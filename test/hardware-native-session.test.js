'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHardwareSession } = require('../src/panel/hardware-session');
const { HardwareProtocol } = require('../src/panel/hardware-protocol');
const { PROTOCOL } = require('../src/panel/hardware-build');
const { visitFor } = require('../src/panel/hardware-state');

const source = 'package NativeSession; interface Value; method Bit#(8) get; endinterface\n'
    + 'module mkUser(Value); Reg#(Bit#(8)) state <- mkReg(0);\n'
    + 'rule advance; state <= state + 1; endrule method Bit#(8) get = state; endmodule endpackage';
function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }
async function fixture(t) {
    const runs = path.resolve(__dirname, '../.build/hardware/runs'); await fs.mkdir(runs, { recursive: true });
    const root = path.join(await fs.mkdtemp(path.join(runs, 'g6-native-session-')), 'g6'); await fs.mkdir(root);
    const sourceRoot = path.join(root, 'source'); await fs.mkdir(sourceRoot); await fs.writeFile(path.join(sourceRoot, 'User.bsv'), source);
    const messages = [], opened = [], saved = [], controls = { choose: async () => ({ sourceRoot }), pick: async () => null,
        sourcePick: entries => entries.length === 1 ? entries[0].id : null,
        save: null, restore: null, diagnostic: null, lastRequestId: null };
    let session, sequence = 0, revision = 0;
    const protocol = new HardwareProtocol({ build: { buildId: 'contract-test-build' }, send: message => messages.push(message),
        dispatch: (...args) => session.dispatch(...args), welcome: () => ({ catalog: session.getCatalog() }) });
    session = createHardwareSession({ protocol, chooseInput: (...args) => controls.choose(...args), selectBuild: (...args) => controls.pick(...args),
        selectSourceEntry: (...args) => controls.sourcePick?.(...args),
        openSource: async (buildId, reference) => { opened.push({ buildId, reference }); return { status: 'observed-callback' }; },
        exportSvg: async () => ({ status: 'exported' }), saveState: async state => { saved.push(state); await controls.save?.(); },
        getRestoreState: (...args) => controls.restore?.(...args), onDiagnostic: event => controls.diagnostic?.(event),
        onInput: (...args) => controls.onInput?.(...args) });
    const hello = { protocol: PROTOCOL, panelId: null, sessionId: null, buildId: 'contract-test-build', requestId: 'hello', generation: 0,
        snapshotId: null, action: 'hello', payload: { expectedBuildId: 'contract-test-build', expectedProtocol: PROTOCOL } };
    await protocol.receive(hello);
    const request = async (action, payload = {}, change = {}) => {
        if (action === 'persist' && payload.revision === undefined) payload = { ...payload, revision: ++revision };
        const requestId = `request-${++sequence}`;
        controls.lastRequestId = requestId;
        await protocol.receive({ ...protocol.identity(), requestId, snapshotId: session.getCurrent()?.snapshotId ?? null, action, payload, ...change });
        return messages.find(message => message.requestId === requestId);
    };
    t.after(async () => { await Promise.all([session.dispose(), protocol.dispose()]); });
    t.diagnostic(`native session inputs: ${root}`);
    const register = async () => { const result = await request('choose-source'); assert.equal(result.status, 'ok'); return session.getCatalog()[0]; };
    const scene = async (entry, extra = {}, commit = true) => {
        const intent = { buildId: entry.buildId, snapshotId: entry.snapshotId, queryGeneration: 1,
            sceneKind: entry.sceneKind || 'bsv', rootInstanceId: entry.rootInstanceId, ...extra };
        const response = await request('scene', { buildId: entry.buildId, intent });
        if (commit && response.status === 'ok') assert.equal((await request('persist', {
            state: { schema: 1, view: viewFor(visitFor(response.payload.scene, intent)) } })).status, 'ok');
        return response;
    };
    return { root, sourceRoot, session, protocol, request, register, scene, messages, opened, saved, controls };
}
function viewFor(current) {
    return Object.fromEntries(['buildId', 'snapshotId', 'sourceRevision', 'sceneKind', 'provider', 'rootInstanceId', 'ownerInstanceId',
        'selectedEntityId', 'selectedRelationId', 'viewport', 'activePanel'].map(key => [key, current[key]]));
}
test('native registration publishes after old-generation reply and only a displayed scene commit establishes current owner', async t => {
    const f = await fixture(t);
    assert.deepEqual((await f.request('catalog')).payload, []);
    const entry = await f.register();
    const registration = f.messages.findIndex(message => message.action === 'choose-source' && message.kind === 'response');
    const catalog = f.messages.findIndex(message => message.action === 'catalog' && message.kind === 'event');
    assert.ok(registration < catalog); assert.equal(f.messages[registration].generation, 0); assert.equal(f.messages[catalog].generation, 1);
    assert.equal(f.session.getInput().summary.status, 'source-only'); assert.equal(f.session.getCurrent(), null);
    const result = await f.scene(entry, {}, false); assert.equal(result.status, 'ok');
    assert.equal(f.session.getCurrent(), null);
    await f.scene(entry);
    assert.equal(f.session.getCurrent().ownerInstanceId, entry.rootInstanceId);
    assert.equal(f.session.getCurrent().sourceRevision, entry.sourceRevision);
    assert.equal(f.session.getInput().sourceModel.instances.some(instance => instance.name === 'mkUser'), true);
});
test('invalid replacement, cancelled root choice and mutable chooser preserve previous native result', async t => {
    const f = await fixture(t), entry = await f.register(); await f.scene(entry);
    const before = f.session.getInput(), current = f.session.getCurrent(), generation = f.protocol.generation;
    f.controls.choose = async (_action, options) => { options.sourceRoot = '/never-authorized'; return null; };
    assert.equal((await f.request('choose-source')).payload.status, 'cancelled');
    assert.equal(f.session.getOptions().sourceRoot, f.sourceRoot);
    f.controls.choose = async () => ({ sourceRoot: f.sourceRoot, manifest: { version: 1, sources: [{ path: '../outside.bsv' }] } });
    assert.equal((await f.request('choose-manifest')).status, 'invalid');
    assert.equal(f.session.getInput(), before); assert.equal(f.session.getCurrent(), current); assert.equal(f.protocol.generation, generation);
    await fs.writeFile(path.join(f.sourceRoot, 'Second.bsv'), 'package Second; module mkSecond(Empty); endmodule endpackage');
    f.controls.choose = async () => ({ sourceRoot: f.sourceRoot });
    assert.equal((await f.request('choose-source')).payload.status, 'cancelled');
    assert.equal(f.session.getInput(), before); assert.equal(f.protocol.generation, generation);
});
test('native session and public scene reject foreign identity, payload paths and unregistered source references', async t => {
    const f = await fixture(t), entry = await f.register(); await f.scene(entry);
    assert.equal((await f.request('catalog', {}, { sessionId: 'foreign' })).status, 'forbidden');
    assert.equal((await f.request('catalog', {}, { snapshotId: 'hw-foreign' })).status, 'stale');
    assert.equal((await f.request('choose-artifact', { path: '/etc/passwd' })).status, 'invalid');
    assert.equal((await f.request('scene', { buildId: 'foreign', intent: {} })).status, 'forbidden');
    assert.equal((await f.scene(entry, { selectedEntityId: 'foreign-entity' })).status, 'invalid');
    assert.equal((await f.request('source-open', { buildId: entry.buildId, reference: { pathRef: '/etc/passwd' } })).status, 'invalid');
    assert.equal(f.opened.length, 0);
});
test('real source query passes unchanged through native protocol and issued source reference reaches callback', async t => {
    const f = await fixture(t), entry = await f.register(), scene = (await f.scene(entry)).payload.scene;
    const context = (await f.request('analysis-context', { buildId: entry.buildId, provider: 'stock' })).payload;
    const query = { kind: 'state-accesses', analysisId: context.analysisId, snapshotId: null, implementationProvider: 'stock',
        ownerInstanceId: scene.ownerInstanceId, implementationOccurrenceId: null,
        seed: { entityId: scene.storages[0].id, sourceRevision: scene.sourceRevision },
        scope: { kind: 'source-only', rootOccurrenceId: null }, queryGeneration: 2 };
    const result = await f.request('analysis', { buildId: entry.buildId, query }); assert.equal(result.status, 'ok');
    assert.equal(result.payload.kind, 'state-accesses'); assert.ok(result.payload.sourceRefs.length);
    const reference = result.payload.sourceRefs[0];
    const opened = await f.request('source-open', { buildId: entry.buildId, reference }); assert.equal(opened.status, 'ok');
    assert.equal(f.opened[0].reference.id, reference.id);
    const view = { ...viewFor(f.session.getCurrent()), viewport: { x: 23, y: 42, scale: 1.5 },
        disclosureState: { capabilities: false, presentation: { fit: 'selection', inspectorOpen: false, selectionIds: [scene.storages[0].id] } },
        query: Object.fromEntries(Object.entries(query).filter(([key]) => key !== 'queryGeneration')) };
    const stored = await f.request('persist', { state: { schema: 1, view } }); assert.equal(stored.status, 'ok');
    assert.deepEqual({ ...f.session.getCurrent().viewport }, view.viewport); assert.equal(f.saved.at(-1).inputIdentity, f.session.getInput().inputIdentity);
    assert.equal(JSON.stringify(f.saved.at(-1)).includes(f.sourceRoot), false);
});
test('saved state rejects source blobs, fake revision and never-issued analysis', async t => {
    const f = await fixture(t), entry = await f.register(); await f.scene(entry); const view = viewFor(f.session.getCurrent()), saves = f.saved.length;
    for (const state of [{ schema: 2, view }, { schema: 1, view: { ...view, source: source } },
        { schema: 1, view: { ...view, sourceRevision: '0'.repeat(64) } },
        { schema: 1, view: { ...view, viewport: { x: 0, y: 0, scale: -1 } } },
        { schema: 1, view: { ...view, query: { kind: 'same-net' } } },
        { schema: 1, view: { ...view, disclosureState: { analysis: { source: { text: source } } } } }]) {
        assert.notEqual((await f.request('persist', { state })).status, 'ok');
    }
    assert.equal(f.saved.length, saves);
});
test('latest registration aborts earlier pending input and disposed session settles outstanding dialog', async t => {
    const f = await fixture(t), first = deferred(); let attempts = 0;
    f.controls.choose = async () => ++attempts === 1 ? first.promise : { sourceRoot: f.sourceRoot };
    const old = f.request('choose-source'); await new Promise(resolve => setImmediate(resolve));
    const current = await f.request('choose-source'); assert.equal(current.status, 'ok');
    assert.equal((await old).status, 'cancelled'); first.resolve({ sourceRoot: '/invalid-old-root' });
    assert.equal(f.session.getOptions().sourceRoot, f.sourceRoot); assert.equal(f.protocol.generation, 1);
    f.controls.choose = () => new Promise(() => {});
    const outstanding = f.request('choose-source'); await new Promise(resolve => setImmediate(resolve));
    await f.session.dispose(); await outstanding;
    assert.equal(f.session.getDiagnostics().activeOperations, 0); assert.equal(f.session.getDiagnostics().loading, false);
});
test('late persistence cannot overwrite a newer canonical selection', async t => {
    const f = await fixture(t), entry = await f.register(), initial = (await f.scene(entry)).payload.scene;
    const wait = deferred(); f.controls.save = () => wait.promise;
    const pending = f.request('persist', { state: { schema: 1, view: viewFor(f.session.getCurrent()) } });
    await new Promise(resolve => setImmediate(resolve));
    const next = f.scene(entry, { selectedEntityId: initial.storages[0].id, queryGeneration: 2 });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(f.session.getCurrent().selectedEntityId, initial.storages[0].id);
    wait.resolve(); assert.equal((await pending).status, 'cancelled'); await next;
    assert.equal(f.session.getCurrent().selectedEntityId, initial.storages[0].id);
    assert.equal(f.saved.at(-1).view.selectedEntityId, initial.storages[0].id);
});

