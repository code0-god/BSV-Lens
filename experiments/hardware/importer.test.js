'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const crypto = require('node:crypto');

function fixture() {
    return { modules: {
        top: { ports: { a: { direction: 'input', bits: [2, 3] } }, cells: {
            left: { type: 'child', parameters: { N: '10' }, attributes: {}, connections: { p: [3, 2, '0', 'x'] } },
            right: { type: 'child', parameters: { N: '11' }, attributes: {}, connections: { p: [2, 3, '1', 'z'] } }
        }, netnames: { bus: { bits: [3, 2], attributes: {} }, alias: { bits: [2, 3], attributes: {} } } },
        child: { ports: { p: { direction: 'input', bits: [2, 3, 4, 5] } }, cells: {
            opaque: { type: 'vendor', parameters: {}, attributes: { src: 'generated.v:1.1-1.9' }, connections: { Q: [2, 3, 4, 5] } }
        }, netnames: {} }
    } };
}

function snapshot(raw, extra = {}) {
    return { artifact: { hash: crypto.createHash('sha256').update(JSON.stringify(raw)).digest('hex'), pathRef: 'unit.json' },
        stage: 'hierarchical-rtl-proc', toolchain: [{ name: 'yosys', version: 'unit', identity: 'unit' }],
        passSequence: ['proc'], buildOptionsFingerprint: 'unit-options', tops: ['top'], ...extra };
}

test('independent seam: repeated definitions retain occurrence-local bits and ordered boundary bindings', () => {
    const api = require('./importer');
    const raw = fixture();
    const model = api.importYosys(raw, snapshot(raw));
    const children = api.getChildren(model, model.roots[0]);
    assert.equal(children.length, 2);
    assert.equal(children[0].definitionId, children[1].definitionId);
    assert.notEqual(api.getPorts(model, children[0].id)[0].bits[0], api.getPorts(model, children[1].id)[0].bits[0]);
    for (const child of children) {
        const expected = raw.modules.top.cells[child.name].connections.p;
        assert.deepEqual(expected.map((_, i) => {
            const binding = api.crossHierarchyBoundary(model, child.id, 'p', i, 'out');
            return model.bits[binding.toBitId].value;
        }), expected);
    }
});

const api = require('./importer');
const plain = value => JSON.parse(JSON.stringify(value));
const sortRows = rows => rows.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b), 'en'));
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const has = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

// Independent breadth-first walk: only the original JSON is used to build expected records.
// This deliberately does not share IDs, indexes, recursion, or helpers with the importer.
function reference(raw, tops) {
    const rows = { definitions: [], occurrences: [], cells: [], ports: [], pins: [], aliases: [], memories: [], boundaries: [] };
    for (const [name, module] of Object.entries(raw.modules)) rows.definitions.push([name, module]);
    const queue = tops.map(name => ({ module: name, path: [name], parent: null }));
    for (let cursor = 0; cursor < queue.length; cursor++) {
        const item = queue[cursor];
        const module = raw.modules[item.module];
        rows.occurrences.push([item.path, item.module, item.parent]);
        for (const [name, port] of Object.entries(module.ports || {})) rows.ports.push([item.path, name, port.direction ?? null, port.bits, port]);
        for (const [name, alias] of Object.entries(module.netnames || {})) rows.aliases.push([item.path, name, alias.bits, alias]);
        for (const [name, memory] of Object.entries(module.memories || {})) rows.memories.push([item.path, name, memory]);
        for (const [name, cell] of Object.entries(module.cells || {})) {
            rows.cells.push([item.path, name, cell.type, cell]);
            for (const [pin, bits] of Object.entries(cell.connections || {})) {
                rows.pins.push([item.path, name, pin, has(cell.port_directions || {}, pin) ? cell.port_directions[pin] : null, bits]);
            }
            if (has(raw.modules, cell.type)) {
                const childPath = item.path.concat(name);
                queue.push({ module: cell.type, path: childPath, parent: item.path });
                for (const [pin, actuals] of Object.entries(cell.connections || {})) {
                    const formals = raw.modules[cell.type].ports[pin].bits;
                    for (let i = 0; i < actuals.length; i++) rows.boundaries.push([item.path, childPath, name, pin, i, actuals[i], formals[i]]);
                }
            }
        }
    }
    return rows;
}

