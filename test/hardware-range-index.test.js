'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeRange } = require('../src/hardware/correspondence/source');

test('repeated and changed source text retains exact Unicode and CRLF coordinates', () => {
    const original = '😀한e\u0301\t\r\nlast';
    for (const text of [original, original, 'prefix\r\n' + original, original,
        'x'.repeat(256 * 1024 + 1) + '\r\n' + original, original]) {
        const start = text.indexOf('한'), end = start + 3;
        const expected = normalizeRange(text, { unit: 'utf16', start, end });
        assert.equal(expected.text, '한e\u0301');
        assert.equal(expected.start, start); assert.equal(expected.end, end);
        const utf8 = { start: Buffer.byteLength(text.slice(0, start)), end: Buffer.byteLength(text.slice(0, end)) };
        const codepoint = { start: [...text.slice(0, start)].length, end: [...text.slice(0, end)].length };
        assert.deepEqual(expected.utf8, utf8); assert.deepEqual(expected.codepoint, codepoint);
        for (const [unit, offsets] of Object.entries({ utf8, codepoint }))
            assert.deepEqual(normalizeRange(text, { unit, ...offsets }), expected);
        const prefix = text.slice(0, start), line = prefix.split('\n').length - 1;
        const column = prefix.length - prefix.lastIndexOf('\n') - 1;
        assert.deepEqual(normalizeRange(text, { unit: 'position', encoding: 'utf16', base: 0,
            start: { line, column }, end: { line, column: column + 3 } }), expected);
        const insideSurrogate = text.indexOf('😀') + 1;
        assert.throws(() => normalizeRange(text, { unit: 'utf16', start: insideSurrogate, end }), { code: 'INVALID_RANGE' });
    }
    assert.throws(() => normalizeRange('bad\ud800', { unit: 'utf16', start: 0, end: 1 }), { code: 'INVALID_RANGE' });
    assert.equal(normalizeRange(original, { unit: 'utf16', start: 0, end: 2 }).text, '😀');
});
