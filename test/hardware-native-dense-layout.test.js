'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { layout } = require('../media/hardware-layout');
const { projectLabels } = require('../media/hardware-readability');
const { validateGeometry } = require('../experiments/hardware/g4-fix/oracle/geometry.cjs');

function fixture() {
    const scene = { sceneKind: 'bsv', shell: { id: 'root', label: 'root' },
        children: ['left', 'right'].map(id => ({ id, label: id })), storages: [], contacts: [], interfaceGroups: [],
        connections: [{ id: 'relation', label: 'Full dependency name', endpointIds: ['left', 'right'],
            incidences: ['left', 'right'].map(contactId => ({ contactId, members: [] })), members: [], style: 'semantic',
            bits: [], rawBits: [], memberRelationIds: [] }] };
    const geometry = layout(scene, { width: 900, height: 600 }), route = geometry.routes[0];
    const label = geometry.labels.find(row => row.ownerId === route.id), anchor = route.attachments[0];
    Object.assign(label, { x: anchor.x, y: anchor.y, anchor: 'start', bounds: null, text: scene.connections[0].label,
        fullText: scene.connections[0].label, foldedReason: 'no-label-clearance' });
    delete label.textWidth;
    Object.assign(route, { label, labelBounds: null, labelX: label.x, labelY: label.y, labelAnchor: label.anchor });
    return { scene, geometry, label, route };
}

test('explicit folded supplementary connection preserves canonical name, route and a real attachment anchor', () => {
    const value = fixture(), before = JSON.stringify(value.scene);
    assert.equal(validateGeometry(value.scene, value.geometry).valid, true);
    for (const scale of [.2, 1, 2]) {
        const projection = projectLabels({ ...value, viewport: { x: 0, y: 0, scale }, canvas: { width: 1200, height: 900 },
            current: { selectedEntityId: null, selectedRelationId: value.route.id, disclosureState: {} }, level: 'detail',
            measure: (text, size) => ({ width: text.length * size * .6, ascent: size * .8, descent: size * .2 }) });
        const label = projection.labels.find(row => row.ownerId === value.route.id);
        assert.equal(label.visible, false); assert.equal(label.reason, 'no-label-clearance'); assert.equal(label.bounds, null);
        assert.equal(label.fullText, value.scene.connections[0].label); assert.equal(label.pointerPolicy, 'none');
    }
    assert.equal(JSON.stringify(value.scene), before); assert.equal(value.geometry.routes.length, value.scene.connections.length);
});

test('folded label oracle rejects primary labels, fake bounds, foreign owners, changed names and unanchored coordinates', () => {
    for (const mutate of [
        f => { f.label.role = 'node-title'; }, f => { f.label.ownerId = 'root'; },
        f => { f.label.fullText = 'wrong name'; }, f => { f.label.text = 'wrong name'; },
        f => { f.label.bounds = { x: 0, y: 0, width: 1, height: 1 }; },
        f => { f.label.foldedReason = 'unverified-reason'; }, f => { f.label.x += 1; },
        f => { f.geometry.labels = f.geometry.labels.filter(row => row !== f.label); },
        f => { f.geometry.routes = []; }, f => { f.route.labelX += 1; },
        f => { f.geometry.labels.push({ ...f.label }); }
    ]) {
        const value = fixture(); mutate(value);
        assert.equal(validateGeometry(value.scene, value.geometry).valid, false);
    }
});

test('actual workspace memory root routes survive exhausted supplementary label pockets',
    { skip: !process.env.G6_DENSE_SCENE && 'External actual-workspace scene is supplied in the G6 workspace lane' }, () => {
        const bytes = fs.readFileSync(process.env.G6_DENSE_SCENE), scene = JSON.parse(bytes), original = JSON.stringify(scene);
        assert.equal(scene.shell.label, 'mkAquaMemorySubsystem'); assert.equal(scene.connections.length, 27);
        for (const size of [{ width: 512, height: 466 }, { width: 1140, height: 677 }]) {
            const geometry = layout(scene, size), report = validateGeometry(scene, geometry);
            assert.equal(report.valid, true, JSON.stringify(report.findings));
            assert.ok(geometry.labels.some(label => label.foldedReason === 'no-label-clearance'));
            assert.equal(geometry.routes.length, 27); assert.equal(geometry.nodes.length, 5);
            assert.equal(geometry.contacts.length, scene.contacts.length);
            assert.deepEqual(layout(scene, size), geometry); assert.equal(JSON.stringify(scene), original);
        }
        assert.deepEqual(fs.readFileSync(process.env.G6_DENSE_SCENE), bytes);
    });
