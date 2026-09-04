'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const Graph = require('../media/graph-view');

function fixture() {
    const stateNodes = [
        ['activeDescriptor', 'register'],
        ['activeStripe', 'register'],
        ['completions', 'fifo'],
        ['nextStripeId', 'register'],
        ['publishedUntil', 'register'],
        ['stripeLookahead', 'register'],
        ['workPosition', 'register']
    ].map(([id, kind]) => ({
        id,
        name: id,
        label: id,
        kind,
        parentId: 'scheduler',
        ownerId: 'scheduler',
        primitive: true,
        relativePath: 'MatmulScheduler.bsv',
        details: {}
    }));
    return {
        nodes: [
            {
                id: 'scheduler',
                name: 'mkMatmulScheduler',
                label: 'mkMatmulScheduler',
                kind: 'module',
                relativePath: 'MatmulScheduler.bsv',
                details: {}
            },
            ...stateNodes
        ],
        edges: stateNodes.map((stateNode) => ({
            id: `contains-${stateNode.id}`,
            source: 'scheduler',
            target: stateNode.id,
            kind: 'contains',
            mode: 'structure',
            evidence: `contains-${stateNode.id}`
        }))
    };
}

function visibleState(primitives) {
    const result = Graph.createViewModel(fixture(), {
        level: 'module',
        analysisMode: 'structure',
        focusStack: ['scheduler'],
        collapseModuleMembers: false,
        filters: { primitives }
    }).visible();
    return {
        result,
        group: result.nodes.find((node) =>
            node.kind === 'member-group' && node.bucket === 'state'
        )
    };
}

test('State primitives filter off keeps total count and reports zero visible members', () => {
    const { result, group } = visibleState(false);

    assert.deepEqual({
        totalCount: group.totalCount,
        visibleCount: group.visibleCount,
        collapsed: group.collapsed
    }, {
        totalCount: 7,
        visibleCount: 0,
        collapsed: false
    });
    assert.equal(result.nodes.filter((node) => node.primitive).length, 0);
});

test('State primitives filter on reports and materializes all seven members', () => {
    const { result, group } = visibleState(true);

    assert.deepEqual({
        totalCount: group.totalCount,
        visibleCount: group.visibleCount,
        collapsed: group.collapsed
    }, {
        totalCount: 7,
        visibleCount: 7,
        collapsed: false
    });
    assert.equal(result.nodes.filter((node) => node.primitive).length, 7);
});
