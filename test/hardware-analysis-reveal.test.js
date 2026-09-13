'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter, once } = require('node:events');
const http = require('node:http');
const { createCatalog, createServer } = require('../experiments/hardware/g4/server');
const { loadCapturedCase } = require('../experiments/hardware/g3/query');
const { loadOriginCase } = require('../experiments/hardware/g3/origin-query');
const { createSceneQuery } = require('../src/hardware/scene-query');
const { createNavigation } = require('../media/hardware-navigation');
const { revealIntent, projectAnalysis } = require('../media/hardware-analysis');
const { layout, fitViewport } = require('../media/hardware-layout');
const catalog = createCatalog();
const bounded = { timeout: 60000 };
const frame = ({ current, scene, geometry }) => ({ current, scene, geometry });
const saved = state => ({ ...frame(state), history: state.history });
const event = (emitter, name) => once(emitter, name, { signal: AbortSignal.timeout(10000) });

async function harness(build = 'C', provider = 'instrumented', sourcePath = ['wide', 'implementation']) {
    const query = (await catalog).find(q => q.getCatalogEntry().buildId === build);
    const entry = query.getCatalogEntry();
    const imported = provider === 'stock' ? await loadCapturedCase(build) : await loadOriginCase(build);
    const model = imported.request.importResult.implementation;
    const h = { query, entry, model, sceneCalls: [], resolveCalls: [], hook: null, sceneHook: null, badLayout: false };
    h.nav = createNavigation({
        queryScene(request, options) { h.sceneCalls.push(request); return h.sceneHook ? h.sceneHook(request, options) : query.getScene(request); },
        queryAnalysis: (request, options) => query.analyze(request, options),
        resolveAnalysisTarget(request, options) {
            h.resolveCalls.push(request); return h.hook ? h.hook(request, options) : query.revealAnalysisTarget(request);
        },
        layoutScene(scene, size) { const geometry = layout(scene, size); if (h.badLayout) geometry.bounds.width = NaN; return geometry; },
        fitViewport, getSize: () => ({ width: 1100, height: 650 })
    });
    assert.equal(await h.nav.navigate({ buildId: build, snapshotId: entry.snapshotId, sceneKind: 'bsv',
        rootInstanceId: entry.rootInstanceId, ownerInstanceId: entry.rootInstanceId }), true);
    for (const label of sourcePath) {
        const child = h.nav.getState().scene.children.find(c => c.label === label);
        assert.ok(child);
        assert.equal(await h.nav.navigate({ ownerInstanceId: child.id, rootInstanceId: child.id }), true);
    }
    const source = h.nav.getState();
    if (source.scene.storages.length) await h.nav.select(source.scene.storages[0].id);
    assert.equal(await h.nav.navigate({ sceneKind: 'rtl', implementationProvider: provider }), true);
    return h;
}
function request(h, target) {
    const { current, queryGeneration } = h.nav.getState();
    return { buildId: current.buildId, snapshotId: current.implementationContext.snapshotId,
        implementationProvider: current.implementationContext.provider, queryGeneration: queryGeneration + 1,
        rootInstanceId: current.rootInstanceId, ownerInstanceId: current.ownerInstanceId,
        target: { entityId: target.entityId, occurrenceId: target.occurrenceId, snapshotId: target.snapshotId,
            provider: target.provider || current.implementationContext.provider } };
}
async function analyze(h) {
    const { scene, current } = h.nav.getState();
    const port = scene.contacts.find(c => c.ownerId === scene.shell.id && c.label === 'get');
    assert.ok(port);
    assert.equal(await h.nav.analyze({ kind: 'same-net', seed: { entityId: port.id, indices: [0] },
        scope: { kind: 'design', rootOccurrenceId: current.implementationContext.rootOccurrenceId } }), true,
    h.nav.getState().error?.message);
    return h.nav.getState().current.analysis.result;
}
function assertResolved(h, target, result, expectedOwner) {
    assert.equal(result.status, 'resolved');
    assert.equal(result.context.ownerInstanceId, expectedOwner);
    assert.equal(result.context.ownerChanged, expectedOwner !== h.nav.getState().current.ownerInstanceId);
    assert.equal(result.context.status, result.context.ownerChanged ? 'owner-broadened' : 'owner-preserved');
    assert.deepEqual(structuredClone(result.target), request(h, target).target);
    assert.ok(Object.isFrozen(result));
    const scene = h.query.getScene(result.intent).scene;
    assert.equal(scene.shell.id, target.occurrenceId);
    assert.equal(scene.selection.selectedEntityId, target.entityId);
    assert.equal(scene.snapshotId, target.snapshotId);
    assert.equal(scene.ownerInstanceId, expectedOwner);
    return scene;
}