test('native commits reject stale actor revisions without treating a late queried scene as a committed visit', async t => {
    const f = await fixture(t), entry = await f.register(), scene = (await f.scene(entry)).payload.scene;
    const previous = viewFor(f.session.getCurrent()), selected = { ...previous, selectedEntityId: scene.storages[0].id };
    assert.equal((await f.request('persist', { state: { schema: 1, view: selected }, revision: 10 })).status, 'ok');
    for (const revision of [9, 10]) {
        const reply = await f.request('persist', { state: { schema: 1, view: previous }, revision });
        assert.equal(reply.status, 'cancelled'); assert.equal(reply.error.code, 'SUPERSEDED');
    }
    for (const revision of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, '11']) {
        assert.equal((await f.request('persist', { state: { schema: 1, view: previous }, revision })).status, 'invalid');
    }
    assert.equal((await f.scene(entry, { queryGeneration: 20 }, false)).status, 'ok');
    assert.equal(f.session.getCurrent().selectedEntityId, selected.selectedEntityId);
    assert.equal((await f.request('persist', { state: { schema: 1, view: previous }, revision: 11 })).status, 'ok');
    assert.equal(f.session.getCurrent().selectedEntityId, null);
    assert.equal(Object.hasOwn(f.saved.at(-1), 'revision'), false);
    assert.equal(Object.hasOwn(f.saved.at(-1).view, 'revision'), false);
});

