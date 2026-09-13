'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { pathToFileURL } = require('node:url');
const { settled, chooseObject } = require('./development-smoke.cjs');
const { captureNative, clickWire } = require('./native-oracle.cjs');
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const stateOf = frame => frame.evaluate(() => window.bsvHardware.getState());
const position = (text, offset) => { const lines = text.slice(0, offset).split('\n'); return { line: lines.length - 1, character: lines.at(-1).length }; };
const identity = state => ({ buildId: state.current.buildId, snapshotId: state.current.snapshotId, provider: state.current.provider,
    owner: state.current.ownerInstanceId, occurrence: state.current.implementationContext.contextOccurrenceId,
    selected: state.current.selectedEntityId, relation: state.current.selectedRelationId, viewport: state.current.viewport,
    queryId: state.current.analysis?.result.queryId || null, resultHash: digest(JSON.stringify(state.current.analysis?.result || null)) });

async function inputTitle(page, title) {
    await page.locator('.quick-input-title').filter({ hasText: title }).waitFor({ state: 'visible', timeout: 30000 });
}
async function inputsOpen(frame) {
    if (!await frame.locator('#native-inputs').evaluate(element => element.open)) await frame.locator('#native-inputs > summary').click();
}
async function selectProvider(frame, provider) {
    await inputsOpen(frame); await frame.locator('#provider-select').selectOption(provider);
    await frame.locator('#native-inputs > summary').click(); await settled(frame);
    assert.equal(await frame.locator('#provider-select').inputValue(), provider, 'Closing view controls changed explicit RTL provider choice');
}
async function registerBundle({ native, frame, page, fixture, needsSourceRoot = false, approveOrigin = false }) {
    assert.ok(fixture.manifestRelative && fixture.workspaceRootChoice, 'Fixture requires explicit UI root choice and relative manifest');
    const generation = await frame.evaluate(() => window.BsvHardwareTransport.identity().generation);
    await inputsOpen(frame); await frame.locator('#native-inputs [data-native-action="choose-manifest"]').click();
    await inputTitle(page, 'Choose artifact authority root'); await native.nativeInput({ choice: fixture.workspaceRootChoice }, page);
    await inputTitle(page, 'Hardware input manifest'); await native.nativeInput({ text: fixture.manifestRelative }, page);
    if (needsSourceRoot) {
        await inputTitle(page, 'Choose source authority root for this bundle');
        await native.nativeInput({ choice: fixture.sourceRootChoice || fixture.workspaceRootChoice }, page);
        await inputTitle(page, 'Bundle source folder'); await native.nativeInput({ text: fixture.sourceRelative || '.' }, page);
    }
    if (fixture.manifest.origin) await page.getByRole('button', { name: approveOrigin ? 'Approve captured provider' : 'Register stock inputs only', exact: true }).click();
    if (fixture.rootChoice) { await inputTitle(page, 'Choose an actual root'); await native.nativeInput({ choice: fixture.rootChoice }, page); }
    await frame.waitForFunction(({ label, generation }) => window.BsvHardwareTransport.identity().generation > generation
        && window.bsvHardware.getState().scene?.header?.buildLabel.includes(label) && !window.bsvHardware.getState().pending,
    { label: fixture.manifest.label, generation }, { timeout: 60000 });
    if (await frame.locator('#native-inputs').evaluate(element => element.open)) await frame.locator('#native-inputs > summary').click();
    return settled(frame);
}
async function analyze(frame, kind, direction) {
    const previous = await stateOf(frame), selector = `[data-analysis-kind=${JSON.stringify(kind)}]`
        + (direction ? `[data-analysis-direction=${JSON.stringify(direction)}]` : '');
    await frame.locator(selector).first().click();
    await frame.waitForFunction(({ kind, direction, generation }) => {
        const s = window.bsvHardware.getState(); if (s.error) throw new Error(s.error.message);
        return !s.pending && s.queryGeneration > generation && s.current.analysis?.result.kind === kind
            && (!direction || s.current.analysis.result.direction === direction);
    }, { kind, direction, generation: previous.queryGeneration }, { timeout: 30000 });
    return settled(frame);
}
async function clickControl(frame, id) { await frame.locator(`#${id}`).click(); return settled(frame); }
async function enter(frame, name) {
    const state = await settled(frame), child = state.scene.children.find(item => item.label === name);
    assert.ok(child, `Missing actual child ${name}`); await chooseObject(frame, child.id);
    await frame.waitForFunction(id => window.bsvHardware.getState().scene?.shell.id === id, child.id, { timeout: 30000 });
    return settled(frame);
}
async function sourceReveal({ native, frame, fixture, referenceId }) {
    const state = await settled(frame), reference = state.current.analysis?.result.sourceRefs.find(ref => ref.id === referenceId);
    assert.ok(reference, 'Native source control reference must belong to the product result');
    const source = fixture.sourceFiles.find(source => source.pathRef === reference.pathRef);
    assert.ok(source, 'Reference must belong to the explicitly copied fixture source');
    const bytes = fs.readFileSync(source.path), text = bytes.toString('utf8');
    assert.equal(digest(text), reference.revision);
    const since = native.channel.records.length;
    const button = frame.locator(`[data-source-open-id=${JSON.stringify(referenceId)}]`).first();
    for (let depth = 0; depth < 8; depth++) {
        const closed = button.locator('xpath=ancestor::details[not(@open)]').first();
        if (!await closed.count()) break;
        await closed.locator('summary').first().click();
    }
    await button.scrollIntoViewIfNeeded();
    const from = await frame.evaluate(referenceId => {
        const record = { referenceId, events: [] };
        const listener = event => { if (event.detail.referenceId === referenceId) record.events.push(structuredClone(event.detail)); };
        window.__g6SourceReveal = { record, listener }; window.addEventListener('hardware:source', listener);
        return window.__bsvVsixSmoke.posts.length;
    }, referenceId);
    try {
        await button.click();
        const event = await native.channel.waitFor('editorSelection', value => value.editor?.uri === pathToFileURL(source.path).href
            && value.editor.selectionText === text.slice(reference.range.start, reference.range.end), 30000, since);
        assert.deepEqual(event.editor.selection, { start: position(text, reference.range.start), end: position(text, reference.range.end) });
        assert.equal(event.editor.fullTextSha256, digest(text)); assert.equal(event.editor.dirty, false);
        const acknowledged = await frame.waitForFunction(({ from, referenceId, buildId }) => {
            const request = window.__bsvVsixSmoke.posts.slice(from).find(message => message.action === 'source-open'
                && message.payload.buildId === buildId && message.payload.reference.id === referenceId);
            const response = request && window.__bsvVsixSmoke.host.find(message => message.kind === 'response'
                && ['requestId', 'action', 'panelId', 'sessionId', 'protocol', 'buildId', 'generation', 'snapshotId']
                    .every(key => message[key] === request[key]));
            return response && { request, response };
        }, { from, referenceId, buildId: state.current.buildId }, { timeout: 30000 });
        const acknowledgement = await acknowledged.jsonValue();
        assert.equal(acknowledgement.response.status, 'ok', `Native source-open ACK failed: ${JSON.stringify(acknowledgement.response.error)}`);
        assert.equal(acknowledgement.response.payload.uri, event.editor.uri);
        assert.equal(acknowledgement.response.payload.documentHash, reference.revision);
        assert.deepEqual(acknowledgement.response.payload.selection, event.editor.selection);
        const finished = await frame.waitForFunction(referenceId => {
            const events = window.__g6SourceReveal.record.events;
            const pending = events.findLastIndex(event => event.status === 'pending');
            const terminal = pending >= 0 && events.slice(pending + 1).find(event => ['complete', 'error', 'cancelled'].includes(event.status));
            const source = window.bsvHardware.getState().current?.disclosureState.analysis?.source;
            return terminal && { referenceId, events, terminal, source };
        }, referenceId, { timeout: 30000 });
        const completion = await finished.jsonValue();
        assert.ok(completion.events.some(event => event.status === 'pending'));
        assert.equal(completion.terminal.status, 'complete', `Source operation did not complete: ${JSON.stringify(completion.terminal)}`);
        assert.equal(completion.source.referenceId, referenceId); assert.equal(completion.source.error, undefined);
        assert.equal(completion.source.result.id, referenceId); assert.equal(completion.source.result.readOnly, true);
        assert.equal(await frame.evaluate(({ from, referenceId }) => window.__bsvVsixSmoke.posts.slice(from)
            .filter(message => message.action === 'source-open' && message.payload.reference.id === referenceId).length, { from, referenceId }), 1);
        return { reference, editor: event.editor, sourcePath: source.path, acknowledgement, completion };
    } finally {
        await frame.evaluate(() => { window.removeEventListener('hardware:source', window.__g6SourceReveal.listener); delete window.__g6SourceReveal; });
    }
}

