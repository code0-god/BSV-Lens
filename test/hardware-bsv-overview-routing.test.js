'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { layout, ROUTING_LIMITS } = require('../media/hardware-layout');
const { validateGeometry } = require('../experiments/hardware/g4-fix/oracle/geometry.cjs');

function overview(count = 8) {
    const scene = { sceneKind: 'bsv', projection: { kind: 'bsv-overview', ownerInstanceId: 'owner', sourceRevision: 'revision-a' },
        shell: { id: 'owner', label: 'Pipeline', sourceRefs: [{ revision: 'revision-a' }] }, children: [],
        storages: Array.from({ length: count }, (_, i) => ({ id: `state${i}`, label: `counter${i}` })),
        contacts: [], interfaceGroups: [], connections: [] };
    for (let i = 0; i < count; i++) for (const family of ['read', 'write']) {
        const endpointIds = family === 'read' ? [`state${i}`, 'owner'] : ['owner', `state${i}`];
        scene.connections.push({ id: `${family}${i}`, label: `state-${family}`, style: 'semantic',
            endpointIds, memberRelationIds: [`fact-${family}${i}`], incidences: endpointIds.map(contactId => ({ contactId, members: [] })) });
    }
    return scene;
}

test('BSV overview routes independent readers/writers without reserving space for folded relation names', () => {
    for (const size of [{ width: 1200, height: 800 }, { width: 512, height: 474.5 }, { width: 420, height: 650 }]) {
        const scene = overview(), before = JSON.stringify(scene), geometry = layout(scene, size);
        assert.deepEqual(geometry.routes.map(route => route.id), scene.connections.map(connection => connection.id));
        assert.equal(JSON.stringify(scene), before);
        const result = validateGeometry(scene, geometry);
        assert.equal(result.valid, true, JSON.stringify(result.findings));
        assert.equal(geometry.labels.filter(label => label.foldedReason === 'overview-detail').length, scene.connections.length);
        assert.ok(geometry.labels.filter(label => label.role === 'node-title').every(label => label.bounds));
    }
});

function injectSearchFailure(connectionId, code = 'ROUTING_BLOCKED') {
    const source = fs.readFileSync(require.resolve('../media/hardware-layout'), 'utf8');
    const anchor = 'function search(start, targets, owner) {';
    assert.equal(source.split(anchor).length, 2);
    const instrumented = source.replace(anchor, `${anchor}\nif (routes[owner - 1].id === ${JSON.stringify(connectionId)})
        throw error(${JSON.stringify(code)}, 'Injected secondary route failure', { connectionId: routes[owner - 1].id });`);
    const context = { module: { exports: {} } };
    vm.runInNewContext(instrumented, context, { filename: 'test-only-injected-layout.js' });
    return context.module.exports.layout;
}

test('a failed secondary semantic route is explicit, lossless and leaves no dangling stub or occupied track', () => {
    const scene = overview(), original = JSON.stringify(scene);
    const geometry = JSON.parse(JSON.stringify(injectSearchFailure('read3')(scene, { width: 512, height: 474.5 })));
    assert.equal(geometry.routing.status, 'partial');
    assert.equal(geometry.routing.deferred.length, 1);
    assert.deepEqual(geometry.routing.deferred[0], { connectionId: 'read3', memberRelationIds: ['fact-read3'],
        code: 'ROUTING_BLOCKED', message: 'Injected secondary route failure' });
    assert.equal(geometry.routes.length, scene.connections.length - 1);
    assert.ok(!geometry.labels.some(label => label.ownerId === 'read3'));
    assert.equal(JSON.stringify(scene), original);
    const result = validateGeometry(scene, geometry);
    assert.equal(result.valid, true, JSON.stringify(result.findings));
    for (const mutate of [
        copy => { copy.routing.status = 'complete'; },
        copy => { copy.routing.deferred[0].memberRelationIds = []; },
        copy => { copy.routing.deferred[0].code = 'INVALID_ROUTING_INPUT'; },
        copy => { copy.routing.deferred.push(copy.routing.deferred[0]); },
        copy => { copy.routing.routedRelationIds.push('read3'); },
        copy => { copy.routing.deferred = []; },
        copy => { copy.routing.deferred[0].connectionId = 'foreign'; }
    ]) {
        const copy = structuredClone(geometry); mutate(copy);
        assert.equal(validateGeometry(scene, copy).valid, false);
    }
});

