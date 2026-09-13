'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { hash } = require('../experiments/hardware/g4/validate-delivery');
const { createRun } = require('../experiments/hardware/g6/run.cjs');
const { copyTestDependencies, counts, changedInputs } = require('../experiments/hardware/g6/core.cjs');
const { verify, validateAllowed } = require('../experiments/hardware/g6/preservation.cjs');
function fixture() {
    const output = createRun('core-evidence-test'), root = path.join(output, 'author'); fs.mkdirSync(root);
    const put = (file, data) => { const target = path.join(root, file); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, data); return target; };
    return { output, root, put };
}
test('Author core copies only declared installed dependency closure with actual byte inventory', () => {
    const { output, root, put } = fixture(), copy = path.join(output, 'copy'); fs.mkdirSync(copy);
    put('package.json', JSON.stringify({ devDependencies: { sample: '1.0.0' } }));
    put('node_modules/sample/package.json', JSON.stringify({ name: 'sample', version: '1.0.0', dependencies: { nested: '2.0.0' }, optionalDependencies: { absent: '1' } }));
    put('node_modules/sample/index.js', 'module.exports = require("nested");');
    put('node_modules/sample/node_modules/nested/package.json', JSON.stringify({ name: 'nested', version: '2.0.0' }));
    put('node_modules/sample/node_modules/nested/index.js', 'module.exports = 2;');
    put('node_modules/unrelated/package.json', JSON.stringify({ name: 'unrelated', version: '3.0.0' }));
    const receipt = copyTestDependencies(root, copy, ['sample']);
    assert.deepEqual(receipt.packages.map(row => [row.name, row.version]), [['sample', '1.0.0'], ['nested', '2.0.0']]);
    assert.equal(require(path.join(copy, 'node_modules/sample')), 2);
    assert.deepEqual(receipt.unavailableOptional, [{ owner: 'sample', name: 'absent' }]);
    assert.equal(fs.existsSync(path.join(copy, 'node_modules/unrelated')), false);
    assert.equal(receipt.files.length, 4); assert.deepEqual(changedInputs(copy, receipt.files), []);
    fs.appendFileSync(path.join(copy, 'node_modules/sample/index.js'), '\n');
    assert.deepEqual(changedInputs(copy, receipt.files), ['node_modules/sample/index.js']);
    assert.throws(() => copyTestDependencies(root, path.join(output, 'forbidden'), ['unrelated']), /Undeclared/);
});
test('G6 baseline permits exact runtime files while retaining historical content and run metadata', async () => {
    const { output, root, put } = fixture();
    const product = put('src/example.js', 'original runtime'), protectedFile = put('docs/hardware/evidence/prior.json', 'original evidence');
    const oldRun = put('.build/hardware/runs/prior/result.json', 'original raw result');
    put('source-link', 'placeholder'); fs.unlinkSync(path.join(root, 'source-link')); fs.symlinkSync('src/example.js', path.join(root, 'source-link'));
    const entries = ['src/example.js', 'docs/hardware/evidence/prior.json'].map(name => {
        const bytes = fs.readFileSync(path.join(root, name)); return { path: name, kind: 'file', bytes: bytes.length, sha256: hash(bytes) };
    }).concat([{ path: 'source-link', kind: 'symlink', target: 'src/example.js' }]);
    const stat = fs.statSync(oldRun), historical = { schema: 'g6-historical-run-metadata-v1', files: [
        { path: '.build/hardware/runs/prior/result.json', bytes: stat.size, mtimeMs: stat.mtimeMs, kind: 'file' }] };
    const bytes = Buffer.from(JSON.stringify(historical)); fs.writeFileSync(path.join(output, 'historical.json'), bytes);
    const baseline = { schema: 'g6-baseline-v1', entries, fingerprint: hash(JSON.stringify(entries)), historicalRuns: {
        file: 'historical.json', count: 1, sha256: hash(bytes) } };
    const baselineFile = path.join(output, 'baseline.json'); fs.writeFileSync(baselineFile, JSON.stringify(baseline));
    const run = () => { const directory = fs.mkdtempSync(path.join(output, 'verification-')); return verify(baselineFile, ['src/example.js'], { root, output: directory }); };
    fs.writeFileSync(product, 'new runtime');
    const receipt = await run(); assert.equal(receipt.status, 'pass'); assert.equal(receipt.changes.length, 1); assert.equal(receipt.historicalRuns.unchanged, 1);
    assert.throws(() => validateAllowed(['docs/hardware/evidence/prior.json'], entries), /Protected input/);
    assert.throws(() => validateAllowed(['src/*'], entries), /existing baseline file/);
    assert.throws(() => validateAllowed(['src/example.js', 'src/example.js'], entries), /Duplicate/);
    fs.appendFileSync(protectedFile, ' changed'); await assert.rejects(run(), /baseline preservation failed/);
    fs.writeFileSync(protectedFile, 'original evidence'); fs.appendFileSync(oldRun, ' changed'); await assert.rejects(run(), /baseline preservation failed/);
});
test('Core aggregate reports actual TAP counters and explicit absent counters', () => {
    assert.deepEqual(counts('# tests 3\n# pass 1\n# fail 1\n# skipped 1\n# cancelled 0'), { tests: 3, pass: 1, fail: 1, skipped: 1, cancelled: 0 });
    assert.deepEqual(counts('load error'), { tests: -1, pass: -1, fail: -1, skipped: -1, cancelled: -1 });
});
