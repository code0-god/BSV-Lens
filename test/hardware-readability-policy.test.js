'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { projectLabels, detailLevel, fitSelection } = require('../media/hardware-readability');

const measure = (text, size) => ({ width: [...text].length * size * 0.6, ascent: size * 0.8, descent: size * 0.2 });
function fixture() {
    const scene = { sceneKind: 'bsv', shell: { id: 'root', label: 'root', secondaryLabel: 'mkRoot' },
        children: [{ id: 'left', label: 'left' }, { id: 'right', label: 'right' }], storages: [], contacts: [], connections: [] };
    const nodes = [{ id: 'root', x: 0, y: 0, width: 1000, height: 600 },
        { id: 'left', x: 80, y: 150, width: 300, height: 250 }, { id: 'right', x: 600, y: 150, width: 300, height: 250 }];
    const geometry = { bounds: { x: 0, y: 0, width: 1000, height: 600 }, nodes, contacts: [], groups: [], routes: [],
        labels: nodes.map(n => ({ id: `${n.id}:title`, ownerId: n.id, role: 'node-title', fullText: n.id,
            text: n.id, x: n.x + 16, y: n.y + 27, anchor: 'start', bounds: { x: n.x + 14, y: n.y + 13, width: 80, height: 20 } })) };
    return { scene, geometry, viewport: { x: 10, y: 10, scale: 0.35 }, canvas: { width: 420, height: 300 },
        current: { selectedEntityId: null, selectedRelationId: null, disclosureState: {} }, level: 'overview', measure };
}
test('overview keeps distinct primary names at real screen size without changing geometry', () => {
    const input = fixture(), before = structuredClone({ scene: input.scene, geometry: input.geometry });
    const result = projectLabels(input);
    for (const id of ['root', 'left', 'right']) {
        const label = result.labels.find(l => l.ownerId === id);
        assert.equal(label.visible, true, id); assert.equal(label.text, id);
        assert.ok(label.fontSize * input.viewport.scale >= 12 - 1e-9);
        assert.ok(label.bounds.width <= input.geometry.nodes.find(n => n.id === id).width * input.viewport.scale);
    }
    assert.deepEqual({ scene: input.scene, geometry: input.geometry }, before);
});
test('long same-prefix names retain unique measured suffixes including mixed graphemes', () => {
    const input = fixture();
    input.scene.children[0].label = '긴_module_occurrence_left'; input.scene.children[1].label = '긴_module_occurrence_right';
    input.geometry.labels[1].fullText = input.scene.children[0].label;
    input.geometry.labels[2].fullText = input.scene.children[1].label;
    const result = projectLabels(input).labels.filter(l => l.ownerId !== 'root');
    assert.equal(result.every(l => l.visible), true);
    assert.notEqual(result[0].text, result[1].text);
    assert.match(result[0].text, /left$/); assert.match(result[1].text, /right$/);
});
test('detail hysteresis does not oscillate around the overview boundary', () => {
    let level = 'overview';
    for (const scale of [0.54, 0.56, 0.54, 0.56]) { level = detailLevel(scale, level); assert.equal(level, 'overview'); }
    assert.equal(detailLevel(0.7, level), 'normal');
    assert.equal(detailLevel(0.56, 'normal'), 'normal');
});
test('supplementary detail cannot intercept a module body click', () => {
    const input = fixture();
    input.geometry.labels.push({ ...input.geometry.labels[0], id: 'root:detail', role: 'node-detail', fullText: 'mkRoot' });
    const result = projectLabels(input);
    assert.equal(result.labels.find(label => label.id === 'root:detail').pointerPolicy, 'none');
    assert.equal(result.labels.find(label => label.id === 'root:title').pointerPolicy, 'canonical-owner');
});
test('compressed shell title uses reserved top space before an unconnected header route', () => {
    const input = fixture();
    input.measure = (text, size) => ({ ...measure(text, size), ascent: size * 11 / 12, descent: size / 4 });
    input.geometry.routes.push({ id: 'unconnected', unconnected: true, segments: [[16, 55, 28, 55]] });
    const before = structuredClone(input.geometry);
    const title = projectLabels(input).labels.find(label => label.id === 'root:title');
    assert.equal(title.visible, true);
    assert.ok(title.bounds.y + title.bounds.height + 2 < input.viewport.y + 55 * input.viewport.scale);
    assert.ok(title.bounds.y >= input.viewport.y + 2);
    assert.deepEqual(input.geometry, before);
});
test('selection fit reports local scope and keeps public viewport numeric', () => {
    const input = fixture(); input.current.selectedEntityId = 'left';
    const fit = fitSelection(input);
    assert.ok(fit); assert.ok(Object.values(fit.viewport).every(Number.isFinite));
    assert.ok(fit.viewport.scale >= 0.8); assert.ok(fit.ids.includes('left'));
    input.current.selectedEntityId = null; assert.equal(fitSelection(input), null);
});