async function runAcceptance({ native, frame, page, fixtures, output = native.output, record = () => {} }) {
    assert.equal(native.receipt.targetMode, 'installed', 'N01–N15 requires an installed VSIX');
    for (const key of ['A', 'B', 'C']) assert.ok(fixtures[key], `Missing external ${key} fixture`);
    const steps = [], captures = [];
    const pass = async (id, detail = {}) => { const row = { id, status: 'pass', executed: true, scope: 'installed-vsix',
        vsixSha256: native.receipt.vsixSha256, ...detail }; steps.push(row); await record(id, row); };
    const capture = async (name, fixture, expectations) => {
        const result = await captureNative({ native, frame, page, output, name, expectations, authority: fixture.authority });
        captures.push({ name, inventory: result.inventory, verdict: result.verdict });
        assert.equal(result.verdict.status, 'pass', `${name}: ${JSON.stringify(result.verdict.findings.slice(0, 12))}`); return result;
    };
    let state;
    await native.channel.request('openProductCommand', { command: 'bsvArchitecture.openHardwareSchematic' });
    await frame.waitForFunction(() => !!window.BsvHardwareTransport?.identity(), null, { timeout: 30000 });
    await pass('N01', { transport: await frame.evaluate(() => window.BsvHardwareTransport.identity()), hardware: await native.channel.request('observeHardware') });
    assert.equal(await frame.locator('#native-empty').isVisible(), true);
    assert.equal((await stateOf(frame)).current, null); await native.capture('N02-empty-input', page);
    await pass('N02', { message: await frame.locator('#native-empty').innerText() });
    state = await registerBundle({ native, frame, page, fixture: fixtures.A, needsSourceRoot: true });
    assert.equal(state.scene.sceneKind, 'bsv'); assert.deepEqual(state.scene.children.map(child => child.label), ['left', 'right']);
    await capture('N03-A-overall', fixtures.A, { root: 'mkConnected', children: ['left', 'right'], fitAll: true });
    await pass('N03', { manifest: fixtures.A.manifestRelative, current: state.current });
    const overall = state, left = state.scene.children.find(child => child.label === 'left');
    state = await enter(frame, 'left'); const storage = state.scene.storages.find(item => item.label === 'state'); assert.ok(storage);
    await capture('N04-A-left', fixtures.A, { root: 'left', storages: ['state'], contacts: ['put', 'get'], detail: true, fitAll: true });
    await pass('N04', { shellId: state.scene.shell.id, owner: state.current.ownerInstanceId });
    await chooseObject(frame, storage.id); state = await analyze(frame, 'state-accesses');
    assert.equal(state.current.selectedEntityId, storage.id); assert.equal(state.current.analysis.result.writers.length, 1);
    await pass('N05', { current: state.current });
    await frame.locator('[data-code-section="writer"] [data-analysis-kind="behavior"]').click();
    await frame.waitForFunction(() => window.bsvHardware.getState().current?.analysis?.result.kind === 'behavior'); state = await settled(frame);
    const refId = await frame.locator('#code-drawer pre[data-source-reference-id]').first().getAttribute('data-source-reference-id');
    await pass('N06', await sourceReveal({ native, frame, fixture: fixtures.A, referenceId: refId }));
    const source = fixtures.A.sourceFiles.find(row => row.pathRef === state.current.analysis.result.sourceRefs.find(ref => ref.id === refId).pathRef);
    const text = fs.readFileSync(source.path, 'utf8'), offset = text.indexOf('left <- mkStage'); assert.ok(offset >= 0);
    await native.channel.request('moveCursor', { path: source.path, start: position(text, offset + 2) });
    await frame.waitForFunction(id => window.bsvHardware.getState().current?.selectedEntityId === id, left.id, { timeout: 30000 });
    state = await settled(frame); assert.equal(state.current.sceneKind, 'bsv'); assert.equal(state.current.buildId, overall.current.buildId);
    await pass('N07', { actualEditor: await native.channel.request('observeEditors'), current: state.current });
    await frame.locator('#breadcrumb button').first().click(); await settled(frame);
    await selectProvider(frame, 'stock'); state = await clickControl(frame, 'rtl'); assert.equal(state.current.provider, 'stock');
    const get = state.scene.contacts.find(contact => contact.ownerId === state.scene.shell.id && contact.label === 'get'); assert.ok(get);
    await chooseObject(frame, get.id); await settled(frame);
    await capture('N08-narrow-A-RTL-overview', fixtures.A, { root: 'mkConnected', children: ['left', 'right'], fitAll: true });
    await frame.locator('.analysis-controls select').filter({ has: frame.locator('option[value="indices"]') }).selectOption('indices');
    await frame.getByLabel('Zero-based positions (order and repeats kept)', { exact: true }).fill('1, 0, 1');
    state = await analyze(frame, 'same-net'); assert.deepEqual(state.current.analysis.result.seed.positions.map(bit => bit.index), [1, 0, 1]);
    await pass('N08', { current: state.current, expectedPort: { id: get.id, bits: get.bits } });
    state = await registerBundle({ native, frame, page, fixture: fixtures.B });
    await selectProvider(frame, 'stock'); state = await clickControl(frame, 'rtl'); assert.equal(state.current.provider, 'stock');
    const cell = state.scene.children.find(item => item.type === '$add'); assert.ok(cell, 'B actual RTL has no add cell');
    await chooseObject(frame, cell.id); state = await settled(frame);
    const pin = state.scene.contacts.find(item => item.ownerId === cell.id && item.label === 'Y'); assert.ok(pin);
    await frame.locator(`[data-analysis-pin-id=${JSON.stringify(pin.id)}]`).click();
    const same = await analyze(frame, 'same-net'), sameQuery = same.current.analysis.result.queryId;
    state = await analyze(frame, 'dependencies', 'backward'); assert.notEqual(state.current.analysis.result.queryId, sameQuery);
    assert.deepEqual(state.current.viewport, same.current.viewport);
    state = await clickControl(frame, 'fit-selection');
    await capture('N09-B-dependency', fixtures.B, { root: false, selected: true });
    await pass('N09', { sameNet: same.current.analysis.result, dependencies: state.current.analysis.result });
    const stops = state.current.analysis.result.boundaries.filter(boundary => ['sequential', 'unsupported-cell', 'blackbox', 'memory'].includes(boundary.reason));
    assert.ok(stops.length, 'Actual dependency query must expose a sequential or unsupported boundary');
    await pass('N10', { stops, frontier: state.current.analysis.result.frontier, limits: state.current.analysis.result.limits });
    state = await registerBundle({ native, frame, page, fixture: fixtures.A });
    await inputsOpen(frame); await frame.locator('#native-inputs [data-native-action="choose-origin"]').click();
    await page.getByRole('button', { name: 'Approve captured provider', exact: true }).click();
    await frame.waitForFunction(() => !document.querySelector('#provider-select option[value="instrumented"]').disabled, null, { timeout: 60000 });
    await settled(frame); await frame.locator('#native-inputs > summary').click();
    await selectProvider(frame, 'instrumented'); state = await clickControl(frame, 'rtl'); assert.equal(state.current.provider, 'instrumented'); state = await enter(frame, 'left');
    let contributor;
    for (const candidate of state.scene.children.filter(item => item.kind === 'rtl-cell').slice(0, 8)) {
        await chooseObject(frame, candidate.id); state = await settled(frame);
        if (state.scene.correspondence.origin.claims.length) { contributor = candidate.id; break; }
    }
    assert.ok(contributor, 'Instrumented known contributor not observed'); assert.equal(state.scene.capabilities.completeOriginSets, false);
    state = await clickControl(frame, 'fit-selection');
    await capture('N11-partial-contributor', fixtures.A, { root: false, selected: true });
    await pass('N11', { contributor, origin: state.scene.correspondence.origin });
    state = await clickControl(frame, 'up'); const rtlRoot = state.scene.shell.id;
    const occurrences = state.scene.children.filter(child => child.kind === 'rtl-occurrence');
    const rtlLeft = occurrences.find(item => item.label === 'left'), rtlRight = occurrences.find(item => item.label === 'right');
    assert.ok(rtlLeft && rtlRight); assert.notEqual(rtlLeft.id, rtlRight.id);
    await chooseObject(frame, rtlLeft.id); state = await settled(frame); const savedLeft = identity(state);
    state = await clickControl(frame, 'back'); assert.equal(state.scene.shell.id, rtlRoot);
    state = await clickControl(frame, 'forward'); assert.deepEqual(identity(state), savedLeft);
    await clickControl(frame, 'up'); await chooseObject(frame, rtlRight.id); state = await settled(frame); assert.equal(state.scene.shell.id, rtlRight.id);
    state = await clickControl(frame, 'up'); assert.equal(state.scene.shell.id, rtlRoot);
    await pass('N12', { root: rtlRoot, left: rtlLeft.id, right: rtlRight.id });
    state = await enter(frame, 'left'); const hits = [];
    for (const connection of state.scene.connections.filter(item => item.bits.length)) {
        const hit = await clickWire({ frame, page, connectionId: connection.id });
        assert.equal(hit.state.scene.inspector.connectivity.id, connection.id);
        assert.deepEqual(hit.state.scene.inspector.connectivity.bits, connection.bits);
        hits.push({ id: connection.id, bits: connection.bits, point: hit.point }); if (hits.length === 2) break;
    }
    assert.equal(hits.length, 2); assert.ok(!hits[0].bits.some(bit => hits[1].bits.includes(bit)));
    await capture('N13-distinct-wire-hits', fixtures.A, { root: 'left', fitAll: true }); await pass('N13', { hits });
    await clickControl(frame, 'return-bsv'); await frame.locator('#breadcrumb button').first().click(); await settled(frame);
    state = await enter(frame, 'left'); await chooseObject(frame, state.scene.storages.find(item => item.label === 'state').id);
    await analyze(frame, 'state-accesses'); await frame.locator('[data-code-section="writer"] [data-analysis-kind="behavior"]').click();
    await frame.waitForFunction(() => window.bsvHardware.getState().current?.analysis?.result.kind === 'behavior');
    const bsv = await settled(frame), bsvIdentity = identity(bsv); await native.traceCheckpoint('N14-bsv-writer');
    state = await clickControl(frame, 'rtl');
    const mapped = state.scene.children.find(item => item.type === '$add'); assert.ok(mapped); await chooseObject(frame, mapped.id);
    state = await analyze(frame, 'correspondence');
    const rtlReference = state.current.analysis.result.sourceRefs.find(ref => fixtures.A.sourceFiles.some(source => source.pathRef === ref.pathRef));
    assert.ok(rtlReference, 'RTL correspondence has no approved original source reference');
    const references = frame.locator('[data-analysis-disclosure-id$=":source-references"]');
    if (await references.count() && !await references.evaluate(element => element.open)) await references.locator('summary').click();
    await native.traceCheckpoint('N14-rtl-correspondence');
    const roundtripSource = await sourceReveal({ native, frame, fixture: fixtures.A, referenceId: rtlReference.id });
    await native.traceCheckpoint('N14-editor-source');
    for (let back = 0; back < 6 && (await stateOf(frame)).current.sceneKind !== 'bsv'; back++) {
        await clickControl(frame, 'back'); await native.traceCheckpoint(`N14-back-${back}`);
    }
    state = await settled(frame); assert.deepEqual(identity(state), bsvIdentity);
    await capture('N14-restored-BSV', fixtures.A, { root: 'left', selected: true }); await pass('N14', { source: roundtripSource, before: bsvIdentity, after: identity(state) });
    await registerBundle({ native, frame, page, fixture: fixtures.C, approveOrigin: true }); const widths = [];
    for (const [name, width] of [['narrow', 8], ['wide', 12]]) {
        await frame.locator('#breadcrumb button').first().click(); await settled(frame); await enter(frame, name); state = await enter(frame, 'implementation');
        const sourceOwner = state.current.ownerInstanceId, sourcePath = state.scene.occurrencePath;
        await capture(`N15-C-${name}-source`, fixtures.C, { root: 'implementation', contacts: ['get'], fitAll: true });
        await selectProvider(frame, 'stock'); state = await clickControl(frame, 'rtl'); assert.equal(state.current.provider, 'stock');
        assert.equal(state.current.implementationContext.occurrencePath.at(-1), name);
        const port = state.scene.contacts.find(contact => contact.ownerId === state.scene.shell.id && contact.label === 'get');
        assert.equal(port.bits.length, width); await chooseObject(frame, port.id); state = await analyze(frame, 'same-net');
        widths.push({ name, width, sourceOwner, sourcePath, actual: state.current.implementationContext, seed: state.current.analysis.result.seed });
        await capture(`N15-C-${name}`, fixtures.C, { root: name, contacts: ['get'], fitAll: true });
        await clickControl(frame, 'return-bsv');
    }
    assert.notEqual(widths[0].sourceOwner, widths[1].sourceOwner); assert.notEqual(widths[0].actual.contextOccurrenceId, widths[1].actual.contextOccurrenceId);
    await pass('N15', { widths });
    return { schema: 'g6-native-acceptance-v1', status: 'pass', targetMode: native.receipt.targetMode,
        vsixSha256: native.receipt.vsixSha256, steps, captures, userVisualDesignAcceptance: 'PENDING' };
}

