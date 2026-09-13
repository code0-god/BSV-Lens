#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { launchNative } = require('../g6/native-driver.cjs');
const { createRun } = require('../g6/run.cjs');
const { settled, chooseObject } = require('../g6/development-smoke.cjs');
const { analyze, sourceReveal, identity } = require('../g6/native-acceptance.cjs');
const ROOT = path.resolve(__dirname, '../../..');
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const write = (output, name, value) => fs.writeFileSync(path.join(output, name), JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
function sourceInventory(workspace) {
    const git = args => execFileSync('git', ['-C', workspace, ...args], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 }).trim();
    const names = [...new Set(git(['ls-files', '--cached', '--others', '--exclude-standard', '-z']).split('\0').filter(Boolean))].sort();
    assert.ok(names.length <= 100000, 'Tracked/nonignored source inventory limit');
    const files = [], skipped = [];
    for (const relative of names.filter(name => /\.bsv$/i.test(name) || name.startsWith('.vscode/'))) {
        const file = path.join(workspace, relative), info = fs.lstatSync(file);
        if (info.isSymbolicLink()) { skipped.push({ path: relative, reason: 'symlink-not-followed' }); continue; }
        assert.ok(info.isFile() && info.size <= 16 * 1024 * 1024);
        const bytes = fs.readFileSync(file); files.push({ path: relative, bytes: bytes.length, sha256: digest(bytes) });
    }
    return { workspace, head: git(['rev-parse', 'HEAD']), branch: git(['branch', '--show-current']), dirty: git(['status', '--porcelain=v1']),
        scope: 'All Git tracked and nonignored BSV plus workspace settings. Compiler/cache artifacts are not traversed or changed.',
        files, bsvFiles: files.filter(row => /\.bsv$/i.test(row.path)).length, skipped, fingerprint: digest(JSON.stringify(files)) };
}
async function run({ mode, vsix, workspace, output, observerVsix }) {
    assert.ok(['before', 'after'].includes(mode)); assert.ok(vsix && workspace);
    workspace = fs.realpathSync(workspace); output ||= createRun('discovery-cancel-' + mode);
    observerVsix ||= path.join(ROOT, '.build/hardware/runs/g6-observer-resources-final-xQD0Ig/g6/bsv-lens-g6-observer-0.0.1.vsix');
    const before = sourceInventory(workspace); write(output, 'source-before.json', before);
    const report = { schema: 'g6-discovery-cancel-native-v1', mode, status: 'running', startedAt: new Date().toISOString(),
        workspace, vsix, vsixSha256: digest(fs.readFileSync(vsix)), source: { count: before.bsvFiles, fingerprint: before.fingerprint }, steps: [],
        boundary: 'Installed product VSIX, actual command and native QuickPick pointer/keyboard only. No catalog, query, scene, source range or document mutation. Local isolated profile and Restricted Mode.' };
    write(output, 'contract.json', report);
    let native, frame, page;
    const capture = async name => {
        const dom = await frame.evaluate(() => ({ viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio },
            html: document.documentElement.outerHTML, text: document.body.innerText,
            state: window.bsvHardware.getState(), transport: window.BsvHardwareTransport.identity(),
            posts: window.__bsvVsixSmoke.posts, host: window.__bsvVsixSmoke.host,
            selector: document.querySelector('#build-select')?.selectedOptions[0]?.textContent,
            status: document.querySelector('#native-input-status')?.textContent,
            footer: document.querySelector('#status')?.textContent }));
        const host = await native.channel.request('observeHardware');
        write(output, name + '.dom.json', dom); write(output, name + '.host.json', host);
        await native.capture(name, page); await native.traceCheckpoint(name);
        return dom;
    };
    try {
        native = await launchNative({ vsix, observerVsix, workspace, output, restricted: true, harnessFiles: [__filename] });
        page = native.context.pages()[0];
        const noTrust = page.getByRole('button', { name: "No, I don't trust the authors", exact: true });
        if (await noTrust.isVisible()) await noTrust.click();
        assert.equal((await native.channel.request('observeEditors')).trusted, false);
        await native.channel.request('openProductCommand', { command: 'bsvArchitecture.openHardwareSchematic' });
        ({ page, frame } = await native.findWebview());
        await frame.waitForFunction(() => !!window.BsvHardwareTransport.identity());
        const chooser = page.locator('.quick-input-title').filter({ hasText: 'Choose a source design' });
        await chooser.waitFor({ state: 'visible', timeout: 90000 });
        const candidates = await page.locator('.quick-input-list .label-name').allTextContents();
        assert.ok(candidates.length > 1);
        write(output, 'source-design-candidates.json', candidates);
        await capture('01-design-choice');
        await page.locator('.quick-input-widget input').press('Escape');
        await chooser.waitFor({ state: 'hidden' });
        if (mode === 'before') {
            await frame.waitForFunction(() => document.querySelector('#native-input-status').textContent.includes('Source design selection cancelled'));
            const empty = await capture('02-cancelled-before');
            assert.equal(empty.selector, 'No BSV files found'); assert.equal(empty.state.scene, null);
            assert.match(empty.footer, /Finding BSV sources/);
            const discovery = empty.posts.find(row => row.action === 'discover-workspace'); assert.ok(discovery);
            const response = empty.host.find(row => row.requestId === discovery.requestId && row.kind === 'response');
            assert.equal(response?.status, 'cancelled');
            report.steps.push({ id: 'native-before-reproduction', status: 'pass', visibleCandidateRows: candidates.length,
                discoveredSourcesOnDisk: before.bsvFiles, selector: empty.selector, statusText: empty.status, footer: empty.footer,
                discoveryResponse: response, finding: 'Discovery reached design choice, but Escape falsely reports no BSV files and retains finding footer.' });
        } else {
            await frame.locator('#native-select-design').waitFor({ state: 'visible' });
            const cancelled = await capture('02-cancelled-after');
            assert.equal(cancelled.selector, 'Select a design');
            const selection = cancelled.host.findLast(row => row.action === 'source-selection');
            assert.equal(selection.payload.sourceFiles, before.bsvFiles, 'Configured build exclusions must not consume normal source discovery capacity');
            assert.equal(cancelled.status, 'Found ' + selection.payload.sourceFiles + ' BSV files. Choose a design to open.');
            assert.equal(cancelled.footer, cancelled.status);
            assert.equal(selection.payload.status, 'selection-required');
            assert.equal(selection.payload.preserved, false); report.selectionRequired = selection.payload;
            for (let attempt = 0; attempt < 2; attempt++) {
                await frame.locator('#native-select-design').click();
                await chooser.waitFor({ state: 'visible', timeout: 90000 });
                if (attempt === 0) {
                    await page.locator('.quick-input-widget input').press('Escape'); await chooser.waitFor({ state: 'hidden' });
                    await frame.waitForFunction(() => document.querySelector('#native-input-status').textContent.startsWith('Found '));
                    const previousSession = (await frame.evaluate(() => window.BsvHardwareTransport.identity())).sessionId;
                    await native.channel.request('openTextDocument', { path: path.join(workspace, 'src/control/ExecuteController.bsv') });
                    const hidden = await native.channel.request('observeHardware');
                    assert.equal(hidden.activePanels, 1); assert.equal(hidden.sessions[0].visible, false); assert.equal(hidden.sessions[0].closed, false);
                    await native.channel.request('openProductCommand', { command: 'bsvArchitecture.openHardwareSchematic' });
                    ({ page, frame } = await native.findWebview());
                    assert.equal((await native.channel.request('observeHardware')).sessions[0].visible, true);
                    assert.equal((await frame.evaluate(() => window.BsvHardwareTransport.identity())).sessionId, previousSession);
                    assert.equal(await frame.locator('#native-input-status').textContent(), cancelled.status);
                    assert.equal(await chooser.isVisible(), false);
                    await capture('02b-cancelled-reopen');
                    report.steps.push({ id: 'cancelled-hidden-reopen', status: 'pass', sessionId: previousSession, hidden });
                }
            }
            await page.locator('.quick-input-widget input').fill('mkExecuteController');
            await native.nativeInput({ choice: 'mkExecuteController' }, page);
            await frame.waitForFunction(() => window.bsvHardware.getState().scene?.shell.label === 'mkExecuteController', null, { timeout: 90000 });
            let state = await settled(frame);
            assert.equal(state.scene.sceneKind, 'bsv'); assert.equal(state.current.snapshotId, null);
            assert.ok(state.scene.storages.length > 0 || state.scene.children.length > 0);
            await capture('03-execute-controller');
            const discovered = (await native.channel.request('observeHardware')).sessions[0].discovery;
            report.discovery = discovered;
            report.inventoryDifference = before.files.filter(row => /\.bsv$/i.test(row.path) && !discovered.included.some(input => input.path === row.path));
            write(output, 'discovery.json', { discovery: discovered, independentInventoryDifference: report.inventoryDifference });
            assert.equal(discovered.status, 'ready'); assert.equal(discovered.truncated, false);
            assert.deepEqual(report.inventoryDifference, []);
            assert.equal(discovered.indexedFiles, before.bsvFiles);
            assert.equal(discovered.discoveredFiles, before.bsvFiles);
            assert.equal(discovered.excluded.some(row => row.path.startsWith('build/')), false, 'Build copies must be pruned before the candidate cap');
            report.steps.push({ id: 'native-after-recovery', status: 'pass', visibleCandidateRows: candidates.length, cancelledSelector: cancelled.selector,
                current: state.current, children: state.scene.children.map(row => row.label), storages: state.scene.storages.map(row => row.label) });
            const storage = state.scene.storages.find(row => row.label === 'stateReg') || state.scene.storages[0];
            assert.ok(storage); await chooseObject(frame, storage.id); state = await analyze(frame, 'state-accesses');
            const accesses = identity(state); assert.ok(state.current.analysis.result.writers.length);
            await frame.locator('[data-code-section="writer"] [data-analysis-kind="behavior"]').first().click();
            await frame.waitForFunction(() => window.bsvHardware.getState().current.analysis?.result.kind === 'behavior');
            state = await settled(frame);
            const referenceId = await frame.locator('#code-drawer pre[data-source-reference-id]').first().getAttribute('data-source-reference-id');
            const reference = state.current.analysis.result.sourceRefs.find(row => row.id === referenceId); assert.ok(reference);
            const sourcePath = fs.realpathSync(path.resolve(workspace, reference.pathRef));
            assert.ok(!path.relative(workspace, sourcePath).startsWith('..'));
            const reveal = await sourceReveal({ native, frame, referenceId, fixture: { sourceFiles: [{ pathRef: reference.pathRef, path: sourcePath }] } });
            await capture('04-actual-editor-source');
            await frame.locator('#back').click(); state = await settled(frame);
            const restored = identity(state); for (const field of ['buildId', 'owner', 'selected', 'queryId', 'resultHash']) assert.equal(restored[field], accesses[field]);
            await capture('05-source-back');
            report.steps.push({ id: 'actual-source-back', status: 'pass', reveal, before: accesses, restored });
        }
        const after = sourceInventory(workspace); write(output, 'source-after.json', after); assert.deepEqual(after, before);
        report.sourcePreserved = true;
        report.build = (await native.channel.request('observeHardware')).sessions[0]?.build;
        await native.close(); assert.equal(native.receipt.status, 'passed');
        report.status = 'pass'; report.installedRuntimeIdentity = native.receipt.installedRuntimeIdentity;
        report.environment = native.receipt.environment;
    } catch (error) {
        report.status = 'fail'; report.error = error.stack || String(error);
        if (frame && native) await capture('failure').catch(captureError => { report.captureError = captureError.message; });
        await native?.close('failed', error);
        throw error;
    } finally {
        report.finishedAt = new Date().toISOString(); write(output, 'validation.json', report);
        console.log(JSON.stringify({ output, mode, status: report.status }));
    }
    return report;
}
if (require.main === module) {
    const [mode, vsix, workspace] = process.argv.slice(2);
    if (mode === '--help') console.log('node native.cjs before|after VSIX WORKSPACE');
    else run({ mode, vsix, workspace, output: process.env.G6_OUTPUT_DIR }).catch(error => { console.error(error); process.exitCode = 1; });
}
module.exports = { run, sourceInventory };
