'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { createCatalog, createServer } = require('../experiments/hardware/g4/server');
const { loadCapturedCase } = require('../experiments/hardware/g3/query');

test('analysis context uses the same registered build and snapshot as the actual scene host', async t => {
    const server = await createServer();
    t.after(() => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())));
    const listening = once(server, 'listening', { signal: AbortSignal.timeout(30000) });
    server.listen(0, '127.0.0.1');
    await listening;
    const base = `http://127.0.0.1:${server.address().port}`;
    const catalog = await (await fetch(`${base}/api/catalog`)).json();
    const contextResponse = await fetch(`${base}/api/analysis-context?build=${encodeURIComponent(catalog[0].buildId)}&provider=stock`);
    assert.equal(contextResponse.status, 200);
    const context = await contextResponse.json();
    assert.equal(context.snapshotId, catalog[0].snapshotId);
    assert.equal(context.implementationProvider, 'stock');
    assert.ok(context.analysisId);
});

test('registered analysis source opens through HTTP without granting arbitrary file authority', async t => {
    const catalog = await createCatalog(), query = catalog.find(q => q.getCatalogEntry().buildId === 'A');
    const captured = await loadCapturedCase('A'), entry = query.getCatalogEntry();
    const behavior = captured.analysis.sourceModel.stateBehaviors.find(b => b.ownerInstanceId === entry.rootInstanceId && b.name === 'put');
    const context = query.getAnalysisContext('stock');
    const server = await createServer({ catalog });
    t.after(() => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())));
    const listening = once(server, 'listening', { signal: AbortSignal.timeout(30000) });
    server.listen(0, '127.0.0.1'); await listening;
    const base = `http://127.0.0.1:${server.address().port}`;
    const input = { kind: 'behavior', analysisId: context.analysisId, snapshotId: context.snapshotId,
        implementationProvider: 'stock', ownerInstanceId: entry.rootInstanceId,
        implementationOccurrenceId: captured.request.importResult.implementation.roots[0],
        seed: { entityId: behavior.id }, scope: { kind: 'design', rootOccurrenceId: captured.request.importResult.implementation.roots[0] },
        queryGeneration: 1 };
    const response = await fetch(`${base}/api/analysis?build=A&query=${encodeURIComponent(JSON.stringify(input))}`);
    assert.equal(response.status, 200);
    const result = await response.json(), ref = result.sourceRefs.find(r => r.semanticId === behavior.id);
    assert.ok(ref);
    const url = (reference, build = 'A') => `${base}/api/source?build=${build}&reference=${encodeURIComponent(JSON.stringify(reference))}`;
    const opened = await fetch(url(ref));
    assert.equal(opened.status, 200);
    assert.deepEqual(await opened.json(), JSON.parse(JSON.stringify(query.getSource(ref))));
    for (const [reference, status] of [
        [{ ...ref, id: 'unregistered-source' }, 400],
        [{ ...ref, range: { ...ref.range, end: ref.range.end + 1 } }, 400],
        [{ ...ref, sliceHash: '0'.repeat(64) }, 400],
        [{ ...ref, revision: '0'.repeat(64) }, 409],
        [{ ...ref, pathRef: '../../private' }, 409]
    ]) assert.equal((await fetch(url(reference))).status, status);
    assert.equal((await fetch(url(ref, 'B'))).status, 400);
    assert.equal((await fetch(url(ref, 'unknown'))).status, 404);
    assert.equal((await fetch(url(ref), { headers: { Origin: 'https://foreign.example' } })).status, 403);
    assert.equal((await fetch(url(ref), { method: 'POST' })).status, 405);
    assert.equal((await fetch(`${base}/api/source?build=A&reference=%7B`)).status, 400);
});
