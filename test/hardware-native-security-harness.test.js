'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRun } = require('../experiments/hardware/g6/run.cjs');
const { prepare, retain, verifyInventory, digest } = require('../experiments/hardware/g6/native-security-inputs.cjs');
const { loadNativeInput } = require('../src/hardware/native-input');

function fixture(output) {
    const workspace = path.join(output, 'original-controlled-inputs'); fs.mkdirSync(workspace);
    const source = 'package Security; module mkSecurity(Empty); endmodule endpackage';
    const artifact = JSON.stringify({ modules: { mkSecurity: { attributes: { top: '1' }, ports: {}, cells: {}, netnames: {} } } });
    const inventory = [['Source.bsv', source], ['design.json', artifact]].map(([relative, value]) => {
        fs.writeFileSync(path.join(workspace, relative), value, { flag: 'wx' });
        return { path: relative, bytes: Buffer.byteLength(value), sha256: digest(value) };
    });
    const manifest = { version: 1, sources: [{ path: 'Source.bsv', pathRef: 'original/Source.bsv', contentHash: digest(source) }],
        artifact: { path: 'design.json', contentHash: digest(artifact) }, origin: { deliberatelyNotNativeInput: 'stripped by stock-only security fixture' } };
    const fixturePath = path.join(output, 'original-fixtures.json');
    fs.writeFileSync(fixturePath, JSON.stringify({ schema: 'g6-native-fixtures-v1', status: 'pass', workspace, inventory,
        fixtures: { A: { key: 'A', artifact: path.join(workspace, 'design.json'), manifest,
            sourceFiles: [{ path: path.join(workspace, 'Source.bsv'), pathRef: 'original/Source.bsv', contentHash: digest(source) }] } } }), { flag: 'wx' });
    return { fixturePath, workspace, inventory };
}

test('native security fixture preparation confines destructive cases to separate copied inputs', async t => {
    const output = createRun('security-harness-contract'), original = fixture(output), inputs = prepare(original.fixturePath, output);
    const relative = path.relative(path.resolve(__dirname, '..'), inputs.privateRoot);
    assert.ok(relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative));
    assert.deepEqual(JSON.parse(fs.readFileSync(inputs.workspaceFile)), { folders: [
        { path: path.basename(inputs.workspace) }, { path: path.basename(inputs.secondWorkspace) }] });
    t.diagnostic(`Security fixture preparation: ${output}`);
    assert.equal(verifyInventory(original.workspace, original.inventory), true);
    assert.equal(verifyInventory(inputs.workspace, original.inventory), true);
    assert.equal(inputs.fixtures.A.manifest.origin, undefined);
    assert.equal(inputs.mutation.manifest.sources[0].pathRef, 'original/Source.bsv');
    assert.ok(inputs.mutation.sourceFiles[0].path.startsWith(path.join(inputs.workspace, 'mutation')));
    const originalSource = fs.readFileSync(inputs.mutation.sourceFiles[0].path);
    fs.appendFileSync(inputs.mutation.sourceFiles[0].path, '\n// isolated mutation');
    assert.equal(verifyInventory(original.workspace, original.inventory), true);
    assert.equal(verifyInventory(inputs.workspace, original.inventory), true);
    fs.writeFileSync(inputs.mutation.sourceFiles[0].path, originalSource);
    const loaded = await loadNativeInput({ sourceRoot: inputs.workspace, artifactRoot: inputs.workspace, manifest: inputs.mutation.manifest });
    assert.equal(loaded.summary.status, 'source-and-artifact'); assert.equal(loaded.sources[0].path, inputs.mutation.sourceFiles[0].path);
    const synthetic = await loadNativeInput({ sourceRoot: inputs.workspace, artifactRoot: inputs.workspace, manifest: inputs.synthetic.manifest });
    assert.equal(synthetic.summary.status, 'source-only'); assert.equal(synthetic.summary.compilerExecuted, false);
    assert.match(synthetic.sources[0].capturedText, /<svg onload=/);
    await assert.rejects(loadNativeInput({ sourceRoot: path.join(inputs.workspace, 'source-escape'), artifactRoot: inputs.workspace,
        rootGrants: { sourceRoot: { path: path.join(inputs.workspace, 'source-escape'), dev: 0, ino: 0 } } }), { code: 'PATH_DENIED' });
    const retained = retain(inputs, output);
    assert.equal(retained.retainedCapturedPreserved, true);
    assert.equal(retained.validatedWorkspace, inputs.workspace);
    assert.ok(retained.retainedRoot.startsWith(output));
    assert.equal(fs.lstatSync(path.join(retained.retainedWorkspace, 'source-escape')).isSymbolicLink(), true);
});

test('native security fixture preparation rejects changed original bytes before any copy', () => {
    const output = createRun('security-harness-rejection'), original = fixture(output);
    fs.appendFileSync(path.join(original.workspace, 'Source.bsv'), '\n// deliberately corrupt isolated contract input');
    assert.throws(() => prepare(original.fixturePath, output), /Original fixture inventory differs/);
    assert.equal(fs.existsSync(path.join(output, 'security-workspace')), false);
});
