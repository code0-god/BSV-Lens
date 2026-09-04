'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { buildAquaSemanticModel } = require('./aqua-semantic-fixture');

const MATMUL_METHODS = [
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

test('pinned AQuA MatmulScheduler retains exact contract protocols and state behavior', () => {
    // Given
    const { model } = buildAquaSemanticModel();
    const matmul = model.instances.find((instance) =>
        instance.path === 'mkAquaLoopMatmul.matmul'
    );
    const endpointById = new Map(model.endpoints.map((endpoint) => [endpoint.id, endpoint]));

    // When
    const methods = model.endpoints.filter((endpoint) =>
        endpoint.ownerInstanceId === matmul.id
        && endpoint.kind === 'method-endpoint'
    );
    const channels = model.protocolChannels
        .filter((channel) => channel.ownerInstanceId === matmul.id)
        .sort((left, right) => left.name.localeCompare(right.name));
    const contract = model.interfaceContracts.find((item) =>
        item.moduleId === 'def:MatmulScheduler:mkMatmulScheduler'
    );
    const completeWork = model.stateBehaviors.find((behavior) =>
        behavior.ownerInstanceId === matmul.id
        && behavior.name === 'completeWork'
    );

    // Then
    assert.ok(matmul);
    assert.equal(matmul.targetDefinitionId, 'def:MatmulScheduler:mkMatmulScheduler');
    assert.deepEqual(methods.map((endpoint) => endpoint.name), MATMUL_METHODS);
    assert.equal(model.endpoints.some((endpoint) => endpoint.name === 'isValid'), false);
    assert.equal(contract.status, 'exact');
    assert.equal(contract.diagnostics.length, 0);
    assert.deepEqual(channels.map((channel) => ({
        name: channel.name,
        direction: channel.direction,
        payloadType: channel.payloadType,
        methods: Object.fromEntries(Object.entries(channel.methods).map(([role, id]) => [
            role,
            endpointById.get(id)?.name
        ]))
    })), [
        {
            name: 'Completion',
            direction: 'output-with-ack',
            payloadType: 'StripeCompletion',
            methods: {
                valid: 'completionValid',
                payload: 'completion',
                consume: 'consumeCompletion'
            }
        },
        {
            name: 'Lookahead',
            direction: 'output',
            payloadType: 'ActivationStripe',
            methods: {
                valid: 'lookaheadValid',
                payload: 'lookaheadStripe'
            }
        },
        {
            name: 'Publish',
            direction: 'input',
            payloadType: 'ActivationStripe',
            methods: {
                ready: 'publishReady',
                action: 'publishStripe'
            }
        },
        {
            name: 'Start',
            direction: 'input',
            payloadType: 'AquaMatmulDescriptor',
            methods: {
                ready: 'startReady',
                action: 'start'
            }
        },
        {
            name: 'Work',
            direction: 'output-with-ack',
            payloadType: 'ArrayWork#(arrayDim)',
            methods: {
                valid: 'workValid',
                payload: 'currentWork',
                consume: 'completeWork'
            }
        }
    ]);
    assert.ok(completeWork.reads.includes('activeDescriptor'));
    assert.ok(completeWork.writes.includes('completions'));
    assert.ok(completeWork.transitions.some((transition) =>
        transition.state === 'completions' && transition.effect === 'enqueue'
    ));
});

test('pinned AQuA WorkScheduler retains typed input fragment and completion channels', () => {
    // Given
    const { model } = buildAquaSemanticModel();
    const worker = model.instances.find((instance) =>
        instance.path === 'mkAquaLoopMatmul.fragments'
    );
    const endpointById = new Map(model.endpoints.map((endpoint) => [endpoint.id, endpoint]));

    // When
    const channels = new Map(model.protocolChannels
        .filter((channel) => channel.ownerInstanceId === worker.id)
        .map((channel) => [channel.name, channel]));

    // Then
    assert.equal(channels.get('Start').payloadType, 'ArrayWork#(arrayDim)');
    assert.equal(channels.get('Fragment').payloadType, 'KFragment');
    assert.equal(channels.get('Fragment').direction, 'output-with-ack');
    assert.deepEqual(
        Object.values(channels.get('Fragment').methods).map((id) => endpointById.get(id).name),
        ['fragmentValid', 'currentFragment', 'consumeFragment']
    );
    assert.equal(channels.get('Lookahead').payloadType, 'KFragment');
    assert.equal(channels.get('Done').direction, 'ack');
});

test('pinned AQuA exposes real Matmul to WorkScheduler typed semantic flow', () => {
    // Given
    const { model } = buildAquaSemanticModel();
    const endpointById = new Map(model.endpoints.map((endpoint) => [endpoint.id, endpoint]));

    // When
    const flow = model.semanticFlows.find((candidate) =>
        candidate.kind === 'payload'
        && endpointById.get(candidate.fromEndpointId)?.name === 'currentWork'
        && endpointById.get(candidate.toEndpointId)?.name === 'start'
        && candidate.parameterIndex === 0
    );

    // Then
    assert.ok(flow);
    assert.equal(flow.payloadType, 'ArrayWork#(arrayDim)');
    assert.equal(flow.payloadTypeStatus, 'exact');
    assert.match(flow.evidence, /matmul\.currentWork/);
    assert.match(flow.evidence, /fragments\.start/);
    assert.ok(flow.location);
});
