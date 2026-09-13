'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { spawnSync } = require('node:child_process');
const { collectFiles, writeZip } = require('../../../scripts/zip');
const delivery = require('./validate-delivery');
const root = path.resolve(__dirname, '../../..');
const packager = path.join(root, 'experiments/hardware/package-review.js');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');

function packageEntries(sourceOnly, omit) {
    let result;
    // Execute the real collector, exclusion and validation paths without touching dist.
    // Only unfinished prose is substituted; runtime/evidence/tests remain actual bytes.
    const modules = {
        'node:fs': { ...fs, statSync: file => file.endsWith('/G3_REPORT.md') ? { isFile: () => true } : fs.statSync(file),
            readFileSync: (file, ...args) => file.endsWith('.zip') ? Buffer.from('test zip placeholder') : fs.readFileSync(file, ...args),
            writeFileSync() {} },
        'node:child_process': { execFileSync() {} },
        './g3/validate-delivery': { ...delivery, assertNewOutput() {} },
        '../../scripts/zip': {
            collectFiles: (directory, options) => {
                const entries = collectFiles(directory, options).filter(entry => entry.name !== 'bsv-lens/docs/hardware/G3_REPORT.md');
                entries.push({ name: 'bsv-lens/docs/hardware/G3_REPORT.md', data: Buffer.from('Test-only report; not a final delivery.') });
                return entries.filter(entry => entry.name !== `bsv-lens/${omit}`);
            },
            writeZip: (_output, entries) => { result = entries; return { entries: entries.length, bytes: 0 }; }
        }
    };
    vm.runInNewContext(fs.readFileSync(packager, 'utf8'), {
        __dirname: path.dirname(packager), Buffer, console: { log() {} },
        process: { argv: ['node', packager, '--g3', ...(sourceOnly ? ['--source'] : [])] },
        require: name => modules[name] || createRequire(packager)(name)
    });
    return result;
}

function saveArchive(file, entries) {
    writeZip(file, entries);
    fs.writeFileSync(`${file}.sha256`, `${hash(fs.readFileSync(file))}  ${path.basename(file)}\n`);
}

for (const sourceOnly of [false, true]) test(`G3 ${sourceOnly ? 'Source' : 'review'} rejects missing origin inputs before writing`, () => {
    for (const missing of ['src/hardware/correspondence/origin-worker.js', 'experiments/hardware/g3/origin-query.js',
        'docs/hardware/evidence/g3-origin-ghc96/patches/final-bsc-origin.patch',
        'docs/hardware/evidence/g3-origin-ghc96/receipts/instrumented-compile-final.log']) {
        assert.throws(() => packageEntries(sourceOnly, missing), error => error.message.includes(`Missing G3 delivery member: ${missing}`));
    }
});

test('G3 member validation rejects tampering, hidden dependencies, traversal, and Source history', () => {
    const entries = packageEntries(true);
    assert.throws(() => delivery.validateEntries(entries, false), /Missing G3 delivery member: \.build/);
    const tampered = entries.map(entry => entry.name.endsWith('/origin-worker.js') ? { ...entry, data: Buffer.from('changed') } : entry);
    assert.throws(() => delivery.validateEntries(tampered, true), /Runtime bytes differ/);
    const evidence = entries.map(entry => entry.name.endsWith('/patches/final-bsc-origin.patch') ? { ...entry, data: Buffer.from('changed') } : entry);
    assert.throws(() => delivery.validateEntries(evidence, true), /Delivery input SHA mismatch/);
    for (const name of ['node_modules/hidden/index.js', 'tools/bsc', 'profiles/Default/Cookies', '.env', '.aws/credentials']) {
        assert.throws(() => delivery.validateEntries([...entries, { name: `bsv-lens/${name}`, data: '' }], true), /Forbidden delivery member/);
    }
    assert.throws(() => delivery.validateEntries([...entries, { name: 'bsv-lens/../escaped', data: '' }], true), /Unsafe delivery path/);
    assert.throws(() => delivery.validateEntries([...entries, entries[0]], true), /Duplicate delivery member/);
    assert.throws(() => delivery.validateEntries([...entries, { name: 'bsv-lens/.build/hardware/g3-a/CHECKPOINT.json', data: '' }], true), /Source archive contains/);
});