test('oversized selected bodies reveal a real attachment and keep their title in the visible body', () => {
    const input = fixture(), selected = input.geometry.nodes.find(node => node.id === 'left');
    Object.assign(input.geometry.nodes[0], { width: 2600, height: 1200 });
    Object.assign(input.geometry.bounds, { width: 2600, height: 1200 });
    Object.assign(selected, { width: 2000, height: 800 });
    input.geometry.nodes.find(node => node.id === 'right').x = 2200;
    input.canvas = { width: 420, height: 180 }; input.current.selectedEntityId = selected.id;
    const attachment = { ownerId: selected.id, x: selected.x, y: selected.y + 288 };
    input.scene.connections.push({ id: 'related', endpointIds: ['root', selected.id] });
    input.geometry.routes.push({ id: 'related', attachments: [attachment], segments: [[20, attachment.y, attachment.x, attachment.y]] });
    const original = structuredClone(input.geometry), fit = fitSelection(input);
    assert.equal(fit.viewport.x + attachment.x * fit.viewport.scale, input.canvas.width / 2);
    assert.equal(fit.viewport.y + attachment.y * fit.viewport.scale, input.canvas.height / 2);
    const title = projectLabels({ ...input, viewport: fit.viewport }).labels.find(label => label.ownerId === selected.id);
    assert.equal(title.visible, true); assert.equal(title.text, 'left');
    assert.ok(title.screenFontSize >= 12); assert.equal(title.pointerPolicy, 'canonical-owner');
    assert.ok(title.bounds.x >= 2 && title.bounds.x + title.bounds.width <= input.canvas.width - 2);
    assert.ok(title.bounds.y >= 2 && title.bounds.y + title.bounds.height <= input.canvas.height - 2);
    assert.deepEqual(input.geometry, original);
});

test('child interface captions preserve the module body entry area and remain inspectable when boundary space permits', () => {
    const input = fixture(), owner = input.geometry.nodes.find(node => node.id === 'left');
    owner.width = 240;
    const point = { id: 'child-interface', ownerId: owner.id, side: 'left', boundary: false,
        x: owner.x, y: owner.y + owner.height / 2 + 8 / input.viewport.scale, slots: [] };
    input.geometry.groups.push(point);
    input.geometry.labels.push({ id: `${point.id}:label`, ownerId: point.id, role: 'interface-group',
        fullText: 'weightPort', text: 'weightPort', anchor: 'start', x: point.x + 16, y: point.y - 4,
        bounds: { x: point.x + 14, y: point.y - 18, width: 100, height: 20 } });
    const before = structuredClone(input.geometry), center = {
        x: input.viewport.x + (owner.x + owner.width / 2) * input.viewport.scale,
        y: input.viewport.y + (owner.y + owner.height / 2) * input.viewport.scale };
    const label = projectLabels(input).labels.find(label => label.ownerId === point.id);
    assert.ok(!label.visible || center.x < label.bounds.x || center.x > label.bounds.x + label.bounds.width
        || center.y < label.bounds.y || center.y > label.bounds.y + label.bounds.height);
    assert.equal(label.visible, false); assert.equal(label.reason, 'interface-boundary-space');
    assert.equal(label.fullText, 'weightPort'); assert.deepEqual(input.geometry, before);
    input.viewport.scale = 1; input.canvas = { width: 1200, height: 800 }; owner.width = 400;
    const expanded = projectLabels(input).labels.find(label => label.ownerId === point.id);
    assert.equal(expanded.visible, true); assert.equal(expanded.text, 'weightPort');
    assert.equal(expanded.pointerPolicy, 'canonical-owner');
    assert.ok(expanded.bounds.x + expanded.bounds.width <= input.viewport.x + (owner.x + owner.width / 4) * input.viewport.scale);
    const other = { ...point, id: 'other-child-interface', y: point.y + 48 };
    input.geometry.groups.push(other);
    input.geometry.labels.at(-1).fullText = 'controller_alpha_activation_interface';
    input.geometry.labels.push({ ...input.geometry.labels.at(-1), id: `${other.id}:label`, ownerId: other.id,
        fullText: 'controller_alpha_weight_interface' });
    const visible = projectLabels(input).labels.filter(label => label.role === 'interface-group' && label.visible);
    assert.equal(new Set(visible.map(label => label.text)).size, visible.length);
});

test('a selected title wider than its tiny node stays full-size in a clear owner-adjacent callout', () => {
    const input = fixture(), node = input.geometry.nodes.find(node => node.id === 'left');
    input.current.selectedEntityId = 'left'; input.viewport.scale = 0.2;
    input.scene.children[0].label = 'active'; input.geometry.labels[1].fullText = 'active';
    node.width = 150; node.height = 100;
    const original = structuredClone({ geometry: input.geometry, viewport: input.viewport, current: input.current });
    const label = projectLabels(input).labels.find(label => label.ownerId === 'left');
    assert.equal(label.visible, true); assert.equal(label.text, 'active');
    assert.ok(label.screenFontSize >= 12); assert.equal(label.reason, 'selected-title-callout');
    assert.equal(label.pointerPolicy, 'canonical-owner');
    assert.deepEqual({ geometry: input.geometry, viewport: input.viewport, current: input.current }, original);
    const box = { x: input.viewport.x + node.x * input.viewport.scale, y: input.viewport.y + node.y * input.viewport.scale,
        width: node.width * input.viewport.scale, height: node.height * input.viewport.scale };
    assert.ok(label.bounds.x + label.bounds.width <= box.x || label.bounds.x >= box.x + box.width
        || label.bounds.y + label.bounds.height <= box.y || label.bounds.y >= box.y + box.height);
    const wireY = label.bounds.y + label.bounds.height / 2;
    input.geometry.routes.push({ id: 'unrelated-wire', segments: [[
        (label.bounds.x - input.viewport.x) / input.viewport.scale, (wireY - input.viewport.y) / input.viewport.scale,
        (label.bounds.x + label.bounds.width - input.viewport.x) / input.viewport.scale, (wireY - input.viewport.y) / input.viewport.scale
    ]] });
    const clear = projectLabels(input).labels.find(label => label.ownerId === 'left');
    assert.equal(clear.visible, true); assert.equal(clear.reason, 'selected-title-callout');
    assert.ok(clear.bounds.y + clear.bounds.height < wireY || clear.bounds.y > wireY
        || clear.bounds.x + clear.bounds.width < label.bounds.x || clear.bounds.x > label.bounds.x + label.bounds.width);
    assert.deepEqual(input.viewport, original.viewport);
});
