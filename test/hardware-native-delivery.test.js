'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { hash } = require('../experiments/hardware/g4/validate-delivery');
const delivery = require('../experiments/hardware/g6/validate-delivery.cjs');
const packaging = require('../experiments/hardware/g6/package-review.cjs');
const { createRun } = require('../experiments/hardware/g6/run.cjs');
const { inventoryFromEntries, installerDelta } = require('../experiments/hardware/g6/native-runtime.cjs');

// These synthetic envelopes test validation rejection, not installed execution.
function fixture() {
    const prefix = `bsv-lens/${delivery.evidenceRoot}run-synthetic/`, rows = [], files = [];
    const put = (name, value) => { const data = Buffer.from(JSON.stringify(value)); rows.push({ name: prefix + name, data });
        files.push({ path: name, bytes: data.length, sha256: hash(data) }); return name; };
    const packageBytes = Buffer.from(JSON.stringify({ name: 'bsv-lens' }));
    const runtime = inventoryFromEntries([...['src/extension.js', 'media/hardware-view.js'].map(path => ({ path, bytes: Buffer.from(path) })),
        { path: 'package.json', bytes: packageBytes }], 'synthetic');
    put('native/archive-package.json', { name: 'bsv-lens' }); put('native/installed-package.json', { name: 'bsv-lens' });
    const vsix = { sha256: hash('synthetic vsix'), bytes: 3, receipt: put('vsix-validation.json', { sha256: hash('synthetic vsix'), bytes: 3,
        crc: 'PASS', nativeBuild: { extensionId: 'code0-god.bsv-lens', version: '0.4.1' }, runtime: runtime.rawFiles }) };
    const isolation = { profile: '/synthetic-test-only/profile', userDataDir: '/synthetic-test-only/profile/user-data',
        extensionsDir: '/synthetic-test-only/profile/extensions', sharedDataDir: '/synthetic-test-only/profile/shared-data' };
    const argv = ['user-data-dir', 'extensions-dir', 'shared-data-dir'].map((option, i) => `--${option}=${[isolation.userDataDir, isolation.extensionsDir, isolation.sharedDataDir][i]}`);
    const receipt = put('native/receipt.json', { targetMode: 'installed', status: 'passed', installedRuntimeIdentity: 'PASS', isolation,
        launch: { argv }, commands: ['--version', '--install-extension', '--list-extensions'].map(phase => ({ phase, argv: [...argv, phase], exitCode: 0 })),
        sharedDataOptionEvidence: { option: '--shared-data-dir', mainSha256: hash('synthetic VS Code source') },
        vsixSha256: vsix.sha256, installedTarget: { extensionPath: '/synthetic-test-only', runtime },
        archiveRuntime: runtime, installerDelta: installerDelta(packageBytes, packageBytes), environment: { node: 'synthetic' } });
    const ids = [...Array.from({ length: 15 }, (_, i) => `N${String(i + 1).padStart(2, '0')}`), ...Array.from({ length: 14 }, (_, i) => `S${String(i + 1).padStart(2, '0')}`)];
    const index = { schema: 'g6-evidence-v1', files, vsix, native: { receipts: [receipt],
        traces: [put('native/native-trace-main.zip', 'synthetic trace envelope')], captures: [put('native/screen.png', 'synthetic capture envelope')] },
        acceptance: ids.map(id => ({ id, status: 'PASS', executed: true, scope: 'installed-vsix', receipt })), lanes: [] };
    files.sort((a, b) => a.path.localeCompare(b.path)); rows.push({ name: prefix + 'index.json', data: Buffer.from(JSON.stringify(index)) });
    return { prefix, rows, index };
}
function changed(f, mutate) { const index = structuredClone(f.index); mutate(index); return f.rows.map(row => row.name === f.prefix + 'index.json' ? { ...row, data: Buffer.from(JSON.stringify(index)) } : row); }
function changedFile(f, file, mutate) {
    const row = f.rows.find(row => row.name === f.prefix + file), value = JSON.parse(row.data); mutate(value); const data = Buffer.from(JSON.stringify(value));
    return changed(f, index => Object.assign(index.files.find(row => row.path === file), { bytes: data.length, sha256: hash(data) }))
        .map(entry => entry === row ? { ...entry, data } : entry);
}
test('G6 delivery requires installed final VSIX evidence and every native/security acceptance gate', () => {
    const f = fixture(); assert.equal(delivery.validateEvidence(f.rows).complete, true);
    assert.throws(() => delivery.validateEvidence([]), /Missing final installed-native/);
    assert.equal(delivery.validateEvidence([], { allowIncompleteNative: true }).complete, false);
    for (const key of ['native', 'vsix', 'acceptance']) assert.throws(() => delivery.validateEvidence(changed(f, row => delete row[key])));
    assert.throws(() => delivery.validateEvidence(changed(f, row => row.acceptance.pop())), /Missing final installed-native/);
    assert.throws(() => delivery.validateEvidence(changed(f, row => { row.acceptance[0].status = 'NOT RUN'; row.acceptance[0].reason = 'unavailable'; })), /Missing final installed-native/);
    assert.throws(() => delivery.validateEvidence(changed(f, row => { row.acceptance[0].scope = 'preview-browser'; })), /scope/);
    assert.throws(() => delivery.validateEvidence(changedFile(f, 'native/receipt.json', row => row.targetMode = 'development')), /installed VSIX/);
    assert.throws(() => delivery.validateEvidence(changedFile(f, 'native/receipt.json', row => row.vsixSha256 = hash('other'))));
    assert.throws(() => delivery.validateEvidence(changedFile(f, 'native/receipt.json', row => row.status = 'failed')));
});
test('Final native evidence rejects default shared storage, escaping stores and incomplete CLI isolation', () => {
    const f = fixture();
    const reject = mutate => assert.throws(() => delivery.validateEvidence(changedFile(f, 'native/receipt.json', mutate)));
    reject(row => delete row.isolation.sharedDataDir);
    reject(row => row.isolation.sharedDataDir = '/Users/example/.vscode-shared');
    reject(row => row.isolation.sharedDataDir = row.isolation.userDataDir);
    reject(row => row.launch.argv = row.launch.argv.filter(value => !value.startsWith('--shared-data-dir=')));
    reject(row => row.commands[1].argv = row.commands[1].argv.filter(value => !value.startsWith('--shared-data-dir=')));
    reject(row => row.launch.argv.push('--extensions-dir=/outside'));
    reject(row => row.commands[0].exitCode = 1);
    reject(row => delete row.sharedDataOptionEvidence);
    reject(row => row.isolation.userDataDir = `${row.isolation.profile}/../user-data`);
});
test('G6 index enforces exact attachment hash, sorted paths, narrow traces and no local profile state', () => {
    const f = fixture(), proof = delivery.validateEvidence(f.rows); assert.deepEqual(delivery.validateEvidence(f.rows, { expected: proof }), proof);
    for (const row of f.index.files) {
        assert.throws(() => delivery.validateEvidence(f.rows.filter(entry => entry.name !== f.prefix + row.path)), /Missing G6 attachment/);
        assert.throws(() => delivery.validateEvidence(f.rows.map(entry => entry.name === f.prefix + row.path ? { ...entry, data: Buffer.from('corrupt') } : entry)), /G6 attachment/);
    }
    assert.throws(() => delivery.validateEvidence(changed(f, row => row.files.reverse())), /path-sorted/);
    assert.throws(() => delivery.validateEvidence([...f.rows, { name: f.prefix + 'orphan.json', data: Buffer.from('{}') }]), /Unindexed/);
    for (const file of ['native/other.zip', 'profile/settings.json', 'shared-data/state.json', 'native/../escape', '.omx/state.json', 'node_modules/x'])
        assert.throws(() => delivery.validateEvidence(changed(f, row => row.files[0].path = file)));
    assert.equal(delivery.tracePath(delivery.evidenceRoot + 'run-real/native/native-trace-main.zip'), true);
    assert.equal(delivery.tracePath(delivery.evidenceRoot + 'run-real/native/trace.zip'), false);
});
test('G6 collector omits historical readability QA and local state without touching original files', () => {
    const output = createRun('delivery-collector-test'), root = path.join(output, 'workspace'); fs.mkdirSync(root);
    const put = (file, data) => { fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true }); fs.writeFileSync(path.join(root, file), data); };
    put('src/core.js', 'runtime'); put('docs/hardware/evidence/g5-readability/run-old/index.json', 'historical');
    put('docs/hardware/evidence/g5/run-YTGBZS/index.json', 'separate historical supplement');
    put('docs/hardware/evidence/g5/run-zAkL5y/queries.json', 'required queries'); put('.omx/state.json', 'private');
    put('docs/hardware/evidence/g6/run-current/index.json', '{}');
    const entries = packaging.collectEntries({ workspace: root });
    assert.equal(entries.some(row => row.name.includes('g5-readability/run-old')), false);
    assert.equal(entries.some(row => row.name.includes('run-YTGBZS')), false);
    assert.equal(entries.some(row => row.name.includes('run-zAkL5y')), true);
    assert.equal(entries.some(row => row.name.includes('.omx')), false);
    assert.equal(fs.readFileSync(path.join(root, 'docs/hardware/evidence/g5-readability/run-old/index.json'), 'utf8'), 'historical');
    assert.deepEqual(packaging.archiveNames(root).map(file => path.basename(file)), ['bsv-lens-hardware-g6-review.zip', 'bsv-lens-hardware-g6-source.zip']);
    assert.throws(() => packaging.checkLimits([{ name: 'large', data: { length: 64 * 1024 * 1024 + 1 } }]), /ARCHIVE_MEMBER_SIZE/);
    assert.throws(() => packaging.checkLimits(Array.from({ length: 13 }, () => ({ name: 'large', data: { length: 64 * 1024 * 1024 } }))), /ARCHIVE_TOTAL_SIZE/);
});
