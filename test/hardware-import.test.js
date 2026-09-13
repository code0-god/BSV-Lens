'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const crypto = require('node:crypto');
const provider = require('../src/hardware/yosys-json');
const reference = require('../experiments/hardware/importer');
const hash = text => crypto.createHash('sha256').update(text).digest('hex');
const plain = value => JSON.parse(JSON.stringify(value));
function fixture() {
    return { modules: { top: { ports: { io: { direction: 'inout', bits: [2, 3] } },
        cells: { left: { type: 'child', connections: { p: [3, 2, '0', 'x'] } },
            right: { type: 'child', connections: { p: [2, 3, '1', 'z'] } } },
        netnames: { bus: { bits: [3, 2, 3, 'x'], offset: -2, upto: 1, signed: 1 } },
        memories: { bank: { width: 8, size: 2, vendor: { unknown: true } } } },
    child: { ports: { p: { direction: 'input', bits: [2, 3, 4, 5] } },
        cells: { opaque: { type: 'vendor', parameters: { N: '10' },
            attributes: { src: '/not-authorized/file.v:1.1-9.1', vendor: [1, 2] },
            connections: { Y: [2, 2], A: [3] }, port_directions: { Y: 'output', A: 'input' } } } } } };
}
function metadata(text, tops = ['top']) {
    return { artifact: { hash: hash(text), pathRef: 'artifact' }, stage: 'hierarchical-rtl-proc', tops,
        toolchain: [{ name: 'yosys', version: 'test', identity: 'test' }], passSequence: ['proc'],
        buildOptionsFingerprint: 'options' };
}
function normalized(model) {
    return JSON.parse(JSON.stringify(model).split(model.snapshot.id).join('SNAPSHOT'));
}
for (const [name, top] of [['A', 'mkConnected'], ['B', 'mkControl'], ['C', 'mkReuse']]) {
    test(`product matches every reference table and ordered connectivity for actual G1 ${name}`, () => {
        const text = fs.readFileSync(`docs/hardware/evidence/toolchain/${name}/design.json`, 'utf8');
        const manifest = JSON.parse(fs.readFileSync('docs/hardware/evidence/toolchain/manifest.json', 'utf8'));
        assert.equal(hash(text), manifest.files.find(f => f.path === `docs/hardware/evidence/toolchain/${name}/design.json`).sha256);
        const meta = metadata(text, [top]);
        assert.deepEqual(normalized(provider.importYosys(text, meta)), normalized(reference.importYosys(text, meta)));
    });
}
test('repeated occurrences, constants, raw unknowns and all tables survive; mutations cannot rewrite truth', () => {
    const raw = fixture(), text = JSON.stringify(raw), meta = metadata(text);
    const model = provider.importYosys(text, meta);
    assert.deepEqual(normalized(model), normalized(reference.importYosys(text, meta)));
    assert.deepEqual(plain(model.raw), raw);
    const children = provider.getChildren(model, model.roots[0]);
    assert.notEqual(provider.getPorts(model, children[0].id)[0].bits[0], provider.getPorts(model, children[1].id)[0].bits[0]);
    for (const child of children) assert.deepEqual([0, 1, 2, 3].map(i => model.bits[provider.crossHierarchyBoundary(model, child.id, 'p', i).actualBitId].value), raw.modules.top.cells[child.name].connections.p);
    assert.throws(() => { Object.values(model.pins)[0].bits.reverse(); }, TypeError);
    assert.throws(() => { model.raw.modules.top.memories.bank.size = 3; }, TypeError);
    assert.throws(() => { model.snapshot.stage = 'changed'; }, TypeError);
    assert.deepEqual(provider.getGeneratedEvidence(model, model.roots[0]).originalBsv, { status: 'unmapped', refs: [] });
});
test('malformed directions and unreachable invalid boundary bindings are rejected', () => {
    for (const mutate of [r => { r.modules.top.ports.io.direction = 'sideways'; },
        r => { r.modules.child.cells.opaque.port_directions.Y = 42; },
        r => { r.modules.unselected = { cells: { c: { type: 'child', connections: { p: [2] } } } }; },
        r => { r.modules.top.cells.left.port_directions = { p: 'output' }; }]) {
        const raw = fixture(); mutate(raw); const text = JSON.stringify(raw);
        assert.throws(() => provider.importYosys(text, metadata(text)), /direction|width/i);
    }
});

