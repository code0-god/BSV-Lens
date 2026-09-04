'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
    buildFlowFixture,
    buildSemanticSource
} = require('./semantic-fixture');

function methodNames(channel, endpointById) {
    return Object.fromEntries(
        Object.entries(channel.methods)
            .filter(([, endpointId]) => endpointId)
            .map(([role, endpointId]) => [role, endpointById.get(endpointId)?.name])
    );
}

test('MatmulScheduler methods form five source-derived protocol channels', () => {
    // Given
    const model = buildFlowFixture();
    const scheduler = model.instances.find((instance) => instance.path === 'mkFlowTop.scheduler');
    const endpointById = new Map(model.endpoints.map((endpoint) => [endpoint.id, endpoint]));

    // When
    const channels = model.protocolChannels
        .filter((channel) => channel.ownerInstanceId === scheduler.id)
        .sort((left, right) => left.name.localeCompare(right.name));

    // Then
    assert.deepEqual(channels.map((channel) => ({
        name: channel.name,
        direction: channel.direction,
        payloadType: channel.payloadType,
        methods: methodNames(channel, endpointById),
        inferenceOrigin: channel.inferenceOrigin,
        confidence: channel.confidence
    })), [
        {
            name: 'Completion',
            direction: 'output-with-ack',
            payloadType: 'StripeCompletion',
            methods: {
                valid: 'completionValid',
                payload: 'completion',
                consume: 'consumeCompletion'
            },
            inferenceOrigin: 'source-derived',
            confidence: 'source-derived'
        },
        {
            name: 'Lookahead',
            direction: 'output',
            payloadType: 'ActivationStripe',
            methods: {
                valid: 'lookaheadValid',
                payload: 'lookaheadStripe'
            },
            inferenceOrigin: 'source-derived',
            confidence: 'source-derived'
        },
        {
            name: 'Publish',
            direction: 'input',
            payloadType: 'ActivationStripe',
            methods: {
                ready: 'publishReady',
                action: 'publishStripe'
            },
            inferenceOrigin: 'source-derived',
            confidence: 'source-derived'
        },
        {
            name: 'Start',
            direction: 'input',
            payloadType: 'AquaMatmulDescriptor',
            methods: {
                ready: 'startReady',
                action: 'start'
            },
            inferenceOrigin: 'source-derived',
            confidence: 'source-derived'
        },
        {
            name: 'Work',
            direction: 'output-with-ack',
            payloadType: 'ArrayWork#(arrayDim)',
            methods: {
                valid: 'workValid',
                payload: 'currentWork',
                consume: 'completeWork'
            },
            inferenceOrigin: 'source-derived',
            confidence: 'source-derived'
        }
    ]);
});

test('WorkScheduler channels preserve input fragment lookahead and done semantics', () => {
    // Given
    const model = buildFlowFixture();
    const worker = model.instances.find((instance) => instance.path === 'mkFlowTop.worker');
    const endpointById = new Map(model.endpoints.map((endpoint) => [endpoint.id, endpoint]));

    // When
    const channels = model.protocolChannels
        .filter((channel) => channel.ownerInstanceId === worker.id)
        .sort((left, right) => left.name.localeCompare(right.name));

    // Then
    assert.deepEqual(channels.map((channel) => ({
        name: channel.name,
        direction: channel.direction,
        payloadType: channel.payloadType,
        methods: methodNames(channel, endpointById)
    })), [
        {
            name: 'Done',
            direction: 'ack',
            payloadType: null,
            methods: { valid: 'doneValid', consume: 'consumeDone' }
        },
        {
            name: 'Fragment',
            direction: 'output-with-ack',
            payloadType: 'KFragment',
            methods: {
                valid: 'fragmentValid',
                payload: 'currentFragment',
                consume: 'consumeFragment'
            }
        },
        {
            name: 'Lookahead',
            direction: 'output',
            payloadType: 'KFragment',
            methods: {
                valid: 'lookaheadValid',
                payload: 'lookaheadFragment'
            }
        },
        {
            name: 'Start',
            direction: 'input',
            payloadType: 'ArrayWork#(arrayDim)',
            methods: { ready: 'startReady', action: 'start' }
        }
    ]);
});

test('method names alone never force an ambiguous protocol channel', () => {
    // Given
    const source = `
package AmbiguousProtocol;
interface OddIfc;
    method Bool ready;
    method Bool valid;
    method Action consume;
endinterface
module mkOdd(OddIfc);
    method Bool ready = True;
    method Bool valid = True;
    method Action consume;
        noAction;
    endmethod
endmodule
endpackage
`;

    // When
    const model = buildSemanticSource(source, 'AmbiguousProtocol.bsv', {
        entrypoints: ['mkOdd']
    });

    // Then
    assert.deepEqual(model.protocolChannels, []);
    assert.ok(model.endpoints
        .filter((endpoint) => endpoint.kind === 'method-endpoint')
        .every((endpoint) => endpoint.contractStatus === 'exact'));
});

test('exact requests and responses subinterfaces form one request-response channel', () => {
    // Given
    const source = `
package RequestResponse;
interface RequestsIfc;
    method Action put(Bit#(8) request);
endinterface
interface ResponsesIfc;
    method Bool valid;
    method Bit#(16) response;
endinterface
interface PortIfc;
    interface RequestsIfc requests;
    interface ResponsesIfc responses;
endinterface
module mkPort(PortIfc);
endmodule
endpackage
`;

    // When
    const model = buildSemanticSource(source, 'RequestResponse.bsv', {
        entrypoints: ['mkPort']
    });
    const endpointById = new Map(model.endpoints.map((endpoint) => [endpoint.id, endpoint]));
    const channel = model.protocolChannels[0];

    // Then
    assert.equal(model.protocolChannels.length, 1);
    assert.equal(channel.name, 'Port');
    assert.equal(channel.direction, 'request-response');
    assert.equal(channel.payloadType, null);
    assert.equal(endpointById.get(channel.methods.request).interfacePath.join('.'), 'requests');
    assert.equal(endpointById.get(channel.methods.response).interfacePath.join('.'), 'responses');
    assert.equal(channel.inferenceOrigin, 'source-derived');
    assert.equal(channel.confidence, 'source-derived');
});
