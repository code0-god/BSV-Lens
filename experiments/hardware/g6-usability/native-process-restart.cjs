#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { launchNative } = require('../g6/native-driver.cjs');
const { createRun } = require('../g6/run.cjs');
const { settled, chooseObject } = require('../g6/development-smoke.cjs');
const { enter, analyze } = require('../g6/native-acceptance.cjs');
const { digest, design, maintenance } = require('./native-lifecycle-inputs.cjs');
const ROOT = path.resolve(__dirname, '../../..');
const write = (folder, name, value) => fs.writeFileSync(path.join(folder, name), JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
function semanticResult(result) {
    const { id, metrics, request, ...value } = result;
    const { queryGeneration, ...semanticRequest } = request;
    return { ...value, request: semanticRequest };
}
async function stableScene(frame) {
    await settled(frame);
    return frame.evaluate(async () => {
        await document.fonts.ready;
        const samples = [], deadline = performance.now() + 5000;
        let previous = null, stableFrames = 0;
        while (performance.now() < deadline) {
            await new Promise(requestAnimationFrame); await window.bsvHardware.whenSettled();
            const state = window.bsvHardware.getState(), svg = document.getElementById('viewport'), rect = svg.getBoundingClientRect();
            const sample = { canvas: { width: svg.clientWidth, height: svg.clientHeight }, viewport: state.current.viewport,
                bounds: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }, owner: state.current.ownerInstanceId,
                queryId: state.current.analysis?.result.queryId, pending: state.pending, transition: !!state.transition };
            const encoded = JSON.stringify(sample); stableFrames = encoded === previous ? stableFrames + 1 : 0;
            samples.push(sample); previous = encoded;
            if (stableFrames >= 2 && !sample.pending && !sample.transition) return { state, samples };
        }
        throw new Error('Actual canvas/viewport did not stabilize across animation frames');
    });
}
async function run({ vsix, output = process.env.G6_OUTPUT_DIR || createRun('usability-final-process-restart'),
    observerVsix = path.join(ROOT, '.build/hardware/runs/g6-observer-resources-final-xQD0Ig/g6/bsv-lens-g6-observer-0.0.1.vsix') }) {
    assert.ok(vsix);
    const workspace = path.join(output, 'workspace'); fs.mkdirSync(workspace);
    const sources = [['Control.bsv', design], ['Service.bsv', maintenance]].map(([name, text]) => {
        const file = path.join(workspace, name); fs.writeFileSync(file, text, { flag: 'wx' });
        return { name, path: file, bytes: Buffer.byteLength(text), sha256: digest(Buffer.from(text)) };
    });
    const seedOutput = path.join(output, 'seed', 'g6'), restartedOutput = path.join(output, 'restarted', 'g6');
    fs.mkdirSync(seedOutput, { recursive: true }); fs.mkdirSync(restartedOutput, { recursive: true });
    const report = { schema: 'g6-usability-native-process-restart-v1', startedAt: new Date().toISOString(), status: 'running',
        vsix: path.resolve(vsix), vsixSha256: digest(fs.readFileSync(vsix)), workspace, sources,
        scope: 'Two actual Code processes, same installed VSIX and driver-owned profile. Existing sources and saved Host reference are revalidated.',
        compilerExecuted: false, userVisualDesignAcceptance: 'PENDING', trustPrompts: [] };
    write(output, 'restart-contract.json', report);
    let seed, restarted;
    const open = async native => {
        const page = native.context.pages()[0], trust = page.getByRole('button', { name: "No, I don't trust the authors", exact: true });
        await trust.waitFor({ state: 'visible', timeout: 30000 });
        await trust.click(); await trust.waitFor({ state: 'hidden' });
        const editors = await native.channel.request('observeEditors'); assert.equal(editors.trusted, false);
        report.trustPrompts.push({ processPid: native.receipt.launch.pid, button: "No, I don't trust the authors", clicked: true, trusted: editors.trusted });
        await native.channel.request('openProductCommand', { command: 'bsvArchitecture.openHardwareSchematic' });
        return native.findWebview();
    };
    try {
        const common = { vsix, observerVsix, workspace, restricted: true,
            harnessFiles: [__filename, require.resolve('./native-lifecycle-inputs.cjs')] };
        seed = await launchNative({ ...common, output: seedOutput });
        let { frame, page } = await open(seed);
        await page.locator('.quick-input-title').filter({ hasText: 'Choose a source design' }).waitFor();
        await seed.nativeInput({ choice: 'mkController' }, page);
        await frame.waitForFunction(() => window.bsvHardware?.getState().scene?.shell.label === 'mkController');
        let state = await enter(frame, 'west');
        await chooseObject(frame, state.scene.storages.find(item => item.label === 'state').id);
        state = await analyze(frame, 'state-accesses'); await frame.locator('#fit-selection').click();
        const seedStable = await stableScene(frame); state = seedStable.state;
        const before = state, saved = await frame.evaluate(() => window.__bsvVsixSmoke.states.at(-1));
        assert.ok(saved?.view?.query); assert.equal(saved.view.ownerInstanceId, before.current.ownerInstanceId);
        report.seed = { state: before, saved, stability: seedStable.samples, host: await seed.channel.request('observeHardware'),
            processPid: seed.receipt.launch.pid, protocol: await frame.evaluate(() => window.BsvHardwareTransport.identity()) };
        await seed.capture('D11-before-process-exit', page); await seed.traceCheckpoint('D11-before-process-exit');
        await seed.close('passed');
        assert.equal(seed.receipt.shutdown.code, 0); assert.equal(seed.receipt.shutdown.signal, null);
        restarted = await launchNative({ ...common, output: restartedOutput, reuseProfileReceipt: path.join(seedOutput, 'native-receipt.json') });
        assert.notEqual(restarted.receipt.launch.pid, seed.receipt.launch.pid, 'Restart must launch a different actual Code process');
        assert.equal(restarted.receipt.isolation.userDataDir, seed.receipt.isolation.userDataDir);
        ({ frame, page } = await open(restarted));
        await frame.waitForFunction(expected => {
            const state = window.bsvHardware?.getState();
            return state?.current?.ownerInstanceId === expected.owner && state.current.selectedEntityId === expected.selected
                && state.current.analysis?.result.queryId === expected.queryId && !state.pending && !state.error;
        }, { owner: before.current.ownerInstanceId, selected: before.current.selectedEntityId, queryId: before.current.analysis.result.queryId }, { timeout: 60000 });
        const restartStable = await stableScene(frame), after = restartStable.state, currentEditors = await restarted.channel.request('observeEditors');
        report.restarted = { state: after, stability: restartStable.samples, processPid: restarted.receipt.launch.pid, host: await restarted.channel.request('observeHardware'),
            protocol: await frame.evaluate(() => window.BsvHardwareTransport.identity()), editors: currentEditors };
        assert.equal(currentEditors.trusted, false);
        assert.equal(await page.locator('.quick-input-title').filter({ hasText: 'Choose a source design' }).isVisible(), false);
        assert.equal(restarted.receipt.nativeInputs?.length || 0, 0, 'Valid restart must not manually reselect a source root/design');
        for (const key of ['buildId', 'snapshotId', 'sceneKind', 'provider', 'rootInstanceId', 'ownerInstanceId', 'sourceRevision', 'selectedEntityId', 'selectedRelationId'])
            assert.deepEqual(after.current[key], before.current[key], `Restart changed ${key}`);
        assert.deepEqual(semanticResult(after.current.analysis.result), semanticResult(before.current.analysis.result));
        const anchor = state => {
            const node = state.geometry.nodes.find(item => item.id === state.current.selectedEntityId); assert.ok(node);
            const { x, y, scale } = state.current.viewport, canvas = state.runtime.canvas;
            return { x: x + (node.x + node.width / 2) * scale - canvas.width / 2,
                y: y + (node.y + node.height / 2) * scale - canvas.height / 2,
                visible: x + node.x * scale >= -1e-6 && y + node.y * scale >= -1e-6
                    && x + (node.x + node.width) * scale <= canvas.width + 1e-6
                    && y + (node.y + node.height) * scale <= canvas.height + 1e-6 };
        };
        const originalAnchor = anchor(before), restoredAnchor = anchor(after);
        report.viewportRestore = { beforeCanvas: before.runtime.canvas, afterCanvas: after.runtime.canvas,
            before: before.current.viewport, after: after.current.viewport, originalAnchor, restoredAnchor,
            contract: 'hardware-navigation.resize preserves selected world anchor relative to canvas center; equal canvas requires exact transform' };
        assert.equal(after.current.viewport.scale, before.current.viewport.scale);
        if (JSON.stringify(after.runtime.canvas) === JSON.stringify(before.runtime.canvas)) assert.deepEqual(after.current.viewport, before.current.viewport);
        else for (const axis of ['x', 'y']) assert.ok(Math.abs(restoredAnchor[axis] - originalAnchor[axis]) < 1e-6, `Restart changed selected ${axis} anchor`);
        assert.equal(restoredAnchor.visible, true);
        assert.deepEqual(after.current.disclosureState.presentation, before.current.disclosureState.presentation);
        const posts = await frame.evaluate(() => window.__bsvVsixSmoke.posts.map(message => ({ action: message.action, payload: message.payload })));
        assert.ok(posts.some(message => message.action === 'discover-workspace'));
        assert.equal(posts.some(message => ['choose-source', 'choose-manifest', 'choose-design', 'choose-artifact'].includes(message.action)), false);
        report.restarted.posts = posts;
        assert.notEqual(report.restarted.protocol.sessionId, report.seed.protocol.sessionId);
        assert.equal(await page.locator('.monaco-dialog-box:visible').count(), 0, 'Restored native capture must be unobscured by workbench dialogs');
        await restarted.capture('D11-restored-after-process-restart', page); await restarted.traceCheckpoint('D11-restored-process');
        report.status = 'passed';
    } catch (error) {
        report.status = 'failed'; report.failure = error.stack; console.error('PROCESS_RESTART_FAILURE', error.stack);
        if (restarted) {
            report.failureHost = await restarted.channel.request('observeHardware').catch(cause => ({ error: cause.message }));
            await restarted.capture('D11-process-restart-failure').catch(() => {});
        }
    } finally {
        if (restarted) await restarted.close(report.status === 'passed' ? 'passed' : 'failed', report.failure || report.status);
        if (seed) await seed.close(report.status === 'passed' ? 'passed' : 'failed', report.failure || report.status);
        report.sourcePreserved = sources.every(source => digest(fs.readFileSync(source.path)) === source.sha256);
        report.finishedAt = new Date().toISOString(); write(output, 'process-restart-report.json', report);
        console.log('PROCESS_RESTART_REPORT', path.join(output, 'process-restart-report.json'));
    }
    assert.equal(report.sourcePreserved, true); assert.equal(report.status, 'passed', report.failure); return report;
}
if (require.main === module) {
    if (process.argv.includes('--help')) console.log('Usage: node native-process-restart.cjs FINAL.vsix\nActual installed Code process restart in the same private profile; no manual source selection after restart.');
    else run({ vsix: process.argv[2] }).catch(error => { console.error(error.stack); process.exitCode = 1; });
}
module.exports = { run };