test('all malformed bit types, JSON limits, cycles, sparse arrays and accessors fail at the provider seam', () => {
    for (const bit of [-1, 0.1, Number.MAX_SAFE_INTEGER + 1, null, {}, [], '2', 'X', true]) {
        const raw = fixture(); raw.modules.top.ports.io.bits = [bit];
        const text = JSON.stringify(raw);
        assert.throws(() => provider.importYosys(text, metadata(text)), /Malformed bit/);
    }
    const raw = fixture(), text = JSON.stringify(raw), meta = metadata(text);
    for (const limits of [{ maxBytes: 40 }, { maxJsonDepth: 2 }, { maxJsonNodes: 3 }, { maxHierarchyDepth: 1 },
        { maxOccurrences: 1 }, { maxEntities: 4 }, { maxVectorWidth: 1 }]) {
        assert.throws(() => provider.importYosys(text, { ...meta, limits }), /limit|width/);
    }
    assert.throws(() => provider.importYosys('{', meta), SyntaxError);
    const cycle = fixture(); cycle.loop = cycle;
    assert.throws(() => provider.importYosys(cycle, meta), /Cyclic/);
    const accessor = fixture();
    Object.defineProperty(accessor, 'evil', { enumerable: true, get() { assert.fail('Accessor must never execute'); } });
    assert.throws(() => provider.importYosys(accessor, meta), /accessor/);
    const sparse = fixture(); sparse.extra = new Array(3);
    assert.throws(() => provider.importYosys(sparse, meta), /sparse/);
    const decorated = fixture(); decorated.extra = []; decorated.extra.extra = 1;
    assert.throws(() => provider.importYosys(decorated, meta), /decorated/);
    const symbol = fixture(); symbol[Symbol('hidden')] = 1;
    assert.throws(() => provider.importYosys(symbol, meta), /symbol/);
});
test('hostile prototype names are retained safely, not dropped; unknown directions and open formals stay explicit', () => {
    const text = '{"modules":{"__proto__":{"ports":{"constructor":{"bits":[2]},"a/b~c":{"bits":[3]}},"cells":{"constructor":{"type":"box","connections":{"open":[]}}},"netnames":{"__proto__":{"bits":[2,3]}}},"box":{"attributes":{"blackbox":"0001"},"ports":{"open":{"bits":[2],"direction":"output"},"missing":{"bits":[3]}}}}}';
    const meta = metadata(text, ['__proto__']);
    const model = provider.importYosys(text, meta);
    assert.deepEqual(normalized(model), normalized(reference.importYosys(text, meta)));
    assert.equal(Object.getPrototypeOf(model.raw.modules), null);
    assert.equal(Object.getPrototypeOf(model.definitions), null);
    assert.equal({}.polluted, undefined);
    const child = provider.getChildren(model, model.roots[0])[0];
    assert.equal(provider.crossHierarchyBoundary(model, child.id, 'open', 0), null);
    assert.equal(provider.crossHierarchyBoundary(model, child.id, 'missing', 0), null);
    assert.equal(provider.getPorts(model, model.roots[0])[1].direction, null);
});
test('corruption checks detect same-count pin reorder, aliases and formal/actual binding mutation', () => {
    const text = JSON.stringify(fixture()), meta = metadata(text);
    const expected = normalized(reference.importYosys(text, meta));
    for (const corrupt of [m => { Object.values(m.pins)[0].bits.reverse(); },
        m => { Object.values(m.aliases)[0].bits.reverse(); },
        m => { const b = Object.values(m.boundaries)[0]; b.actualBitId = m.pins[b.pinId].bits[1]; }]) {
        const actual = normalized(provider.importYosys(text, meta));
        corrupt(actual);
        assert.throws(() => assert.deepEqual(actual, expected), { code: 'ERR_ASSERTION' });
    }
});
test('object dictionary order is irrelevant, vector order and actual content remain identity', () => {
    const reverse = value => Array.isArray(value) ? value.map(reverse) : value && typeof value === 'object'
        ? Object.fromEntries(Object.entries(value).reverse().map(([k, v]) => [k, reverse(v)])) : value;
    const raw = fixture(), meta = metadata(JSON.stringify(raw));
    const first = provider.importYosys(raw, meta);
    const second = provider.importYosys(reverse(raw), reverse(meta));
    assert.deepEqual(normalized(first), normalized(second));
    assert.equal(first.snapshot.id, second.snapshot.id);
    raw.modules.top.cells.left.connections.p.reverse();
    assert.notEqual(provider.importYosys(raw, meta).snapshot.id, first.snapshot.id);
});
