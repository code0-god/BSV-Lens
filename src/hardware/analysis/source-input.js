'use strict';
const { failure } = require('../json');
const { isHash } = require('../snapshot');
const invalid = message => { throw failure('INVALID_INPUT', message); };
const SOURCE_KINDS = ['state-accesses', 'behavior', 'call-site', 'source-dependencies', 'correspondence'];
function normalizeSource(q, attachment) {
    const { fields, inside } = require('./input');
    const { source, model, owners } = attachment;
    fields(q.seed, ['entityId', 'sourceRevision', 'entryCallSiteId'], 'source seed');
    fields(q.scope, ['kind', 'rootOccurrenceId'], 'source scope');
    if (typeof q.seed.entityId !== 'string') invalid('Canonical source entity ID required');
    if (q.mode !== undefined && !['build', 'current-source'].includes(q.mode)) invalid('Unknown source mode');
    const entity = source?.records.get(q.seed.entityId);
    const implementation = q.kind === 'correspondence' && model?.entities[q.seed.entityId];
    if (!entity && !implementation) throw failure(source || implementation ? 'INVALID_INPUT' : 'UNAVAILABLE', 'Canonical source seed is not attached');
    const owner = q.ownerInstanceId ?? null;
    if (owner !== null && (typeof owner !== 'string' || !source?.instances.has(owner))) invalid('Unknown source owner');
    if (q.scope.kind === 'source-only') {
        if (q.scope.rootOccurrenceId !== null || q.implementationOccurrenceId !== null || implementation) invalid('Source-only scope requires null RTL context');
        if (model) invalid('Source-only scope requires a source-only attachment');
    } else {
        if (!model) throw failure('UNAVAILABLE', 'Hardware scope is not attached');
        if (!['occurrence', 'subtree', 'design'].includes(q.scope.kind) || typeof q.scope.rootOccurrenceId !== 'string' || !model.occurrences[q.scope.rootOccurrenceId]) invalid('Unknown source hardware scope');
        if (q.scope.kind === 'design' && !model.roots.includes(q.scope.rootOccurrenceId)) invalid('Design scope requires actual root');
        if (typeof q.implementationOccurrenceId !== 'string' || !model.occurrences[q.implementationOccurrenceId] || !inside(model, q.implementationOccurrenceId, q.scope)) invalid('Unknown/out-of-scope implementation occurrence');
        if (owner !== null && owners[owner] !== q.implementationOccurrenceId) invalid('Foreign source owner implementation context');
        if (implementation && implementation.occurrenceId !== q.implementationOccurrenceId) invalid('Foreign correspondence target');
    }
    if (entity) {
        const callableId = entity.enclosingCallableId || (source.functions.has(entity.id) ? entity.id : null);
        const directOwner = source.ownerOf(entity);
        const entry = q.seed.entryCallSiteId === undefined ? null : source.calls.get(q.seed.entryCallSiteId);
        if (q.seed.entryCallSiteId !== undefined && (!entry || !callableId || entry.calleeDefinitionId !== callableId || entry.resolutionStatus !== 'exact')) invalid('Unverified helper entry call site');
        const ownedCallable = id => source.behaviors.some(b => b.ownerInstanceId === owner && b.definitionId === id);
        if (directOwner && owner !== directOwner) invalid('Explicit matching source owner required');
        if (owner && !directOwner && !(callableId && (ownedCallable(callableId) || entry && ownedCallable(entry.enclosingCallableId)))) invalid('Source callable is foreign to owner');
        if (!owner && !directOwner && callableId && !source.functions.has(callableId)) invalid('Occurrence owner required for method/rule source');
        if (q.seed.sourceRevision !== undefined) {
            if (!isHash(q.seed.sourceRevision)) invalid('Source revision SHA256 required');
            const document = source.documentFor(entity);
            if (!document || document.revision !== q.seed.sourceRevision) throw failure('SOURCE_REVISION_MISMATCH', 'Foreign source revision');
        }
        if (q.kind === 'state-accesses' && !source.architecture?.storage[entity.id] && !source.instances.get(entity.id)?.primitiveKind) invalid('Storage occurrence seed required');
        if (q.kind === 'call-site' && !source.calls.has(entity.id) && !source.bindings.has(entity.id) && !source.expressions.get(entity.id)?.callSiteId) invalid('Call site or occurrence binding seed required');
        if (q.kind === 'behavior' && !source.behaviors.some(b => b.id === entity.id) && !source.endpoints.has(entity.id) && !source.functions.has(entity.id)) invalid('Behavior, method endpoint or helper seed required');
        if (q.kind === 'source-dependencies' && !source.expressions.has(entity.id) && !source.statements.has(entity.id) && !source.functions.has(entity.id)) invalid('Expression, statement or helper dependency seed required');
    } else if (q.seed.sourceRevision !== undefined || q.seed.entryCallSiteId !== undefined) invalid('Source selectors do not apply to implementation targets');
    return { entityId: q.seed.entityId, sourceRevision: q.seed.sourceRevision ?? null, entryCallSiteId: q.seed.entryCallSiteId ?? null,
        ownerInstanceId: owner, occurrenceId: q.implementationOccurrenceId, domain: implementation ? 'implementation' : 'source', positions: [] };
}
module.exports = { SOURCE_KINDS, normalizeSource };
