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
