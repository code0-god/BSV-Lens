'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { manifestBytes, inventoryFromEntries, installerDelta, assertRuntimeMatch, harnessInventory } = require('./native-runtime.cjs');

const manifest = { name: 'bsv-lens', publisher: 'code0-god', version: '0.4.1',
    contributes: { commands: [{ command: 'bsvArchitecture.openHardwareSchematic', title: 'Hardware' }, { command: 'legacy', title: 'Legacy' }] },
    dependencies: { z: '2', a: '1' }, nested: { __metadata: 'meaningful nested value', z: 1, a: 2 } };
const source = Buffer.from(JSON.stringify(manifest, null, 2));
const inventory = (bytes, script = 'runtime') => inventoryFromEntries([
    { path: 'package.json', bytes }, { path: 'src/extension.js', bytes: Buffer.from(script) }
], 'test-only');

test('installer formatting, recursive key order, and only top-level metadata are accepted', () => {
    const installed = Buffer.from(JSON.stringify({ nested: { a: 2, z: 1, __metadata: 'meaningful nested value' },
        dependencies: { a: '1', z: '2' }, contributes: manifest.contributes, version: '0.4.1', publisher: 'code0-god', name: 'bsv-lens',
        __metadata: { installedTimestamp: 1, targetPlatform: 'undefined', size: 123 } }));
    const expected = inventory(source), actual = inventory(installed), delta = installerDelta(source, installed);
    assert.notEqual(actual.rawFingerprint, expected.rawFingerprint);
    assert.equal(actual.fingerprint, expected.fingerprint);
    assert.deepEqual(delta.changedTopLevel.map(item => item.key), ['__metadata']);
    assertRuntimeMatch(expected, actual, delta);
    assert.match(manifestBytes(installed).toString(), /"nested":\{"__metadata":"meaningful nested value","a":2,"z":1\}/);
});
for (const [name, change] of [
    ['command', value => { value.contributes.commands[0].command = 'injected.command'; }],
    ['version', value => { value.version = '0.4.2'; }],
    ['dependency', value => { value.dependencies.a = 'malicious'; }],
    ['publisher', value => { value.publisher = 'another-publisher'; }],
    ['nested metadata', value => { value.nested.__metadata = 'changed'; }],
    ['array ordering', value => { value.contributes.commands.reverse(); }]
]) test(`installer ${name} tampering is rejected`, () => {
    const changed = structuredClone(manifest); change(changed); changed.__metadata = { installedTimestamp: 1 };
    const bytes = Buffer.from(JSON.stringify(changed));
    assert.throws(() => assertRuntimeMatch(inventory(source), inventory(bytes), installerDelta(source, bytes)));
});
test('non-manifest runtime changes remain raw-byte failures', () => {
    assert.throws(() => assertRuntimeMatch(inventory(source), inventory(source, 'changed runtime'), installerDelta(source, source)), /Non-manifest runtime bytes changed/);
});
test('explicit helper changes invalidate raw harness identity', () => {
    const directory = require('./run.cjs').createRun('harness-change');
    const helper = path.join(directory, 'test-only-helper.cjs');
    fs.writeFileSync(helper, 'module.exports = 1;\n', { flag: 'wx' });
    const before = harnessInventory([helper]);
    fs.writeFileSync(helper, 'module.exports = 2;\n');
    const after = harnessInventory([helper]);
    assert.notEqual(before.rawFingerprint, after.rawFingerprint);
    const relative = path.relative(path.resolve(__dirname, '../../..'), helper);
    assert.notEqual(before.rawFiles.find(file => file.path === relative).sha256, after.rawFiles.find(file => file.path === relative).sha256);
});
