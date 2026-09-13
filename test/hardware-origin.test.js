'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const os = require('node:os');
const { once } = require('node:events');
const hardware = require('../src/hardware');
const origin = require('../src/hardware/correspondence/origin');
const root = path.resolve(__dirname, '..');
const base = 'docs/hardware/evidence/g3-origin-ghc96';
const hash = value => crypto.createHash('sha256').update(value).digest('hex');

async function requestFor(key = 'A', extraRoot = null) {
    const registry = hardware.createArtifactRegistry({ artifactRoots: [path.join(root, base), ...(extraRoot ? [extraRoot] : [])], sourceRoots: [path.join(root, base, 'inputs/fixtures')] });
    const sidecarRef = `${base}/results/origin-sidecar.json`;
    const sidecarText = await fs.readFile(path.join(root, sidecarRef), 'utf8');
    const payload = JSON.parse(sidecarText);
    await registry.registerArtifact({ pathRef: sidecarRef, path: path.join(root, sidecarRef) });
    const refs = new Set(['inputs/build-inputs.json', 'inputs/execution-identities.json',
        'receipts/instrumented-compile-final.json', 'receipts/instrumented-compile-final.log']);
    for (const item of payload.sourceOrigins) refs.add(item.pathRef);
    for (const label of Object.keys(payload.artifacts)) {
        refs.add(`results/instrumented/${label}/design.json`);
        const rtlDirectory = `results/instrumented/${label}/rtl`;
        for (const name of await fs.readdir(path.join(root, base, rtlDirectory))) if (name.endsWith('.v')) refs.add(`${rtlDirectory}/${name}`);
    }
    for (const link of payload.links) for (const capture of link.readerTransport) refs.add(capture.path);
    const files = [];
    for (const captureRef of [...refs].sort()) {
        const pathRef = `${base}/${captureRef}`, text = await fs.readFile(path.join(root, pathRef), 'utf8');
        const kind = captureRef.startsWith('inputs/fixtures/') ? 'source' : 'artifact';
        if (kind === 'source') await registry.registerSource({ pathRef, path: path.join(root, pathRef), contentHash: hash(text), capture: true });
        else await registry.registerArtifact({ pathRef, path: path.join(root, pathRef) });
        files.push({ captureRef, pathRef, contentHash: hash(text), kind });
    }
    const artifactRef = `${base}/results/instrumented/${key}/design.json`;
    const imported = await hardware.importArtifact({ registry, artifactRef, expectedArtifactHash: payload.artifacts[key] });
    return { registry, importResult: imported,
        sidecar: { pathRef: sidecarRef, contentHash: hash(sidecarText) }, files,
        authority: { provider: payload.provider, compilerBinarySha256: payload.compilerBinarySha256,
            patchSha256: payload.patchSha256, originAdapterSha256: payload.originAdapterSha256,
            sourcePin: payload.sourcePin, kind: 'caller-approved-instrumented-capture' } };
}

test('actual compiler roots reach product leaf contributors, never complete origin sets', async () => {
    const request = await requestFor('A'), before = JSON.stringify(request.importResult);
    const analysis = await origin.attachOrigins(request);
    assert.ok(Object.isFrozen(analysis) && Object.isFrozen(analysis.bundle));
    const result = origin.sourceToImplementation(analysis, { occurrencePath: ['mkConnected', 'left'], contribution: 'known' });
    assert.equal(result.resolution, 'resolved');
    assert.deepEqual(result.claims.map(c => c.source.text).sort(), ['state <- mkReg(0)', 'value + 1']);
    for (const claim of result.claims) {
        assert.equal(claim.completeOriginSet, false);
        assert.ok(claim.source.semanticId);
        const cell = request.importResult.implementation.cells[claim.target.entityId];
        assert.ok(['$add', '$dff'].includes(cell.type));
        assert.equal(origin.implementationToSource(analysis, { entityId: cell.id }).claims[0].source.token, claim.source.token);
        assert.equal(origin.explainMapping(analysis, claim.id).compiler.trace.length, 34);
    }
    assert.equal(origin.sourceToImplementation(analysis, { contribution: 'complete' }).claims.length, 0);
    assert.equal(origin.getCoverage(analysis).completeOriginSetObjects, 0);
    assert.equal(JSON.stringify(request.importResult), before);
});

test('origin query preserves repeated occurrences and concrete widths', async () => {
    const a = await origin.attachOrigins(await requestFor('A'));
    assert.equal(origin.sourceToImplementation(a, { contribution: 'known' }).resolution, 'ambiguous');
    const left = origin.sourceToImplementation(a, { occurrencePath: ['mkConnected', 'left'] });
    const right = origin.sourceToImplementation(a, { occurrencePath: ['mkConnected', 'right'] });
    assert.ok(left.claims.every(c => right.claims.every(r => c.target.entityId !== r.target.entityId)));
    const request = await requestFor('C'), c = await origin.attachOrigins(request);
    for (const [name, width] of [['narrow', 8], ['wide', 12]]) {
        const result = origin.sourceToImplementation(c, { occurrencePath: ['mkReuse', name] });
        assert.equal(result.claims.length, 2);
        const storage = result.claims.find(r => r.source.kind === 'binding');
        const cell = request.importResult.implementation.cells[storage.target.entityId];
        assert.equal(cell.raw.connections.Q.length, width);
    }
    assert.equal(origin.sourceToImplementation(c, { occurrencePath: ['mkReuse', 'wide', 'implementation'] }).claims.length, 0);
});

