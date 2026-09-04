'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { buildFlowFixture } = require('./semantic-fixture');
const { buildSemanticIndexes } = require('../src/architecture/semantic/indexes');

test('semantic indexes expose definitions instances endpoints bindings flows and channels', () => {
    // Given
    const model = buildFlowFixture();

    // When
    const indexes = buildSemanticIndexes(model);
    const scheduler = model.instances.find((instance) => instance.path === 'mkFlowTop.scheduler');

    // Then
    assert.equal(indexes.definitionById.size, model.definitions.length);
    assert.equal(indexes.instanceById.size, model.instances.length);
    assert.equal(indexes.endpointById.size, model.endpoints.length);
    assert.equal(indexes.bindingById.size, model.bindings.length);
    assert.equal(indexes.channelById.size, model.protocolChannels.length);
    assert.equal(indexes.flowById.size, model.semanticFlows.length);
    assert.ok(indexes.instancesByDefinition.get('def:SemanticFlowFixture:mkScheduler')
        .some((instance) => instance.id === scheduler.id));
    assert.ok(indexes.childrenByInstance.get(scheduler.parentInstanceId)
        .some((instance) => instance.id === scheduler.id));
    assert.ok(indexes.endpointsByInstance.get(scheduler.id).length > 0);
    assert.ok(indexes.channelsByInstance.get(scheduler.id).length > 0);
});

test('semantic model owns one prebuilt non-serialized index set', () => {
    // Given
    const model = buildFlowFixture();

    // When
    const descriptor = Object.getOwnPropertyDescriptor(model, 'indexes');
    const serialized = JSON.stringify(model);

    // Then
    assert.equal(descriptor.enumerable, false);
    assert.equal(model.indexes.definitionById.size, model.definitions.length);
    assert.equal(serialized.includes('"indexes"'), false);
});
