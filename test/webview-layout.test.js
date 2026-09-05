'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const Layout = require('../media/webview-layout');

test('layout module exposes matching CommonJS and browser APIs', () => {
    assert.equal(typeof Layout.layoutGraph, 'function');
    assert.equal(globalThis.BsvArchitectureLayout, Layout);
});

test('compact behavior layout remains deterministic at narrow widths', () => {
    const nodes = ['focus', 'second', 'third', 'fourth'].map((id) => ({
        id,
        name: id,
        label: id,
        kind: 'rule'
    }));
    const layout = Layout.layoutGraph(nodes, [], [], {
        level: 'behavior',
        analysisMode: 'structure',
        direction: 'LR',
        focusId: 'focus',
        viewportWidth: 600,
        layoutModuleHierarchy() {
            assert.fail('module hierarchy layout should not run');
        }
    });

    assert.deepEqual([...layout.positions].map(([id, position]) => [
        id,
        position.x,
        position.y,
        position.width,
        position.height
    ]), [
        ['focus', 25, 20, 180, 78],
        ['fourth', 235, 20, 180, 78],
        ['second', 25, 116, 180, 78],
        ['third', 235, 116, 180, 78]
    ]);
});

test('module layout keeps every method card at dense dimensions', () => {
    const methods = Array.from({ length: 40 }, (_, index) => ({
        id: `method-${index}`,
        name: `method-${index}`,
        label: `method-${index}`,
        kind: 'method'
    }));
    let observedSizes;
    Layout.layoutGraph(methods, [], [], {
        level: 'module',
        analysisMode: 'structure',
        direction: 'LR',
        focusId: null,
        viewportWidth: 1280,
        layoutModuleHierarchy(_nodes, _edges, sizes) {
            observedSizes = sizes;
            return { positions: new Map(), groups: [], bounds: {}, direction: 'LR' };
        }
    });

    assert.equal(observedSizes.size, 40);
    assert.ok([...observedSizes.values()].every((size) => size.width === 154 && size.height === 58));
});

test('data flow layers producers before state and consumers in LR and TB directions', () => {
    const nodes = [
        { id: 'consumer', name: 'consumer', label: 'consumer', kind: 'rule' },
        { id: 'fifo', name: 'fifo', label: 'fifo', kind: 'fifo' },
        { id: 'producer', name: 'producer', label: 'producer', kind: 'rule' }
    ];
    const edges = [
        { id: 'write', source: 'producer', target: 'fifo', kind: 'write' },
        { id: 'read', source: 'fifo', target: 'consumer', kind: 'read' }
    ];
    const options = {
        level: 'behavior',
        analysisMode: 'data-flow',
        focusId: null,
        viewportWidth: 1280,
        layoutModuleHierarchy() {
            assert.fail('module hierarchy layout should not run');
        }
    };
    const lr = Layout.layoutGraph(nodes, edges, [], { ...options, direction: 'LR' });
    const tb = Layout.layoutGraph(nodes, edges, [], { ...options, direction: 'TB' });

    assert.ok(lr.positions.get('producer').x < lr.positions.get('fifo').x);
    assert.ok(lr.positions.get('fifo').x < lr.positions.get('consumer').x);
    assert.ok(tb.positions.get('producer').y < tb.positions.get('fifo').y);
    assert.ok(tb.positions.get('fifo').y < tb.positions.get('consumer').y);
});

test('data flow layout is deterministic across reversed node and edge input', () => {
    const nodes = [
        { id: 'source', name: 'source', label: 'source', kind: 'method' },
        { id: 'left', name: 'left', label: 'left', kind: 'fifo' },
        { id: 'right', name: 'right', label: 'right', kind: 'fifo' },
        { id: 'sink', name: 'sink', label: 'sink', kind: 'rule' }
    ];
    const edges = [
        { id: 'a', source: 'source', target: 'left', kind: 'write' },
        { id: 'b', source: 'source', target: 'right', kind: 'write' },
        { id: 'c', source: 'left', target: 'sink', kind: 'read' },
        { id: 'd', source: 'right', target: 'sink', kind: 'read' }
    ];
    const options = {
        level: 'behavior',
        analysisMode: 'data-flow',
        direction: 'LR',
        focusId: null,
        viewportWidth: 1280,
        layoutModuleHierarchy() {}
    };
    const first = Layout.layoutGraph(nodes, edges, [], options);
    const reversed = Layout.layoutGraph(nodes.toReversed(), edges.toReversed(), [], options);

    assert.deepEqual([...first.positions], [...reversed.positions]);
});

test('scheduling layout condenses precedence cycles and ignores unordered relations', () => {
    const nodes = ['a', 'b', 'c', 'd'].map((id) => ({
        id,
        name: id,
        label: id,
        kind: 'rule'
    }));
    const edges = [
        { id: 'ab', source: 'a', target: 'b', kind: 'execution-order' },
        { id: 'ba', source: 'b', target: 'a', kind: 'preempts' },
        { id: 'bc', source: 'b', target: 'c', kind: 'sequential-before' },
        { id: 'ad', source: 'a', target: 'd', kind: 'conflict', bidirectional: true }
    ];
    const layout = Layout.layoutGraph(nodes, edges, [], {
        level: 'behavior',
        analysisMode: 'scheduling',
        direction: 'LR',
        focusId: null,
        viewportWidth: 1280,
        layoutModuleHierarchy() {}
    });

    assert.equal(layout.positions.get('a').x, layout.positions.get('b').x);
    assert.ok(layout.positions.get('b').x < layout.positions.get('c').x);
    assert.equal(layout.positions.get('d').x, layout.positions.get('a').x);
    assert.deepEqual(layout.cycles.map(({ id, members, edgeIds }) => ({ id, members, edgeIds })), [{
        id: 'cycle:a|b',
        members: ['a', 'b'],
        edgeIds: ['ab', 'ba']
    }]);
    assert.ok(layout.cycles[0].bounds.width > layout.positions.get('a').width);
    assert.ok(layout.cycles[0].bounds.height > layout.positions.get('a').height);
});

