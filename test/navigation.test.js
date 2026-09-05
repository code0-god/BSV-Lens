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
        'inspectFlow', 'enterCodeDefinition', 'openDefinition', 'openSource', 'goBack', 'goForward'
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
        sourceRevision: null,
        codeContainerId: null,
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
        sourceRevision: null,
        codeContainerId: null,
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

test('flow-to-code Back and Forward restore relation detail, filters, and viewport', () => {
    const saved = state({
        level: 'system', focusStack: ['root'], selectedId: null,
        filters: { rules: true, primitives: false },
        transform: { x: 17, y: 29, scale: 1.4 }
    });
    const model = fixture();
    const codeSubjects = new Map();
    const navigation = Navigation.createIntentController({
        state: saved, modelRevision: 7,
        getNode: (id) => model.byId.get(id), focusPath: model.focusPath, rootFor: model.rootFor,
        project: () => true, resolveCodeSubject: (id) => codeSubjects.get(id) || null
    });
    navigation.reconcileModel(7);
    navigation.inspectFlow({
        id: 'flow:work', kind: 'semantic-flow', ownerInstanceId: 'root'
    }, 'edge:work');
    navigation.enterBehavior('method', {
        entryCallSiteId: 'call:work', bindingEnvironmentId: 'env:work'
    });
    const expression = {
        id: 'expr:work', kind: 'identifier', sourceRevision: 'source:r1'
    };
    codeSubjects.set(expression.id, expression);
    navigation.inspectCode(expression, 'method');
    saved.transform = { x: 99, y: 101, scale: 2 };

    navigation.goBack();
    assert.equal(saved.selectedRelationId, 'edge:work');
    assert.deepEqual(saved.analysisContext.subject, { kind: 'semantic-flow', id: 'flow:work' });
    assert.deepEqual(saved.filters, { rules: true, primitives: false });
    assert.deepEqual(saved.transform, { x: 17, y: 29, scale: 1.4 });
    navigation.goForward();
    assert.deepEqual(saved.analysisContext.subject, { kind: 'identifier', id: 'expr:work' });
    assert.deepEqual(saved.transform, { x: 99, y: 101, scale: 2 });
});

test('code subjects retain caller occurrence, source revision, callsite, and parent semantic history', () => {
    const saved = state({ level: 'module', focusStack: ['root', 'child'], selectedId: 'child' });
    const model = fixture();
    const codeSubjects = new Map();
    const navigation = Navigation.createIntentController({
        state: saved,
        modelRevision: 7,
        getNode: (id) => model.byId.get(id),
        focusPath: model.focusPath,
        rootFor: model.rootFor,
        project: () => true,
        resolveCodeSubject: (id) => codeSubjects.get(id) || null
    });
    navigation.reconcileModel(7);
    navigation.inspectChannel({ id: 'channel', kind: 'protocol-channel', ownerInstanceId: 'child' }, 'channel');
    navigation.enterBehavior('method', { fromSemanticParent: true });
    const expression = {
        id: 'expr:return', kind: 'return-expression', ownerInstanceId: 'child',
        sourceRevision: 'source:r1'
    };
    codeSubjects.set(expression.id, expression);

    navigation.inspectCode(expression, 'method', {
        entryCallSiteId: 'call:work', bindingEnvironmentId: 'env:work'
    });
    assert.deepEqual(saved.analysisContext.subject, {
        kind: 'return-expression', id: 'expr:return'
    });
    assert.equal(saved.analysisContext.presentationId, 'method');
    assert.equal(saved.analysisContext.sourceRevision, 'source:r1');
    assert.equal(saved.analysisContext.ownerInstanceId, 'child');
    assert.equal(saved.analysisContext.entryCallSiteId, 'call:work');
    assert.equal(saved.analysisContext.bindingEnvironmentId, 'env:work');

    codeSubjects.set(expression.id, { ...expression, sourceRevision: 'source:r2' });
    navigation.reconcileModel(8);
    assert.equal(saved.selectedId, 'method');
    assert.deepEqual(saved.analysisContext.subject, { kind: 'method', id: 'method' });
    assert.equal(saved.navigationRecovery.reason, 'code-source-revision-stale');
    navigation.goBack();
    assert.deepEqual(saved.analysisContext.subject, { kind: 'protocol-channel', id: 'channel' });
});

test('direct code definition entry clears occurrence context and Back restores prior Code snapshot', () => {
    const saved = state({
        level: 'behavior', focusStack: ['root', 'child'], selectedId: 'method',
        filters: { rules: true }, transform: { x: 23, y: 31, scale: 1.6 }
    });
    const model = fixture();
    const codeSubjects = new Map();
    const navigation = Navigation.createIntentController({
        state: saved, modelRevision: 7,
        getNode: (id) => model.byId.get(id), focusPath: model.focusPath, rootFor: model.rootFor,
        project: () => true, resolveCodeSubject: (id) => codeSubjects.get(id) || null
    });
    navigation.reconcileModel(7);
    const expression = { id: 'expr:return', kind: 'identifier', sourceRevision: 'source:r1' };
    codeSubjects.set(expression.id, expression);
    navigation.inspectCode(expression, 'method', {
        entryCallSiteId: 'call:method', bindingEnvironmentId: 'env:method'
    });
    const before = structuredClone(saved);
    const fn = {
        id: 'def:Pure:callChoose', kind: 'function-definition', name: 'callChoose',
        sourceRevision: 'source:pure', statementIds: ['statement:return']
    };
    codeSubjects.set(fn.id, fn);

    assert.equal(navigation.enterCodeDefinition(fn).status, 'committed');
    assert.deepEqual(saved.focusStack, []);
    assert.equal(saved.selectedId, null);
    assert.equal(saved.analysisContext.rootInstanceId, null);
    assert.equal(saved.analysisContext.ownerInstanceId, null);
    assert.deepEqual(saved.analysisContext.occurrencePath, []);
    assert.deepEqual(saved.analysisContext.subject, {
        kind: 'function-definition', id: fn.id
    });
    assert.equal(saved.analysisContext.presentationId, null);
    assert.equal(saved.analysisContext.entryCallSiteId, null);
    assert.equal(saved.analysisContext.bindingEnvironmentId, null);
    assert.equal(saved.analysisContext.sourceRevision, 'source:pure');

    navigation.goBack();
    assert.deepEqual(saved.analysisContext, before.analysisContext);
    assert.deepEqual(saved.focusStack, before.focusStack);
    assert.equal(saved.selectedId, before.selectedId);
    assert.deepEqual(saved.filters, before.filters);
    assert.deepEqual(saved.transform, before.transform);
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
