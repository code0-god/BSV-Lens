'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const Text = require('../media/text-metrics');

test('display width counts CJK and grapheme clusters conservatively', () => {
    assert.equal(Text.displayWidth('abc'), 3);
    assert.equal(Text.displayWidth('A가B'), 4);
    assert.equal(Text.displayWidth('가나다'), 6);
    assert.equal(Text.displayWidth('e\u0301'), 1);
    assert.equal(Text.displayWidth('🙂'), 2);
});

test('truncateWidth never splits CJK or combined graphemes', () => {
    assert.equal(Text.truncateWidth('가나다라', 5), '가나…');
    assert.equal(Text.truncateWidth('e\u0301clair', 4), 'e\u0301cl…');
    assert.equal(Text.truncateWidth('short', 8), 'short');
});
