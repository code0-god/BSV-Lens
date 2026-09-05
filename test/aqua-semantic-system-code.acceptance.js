'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const { fileURLToPath } = require('node:url');
const { createSemanticQueries } = require('../media/semantic-query');
const { createLineStarts } = require('../src/architecture/source-utils');
const { buildAquaSemanticModel } = require('./aqua-semantic-fixture');

test('pinned system flow identifies transfer code separately from endpoint implementations', () => {
    const { model } = buildAquaSemanticModel();
    const queries = createSemanticQueries(model);
    const endpoints = new Map(model.endpoints.map((endpoint) => [endpoint.id, endpoint]));
    const matches = model.semanticFlows.filter((flow) =>
        flow.kind === 'payload'
        && endpoints.get(flow.fromEndpointId)?.name === 'currentWork'
        && endpoints.get(flow.toEndpointId)?.name === 'start'
    );
    assert.equal(matches.length, 1);
    const result = queries.getFlowEvidence(matches[0].id);
    assert.equal(result.status, 'exact');
    const producerOwner = queries.getInstanceComposition(result.producer.endpoint.ownerInstanceId);
    const consumerOwner = queries.getInstanceComposition(result.consumer.endpoint.ownerInstanceId);
    assert.equal(producerOwner.instance.name, 'matmul');
    assert.equal(consumerOwner.instance.name, 'fragments');
    assert.equal(result.mapping.parameterIndex, 0);
    assert.equal(result.mapping.parameterName, 'work');
    assert.equal(result.mapping.payloadType, 'ArrayWork#(arrayDim)');
    assert.equal(result.mapping.consumerArgumentExpression, 'work');
    assert.ok(result.mapping.sourceAliases.includes('work'));
    const transfer = queries.getBehaviorSlice(result.causeBehaviorId, {
        ownerInstanceId: matches[0].ownerInstanceId
    });
    assert.equal(transfer.status, 'exact');
    assert.equal(transfer.behavior.name, 'beginArrayWork');
    assert.notEqual(result.causeBehaviorId, result.producer.implementationBehaviorId);
    assert.notEqual(result.causeBehaviorId, result.consumer.implementationBehaviorId);
    assert.ok(result.callSiteId);
    assert.deepEqual(result.evidenceRefs.map((reference) => reference.text), [
        'let work = matmul.currentWork;',
        'fragments.start(work, work.kTileStart != 0);'
    ]);
    for (const reference of result.evidenceRefs) {
        const source = fs.readFileSync(fileURLToPath(reference.sourceRange.uri), 'utf8');
        const starts = createLineStarts(source);
        const range = reference.sourceRange;
        assert.equal(source.slice(
            starts[range.line] + range.column,
            starts[range.endLine] + range.endColumn
        ), reference.text);
    }
    const implementation = queries.resolveEndpointImplementation(result.consumer.endpointId, {
        ownerInstanceId: consumerOwner.instance.id
    });
    assert.equal(implementation.status, 'exact');
    assert.equal(implementation.behavior.ownerInstanceId, consumerOwner.instance.id);
    assert.equal(implementation.behavior.name, 'start');
});
