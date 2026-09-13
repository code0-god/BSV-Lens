'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { projectLabels, fitSelection } = require('../media/hardware-readability');

function displayFixture() {
    const scene = { sceneKind: 'rtl', shell: { id: 'root', label: 'root' },
        children: [{ id: 'left', label: 'left' }, { id: 'right', label: 'right' }], storages: [], contacts: [], connections: [] };
    const nodes = [{ id: 'root', x: 0, y: 0, width: 1800, height: 828 },
        { id: 'left', x: 480, y: 150, width: 240, height: 276 }, { id: 'right', x: 1080, y: 150, width: 240, height: 276 }];
    const geometry = { bounds: { x: 0, y: 0, width: 1992, height: 888 }, nodes, contacts: [], groups: [], routes: [],
        labels: nodes.map(node => ({ id: `${node.id}:title`, ownerId: node.id, role: 'node-title', fullText: node.id,
            text: node.id, x: node.x + 16, y: node.y + 27, anchor: 'start', bounds: { x: node.x + 14, y: node.y + 13, width: 100, height: 20 } })) };
    return { scene, geometry, viewport: { x: 20, y: 20, scale: .15 }, canvas: { width: 396, height: 300 },
        current: { selectedEntityId: null, selectedRelationId: null, disclosureState: {} }, level: 'overview',
        measure: (text, size) => ({ width: [...text].length * size * .6, ascent: size * .8, descent: size * .2 }) };
}

test('compact overview retains full distinct module names using measured 12-to-9 title attempts', () => {
    const input = displayFixture(), before = structuredClone({ scene: input.scene, geometry: input.geometry, viewport: input.viewport });
    const result = projectLabels(input);
    const left = result.labels.find(label => label.ownerId === 'left'), right = result.labels.find(label => label.ownerId === 'right');
    assert.equal(left.visible, true); assert.equal(right.visible, true);
    assert.equal(left.text, 'left'); assert.equal(right.text, 'right');
    assert.ok(left.screenFontSize >= 12 && left.screenFontSize < 13);
    assert.ok(right.screenFontSize >= 10 && right.screenFontSize < 11);
    assert.equal(right.reason, 'overview-title-fit');
    assert.ok(result.labels.filter(label => label.visible).every(label => label.screenFontSize >= 9));
    assert.deepEqual(projectLabels(input), result);
    assert.deepEqual({ scene: input.scene, geometry: input.geometry, viewport: input.viewport }, before);
});

test('selected and detail primary titles never use the overview font fallback', () => {
    const input = displayFixture(); input.current.selectedEntityId = 'right';
    const selected = projectLabels(input).labels.find(label => label.ownerId === 'right');
    assert.ok(selected.screenFontSize >= 12); assert.equal(selected.visible, true);
    assert.equal(selected.text, 'right'); assert.equal(selected.reason, 'selected-title-callout');
    const fit = fitSelection(input), detailed = projectLabels({ ...input, viewport: fit.viewport, level: 'normal' });
    const title = detailed.labels.find(label => label.ownerId === 'right');
    assert.equal(title.visible, true); assert.ok(title.screenFontSize >= 12);
    input.current.selectedEntityId = null;
    const normal = projectLabels({ ...input, level: 'normal' }).labels.find(label => label.ownerId === 'right');
    assert.ok(normal.screenFontSize >= 12); assert.equal(normal.visible, false);
});

test('RTL overview occurrence names use bounded callouts when tiny bodies cannot fit their names', () => {
    const input = displayFixture();
    input.scene.children.forEach(child => { child.kind = 'rtl-occurrence'; });
    input.viewport.scale = .08533333333333333; input.canvas = { width: 264, height: 188 };
    const before = structuredClone({ scene: input.scene, geometry: input.geometry, current: input.current, viewport: input.viewport });
    const labels = projectLabels(input).labels;
    for (const id of ['root', 'left', 'right']) {
        const label = labels.find(label => label.ownerId === id);
        assert.equal(label.visible, true, id); assert.equal(label.text, id); assert.ok(label.screenFontSize >= 9);
        if (id !== 'root') assert.equal(label.reason, 'overview-title-callout');
    }
    const displayed = labels.filter(label => label.visible);
    for (let i = 0; i < displayed.length; i++) for (let j = i + 1; j < displayed.length; j++) {
        const a = displayed[i].bounds, b = displayed[j].bounds;
        assert.ok(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y);
    }
    assert.deepEqual({ scene: input.scene, geometry: input.geometry, current: input.current, viewport: input.viewport }, before);
});

test('overview names use bounded owner space when a header dash blocks the normal title anchor', () => {
    const input = displayFixture();
    input.scene.shell.label = 'connectedRoot'; input.geometry.labels[0].fullText = 'connectedRoot';
    input.viewport.scale = .142;
    input.geometry.routes.push({ id: 'header-dash', segments: [[10, 70, 90, 70], [220, 70, 300, 70]] });
    const before = structuredClone(input.geometry), labels = projectLabels(input).labels;
    const root = labels.find(label => label.ownerId === 'root'), right = labels.find(label => label.ownerId === 'right');
    assert.equal(root.visible, true); assert.equal(root.text, 'connectedRoot');
    assert.ok(root.bounds.x > input.viewport.x + input.geometry.nodes[0].width * input.viewport.scale / 2);
    assert.equal(right.visible, true); assert.equal(right.text, 'right'); assert.ok(right.screenFontSize >= 9);
    assert.deepEqual(input.geometry, before);
});

