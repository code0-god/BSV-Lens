'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { createRun } = require('./run.cjs');
const { reuseProfile } = require('./native-driver.cjs');
const { runtimeInventory } = require('./native-runtime.cjs');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
function fixture(t) {
    const output = createRun('restart-contract'), profile = fs.mkdtempSync(path.join(os.tmpdir(), 'bg6-'));
    const isolation = { profile, userDataDir: path.join(profile, 'user-data'), extensionsDir: path.join(profile, 'extensions'),
        sharedDataDir: path.join(profile, 'shared-data') };
    for (const directory of [isolation.userDataDir, isolation.extensionsDir, isolation.sharedDataDir]) fs.mkdirSync(directory);
    const storage = path.join(isolation.userDataDir, 'User/workspaceStorage/sample'); fs.mkdirSync(storage, { recursive: true });
    fs.writeFileSync(path.join(storage, 'state.vscdb'), 'Synthetic memento guard fixture; not native execution');
    const installed = path.join(isolation.extensionsDir, 'code0-god.bsv-lens-0.4.1'); fs.mkdirSync(installed);
    fs.writeFileSync(path.join(installed, 'package.json'), JSON.stringify({ publisher: 'code0-god', name: 'bsv-lens', version: '0.4.1' }));
    const workspace = path.join(output, 'workspace'); fs.mkdirSync(workspace);
    const vsix = path.join(output, 'product.vsix'), observerVsix = path.join(output, 'observer.vsix');
    fs.writeFileSync(vsix, 'Synthetic VSIX-hash guard fixture'); fs.writeFileSync(observerVsix, 'Synthetic observer-hash guard fixture');
    const closed = spawnSync(process.execPath, ['-e', '']); assert.equal(closed.status, 0);
    const previous = { schema: 'bsv-g6-native-driver-v1', status: 'passed', targetMode: 'installed',
        installedRuntimeIdentity: 'PASS', installedRuntimeUnchanged: true, harnessUnchanged: true,
        shutdown: { code: 0, signal: null }, finishedAt: new Date().toISOString(), launch: { pid: closed.pid },
        workspace, workspaceConfiguration: null, vsixSha256: hash(fs.readFileSync(vsix)),
        observerPackage: { sha256: hash(fs.readFileSync(observerVsix)) }, vscodeExecutable: process.execPath, isolation,
        installedTarget: { extensionPath: installed }, installedRuntimeAfter: runtimeInventory(installed) };
    const receiptPath = path.join(output, 'native-receipt.json');
    const save = () => fs.writeFileSync(receiptPath, JSON.stringify(previous)); save();
    t.diagnostic(`Synthetic restart guard fixture: ${output}`);
    return { previous, isolation, installed, storage, save, output,
        options: { receiptPath, vsix, observerVsix, workspace, workspaceConfiguration: null, vscodeExecutable: process.execPath } };
}
test('restart accepts only a closed matching owned profile and hashes existing workspace state without altering bytes', t => {
    const f = fixture(t), before = fs.readFileSync(f.options.receiptPath), state = fs.readFileSync(path.join(f.storage, 'state.vscdb'));
    const result = reuseProfile(f.options);
    assert.equal(result.profile, f.isolation.profile); assert.equal(result.previousReceipt.sha256, hash(before));
    assert.equal(result.workspaceStateBefore.files.length, 1); assert.equal(result.workspaceStateBefore.files[0].sha256, hash(state));
    assert.deepEqual(fs.readFileSync(f.options.receiptPath), before);
    assert.deepEqual(fs.readFileSync(path.join(f.storage, 'state.vscdb')), state);
});
test('restart accepts the canonical installed path under the same private temporary directory', t => {
    const f = fixture(t); f.previous.installedTarget.extensionPath = fs.realpathSync(f.installed); f.save();
    assert.equal(reuseProfile(f.options).profile, f.isolation.profile);
});
test('restart rejects a different workspace, VSIX, observer, executable, unclosed process and changed installed runtime', t => {
    for (const mutate of [
        f => { f.previous.workspace += '-foreign'; }, f => { f.previous.vsixSha256 = '0'.repeat(64); },
        f => { f.previous.observerPackage.sha256 = '0'.repeat(64); }, f => { f.previous.vscodeExecutable += '-foreign'; },
        f => { f.previous.status = 'running'; }, f => { f.previous.shutdown.code = 1; },
        f => { f.previous.launch.pid = process.pid; }, f => { f.previous.targetMode = 'development'; },
        f => { f.previous.workspaceConfiguration = { file: 'foreign' }; },
        f => { fs.writeFileSync(path.join(f.installed, 'package.json'), '{}'); }
    ]) { const f = fixture(t); mutate(f); f.save(); assert.throws(() => reuseProfile(f.options)); }
});
test('restart rejects foreign temporary profiles, receipt/store symlinks and unbounded workspace state', t => {
    for (const mutate of [
        f => { f.previous.isolation.profile = fs.mkdtempSync(path.join(os.tmpdir(), 'foreign-profile-')); },
        f => { const target = f.options.receiptPath + '.original'; fs.renameSync(f.options.receiptPath, target); fs.symlinkSync(target, f.options.receiptPath); },
        f => { const target = f.isolation.extensionsDir + '-original'; fs.renameSync(f.isolation.extensionsDir, target); fs.symlinkSync(target, f.isolation.extensionsDir); },
        f => { const target = f.installed + '-original'; fs.renameSync(f.installed, target); fs.symlinkSync(target, f.installed); },
        f => { fs.symlinkSync(f.options.vsix, path.join(f.storage, 'escaped-state')); },
        f => { fs.writeFileSync(path.join(f.storage, 'oversized'), Buffer.alloc(16 * 1024 * 1024 + 1)); }
    ]) { const f = fixture(t); mutate(f);
        if (!fs.lstatSync(f.options.receiptPath).isSymbolicLink()) f.save();
        assert.throws(() => reuseProfile(f.options)); }
});
