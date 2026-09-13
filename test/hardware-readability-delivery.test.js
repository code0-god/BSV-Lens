'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { writeZip } = require('../scripts/zip');
const { hash, assertNewOutput } = require('../experiments/hardware/g4/validate-delivery');
const delivery = require('../experiments/hardware/g5-readability/validate-delivery.cjs');
const packaging = require('../experiments/hardware/g5-readability/package.cjs');

// Envelope fixtures exercise missing/hash/identity boundaries, never claim browser execution.
function fixture() {
    const prefix = `bsv-lens/${delivery.evidenceRoot}run-synthetic/`, entries = [], files = [];
    const put = (name, value) => {
        const data = Buffer.from(JSON.stringify(value)); entries.push({ name: prefix + name, data });
        files.push({ path: name, bytes: data.length, sha256: hash(data) }); return name;
    };
    const index = { schema: 'g5-readability-evidence-v1', files, browser: {} };
    for (const phase of ['before', 'after']) index.browser[phase] = {
        traces: [put(`browser/${phase}/trace-main.zip`, 'synthetic trace envelope')],
        captures: [put(`browser/${phase}/A.png`, 'synthetic image envelope')],
        measurements: [put(`browser/${phase}/A.json`, { label: 'left', effectiveFont: phase === 'before' ? 4 : 12 })],
        receipt: put(`browser/${phase}/receipt.json`, phase === 'before' ? { status: 'captured' }
            : { status: 'pass', journeys: Array.from({ length: 20 }, (_, i) => ({ id: `J${String(i + 1).padStart(2, '0')}`, status: 'pass' })) })
    };
    index.semanticComparison = put('checks/semantic.json', { status: 'pass', comparedTo: 'before/semantic.json',
        semantic: { queries: Array(12).fill({}), correspondence: Array(9).fill({}) } });
    const kinds = ['behavior', 'source-dependencies', 'call-site', 'correspondence', 'same-net', 'dependencies'];
    const requests = Array.from({ length: 75 }, (_, i) => ({ buildId: ['A', 'B', 'C'][i % 3], label: `synthetic-${i}`,
        input: { kind: kinds[i % kinds.length], seed: { entityId: `synthetic-${i}` } } }));
    const identities = ['A', 'B', 'C'].map(buildId => ({ buildId }));
    index.semanticDetails = {
        requests: put('checks/semantic-details/requests.json', requests),
        results: put('checks/semantic-details/before.capture.json', { schema: 'g5-readability-semantic-details-capture-v1', identities,
            requests, queries: requests.map(row => ({ ...row, result: { kind: row.input.kind }, sources: [] })) }),
        receipt: put('checks/semantic-details/semantic-details.json', { schema: 'g5-readability-semantic-details-v1', status: 'pass',
            before: { identities }, after: { identities }, queries: requests.map(row => ({ ...row, status: 'pass' })) })
    };
    index.checks = ['negative-tests', 'f1-f2', 'core', 'preservation'].map(id => ({ id, receipt: put(`checks/${id}.json`, { status: 'pass', exit: 0 }) }));
    files.sort((a, b) => a.path.localeCompare(b.path));
    entries.push({ name: prefix + 'index.json', data: Buffer.from(JSON.stringify(index)) });
    return { entries, index, prefix };
}
function changeIndex(f, change) {
    const index = structuredClone(f.index); change(index);
    return f.entries.map(entry => entry.name === `${f.prefix}index.json` ? { ...entry, data: Buffer.from(JSON.stringify(index)) } : entry);
}
function changeFile(f, name, change) {
    const entry = f.entries.find(row => row.name === f.prefix + name), value = JSON.parse(entry.data); change(value);
    const data = Buffer.from(JSON.stringify(value));
    const entries = changeIndex(f, index => Object.assign(index.files.find(row => row.path === name), { bytes: data.length, sha256: hash(data) }));
    return entries.map(row => row === entry ? { ...row, data } : row);
}