function actualRows(model) {
    const path = id => model.occurrences[id].path;
    const bits = owner => owner.bits.map(id => model.bits[id].value);
    return {
        definitions: Object.values(model.definitions).map(d => [d.name, d.raw]),
        occurrences: Object.values(model.occurrences).map(o => [o.path, model.definitions[o.definitionId].name, o.parentId ? path(o.parentId) : null]),
        cells: Object.values(model.cells).map(c => [path(c.occurrenceId), c.name, c.type, c.raw]),
        ports: Object.values(model.ports).map(p => [path(p.occurrenceId), p.name, p.direction, bits(p), p.raw]),
        pins: Object.values(model.pins).map(p => [path(p.occurrenceId), model.cells[p.cellId].name, p.name, p.direction, bits(p)]),
        aliases: Object.values(model.aliases).map(a => [path(a.occurrenceId), a.name, bits(a), a.raw]),
        memories: Object.values(model.memories).map(m => [path(m.occurrenceId), m.name, m.raw]),
        boundaries: Object.values(model.boundaries).map(b => [path(b.parentOccurrenceId), path(b.childOccurrenceId),
            model.cells[model.pins[b.pinId].cellId].name, b.portName, b.index, model.bits[b.actualBitId].value, model.bits[b.formalBitId].value])
    };
}

function resolvePointer(raw, pointer) {
    assert.ok(pointer.startsWith('/'));
    let value = raw;
    for (const component of pointer.substring(1).split('/')) {
        const key = component.replace(/~1/g, '/').replace(/~0/g, '~');
        assert.ok(value !== null && typeof value === 'object' && has(value, key), `Dangling provider pointer ${pointer}`);
        value = value[key];
    }
    return value;
}

