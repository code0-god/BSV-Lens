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
test('camel-case hardware names keep a readable semantic suffix when measured space is narrow', () => {
    const input = fixture();
    input.scene.children[0].label = 'processingElements'; input.geometry.labels[1].fullText = 'processingElements';
    input.scene.children[1].label = 'processingEngines'; input.geometry.labels[2].fullText = 'processingEngines';
    const result = projectLabels(input).labels.filter(label => label.ownerId !== 'root');
    assert.equal(result[0].text, 'processingElements');
    assert.deepEqual(result[0].lines, ['processing', 'Elements']);
    assert.match(result[0].text, /Elements$/); assert.match(result[1].text, /Engines$/);
    assert.notEqual(result[0].text, result[1].text);
    assert.ok(result.every(label => label.visible && label.screenFontSize >= 9));
});
test('narrow hardware overview wraps a complete camel-case name inside its node', () => {
    const input = fixture(), node = input.geometry.nodes.find(item => item.id === 'left');
    input.viewport = { x: 0, y: 0, scale: 0.223 }; input.canvas = { width: 396, height: 264 };
    Object.assign(node, { x: 120, y: 120, width: 240, height: 156 });
    input.scene.children[0].label = 'activeWeightBankReg';
    input.geometry.labels[1].fullText = 'activeWeightBankReg';
    input.geometry.nodes.find(item => item.id === 'right').x = 1200;
    input.geometry.nodes[0].width = 1800; input.geometry.bounds.width = 1800;
    const label = projectLabels(input).labels.find(item => item.ownerId === 'left');
    assert.equal(label.visible, true); assert.equal(label.text, 'activeWeightBankReg');
    assert.deepEqual(label.lines, ['active', 'Weight', 'BankReg']);
    assert.ok(label.screenFontSize >= 9); assert.ok(label.bounds.height > label.screenFontSize * 2);
    const screenNode = { x: node.x * input.viewport.scale, y: node.y * input.viewport.scale,
        width: node.width * input.viewport.scale, height: node.height * input.viewport.scale };
    assert.ok(label.bounds.x >= screenNode.x && label.bounds.x + label.bounds.width <= screenNode.x + screenNode.width);
    assert.ok(label.bounds.y >= screenNode.y && label.bounds.y + label.bounds.height <= screenNode.y + screenNode.height);
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
test('overview exposes a clear repeated-family summary while folding ordinary detail', () => {
    const input = fixture();
    input.scene.children[0].family = { resolutionStatus: 'exact', dimensions: [{ expression: '2', status: 'concrete' }] };
    input.scene.children[0].displaySecondaryLabel = 'Reg × 2';
    input.geometry.labels.push(...['left', 'right'].map(id => ({
        id: `${id}:detail`, ownerId: id, role: 'node-detail', fullText: id === 'left' ? 'Reg × 2' : 'mkRight',
        x: input.geometry.nodes.find(node => node.id === id).x + 16,
        y: input.geometry.nodes.find(node => node.id === id).y + 47, anchor: 'start',
        bounds: { x: input.geometry.nodes.find(node => node.id === id).x + 14,
            y: input.geometry.nodes.find(node => node.id === id).y + 33, width: 80, height: 20 }
    })));
    const labels = projectLabels(input).labels;
    const family = labels.find(label => label.id === 'left:detail');
    assert.equal(family.visible, true);
    assert.equal(family.text, 'Reg × 2');
    assert.ok(family.screenFontSize >= 9);
    assert.equal(family.pointerPolicy, 'none');
    assert.equal(labels.find(label => label.id === 'right:detail').visible, false);
});
test('repeated-family summary follows a wrapped title when the node has room', () => {
    const input = fixture(), node = input.geometry.nodes.find(item => item.id === 'left');
    input.scene.children[0].label = 'activeWeightBankReg';
    input.scene.children[0].family = { resolutionStatus: 'exact', dimensions: [{ expression: '2', status: 'concrete' }] };
    input.geometry.labels[1].fullText = 'activeWeightBankReg';
    input.geometry.labels.push({ id: 'left:detail', ownerId: 'left', role: 'node-detail', fullText: 'Reg × 2',
        x: node.x + 16, y: node.y + 47, anchor: 'start',
        bounds: { x: node.x + 14, y: node.y + 33, width: 80, height: 20 } });
    const labels = projectLabels(input).labels, title = labels.find(label => label.id === 'left:title');
    const family = labels.find(label => label.id === 'left:detail');
    assert.equal(title.visible, true);
    assert.equal(family.visible, true);
    assert.ok(family.bounds.y >= title.bounds.y + title.bounds.height + 2);
});
test('narrow family summary keeps rank and certainty together', () => {
    const input = fixture(), node = input.geometry.nodes.find(item => item.id === 'left');
    node.width = 300;
    input.scene.children[0].family = { resolutionStatus: 'symbolic', dimensions: [
        { expression: 'arrayDim', status: 'symbolic' }, { expression: 'arrayDim', status: 'symbolic' }
    ] };
    input.geometry.labels.push({ id: 'left:detail', ownerId: 'left', role: 'node-detail',
        fullText: 'Module array · 2D · symbolic', x: node.x + 16, y: node.y + 47, anchor: 'start',
        bounds: { x: node.x + 14, y: node.y + 33, width: 210, height: 20 } });
    const family = projectLabels(input).labels.find(label => label.id === 'left:detail');
    assert.equal(family.visible, true);
    assert.equal(family.text, '2D · symbolic');
});
test('very narrow storage family keeps its hardware kind instead of a count alone', () => {
    const input = fixture(), node = input.geometry.nodes.find(item => item.id === 'left');
    node.width = 168;
    input.scene.children[0] = { id: 'left', label: 'bank', kind: 'storage', primitiveKind: 'memory',
        family: { resolutionStatus: 'exact', dimensions: [{ expression: '2', status: 'concrete' }] },
        multiplicity: { status: 'exact', count: 2 } };
    input.geometry.labels[1].fullText = 'bank';
    input.geometry.labels.push({ id: 'left:detail', ownerId: 'left', role: 'node-detail', fullText: 'Memory × 2',
        x: node.x + 16, y: node.y + 47, anchor: 'start',
        bounds: { x: node.x + 14, y: node.y + 33, width: 100, height: 20 } });
    const family = projectLabels(input).labels.find(label => label.id === 'left:detail');
    assert.equal(family.visible, true);
    assert.equal(family.text, 'Memory');
});
test('long node title leaves the top-right kind glyph clear', () => {
    const input = fixture(), node = input.geometry.nodes.find(item => item.id === 'left');
    input.viewport = { x: 0, y: 0, scale: 1 };
    input.canvas = { width: 1200, height: 800 };
    input.level = 'normal';
    input.scene.children[0].label = 'veryLongHardwareModuleOccurrence';
    input.geometry.labels[1].fullText = input.scene.children[0].label;
    node.width = 240;
    const title = projectLabels(input).labels.find(label => label.id === 'left:title');
    assert.equal(title.visible, true);
    assert.ok(title.bounds.x + title.bounds.width < node.x + node.width - 28);
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

test('a selected wrapped title remains visible over routes already hidden by its node body', () => {
    const input = fixture(), node = input.geometry.nodes.find(node => node.id === 'left');
    input.current.selectedEntityId = 'left'; input.viewport.scale = 0.2265625;
    input.scene.children[0].label = 'groupIndexReg'; input.geometry.labels[1].fullText = 'groupIndexReg';
    node.width = 360; node.height = 180;
    input.geometry.routes.push({ id: 'selected-route', segments: [[node.x, node.y + 80, node.x + node.width, node.y + 80]] });
    const original = structuredClone({ geometry: input.geometry, viewport: input.viewport, current: input.current });
    const label = projectLabels(input).labels.find(label => label.ownerId === 'left');
    const box = { x: input.viewport.x + node.x * input.viewport.scale, y: input.viewport.y + node.y * input.viewport.scale,
        width: node.width * input.viewport.scale, height: node.height * input.viewport.scale };
    assert.equal(label.visible, true); assert.equal(label.text, 'groupIndexReg');
    assert.equal(label.lines.join(''), 'groupIndexReg'); assert.ok(label.screenFontSize >= 12);
    assert.ok(label.bounds.x >= box.x && label.bounds.y >= box.y);
    assert.ok(label.bounds.x + label.bounds.width <= box.x + box.width);
    assert.ok(label.bounds.y + label.bounds.height <= box.y + box.height);
    assert.deepEqual({ geometry: input.geometry, viewport: input.viewport, current: input.current }, original);
});

test('a selected title uses a non-interactive overlay only when routes occupy every clear callout', () => {
    const input = fixture(), node = input.geometry.nodes.find(node => node.id === 'left');
    input.current.selectedEntityId = 'left'; input.viewport.scale = 0.2;
    input.scene.children[0].label = 'groupIndexReg'; input.geometry.labels[1].fullText = 'groupIndexReg';
    node.width = 240; node.height = 156;
    const screen = { x: input.viewport.x + node.x * input.viewport.scale,
        y: input.viewport.y + node.y * input.viewport.scale, width: node.width * input.viewport.scale,
        height: node.height * input.viewport.scale };
    for (const [id, y] of [['above', screen.y - 20], ['below', screen.y + screen.height + 10]]) {
        input.geometry.routes.push({ id, segments: [[0, (y - input.viewport.y) / input.viewport.scale,
            1000, (y - input.viewport.y) / input.viewport.scale]] });
    }
    for (const [id, x] of [['left-side', screen.x - 10], ['right-side', screen.x + screen.width + 10]]) {
        input.geometry.routes.push({ id, segments: [[(x - input.viewport.x) / input.viewport.scale, 0,
            (x - input.viewport.x) / input.viewport.scale, 1000]] });
    }
    const original = structuredClone({ geometry: input.geometry, viewport: input.viewport, current: input.current });
    const label = projectLabels(input).labels.find(label => label.ownerId === 'left');
    assert.equal(label.visible, true); assert.equal(label.text, 'groupIndexReg');
    assert.equal(label.reason, 'selected-title-overlay'); assert.equal(label.pointerPolicy, 'none');
    assert.ok(label.screenFontSize >= 12);
    assert.deepEqual({ geometry: input.geometry, viewport: input.viewport, current: input.current }, original);
});
