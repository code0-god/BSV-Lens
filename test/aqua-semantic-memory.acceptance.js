'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { buildAquaSemanticModel } = require('./aqua-semantic-fixture');

test('pinned AquaMemorySubsystem expands exact source-derived child hierarchy', () => {
    // Given
    const { fixture, model } = buildAquaSemanticModel();
    const memory = model.instances.find((instance) =>
        instance.path === 'mkAquaMemorySubsystem'
    );

    // When
    const children = model.instances
        .filter((instance) => instance.parentInstanceId === memory.id)
        .map((instance) => ({
            name: instance.name,
            targetDefinitionId: instance.targetDefinitionId,
            path: instance.path,
            resolution: instance.targetResolutionStatus
        }));

    // Then
    assert.equal(fixture.revision, '6692a52973fbb487a421b07fc8cd881d0542e964');
    assert.deepEqual(children, [
        {
            name: 'load',
            targetDefinitionId: 'def:LoadController:mkLoadController',
            path: 'mkAquaMemorySubsystem.load',
            resolution: 'exact'
        },
        {
            name: 'staging',
            targetDefinitionId: 'def:LoadStager:mkLoadStager',
            path: 'mkAquaMemorySubsystem.staging',
            resolution: 'exact'
        },
        {
            name: 'accumulators',
            targetDefinitionId: 'def:AccumulatorMem:mkAccumulatorMem',
            path: 'mkAquaMemorySubsystem.accumulators',
            resolution: 'exact'
        },
        {
            name: 'store',
            targetDefinitionId: 'def:StoreController:mkStoreController',
            path: 'mkAquaMemorySubsystem.store',
            resolution: 'exact'
        }
    ]);
});

test('pinned AquaMemorySubsystem resolves structural constructor bindings only', () => {
    // Given
    const { model } = buildAquaSemanticModel();
    const memory = model.instances.find((instance) =>
        instance.path === 'mkAquaMemorySubsystem'
    );
    const instanceById = new Map(model.instances.map((instance) => [instance.id, instance]));

    // When
    const bindings = model.bindings
        .filter((binding) =>
            binding.kind === 'constructor-binding'
            && instanceById.get(binding.targetInstanceId)?.parentInstanceId === memory.id
        )
        .map((binding) => ({
            source: instanceById.get(binding.sourceInstanceId).name,
            target: instanceById.get(binding.targetInstanceId).name,
            formal: binding.formalParameter.name,
            actual: binding.actualExpression,
            status: binding.resolutionStatus
        }));

    // Then
    assert.deepEqual(bindings, [
        {
            source: 'load',
            target: 'staging',
            formal: 'load',
            actual: 'load',
            status: 'exact'
        },
        {
            source: 'accumulators',
            target: 'store',
            formal: 'accumulator',
            actual: 'accumulators',
            status: 'exact'
        }
    ]);
});

test('pinned AquaMemorySubsystem resolves required nested interface forwarding paths', () => {
    // Given
    const { model } = buildAquaSemanticModel();
    const memory = model.instances.find((instance) =>
        instance.path === 'mkAquaMemorySubsystem'
    );

    // When
    const forwards = model.bindings
        .filter((binding) =>
            binding.kind === 'interface-forward'
            && binding.ownerInstanceId === memory.id
            && binding.resolutionStatus === 'exact'
        )
        .map((binding) => [
            binding.outerPath.join('.'),
            binding.innerPath.join('.')
        ]);

    // Then
    for (const expected of [
        ['activationPort.requests', 'load.activationPort.requests'],
        ['activationPort.responses', 'staging.activationResponses'],
        ['outputPort', 'store.outputPort'],
        ['activationBanks', 'staging.activationBanks'],
        ['accumulator', 'accumulators']
    ]) assert.ok(forwards.some((binding) =>
        binding[0] === expected[0] && binding[1] === expected[1]
    ), `${expected[0]} forwards to ${expected[1]}`);
});
