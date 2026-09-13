'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { findRouteCandidates } = require('../media/hardware-view');
const { loadCapturedCase } = require('../experiments/hardware/g3/query');
const { createSceneQuery } = require('../src/hardware/scene-query');
const { createArchitecture } = require('../src/hardware/architecture');

test('wire hit selection follows distance and identity, not SVG paint order or names', () => {
    const routes = [
        { id: 'scope-a/clock', label: 'CLK', segments: [[0, 0, 100, 0]] },
        { id: 'scope-b/clock', label: 'CLK', segments: [[0, 4, 100, 4]] }
    ];
    const before = JSON.stringify(routes);
    assert.deepEqual(findRouteCandidates(routes, { x: 40, y: 0 }).map(item => item.id), ['scope-a/clock']);
    assert.deepEqual(findRouteCandidates([...routes].reverse(), { x: 40, y: 4 }).map(item => item.id), ['scope-b/clock']);
    assert.deepEqual(findRouteCandidates(routes, { x: 40, y: 2 }).map(item => item.id).sort(), routes.map(item => item.id));
    assert.deepEqual(findRouteCandidates(routes, { x: 40, y: 20 }), []);
    assert.equal(JSON.stringify(routes), before);
});

test('a proper crossing offers candidates while same-net fanout stays one selection', () => {
    const fanout = { id: 'fanout', segments: [[0, 0, 100, 0], [50, 0, 50, 50]] };
    assert.deepEqual(findRouteCandidates([fanout], { x: 50, y: 0 }).map(item => item.id), ['fanout']);
    const crossing = { id: 'other', segments: [[25, -30, 25, 30]] };
    assert.deepEqual(findRouteCandidates([fanout, crossing], { x: 25, y: 0 }).map(item => item.id).sort(), ['fanout', 'other']);
});

test('simple overview keeps canonical interface inspection and visible methods without a duplicate group', async () => {
    const capture = await loadCapturedCase('A');
    const architecture = createArchitecture({ importResult: capture.request.importResult, analysis: capture.analysis });
    const query = createSceneQuery({ buildId: 'A', label: 'A', importResult: capture.request.importResult, analysis: capture.analysis });
    const entry = query.getCatalogEntry();
    const scene = query.getScene({ buildId: 'A', snapshotId: entry.snapshotId, queryGeneration: 1 }).scene;
    const group = architecture.occurrences[scene.ownerInstanceId].contacts.map(id => architecture.contacts[id])
        .find(contact => contact.category === 'Interface' && contact.interfacePath.length === 0);
    assert.ok(group, 'The actual source interface remains in canonical architecture');
    const expected = Object.values(architecture.contacts).filter(contact => contact.ownerId === group.ownerId
        && contact.category !== 'Interface' && contact.interfaceDefinitionId === group.interfaceDefinitionId);
    assert.deepEqual(expected.map(contact => contact.label).sort(), ['get', 'put']);
    assert.ok(scene.contacts.every(contact => contact.category !== 'Interface'));
    assert.ok(!scene.interfaceGroups.some(item => item.ownerId === group.ownerId), 'Visible simple methods must not duplicate an aggregate interface');
    const members = scene.contacts.filter(contact => contact.ownerId === group.ownerId);
    assert.deepEqual(members.map(contact => contact.id).sort(), expected.map(contact => contact.id).sort());
    assert.deepEqual(members.map(item => item.label).sort(), ['get', 'put']);
    assert.ok(members.every(item => item.interfaceDefinitionId === group.interfaceDefinitionId));
    assert.equal(group.interaction.kind, 'inspect');
    const selected = query.getScene({ buildId: 'A', snapshotId: entry.snapshotId, queryGeneration: 2,
        rootInstanceId: scene.rootInstanceId, ownerInstanceId: scene.ownerInstanceId, selectedEntityId: group.id }).scene;
    assert.equal(selected.ownerInstanceId, scene.ownerInstanceId);
    assert.equal(selected.rootInstanceId, scene.rootInstanceId);
    assert.deepEqual(selected.inspector.interfaceMembers.map(member => member.id).sort(), expected.map(contact => contact.id).sort());
    assert.deepEqual(selected.inspector.interfaceMembers.map(member => member.label).sort(), ['get', 'put']);
    assert.ok(selected.inspector.interfaceMembers.every(member => architecture.contacts[member.id].interfaceDefinitionId === group.interfaceDefinitionId));
});

test('displayed child contacts carry verified actual-formal incidence mappings', async () => {
    const capture = await loadCapturedCase('A');
    const query = createSceneQuery({ buildId: 'A', label: 'A', importResult: capture.request.importResult, analysis: capture.analysis });
    const entry = query.getCatalogEntry();
    const scene = query.getScene({ buildId: 'A', snapshotId: entry.snapshotId, queryGeneration: 1,
        sceneKind: 'rtl', implementationProvider: 'stock' }).scene;
    const model = capture.request.importResult.implementation;
    const projected = scene.connections.flatMap(connection => connection.incidences.flatMap(incidence =>
        incidence.members.map(member => ({ connection, incidence, member }))));
    const crossing = projected.filter(item => item.member.boundaryId);
    assert.ok(crossing.length > 0);
    for (const { connection, incidence, member } of projected) {
        assert.ok(connection.bits.includes(member.bitId));
        assert.equal(model.entities[member.endpointId].bits[member.index], member.bitId);
        if (member.boundaryId) {
            const boundary = model.boundaries[member.boundaryId];
            assert.equal(boundary.actualBitId, member.bitId);
            assert.equal(boundary.portId, incidence.contactId);
            assert.equal(boundary.pinId, member.endpointId);
            assert.equal(model.ports[incidence.contactId].bits[member.contactIndex], boundary.formalBitId);
        } else assert.equal(incidence.contactId, member.endpointId);
    }
    const vector = scene.connections.find(connection => connection.rawBits.every(bit => typeof bit === 'number'));
    const selected = query.getScene({ buildId: 'A', snapshotId: entry.snapshotId, queryGeneration: 2,
        sceneKind: 'rtl', implementationProvider: 'stock', selectedRelationId: vector.id }).scene;
    assert.equal(selected.inspector.connectivity.id, vector.id);
    assert.deepEqual(selected.inspector.connectivity.bits, vector.bits);
    assert.deepEqual(selected.inspector.connectivity.rawBits, vector.rawBits);
    assert.deepEqual(selected.inspector.connectivity.incidences, vector.incidences);
});
