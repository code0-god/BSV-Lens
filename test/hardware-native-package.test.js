'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRun } = require('../experiments/hardware/g6/run.cjs');
const { collectProductFiles, stageRuntime, readVsix, verifyVsix, verifyInstalledRuntime, resolveProvenance } = require('../experiments/hardware/g6/package-vsix.cjs');
const { inspectHardwareBuild } = require('../src/panel/hardware-build');
const { hash } = require('../src/hardware/json');
const { writeZip } = require('../scripts/zip');

function fixture() {
    const output = createRun('package-test'), root = path.join(output, 'source');
    for (const directory of ['src', 'media', 'experiments', 'dist', '.omx']) fs.mkdirSync(path.join(root, directory), { recursive: true });
    const manifest = { name: 'bsv-lens', publisher: 'code0-god', version: '0.4.1', engines: { vscode: '^1.90.0' },
        main: './src/extension.js', files: ['src/**', 'media/**', 'README.md', 'CHANGELOG.md', 'LICENSE'] };
    for (const [file, contents] of Object.entries({ 'package.json': JSON.stringify(manifest, null, 2),
        'src/extension.js': "'use strict'; exports.activate = () => {};\n", 'media/view.js': "'use strict';\n",
        'media/build-metadata.js': 'historical-legacy-marker', 'media/hardware-build.json': 'historical-native-marker',
        'README.md': '# Test-only packaging fixture\n', 'CHANGELOG.md': '# Test fixture\n', LICENSE: 'MIT\n',
        'experiments/private.js': 'never product', 'dist/old.vsix': 'protected archive', '.omx/state.json': 'private local state' })) fs.writeFileSync(path.join(root, file), contents);
    return { output, root, manifest };
}
async function stagedFixture() {
    const fixtureInput = fixture();
    const staged = await stageRuntime({ ...fixtureInput, sourceCommit: 'a'.repeat(40), dirty: true });
    return { ...fixtureInput, ...staged };
}
function archiveEntries(stage) {
    const names = collectProductFiles(stage).files.map(row => row.path).concat(['media/hardware-build.json', 'media/build-metadata.js']);
    const mapped = names.map(file => ({ name: `extension/${file === 'README.md' ? 'readme.md' : file === 'CHANGELOG.md' ? 'changelog.md' : file === 'LICENSE' ? 'LICENSE.txt' : file}`,
        data: fs.readFileSync(path.join(stage, file)) }));
    return [...mapped, { name: 'extension.vsixmanifest', data: Buffer.from('<PackageManifest/>') }, { name: '[Content_Types].xml', data: Buffer.from('<Types/>') }];
}

test('G6 stages approved runtime without touching historical metadata, evidence or archives', async () => {
    const { root, output, stage, source, nativeBuild, legacyBuild, includeDependencies } = await stagedFixture();
    assert.equal(includeDependencies, false); assert.deepEqual(source.dependencies, []);
    assert.equal(fs.readFileSync(path.join(root, 'media/build-metadata.js'), 'utf8'), 'historical-legacy-marker');
    assert.equal(fs.readFileSync(path.join(root, 'media/hardware-build.json'), 'utf8'), 'historical-native-marker');
    assert.equal(fs.readFileSync(path.join(root, 'dist/old.vsix'), 'utf8'), 'protected archive');
    for (const directory of ['experiments', 'dist', '.omx']) assert.equal(fs.existsSync(path.join(stage, directory)), false);
    assert.deepEqual(inspectHardwareBuild(stage), nativeBuild);
    assert.deepEqual(inspectHardwareBuild(root), nativeBuild);
    assert.equal(legacyBuild.version, '0.4.1'); assert.match(legacyBuild.buildId, /^sha256:[a-f0-9]{64}$/);
    assert.equal(collectProductFiles(root).fingerprint, source.fingerprint);
    await assert.rejects(stageRuntime({ root, output, sourceCommit: 'a'.repeat(40), dirty: true }), { code: 'EEXIST' });
});

test('G6 ZIP and installation verifier bind exact bytes, CRC and native host/Webview metadata', async () => {
    const { output, stage, nativeBuild } = await stagedFixture(), file = path.join(output, 'test-only.vsix');
    writeZip(file, archiveEntries(stage));
    const receipt = verifyVsix(file, { stage, expectedBuild: nativeBuild });
    assert.equal(receipt.crc, 'PASS'); assert.equal(receipt.sha256, hash(fs.readFileSync(file)));
    assert.equal(receipt.installedValidation, 'NOT RUN');
    assert.equal(verifyInstalledRuntime({ vsix: file, installationPath: stage }).status, 'PASS');
    fs.appendFileSync(path.join(stage, 'media/view.js'), '// changed installed asset\n');
    assert.throws(() => verifyInstalledRuntime({ vsix: file, installationPath: stage }), /Installed runtime differs/);
    const changed = archiveEntries(stage), modified = path.join(output, 'modified-test-only.vsix');
    writeZip(modified, changed);
    assert.throws(() => verifyVsix(modified), /VSIX native runtime identity mismatch/);
});

