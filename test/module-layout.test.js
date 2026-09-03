'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const Graph = require('../media/graph-view');

function fixture() {
    const root = {
        id: 'module',
        kind: 'module',
        label: 'Module'
    };
    const interfaces = {
        id: 'group:interfaces',
        kind: 'member-group',
        bucket: 'interfaces',
        parentId: root.id,
        label: 'Interfaces'
    };
    const methods = {
        id: 'group:methods',
        kind: 'member-group',
        bucket: 'methods',
        parentId: root.id,
        label: 'Methods'
    };
    const interfaceNode = {
        id: 'interface',
        kind: 'interface',
        parentId: root.id,
        label: 'Interface'
    };
    const methodNodes = Array.from({ length: 12 }, (_, index) => ({
        id: `method:${index}`,
        kind: 'method',
        parentId: root.id,
        label: `method${index}`
    }));
    const nodes = [root, interfaces, methods, interfaceNode, ...methodNodes];
    const hierarchyEdge = (source, target) => ({
        id: `${source}->${target}`,
        source,
        target,
        kind: 'contains',
        origin: 'view-model'
    });
    const edges = [
        hierarchyEdge(root.id, interfaces.id),
        hierarchyEdge(root.id, methods.id),
        hierarchyEdge(interfaces.id, interfaceNode.id),
        ...methodNodes.map((node) => hierarchyEdge(methods.id, node.id))
    ];
    const sizes = new Map(nodes.map((node) => [node.id,
        node.kind === 'module'
            ? { width: 300, height: 88 }
            : node.kind === 'member-group'
                ? { width: 220, height: 52 }
                : node.kind === 'method'
                    ? { width: 154, height: 58 }
                    : { width: 220, height: 78 }
    ]));
    return { nodes, edges, sizes, methodNodes };
}

function assertNoNodeOverlaps(layout) {
    const positions = [...layout.positions.entries()];
    for (let left = 0; left < positions.length; left += 1) {
        for (let right = left + 1; right < positions.length; right += 1) {
            const [leftId, a] = positions[left];
            const [rightId, b] = positions[right];
            const overlaps = a.x < b.x + b.width
                && a.x + a.width > b.x
                && a.y < b.y + b.height
                && a.y + a.height > b.y;
            assert.equal(overlaps, false, `${leftId} overlaps ${rightId}`);
        }
    }
}

function assertRoutesAvoidUnrelatedNodes(layout, edges) {
    for (const edge of edges.filter((item) => item.source === 'module')) {
        const route = layout.edgeRoutes.get(edge.id);
        assert.ok(route, `missing route for ${edge.id}`);
        assert.equal(route.marker, 'hierarchy');
        const values = [...route.path.matchAll(/-?\d+(?:\.\d+)?/g)].map((match) => Number(match[0]));
        const points = [];
        for (let index = 0; index < values.length; index += 2) {
            points.push({ x: values[index], y: values[index + 1] });
        }
        for (let index = 1; index < points.length; index += 1) {
            const start = points[index - 1];
            const end = points[index];
            const length = Math.hypot(end.x - start.x, end.y - start.y);
            for (let distance = 2; distance < length - 2; distance += 2) {
                const ratio = distance / length;
                const point = {
                    x: start.x + (end.x - start.x) * ratio,
                    y: start.y + (end.y - start.y) * ratio
                };
                for (const [nodeId, rect] of layout.positions) {
                    if (nodeId === edge.source || nodeId === edge.target) continue;
                    const inside = point.x > rect.x + 1
                        && point.x < rect.x + rect.width - 1
                        && point.y > rect.y + 1
                        && point.y < rect.y + rect.height - 1;
                    assert.equal(inside, false, `${edge.id} crosses ${nodeId}`);
                }
            }
        }
    }
    for (const edge of edges.filter((item) => item.source !== 'module')) {
        assert.equal(layout.edgeRoutes.has(edge.id), false, `${edge.id} should use panel containment`);
    }
}

function assertPanelContainment(layout, nodes) {
    const panels = layout.groups.filter((group) => group.kind === 'member-panel');
    assert.equal(panels.length, 2);
    for (let left = 0; left < panels.length; left += 1) {
        for (let right = left + 1; right < panels.length; right += 1) {
            const a = panels[left];
            const b = panels[right];
            const overlaps = a.x < b.x + b.width
                && a.x + a.width > b.x
                && a.y < b.y + b.height
                && a.y + a.height > b.y;
            assert.equal(overlaps, false, `${a.id} overlaps ${b.id}`);
        }
    }
    for (const panel of panels) {
        for (const nodeId of panel.nodeIds) {
            const rect = layout.positions.get(nodeId);
            assert.ok(rect, `missing panel node ${nodeId}`);
            assert.ok(rect.x >= panel.x && rect.x + rect.width <= panel.x + panel.width);
            assert.ok(rect.y >= panel.y && rect.y + rect.height <= panel.y + panel.height);
        }
    }
    assert.deepEqual(
        [...new Set(panels.flatMap((panel) => panel.nodeIds))].sort(),
        nodes.filter((node) => node.id !== 'module').map((node) => node.id).sort()
    );
}

test('Module hierarchy adapts packing and routes around unrelated blocks', () => {
    assert.equal(typeof Graph.layoutModuleHierarchy, 'function');
    const data = fixture();
    const wide = Graph.layoutModuleHierarchy(data.nodes, data.edges, data.sizes, {
        direction: 'LR',
        focusId: 'module',
        viewport: { width: 1200, height: 600 }
    });
    const narrow = Graph.layoutModuleHierarchy(data.nodes, data.edges, data.sizes, {
        direction: 'LR',
        focusId: 'module',
        viewport: { width: 620, height: 900 }
    });
    const topDown = Graph.layoutModuleHierarchy(data.nodes, data.edges, data.sizes, {
        direction: 'TB',
        focusId: 'module',
        viewport: { width: 900, height: 700 }
    });

    assertNoNodeOverlaps(wide);
    assertNoNodeOverlaps(narrow);
    assertNoNodeOverlaps(topDown);
    assertPanelContainment(wide, data.nodes);
    assertPanelContainment(narrow, data.nodes);
    assertPanelContainment(topDown, data.nodes);
    assertRoutesAvoidUnrelatedNodes(wide, data.edges);
    assertRoutesAvoidUnrelatedNodes(narrow, data.edges);
    assertRoutesAvoidUnrelatedNodes(topDown, data.edges);

    const columns = (layout) => new Set(data.methodNodes.map((node) =>
        Math.round(layout.positions.get(node.id).x)
    )).size;
    assert.ok(columns(wide) > columns(narrow), 'wide canvas should use more member columns');
    assert.deepEqual(
        [...Graph.layoutModuleHierarchy(data.nodes.slice().reverse(), data.edges.slice().reverse(), data.sizes, {
            direction: 'LR',
            focusId: 'module',
            viewport: { width: 1200, height: 600 }
        }).positions],
        [...wide.positions],
        'layout must be deterministic'
    );
});
