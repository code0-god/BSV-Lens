'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { poll, attack, refreshFailure, revealButton, openWorkspacePanel, registerBundle } = require('./native-security-attacks.cjs');
const { identity, enter, analyze, sourceReveal } = require('./native-acceptance.cjs');
const { settled, chooseObject } = require('./development-smoke.cjs');
const { digest } = require('./native-security-inputs.cjs');

async function writer(frame) {
    let state = await enter(frame, 'left');
    await chooseObject(frame, state.scene.storages.find(item => item.label === 'state').id);
    await analyze(frame, 'state-accesses');
    await frame.locator('[data-code-section="writer"] [data-analysis-kind="behavior"]').click();
    await frame.waitForFunction(() => window.bsvHardware.getState().current?.analysis?.result.kind === 'behavior');
    state = await settled(frame);
    const id = await frame.locator('#code-drawer pre[data-source-reference-id]').first().getAttribute('data-source-reference-id');
    const reference = state.current.analysis.result.sourceRefs.find(item => item.id === id); assert.ok(reference);
    return { state, reference };
}
async function capturedReveal(native, frame, reference) {
    const since = native.channel.records.length; await revealButton(frame, reference.id);
    const event = await native.channel.waitFor('editorSelection', value => value.editor?.uri.startsWith('bsv-hardware-capture:')
        && value.editor.selectionSha256 === reference.sliceHash, 30000, since);
    assert.equal(event.editor.fullTextSha256, reference.revision); assert.equal(event.editor.dirty, false);
    return event.editor;
}
async function staleEvent(frame, start) {
    return poll(() => frame.evaluate(start => window.__bsvVsixSmoke.host.slice(start).find(message =>
        message.kind === 'event' && message.action === 'status' && message.payload?.status === 'stale'), start), Boolean, 'Actual file watcher stale event');
}

