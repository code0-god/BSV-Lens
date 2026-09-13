'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createArtifactRegistry } = require('../src/hardware/registry');
const { attachCorrespondence, createSourceSession, listSourceEntries } = require('../src/hardware/correspondence');
const { hash } = require('../src/hardware/json');

async function fixture(t) {
    const runs = path.resolve(__dirname, '../.build/hardware/runs');
    await fs.mkdir(runs, { recursive: true });
    const root = await fs.mkdtemp(path.join(runs, 'g6-usability-source-cache-'));
    const directory = path.join(root, 'g6');
    await fs.mkdir(directory);
    const files = { 'First.bsv': 'package First; import Second::*; module mkFirst(Value);\n'
        + 'Value child <- mkSecond; method Bit#(8) get = child.get; endmodule endpackage',
    'Second.bsv': 'package Second; interface Value; method Bit#(8) get; endinterface\n'
        + 'module mkSecond(Value); Reg#(Bit#(8)) state <- mkReg(0);\n'
        + 'rule advance; state <= state + 1; endrule\n'
        + 'method Bit#(8) get = state; endmodule endpackage' };
    for (const [name, text] of Object.entries(files)) await fs.writeFile(path.join(directory, name), text);
    t.diagnostic(`cache inputs: ${directory}`);
    async function request(names = Object.keys(files)) {
        const registry = createArtifactRegistry({ artifactRoots: [], sourceRoots: [directory] }), sources = [];
        for (const pathRef of names) {
            const contentHash = hash(await fs.readFile(path.join(directory, pathRef)));
            await registry.registerSource({ pathRef, path: path.join(directory, pathRef), contentHash });
            sources.push({ pathRef, contentHash, revision: contentHash });
        }
        return { registry, sources };
    }
    return { directory, request };
}
const facts = ({ metrics, ...value }) => value;

test('session cache reuses only verified unchanged files; changed, moved and removed documents match cold analysis', async t => {
    const f = await fixture(t), sourceSession = createSourceSession();
    t.after(() => sourceSession.dispose());
    const first = await attachCorrespondence({ ...await f.request(), sourceSession });
    assert.equal(first.metrics.parsedSourceFiles, 2);
    const repeated = await attachCorrespondence({ ...await f.request(), sourceSession });
    assert.equal(repeated.metrics.parsedSourceFiles, 0);
    assert.equal(repeated.metrics.reusedSourceFiles, 2);
    assert.deepEqual(facts(repeated), facts(first));
    await fs.appendFile(path.join(f.directory, 'Second.bsv'), '\n// Saved source revision\n');
    const updatedRequest = await f.request();
    const updated = await attachCorrespondence({ ...updatedRequest, sourceSession });
    assert.equal(updated.metrics.parsedSourceFiles, 1);
    assert.equal(updated.metrics.reusedSourceFiles, 1);
    assert.deepEqual(facts(updated), facts(await attachCorrespondence(updatedRequest)));
    await fs.rename(path.join(f.directory, 'First.bsv'), path.join(f.directory, 'Moved.bsv'));
    const movedRequest = await f.request(['Moved.bsv', 'Second.bsv']);
    const moved = await attachCorrespondence({ ...movedRequest, sourceSession });
    assert.equal(moved.metrics.parsedSourceFiles, 1);
    assert.equal(moved.metrics.reusedSourceFiles, 1);
    assert.deepEqual(facts(moved), facts(await attachCorrespondence(movedRequest)));
    const remaining = await attachCorrespondence({ ...await f.request(['Second.bsv']), sourceSession });
    assert.equal(remaining.metrics.sourceCacheFiles, 1);
    assert.ok(remaining.metrics.sourceCacheBytes <= 32 * 1024 * 1024);
});

test('cache is product-owned, session-local and never substitutes source registry authority', async t => {
    const f = await fixture(t), request = await f.request();
    const left = createSourceSession(), right = createSourceSession();
    t.after(async () => { await left.dispose(); await right.dispose(); });
    await attachCorrespondence({ ...request, sourceSession: left });
    const separate = await attachCorrespondence({ ...request, sourceSession: right });
    assert.equal(separate.metrics.parsedSourceFiles, 2);
    await assert.rejects(attachCorrespondence({ ...request, sourceSession: { ...left } }), { code: 'INVALID_INPUT' });
    await assert.rejects(attachCorrespondence({ ...request, sourceCache: [] }), { code: 'INVALID_INPUT' });
    await assert.rejects(attachCorrespondence({ ...request, sourceSession: left,
        registry: createArtifactRegistry({ artifactRoots: [], sourceRoots: [f.directory] }) }), { code: 'PATH_DENIED' });
    assert.equal((await attachCorrespondence({ ...request, sourceSession: left })).metrics.reusedSourceFiles, 2);
});

