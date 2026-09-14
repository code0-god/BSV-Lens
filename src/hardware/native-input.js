'use strict';

const path = require('node:path');
const { importArtifact } = require('./index');
const { attachCorrespondence, listSourceEntries } = require('./correspondence');
const { attachOrigins } = require('./correspondence/origin');
const { createSceneQuery } = require('./scene-query');
const { hash, stable, failure, copyJson, DEFAULT_LIMITS } = require('./json');
const { validateNativeManifest, LIMITS } = require('./native-input-schema');
const { approvedRoot, discoverSources, createInputReader, cancelled } = require('./native-input-io');

async function loadNativeInput({ sourceRoot, artifactRoot, rootGrants, manifest, artifactPath, signal, onProgress, sourceSession,
    sourceEntry, selectSourceEntry, onSourceIndex, discovery, originApproved = false } = {}) {
    if (signal != null && !(signal instanceof AbortSignal) || onProgress !== undefined && typeof onProgress !== 'function'
        || selectSourceEntry !== undefined && typeof selectSourceEntry !== 'function'
        || onSourceIndex !== undefined && typeof onSourceIndex !== 'function'
        || typeof originApproved !== 'boolean') throw failure('INVALID_INPUT', 'Invalid native input callback/approval');
    const config = validateNativeManifest(manifest);
    if (artifactPath !== undefined) {
        if (config.artifact) throw failure('INVALID_INPUT', 'Choose one artifact descriptor');
        config.artifact = validateNativeManifest({ version: 1, artifact: { path: artifactPath } }).artifact;
    }
    if (config.origin && !originApproved) throw failure('FORBIDDEN', 'Instrumented capture requires a separate host approval');
    const grants = rootGrants === undefined ? undefined : copyJson(rootGrants, { ...DEFAULT_LIMITS, maxBytes: 16384, maxJsonDepth: 3, maxJsonNodes: 32 });
    if (grants != null && (typeof grants !== 'object' || Array.isArray(grants)
        || Object.keys(grants).some(key => !['sourceRoot', 'artifactRoot'].includes(key)))) throw failure('PATH_DENIED', 'Invalid host root grants');
    cancelled(signal);
    const roots = { sourceRoot: await approvedRoot(sourceRoot, grants?.sourceRoot), artifactRoot: await approvedRoot(artifactRoot, grants?.artifactRoot) };
    const verifyGrants = async () => {
        await approvedRoot(roots.sourceRoot, grants?.sourceRoot); await approvedRoot(roots.artifactRoot, grants?.artifactRoot); cancelled(signal);
    };
    const reader = createInputReader({ ...roots, rootGrants: grants, signal,
        ...(discovery?.limits?.maxFileBytes ? { maxSourceFileBytes: discovery.limits.maxFileBytes } : {}) });
    const progress = phase => { cancelled(signal); onProgress?.({ phase }); cancelled(signal); };
    progress('source-registration');
    await verifyGrants();
    const descriptors = config.sources ?? await discoverSources(roots.sourceRoot, signal);
    const documents = [];
    for (const descriptor of descriptors) documents.push(await reader.read(descriptor, 'source'));
    const sources = documents.map(({ pathRef, contentHash }) => ({ pathRef, contentHash, revision: contentHash }));
    let sourceEntries = null, sourceIndexStatus = null, selectedSourceEntry = sourceEntry || null;
    if (sources.length && (selectSourceEntry || sourceEntry)) {
        if (config.artifact || config.metadata || config.origin || config.generatedRtl?.length)
            throw failure('INVALID_INPUT', 'Source design selection is independent of compiler artifact correspondence');
        progress('source-design-index');
        sourceEntries = await listSourceEntries({ registry: reader.registry, sources, sourceSession, signal, onProgress });
        sourceIndexStatus = Object.freeze({ status: sourceEntries.status, totalEntries: sourceEntries.totalEntries,
            entryLimit: sourceEntries.entryLimit, returnedEntries: sourceEntries.entries.length });
        onSourceIndex?.({ designs: sourceEntries.entries, sourceSetIdentity: sourceEntries.sourceSetIdentity,
            sourceFiles: sourceEntries.sourceFiles, sourceIndexStatus, entryId: null });
        if (selectedSourceEntry) {
            const matching = sourceEntries.entries.filter(entry => entry.pathRef === selectedSourceEntry.pathRef
                && entry.revision === selectedSourceEntry.revision && entry.definitionId === selectedSourceEntry.definitionId);
            if (matching.length !== 1) throw failure('SOURCE_REVISION_MISMATCH', 'Selected source design no longer matches the discovered source revision');
            onSourceIndex?.({ designs: sourceEntries.entries, sourceSetIdentity: sourceEntries.sourceSetIdentity,
                sourceFiles: sourceEntries.sourceFiles, sourceIndexStatus, entryId: matching[0].id });
        } else if (sourceEntries.entries.length) {
            const selected = await selectSourceEntry(sourceEntries.entries, { signal, indexStatus: sourceIndexStatus }); cancelled(signal);
            if (!selected) throw failure('CANCELLED', 'Source design selection cancelled');
            const entry = sourceEntries.entries.find(entry => entry.id === selected);
            if (!entry) throw failure('FORBIDDEN', 'Selected source design is not in this workspace inventory');
            selectedSourceEntry = { pathRef: entry.pathRef, revision: entry.revision, definitionId: entry.definitionId };
            onSourceIndex?.({ designs: sourceEntries.entries, sourceSetIdentity: sourceEntries.sourceSetIdentity,
                sourceFiles: sourceEntries.sourceFiles, sourceIndexStatus, entryId: entry.id });
        }
    }
    async function readArtifact(descriptor) {
        const row = await reader.read(descriptor, 'artifact');
        return { pathRef: row.pathRef, contentHash: row.contentHash };
    }
    async function implementation(descriptor) {
        const row = await readArtifact(descriptor);
        return importArtifact({ registry: reader.registry, artifactRef: row.pathRef,
            expectedArtifactHash: row.contentHash, manifest: descriptor.manifest, signal, onProgress });
    }
    progress('artifact-import');
    const imported = config.artifact ? await implementation(config.artifact) : null;
    const metadata = config.metadata ? { ...await readArtifact(config.metadata), provider: config.metadata.provider,
        sourceInputs: config.metadata.sourceInputs } : null;
    const generatedRtl = [];
    for (const descriptor of config.generatedRtl || []) generatedRtl.push(await readArtifact(descriptor));
    if (metadata && !sources.length) throw failure('INVALID_INPUT', 'Correspondence metadata needs selected source documents');
    progress('correspondence-attach');
    const analysis = sources.length ? await attachCorrespondence({ registry: reader.registry, importResult: imported,
        sources, metadata, generatedRtl, signal, onProgress, ...(sourceSession ? { sourceSession } : {}),
        ...(selectedSourceEntry ? { sourceEntry: selectedSourceEntry } : {}) }) : null;
    let originCase = null;
    if (config.origin) {
        if (!analysis || !imported) throw failure('INVALID_INPUT', 'Origin mode requires source and stock implementation context');
        progress('origin-registration');
        const sidecar = await readArtifact(config.origin.sidecar), files = [];
        for (const descriptor of config.origin.files) {
            const row = await reader.read(descriptor, descriptor.kind);
            files.push({ pathRef: row.pathRef, contentHash: row.contentHash, captureRef: descriptor.captureRef, kind: descriptor.kind });
        }
        const importResult = await implementation(config.origin.artifact);
        const request = { registry: reader.registry, importResult, sidecar, files,
            authority: { ...config.origin.authority, kind: 'caller-approved-instrumented-capture' }, signal, onProgress };
        originCase = { request, analysis: await attachOrigins(request) };
    }
    const sourceBindings = config.sourceBindings ?? inferBindings(documents, originCase);
    await reader.verify();
    await verifyGrants();
    progress('scene-preparation');
    const inventory = [...reader.registered.values()].map(({ pathRef, contentHash, kind }) => ({ pathRef, contentHash, kind }))
        .sort((a, b) => a.pathRef < b.pathRef ? -1 : a.pathRef > b.pathRef ? 1 : 0);
    const inputIdentity = hash(stable({ version: 1, manifest: config, inventory, ...(selectedSourceEntry ? { sourceEntry: selectedSourceEntry } : {}) }));
    const buildId = `native-${inputIdentity.slice(0, 20)}`;
    const label = config.label || path.basename(roots.sourceRoot || roots.artifactRoot || 'No input');
    const options = { buildId, label, importResult: imported, analysis, originCase, sourceBindings };
    const prepared = imported || analysis ? queriesForRoots(options) : { catalog: [], roots: [], entrypoints: [], rtlCandidates: 0 };
    if (imported && analysis && !metadata) {
        const rtl = queriesForRoots({ buildId: `${buildId}-rtl`, label: `${label}: RTL · source not mapped`, importResult: imported });
        prepared.catalog.push(...rtl.catalog); prepared.roots.push(...rtl.roots);
        prepared.entrypoints.push(...rtl.entrypoints); prepared.rtlCandidates += rtl.rtlCandidates;
    }
    const { catalog, roots: rootCandidates } = prepared;
    const summary = { status: imported ? analysis ? 'source-and-artifact' : 'artifact-only' : analysis ? 'source-only' : 'no-input',
        label, inputIdentity, sourceFiles: documents.length, sourceBytes: documents.reduce((sum, source) => sum + source.bytes, 0),
        indexedSourceFiles: documents.length, analyzedSourceFiles: analysis?.sourceScope?.analyzedFiles ?? documents.length,
        sourceScope: analysis?.sourceScope || null,
        snapshotId: imported?.snapshot.id || null, sourceAnalysisId: analysis?.id || null,
        metadata: metadata ? 'registered' : 'not-provided', origin: originCase ? 'known-contributor-only' : 'not-provided',
        freshness: imported?.availability.freshness || analysis?.freshness.status || 'unknown',
        roots: rootCandidates, entrypoints: prepared.entrypoints,
        entrypointStatus: { status: 'complete', rtlLimit: 128, rtlCandidates: prepared.rtlCandidates },
        limits: LIMITS, compilerExecuted: false };
    if (sourceEntries) Object.assign(summary, { sourceEntries: sourceEntries.entries, sourceSetIdentity: sourceEntries.sourceSetIdentity, sourceIndexStatus,
        selectedDesignId: sourceEntries.entries.find(entry => entry.pathRef === selectedSourceEntry?.pathRef
            && entry.definitionId === selectedSourceEntry?.definitionId)?.id || null });
    if (discovery) summary.discovery = { ...discovery,
        status: discovery.status === 'partial' || sourceIndexStatus?.status === 'limited' ? 'partial' : documents.length && !rootCandidates.length ? 'no-module' : discovery.status,
        ...(sourceIndexStatus ? { sourceIndexStatus } : {}),
        indexedFiles: documents.length, analyzedFiles: summary.analyzedSourceFiles,
        inventoryFingerprint: hash(stable(sources)), included: discovery.included.map(item => ({ ...item,
            contentHash: sources.find(source => source.pathRef === item.path)?.contentHash || null })) };
    await verifyGrants();
    return { catalog, sources: reader.sources, watchFiles: [...reader.watchFiles].sort(), inputIdentity,
        summary, sourceModel: analysis?.sourceModel || null, registry: reader.registry,
        importResult: imported, analysis, originCase, roots, selectedSourceEntry };
}

