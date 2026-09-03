'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
    findSmallestNodeAtPosition,
    positionInRange
} = require('../src/architecture/symbol-index');

const uri = 'file:///Example.bsv';
const nodes = [
    {
        id: 'module',
        kind: 'module',
        sourceRange: { uri, line: 1, column: 0, endLine: 20, endColumn: 9 }
    },
    {
        id: 'rule',
        kind: 'rule',
        sourceRange: { uri, line: 5, column: 4, endLine: 9, endColumn: 11 }
    },
    {
        id: 'state',
        kind: 'register',
        sourceRange: { uri, line: 6, column: 8, endLine: 6, endColumn: 13 }
    }
];

test('position containment handles multiline and inclusive boundaries', () => {
    assert.equal(positionInRange(5, 4, nodes[1].sourceRange), true);
    assert.equal(positionInRange(9, 11, nodes[1].sourceRange), true);
    assert.equal(positionInRange(9, 12, nodes[1].sourceRange), false);
});

test('smallest containing architecture node wins', () => {
    assert.equal(findSmallestNodeAtPosition(nodes, uri, 6, 10).id, 'state');
    assert.equal(findSmallestNodeAtPosition(nodes, uri, 8, 2).id, 'rule');
    assert.equal(findSmallestNodeAtPosition(nodes, uri, 18, 0).id, 'module');
});

test('unmatched files and positions return null', () => {
    assert.equal(findSmallestNodeAtPosition(nodes, 'file:///Other.bsv', 6, 10), null);
    assert.equal(findSmallestNodeAtPosition(nodes, uri, 30, 0), null);
});
