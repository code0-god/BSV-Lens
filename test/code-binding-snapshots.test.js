'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createSemanticQueries } = require('../media/semantic-query');
const { buildSemanticSource } = require('./semantic-fixture');

test('earlier call arguments retain their binding environment after later reassignment', () => {
    const source = `package Snapshots;
function Bit#(8) identity(Bit#(8) a); return a; endfunction
function Bit#(8) f(Bit#(8) p);
    let x = p;
    let first = identity(x);
    x = 7;
    let second = identity(x);
    return first + second;
endfunction
endpackage`;
    const model = buildSemanticSource(source, 'Snapshots.bsv');
    const calls = model.callSites.filter((item) => item.calleeName === 'identity');
    assert.equal(calls.length, 2);
    const initial = model.statements.find((item) => item.localSymbol?.name === 'x');
    const assignment = model.statements.find((item) => item.kind === 'local-assignment');
    const queries = createSemanticQueries(model);
    const before = queries.getExpressionDependencies(calls[0].argumentExpressionIds[0]);
    const after = queries.getExpressionDependencies(calls[1].argumentExpressionIds[0]);

    assert.deepEqual(before.expression.definitionIds, [initial.rightExpressionId]);
    assert.deepEqual(after.expression.definitionIds, [assignment.rightExpressionId]);
    assert.deepEqual(before.bindingEnvironment.bindings.x.originExpressionIds, [initial.rightExpressionId]);
    assert.deepEqual(after.bindingEnvironment.bindings.x.originExpressionIds, [assignment.rightExpressionId]);
    assert.notEqual(before.bindingEnvironment.id, after.bindingEnvironment.id);
});