function verifyFidelity(raw, model) {
    const expected = reference(raw, model.snapshot.tops);
    const actual = actualRows(model);
    const coverage = {};
    for (const name of Object.keys(expected)) {
        assert.deepEqual(sortRows(plain(actual[name])), sortRows(plain(expected[name])), name);
        coverage[name] = { verified: actual[name].length, total: expected[name].length };
    }
    assert.deepEqual(plain(model.raw), raw, 'entire provider payload retained');
    const numericKeys = new Set();
    let endpointBits = 0;
    let aliasBits = 0;
    let constantSlots = 0;
    // Separate exhaustive direct scans of each module, not the reference record projection.
    for (const occurrence of Object.values(model.occurrences)) {
        const module = raw.modules[model.definitions[occurrence.definitionId].name];
        const slots = [];
        for (const [name, port] of Object.entries(module.ports || {})) port.bits.forEach((bit, i) => slots.push([bit, 'port', null, name, i, port.direction ?? null]));
        for (const [cell, object] of Object.entries(module.cells || {})) {
            for (const [pin, bits] of Object.entries(object.connections || {})) bits.forEach((bit, i) => slots.push([bit, 'pin', cell, pin, i, object.port_directions?.[pin] ?? null]));
        }
        for (const [name, alias] of Object.entries(module.netnames || {})) alias.bits.forEach((bit, i) => slots.push([bit, 'alias', null, name, i, null]));
        endpointBits += slots.filter(s => s[1] !== 'alias').length;
        aliasBits += slots.filter(s => s[1] === 'alias').length;
        constantSlots += slots.filter(s => typeof s[0] === 'string').length;
        for (const value of new Set(slots.map(s => s[0]).filter(v => typeof v === 'number'))) {
            const result = api.getNetEndpoints(model, occurrence.id, value)[0];
            assert.ok(!numericKeys.has(result.bitId), 'numeric bits cannot cross occurrence namespaces');
            numericKeys.add(result.bitId);
            const endpoints = result.endpoints.map(e => {
                const owner = model.entities[e.entityId];
                const role = e.direction === 'inout' ? 'bidirectional' : e.direction === 'input' ? (e.kind === 'port' ? 'driver' : 'load') : e.direction === 'output' ? (e.kind === 'port' ? 'load' : 'driver') : 'unknown';
                assert.equal(e.role, role);
                return [value, e.kind, e.kind === 'pin' ? model.cells[owner.cellId].name : null, owner.name, e.index, e.direction];
            });
            const aliases = result.aliases.map(a => [value, 'alias', null, model.aliases[a.aliasId].name, a.index, null]);
            assert.deepEqual(sortRows([...endpoints, ...aliases]), sortRows(slots.filter(s => s[0] === value)), 'same-net membership');
        }
        const queried = api.getNetEndpoints(model, occurrence.id, occurrence.bits);
        assert.deepEqual(queried.map(b => b.bitId), occurrence.bits, 'vector queries preserve request order');
        assert.deepEqual(api.getPorts(model, occurrence.id).map(p => p.name).sort(), Object.keys(module.ports || {}).sort());
        assert.deepEqual(api.getChildren(model, occurrence.id).map(c => c.name).sort(), Object.entries(module.cells || {}).filter(([, c]) => has(raw.modules, c.type)).map(([n]) => n).sort());
    }
    const allBits = Object.values(model.bits);
    assert.equal(allBits.filter(b => b.kind === 'signal-bit').length, numericKeys.size);
    const constants = allBits.filter(b => b.kind === 'constant');
    assert.equal(constants.length, constantSlots);
    for (const bit of constants) assert.equal(bit.endpoints.length + bit.aliases.length, 1, 'constants are value slots, never global physical sources');
    assert.equal(allBits.reduce((n, b) => n + b.endpoints.length, 0), endpointBits);
    assert.equal(allBits.reduce((n, b) => n + b.aliases.length, 0), aliasBits);
    for (const binding of Object.values(model.boundaries)) {
        const out = api.crossHierarchyBoundary(model, binding.childOccurrenceId, binding.portName, binding.index, 'out');
        const into = api.crossHierarchyBoundary(model, binding.childOccurrenceId, binding.portName, binding.index, 'into');
        assert.equal(out.toBitId, binding.actualBitId);
        assert.equal(into.toBitId, binding.formalBitId);
        assert.equal(model.pins[binding.pinId].bits[binding.index], binding.actualBitId);
        assert.equal(model.ports[binding.portId].bits[binding.index], binding.formalBitId);
    }
    let providerReferences = 0;
    let generatedRtlEntities = 0;
    let directGeneratedRtlEntities = 0;
    const expectedEntityCount = Object.values(expected).reduce((sum, rows) => sum + rows.length, 0) + numericKeys.size + constantSlots;
    assert.equal(Object.keys(model.entities).length, expectedEntityCount);
    for (const entity of Object.values(model.entities)) {
        assert.ok(entity.providerRefs.length);
        for (const ref of entity.providerRefs) {
            assert.equal(ref.artifactHash, model.snapshot.artifact.hash);
            assert.equal(ref.pathRef, model.snapshot.artifact.pathRef);
            const original = resolvePointer(raw, ref.pointer);
            if (entity.kind === 'signal-bit' || entity.kind === 'constant') assert.equal(original, entity.value);
            providerReferences++;
        }
        const evidence = api.getGeneratedEvidence(model, entity.id);
        assert.deepEqual(evidence.originalBsv, { status: 'unmapped', refs: [] });
        if (evidence.generatedRtl.length) generatedRtlEntities++;
        if (evidence.generatedRtl.some(e => e.scope === 'entity-attribute')) directGeneratedRtlEntities++;
        for (const generated of evidence.generatedRtl) {
            assert.equal(generated.kind, 'generated-rtl');
            const direct = entity.providerRefs.some(ref => ref.pointer === generated.ownerPointer);
            assert.equal(generated.scope, direct ? 'entity-attribute' : 'ancestor-context');
            assert.equal(resolvePointer(raw, generated.providerRefs[0].pointer), generated.raw);
        }
    }
    return { ...coverage, signalBits: { verified: numericKeys.size, total: numericKeys.size },
        connectionBitSlots: { verified: endpointBits, total: endpointBits }, aliasBitSlots: { verified: aliasBits, total: aliasBits },
        constantSlots: { verified: constants.length, total: constantSlots },
        entitiesWithProviderPointers: { verified: Object.keys(model.entities).length, total: expectedEntityCount },
        providerReferences, generatedRtlEvidenceEntities: { available: generatedRtlEntities, total: expectedEntityCount },
        directGeneratedRtlAttributeEntities: { available: directGeneratedRtlEntities, total: expectedEntityCount },
        ancestorOnlyGeneratedRtlContextEntities: { available: generatedRtlEntities - directGeneratedRtlEntities, total: expectedEntityCount },
        originalBsvMappingEntities: { verified: 0, total: expectedEntityCount } };
}

