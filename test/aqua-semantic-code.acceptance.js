'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createSemanticQueries } = require('../media/semantic-query');
const { buildAquaSemanticModel } = require('./aqua-semantic-fixture');

test('pinned Aqua beginArrayWork separates comparison, assertions, calls, and branch state effects', () => {
    const { model } = buildAquaSemanticModel();
    const behavior = model.stateBehaviors.find((item) => item.name === 'beginArrayWork');
    assert.ok(behavior);
    assert.deepEqual([...behavior.writes].sort(), ['activeWork', 'arrayWorkId', 'fragmentId', 'phase']);
    assert.equal(behavior.writes.includes('nextArrayWorkId'), false);
    const statements = model.statements.filter((item) => item.enclosingCallableId === behavior.definitionId);
    assert.equal(statements.filter((item) => item.kind === 'assertion').length, 2);
    assert.equal(statements.filter((item) => item.kind === 'state-assignment').length, 4);
    assert.ok(statements.some((item) => item.kind === 'if'));
    const comparison = model.expressions.find((item) =>
        item.enclosingCallableId === behavior.definitionId
        && item.text === 'nextArrayWorkId <= fromInteger(2 ** 32 - 1)');
    assert.equal(comparison.operator, '<=');
    const startCall = model.callSites.find((item) =>
        item.enclosingCallableId === behavior.definitionId && item.calleeName === 'fragments.start');
    assert.ok(startCall);
    assert.equal(startCall.argumentExpressionIds.length, 2);
    const flow = model.semanticFlows.find((item) => item.kind === 'payload' && item.causeBehaviorId === behavior.id);
    assert.equal(flow.callSiteId, startCall.id);
    const slice = createSemanticQueries(model).getBehaviorSlice(behavior.id);
    assert.equal(slice.statements.length, statements.length);
    assert.equal(slice.predicateExpression.id, behavior.predicateExpressionId);
});

test('pinned Aqua helper function has one definition, typed locals, and multiline return dependencies', () => {
    const { model } = buildAquaSemanticModel();
    const fn = model.functionDefinitions.find((item) => item.name === 'accumulatorBaseValid');
    assert.ok(fn);
    assert.equal(model.instances.some((item) => item.targetDefinitionId === fn.id), false);
    const statements = model.statements.filter((item) => item.enclosingCallableId === fn.id);
    assert.equal(statements.filter((item) => item.kind === 'local-declaration').length, 2);
    const returned = statements.find((item) => item.kind === 'return');
    assert.ok(returned);
    const expression = model.expressions.find((item) => item.id === returned.expressionId);
    assert.match(expression.text, /rowEnd <= fromInteger/);
    assert.equal(expression.resolutionStatus, 'exact');
});
