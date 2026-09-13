'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { normalize, decode, decodeMany, LIMITS } = require('./inventory-tables.cjs');
const encode = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
function fixture() {
    const input = encode({ schema: 'original-inventory', files: [{ path: 'first/file.js', kind: 'file', bytes: 4, sha256: 'a'.repeat(64) },
        { path: 'second/copy.js', kind: 'file', bytes: 4, sha256: 'a'.repeat(64) }, { path: 'first/link', kind: 'symlink', target: '../original' }], fingerprint: 'original fingerprint' });
    return { input, tables: normalize(input, 'baseline/original.json') };
}
test('Transparent inventory tables preserve complete original bytes, metadata and row/property order', () => {
    const { input, tables } = fixture(); assert.deepEqual(decode(tables).data, input); assert.equal(tables.contents.length, 2);
    assert.equal(tables.directories.length, 2); assert.equal(decodeMany([tables])[0].rows, 3); assert.ok(JSON.stringify(tables).includes('../original'));
});
test('Missing, foreign, reordered or altered references cannot produce an accepted original', () => {
    const { tables } = fixture();
    for (const mutate of [value => value.directories.pop(), value => value.contents.pop(), value => value.rows[0][0] = -1,
        value => value.rows[0][2] = 999, value => value.rows.reverse(), value => value.rows[0][1] = 'changed',
        value => value.contents[0].sha256 = 'b'.repeat(64), value => value.contents[1].target = '/foreign',
        value => value.directories[0] = '../escape/', value => value.rows[0][1] = 'nested/file', value => value.rows.push(value.rows[0]),
        value => value.contents.push({ kind: 'unused' }), value => value.contents[0].path = 'foreign']) {
        const changed = structuredClone(tables); mutate(changed); assert.throws(() => decode(changed));
    }
    const changed = structuredClone(tables); changed.template = { fingerprint: changed.template.fingerprint, ...changed.template };
    assert.throws(() => decode(changed), /bytes\/hash\/order/);
});
test('Encoded, decoded, row-count, aggregate and expansion work remain bounded', () => {
    const { tables } = fixture();
    assert.throws(() => decode({ ...tables, original: { ...tables.original, bytes: LIMITS.member + 1 } }));
    assert.throws(() => decode({ ...tables, rows: Array(LIMITS.rows + 1).fill(tables.rows[0]) }));
    assert.throws(() => decodeMany([tables, tables]), /Duplicate/);
    assert.throws(() => decodeMany(Array(129).fill(tables)));
    const bomb = structuredClone(tables); bomb.directories[0] = 'long/'.repeat(5000); bomb.rows = Array.from({ length: 4000 }, (_, i) => [0, String(i), 0]);
    assert.throws(() => decode(bomb), /reconstruction budget/);
});
