'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const Graph = require('../media/graph-view');

function node(id, kind, parentId, details = {}, extra = {}) {
    return {
        id,
        name: id,
        label: id,
        kind,
        parentId,
        ownerId: parentId,
        relativePath: extra.relativePath || 'Top.bsv',
        details,
        ...extra
    };
}

function fixture() {
    const nodes = [
        node('pkg', 'package', null),
        node('a', 'module', 'pkg'),
        node('b', 'module', 'pkg', {}, { relativePath: 'Child.bsv' }),
        node('ifc', 'interface', 'pkg'),
        node('rule', 'rule', 'a'),
        node('method', 'method', 'a'),
        node('fn', 'function', 'a'),
        node('reg', 'register', 'a', {}, { primitive: true }),
        node('fifo', 'fifo', 'a', {}, { primitive: true }),
        node('exact-z', 'instance', 'a', { targetId: 'b', targetName: 'mkB' }),
        node('exact-a', 'instance', 'a', { targetId: 'b', targetName: 'mkB' }),
        node('param', 'instance', 'a', { targetName: 'mkParam#(2)', parameterized: true }),
        node('missing', 'instance', 'a', { targetName: 'mkMissing', unresolved: true }),
        node('type', 'type', 'a'),
        { ...node('hidden-rule', 'rule', 'a'), hidden: true },
        { ...node('hidden-module', 'module', 'pkg'), hidden: true }
    ];
    const edge = (id, source, target, kind, mode, extra = {}) => ({
        id, source, target, kind, mode, evidence: id, ...extra
    });
    const edges = [
        edge('contains-rule', 'a', 'rule', 'contains', 'structure'),
        edge('contains-method', 'a', 'method', 'contains', 'structure'),
        edge('contains-fn', 'a', 'fn', 'contains', 'structure'),
        edge('contains-reg', 'a', 'reg', 'contains', 'structure'),
        edge('contains-fifo', 'a', 'fifo', 'contains', 'structure'),
        edge('contains-exact-a', 'a', 'exact-a', 'contains', 'structure'),
        edge('contains-exact-z', 'a', 'exact-z', 'contains', 'structure'),
        edge('contains-param', 'a', 'param', 'contains', 'structure'),
        edge('contains-missing', 'a', 'missing', 'contains', 'structure'),
        edge('contains-type', 'a', 'type', 'contains', 'structure'),
        edge('contains-hidden', 'a', 'hidden-rule', 'contains', 'structure'),
        edge('implements', 'a', 'ifc', 'implements', 'structure'),
        edge('instantiates', 'a', 'b', 'instantiate', 'structure'),
        edge('produce', 'rule', 'fifo', 'write', 'data-flow'),
        edge('consume', 'fifo', 'method', 'read', 'data-flow'),
        edge('invoke', 'rule', 'fn', 'invoke', 'data-flow'),
        edge('value', 'fn', 'method', 'value', 'data-flow'),
        edge('hidden-data', 'hidden-rule', 'fifo', 'write', 'data-flow'),
        edge('urgency', 'rule', 'method', 'descending-urgency', 'scheduling'),
        edge('potential', 'method', 'rule', 'potential-state-dependency', 'scheduling', {
            bidirectional: true
        })
    ];
    return { nodes, edges };
}

test('exposes dependency-free CommonJS and browser APIs', () => {
    assert.equal(typeof Graph.createViewModel, 'function');
    assert.equal(typeof Graph.filterEdgesByMode, 'function');
    assert.equal(globalThis.BsvArchitectureGraph, Graph);
});

test('indexes nodes children relations and mode adjacency once', () => {
    const indexes = Graph.buildIndexes(fixture());
    assert.equal(indexes.nodeById.get('a').kind, 'module');
    assert.equal(indexes.edgeById.get('produce').kind, 'write');
    assert.equal(indexes.children.get('a').some((item) => item.id === 'rule'), true);
    assert.equal(indexes.relationsByNode.get('rule').length, 5);
    assert.deepEqual(indexes.adjacencyByMode.get('data-flow').get('fifo'), ['method', 'rule']);
});

test('analysis modes select disjoint edge sets', () => {
    const indexes = Graph.buildIndexes(fixture());
    assert.deepEqual(
        Graph.filterEdgesByMode(indexes.edges, 'structure', indexes).map((item) => item.id).slice(-2),
        ['implements', 'instantiates']
    );
    assert.deepEqual(
        Graph.filterEdgesByMode(indexes.edges, 'data-flow', indexes).map((item) => item.id),
        ['consume', 'invoke', 'produce', 'value']
    );
    assert.deepEqual(
        Graph.filterEdgesByMode(indexes.edges, 'scheduling', indexes).map((item) => item.id),
        ['potential', 'urgency']
    );
});

