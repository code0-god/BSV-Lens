'use strict';
const { checkedJson } = require('../correspondence/schema');
const { failure, hash, stable } = require('../json');
const { SOURCE_KINDS, normalizeSource } = require('./source-input');
const DEFAULT_LIMITS = Object.freeze({ maxBits: 4096, maxPins: 8192, maxCells: 512, maxEdges: 16384,
    maxHierarchyDepth: 64, maxResultBytes: 4194304, timeoutMs: 30000 });
const KINDS = ['same-net', 'drivers-loads', 'dependencies', 'state-accesses', 'behavior', 'call-site', 'source-dependencies', 'correspondence'];
const invalid = message => { throw failure('INVALID_INPUT', message); };
function fields(value, allowed, label) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(k => !allowed.includes(k))) invalid(`Invalid ${label} fields`);
}
function inside(model, id, scope) {
    if (scope.kind === 'occurrence') return id === scope.rootOccurrenceId;
    let occurrence = model.occurrences[id];
    while (occurrence) {
        if (occurrence.id === scope.rootOccurrenceId) return true;
        occurrence = model.occurrences[occurrence.parentId];
    }
    return false;
}
function normalize(input, attachment) {
    const q = checkedJson(input, { maxBytes: 1048576, maxJsonNodes: 20000, maxJsonDepth: 12 });
    fields(q, ['kind','analysisId','snapshotId','implementationProvider','stage','ownerInstanceId','implementationOccurrenceId',
        'seed','scope','direction','semanticsProfile','limits','queryGeneration','mode'], 'query');
    if (!KINDS.includes(q.kind)) invalid('Unknown analysis kind');
    if (!Number.isSafeInteger(q.queryGeneration) || q.queryGeneration < 0) invalid('Invalid query generation');
    const { context, model, owners } = attachment;
    if (q.analysisId !== context.analysisId) throw failure('ANALYSIS_MISMATCH', 'Foreign analysis');
    if (q.snapshotId !== context.snapshotId) throw failure('SNAPSHOT_MISMATCH', 'Foreign snapshot');
    if (q.implementationProvider !== context.implementationProvider) invalid('Foreign provider');
    if (q.stage !== undefined && q.stage !== null && q.stage !== context.stage) invalid('Contradictory stage');
    if (q.direction !== undefined && !['backward','forward'].includes(q.direction)) invalid('Unknown direction');
    if (q.semanticsProfile !== undefined && q.semanticsProfile !== 'yosys-0.68-structural-v1') invalid('Unknown semantics profile');
    if (q.kind === 'dependencies' && (q.direction === undefined || q.semanticsProfile === undefined)) invalid('Dependencies require explicit direction and semantics profile');
    const limits = { ...DEFAULT_LIMITS };
    if (q.limits !== undefined) {
        fields(q.limits, Object.keys(limits), 'limits');
        for (const [key, value] of Object.entries(q.limits)) {
            if (!Number.isSafeInteger(value) || value < 1 || value > limits[key]) invalid(`Invalid budget: ${key}`);
            limits[key] = value;
        }
    }
    if (SOURCE_KINDS.includes(q.kind)) {
        const seed = normalizeSource(q, attachment);
        const normalized = { kind: q.kind, context, ownerInstanceId: q.ownerInstanceId ?? null,
            implementationOccurrenceId: q.implementationOccurrenceId, seed, scope: q.scope,
            direction: q.direction ?? null, semanticsProfile: q.semanticsProfile ?? null, mode: q.mode || 'build', limits, candidates: [] };
        return { ...normalized, queryId: `analysis-query-${hash(stable(identityValue(normalized)))}`,
            request: { queryGeneration: q.queryGeneration, snapshotId: q.snapshotId } };
    }
    if (q.mode !== undefined) invalid('Source mode does not apply to electrical queries');
    if (q.ownerInstanceId != null && (typeof q.ownerInstanceId !== 'string' || !owners[q.ownerInstanceId])) invalid('Unknown BSV owner');
    if (!model) throw failure('UNAVAILABLE', 'Hardware is not attached');
    if (typeof q.implementationOccurrenceId !== 'string' || !model.occurrences[q.implementationOccurrenceId]) invalid('Unknown implementation occurrence');
    if (q.ownerInstanceId != null && !inside(model, q.implementationOccurrenceId,
        { kind: 'subtree', rootOccurrenceId: owners[q.ownerInstanceId] })) invalid('Foreign BSV owner context');
    fields(q.scope, ['kind','rootOccurrenceId'], 'scope');
    if (!['occurrence','subtree','design'].includes(q.scope.kind) || typeof q.scope.rootOccurrenceId !== 'string' || !model.occurrences[q.scope.rootOccurrenceId]) invalid('Unknown scope');
    if (q.scope.kind === 'design' && !model.roots.includes(q.scope.rootOccurrenceId)) invalid('Design scope requires an actual root');
    if (!inside(model, q.implementationOccurrenceId, q.scope)) invalid('Seed occurrence outside scope');
    fields(q.seed, ['entityId','indices','slice','occurrenceId','bitIds'], 'seed');
    const s = q.seed;
    let entityId = null, indices, bits, candidates = [];
    if (s.entityId !== undefined) {
        if (typeof s.entityId !== 'string') invalid('Canonical entity ID must be a string');
        if (s.occurrenceId !== undefined || s.bitIds !== undefined || s.indices !== undefined && s.slice !== undefined) invalid('Conflicting seed selectors');
        const entity = model.entities[s.entityId];
        if (!entity || entity.occurrenceId !== q.implementationOccurrenceId) invalid('Unknown or foreign seed');
        entityId = entity.id;
        if (entity.kind === 'cell') {
            if (s.indices !== undefined || s.slice !== undefined) invalid('Cell seed requires a pin, not indices');
            candidates = [...entity.pins].sort().map(id => ({ kind: 'implementation', objectKind: 'pin', entityId: id,
                occurrenceId: entity.occurrenceId, snapshotId: context.snapshotId }));
            bits = []; indices = [];
        } else {
            bits = entity.kind === 'signal-bit' || entity.kind === 'constant' ? [entity.id] : entity.bits;
            if (!bits || !['port','pin','alias','signal-bit','constant'].includes(entity.kind)) invalid('Electrical seed required');
            if (s.slice !== undefined) {
                fields(s.slice, ['start','end'], 'slice');
                const { start, end } = s.slice;
                if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end <= start || end > bits.length) invalid('Invalid slice');
                indices = Array.from({ length: end - start }, (_, i) => start + i);
            } else indices = s.indices === undefined ? bits.map((_,i) => i) : s.indices;
        }
    } else {
        if (s.indices !== undefined || s.slice !== undefined || s.occurrenceId !== q.implementationOccurrenceId || !Array.isArray(s.bitIds)) invalid('Invalid explicit bit vector');
        bits = s.bitIds; indices = bits.map((_,i) => i);
    }
    if (!Array.isArray(indices) || !candidates.length && !indices.length || indices.length > DEFAULT_LIMITS.maxBits) invalid('Empty or oversized seed');
    const positions = indices.map((index, position) => {
        if (!Number.isSafeInteger(index) || index < 0 || index >= bits.length) invalid('Invalid seed index');
        const bitId = bits[index];
        if (typeof bitId !== 'string' || !model.bits[bitId] || model.bits[bitId].occurrenceId !== q.implementationOccurrenceId) invalid('Foreign bit');
        return { position, index, bitId, entityId };
    });
    const normalized = { kind: q.kind, context, ownerInstanceId: q.ownerInstanceId ?? null,
        implementationOccurrenceId: q.implementationOccurrenceId, seed: { entityId, occurrenceId: q.implementationOccurrenceId,
            positions }, scope: q.scope, direction: q.direction ?? null, semanticsProfile: q.semanticsProfile ?? null, limits, candidates };
    return { ...normalized, queryId: `analysis-query-${hash(stable(identityValue(normalized)))}`,
        request: { queryGeneration: q.queryGeneration, snapshotId: q.snapshotId } };
}
// Capability advertisements are nonsemantic for every kind; never fabricate historical values.
function identityValue(value) {
    const { capabilities, ...context } = value.context;
    return { ...value, context };
}
module.exports = { normalize, inside, DEFAULT_LIMITS, KINDS, fields, identityValue };
