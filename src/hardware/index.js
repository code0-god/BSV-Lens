'use strict';

const { Worker } = require('node:worker_threads');
const { EventEmitter } = require('node:events');
const { ArtifactRegistry, createArtifactRegistry } = require('./registry');
const provider = require('./yosys-json');
const { normalizeManifest, withFreshness } = require('./snapshot');
const { copyJson, deepFreeze, failure, classify, DEFAULT_LIMITS } = require('./json');

function cancelled(signal) {
    if (signal?.aborted) throw failure('CANCELLED', 'Hardware import cancelled');
}
async function runWorker(data, signal, onProgress) {
    cancelled(signal);
    const worker = new Worker(require.resolve('./import-worker'), { workerData: data,
        resourceLimits: { maxOldGenerationSizeMb: 512, stackSizeMb: 4 } });
    const threadId = worker.threadId;
    let result, error, aborted = false;
    // Both normal completion and cancellation settle only on the real exit event.
    return new Promise((resolve, reject) => {
        const abort = () => {
            aborted = true;
            worker.terminate().catch(cause => { error = cause; });
        };
        worker.on('message', message => {
            if (aborted) return;
            if (message.type === 'progress') {
                try { onProgress?.(deepFreeze({ phase: message.phase, threadId: message.threadId })); }
                catch (cause) { error = cause; abort(); }
            } else if (message.type === 'result') result = message.value;
            else if (message.type === 'failure') error = failure(message.error.code, message.error.message);
        });
        worker.on('error', cause => { error = cause; });
        worker.once('exit', code => {
            signal?.removeEventListener('abort', abort);
            try { onProgress?.(deepFreeze({ phase: 'exited', threadId, exitCode: code, cancelled: aborted || !!signal?.aborted })); }
            catch (cause) { error = cause; }
            if (error) reject(error);
            else if (aborted || signal?.aborted) reject(failure('CANCELLED', 'Hardware import cancelled'));
            else if (code !== 0 || !result) reject(failure('INVALID_INPUT', `Hardware import worker exited without a result (${code})`));
            else {
                // Structured clone does not preserve null-prototype JSON dictionaries.
                const model = result.implementation;
                for (const name of ['definitions', 'occurrences', 'cells', 'ports', 'pins', 'bits', 'aliases', 'memories', 'boundaries', 'entities']) Object.setPrototypeOf(model[name], null);
                const pending = [model.raw];
                while (pending.length) {
                    const item = pending.pop();
                    if (!item || typeof item !== 'object') continue;
                    if (!Array.isArray(item)) Object.setPrototypeOf(item, null);
                    for (const value of Object.values(item)) pending.push(value);
                }
                resolve(deepFreeze(result));
            }
        });
        signal?.addEventListener('abort', abort, { once: true });
        if (signal?.aborted) abort();
    });
}
async function importArtifact({ registry, artifactRef, manifest, limits, expectedArtifactHash, signal, onProgress }) {
    try {
        cancelled(signal);
        if (!(registry instanceof ArtifactRegistry)) throw failure('INVALID_INPUT', 'Product artifact registry required');
        // Copy before asynchronous I/O: subsequent caller mutation cannot change a request.
        const copiedManifest = normalizeManifest(manifest);
        const copiedLimits = limits === undefined ? undefined : copyJson(limits, DEFAULT_LIMITS);
        if (copiedLimits) for (const [key, value] of Object.entries(copiedLimits)) {
            if (!Object.hasOwn(DEFAULT_LIMITS, key) || !Number.isSafeInteger(value) || value < 1 || value > DEFAULT_LIMITS[key]) throw failure('INVALID_INPUT', `Invalid limit: ${key}`);
        }
        const artifact = await registry.readArtifact(artifactRef, copiedLimits?.maxBytes);
        cancelled(signal);
        const result = await runWorker({ text: artifact.text, artifactRef, manifest: copiedManifest,
            limits: copiedLimits, expectedArtifactHash }, signal, onProgress);
        cancelled(signal);
        const freshness = await registry.checkFreshness(result.snapshot);
        cancelled(signal);
        return withFreshness(result, freshness);
    } catch (error) { throw classify(error); }
}
class ImportSession extends EventEmitter {
    #revision = 0;
    #freshnessRevision = 0;
    #pending = new Set();
    #state = deepFreeze({ revision: 0, status: 'idle', current: null, error: null });
    getState() { return this.#state; }
    #publish(status, current, error = null) {
        this.#state = deepFreeze({ revision: this.#revision, status, current, error });
        this.emit('state', this.#state);
    }
    import(request) {
        let validationError;
        try {
            request = { ...request, manifest: normalizeManifest(request.manifest),
                ...(request.limits === undefined ? {} : { limits: copyJson(request.limits, DEFAULT_LIMITS) }) };
        } catch (error) { validationError = classify(error); }
        const revision = ++this.#revision;
        for (const pending of this.#pending) pending.controller.abort();
        const controller = new AbortController();
        const forwardAbort = () => controller.abort();
        request.signal?.addEventListener('abort', forwardAbort, { once: true });
        if (request.signal?.aborted) controller.abort();
        const entry = { controller, promise: null };
        this.#pending.add(entry);
        // Start on a microtask so reentrant state observers see a registered attempt.
        const promise = Promise.resolve().then(async () => {
            try {
                if (validationError) throw validationError;
                const result = await importArtifact({ ...request, signal: controller.signal,
                    onProgress: event => {
                        if (revision !== this.#revision) return;
                        this.emit('worker', deepFreeze({ revision, ...event }));
                        request.onProgress?.(event);
                    } });
                if (revision !== this.#revision) throw failure('SUPERSEDED', 'A newer hardware import owns publication');
                if (result.availability.freshness === 'stale') throw failure('STALE_SOURCE', 'Declared sources changed; previous snapshot retained');
                this.#publish(result.availability.status, result);
                return result;
            } catch (error) {
                if (revision !== this.#revision) throw failure('SUPERSEDED', 'A newer hardware import owns publication');
                this.#publish(error.code === 'CANCELLED' ? 'cancelled' : error.code === 'STALE_SOURCE' ? 'stale' : 'failed', this.#state.current,
                    { code: error.code || 'INVALID_INPUT', message: error.message });
                throw error;
            } finally {
                request.signal?.removeEventListener('abort', forwardAbort);
                this.#pending.delete(entry);
            }
        });
        entry.promise = promise;
        this.#publish('importing', this.#state.current);
        return promise;
    }
    async cancel() {
        const pending = [...this.#pending];
        for (const entry of pending) entry.controller.abort();
        await Promise.allSettled(pending.map(entry => entry.promise));
    }
    async refresh(registry) {
        const revision = this.#revision;
        const freshnessRevision = ++this.#freshnessRevision;
        const current = this.#state.current;
        if (!current) return this.#state;
        const freshness = await registry.checkFreshness(current.snapshot);
        if (revision !== this.#revision || freshnessRevision !== this.#freshnessRevision || this.#state.current !== current) return this.#state;
        const refreshed = withFreshness(current, freshness);
        this.#publish(this.#pending.size ? this.#state.status : refreshed.availability.status, refreshed);
        return this.#state;
    }
}
const createImportSession = () => new ImportSession();
module.exports = { createArtifactRegistry, importArtifact, createImportSession,
    getChildren: provider.getChildren, getPorts: provider.getPorts, getNetEndpoints: provider.getNetEndpoints,
    crossHierarchyBoundary: provider.crossHierarchyBoundary, getGeneratedEvidence: provider.getGeneratedEvidence,
    DEFAULT_LIMITS: provider.DEFAULT_LIMITS };

// Lazy G5 seam: existing G2 exports retain their original function identities.
module.exports.createAnalysisQuery = options => require('./analysis').createAnalysisQuery(options);
module.exports.createAnalysisSession = options => require('./analysis').createAnalysisSession(options);