test('Reveal product resolves real A/C parent, sibling and hidden targets using existing source ancestors', bounded, async () => {
    for (const [build, sourcePath, sibling] of [['A', ['left'], 'right'], ['C', ['wide', 'implementation'], 'narrow']]) {
        for (const provider of ['stock', 'instrumented']) {
            const h = await harness(build, provider, sourcePath), result = await analyze(h);
            const state = h.nav.getState(), root = h.model.roots[0];
            const parent = result.objects.find(o => o.occurrenceId === root);
            assert.ok(parent, 'actual design-scope result reaches the parent');
            assertResolved(h, parent, h.query.revealAnalysisTarget(request(h, parent)), h.entry.rootInstanceId);
            const siblingOccurrence = Object.values(h.model.occurrences).find(o => o.name === sibling);
            const clock = Object.values(h.model.ports).find(p => p.occurrenceId === state.scene.shell.id && p.name === 'CLK');
            const clockResult = await h.query.analyze({ ...state.current.analysis.request, seed: { entityId: clock.id, indices: [0] } });
            const siblingRef = clockResult.objects.find(o => o.occurrenceId === siblingOccurrence.id);
            assert.ok(siblingRef, 'real clock same-net result reaches the sibling');
            assertResolved(h, siblingRef, h.query.revealAnalysisTarget(request(h, siblingRef)), h.entry.rootInstanceId);
            const local = result.objects.find(o => o.occurrenceId === state.scene.shell.id);
            assert.ok(local);
            const projection = projectAnalysis(state.scene, result, []);
            assert.ok(projection.counts.hidden > 0);
            const localScene = assertResolved(h, local, h.query.revealAnalysisTarget(request(h, local)), state.current.ownerInstanceId);
            if (build === 'C') {
                assert.equal(state.current.implementationContext.implementationOccurrenceId, null);
                assert.equal(localScene.implementationContext.implementationOccurrenceId, null);
                assert.equal(localScene.implementationContext.ownership, 'containing-only');
                assert.equal(localScene.children.some(c => c.label === 'implementation'), false);
            }
        }
    }
});

test('Reveal preserves a broad current source owner while moving between actual RTL descendants', bounded, async () => {
    for (const provider of ['stock', 'instrumented']) {
        const h = await harness('A', provider, []);
        const sourceOwner = h.nav.getState().current.ownerInstanceId;
        const left = h.nav.getState().scene.children.find(c => c.label === 'left');
        assert.equal(await h.nav.navigate({ implementationContext: { snapshotId: h.model.snapshot.id, contextOccurrenceId: left.id } }), true);
        const result = await analyze(h), parent = result.objects.find(o => o.occurrenceId === h.model.roots[0]);
        assertResolved(h, parent, h.query.revealAnalysisTarget(request(h, parent)), sourceOwner);
        assert.equal(await h.nav.revealAnalysis(parent), true);
        assert.equal(h.nav.getState().current.ownerInstanceId, sourceOwner);
        assert.equal(h.nav.getState().current.analysisReveal.context.ownerChanged, false);
    }
});

test('Reveal actual imported target has explicit unavailable context when compiler anchors are not attached', bounded, async () => {
    const { attachCorrespondence } = require('../src/hardware/correspondence');
    const stock = await loadCapturedCase('C');
    const analysis = await attachCorrespondence({ registry: stock.request.registry, importResult: stock.request.importResult, sources: stock.request.sources });
    const query = createSceneQuery({ buildId: 'C', label: 'No compiler anchors', importResult: stock.request.importResult, analysis });
    const entry = query.getCatalogEntry(), model = stock.request.importResult.implementation;
    const target = Object.values(model.ports).find(p => p.occurrenceId === model.roots[0]);
    const result = query.revealAnalysisTarget({ buildId: 'C', snapshotId: model.snapshot.id, implementationProvider: 'stock', queryGeneration: 1,
        ownerInstanceId: entry.rootInstanceId, rootInstanceId: entry.rootInstanceId,
        target: { entityId: target.id, occurrenceId: target.occurrenceId, snapshotId: model.snapshot.id, provider: 'stock' } });
    assert.equal(result.status, 'unavailable');
    assert.equal(result.intent, null);
    assert.equal(result.context.anchorOccurrenceId, null);
    assert.equal(result.context.ownerInstanceId, null);
    assert.equal(result.target.entityId, target.id);
});

