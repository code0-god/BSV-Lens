'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createOutput } = require('./baseline.cjs');
const { factor, decode, verifyFile, LIMITS } = require('./diagnostics.cjs');
const { hash } = require('../g4/validate-delivery');
const encode = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
function fixture() {
    const directory = createOutput('dedup-test'), root = path.join(directory, 'original'), output = path.join(directory, 'factor'); fs.mkdirSync(root); fs.mkdirSync(output);
    const names = ['first.dom.json', 'second.dom.json'];
    for (const [i, name] of names.entries()) fs.writeFileSync(path.join(root, name), encode({ selector: 'same module', events: [{ status: 'actual captured status' }],
        transport: { host: [{ payload: 'first' }, ...(i ? [{ payload: 'second' }] : [])], posts: [1], states: [{ owner: 'scope' }], lastModel: null }, canvas: { width: 420 } }));
    const receipt = factor({ root, names, output, logicalPrefix: 'before' }), manifest = JSON.parse(fs.readFileSync(path.join(output, 'transport-dedup.json')));
    const files = new Map(receipt.selectedFiles.map(row => [row.path, fs.readFileSync(path.join(output, row.path))]));
    return { root, output, names, receipt, manifest, files };
}
test('Dedup reconstructs every original byte, value, order and whitespace while retaining originals', () => {
    const f = fixture(), decoded = decode(f.manifest, name => f.files.get(name));
    decoded.forEach((row, i) => assert.deepEqual(row.data, fs.readFileSync(path.join(f.root, f.names[i]))));
    assert.equal(verifyFile(path.join(f.output, 'transport-dedup.json')).status, 'PASS'); assert.equal(f.receipt.compressionUsed, false);
});
test('Mutation, missing references and changed original property order fail even with repinned encoded bytes', () => {
    const f = fixture();
    for (const name of f.files.keys()) if (name !== 'transport-dedup.json') {
        assert.throws(() => decode(f.manifest, key => key === name ? undefined : f.files.get(key)));
        assert.throws(() => decode(f.manifest, key => key === name ? Buffer.from('corrupt') : f.files.get(key)));
    }
    const manifest = structuredClone(f.manifest), row = manifest.documents[0], original = JSON.parse(f.files.get(row.encoded.path));
    const reordered = encode({ canvas: original.canvas, ...original }); row.encoded.bytes = reordered.length; row.encoded.sha256 = hash(reordered);
    assert.throws(() => decode(manifest, name => name === row.encoded.path ? reordered : f.files.get(name)), /original DOM bytes differ/);
});
test('Unbounded/foreign/cyclic references and dishonest decoded lengths are rejected', () => {
    const f = fixture();
    for (const mutate of [value => value.shared.path = '../outside', value => value.documents[0].encoded.path = value.shared.path,
        value => value.documents[0].original.bytes = LIMITS.member + 1, value => value.originalBytes++,
        value => value.documents.push(value.documents[0]), value => value.documents = Array(129).fill(value.documents[0])]) {
        const manifest = structuredClone(f.manifest); mutate(manifest); assert.throws(() => decode(manifest, name => f.files.get(name)));
    }
    for (const count of [-1, Infinity, 99]) {
        const manifest = structuredClone(f.manifest), row = manifest.documents[0], value = JSON.parse(f.files.get(row.encoded.path)); value.transport.counts.host = count;
        const bytes = encode(value); row.encoded.bytes = bytes.length; row.encoded.sha256 = hash(bytes);
        assert.throws(() => decode(manifest, name => name === row.encoded.path ? bytes : f.files.get(name)), /prefix count/);
    }
});
test('Noncumulative data and unsupported original formatting are never silently factored', () => {
    const f = fixture(), output = path.join(path.dirname(f.output), 'reject'); fs.mkdirSync(output);
    fs.writeFileSync(path.join(f.root, f.names[0]), JSON.stringify({ transport: { host: [], posts: [], states: [], lastModel: null } }));
    assert.throws(() => factor({ root: f.root, names: f.names, output }), /formatting/);
    fs.writeFileSync(path.join(f.root, f.names[0]), encode({ transport: { host: [{ payload: 'foreign' }], posts: [1], states: [{ owner: 'scope' }], lastModel: null } }));
    assert.throws(() => factor({ root: f.root, names: f.names, output }), /cumulative prefix/);
});
