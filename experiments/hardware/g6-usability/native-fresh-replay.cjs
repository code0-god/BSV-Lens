#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { finished } = require('node:stream/promises');
const { requireArchived } = require('../g6/final-delivery.cjs');
const ROOT = path.resolve(__dirname, '../../..');
const SELF = 'experiments/hardware/g6-usability/native-fresh-replay.cjs';
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const identity = file => { const bytes = fs.readFileSync(file); return { path: file, bytes: bytes.length, sha256: hash(bytes) }; };
const write = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
const outside = (root, file) => { const relative = path.relative(root, file); return relative.startsWith(`..${path.sep}`) || relative === '..' || path.isAbsolute(relative); };
function archivedPath(cwd, relative) {
    assert.ok(typeof relative === 'string' && relative && !path.isAbsolute(relative) && !relative.includes('\\')
        && !relative.split('/').some(part => !part || part === '.' || part === '..'), 'Expected a relative archived path');
    const file = path.resolve(cwd, relative);
    assert.equal(outside(fs.realpathSync(cwd), fs.realpathSync(file)), false, 'Archived path escapes the extraction');
    assert.equal(fs.lstatSync(file).isSymbolicLink(), false, 'Archived input leaf is a symlink');
    return file;
}
function inventory(directory) {
    const result = []; let bytes = 0;
    function visit(relative) {
        for (const item of fs.readdirSync(path.join(directory, relative), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
            const name = relative ? `${relative}/${item.name}` : item.name;
            assert.equal(item.isSymbolicLink(), false, `Unexpected original symlink: ${name}`);
            if (name === '.build/hardware/runs') { assert.ok(item.isDirectory()); continue; }
            if (item.isDirectory()) visit(name);
            else { assert.ok(item.isFile()); const row = identity(path.join(directory, name)); bytes += row.bytes;
                assert.ok(row.bytes <= 64 * 1024 * 1024 && bytes <= 768 * 1024 * 1024 && result.length < 20000, 'Original inventory resource limit');
                result.push({ ...row, path: name }); }
        }
    }
    visit(''); return result.sort((a, b) => a.path.localeCompare(b.path));
}
function selectInputs({ cwd, evidence, workspaces, workspaceId }) {
    assert.ok(Array.isArray(workspaces), 'Archived workspace descriptors required');
    const choices = workspaceId ? workspaces.filter(item => item.id === workspaceId) : workspaces;
    assert.equal(choices.length, 1, 'Select exactly one archived workspace with workspaceId when several are supplied');
    const workspace = choices[0], sourceRoot = archivedPath(cwd, workspace.root);
    const sourceInventory = JSON.parse(fs.readFileSync(archivedPath(cwd, workspace.inventory)));
    assert.ok(Array.isArray(sourceInventory.files) && sourceInventory.files.length);
    const manifest = JSON.parse(fs.readFileSync(archivedPath(cwd, workspace.manifest)));
    assert.equal(manifest.artifact, undefined, 'This replay opens the captured source-only workspace');
    assert.ok(typeof manifest.label === 'string' && manifest.label.length > 0, 'Captured workspace label is required');
    require('./replay-input.cjs').sourceEntry(workspace.sourceEntry, manifest, sourceInventory.files);
    for (const row of sourceInventory.files) {
        const actual = identity(archivedPath(sourceRoot, row.path));
        assert.equal(actual.bytes, row.bytes); assert.equal(actual.sha256, row.sha256);
    }
    const candidates = [];
    for (const row of evidence.indexes) {
        const index = JSON.parse(fs.readFileSync(archivedPath(cwd, row.path)));
        if (index.vsix?.file) candidates.push({ file: archivedPath(cwd, `${path.posix.dirname(row.path)}/${index.vsix.file}`), descriptor: index.vsix });
    }
    assert.ok(candidates.length, 'Final VSIX must be physically included in the extraction');
    assert.equal(new Set(candidates.map(item => item.descriptor.sha256)).size, 1, 'Conflicting archived final VSIX bytes');
    const candidate = candidates[0], vsix = identity(candidate.file);
    assert.equal(vsix.sha256, candidate.descriptor.sha256); assert.equal(vsix.bytes, candidate.descriptor.bytes);
    assert.ok(evidence.builds.length && evidence.builds.every(build => build.sha256 === vsix.sha256));
    return { workspace, sourceRoot, sourceInventory, label: manifest.label, vsix };
}
function assertSourceEntry(state, entry) {
    const shell = state.scene.shell;
    assert.equal(shell.kind, 'module-occurrence'); assert.equal(shell.definitionId, entry.definitionId);
    assert.equal(state.current.ownerInstanceId, shell.id);
    const references = shell.sourceRefs.filter(ref => ref.semanticId === shell.id && ref.sourceKind === 'module-occurrence'
        && ref.pathRef === entry.pathRef && ref.revision === entry.revision && ref.contentHash === entry.revision);
    assert.equal(references.length, 1, 'Selected occurrence must bind the captured definition and source revision');
    return { ownerInstanceId: shell.id, definitionId: shell.definitionId, referenceId: references[0].id,
        pathRef: entry.pathRef, revision: entry.revision };
}
function viewportObservation(state, canvas, client) {
    const selected = state.geometry.nodes.find(node => node.id === state.current.selectedEntityId); assert.ok(selected);
    return { viewport: state.current.viewport, selected: { id: selected.id, x: selected.x, y: selected.y,
        width: selected.width, height: selected.height }, canvas, client };
}
function assertRestoredViewport(before, after) {
    assert.equal(after.selected.id, before.selected.id); assert.equal(after.viewport.scale, before.viewport.scale);
    if (before.canvas.width === after.canvas.width && before.canvas.height === after.canvas.height)
        assert.deepEqual(after.viewport, before.viewport, 'Equal drawable size requires exact restored viewport');
    const offset = (value, dimensions) => ({ x: value.viewport.x + (value.selected.x + value.selected.width / 2) * value.viewport.scale - dimensions.width / 2,
        y: value.viewport.y + (value.selected.y + value.selected.height / 2) * value.viewport.scale - dimensions.height / 2 });
    const clientBefore = offset(before, before.client), clientAfter = offset(after, after.client);
    const boundsBefore = offset(before, before.canvas), boundsAfter = offset(after, after.canvas);
    for (const [axis, dimension] of [['x', 'width'], ['y', 'height']]) {
        assert.ok(Math.abs(clientBefore[axis] - clientAfter[axis]) < 1e-6, `Restored selected anchor shifted on ${axis}`);
        const quantization = ((before.client[dimension] - before.canvas[dimension]) - (after.client[dimension] - after.canvas[dimension])) / 2;
        assert.ok(Math.abs(boundsBefore[axis] - boundsAfter[axis] - quantization) < 1e-6, `Unexplained bounding-box anchor shift on ${axis}`);
    }
    return { before, after, clientBefore, clientAfter, boundsBefore, boundsAfter,
        policy: 'Exact viewport for equal drawable bounds; unchanged scale and exact selected DOM client anchor after resize. Fractional CSS bounding-box drift must equal measured client-size quantization.' };
}
async function nativeOnly(configFile) {
    const config = JSON.parse(fs.readFileSync(configFile)), { cwd, output, observerVsix, vscodeExecutable, dependenciesDirectory, input } = config;
    assert.equal(fs.realpathSync(ROOT), fs.realpathSync(cwd), 'Execute the helper extracted from this archive');
    assert.equal(fs.realpathSync(process.cwd()), fs.realpathSync(cwd)); assert.equal(path.basename(output), 'g6');
    assert.equal(outside(cwd, output), true); assert.equal(process.env.NODE_PATH, undefined);
    assert.deepEqual(require('node:module').globalPaths, []);
    for (const name of ['@playwright/test', '@vscode/test-electron'])
        assert.equal(outside(fs.realpathSync(dependenciesDirectory), fs.realpathSync(require.resolve(`${name}/package.json`))), false);
    const { launchNative } = requireArchived(cwd, 'experiments/hardware/g6/native-driver.cjs');
    const { settled, chooseObject } = requireArchived(cwd, 'experiments/hardware/g6/development-smoke.cjs');
    const { enter, analyze, sourceReveal, identity: viewIdentity } = requireArchived(cwd, 'experiments/hardware/g6/native-acceptance.cjs');
    const { measureNative, validateNativeTypography } = requireArchived(cwd, 'experiments/hardware/g6/native-oracle.cjs');
    const { verifyVsix, readVsix, verifyInstalledRuntime } = requireArchived(cwd, 'experiments/hardware/g6/package-vsix.cjs');
    const before = inventory(cwd), report = { schema: 'g6-usability-fresh-native-v1', status: 'FAIL', startedAt: new Date().toISOString(),
        cwd, output, vsix: input.vsix, workspace: input.workspace, sourceInventory: input.sourceInventory, steps: [], userVisualDesignAcceptance: 'PENDING' };
    const archivedVsix = verifyVsix(input.vsix.path); assert.equal(archivedVsix.sha256, input.vsix.sha256);
    let native, frame, page;
    try {
        const workspaceFile = path.join(output, 'captured.code-workspace');
        write(workspaceFile, { folders: [{ path: input.sourceRoot, name: input.label }] });
        native = await launchNative({ vsix: input.vsix.path, observerVsix, vscodeExecutable, workspace: input.sourceRoot,
            workspaceFile, output, restricted: true, harnessFiles: [path.join(cwd, SELF)] });
        page = native.context.pages()[0];
        const restricted = page.getByRole('button', { name: "No, I don't trust the authors", exact: true });
        await restricted.waitFor({ state: 'visible', timeout: 30000 });
        await restricted.click(); await restricted.waitFor({ state: 'hidden' });
        const trustObservation = await native.channel.request('observeEditors'); assert.equal(trustObservation.trusted, false);
        report.trustPrompt = { button: "No, I don't trust the authors", clicked: true, trusted: trustObservation.trusted };
        const capture = async name => {
            assert.equal(await page.locator('.monaco-dialog-box:visible').count(), 0, 'Fresh native capture must be unobscured by workbench dialogs');
            return native.capture(name, page);
        };
        await native.channel.request('openProductCommand', { command: 'bsvArchitecture.openHardwareSchematic' });
        ({ frame, page } = await native.findWebview());
        await page.locator('.quick-input-title').filter({ hasText: 'Choose a source design' }).waitFor({ state: 'visible', timeout: 90000 });
        report.rootChoices = await page.locator('.quick-input-list .label-name').allTextContents();
        assert.equal(report.rootChoices.filter(name => name === 'mkAquaMemorySubsystem').length, 1);
        await native.nativeInput({ choice: 'mkAquaMemorySubsystem' }, page);
        await frame.waitForFunction(() => window.bsvHardware.getState().scene?.shell.label === 'mkAquaMemorySubsystem'
            && !window.bsvHardware.getState().pending, null, { timeout: 90000 });
        let state = await settled(frame);
        assert.deepEqual(state.scene.children.map(item => item.label), ['load', 'staging', 'accumulators', 'store']);
        assert.equal(state.current.snapshotId, null);
        if (input.workspace.sourceEntry) report.entryIdentity = assertSourceEntry(state, input.workspace.sourceEntry);
        assert.ok(await frame.evaluate(() => window.__bsvVsixSmoke.posts.some(item => item.action === 'discover-workspace')));
        assert.equal(await frame.evaluate(() => window.__bsvVsixSmoke.posts.some(item => ['choose-source', 'choose-manifest', 'choose-artifact'].includes(item.action))), false);
        report.handshake = await frame.evaluate(() => window.BsvHardwareTransport.identity());
        assert.equal(report.handshake.buildId, archivedVsix.nativeBuild.buildId);
        report.steps.push('automatic-source-discovery-and-explicit-Memory-design');
        await capture('fresh-memory'); await native.traceCheckpoint('fresh-memory');
        state = await enter(frame, 'load'); const storage = state.scene.storages.find(item => item.label === 'active'); assert.ok(storage);
        await chooseObject(frame, storage.id); state = await analyze(frame, 'state-accesses'); assert.ok(state.current.analysis.result.writers.length);
        const saved = viewIdentity(state); report.selectedBeforeSource = saved;
        const beforeViewport = viewportObservation(state, await frame.locator('#viewport').boundingBox(),
            await frame.locator('#viewport').evaluate(node => ({ width: node.clientWidth, height: node.clientHeight })));
        await frame.locator('[data-code-section="writer"] [data-analysis-kind="behavior"]').first().click();
        await frame.waitForFunction(() => window.bsvHardware.getState().current.analysis?.result.kind === 'behavior'); state = await settled(frame);
        const referenceId = await frame.locator('#code-drawer pre[data-source-reference-id]').first().getAttribute('data-source-reference-id');
        const reference = state.current.analysis.result.sourceRefs.find(item => item.id === referenceId); assert.ok(reference);
        const source = input.sourceInventory.files.find(item => item.path === reference.pathRef); assert.ok(source);
        report.sourceReveal = await sourceReveal({ native, frame, referenceId, fixture: { sourceFiles: [
            { pathRef: reference.pathRef, path: archivedPath(input.sourceRoot, source.path) }] } });
        await capture('fresh-actual-editor'); await native.traceCheckpoint('fresh-source-editor');
        report.steps.push('load-storage-writer-real-editor-range');
        await frame.locator('#back').click(); state = await settled(frame); report.restored = viewIdentity(state);
        for (const key of ['buildId', 'snapshotId', 'owner', 'selected', 'relation', 'queryId', 'resultHash']) assert.deepEqual(report.restored[key], saved[key]);
        report.backViewport = assertRestoredViewport(beforeViewport, viewportObservation(state, await frame.locator('#viewport').boundingBox(),
            await frame.locator('#viewport').evaluate(node => ({ width: node.clientWidth, height: node.clientHeight }))));
        const measurement = await measureNative({ native, frame, page });
        const typography = validateNativeTypography(state, measurement, { root: false, mandatory: [
            { id: 'readability-context', text: state.current.occurrencePath.join('.'), minFont: 12 },
            { ownerId: storage.id, role: 'node-title', text: storage.label, minFont: 12 }] });
        assert.equal(typography.status, 'pass', JSON.stringify(typography.findings));
        write(path.join(output, 'fresh-back.measurement.json'), measurement); write(path.join(output, 'fresh-back.typography.json'), typography);
        await capture('fresh-source-back'); report.steps.push('Back-restores-analysis-and-readable-selection');
        const choices = await frame.locator('#build-select option').evaluateAll(nodes => nodes.map(node => ({ value: node.value, text: node.textContent })));
        const loop = choices.filter(item => item.text === 'mkAquaLoopMatmul'); assert.equal(loop.length, 1);
        await frame.locator('#build-select').selectOption(loop[0].value);
        await frame.waitForFunction(() => window.bsvHardware.getState().scene?.shell.label === 'mkAquaLoopMatmul'
            && !window.bsvHardware.getState().pending, null, { timeout: 90000 }); state = await settled(frame);
        assert.deepEqual(state.scene.children.map(item => item.label), ['matmul', 'fragments']);
        assert.equal(await frame.locator('#build-select').inputValue(), loop[0].value); assert.deepEqual(state.geometry.routing.deferred, []);
        report.loop = viewIdentity(state); await capture('fresh-loop'); await native.traceCheckpoint('fresh-loop');
        report.steps.push('explicit-Loop-design-and-committed-owner');
        await native.close(); assert.equal(native.receipt.status, 'passed'); assert.deepEqual(native.receipt.errors, []);
        report.shutdown = native.receipt.shutdown; assert.deepEqual(report.shutdown, { code: 0, signal: null });
        report.installedRuntime = verifyInstalledRuntime({ vsix: input.vsix.path, installationPath: native.receipt.installedTarget.extensionPath });
        report.nativeReceipt = identity(path.join(output, 'native-receipt.json'));
        report.traces = native.receipt.traceChunks.map(row => ({ ...row, crc: readVsix(path.join(output, row.path)).size > 0 ? 'PASS' : 'FAIL' }));
        report.status = 'PASS';
    } catch (error) {
        report.error = error.stack;
        if (native) { if (page) await native.capture('fresh-failure', page).catch(cause => { report.captureError = cause.message; });
            await native.close('failed', error); }
    } finally {
        report.originalInventoryUnchanged = JSON.stringify(before) === JSON.stringify(inventory(cwd));
        report.originalInventoryFingerprint = hash(JSON.stringify(before)); report.originalFiles = before.length;
        report.originalInventoryScope = 'All original members; excludes only .build/hardware/runs/, which the archive validator forbids in shipped inputs and reserves for isolated core replay output.';
        report.vsixUnchanged = identity(input.vsix.path).sha256 === input.vsix.sha256;
        if (!report.originalInventoryUnchanged || !report.vsixUnchanged) report.status = 'FAIL';
        report.finishedAt = new Date().toISOString(); write(path.join(output, 'fresh-native.json'), report);
    }
    assert.equal(report.status, 'PASS', report.error); return report;
}
function nativeReplay({ toolsRoot = ROOT, observerVsix, vscodeExecutable, outputRoot, workspaceId } = {}) {
    toolsRoot = fs.realpathSync(toolsRoot); outputRoot ||= path.join(toolsRoot, '.build/hardware/runs');
    const tools = Object.fromEntries(Object.entries({ observerVsix, vscodeExecutable }).map(([key, file]) => {
        assert.ok(typeof file === 'string' && path.isAbsolute(file), `Explicit absolute ${key} required`);
        return [key, identity(fs.realpathSync(file))];
    }));
    return async ({ receipt, cwd, env = {}, directory, workspaces }) => {
        cwd = fs.realpathSync(cwd); assert.equal(outside(cwd, toolsRoot), true, 'Test dependencies must be external to the extraction');
        fs.mkdirSync(outputRoot, { recursive: true }); outputRoot = fs.realpathSync(outputRoot);
        assert.equal(outside(cwd, path.resolve(outputRoot)), true); assert.equal(outside(path.resolve(directory), path.resolve(outputRoot)), true);
        assert.equal(fs.existsSync(path.join(cwd, 'node_modules')), false);
        const input = selectInputs({ cwd, evidence: receipt.nativeEvidence, workspaces, workspaceId });
        const output = path.join(fs.mkdtempSync(path.join(outputRoot, `g6-usability-fresh-${receipt.mode}-`)), 'g6'); fs.mkdirSync(output);
        const dependenciesDirectory = path.join(output, 'test-tools'), parentModules = path.join(path.dirname(cwd), 'node_modules');
        fs.mkdirSync(dependenciesDirectory); assert.equal(fs.existsSync(parentModules), false);
        const dependencies = requireArchived(cwd, 'experiments/hardware/g6/core.cjs').copyTestDependencies(toolsRoot, dependenciesDirectory);
        write(path.join(output, 'test-dependencies.json'), dependencies);
        const linkTarget = path.join(dependenciesDirectory, 'node_modules'); fs.symlinkSync(linkTarget, parentModules, 'dir');
        const configFile = path.join(output, 'replay-config.json');
        write(configFile, { cwd, output, input, dependenciesDirectory: linkTarget,
            ...Object.fromEntries(Object.entries(tools).map(([key, value]) => [key, value.path])) });
        const environment = { ...process.env, G4_REVIEW_ROOT: cwd, G5_OUTPUT_DIR: output, G5_READABILITY_OUTPUT_DIR: output,
            G6_OUTPUT_DIR: output, NODE_OPTIONS: '--no-global-search-paths' };
        delete environment.NODE_PATH; delete environment.ELECTRON_RUN_AS_NODE;
        const args = ['--no-global-search-paths', path.join(cwd, SELF), '--native-only', configFile];
        const logs = ['stdout', 'stderr'].map(name => fs.createWriteStream(path.join(output, `${name}.log`), { flags: 'wx' }));
        let error, exit, linkRemoved = false;
        try {
            const child = spawn(process.execPath, args, { cwd, env: environment, timeout: 600000, stdio: ['ignore', 'pipe', 'pipe'] });
            child.stdout.pipe(logs[0]); child.stderr.pipe(logs[1]); child.on('error', cause => { error = cause.message; });
            exit = await new Promise(resolve => child.once('close', (code, signal) => resolve({ code, signal })));
            await Promise.all(logs.map(stream => finished(stream)));
        } finally {
            assert.ok(fs.lstatSync(parentModules).isSymbolicLink() && fs.readlinkSync(parentModules) === linkTarget);
            fs.unlinkSync(parentModules); linkRemoved = true;
        }
        const file = path.join(output, 'fresh-native.json'), result = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file)) : null;
        if (result?.status === 'PASS') {
            const nativeReceipt = JSON.parse(fs.readFileSync(path.join(output, 'native-receipt.json')));
            requireArchived(cwd, 'experiments/hardware/g6/validate-delivery.cjs').validateNativeIsolation(nativeReceipt);
            assert.equal(nativeReceipt.vsixSha256, input.vsix.sha256);
            assert.equal(nativeReceipt.installedRuntimeUnchanged, true); assert.equal(nativeReceipt.harnessUnchanged, true);
            assert.deepEqual(nativeReceipt.shutdown, { code: 0, signal: null });
        }
        const resultReceipt = { status: exit?.code === 0 && !error && result?.status === 'PASS' ? 'PASS' : 'FAIL', output,
            executable: process.execPath, args, exit, error, tools, input: { vsix: input.vsix, workspace: input.workspace },
            dependencyFingerprint: dependencies.fingerprint, result: result && identity(file), nativeReceipt: result?.nativeReceipt,
            originalInventoryUnchanged: result?.originalInventoryUnchanged, originalInventoryFingerprint: result?.originalInventoryFingerprint,
            cleanup: { parentModuleLinkRemoved: linkRemoved, isolatedCodeShutdown: result?.shutdown,
                retained: 'Own isolated profile and run evidence retained for byte verification; no user profile was touched.' },
            environment: { NODE_OPTIONS: environment.NODE_OPTIONS, NODE_PATH: null, TMPDIR: environment.TMPDIR || null, coreTMPDIR: env.TMPDIR || null },
            vsixSha256: input.vsix.sha256, steps: result?.steps, userVisualDesignAcceptance: 'PENDING' };
        for (const tool of Object.values(tools)) assert.equal(identity(tool.path).sha256, tool.sha256);
        write(path.join(output, 'replay-receipt.json'), resultReceipt);
        assert.equal(resultReceipt.status, 'PASS', `Fresh native failed: ${output}`); return resultReceipt;
    };
}
async function main(argv) {
    if (argv[0] === '--help') { console.log('Fresh installed native replay of captured AQuA sources (no compiler):\n  node native-fresh-replay.cjs --extraction ABS_BSV_LENS --tools-root ABS_REPO --observer-vsix ABS_VSIX --vscode ABS_CODE [--output-root ABS_DIR] [--workspace-id ID]\nThe VSIX and source inventory are selected only from validated evidence indexes inside the extraction. The named workspace is written outside the extraction to preserve its captured label. No source registration is required.\nAdvanced: --context ABS_JSON instead of --extraction; context = { cwd, receipt: { mode, nativeEvidence }, workspaces, directory }.\nOutput must be outside the extraction and package run. External tools must already be installed in the explicitly supplied tools root.\nCallback: nativeReplay({ toolsRoot, observerVsix, vscodeExecutable }) passed to package-review.build({ nativeReplay }).'); return; }
    if (argv[0] === '--native-only') { assert.equal(argv.length, 2); await nativeOnly(path.resolve(argv[1])); return; }
    const options = {}; let context, extraction;
    while (argv.length) { const key = argv.shift(), value = argv.shift(); assert.ok(value, `Missing ${key}`);
        if (key === '--context') { assert.ok(!context && !extraction); context = JSON.parse(fs.readFileSync(path.resolve(value))); }
        else if (key === '--extraction') { assert.ok(!context && !extraction); extraction = fs.realpathSync(value); }
        else { const field = { '--tools-root': 'toolsRoot', '--observer-vsix': 'observerVsix', '--vscode': 'vscodeExecutable', '--output-root': 'outputRoot', '--workspace-id': 'workspaceId' }[key];
            assert.ok(field && options[field] === undefined, `Unknown or duplicate ${key}`); options[field] = value; } }
    if (extraction) {
        const files = require(path.join(extraction, 'scripts/zip.js')).collectFiles(extraction, { prefix: 'bsv-lens' });
        const evidence = requireArchived(extraction, 'experiments/hardware/g6-usability/validate-delivery.cjs').validateEvidence(files);
        context = { cwd: extraction, receipt: { mode: 'standalone', nativeEvidence: evidence }, workspaces: evidence.workspaces, directory: path.dirname(extraction) };
    }
    assert.ok(context, 'Use --help for the replay context contract'); console.log(JSON.stringify(await nativeReplay(options)(context)));
}
if (require.main === module) main(process.argv.slice(2)).catch(error => { console.error(error.stack); process.exitCode = 1; });
module.exports = { nativeReplay, nativeOnly, selectInputs, archivedPath, inventory, outside, assertSourceEntry, viewportObservation, assertRestoredViewport };
