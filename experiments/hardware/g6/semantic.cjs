'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { isDeepStrictEqual } = require('node:util');
const { capture } = require('../g5-readability/semantic-details.cjs');
const { inspectHardwareBuild } = require('../../../src/panel/hardware-build');
const { createRun } = require('./run.cjs');
const ROOT = path.resolve(__dirname, '../../..');
const BASELINE = 'docs/hardware/g6/G6_SEMANTIC_BASELINE.json';
const HISTORICAL = 'docs/hardware/evidence/g5-readability/run-0vHU05';
const CAPTURE_SHA = '7728623c829d74c7671cdb40133c617c96668557a3b4b472e10abc20d26e18f6';
const ARCHIVE_SHA = '3504decafff6ad0c600b2a8c2d0c2651edee3f84a33c408e522d85663b23c686';
const encode = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
const hash = value => createHash('sha256').update(value).digest('hex');
const identity = bytes => ({ bytes: bytes.length, sha256: hash(bytes) });
const valueIdentity = value => identity(encode(value));
const rowIdentity = row => ({ buildId: row.buildId, label: row.label, input: valueIdentity(row.input),
    result: valueIdentity(row.result), sources: valueIdentity(row.sources), sourceItems: row.sources.map(valueIdentity) });
function validateCapture(value) {
    assert.equal(value.schema, 'g5-readability-semantic-details-capture-v1');
    assert.equal(value.requests.length, 75); assert.equal(value.queries.length, 75);
    assert.deepEqual(value.identities.map(row => row.buildId), ['A', 'B', 'C']);
    assert.deepEqual(value.queries.map(({ buildId, label, input }) => ({ buildId, label, input })), value.requests);
    for (const row of value.queries) {
        assert.ok(!Object.hasOwn(row.result, 'metrics') && !Object.hasOwn(row.result, 'request'));
        assert.ok(Array.isArray(row.sources));
    }
}
function generateBaseline(workspace = ROOT) {
    const indexFile = path.join(workspace, HISTORICAL, 'index.json'), indexBytes = fs.readFileSync(indexFile);
    const index = JSON.parse(indexBytes);
    const read = file => {
        const entry = index.files.find(row => row.path === file); assert.ok(entry, 'Historical evidence must be indexed');
        const bytes = fs.readFileSync(path.join(workspace, HISTORICAL, file)); assert.deepEqual(identity(bytes), { bytes: entry.bytes, sha256: entry.sha256 });
        return { bytes, reference: { path: `${HISTORICAL}/${file}`, ...identity(bytes) } };
    };
    const original = read('checks/semantic-details/before.capture.json'), prior = read('checks/semantic-details/semantic-details.json');
    assert.equal(original.reference.sha256, CAPTURE_SHA);
    const data = JSON.parse(original.bytes), report = JSON.parse(prior.bytes); validateCapture(data);
    assert.equal(report.status, 'pass'); assert.equal(report.before.archiveSha256, ARCHIVE_SHA);
    assert.deepEqual(report.excludedFields, ['metrics', 'request']);
    const archivePath = 'dist/bsv-lens-hardware-g5-source.zip', archive = fs.readFileSync(path.join(workspace, archivePath));
    assert.equal(hash(archive), ARCHIVE_SHA, 'Immutable original G5 source archive changed');
    const baseline = { schema: 'g6-semantic-baseline-v1', createdAt: new Date().toISOString(),
        provenance: { kind: 'Hashes derived only from immutable pre-G6 capture before current G6 query execution',
            capture: original.reference, replayReport: prior.reference, evidenceIndex: { path: `${HISTORICAL}/index.json`, ...identity(indexBytes) },
            originalG5SourceArchive: { path: archivePath, ...identity(archive) },
            historicalInputsRequiredForReplay: false },
        encoding: 'UTF-8 JSON.stringify(value, null, 2) followed by one LF; full ordered objects/arrays retained when hashing',
        exclusions: ['top-level query result.metrics', 'top-level query result.request'],
        identities: data.identities, requests: data.requests, requestsIdentity: valueIdentity(data.requests),
        queries: data.queries.map(rowIdentity), fullCapture: identity(original.bytes) };
    const file = path.join(workspace, BASELINE); fs.writeFileSync(file, encode(baseline), { flag: 'wx' });
    console.log(JSON.stringify({ baseline: file, ...identity(fs.readFileSync(file)), queryCount: baseline.queries.length,
        expectedDerivedFrom: original.reference, currentQueriesExecuted: false })); return baseline;
}
function compare(baseline, current) {
    assert.equal(baseline.schema, 'g6-semantic-baseline-v1');
    assert.equal(baseline.provenance.capture.sha256, CAPTURE_SHA); assert.equal(baseline.fullCapture.sha256, CAPTURE_SHA);
    assert.equal(baseline.provenance.originalG5SourceArchive.sha256, ARCHIVE_SHA);
    assert.deepEqual(baseline.exclusions, ['top-level query result.metrics', 'top-level query result.request']);
    validateCapture(current); assert.equal(baseline.queries.length, 75);
    assert.deepEqual(current.requests, baseline.requests, 'Public query requests changed');
    assert.deepEqual(valueIdentity(current.requests), baseline.requestsIdentity, 'Request hash changed');
    assert.deepEqual(current.identities, baseline.identities, 'Snapshot/provider/source identity changed');
    const queries = current.queries.map(rowIdentity), mismatches = [];
    for (let i = 0; i < queries.length; i++) if (!isDeepStrictEqual(queries[i], baseline.queries[i])) mismatches.push({ index: i,
        buildId: queries[i].buildId, label: queries[i].label, expected: baseline.queries[i], actual: queries[i] });
    assert.deepEqual(mismatches, [], 'Complete query result or resolved source changed');
    const fullCapture = valueIdentity(current); assert.deepEqual(fullCapture, baseline.fullCapture, 'Complete ordered capture changed');
    return { queries, fullCapture };
}
function runtime(workspace) {
    return { native: inspectHardwareBuild(workspace), harness: ['experiments/hardware/g6/semantic.cjs',
        'experiments/hardware/g5-readability/semantic-details.cjs', 'experiments/hardware/g4/server.js',
        'experiments/hardware/g3/query.js', 'experiments/hardware/g3/origin-query.js'].map(file => ({ path: file, ...identity(fs.readFileSync(path.join(workspace, file))) })) };
}
async function replay({ workspace = ROOT, baselineFile = path.join(workspace, BASELINE), output = process.env.G6_OUTPUT_DIR || createRun('semantic-details') } = {}) {
    const bytes = fs.readFileSync(baselineFile), baseline = JSON.parse(bytes), before = runtime(workspace);
    const report = { schema: 'g6-semantic-replay-v1', status: 'fail', startedAt: new Date().toISOString(),
        baseline: { path: path.relative(workspace, baselineFile), ...identity(bytes), provenance: baseline.provenance },
        environment: { node: process.version, platform: process.platform, arch: process.arch }, runtimeBefore: before,
        exclusions: baseline.exclusions, inputRequests: baseline.requests.length, currentQueriesExecuted: false,
        scope: 'Existing public G5 capture API with the exact immutable 75 requests; preview catalog is test-only. No native installed, compiler or new origin coverage claim.' };
    let current;
    try {
        current = await capture(workspace, baseline.requests); report.currentQueriesExecuted = true;
        const result = compare(baseline, current);
        report.runtimeAfter = runtime(workspace); assert.deepEqual(report.runtimeAfter, before, 'Query runtime changed during replay');
        assert.deepEqual(fs.readFileSync(baselineFile), bytes, 'Expected baseline changed during replay');
        report.queryCount = result.queries.length; report.queries = result.queries; report.fullCapture = result.fullCapture;
        report.countsByKind = current.requests.reduce((counts, row) => (counts[row.input.kind] = (counts[row.input.kind] || 0) + 1, counts), {});
        report.countsByBuild = current.requests.reduce((counts, row) => (counts[row.buildId] = (counts[row.buildId] || 0) + 1, counts), {});
        report.duplicateCaptureNotWritten = true; report.status = 'pass';
    } catch (error) {
        report.error = error.stack || String(error);
        if (current) { report.failedCapture = 'failed-current.capture.json'; fs.writeFileSync(path.join(output, report.failedCapture), encode(current), { flag: 'wx' }); }
    } finally {
        report.finishedAt = new Date().toISOString(); fs.writeFileSync(path.join(output, 'semantic.json'), encode(report), { flag: 'wx' });
        console.log(JSON.stringify({ output, status: report.status, queryCount: report.queryCount, countsByKind: report.countsByKind,
            countsByBuild: report.countsByBuild, fullCapture: report.fullCapture, error: report.error }));
    }
    assert.equal(report.status, 'pass', 'G6 semantic replay failed; see semantic.json'); return report;
}
if (require.main === module) {
    const [mode, workspace] = process.argv.slice(2);
    if (mode === '--baseline') { try { generateBaseline(workspace ? path.resolve(workspace) : ROOT); } catch (error) { console.error(error); process.exitCode = 1; } }
    else { assert.ok(!mode || mode === '--replay', 'Usage: semantic.cjs --baseline|--replay [WORKSPACE]');
        replay({ workspace: workspace ? path.resolve(workspace) : ROOT }).catch(error => { console.error(error); process.exitCode = 1; }); }
}
module.exports = { generateBaseline, compare, replay };
