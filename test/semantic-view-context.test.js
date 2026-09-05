'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const Graph = require('../media/graph-view');

function fixture() {
    const instance = (id, parentId = null, root = false) => ({
        id, kind: 'instance', name: id, label: id, architectureInstance: true,
        parentId, ownerId: parentId, relativePath: 'Top.bsv', details: { root }
    });
    const boundary = (id, rootId) => ({
        id, semanticId: `semantic-${id}`, kind: 'root-boundary', name: id, label: id,
        virtual: true, external: true, rootBoundary: true, boundaryRootId: rootId,
        relativePath: 'Top.bsv', details: { rootInstanceId: rootId }
    });
    const channel = (id, rootId) => ({
        id, kind: 'protocol-channel', name: id, label: id, parentId: rootId,
        ownerId: rootId, externalChannel: true, boundaryRootId: rootId,
        relativePath: 'Top.bsv', details: { boundaryStatus: 'unbound' }
    });
    return {
        activeFile: 'Top.bsv',
        architectureRoots: ['root-a', 'root-b'],
        semanticRoots: [
            { instanceId: 'root-a', reason: 'configured' },
            { instanceId: 'root-b', reason: 'uninstantiated' }
        ],
        nodes: [
            instance('root-a', null, true),
            instance('a-child', 'root-a'),
            instance('root-b', null, true),
            boundary('boundary-a', 'root-a'),
            boundary('boundary-b', 'root-b'),
            channel('channel-a', 'root-a'),
            channel('channel-b', 'root-b'),
            { id: 'pkg', kind: 'package', name: 'pkg', label: 'pkg', relativePath: 'Top.bsv' }
        ],
        edges: [
            { id: 'child', source: 'root-a', target: 'a-child', kind: 'instance-child', mode: 'structure' },
            { id: 'boundary-out', source: 'channel-a', target: 'boundary-a', kind: 'boundary-output', mode: 'data-flow', boundary: true },
            { id: 'boundary-in', source: 'boundary-b', target: 'channel-b', kind: 'boundary-input', mode: 'data-flow', boundary: true }
        ]
    };
}

function view(state = {}) {
    return Graph.createViewModel(fixture(), {
        sourceScope: 'workspace', level: 'system', analysisMode: 'structure', hopScope: 'all',
        focusStack: [], selectedId: null,
        filters: { packages: false, imports: false, rules: true, primitives: false },
        ...state
    });
}

test('projection and source-resolution contexts are explicit and DOM-free', () => {
    const vm = view({
        analysisMode: 'data-flow',
        focusStack: ['root-a'],
        hopScope: 1,
        selectedId: 'a-child'
    });

    assert.deepEqual(vm.projectionContext(), {
        sourceScope: 'workspace',
        level: 'system',
        analysisMode: 'data-flow',
        focusInstanceId: 'root-a',
        rootSelection: 'root-a',
        hopScope: 1,
        filters: { packages: false, imports: false, rules: true, primitives: false }
    });
    const context = vm.sourceResolutionContext();
    assert.equal(context.focusInstanceId, 'root-a');
    assert.equal(context.selectedNodeId, 'a-child');
    assert.deepEqual(context.visibleNodeIds, vm.visible().nodes.map((node) => node.id));
    assert.deepEqual(context.viewNodeIds, vm.visible({ focusId: null, hopScope: 'all' }).nodes.map((node) => node.id));
    assert.ok(context.viewNodeIds.includes('root-b'));
    assert.equal(vm.sourceResolutionContext(null).selectedNodeId, null);
});

test('System Structure hides external boundary cards while Data Flow retains channels and directional edges', () => {
    const vm = view();
    const structure = vm.visible();
    const dataFlow = vm.visible({ analysisMode: 'data-flow' });

    assert.deepEqual(structure.nodes.map((node) => node.id), ['a-child', 'root-a', 'root-b']);
    assert.equal(structure.nodes.some((node) => node.rootBoundary), false);
    assert.deepEqual(dataFlow.nodes.filter((node) => node.rootBoundary).map((node) => node.id), [
        'boundary-a',
        'boundary-b'
    ]);
    assert.deepEqual(dataFlow.nodes.filter((node) => node.externalChannel).map((node) => node.id), [
        'channel-a',
        'channel-b'
    ]);
    assert.deepEqual(dataFlow.edges.map((edge) => edge.id), ['boundary-in', 'boundary-out']);
    assert.equal(dataFlow.topology.rootById.get('boundary-a'), 'root-a');
    assert.equal(dataFlow.topology.rootById.get('channel-a'), 'root-a');
    assert.equal(dataFlow.topology.parentById.has('boundary-a'), false);
    assert.equal(vm.rootFor('boundary-a').id, 'root-a');
    assert.equal(vm.rootFor('channel-a').id, 'root-a');
    assert.equal(vm.rootFor('pkg'), null);
});

test('Source Map OFF and ON preserve canonical IR while retaining secondary candidates', () => {
    const model = fixture();
    const before = JSON.stringify(model);
    const vm = Graph.createViewModel(model, {
        sourceScope: 'workspace', level: 'system', analysisMode: 'structure', hopScope: 'all',
        filters: { packages: false, imports: false, rules: true, primitives: false }
    });

    assert.equal(vm.visible().nodes.some((node) => node.id === 'pkg'), false);
    vm.state.filters.packages = true;
    assert.equal(vm.visible().nodes.some((node) => node.id === 'pkg'), true);
    assert.equal(JSON.stringify(model), before);
});

test('explicit null focus differs from an absent visible option and preserves module ownership', () => {
    const vm = view({ focusStack: ['root-a'] });

    assert.deepEqual(vm.visible().nodes.map((node) => node.id), ['a-child', 'root-a']);
    assert.deepEqual(vm.visible({ focusId: null }).nodes.map((node) => node.id), [
        'a-child',
        'root-a',
        'root-b'
    ]);

    vm.setLevel('module');
    const context = vm.sourceResolutionContext();
    assert.ok(context.viewNodeIds.includes('root-a'));
    assert.equal(context.viewNodeIds.includes('root-b'), false);
});
