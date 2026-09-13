'use strict';

const { Worker } = require('node:worker_threads');
const { EventEmitter } = require('node:events');
const fs = require('node:fs/promises');
const path = require('node:path');
const { copyJson, deepFreeze, stable, hash, failure, DEFAULT_LIMITS } = require('../json');
const { logicalRef, isHash } = require('../snapshot');
const base = require('./index');
const contexts = new WeakMap();
const cancelled = signal => { if (signal?.aborted) throw failure('CANCELLED', 'Origin attachment cancelled'); };

async function attachOrigins(input) {
    if (!input || !Array.isArray(input.files) || input.files.length > 512) throw failure('INVALID_INPUT', 'Origin evidence descriptors required');
    input = { ...input };
    if (input.signal != null && !(input.signal instanceof AbortSignal) ||
        input.onProgress !== undefined && typeof input.onProgress !== 'function') throw failure('INVALID_INPUT', 'Origin signal/callback contract');
    const captured = copyJson({ sidecar: input.sidecar, files: input.files, authority: input.authority }, DEFAULT_LIMITS);
    const copied = { ...captured, files: [...captured.files].sort((a, b) => a.captureRef < b.captureRef ? -1 : a.captureRef > b.captureRef ? 1 : 0) };
    const seen = new Set();
    for (const entry of [copied.sidecar, ...copied.files]) {
        logicalRef(entry.pathRef);
        if (!isHash(entry.contentHash)) throw failure('INVALID_INPUT', 'Origin evidence hash required');
        if (entry.captureRef !== undefined) {
            logicalRef(entry.captureRef);
            if (seen.has(entry.captureRef) || !['source', 'artifact'].includes(entry.kind)) throw failure('INVALID_INPUT', 'Duplicate/invalid capture descriptor');
            seen.add(entry.captureRef);
        }
    }
    if (copied.authority.provider !== 'isolated-bsc-ghc96-root-observer-v1' ||
        copied.authority.kind !== 'caller-approved-instrumented-capture') throw failure('UNSUPPORTED', 'Untrusted origin provider');
    cancelled(input.signal);
    const sources = copied.files.filter(f => f.kind === 'source').map(f => ({ pathRef: f.pathRef, contentHash: f.contentHash, revision: f.contentHash }));
    const sourceAnalysis = await base.attachCorrespondence({ registry: input.registry, importResult: input.importResult, sources, signal: input.signal });
    let total = 0;
    const files = await Promise.all(copied.files.map(async entry => {
        const result = entry.kind === 'source' ? await input.registry.readSource(entry) : await input.registry.readArtifact(entry.pathRef);
        if (typeof result.text !== 'string' || hash(result.text) !== entry.contentHash) throw failure('ARTIFACT_HASH_MISMATCH', 'Origin input hash mismatch');
        total += Buffer.byteLength(result.text);
        if (total > 64 * 1024 * 1024) throw failure('LIMIT_EXCEEDED', 'Origin capture byte limit');
        return { ...entry, text: result.text };
    }));
    const sidecar = await input.registry.readArtifact(copied.sidecar.pathRef);
    if (sidecar.contentHash !== copied.sidecar.contentHash) throw failure('ARTIFACT_HASH_MISMATCH', 'Origin sidecar hash mismatch');
    cancelled(input.signal);
    const adapterFiles = await Promise.all(['origin.js', 'origin-data.js', 'origin-worker.js'].map(async name =>
        ({ path: `src/hardware/correspondence/${name}`, hash: hash(await fs.readFile(path.join(__dirname, name))) })));
    const adapterIdentity = hash(stable({ files: adapterFiles, sourceAnalysisId: sourceAnalysis.id }));
    const evidenceIdentity = hash(stable(copied));
    const worker = new Worker(require.resolve('./origin-worker'), { resourceLimits: { maxOldGenerationSizeMb: 512, stackSizeMb: 4 },
        workerData: { files, sidecarText: sidecar.text, authority: copied.authority, evidenceIdentity, adapterIdentity,
            importResult: input.importResult, baseClaims: sourceAnalysis.correspondence.claims } });
    let result, error, aborted = false;
    await new Promise((resolve, reject) => {
        const abort = () => { aborted = true; worker.terminate().catch(cause => { error = cause; }); };
        const timer = setTimeout(() => { error = failure('LIMIT_EXCEEDED', 'Origin validation deadline'); abort(); }, 30000);
        worker.on('message', message => {
            if (aborted) return;
            if (message.type === 'progress') {
                try { input.onProgress?.({ phase: message.phase, threadId: worker.threadId }); } catch (cause) { error = cause; abort(); }
            } else if (message.type === 'error') error = failure(message.code, message.message);
            else result = message.result;
        });
        worker.on('error', cause => { error = cause; });
        worker.once('exit', exitCode => {
            clearTimeout(timer); input.signal?.removeEventListener('abort', abort);
            try { input.onProgress?.({ phase: 'exited', exitCode, cancelled: aborted }); } catch (cause) { error = cause; }
            if (error) reject(error);
            else if (aborted || input.signal?.aborted) reject(failure('CANCELLED', 'Origin worker terminated'));
            else if (exitCode !== 0 || !result) reject(failure('INVALID_INPUT', 'Origin worker produced no valid result'));
            else resolve();
        });
        input.signal?.addEventListener('abort', abort, { once: true });
        if (input.signal?.aborted) abort();
    });
    for (const descriptor of [copied.sidecar, ...copied.files.filter(f => f.kind === 'artifact')]) {
        const current = await input.registry.readArtifact(descriptor.pathRef);
        if (current.contentHash !== descriptor.contentHash) throw failure('ARTIFACT_HASH_MISMATCH', 'Origin evidence changed during validation');
    }
    cancelled(input.signal);
    const refreshed = await base.refreshFreshness(sourceAnalysis, input.registry);
    cancelled(input.signal);
    const analysis = deepFreeze({ id: `origin-analysis-${hash(stable({ snapshot: input.importResult.snapshot.id, bundle: result.bundle.id }))}`,
        bundle: result.bundle, freshness: refreshed.freshness });
    contexts.set(analysis, { explanations: deepFreeze(result.explanations), sourceAnalysis: refreshed, expected: result.bundle });
    return analysis;
}
function trusted(analysis) {
    const context = contexts.get(analysis);
    if (!context) throw failure('INVALID_INPUT', 'Product origin AnalysisBundle required');
    return context;
}
function query(analysis, options = {}, reverse = false) {
    const context = trusted(analysis);
    if (!options || Object.keys(options).some(key => !['contribution', 'snapshotId', 'mode', 'limit', 'semanticId',
        'token', 'sourceRevision', 'occurrencePath', 'entityId', 'family'].includes(key))) throw failure('INVALID_INPUT', 'Unknown origin query field');
    if (options.family !== undefined && options.family !== 'origin') throw failure('UNSUPPORTED', 'Origin query family required');
    if (options.mode !== undefined && !['build', 'current-source'].includes(options.mode)) throw failure('INVALID_INPUT', 'Unknown origin query mode');
    if (options.occurrencePath !== undefined && (!Array.isArray(options.occurrencePath) ||
        options.occurrencePath.some(part => typeof part !== 'string' || !part))) throw failure('INVALID_INPUT', 'Origin occurrence path tokens required');
    if (reverse && typeof options.entityId !== 'string') throw failure('INVALID_INPUT', 'Origin target ID required');
    if (!['known', 'complete', undefined].includes(options.contribution)) throw failure('INVALID_INPUT', 'Unknown origin contribution scope');
    if (options.snapshotId && options.snapshotId !== analysis.bundle.implementationSnapshotId) throw failure('INVALID_INPUT', 'Foreign origin snapshot');
    if (options.sourceRevision !== undefined && !isHash(options.sourceRevision)) throw failure('INVALID_INPUT', 'Source revision SHA256 required');
    if (options.mode === 'current-source' && analysis.freshness.status !== 'current') return { resolution: 'stale', claims: [], freshness: analysis.freshness };
    if (options.sourceRevision && !context.sourceAnalysis.correspondence.evidenceSet.sources.some(source =>
        source.revision === options.sourceRevision)) return deepFreeze({
        resolution: 'stale', claims: [], freshness: analysis.freshness,
        unresolved: [{ reason: 'source-revision-not-in-build' }]
    });
    const limit = options.limit ?? 1000;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 30000) throw failure('LIMIT_EXCEEDED', 'Origin query limit');
    const claims = options.contribution === 'complete' ? [] : analysis.bundle.claims.filter(claim =>
        (!reverse || claim.target.entityId === options.entityId) &&
        (!options.semanticId || claim.source.semanticId === options.semanticId) &&
        (!options.token || claim.source.token === options.token) &&
        (!options.sourceRevision || claim.source.revision === options.sourceRevision) &&
        (!options.occurrencePath || stable(claim.target.occurrencePath) === stable(options.occurrencePath)));
    const contexts = new Set(claims.map(c => c.target.occurrenceId));
    return deepFreeze({ resolution: claims.length ? contexts.size > 1 ? 'ambiguous' : 'resolved' : 'unmapped',
        claims: claims.slice(0, limit), truncated: claims.length > limit, freshness: analysis.freshness,
        limitations: ['known contributors only', 'no complete origin sets', 'no inferred surrounding net or cell causes'],
        unresolved: analysis.bundle.unresolved });
}
function explainMapping(analysis, claimId) {
    const context = trusted(analysis), claim = analysis.bundle.claims.find(c => c.id === claimId);
    if (!claim) throw failure('INVALID_INPUT', 'Unknown origin claim');
    return deepFreeze({ claim, ...context.explanations.find(e => e.linkId === claim.linkId) });
}
function validateBundle(bundle, analysis) {
    if (stable(copyJson(bundle, DEFAULT_LIMITS)) !== stable(trusted(analysis).expected)) throw failure('ORIGIN_CONTRADICTION', 'Origin claims differ from validated captured transformations');
    return true;
}
async function refreshFreshness(analysis, registry) {
    const context = trusted(analysis), refreshed = await base.refreshFreshness(context.sourceAnalysis, registry);
    const next = deepFreeze({ ...analysis, freshness: refreshed.freshness });
    contexts.set(next, { ...context, sourceAnalysis: refreshed });
    return next;
}
class OriginSession extends EventEmitter {
    #revision = 0;
    #refreshRevision = 0;
    #pending = new Set();
    #state = deepFreeze({ revision: 0, status: 'idle', current: null, error: null });
    getState() { return this.#state; }
    #publish(status, current, error = null) {
        this.#state = deepFreeze({ revision: this.#revision, status, current, error });
        this.emit('state', this.#state);
    }
    attach(request) {
        const revision = ++this.#revision;
        for (const pending of this.#pending) pending.controller.abort();
        const controller = new AbortController(), entry = { controller, promise: null };
        const signal = request?.signal instanceof AbortSignal ? request.signal : null;
        const abort = () => controller.abort();
        signal?.addEventListener('abort', abort, { once: true });
        if (signal?.aborted) controller.abort();
        this.#pending.add(entry);
        const operation = !request || request.signal != null && !signal
            ? Promise.reject(failure('INVALID_INPUT', 'Origin session request/signal required'))
            : attachOrigins({ ...request, signal: controller.signal, onProgress: event => {
                this.emit('worker', { revision, ...event });
                if (revision === this.#revision) request.onProgress?.(event);
            } });
        entry.promise = operation.then(result => {
            if (revision !== this.#revision) throw failure('SUPERSEDED', 'Newer origin attachment owns publication');
            if (!['current', 'not-attached'].includes(result.freshness.status)) throw failure('STALE_SOURCE', 'Historical origin cannot replace current mapping');
            this.#publish('ready', result);
            return result;
        }).catch(error => {
            if (revision !== this.#revision) throw failure('SUPERSEDED', 'Newer origin attachment owns publication');
            this.#publish(error.code === 'CANCELLED' ? 'cancelled' : 'failed', this.#state.current,
                { code: error.code || 'INVALID_INPUT', message: error.message });
            throw error;
        }).finally(() => { signal?.removeEventListener('abort', abort); this.#pending.delete(entry); });
        this.#publish('attaching', this.#state.current);
        return entry.promise;
    }
    async cancel() {
        const pending = [...this.#pending];
        for (const entry of pending) entry.controller.abort();
        await Promise.allSettled(pending.map(entry => entry.promise));
    }
    async refresh(registry) {
        const revision = this.#revision, refresh = ++this.#refreshRevision, current = this.#state.current;
        if (!current) return this.#state;
        const result = await refreshFreshness(current, registry);
        if (revision === this.#revision && refresh === this.#refreshRevision && this.#state.current === current)
            this.#publish(this.#pending.size ? this.#state.status : result.freshness.status === 'current' ? 'ready' : 'stale', result);
        return this.#state;
    }
}
module.exports = { attachOrigins, sourceToImplementation: (a, q) => query(a, q),
    implementationToSource: (a, q) => query(a, q, true), explainMapping, validateBundle, refreshFreshness,
    createOriginSession: () => new OriginSession(),
    getCoverage(analysis) { trusted(analysis); return analysis.bundle.coverage; } };