async function runSourceCases(context) {
    const { native, frame, page, inputs, pass } = context;
    await registerBundle({ native, frame, page, fixture: inputs.mutation });
    const { state, reference } = await writer(frame), source = inputs.mutation.sourceFiles[0].path;
    const original = fs.readFileSync(source), sourceHash = digest(original), forged = [];
    for (const [id, change, expectedCode] of [['range', { range: { ...reference.range, start: -1 } }, 'INVALID_RANGE'],
        ['revision', { revision: '0'.repeat(64) }, 'SOURCE_REVISION_MISMATCH']]) {
        forged.push(await attack({ native, frame, id: `source-${id}`, action: 'source-open',
            payload: { buildId: state.current.buildId, reference: { ...reference, ...change } }, expectedCode }));
    }
    const initialReveal = await sourceReveal({ native, frame, fixture: inputs.mutation, referenceId: reference.id });
    const dirty = await native.channel.request('editBuffer', { path: source, start: { line: 0, character: 0 }, text: '// unsaved isolated security shift\n' });
    assert.equal(dirty.dirty, true); assert.notEqual(dirty.fullTextSha256, sourceHash);
    let captured;
    try {
        captured = await capturedReveal(native, frame, reference);
        const editor = await native.channel.request('observeEditors');
        const live = editor.visible.find(item => item.uri === dirty.uri);
        if (live) { assert.equal(live.dirty, true); assert.equal(live.fullTextSha256, dirty.fullTextSha256); }
        assert.equal(digest(fs.readFileSync(source)), sourceHash);
        await native.capture('S05-dirty-captured-source', page);
    } finally {
        const reverted = await native.channel.request('revertBuffer', { path: source });
        assert.equal(reverted.dirty, false); assert.equal(reverted.fullTextSha256, sourceHash);
        await openWorkspacePanel(native, path.basename(inputs.workspace));
        await settled(frame);
    }
    await pass('S05', { forged, initialReveal, dirty, captured, diskSha256: sourceHash,
        contract: 'The actual dirty TextDocument remains unchanged by product reveal. Product opens its full historical read-only content provider and canonical range.' });
    const preserved = identity(await settled(frame));
    const saved = `${source}.approved-original`, outsideSource = path.join(inputs.outside, 'replacement.bsv');
    fs.writeFileSync(outsideSource, original, { flag: 'wx' }); fs.renameSync(source, saved); fs.symlinkSync(outsideSource, source);
    let replacement;
    try {
        replacement = await attack({ native, frame, id: 'source-symlink-replacement', action: 'source-open',
            payload: { buildId: state.current.buildId, reference }, expectedCode: 'PATH_DENIED' });
    } finally { fs.unlinkSync(source); fs.renameSync(saved, source); }
    await pass('S03', { initialSymlinkInputs: context.symlinks, replacement, preserved });
    const changed = [], failures = [];
    const start = () => frame.evaluate(() => window.__bsvVsixSmoke.host.length);
    let mark = await start(); fs.appendFileSync(source, '\n// isolated source freshness test\n');
    try {
        changed.push({ kind: 'source-changed', event: await staleEvent(frame, mark) });
        failures.push(await refreshFailure({ native, frame, expectedCode: 'ARTIFACT_HASH_MISMATCH' }));
    } finally { fs.writeFileSync(source, original); }
    mark = await start(); fs.renameSync(source, saved);
    try {
        changed.push({ kind: 'source-moved', event: await staleEvent(frame, mark), captured: await capturedReveal(native, frame, reference) });
        failures.push(await refreshFailure({ native, frame, expectedCode: 'ENOENT' }));
    } finally { fs.renameSync(saved, source); }
    const artifact = inputs.mutation.artifact, artifactBytes = fs.readFileSync(artifact);
    mark = await start(); fs.appendFileSync(artifact, '\n ');
    try {
        changed.push({ kind: 'artifact-changed', event: await staleEvent(frame, mark) });
        failures.push(await refreshFailure({ native, frame, expectedCode: 'ARTIFACT_HASH_MISMATCH' }));
    } finally { fs.writeFileSync(artifact, artifactBytes); }
    mark = await start(); const artifactMoved = `${artifact}.approved-original`; fs.renameSync(artifact, artifactMoved);
    try {
        changed.push({ kind: 'artifact-moved', event: await staleEvent(frame, mark) });
        failures.push(await refreshFailure({ native, frame, expectedCode: 'ENOENT' }));
    } finally { fs.renameSync(artifactMoved, artifact); }
    await pass('S12', { changed, sourceRestored: digest(fs.readFileSync(source)) === sourceHash,
        artifactRestored: digest(fs.readFileSync(artifact)) === digest(artifactBytes) });
    await pass('S14', { failures, semanticState: identity(await settled(frame)),
        contract: 'Every failed refresh is independently compared against the immediately preceding valid displayed build, snapshot, occurrence, selection, query/result and viewport.' });
}

