'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Worker } = require('node:worker_threads');
const { hash, stable } = require('../../../src/hardware/json');
const { capture } = require('../g5-readability/semantic-details.cjs');
const { compare } = require('../g6/semantic.cjs');
const { createRun } = require('../g6/run.cjs');
const ROOT = path.resolve(__dirname, '../../..');
const REFERENCE = 'docs/hardware/g6-usability/SEMANTIC_BASELINE.json';
const REFERENCE_SHA = '99e776820e31727aff09630570d8e51974e84b3e929766fc5990da63eb013458';
const CAPTURE_SHA = '7728623c829d74c7671cdb40133c617c96668557a3b4b472e10abc20d26e18f6';
const SOURCE_KINDS = ['state-accesses', 'behavior', 'call-site', 'source-dependencies', 'correspondence'];
const encode = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
const write = (directory, name, value) => fs.writeFileSync(path.join(directory, name), encode(value), { flag: 'wx' });
const identity = value => { const { capabilities, ...context } = value.context; return { ...value, context }; };
const sealed = (kind, value) => `${kind}-${hash(stable(value))}`;
const withoutId = ({ id, ...value }) => value;

function loadReference(root = ROOT) {
    const bytes = fs.readFileSync(path.join(root, REFERENCE));
    assert.equal(hash(bytes), REFERENCE_SHA, 'Pinned historical identity reference changed');
    const reference = JSON.parse(bytes), baselineBytes = fs.readFileSync(path.join(root, reference.provenance.baseline.path));
    assert.equal(hash(baselineBytes), reference.provenance.baseline.sha256, 'Original strict baseline changed');
    const baseline = JSON.parse(baselineBytes);
    assert.equal(reference.provenance.capture.sha256, CAPTURE_SHA); assert.equal(baseline.fullCapture.sha256, CAPTURE_SHA);
    assert.equal(hash(stable(reference.provider.files)), reference.provider.identity, 'Historical provider seal');
    assert.equal(new Set(reference.provider.files.map(file => file.pathRef)).size, reference.provider.files.length);
    assert.equal(reference.queries.length, 75); assert.equal(baseline.requests.length, 75);
    return { reference, baseline };
}

async function observeProvider(root, loaded) {
    const request = loaded.request, artifact = async item => ({ ...item, text: (await request.registry.readArtifact(item.pathRef)).text });
    const data = { auditRoot: root, importResult: request.importResult,
        sources: await Promise.all(request.sources.map(async item => ({ ...item, ...await request.registry.readSource(item) }))),
        metadata: await artifact(request.metadata), generatedRtl: await Promise.all(request.generatedRtl.map(artifact)),
        artifactText: (await request.registry.readArtifact(request.importResult.snapshot.artifact.pathRef)).text };
    const script = `const {parentPort,workerData}=require('node:worker_threads'),path=require('node:path'),fs=require('node:fs');
const send=parentPort.postMessage.bind(parentPort),root=path.join(workerData.auditRoot,'src');
parentPort.postMessage=message=>{if(message.type==='result'){
const {hash,stable}=require(path.join(root,'hardware/json.js'));
const files=[...new Set([...Object.keys(require.cache),require.resolve(path.join(root,'hardware/correspondence/index.js'))])].filter(file=>file.startsWith(root+path.sep)).sort().map(file=>({pathRef:path.relative(root,file).split(path.sep).join('/'),contentHash:hash(fs.readFileSync(file))}));
send({type:'audit',analysisId:message.value.id,providerIdentity:message.value.correspondence.providers[0].implementationIdentity,computedIdentity:hash(stable(files)),files});
}else if(message.type==='failure')send(message);};
require(path.join(root,'hardware/correspondence/worker.js'));`;
    const result = await new Promise((resolve, reject) => {
        const worker = new Worker(script, { eval: true, workerData: data, resourceLimits: { maxOldGenerationSizeMb: 512, stackSizeMb: 4 } });
        let value, error;
        const timer = setTimeout(() => { error = new Error('Provider observation deadline'); worker.terminate(); }, 30000);
        worker.on('message', message => { if (message.type === 'audit') value = message; else error = new Error(message.error.message); });
        worker.on('error', cause => { error = cause; });
        worker.once('exit', code => { clearTimeout(timer); if (error) reject(error); else if (code || !value) reject(new Error(`Provider worker exit ${code}`)); else resolve(value); });
    });
    assert.equal(result.analysisId, loaded.analysis.id, 'Observed original worker differs from normal public API');
    assert.equal(result.computedIdentity, result.providerIdentity, 'Actual provider file seal');
    return result;
}