test('cancel and dispose settle on worker exit; cancelled work cannot replace the last valid cache', async t => {
    const f = await fixture(t), sourceSession = createSourceSession(), request = await f.request();
    await attachCorrespondence({ ...request, sourceSession });
    const controller = new AbortController(), events = [];
    await assert.rejects(attachCorrespondence({ ...request, sourceSession, signal: controller.signal,
        onProgress: event => { events.push(event); if (event.phase === 'building') controller.abort(); } }), { code: 'CANCELLED' });
    assert.ok(events.some(event => event.phase === 'exited' && event.cancelled));
    assert.equal((await attachCorrespondence({ ...request, sourceSession })).metrics.reusedSourceFiles, 2);
    let disposal;
    await assert.rejects(attachCorrespondence({ ...request, sourceSession, onProgress: event => {
        if (event.phase === 'building') disposal = sourceSession.dispose();
    } }), { code: 'CANCELLED' });
    await disposal;
    await assert.rejects(attachCorrespondence({ ...request, sourceSession }), { code: 'CANCELLED' });
});

test('superseded worker cannot publish cache into its replacement revision', async t => {
    const f = await fixture(t), request = await f.request(), sourceSession = createSourceSession();
    t.after(() => sourceSession.dispose());
    await attachCorrespondence({ ...request, sourceSession });
    const events = [];
    let replacement;
    await assert.rejects(attachCorrespondence({ ...request, sourceSession, onProgress: event => {
        events.push(event);
        if (event.phase === 'building') replacement = attachCorrespondence({ ...request, sourceSession });
    } }), { code: 'CANCELLED' });
    assert.ok(events.some(event => event.phase === 'exited' && event.cancelled));
    const latest = await replacement;
    assert.equal(latest.metrics.reusedSourceFiles, 2);
    assert.deepEqual(facts(latest), facts(await attachCorrespondence(request)));
});

test('cache capacity drops optimization records without dropping parsed documents', () => {
    const { createSourceParseCache } = require('../src/hardware/correspondence/source');
    const cache = createSourceParseCache(), text = 'package Types; typedef Bit#(8) Byte; endpackage';
    for (let index = 0; index < 257; index++) {
        const parsed = cache.parse({ pathRef: `Types${index}.bsv`, contentHash: hash(text), text });
        assert.equal(parsed.types[0].name, 'Byte');
    }
    const { entries, metrics } = cache.finish();
    assert.equal(entries.length, 256);
    assert.equal(metrics.sourceCacheDroppedFiles, 1);
    assert.equal(metrics.parsedSourceFiles, 257);
    assert.ok(metrics.sourceCacheBytes <= 32 * 1024 * 1024);
});

test('serialized byte overflow drops only the internal cache, never the source parser result', () => {
    const { createSourceParseCache } = require('../src/hardware/correspondence/source');
    const text = 'package Types; typedef Bit#(8) Byte; endpackage';
    const document = { pathRef: 'Types.bsv', contentHash: hash(text), text };
    const initial = createSourceParseCache(), parsed = initial.parse(document);
    const entry = initial.finish().entries[0];
    const oversized = { ...entry, bytes: Buffer.concat([entry.bytes, Buffer.alloc(32 * 1024 * 1024)]) };
    const stressed = createSourceParseCache([oversized]);
    assert.deepEqual(stressed.parse(document), parsed);
    assert.equal(stressed.finish().metrics.sourceCacheDroppedFiles, 1);
    assert.equal(stressed.finish().metrics.sourceCacheBytes, 0);
    assert.deepEqual(stressed.finish().entries, []);
});

