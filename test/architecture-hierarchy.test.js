'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const Graph = require('../media/graph-view');
const Layout = require('../media/webview-layout');

function fixture() {
    const nodes = [
        { id: 'root-a', kind: 'instance', name: 'Root A', label: 'Root A', architectureInstance: true, details: { root: true } },
        { id: 'a-child', kind: 'instance', name: 'A child', label: 'A child', architectureInstance: true, parentId: 'root-a', details: {} },
        { id: 'a-grandchild', kind: 'instance', name: 'A grandchild', label: 'A grandchild', architectureInstance: true, parentId: 'a-child', details: {} },
        { id: 'root-b', kind: 'instance', name: 'Root B', label: 'Root B', architectureInstance: true, details: { root: true } }
    ];
    const edges = [
        { id: 'hierarchy-a', source: 'root-a', target: 'a-child', kind: 'instance-child', mode: 'structure' },
        { id: 'hierarchy-b', source: 'a-child', target: 'a-grandchild', kind: 'instance-child', mode: 'structure' },
        { id: 'constructor', source: 'a-grandchild', target: 'root-b', kind: 'constructor-binding', mode: 'data-flow' }
    ];
    return {
        nodes,
        edges,
        architectureRoots: ['root-a', 'root-b'],
        semanticRoots: [
            { instanceId: 'root-a', reason: 'configured' },
            { instanceId: 'root-b', reason: 'uninstantiated' }
        ],
        activeFile: null
    };
}

function view(model = fixture(), state = {}) {
    return Graph.createViewModel(model, {
        sourceScope: 'workspace', level: 'system', analysisMode: 'structure', hopScope: 'all',
        filters: { packages: false, imports: false, rules: true, primitives: true },
        ...state
    });
}

function inside(inner, outer) {
    return inner.x >= outer.x && inner.y >= outer.y
        && inner.x + inner.width <= outer.x + outer.width
        && inner.y + inner.height <= outer.y + outer.height;
}

function overlap(a, b) {
    return a.x < b.x + b.width && a.x + a.width > b.x
        && a.y < b.y + b.height && a.y + a.height > b.y;
}

test('System flow ranks remain packed inside their independent root boundaries', () => {
    const vm = view();
    const { nodes, topology } = vm.visible();
    const edges = [{ id: 'flow', source: 'root-a', target: 'a-child', kind: 'payload', mode: 'data-flow' }];
    const layout = Layout.layoutGraph(nodes, edges, [], {
        level: 'system', analysisMode: 'data-flow', direction: 'LR', topology
    });
    assert.equal(layout.groups.filter((group) => group.kind === 'root-boundary').length, 2);
    for (const group of layout.groups) {
        for (const id of group.nodeIds) assert.ok(inside(layout.positions.get(id), group), id);
    }
});

test('secondary source nodes retain positions outside the hardware forest', () => {
    const vm = view();
    const { nodes, edges, topology } = vm.visible();
    const source = { id: 'source-package', kind: 'package', name: 'Sources', label: 'Sources' };
    const layout = Layout.layoutGraph([...nodes, source], edges, [], {
        level: 'system', analysisMode: 'structure', direction: 'LR', topology
    });
    assert.ok(layout.positions.has(source.id));
    const sourceGroup = layout.groups.find((group) => group.kind === 'source-map');
    assert.ok(sourceGroup);
    assert.ok(inside(layout.positions.get(source.id), sourceGroup));
    for (const group of layout.groups.filter((item) => item.kind === 'root-boundary')) {
        assert.equal(overlap(sourceGroup, group), false);
    }
});

test('GraphViewModel exposes neutral semantic topology and hierarchy focus paths', () => {
    const vm = view();
    const visible = vm.visible();

    assert.deepEqual(visible.topology.roots.map((root) => root.id), ['root-a', 'root-b']);
    assert.equal(visible.topology.parentById.get('a-child'), 'root-a');
    assert.equal(visible.topology.parentById.get('a-grandchild'), 'a-child');
    assert.equal(visible.topology.rootById.get('a-grandchild'), 'root-a');
    assert.equal(visible.topology.rootById.get('root-b'), 'root-b');
    assert.deepEqual(vm.focusPath('a-grandchild'), ['root-a', 'a-child', 'a-grandchild']);
    assert.equal(vm.rootFor('a-grandchild').id, 'root-a');
    assert.ok(visible.nodes.some((node) => node.id === 'root-b'), 'isolated root stays visible');
    assert.equal(visible.topology.parentById.has('root-b'), false, 'constructor relation is not hierarchy');
});

test('focused Component is confined to its semantic root while no focus includes all roots', () => {
    const vm = view();
    assert.deepEqual(vm.visible().topology.roots.map((root) => root.id), ['root-a', 'root-b']);

    const focused = vm.visible({ focusId: 'a-child' });
    assert.deepEqual(focused.nodes.map((node) => node.id).sort(), ['a-child', 'a-grandchild', 'root-a']);
    assert.deepEqual(focused.topology.roots.map((root) => root.id), ['root-a']);
});

test('System Structure forest boundaries contain each LR and TB hierarchy without overlap', () => {
    const visible = view().visible();
    for (const direction of ['LR', 'TB']) {
        const layout = Layout.layoutGraph(visible.nodes, visible.edges, [], {
            level: 'system', analysisMode: 'structure', direction,
            focusId: null, viewportWidth: 1200, topology: visible.topology,
            layoutModuleHierarchy() { assert.fail('module layout should not run'); }
        });
        const boundaries = layout.groups.filter((group) => group.kind === 'root-boundary');
        assert.equal(boundaries.length, 2);
        assert.equal(overlap(boundaries[0], boundaries[1]), false);
        for (const boundary of boundaries) {
            for (const nodeId of boundary.nodeIds) {
                assert.ok(inside(layout.positions.get(nodeId), boundary), `${nodeId} outside ${boundary.id}`);
            }
        }
        const root = layout.positions.get('root-a');
        const child = layout.positions.get('a-child');
        const grandchild = layout.positions.get('a-grandchild');
        const primary = direction === 'LR' ? 'x' : 'y';
        assert.ok(root[primary] < child[primary]);
        assert.ok(child[primary] < grandchild[primary]);
        assert.ok(inside(boundaries[1], layout.bounds), 'Fit bounds include root label and summary');
        assert.equal(layout.edgeRoutes.has('constructor'), false);
    }
});
