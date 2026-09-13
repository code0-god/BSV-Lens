'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { settled, chooseObject } = require('../g6/development-smoke.cjs');
const { identity, enter, analyze } = require('../g6/native-acceptance.cjs');
const { poll, revealButton } = require('../g6/native-security-attacks.cjs');
const { clickWire, validateNativeTypography } = require('../g6/native-oracle.cjs');
const { digest } = require('./native-lifecycle-inputs.cjs');

async function gate(frame, action, owner = null) {
    await frame.evaluate(({ action, owner }) => {
        const original = window.BsvHardwareTransport.request;
        const gate = window.__lifecycleGate = { original, action, owner, reached: false, enabled: true, released: false };
        window.BsvHardwareTransport.request = function delayedActualResponse(kind, payload, options) {
            const result = original.call(this, kind, payload, options);
            if (kind !== action || !gate.enabled || owner && !payload.intent?.ownerInstanceId?.includes(owner)) return result;
            return result.then(value => { gate.reached = true; gate.body = structuredClone(value);
                return new Promise(resolve => { gate.release = () => { gate.released = true; gate.enabled = false; resolve(value); }; }); });
        };
    }, { action, owner });
}
async function release(frame) {
    return frame.evaluate(() => {
        const gate = window.__lifecycleGate; if (!gate) return null;
        gate.release?.(); window.BsvHardwareTransport.request = gate.original;
        const result = { action: gate.action, reached: gate.reached, released: gate.released, body: gate.body };
        delete window.__lifecycleGate; return result;
    });
}
async function runInteractions(context) {
    const { native, inputs, frame, page, pass, capture, waitOwner, waitSource, refresh, selection, output } = context;
    const captureArtifact = async label => {
        const observed = await capture(label), scene = observed.state.scene;
        assert.equal(scene.sceneKind, 'rtl');
        const objects = [scene.shell, ...scene.children.filter(item => item.kind === 'rtl-occurrence')];
        const mandatory = objects.map(item => ({ ownerId: item.id, role: 'node-title', minFont: 9, text: item.label }));
        const typography = validateNativeTypography(observed.state, observed.measurement,
            { mandatory, minimumFont: 9, allowOverviewAbbreviation: true });
        const humanStatus = { text: observed.dom.input,
            settled: !/\bOpening\b|여는\s*중|불러오는\s*중/i.test(observed.dom.input) };
        fs.writeFileSync(path.join(output, `${label}.typography.json`), JSON.stringify({
            expectedFrom: 'Canonical RTL shell and direct rtl-occurrence children, independent of rendered visible labels',
            mandatory, typography, humanStatus, vsixSha256: native.receipt.vsixSha256 }, null, 2) + '\n', { flag: 'wx' });
        assert.equal(typography.status, 'pass', `${label} native typography: ${JSON.stringify(typography.findings)}`);
        assert.equal(humanStatus.settled, true, `${label} still reports a pending input operation`);
        return observed;
    };
    const sourceFile = inputs.source;
    let state = await settled(frame);
    await frame.locator('#breadcrumb button').first().click(); state = await waitOwner('mkController');
    inputs.write('deep/service/Service.bsv', inputs.maintenance);
    await waitSource(session => session.discovery?.included.some(file => file.path === 'deep/service/Service.bsv'));
    inputs.settings({ 'bsvArchitecture.autoRefresh': false });
    await poll(() => frame.evaluate(() => window.__bsvVsixSmoke.host.findLast(message => message.action === 'discovery-invalidated')?.payload),
        value => value?.autoRefresh === false, 'Manual refresh configuration reached native watcher');
    await refresh(); await waitOwner('mkController'); state = await settled(frame);
    const before = identity(state), posts = await frame.evaluate(() => window.__bsvVsixSmoke.posts.length);
    await gate(frame, 'scene', 'mkMaintenance');
    try {
        const choice = await frame.locator('#build-select option').evaluateAll(nodes => nodes.find(node => node.textContent === 'mkMaintenance')?.value);
        assert.ok(choice); await frame.locator('#build-select').selectOption(choice);
        await frame.waitForFunction(() => window.__lifecycleGate.reached);
        const invalidationStart = await frame.evaluate(() => window.__bsvVsixSmoke.host.length);
        inputs.write('deep/service/Service.bsv', inputs.maintenance + '// saved after actual scene response\n');
        await poll(() => frame.evaluate(from => window.__bsvVsixSmoke.host.slice(from).filter(message => message.action === 'discovery-invalidated')
            .findLast(message => message.payload?.changedFiles.includes('deep/service/Service.bsv'))?.payload, invalidationStart), Boolean, 'Candidate source invalidation');
        const delayed = await release(frame);
        await frame.waitForFunction(() => window.bsvHardware.getState().outcome?.code === 'STALE_SOURCE');
        const rejected = await capture('F05-stale-design');
        assert.equal(rejected.state.current.ownerInstanceId, before.owner); assert.equal(rejected.host.current.buildId, before.buildId);
        assert.equal(rejected.dom.selectedLabel, 'mkController');
        pass('F05-stale-design', { before, delayed, rejected: rejected.state.current, rejectedPostCount: posts });
    } finally { await release(frame); }
    await refresh(); await waitOwner('mkController'); state = await settled(frame);
    const rapidBefore = identity(state); await gate(frame, 'scene', 'mkMaintenance');
    try {
        const choice = await frame.locator('#build-select option').evaluateAll(nodes => nodes.find(node => node.textContent === 'mkMaintenance')?.value);
        await frame.locator('#build-select').selectOption(choice); await frame.waitForFunction(() => window.__lifecycleGate.reached);
        await frame.locator('#back').click(); const delayed = await release(frame);
        await frame.waitForFunction(() => !window.bsvHardware.getState().pending);
        const restored = await capture('F06-rapid-back');
        assert.equal(restored.state.current.ownerInstanceId, rapidBefore.owner); assert.equal(restored.host.current.ownerInstanceId, rapidBefore.owner);
        assert.equal(restored.dom.selectedLabel, 'mkController'); pass('F06-rapid-back', { before: rapidBefore, delayed, restored: restored.state.current });
    } finally { await release(frame); }
    inputs.settings(); await waitSource(session => session.discovery?.rules && session.state.activeOperations === 0);
    state = await enter(frame, 'west'); await chooseObject(frame, state.scene.storages.find(item => item.label === 'state').id);
    await analyze(frame, 'state-accesses'); await frame.locator('[data-code-section="writer"] [data-analysis-kind="behavior"]').first().click();
    await frame.waitForFunction(() => window.bsvHardware.getState().current?.analysis?.result.kind === 'behavior'); state = await settled(frame);
    const referenceId = await frame.locator('#code-drawer pre[data-source-reference-id]').first().getAttribute('data-source-reference-id');
    const reference = state.current.analysis.result.sourceRefs.find(item => item.id === referenceId), selected = identity(state); assert.ok(reference);
    await gate(frame, 'source');
    try {
        await revealButton(frame, referenceId); await frame.waitForFunction(() => window.__lifecycleGate.reached);
        await frame.locator('#toggle-inspector').click(); await frame.locator('#toggle-inspector').click();
        const pending = await frame.evaluate(() => ({ state: window.bsvHardware.getState(),
            sourcePosts: window.__bsvVsixSmoke.posts.filter(message => message.action === 'source').length }));
        assert.equal(pending.state.current.analysis.result.queryId, selected.queryId); assert.equal(pending.state.current.selectedEntityId, selected.selected);
        const since = native.channel.records.length, delayed = await release(frame);
        const editor = await native.channel.waitFor('editorSelection', event => event.editor?.selectionSha256 === reference.sliceHash
            && event.editor.fullTextSha256 === reference.revision, 30000, since);
        await native.capture('U09-delayed-source-editor', page);
        pass('U09-delayed-source', { selected, pending, delayed, editor, sourcePath: sourceFile });
    } finally { await release(frame); }
    const opening = native.channel.request('openProductCommand', { command: 'bsvArchitecture.openHardwareSchematic' }); opening.catch(() => {});
    await native.nativeInput({ choice: path.basename(inputs.main) }, page); await opening;
    await frame.locator('#breadcrumb button').first().click(); await waitOwner('mkController');
    const sourceBeforeArtifact = identity(await settled(frame));
    const openCandidates = async () => {
        await frame.locator('#connect-rtl').click();
        await page.locator('.quick-input-title').filter({ hasText: 'Choose artifact authority root' }).waitFor();
        await native.nativeInput({ choice: path.basename(inputs.artifacts) }, page);
        await page.locator('.quick-input-title').filter({ hasText: 'Connect an RTL result' }).waitFor();
        return frame.evaluate(() => window.__bsvVsixSmoke.host.findLast(message => message.action === 'artifact-candidates').payload);
    };
    const candidates = await openCandidates(); assert.equal(candidates.candidates.length, 2); assert.equal(candidates.rejected.length, 2);
    assert.equal(candidates.automaticallySelected, null); assert.equal(candidates.importExecuted, false); assert.equal(candidates.sourceJoinPerformed, false);
    await native.capture('R02-explicit-artifact-candidates', page); await page.locator('.quick-input-widget input').press('Escape');
    assert.deepEqual(identity(await settled(frame)), sourceBeforeArtifact); pass('R02-R03-R04', { candidates, sourceBeforeArtifact });
    await openCandidates(); const first = path.join(inputs.artifacts, 'first.json'), original = fs.readFileSync(first);
    const mark = await frame.evaluate(() => window.__bsvVsixSmoke.host.length); fs.appendFileSync(first, '\n');
    let mismatch;
    try {
        await native.nativeInput({ choice: 'first.json' }, page);
        mismatch = await poll(() => frame.evaluate(start => window.__bsvVsixSmoke.host.slice(start).find(message => message.action === 'choose-artifact'
            && message.kind === 'response' && message.error), mark), Boolean, 'Changed artifact candidate rejected');
        assert.equal(mismatch.error.code, 'ARTIFACT_HASH_MISMATCH'); assert.deepEqual(identity(await settled(frame)), sourceBeforeArtifact);
    } finally { fs.writeFileSync(first, original); }
    pass('R05-R06', { mismatch, preservedSource: sourceBeforeArtifact, restoredArtifactHash: digest(original) });
    await openCandidates(); await native.nativeInput({ choice: 'second.json' }, page);
    await page.locator('.quick-input-title').filter({ hasText: 'Choose an actual root' }).waitFor();
    const root = (await page.locator('.quick-input-list .label-name').allTextContents()).filter(label => label.includes('RTL design root'));
    assert.equal(root.length, 1); await native.nativeInput({ choice: root[0] }, page);
    await frame.waitForFunction(() => window.bsvHardware.getState().current?.sceneKind === 'rtl' && !window.bsvHardware.getState().pending);
    state = await settled(frame); assert.equal(state.current.ownerInstanceId, null); assert.equal(state.scene.sourceContext, null);
    const rtlRoot = state.scene.shell.id; await captureArtifact('F08-artifact-only-root');
    const visits = [];
    for (const name of ['left', 'right']) {
        const entered = await enter(frame, name); visits.push({ name, occurrence: entered.scene.shell.id });
        await frame.locator('#up').click(); state = await settled(frame); assert.equal(state.scene.shell.id, rtlRoot);
    }
    assert.notEqual(visits[0].occurrence, visits[1].occurrence);
    const connection = state.scene.connections.find(item => item.bits.length && state.geometry.routes.some(route => route.id === item.id)); assert.ok(connection);
    const wire = await clickWire({ frame, page, connectionId: connection.id });
    assert.deepEqual(wire.state.scene.inspector.connectivity.bits, connection.bits); await captureArtifact('F08-artifact-wire');
    pass('F08-RTL-F1-F2', { visits, selectedNet: connection.id, bits: connection.bits, point: wire.point });
    for (let step = 0; step < 8 && (await settled(frame)).current.sceneKind === 'rtl'; step++) await frame.locator('#back').click();
    state = await settled(frame); assert.equal(state.current.sceneKind, 'bsv'); assert.equal(state.current.ownerInstanceId, sourceBeforeArtifact.owner);
    assert.equal(state.current.snapshotId, null); pass('R06-artifact-back-source', { before: sourceBeforeArtifact, after: identity(state) });
    assert.equal(fs.existsSync(inputs.marker), false);
}
module.exports = { runInteractions, gate, release };
