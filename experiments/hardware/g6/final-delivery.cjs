'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { spawn } = require('node:child_process');
const { finished } = require('node:stream/promises');
const ROOT = path.resolve(__dirname, '../../..');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const fileIdentity = file => { const bytes = fs.readFileSync(file); return { path: file, bytes: bytes.length, sha256: hash(bytes) }; };
const write = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
const position = (text, offset) => { const lines = text.slice(0, offset).split('\n'); return { line: lines.length - 1, character: lines.at(-1).length }; };
function requireArchived(cwd, relative) {
    assert.ok(relative.startsWith('experiments/hardware/') && !relative.split('/').includes('..'));
    const file = path.join(cwd, relative); assert.ok(fs.lstatSync(file).isFile()); return require(file);
}
async function nativeOnly(configFile) {
    const config = JSON.parse(fs.readFileSync(configFile)), { cwd, output, vsix, observerVsix, vscodeExecutable } = config;
    assert.equal(fs.realpathSync(cwd), fs.realpathSync(ROOT), 'Native replay must execute the archived wrapper');
    assert.equal(fs.realpathSync(process.cwd()), fs.realpathSync(cwd)); assert.equal(path.basename(output), 'g6');
    assert.equal(process.env.NODE_PATH, undefined, 'Native replay must not use NODE_PATH');
    assert.deepEqual(require('node:module').globalPaths, []);
    for (const dependency of ['@playwright/test', '@vscode/test-electron']) {
        const resolved = fs.realpathSync(require.resolve(`${dependency}/package.json`));
        assert.ok(resolved.startsWith(`${config.dependenciesDirectory}${path.sep}`), 'Native test dependency resolved outside its explicit copy');
    }
    const { prepareFixtures } = requireArchived(cwd, 'experiments/hardware/g6/native-fixtures.cjs');
    const { launchNative } = requireArchived(cwd, 'experiments/hardware/g6/native-driver.cjs');
    const { settled, chooseObject } = requireArchived(cwd, 'experiments/hardware/g6/development-smoke.cjs');
    const { registerBundle, enter, analyze, sourceReveal, identity } = requireArchived(cwd, 'experiments/hardware/g6/native-acceptance.cjs');
    const { captureNative } = requireArchived(cwd, 'experiments/hardware/g6/native-oracle.cjs');
    const { readVsix } = requireArchived(cwd, 'experiments/hardware/g6/package-vsix.cjs');
    const fixturesDirectory = path.join(output, 'input-copies'); fs.mkdirSync(fixturesDirectory);
    const inputs = await prepareFixtures(fixturesDirectory), fixture = inputs.fixtures.A;
    const { origin, ...stockManifest } = fixture.manifest;
    const referenceInput = await require(path.join(cwd, 'src/hardware/native-input.js')).loadNativeInput({
        sourceRoot: inputs.workspace, artifactRoot: inputs.workspace, manifest: stockManifest });
    const authority = { model: referenceInput.importResult.implementation,
        architecture: require(path.join(cwd, 'src/hardware/architecture.js')).createArchitecture({
            importResult: referenceInput.importResult, analysis: referenceInput.analysis }) };
    const report = { schema: 'g6-fresh-native-replay-v1', status: 'FAIL', startedAt: new Date().toISOString(),
        scope: 'Fresh archive harness; exact installed VSIX; actual A registration, writer editor, Back and reverse editor reveal. Full N/S acceptance remains a separate indexed lane.',
        cwd, targetMode: 'installed', vsix: fileIdentity(vsix), observerVsix: fileIdentity(observerVsix),
        vscodeExecutable: fileIdentity(vscodeExecutable), sourceInputs: inputs.inventory, steps: [], userVisualDesignAcceptance: 'PENDING' };
    let native, frame, page;
    try {
        native = await launchNative({ vsix, observerVsix, vscodeExecutable, workspace: inputs.workspace, output,
            harnessFiles: [path.join(cwd, 'experiments/hardware/g5-readability/oracle.cjs'), path.join(cwd, 'experiments/hardware/g4-fix/oracle/geometry.cjs')] });
        await native.channel.request('openProductCommand', { command: 'bsvArchitecture.openHardwareSchematic' });
        ({ frame, page } = await native.findWebview());
        await frame.waitForFunction(() => !!window.BsvHardwareTransport?.identity(), null, { timeout: 30000 });
        assert.equal(await frame.locator('#native-empty').isVisible(), true);
        report.steps.push('installed-command-empty-input');
        let state = await registerBundle({ native, frame, page, fixture, needsSourceRoot: true });
        assert.equal(state.scene.sceneKind, 'bsv'); assert.deepEqual(state.scene.children.map(row => row.label), ['left', 'right']);
        assert.equal(state.scene.snapshotId, referenceInput.importResult.snapshot.id);
        const left = state.scene.children.find(row => row.label === 'left');
        await native.traceCheckpoint('fresh-registered-A'); report.steps.push('actual-source-artifact-registration');
        state = await enter(frame, 'left'); const storage = state.scene.storages.find(row => row.label === 'state'); assert.ok(storage);
        await chooseObject(frame, storage.id); state = await analyze(frame, 'state-accesses');
        assert.equal(state.current.selectedEntityId, storage.id); assert.equal(state.current.analysis.result.writers.length, 1);
        const before = identity(state), canvasBefore = await frame.locator('#viewport').boundingBox();
        const readable = await captureNative({ native, frame, page, output, authority, name: 'fresh-selected-state',
            expectations: { root: 'left', storages: ['state'], contacts: ['put', 'get'], detail: true, fitAll: true } });
        assert.equal(readable.verdict.status, 'pass', JSON.stringify(readable.verdict.findings));
        report.readability = readable.verdict; report.steps.push('native-selected-names-glyph-measurement');
        await frame.locator('[data-code-section="writer"] [data-analysis-kind="behavior"]').click();
        await frame.waitForFunction(() => window.bsvHardware.getState().current?.analysis?.result.kind === 'behavior');
        state = await settled(frame);
        const referenceId = await frame.locator('#code-drawer pre[data-source-reference-id]').first().getAttribute('data-source-reference-id');
        report.sourceReveal = await sourceReveal({ native, frame, fixture, referenceId });
        await native.capture('fresh-actual-editor-range', page); await native.traceCheckpoint('fresh-writer-editor');
        report.steps.push('actual-editor-writer-range');
        await frame.locator('#back').click(); state = await settled(frame); const after = identity(state);
        for (const key of ['buildId', 'snapshotId', 'provider', 'owner', 'occurrence', 'selected', 'relation', 'queryId', 'resultHash'])
            assert.deepEqual(after[key], before[key], `Back did not restore ${key}`);
        const canvasAfter = await frame.locator('#viewport').boundingBox();
        if (canvasBefore.width === canvasAfter.width && canvasBefore.height === canvasAfter.height) assert.deepEqual(after.viewport, before.viewport);
        report.back = { before, after, canvasBefore, canvasAfter, viewportPolicy: 'Exact transform when drawable dimensions match; existing anchor adaptation after editor split otherwise.' };
        report.steps.push('back-restores-selected-analysis');
        const source = fixture.sourceFiles[0], text = fs.readFileSync(source.path, 'utf8'), offset = text.indexOf('left <- mkStage'); assert.ok(offset >= 0);
        await native.channel.request('moveCursor', { path: source.path, start: position(text, offset + 2) });
        await frame.waitForFunction(id => window.bsvHardware.getState().current?.selectedEntityId === id, left.id, { timeout: 30000 });
        state = await settled(frame); assert.equal(state.current.sceneKind, 'bsv'); assert.equal(state.current.buildId, before.buildId);
        report.reverse = { editor: await native.channel.request('observeEditors'), identity: identity(state) };
        await native.capture('fresh-editor-to-occurrence', page); await native.traceCheckpoint('fresh-reverse');
        report.steps.push('editor-instance-reveals-occurrence');
        await native.close(); assert.equal(native.receipt.status, 'passed');
        report.nativeReceipt = fileIdentity(path.join(output, 'native-receipt.json'));
        report.traceCrc = native.receipt.traceChunks.map(row => {
            assert.equal(fileIdentity(path.join(output, row.path)).sha256, row.sha256);
            const entries = readVsix(path.join(output, row.path)); return { path: row.path, bytes: row.bytes, sha256: row.sha256, entries: entries.size, crc: 'PASS' };
        });
        report.status = 'PASS';
    } catch (error) {
        report.error = error.stack || String(error);
        if (native) { try { await native.capture('fresh-native-failure', page); } catch (failure) { report.captureError = failure.message; }
            await native.close('failed', error); }
    } finally {
        report.originalInputsPreserved = inputs.inventory.every(row => { const bytes = fs.readFileSync(path.join(inputs.workspace, row.path)); return bytes.length === row.bytes && hash(bytes) === row.sha256; });
        report.vsixUnchanged = fileIdentity(vsix).sha256 === report.vsix.sha256;
        if (!report.originalInputsPreserved || !report.vsixUnchanged) report.status = 'FAIL';
        report.finishedAt = new Date().toISOString(); write(path.join(output, 'fresh-native.json'), report);
        console.log(JSON.stringify({ status: report.status, output, steps: report.steps, error: report.error }));
    }
    assert.equal(report.status, 'PASS', 'Fresh installed native replay failed'); return report;
}
function nativeReplay({ author = ROOT, vsix, observerVsix, vscodeExecutable }) {
    const tools = Object.fromEntries(Object.entries({ vsix, observerVsix, vscodeExecutable }).map(([key, value]) => {
        assert.ok(typeof value === 'string' && path.isAbsolute(value), `${key} must be an explicit absolute path`);
        const file = fs.realpathSync(value); fs.accessSync(file, key === 'vscodeExecutable' ? fs.constants.X_OK : fs.constants.R_OK); return [key, fileIdentity(file)];
    }));
    return async ({ receipt, cwd, env, directory }) => {
        assert.ok(path.resolve(cwd) !== author); assert.ok(!fs.existsSync(path.join(cwd, 'node_modules')));
        assert.ok(receipt.nativeEvidence.builds.length && receipt.nativeEvidence.builds.every(build => build.sha256 === tools.vsix.sha256), 'Replay VSIX must match the final archive');
        const output = path.join(directory, `native-replay-${receipt.mode}`, 'g6'); fs.mkdirSync(output, { recursive: true });
        const dependenciesDirectory = path.join(output, 'test-tools'), parentModules = path.join(path.dirname(cwd), 'node_modules');
        fs.mkdirSync(dependenciesDirectory); assert.equal(fs.existsSync(parentModules), false);
        const dependencies = requireArchived(cwd, 'experiments/hardware/g6/core.cjs').copyTestDependencies(author, dependenciesDirectory);
        fs.symlinkSync(path.join(dependenciesDirectory, 'node_modules'), parentModules, 'dir');
        const configFile = path.join(output, 'native-replay-config.json');
        write(configFile, { cwd, output, dependenciesDirectory: path.join(dependenciesDirectory, 'node_modules'),
            ...Object.fromEntries(Object.entries(tools).map(([key, value]) => [key, value.path])) });
        write(path.join(output, 'test-dependencies.json'), { ...dependencies, parentModuleLink: parentModules,
            scope: 'Explicit native-test tooling outside original extracted bsv-lens. No NODE_PATH or product Extension Host dependency injection.' });
        const executable = process.execPath, args = ['--no-global-search-paths', path.join(cwd, 'experiments/hardware/g6/final-delivery.cjs'), '--native-only', configFile];
        const environment = { ...process.env, G4_REVIEW_ROOT: cwd, G5_OUTPUT_DIR: output,
            G5_READABILITY_OUTPUT_DIR: output, G6_OUTPUT_DIR: output, NODE_OPTIONS: '--no-global-search-paths' };
        delete environment.NODE_PATH; delete environment.ELECTRON_RUN_AS_NODE;
        const logs = ['stdout', 'stderr'].map(name => fs.createWriteStream(path.join(output, `${name}.log`), { flags: 'wx' }));
        const startedAt = new Date().toISOString(), child = spawn(executable, args, { cwd, env: environment, timeout: 600000, stdio: ['ignore', 'pipe', 'pipe'] });
        child.stdout.pipe(logs[0]); child.stderr.pipe(logs[1]); let error;
        child.on('error', value => { error = value.message; });
        const exit = await new Promise(resolve => child.once('close', (code, signal) => resolve({ code, signal })));
        await Promise.all(logs.map(stream => finished(stream)));
        const resultFile = path.join(output, 'fresh-native.json');
        const result = fs.existsSync(resultFile) ? JSON.parse(fs.readFileSync(resultFile)) : null;
        if (result?.status === 'PASS') {
            assert.equal(result.vsix.sha256, tools.vsix.sha256);
            requireArchived(cwd, 'experiments/hardware/g6/validate-delivery.cjs').validateNativeIsolation(
                JSON.parse(fs.readFileSync(path.join(output, 'native-receipt.json'))));
        }
        const report = { status: exit.code === 0 && !error && result?.status === 'PASS' ? 'PASS' : 'FAIL', output, startedAt,
            finishedAt: new Date().toISOString(), executable, args, exit, error, tools, dependencyFingerprint: dependencies.fingerprint,
            environment: { PATH: environment.PATH, NODE_OPTIONS: environment.NODE_OPTIONS, NODE_PATH: null, G6_OUTPUT_DIR: output,
                TMPDIR: environment.TMPDIR || null, coreTemporaryDirectory: env.TMPDIR || null,
                boundary: 'Native tools use the caller OS temporary root and explicit three-store isolation; compiler-free core retains its separate restricted environment.' },
            result: result ? fileIdentity(resultFile) : null, steps: result?.steps, vsixSha256: result?.vsix.sha256,
            nativeReceipt: result?.nativeReceipt, traceCrc: result?.traceCrc, userVisualDesignAcceptance: 'PENDING' };
        for (const tool of Object.values(tools)) assert.equal(fileIdentity(tool.path).sha256, tool.sha256, 'External native tool changed');
        write(path.join(output, 'replay-receipt.json'), report); assert.equal(report.status, 'PASS', 'See fresh native replay receipt'); return report;
    };
}
async function main(argv) {
    if (argv[0] === '--native-only') { assert.equal(argv.length, 2); return nativeOnly(path.resolve(argv[1])); }
    const mode = argv.shift(); assert.ok(['--stage', '--build'].includes(mode), 'Usage: final-delivery.cjs --stage|--build --vsix ABSOLUTE --observer-vsix ABSOLUTE --vscode ABSOLUTE [--report RELATIVE]');
    const options = { publish: mode === '--build' }, external = {};
    while (argv.length) {
        const option = argv.shift(), value = argv.shift(); assert.ok(value, `Missing ${option} value`);
        if (option === '--report') options.report = value;
        else { const key = { '--vsix': 'vsix', '--observer-vsix': 'observerVsix', '--vscode': 'vscodeExecutable' }[option]; assert.ok(key && !external[key], `Unknown/duplicate ${option}`); external[key] = value; }
    }
    options.vsix = external.vsix; options.nativeReplay = nativeReplay(external);
    const result = await require('./package-review.cjs').build(options); console.log(JSON.stringify(result, null, 2)); return result;
}
if (require.main === module) main(process.argv.slice(2)).catch(error => { console.error(error.stack || error); process.exitCode = 1; });
module.exports = { nativeOnly, nativeReplay, requireArchived };