test('System level never materializes behavior or state nodes', () => {
    const view = Graph.createViewModel(fixture(), {
        sourceScope: 'workspace',
        level: 'system',
        analysisMode: 'structure',
        hopScope: 'all'
    });
    const result = view.visible();
    assert.deepEqual(result.nodes.map((item) => item.id), ['a', 'b', 'ifc', 'pkg']);
    assert.ok(!result.nodes.some((item) => ['rule', 'method', 'register'].includes(item.kind)));
});

test('Module level starts with explicit collapsed member buckets', () => {
    const view = Graph.createViewModel(fixture(), {
        level: 'module',
        analysisMode: 'structure',
        focusStack: ['a'],
        hopScope: 'all'
    });
    const buckets = view.memberBuckets('a');
    assert.deepEqual(buckets.map((bucket) => [
        bucket.kind,
        bucket.totalCount,
        bucket.collapsed
    ]), [
        ['interfaces', 1, false],
        ['methods', 1, true],
        ['rules', 1, true],
        ['local-functions', 1, true],
        ['state', 2, true],
        ['child-instances', 4, false],
        ['types', 1, false]
    ]);
    assert.ok(view.visible().nodes.some((item) => item.id === 'member-group:a:methods'));
    assert.ok(!view.visible().nodes.some((item) => item.id === 'method'));
    assert.ok(!view.visible().nodes.some((item) => item.id === 'b'));
});

test('Module level omits member groups with no real or configured content', () => {
    const model = {
        nodes: [
            node('sparse', 'module', null),
            node('only-method', 'method', 'sparse')
        ],
        edges: [{
            id: 'contains-only-method',
            source: 'sparse',
            target: 'only-method',
            kind: 'contains',
            mode: 'structure',
            evidence: 'contains-only-method'
        }]
    };
    const view = Graph.createViewModel(model, {
        level: 'module',
        analysisMode: 'structure',
        focusStack: ['sparse'],
        hopScope: 'all'
    });

    assert.deepEqual(
        view.visible().nodes
            .filter((item) => item.kind === 'member-group')
            .map((item) => item.bucket),
        ['methods']
    );
});

test('Module structure routes expanded members through owner groups', () => {
    const view = Graph.createViewModel(fixture(), {
        level: 'module',
        analysisMode: 'structure',
        focusStack: ['a'],
        hopScope: 'all'
    });
    view.expand('a', 'methods');
    const result = view.visible();
    const methodsGroup = 'member-group:a:methods';

    assert.ok(result.edges.some((edge) =>
        edge.source === 'a' && edge.target === methodsGroup && edge.layoutOnly
    ));
    assert.ok(result.edges.some((edge) =>
        edge.source === methodsGroup && edge.target === 'method' && edge.kind === 'contains'
    ));
    assert.ok(result.edges.filter((edge) => edge.origin === 'view-model').every((edge) => edge.suppressLabel));
    assert.ok(!result.edges.some((edge) => edge.source === 'a' && edge.target === 'method'));
    assert.ok(!result.nodes.some((item) => item.id === 'b'));
});

test('Behavior level exposes individual methods rules functions and state', () => {
    const view = Graph.createViewModel(fixture(), {
        level: 'behavior',
        analysisMode: 'data-flow',
        focusStack: ['a'],
        hopScope: 'all'
    });
    const ids = view.visible().nodes.map((item) => item.id);
    assert.ok(['a', 'rule', 'method', 'fn', 'reg', 'fifo'].every((id) => ids.includes(id)));
    assert.ok(!ids.includes('hidden-rule'));
});

test('1 hop BFS uses only currently active mode edges', () => {
    const view = Graph.createViewModel(fixture());
    assert.deepEqual(view.neighborhood('rule', 1, 'data-flow'), ['rule', 'fifo', 'fn']);
    assert.deepEqual(view.neighborhood('rule', 1, 'scheduling'), ['rule', 'method']);
    assert.ok(!view.neighborhood('rule', 1, 'data-flow').includes('a'));
});

test('2 hop and 3 hop BFS expand deterministic adjacency', () => {
    const view = Graph.createViewModel(fixture());
    assert.deepEqual(view.neighborhood('rule', 2, 'data-flow'), ['rule', 'fifo', 'fn', 'method']);
    assert.deepEqual(view.neighborhood('rule', 3, 'data-flow'), ['rule', 'fifo', 'fn', 'method']);
});

