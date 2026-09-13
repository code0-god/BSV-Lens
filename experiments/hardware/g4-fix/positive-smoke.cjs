'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const root = path.resolve(process.env.G4_REVIEW_ROOT || path.join(__dirname, '../../..'));
const { createCatalog } = require(path.join(root, 'experiments/hardware/g4/server.js'));
const { createNavigation } = require(path.join(root, 'media/hardware-navigation.js'));
const { layout, fitViewport } = require(path.join(root, 'media/hardware-layout.js'));
const size = { width: 1100, height: 650 };

(async () => {
    const query = (await createCatalog()).find(item => item.getCatalogEntry().buildId === 'A');
    const entry = query.getCatalogEntry();
    const navigation = createNavigation({ queryScene: async intent => query.getScene(intent),
        layoutScene: layout, getSize: () => size, fitViewport });
    assert.equal(await navigation.navigate({ ...entry, sceneKind: 'bsv', ownerInstanceId: entry.rootInstanceId }), true);
    const left = navigation.getState().scene.children.find(item => item.label === 'left');
    assert.equal(await navigation.navigate({ rootInstanceId: left.id, ownerInstanceId: left.id }), true);
    const storage = navigation.getState().scene.storages.find(item => item.label === 'state');
    await navigation.select(storage.id);
    navigation.patchCurrent({ disclosureState: { capabilities: true } });
    navigation.setViewport({ x: 35, y: 47, scale: 1.15 });
    const before = navigation.getState();
    assert.equal(await navigation.navigate({ sceneKind: 'rtl', implementationProvider: 'instrumented',
        selectedEntityId: storage.id }), true);
    navigation.setViewport(fitViewport(navigation.getState().geometry, size));
    assert.equal(navigation.back(), true);
    const after = navigation.getState();
    assert.deepEqual(after.current, before.current);
    assert.deepEqual(after.scene, before.scene);
    assert.deepEqual(after.geometry, before.geometry);
    console.log(JSON.stringify({ status: 'pass', sceneKind: after.current.sceneKind,
        ownerInstanceId: after.current.ownerInstanceId, selection: after.current.selectedEntityId,
        viewport: after.current.viewport, disclosure: after.current.disclosureState,
        sourceContext: after.current.sourceContext, implementationContext: after.current.implementationContext }, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; });