test('index lists source modules before elaboration and explicit entry scopes dependencies without testbench-name exclusion', async t => {
    const f = await fixture(t), sourceSession = createSourceSession();
    t.after(() => sourceSession.dispose());
    await fs.writeFile(path.join(f.directory, 'Harness.bsv'), 'package Harness; import First::*; module mkHarness(Empty);\n'
        + 'Value design <- mkFirst; endmodule endpackage');
    const request = { ...await f.request(['First.bsv', 'Second.bsv', 'Harness.bsv']), sourceSession };
    const index = await listSourceEntries(request);
    assert.equal(index.status, 'complete'); assert.equal(index.sourceFiles, 3);
    assert.equal(index.entries.length, 3); assert.equal(index.metrics.parsedSourceFiles, 3);
    const candidate = index.entries.find(entry => entry.name === 'mkFirst');
    assert.equal(candidate.rootCandidate, false);
    assert.equal(index.entries.find(entry => entry.name === 'mkHarness').rootCandidate, true);
    const sourceEntry = { pathRef: candidate.pathRef, revision: candidate.revision, definitionId: candidate.definitionId };
    const selected = await attachCorrespondence({ ...request, sourceEntry });
    assert.equal(selected.metrics.reusedSourceFiles, 3);
    assert.equal(selected.sourceScope.inventoryFiles, 3);
    assert.equal(selected.sourceScope.analyzedFiles, 2);
    assert.deepEqual(selected.sourceScope.excluded.map(entry => entry.pathRef), ['Harness.bsv']);
    assert.deepEqual(selected.sourceModel.roots.map(root => root.name), ['mkFirst']);
    const plain = await attachCorrespondence(await f.request());
    assert.deepEqual(selected.sourceModel.statements, plain.sourceModel.statements);
    assert.deepEqual(selected.sourceModel.callSites, plain.sourceModel.callSites);
    assert.deepEqual(selected.sourceModel.endpoints, plain.sourceModel.endpoints);
    assert.deepEqual(selected.correspondence.claims, plain.correspondence.claims);
    assert.equal(selected.implementationSnapshotId, null);
});

test('source entry rejects foreign revision, descriptor and artifact context; arbitrary module names select by exact definition', async t => {
    const f = await fixture(t);
    await fs.writeFile(path.join(f.directory, 'Odd.bsv'), 'package Odd; module compute(Empty); endmodule endpackage');
    const request = await f.request(['Odd.bsv']), candidate = (await listSourceEntries(request)).entries[0];
    const sourceEntry = { pathRef: candidate.pathRef, revision: candidate.revision, definitionId: candidate.definitionId };
    const selected = await attachCorrespondence({ ...request, sourceEntry });
    assert.deepEqual(selected.sourceModel.roots.map(root => root.name), ['compute']);
    for (const patch of [{ pathRef: 'Other.bsv' }, { revision: '0'.repeat(64) }, { definitionId: 'def:Other:compute' }])
        await assert.rejects(attachCorrespondence({ ...request, sourceEntry: { ...sourceEntry, ...patch } }), { code: 'SOURCE_REVISION_MISMATCH' });
    await assert.rejects(attachCorrespondence({ ...request, sourceEntry: { ...sourceEntry, top: 'Other' } }), { code: 'INVALID_INPUT' });
    await assert.rejects(attachCorrespondence({ ...request, sourceEntry, importResult: {} }), { code: 'INVALID_INPUT' });
    await assert.rejects(listSourceEntries({ ...request, sourceEntry }), { code: 'INVALID_INPUT' });
});

test('function/type-only index reports found source files with no module entries', async t => {
    const f = await fixture(t);
    await fs.writeFile(path.join(f.directory, 'Types.bsv'), 'package Types; typedef Bit#(8) Byte;\n'
        + 'function Byte twice(Byte n); return n + n; endfunction endpackage');
    const index = await listSourceEntries(await f.request(['Types.bsv']));
    assert.equal(index.sourceFiles, 1); assert.equal(index.status, 'complete');
    assert.equal(index.entries.length, 0);
});

test('same named modules in different source packages remain separate exact entries', async t => {
    const f = await fixture(t);
    await fs.writeFile(path.join(f.directory, 'East.bsv'), 'package East; module compute(Empty); endmodule endpackage');
    await fs.writeFile(path.join(f.directory, 'West.bsv'), 'package West; module compute(Empty); endmodule endpackage');
    const request = await f.request(['East.bsv', 'West.bsv']), index = await listSourceEntries(request);
    assert.equal(index.entries.length, 2);
    assert.equal(new Set(index.entries.map(entry => entry.id)).size, 2);
    for (const { pathRef, revision, definitionId } of index.entries) {
        const analysis = await attachCorrespondence({ ...request, sourceEntry: { pathRef, revision, definitionId } });
        assert.equal(analysis.sourceModel.roots.length, 1);
        assert.equal(analysis.sourceModel.roots[0].targetDefinitionId, definitionId);
        assert.deepEqual(analysis.sourceScope.included.map(source => source.pathRef), [pathRef]);
    }
});
