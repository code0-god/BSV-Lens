'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { findMatchingDelimiter, splitTopLevel } = require('../src/architecture/source-utils');

test('splits nested type arguments without splitting nested commas', () => {
    assert.deepEqual(
        splitTopLevel('Vector#(2, Bit#(8)), Bool').map(value => value.trim()),
        ['Vector#(2, Bit#(8))', 'Bool']
    );
});

test('ignores delimiters inside strings and comments', () => {
    assert.deepEqual(splitTopLevel('a, "x,y", b'), ['a', ' "x,y"', ' b']);
    assert.deepEqual(splitTopLevel('a /*,*/, b'), ['a /*,*/', ' b']);
    assert.equal(findMatchingDelimiter('mk#(" ) ", TAdd#(1, 2))', 3, '(', ')'), 22);
});