test('every smaller overview title still rejects wire clearance and never changes topology', () => {
    const input = displayFixture();
    input.geometry.routes.push({ id: 'unrelated-wire', segments: [[1080, 150 + 7 / .15, 1320, 150 + 7 / .15]] });
    const before = structuredClone(input.geometry), right = projectLabels(input).labels.find(label => label.ownerId === 'right');
    assert.equal(right.visible, false); assert.equal(right.reason, 'label-clearance');
    assert.ok(right.screenFontSize >= 9); assert.deepEqual(input.geometry, before);
});

test('preferred RTL provider survives resize without changing actual provider, querying or adding visits', async () => {
    const { createNavigation, visitKey } = require('../media/hardware-navigation');
    const { stateValue } = require('../src/panel/hardware-state');
    let size = { width: 396, height: 480 }, calls = 0, pending;
    const scene = request => ({ id: 'scene', buildId: 'build', snapshotId: 'snapshot', sceneKind: 'bsv', provider: 'stock',
        sourceRevision: 'revision', ownerInstanceId: 'root', rootInstanceId: 'root', occurrencePath: ['root'], breadcrumb: [],
        shell: { id: 'root' }, children: [], storages: [], contacts: [], connections: [], disclosureState: request.disclosureState,
        selection: { selectedEntityId: request.selectedEntityId, selectedRelationId: null } });
    const nav = createNavigation({ getSize: () => size,
        layoutScene: () => ({ bounds: { x: 0, y: 0, width: 800, height: 600 }, nodes: [{ id: 'root', x: 10, y: 10, width: 400, height: 300 }], contacts: [], routes: [] }),
        fitViewport: () => ({ x: 20, y: 20, scale: .5 }), queryScene: (request, { signal }) => {
            calls++; const response = { scene: scene(request), requestSnapshotId: request.snapshotId, queryGeneration: request.queryGeneration };
            return calls === 1 ? response : new Promise(resolve => { pending = { signal, resolve: () => resolve(response) }; });
        } });
    await nav.navigate({ buildId: 'build', snapshotId: 'snapshot', sceneKind: 'bsv', ownerInstanceId: 'root', implementationProvider: 'stock' });
    const key = visitKey(nav.getState().current), presentation = { preferredImplementationProvider: 'instrumented', inspectorOpen: true };
    nav.patchCurrent({ disclosureState: { presentation } }); size = { width: 396, height: 620 }; nav.resize();
    assert.equal(calls, 1); assert.equal(nav.getState().history.back.length, 0); assert.equal(visitKey(nav.getState().current), key);
    assert.equal(nav.getState().current.provider, 'stock'); assert.equal(nav.getState().current.disclosureState.presentation.preferredImplementationProvider, 'instrumented');
    const request = nav.navigate({ selectedEntityId: 'root' });
    nav.patchCurrent({ disclosureState: { presentation: { ...presentation, preferredImplementationProvider: 'stock' },
        analysis: { codeScroll: { 'writer:reference': { top: 42, left: 8 } } } } });
    assert.equal(pending.signal.aborted, false); pending.resolve(); await request;
    const saved = { schema: 1, view: { sceneKind: 'bsv', provider: 'stock', disclosureState: { presentation } } };
    assert.equal(stateValue(saved).view.disclosureState.presentation.preferredImplementationProvider, 'instrumented');
    saved.view.disclosureState.presentation.preferredImplementationProvider = 'foreign';
    assert.throws(() => stateValue(saved), { code: 'INVALID_INPUT' });
});

test('native saved code scroll preserves renderer-shaped positions and rejects malformed entries', () => {
    const { stateValue } = require('../src/panel/hardware-state');
    const codeScroll = { 'writer:reference': { top: 35.5, left: 12 }, 'approved:source-reference': { top: 0, left: 0 } };
    const state = map => ({ schema: 1, view: { sceneKind: 'bsv', provider: 'stock', disclosureState: { analysis: { codeScroll: map } } } });
    const checked = stateValue(state(codeScroll)).view.disclosureState.analysis.codeScroll;
    assert.equal(Object.getPrototypeOf(checked), null);
    assert.deepEqual(JSON.parse(JSON.stringify(checked)), codeScroll);
    for (const invalid of [12, { top: -1, left: 0 }, { top: 0, left: Infinity }, { top: 0 },
        { top: 0, left: 0, path: '/outside' }, { top: 1e10, left: 0 }]) {
        assert.throws(() => stateValue(state({ reference: invalid })), { code: 'INVALID_INPUT' });
    }
    assert.throws(() => stateValue(state(Object.fromEntries(Array.from({ length: 129 }, (_, index) => [String(index), { top: 0, left: 0 }])))), { code: 'LIMIT_EXCEEDED' });
});