test('imported origin annotations cannot self-promote or contradict capture identity', async () => {
    const request = await requestFor('A');
    await assert.rejects(origin.attachOrigins({ ...request, authority: { ...request.authority, provider: 'self-declared-exact' } }));
    await assert.rejects(origin.attachOrigins({ ...request, sidecar: { ...request.sidecar, contentHash: '0'.repeat(64) } }));
    const analysis = await origin.attachOrigins(request);
    const forged = structuredClone(analysis.bundle);
    forged.claims[0].completeOriginSet = true;
    assert.throws(() => origin.validateBundle(forged, analysis));
});

test('origin input order is not identity, and capture authority includes the actual product adapter', async () => {
    const request = await requestFor();
    const first = await origin.attachOrigins(request);
    const reordered = await origin.attachOrigins({ ...request, files: [...request.files].reverse() });
    assert.equal(first.id, reordered.id);
    assert.equal(first.bundle.id, reordered.bundle.id);
    assert.match(first.bundle.adapterIdentity, /^[a-f0-9]{64}$/);
});

test('hash-valid unrelated source and self-promoted partial origin payloads fail semantic validation', async t => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bsv-origin-negative-'));
    t.after(() => fs.rm(directory, { recursive: true, force: true }));
    const request = await requestFor('A', directory);
    const text = await fs.readFile(path.join(root, base, 'results/origin-sidecar.json'), 'utf8');
    for (const [name, mutate] of [
        ['unrelated-source', value => { value.sourceOrigins[0] = { ...value.sourceOrigins[2], token: value.sourceOrigins[0].token }; }],
        ['complete-set', value => { value.links[0].completeOriginSet = true; }],
        ['partial-promoted', value => { const link = value.links.find(l => l.status === 'partial-observed-token-transport'); link.status = 'verified-known-contributor'; link.gaps = []; }],
        ['wrong-occurrence', value => { value.links[0].implementationOccurrences = [['mkConnected', 'other']]; }],
        ['unknown-exact', value => { value.claims = [{ status: 'exact', completeOriginSet: true }]; }]
    ]) {
        const value = JSON.parse(text); mutate(value);
        const content = JSON.stringify(value), file = path.join(directory, `${name}.json`);
        await fs.writeFile(file, content);
        await request.registry.registerArtifact({ pathRef: name, path: file });
        await assert.rejects(origin.attachOrigins({ ...request, sidecar: { pathRef: name, contentHash: hash(content) } }),
            { code: 'ORIGIN_CONTRADICTION' });
    }
});

test('origin gate rejects duplicate imported link identities before publication', async t => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bsv-origin-duplicates-'));
    t.after(() => fs.rm(directory, { recursive: true, force: true }));
    const request = await requestFor('A', directory);
    const payload = JSON.parse(await fs.readFile(path.join(root, base, 'results/origin-sidecar.json'), 'utf8'));
    payload.links.push(payload.links.find(link => link.target.module === 'mkStage'));
    const content = JSON.stringify(payload), file = path.join(directory, 'duplicate.json');
    await fs.writeFile(file, content);
    await request.registry.registerArtifact({ pathRef: 'duplicate-origin', path: file });
    const session = origin.createOriginSession(), initial = await session.attach(request);
    t.after(() => session.cancel());
    await assert.rejects(session.attach({ ...request, sidecar: {
        pathRef: 'duplicate-origin', contentHash: hash(content)
    } }), { code: 'ORIGIN_CONTRADICTION' });
    assert.equal(session.getState().current, initial);
    assert.equal(new Set(initial.bundle.claims.map(claim => claim.id)).size, initial.bundle.claims.length);
});

test('origin gate bounds nested sidecars and rejects hostile keys with valid byte hashes', async t => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bsv-origin-bounds-'));
    t.after(() => fs.rm(directory, { recursive: true, force: true }));
    const request = await requestFor('A', directory);
    const original = await fs.readFile(path.join(root, base, 'results/origin-sidecar.json'), 'utf8');
    for (const [name, coverage, code] of [
        ['prototype-key', JSON.parse('{"__proto__":{"exact":true}}'), 'INVALID_INPUT'],
        ['constructor-key', JSON.parse('{"constructor":{"prototype":{"exact":true}}}'), 'INVALID_INPUT'],
        ['deep', JSON.parse('{"next":'.repeat(1000) + '{}' + '}'.repeat(1000)), 'LIMIT_EXCEEDED']
    ]) {
        const payload = JSON.parse(original);
        payload.coverage = coverage;
        const content = JSON.stringify(payload), file = path.join(directory, `${name}.json`);
        await fs.writeFile(file, content);
        await request.registry.registerArtifact({ pathRef: name, path: file });
        await assert.rejects(origin.attachOrigins({ ...request, sidecar: { pathRef: name, contentHash: hash(content) } }), { code });
    }
});