test('readability evidence requires before/after, semantic comparison and all 20 journeys', () => {
    const f = fixture(), result = delivery.validateEvidence(f.entries);
    assert.equal(result.browser, 'indexed-pass'); assert.equal(result.journeys.length, 20);
    assert.throws(() => delivery.validateEvidence([]), /Missing readability evidence index/);
    for (const field of ['browser', 'semanticComparison', 'semanticDetails', 'checks']) {
        const entries = changeIndex(f, index => delete index[field]);
        assert.throws(() => delivery.validateEvidence(entries), /Missing readability before\/after/);
        assert.equal(delivery.validateEvidence(entries, { allowIncompleteBrowser: true }).browser, 'MISSING - CANDIDATE ONLY');
    }
    assert.throws(() => delivery.validateEvidence(changeFile(f, 'browser/after/receipt.json', row => row.journeys.pop())), /Missing readability before\/after/);
    assert.throws(() => delivery.validateEvidence(changeFile(f, 'browser/after/receipt.json', row => row.journeys[0].status = 'fail')), /strictly equal/);
    assert.throws(() => delivery.validateEvidence(changeFile(f, 'checks/semantic.json', row => row.comparedTo = null)), /before\/after comparison missing/);
    assert.throws(() => delivery.validateEvidence(changeFile(f, 'checks/core.json', row => row.exit = 2)), /Failed readability check/);
    assert.throws(() => delivery.validateEvidence(changeFile(f, 'checks/core.json', row => row.status = 'blocked')), /Failed readability check/);
});

test('supplementary semantics require indexed complete requests, results and six query kinds', () => {
    const f = fixture(), details = f.index.semanticDetails;
    for (const field of ['receipt', 'requests', 'results'])
        assert.throws(() => delivery.validateEvidence(changeIndex(f, row => row.semanticDetails[field] = 'absent.json')), /Unindexed readability receipt/);
    assert.throws(() => delivery.validateEvidence(changeFile(f, details.requests, rows => rows.pop())), /75 detailed semantic requests/);
    assert.throws(() => delivery.validateEvidence(changeFile(f, details.results, row => row.queries.pop())), /Detailed semantic result count/);
    assert.throws(() => delivery.validateEvidence(changeFile(f, details.results, row => row.requests[0].label = 'wrong')), /Detailed semantic requests differ/);
    assert.throws(() => delivery.validateEvidence(changeFile(f, details.results, row => row.queries[0].input.seed.entityId = 'wrong')), /Detailed semantic query inputs differ/);
    assert.throws(() => delivery.validateEvidence(changeFile(f, details.receipt, row => row.queries[0].input.seed.entityId = 'wrong')), /Detailed semantic receipt inputs differ/);
    assert.throws(() => delivery.validateEvidence(changeFile(f, details.receipt, row => row.status = 'fail')), /strictly equal/);
    assert.throws(() => delivery.validateEvidence(changeFile(f, details.requests, rows => rows.forEach(row => row.input.kind = 'same-net'))), /Missing detailed semantic kind/);
});

test('zero-byte evidence logs retain strict existence, size and SHA closure', () => {
    const f = fixture(), data = Buffer.alloc(0), name = 'checks/empty.stderr.log';
    const entries = changeIndex(f, row => {
        row.files.push({ path: name, bytes: 0, sha256: hash(data) }); row.files.sort((a, b) => a.path.localeCompare(b.path));
    });
    assert.throws(() => delivery.validateEvidence(entries), /Missing readability reference/);
    const complete = [...entries, { name: f.prefix + name, data }];
    assert.equal(delivery.validateEvidence(complete).browser, 'indexed-pass');
    assert.throws(() => delivery.validateEvidence([...entries, { name: f.prefix + name, data: Buffer.from('changed') }]), /Readability size mismatch/);
    const wrong = { ...f, entries: complete, index: JSON.parse(entries.find(row => row.name === f.prefix + 'index.json').data) };
    assert.throws(() => delivery.validateEvidence(changeIndex(wrong, row => row.files.find(file => file.path === name).sha256 = hash('different'))), /Readability SHA mismatch/);
});