test('Reveal C instrumented withheld parent restores full analysis/code/viewport with Back and Forward; Up remains actual hierarchy', bounded, async () => {
    const h = await harness();
    h.nav.patchCurrent({ disclosureState: { code: { open: true, scrollTop: 43 }, rtlSignals: true }, activePanel: 'source' });
    h.nav.setViewport({ x: 47, y: -31, scale: 1.4 });
    const result = await analyze(h), initial = frame(h.nav.getState());
    const target = result.objects.find(o => o.occurrenceId === h.model.roots[0]);
    assert.equal(revealIntent(initial.scene, target, result), null, 'frontend cannot establish this provider-local owner anchor');
    assert.equal(await h.nav.revealAnalysis(target), true, h.nav.getState().error?.message);
    const revealed = frame(h.nav.getState());
    assert.equal(revealed.scene.shell.id, target.occurrenceId);
    assert.equal(revealed.current.selectedEntityId, target.entityId);
    assert.equal(revealed.current.ownerInstanceId, h.entry.rootInstanceId);
    assert.equal(revealed.current.analysisReveal.context.status, 'owner-broadened');
    assert.equal(revealed.current.analysis, undefined);
    const calls = h.sceneCalls.length;
    assert.equal(h.nav.back(), true); assert.deepEqual(frame(h.nav.getState()), initial);
    assert.equal(h.nav.forward(), true); assert.deepEqual(frame(h.nav.getState()), revealed);
    assert.equal(h.sceneCalls.length, calls);
    assert.equal(await h.nav.up(), false); assert.equal(h.nav.getState().outcome.code, 'RTL_ROOT');
    h.nav.back();
    const local = result.objects.find(o => o.occurrenceId === initial.scene.shell.id);
    assert.equal(await h.nav.revealAnalysis(local), true);
    assert.deepEqual(h.nav.getState().current.analysis, initial.current.analysis);
    assert.equal(h.nav.back(), true); assert.deepEqual(frame(h.nav.getState()), initial);
});

test('Reveal rejects foreign target/provider/snapshot/owner and unavailable provider without guessed anchors', bounded, async () => {
    const h = await harness(), result = await analyze(h);
    const target = result.objects.find(o => o.occurrenceId === h.model.roots[0]), valid = request(h, target);
    for (const mutate of [r => { r.buildId = 'A'; }, r => { r.snapshotId = 'foreign'; },
        r => { r.implementationProvider = 'stock'; }, r => { r.ownerInstanceId = 'foreign'; },
        r => { r.rootInstanceId = 'foreign'; }, r => { r.target.entityId = 'foreign'; },
        r => { r.target.snapshotId = 'foreign'; }, r => { r.target.provider = 'stock'; },
        r => { r.target.occurrenceId = h.nav.getState().scene.shell.id; },
        r => { r.target.occurrenceId = null; }, r => { r.queryGeneration = -1; }, r => { r.file = '/etc/passwd'; }]) {
        const input = structuredClone(valid); mutate(input);
        assert.throws(() => h.query.revealAnalysisTarget(input), error => !!error.code);
    }
    const stock = await loadCapturedCase('C');
    const noOrigin = createSceneQuery({ buildId: 'C', label: 'C stock only', importResult: stock.request.importResult, analysis: stock.analysis });
    assert.throws(() => noOrigin.revealAnalysisTarget(valid), { code: 'UNSUPPORTED' });
    const before = saved(h.nav.getState());
    for (const ref of [{ ...target, provider: 'stock' }, { ...target, snapshotId: 'foreign' }, { ...target, entityId: 'foreign' }]) {
        assert.equal(await h.nav.revealAnalysis(ref), false);
        assert.deepEqual(saved(h.nav.getState()), before);
    }
});

test('Reveal deferred resolver shares navigation generation and cannot publish after Back or a new intent', bounded, async () => {
    for (const action of ['back', 'navigate', 'reveal']) {
        const h = await harness(), result = await analyze(h);
        const target = result.objects.find(o => o.occurrenceId === h.model.roots[0]);
        const events = new EventEmitter();
        h.hook = (input, { signal }) => new Promise(resolve => events.emit('request', {
            signal, input, respond: () => resolve(h.query.revealAnalysisTarget(input))
        }));
        const requested = event(events, 'request'), pending = h.nav.revealAnalysis(target), [first] = await requested;
        const aborted = event(first.signal, 'abort');
        const generation = h.nav.getState().queryGeneration;
        h.hook = null;
        if (action === 'back') assert.equal(h.nav.back(), true);
        else if (action === 'navigate') assert.equal(await h.nav.up(), true);
        else assert.equal(await h.nav.revealAnalysis(target), true);
        await aborted;
        const newer = h.nav.getState();
        assert.equal(newer.queryGeneration, generation + 1);
        first.respond(); assert.equal(await pending, false);
        assert.deepEqual(h.nav.getState(), newer);
    }
});

