'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { capture } = require('../experiments/hardware/g5-readability/semantic-details.cjs');
const { compare } = require('../experiments/hardware/g6/semantic.cjs');
const { createRun } = require('../experiments/hardware/g6/run.cjs');
const { loadCapturedCase } = require('../experiments/hardware/g3/query.js');
const { V2_REBASED_CAPTURE, V2_UNCHANGED_ROWS, loadReference, proveIdentities, verifyAnalysis, querySeal, resultSeal,
    rebaseCapture } = require('../experiments/hardware/g6-usability/semantic.cjs');

const root = path.resolve(__dirname, '..'), clone = value => JSON.parse(JSON.stringify(value));
let fixture;
function inputs() {
    return fixture ||= (async () => {
        const { reference, baseline } = loadReference(root);
        const current = await capture(root), proof = await proveIdentities(reference, root);
        return { reference, baseline, current, proof };
    })();
}
function reseal(row) { row.result.queryId = querySeal(row); row.result.id = resultSeal(row.result); }

test('cross-build75 retains strict v1 rejection and pins the exact v2 capture without changing live objects', async () => {
    const { reference, baseline, current, proof } = await inputs(), before = JSON.stringify(current);
    assert.throws(() => compare(baseline, current), /Public query requests changed/);
    const result = rebaseCapture(reference, baseline, current, proof);
    assert.deepEqual(result.fullCapture, V2_REBASED_CAPTURE);
    assert.deepEqual(result.unchangedRows, V2_UNCHANGED_ROWS);
    assert.equal(result.changedRows.length, 75 - V2_UNCHANGED_ROWS.length);
    assert.equal(JSON.stringify(current), before);
});

test('semantic mutations fail even after recomputing syntactically valid current query/result IDs', async t => {
    const { reference, baseline, current, proof } = await inputs();
    const mutations = {
        'ordered repeated positions': value => { const row = value.queries[1]; row.result.seed.positions.reverse(); reseal(row); },
        'bit identity': value => { const row = value.queries[0]; row.result.seed.positions[0].bitId = row.result.seed.positions[1].bitId; reseal(row); },
        'query scope': value => { const row = value.queries[0]; row.input.scope.kind = 'subtree'; value.requests[0].input.scope.kind = 'subtree'; row.result.scope.kind = 'subtree'; reseal(row); },
        'frontier and stop reason': value => { const row = value.queries[0]; row.result.frontier.push({ reason: 'changed-boundary' }); row.result.limits.stopReasons.push('changed-boundary'); reseal(row); },
        'source text': value => { const row = value.queries.find(item => item.sources.length); row.sources[0].text = `${row.sources[0].text}\nchanged`; },
        'source range': value => { const row = value.queries.find(item => item.result.sourceRefs.length); row.result.sourceRefs[0].range.start++; reseal(row); },
        'predicate or body condition': value => { const row = value.queries.find(item => item.result.conditions); row.result.conditions.body.push({ signedExpressionId: 'changed-condition', polarity: false }); reseal(row); },
        'relation removal': value => { const row = value.queries.find(item => item.result.relations.length); row.result.relations.pop(); reseal(row); },
        'origin coverage upgrade': value => { const row = value.queries.find(item => item.result.correspondence?.origin.claims.length); row.result.correspondence.origin.claims[0].completeOriginSet = true; reseal(row); },
        'stock claim removal': value => { const row = value.queries.find(item => item.result.correspondence?.stock.claims.length); row.result.correspondence.stock.claims.pop(); reseal(row); },
        'foreign provider': value => { const row = value.queries[0]; row.result.context.providerIdentity = 'other-provider'; reseal(row); },
        'unknown identity field': value => { const row = value.queries[0]; row.result.unapprovedAnalysisId = row.result.context.analysisId; reseal(row); }
    };
    for (const [name, mutate] of Object.entries(mutations)) await t.test(name, () => {
        const value = clone(current); mutate(value);
        assert.throws(() => rebaseCapture(reference, baseline, value, proof));
    });
});

test('invalid seals, non-bijective identity mapping and provider tampering fail', async t => {
    const { reference, baseline, current, proof } = await inputs();
    for (const field of ['id', 'queryId']) await t.test(`corrupted ${field}`, () => {
        const value = clone(current); value.queries[0].result[field] = 'analysis-invalid';
        assert.throws(() => rebaseCapture(reference, baseline, value, proof), /seal invalid/);
    });
    const mapped = clone(proof); mapped.builds[1].oldAnalysisId = mapped.builds[0].oldAnalysisId;
    assert.throws(() => rebaseCapture(reference, baseline, current, mapped));
    const foreign = clone(proof); foreign.builds[0].currentAnalysisId = foreign.builds[1].currentAnalysisId;
    assert.throws(() => rebaseCapture(reference, baseline, current, foreign), /Foreign context identity/);
    const { analysis } = await loadCapturedCase('A');
    assert.throws(() => verifyAnalysis(analysis, '0'.repeat(64), reference.provider.identity, reference.builds[0].analysisId));
    assert.throws(() => verifyAnalysis(analysis, proof.provider.providerIdentity, '0'.repeat(64), reference.builds[0].analysisId));
    const changedModel = clone(analysis); changedModel.sourceModel.definitions[0].name = 'changed-source-fact';
    assert.throws(() => verifyAnalysis(changedModel, proof.provider.providerIdentity, reference.provider.identity, reference.builds[0].analysisId), /Complete source model seal/);
});

test('compact historical reference tampering cannot replace pinned expected provider or query values', () => {
    const { reference } = loadReference(root), directory = createRun('usability-semantic-negative');
    const destination = path.join(directory, 'docs/hardware/g6-usability'); fs.mkdirSync(destination, { recursive: true });
    reference.provider.files[0].contentHash = '0'.repeat(64);
    fs.writeFileSync(path.join(destination, 'SEMANTIC_BASELINE.json'), JSON.stringify(reference, null, 2) + '\n', { flag: 'wx' });
    assert.throws(() => loadReference(directory), /Pinned historical identity reference changed/);
});

test('strict historical indexed12 comparator rejects semantic v2 material', async () => {
    const { proof } = await inputs(), { collectFiles } = require('../scripts/zip');
    const legacy = require('../experiments/hardware/g5/validate-review.cjs');
    const { rebaseResult } = require('../experiments/hardware/g6-usability/delivery-replay.cjs');
    const { createCatalog } = require('../experiments/hardware/g4/server.js');
    const evidence = legacy.validateEvidence(collectFiles(path.join(root, legacy.evidenceRoot), { prefix: `bsv-lens/${legacy.evidenceRoot.slice(0, -1)}` }), { allowIncompleteBrowser: true });
    const row = evidence.queries[0], expected = legacy.semantic(JSON.parse(fs.readFileSync(path.join(root, row.result))));
    const identity = proof.builds.find(build => build.buildId === row.buildId);
    const request = { ...JSON.parse(fs.readFileSync(path.join(root, row.request))), analysisId: identity.currentAnalysisId };
    const query = (await createCatalog()).find(query => query.getCatalogEntry().buildId === row.buildId);
    const current = legacy.semantic(await query.analyze(request));
    assert.throws(() => rebaseResult(row.buildId, request, current, expected, proof), /Historical indexed query material changed/);
});
