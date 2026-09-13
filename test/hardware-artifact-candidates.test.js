'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { hash } = require('../src/hardware/json');
const { grantDirectory } = require('../src/panel/hardware-authority');
const { discoverArtifactCandidates, ARTIFACT_CANDIDATE_LIMITS: limits } = require('../src/panel/hardware-artifact-candidates');
const { loadNativeInput } = require('../src/hardware/native-input');
const synthetic = JSON.stringify({ creator: 'synthetic-candidate-test', modules: {
    Independent: { attributes: { top: '1' }, ports: {}, cells: {}, netnames: {} }
} });

async function sandbox(t) {
    const runs = path.resolve(__dirname, '../.build/hardware/runs'); await fs.mkdir(runs, { recursive: true });
    const run = await fs.mkdtemp(path.join(runs, 'g6-usability-artifact-'));
    const root = path.join(run, 'g6-usability'); await fs.mkdir(root);
    const output = path.join(root, 'outputs'); await fs.mkdir(output);
    t.diagnostic(`artifact candidate fixture: ${root}`);
    return { root, output, grant: await grantDirectory(output) };
}

test('R02/R04 captured A/B/C remain separate, hash-bound format candidates without import or source joins', async t => {
    const { output, grant } = await sandbox(t), expected = new Map();
    for (const [index, label] of ['A', 'B', 'C'].entries()) {
        const input = path.resolve(__dirname, `../docs/hardware/evidence/toolchain/${label}/design.json`);
        const bytes = await fs.readFile(input), relative = `${['build', 'dist', 'vendor'][index]}/design-${index}.json`;
        await fs.mkdir(path.dirname(path.join(output, relative)), { recursive: true });
        await fs.writeFile(path.join(output, relative), bytes);
        expected.set(relative, { contentHash: hash(bytes), bytes: bytes.length, modules: Object.keys(JSON.parse(bytes).modules).sort() });
    }
    const result = await discoverArtifactCandidates({ grant });
    assert.equal(result.status, 'complete'); assert.equal(result.candidates.length, 3); assert.deepEqual(result.rejected, []);
    for (const candidate of result.candidates) {
        const original = expected.get(candidate.path);
        assert.equal(candidate.contentHash, original.contentHash); assert.equal(candidate.bytes, original.bytes);
        assert.deepEqual(candidate.modules, original.modules); assert.equal(candidate.verification, 'format-only');
        assert.equal(candidate.correspondence, 'not-established'); assert.equal(candidate.sourceRevision, null);
        assert.equal(candidate.buildRevision, null); assert.equal(candidate.freshness, 'unknown');
    }
    assert.equal(result.automaticallySelected, null); assert.equal(result.importExecuted, false);
    assert.equal(result.compilerExecuted, false); assert.equal(result.sourceJoinPerformed, false);
});

test('R03/R06/R07 malformed, hostile, unrelated JSON and executable strings do not affect valid source analysis', async t => {
    const { root, output, grant } = await sandbox(t);
    const sourceRoot = path.join(root, 'source'); await fs.mkdir(sourceRoot);
    await fs.writeFile(path.join(sourceRoot, 'Real.bsv'), 'package Real; module mkReal(Empty); endmodule endpackage');
    const source = await loadNativeInput({ sourceRoot }), before = source.inputIdentity;
    await fs.writeFile(path.join(output, 'valid.json'), synthetic);
    for (const [name, content] of Object.entries({
        'malformed.json': '{"modules":', 'hostile.json': '{"__proto__":{"escaped":true},"modules":{"X":{"ports":{}}}}',
        'package.json': JSON.stringify({ scripts: { scan: `touch ${root}/executed` } }),
        'tasks.json': JSON.stringify({ tasks: [{ command: `touch ${root}/executed` }] }),
        'receipt.json': '{"modules":["a","b"]}', 'wrong-fields.json': '{"modules":{"X":{"ports":[]}}}',
        'Makefile': `all:\n\ttouch ${root}/executed\n`
    })) await fs.writeFile(path.join(output, name), content);
    const result = await discoverArtifactCandidates({ grant });
    assert.equal(result.candidates.length, 1); assert.equal(result.rejected.length, 6);
    assert.ok(result.rejected.every(item => ['UNSUPPORTED', 'INVALID_INPUT'].includes(item.code)));
    assert.equal(result.skippedFiles, 1); assert.equal(Object.prototype.escaped, undefined);
    assert.equal(source.inputIdentity, before); assert.equal(source.summary.status, 'source-only');
    assert.equal((await loadNativeInput({ sourceRoot })).inputIdentity, before);
    await assert.rejects(fs.access(path.join(root, 'executed')), { code: 'ENOENT' });
});

test('R05 candidate freshness is unknown and later explicit import rejects changed bytes', async t => {
    const { output, grant } = await sandbox(t);
    await fs.writeFile(path.join(output, 'same-name.json'), synthetic);
    const { candidates: [candidate] } = await discoverArtifactCandidates({ grant, paths: ['same-name.json', 'same-name.json'] });
    assert.equal(candidate.sourceRevision, null); assert.equal(candidate.buildRevision, null);
    await fs.writeFile(path.join(output, candidate.path), synthetic + '\n');
    await assert.rejects(loadNativeInput({ artifactRoot: grant.path, rootGrants: { artifactRoot: grant },
        manifest: { version: 1, artifact: { path: candidate.path, contentHash: candidate.contentHash } } }), { code: 'ARTIFACT_HASH_MISMATCH' });
});

