#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { launchNative } = require('../g6/native-driver.cjs');
const { createRun } = require('../g6/run.cjs');
const { settled } = require('../g6/development-smoke.cjs');
const { identity } = require('../g6/native-acceptance.cjs');
const { measureNative, validateNativeTypography } = require('../g6/native-oracle.cjs');
const { sourceInventory } = require('../g6-discovery-cancel/native.cjs');
const { viewportFrame, assertViewportPreserved } = require('./native-history.cjs');
const ROOT = path.resolve(__dirname, '../../..');
const MESSAGE = 'This design exceeds the supported analysis size. Choose a smaller module.';
const RAW = 'Generated correspondence shared payload byte limit';
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const save = (output, name, value) => fs.writeFileSync(path.join(output, name), JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
async function run({ vsix, workspace, output = createRun('typeclass-native-limit') }) {
    workspace = fs.realpathSync(workspace); const before = sourceInventory(workspace); save(output, 'source-before.json', before);
    const report = { schema: 'g6-typeclass-native-limit-v1', status: 'running', startedAt: new Date().toISOString(), workspace,
        vsix, vsixSha256: digest(fs.readFileSync(vsix)), sources: { count: before.bsvFiles, fingerprint: before.fingerprint }, steps: [],
        boundary: 'Actual oversized workspace roots, ordinary QuickPick/root selector actions, installed VSIX and private Restricted Mode profile. No injected failure, model, query, source range or raised resource limit.' };
    save(output, 'contract.json', report); let native, frame, page;
    async function capture(name, rootName) {
        const dom = await frame.evaluate(() => {
            const state = window.bsvHardware.getState();
            return { current: state.current, error: state.error, pending: state.pending, history: state.history,
                scene: state.scene && { id: state.scene.id, sceneKind: state.scene.sceneKind, shell: state.scene.shell,
                    children: state.scene.children, storages: state.scene.storages, inspector: { title: state.scene.inspector.title } },
                transport: window.BsvHardwareTransport.identity(), status: document.querySelector('#native-input-status').textContent,
                footer: document.querySelector('#status').textContent, empty: document.querySelector('#native-empty-message').textContent,
                retryVisible: document.querySelector('#native-select-design').checkVisibility(),
                selectionTitle: document.querySelector('#selection-title').textContent,
                selector: { value: document.querySelector('#build-select').value, text: document.querySelector('#build-select').selectedOptions[0]?.textContent },
                hostMessages: window.__bsvVsixSmoke.host.filter(row => row.action === 'native-status' || row.error),
                posts: window.__bsvVsixSmoke.posts.map(row => ({ action: row.action, requestId: row.requestId, generation: row.generation })) };
        });
        const host = await native.channel.request('observeHardware');
        save(output, name + '.dom.json', dom); save(output, name + '.host.json', host);
        assert.equal(host.activePanels, 1); assert.equal(dom.transport.sessionId, report.sessionId);
        assert.equal(host.sessions[0].protocol.sessionId, report.sessionId);
        let typography = null;
        if (rootName) {
            assert.equal(dom.selector.text, rootName); assert.equal(dom.selectionTitle, rootName);
            assert.equal(dom.scene.shell.label, rootName);
            for (const field of ['buildId', 'ownerInstanceId', 'sourceRevision', 'selectedEntityId'])
                assert.equal(host.sessions[0].current[field], dom.current[field]);
            await frame.evaluate(async () => { await document.fonts.ready; await window.bsvHardware.whenSettled(); });
            await page.mouse.move(3, 3);
            const measurement = await measureNative({ native, frame, page });
            const expectations = { root: rootName, children: dom.scene.children.map(row => row.label), selected: true, allowOverviewAbbreviation: true };
            typography = validateNativeTypography(dom, measurement, expectations);
            save(output, name + '.measurement.json', measurement); save(output, name + '.typography.json', { expectations, ...typography });
        }
        await native.capture(name, page); await native.traceCheckpoint(name);
        console.log('NATIVE_CHECKPOINT', name);
        if (typography) assert.deepEqual(typography.findings, [], 'Strict native typography after recovery: ' + name);
        return { dom, host };
    }
    async function quickPick(name) {
        await page.locator('.quick-input-title').filter({ hasText: 'Choose a source design' }).waitFor({ state: 'visible', timeout: 90000 });
        await page.locator('.quick-input-widget input').fill(name);
        await page.locator('.quick-input-widget').getByRole('option', { name: new RegExp('^' + name + ',') }).click();
        await page.locator('.quick-input-widget').waitFor({ state: 'hidden' });
    }
    async function select(name) {
        const options = await frame.locator('#build-select option').evaluateAll(nodes => nodes.map(node => ({ value: node.value, text: node.textContent })));
        const found = options.filter(row => row.value.startsWith('design:') && row.text === name); assert.equal(found.length, 1);
        await frame.locator('#build-select').selectOption(found[0].value);
    }
    async function waitRoot(name) {
        await frame.waitForFunction(name => {
            const state = window.bsvHardware.getState(); if (state.error) throw new Error(JSON.stringify(state.error));
            return state.scene?.shell.label === name && !state.pending;
        }, name, { timeout: 90000 }); return settled(frame);
    }
    try {
        native = await launchNative({ vsix, workspace, output, restricted: true,
            observerVsix: path.join(ROOT, '.build/hardware/runs/g6-observer-resources-final-xQD0Ig/g6/bsv-lens-g6-observer-0.0.1.vsix'),
            harnessFiles: [__filename, path.join(__dirname, 'native-history.cjs'), path.join(__dirname, '../g6-discovery-cancel/native.cjs')] });
        page = native.context.pages()[0]; const noTrust = page.getByRole('button', { name: "No, I don't trust the authors", exact: true });
        if (await noTrust.isVisible()) await noTrust.click();
        assert.equal((await native.channel.request('observeEditors')).trusted, false);
        await native.channel.request('openProductCommand', { command: 'bsvArchitecture.openHardwareSchematic' });
        ({ page, frame } = await native.findWebview()); await frame.waitForFunction(() => !!window.BsvHardwareTransport.identity());
        report.sessionId = (await frame.evaluate(() => window.BsvHardwareTransport.identity())).sessionId;
        await quickPick('mkTbIM2PCoreMatrix');
        await frame.waitForFunction(message => document.querySelector('#native-input-status').textContent === message, MESSAGE, { timeout: 120000 });
        const initial = await capture('01-initial-oversized');
        assert.equal(initial.dom.scene, null); assert.equal(initial.dom.retryVisible, true);
        assert.equal(initial.dom.selector.text, 'Select a design');
        assert.equal(initial.dom.empty, MESSAGE); assert.equal(initial.dom.footer, MESSAGE);
        assert.ok(initial.dom.hostMessages.some(row => row.payload?.code === 'LIMIT_EXCEEDED' && row.payload.message === RAW
            || row.error?.code === 'LIMIT_EXCEEDED' && row.error.message === RAW));
        assert.equal(initial.dom.status.includes(RAW), false);
        report.steps.push({ id: 'initial-oversized', root: 'mkTbIM2PCoreMatrix', status: 'pass', message: initial.dom.status });
        await frame.locator('#native-select-design').click(); await quickPick('mkPE');
        const valid = await waitRoot('mkPE'), validIdentity = identity(valid);
        await capture('02-retry-to-PE', 'mkPE'); report.steps.push({ id: 'initial-retry', status: 'pass', root: 'mkPE', identity: validIdentity });
        const history = valid.history, beforeFailureViewport = await viewportFrame(frame);
        await select('mkTbIM2PCoreMultiwidth');
        const committedMessage = MESSAGE + ' Still showing mkPE.';
        await frame.waitForFunction(message => document.querySelector('#native-input-status').textContent === message, committedMessage, { timeout: 120000 });
        const preserved = await capture('03-committed-oversized', 'mkPE');
        assert.equal(preserved.dom.status, committedMessage); assert.equal(preserved.dom.footer, committedMessage);
        assert.equal(preserved.dom.scene.id, valid.scene.id); assert.equal(preserved.dom.pending, false);
        const afterIdentity = identity(preserved.dom);
        for (const field of ['buildId', 'snapshotId', 'provider', 'owner', 'occurrence', 'selected', 'relation', 'queryId', 'resultHash'])
            assert.equal(afterIdentity[field], validIdentity[field]);
        assert.deepEqual(preserved.dom.history, history);
        const viewportPreservation = assertViewportPreserved(beforeFailureViewport, await viewportFrame(frame));
        assert.ok(preserved.dom.hostMessages.some(row => row.payload?.code === 'LIMIT_EXCEEDED' && row.payload.message === RAW
            || row.error?.code === 'LIMIT_EXCEEDED' && row.error.message === RAW));
        report.steps.push({ id: 'committed-oversized', status: 'pass', requestedRoot: 'mkTbIM2PCoreMultiwidth', retainedRoot: 'mkPE',
            message: preserved.dom.status, before: validIdentity, after: afterIdentity, historyUnchanged: true, viewportPreservation });
        await select('mkExecuteController'); const next = await waitRoot('mkExecuteController');
        const recovered = await capture('04-other-normal-design', 'mkExecuteController');
        assert.equal(recovered.dom.status.includes(MESSAGE), false); assert.equal(next.current.analysis ?? null, null);
        assert.notEqual(next.current.ownerInstanceId, valid.current.ownerInstanceId);
        report.steps.push({ id: 'committed-recovery', status: 'pass', root: 'mkExecuteController', identity: identity(next) });
        report.build = recovered.host.sessions[0].build; report.status = 'pass';
        await native.close(); assert.equal(native.receipt.status, 'passed');
    } catch (error) {
        report.status = 'fail'; report.error = error.stack || String(error);
        if (native && frame) await capture('failure').catch(value => { report.captureError = value.message; });
        await native?.close('failed', error); throw error;
    } finally {
        const after = sourceInventory(workspace); save(output, 'source-after.json', after);
        report.sourcePreserved = JSON.stringify(before) === JSON.stringify(after); if (!report.sourcePreserved) report.status = 'fail';
        report.finishedAt = new Date().toISOString(); save(output, 'validation.json', report);
        console.log(JSON.stringify({ output, status: report.status }));
        assert.ok(report.sourcePreserved, 'Original source/settings changed during native limit validation');
    }
    return report;
}
if (require.main === module) {
    const [vsix, workspace] = process.argv.slice(2);
    if (vsix === '--help') console.log('node native-limit.cjs FINAL.vsix WORKSPACE');
    else run({ vsix, workspace }).catch(error => { console.error(error); process.exitCode = 1; });
}
module.exports = { run };
