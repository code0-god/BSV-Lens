'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const Navigation = require('../media/navigation');
const Graph = require('../media/graph-view');

function fixture() {
    const nodes = [
        { id: 'root', kind: 'instance', architectureInstance: true, parentId: null, details: { root: true, path: 'mkTop', targetId: 'module-top', targetDefinitionId: 'def:Top:mkTop' } },
        { id: 'child', kind: 'instance', architectureInstance: true, parentId: 'root', details: { path: 'mkTop.child', targetId: 'module-child', targetDefinitionId: 'def:Top:mkChild', entryCallSiteId: 'call:child', bindingEnvironmentId: 'env:child' } },
        { id: 'method', kind: 'method', parentId: 'child', semanticBehavior: true, details: { definitionId: 'def:Top:mkChild.work' } },
        { id: 'channel', kind: 'protocol-channel', parentId: 'child', details: {} },
        { id: 'endpoint', kind: 'endpoint', parentId: 'child', details: {} },
        { id: 'module-top', kind: 'module', parentId: null },
        { id: 'module-child', kind: 'module', parentId: null },
        { id: 'ambiguous', kind: 'instance', parentId: 'module-top', details: { targetName: 'mkChild' } }
    ];
    const byId = new Map(nodes.map((node) => [node.id, node]));
    const focusPath = (id) => id === 'child' ? ['root', 'child'] : id === 'root' ? ['root'] : byId.has(id) ? [id] : [];
    const rootFor = (id) => ['root', 'child', 'method', 'channel', 'endpoint'].includes(id) ? byId.get('root') : null;
    return { nodes, byId, focusPath, rootFor };
}

function state(overrides = {}) {
    return Navigation.migrateState({
        level: 'system', analysisMode: 'structure', focusStack: [], selectedId: null,
        filters: { rules: true }, collapsedGroups: {}, expandedAggregations: {},
        trace: { startId: null, paths: [], index: 0 },
        transform: { x: 11, y: 12, scale: 1.2 }, ...overrides
    });
}

function controller(saved = state(), options = {}) {
    const model = fixture();
    const projected = [];
    return {
        model,
        projected,
        navigation: Navigation.createIntentController({
            state: saved,
            modelRevision: options.revision ?? 7,
            getNode: (id) => model.byId.get(id),
            focusPath: model.focusPath,
            rootFor: model.rootFor,
            project: (candidate) => {
                projected.push(structuredClone(candidate));
                return options.reject?.(candidate) ? false : true;
            }
        })
    };
}

test('aggregate presentation edges retain their original canonical semantic flow IDs', () => {
    const indexes = Graph.buildIndexes({
        nodes: [
            { id: 'producer', kind: 'instance' },
            { id: 'consumer', kind: 'instance' }
        ],
        semanticFlows: [{ id: 'flow:payload:exact' }],
        edges: [{
            id: 'aggregate', source: 'producer', target: 'consumer', kind: 'payload',
            semanticId: 'flow:payload:exact'
        }]
    });
    assert.equal(indexes.edgeById.get('aggregate').semanticFlowId, 'flow:payload:exact');
});

test('exposes the complete Gate A intent surface', () => {
    const { navigation } = controller();
    for (const intent of [
        'selectEntity', 'focusEntity', 'enterInstance', 'inspectChannel',
        'inspectEndpoint', 'enterBehavior', 'enterFunctionCall', 'inspectCode',
        'openDefinition', 'openSource', 'goBack', 'goForward'
    ]) assert.equal(typeof navigation[intent], 'function', intent);
});

test('migrates legacy focus state into explicit versioned AnalysisContext', () => {
    const migrated = state({ focusStack: ['root', 'child'], selectedId: 'method', level: 'behavior' });
    const { navigation } = controller(migrated);
    navigation.reconcileModel(19);

    assert.equal(migrated.navigationVersion, Navigation.STATE_VERSION);
    assert.deepEqual(migrated.analysisContext, {
        modelRevision: 19,
        rootInstanceId: 'root',
        ownerInstanceId: 'child',
        occurrencePath: ['root', 'child'],
        subject: { kind: 'method', id: 'method' },
        presentationId: 'method',
        entryCallSiteId: null,
        bindingEnvironmentId: null,
        level: 'behavior',
        mode: 'structure'
    });
    assert.deepEqual(migrated.navigationHistory, { back: [], forward: [] });
});