test('G6 ZIP validation rejects corrupt data, escaping paths and forged metadata hashes', async () => {
    const { output, stage } = await stagedFixture(), entries = archiveEntries(stage);
    const forged = entries.map(entry => entry.name === 'extension/media/hardware-build.json'
        ? { ...entry, data: Buffer.from(JSON.stringify({ ...JSON.parse(entry.data), runtimeFingerprint: '0'.repeat(64) })) } : entry);
    const forgedPath = path.join(output, 'forged-test-only.vsix'); writeZip(forgedPath, forged);
    assert.throws(() => verifyVsix(forgedPath), /Native aggregate fingerprint mismatch/);
    const unsafePath = path.join(output, 'unsafe-test-only.zip');
    writeZip(unsafePath, [{ name: 'safe/path.txt', data: Buffer.from('data') }]);
    const unsafe = fs.readFileSync(unsafePath);
    for (let offset = unsafe.indexOf('safe/path.txt'); offset >= 0; offset = unsafe.indexOf('safe/path.txt', offset + 1)) unsafe.write('../x/path.txt', offset);
    fs.writeFileSync(unsafePath, unsafe); assert.throws(() => readVsix(unsafePath), /Unsafe archive path/);
    const corruptPath = path.join(output, 'corrupt-test-only.zip'); writeZip(corruptPath, [{ name: 'safe.txt', data: Buffer.from('hello') }]);
    const corrupt = fs.readFileSync(corruptPath); corrupt[30 + corrupt.readUInt16LE(26) + corrupt.readUInt16LE(28)] ^= 1;
    fs.writeFileSync(corruptPath, corrupt); assert.throws(() => readVsix(corruptPath));
});

test('G6 product collection rejects broader inputs, symlinks and implicit scripts; dependencies stay explicit', () => {
    const { root, manifest } = fixture(), file = path.join(root, 'package.json');
    fs.writeFileSync(file, JSON.stringify({ ...manifest, dependencies: { requiredRuntime: '1.0.0' } }));
    assert.deepEqual(collectProductFiles(root).dependencies, ['requiredRuntime']);
    fs.writeFileSync(file, JSON.stringify({ ...manifest, files: [...manifest.files, 'experiments/**'] }));
    assert.throws(() => collectProductFiles(root), /Not a product include/);
    fs.writeFileSync(file, JSON.stringify({ ...manifest, scripts: { 'vscode:prepublish': 'unexpected execution' } }));
    assert.throws(() => collectProductFiles(root), /unreviewed prepublish script/);
    fs.writeFileSync(file, JSON.stringify(manifest)); fs.symlinkSync('../dist/old.vsix', path.join(root, 'media/escape'));
    assert.throws(() => collectProductFiles(root), /symlink/);
});

test('Git-less archived source stages with explicit hash-bound provenance and no inherited Git fallback', async () => {
    const { root, output } = fixture();
    assert.equal(fs.existsSync(path.join(root, '.git')), false);
    assert.throws(() => resolveProvenance({ root }));
    for (const supplied of [{ sourceCommit: 'b'.repeat(40) }, { dirty: false }, { sourceCommit: 'short', dirty: true },
        { sourceCommit: 'b'.repeat(40), dirty: 'false' }]) assert.throws(() => resolveProvenance({ root, ...supplied }));
    const provenance = resolveProvenance({ root, sourceCommit: 'b'.repeat(40), dirty: false });
    assert.equal(provenance.kind, 'explicit-archived-provenance'); assert.equal(provenance.dirty, false);
    assert.match(provenance.inputFingerprint, /^[a-f0-9]{64}$/);
    const staged = await stageRuntime({ root, output, ...provenance });
    assert.equal(staged.legacyBuild.sourceCommit, provenance.sourceCommit);
    assert.equal(staged.legacyBuild.dirty, false);
    assert.deepEqual(staged.nativeBuild, inspectHardwareBuild(root));
});

test('Observed VS Code manifest formatting and metadata normalize without ignoring product fields', async () => {
    const { output, stage } = await stagedFixture(), file = path.join(output, 'installer-metadata-test-only.vsix');
    writeZip(file, archiveEntries(stage));
    const manifestFile = path.join(stage, 'package.json'), original = JSON.parse(fs.readFileSync(manifestFile));
    const installed = { ...original, __metadata: { installedTimestamp: 1788934623937, targetPlatform: 'undefined', size: 1000 } };
    fs.writeFileSync(manifestFile, JSON.stringify(installed));
    const metadataReceipt = verifyInstalledRuntime({ vsix: file, installationPath: stage });
    assert.equal(metadataReceipt.status, 'PASS'); assert.equal(metadataReceipt.manifestDelta.rawBytesEqual, false);
    assert.deepEqual(metadataReceipt.manifestDelta.changedTopLevelKeys, ['__metadata']);
    assert.notEqual(metadataReceipt.manifestDelta.archive.sha256, metadataReceipt.manifestDelta.installed.sha256);
    fs.writeFileSync(manifestFile, JSON.stringify(original, null, 4));
    const formattingReceipt = verifyInstalledRuntime({ vsix: file, installationPath: stage });
    assert.equal(formattingReceipt.status, 'PASS'); assert.deepEqual(formattingReceipt.manifestDelta.changedTopLevelKeys, []);
    assert.equal(formattingReceipt.manifestDelta.rawBytesEqual, false);
    for (const mutation of [{ version: '0.4.2' }, { contributes: { commands: [{ command: 'foreign.command', title: 'Changed command' }] } },
        { dependencies: { unexpected: '1.0.0' } }, { files: [...original.files].reverse() }]) {
        fs.writeFileSync(manifestFile, JSON.stringify({ ...installed, ...mutation }));
        assert.throws(() => verifyInstalledRuntime({ vsix: file, installationPath: stage }), /Installed runtime differs/);
    }
});