function richFixture() {
    const raw = fixture();
    raw.modules.top.attributes = { src: '../../outside/generated.v:3.2-9.4', custom: ['kept', 12] };
    raw.modules.top.ports.a = { bits: [2, 3], direction: 'inout', offset: -2, upto: 1, signed: 1 };
    raw.modules.top.ports.unknown = { bits: [2, 'x', 'z', '0', '1'] };
    raw.modules.top.netnames.repeated = { bits: [3, 2, 3, '0', '0', 'x', 'x'], offset: 4, upto: 1, signed: 1, attributes: { custom: 'kept' } };
    raw.modules.top.memories = { bank: { hide_name: 0, attributes: { src: 'memory.v:2.1-4.8' }, width: 8, start_offset: 7, size: 16 } };
    raw.modules.top.cells.driver0 = { type: 'unknown-ip', connections: { Y: [2], A: [3] }, port_directions: { Y: 'output', A: 'input' } };
    raw.modules.top.cells.driver1 = { type: 'unknown-ip', connections: { Y: [2] }, port_directions: { Y: 'output' } };
    raw.modules.top.cells.box = { type: 'bb', connections: { io: [3], open: [] } };
    raw.modules.bb = { attributes: { blackbox: '0001' }, ports: { io: { bits: [2], direction: 'inout' }, open: { bits: [3], direction: 'output' }, missing: { bits: [4] } } };
    return raw;
}

test('independent complete vectors, same-net memberships, unknown cells, memories, black boxes and unconnected formals', () => {
    const raw = richFixture();
    const model = api.importYosys(raw, snapshot(raw));
    verifyFidelity(raw, model);
    const root = model.roots[0];
    const box = api.getChildren(model, root).find(c => c.name === 'box');
    assert.equal(box.blackbox, true);
    assert.equal(api.crossHierarchyBoundary(model, box.id, 'open', 0), null);
    assert.equal(api.crossHierarchyBoundary(model, box.id, 'missing', 0), null);
    assert.equal(api.getNetEndpoints(model, root, 2)[0].endpoints.filter(e => e.role === 'driver').length, 2);
    assert.ok(Object.values(model.pins).filter(p => p.name === 'Q').every(p => p.direction === null));
    assert.equal(Object.keys(model.memories).length, 1);
    assert.ok(Object.values(model.cells).every(c => !['RDY', 'EN', 'CAN_FIRE', 'WILL_FIRE'].includes(c.name)));
    const rawBefore = plain(model.raw);
    raw.modules.top.ports.a.bits[0] = 999;
    assert.deepEqual(plain(model.raw), rawBefore, 'import cannot be changed by mutating caller data');
});