async function runTypography({ native, frame, page, fixture, output = native.output, cases = [] }) {
    await registerBundle({ native, frame, page, fixture });
    let state = await enter(frame, 'left'); const storage = state.scene.storages.find(item => item.label === 'state');
    assert.ok(storage); await chooseObject(frame, storage.id); await analyze(frame, 'state-accesses'); await clickControl(frame, 'fit');
    const baseline = identity(await settled(frame)); delete baseline.viewport;
    const results = [];
    const scenarios = [
        { name: 'native-detail-default', apply: async () => {} },
        { name: 'native-inspector-closed', apply: () => frame.locator('#toggle-inspector').click() },
        { name: 'native-inspector-restored', apply: () => frame.locator('#toggle-inspector').click() },
        ...cases
    ];
    for (const scenario of scenarios) {
        assert.equal(typeof scenario.apply, 'function', 'Native typography scenario requires a real UI/window action');
        await scenario.apply({ native, frame, page }); state = await settled(frame);
        const after = identity(state); delete after.viewport; assert.deepEqual(after, baseline, 'Native panel/theme/resize changed semantic context');
        const result = await captureNative({ native, frame, page, output, name: scenario.name, authority: fixture.authority,
            expectations: { root: 'left', storages: ['state'], contacts: ['put', 'get'], detail: true,
                fitAll: state.current.disclosureState.presentation?.fit === 'structure' } });
        results.push({ name: scenario.name, inventory: result.inventory, verdict: result.verdict,
            window: result.measurement.native.hostWindow, frame: result.measurement.native.frameBounds, canvas: result.measurement.canvas });
        assert.equal(result.verdict.status, 'pass', JSON.stringify(result.verdict.findings.slice(0, 12)));
    }
    return { schema: 'g6-native-typography-v1', status: 'pass', vsixSha256: native.receipt.vsixSha256, results,
        scope: 'Actual native DOM typography/geometry; visual reviewer and user design acceptance remain separate.' };
}

module.exports = { registerBundle, runAcceptance, runTypography, sourceReveal, analyze, enter, identity };
