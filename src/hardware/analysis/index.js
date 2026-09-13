'use strict';
const { deepFreeze, failure, hash, stable } = require('../json');
const { checkedJson } = require('../correspondence/schema');
const { normalize, DEFAULT_LIMITS, KINDS, fields } = require('./input');
const { runWorker } = require('./execution');
const { SOURCE_KINDS } = require('./source-input');
const { createSourceContext } = require('./source-context');

function createAnalysisQuery({ importResult = null, analysis = null, originCase = null, sourceBindings = [], sourceModel = null } = {}) {
    if (!importResult && !sourceModel && !analysis) throw failure('INVALID_INPUT', 'Hardware or source model required');
    if (importResult && (!Object.isFrozen(importResult) || !Object.isFrozen(importResult.implementation) ||
        importResult.snapshot.id !== importResult.implementation.snapshot.id)) throw failure('INVALID_INPUT', 'Immutable product import required');
    if (analysis) {
        require('../correspondence').getCoverage(analysis);
        if (analysis.implementationSnapshotId !== (importResult?.snapshot.id || null) || analysis.implementationModelId !== (importResult?.implementation.id || null))
            throw failure('SNAPSHOT_MISMATCH', 'Foreign attached analysis');
        if (sourceModel && sourceModel !== analysis.sourceModel) throw failure('SOURCE_REVISION_MISMATCH', 'Foreign source model');
        sourceModel = analysis.sourceModel;
    }
    if (originCase) {
        require('../correspondence/origin').getCoverage(originCase.analysis);
        const imported = originCase.request.importResult;
        if (!Object.isFrozen(imported) || originCase.analysis.bundle.implementationSnapshotId !== imported.snapshot.id ||
            originCase.analysis.bundle.implementationModelId !== imported.implementation.id) throw failure('SNAPSHOT_MISMATCH', 'Foreign origin capture');
    }
    const source = createSourceContext(sourceModel, analysis, importResult);
    if (source) sourceModel = source.model;
    const bindings = checkedJson(sourceBindings);
    if (!Array.isArray(bindings)) throw failure('INVALID_INPUT', 'Source binding array required');
    const seen = new Set();
    for (const b of bindings) {
        fields(b, ['sourcePathRef','sourceRevision','originPathRef','originRevision'], 'source binding');
        const source = sourceModel?.sourceDocuments.find(d => d.relativePath === b.sourcePathRef && d.revision === b.sourceRevision);
        const origin = originCase?.request.files.find(f => f.kind === 'source' && f.pathRef === b.originPathRef && f.contentHash === b.originRevision);
        if (!source || !origin || b.sourceRevision !== b.originRevision || hash(source.content) !== b.originRevision)
            throw failure('SOURCE_REVISION_MISMATCH', 'Equal registered source revisions required');
        if (seen.has(b.sourcePathRef) || seen.has(b.originPathRef)) throw failure('INVALID_INPUT', 'Duplicate source binding');
        seen.add(b.sourcePathRef); seen.add(b.originPathRef);
    }
    const attachments = new Map();
    function attach(selector, imported) {
        const model = imported?.implementation || null, snapshot = imported?.snapshot || null;
        const context = deepFreeze({ analysisId: analysis?.id || `analysis-context-${hash(stable({ snapshotId: snapshot?.id || null,
            sourceModelIdentity: sourceModel ? hash(stable(sourceModel)) : null }))}`,
            snapshotId: snapshot?.id || null, modelId: model?.id || null, implementationProvider: selector,
            providerIdentity: snapshot?.providerIdentity || null, stage: snapshot?.stage ?? null,
            artifactHash: snapshot?.artifact.hash || null, buildInputFingerprint: snapshot?.buildInputFingerprint || null,
            sourceModelIdentity: analysis?.sourceModelIdentity || (sourceModel ? hash(stable(sourceModel)) : null),
            sourceStatus: sourceModel ? 'attached' : 'not-attached', originAnalysisId: selector === 'instrumented' ? originCase.analysis.id : null,
            freshness: imported?.availability.freshness || 'unknown', unknownInputs: snapshot?.unknownInputs || [],
            capabilities: Object.fromEntries(KINDS.map(kind => [kind,
                SOURCE_KINDS.includes(kind) ? (kind === 'correspondence' ? analysis || originCase : source) ? 'available' : 'not-attached'
                    : model ? 'available' : 'not-attached'])) });
        const owners = Object.create(null);
        for (const owner of analysis?.correspondence.contexts || []) {
            const id = owner.contextOccurrenceId || owner.implementationOccurrenceId;
            if (selector === 'stock') owners[owner.occurrenceId] = id;
            else {
                const path = importResult.implementation.occurrences[id]?.path;
                // Equal captured source revisions are necessary for any cross-provider BSV owner join.
                if (bindings.some(b => b.sourcePathRef === owner.sourceRef.pathRef && b.sourceRevision === owner.sourceRef.revision))
                    owners[owner.occurrenceId] = Object.values(model.occurrences).find(o => stable(o.path) === stable(path))?.id;
            }
        }
        attachments.set(selector, { model, context, owners, source, analysis, originCase, sourceBindings: bindings,
            stockModel: importResult?.implementation || null });
    }
    attach('stock', importResult);
    if (originCase) attach('instrumented', originCase.request.importResult);
    function attachment(provider = 'stock') {
        if (!['stock','instrumented'].includes(provider)) throw failure('INVALID_INPUT', 'Unknown implementation provider');
        const value = attachments.get(provider);
        if (!value) throw failure('UNAVAILABLE', 'Requested provider is not attached');
        return value;
    }
    return Object.freeze({ getContext(provider) { return attachment(provider).context; },
        async query(input, { signal, onProgress } = {}) {
            if (signal?.aborted) throw failure('CANCELLED', 'Analysis cancelled');
            // Copy hostile input before reading even its selector; model objects never come from requests.
            const copied = checkedJson(input, { maxBytes: 1048576, maxJsonNodes: 20000, maxJsonDepth: 12 });
            const attached = attachment(copied?.implementationProvider);
            const normalized = normalize(copied, attached);
            if (SOURCE_KINDS.includes(normalized.kind)) return require('./source').executeSource(attached, normalized, signal, onProgress);
            return runWorker({ model: attached.model, query: normalized }, signal, onProgress);
        } });
}
function createAnalysisSession(options) { return new (require('./session').AnalysisSession)(options?.query && options?.getContext ? options : createAnalysisQuery(options)); }
module.exports = { createAnalysisQuery, createAnalysisSession, DEFAULT_LIMITS };
