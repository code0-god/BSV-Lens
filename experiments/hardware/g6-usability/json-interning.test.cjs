'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { hash } = require('../g4/validate-delivery');
const { factor, decode, LIMITS } = require('./json-interning.cjs');
const encode = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
function fixture() {
    const shared = { messages: [{ id: 1, text: 'unchanged original '.repeat(50) }, { id: 2, literal: { '$ref': 'ordinary source value; never interpreted' } }] };
    const inputs = [{ path: 'before/scene.measurement.json', format: 'json-pretty-2-lf', bytes: encode({ first: shared, labels: [shared], empty: null }) },
        { path: 'native/events.jsonl', format: 'jsonl-compact-lf', bytes: Buffer.from([{ sequence: 1, result: shared }, { sequence: 2, result: shared }].map(row => JSON.stringify(row)).join('\n') + '\n') }];
    return { inputs, encoded: factor(inputs) };
}
function changedFile(f, descriptor, change) {
    const manifest = structuredClone(f.manifest), files = new Map(f.files), target = descriptor(manifest), value = JSON.parse(files.get(target.path)); change(value);
    const bytes = encode(value); target.bytes = bytes.length; target.sha256 = hash(bytes); files.set(target.path, bytes); return { manifest, files };
}
test('One plain atom table reconstructs exact JSON and JSONL fields, order, whitespace and every record', () => {
    const f = fixture(), rows = decode(f.encoded.manifest, name => f.encoded.files.get(name)); assert.ok(f.encoded.atoms > 0);
    rows.forEach((row, i) => assert.deepEqual(row.data, f.inputs[i].bytes)); assert.ok(f.encoded.physicalBytes < f.encoded.originalBytes);
    assert.equal(f.encoded.manifest.atomsAreOriginalValues, true);
});
test('Mutated/missing atoms or skeletons, repinned content and wrong order fail original-byte verification', () => {
    const { encoded: f } = fixture();
    for (const name of f.files.keys()) if (name !== 'json-interning.json') {
        assert.throws(() => decode(f.manifest, key => key === name ? undefined : f.files.get(key)));
        assert.throws(() => decode(f.manifest, key => key === name ? Buffer.from('corrupt') : f.files.get(key)));
    }
    const changed = changedFile(f, value => value.atoms, value => { value[0] = { changed: true }; });
    assert.throws(() => decode(changed.manifest, name => changed.files.get(name)));
    const reordered = changedFile(f, value => value.documents[1].encoded, value => value.value.reverse());
    assert.throws(() => decode(reordered.manifest, name => reordered.files.get(name)));
});
test('Foreign indices, hostile paths, duplicate/overlapping pointers and non-null holes reject', () => {
    const { encoded: f } = fixture();
    const reject = change => { const x = changedFile(f, value => value.documents[0].encoded, change); assert.throws(() => decode(x.manifest, name => x.files.get(name))); };
    reject(value => value.holes[0].atom = -1); reject(value => value.holes[0].atom = 999); reject(value => value.holes[0].atom = 0.5);
    reject(value => value.holes[0].path = ['__proto__']); reject(value => value.holes[0].path = ['constructor']);
    reject(value => value.holes.push(value.holes[0])); reject(value => value.holes.push({ path: [], atom: 0 }));
    reject(value => value.holes[0].path = ['absent']); reject(value => value.value.first = 'not a null hole');
    reject(value => value.holes[1].path = ['labels', '0']);
    assert.equal(Object.prototype.polluted, undefined);
});
test('Member/aggregate/depth/record/work declarations stay bounded and unknown formats are not normalized silently', () => {
    const { inputs, encoded: f } = fixture();
    assert.throws(() => factor([{ ...inputs[0], bytes: Buffer.from(JSON.stringify(JSON.parse(inputs[0].bytes))) }]));
    assert.throws(() => factor([{ ...inputs[0], format: 'unknown' }]));
    const manifest = structuredClone(f.manifest); manifest.documents[0].original.bytes = LIMITS.member + 1;
    assert.throws(() => decode(manifest, name => f.files.get(name)));
    const rows = structuredClone(f.manifest); rows.documents = Array(129).fill(rows.documents[0]); assert.throws(() => decode(rows, name => f.files.get(name)));
    const tooDeep = changedFile(f, value => value.documents[0].encoded, value => { value.holes[0].path = Array(129).fill('nested'); });
    assert.throws(() => decode(tooDeep.manifest, name => tooDeep.files.get(name)));
});
test('Compact nested atoms and skeletons reject excessive pretty expansion before any pretty stringify', () => {
    const { encoded: f } = fixture(); let value = Array(300000).fill('x');
    for (let i = 0; i < 120; i++) value = { nested: value };
    for (const target of ['atom', 'skeleton']) {
        const manifest = structuredClone(f.manifest), files = new Map(f.files), item = target === 'atom' ? manifest.atoms : manifest.documents[0].encoded;
        const bytes = Buffer.from(JSON.stringify(target === 'atom' ? [value] : { value, holes: [] }));
        item.bytes = bytes.length; item.sha256 = hash(bytes); files.set(item.path, bytes); assert.ok(bytes.length < 2 * 1024 * 1024);
        const stringify = JSON.stringify; let prettyCalls = 0;
        JSON.stringify = function (input, replacer, space) { if (space === 2) { prettyCalls++; throw new Error('Unexpected pretty allocation'); } return stringify(input, replacer, space); };
        try { assert.throws(() => decode(manifest, name => files.get(name)), /JSON size preflight/); assert.equal(prettyCalls, 0); }
        finally { JSON.stringify = stringify; }
    }
});