test('origin gate distinguishes foreign source revisions from valid unmapped selections', async () => {
    const request = await requestFor('A'), analysis = await origin.attachOrigins(request);
    const selection = { occurrencePath: ['mkConnected', 'left'], mode: 'current-source' };
    const foreign = origin.sourceToImplementation(analysis, { ...selection, sourceRevision: '0'.repeat(64) });
    assert.equal(foreign.resolution, 'stale');
    assert.equal(foreign.claims.length, 0);
    assert.equal(foreign.unresolved[0].reason, 'source-revision-not-in-build');
    for (const sourceRevision of ['not-a-revision', '', null, 1]) {
        assert.throws(() => origin.sourceToImplementation(analysis, { ...selection, sourceRevision }), { code: 'INVALID_INPUT' });
    }
    const sourceRevision = analysis.bundle.claims[0].source.revision;
    assert.equal(origin.sourceToImplementation(analysis, { ...selection, sourceRevision }).resolution, 'resolved');
    assert.equal(origin.sourceToImplementation(analysis, {
        ...selection, sourceRevision, semanticId: 'unknown-semantic-record'
    }).resolution, 'unmapped');
    const reverse = origin.implementationToSource(analysis, {
        entityId: analysis.bundle.claims[0].target.entityId, sourceRevision: '0'.repeat(64)
    });
    assert.equal(reverse.resolution, 'stale');
});

test('origin attachment cancellation terminates its real worker and preserves existing analysis', async () => {
    const request = await requestFor();
    const before = JSON.stringify(request.importResult), initial = await origin.attachOrigins(request);
    const controller = new AbortController(), phases = [];
    await assert.rejects(origin.attachOrigins({ ...request, signal: controller.signal, onProgress(event) {
        phases.push(event);
        if (event.phase === 'origin-validating') controller.abort();
    } }), { code: 'CANCELLED' });
    assert.equal(phases[0].phase, 'origin-validating');
    assert.ok(phases[0].threadId > 0);
    assert.equal(phases.at(-1).phase, 'exited');
    assert.equal(JSON.stringify(request.importResult), before);
    assert.equal(origin.sourceToImplementation(initial, { occurrencePath: ['mkConnected', 'left'] }).claims.length, 2);
});

test('origin session publishes only latest validated analysis and retains it on invalid or cancelled work', async t => {
    const request = await requestFor();
    const session = origin.createOriginSession();
    t.after(() => session.cancel());
    const initial = await session.attach(request);
    await assert.rejects(session.attach({ ...request, authority: { ...request.authority, provider: 'unknown' } }));
    assert.equal(session.getState().current, initial);
    const started = once(session, 'worker', { signal: AbortSignal.timeout(10000) });
    const older = session.attach(request).catch(error => error);
    assert.equal((await started)[0].phase, 'origin-validating');
    const latest = await session.attach(request);
    assert.equal((await older).code, 'SUPERSEDED');
    assert.equal(session.getState().current, latest);
    const cancelling = once(session, 'worker', { signal: AbortSignal.timeout(10000) });
    const pending = session.attach(request).catch(error => error);
    await cancelling;
    await session.cancel();
    assert.equal((await pending).code, 'CANCELLED');
    assert.equal(session.getState().current, latest);
});

test('cancellation during final source refresh cannot publish an origin result', async () => {
    const request = await requestFor(), controller = new AbortController();
    const readSource = request.registry.readSource.bind(request.registry);
    let workerExited = false;
    request.registry.readSource = async ref => {
        const result = await readSource(ref);
        if (workerExited) controller.abort();
        return result;
    };
    await assert.rejects(origin.attachOrigins({ ...request, signal: controller.signal,
        onProgress(event) { if (event.phase === 'exited') workerExited = true; } }), { code: 'CANCELLED' });
    assert.equal(workerExited, true);
});

test('in-flight origin attachment owns its initial snapshot reference', async () => {
    const request = await requestFor('A'), other = await requestFor('B');
    const expected = request.importResult.snapshot.id;
    const pending = origin.attachOrigins(request);
    request.importResult = other.importResult;
    const analysis = await pending;
    assert.equal(analysis.bundle.implementationSnapshotId, expected);
    assert.equal(origin.sourceToImplementation(analysis, { occurrencePath: ['mkConnected', 'left'] }).claims.length, 2);
});

module.exports = { requestFor };
