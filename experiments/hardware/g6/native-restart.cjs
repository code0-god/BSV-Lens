'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { launchNative } = require('./native-driver.cjs');
const { createRun } = require('./run.cjs');
const { settled, chooseObject } = require('./development-smoke.cjs');
const { registerBundle, enter, analyze, sourceReveal } = require('./native-acceptance.cjs');
const { measureNative } = require('./native-oracle.cjs');
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const write = (file, value) => fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' });
async function current(frame) {
    return frame.evaluate(() => {
        const state = window.bsvHardware.getState();
        return { view: window.bsvHardware.persistableState(), queryId: state.current?.analysis?.result.queryId || null,
            sourceRefs: (state.current?.analysis?.result.sourceRefs || []).map(ref => ({ id: ref.id, pathRef: ref.pathRef,
                revision: ref.revision, range: ref.range, sliceHash: ref.sliceHash })) };
    });
}
async function persisted(frame, state) {
    await frame.waitForFunction(expected => {
        const post = window.__bsvVsixSmoke.posts.findLast(message => message.action === 'persist'
            && JSON.stringify(message.payload.state) === expected);
        if (post && (!Number.isSafeInteger(post.payload.revision) || post.payload.revision <= 0
            || Object.hasOwn(post.payload.state, 'revision'))) throw new Error('Commit revision must be transient positive session metadata');
        return post && window.__bsvVsixSmoke.host.some(message => message.kind === 'response'
            && message.requestId === post.requestId && message.status === 'ok');
    }, JSON.stringify(state), { timeout: 30000 });
}
async function run({ vsix, observerVsix, fixturePath, output = process.env.G6_OUTPUT_DIR || createRun('native-restart') }) {
    assert.ok(vsix && observerVsix && fixturePath, 'Explicit installed product/observer VSIX and external fixture JSON required');
    const fixtureBytes = fs.readFileSync(fixturePath), data = JSON.parse(fixtureBytes);
    assert.equal(data.schema, 'g6-native-fixtures-v1'); assert.equal(data.status, 'pass'); assert.ok(data.fixtures.A);
    const fixture = data.fixtures.A, vsixSha256 = hash(fs.readFileSync(vsix)), observerSha256 = hash(fs.readFileSync(observerVsix));
    const firstOutput = path.join(output, 'first', 'g6'), secondOutput = path.join(output, 'second', 'g6');
    fs.mkdirSync(firstOutput, { recursive: true }); fs.mkdirSync(secondOutput, { recursive: true });
    const report = { schema: 'g6-native-process-restart-v1', status: 'running', targetMode: 'installed',
        vsix: path.resolve(vsix), vsixSha256, observerVsix: path.resolve(observerVsix), observerSha256,
        fixturePath: path.resolve(fixturePath), fixtureSha256: hash(fixtureBytes), workspace: data.workspace,
        contract: 'Two separate installed VS Code processes use the same validated private profile. The second process has no input authority until explicit UI registration; only then may it restore the saved semantic view.',
        userVisualDesignAcceptance: 'PENDING', steps: [] };
    write(path.join(output, 'restart-contract.json'), report);
    let native, frame, page;
    const pass = (name, details) => { report.steps.push({ name, status: 'PASS', ...details }); console.log(`NATIVE_RESTART_PASS ${name}`); };
    async function launch(directory, previousReceipt) {
        native = await launchNative({ vsix, observerVsix, workspace: data.workspace, output: directory,
            ...(previousReceipt ? { reuseProfileReceipt: previousReceipt } : {}), harnessFiles: [__filename,
                path.resolve(__dirname, '../g5-readability/oracle.cjs')] });
        await native.channel.request('openProductCommand', { command: 'bsvArchitecture.openHardwareSchematic' });
        ({ frame, page } = await native.findWebview());
        await frame.waitForFunction(() => !!window.BsvHardwareTransport?.identity());
        await frame.locator('#native-empty').waitFor({ state: 'visible' });
    }
    try {
        await launch(firstOutput);
        await registerBundle({ native, frame, page, fixture, needsSourceRoot: true });
        let state = await enter(frame, 'left'), storage = state.scene.storages.find(row => row.label === 'state'); assert.ok(storage);
        await chooseObject(frame, storage.id); await analyze(frame, 'state-accesses');
        await frame.locator('[data-code-section="writer"] [data-analysis-kind="behavior"]').click();
        await frame.waitForFunction(() => window.bsvHardware.getState().current?.analysis?.result.kind === 'behavior'); await settled(frame);
        await frame.locator('#fit-selection').click(); await settled(frame);
        if (!await frame.locator('#capability-panel').evaluate(node => node.open)) await frame.locator('#capability-panel > summary').click();
        await settled(frame); const before = await current(frame); assert.ok(before.queryId && before.sourceRefs.length);
        assert.equal(before.view.view.disclosureState.capabilities, true);
        await persisted(frame, before.view);
        write(path.join(firstOutput, 'saved-view.json'), before);
        write(path.join(firstOutput, 'readability.measurement.json'), await measureNative({ native, frame, page }));
        await native.capture('saved-analysis', page); await native.traceCheckpoint('saved-analysis');
        const firstPid = native.receipt.launch.pid, firstProfile = native.receipt.isolation.profile;
        const firstIdentity = await frame.evaluate(() => window.BsvHardwareTransport.identity());
        await native.close(); assert.equal(native.receipt.status, 'passed'); assert.equal(native.receipt.shutdown.code, 0);
        const firstReceipt = path.join(firstOutput, 'native-receipt.json'), firstReceiptSha256 = hash(fs.readFileSync(firstReceipt));
        pass('first-process-saved-and-exited', { pid: firstPid, profile: firstProfile, receipt: firstReceipt, receiptSha256: firstReceiptSha256,
            view: before.view, queryId: before.queryId });
        await launch(secondOutput, firstReceipt);
        const unregistered = await frame.evaluate(() => ({ current: window.bsvHardware.getState().current,
            identity: window.BsvHardwareTransport.identity(), actions: window.__bsvVsixSmoke.posts.map(message => message.action) }));
        assert.notEqual(native.receipt.launch.pid, firstPid); assert.equal(native.receipt.isolation.profile, firstProfile);
        assert.notEqual(unregistered.identity.sessionId, firstIdentity.sessionId); assert.notEqual(unregistered.identity.panelId, firstIdentity.panelId);
        assert.equal(unregistered.current, null);
        assert.ok(!unregistered.actions.some(action => ['scene', 'analysis', 'source', 'source-open', 'choose-source', 'choose-manifest'].includes(action)));
        const hardware = await native.channel.request('observeHardware'); assert.equal(hardware.sessions.length, 1);
        assert.equal(hardware.sessions[0].watchers, 0); assert.equal(hardware.sessions[0].state.activeOperations, 0);
        pass('second-process-no-automatic-authority', { pid: native.receipt.launch.pid, unregistered, hardware,
            workspaceStateBefore: native.receipt.restart.workspaceStateBefore });
        await native.capture('restart-unregistered', page); await native.traceCheckpoint('restart-unregistered');
        await registerBundle({ native, frame, page, fixture, needsSourceRoot: true });
        await frame.waitForFunction(queryId => window.bsvHardware.getState().current?.analysis?.result.queryId === queryId
            && !window.bsvHardware.getState().pending, before.queryId, { timeout: 30000 });
        await settled(frame); const after = await current(frame);
        assert.deepEqual(after, before, 'Explicit re-registration did not restore the same view, query and source identity');
        await persisted(frame, after.view);
        write(path.join(secondOutput, 'restored-view.json'), after);
        write(path.join(secondOutput, 'readability.measurement.json'), await measureNative({ native, frame, page }));
        await native.capture('restored-analysis', page); await native.traceCheckpoint('restored-analysis');
        pass('explicit-registration-restores-analysis', { before, after });
        const referenceId = await frame.locator('#code-drawer pre[data-source-reference-id]').first().getAttribute('data-source-reference-id');
        assert.ok(after.sourceRefs.some(reference => reference.id === referenceId));
        const editor = await sourceReveal({ native, frame, fixture, referenceId });
        write(path.join(secondOutput, 'restored-source-editor.json'), editor);
        await native.capture('restored-source-editor', page); await native.traceCheckpoint('restored-source-editor');
        pass('restored-source-opens-real-editor', editor);
        await native.close(); assert.equal(native.receipt.status, 'passed');
        assert.equal(hash(fs.readFileSync(firstReceipt)), firstReceiptSha256, 'Earlier receipt was modified by the restart');
        report.firstReceipt = firstReceipt; report.secondReceipt = path.join(secondOutput, 'native-receipt.json'); report.status = 'PASS';
    } catch (error) {
        report.status = 'FAIL'; report.failure = error.stack || String(error);
        if (native) {
            try { if (frame && !frame.isDetached()) { write(path.join(output, 'failure-view.json'), await current(frame));
                await native.capture('restart-failure', page); } } catch (failure) { report.captureFailure = failure.message; }
            await native.close('failed', error);
        }
    } finally {
        report.inputsPreserved = hash(fs.readFileSync(vsix)) === vsixSha256 && hash(fs.readFileSync(observerVsix)) === observerSha256
            && hash(fs.readFileSync(fixturePath)) === hash(fixtureBytes) && data.inventory.every(row => {
                const bytes = fs.readFileSync(path.join(data.workspace, row.path)); return bytes.length === row.bytes && hash(bytes) === row.sha256;
            });
        if (!report.inputsPreserved) report.status = 'FAIL'; report.finishedAt = new Date().toISOString();
        write(path.join(output, 'native-restart.json'), report);
    }
    return report;
}
if (require.main === module) {
    if (process.argv.includes('--help')) console.log('Usage: native-restart.cjs PRODUCT.vsix OBSERVER.vsix EXTERNAL-FIXTURES.json');
    else { const [vsix, observerVsix, fixturePath] = process.argv.slice(2);
        run({ vsix, observerVsix, fixturePath }).then(report => { console.log(JSON.stringify({ status: report.status, steps: report.steps.map(row => row.name), failure: report.failure }));
            if (report.status !== 'PASS') process.exitCode = 1; }).catch(error => { console.error(error.stack || error); process.exitCode = 1; }); }
}
module.exports = { run, current, persisted };
