'use strict';
const { createSemanticQueries } = require('../../../media/semantic-query');
const { createArchitecture } = require('../architecture');
const { normalizeRange } = require('../correspondence/source');
const { logicalRef, isHash } = require('../snapshot');
const { failure, hash, stable, copyJson, deepFreeze, DEFAULT_LIMITS } = require('../json');
function createSourceContext(sourceModel, analysis, importResult) {
    if (!sourceModel) return null;
    // Source-only callers transfer a bounded data snapshot, never filesystem authority or mutable indexes.
    const model = analysis ? sourceModel : deepFreeze(copyJson(sourceModel, DEFAULT_LIMITS));
    const map = name => new Map((model[name] || []).map(x => [x.id, x]));
    const documents = map('sourceDocuments'), records = new Map();
    const collections = ['definitions', 'instances', 'endpoints', 'stateBehaviors', 'bindings', 'semanticFlows',
        'sourceReferences', 'statements', 'expressions', 'callSites', 'functionDefinitions', 'supplements'];
    for (const name of collections) for (const record of model[name] || []) records.set(record.id, record);
    const architecture = analysis && importResult ? createArchitecture({ analysis, importResult }) : null;
    const source = { model, records, documents, architecture, instances: map('instances'), endpoints: map('endpoints'),
        functions: map('functionDefinitions'), expressions: map('expressions'), statements: map('statements'), calls: map('callSites'),
        bindings: map('bindings'), behaviors: model.stateBehaviors || [], semantic: createSemanticQueries(model),
        documentFor: entity => documents.get(entity.sourceDocumentId || entity.sourceRange?.uri || entity.location?.uri || entity.uri),
        freshness: analysis?.freshness || { status: 'captured', documents: [...documents.values()].map(d =>
            ({ pathRef: d.relativePath, revision: d.revision, contentHash: d.revision, status: 'captured', currentHash: null })) } };
    source.ownerOf = entity => architecture?.entities[entity.id]?.ownerInstanceId || entity.ownerInstanceId ||
        (source.instances.has(entity.id) ? entity.primitiveKind ? entity.parentInstanceId : entity.id : null);
    const verified = new Set(), refs = new Map();
    source.reference = (entity, ownerInstanceId = null, occurrenceId = null) => {
        const location = entity.sourceRange || entity.location;
        if (!location) return null;
        const document = source.documentFor(entity);
        if (!document) throw failure('INVALID_RANGE', 'Source record has no captured document');
        if (!verified.has(document.id)) {
            logicalRef(document.relativePath);
            if (typeof document.content !== 'string' || !isHash(document.revision) || hash(document.content) !== document.revision)
                throw failure('SOURCE_REVISION_MISMATCH', 'Source document revision differs from full text');
            verified.add(document.id);
        }
        if (entity.sourceRevision && entity.sourceRevision !== document.revision) throw failure('SOURCE_REVISION_MISMATCH', 'Source record revision differs from document');
        const key = `${entity.id}\0${ownerInstanceId}\0${occurrenceId}`;
        if (refs.has(key)) return refs.get(key);
        const range = normalizeRange(document.content, { unit: 'position', encoding: 'utf16', base: 0,
            start: { line: location.line, column: location.column }, end: { line: location.endLine, column: location.endColumn } });
        if (entity.range && (entity.range.start !== range.start || entity.range.end !== range.end))
            throw failure('INVALID_RANGE', 'Source offset/position ranges disagree');
        const value = { pathRef: document.relativePath, revision: document.revision, contentHash: document.revision,
            sourceKind: entity.kind || 'source', semanticId: entity.id, ownerInstanceId, occurrenceId,
            range: { start: range.start, end: range.end, text: range.text }, text: range.text, sliceHash: range.sliceHash };
        const ref = deepFreeze({ id: `analysis-source-${hash(stable(value))}`, ...value }); refs.set(key, ref); return ref;
    };
    return source;
}
module.exports = { createSourceContext };