test('metadata save failure does not roll back a displayed commit and disposal cannot republish a late save', async t => {
    const f = await fixture(t), entry = await f.register(), scene = (await f.scene(entry)).payload.scene;
    const selected = { ...viewFor(f.session.getCurrent()), selectedEntityId: scene.storages[0].id };
    f.controls.save = async () => { throw new Error('Explicit metadata write failure'); };
    const failedSave = await f.request('persist', { state: { schema: 1, view: selected } });
    assert.equal(failedSave.status, 'host-error'); assert.equal(failedSave.error.code, 'COMMITTED_UNSAVED');
    assert.equal(f.session.getCurrent().selectedEntityId, selected.selectedEntityId);
    assert.ok(f.session.getDiagnostics().events.some(event => event.phase === 'save-failed'));
    const wait = deferred(); f.controls.save = () => wait.promise;
    const pending = f.request('persist', { state: { schema: 1, view: { ...selected, selectedEntityId: null } } });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(f.session.getCurrent().selectedEntityId, null);
    const disposing = Promise.all([f.protocol.dispose(), f.session.dispose()]); wait.resolve();
    await disposing; await pending;
    assert.equal(f.session.getCurrent(), null); assert.equal(f.session.getDiagnostics().activeOperations, 0);
});
test('native cancellation reaches actual analysis worker and waits for worker exit', async t => {
    const f = await fixture(t), artifactRoot = path.join(f.root, 'artifact'); await fs.mkdir(artifactRoot);
    await fs.writeFile(path.join(artifactRoot, 'design.json'), JSON.stringify({ modules: {
        top: { attributes: { top: '1' }, ports: { value: { direction: 'output', bits: [2, 3] } }, cells: {},
            netnames: { value: { hide_name: 0, bits: [2, 3], attributes: {} } } } } }));
    f.controls.choose = async () => ({ artifactRoot, artifactPath: 'design.json' });
    const entry = await f.register(); await f.scene(entry);
    const input = f.session.getInput(), occurrence = input.importResult.implementation.roots[0];
    const port = Object.values(input.importResult.implementation.ports)[0];
    const context = (await f.request('analysis-context', { buildId: entry.buildId, provider: 'stock' })).payload;
    f.controls.diagnostic = event => { if (event.action === 'analysis' && event.phase === 'started') {
        f.protocol.receive({ ...f.protocol.identity(), requestId: 'cancel-worker', snapshotId: entry.snapshotId, action: 'cancel',
            payload: { targetRequestId: f.controls.lastRequestId } });
    } };
    const result = await f.request('analysis', { buildId: entry.buildId, query: { kind: 'same-net', analysisId: context.analysisId,
        snapshotId: entry.snapshotId, implementationProvider: 'stock', implementationOccurrenceId: occurrence,
        seed: { entityId: port.id }, scope: { kind: 'occurrence', rootOccurrenceId: occurrence }, queryGeneration: 3 } });
    assert.equal(result.status, 'cancelled');
    assert.ok(f.session.getDiagnostics().events.some(event => event.action === 'analysis' && event.phase === 'exited' && event.cancelled));
    assert.equal(f.session.getDiagnostics().activeOperations, 0); assert.equal(f.session.getInput(), input);
});
test('separate native sessions never share current selection or foreign panel authority', async t => {
    const first = await fixture(t), second = await fixture(t);
    const firstEntry = await first.register(), secondEntry = await second.register();
    const scene = (await first.scene(firstEntry)).payload.scene;
    await first.scene(firstEntry, { selectedEntityId: scene.storages[0].id });
    assert.equal(second.session.getCurrent(), null);
    assert.equal((await second.request('scene', { buildId: secondEntry.buildId, intent: {} }, first.protocol.identity())).status, 'forbidden');
    assert.equal(second.session.getCurrent(), null); assert.equal(first.session.getCurrent().selectedEntityId, scene.storages[0].id);
});
test('host-only logical selection metadata remains separate from Webview authority and persisted view', async t => {
    const f = await fixture(t), manifestFile = path.join(f.root, 'selected-manifest.json');
    const stat = await fs.stat(f.sourceRoot), rootGrants = { sourceRoot: { path: await fs.realpath(f.sourceRoot), dev: stat.dev, ino: stat.ino } };
    f.controls.choose = async () => ({ sourceRoot: f.sourceRoot, rootGrants, manifestFile, pendingOriginManifest: { version: 1 } });
    const entry = await f.register(); await f.scene(entry);
    assert.equal(f.session.getOptions().manifestFile, manifestFile);
    assert.equal((await f.request('choose-manifest', { manifestFile })).status, 'invalid');
    assert.equal((await f.request('choose-source', { rootGrants })).status, 'invalid');
    const view = { ...viewFor(f.session.getCurrent()), viewport: { x: 12, y: 34, scale: 2 } };
    assert.equal((await f.request('persist', { state: { schema: 1, view } })).status, 'ok');
    assert.equal(JSON.stringify(f.saved.at(-1)).includes(manifestFile), false);
    assert.equal(JSON.stringify(f.saved.at(-1)).includes('rootGrants'), false);
    const stored = f.saved.at(-1); f.controls.restore = () => stored;
    await f.request('refresh-input');
    const event = f.messages.filter(message => message.kind === 'event' && message.action === 'catalog').at(-1);
    assert.deepEqual({ ...event.payload.restoreState.view.viewport }, view.viewport);
    f.controls.restore = () => ({ ...stored, inputIdentity: 'foreign' });
    await f.request('refresh-input');
    assert.equal(f.messages.filter(message => message.kind === 'event' && message.action === 'catalog').at(-1).payload.restoreState, undefined);
    assert.ok(f.session.getDiagnostics().events.some(event => event.phase === 'restore-rejected'));
});

