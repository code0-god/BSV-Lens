'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { hash } = require('../g4/validate-delivery');
const { relative } = require('../g6/validate-delivery.cjs');
const LIMITS = { member: 64 * 1024 * 1024, aggregate: 768 * 1024 * 1024, nodes: 4000000, depth: 128, rows: 100000, documents: 128 };
const FORMATS = ['json-pretty-2-lf', 'jsonl-compact-lf'];
const forbidden = new Set(['__proto__', 'prototype', 'constructor']);
function quotedBytes(text) {
    let bytes = 2;
    for (let i = 0; i < text.length; i++) {
        const code = text.charCodeAt(i);
        if ([8, 9, 10, 12, 13, 34, 92].includes(code)) bytes += 2;
        else if (code < 32) bytes += 6;
        else if (code >= 0xd800 && code <= 0xdbff && text.charCodeAt(i + 1) >= 0xdc00 && text.charCodeAt(i + 1) <= 0xdfff) { bytes += 4; i++; }
        else if (code >= 0xd800 && code <= 0xdfff) bytes += 6;
        else bytes += code <= 0x7f ? 1 : code <= 0x7ff ? 2 : 3;
        assert.ok(bytes <= LIMITS.member, 'JSON size preflight: escaped string limit');
    }
    return bytes;
}
function measure(value) {
    const result = { compact: 0, pretty: 0, lines: 1 }; let nodes = 0;
    const add = (compact, pretty = compact, lines = 0) => {
        result.compact += compact; result.pretty += pretty; result.lines += lines;
        assert.ok(result.compact < LIMITS.member && result.pretty < LIMITS.member, 'JSON size preflight: member/work limit');
    };
    function walk(item, depth) {
        assert.ok(depth <= LIMITS.depth && ++nodes <= LIMITS.nodes, 'JSON size preflight: node/depth limit');
        if (typeof item === 'string') { add(quotedBytes(item)); return; }
        if (item === null || ['boolean', 'number'].includes(typeof item)) { add(JSON.stringify(item).length); return; }
        assert.ok(item && typeof item === 'object', 'JSON size preflight: non-JSON value');
        const keys = Object.keys(item), array = Array.isArray(item); add(2);
        for (const [index, key] of keys.entries()) {
            add(index ? 1 : 0, (index ? 1 : 0) + 1 + 2 * (depth + 1), 1);
            if (!array) { const bytes = quotedBytes(key); add(bytes + 1, bytes + 2); }
            walk(item[key], depth + 1);
        }
        if (keys.length) add(0, 1 + 2 * depth, 1);
    }
    walk(value, 0); return result;
}
const encoded = value => { measure(value); return Buffer.from(JSON.stringify(value, null, 2) + '\n'); };
const descriptor = (name, bytes) => ({ path: name, bytes: bytes.length, sha256: hash(bytes) });
function render(value, format) {
    assert.ok(FORMATS.includes(format)); measure(value);
    if (format === FORMATS[0]) return encoded(value);
    assert.ok(Array.isArray(value) && value.length <= LIMITS.rows); return Buffer.from(value.map(row => JSON.stringify(row)).join('\n') + '\n');
}
function visit(value, callback, cursor = [], budget = { nodes: 0 }) {
    assert.ok(cursor.length <= LIMITS.depth && ++budget.nodes <= LIMITS.nodes, 'JSON node/depth limit');
    if (callback(value, cursor) === false) return;
    if (value && typeof value === 'object') for (const key of Object.keys(value)) visit(value[key], callback, [...cursor, Array.isArray(value) ? Number(key) : key], budget);
}
function parse(bytes, format) {
    assert.ok(Buffer.isBuffer(bytes) && bytes.length <= LIMITS.member && FORMATS.includes(format));
    const text = bytes.toString('utf8');
    const value = format === FORMATS[0] ? JSON.parse(text) : text.trimEnd().split('\n').map(line => JSON.parse(line));
    visit(value, () => {}); assert.deepEqual(render(value, format), bytes, 'Original JSON formatting must be reproduced exactly'); return value;
}
function pin(record, read) {
    relative(record.path); assert.ok(Number.isSafeInteger(record.bytes) && record.bytes >= 0 && record.bytes <= LIMITS.member);
    assert.match(record.sha256, /^[a-f0-9]{64}$/); const bytes = read(record.path); assert.ok(Buffer.isBuffer(bytes), `Missing reference: ${record.path}`);
    assert.equal(bytes.length, record.bytes); assert.equal(hash(bytes), record.sha256); return bytes;
}
function setHole(holder, pointer, atom, trie) {
    assert.ok(Array.isArray(pointer) && pointer.length <= LIMITS.depth); let node = trie;
    for (const token of pointer) {
        assert.ok(typeof token === 'string' || Number.isSafeInteger(token) && token >= 0, 'Invalid pointer token');
        assert.ok(!forbidden.has(token), 'Hostile pointer'); assert.ok(!node.end, 'Ancestor pointer overlap');
        const key = `${typeof token}:${token}`; if (!node.children.has(key)) node.children.set(key, { children: new Map() }); node = node.children.get(key);
    }
    assert.ok(!node.end && node.children.size === 0, 'Duplicate/descendant pointer overlap'); node.end = true;
    if (!pointer.length) { assert.equal(holder.value, null, 'Root reference must target a null hole'); holder.value = atom; return; }
    let parent = holder.value;
    for (const [index, token] of pointer.entries()) {
        assert.ok(parent && typeof parent === 'object' && Object.hasOwn(parent, token), 'Pointer target missing');
        assert.ok(Array.isArray(parent) ? Number.isSafeInteger(token) && token >= 0 && token < parent.length : typeof token === 'string', 'Pointer container/index mismatch');
        if (index + 1 === pointer.length) { assert.equal(parent[token], null, 'Reference must target a null hole'); Object.defineProperty(parent, token, { value: atom, enumerable: true, writable: true, configurable: true }); }
        else parent = parent[token];
    }
}
function decode(manifest, read) {
    assert.equal(manifest.schema, 'g6-usability-json-interning-v1'); assert.equal(manifest.atomsAreOriginalValues, true);
    assert.ok(Array.isArray(manifest.documents) && manifest.documents.length > 0 && manifest.documents.length <= LIMITS.documents);
    const atoms = JSON.parse(pin(manifest.atoms, read)); assert.ok(Array.isArray(atoms) && atoms.length <= LIMITS.rows); visit(atoms, () => {});
    const sizes = atoms.map(measure);
    const originals = new Set(), references = new Set([manifest.atoms.path]), used = new Set(), results = []; let total = 0, nodes = 0;
    for (const record of manifest.documents) {
        relative(record.original.path); assert.ok(!originals.has(record.original.path)); originals.add(record.original.path);
        assert.ok(Number.isSafeInteger(record.original.bytes) && record.original.bytes > 0 && record.original.bytes <= LIMITS.member);
        total += record.original.bytes; assert.ok(total <= LIMITS.aggregate, 'Decoded aggregate limit');
        assert.ok(!references.has(record.encoded.path), 'Duplicate/cyclic document reference'); references.add(record.encoded.path);
        const skeleton = JSON.parse(pin(record.encoded, read)); assert.deepEqual(Object.keys(skeleton).sort(), ['holes', 'value']);
        assert.ok(Array.isArray(skeleton.holes) && skeleton.holes.length <= LIMITS.rows); assert.ok(FORMATS.includes(record.format));
        if (record.format === FORMATS[1]) assert.ok(Array.isArray(skeleton.value), 'JSONL root must remain an ordered row array');
        visit(skeleton, () => {}); let expansion = render(skeleton.value, record.format).length;
        for (const hole of skeleton.holes) {
            assert.deepEqual(Object.keys(hole).sort(), ['atom', 'path']); assert.ok(Number.isSafeInteger(hole.atom) && hole.atom >= 0 && hole.atom < atoms.length, 'Invalid atom reference');
            assert.ok(Array.isArray(hole.path) && hole.path.length <= LIMITS.depth);
            const size = sizes[hole.atom]; expansion += (record.format === FORMATS[0] ? size.pretty + 2 * hole.path.length * (size.lines - 1) : size.compact) - 4;
            assert.ok(expansion <= LIMITS.member, 'Decoded reconstruction work/member limit'); used.add(hole.atom);
        }
        assert.equal(expansion, record.original.bytes, 'Declared decoded size differs from bounded expansion');
        const trie = { children: new Map() }, holder = { value: skeleton.value };
        for (const hole of skeleton.holes) setHole(holder, hole.path, atoms[hole.atom], trie);
        const budget = { nodes }; visit(holder.value, () => {}, [], budget); nodes = budget.nodes;
        const bytes = render(holder.value, record.format); assert.deepEqual(descriptor(record.original.path, bytes), record.original, 'Original bytes/SHA/order differ');
        results.push({ ...record.original, data: bytes });
    }
    assert.equal(used.size, atoms.length, 'Unused atom data'); assert.equal(total, manifest.originalBytes); return results;
}
function factor(inputs) {
    assert.ok(Array.isArray(inputs) && inputs.length > 0 && inputs.length <= LIMITS.documents);
    const candidates = new Map(), cached = new WeakMap(); let total = 0, work = 0;
    const documents = inputs.map(input => { total += input.bytes.length; assert.ok(total <= LIMITS.aggregate); relative(input.path); return { ...input, value: parse(input.bytes, input.format) }; });
    function candidate(value) {
        if (value === null || typeof value !== 'object' && typeof value !== 'string') return null;
        if (typeof value === 'object' && cached.has(value)) return cached.get(value);
        const text = JSON.stringify(value); work += Buffer.byteLength(text); assert.ok(work <= LIMITS.aggregate, 'Interning preparation work limit');
        const result = Buffer.byteLength(text) >= 128 ? { key: hash(text), value } : null;
        if (typeof value === 'object') cached.set(value, result); return result;
    }
    for (const input of documents) visit(input.value, (value, cursor) => {
        if (!cursor.length || cursor.some(token => forbidden.has(token))) return;
        const found = candidate(value); if (found) { const previous = candidates.get(found.key); candidates.set(found.key, { ...found, count: (previous?.count || 0) + 1 }); }
    });
    const atoms = [], atomIds = new Map(), skeletons = [];
    for (const input of documents) {
        const holes = [];
        function replace(value, cursor) {
            const found = cursor.length && !cursor.some(token => forbidden.has(token)) ? candidate(value) : null;
            if (found && candidates.get(found.key)?.count > 1) {
                if (!atomIds.has(found.key)) { atomIds.set(found.key, atoms.length); atoms.push(value); }
                holes.push({ path: cursor, atom: atomIds.get(found.key) }); return null;
            }
            if (!value || typeof value !== 'object') return value;
            const result = Array.isArray(value) ? [] : {};
            for (const key of Object.keys(value)) Object.defineProperty(result, key, { value: replace(value[key], [...cursor, Array.isArray(value) ? Number(key) : key]), enumerable: true, configurable: true, writable: true });
            return result;
        }
        skeletons.push({ value: replace(input.value, []), holes });
    }
    assert.ok(atoms.length <= LIMITS.rows); const files = new Map([['atoms.json', encoded(atoms)]]);
    const records = documents.map((input, i) => { const name = `document-${String(i).padStart(3, '0')}.json`, bytes = encoded(skeletons[i]); files.set(name, bytes);
        return { original: descriptor(input.path, input.bytes), encoded: descriptor(name, bytes), format: input.format }; });
    const manifest = { schema: 'g6-usability-json-interning-v1', atomsAreOriginalValues: true, atoms: descriptor('atoms.json', files.get('atoms.json')),
        documents: records, originalBytes: total, contract: 'Plain JSON original-value atoms plus ordered document skeletons and disjoint typed paths to null holes. Dictionary values are never recursively interpreted. No compression or missing measurements/messages.' };
    const decoded = decode(manifest, name => files.get(name)); decoded.forEach((row, i) => assert.deepEqual(row.data, inputs[i].bytes));
    files.set('json-interning.json', encoded(manifest));
    return { manifest, files, originalBytes: total, physicalBytes: [...files.values()].reduce((sum, bytes) => sum + bytes.length, 0), atoms: atoms.length, preparationWork: work };
}
function verifyFile(file) {
    const root = path.dirname(path.resolve(file)), read = name => { relative(name); let target = root;
        for (const part of name.split('/')) { target = path.join(target, part); assert.ok(!fs.lstatSync(target).isSymbolicLink(), 'Symlink reference forbidden'); }
        const stat = fs.lstatSync(target); assert.ok(stat.isFile() && stat.size <= LIMITS.member); return fs.readFileSync(target); };
    const manifest = JSON.parse(read(path.basename(file)));
    return { status: 'PASS', originals: decode(manifest, read).map(({ data, ...row }) => row), compressionUsed: false };
}
if (require.main === module) {
    const [mode, file] = process.argv.slice(2); assert.ok(mode === '--verify' && file && process.argv.length === 4, 'Usage: json-interning.cjs --verify MANIFEST.json');
    try { console.log(JSON.stringify(verifyFile(file))); } catch (error) { console.error(error); process.exitCode = 1; }
}
module.exports = { factor, decode, verifyFile, LIMITS };