function queriesForRoots(options) {
    const query = createSceneQuery(options), roots = [...query.getRootCandidates()];
    if (!roots.length && options.analysis && !options.importResult) return { catalog: [], roots: [], entrypoints: [], rtlCandidates: 0 };
    const candidates = query.getEntryCandidates?.();
    if (candidates?.status === 'limited') throw failure('LIMIT_EXCEEDED',
        `Native RTL entry choices exceed ${candidates.limit} (${candidates.totalCandidates} roots and immediate retained modules). Choose a smaller explicit input.`);
    const entrypoints = [...(candidates?.entries || roots)];
    const catalog = candidates || roots.length > 1 ? entrypoints.map(entry => createSceneQuery({ ...options,
        buildId: entrypoints.length > 1 ? `${options.buildId}-${hash(entry.id).slice(0, 10)}` : options.buildId,
        label: candidates ? `${options.label}: RTL ${entry.isDesignRoot ? 'design root' : 'module'} · ${entry.path.join('/')}`
            : `${options.label}: ${entry.label}`, defaultRootInstanceId: entry.id })) : [query];
    return { catalog, roots, entrypoints, rtlCandidates: candidates?.totalCandidates || 0 };
}

function inferBindings(documents, originCase) {
    if (!originCase) return [];
    const captured = originCase.request.files.filter(file => file.kind === 'source');
    const result = [];
    for (const source of documents) {
        const matches = captured.filter(file => file.contentHash === source.contentHash);
        if (matches.length > 1 || matches.length && documents.filter(file => file.contentHash === source.contentHash).length !== 1) {
            throw failure('AMBIGUOUS_SOURCE', 'Equal source captures need explicit sourceBindings');
        }
        if (!matches.length) continue;
        result.push({ sourcePathRef: source.pathRef, sourceRevision: source.contentHash,
            originPathRef: matches[0].pathRef, originRevision: matches[0].contentHash });
    }
    return result;
}

module.exports = { loadNativeInput, validateNativeManifest, NATIVE_INPUT_LIMITS: LIMITS };
