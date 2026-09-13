'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { hash } = require('../g4/validate-delivery');
const { relative } = require('../g6/validate-delivery.cjs');
const ARRAY_KEYS = ['host', 'posts', 'states'];
const LIMITS = { member: 64 * 1024 * 1024, total: 768 * 1024 * 1024, documents: 128 };
const encode = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
const record = (name, bytes) => ({ path: name, bytes: bytes.length, sha256: hash(bytes) });
function shape(value, keys, name) {
    assert.ok(value && typeof value === 'object' && !Array.isArray(value), `${name} object required`);
    assert.deepEqual(Object.keys(value).sort(), [...keys].sort(), `Unexpected ${name} fields`);
}
function checked(descriptor, read) {
    relative(descriptor.path); assert.ok(Number.isSafeInteger(descriptor.bytes) && descriptor.bytes >= 0 && descriptor.bytes <= LIMITS.member);
    assert.match(descriptor.sha256, /^[a-f0-9]{64}$/);
    const bytes = read(descriptor.path); assert.ok(Buffer.isBuffer(bytes), `Missing diagnostic reference: ${descriptor.path}`);
    assert.equal(bytes.length, descriptor.bytes); assert.equal(hash(bytes), descriptor.sha256); return bytes;
}
function decode(manifest, read) {
    assert.equal(manifest.schema, 'g6-usability-transport-dedup-v1'); assert.equal(manifest.encoding, 'UTF-8 JSON.stringify(value, null, 2) + LF; original property order');
    assert.ok(Array.isArray(manifest.documents) && manifest.documents.length > 0 && manifest.documents.length <= LIMITS.documents);
    const sharedBytes = checked(manifest.shared, read), shared = JSON.parse(sharedBytes);
    shape(shared, [...ARRAY_KEYS, 'lastModel'], 'shared transport');
    for (const key of ARRAY_KEYS) assert.ok(Array.isArray(shared[key]));
    const output = [], originalPaths = new Set(), encodedPaths = new Set([manifest.shared.path]); let total = 0, work = 0;
    for (const row of manifest.documents) {
        relative(row.original.path); assert.ok(!originalPaths.has(row.original.path)); originalPaths.add(row.original.path);
        assert.ok(Number.isSafeInteger(row.original.bytes) && row.original.bytes > 0 && row.original.bytes <= LIMITS.member);
        total += row.original.bytes; assert.ok(total <= LIMITS.total, 'Decoded aggregate limit');
        assert.ok(!encodedPaths.has(row.encoded.path), 'Repeated/cyclic diagnostic reference'); encodedPaths.add(row.encoded.path);
        const encoded = checked(row.encoded, read); work += encoded.length + sharedBytes.length * 2;
        assert.ok(encoded.length + sharedBytes.length * 2 <= LIMITS.member && work <= LIMITS.total, 'Bounded diagnostic reconstruction work exceeded');
        const value = JSON.parse(encoded), reference = value.transport;
        shape(reference, ['schema', 'shared', 'counts'], 'transport reference'); assert.equal(reference.schema, 'g6-usability-transport-prefix-v1');
        assert.equal(reference.shared, manifest.shared.path, 'Only the one indexed shared transport may be referenced'); shape(reference.counts, ARRAY_KEYS, 'prefix counts');
        const transport = { ...shared };
        for (const key of ARRAY_KEYS) {
            const count = reference.counts[key]; assert.ok(Number.isSafeInteger(count) && count >= 0 && count <= shared[key].length, 'Invalid prefix count');
            transport[key] = shared[key].slice(0, count);
        }
        value.transport = transport;
        const bytes = encode(value); assert.ok(bytes.length <= LIMITS.member); assert.deepEqual(record(row.original.path, bytes), row.original, 'Reconstructed original DOM bytes differ');
        output.push({ ...row.original, data: bytes });
    }
    assert.equal(total, manifest.originalBytes); return output;
}
function localRead(root, name) {
    relative(name); let file = root;
    for (const part of name.split('/')) { file = path.join(file, part); assert.ok(!fs.lstatSync(file).isSymbolicLink(), 'Diagnostic symlink forbidden'); }
    const stat = fs.statSync(file); assert.ok(stat.isFile() && stat.size <= LIMITS.member, 'Diagnostic input limit');
    const bytes = fs.readFileSync(file), after = fs.statSync(file);
    assert.ok(stat.ino === after.ino && stat.size === after.size && stat.mtimeMs === after.mtimeMs, 'Diagnostic input changed'); return bytes;
}
function factor({ root, names, output, logicalPrefix = '' }) {
    assert.ok(Array.isArray(names) && names.length > 0 && names.length <= LIMITS.documents && new Set(names).size === names.length);
    if (logicalPrefix) relative(logicalPrefix);
    assert.equal(fs.readdirSync(output).length, 0, 'Factoring requires an empty output directory');
    const inputs = names.map(name => { assert.match(name, /\.dom\.json$/); const bytes = localRead(root, name), value = JSON.parse(bytes);
        assert.deepEqual(encode(value), bytes, 'Original formatting/property order must be reproduced exactly'); shape(value.transport, [...ARRAY_KEYS, 'lastModel'], 'transport');
        for (const key of ARRAY_KEYS) assert.ok(Array.isArray(value.transport[key])); return { name, bytes, value }; });
    const shared = inputs.reduce((best, item) => ARRAY_KEYS.reduce((sum, key) => sum + item.value.transport[key].length, 0)
        > ARRAY_KEYS.reduce((sum, key) => sum + best.value.transport[key].length, 0) ? item : best).value.transport;
    const sharedBytes = encode(shared), sharedRecord = record('shared-transport.json', sharedBytes), files = new Map([[sharedRecord.path, sharedBytes]]), documents = [];
    for (const [index, input] of inputs.entries()) {
        const transport = input.value.transport;
        for (const key of ARRAY_KEYS) assert.deepEqual(transport[key], shared[key].slice(0, transport[key].length), `Transport history is not an exact cumulative prefix: ${input.name}/${key}`);
        assert.deepEqual(transport.lastModel, shared.lastModel);
        const encoded = encode({ ...input.value, transport: { schema: 'g6-usability-transport-prefix-v1', shared: sharedRecord.path,
            counts: Object.fromEntries(ARRAY_KEYS.map(key => [key, transport[key].length])) } });
        const name = `document-${String(index).padStart(3, '0')}.json`; files.set(name, encoded);
        documents.push({ original: record(`${logicalPrefix ? logicalPrefix + '/' : ''}${input.name}`, input.bytes), encoded: record(name, encoded) });
    }
    const manifest = { schema: 'g6-usability-transport-dedup-v1', encoding: 'UTF-8 JSON.stringify(value, null, 2) + LF; original property order', shared: sharedRecord,
        documents, originalBytes: inputs.reduce((sum, input) => sum + input.bytes.length, 0),
        contract: 'Lossless indexed transport deduplication. Every original value/message/state retained, one bounded shared object, no compression, recursive references or changed captures.' };
    const decoded = decode(manifest, name => files.get(name));
    for (const [index, row] of decoded.entries()) assert.deepEqual(row.data, inputs[index].bytes);
    files.set('transport-dedup.json', encode(manifest));
    for (const [name, bytes] of files) fs.writeFileSync(path.join(output, name), bytes, { flag: 'wx' });
    for (const input of inputs) assert.deepEqual(localRead(root, input.name), input.bytes, 'Original DOM changed during factoring');
    return { schema: 'g6-usability-transport-dedup-receipt-v1', status: 'PASS', output, originalRoot: root, originalFiles: names,
        originalBytes: manifest.originalBytes, physicalBytes: [...files.values()].reduce((sum, bytes) => sum + bytes.length, 0),
        reconstructed: decoded.map(({ data, ...row }) => row), selectedFiles: [...files].map(([name, bytes]) => record(name, bytes)),
        originalFilesPreserved: true, compressionUsed: false, decodedMemberLimit: LIMITS.member, decodedAggregateLimit: LIMITS.total };
}
function verifyFile(file) {
    const root = path.dirname(path.resolve(file)), manifest = JSON.parse(localRead(root, path.basename(file)));
    const decoded = decode(manifest, name => localRead(root, name));
    return { status: 'PASS', documents: decoded.map(({ data, ...row }) => row), originalBytes: manifest.originalBytes, compressionUsed: false };
}
if (require.main === module) {
    const [mode, file] = process.argv.slice(2); assert.ok(mode === '--verify' && file && process.argv.length === 4, 'Usage: diagnostics.cjs --verify TRANSPORT_MANIFEST.json');
    try { console.log(JSON.stringify(verifyFile(file))); } catch (error) { console.error(error); process.exitCode = 1; }
}
module.exports = { factor, decode, verifyFile, LIMITS };
