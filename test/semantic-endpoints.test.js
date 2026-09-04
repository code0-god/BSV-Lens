'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
    buildFlowFixture,
    buildSemanticSource
} = require('./semantic-fixture');

test('method endpoints retain categories payloads contracts and implementation links', () => {
    // Given
    const expectedSchedulerMethods = [
        'startReady',
        'start',
        'publishReady',
        'publishStripe',
        'workValid',
        'currentWork',
        'completeWork',
        'lookaheadValid',
        'lookaheadStripe',
        'completionValid',
        'completion',
        'consumeCompletion'
    ];

    // When
    const model = buildFlowFixture();
    const scheduler = model.instances.find((instance) => instance.path === 'mkFlowTop.scheduler');
    const endpoints = model.endpoints.filter((endpoint) =>
        endpoint.ownerInstanceId === scheduler.id
        && endpoint.kind === 'method-endpoint'
    );
    const currentWork = endpoints.find((endpoint) => endpoint.name === 'currentWork');
    const start = endpoints.find((endpoint) => endpoint.name === 'start');

    // Then
    assert.deepEqual(endpoints.map((endpoint) => endpoint.name), expectedSchedulerMethods);
    assert.equal(endpoints.some((endpoint) => endpoint.name === 'isValid'), false);
    assert.deepEqual({
        category: currentWork.category,
        direction: currentWork.direction,
        resultType: currentWork.resultType,
        contractStatus: currentWork.contractStatus,
        implementationMethodId: currentWork.implementationMethodId
    }, {
        category: 'value',
        direction: 'output',
        resultType: 'ArrayWork#(arrayDim)',
        contractStatus: 'exact',
        implementationMethodId: 'def:SemanticFlowFixture:mkScheduler.currentWork'
    });
    assert.deepEqual(start.parameters, [{
        name: 'descriptor',
        type: 'AquaMatmulDescriptor'
    }]);
    assert.ok(start.evidence);
    assert.ok(start.location);
});

test('nested subinterface endpoints preserve full paths and forwarding targets', () => {
    // Given
    const source = `
package Forwarding;
interface RequestsIfc;
    method Action put(Bit#(8) value);
endinterface
interface ResponsesIfc;
    method Bool valid;
    method Bit#(8) value;
endinterface
interface ReadPortIfc;
    interface RequestsIfc requests;
    interface ResponsesIfc responses;
endinterface
interface LoadIfc;
    interface ReadPortIfc activationPort;
endinterface
interface StageIfc;
    interface ResponsesIfc activationResponses;
endinterface
interface OuterIfc;
    interface ReadPortIfc activationPort;
    interface RequestsIfc outputPort;
endinterface
module mkLoad(LoadIfc);
endmodule
module mkStage(StageIfc);
endmodule
module mkStore(OuterIfc);
endmodule
module mkMemory(OuterIfc);
    LoadIfc load <- mkLoad;
    StageIfc staging <- mkStage;
    OuterIfc store <- mkStore;
    interface ReadPortIfc activationPort;
        interface requests = load.activationPort.requests;
        interface responses = staging.activationResponses;
    endinterface
    interface outputPort = store.outputPort;
endmodule
endpackage
`;

    // When
    const model = buildSemanticSource(source, 'Forwarding.bsv', {
        entrypoints: ['mkMemory']
    });
    const memory = model.instances.find((instance) => instance.root);
    const paths = model.endpoints
        .filter((endpoint) => endpoint.ownerInstanceId === memory.id)
        .map((endpoint) => endpoint.interfacePath.join('.'));
    const forwards = model.bindings.filter((binding) =>
        binding.kind === 'interface-forward'
        && binding.ownerInstanceId === memory.id
    );

    // Then
    assert.ok(paths.includes('activationPort.requests'));
    assert.ok(paths.includes('activationPort.responses'));
    assert.ok(paths.includes('activationPort.requests.put'));
    assert.ok(paths.includes('activationPort.responses.value'));
    assert.deepEqual(forwards.map((binding) => ({
        outerPath: binding.outerPath.join('.'),
        innerPath: binding.innerPath.join('.'),
        resolutionStatus: binding.resolutionStatus
    })), [
        {
            outerPath: 'activationPort.requests',
            innerPath: 'load.activationPort.requests',
            resolutionStatus: 'exact'
        },
        {
            outerPath: 'activationPort.responses',
            innerPath: 'staging.activationResponses',
            resolutionStatus: 'exact'
        },
        {
            outerPath: 'outputPort',
            innerPath: 'store.outputPort',
            resolutionStatus: 'exact'
        }
    ]);
    assert.ok(forwards.every((binding) =>
        binding.outerEndpointId
        && binding.innerEndpointId
        && binding.analysisOrigin === 'Source-derived'
        && binding.evidence
        && binding.location
    ));
});

test('nested method implementation links require exact source signatures', () => {
    // Given
    const source = `
package NestedMismatch;
interface ChildIfc;
    method Bit#(8) value;
endinterface
interface OuterIfc;
    interface ChildIfc child;
endinterface
module mkOuter(OuterIfc);
    interface ChildIfc child;
        method Bit#(16) value = 0;
    endinterface
endmodule
endpackage
`;

    // When
    const model = buildSemanticSource(source, 'NestedMismatch.bsv', {
        entrypoints: ['mkOuter']
    });
    const endpoint = model.endpoints.find((candidate) =>
        candidate.interfacePath.join('.') === 'child.value'
    );

    // Then
    assert.equal(endpoint.contractStatus, 'mismatch');
    assert.equal(endpoint.implementationMethodId, null);
});