test('scope/source/input/budget and physical or RTL routing failures cannot become a partial BSV scene', () => {
    const faulty = injectSearchFailure('read3'), size = { width: 512, height: 474.5 };
    for (const mutate of [
        scene => { scene.projection.ownerInstanceId = 'foreign'; },
        scene => { scene.projection.sourceRevision = 'stale'; },
        scene => { scene.connections[0].endpointIds = ['unknown', 'owner']; }
    ]) {
        const scene = overview(); mutate(scene);
        assert.throws(() => faulty(scene, size), { code: 'INVALID_ROUTING_INPUT' });
    }
    for (const sceneKind of ['bsv', 'rtl']) {
        const scene = overview(); scene.sceneKind = sceneKind;
        scene.connections.find(connection => connection.id === 'read3').style = 'physical';
        assert.throws(() => faulty(scene, size), { code: 'ROUTING_BLOCKED' });
    }
    assert.throws(() => injectSearchFailure('read3', 'INVALID_ROUTING_GEOMETRY')(overview(), size), { code: 'INVALID_ROUTING_GEOMETRY' });
    assert.throws(() => faulty(overview(), size, { limits: { maxExpansions: 0 } }), { code: 'ROUTING_BUDGET_EXCEEDED' });
});

test('independent oracle requires a BSV overview for an overview-folded label', () => {
    const scene = overview(2), geometry = layout(scene, { width: 1200, height: 800 });
    for (const mutate of [
        copy => { copy.sceneKind = 'rtl'; }, copy => { delete copy.projection; },
        copy => { copy.projection.sourceRevision = 'foreign'; }
    ]) {
        const copy = structuredClone(scene); mutate(copy);
        assert.equal(validateGeometry(copy, geometry).valid, false);
    }
});

test('current source overview keeps invocation and return families separate within unchanged routing budgets', async () => {
    const { createCatalog } = require('../experiments/hardware/g4/server');
    const query = (await createCatalog()).find(query => query.getCatalogEntry().buildId === 'A');
    const entry = query.getCatalogEntry();
    const scene = query.getScene({ buildId: entry.buildId, snapshotId: entry.snapshotId, queryGeneration: 1, sceneKind: 'bsv' }).scene;
    assert.deepEqual(scene.connections.map(connection => connection.relationFamily).sort(), ['invoke', 'invoke', 'return', 'return']);
    const members = scene.connections.flatMap(connection => connection.memberRelationIds);
    assert.equal(new Set(members).size, members.length);
    assert.deepEqual([...members, ...scene.projection.foldedRelationIds, ...scene.projection.scopeOutsideRelationIds].sort(),
        [...scene.projection.canonicalRelationIds].sort());
    const geometry = layout(scene, { width: 1100, height: 650 });
    assert.equal(geometry.routing.status, 'complete');
    assert.equal(validateGeometry(scene, geometry).valid, true);
    assert.ok(geometry.metrics.passes <= ROUTING_LIMITS.maxPasses);
    assert.ok(geometry.metrics.expansions <= ROUTING_LIMITS.maxExpansions);
    assert.ok(geometry.metrics.checks <= ROUTING_LIMITS.maxChecks);
    console.log(JSON.stringify({ inputContract: 'current-exact-family-overview', connections: scene.connections.length,
        geometry: geometry.metrics, historicalTotalLengthTarget: 'Not comparable: historical presentation grouped different relation families' }));
});