test('All scope reaches complete active component only', () => {
    const view = Graph.createViewModel(fixture());
    assert.deepEqual(view.neighborhood('rule', 'all', 'data-flow'), ['rule', 'fifo', 'fn', 'method']);
    assert.ok(!view.neighborhood('rule', 'all', 'data-flow').includes('b'));
});

test('visible applies one two three and component scopes to focused mode edges', () => {
    const view = Graph.createViewModel(fixture(), {
        level: 'behavior',
        analysisMode: 'data-flow',
        focusStack: ['rule']
    });
    const visibleIds = (hopScope) => new Set(view.visible({ hopScope }).nodes.map((item) => item.id));

    assert.deepEqual(visibleIds(1), new Set(['rule', 'fifo', 'fn']));
    assert.deepEqual(visibleIds(2), new Set(['rule', 'fifo', 'fn', 'method']));
    assert.deepEqual(visibleIds(3), new Set(['rule', 'fifo', 'fn', 'method']));
    assert.deepEqual(visibleIds('all'), new Set(['rule', 'fifo', 'fn', 'method']));
    assert.deepEqual(
        new Set(view.visible({ hopScope: 1, analysisMode: 'scheduling' }).nodes.map((item) => item.id)),
        new Set(['rule', 'method'])
    );
});

test('visible ignores hop scope when no focus exists', () => {
    const view = Graph.createViewModel(fixture(), {
        level: 'behavior',
        analysisMode: 'data-flow',
        hopScope: 1
    });
    const ids = new Set(view.visible().nodes.map((item) => item.id));

    assert.ok(ids.has('reg'));
    assert.ok(ids.has('method'));
    assert.ok(ids.has('missing'));
});

test('visible focus traversal cannot cross unmaterialized level nodes', () => {
    const model = {
        nodes: [
            node('pkg', 'package', null),
            node('module-a', 'module', 'pkg'),
            node('module-b', 'module', 'pkg'),
            node('start', 'rule', 'module-a'),
            node('target', 'rule', 'module-a'),
            node('bridge', 'rule', 'module-b')
        ],
        edges: [
            { id: 'to-bridge', source: 'start', target: 'bridge', kind: 'invoke', mode: 'data-flow' },
            { id: 'to-target', source: 'bridge', target: 'target', kind: 'invoke', mode: 'data-flow' }
        ]
    };
    const view = Graph.createViewModel(model, {
        level: 'behavior',
        analysisMode: 'data-flow',
        focusStack: ['start'],
        hopScope: 'all'
    });

    assert.deepEqual(view.visible().nodes.map((item) => item.id), ['start']);
});

test('collapse and expand update one owner bucket only', () => {
    const view = Graph.createViewModel(fixture(), { level: 'module', focusStack: ['a'] });
    view.expand('a', 'methods');
    assert.equal(view.memberBuckets('a').find((item) => item.kind === 'methods').collapsed, false);
    assert.equal(view.memberBuckets('a').find((item) => item.kind === 'rules').collapsed, true);
    assert.ok(view.visible({ hopScope: 'all' }).nodes.some((item) => item.id === 'method'));
    view.collapse('a', 'methods');
    assert.equal(view.memberBuckets('a').find((item) => item.kind === 'methods').collapsed, true);
});

test('collapseModuleMembers false expands default member buckets', () => {
    const view = Graph.createViewModel(fixture(), {
        level: 'module',
        focusStack: ['a'],
        collapseModuleMembers: false
    });
    assert.equal(view.memberBuckets('a').find((item) => item.kind === 'methods').collapsed, false);
    assert.equal(view.memberBuckets('a').find((item) => item.kind === 'state').collapsed, false);
});

test('showMethodPorts false removes method cards and their empty bucket', () => {
    const view = Graph.createViewModel(fixture(), {
        level: 'module',
        focusStack: ['a'],
        collapseModuleMembers: false,
        showMethodPorts: false
    });
    const visible = view.visible({ hopScope: 'all' }).nodes;

    assert.equal(visible.some((item) => item.kind === 'method'), false);
    assert.equal(visible.some((item) => item.kind === 'member-group' && item.bucket === 'methods'), false);
});