for (const mode of ['build', 'validate-only']) test(`${mode}: both temporary archives replay public APIs, tests, and strict author failure`, { timeout: 360000 }, t => {
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'bsv-g3-harness-test-'));
    t.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
    const workspace = mode === 'build' ? path.join(temporary, 'workspace') : root;
    const archives = ['review', 'source'].map(kind => mode === 'build'
        ? path.join(workspace, 'dist', `bsv-lens-hardware-g3-${kind}.zip`) : path.join(temporary, `${kind}.zip`));
    const review = packageEntries(false), source = packageEntries(true);
    assert.ok(review.some(entry => entry.name.startsWith('bsv-lens/.build/')));
    assert.ok(source.every(entry => !entry.name.startsWith('bsv-lens/.build/')));
    if (mode === 'build') {
        for (const entry of review) {
            const file = path.join(workspace, entry.name.slice('bsv-lens/'.length));
            fs.mkdirSync(path.dirname(file), { recursive: true });
            fs.writeFileSync(file, entry.data);
        }
    } else { saveArchive(archives[0], review); saveArchive(archives[1], source); }
    // Both real CLI modes operate only on disposable archives, never final dist.
    const args = ['--no-global-search-paths', 'experiments/hardware/g3/validate-delivery.js',
        ...(mode === 'validate-only' ? ['--validate-only', ...archives] : [])];
    const result = spawnSync(process.execPath, args, { cwd: workspace, encoding: 'utf8', timeout: 330000, maxBuffer: 16 * 1024 * 1024 });
    const evidence = path.join(os.tmpdir(), `st_01a07cb2-${mode}-harness-cli.json`);
    fs.writeFileSync(evidence, JSON.stringify({ executable: process.execPath, args,
        cwd: workspace, exit: result.status, stdout: result.stdout, stderr: result.stderr }, null, 2));
    for (const [index, archive] of archives.entries()) {
        if (fs.existsSync(`${archive}.validation.json`)) fs.copyFileSync(`${archive}.validation.json`,
            path.join(os.tmpdir(), `st_01a07cb2-${mode}-${index ? 'source' : 'review'}.validation.json`));
    }
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const receipts = archives.map(archive => JSON.parse(fs.readFileSync(`${archive}.validation.json`, 'utf8')));
    for (const receipt of receipts) {
        assert.equal(receipt.status, 'pass'); assert.equal(receipt.crc, 'pass');
        assert.equal(receipt.shippedOffline, 'pass'); assert.equal(receipt.liveCompilerReplay, 'not-run');
        assert.equal(receipt.authorPreservation.exit, 1); assert.equal(receipt.authorPreservation.missing.length, 14);
        assert.equal(receipt.runtimeWorkspaceEquality, true);
        assert.ok(receipt.commands.every(command => command.exit === command.expectedExit));
        assert.equal(fs.existsSync(receipt.isolation.freshEmptyExtraction), false);
        assert.throws(() => delivery.assertNewOutput(receipt.archive), /Refusing to overwrite prior delivery/);
    }
    assert.deepEqual(receipts[0].members.runtime, receipts[1].members.runtime);
    assert.equal(receipts[1].runtimeReviewEquality, true);
    assert.notEqual(receipts[0].isolation.freshEmptyExtraction, receipts[1].isolation.freshEmptyExtraction);
    const expected = receipts[0].authorPreservation.missing;
    const author = receipts[0].commands.find(command => command.args.includes('experiments/hardware/bsv-evidence/check_author.py'));
    assert.throws(() => delivery.checkAuthor({ ...author, stderr: author.stderr.replace(expected[0] + '\n', '') }, expected), /exactly the 14/);
    assert.throws(() => delivery.checkAuthor({ ...author, exit: 0 }, expected));
});

test('validation records SHA and CRC failures without running extracted code', t => {
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'bsv-g3-corruption-'));
    t.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
    for (const kind of ['sha', 'crc', 'traversal', 'symlink']) {
        const archive = path.join(temporary, `${kind}.zip`);
        saveArchive(archive, [{ name: kind === 'traversal' ? 'bsv-lens/../escape' : 'bsv-lens/file',
            data: 'test-data', ...(kind === 'symlink' ? { mode: 0o120777 } : {}) }]);
        if (kind === 'sha') fs.appendFileSync(archive, 'changed');
        if (kind === 'crc') {
            const bytes = fs.readFileSync(archive); bytes[30 + Buffer.byteLength('bsv-lens/file')] ^= 0xff;
            fs.writeFileSync(archive, bytes);
            fs.writeFileSync(`${archive}.sha256`, `${hash(bytes)}  ${path.basename(archive)}\n`);
        }
        assert.throws(() => delivery.validateDelivery({ archives: [archive, path.join(temporary, 'unused.zip')] }));
        const receipt = JSON.parse(fs.readFileSync(`${archive}.validation.json`, 'utf8'));
        assert.equal(receipt.status, 'fail');
        assert.equal(receipt.commands.length, kind === 'sha' ? 0 : 1);
        assert.equal(receipt.members, undefined);
    }
});
