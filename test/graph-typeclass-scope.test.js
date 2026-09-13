'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { normalizeConfig } = require('../src/architecture/config');
const { buildArchitectureModel, functionNodeId } = require('../src/architecture/graph-builder');
const { parseBsvFile } = require('../src/architecture/parser');

function build(body) {
    const parsed = parseBsvFile(`package Scoped;\n${body}\nendpackage`, {
        uri: 'file:///Scoped.bsv', relativePath: 'Scoped.bsv'
    });
    return buildArchitectureModel([parsed], normalizeConfig({}));
}

test('legacy graph does not infer typeclass dispatch from a single instance implementation', () => {
    const model = build(`
instance Convert#(Bit#(8));
    function Bit#(8) convert(Bit#(8) value); return value; endfunction
endinstance
function Bit#(8) caller(Bit#(8) value); return convert(value); endfunction
`);
    const caller = model.nodes.find(node => node.kind === 'function' && node.name === 'caller');
    assert.equal(model.edges.some(edge => edge.source === caller.id && edge.kind === 'call'), false);
    assert.ok(model.diagnostics.some(item => item.code === 'resolution.unresolved'
        && item.message.includes('typeclass dispatch')));
    assert.ok(model.nodes.some(node => node.kind === 'function' && node.name === 'convert'));
});

test('legacy graph keeps same-line instance functions distinct and preserves ordinary function IDs and calls', () => {
    const model = build(`
instance Convert#(Bit#(8)); function Bit#(8) convert(Bit#(8) value); return value; endfunction endinstance instance Convert#(Bit#(16)); function Bit#(16) convert(Bit#(16) value); return value; endfunction endinstance
function Bit#(8) helper(Bit#(8) value); return value; endfunction
function Bit#(8) caller(Bit#(8) value); return helper(value); endfunction
`);
    const overloads = model.nodes.filter(node => node.kind === 'function' && node.name === 'convert');
    assert.equal(overloads.length, 2);
    assert.equal(new Set(overloads.map(node => node.id)).size, 2);
    assert.equal(model.diagnostics.some(item => item.message.startsWith('Duplicate architecture node id')), false);
    const helper = model.nodes.find(node => node.kind === 'function' && node.name === 'helper');
    const caller = model.nodes.find(node => node.kind === 'function' && node.name === 'caller');
    assert.equal(helper.id, functionNodeId('Scoped', 'helper', null, helper.location.line));
    assert.ok(model.edges.some(edge => edge.source === caller.id && edge.target === helper.id
        && edge.kind === 'call' && edge.confidence === 'explicit'));
});
