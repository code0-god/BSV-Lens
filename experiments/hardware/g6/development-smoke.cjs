#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { launchDevelopment, launchNative } = require('./native-driver.cjs');
const { createRun } = require('./run.cjs');

const ROOT = path.resolve(__dirname, '../../..');
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const json = (file, value) => fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' });
async function settled(frame) {
    await frame.waitForFunction(() => {
        const state = window.bsvHardware?.getState();
        if (state?.error) throw new Error(JSON.stringify(state.error));
        return state?.current && state.scene && !state.pending && !state.transition;
    }, null, { timeout: 30000 });
    await frame.evaluate(async () => { await document.fonts.ready; await window.bsvHardware.whenSettled(); });
    return frame.evaluate(() => window.bsvHardware.getState());
}
async function chooseObject(frame, id) {
    const target = frame.locator(`[data-semantic-id=${JSON.stringify(id)}][data-active="true"]`);
    const body = target.locator('.body');
    if (await body.count()) {
        await body.click();
    } else await target.locator('.mark').first().click();
}
async function executeSmoke({ targetMode, vsix } = {}) {
    assert.ok(['development', 'installed'].includes(targetMode), 'Explicit smoke target mode required');
    assert.ok(targetMode === 'installed' ? typeof vsix === 'string' && vsix.length : vsix === undefined, 'VSIX is required only for installed smoke');
    const lane = targetMode === 'installed' ? 'installed' : 'development';
    const output = process.env.G6_OUTPUT_DIR || createRun(`${lane}-smoke`);
    const fixture = path.join(ROOT, 'experiments/hardware/fixtures/Connected.bsv');
    const workspace = path.join(output, 'workspace'); fs.mkdirSync(workspace);
    const source = path.join(workspace, 'Connected.bsv'); fs.copyFileSync(fixture, source, fs.constants.COPYFILE_EXCL);
    const bytes = fs.readFileSync(source), originalHash = digest(bytes);
    const report = { schema: 'g6-source-smoke-v1', targetMode, scope: targetMode === 'installed' ? 'Explicit installed VSIX, source-only Connected smoke; not full N01–N15 acceptance'
        : 'Real development Extension Host, source-only Connected; not installed VSIX acceptance',
        startedAt: new Date().toISOString(), status: 'running', source: { original: fixture, copy: source, bytes: bytes.length, sha256: originalHash }, steps: [] };
    json(path.join(output, `${lane}-contract.json`), { ...report, productEditsAllowed: false, compilerExecution: false,
        hypothesesIfBlocked: ['Native host/asset handshake fails before input', 'Actual VS Code input differs from harness selectors', 'Product source-only query/source authority fails after registration'] });
    let native, frame, page;
    try {
        native = targetMode === 'installed' ? await launchNative({ vsix, workspace, output })
            : await launchDevelopment({ developmentRoot: ROOT, workspace, output });
        await native.channel.request('openProductCommand', { command: 'bsvArchitecture.openHardwareSchematic' });
        ({ frame, page } = await native.findWebview());
        await frame.locator('#native-empty').waitFor({ state: 'visible', timeout: 30000 });
        await frame.waitForFunction(() => !!window.BsvHardwareTransport?.identity(), null, { timeout: 30000 });
        report.steps.push({ name: 'empty-input', status: 'passed', nativeStatus: await frame.locator('#native-input-status').innerText() });
        await native.capture(`${lane}-empty`, page);
        await frame.locator('#native-empty [data-native-action="choose-source"]').click();
        await native.nativeInput({ choice: path.basename(workspace) }, page);
        await page.locator('.quick-input-title').filter({ hasText: 'Source folder' }).waitFor({ state: 'visible', timeout: 30000 });
        await native.nativeInput({ text: '.' }, page);
        let state = await settled(frame);
        assert.equal(state.scene.sceneKind, 'bsv');
        assert.ok(state.scene.children.some(child => child.label === 'left'), 'Source-only overall scene lacks actual left child');
        json(path.join(output, `${lane}-overall-state.json`), state);
        report.steps.push({ name: 'registered-source', status: 'passed', current: state.current });
        await native.capture(`${lane}-overall`, page);
        const left = state.scene.children.find(child => child.label === 'left');
        await chooseObject(frame, left.id);
        await frame.waitForFunction(id => window.bsvHardware.getState().current?.ownerInstanceId === id, left.id, { timeout: 30000 });
        state = await settled(frame);
        const storage = state.scene.storages.find(item => item.label === 'state'); assert.ok(storage, 'Entered left has no state storage');
        await chooseObject(frame, storage.id);
        await frame.locator('[data-analysis-kind="state-accesses"]').first().click();
        await frame.waitForFunction(() => window.bsvHardware.getState().current?.analysis?.result?.kind === 'state-accesses', null, { timeout: 30000 });
        state = await settled(frame); json(path.join(output, `${lane}-state-accesses.json`), state);
        assert.equal(state.current.selectedEntityId, storage.id);
        assert.ok(state.current.analysis.result.writers.length, 'State access query omitted actual writer');
        await frame.locator('[data-code-section="writer"] [data-analysis-kind="behavior"]').click();
        await frame.waitForFunction(() => window.bsvHardware.getState().current?.analysis?.result?.kind === 'behavior', null, { timeout: 30000 });
        state = await settled(frame); json(path.join(output, `${lane}-writer-state.json`), state);
        const selectedPre = frame.locator('#code-drawer pre[data-source-reference-id]').first();
        const referenceId = await selectedPre.getAttribute('data-source-reference-id');
        const reference = state.current.analysis.result.sourceRefs.find(ref => ref.id === referenceId);
        assert.ok(reference, 'Rendered writer reference is not in product query result');
        const before = native.channel.records.length;
        await frame.locator(`[data-source-open-id=${JSON.stringify(referenceId)}]`).first().click();
        const selected = await native.channel.waitFor('editorSelection', event => event.editor?.uri === pathToFileURL(source).href
            && event.editor.selectionText === bytes.toString('utf8').slice(reference.range.start, reference.range.end), 30000, before);
        const expectedPrefix = bytes.toString('utf8').slice(0, reference.range.start).split('\n');
        const expectedEnd = bytes.toString('utf8').slice(0, reference.range.end).split('\n');
        assert.deepEqual(selected.editor.selection.start, { line: expectedPrefix.length - 1, character: expectedPrefix.at(-1).length });
        assert.deepEqual(selected.editor.selection.end, { line: expectedEnd.length - 1, character: expectedEnd.at(-1).length });
        assert.equal(selected.editor.fullTextSha256, originalHash); assert.equal(selected.editor.dirty, false);
        report.sourceReveal = { reference, actualEditor: selected.editor };
        report.steps.push({ name: 'actual-editor-writer-reveal', status: 'passed', referenceId, editor: selected.editor });
        report.hardware = await native.channel.request('observeHardware');
        const transport = await frame.evaluate(() => {
            const observed = window.__bsvVsixSmoke;
            if (!observed) throw new Error('Native observation hook unavailable');
            return { host: observed.host, posts: observed.posts, states: observed.states };
        });
        const identity = report.hardware.sessions[0].protocol;
        for (const action of ['hello', 'choose-source', 'analysis', 'source', 'source-open']) {
            assert.ok(transport.posts.some(message => message.action === action), `Actual native ${action} request was not observed`);
        }
        for (const message of transport.posts.filter(message => message.action !== 'hello')) {
            assert.equal(message.panelId, identity.panelId); assert.equal(message.sessionId, identity.sessionId);
            assert.equal(message.buildId, identity.buildId); assert.equal(message.protocol, 1);
        }
        json(path.join(output, 'native-protocol.json'), transport);
        report.protocolEvidence = { file: 'native-protocol.json', hostMessages: transport.host.length,
            webviewRequests: transport.posts.length, savedStates: transport.states.length, identity };
        await native.capture(`${lane}-editor-source`, page);
        report.status = 'passed'; await native.close(); assert.equal(native.receipt.status, 'passed');
    } catch (error) {
        report.status = 'failed'; report.error = error?.stack || String(error);
        if (native) {
            try { await native.capture(`${lane}-failure`, page); } catch (captureError) { report.captureError = captureError.message; }
            try { report.hardware = await native.channel.request('observeHardware'); } catch (observeError) { report.observeError = observeError.message; }
            if (frame) {
                try { report.dom = await frame.locator('body').innerText(); report.state = await frame.evaluate(() => window.bsvHardware?.getState()); }
                catch (stateError) { report.stateError = stateError.message; }
            }
            await native.close('failed', error);
        }
        console.error(error?.stack || error); process.exitCode = 1;
    } finally {
        report.originalPreserved = digest(fs.readFileSync(fixture)) === originalHash && digest(fs.readFileSync(source)) === originalHash;
        report.finishedAt = new Date().toISOString(); json(path.join(output, `${lane}-smoke.json`), report);
        console.log(JSON.stringify({ output, status: report.status, steps: report.steps.map(step => step.name), error: report.error }));
    }
}
const main = () => executeSmoke({ targetMode: 'development' });
if (require.main === module) main().catch(error => { console.error(error?.stack || error); process.exitCode = 1; });
module.exports = { main, executeSmoke, settled, chooseObject };
