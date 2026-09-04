'use strict';

const assert = require('node:assert/strict');

function assertAquaSemanticArchitecture(model) {
    assert.equal(model.schemaVersion, 3);
    for (const field of [
        'definitions',
        'instances',
        'endpoints',
        'bindings',
        'protocolChannels',
        'semanticFlows',
        'stateBehaviors',
        'scheduleRelations',
        'interfaceContracts',
        'semanticDiagnostics'
    ]) assert.ok(Array.isArray(model[field]), field);

    const memory = model.instances.find((instance) =>
        instance.path === 'mkAquaMemorySubsystem'
    );
    assert.ok(memory);
    assert.deepEqual(model.instances
        .filter((instance) => instance.parentInstanceId === memory.id)
        .map((instance) => instance.name), [
        'load',
        'staging',
        'accumulators',
        'store'
    ]);

    const instanceById = new Map(model.instances.map((instance) => [instance.id, instance]));
    assert.ok(model.bindings.some((binding) =>
        binding.kind === 'constructor-binding'
        && instanceById.get(binding.sourceInstanceId)?.name === 'load'
        && instanceById.get(binding.targetInstanceId)?.name === 'staging'
    ));
    assert.ok(model.bindings.some((binding) =>
        binding.kind === 'constructor-binding'
        && instanceById.get(binding.sourceInstanceId)?.name === 'accumulators'
        && instanceById.get(binding.targetInstanceId)?.name === 'store'
    ));

    for (const [outer, inner] of [
        ['activationPort.requests', 'load.activationPort.requests'],
        ['activationPort.responses', 'staging.activationResponses'],
        ['outputPort', 'store.outputPort'],
        ['activationBanks', 'staging.activationBanks'],
        ['accumulator', 'accumulators']
    ]) assert.ok(model.bindings.some((binding) =>
        binding.kind === 'interface-forward'
        && binding.outerPath.join('.') === outer
        && binding.innerPath.join('.') === inner
        && binding.resolutionStatus === 'exact'
    ), `${outer} forwards to ${inner}`);

    const endpointById = new Map(model.endpoints.map((endpoint) => [endpoint.id, endpoint]));
    assert.ok(model.semanticFlows.some((flow) =>
        flow.kind === 'payload'
        && endpointById.get(flow.fromEndpointId)?.name === 'currentWork'
        && endpointById.get(flow.toEndpointId)?.name === 'start'
        && flow.payloadType === 'ArrayWork#(arrayDim)'
        && flow.parameterIndex === 0
    ));
    assert.ok(model.protocolChannels.some((channel) =>
        channel.name === 'Work'
        && channel.payloadType === 'ArrayWork#(arrayDim)'
    ));
    assert.ok(model.stateBehaviors.some((behavior) =>
        behavior.name === 'completeWork'
        && behavior.writes.includes('completions')
    ));
    assert.ok(model.architectureRoots.length > 0);
    assert.equal(JSON.stringify(model).includes('"semanticIndexes"'), false);
}

module.exports = {
    assertAquaSemanticArchitecture
};