test('all indexed readability attachments enforce missing, size, hash and post-replay closure', () => {
    const f = fixture(), expected = delivery.validateEvidence(f.entries);
    assert.deepEqual(delivery.validateEvidence(f.entries, { expected }), expected);
    for (const row of f.index.files) {
        const name = f.prefix + row.path;
        assert.throws(() => delivery.validateEvidence(f.entries.filter(entry => entry.name !== name)), /Missing readability reference/);
        assert.throws(() => delivery.validateEvidence(f.entries.map(entry => entry.name === name ? { ...entry, data: entry.data.subarray(1) } : entry)), /Readability size mismatch/);
        assert.throws(() => delivery.validateEvidence(f.entries.map(entry => {
            if (entry.name !== name) return entry;
            const data = Buffer.from(entry.data); data[0] ^= 1; return { ...entry, data };
        })), /Readability SHA mismatch/);
    }
    assert.throws(() => delivery.validateEvidence(changeIndex(f, row => row.checks.pop()), { expected, allowIncompleteBrowser: true }), /Post-replay readability evidence changed/);
});

test('readability approved root, trace exceptions and sorted inventory stay narrow', () => {
    const f = fixture();
    for (const value of ['../escape', '/escape', 'a//b', 'a/./b', 'a\\b', 'x\0', 'C:/trace.zip', 'other.zip', 'node_modules/file', '.omx/state.json', '.codegraph/index.db'])
        assert.throws(() => delivery.validateEvidence(changeIndex(f, row => row.files[0].path = value)), /Unsafe readability|Forbidden readability|path-sorted/);
    assert.throws(() => delivery.validateEvidence([...f.entries, f.entries[0]]), /Duplicate readability member/);
    assert.throws(() => delivery.validateEvidence([...f.entries, { name: f.prefix + 'orphan.json', data: Buffer.from('{}') }]), /Unindexed readability evidence/);
    assert.throws(() => delivery.validateEvidence(changeIndex(f, row => row.files.reverse())), /path-sorted/);
    assert.throws(() => delivery.validateEvidence(changeIndex(f, row => row.browser.after.receipt = 'not-indexed.json')), /Unindexed readability receipt/);
    assert.throws(() => delivery.validateEvidence(changeIndex(f, row => row.browser.after.captures = [])), /Missing after captures/);
    assert.throws(() => delivery.validateEvidence(changeIndex(f, row => row.browser.after.traces = row.browser.before.traces)), /Wrong after browser attachment/);
    for (const value of ['run-a/browser/after/trace.zip', 'run-a/browser/before/trace-part-2.zip']) assert.equal(delivery.tracePath(delivery.evidenceRoot + value), true);
    for (const value of ['run-a/browser/trace.zip', 'resume-a/browser/after/trace.zip', 'run-a/browser/after/arbitrary.zip']) assert.equal(delivery.tracePath(delivery.evidenceRoot + value), false);
});