test('Reveal malformed resolution, stale echoes, resolver failure and invalid scene/layout are atomic', bounded, async () => {
    const h = await harness(), result = await analyze(h);
    const target = result.objects.find(o => o.occurrenceId === h.model.roots[0]);
    const before = saved(h.nav.getState());
    for (const mutate of [r => { r.queryGeneration--; }, r => { r.requestSnapshotId = 'foreign'; },
        r => { r.target.entityId = h.nav.getState().scene.contacts[0].id; }, r => { r.target.snapshotId = 'foreign'; },
        r => { r.target.provider = 'stock'; }, r => { r.target.occurrenceId = h.nav.getState().scene.shell.id; },
        r => { r.intent.ownerInstanceId = 'foreign'; }, r => { r.intent.implementationProvider = 'stock'; },
        r => { r.intent.implementationContext.contextOccurrenceId = h.nav.getState().scene.shell.id; },
        r => { r.context.ownerChanged = false; }, r => { r.status = 'unavailable'; r.intent = null; },
        r => { r.status = 'ambiguous'; r.intent = null; }]) {
        h.hook = input => { const value = structuredClone(h.query.revealAnalysisTarget(input)); mutate(value); return value; };
        assert.equal(await h.nav.revealAnalysis(target), false);
        assert.deepEqual(saved(h.nav.getState()), before);
    }
    for (const code of ['CANCELLED', 'UNAVAILABLE']) {
        h.hook = () => { throw Object.assign(new Error(code), { code }); };
        assert.equal(await h.nav.revealAnalysis(target), false);
        assert.equal(h.nav.getState().outcome.status, code === 'CANCELLED' ? 'cancelled' : 'unresolved');
        assert.deepEqual(saved(h.nav.getState()), before);
    }
    h.hook = null;
    h.sceneHook = input => { const value = structuredClone(h.query.getScene(input)); value.scene.selection.selectedEntityId = 'foreign'; return value; };
    assert.equal(await h.nav.revealAnalysis(target), false); assert.deepEqual(saved(h.nav.getState()), before);
    h.sceneHook = null; h.badLayout = true;
    assert.equal(await h.nav.revealAnalysis(target), false); assert.deepEqual(saved(h.nav.getState()), before);
});

test('Reveal localhost GET calls real product resolver and preserves bounded Host/Origin/file authority', bounded, async t => {
    const h = await harness(), result = await analyze(h);
    const target = result.objects.find(o => o.occurrenceId === h.model.roots[0]), input = request(h, target);
    const server = await createServer({ catalog: await catalog });
    const listening = event(server, 'listening'); server.listen(0, '127.0.0.1'); await listening;
    t.after(() => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())));
    const send = (pathname, headers = {}, method = 'GET') => new Promise((resolve, reject) => {
        const req = http.request({ hostname: '127.0.0.1', port: server.address().port, path: pathname, headers, method }, res => {
            let body = ''; res.on('data', chunk => { body += chunk; });
            res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: JSON.parse(body) }));
        }); req.on('error', reject); req.end();
    });
    const path = value => `/api/analysis-reveal?build=C&query=${encodeURIComponent(JSON.stringify(value))}`;
    const response = await send(path(input));
    assert.equal(response.status, 200);
    assert.deepEqual(response.body, JSON.parse(JSON.stringify(h.query.revealAnalysisTarget(input))));
    assert.match(response.headers['content-security-policy'], /default-src 'none'/);
    assert.doesNotMatch(response.headers['content-security-policy'], /unsafe-inline/);
    for (const headers of [{ Host: 'foreign.example' }, { Origin: 'https://foreign.example' }]) assert.equal((await send(path(input), headers)).status, 403);
    assert.equal((await send(path(input), {}, 'POST')).status, 405);
    assert.equal((await send(path({ ...input, snapshotId: 'foreign' }))).status, 409);
    assert.equal((await send(path({ ...input, buildId: 'A' }))).status, 400);
    assert.equal((await send(path({ ...input, file: '/etc/passwd' }))).status, 400);
    assert.equal((await send('/api/analysis-reveal?build=C&query=' + 'x'.repeat(17000))).status, 414);
    assert.equal((await send('/api/analysis-reveal?build=unknown&query=%7B%7D')).status, 404);
    assert.equal((await send('/api/source?path=/etc/passwd')).status, 404);
});
