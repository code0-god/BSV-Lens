'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const { collectFiles, writeZip } = require('../scripts/zip');
const { hash, assertNewOutput } = require('../experiments/hardware/g4/validate-delivery');
const { validateEvidence, validateEntries, tracePath, semantic, extraction, replayEntries } = require('../experiments/hardware/g5/validate-review.cjs');
const { archiveNames, collectEntries } = require('../experiments/hardware/g5/package-review.cjs');
const root = path.resolve(__dirname, '..');
test('G5 delivery cannot pass without indexed actual queries and browser evidence', () => {
    assert.throws(() => validateEvidence([]), /Missing G5 evidence indexes/);
});

test('fresh replay outputs stay separate while shipped evidence mutations remain invalid', () => {
    const { entries } = fixture();
    const generated = { name: 'bsv-lens/.build/hardware/runs/correspondence-new/cancellation.json', data: Buffer.from('{}') };
    assert.throws(() => validateEntries([...entries, generated], true, root), /Archive contains replay-only output/);
    assert.deepEqual(replayEntries([...entries, generated]), entries);
    const expected = validateEvidence(entries);
    assert.deepEqual(validateEvidence(replayEntries([...entries, generated])), expected);
    const changed = entries.map((entry, i) => i ? entry : { ...entry, data: Buffer.from('changed') });
    assert.throws(() => validateEvidence(replayEntries([...changed, generated])), /G5 size mismatch|G5 SHA mismatch/);
    assert.throws(() => validateEvidence(replayEntries([...entries.slice(1), generated])), /Missing G5 reference/);
    for (const name of ['bsv-lens/.build/hardware/other.json', 'bsv-lens/.build/hardware/runs-copy/file.json',
        'bsv-lens/src/new.js', 'bsv-lens/docs/new.json']) {
        const entry = { name, data: Buffer.from('{}') };
        assert.deepEqual(replayEntries([entry]), [entry]);
    }
});

test('actual ZIP metadata exceeding total or member limits rejects before extraction', t => {
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'g5-extraction-bounds-'));
    t.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
    for (const [count, size, code] of [[13, 64 * 1024 * 1024, 'ARCHIVE_TOTAL_SIZE'],
        [1, 65 * 1024 * 1024, 'ARCHIVE_MEMBER_SIZE']]) {
        const archive = path.join(temporary, `${code}.zip`), destination = path.join(temporary, code);
        fs.mkdirSync(destination);
        writeZip(archive, Array.from({ length: count }, (_, i) => ({ name: `bsv-lens/file-${i}.json`, data: Buffer.alloc(0) })));
        // Change only advertised uncompressed sizes. No giant fixture or payload
        // allocation is needed to exercise the real Python ZIP metadata boundary.
        const bytes = fs.readFileSync(archive), signature = Buffer.from('504b0102', 'hex');
        let offset = 0, changed = 0;
        while ((offset = bytes.indexOf(signature, offset)) !== -1) {
            bytes.writeUInt32LE(size, offset + 24);
            offset += 46 + bytes.readUInt16LE(offset + 28) + bytes.readUInt16LE(offset + 30) + bytes.readUInt16LE(offset + 32);
            changed++;
        }
        assert.equal(changed, count);
        fs.writeFileSync(archive, bytes);
        const result = spawnSync('python3', ['-E', '-s', '-S', '-B', '-c', extraction, archive, destination], { encoding: 'utf8' });
        assert.ifError(result.error);
        assert.equal(result.status, 1);
        assert.match(result.stderr, new RegExp(code));
        assert.deepEqual(fs.readdirSync(destination), []);
    }
});

