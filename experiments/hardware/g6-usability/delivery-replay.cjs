'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { once } = require('node:events');
const { collectFiles } = require('../../../scripts/zip');
const { hash } = require('../../../src/hardware/json');
const { createRun } = require('../g6/run.cjs');
const { loadReference, proveIdentities, querySeal, resultSeal } = require('./semantic.cjs');
const ROOT = path.resolve(__dirname, '../../..');
const encode = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');

function rebaseResult(buildId, request, result, expected, proof) {
    const identity = proof.builds.find(build => build.buildId === buildId); assert.ok(identity);
    assert.equal(request.analysisId, identity.currentAnalysisId);
    assert.equal(request.implementationProvider, 'stock');
    assert.equal(result.context.analysisId, identity.currentAnalysisId);
    assert.equal(result.context.originAnalysisId, null);
    assert.equal(result.queryId, querySeal({ input: request, result }));
    assert.equal(result.id, resultSeal(result));
    const oldRequest = { ...request, analysisId: identity.oldAnalysisId }, rebased = JSON.parse(JSON.stringify(result));
    rebased.context.analysisId = identity.oldAnalysisId;
    rebased.queryId = querySeal({ input: oldRequest, result: rebased });
    assert.equal(rebased.queryId, expected.queryId, 'Historical indexed query material changed');
    rebased.id = resultSeal(rebased);
    assert.deepEqual(rebased, expected, 'Complete indexed query facts changed');
    return rebased;
}

async function replay({ root = ROOT, output = process.env.G6_OUTPUT_DIR || createRun('usability-delivery-replay') } = {}) {
    const { reference } = loadReference(root), proof = await proveIdentities(reference, root);
    const legacy = require(path.join(root, 'experiments/hardware/g5/validate-review.cjs'));
    const evidence = legacy.validateEvidence(collectFiles(path.join(root, legacy.evidenceRoot), { prefix: `bsv-lens/${legacy.evidenceRoot.slice(0, -1)}` }), { allowIncompleteBrowser: true });
    assert.equal(evidence.queries.length, 12, 'Preserved indexed query inventory changed');
    const write = (name, value) => fs.writeFileSync(path.join(output, name), encode(value), { flag: 'wx' });
    write('identity-proof.json', proof);
    const commands = { commands: [] }, env = { ...process.env, NODE_OPTIONS: '--no-global-search-paths', G4_REVIEW_ROOT: root };
    const cli = (buildId, requestFile, expectedExit = 0) => legacy.command(commands, process.execPath,
        ['--no-global-search-paths', 'experiments/hardware/g5/query.cjs', buildId, 'query', requestFile], root, env, expectedExit);
    const first = evidence.queries[0], firstProof = proof.builds.find(build => build.buildId === first.buildId);
    const differs = firstProof.currentAnalysisId !== firstProof.oldAnalysisId;
    const original = cli(first.buildId, path.join(root, first.request), differs ? 1 : 0);
    if (differs) assert.match(original.stderr, /ANALYSIS_MISMATCH/);
    const originalStrictComparison = { status: differs ? 'FAIL' : 'PASS', stage: 'unchanged public CLI with original indexed request',
        code: differs ? 'ANALYSIS_MISMATCH' : null, oldRequest: first.request, requestUnchanged: true };
    const before = proof.provider.files.map(file => ({ ...file, actualHash: hash(fs.readFileSync(path.join(root, 'src', file.pathRef))) }));
    assert.ok(before.every(file => file.actualHash === file.contentHash));
    const server = await require(path.join(root, 'experiments/hardware/g4/server.js')).createServer();
    const listening = once(server, 'listening', { signal: AbortSignal.timeout(30000) }); server.listen(0, '127.0.0.1'); await listening;
    const results = [];
    try {
        for (const [index, query] of evidence.queries.entries()) {
            const oldRequest = JSON.parse(fs.readFileSync(path.join(root, query.request)));
            const expected = legacy.semantic(JSON.parse(fs.readFileSync(path.join(root, query.result))));
            const identity = proof.builds.find(build => build.buildId === query.buildId); assert.ok(identity);
            assert.equal(oldRequest.analysisId, identity.oldAnalysisId);
            const request = { ...oldRequest, analysisId: identity.currentAnalysisId };
            const name = `${String(index).padStart(2, '0')}-${query.buildId}-${request.kind}.current.request.json`;
            write(name, request);
            const actual = legacy.semantic(JSON.parse(cli(query.buildId, path.join(output, name)).stdout));
            const rebased = rebaseResult(query.buildId, request, actual, expected, proof);
            const url = `http://127.0.0.1:${server.address().port}/api/analysis?build=${query.buildId}&query=${encodeURIComponent(JSON.stringify(request))}`;
            const response = await fetch(url, { signal: AbortSignal.timeout(30000) }); assert.equal(response.status, 200);
            assert.deepEqual(legacy.semantic(await response.json()), actual, 'Actual public HTTP and CLI results differ');
            const sources = [];
            for (const ref of actual.sourceRefs) {
                const url = `http://127.0.0.1:${server.address().port}/api/source?build=${query.buildId}&reference=${encodeURIComponent(JSON.stringify(ref))}`;
                const response = await fetch(url, { signal: AbortSignal.timeout(30000) }); assert.equal(response.status, 200);
                const source = await response.json();
                assert.equal(source.id, ref.id); assert.equal(source.revision, ref.revision); assert.equal(source.text, ref.range.text);
                assert.equal(source.sliceHash, ref.sliceHash); assert.equal(source.readOnly, true);
                sources.push({ id: source.id, revision: source.revision, range: source.range, sliceHash: source.sliceHash });
            }
            results.push({ buildId: query.buildId, request: query.request, result: rebased, sources,
                currentQueryId: actual.queryId, currentResultId: actual.id });
        }
    } finally {
        await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
        write('commands.json', commands);
    }
    const cancellation = await require(path.join(root, 'experiments/hardware/g5/delivery-replay.cjs')).cancellation();
    assert.equal(cancellation.status, 'pass'); assert.equal(cancellation.workerExited, true);
    assert.deepEqual(proof.provider.files.map(file => ({ ...file, actualHash: hash(fs.readFileSync(path.join(root, 'src', file.pathRef))) })), before, 'Provider runtime changed during CLI/HTTP replay');
    const report = { status: 'pass', queries: results, cancellation, originalStrictComparison, output,
        resultRepresentation: 'Historical IDs rebased for complete comparison; actual current CLI output and mapped request bytes are retained in commands.json and current.request files.',
        reference: 'docs/hardware/g6-usability/SEMANTIC_BASELINE.json', identityProof: 'identity-proof.json',
        replayVerification: { status: 'pass', executedQueryCount: results.length, cli: 'PASS', http: 'PASS', source: 'PASS',
            workerCancellation: 'PASS', completeIndexedFacts: 'PASS', externalOldArchiveRequired: false } };
    write('delivery-replay.json', report); return report;
}
if (require.main === module) {
    const [mode] = process.argv.slice(2);
    if (mode === '--help') console.log('Usage: node experiments/hardware/g6-usability/delivery-replay.cjs --replay\nAuthenticates build identities and replays the preserved12 queries through real CLI/HTTP/source/cancellation.');
    else { assert.ok(!mode || mode === '--replay'); replay().then(report => console.log(JSON.stringify(report, null, 2))).catch(error => { console.error(error); process.exitCode = 1; }); }
}
module.exports = { replay, rebaseResult };
