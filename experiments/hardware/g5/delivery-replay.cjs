'use strict';

// Delivery-only capture/replay adapter. Expected answers always come from the
// shipped public CLI; replay also compares the actual localhost HTTP surface.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { once } = require('node:events');
const { collectFiles } = require('../../../scripts/zip');
const { hash } = require('../g4/validate-delivery');
const { createCatalog, createServer } = require('../g4/server');
const { loadCapturedCase } = require('../g3/query');
const { createArchitecture } = require('../../../src/hardware/architecture');
const { createAnalysisQuery, createAnalysisSession } = require('../../../src/hardware/analysis');
const { command, semantic, validateEvidence, evidenceRoot } = require('./validate-review.cjs');
const root = path.resolve(__dirname, '../../..');
const text = value => `${JSON.stringify(value, null, 2)}\n`;
function cli(buildId, requestPath) {
    const receipt = { commands: [] };
    const row = command(receipt, process.execPath, ['--no-global-search-paths', 'experiments/hardware/g5/query.cjs',
        buildId, 'query', requestPath], root, { ...process.env, NODE_OPTIONS: '--no-global-search-paths', G4_REVIEW_ROOT: root });
    return { row, result: JSON.parse(row.stdout) };
}
async function requests(catalog) {
    const result = [];
    for (const query of catalog) {
        const buildId = query.getCatalogEntry().buildId, context = query.getAnalysisContext('stock');
        const stock = await loadCapturedCase(buildId), model = stock.request.importResult.implementation;
        const architecture = createArchitecture({ importResult: stock.request.importResult, analysis: stock.analysis });
        const occurrence = model.roots[0];
        const port = Object.values(model.ports).filter(port => port.occurrenceId === occurrence && port.bits.length > 1)
            .sort((a, b) => a.id.localeCompare(b.id))[0];
        assert.ok(port, `Missing actual vector: ${buildId}`);
        const common = { analysisId: context.analysisId, snapshotId: context.snapshotId, implementationProvider: 'stock',
            implementationOccurrenceId: occurrence, ownerInstanceId: null, scope: { kind: 'design', rootOccurrenceId: occurrence }, queryGeneration: 1 };
        for (const kind of ['same-net', 'drivers-loads', 'dependencies']) result.push({ buildId,
            input: { ...common, kind, seed: { entityId: port.id, indices: [0, 1, 0] },
                ...(kind === 'dependencies' ? { direction: 'backward', semanticsProfile: 'yosys-0.68-structural-v1' } : {}) } });
        const storage = Object.values(architecture.storage).sort((a, b) => a.id.localeCompare(b.id))[0];
        assert.ok(storage);
        const owner = stock.analysis.correspondence.contexts.find(item => item.occurrenceId === storage.ownerInstanceId);
        result.push({ buildId, input: { ...common, kind: 'state-accesses', seed: { entityId: storage.id },
            ownerInstanceId: storage.ownerInstanceId, implementationOccurrenceId: owner.contextOccurrenceId || owner.implementationOccurrenceId } });
    }
    return result;
}
async function capture(directory) {
    assert.ok(directory && path.isAbsolute(directory), 'Absolute new capture directory required');
    fs.mkdirSync(directory, { recursive: false });
    const files = [], queries = [];
    const write = (relative, value) => {
        const bytes = Buffer.from(text(value)); fs.writeFileSync(path.join(directory, relative), bytes, { flag: 'wx' });
        files.push({ path: relative, bytes: bytes.length, sha256: hash(bytes) }); return relative;
    };
    for (const { buildId, input } of await requests(await createCatalog())) {
        const key = `${buildId}-${input.kind}`, request = write(`${key}.request.json`, input);
        const { result, row } = cli(buildId, path.join(directory, request));
        const resultPath = write(`${key}.result.json`, result);
        const receipt = write(`${key}.receipt.json`, { ...row, buildId, requestSha256: hash(fs.readFileSync(path.join(directory, request))),
            resultSha256: hash(fs.readFileSync(path.join(directory, resultPath))) });
        queries.push({ buildId, request, result: resultPath, receipt });
    }
    fs.writeFileSync(path.join(directory, 'index.json'), text({ schema: 'g5-delivery-evidence-v1',
        provenance: 'actual preserved A/B/C public CLI; browser evidence deliberately absent', files, queries }), { flag: 'wx' });
    return { directory, queries: queries.length, browser: 'missing', status: 'captured-not-delivery-pass' };
}
async function cancellation() {
    const stock = await loadCapturedCase('A');
    const api = createAnalysisQuery({ importResult: stock.request.importResult });
    const context = api.getContext('stock'), model = stock.request.importResult.implementation;
    const port = Object.values(model.ports).find(item => item.bits.length);
    const input = { kind: 'same-net', analysisId: context.analysisId, snapshotId: context.snapshotId,
        implementationProvider: 'stock', implementationOccurrenceId: port.occurrenceId, ownerInstanceId: null,
        seed: { entityId: port.id }, scope: { kind: 'design', rootOccurrenceId: model.roots[0] }, queryGeneration: 1 };
    const session = createAnalysisSession(api), previous = await session.query(input), order = [];
    let cancelled;
    const exited = new Promise((resolve, reject) => {
        const deadline = setTimeout(() => reject(new Error('Cancellation worker event missing')), 30000);
        session.on('worker', event => {
            if (event.revision !== 2) return;
            if (event.phase === 'ready') { order.push('ready'); cancelled = session.cancel().then(() => order.push('settled')); }
            if (event.phase === 'exited') { order.push('exit'); clearTimeout(deadline); resolve(event); }
        });
    });
    await assert.rejects(session.query({ ...input, queryGeneration: 2 }), error => error.code === 'CANCELLED' && error.metrics.workerExited);
    const exit = await exited; await cancelled;
    assert.ok(exit.cancelled); assert.equal(session.getState().current, previous); assert.deepEqual(order, ['ready', 'exit', 'settled']);
    return { status: 'pass', previousId: previous.id, workerExited: true, order };
}
async function replay() {
    const evidence = validateEvidence(collectFiles(path.join(root, evidenceRoot), { prefix: `bsv-lens/${evidenceRoot.slice(0, -1)}` }),
        { allowIncompleteBrowser: true });
    const server = await createServer();
    const listening = once(server, 'listening', { signal: AbortSignal.timeout(30000) });
    server.listen(0, '127.0.0.1'); await listening;
    const results = [];
    try {
        for (const query of evidence.queries) {
            const requestPath = path.join(root, query.request), request = JSON.parse(fs.readFileSync(requestPath));
            const expected = semantic(JSON.parse(fs.readFileSync(path.join(root, query.result))));
            const actual = semantic(cli(query.buildId, requestPath).result);
            assert.deepEqual(actual, expected, `Indexed CLI identity/ordered values/frontiers differ: ${query.request}`);
            const url = `http://127.0.0.1:${server.address().port}/api/analysis?build=${query.buildId}&query=${encodeURIComponent(JSON.stringify(request))}`;
            const response = await fetch(url, { signal: AbortSignal.timeout(30000) }); assert.equal(response.status, 200);
            assert.deepEqual(semantic(await response.json()), expected, `Public HTTP/CLI result differs: ${query.request}`);
            const sources = [];
            for (const ref of actual.sourceRefs) {
                const sourceUrl = `http://127.0.0.1:${server.address().port}/api/source?build=${query.buildId}&reference=${encodeURIComponent(JSON.stringify(ref))}`;
                const opened = await fetch(sourceUrl, { signal: AbortSignal.timeout(30000) });
                assert.equal(opened.status, 200);
                const source = await opened.json();
                assert.equal(source.id, ref.id); assert.equal(source.revision, ref.revision);
                assert.equal(source.text, ref.range.text); assert.equal(source.sliceHash, ref.sliceHash);
                assert.equal(source.readOnly, true);
                sources.push({ id: source.id, revision: source.revision, range: source.range, sliceHash: source.sliceHash });
            }
            results.push({ buildId: query.buildId, request: query.request, result: actual, sources });
        }
    } finally { await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
    return { status: 'pass', queries: results, cancellation: await cancellation() };
}
if (require.main === module) {
    const [mode, directory, ...rest] = process.argv.slice(2);
    assert.ok(!rest.length && (mode === '--capture' && directory || mode === '--replay' && !directory),
        'Usage: delivery-replay.cjs --capture NEW_ABSOLUTE_DIRECTORY | --replay');
    (mode === '--capture' ? capture(path.resolve(directory)) : replay()).then(value => console.log(text(value)))
        .catch(error => { console.error(error); process.exitCode = 1; });
}
module.exports = { capture, replay, requests, cancellation };