test('expanded child instances aggregate exact and unresolved multiplicity', () => {
    const view = Graph.createViewModel(fixture(), { level: 'module', focusStack: ['a'] });
    const groups = view.visible({ hopScope: 'all' }).nodes.filter((item) => item.kind === 'instance-group');
    assert.deepEqual(groups.map((group) => [group.label, group.sourceIds, group.multiplicity]), [
        ['mkB × 2', ['exact-a', 'exact-z'], { status: 'exact', count: 2 }],
        ['mkMissing × N', ['missing'], { status: 'unresolved', count: null }],
        ['mkParam#(2) × N', ['param'], { status: 'parameterized', count: null }]
    ]);
    const childGroupId = 'member-group:a:child-instances';
    assert.ok(view.visible({ hopScope: 'all' }).edges.some((edge) =>
        edge.source === childGroupId && edge.kind === 'instantiate'
    ));

    const exact = groups[0];
    view.toggleAggregation(exact.id);
    const expandedIds = view.visible({ hopScope: 'all' }).nodes.map((item) => item.id);
    assert.ok(expandedIds.includes('exact-a'));
    assert.ok(expandedIds.includes('exact-z'));
});

test('instance aggregation keeps every semantic identity dimension distinct', () => {
    const model = fixture();
    const base = {
        targetId: 'b',
        targetName: 'mkB',
        declaredType: 'ChildIfc#(8)',
        constructor: 'mkB',
        staticArguments: ['8'],
        specialization: '#(8)',
        role: 'worker',
        config: { clock: 'fast' }
    };
    const variants = [
        ['identity-base', base],
        ['identity-type', { ...base, declaredType: 'OtherIfc#(8)' }],
        ['identity-constructor', { ...base, constructor: 'mkOther' }],
        ['identity-static', { ...base, staticArguments: ['16'] }],
        ['identity-specialization', { ...base, specialization: '#(16)' }],
        ['identity-role', { ...base, role: 'controller' }],
        ['identity-config', { ...base, config: { clock: 'slow' } }]
    ];
    for (const [id, details] of variants) {
        model.nodes.push(node(id, 'instance', 'a', details));
        model.edges.push({
            id: `contains-${id}`,
            source: 'a',
            target: id,
            kind: 'contains',
            mode: 'structure',
            evidence: id
        });
    }

    const view = Graph.createViewModel(model, { level: 'module', focusStack: ['a'] });
    const identityGroups = view.visible({ hopScope: 'all' }).nodes
        .filter((item) => item.kind === 'instance-group')
        .filter((item) => item.sourceIds.some((id) => id.startsWith('identity-')));

    assert.equal(identityGroups.length, variants.length);
    assert.ok(identityGroups.every((group) => group.sourceIds.length === 1));
});

test('focus breadcrumbs restore valid order and remove duplicates', () => {
    const view = Graph.createViewModel(fixture(), { focusStack: ['a', 'gone', 'a', 'fn'] });
    assert.deepEqual(view.state.focusStack, ['a', 'fn']);
    view.setFocus(['pkg', { id: 'a' }, 'not-present']);
    assert.deepEqual(view.breadcrumbs().map((item) => item.id), ['pkg', 'a']);
});

test('shortest paths honor mode and navigate all equal paths', () => {
    const view = Graph.createViewModel(fixture());
    const result = view.shortestPaths('rule', 'method', { analysisMode: 'data-flow' });

    assert.deepEqual(result.paths, [
        ['rule', 'fifo', 'method'],
        ['rule', 'fn', 'method']
    ]);
    assert.equal(result.truncated, false);
    assert.ok(result.visitedNodes >= 4);
    assert.deepEqual(view.shortestPaths('a', 'b', { analysisMode: 'data-flow' }).paths, []);
    const navigator = Graph.createPathNavigator({
        paths: [
            ['rule', 'z', 'method'],
            ['rule', 'a', 'method']
        ],
        truncated: true,
        visitedNodes: 4,
        elapsedMs: 1
    });
    assert.equal(navigator.label, '1 of 2+');
    assert.equal(navigator.truncated, true);
    assert.equal(navigator.visitedNodes, 4);
    assert.deepEqual(navigator.next(), ['rule', 'z', 'method']);
    assert.deepEqual(navigator.previous(), ['rule', 'a', 'method']);
});

