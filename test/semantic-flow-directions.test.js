'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { buildSemanticSource } = require('./semantic-fixture');

test('Action Value and ActionValue flows preserve semantic direction', () => {
    // Given
    const source = `
package FlowDirections;
interface ChildIfc;
    method Action put(Bit#(8) value);
    method Bit#(8) value;
    method ActionValue#(Bit#(8)) take;
endinterface
module mkChild(ChildIfc);
    method Action put(Bit#(8) value);
        noAction;
    endmethod
    method Bit#(8) value = 1;
    method ActionValue#(Bit#(8)) take;
        return 2;
    endmethod
endmodule
module mkTop(Empty);
    ChildIfc child <- mkChild;
    rule writeChild;
        child.put(1);
    endrule
    rule readChild;
        let item = child.value;
    endrule
    rule takeChild;
        let item <- child.take;
    endrule
endmodule
endpackage
`;
    const model = buildSemanticSource(source, 'FlowDirections.bsv', {
        entrypoints: ['mkTop']
    });
    const child = model.instances.find((instance) => instance.path === 'mkTop.child');
    const endpoints = new Map(model.endpoints
        .filter((endpoint) => endpoint.ownerInstanceId === child.id)
        .map((endpoint) => [endpoint.name, endpoint]));
    const behaviors = new Map(model.stateBehaviors
        .filter((behavior) => behavior.ownerInstanceId === child.parentInstanceId)
        .map((behavior) => [behavior.name, behavior]));

    // When
    const has = (kind, fromId, toId) => model.semanticFlows.some((flow) =>
        flow.kind === kind && flow.fromId === fromId && flow.toId === toId
    );

    // Then
    assert.equal(has('invoke', behaviors.get('writeChild').id, endpoints.get('put').id), true);
    assert.equal(has('return', endpoints.get('put').id, behaviors.get('writeChild').id), false);
    assert.equal(has('return', endpoints.get('value').id, behaviors.get('readChild').id), true);
    assert.equal(has('invoke', behaviors.get('readChild').id, endpoints.get('value').id), false);
    assert.equal(has('invoke', behaviors.get('takeChild').id, endpoints.get('take').id), true);
    assert.equal(has('return', endpoints.get('take').id, behaviors.get('takeChild').id), true);
});

test('endpoint implementation links follow method input and output direction', () => {
    // Given
    const source = `
package ImplementationDirections;
interface ChildIfc;
    method Action put(Bit#(8) value);
    method Bit#(8) value;
    method ActionValue#(Bit#(8)) take;
endinterface
module mkChild(ChildIfc);
    method Action put(Bit#(8) value);
        noAction;
    endmethod
    method Bit#(8) value = 1;
    method ActionValue#(Bit#(8)) take;
        return 2;
    endmethod
endmodule
endpackage
`;
    const model = buildSemanticSource(source, 'ImplementationDirections.bsv', {
        entrypoints: ['mkChild']
    });
    const root = model.instances.find((instance) => instance.root);
    const endpoints = new Map(model.endpoints
        .filter((endpoint) => endpoint.ownerInstanceId === root.id)
        .map((endpoint) => [endpoint.name, endpoint]));
    const behaviors = new Map(model.stateBehaviors
        .filter((behavior) => behavior.ownerInstanceId === root.id)
        .map((behavior) => [behavior.name, behavior]));

    // When
    const has = (kind, fromId, toId) => model.semanticFlows.some((flow) =>
        flow.kind === kind && flow.fromId === fromId && flow.toId === toId
    );

    // Then
    assert.equal(has('invoke', endpoints.get('put').id, behaviors.get('put').id), true);
    assert.equal(has('return', behaviors.get('value').id, endpoints.get('value').id), true);
    assert.equal(has('invoke', endpoints.get('take').id, behaviors.get('take').id), true);
    assert.equal(has('return', behaviors.get('take').id, endpoints.get('take').id), true);
});