// Synthetic envelope fixtures test the delivery boundary, not product answers.
function fixture({ browser = true } = {}) {
    const prefix = 'bsv-lens/docs/hardware/evidence/g5/run-synthetic/';
    const entries = collectFiles(path.join(root, 'docs/hardware/evidence/g5/semantics'),
        { prefix: 'bsv-lens/docs/hardware/evidence/g5/semantics' });
    const files = [], queries = [];
    const put = (name, value) => {
        const data = Buffer.from(JSON.stringify(value));
        entries.push({ name: prefix + name, data }); files.push({ path: name, bytes: data.length, sha256: hash(data) });
        return name;
    };
    for (const buildId of ['A', 'B', 'C']) for (const kind of ['same-net', 'drivers-loads', 'dependencies', 'state-accesses']) {
        const stem = `${buildId}-${kind}`, request = put(`${stem}.request.json`, { kind });
        const result = put(`${stem}.result.json`, { kind, id: stem, queryId: stem });
        const receipt = put(`${stem}.receipt.json`, { buildId, exit: 0,
            requestSha256: files.at(-2).sha256, resultSha256: files.at(-1).sha256 });
        queries.push({ buildId, request, result, receipt });
    }
    const index = { files, queries };
    if (browser) {
        index.browser = { status: 'pass', interaction: 'real-pointer-keyboard', trace: put('browser/trace.zip', 'synthetic envelope only'),
            captures: [put('browser/capture.png', 'synthetic envelope only')], receipt: put('browser/receipt.json', { status: 'pass',
                journeys: Array.from({ length: 15 }, (_, i) => ({ id: `J${String(i + 1).padStart(2, '0')}`, status: 'pass' })) }) };
    }
    entries.push({ name: prefix + 'index.json', data: Buffer.from(JSON.stringify(index)) });
    return { entries, prefix, index };
}
function changeIndex(f, mutate) {
    const index = structuredClone(f.index); mutate(index);
    return f.entries.map(entry => entry.name === f.prefix + 'index.json' ? { ...entry, data: Buffer.from(JSON.stringify(index)) } : entry);
}

test('all indexed G5 bytes including actual-query receipt links enforce missing/size/hash closure', () => {
    const f = fixture(); const expected = validateEvidence(f.entries);
    assert.equal(expected.queries.length, 12); assert.equal(expected.browser, 'indexed-pass');
    for (const row of f.index.files) {
        const name = f.prefix + row.path, entry = f.entries.find(entry => entry.name === name);
        assert.throws(() => validateEvidence(f.entries.filter(entry => entry.name !== name)), /Missing G5 reference/);
        assert.throws(() => validateEvidence(f.entries.map(item => item === entry ? { ...item, data: item.data.subarray(1) } : item)), /G5 size mismatch/);
        const changed = Buffer.from(entry.data); changed[0] ^= 1;
        assert.throws(() => validateEvidence(f.entries.map(item => item === entry ? { ...item, data: changed } : item)), /G5 SHA mismatch/);
    }
    assert.throws(() => validateEvidence(changeIndex(f, index => index.queries.pop())), /Missing G5 actual query/);
    assert.throws(() => validateEvidence(changeIndex(f, index => index.queries[0].receipt = index.queries[1].receipt)), /strictly equal/);
    assert.throws(() => validateEvidence(changeIndex(f, index => index.queries[0].result = 'unindexed.json')), /Unindexed G5 receipt/);
    assert.throws(() => validateEvidence(changeIndex(f, index => index.browser = undefined), { expected, allowIncompleteBrowser: true }), /Post-replay G5 evidence changed/);
});

test('missing browser is explicitly candidate-only, never a final PASS', () => {
    const f = fixture({ browser: false });
    assert.throws(() => validateEvidence(f.entries), /Missing G5 browser journeys/);
    assert.equal(validateEvidence(f.entries, { allowIncompleteBrowser: true }).browser, 'MISSING - CANDIDATE ONLY');
    const full = fixture();
    assert.throws(() => validateEvidence(changeIndex(full, index => index.browser.status = 'fail')), /Browser evidence did not pass/);
});