function verifyAnalysis(analysis, currentProvider, historicalProvider, expectedOldId) {
    const bundle = analysis.correspondence;
    assert.equal(hash(stable({ documents: bundle.evidenceSet.sources, model: analysis.sourceModel })), analysis.sourceModelIdentity, 'Complete source model seal');
    assert.equal(bundle.sourceModelIdentity, analysis.sourceModelIdentity);
    for (const provider of bundle.providers) assert.equal(provider.implementationIdentity, currentProvider);
    assert.equal(bundle.id, sealed('correspondence', withoutId(bundle)));
    const material = correspondenceId => ({ schemaVersion: analysis.schemaVersion, implementationSnapshotId: analysis.implementationSnapshotId,
        implementationModelId: analysis.implementationModelId, correspondenceId, sourceModelIdentity: analysis.sourceModelIdentity });
    assert.equal(analysis.id, sealed('analysis', material(bundle.id)));
    const oldBundleId = sealed('correspondence', { ...withoutId(bundle), providers: bundle.providers.map(provider => ({ ...provider, implementationIdentity: historicalProvider })) });
    const oldAnalysisId = sealed('analysis', material(oldBundleId));
    assert.equal(oldAnalysisId, expectedOldId, 'Complete correspondence facts changed after authenticated provider rebasing');
    return { currentAnalysisId: analysis.id, oldAnalysisId, currentCorrespondenceId: bundle.id, oldCorrespondenceId: oldBundleId };
}

async function proveIdentities(reference, root = ROOT) {
    const cases = await Promise.all(reference.builds.map(async old => {
        const stock = await require(path.join(root, 'experiments/hardware/g3/query.js')).loadCapturedCase(old.buildId);
        const origin = await require(path.join(root, 'experiments/hardware/g3/origin-query.js')).loadOriginCase(old.buildId);
        return { old, stock, origin };
    }));
    const provider = await observeProvider(root, cases[0].stock), builds = [];
    const adapterFiles = reference.originAdapterFiles.map(file => ({ path: file.path, hash: hash(fs.readFileSync(path.join(root, file.path))) }));
    for (const { old, stock, origin } of cases) {
        assert.equal(stock.analysis.sourceModelIdentity, old.sourceModelIdentity);
        const stockProof = verifyAnalysis(stock.analysis, provider.providerIdentity, reference.provider.identity, old.analysisId);
        assert.equal(stockProof.oldCorrespondenceId, old.correspondenceId);
        const request = origin.request;
        const sourceAnalysis = await require(path.join(root, 'src/hardware/correspondence')).attachCorrespondence({ registry: request.registry,
            importResult: request.importResult, sources: request.files.filter(file => file.kind === 'source')
                .map(file => ({ pathRef: file.pathRef, contentHash: file.contentHash, revision: file.contentHash })) });
        const sourceProof = verifyAnalysis(sourceAnalysis, provider.providerIdentity, reference.provider.identity, old.originSourceAnalysisId);
        const bundle = origin.analysis.bundle;
        assert.equal(bundle.adapterIdentity, hash(stable({ files: adapterFiles, sourceAnalysisId: sourceAnalysis.id })));
        assert.equal(bundle.id, sealed('origin-bundle', withoutId(bundle)));
        const oldAdapterIdentity = hash(stable({ files: reference.originAdapterFiles, sourceAnalysisId: sourceProof.oldAnalysisId }));
        assert.equal(oldAdapterIdentity, old.originAdapterIdentity);
        const oldBundleId = sealed('origin-bundle', { ...withoutId(bundle), adapterIdentity: oldAdapterIdentity });
        assert.equal(oldBundleId, old.originBundleId, 'Complete known-contributor facts changed');
        const originId = id => sealed('origin-analysis', { snapshot: request.importResult.snapshot.id, bundle: id });
        assert.equal(origin.analysis.id, originId(bundle.id)); assert.equal(originId(oldBundleId), old.originAnalysisId);
        builds.push({ buildId: old.buildId, ...stockProof, currentOriginAnalysisId: origin.analysis.id, oldOriginAnalysisId: old.originAnalysisId,
            currentOriginBundleId: bundle.id, oldOriginBundleId: oldBundleId, currentOriginAdapterIdentity: bundle.adapterIdentity, oldOriginAdapterIdentity: oldAdapterIdentity,
            sourceProof, stockClaimCount: stock.analysis.correspondence.claims.length, originClaimCount: bundle.claims.length });
    }
    for (const field of ['currentAnalysisId', 'currentCorrespondenceId', 'currentOriginAnalysisId', 'oldAnalysisId', 'oldCorrespondenceId', 'oldOriginAnalysisId'])
        assert.equal(new Set(builds.map(build => build[field])).size, builds.length, `Identity mapping is not bijective: ${field}`);
    return { provider, adapterFiles, builds };
}