function reverseKeys(value) {
    if (Array.isArray(value)) return value.map(reverseKeys);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).reverse().map(([k, v]) => [k, reverseKeys(v)]));
    return value;
}

test('object key reordering changes neither canonical semantics nor IDs for the same snapshot', () => {
    const raw = richFixture();
    const snap = snapshot(raw);
    const a = api.importYosys(raw, snap);
    const b = api.importYosys(reverseKeys(raw), reverseKeys(snap));
    assert.equal(a.snapshot.id, b.snapshot.id);
    assert.deepEqual(Object.keys(a.entities), Object.keys(b.entities));
    verifyFidelity(reverseKeys(raw), b);
    assert.deepEqual(plain(actualRows(a)), plain(actualRows(b)));
});

test('deterministic generated concatenations, reordering, replication and constants use the independent reference', () => {
    let state = 0x97a21;
    const next = () => (state = (Math.imul(state, 1664525) + 1013904223) >>> 0);
    const choices = [2, 3, 4, 5, '0', '1', 'x', 'z'];
    for (let seed = 0; seed < 40; seed++) {
        const raw = richFixture();
        for (const name of ['left', 'right']) raw.modules.top.cells[name].connections.p = Array.from({ length: 4 }, () => choices[next() % choices.length]);
        raw.modules.top.netnames.generated = { bits: Array.from({ length: 17 }, () => choices[(next() >>> 8) % choices.length]) };
        verifyFidelity(raw, api.importYosys(raw, snapshot(raw)));
    }
});

test('prototype keys, escaped names and reserved path segments never collide or pollute prototypes', () => {
    const raw = JSON.parse('{"modules":{"__proto__":{"ports":{"constructor":{"bits":[2]},"a/b~c":{"bits":[3]}},"cells":{"bit":{"type":"mid","connections":{}}},"netnames":{"__proto__":{"bits":[2,3]}}},"mid":{"cells":{"2":{"type":"leaf","connections":{}}}},"leaf":{"ports":{"p":{"bits":[2]}}}}}');
    const model = api.importYosys(raw, snapshot(raw, { tops: ['__proto__'] }));
    verifyFidelity(raw, model);
    assert.equal(Object.getPrototypeOf(model.definitions), null);
    assert.equal(Object.getPrototypeOf(model.raw.modules), null);
    assert.equal({}.polluted, undefined);
    assert.equal(Object.keys(model.occurrences).length, 3);
});

test('snapshot identity includes artifact, content, stage, toolchain, passes and build options, never caller ID alone', () => {
    const raw = fixture();
    const snap = snapshot(raw, { id: 'caller-id', gitCommit: 'same' });
    const base = api.importYosys(raw, snap);
    const variants = [ { artifact: { ...snap.artifact, hash: 'a'.repeat(64) } }, { stage: 'optimized' },
        { toolchain: [{ name: 'yosys', version: 'other', identity: 'other' }] }, { passSequence: ['proc', 'opt'] },
        { buildOptionsFingerprint: 'other' }, { concreteParameters: { N: '3' } } ];
    for (const variant of variants) {
        const other = api.importYosys(raw, { ...snap, ...variant });
        assert.notEqual(base.snapshot.id, other.snapshot.id);
        assert.ok(Object.keys(other.entities).every(id => !has(base.entities, id)));
    }
    assert.equal(base.snapshot.id, api.importYosys(raw, { ...snap, id: 'different-caller-id' }).snapshot.id);
    const changed = fixture(); changed.modules.top.ports.a.bits.reverse();
    assert.notEqual(base.snapshot.id, api.importYosys(changed, snap).snapshot.id);
    assert.throws(() => api.importYosys(JSON.stringify(raw), { ...snap, artifact: { ...snap.artifact, hash: '0'.repeat(64) } }), /hash mismatch/);
});