test('scheduling SCC layout is deterministic across reversed input', () => {
    const nodes = ['a', 'b', 'c', 'd'].map((id) => ({
        id,
        name: id,
        label: id,
        kind: 'rule'
    }));
    const edges = [
        { id: 'ab', source: 'a', target: 'b', kind: 'descending-urgency' },
        { id: 'ba', source: 'b', target: 'a', kind: 'execution-order' },
        { id: 'bc', source: 'b', target: 'c', kind: 'preempts' }
    ];
    const options = {
        level: 'behavior',
        analysisMode: 'scheduling',
        direction: 'TB',
        focusId: null,
        viewportWidth: 1280,
        layoutModuleHierarchy() {}
    };
    const first = Layout.layoutGraph(nodes, edges, [], options);
    const reversed = Layout.layoutGraph(nodes.toReversed(), edges.toReversed(), [], options);

    assert.deepEqual([...first.positions], [...reversed.positions]);
    assert.deepEqual(first.cycles, reversed.cycles);
});

test('layer ordering removes simple crossings without mutating edge semantics', () => {
    const nodes = ['source-a', 'source-b', 'target-c', 'target-d'].map((id) => ({
        id,
        name: id,
        label: id,
        kind: id.startsWith('source') ? 'method' : 'rule'
    }));
    const edges = [
        { id: 'ad', source: 'source-a', target: 'target-d', kind: 'write', evidence: 'a to d' },
        { id: 'bc', source: 'source-b', target: 'target-c', kind: 'write', evidence: 'b to c' }
    ];
    const originalEdges = structuredClone(edges);
    const layout = Layout.layoutGraph(nodes, edges, [], {
        level: 'behavior',
        analysisMode: 'data-flow',
        direction: 'LR',
        focusId: null,
        viewportWidth: 1280,
        layoutModuleHierarchy() {}
    });

    assert.ok(layout.positions.get('source-a').y < layout.positions.get('source-b').y);
    assert.ok(layout.positions.get('target-d').y < layout.positions.get('target-c').y);
    assert.deepEqual(edges, originalEdges);
});

test('system data-flow routes stay inside their own root including feedback', () => {
    const nodes = ['a', 'b'].flatMap((root) => [
        { id: root, kind: 'instance', architectureInstance: true },
        { id: `${root}-input`, kind: 'root-boundary', presentationRole: 'external-input' },
        { id: `${root}-channel`, kind: 'protocol-channel' },
        { id: `${root}-output`, kind: 'root-boundary', presentationRole: 'external-output' }
    ].map((node) => ({ ...node, name: node.id, label: node.id })));
    const edges = ['a', 'b'].flatMap((root) => [
        { id: `${root}-in`, source: `${root}-input`, target: `${root}-channel`, kind: 'boundary-input' },
        { id: `${root}-out`, source: `${root}-channel`, target: `${root}-output`, kind: 'boundary-output' },
        { id: `${root}-read`, source: `${root}-channel`, target: root, kind: 'read' },
        { id: `${root}-write`, source: root, target: `${root}-channel`, kind: 'write' }
    ]);
    const originalEdges = structuredClone(edges);
    const roots = ['a', 'b'].map((id) => ({
        id, label: id, reason: 'uninstantiated',
        nodeIds: nodes.filter((node) => node.id === id || node.id.startsWith(`${id}-`)).map((node) => node.id)
    }));
    const topology = {
        roots,
        rootById: new Map(roots.flatMap((root) => root.nodeIds.map((id) => [id, root.id])))
    };
    for (const direction of ['LR', 'TB']) {
        const layout = Layout.layoutGraph(nodes, edges, [], {
            level: 'system', analysisMode: 'data-flow', direction, topology,
            viewportWidth: 1600, viewportHeight: 1000
        });
        for (const edge of edges) {
            const route = layout.edgeRoutes.get(edge.id);
            assert.ok(route, `${edge.id} requires a root-local route`);
            const group = layout.groups.find((item) => item.ownerId === topology.rootById.get(edge.source));
            let x;
            let y;
            for (const segment of route.path.matchAll(/([MHV])\s+(-?[\d.]+)(?:\s+(-?[\d.]+))?/g)) {
                if (segment[1] === 'M') [x, y] = [Number(segment[2]), Number(segment[3])];
                else if (segment[1] === 'H') x = Number(segment[2]);
                else y = Number(segment[2]);
                assert.ok(x >= group.x && x <= group.x + group.width, `${edge.id} leaves its root horizontally`);
                assert.ok(y >= group.y && y <= group.y + group.height, `${edge.id} leaves its root vertically`);
            }
            assert.ok(route.labelX >= group.x && route.labelX <= group.x + group.width);
            assert.ok(route.labelY >= group.y && route.labelY <= group.y + group.height);
        }
    }
    assert.deepEqual(edges, originalEdges);
});
