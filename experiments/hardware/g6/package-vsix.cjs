'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { execFileSync } = require('node:child_process');
const { crc32 } = require('../../../scripts/zip');
const { writeBuildMetadata } = require('../../../scripts/build-metadata');
const { inspectHardwareBuild, manifestBytes, MANIFEST_NORMALIZATION } = require('../../../src/panel/hardware-build');
const { hash, stable } = require('../../../src/hardware/json');
const { createRun } = require('./run.cjs');
const ROOT = path.resolve(__dirname, '../../..');
const GENERATED = new Set(['media/hardware-build.json', 'media/build-metadata.js']);
const LIMITS = { memberBytes: 64 * 1024 * 1024, aggregateBytes: 768 * 1024 * 1024 };
const comparePath = (a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
const record = (file, bytes) => ({ path: file, bytes: bytes.length, sha256: hash(bytes) });
const normalizedManifest = bytes => ({ ...record('package.json', manifestBytes(bytes)), normalization: MANIFEST_NORMALIZATION });
function safePath(relative) {
    assert.ok(typeof relative === 'string' && relative && !relative.includes('\\') && !relative.includes(':') && !relative.includes('\0')
        && !relative.split('/').some(part => !part || part === '.' || part === '..'), 'Unsafe archive path');
}
function readFile(root, relative) {
    safePath(relative);
    let current = root;
    for (const part of relative.split('/')) {
        current = path.join(current, part);
        assert.equal(fs.lstatSync(current).isSymbolicLink(), false, `Product symlink: ${relative}`);
    }
    const stat = fs.statSync(current);
    assert.ok(stat.isFile() && stat.size <= LIMITS.memberBytes, `Invalid/oversized product file: ${relative}`);
    return fs.readFileSync(current);
}
function collectProductFiles(root = ROOT) {
    const manifest = JSON.parse(readFile(root, 'package.json'));
    assert.equal(`${manifest.publisher}.${manifest.name}`, 'code0-god.bsv-lens');
    assert.equal(manifest.version, '0.4.1');
    assert.ok(Array.isArray(manifest.files), 'Explicit product files contract required');
    assert.ok(!manifest.scripts?.['vscode:prepublish'], 'G6 packaging does not run an unreviewed prepublish script');
    const names = new Set(['package.json']);
    function walk(relative) {
        for (const name of fs.readdirSync(path.join(root, relative)).sort()) {
            const file = `${relative}/${name}`, stat = fs.lstatSync(path.join(root, file));
            assert.ok(!name.startsWith('.') && !stat.isSymbolicLink(), `Local state/symlink in product tree: ${file}`);
            if (stat.isDirectory()) walk(file);
            else if (!GENERATED.has(file)) names.add(file);
        }
    }
    for (const pattern of manifest.files) {
        if (['src/**', 'media/**'].includes(pattern)) walk(pattern.slice(0, -3));
        else {
            assert.match(pattern, /^(?:[A-Za-z][A-Za-z0-9_-]*\.md|LICENSE(?:\.txt|\.md)?)$/, `Not a product include: ${pattern}`);
            names.add(pattern);
        }
    }
    const files = [...names].map(file => record(file, readFile(root, file))).sort(comparePath);
    assert.ok(files.some(file => file.path === manifest.main?.replace(/^\.\//, '')), 'Main entrypoint is not included');
    assert.ok(files.reduce((n, file) => n + file.bytes, 0) <= LIMITS.aggregateBytes, 'Product aggregate limit');
    return { manifest, files, fingerprint: hash(stable(files)),
        dependencies: Object.keys({ ...manifest.dependencies, ...manifest.optionalDependencies }).sort() };
}
function writeJson(file, value) { fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' }); }
function copyFile(root, stage, relative) {
    const bytes = readFile(root, relative), target = path.join(stage, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, bytes, { flag: 'wx' });
}
async function stageRuntime({ root = ROOT, output, sourceCommit, dirty }) {
    assert.match(sourceCommit, /^[a-f0-9]{40}$/); assert.equal(typeof dirty, 'boolean');
    const source = collectProductFiles(root), stage = path.join(output, 'vsix-stage');
    fs.mkdirSync(stage);
    for (const file of source.files) copyFile(root, stage, file.path);
    const includeDependencies = source.dependencies.length > 0;
    const dependencyFiles = [];
    if (includeDependencies) {
        const vsce = require('@vscode/vsce');
        const selected = (await vsce.listFiles({ cwd: root, packageManager: vsce.PackageManager.Npm })).filter(file => file.startsWith('node_modules/'));
        for (const dependency of source.dependencies) assert.ok(selected.includes(`node_modules/${dependency}/package.json`), `Runtime dependency not selected by product files contract: ${dependency}`);
        for (const file of selected.sort()) { copyFile(root, stage, file); dependencyFiles.push(record(file, readFile(root, file))); }
    }
    const nativeBuild = inspectHardwareBuild(stage);
    assert.deepEqual(nativeBuild, inspectHardwareBuild(root), 'Source changed while staging native runtime');
    writeJson(path.join(stage, 'media/hardware-build.json'), nativeBuild);
    const legacyBuild = writeBuildMetadata(stage, sourceCommit, dirty);
    assert.deepEqual(nativeBuild, inspectHardwareBuild(stage), 'Generated metadata changed native identity');
    assert.equal(collectProductFiles(root).fingerprint, source.fingerprint, 'Source changed during staging');
    return { stage, source, nativeBuild, legacyBuild, includeDependencies, dependencyFiles };
}
function readVsix(file) {
    assert.ok(fs.statSync(file).size <= LIMITS.aggregateBytes, 'Archive byte limit');
    const bytes = fs.readFileSync(file), entries = new Map();
    let end = bytes.length - 22;
    for (; end >= Math.max(0, bytes.length - 65557); end--) if (bytes.readUInt32LE(end) === 0x06054b50) break;
    assert.ok(end >= 0 && bytes.readUInt32LE(end) === 0x06054b50, 'ZIP end directory missing');
    assert.equal(bytes.readUInt16LE(end + 4), 0); assert.equal(bytes.readUInt16LE(end + 6), 0);
    const count = bytes.readUInt16LE(end + 10); assert.ok(count < 65535, 'ZIP64 unsupported');
    assert.equal(bytes.readUInt16LE(end + 8), count);
    assert.equal(end + 22 + bytes.readUInt16LE(end + 20), bytes.length, 'ZIP trailing bytes');
    let offset = bytes.readUInt32LE(end + 16), total = 0;
    const directoryEnd = offset + bytes.readUInt32LE(end + 12), seen = new Set();
    assert.equal(directoryEnd, end, 'Invalid ZIP directory size');
    for (let index = 0; index < count; index++) {
        assert.ok(offset + 46 <= end); assert.equal(bytes.readUInt32LE(offset), 0x02014b50);
        const flags = bytes.readUInt16LE(offset + 8), method = bytes.readUInt16LE(offset + 10);
        const expectedCrc = bytes.readUInt32LE(offset + 16), compressed = bytes.readUInt32LE(offset + 20), size = bytes.readUInt32LE(offset + 24);
        const nameLength = bytes.readUInt16LE(offset + 28), extra = bytes.readUInt16LE(offset + 30), comment = bytes.readUInt16LE(offset + 32);
        const local = bytes.readUInt32LE(offset + 42), name = bytes.subarray(offset + 46, offset + 46 + nameLength).toString('utf8');
        safePath(name); assert.ok(!seen.has(name.toLowerCase()), `Duplicate ZIP entry: ${name}`); seen.add(name.toLowerCase());
        assert.equal(flags & 1, 0, 'Encrypted ZIP unsupported'); assert.ok([0, 8].includes(method), 'Unsupported ZIP compression');
        const mode = bytes.readUInt32LE(offset + 38) >>> 16; assert.ok([0, 0o100000].includes(mode & 0o170000), 'Non-file ZIP entry');
        total += size; assert.ok(size <= LIMITS.memberBytes && total <= LIMITS.aggregateBytes, 'ZIP resource limit');
        assert.ok(local + 30 <= bytes.readUInt32LE(end + 16)); assert.equal(bytes.readUInt32LE(local), 0x04034b50);
        assert.equal(bytes.readUInt16LE(local + 8), method);
        const localNameLength = bytes.readUInt16LE(local + 26), localExtra = bytes.readUInt16LE(local + 28), start = local + 30 + localNameLength + localExtra;
        assert.equal(bytes.subarray(local + 30, local + 30 + localNameLength).toString('utf8'), name);
        assert.ok(start + compressed <= bytes.readUInt32LE(end + 16), 'ZIP member overlaps directory');
        const payload = bytes.subarray(start, start + compressed);
        const data = method === 8 ? zlib.inflateRawSync(payload, { maxOutputLength: LIMITS.memberBytes }) : Buffer.from(payload);
        assert.equal(data.length, size, 'ZIP member size mismatch'); assert.equal(crc32(data), expectedCrc, 'ZIP CRC mismatch');
        entries.set(name, data); offset += 46 + nameLength + extra + comment;
    }
    assert.equal(offset, directoryEnd); return entries;
}
function verifyVsix(file, { stage, expectedBuild } = {}) {
    const entries = readVsix(file), metadata = entries.get('extension/media/hardware-build.json');
    assert.ok(metadata, 'Native build metadata missing');
    const nativeBuild = JSON.parse(metadata);
    if (expectedBuild) assert.deepEqual(nativeBuild, expectedBuild);
    for (const name of entries.keys()) assert.match(name, /^(?:\[Content_Types\]\.xml|extension\.vsixmanifest|extension\/(?:package\.json|(?:readme|changelog)\.md|LICENSE(?:\.txt)?|src\/.+|media\/.+|node_modules\/.+))$/i, `Unexpected VSIX member: ${name}`);
    const runtime = [...entries].filter(([name]) => /^extension\/(?:package\.json$|src\/|media\/|node_modules\/)/.test(name))
        .map(([name, bytes]) => record(name.slice('extension/'.length), bytes)).sort(comparePath);
    const normalizedRuntime = runtime.map(row => row.path === 'package.json' ? normalizedManifest(entries.get('extension/package.json')) : row);
    const original = nativeBuild.files.map(row => ({ ...row })).sort(comparePath);
    assert.deepEqual(normalizedRuntime.filter(row => !GENERATED.has(row.path) && !row.path.startsWith('node_modules/')), original, 'VSIX native runtime identity mismatch');
    const nativeFiles = original.slice().sort((a, b) => a.path.localeCompare(b.path));
    assert.deepEqual(nativeBuild.files, nativeFiles, 'Native inventory order differs from its defined contract');
    assert.equal(nativeBuild.runtimeFingerprint, hash(stable(nativeFiles)), 'Native aggregate fingerprint mismatch');
    assert.equal(nativeBuild.hostFingerprint, hash(stable(nativeFiles.filter(row => row.path.startsWith('src/')))));
    assert.equal(nativeBuild.webviewFingerprint, hash(stable(nativeFiles.filter(row => row.path.startsWith('media/')))));
    assert.equal(nativeBuild.buildId, `g6:${nativeBuild.runtimeFingerprint}`);
    assert.equal(nativeBuild.schema, 1); assert.equal(nativeBuild.protocol, 1);
    const manifest = JSON.parse(entries.get('extension/package.json'));
    assert.equal(`${manifest.publisher}.${manifest.name}`, nativeBuild.extensionId); assert.equal(manifest.version, nativeBuild.version);
    assert.equal(nativeBuild.extensionId, 'code0-god.bsv-lens'); assert.equal(nativeBuild.version, '0.4.1');
    assert.ok(entries.has('extension/media/build-metadata.js') && entries.has('extension.vsixmanifest') && entries.has('[Content_Types].xml'), 'Required VSIX metadata missing');
    if (stage) for (const row of runtime) assert.deepEqual(row, record(row.path, readFile(stage, row.path)), `Stage/VSIX mismatch: ${row.path}`);
    return { file, bytes: fs.statSync(file).size, sha256: hash(fs.readFileSync(file)), crc: 'PASS', nativeBuild,
        entries: [...entries].map(([name, bytes]) => record(name, bytes)).sort(comparePath), runtime,
        runtimeFingerprint: hash(stable(runtime)), normalizedRuntime, normalizedRuntimeFingerprint: hash(stable(normalizedRuntime)),
        manifest: { raw: record('package.json', entries.get('extension/package.json')), normalized: normalizedManifest(entries.get('extension/package.json')) },
        installedValidation: 'NOT RUN' };
}
function verifyInstalledRuntime({ vsix, installationPath }) {
    const archive = verifyVsix(vsix), installed = archive.runtime.map(row => record(row.path, readFile(installationPath, row.path)));
    const archiveManifest = readVsix(vsix).get('extension/package.json'), installedManifest = readFile(installationPath, 'package.json');
    const normalizedRuntime = installed.map(row => row.path === 'package.json' ? normalizedManifest(installedManifest) : row);
    assert.deepEqual(normalizedRuntime, archive.normalizedRuntime, 'Installed runtime differs from delivered VSIX outside approved manifest normalization');
    const nativeBuild = inspectHardwareBuild(installationPath);
    assert.deepEqual(nativeBuild, archive.nativeBuild, 'Installed runtime contains unlisted or changed files');
    const before = JSON.parse(archiveManifest), after = JSON.parse(installedManifest);
    const changedKeys = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(key => stable(before[key]) !== stable(after[key])).sort();
    assert.ok(changedKeys.every(key => key === '__metadata'), 'Installer changed a runtime manifest field');
    return { status: 'PASS', installationPath, vsixSha256: archive.sha256, runtime: installed,
        nativeBuild, runtimeFingerprint: hash(stable(installed)), archiveRuntime: archive.runtime,
        normalizedRuntime, normalizedRuntimeFingerprint: hash(stable(normalizedRuntime)),
        manifestDelta: { normalization: MANIFEST_NORMALIZATION, changedTopLevelKeys: changedKeys,
            rawBytesEqual: archiveManifest.equals(installedManifest), archive: record('package.json', archiveManifest),
            installed: record('package.json', installedManifest), normalized: normalizedManifest(installedManifest) } };
}
function resolveProvenance({ root = ROOT, sourceCommit, dirty } = {}) {
    const provided = sourceCommit !== undefined || dirty !== undefined;
    if (provided) {
        assert.match(sourceCommit, /^[a-f0-9]{40}$/, 'Explicit full source SHA required with dirty');
        assert.equal(typeof dirty, 'boolean', 'Explicit boolean dirty required with sourceCommit');
    } else {
        const gitRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: root, encoding: 'utf8' }).trim();
        assert.equal(fs.realpathSync(gitRoot), fs.realpathSync(root), 'Source root is not the Git root; provide archived sourceCommit and dirty explicitly');
        sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
        dirty = execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).length > 0;
        assert.match(sourceCommit, /^[a-f0-9]{40}$/);
    }
    return { sourceCommit, dirty, kind: provided ? 'explicit-archived-provenance' : 'observed-git',
        inputFingerprint: hash(stable({ sourceCommit, dirty })) };
}
async function buildVsix({ root = ROOT, output = createRun('vsix'), final = false, sourceCommit, dirty } = {}) {
    assert.equal(path.basename(output), 'g6', 'Output must be unique run/g6'); fs.mkdirSync(output, { recursive: true });
    const provenance = resolveProvenance({ root, sourceCommit, dirty });
    ({ sourceCommit, dirty } = provenance);
    const staged = await stageRuntime({ root, output, sourceCommit, dirty });
    const name = `bsv-lens-0.4.1-${staged.nativeBuild.runtimeFingerprint.slice(0, 16)}.vsix`, file = path.join(output, name);
    assert.equal(fs.existsSync(file), false, 'Refusing prior VSIX overwrite');
    const packager = require('@vscode/vsce/package.json'); assert.equal(packager.version, '3.9.2', 'Review changed packager version before packaging');
    const startedAt = new Date().toISOString();
    await require('@vscode/vsce').createVSIX({ cwd: staged.stage, packagePath: file, dependencies: staged.includeDependencies,
        useYarn: false, followSymlinks: false });
    const verification = verifyVsix(file, { stage: staged.stage, expectedBuild: staged.nativeBuild });
    assert.equal(collectProductFiles(root).fingerprint, staged.source.fingerprint, 'Source changed during official package build');
    const receipt = { schema: 'bsv-g6-vsix-package-v1', status: 'PASS', startedAt, finishedAt: new Date().toISOString(), sourceCommit, dirty,
        provenance,
        environment: { node: process.version, platform: process.platform, arch: process.arch },
        sourceRoot: root, output, stage: staged.stage, source: staged.source, legacyBuild: staged.legacyBuild, nativeBuild: staged.nativeBuild,
        packager: { name: packager.name, version: packager.version, source: 'https://github.com/microsoft/vsce',
            api: 'createVSIX', includeDependencies: staged.includeDependencies, dependencyFiles: staged.dependencyFiles }, verification,
        final: null, nativeValidation: 'NOT RUN' };
    fs.writeFileSync(`${file}.sha256`, `${verification.sha256}  ${name}\n`, { flag: 'wx' });
    if (final) {
        const destination = path.join(root, 'dist', name); fs.mkdirSync(path.dirname(destination), { recursive: true });
        for (const suffix of ['', '.sha256', '.validation.json']) assert.equal(fs.existsSync(destination + suffix), false, `Refusing prior final delivery overwrite: ${destination + suffix}`);
        fs.copyFileSync(file, destination, fs.constants.COPYFILE_EXCL); fs.copyFileSync(`${file}.sha256`, `${destination}.sha256`, fs.constants.COPYFILE_EXCL);
        receipt.final = { file: destination, sha256: verification.sha256 }; writeJson(`${destination}.validation.json`, receipt);
    }
    writeJson(`${file}.validation.json`, receipt); return receipt;
}
if (require.main === module) {
    const args = process.argv.slice(2), options = {};
    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--final') options.final = true;
        else if (['--root', '--output'].includes(args[i]) && args[i + 1]) options[args[i].slice(2)] = path.resolve(args[++i]);
        else if (args[i] === '--source-commit' && args[i + 1]) options.sourceCommit = args[++i];
        else if (args[i] === '--dirty' && ['true', 'false'].includes(args[i + 1])) options.dirty = args[++i] === 'true';
        else if (args[i] === '--help') { console.log('node package-vsix.cjs [--root SOURCE] [--output UNIQUE_RUN/g6] [--final]\nGit-less source: --source-commit FULL_SHA --dirty true|false\nOfficial isolated packaging; final promotion is exclusive. Native installation validation is a separate gate.'); process.exit(0); }
        else throw new Error(`Unknown/incomplete argument: ${args[i]}`);
    }
    buildVsix(options).then(receipt => console.log(JSON.stringify({ file: receipt.verification.file, sha256: receipt.verification.sha256,
        buildId: receipt.nativeBuild.buildId, receipt: `${receipt.verification.file}.validation.json` }, null, 2)))
        .catch(error => { console.error(error); process.exitCode = 1; });
}
module.exports = { collectProductFiles, stageRuntime, readVsix, verifyVsix, verifyInstalledRuntime, resolveProvenance, buildVsix, LIMITS };