test('malformed bit references, hierarchy refs and unsupported processes fail explicitly', () => {
    for (const bit of [-1, 1.2, Number.MAX_SAFE_INTEGER + 1, null, {}, [], '2', 'X', true]) {
        const raw = fixture(); raw.modules.top.ports.a.bits = [bit];
        assert.throws(() => api.importYosys(raw, snapshot(raw)), /Malformed bit reference/);
    }
    const failures = [
        [r => { r.modules.top.cells.left.connections.bad = [2]; }, /Missing formal port/],
        [r => { r.modules.top.cells.left.connections.p = [2]; }, /Boundary width mismatch/],
        [r => { r.modules.top.processes = { process: { root_case: {} } }; }, /Unsupported processes/],
        [r => { r.modules.unselected = { processes: { p: {} } }; }, /Unsupported processes/],
        [r => { r.modules.child.cells.recurse = { type: 'top', connections: {} }; }, /Recursive hierarchy/],
        [r => { r.modules.top.cells.left.type = null; }, /Invalid cell type/],
        [r => { r.modules.top.cells.left.connections = []; }, /Invalid object/],
        [r => { r.modules.top.ports.a.bits = {}; }, /Invalid bit vector/]
    ];
    for (const [mutate, error] of failures) { const raw = fixture(); mutate(raw); assert.throws(() => api.importYosys(raw, snapshot(raw)), error); }
    const raw = fixture();
    assert.throws(() => api.importYosys(raw, snapshot(raw, { tops: ['absent'] })), /Missing module definition/);
    assert.throws(() => api.importYosys(raw, snapshot(raw, { tops: ['top', 'top'] })), /unique/);
});

test('every advertised depth/size limit is enforced; malformed JSON objects and invalid query IDs fail', () => {
    const raw = fixture();
    for (const [key, value] of Object.entries({ maxBytes: 100, maxJsonDepth: 2, maxJsonNodes: 3, maxHierarchyDepth: 1,
        maxOccurrences: 1, maxEntities: 3, maxVectorWidth: 1 })) {
        assert.throws(() => api.importYosys(raw, snapshot(raw, { limits: { [key]: value } })), /limit|width/);
    }
    for (const limits of [{ maxEntities: 0 }, { maxBytes: Infinity }, { maxEntities: api.DEFAULT_LIMITS.maxEntities + 1 }, { typo: 10 }]) {
        assert.throws(() => api.importYosys(raw, snapshot(raw, { limits })), /Invalid limit|Non-JSON value/);
    }
    assert.throws(() => api.importYosys('{', snapshot(raw)), SyntaxError);
    const cyclic = fixture(); cyclic.loop = cyclic;
    assert.throws(() => api.importYosys(cyclic, snapshot(raw)), /Cyclic JSON/);
    const accessor = fixture(); Object.defineProperty(accessor, 'evil', { enumerable: true, get() { throw new Error('getter executed'); } });
    assert.throws(() => api.importYosys(accessor, snapshot(raw)), /accessor unsupported/);
    const model = api.importYosys(raw, snapshot(raw));
    const sparse = fixture(); sparse.extra = new Array(3);
    assert.throws(() => api.importYosys(sparse, snapshot(raw)), /sparse or decorated array/);
    const decorated = fixture(); decorated.extra = []; decorated.extra.named = 7;
    assert.throws(() => api.importYosys(decorated, snapshot(raw)), /sparse or decorated array/);
    const maliciousSnapshot = snapshot(raw);
    Object.defineProperty(maliciousSnapshot, 'limits', { enumerable: true, get() { throw new Error('getter executed'); } });
    assert.throws(() => api.importYosys(raw, maliciousSnapshot), /accessor unsupported/);
    const children = api.getChildren(model, model.roots[0]);
    assert.throws(() => api.getNetEndpoints(model, children[0].id, api.getPorts(model, children[1].id)[0].bits[0]), /foreign bit/);
    assert.throws(() => api.getNetEndpoints(model, model.roots[0], '0'), /Unknown or foreign bit/);
    assert.throws(() => api.getPorts(model, '__proto__'), /Unknown occurrence/);
    assert.throws(() => api.getGeneratedEvidence(model, 'absent'), /Unknown hardware entity/);
    assert.throws(() => api.crossHierarchyBoundary(model, children[0].id, 'p', -1), /Invalid boundary query/);
});