async function runLifecycleCases(context) {
    const { native, inputs, pass } = context;
    let { frame, page } = context;
    await registerBundle({ native, frame, page, fixture: inputs.fixtures.A });
    const first = identity(await settled(frame));
    const firstProtocol = await frame.evaluate(() => window.BsvHardwareTransport.identity());
    assert.ok(native.receipt.environment.workspaceFolders.includes(pathToFileURL(inputs.secondWorkspace).href),
        'Second workspace must be opened from the initial explicit workspace file, without restarting the observer mid-run');
    const second = await openWorkspacePanel(native, path.basename(inputs.secondWorkspace));
    assert.notEqual(second.session.protocol.panelId, firstProtocol.panelId);
    await second.frame.locator('#native-empty').waitFor({ state: 'visible' });
    await registerBundle({ native, frame: second.frame, page: second.page, fixture: inputs.fixtures.B, needsSourceRoot: true });
    let secondState = await settled(second.frame);
    const storage = secondState.scene.storages[0]; assert.ok(storage); await chooseObject(second.frame, storage.id); secondState = await settled(second.frame);
    const secondIdentity = identity(secondState);
    const foreign = await attack({ native, frame: second.frame, id: 'two-panels-foreign-envelope',
        change: { panelId: firstProtocol.panelId, sessionId: firstProtocol.sessionId }, expectedCode: 'FORBIDDEN' });
    assert.deepEqual(identity(await settled(frame)), first);
    assert.deepEqual(identity(await settled(second.frame)), secondIdentity);
    const hardware = await native.channel.request('observeHardware'); assert.equal(hardware.activePanels, 2);
    const firstSession = hardware.sessions.find(session => session.protocol.panelId === firstProtocol.panelId);
    assert.ok(firstSession); assert.equal(firstSession.visible, false); assert.equal(firstSession.state.disposed, false);
    assert.ok(firstSession.watchers > 0, 'Hidden panels retain approved input watchers');
    await pass('S10', { first, second: secondIdentity, foreign, hardware,
        contract: 'One panel per explicit workspace. Hidden first panel retains state and approved watchers; separate workspace panel receives distinct authority.' });
    frame = second.frame; page = second.page; context.frame = frame; context.page = page;
    await frame.waitForFunction(() => window.__bsvVsixSmoke.states.some(state => state?.schema === 1 && state?.view));
    const stored = await frame.evaluate(() => window.__bsvVsixSmoke.states.at(-1));
    assert.ok(Buffer.byteLength(JSON.stringify(stored)) <= 16384);
    assert.equal(JSON.stringify(stored).includes(inputs.workspace), false);
    const beforePosts = await frame.evaluate(() => window.__bsvVsixSmoke.posts.length);
    await frame.evaluate(() => {
        window.__g6PendingAtClose = { settled: false };
        window.BsvHardwareTransport.request('choose-source').then(
            result => { window.__g6PendingAtClose = { settled: true, result }; },
            error => { window.__g6PendingAtClose = { settled: true, error: { code: error.code, message: error.message } }; });
    });
    await page.locator('.quick-input-widget').waitFor({ state: 'visible' });
    const pending = await frame.evaluate(count => window.__bsvVsixSmoke.posts.slice(count).find(message => message.action === 'choose-source'), beforePosts);
    assert.ok(pending); const secondProtocol = await frame.evaluate(() => window.BsvHardwareTransport.identity());
    await native.channel.request('uiCommand', { command: 'workbench.action.closeActiveEditor' });
    const retired = await poll(() => native.channel.request('observeHardware'), value => value.retired.some(row =>
        row.protocol.panelId === secondProtocol.panelId && row.state.disposed && row.state.activeOperations === 0), 'Disposed panel worker/listener cleanup');
    const retiredPanel = retired.retired.find(row => row.protocol.panelId === secondProtocol.panelId);
    assert.equal(retiredPanel.watchers, 0); assert.equal(retiredPanel.listeners, 0); assert.equal(retiredPanel.state.loading, false);
    if (await page.locator('.quick-input-widget').isVisible()) await page.locator('.quick-input-widget input').press('Escape');
    await pass('S09', { pendingRequest: pending, retired: retiredPanel, activePanels: retired.activePanels,
        contract: 'Actual panel close cancels an outstanding native chooser and releases every registered watcher/listener before retirement.' });
    const reopened = await openWorkspacePanel(native, path.basename(inputs.secondWorkspace));
    context.frame = reopened.frame; context.page = reopened.page;
    await reopened.frame.locator('#native-empty').waitFor({ state: 'visible' });
    const noInput = await reopened.frame.evaluate(() => ({ state: window.bsvHardware.getState(), transport: window.BsvHardwareTransport.identity(), posts: window.__bsvVsixSmoke.posts }));
    assert.equal(noInput.state.current, null); assert.notEqual(noInput.transport.sessionId, secondProtocol.sessionId);
    const reopenedHardware = await native.channel.request('observeHardware');
    const reopenedSession = reopenedHardware.sessions.find(session => session.protocol.panelId === noInput.transport.panelId);
    assert.equal(reopenedSession.watchers, 0); assert.equal(reopenedSession.current, null);
    assert.equal(reopenedSession.state.activeOperations, 0); assert.equal(reopenedSession.state.loading, false);
    assert.ok(!noInput.posts.some(message => ['choose-source', 'choose-artifact', 'choose-manifest', 'refresh-input', 'analysis'].includes(message.action)));
    await pass('S11', { stored, noInput, reopened: reopenedSession,
        contract: 'Actual disposed/recreated panel reads saved workspace metadata but restores no authority, input, compiler or analysis work. Full Code process restart is a separate validation scope.' });
}
module.exports = { runSourceCases, runLifecycleCases };
