'use strict';
const { hash, stable, failure } = require('../json');
const { getNetEndpoints, getGeneratedEvidence } = require('../yosys-json');
const { inside } = require('./input');
const compare = (a,b) => a < b ? -1 : a > b ? 1 : 0;
const sorted = values => [...values].sort((a,b) => compare(a.id, b.id));
const seal = (kind, value) => ({ id: `analysis-${kind}-${hash(stable(value))}`, kind, ...value });
const bytes = value => Buffer.byteLength(JSON.stringify(value));
function boundaryIndex(model) {
    const adjacency = new Map();
    for (const b of Object.values(model.boundaries).sort((a,b) => compare(a.id,b.id))) {
        for (const [from,to] of [[b.actualBitId,b.formalBitId],[b.formalBitId,b.actualBitId]]) {
            if (!adjacency.has(from)) adjacency.set(from, []);
            adjacency.get(from).push({ to, binding: b });
        }
    }
    return adjacency;
}
function execute(model, q) {
    const started = performance.now();
    const adjacency = boundaryIndex(model);
    const preparationMs = performance.now() - started;
    const objects = new Map(), relations = new Map(), boundaries = new Map(), evidence = new Map(), frontier = new Map();
    const bits = new Set(), pins = new Set(), cells = new Set(), edges = new Set(), stops = new Set();
    let maxDepth = 0;
    const groups = q.seed.positions.map(seed => ({ seed, bitIds: [], incidences: [], boundaryIds: [], drivers: [], loads: [],
        boundaryContacts: [], unknownContacts: [], membership: 'complete', interpretation: 'complete' }));
    const result = { schemaVersion: 1, id: '', queryId: q.queryId, kind: q.kind, status: 'complete', availability: 'available',
        completeness: 'complete', freshness: q.context.freshness, context: q.context, seed: q.seed, scope: q.scope,
        direction: q.direction, semanticsProfile: q.semanticsProfile, groups, objects: [], relations: [], boundaries: [], frontier: [],
        sourceRefs: [], evidenceRefs: [], candidates: q.candidates, limits: { ...q.limits, stopReasons: [] }, request: q.request, metrics: {} };
    // Reserve space for the final identity, counters and one compact frontier per position.
    let usedBytes = bytes({ ...result, request: { ...result.request, queryGeneration: Number.MAX_SAFE_INTEGER } }) + 2048 + groups.reduce((n,g) => n + bytes(g.seed) + 1024, 0);
    if (usedBytes > q.limits.maxResultBytes) throw failure('LIMIT_EXCEEDED', 'Result budget cannot contain the ordered seed and frontier envelope');
    function ref(id) {
        const e = model.entities[id];
        return { kind: 'implementation', objectKind: e.kind, entityId: id, snapshotId: model.snapshot.id,
            occurrenceId: e.occurrenceId || null };
    }
    function stop(group, reason, bitId, extra = {}) {
        const f = seal('frontier', { reason, aspect: 'membership', seedPosition: group.seed.position,
            at: ref(bitId), nextAnalysis: q.kind, ...extra });
        frontier.set(f.id, f);
        if (reason === 'resource-limit') { group.membership = 'partial'; stops.add(extra.limit); }
    }
    if (q.context.freshness === 'stale') { result.status = 'stale'; result.completeness = 'unknown'; result.availability = 'unavailable'; }
    else if (!['same-net','drivers-loads'].includes(q.kind)) {
        result.status = 'unsupported'; result.availability = 'not-implemented'; result.completeness = 'unknown';
    } else if (q.candidates.length) { result.status = 'ambiguous'; result.completeness = 'unknown'; }
    else for (const group of groups) {
        const queue = [{ bitId: group.seed.bitId, depth: 0 }], seen = new Set();
        const groupBoundaryIds = new Set();
        let halted = false;
        for (let cursor = 0; cursor < queue.length; cursor++) {
            const { bitId, depth } = queue[cursor];
            if (seen.has(bitId)) continue;
            const bit = model.bits[bitId];
            const net = getNetEndpoints(model, bit.occurrenceId, bitId)[0];
            const bitObjects = [ { id: bitId, ...ref(bitId), value: bit.value } ];
            const bitRelations = [], bitBoundaries = [], bitEvidence = [], incidences = [];
            const drivers = [], loads = [], boundaryContacts = [], unknownContacts = [];
            const newPins = new Set(), newCells = new Set();
            let preflightLimit = depth > q.limits.maxHierarchyDepth ? 'maxHierarchyDepth'
                : !bits.has(bitId) && bits.size >= q.limits.maxBits ? 'maxBits'
                : net.endpoints.length + net.aliases.length > q.limits.maxEdges ? 'maxEdges' : null;
            if (!preflightLimit) for (const endpoint of net.endpoints) {
                const pin = model.pins[endpoint.entityId];
                if (!pin) continue;
                if (!pins.has(pin.id)) newPins.add(pin.id);
                if (!cells.has(pin.cellId)) newCells.add(pin.cellId);
                if (pins.size + newPins.size > q.limits.maxPins) { preflightLimit = 'maxPins'; break; }
                if (cells.size + newCells.size > q.limits.maxCells) { preflightLimit = 'maxCells'; break; }
            }
            if (preflightLimit) {
                stop(group, 'resource-limit', bitId, { limit: preflightLimit, continuation: 'remaining-seed-component' });
                halted = true; break;
            }
            function contact(entityId, index, direction, alias = false) {
                const entity = model.entities[entityId], cell = model.cells[entity.cellId], occurrence = model.occurrences[entity.occurrenceId];
                let role = 'alias';
                if (!alias) {
                    if (cell?.childOccurrenceId) role = 'hierarchy-pass-through';
                    else if (entity.kind === 'port' && occurrence.blackbox) role = 'opaque-contract';
                    else if (entity.kind === 'port' && occurrence.parentId && occurrence.id !== q.scope.rootOccurrenceId) role = 'hierarchy-pass-through';
                    else if (entity.kind === 'port') role = 'external-contact';
                    else role = 'leaf-terminal';
                }
                const endpoint = { ...ref(entityId), index, bitId, direction: direction ?? null, role };
                const incidence = seal('incidence', { family: 'same-net', from: ref(bitId), to: endpoint });
                incidences.push({ id: incidence.id, ...endpoint }); bitRelations.push(incidence);
                bitObjects.push({ id: entityId, ...ref(entityId), name: entity.name });
                if (entity.kind === 'pin') { newPins.add(entityId); newCells.add(entity.cellId);
                    bitObjects.push({ id: cell.id, ...ref(cell.id), name: cell.name, type: cell.type }); }
                if (alias) return;
                const candidate = { id: incidence.id, ...endpoint };
                if (role === 'hierarchy-pass-through') boundaryContacts.push(candidate);
                if (!['input','output'].includes(direction)) unknownContacts.push({ ...candidate, terminalRole: role,
                    role: direction === 'inout' ? 'bidirectional' : 'unknown-direction' });
                else if (role !== 'hierarchy-pass-through') {
                    const external = role === 'external-contact';
                    (direction === (external ? 'input' : 'output') ? drivers : loads).push(candidate);
                }
            }
            for (const e of [...net.endpoints].sort((a,b) => compare(a.entityId,b.entityId) || a.index-b.index)) contact(e.entityId,e.index,e.direction);
            for (const a of [...net.aliases].sort((a,b) => compare(a.aliasId,b.aliasId) || a.index-b.index)) contact(a.aliasId,a.index,null,true);
            if (bit.kind === 'constant') drivers.push({ id: bit.id, ...ref(bit.id), bitId, value: bit.value, role: 'constant', index: null });
            const continuations = [], next = [];
            for (const { to, binding } of adjacency.get(bitId) || []) {
                const inScope = inside(model, model.bits[to].occurrenceId, q.scope);
                bitBoundaries.push({ id: binding.id, kind: 'hierarchy-crossing', family: 'same-net', boundaryId: binding.id,
                    from: { ...ref(binding.actualBitId), pinId: binding.pinId, index: binding.index },
                    to: { ...ref(binding.formalBitId), portId: binding.portId, index: binding.index },
                    aspect: 'membership', reason: inScope ? 'binding' : 'scope', providerRefs: binding.providerRefs });
                if (inScope) { bitRelations.push({ id: binding.id, kind: 'hierarchy-crossing', family: 'same-net',
                    boundaryId: binding.id, from: ref(binding.actualBitId), to: ref(binding.formalBitId) }); next.push({ bitId: to, depth: depth + 1 }); }
                else continuations.push({ to, binding });
            }
            for (const object of new Map(bitObjects.map(o => [o.id,o])).values()) {
                if (!evidence.has(object.id)) bitEvidence.push({ id: object.id, kind: 'generated-evidence', ...getGeneratedEvidence(model, object.entityId) });
            }
            const uniqueEdges = bitRelations.filter(e => !edges.has(e.id));
            const projected = { maxBits: bits.size + (bits.has(bitId) ? 0 : 1),
                maxPins: pins.size + [...newPins].filter(id => !pins.has(id)).length,
                maxCells: cells.size + [...newCells].filter(id => !cells.has(id)).length,
                maxEdges: edges.size + uniqueEdges.length, maxHierarchyDepth: depth };
            let limit = Object.keys(projected).find(key => projected[key] > q.limits[key]);
            const additionalBytes = bytes(bitObjects.filter(o => !objects.has(o.id))) + bytes(uniqueEdges) + bytes(bitBoundaries.filter(b => !boundaries.has(b.id))) +
                bytes(bitEvidence) + bytes({ bitId, incidences, drivers, loads, boundaryContacts, unknownContacts,
                    boundaryIds: bitBoundaries.map(b => b.id) }) + continuations.reduce((n,c) => n + bytes(c.binding) * 2 + 2048, 0) +
                unknownContacts.reduce((n,c) => n + bytes(c) * 2 + 1024, 0) + 256;
            if (!limit && usedBytes + additionalBytes > q.limits.maxResultBytes) limit = 'maxResultBytes';
            if (limit) {
                // Retained crossings plus this seed-scoped continuation cover the unresolved component, without an unbounded queue dump.
                stop(group, 'resource-limit', bitId, { limit, continuation: 'remaining-seed-component' });
                halted = true; break;
            }
            usedBytes += additionalBytes;
            seen.add(bitId); bits.add(bitId); maxDepth = Math.max(maxDepth, depth);
            for (const id of newPins) pins.add(id);
            for (const id of newCells) cells.add(id);
            for (const edge of bitRelations) { edges.add(edge.id); relations.set(edge.id, edge); }
            for (const object of bitObjects) objects.set(object.id, object);
            for (const e of bitEvidence) evidence.set(e.id, e);
            for (const b of bitBoundaries) { boundaries.set(b.id,b); groupBoundaryIds.add(b.id); }
            group.bitIds.push(bitId); group.incidences.push(...incidences); group.drivers.push(...drivers); group.loads.push(...loads);
            group.boundaryContacts.push(...boundaryContacts); group.unknownContacts.push(...unknownContacts);
            if (unknownContacts.length) group.interpretation = 'partial';
            for (const contact of unknownContacts) {
                const f = seal('frontier', { reason: 'unknown-direction', aspect: 'interpretation',
                    seedPosition: group.seed.position, at: contact, nextAnalysis: null });
                frontier.set(f.id, f);
            }
            for (const c of continuations) stop(group, 'scope', bitId, { boundaryId: c.binding.id, side: bitId === c.binding.actualBitId ? 'actual' : 'formal', next: ref(c.to) });
            queue.push(...next.filter(n => !seen.has(n.bitId)));
        }
        group.bitIds.sort(); group.boundaryIds = [...groupBoundaryIds].sort();
        for (const key of ['incidences','drivers','loads','boundaryContacts','unknownContacts']) group[key].sort((a,b) => compare(a.id,b.id));
        if (halted) group.interpretation = 'partial';
    }
    result.objects = sorted(objects.values()); result.relations = sorted(relations.values()); result.boundaries = sorted(boundaries.values());
    result.frontier = sorted(frontier.values()); result.evidenceRefs = sorted(evidence.values());
    result.limits.stopReasons = [...stops].sort();
    if (result.status === 'complete' && groups.some(g => g.membership === 'partial' || q.kind === 'drivers-loads' && g.interpretation === 'partial')) {
        result.status = 'partial'; result.completeness = 'partial';
    }
    if (result.status === 'complete' && !groups.length) result.status = 'empty';
    const { id, request, metrics, ...semantic } = result;
    result.id = `analysis-result-${hash(stable(semantic))}`;
    result.metrics = { preparationMs, executionMs: performance.now() - started - preparationMs, cancellationMs: 0,
        visitedBits: bits.size, visitedPins: pins.size, visitedCells: cells.size, visitedEdges: edges.size,
        maxHierarchyDepth: maxDepth, resultBytes: 0 };
    for (let i=0; i<3; i++) result.metrics.resultBytes = bytes(result);
    if (bytes(result) > q.limits.maxResultBytes) throw failure('LIMIT_EXCEEDED', 'Result envelope exceeds byte budget');
    return result;
}
module.exports = { execute, boundaryIndex };