test('independent roots stay disconnected; unselected definitions remain lossless without invented occurrences', () => {
    const raw = { modules: { rootA: { ports: { p: { bits: [2, 3], direction: 'output' } } },
        rootB: { ports: { p: { bits: [2, 3], direction: 'input' } } },
        unselected: { ports: { hidden: { bits: [7] } }, cells: { unknown: { type: 'vendor', connections: { A: [7] } } } } } };
    const model = api.importYosys(raw, snapshot(raw, { tops: ['rootA', 'rootB'] }));
    verifyFidelity(raw, model);
    assert.equal(Object.keys(model.definitions).length, 3);
    assert.equal(Object.keys(model.occurrences).length, 2);
    assert.equal(Object.keys(model.cells).length, 0);
    assert.equal(Object.keys(model.boundaries).length, 0);
    const ports = model.roots.map(id => api.getPorts(model, id)[0]);
    assert.notEqual(ports[0].bits[0], ports[1].bits[0]);
    for (const root of model.roots) {
        assert.equal(api.getNetEndpoints(model, root, 2)[0].endpoints.length, 1);
        assert.deepEqual(api.getGeneratedEvidence(model, root).generatedRtl, []);
    }
});

test('reference detects same-count pin, alias and boundary corruption, not merely missing entities', () => {
    const raw = fixture();
    const original = api.importYosys(raw, snapshot(raw));
    const pinModel = plain(original);
    Object.values(pinModel.pins).find(p => p.name === 'p').bits.reverse();
    assert.throws(() => verifyFidelity(raw, pinModel), { code: 'ERR_ASSERTION' });
    const aliasModel = plain(original);
    Object.values(aliasModel.aliases)[0].bits.reverse();
    assert.throws(() => verifyFidelity(raw, aliasModel), { code: 'ERR_ASSERTION' });
    const boundaryModel = plain(original);
    const binding = Object.values(boundaryModel.boundaries)[0];
    binding.actualBitId = boundaryModel.pins[binding.pinId].bits[1];
    assert.throws(() => verifyFidelity(raw, boundaryModel), { code: 'ERR_ASSERTION' });
});
test('browser UMD queries operate on a serialized host model without Node APIs or file reads', () => {
    const vm = require('node:vm');
    const context = vm.createContext({});
    vm.runInContext(fs.readFileSync(require.resolve('./importer'), 'utf8'), context);
    const browser = context.HardwareImporter;
    const raw = richFixture();
    const model = plain(api.importYosys(raw, snapshot(raw)));
    const child = browser.getChildren(model, model.roots[0])[0];
    assert.deepEqual(plain(browser.getPorts(model, child.id)), plain(api.getPorts(model, child.id)));
    assert.deepEqual(plain(browser.getNetEndpoints(model, model.roots[0], [3, 2, 3])), plain(api.getNetEndpoints(model, model.roots[0], [3, 2, 3])));
    assert.deepEqual(plain(browser.crossHierarchyBoundary(model, child.id, 'io', 0)), plain(api.crossHierarchyBoundary(model, child.id, 'io', 0)));
    assert.deepEqual(plain(browser.getGeneratedEvidence(model, child.id)), plain(api.getGeneratedEvidence(model, child.id)));
    assert.throws(() => browser.importYosys(raw, snapshot(raw)), /Node host/);
});

