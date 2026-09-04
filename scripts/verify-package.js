'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { Parser } = require('xml2js');
const { crc32 } = require('./zip');

const root = path.resolve(__dirname, '..');
const dist = path.join(root, 'dist');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const vsixName = `${manifest.name}-${manifest.version}.vsix`;
const repositoryName = `${manifest.name}-repository-${manifest.version}.zip`;
const vsix = readZip(path.join(dist, vsixName));
const repository = readZip(path.join(dist, repositoryName));

for (const entry of [
    'extension/package.json',
    'extension/src/extension.js',
    'extension/src/architecture/behavior-analysis.js',
    'extension/src/architecture/interface-contract-diagnostics.js',
    'extension/src/architecture/interface-contract-types.js',
    'extension/src/architecture/interface-contracts.js',
    'extension/src/architecture/scheduling.js',
    'extension/src/architecture/symbol-resolver.js',
    'extension/src/architecture/symbol-index.js',
    'extension/src/architecture/type-analysis.js',
    'extension/src/compiler/bsc-schedule-provider.js',
    'extension/src/security/workspace-boundary.js',
    'extension/media/graph-view.js',
    'extension/media/text-metrics.js',
    'extension/media/webview-layout.js',
    'extension/media/webview.js',
    'extension/media/webview.css',
    'extension/media/icon.png',
    'extension.vsixmanifest',
    '[Content_Types].xml'
]) assert.ok(vsix.has(entry), `VSIX missing ${entry}`);

for (const entry of vsix.keys()) {
    assert.match(
        entry,
        /^(?:\[Content_Types\]\.xml|extension\.vsixmanifest|extension\/(?:package\.json|(?:readme|changelog)\.md|LICENSE(?:\.txt)?|src\/.+|media\/.+))$/i,
        `Unexpected path included in VSIX: ${entry}`
    );
}

const embedded = JSON.parse(vsix.get('extension/package.json').toString('utf8'));
assert.equal(embedded.version, manifest.version);
assert.equal(`${embedded.publisher}.${embedded.name}`, 'code0-god.bsv-lens');
for (const key of [
    'defaultSourceScope',
    'defaultLevel',
    'defaultMode',
    'defaultHopScope',
    'syncWithEditor',
    'showMethodPorts',
    'collapseModuleMembers',
    'includePotentialScheduleDependencies'
]) assert.ok(embedded.contributes.configuration.properties[`bsvArchitecture.${key}`]);
for (const command of manifest.contributes.commands.map((item) => item.command)) {
    assert.ok(embedded.contributes.commands.some((item) => item.command === command));
}

const packageManifest = parseXml(vsix.get('extension.vsixmanifest'), 'VSIX manifest').PackageManifest;
assert.ok(packageManifest, 'VSIX manifest lacks PackageManifest root');
assert.equal(packageManifest.$.Version, '2.0.0');
assert.equal(packageManifest.$.xmlns, 'http://schemas.microsoft.com/developer/vsx-schema/2011');
const metadata = one(packageManifest.Metadata, 'VSIX Metadata');
const identity = one(metadata.Identity, 'VSIX Identity').$;
assert.equal(identity.Id, manifest.name);
assert.equal(identity.Publisher, manifest.publisher);
assert.equal(identity.Version, manifest.version);

const contentTypes = parseXml(vsix.get('[Content_Types].xml'), 'VSIX content types').Types;
assert.ok(contentTypes, 'VSIX content types lacks Types root');
assert.equal(contentTypes.$.xmlns, 'http://schemas.openxmlformats.org/package/2006/content-types');
const contentTypeByExtension = new Map();
for (const item of contentTypes.Default || []) {
    const extension = item.$.Extension;
    const contentType = item.$.ContentType;
    assert.ok(contentType, `VSIX content type is empty: ${extension}`);
    assert.equal(contentTypeByExtension.has(extension), false, `Duplicate VSIX content type: ${extension}`);
    contentTypeByExtension.set(extension, contentType);
}
for (const [extension, contentType] of [
    ['.vsixmanifest', 'text/xml'],
    ['.json', 'application/json'],
    ['.js', 'application/javascript'],
    ['.css', 'text/css'],
    ['.md', 'text/markdown'],
    ['.png', 'image/png'],
    ['.txt', 'text/plain']
]) assert.equal(contentTypeByExtension.get(extension), contentType, `Invalid VSIX content type: ${extension}`);
for (const extension of contentTypeByExtension.keys()) {
    assert.match(extension, /^\./, `VSIX content type extension lacks leading dot: ${extension}`);
}
for (const entry of vsix.keys()) {
    if (entry === '[Content_Types].xml') continue;
    const extension = path.posix.extname(entry);
    assert.ok(contentTypeByExtension.has(extension), `VSIX content type missing for ${entry}`);
}

const assetByType = new Map();
for (const asset of one(packageManifest.Assets, 'VSIX Assets').Asset) {
    assert.equal(assetByType.has(asset.$.Type), false, `Duplicate VSIX asset type: ${asset.$.Type}`);
    assetByType.set(asset.$.Type, asset.$);
}
for (const [type, assetPath] of [
    ['Microsoft.VisualStudio.Code.Manifest', 'extension/package.json'],
    ['Microsoft.VisualStudio.Services.Content.Details', 'extension/readme.md'],
    ['Microsoft.VisualStudio.Services.Content.Changelog', 'extension/changelog.md'],
    ['Microsoft.VisualStudio.Services.Content.License', 'extension/LICENSE.txt'],
    ['Microsoft.VisualStudio.Services.Icons.Default', 'extension/media/icon.png']
]) {
    const asset = assetByType.get(type);
    assert.ok(asset, `VSIX missing ${type} asset`);
    assert.equal(asset.Path, assetPath);
    assert.equal(asset.Addressable, 'true');
    assert.ok(vsix.has(assetPath), `VSIX asset path missing: ${assetPath}`);
}