function querySeal(row) {
    const q = row.input, result = row.result, { stopReasons, ...limits } = result.limits;
    const source = SOURCE_KINDS.includes(q.kind);
    assert.ok(source || result.seed.positions.length > 0, 'Pinned75 contains no electrical cell-candidate seeds');
    return sealed('analysis-query', identity({ kind: q.kind, context: result.context, ownerInstanceId: q.ownerInstanceId ?? null,
        implementationOccurrenceId: q.implementationOccurrenceId, seed: result.seed, scope: q.scope, direction: q.direction ?? null,
        semanticsProfile: q.semanticsProfile ?? null, ...(source ? { mode: q.mode || 'build' } : {}), limits, candidates: [] }));
}
const resultSeal = result => sealed('analysis-result', identity(withoutId(result)));
function rebaseCapture(reference, baseline, current, proof) {
    assert.equal(current.requests.length, 75); assert.equal(current.queries.length, 75);
    assert.deepEqual(current.queries.map(({ buildId, label, input }) => ({ buildId, label, input })), current.requests);
    const copy = JSON.parse(JSON.stringify(current)), changedPaths = [];
    function swap(object, field, actual, historical, location) {
        assert.equal(object[field], actual, `Foreign context identity: ${location}`);
        object[field] = historical; changedPaths.push({ path: location, actual, historical });
    }
    const byBuild = new Map(proof.builds.map(build => [build.buildId, build]));
    assert.deepEqual(copy.identities.map(row => row.buildId), baseline.identities.map(row => row.buildId));
    for (const [index, row] of copy.identities.entries()) {
        const p = byBuild.get(row.buildId); assert.ok(p);
        for (const provider of ['stock', 'instrumented']) swap(row[provider], 'analysisId', p.currentAnalysisId, p.oldAnalysisId, `/identities/${index}/${provider}/analysisId`);
        swap(row.instrumented, 'originAnalysisId', p.currentOriginAnalysisId, p.oldOriginAnalysisId, `/identities/${index}/instrumented/originAnalysisId`);
    }
    for (const [index, row] of copy.requests.entries()) {
        const p = byBuild.get(row.buildId); assert.ok(p);
        swap(row.input, 'analysisId', p.currentAnalysisId, p.oldAnalysisId, `/requests/${index}/input/analysisId`);
    }
    assert.deepEqual(copy.requests, baseline.requests, 'Semantic query request changed');
    for (const [index, row] of copy.queries.entries()) {
        const r = row.result, p = byBuild.get(row.buildId), expected = reference.queries[index], prefix = `/queries/${index}`;
        assert.equal(row.buildId, expected.buildId); assert.equal(row.label, expected.label);
        assert.equal(r.queryId, querySeal(row), 'Current query seal invalid'); assert.equal(r.id, resultSeal(r), 'Current result seal invalid');
        swap(row.input, 'analysisId', p.currentAnalysisId, p.oldAnalysisId, `${prefix}/input/analysisId`);
        swap(r.context, 'analysisId', p.currentAnalysisId, p.oldAnalysisId, `${prefix}/result/context/analysisId`);
        if (r.context.originAnalysisId !== null) swap(r.context, 'originAnalysisId', p.currentOriginAnalysisId, p.oldOriginAnalysisId, `${prefix}/result/context/originAnalysisId`);
        const stock = r.correspondence?.stock;
        if (stock && Object.hasOwn(stock, 'analysisId')) {
            swap(stock, 'analysisId', p.currentAnalysisId, p.oldAnalysisId, `${prefix}/result/correspondence/stock/analysisId`);
            swap(stock, 'correspondenceId', p.currentCorrespondenceId, p.oldCorrespondenceId, `${prefix}/result/correspondence/stock/correspondenceId`);
        }
        for (const [name, values] of [['evidenceRefs', r.evidenceRefs], ['correspondence/stock/explanations', stock?.explanations || []]])
            for (const [position, value] of values.entries()) if (Object.hasOwn(value, 'analysisId'))
                swap(value, 'analysisId', p.currentAnalysisId, p.oldAnalysisId, `${prefix}/result/${name}/${position}/analysisId`);
        const oldQueryId = querySeal(row); assert.equal(oldQueryId, expected.queryId, 'Historical query material changed');
        swap(r, 'queryId', r.queryId, oldQueryId, `${prefix}/result/queryId`);
        const oldResultId = resultSeal(r); assert.equal(oldResultId, expected.resultId, 'Historical result material changed');
        swap(r, 'id', r.id, oldResultId, `${prefix}/result/id`);
    }
    const result = compare(baseline, copy);
    assert.equal(result.fullCapture.sha256, CAPTURE_SHA);
    return { ...result, changedPaths, rebased: copy };
}