test('enterInstance retains occurrence identity instead of opening its definition', () => {
    const saved = state();
    const { navigation } = controller(saved);
    const result = navigation.enterInstance('child');

    assert.equal(result.status, 'committed');
    assert.equal(saved.level, 'module');
    assert.deepEqual(saved.focusStack, ['root', 'child']);
    assert.equal(saved.selectedId, 'child');
    assert.deepEqual(saved.analysisContext, {
        modelRevision: 7,
        rootInstanceId: 'root',
        ownerInstanceId: 'child',
        occurrencePath: ['root', 'child'],
        subject: { kind: 'instance', id: 'child' },
        presentationId: 'child',
        entryCallSiteId: 'call:child',
        bindingEnvironmentId: 'env:child',
        level: 'module',
        mode: 'structure'
    });
});

test('enterBehavior keeps the owning occurrence and records full Back/Forward snapshots', () => {
    const saved = state({
        level: 'module', focusStack: ['root', 'child'], selectedId: 'child',
        collapsedGroups: { child: { methods: false } },
        expandedAggregations: { group: true },
        trace: { startId: 'child', targetId: null, paths: [], index: 0 }
    });
    const { navigation } = controller(saved);
    navigation.reconcileModel(7);
    navigation.enterBehavior('method');

    assert.equal(saved.level, 'behavior');
    assert.deepEqual(saved.focusStack, ['root', 'child']);
    assert.equal(saved.analysisContext.ownerInstanceId, 'child');
    assert.deepEqual(saved.analysisContext.subject, { kind: 'method', id: 'method' });
    navigation.goBack();
    assert.equal(saved.level, 'module');
    assert.equal(saved.selectedId, 'child');
    assert.deepEqual(saved.collapsedGroups, { child: { methods: false } });
    assert.deepEqual(saved.expandedAggregations, { group: true });
    assert.deepEqual(saved.transform, { x: 11, y: 12, scale: 1.2 });
    navigation.goForward();
    assert.equal(saved.level, 'behavior');
    assert.equal(saved.selectedId, 'method');
});

test('Back captures the immediate pre-navigation selection and viewport without adding selection history', () => {
    const saved = state({
        level: 'module', focusStack: ['root', 'child'], selectedId: 'child'
    });
    const { navigation } = controller(saved);
    navigation.reconcileModel(7);

    navigation.selectEntity('channel');
    saved.transform = { x: 91, y: -24, scale: 1.7 };
    assert.equal(saved.navigationHistory.back.length, 0);
    navigation.enterBehavior('method');
    navigation.goBack();

    assert.equal(saved.selectedId, 'channel');
    assert.deepEqual(saved.focusStack, ['root', 'child']);
    assert.deepEqual(saved.transform, { x: 91, y: -24, scale: 1.7 });
});

test('semantic channel detail keeps canonical subject separate from presentation and owns implementation Back', () => {
    const saved = state({ level: 'module', focusStack: ['root', 'child'], selectedId: 'child' });
    const { navigation } = controller(saved);
    navigation.reconcileModel(7);
    const channel = { id: 'semantic-channel', kind: 'protocol-channel', ownerInstanceId: 'child' };
    const endpoint = { id: 'semantic-endpoint', kind: 'endpoint', ownerInstanceId: 'child' };

    navigation.inspectChannel(channel, 'channel');
    assert.deepEqual(saved.analysisContext.subject, { kind: 'protocol-channel', id: 'semantic-channel' });
    assert.equal(saved.analysisContext.presentationId, 'channel');
    navigation.inspectEndpoint(endpoint, 'endpoint');
    assert.deepEqual(saved.analysisContext.subject, { kind: 'endpoint', id: 'semantic-endpoint' });
    assert.equal(saved.navigationHistory.back.length, 1);

    navigation.enterBehavior('method', {
        fromSemanticParent: true,
        entryCallSiteId: 'call:currentWork',
        bindingEnvironmentId: 'binding:currentWork'
    });
    assert.equal(saved.analysisContext.entryCallSiteId, 'call:currentWork');
    assert.equal(saved.analysisContext.bindingEnvironmentId, 'binding:currentWork');
    navigation.goBack();
    assert.deepEqual(saved.analysisContext.subject, { kind: 'protocol-channel', id: 'semantic-channel' });
    assert.equal(saved.selectedId, 'channel');
    navigation.goBack();
    assert.deepEqual(saved.analysisContext.subject, { kind: 'instance', id: 'child' });
    assert.equal(saved.selectedId, 'child');
});