const prefix = `${manifest.name}/`;
for (const entry of [
    `${prefix}package.json`,
    `${prefix}README.md`,
    `${prefix}DESIGN.md`,
    `${prefix}docs/ARCHITECTURE.md`,
    `${prefix}docs/CONFIGURATION.md`,
    `${prefix}docs/PUBLISHING.md`,
    `${prefix}examples/bsv-mini-accelerator/.bsv-arch.json`,
    `${prefix}test/fixtures/bsc-2026.sched`,
    `${prefix}test/view-model.test.js`
]) assert.ok(repository.has(entry), `Repository ZIP missing ${entry}`);
for (const entry of repository.keys()) {
    assert.equal(
        entry.includes('/dist/')
            || entry.includes('/.omo/')
            || entry.includes('/.vscode-test/')
            || entry.includes('/node_modules/'),
        false,
        `Excluded path included in repository ZIP: ${entry}`
    );
}
const repositoryManifest = JSON.parse(repository.get(`${prefix}package.json`).toString('utf8'));
assert.equal(repositoryManifest.version, manifest.version);

const checksumPath = path.join(dist, 'SHA256SUMS.txt');
const checksumLines = fs.readFileSync(checksumPath, 'utf8').trim().split('\n');
assert.deepEqual(
    checksumLines.map((line) => line.slice(66)).sort(),
    [repositoryName, vsixName].sort()
);
for (const line of checksumLines) {
    const match = /^([a-f0-9]{64})  (.+)$/.exec(line);
    assert.ok(match, `Malformed checksum line: ${line}`);
    const actual = crypto.createHash('sha256')
        .update(fs.readFileSync(path.join(dist, match[2])))
        .digest('hex');
    assert.equal(actual, match[1], `Checksum mismatch for ${match[2]}`);
}

console.log(`verify-package: ${vsix.size} VSIX entries, ${repository.size} repository entries, ZIP CRCs valid`);

function readZip(filePath) {
    const archive = fs.readFileSync(filePath);
    const eocd = findEndOfCentralDirectory(archive);
    const entryCount = archive.readUInt16LE(eocd + 10);
    let offset = archive.readUInt32LE(eocd + 16);
    const entries = new Map();
    for (let index = 0; index < entryCount; index += 1) {
        assert.equal(archive.readUInt32LE(offset), 0x02014b50, 'Invalid ZIP central directory');
        const method = archive.readUInt16LE(offset + 10);
        const expectedCrc = archive.readUInt32LE(offset + 16);
        const compressedSize = archive.readUInt32LE(offset + 20);
        const uncompressedSize = archive.readUInt32LE(offset + 24);
        const nameLength = archive.readUInt16LE(offset + 28);
        const extraLength = archive.readUInt16LE(offset + 30);
        const commentLength = archive.readUInt16LE(offset + 32);
        const localOffset = archive.readUInt32LE(offset + 42);
        const name = archive.subarray(offset + 46, offset + 46 + nameLength).toString('utf8');
        const data = readLocalEntry(
            archive,
            localOffset,
            method,
            compressedSize,
            uncompressedSize,
            expectedCrc
        );
        assert.equal(entries.has(name), false, `Duplicate ZIP entry: ${name}`);
        entries.set(name, data);
        offset += 46 + nameLength + extraLength + commentLength;
    }
    return entries;
}

function readLocalEntry(archive, offset, method, compressedSize, uncompressedSize, expectedCrc) {
    assert.equal(archive.readUInt32LE(offset), 0x04034b50, 'Invalid ZIP local header');
    const nameLength = archive.readUInt16LE(offset + 26);
    const extraLength = archive.readUInt16LE(offset + 28);
    const start = offset + 30 + nameLength + extraLength;
    const compressed = archive.subarray(start, start + compressedSize);
    const data = method === 8
        ? zlib.inflateRawSync(compressed)
        : method === 0
            ? Buffer.from(compressed)
            : assert.fail(`Unsupported ZIP method: ${method}`);
    assert.equal(data.length, uncompressedSize, 'ZIP uncompressed size mismatch');
    assert.equal(crc32(data), expectedCrc, 'ZIP CRC mismatch');
    return data;
}

function findEndOfCentralDirectory(archive) {
    const minimum = Math.max(0, archive.length - 0xffff - 22);
    for (let offset = archive.length - 22; offset >= minimum; offset -= 1) {
        if (archive.readUInt32LE(offset) === 0x06054b50) return offset;
    }
    throw new Error('ZIP end-of-central-directory record not found');
}

function parseXml(buffer, label) {
    assert.ok(buffer.length <= 1024 * 1024, `${label} is unexpectedly large`);
    let parsed;
    let parseError;
    new Parser({ strict: true, explicitRoot: true, explicitArray: true })
        .parseString(buffer.toString('utf8'), (error, value) => {
            parseError = error;
            parsed = value;
        });
    assert.ifError(parseError);
    assert.ok(parsed, `${label} did not parse`);
    return parsed;
}

function one(values, label) {
    assert.equal(values?.length, 1, `${label} must occur exactly once`);
    return values[0];
}

module.exports = { readZip };
