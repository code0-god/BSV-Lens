'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { buildSemanticSource } = require('./semantic-fixture');

test('method return expression links child value endpoint to outer endpoint', () => {
    // Given
    const source = `
package ReturnFlow;
interface ProducerIfc;
    method Bit#(8) value;
endinterface
interface ForwarderIfc;
    method Bit#(8) value;
endinterface
module mkProducer(ProducerIfc);
    method Bit#(8) value = 7;
endmodule
module mkForwarder#(ProducerIfc source)(ForwarderIfc);
    method Bit#(8) value;
        return source.value;
    endmethod
endmodule
module mkTop(Empty);
    ProducerIfc producer <- mkProducer;
    ForwarderIfc forwarder <- mkForwarder(producer);
endmodule
endpackage
`;

    // When
    const model = buildSemanticSource(source, 'ReturnFlow.bsv', {
        entrypoints: ['mkTop']
    });
    const endpointById = new Map(model.endpoints.map((endpoint) => [endpoint.id, endpoint]));
    const flow = model.semanticFlows.find((candidate) => {
        const from = endpointById.get(candidate.fromEndpointId);
        const to = endpointById.get(candidate.toEndpointId);
        return candidate.kind === 'return'
            && from?.ownerInstanceId !== to?.ownerInstanceId
            && from?.name === 'value'
            && to?.name === 'value';
    });

    // Then
    assert.ok(flow);
    assert.equal(flow.payloadType, 'Bit#(8)');
    assert.equal(flow.payloadTypeStatus, 'exact');
    assert.match(flow.evidence, /return source\.value/);
});

test('simple typed local aliases retain one exact endpoint source', () => {
    // Given
    const source = `
package TypedAlias;
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
    ProducerIfc producer <- mkProducer;
    ConsumerIfc consumer <- mkConsumer;
    rule relay;
        Bit#(8) item = producer.value;
        consumer.put(item);
    endrule
endmodule
endpackage
`;

    // When
    const model = buildSemanticSource(source, 'TypedAlias.bsv', {
        entrypoints: ['mkTop']
    });
    const endpointById = new Map(model.endpoints.map((endpoint) => [endpoint.id, endpoint]));

    // Then
    assert.ok(model.semanticFlows.some((flow) =>
        flow.kind === 'payload'
        && endpointById.get(flow.fromEndpointId)?.name === 'value'
        && endpointById.get(flow.toEndpointId)?.name === 'put'
        && flow.payloadType === 'Bit#(8)'
    ));
});