test('leaf channel and endpoint inspection never replaces occurrence containment', () => {
    const saved = state({ level: 'module', focusStack: ['root', 'child'], selectedId: 'child' });
    const { navigation } = controller(saved);
    navigation.reconcileModel(7);

    navigation.inspectChannel('channel');
    assert.deepEqual(saved.focusStack, ['root', 'child']);
    assert.equal(saved.selectedId, 'channel');
    navigation.inspectEndpoint('endpoint');
    assert.deepEqual(saved.focusStack, ['root', 'child']);
    assert.equal(saved.selectedId, 'endpoint');
    assert.equal(saved.navigationHistory.back.length, 1);
});

test('resolution and projection are atomic and unresolved intents preserve the valid screen', () => {
    const saved = state({ focusStack: ['root'], selectedId: 'root' });
    const before = structuredClone(saved);
    const { navigation, projected } = controller(saved, {
        reject: (candidate) => candidate.selectedId === 'child'
    });

    assert.equal(navigation.enterInstance('missing').status, 'unresolved');
    assert.deepEqual(saved, before);
    assert.equal(navigation.enterInstance('ambiguous').status, 'unresolved');
    assert.deepEqual(saved, before);
    assert.equal(navigation.enterInstance('child').status, 'unresolved');
    assert.deepEqual(saved, before);
    assert.equal(projected.length, 1);
});

test('openDefinition has no node-id fallback and source effects carry revision and context', () => {
    const saved = state({ level: 'module', focusStack: ['root', 'child'], selectedId: 'child' });
    const { navigation } = controller(saved);
    navigation.reconcileModel(7);

    assert.equal(navigation.openDefinition('ambiguous').status, 'unresolved');
    assert.deepEqual(navigation.openDefinition('child'), {
        status: 'effect',
        effect: {
            type: 'openDefinition',
            nodeId: 'module-child',
            modelRevision: 7,
            revision: 7,
            context: saved.analysisContext
        }
    });
    assert.deepEqual(navigation.openSource('child'), {
        status: 'effect',
        effect: {
            type: 'openSource',
            nodeId: 'child',
            modelRevision: 7,
            revision: 7,
            context: saved.analysisContext
        }
    });
});

test('refresh classifies a vanished method and atomically recovers its owner occurrence', () => {
    const saved = state({
        level: 'behavior', focusStack: ['root', 'child'], selectedId: 'method'
    });
    const { navigation, model, projected } = controller(saved);
    navigation.reconcileModel(7);
    model.byId.delete('method');

    navigation.reconcileModel(8);

    assert.equal(projected.at(-1).selectedId, 'child', 'owner recovery was projected before commit');
    assert.equal(saved.level, 'module');
    assert.deepEqual(saved.focusStack, ['root', 'child']);
    assert.equal(saved.selectedId, 'child');
    assert.deepEqual(saved.navigationRecovery, {
        status: 'stale',
        missingIdentity: 'method',
        reason: 'subject-missing-owner-recovered'
    });
});

test('refresh with a vanished root preserves explicit workspace state without choosing another root', () => {
    const saved = state({
        level: 'behavior', focusStack: ['root', 'child'], selectedId: 'method'
    });
    const { navigation, model, projected } = controller(saved);
    navigation.reconcileModel(7);
    for (const id of ['root', 'child', 'method']) model.byId.delete(id);

    navigation.reconcileModel(9);

    assert.equal(projected.at(-1).level, 'system', 'workspace recovery was projected before commit');
    assert.equal(saved.level, 'system');
    assert.deepEqual(saved.focusStack, []);
    assert.equal(saved.selectedId, null);
    assert.deepEqual(saved.navigationRecovery, {
        status: 'stale',
        missingIdentity: 'method',
        reason: 'root-missing-workspace-recovered'
    });
});

test('refresh reconciles stable identities and recovers stale missing history without choosing alternatives', () => {
    const saved = state({
        level: 'behavior', focusStack: ['root', 'gone', 'child'], selectedId: 'gone',
        navigationHistory: {
            back: [{ level: 'module', analysisMode: 'structure', focusStack: ['root', 'gone'], selectedId: 'gone' }],
            forward: []
        }
    });
    const { navigation } = controller(saved);
    navigation.reconcileModel(8);

    assert.deepEqual(saved.focusStack, ['root']);
    assert.equal(saved.selectedId, 'root');
    assert.equal(saved.level, 'module');
    assert.deepEqual(saved.analysisContext.occurrencePath, ['root']);
    assert.equal(saved.analysisContext.subject.id, 'root');
    assert.equal(saved.navigationHistory.back.length, 1);
    assert.deepEqual(saved.navigationHistory.back[0].focusStack, ['root']);
    assert.equal(saved.navigationHistory.back[0].selectedId, 'root');
    assert.equal(saved.navigationHistory.back[0].navigationRecovery.status, 'stale');
});
