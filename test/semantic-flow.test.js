'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
    buildFlowFixture,
    buildSemanticSource
} = require('./semantic-fixture');

test('simple value alias creates typed cross-module endpoint flow', () => {
    // Given
    const model = buildFlowFixture();
    const endpointById = new Map(model.endpoints.map((endpoint) => [endpoint.id, endpoint]));

    // When
    const flow = model.semanticFlows.find((candidate) => {
        const source = endpointById.get(candidate.fromEndpointId);
        const target = endpointById.get(candidate.toEndpointId);
        return candidate.kind === 'payload'
            && source?.name === 'currentWork'
            && target?.name === 'start'
            && candidate.parameterIndex === 0;
    });

    // Then
    assert.ok(flow);
    assert.equal(flow.payloadType, 'ArrayWork#(arrayDim)');
    assert.equal(flow.payloadTypeStatus, 'exact');
    assert.equal(flow.parameterName, 'work');
    assert.equal(flow.analysisOrigin, 'Source-derived');
    assert.equal(flow.confidence, 'exact');
    assert.match(flow.evidence, /scheduler\.currentWork/);
    assert.match(flow.evidence, /worker\.start/);
    assert.ok(flow.location);
});

test('direct endpoint expressions and ActionValue bindings retain producer semantics', () => {
    // Given
    const source = `
package DirectFlow;
interface ProducerIfc;
    method Bit#(8) value;
    method ActionValue#(Bit#(8)) get;
endinterface
interface ConsumerIfc;
    method Action put(Bit#(8) value);
endinterface
module mkProducer(ProducerIfc);
    method Bit#(8) value = 1;
    method ActionValue#(Bit#(8)) get;
        return 2;
    endmethod
endmodule
module mkConsumer(ConsumerIfc);
    method Action put(Bit#(8) value);
        noAction;
    endmethod
endmodule
module mkTop(Empty);
    ProducerIfc producer <- mkProducer;
    ConsumerIfc consumer <- mkConsumer;
    rule direct;
        consumer.put(producer.value);
    endrule
    rule actionValue;
        let item <- producer.get;
        consumer.put(item);
    endrule
endmodule
endpackage
`;

    // When
    const model = buildSemanticSource(source, 'DirectFlow.bsv', {
        entrypoints: ['mkTop']
    });
    const endpointById = new Map(model.endpoints.map((endpoint) => [endpoint.id, endpoint]));
    const payloads = model.semanticFlows.filter((flow) => flow.kind === 'payload');

    // Then
    assert.ok(payloads.some((flow) =>
        endpointById.get(flow.fromEndpointId)?.name === 'value'
        && endpointById.get(flow.toEndpointId)?.name === 'put'
        && flow.payloadType === 'Bit#(8)'
    ));
    assert.ok(payloads.some((flow) =>
        endpointById.get(flow.fromEndpointId)?.name === 'get'
        && endpointById.get(flow.toEndpointId)?.name === 'put'
        && flow.payloadType === 'Bit#(8)'
    ));
});

test('ambiguous branch aliases remain unresolved instead of inventing payload flow', () => {
    // Given
    const source = `
package AmbiguousFlow;
interface ProducerIfc;
    method Bit#(8) value;
endinterface
interface ConsumerIfc;
    method Action put(Bit#(8) value);
endinterface
module mkProducer(ProducerIfc);
    method Bit#(8) value = 1;
endmodule
module mkConsumer(ConsumerIfc);
    method Action put(Bit#(8) value);
        noAction;
    endmethod
endmodule
module mkTop(Empty);
    ProducerIfc left <- mkProducer;
    ProducerIfc right <- mkProducer;
    ConsumerIfc consumer <- mkConsumer;
    rule ambiguous;
        Bit#(8) item = 0;
        if (selectLeft) item = left.value;
        else item = right.value;
        consumer.put(item);
    endrule
endmodule
endpackage
`;

    // When
    const model = buildSemanticSource(source, 'AmbiguousFlow.bsv', {
        entrypoints: ['mkTop']
    });
    const unresolved = model.diagnostics.filter((diagnostic) =>
        diagnostic.code === 'semantic-flow.unresolved'
    );

    // Then
    assert.equal(model.semanticFlows.some((flow) =>
        flow.kind === 'payload'
        && flow.evidence.includes('consumer.put(item)')
    ), false);
    assert.ok(unresolved.length >= 1);
    assert.ok(unresolved.every((diagnostic) =>
        diagnostic.severity === 'info'
        && diagnostic.location
    ));
});

test('StateBehavior preserves guards reads writes invocations and explicit effects', () => {
    // Given
    const model = buildFlowFixture();
    const scheduler = model.instances.find((instance) => instance.path === 'mkFlowTop.scheduler');

    // When
    const behavior = model.stateBehaviors.find((candidate) =>
        candidate.ownerInstanceId === scheduler.id
        && candidate.name === 'completeWork'
    );

    // Then
    assert.equal(behavior.kind, 'method');
    assert.equal(behavior.guard, 'active');
    assert.ok(behavior.reads.includes('active'));
    assert.ok(behavior.writes.includes('active'));
    assert.ok(behavior.writes.includes('completions'));
    assert.ok(behavior.transitions.some((transition) =>
        transition.state === 'completions'
        && transition.effect === 'enqueue'
    ));
    assert.equal(behavior.summary, 'Updates active and enqueues completions.');
    assert.deepEqual(behavior.inputs, []);
    assert.deepEqual(behavior.outputs, []);
    assert.deepEqual(behavior.protocolMembership.map((protocol) => protocol.name), ['Work']);
    assert.equal(behavior.analysisOrigin, 'Source-derived');
    assert.ok(behavior.evidence.length >= 1);
});