test('selected manifest paths restrict candidate discovery; missing authority and traversal never grant reads', async t => {
    const { output, grant } = await sandbox(t);
    await fs.writeFile(path.join(output, 'chosen.json'), synthetic);
    await fs.writeFile(path.join(output, 'unrelated.json'), synthetic);
    assert.deepEqual((await discoverArtifactCandidates({ grant, paths: ['chosen.json'] })).candidates.map(item => item.path), ['chosen.json']);
    assert.equal((await discoverArtifactCandidates({ grant, paths: [] })).candidates.length, 0);
    await assert.rejects(discoverArtifactCandidates(), { code: 'PATH_DENIED' });
    await assert.rejects(discoverArtifactCandidates({ grant, paths: ['../outside.json'] }), { code: 'INVALID_INPUT' });
    await assert.rejects(discoverArtifactCandidates({ grant, paths: [path.join(output, 'chosen.json')] }), { code: 'INVALID_INPUT' });
    await assert.rejects(discoverArtifactCandidates({ grant, signal: {} }), { code: 'INVALID_INPUT' });
});

test('candidate symlinks are rejected and pinned root replacement cannot become read authority', async t => {
    const { root, output, grant } = await sandbox(t), outside = path.join(root, 'outside'); await fs.mkdir(outside);
    await fs.writeFile(path.join(outside, 'private.json'), synthetic);
    await fs.writeFile(path.join(output, 'valid.json'), synthetic);
    await fs.symlink(path.join(outside, 'private.json'), path.join(output, 'escape.json'));
    await fs.symlink(outside, path.join(output, 'escape-folder'));
    const result = await discoverArtifactCandidates({ grant });
    assert.deepEqual(result.candidates.map(item => item.path), ['valid.json']);
    assert.equal(result.rejected.length, 2); assert.ok(result.rejected.every(item => item.code === 'PATH_DENIED'));
    const explicit = await discoverArtifactCandidates({ grant, paths: ['escape-folder/private.json'] });
    assert.equal(explicit.candidates.length, 0); assert.equal(explicit.rejected[0].code, 'PATH_DENIED');
    await fs.rename(output, `${output}-approved`); await fs.symlink(outside, output);
    await assert.rejects(discoverArtifactCandidates({ grant }), { code: 'PATH_DENIED' });
});

test('candidate file, byte, hierarchy and JSON limits report incomplete discovery without a fake winner', async t => {
    const { output, grant } = await sandbox(t);
    await fs.writeFile(path.join(output, 'oversized.json'), ' '.repeat(limits.maxFileBytes + 1));
    await fs.writeFile(path.join(output, 'deep.json'), '['.repeat(limits.maxJsonDepth + 2) + '0' + ']'.repeat(limits.maxJsonDepth + 2));
    for (let index = 0; index < limits.maxFiles + 1; index++) await fs.writeFile(path.join(output, `candidate-${String(index).padStart(3, '0')}.json`), synthetic);
    const result = await discoverArtifactCandidates({ grant });
    assert.equal(result.status, 'partial'); assert.ok(result.limitedReasons.includes('file-limit'));
    assert.equal(result.inspectedFiles, limits.maxFiles); assert.equal(result.automaticallySelected, null);
    const selected = await discoverArtifactCandidates({ grant, paths: ['oversized.json', 'deep.json'] });
    assert.equal(selected.status, 'partial'); assert.equal(selected.candidates.length, 0);
    assert.ok(selected.rejected.every(item => item.code === 'LIMIT_EXCEEDED'));
    const deepPath = Array.from({ length: limits.maxDepth + 1 }, (_, index) => `level${index}`).join('/');
    const nestedRoot = path.join(output, 'nested'); await fs.mkdir(path.join(nestedRoot, deepPath), { recursive: true });
    await fs.writeFile(path.join(nestedRoot, deepPath, 'design.json'), synthetic);
    const nested = await discoverArtifactCandidates({ grant: await grantDirectory(nestedRoot) });
    assert.equal(nested.status, 'partial'); assert.ok(nested.limitedReasons.includes('depth-limit'));
    const largeRoot = path.join(output, 'large'); await fs.mkdir(largeRoot);
    const large = JSON.stringify({ description: 'x'.repeat(limits.maxFileBytes - 256), ...JSON.parse(synthetic) });
    for (let index = 0; index < 5; index++) await fs.writeFile(path.join(largeRoot, `${index}.json`), large);
    const byteLimited = await discoverArtifactCandidates({ grant: await grantDirectory(largeRoot) });
    assert.equal(byteLimited.status, 'partial'); assert.ok(byteLimited.limitedReasons.includes('byte-limit'));
    assert.ok(byteLimited.bytesRead <= limits.maxTotalBytes);
});

test('cache/evidence directories are excluded, cancelled requests settle without candidates', async t => {
    const { output, grant } = await sandbox(t);
    for (const directory of ['.git', 'node_modules', '.build', '.vscode-test']) {
        await fs.mkdir(path.join(output, directory)); await fs.writeFile(path.join(output, directory, 'design.json'), synthetic);
    }
    const result = await discoverArtifactCandidates({ grant });
    assert.equal(result.status, 'complete'); assert.equal(result.candidates.length, 0); assert.equal(result.exclusions.length, 4);
    const controller = new AbortController(); controller.abort();
    await assert.rejects(discoverArtifactCandidates({ grant, signal: controller.signal }), { code: 'CANCELLED' });
});
