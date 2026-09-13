'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { hash } = require('../g4/validate-delivery');
const LIMITS = { member: 64 * 1024 * 1024, total: 768 * 1024 * 1024, rows: 300000 };
const encode = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
const record = (name, bytes) => ({ path: name, bytes: bytes.length, sha256: hash(bytes) });
const relativeMetadata = name => typeof name === 'string' && name.length > 0 && !name.startsWith('/') && !name.includes('\0')
    && name.split('/').every(part => part && part !== '.' && part !== '..');
function decode(tables) {
    assert.equal(tables.schema, 'g6-usability-inventory-tables-v1');
    assert.equal(tables.encoding, 'UTF-8 JSON.stringify(value, null, 2) + LF; original property order');
    assert.deepEqual(tables.columns, ['directoryIndex', 'basename', 'contentIndex']);
    assert.ok(tables.template && typeof tables.template === 'object' && !Array.isArray(tables.template) && tables.template.files === null);
    assert.ok(Array.isArray(tables.rows) && tables.rows.length > 0 && tables.rows.length <= LIMITS.rows);
    for (const key of ['directories', 'contents']) assert.ok(Array.isArray(tables[key]) && tables[key].length > 0 && tables[key].length <= tables.rows.length);
    assert.ok(relativeMetadata(tables.original.path)); assert.ok(Number.isSafeInteger(tables.original.bytes) && tables.original.bytes <= LIMITS.member);
    assert.match(tables.original.sha256, /^[a-f0-9]{64}$/);
    const serialized = encode(tables); assert.ok(serialized.length <= LIMITS.member, 'Encoded inventory limit');
    const directories = new Set(), contents = new Set(), paths = new Set(), files = []; let expansion = encode(tables.template).length;
    for (const [index, tuple] of tables.rows.entries()) {
        assert.ok(Array.isArray(tuple) && tuple.length === 3, `Invalid inventory row ${index}`);
        const [directoryIndex, name, contentIndex] = tuple;
        assert.ok(Number.isSafeInteger(directoryIndex) && directoryIndex >= 0 && directoryIndex < tables.directories.length, 'Invalid directory reference');
        assert.ok(Number.isSafeInteger(contentIndex) && contentIndex >= 0 && contentIndex < tables.contents.length, 'Invalid content reference');
        assert.ok(typeof name === 'string' && name.length > 0 && !name.includes('/'), 'Invalid inventory basename');
        const directory = tables.directories[directoryIndex], content = tables.contents[contentIndex];
        assert.ok(typeof directory === 'string' && (directory === '' || directory.endsWith('/')), 'Invalid inventory directory');
        assert.ok(content && typeof content === 'object' && !Array.isArray(content) && !Object.hasOwn(content, 'path'), 'Invalid content descriptor');
        const file = directory + name; assert.ok(relativeMetadata(file) && !paths.has(file), 'Invalid/duplicate inventory path'); paths.add(file);
        const row = { path: file, ...content }, text = JSON.stringify(row, null, 2);
        expansion += Buffer.byteLength(text) + 4 * text.split('\n').length + 2;
        assert.ok(expansion <= LIMITS.member, 'Decoded inventory reconstruction budget exceeded');
        directories.add(directoryIndex); contents.add(contentIndex); files.push(row);
    }
    assert.equal(directories.size, tables.directories.length, 'Unused directory data'); assert.equal(contents.size, tables.contents.length, 'Unused content data');
    const original = { ...tables.template, files }, bytes = encode(original); assert.ok(bytes.length <= LIMITS.member);
    assert.deepEqual(record(tables.original.path, bytes), tables.original, 'Original inventory bytes/hash/order differ');
    return { ...tables.original, data: bytes, rows: files.length, reconstructionBudget: expansion };
}
function normalize(bytes, logicalPath) {
    assert.ok(Buffer.isBuffer(bytes) && bytes.length <= LIMITS.member); const original = JSON.parse(bytes);
    assert.deepEqual(encode(original), bytes, 'Unsupported original inventory formatting'); assert.ok(Array.isArray(original.files));
    const directories = [], contents = [], directoryIds = new Map(), contentIds = new Map(), rows = [];
    for (const row of original.files) {
        assert.ok(relativeMetadata(row.path)); assert.equal(Object.keys(row)[0], 'path', 'Original path field order must be preserved');
        const position = row.path.lastIndexOf('/') + 1, directory = row.path.slice(0, position), basename = row.path.slice(position);
        const { path: ignored, ...content } = row, key = JSON.stringify(content);
        if (!directoryIds.has(directory)) { directoryIds.set(directory, directories.length); directories.push(directory); }
        if (!contentIds.has(key)) { contentIds.set(key, contents.length); contents.push(content); }
        rows.push([directoryIds.get(directory), basename, contentIds.get(key)]);
    }
    const tables = { schema: 'g6-usability-inventory-tables-v1', encoding: 'UTF-8 JSON.stringify(value, null, 2) + LF; original property order',
        original: record(logicalPath, bytes), template: { ...original, files: null }, columns: ['directoryIndex', 'basename', 'contentIndex'], directories, contents, rows,
        contract: 'Plain JSON directory/content tables and ordered file rows. Every path, content hash, size, kind, timestamp and symlink value retained; no compression, encoded blobs or recursive references.' };
    assert.deepEqual(decode(tables).data, bytes); return tables;
}
function decodeMany(records) {
    const result = [], paths = new Set(); let total = 0, work = 0;
    assert.ok(Array.isArray(records) && records.length > 0 && records.length <= 128);
    for (const tables of records) {
        assert.ok(!paths.has(tables.original.path), 'Duplicate original inventory'); paths.add(tables.original.path);
        total += tables.original.bytes; assert.ok(total <= LIMITS.total, 'Decoded inventory aggregate limit');
        const decoded = decode(tables); work += decoded.reconstructionBudget; assert.ok(work <= LIMITS.total, 'Inventory aggregate work limit'); result.push(decoded);
    }
    return result;
}
function verifyFiles(names) {
    return { status: 'PASS', originals: decodeMany(names.map(file => {
        const stat = fs.lstatSync(file); assert.ok(stat.isFile() && !stat.isSymbolicLink() && stat.size <= LIMITS.member);
        return JSON.parse(fs.readFileSync(file));
    })).map(({ data, ...row }) => row), compressionUsed: false };
}
if (require.main === module) {
    const [mode, ...files] = process.argv.slice(2); assert.ok(mode === '--verify' && files.length, 'Usage: inventory-tables.cjs --verify TABLE.json [TABLE.json ...]');
    try { console.log(JSON.stringify(verifyFiles(files.map(file => path.resolve(file))))); } catch (error) { console.error(error); process.exitCode = 1; }
}
module.exports = { normalize, decode, decodeMany, verifyFiles, LIMITS };