test('automatic refresh keeps old source authority until the candidate scene is displayed and committed', async t => {
    const f = await fixture(t);
    f.controls.choose = async () => ({ sourceRoot: f.sourceRoot, discovery: { status: 'ready', included: [{ path: 'User.bsv' }] } });
    assert.equal((await f.request('discover-workspace')).status, 'ok');
    const original = f.session.getCatalog()[0]; await f.scene(original);
    const oldInput = f.session.getInput(), oldCurrent = f.session.getCurrent();
    const unchangedGeneration = f.protocol.generation;
    assert.equal((await f.request('discover-workspace')).payload.status, 'unchanged');
    assert.equal(f.protocol.generation, unchangedGeneration);
    await fs.writeFile(path.join(f.sourceRoot, 'User.bsv'), source.replace('state + 1', 'state + 2'));
    const prepared = await f.request('discover-workspace'); assert.equal(prepared.status, 'ok'); assert.equal(prepared.payload.status, 'prepared');
    const event = f.messages.findLast(message => message.kind === 'event' && message.action === 'catalog');
    assert.equal(event.payload.replaceMode, 'refresh'); assert.equal(event.payload.previousInputIdentity, oldInput.inputIdentity);
    assert.equal(f.session.getInput(), oldInput); assert.equal(f.session.getCurrent(), oldCurrent);
    assert.equal(f.session.getCatalog()[0].buildId, original.buildId);
    const candidate = event.payload.catalog[0];
    assert.equal((await f.scene(candidate, { ownerInstanceId: 'foreign-source-owner' }, false)).status, 'invalid');
    assert.equal(f.session.getInput(), oldInput); assert.equal(f.session.getCurrent(), oldCurrent);
    await f.scene(candidate);
    assert.notEqual(f.session.getInput().inputIdentity, oldInput.inputIdentity);
    assert.equal(f.session.getCurrent().buildId, candidate.buildId);
    assert.equal(f.session.getDiagnostics().pendingInputIdentity, null);
    assert.equal(f.saved.at(-1).inputIdentity, f.session.getInput().inputIdentity);
});
test('automatic discovery messages never accept source path authority from the Webview', async t => {
    const f = await fixture(t); await f.register();
    for (const payload of [{ sourceRoot: f.sourceRoot }, { discovery: { workspace: '/tmp' } }, { manifest: { version: 1 } }])
        assert.equal((await f.request('discover-workspace', payload)).status, 'invalid');
    assert.equal((await f.request('copy-diagnostics', { command: 'workbench.action.files.openFile' })).status, 'invalid');
    assert.equal((await f.request('copy-diagnostics', { viewDiagnostic: 'x'.repeat(16385) })).status, 'invalid');
    assert.equal((await f.request('open-settings', { command: 'arbitrary' })).status, 'invalid');
});
test('independent source design visits retain bounded native authority for Back without merging their roots', async t => {
    const f = await fixture(t);
    await fs.writeFile(path.join(f.sourceRoot, 'Second.bsv'), 'package Second; module mkSecond(Empty); Reg#(Bool) done <- mkReg(False); endmodule endpackage');
    f.controls.sourcePick = entries => entries.find(entry => entry.name === 'mkUser').id;
    f.controls.choose = async (action, options, context) => {
        if (action !== 'choose-design') return { sourceRoot: f.sourceRoot,
            discovery: { status: 'ready', included: [{ path: 'User.bsv' }, { path: 'Second.bsv' }] } };
        const entry = f.session.getInput().summary.sourceEntries.find(entry => entry.id === context.entryId);
        if (!entry) throw Object.assign(new Error('Foreign design'), { code: 'FORBIDDEN' });
        return { ...options, sourceEntry: { pathRef: entry.pathRef, revision: entry.revision, definitionId: entry.definitionId } };
    };
    assert.equal((await f.request('discover-workspace')).status, 'ok');
    const first = f.session.getCatalog()[0]; await f.scene(first);
    const firstInput = f.session.getInput(), previous = viewFor(f.session.getCurrent());
    const second = firstInput.summary.sourceEntries.find(entry => entry.name === 'mkSecond');
    assert.equal((await f.request('choose-design', { entryId: 'foreign' })).status, 'forbidden');
    assert.equal((await f.request('choose-design', { entryId: second.id })).payload.status, 'prepared');
    const event = f.messages.findLast(message => message.kind === 'event' && message.action === 'catalog');
    assert.equal(event.payload.replaceMode, 'design'); assert.equal(f.session.getInput(), firstInput);
    const next = event.payload.catalog[0]; await f.scene(next);
    assert.equal(f.session.getDiagnostics().preparedDesigns, 2);
    assert.notEqual(f.session.getCurrent().rootInstanceId, previous.rootInstanceId);
    assert.equal((await f.request('persist', { state: { schema: 1, view: previous } })).status, 'ok');
    assert.equal(f.session.getInput(), firstInput); assert.equal(f.session.getCurrent().buildId, first.buildId);
    assert.equal(f.session.getInput().sourceModel.roots.length, 1);
    assert.deepEqual(f.saved.at(-1).sourceEntry, f.session.getInput().selectedSourceEntry);
});
test('explicit new history prepares a ninth registered design and releases old authority only on valid commit', async t => {
    const f = await fixture(t), paths = ['User.bsv'];
    for (let i = 1; i <= 8; i++) {
        paths.push(`Design${i}.bsv`);
        await fs.writeFile(path.join(f.sourceRoot, paths.at(-1)), `package Design${i}; module mkDesign${i}(Empty); endmodule endpackage`);
    }
    f.controls.sourcePick = entries => entries.find(entry => entry.name === 'mkUser').id;
    f.controls.choose = async (action, options, context) => {
        if (action !== 'choose-design') return { sourceRoot: f.sourceRoot,
            discovery: { status: 'ready', included: paths.map(path => ({ path })) } };
        const { entry } = f.session.getSourceDesign(context.entryId);
        return { ...options, sourceEntry: { pathRef: entry.pathRef, revision: entry.revision, definitionId: entry.definitionId } };
    };
    const event = () => f.messages.findLast(message => message.kind === 'event' && message.action === 'catalog').payload;
    assert.equal((await f.request('discover-workspace')).status, 'ok');
    const first = f.session.getCatalog()[0]; await f.scene(first);
    const entries = f.session.getDesigns().filter(entry => entry.name !== 'mkUser');
    assert.equal(entries.length, 8);
    for (const entry of entries.slice(0, 7)) {
        assert.equal((await f.request('choose-design', { entryId: entry.id })).payload.status, 'prepared');
        await f.scene(event().catalog[0]);
    }
    assert.equal(f.session.getDiagnostics().preparedDesigns, 8);
    const next = entries[7], previousInput = f.session.getInput(), previous = f.session.getCurrent();
    assert.equal((await f.request('choose-design', { entryId: next.id })).error.code, 'LIMIT_EXCEEDED');
    for (const newHistory of ['true', 1, null, {}])
        assert.equal((await f.request('choose-design', { entryId: next.id, newHistory })).status, 'invalid');
    assert.equal((await f.request('choose-design', { entryId: 'foreign', newHistory: true })).status, 'forbidden');
    assert.equal((await f.request('choose-design', { entryId: next.id, newHistory: true })).payload.status, 'prepared');
    assert.equal(event().replaceMode, 'refresh'); assert.equal(event().newHistory, true);
    assert.equal(event().refreshIntent, undefined); assert.equal(event().refreshTarget.preserveViewport, false);
    assert.equal(f.session.getInput(), previousInput); assert.equal(f.session.getCurrent(), previous);
    assert.equal(f.session.getDiagnostics().preparedDesigns, 8);
    const target = event().catalog[0];
    assert.equal((await f.scene(target, { ownerInstanceId: 'foreign-owner' }, false)).status, 'invalid');
    assert.equal(f.session.getCurrent(), previous);
    const prepared = await f.scene(target, {}, false), intent = { buildId: target.buildId, snapshotId: target.snapshotId,
        queryGeneration: 1, sceneKind: 'bsv', rootInstanceId: target.rootInstanceId };
    const state = { schema: 1, view: viewFor(visitFor(prepared.payload.scene, intent)) };
    f.controls.onInput = input => { if (input !== previousInput) throw Object.assign(new Error('Test-only input listener rejection'), { code: 'INVALID_INPUT' }); };
    assert.equal((await f.request('persist', { state })).status, 'invalid');
    assert.equal(f.session.getInput(), previousInput); assert.equal(f.session.getCurrent(), previous);
    assert.equal(f.session.getDiagnostics().preparedDesigns, 8);
    f.controls.onInput = input => { if (input !== previousInput) throw new Error('Test-only generic listener failure'); };
    assert.equal((await f.request('persist', { state })).error.code, 'COMMIT_REJECTED');
    assert.equal(f.session.getInput(), previousInput); assert.equal(f.session.getCurrent(), previous);
    assert.ok(f.session.getDiagnostics().events.some(event => event.phase === 'commit-rejected' && event.message === 'Test-only generic listener failure'));
    f.controls.onInput = null;
    assert.equal((await f.request('persist', { state })).status, 'ok');
    assert.equal(f.session.getDiagnostics().preparedDesigns, 1);
    assert.equal(f.session.getCurrent().buildId, target.buildId);
    assert.equal((await f.scene(first, {}, false)).status, 'forbidden');
    assert.equal((await f.request('choose-design', { entryId: next.id, newHistory: true })).payload.status, 'prepared',
        'Explicit restart of the current design must not use the unchanged-input shortcut');
    await f.scene(event().catalog[0]); assert.equal(f.session.getDiagnostics().preparedDesigns, 1);
});
test('external source updates defer through the native UI request boundary until the new-history ACK', { timeout: 5000 }, async t => {
    const vm = require('node:vm'), { createNavigation } = require('../media/hardware-navigation');
    const { layout, fitViewport } = require('../media/hardware-layout');
    const { createNativePublication, nativeHistoryPending } = require('../media/hardware-view');
    const f = await fixture(t), paths = ['User.bsv', 'Second.bsv', 'Third.bsv'];
    for (const name of ['Second', 'Third']) await fs.writeFile(path.join(f.sourceRoot, `${name}.bsv`),
        `package ${name}; module mk${name}(Empty); Reg#(Bool) state <- mkReg(False); endmodule endpackage`);
    f.controls.sourcePick = (entries, context) => entries.find(entry => entry.definitionId === context.preferred?.definitionId)?.id
        || entries.find(entry => entry.name === 'mkUser').id;
    f.controls.choose = async (action, options, context) => {
        if (action !== 'choose-design') return { sourceRoot: f.sourceRoot, discovery: { status: 'ready', included: paths.map(path => ({ path })) } };
        const { entry } = f.session.getSourceDesign(context.entryId);
        return { ...options, sourceEntry: { pathRef: entry.pathRef, revision: entry.revision, definitionId: entry.definitionId } };
    };
    const runtime = await fs.readFile(path.resolve(__dirname, '../media/hardware-view.js'), 'utf8'), sent = [];
    const code = runtime.slice(runtime.indexOf('    function nativeHistoryPending('), runtime.indexOf('    function nativeSelectionStatus('))
        + runtime.slice(runtime.indexOf('    async function request('), runtime.indexOf('    function measureLabel('))
        + runtime.slice(runtime.indexOf('    async function discoverWorkspace('), runtime.indexOf('    function nativeTheme('));
    let publication, catalog = null, nav;
    const client = vm.runInNewContext(`let pendingCatalog = null, nativePublication = null, discoveryRequest = null, discoveryAgain = false;
        ${code}\n({ request, discoverWorkspace, flushDiscovery, setCatalog: value => { pendingCatalog = value; },
        setPublication: value => { nativePublication = value; }, waitDiscovery: () => discoveryRequest })`, {
        nativeTransport: { request: async (action, payload) => {
            sent.push(action); const reply = await f.request(action, JSON.parse(JSON.stringify(payload)));
            if (reply.error) throw Object.assign(new Error(reply.error.message), { code: reply.error.code }); return reply.payload;
        } }, navigation: { getState: () => nav?.getState() || { current: null } },
        nativeStatus: () => {}, nativeStatusOverlay: { resolve: value => value, observe() {} },
        inputStatusForBuild: new Map(), committedNativeStatus: null, t: key => key
    });
    nav = createNavigation({ canStartIntent: () => !nativeHistoryPending(catalog, publication),
        getSize: () => ({ width: 1000, height: 700 }), layoutScene: layout, fitViewport,
        queryScene: intent => client.request('scene', { buildId: intent.buildId, intent }) });
    const enter = entry => nav.navigate({ buildId: entry.buildId, snapshotId: entry.snapshotId, sceneKind: 'bsv',
        implementationProvider: 'stock', rootInstanceId: entry.rootInstanceId, ownerInstanceId: entry.rootInstanceId,
        selectedEntityId: null, selectedRelationId: null, disclosureState: {} }, { recordHistory: false, reason: 'refresh' });
    const event = () => f.messages.findLast(message => message.kind === 'event' && message.action === 'catalog').payload;
    const state = () => ({ schema: 1, view: viewFor(nav.getState().current) });
    const clearCatalog = () => { catalog = null; client.setCatalog(null); };
    publication = createNativePublication({ navigation: nav, generation: () => f.protocol.generation,
        send: payload => client.request('persist', payload), capture: () => ({ historyBuildIds: catalog?.options.newHistory ? [] : null }),
        onAccepted: clearCatalog, restore: clearCatalog, onSettled: () => client.flushDiscovery() });
    client.setPublication(publication);
    await client.discoverWorkspace(); await enter(event().catalog[0]); await publication.publish(state(), { immediate: true });
    for (const name of ['mkSecond', 'mkThird']) {
        const entry = f.session.getDesigns().find(entry => entry.name === name);
        await client.request('choose-design', { entryId: entry.id, ...(name === 'mkThird' ? { newHistory: true } : {}) });
        publication.reset({ retain: true });
        catalog = name === 'mkThird' ? { options: { newHistory: true } } : null; client.setCatalog(catalog);
        await enter(event().catalog[0]);
        if (name === 'mkSecond') await publication.publish(state(), { immediate: true });
    }
    const save = deferred(), began = deferred(); t.after(() => save.resolve());
    f.controls.save = () => { began.resolve(); return save.promise; };
    const pending = publication.publish(state(), { immediate: true }); await began.promise;
    const before = f.session.getCurrent(), input = f.session.getInput(), generation = f.protocol.generation;
    const discoveries = sent.filter(action => action === 'discover-workspace').length;
    await fs.appendFile(path.join(f.sourceRoot, 'Third.bsv'), '\n// externally saved revision\n');
    await Promise.all([client.discoverWorkspace(), client.discoverWorkspace(), client.discoverWorkspace()]);
    for (const action of ['choose-source', 'choose-artifact', 'choose-manifest', 'choose-origin', 'choose-design', 'refresh-input', 'discover-workspace'])
        await assert.rejects(client.request(action, {}), error => error.code === 'INPUT_BUSY');
    assert.equal(sent.filter(action => action === 'discover-workspace').length, discoveries);
    assert.equal(f.protocol.generation, generation); assert.equal(f.session.getCurrent(), before);
    assert.ok((await client.request('analysis-context', { buildId: before.buildId, provider: 'stock' })).analysisId);
    const reference = nav.getState().scene.inspector.sourceRefs[0];
    assert.ok(await client.request('source', { buildId: before.buildId, reference }));
    save.resolve(); await pending; f.controls.save = null; await client.waitDiscovery();
    assert.equal(sent.filter(action => action === 'discover-workspace').length, discoveries + 1);
    assert.equal(event().replaceMode, 'refresh'); assert.equal(f.session.getInput(), input);
    publication.reset({ retain: true }); await enter(event().catalog[0]);
    f.controls.onInput = () => { throw new Error('Test-only new source revision rejection'); };
    assert.equal(await publication.publish(state(), { immediate: true }), false);
    assert.equal(f.session.getCurrent().buildId, before.buildId); assert.equal(nav.getState().current.buildId, before.buildId);
    assert.deepEqual(nav.getState().history, { back: [], forward: [] });
});
test('a displayed no-module refresh explicitly commits empty state and clears the previous source owner', async t => {
    const f = await fixture(t);
    f.controls.choose = async () => ({ sourceRoot: f.sourceRoot, discovery: { status: 'ready', included: [{ path: 'User.bsv' }] } });
    await f.request('discover-workspace'); await f.scene(f.session.getCatalog()[0]);
    const previous = f.session.getCurrent();
    await fs.writeFile(path.join(f.sourceRoot, 'User.bsv'), 'package NativeSession; typedef Bit#(8) Byte; endpackage');
    assert.equal((await f.request('discover-workspace')).payload.status, 'prepared');
    assert.equal(f.session.getCurrent(), previous);
    assert.equal((await f.request('persist', { state: { schema: 1, view: null } })).status, 'ok');
    assert.equal(f.session.getInput().summary.discovery.status, 'no-module');
    assert.equal(f.session.getCurrent(), null); assert.equal(f.session.getDiagnostics().pendingInputIdentity, null);
    assert.deepEqual(f.session.getCatalog(), []); assert.equal(f.session.getDiagnostics().preparedDesigns, 0);
});
test('source modified after candidate preparation is rejected at commit even before a watcher debounce fires', async t => {
    const f = await fixture(t);
    f.controls.choose = async () => ({ sourceRoot: f.sourceRoot, discovery: { status: 'ready', included: [{ path: 'User.bsv' }] } });
    await f.request('discover-workspace'); await f.scene(f.session.getCatalog()[0]);
    const before = f.session.getInput(), previous = f.session.getCurrent();
    await fs.writeFile(path.join(f.sourceRoot, 'User.bsv'), source.replace('state + 1', 'state + 2'));
    await f.request('discover-workspace');
    const entry = f.messages.findLast(message => message.kind === 'event' && message.action === 'catalog').payload.catalog[0];
    const intent = { buildId: entry.buildId, snapshotId: null, queryGeneration: 1, sceneKind: 'bsv', rootInstanceId: entry.rootInstanceId };
    const prepared = await f.request('scene', { buildId: entry.buildId, intent });
    await fs.writeFile(path.join(f.sourceRoot, 'User.bsv'), source.replace('state + 1', 'state + 3'));
    const result = await f.request('persist', { state: { schema: 1, view: viewFor(visitFor(prepared.payload.scene, intent)) } });
    assert.equal(result.status, 'stale'); assert.equal(result.error.code, 'STALE_SOURCE');
    assert.equal(f.session.getInput(), before); assert.equal(f.session.getCurrent(), previous);
});
test('explicit independent artifact keeps source-only Back authority without inventing correspondence', async t => {
    const f = await fixture(t), artifactRoot = path.join(f.root, 'rtl'); await fs.mkdir(artifactRoot);
    const artifact = { modules: { OtherHardware: { attributes: { top: '1' }, ports: { data: { direction: 'input', bits: [2] } }, cells: {}, netnames: {} } } };
    await fs.writeFile(path.join(artifactRoot, 'design.json'), JSON.stringify(artifact));
    f.controls.choose = async action => action === 'choose-artifact' ? { artifactRoot, artifactPath: 'design.json', independentArtifact: true }
        : { sourceRoot: f.sourceRoot, discovery: { status: 'ready', included: [{ path: 'User.bsv' }] } };
    await f.request('discover-workspace'); await f.scene(f.session.getCatalog()[0]);
    const sourceInput = f.session.getInput(), sourceView = viewFor(f.session.getCurrent());
    assert.equal((await f.request('choose-artifact')).payload.status, 'prepared');
    const event = f.messages.findLast(message => message.kind === 'event' && message.action === 'catalog');
    assert.equal(event.payload.replaceMode, 'artifact'); assert.equal(f.session.getInput(), sourceInput);
    const entry = event.payload.catalog[0]; await f.scene(entry);
    assert.equal(f.session.getInput().summary.status, 'artifact-only'); assert.equal(f.session.getInput().sourceModel, null);
    assert.equal(f.session.getCurrent().sceneKind, 'rtl');
    const foreign = await f.request('scene', { buildId: 'foreign-build', intent: {} }, { snapshotId: null });
    assert.equal(foreign.status, 'forbidden');
    assert.equal((await f.request('persist', { state: { schema: 1, view: sourceView } }, { snapshotId: null })).status, 'ok');
    assert.equal(f.session.getInput(), sourceInput); assert.equal(f.session.getCurrent().sceneKind, 'bsv');
    assert.equal((await f.request('catalog', {}, { snapshotId: 'foreign-snapshot' })).status, 'stale');
    assert.ok(f.session.getDesigns().some(entry => entry.definitionId === sourceInput.selectedSourceEntry.definitionId));
    assert.equal(f.session.getSourceDesign(sourceInput.summary.selectedDesignId).options.sourceRoot, f.sourceRoot);
});
test('saved-source refresh revalidates the current child and storage instead of reopening the catalog root', async t => {
    const f = await fixture(t), control = 'package Control; interface Stage; method Action put(Bit#(8) x); method Bit#(8) get; endinterface\n'
        + 'module mkLeaf(Stage); Reg#(Bit#(8)) state <- mkReg(0); rule advance; state <= state + 1; endrule\n'
        + 'method Action put(Bit#(8) x); state <= x; endmethod method Bit#(8) get = state; endmodule\n'
        + 'module mkController(Empty); Stage west <- mkLeaf; Stage east <- mkLeaf; rule transfer; east.put(west.get); endrule endmodule endpackage';
    const file = path.join(f.sourceRoot, 'User.bsv'); await fs.writeFile(file, control);
    f.controls.choose = async () => ({ sourceRoot: f.sourceRoot, discovery: { status: 'ready', included: [{ path: 'User.bsv' }] } });
    f.controls.sourcePick = entries => entries.find(entry => entry.name === 'mkController').id;
    await f.request('discover-workspace'); const entry = f.session.getCatalog()[0];
    const root = (await f.scene(entry)).payload.scene, west = root.children.find(child => child.label === 'west');
    const child = (await f.scene(entry, { ownerInstanceId: west.id })).payload.scene, state = child.storages.find(item => item.label === 'state');
    await f.scene(entry, { ownerInstanceId: west.id, selectedEntityId: state.id });
    const before = f.session.getCurrent(), viewport = { x: -125, y: 72, scale: 1.4 };
    await f.request('persist', { state: { schema: 1, view: { ...viewFor(before), viewport } } });
    await fs.writeFile(file, control.replace('state + 1', 'state + 2'));
    await f.request('discover-workspace');
    const update = f.messages.findLast(message => message.kind === 'event' && message.action === 'catalog').payload;
    assert.equal(update.refreshIntent.ownerInstanceId, west.id); assert.equal(update.refreshIntent.selectedEntityId, state.id);
    assert.equal(update.refreshTarget.status, 'preserved'); assert.equal(update.refreshTarget.preserveViewport, true);
    for (const key of ['query', 'sourceContext', 'implementationContext', 'sourceRevision', 'sourceRefs']) assert.equal(Object.hasOwn(update.refreshIntent, key), false);
    const next = await f.request('scene', { buildId: update.selectedBuildId, intent: update.refreshIntent });
    assert.equal(next.status, 'ok'); assert.notEqual(next.payload.scene.sourceRevision, before.sourceRevision);
    assert.equal(next.payload.scene.shell.label, 'west'); assert.equal(next.payload.scene.selection.selectedEntityId, state.id);
    await f.request('persist', { state: { schema: 1, view: { ...viewFor(visitFor(next.payload.scene, update.refreshIntent)), viewport } } });
    assert.equal(f.session.getCurrent().ownerInstanceId, west.id); assert.deepEqual({ ...f.session.getCurrent().viewport }, viewport);
    await fs.writeFile(file, control.replaceAll('state', 'counter'));
    await f.request('discover-workspace');
    const missingSelection = f.messages.findLast(message => message.kind === 'event' && message.action === 'catalog').payload;
    assert.equal(missingSelection.refreshTarget.status, 'selection-unavailable');
    assert.equal(missingSelection.refreshIntent.ownerInstanceId, west.id); assert.equal(missingSelection.refreshIntent.selectedEntityId, null);
    assert.ok(missingSelection.refreshTarget.message);
    await fs.writeFile(file, control.replace('Stage west <- mkLeaf;', '').replace('rule transfer; east.put(west.get); endrule', ''));
    await f.request('discover-workspace');
    const missingOwner = f.messages.findLast(message => message.kind === 'event' && message.action === 'catalog').payload;
    assert.equal(missingOwner.refreshTarget.status, 'owner-unavailable'); assert.equal(missingOwner.refreshTarget.preserveViewport, false);
    assert.equal(missingOwner.refreshIntent.ownerInstanceId, entry.rootInstanceId); assert.ok(missingOwner.refreshTarget.message);
    await fs.writeFile(file, control); await fs.rename(file, path.join(f.sourceRoot, 'Moved.bsv'));
    f.controls.choose = async () => ({ sourceRoot: f.sourceRoot, discovery: { status: 'ready', included: [{ path: 'Moved.bsv' }] } });
    await f.request('discover-workspace');
    const moved = f.messages.findLast(message => message.kind === 'event' && message.action === 'catalog').payload;
    assert.equal(moved.refreshTarget.status, 'owner-unavailable', 'Equal names and occurrence IDs do not replace the source URI identity check');
    assert.equal(moved.refreshTarget.preserveViewport, false);
});