test('shortest paths return one directional path and reverse bidirectional scheduling', () => {
    const edges = [
        { id: 'one', source: 'source', target: 'middle', kind: 'write' },
        { id: 'two', source: 'middle', target: 'target', kind: 'read' }
    ];

    assert.deepEqual(Graph.shortestPaths('source', 'target', edges).paths, [
        ['source', 'middle', 'target']
    ]);
    assert.deepEqual(Graph.shortestPaths('target', 'source', edges).paths, []);
    assert.deepEqual(Graph.shortestPaths('target', 'source', [{
        id: 'schedule',
        source: 'source',
        target: 'target',
        kind: 'mutually-exclusive',
        bidirectional: true
    }]).paths, [['target', 'source']]);
});

test('shortest paths cap combinatorial results at fifty', () => {
    const edges = Array.from({ length: 51 }, (_, index) => [
        { id: `left-${index}`, source: 'source', target: `middle-${index}` },
        { id: `right-${index}`, source: `middle-${index}`, target: 'target' }
    ]).flat();
    const result = Graph.shortestPaths('source', 'target', edges, { maxPaths: 50 });

    assert.equal(result.paths.length, 50);
    assert.equal(result.truncated, true);
    assert.equal(result.limitReason, 'max-paths');
});

test('shortest paths bound visited nodes before exploring a large graph', () => {
    const edges = Array.from({ length: 100 }, (_, index) => ({
        id: `edge-${index}`,
        source: `node-${index}`,
        target: `node-${index + 1}`
    }));
    const result = Graph.shortestPaths('node-0', 'node-100', edges, {
        maxVisitedNodes: 10
    });

    assert.deepEqual(result.paths, []);
    assert.equal(result.truncated, true);
    assert.equal(result.limitReason, 'max-visited-nodes');
    assert.equal(result.visitedNodes, 10);
});

test('shortest paths enforce deterministic time budget', () => {
    let tick = 0;
    const result = Graph.shortestPaths('source', 'target', [{
        id: 'edge',
        source: 'source',
        target: 'target'
    }], {
        timeBudgetMs: 1,
        now: () => tick++
    });

    assert.deepEqual(result.paths, []);
    assert.equal(result.truncated, true);
    assert.equal(result.limitReason, 'time-budget');
    assert.ok(result.elapsedMs >= 1);
});

test('shortest paths handle large cyclic graphs without recursion overflow', () => {
    const count = 5000;
    const edges = Array.from({ length: count }, (_, index) => ({
        id: `cycle-${index}`,
        source: `node-${index}`,
        target: `node-${(index + 1) % count}`
    }));
    const result = Graph.shortestPaths('node-0', 'node-4000', edges, {
        maxVisitedNodes: count,
        timeBudgetMs: 1000
    });

    assert.equal(result.paths.length, 1);
    assert.equal(result.paths[0].length, 4001);
    assert.equal(result.truncated, false);
});

test('legacy all hop scope migrates as component-compatible state', () => {
    const indexes = Graph.buildIndexes(fixture());

    assert.equal(Graph.migrateState({ hops: 'all' }, indexes).hopScope, 'all');
    assert.equal(Graph.migrateState({ hopScope: 'All' }, indexes).hopScope, 'all');
});

test('path navigator remains compatible with direct path arrays', () => {
    const navigator = Graph.createPathNavigator([
        ['rule', 'z', 'method'],
        ['rule', 'a', 'method']
    ]);

    assert.equal(navigator.label, '1 of 2');
    assert.deepEqual(navigator.next(), ['rule', 'z', 'method']);
    assert.deepEqual(navigator.previous(), ['rule', 'a', 'method']);
});

test('Current File source scope excludes other files', () => {
    const view = Graph.createViewModel(fixture(), {
        sourceScope: 'current-file',
        activeFile: 'Top.bsv',
        level: 'system',
        analysisMode: 'structure',
        hopScope: 'all'
    });
    assert.ok(!view.visible().nodes.some((item) => item.id === 'b'));
});

test('old v0.2 state migrates without confusing source and analysis modes', () => {
    const indexes = Graph.buildIndexes(fixture());
    const state = Graph.migrateState({
        mode: 'file',
        focusStack: ['a'],
        selectedId: 'rule',
        filters: { rules: true },
        expandedModules: ['a'],
        hops: '3',
        transform: { x: 2, y: 3, scale: 0.5 }
    }, indexes);

    assert.equal(state.version, Graph.STATE_VERSION);
    assert.equal(state.sourceScope, 'current-file');
    assert.equal(state.level, 'system');
    assert.equal(state.analysisMode, 'structure');
    assert.equal(state.hopScope, 3);
    assert.equal(state.collapsedGroups.a.methods, false);
    assert.deepEqual(state.transform, { x: 2, y: 3, scale: 0.5 });
});