function runtime(root) {
    const files = [];
    const add = file => { const bytes = fs.readFileSync(path.join(root, file)); files.push({ path: file, bytes: bytes.length, sha256: hash(bytes) }); };
    function walk(directory) { for (const entry of fs.readdirSync(path.join(root, directory), { withFileTypes: true })) {
        const file = `${directory}/${entry.name}`; assert.ok(!entry.isSymbolicLink()); if (entry.isDirectory()) walk(file); else add(file);
    } }
    for (const directory of ['src/hardware', 'src/architecture']) walk(directory);
    for (const file of [REFERENCE, 'experiments/hardware/g6-usability/semantic.cjs', 'experiments/hardware/g6/semantic.cjs',
        'experiments/hardware/g5-readability/semantic-details.cjs', 'experiments/hardware/g4/server.js',
        'experiments/hardware/g3/query.js', 'experiments/hardware/g3/origin-query.js']) add(file);
    return files.sort((a, b) => a.path.localeCompare(b.path));
}
async function replay({ root = ROOT, output = process.env.G6_OUTPUT_DIR || createRun('usability-semantic') } = {}) {
    const { reference, baseline } = loadReference(root), before = runtime(root), startedAt = new Date().toISOString();
    const report = { schema: 'g6-usability-cross-build-semantic-v1', status: 'FAIL', startedAt, environment: { node: process.version, platform: process.platform, arch: process.arch },
        reference: { path: REFERENCE, sha256: REFERENCE_SHA }, originalCaptureSha256: CAPTURE_SHA, runtimeBefore: before,
        exclusions: baseline.exclusions, oldExternalArchiveRequired: false, compilerExecuted: false };
    try {
        const current = await capture(root), proof = await proveIdentities(reference, root);
        write(output, 'current.capture.json', current); write(output, 'identity-proof.json', proof);
        try { compare(baseline, current); report.originalStrictComparison = { status: 'PASS' }; }
        catch (error) { report.originalStrictComparison = { status: 'FAIL', error: error.stack }; }
        const result = rebaseCapture(reference, baseline, current, proof);
        write(output, 'identity-mapping.json', { changedPaths: result.changedPaths, fullCapture: result.fullCapture });
        report.runtimeAfter = runtime(root); assert.deepEqual(report.runtimeAfter, before, 'Query runtime changed during cross-build replay');
        loadReference(root);
        Object.assign(report, { status: 'PASS', queries: current.queries.length, mappedIdentityPaths: result.changedPaths.length,
            fullRebasedCapture: result.fullCapture, currentCapture: { bytes: encode(current).length, sha256: hash(encode(current)) },
            meaning: 'Complete ordered query/result/source equality after verified build identity rebasing; original strict byte-identity failure remains separate.' });
    } catch (error) { report.error = error.stack || String(error); }
    report.finishedAt = new Date().toISOString(); write(output, 'semantic.json', report);
    console.log(JSON.stringify({ output, status: report.status, originalStrictComparison: report.originalStrictComparison?.status,
        queries: report.queries, mappedIdentityPaths: report.mappedIdentityPaths, fullRebasedCapture: report.fullRebasedCapture, error: report.error }));
    assert.equal(report.status, 'PASS', 'Cross-build semantic replay failed; see semantic.json'); return report;
}
if (require.main === module) {
    const [mode] = process.argv.slice(2);
    if (mode === '--help') console.log('Usage: node experiments/hardware/g6-usability/semantic.cjs --replay\nOriginal strict baseline remains immutable. Replays current public queries and verifies complete facts across authenticated build identities.');
    else { assert.ok(!mode || mode === '--replay'); replay().catch(error => { console.error(error); process.exitCode = 1; }); }
}
module.exports = { loadReference, proveIdentities, verifyAnalysis, querySeal, resultSeal, rebaseCapture, replay };