for (const [fixtureName, top] of [['A', 'mkConnected'], ['B', 'mkControl'], ['C', 'mkReuse']]) {
    test(`real BSC/Yosys fixture ${fixtureName}: exhaustive independent import and query fidelity`, () => {
        const directory = `docs/hardware/evidence/toolchain/${fixtureName}`;
        const pathRef = `${directory}/design.json`;
        // Missing compiler artifacts fail, rather than being replaced by unit fixtures or skipped.
        const text = fs.readFileSync(pathRef, 'utf8');
        const raw = JSON.parse(text);
        const recipeText = fs.readFileSync(`${directory}/recipe.json`, 'utf8');
        const recipe = JSON.parse(recipeText);
        const manifest = JSON.parse(fs.readFileSync('docs/hardware/evidence/toolchain/manifest.json', 'utf8'));
        const artifact = manifest.files.find(f => f.path === pathRef);
        assert.ok(artifact, 'compiler evidence manifest entry');
        assert.equal(digest(text), artifact.sha256);
        const bscVersion = fs.readFileSync('docs/hardware/evidence/toolchain/bsc-version.txt', 'utf8');
        for (const path of [`${directory}/recipe.json`, 'docs/hardware/evidence/toolchain/bsc-version.txt', recipe.source.path]) {
            const entry = manifest.files.find(f => f.path === path);
            assert.ok(entry, `Manifest entry: ${path}`);
            assert.equal(digest(fs.readFileSync(path)), entry.sha256);
        }
        assert.equal(digest(fs.readFileSync(recipe.source.path)), recipe.source.sha256);
        const snap = { artifact: { hash: artifact.sha256, pathRef }, stage: recipe.stage, tops: [top],
            dependencyFingerprint: digest(JSON.stringify(manifest.files)),
            toolchain: [{ name: 'yosys', version: raw.creator, identity: digest(raw.creator) },
                { name: 'bsc', version: bscVersion, identity: digest(bscVersion) }],
            passSequence: recipe.passes, buildOptionsFingerprint: digest(recipeText),
            sourceInputs: [{ uri: recipe.source.path, contentHash: recipe.source.sha256, role: 'bsv' }] };
        const model = api.importYosys(text, snap);
        const coverage = verifyFidelity(raw, model);
        const serialized = plain(model);
        verifyFidelity(raw, serialized);
        const reordered = api.importYosys(reverseKeys(raw), snap);
        assert.equal(reordered.snapshot.id, model.snapshot.id);
        verifyFidelity(reverseKeys(raw), reordered);
        const output = '.build/hardware/importer';
        fs.mkdirSync(output, { recursive: true });
        fs.writeFileSync(`${output}/${fixtureName}-fidelity.json`, JSON.stringify({ fixture: fixtureName, snapshot: model.snapshot,
            coverage, limits: model.limits, limitations: model.limitations }, null, 2) + '\n');
        fs.writeFileSync(`${output}/${fixtureName}-model.json`, JSON.stringify(model) + '\n');
        const root = model.roots[0];
        const child = api.getChildren(model, root)[0];
        const boundary = child && child.boundaries.length ? model.boundaries[child.boundaries[0]] : null;
        fs.writeFileSync(`${output}/${fixtureName}-queries.json`, JSON.stringify({ snapshotId: model.snapshot.id,
            root, children: api.getChildren(model, root).map(o => ({ id: o.id, path: o.path, providerRefs: o.providerRefs })),
            ports: api.getPorts(model, root), net: api.getNetEndpoints(model, root, model.occurrences[root].bits[0]),
            boundary: boundary ? api.crossHierarchyBoundary(model, child.id, boundary.portName, boundary.index) : null,
            generatedEvidence: api.getGeneratedEvidence(model, root) }, null, 2) + '\n');
        console.log(`FIDELITY ${fixtureName} ${JSON.stringify(coverage)}`);
    });
}