test('G5 trace allowance remains exact; traversal, duplicates, self-reference and orphan evidence reject', () => {
    const f = fixture();
    for (const value of ['../escape', '/escape', 'a//b', 'a/./b', 'a/../b', 'a\\b', 'x\0', 'C:/trace.zip', 'other.zip', 'node_modules/file', '.omx/state.json', '.codegraph/index.db'])
        assert.throws(() => validateEvidence(changeIndex(f, index => index.files[0].path = value)), /Unsafe G5|Forbidden G5/);
    assert.throws(() => validateEvidence(changeIndex(f, index => index.files.push(index.files[0]))), /Duplicate\/self/);
    assert.throws(() => validateEvidence(changeIndex(f, index => index.files[0].path = 'index.json')), /Duplicate\/self/);
    assert.throws(() => validateEvidence([...f.entries, f.entries[0]]), /Duplicate G5 member/);
    assert.throws(() => validateEvidence([...f.entries, { name: f.prefix + 'orphan.json', data: Buffer.from('{}') }]), /Unindexed G5 evidence/);
    assert.throws(() => validateEvidence([...f.entries, { name: f.prefix + 'browser/other.zip', data: Buffer.from('zip') }]), /Forbidden G5 reference/);
    assert.equal(tracePath('docs/hardware/evidence/g5/run-real/browser/trace.zip'), true);
    assert.equal(tracePath('docs/hardware/evidence/g5/resume-real/browser/trace.zip'), false);
    const semantics = f.entries.find(entry => entry.name.endsWith('semantics/census.json'));
    assert.throws(() => validateEvidence(f.entries.filter(entry => entry !== semantics)), /Missing G5 reference/);
});

test('semantic comparison retains identity, repeated ordered values, source ranges and frontiers', () => {
    const result = { id: 'identity', queryId: 'query', seed: { bits: [2, 1, 2] }, frontier: [{ reason: 'scope' }],
        sourceRefs: [{ range: { start: 1, end: 3 } }], metrics: { time: 10 }, request: { queryGeneration: 4 } };
    assert.deepEqual(semantic(result), semantic({ ...result, metrics: { time: 20 }, request: { queryGeneration: 8 } }));
    for (const change of [{ id: 'foreign' }, { seed: { bits: [1, 2, 2] } }, { frontier: [] }, { sourceRefs: [] }])
        assert.notDeepEqual(semantic(result), semantic({ ...result, ...change }));
});

test('collector adds only explicit evidence and archive bytes ignore author metadata; no output overwrite', t => {
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'g5-delivery-test-'));
    t.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
    fs.writeFileSync(path.join(temporary, 'file.txt'), 'same input');
    for (const name of ['.omx', '.codegraph']) {
        fs.mkdirSync(path.join(temporary, name));
        fs.writeFileSync(path.join(temporary, name, 'local.json'), 'local session metadata');
    }
    const entries = collectEntries({ workspace: temporary });
    assert.deepEqual(entries.map(entry => entry.name), ['bsv-lens/file.txt']);
    const a = path.join(temporary, 'a.zip'), b = path.join(temporary, 'b.zip');
    writeZip(a, entries); fs.chmodSync(path.join(temporary, 'file.txt'), 0o600);
    // Archives are excluded by the inherited collector, including the first candidate.
    writeZip(b, collectEntries({ workspace: temporary }));
    assert.deepEqual(fs.readFileSync(a), fs.readFileSync(b));
    assert.throws(() => assertNewOutput(a), /Refusing to overwrite/);
    const dangling = path.join(temporary, 'dangling.zip'); fs.symlinkSync('absent', `${dangling}.validation.json.sha256`);
    assert.throws(() => assertNewOutput(dangling), /Refusing to overwrite/);
    assert.deepEqual(archiveNames(temporary).map(name => path.basename(name)),
        ['bsv-lens-hardware-g5-review.zip', 'bsv-lens-hardware-g5-source.zip']);
});
