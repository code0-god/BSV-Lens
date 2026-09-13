'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const NORMALIZATION = 'canonical-json-without-vscode-metadata';

function canonicalJson(value) {
    if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
    if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
    return JSON.stringify(value);
}
function manifestBytes(bytes) {
    const value = JSON.parse(bytes.toString('utf8'));
    assert.ok(value && typeof value === 'object' && !Array.isArray(value), 'Extension manifest must be an object');
    return Buffer.from(`{${Object.keys(value).filter(key => key !== '__metadata').sort()
        .map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`);
}
function inventoryFromEntries(entries, scope) {
    const rawFiles = [], files = [], seen = new Set();
    for (const { path: relative, bytes } of entries) {
        assert.ok(!seen.has(relative), `Duplicate runtime path: ${relative}`); seen.add(relative);
        const raw = { path: relative, bytes: bytes.length, sha256: digest(bytes) }; rawFiles.push(raw);
        if (relative === 'package.json') {
            const canonical = manifestBytes(bytes);
            files.push({ path: relative, bytes: canonical.length, sha256: digest(canonical), normalization: NORMALIZATION });
        } else files.push(raw);
    }
    const sorted = (a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
    files.sort(sorted); rawFiles.sort(sorted);
    return { scope, algorithm: 'sha256(JSON.stringify(path-sorted inventory rows)); package.json uses explicit canonical normalization',
        files, fingerprint: digest(JSON.stringify(files)), rawFiles, rawFingerprint: digest(JSON.stringify(rawFiles)) };
}
function installerDelta(archivedBytes, installedBytes) {
    const archived = JSON.parse(archivedBytes), installed = JSON.parse(installedBytes);
    const keys = [...new Set([...Object.keys(archived), ...Object.keys(installed)])].sort();
    const changed = keys.filter(key => Object.hasOwn(archived, key) !== Object.hasOwn(installed, key)
        || canonicalJson(archived[key]) !== canonicalJson(installed[key]));
    return { normalization: NORMALIZATION, archiveRawSha256: digest(archivedBytes), installedRawSha256: digest(installedBytes),
        rawBytesEqual: archivedBytes.equals(installedBytes), onlyMetadataOrFormatting: changed.every(key => key === '__metadata'),
        changedTopLevel: changed.map(key => ({ key, archivePresent: Object.hasOwn(archived, key), installedPresent: Object.hasOwn(installed, key),
            archive: archived[key] ?? null, installed: installed[key] ?? null })) };
}
function assertRuntimeMatch(archived, installed, delta) {
    assert.deepEqual(installed.rawFiles.filter(file => file.path !== 'package.json'), archived.rawFiles.filter(file => file.path !== 'package.json'), 'Non-manifest runtime bytes changed');
    assert.equal(delta.onlyMetadataOrFormatting, true, 'Installer changed semantic manifest fields');
    assert.deepEqual(installed.files, archived.files, 'Canonical installed runtime differs from delivered VSIX');
}
function harnessInventory(extraFiles = []) {
    assert.ok(Array.isArray(extraFiles) && extraFiles.every(file => typeof file === 'string'), 'Harness paths must be an explicit string array');
    const root = path.resolve(__dirname, '../../..');
    const local = ['native-driver.cjs', 'native-channel.cjs', 'native-runtime.cjs', 'observer-vsix.cjs', 'observer/index.js', 'observer/package.json',
        'observer/editor-column.cjs', 'development-smoke.cjs', 'installed-smoke.cjs', 'native-acceptance-run.cjs', 'native-acceptance.cjs', 'native-oracle.cjs'];
    const names = [...new Set([...local.map(file => path.join(__dirname, file)).filter(file => fs.existsSync(file)),
        ...extraFiles.map(file => path.resolve(file)), ...(process.argv[1] ? [path.resolve(process.argv[1])] : [])])];
    const entries = names.map(file => {
        assert.ok(fs.lstatSync(file).isFile(), `Harness path is not a regular file: ${file}`);
        return { path: path.relative(root, file).split(path.sep).join('/'), bytes: fs.readFileSync(file) };
    });
    return inventoryFromEntries(entries, 'Test harness sources only; raw byte fingerprint; explicit caller helpers included');
}

function runtimeInventory(root, includeDependencies = true) {
    const entries = [];
    function visit(file) {
        const stat = fs.lstatSync(file);
        assert.ok(!stat.isSymbolicLink(), `Runtime symlink is unexpected: ${file}`);
        if (stat.isDirectory()) for (const name of fs.readdirSync(file).sort()) visit(path.join(file, name));
        else if (stat.isFile()) entries.push({ path: path.relative(root, file).split(path.sep).join('/'), bytes: fs.readFileSync(file) });
    }
    for (const name of ['package.json', 'src', 'media', ...(includeDependencies ? ['node_modules'] : [])]) {
        if (fs.existsSync(path.join(root, name))) visit(path.join(root, name));
    }
    return inventoryFromEntries(entries, `package.json/src/media${includeDependencies ? '/installed-node_modules' : '; development dependencies excluded'}`);
}
module.exports = { runtimeInventory, inventoryFromEntries, manifestBytes, canonicalJson, installerDelta, assertRuntimeMatch, harnessInventory, NORMALIZATION };