test('companion is explicit historical QA only and cannot conceal absent source evidence', () => {
    const inventory = [{ path: delivery.omittedRoot + 'index.json', bytes: 3, sha256: hash('old') }];
    const manifest = { schema: 'g5-readability-companion-v1', omittedRoot: delivery.omittedRoot,
        purpose: 'Historical G5 resume QA supplement only; preserved source/compiler/query evidence remains inline.',
        inventory, inventorySha256: hash(JSON.stringify(inventory)), archives: ['review', 'source'].map(mode => ({
            path: `dist/bsv-lens-hardware-g5-${mode}.zip`, bytes: 3, sha256: hash(mode) })) };
    const entry = { name: `bsv-lens/${delivery.companionPath}`, data: Buffer.from(JSON.stringify(manifest)) };
    assert.equal(delivery.validateCompanion([entry]).inventorySha256, manifest.inventorySha256);
    assert.throws(() => delivery.validateCompanion([]), /Missing historical QA companion/);
    assert.throws(() => delivery.validateCompanion([entry, { name: `bsv-lens/${inventory[0].path}`, data: Buffer.from('old') }]), /Duplicate historical QA supplement/);
    const wrong = { ...manifest, omittedRoot: 'docs/hardware/evidence/toolchain/' };
    assert.throws(() => delivery.validateCompanion([{ ...entry, data: Buffer.from(JSON.stringify(wrong)) }]), /strictly equal/);
    const empty = structuredClone(manifest);
    empty.inventory.push({ path: delivery.omittedRoot + 'stderr.log', bytes: 0, sha256: hash('') });
    empty.inventorySha256 = hash(JSON.stringify(empty.inventory));
    assert.doesNotThrow(() => delivery.validateCompanion([{ ...entry, data: Buffer.from(JSON.stringify(empty)) }]));
    empty.inventory[1].bytes = -1; empty.inventorySha256 = hash(JSON.stringify(empty.inventory));
    assert.throws(() => delivery.validateCompanion([{ ...entry, data: Buffer.from(JSON.stringify(empty)) }]));
});

test('collector preserves old files, excludes local state, emits new deterministic archive names', t => {
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'g5-readability-delivery-'));
    t.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
    const write = (relative, data) => { const file = path.join(temporary, relative); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, data); };
    write('src/example.js', 'module.exports = 1;');
    write(delivery.omittedRoot + 'original.json', 'preserve');
    write('docs/hardware/evidence/g5/run-zAkL5y/query.json', 'retain');
    write(delivery.evidenceRoot + 'run-generation/index.json', 'readability');
    assert.ok(!require('../experiments/hardware/g4/package').collectEntries({ workspace: temporary })
        .some(row => row.name.startsWith(`bsv-lens/${delivery.evidenceRoot}`)), 'G4 collector must not ingest follow-up evidence');
    for (const name of ['.omx', '.codegraph']) write(`${name}/local.json`, 'local');
    const entries = packaging.collectEntries({ workspace: temporary });
    assert.deepEqual(entries.map(row => row.name), [`bsv-lens/${delivery.evidenceRoot}run-generation/index.json`,
        'bsv-lens/docs/hardware/evidence/g5/run-zAkL5y/query.json', 'bsv-lens/src/example.js'].sort((a, b) => a.localeCompare(b)));
    assert.equal(fs.readFileSync(path.join(temporary, delivery.omittedRoot, 'original.json'), 'utf8'), 'preserve');
    const [a, b] = ['a.zip', 'b.zip'].map(name => path.join(temporary, name));
    writeZip(a, entries); fs.chmodSync(path.join(temporary, 'src/example.js'), 0o600);
    writeZip(b, packaging.collectEntries({ workspace: temporary })); assert.equal(packaging.hashFile(a), packaging.hashFile(b));
    assert.throws(() => assertNewOutput(a), /Refusing to overwrite/);
    assert.deepEqual(packaging.archiveNames(temporary).map(name => path.basename(name)),
        ['bsv-lens-hardware-g5-readability-review.zip', 'bsv-lens-hardware-g5-readability-source.zip']);
});

test('resource limits remain 64 MiB member and 768 MiB aggregate without allocation tricks', () => {
    assert.doesNotThrow(() => packaging.checkLimits([{ name: 'small', data: Buffer.from('x') }]));
    assert.throws(() => packaging.checkLimits([{ name: 'large', data: { length: 64 * 1024 * 1024 + 1 } }]), /ARCHIVE_MEMBER_SIZE/);
    assert.throws(() => packaging.checkLimits(Array.from({ length: 13 }, () => ({ name: 'bounded', data: { length: 64 * 1024 * 1024 } }))), /ARCHIVE_TOTAL_SIZE/);
    assert.deepEqual(delivery.inventory([{ name: 'z', data: Buffer.from('z') }, { name: 'a', data: Buffer.from('a') }]).map(row => row.path), ['a', 'z']);
});
