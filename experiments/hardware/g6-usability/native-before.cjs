#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { launchNative } = require('../g6/native-driver.cjs');
const { createRun } = require('../g6/run.cjs');
const { workspaceInventory } = require('../g6/live-compiler.cjs');
const { measureNative, validateNativeTypography } = require('../g6/native-oracle.cjs');

const ROOT = path.resolve(__dirname, '../../..');
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const write = (output, name, value) => fs.writeFileSync(path.join(output, name), JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
async function idle(frame) {
    await frame.waitForFunction(() => {
        const state = window.bsvHardware?.getState();
        return state && !state.pending && !state.transition;
    }, null, { timeout: 60000 });
    await frame.evaluate(async () => { await document.fonts.ready; await window.bsvHardware.whenSettled(); });
    return frame.evaluate(() => window.bsvHardware.getState());
}
async function main() {
    const output = process.env.G6_OUTPUT_DIR || createRun('usability-before');
    const workspace = process.env.G6_WORKSPACE || path.join(os.homedir(), 'aisa-lab/DynDNN/AQuA');
    const vsix = path.join(ROOT, 'dist/bsv-lens-0.4.1-568cd5d7de13990a.vsix');
    const observerVsix = path.join(ROOT, '.build/hardware/runs/g6-observer-resources-final-xQD0Ig/g6/bsv-lens-g6-observer-0.0.1.vsix');
    const before = workspaceInventory(workspace);
    write(output, 'workspace-before.json', before);
    const report = { schema: 'g6-usability-native-before-v1', status: 'running', startedAt: new Date().toISOString(), output,
        workspace, sourceRoot: 'hw/bsv/src', vsix, vsixSha256: hash(fs.readFileSync(vsix)), steps: [], captures: [],
        hypotheses: [
            'The installed source-only projection includes leaf methods and summary interfaces together; inspect actual scene contacts and DOM.',
            'Child/root preparation fails before commit due to geometry or invalid endpoint membership; inspect actual native responses and navigation errors.',
            'The selector reflects the requested root while the committed canvas remains old; compare selector/header/scene/host after real root selection.'
        ],
        evidencePolicy: 'Preserve all raw captures, traces, logs and failed outcomes. These are observations of the old delivered VSIX, never acceptance expectations for the fix.',
        userVisualDesignAcceptance: 'PENDING' };
    write(output, 'before-contract.json', report);
    let native, frame, page;
    try {
        native = await launchNative({ vsix, observerVsix, workspace, output, restricted: true, harnessFiles: [__filename] });
        page = native.context.pages()[0];
        const noTrust = page.getByRole('button', { name: "No, I don't trust the authors", exact: true });
        if (await noTrust.isVisible()) await noTrust.click();
        assert.equal((await native.channel.request('observeEditors')).trusted, false);
        await native.channel.request('openProductCommand', { command: 'bsvArchitecture.openHardwareSchematic' });
        ({ frame, page } = await native.findWebview());
        await frame.locator('#native-empty').waitFor({ state: 'visible' });
        await frame.waitForFunction(() => !!window.BsvHardwareTransport.identity());
        await frame.evaluate(() => {
            window.__usabilityBeforeEvents = [];
            for (const name of ['status', 'commit', 'settled', 'native-status']) window.addEventListener(`hardware:${name}`,
                event => window.__usabilityBeforeEvents.push({ name, at: performance.now(), detail: event.detail }));
        });
        await native.capture('before-empty-window', page);
        write(output, 'before-empty.json', { text: await frame.locator('body').innerText(), host: await native.channel.request('observeHardware') });
        const title = text => page.locator('.quick-input-title').filter({ hasText: text }).waitFor({ state: 'visible', timeout: 60000 });
        await frame.locator('#native-empty [data-native-action="choose-source"]').click();
        await native.nativeInput({ choice: path.basename(workspace) }, page);
        await title('Source folder'); await native.nativeInput({ text: 'hw/bsv/src' }, page);
        await title('Choose an actual root');
        const candidates = await page.locator('.quick-input-list .label-name').allTextContents();
        write(output, 'root-candidates.json', candidates);
        const choice = candidates.filter(name => name.endsWith(': mkAquaMemorySubsystem'));
        assert.equal(choice.length, 1);
        await native.nativeInput({ choice: choice[0] }, page);
        await frame.waitForFunction(() => window.bsvHardware.getState().scene?.shell.label === 'mkAquaMemorySubsystem'
            && !window.bsvHardware.getState().pending, null, { timeout: 60000 });
        await idle(frame);
        if (await frame.locator('#native-inputs').evaluate(node => node.open)) await frame.locator('#native-inputs > summary').click();
        await frame.locator('#fit').click(); await idle(frame);
        const capture = async name => {
            await native.traceCheckpoint(`before-${name}`);
            const state = await idle(frame);
            const dom = await frame.evaluate(() => ({
                selector: { value: document.querySelector('#build-select').value,
                    text: document.querySelector('#build-select').selectedOptions[0]?.textContent },
                title: document.querySelector('#scene-title').textContent,
                context: document.querySelector('#readability-context').textContent,
                inspector: document.querySelector('#inspector').innerText,
                status: document.querySelector('#status').textContent,
                displayStatus: document.querySelector('#display-status').textContent,
                inputStatus: document.querySelector('#native-input-status').textContent,
                events: window.__usabilityBeforeEvents,
                transport: window.__bsvVsixSmoke,
                canvas: document.querySelector('#viewport').getBoundingClientRect().toJSON()
            }));
            const measurement = await measureNative({ native, frame, page });
            const typography = state.scene ? validateNativeTypography(state, measurement, { root: true, children: state.scene.children.map(item => item.label),
                allowOverviewAbbreviation: true }) : null;
            const host = await native.channel.request('observeHardware');
            write(output, `${name}.state.json`, state);
            write(output, `${name}.dom.json`, dom);
            write(output, `${name}.measurement.json`, measurement);
            write(output, `${name}.typography.json`, typography);
            write(output, `${name}.host.json`, host);
            await native.capture(`${name}-window`, page);
            await frame.locator('body').screenshot({ path: path.join(output, `${name}-webview.png`) });
            const summary = { name, owner: state.scene?.shell.id, root: state.scene?.shell.label, childNames: state.scene?.children.map(item => item.label),
                contacts: state.scene?.contacts.length, interfaceGroups: state.scene?.interfaceGroups.length,
                connections: state.scene?.connections.length, routes: state.geometry?.routes.length, error: state.error,
                outcome: state.outcome, selector: dom.selector, title: dom.title, context: dom.context,
                minimumVisibleTitleCssPx: Math.min(...measurement.labels.filter(item => item.visible && item.role === 'node-title').map(item => item.effectiveFont)),
                typographyFindings: typography?.findings, status: dom.status, displayStatus: dom.displayStatus };
            report.captures.push(summary);
            await native.traceCheckpoint(`capture-${name}`);
            console.log('BEFORE_CAPTURE', JSON.stringify(summary));
            return state;
        };
        let state = await capture('memory-overall');
        const rootId = state.scene.shell.id;
        for (const name of ['load', 'staging', 'accumulators', 'store']) {
            state = await idle(frame);
            assert.equal(state.scene.shell.id, rootId, 'Each child action must begin at the same committed root');
            const child = state.scene.children.find(item => item.label === name);
            if (!child) { report.steps.push({ child: name, status: 'absent-in-current-input' }); continue; }
            const target = frame.locator(`[data-semantic-id=${JSON.stringify(child.id)}][data-active="true"] .body`);
            const start = await frame.evaluate(() => window.__usabilityBeforeEvents.length);
            await target.click();
            await frame.waitForFunction(index => window.__usabilityBeforeEvents.slice(index).some(event =>
                ['status', 'commit'].includes(event.name)), start, { timeout: 30000 });
            state = await capture(`child-${name}`);
            report.steps.push({ child: name, target: child.id, action: 'single actual pointer click at module body center',
                entered: state.scene.shell.id === child.id, currentOwner: state.scene.shell.id, error: state.error, outcome: state.outcome });
            if (state.scene.shell.id !== rootId) {
                await frame.locator('#back').click();
                await frame.waitForFunction(id => window.bsvHardware.getState().scene?.shell.id === id, rootId);
                await capture(`back-${name}`);
            }
        }
        const options = await frame.locator('#build-select option').evaluateAll(nodes => nodes.map(node => ({ value: node.value, text: node.textContent })));
        const loop = options.filter(option => option.text.includes('mkAquaLoopMatmul'));
        assert.equal(loop.length, 1);
        const generation = await frame.evaluate(() => window.bsvHardware.getState().queryGeneration);
        await frame.locator('#build-select').selectOption(loop[0].value);
        await frame.waitForFunction(value => window.bsvHardware.getState().queryGeneration > value, generation, { timeout: 60000 });
        state = await capture('loop-root-request');
        report.steps.push({ requestedRoot: loop[0], committedRoot: state.scene?.shell.label, committedBuild: state.current?.buildId,
            selector: report.captures.at(-1).selector, error: state.error, outcome: state.outcome });
        report.status = 'observed';
    } catch (error) {
        report.status = 'capture-failed'; report.failure = error.stack;
        if (native && page) await native.capture('capture-failure-window', page).catch(cause => { report.failureCapture = cause.message; });
        throw error;
    } finally {
        if (native) { await native.close(report.status === 'observed' ? 'passed' : 'failed', report.failure); report.nativeReceipt = 'native-receipt.json'; }
        const after = workspaceInventory(workspace); write(output, 'workspace-after.json', after);
        report.workspacePreserved = JSON.stringify(before.files) === JSON.stringify(after.files);
        report.finishedAt = new Date().toISOString();
        write(output, 'before-report.json', report);
        assert.equal(report.workspacePreserved, true, 'Actual source and pre-existing artifacts changed');
        console.log(`BEFORE_REPORT ${path.join(output, 'before-report.json')}`);
    }
}
if (require.main === module) main().catch(error => { console.error(error.stack); process.exitCode = 1; });
module.exports = { main };
