'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { once, EventEmitter } = require('node:events');
const h = require('../src/hardware');
const hash = text => crypto.createHash('sha256').update(text).digest('hex');
async function setup(t) {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'hardware-g2-'));
    t.after(() => fs.rm(dir, { recursive: true, force: true }));
    const text = JSON.stringify({ modules: { top: { ports: { p: { bits: [2], direction: 'input' } } } } });
    await fs.writeFile(path.join(dir, 'design.json'), text);
    await fs.writeFile(path.join(dir, 'Main.bsv'), 'module original;\nendmodule\n');
    const registry = h.createArtifactRegistry({ artifactRoots: [dir], sourceRoots: [dir], workspaceTrusted: true });
    await registry.registerArtifact({ pathRef: 'design', path: path.join(dir, 'design.json') });
    return { dir, text, registry, request: { registry, artifactRef: 'design', manifest: { stage: 'hierarchical-rtl-proc', tops: ['top'] } } };
}
test('compiler-free worker import seals a partial snapshot with unknown inputs and separate truth contracts', async t => {
    const { request, text } = await setup(t);
    const result = await h.importArtifact(request);
    assert.equal(result.snapshot.artifact.hash, hash(text));
    assert.equal(result.snapshot.structure, 'verified');
    assert.equal(result.snapshot.inputCompleteness, 'partial');
    assert.equal(result.snapshot.sourceInputs, null);
    assert.equal(result.snapshot.toolchain, null);
    assert.equal(result.availability.freshness, 'unknown');
    assert.deepEqual(result.contracts.correspondence, { status: 'not-attached' });
    assert.ok(Object.isFrozen(result.snapshot));
    assert.ok(Object.isFrozen(result.implementation.ports));
});
test('worker cancellation is observable, awaited and retains the last successful snapshot', async t => {
    const { request } = await setup(t);
    const session = h.createImportSession();
    const previous = await session.import(request);
    const started = once(session, 'worker', { signal: AbortSignal.timeout(5000) });
    const pending = session.import(request);
    const rejection = assert.rejects(pending, { code: 'CANCELLED' });
    const [event] = await started;
    assert.equal(event.phase, 'importing');
    await session.cancel();
    await rejection;
    assert.equal(session.getState().current, previous);
    assert.equal(session.getState().status, 'cancelled');
});

function completeManifest(extra = {}) {
    return { stage: 'hierarchical-rtl-proc', tops: ['top'], sourceInputs: [], dependencyFingerprint: hash('dependencies'),
        toolchain: [{ name: 'yosys', version: 'declared-only', identity: hash('binary') }], passSequence: ['proc'],
        buildOptionsFingerprint: hash('options'), concreteParameters: {}, ...extra };
}
test('identity uses every declared build input and actual bytes; registry host paths, labels and freshness do not identify a build', async t => {
    const { request, dir, registry, text } = await setup(t);
    const manifest = completeManifest();
    const base = await h.importArtifact({ ...request, manifest });
    assert.equal(base.snapshot.inputCompleteness, 'complete');
    assert.equal(base.availability.status, 'ready');
    const variants = [{ sourceInputs: [{ pathRef: 'missing', contentHash: hash('source'), role: 'source' }] },
        { dependencyFingerprint: hash('other dependency') }, { toolchain: [{ name: 'yosys', version: 'other', identity: hash('other binary') }] },
        { passSequence: ['proc', 'opt'] }, { buildOptionsFingerprint: hash('other options') }, { concreteParameters: { N: '32' } },
        { stage: 'other-declared-stage' }];
    for (const extra of variants) {
        const result = await h.importArtifact({ ...request, manifest: { ...manifest, ...extra } });
        assert.notEqual(result.snapshot.id, base.snapshot.id);
        assert.notEqual(result.snapshot.buildInputFingerprint, base.snapshot.buildInputFingerprint);
    }
    await fs.writeFile(path.join(dir, 'copy.json'), text);
    await registry.registerArtifact({ pathRef: 'other-label', path: path.join(dir, 'copy.json') });
    const copy = await h.importArtifact({ ...request, artifactRef: 'other-label', manifest });
    assert.equal(copy.snapshot.id, base.snapshot.id);
    assert.ok(!JSON.stringify(copy).includes(dir));
    await fs.writeFile(path.join(dir, 'copy.json'), `${text}\n`);
    const bytesChanged = await h.importArtifact({ ...request, artifactRef: 'other-label', manifest });
    assert.notEqual(bytesChanged.snapshot.id, base.snapshot.id);
    assert.equal(bytesChanged.snapshot.buildInputFingerprint, base.snapshot.buildInputFingerprint);
    assert.equal((await h.importArtifact({ ...request, manifest, limits: { maxOccurrences: 10 } })).snapshot.id, base.snapshot.id);
});
test('freshness changes without rewriting sealed identity; captured UTF-16 source is distinct from a shifted current range', async t => {
    const { request, registry, dir } = await setup(t);
    const text = '\u{1f600}\nmodule original;\nendmodule\n';
    const sourcePath = path.join(dir, 'Main.bsv');
    await fs.writeFile(sourcePath, text);
    const contentHash = hash(text);
    await registry.registerSource({ pathRef: 'captured', path: sourcePath, contentHash, capture: true });
    await registry.registerSource({ pathRef: 'current-only', path: sourcePath, contentHash });
    const sourceInputs = [{ pathRef: 'captured', contentHash, role: 'source' }];
    const session = h.createImportSession();
    const first = await session.import({ ...request, manifest: completeManifest({ sourceInputs }) });
    const initialId = first.snapshot.id;
    const range = { start: 3, end: 19 };
    const current = await registry.readSource({ pathRef: 'captured', contentHash, range });
    assert.equal(current.status, 'current');
    assert.equal(current.text, text.slice(range.start, range.end));
    await fs.writeFile(sourcePath, `shifted\n${text}`);
    const captured = await registry.readSource({ pathRef: 'captured', contentHash, range });
    assert.equal(captured.status, 'captured');
    assert.equal(captured.freshness, 'stale');
    assert.equal(captured.text, current.text);
    const stale = await registry.readSource({ pathRef: 'current-only', contentHash, range });
    assert.equal(stale.status, 'stale');
    assert.equal(Object.hasOwn(stale, 'text'), false);
    await session.refresh(registry);
    assert.equal(session.getState().current.snapshot, first.snapshot);
    assert.equal(session.getState().current.snapshot.id, initialId);
    assert.equal(session.getState().current.availability.freshness, 'stale');
    assert.equal(first.availability.freshness, 'fresh');
    const retained = session.getState().current;
    await assert.rejects(session.import({ ...request, manifest: completeManifest({ sourceInputs }) }), { code: 'STALE_SOURCE' });
    assert.equal(session.getState().current, retained);
    await fs.writeFile(sourcePath, text);
    await session.refresh(registry);
    assert.equal(session.getState().current.availability.status, 'ready');
    assert.equal(session.getState().current.snapshot.id, initialId);
    await assert.rejects(registry.readSource({ pathRef: 'captured', contentHash, range: { start: 0, end: 1000 } }), { code: 'INVALID_INPUT' });
    await assert.rejects(registry.readSource({ pathRef: 'captured', contentHash, range: { start: -1, end: 0 } }), { code: 'INVALID_INPUT' });
});
test('trust never grants arbitrary paths; symlink replacement, source escape and root replacement are denied', async t => {
    const { registry, request, dir, text } = await setup(t);
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'hardware-outside-'));
    t.after(() => fs.rm(outside, { recursive: true, force: true }));
    const secret = path.join(outside, 'secret.json');
    await fs.writeFile(secret, text);
    await assert.rejects(registry.registerArtifact({ pathRef: 'external', path: secret }), { code: 'PATH_DENIED' });
    await assert.rejects(registry.registerSource({ pathRef: 'external', path: secret, contentHash: hash(text) }), { code: 'PATH_DENIED' });
    await fs.symlink(secret, path.join(dir, 'escape.json'));
    await assert.rejects(registry.registerArtifact({ pathRef: 'escape', path: path.join(dir, 'escape.json') }), { code: 'PATH_DENIED' });
    await assert.rejects(h.importArtifact({ ...request, artifactRef: secret }), { code: 'INVALID_INPUT' });
    await assert.rejects(h.importArtifact({ ...request, artifactRef: 'unregistered' }), { code: 'PATH_DENIED' });
    await fs.unlink(path.join(dir, 'design.json'));
    await fs.symlink(secret, path.join(dir, 'design.json'));
    await assert.rejects(h.importArtifact(request), { code: 'PATH_DENIED' });
    const current = await registry.readSource({ pathRef: 'unregistered', contentHash: hash(text), range: { start: 0, end: 1 } });
    assert.equal(current.status, 'unavailable');
    assert.equal(Object.hasOwn(current, 'text'), false);
    const root = path.join(dir, 'root'); await fs.mkdir(root);
    await fs.writeFile(path.join(root, 'file.json'), text);
    const pinned = h.createArtifactRegistry({ artifactRoots: [root] });
    await pinned.registerArtifact({ pathRef: 'root-artifact', path: path.join(root, 'file.json') });
    await fs.rename(root, path.join(dir, 'old-root'));
    await fs.writeFile(path.join(outside, 'file.json'), text);
    await fs.symlink(outside, root);
    await assert.rejects(pinned.readArtifact('root-artifact'), { code: 'PATH_DENIED' });
});
test('unsupported, malformed, hash-mismatched and size-limited attempts preserve the successful publication', async t => {
    const { request, dir } = await setup(t);
    const session = h.createImportSession();
    const first = await session.import(request);
    for (const [text, code] of [
        ['{', 'INVALID_INPUT'],
        [JSON.stringify({ modules: { top: { processes: { p: { root_case: {} } } } } }), 'UNSUPPORTED'],
        [JSON.stringify({ otherFormat: {} }), 'UNSUPPORTED'],
        [JSON.stringify({ modules: { top: { ports: { p: { bits: ['2'] } } } } }), 'INVALID_INPUT'],
        [JSON.stringify({ modules: { top: { ports: { p: { bits: [2], direction: 'sideways' } } } } }), 'INVALID_INPUT']
    ]) {
        await fs.writeFile(path.join(dir, 'design.json'), text);
        await assert.rejects(session.import(request), { code });
        assert.equal(session.getState().current, first);
    }
    await fs.writeFile(path.join(dir, 'design.json'), JSON.stringify({ modules: { top: {} } }));
    await assert.rejects(session.import({ ...request, expectedArtifactHash: '0'.repeat(64) }), { code: 'ARTIFACT_HASH_MISMATCH' });
    await assert.rejects(session.import({ ...request, limits: { maxBytes: 4 } }), { code: 'LIMIT_EXCEEDED' });
    await assert.rejects(session.import({ ...request, limits: { maxEntities: 1 } }), { code: 'LIMIT_EXCEEDED' });
    await assert.rejects(session.import({ ...request, limits: { maxJsonDepth: 1 } }), { code: 'LIMIT_EXCEEDED' });
    assert.equal(session.getState().current, first);
});
test('CPU cancellation waits for real worker exit; callbacks observe no partial publication', async t => {
    const { request, dir } = await setup(t);
    const session = h.createImportSession();
    const previous = await session.import(request);
    const raw = { modules: { top: { ports: { p: { bits: Array.from({ length: 30000 }, (_, i) => i + 2), direction: 'input' } },
        attributes: { payload: 'a'.repeat(4000000) } } } };
    await fs.writeFile(path.join(dir, 'design.json'), JSON.stringify(raw));
    const started = once(session, 'worker', { signal: AbortSignal.timeout(5000) });
    const controller = new AbortController();
    const events = [];
    const pending = session.import({ ...request, signal: controller.signal, onProgress: event => events.push(event) });
    const rejected = assert.rejects(pending, { code: 'CANCELLED' });
    const [event] = await started;
    assert.equal(event.phase, 'importing');
    assert.equal(session.getState().current, previous);
    const exited = once(session, 'worker', { signal: AbortSignal.timeout(5000) });
    controller.abort();
    await session.cancel();
    const [exit] = await exited;
    assert.equal(exit.phase, 'exited');
    assert.equal(exit.threadId, event.threadId);
    assert.equal(exit.cancelled, true);
    assert.equal(events.at(-1).phase, 'exited');
    await rejected;
    assert.equal(session.getState().current, previous);
});
test('new requests supersede running workers and late freshness replies cannot overwrite the latest snapshot', async t => {
    const { request, registry } = await setup(t);
    const session = h.createImportSession();
    const events = [];
    session.on('state', state => events.push(state));
    const started = once(session, 'worker', { signal: AbortSignal.timeout(5000) });
    const old = session.import(request);
    const rejected = assert.rejects(old, { code: 'SUPERSEDED' });
    await started;
    const latest = await session.import({ ...request, manifest: { ...request.manifest, stage: 'latest' } });
    await rejected;
    assert.equal(session.getState().current, latest);
    assert.ok(events.filter(s => s.current).every(s => s.current.snapshot.id === latest.snapshot.id));
    // Delay the exact freshness reply, not the filesystem or a wall-clock interval.
    const realCheck = registry.checkFreshness.bind(registry);
    let release;
    const checkEvents = new EventEmitter();
    const entered = once(checkEvents, 'requested', { signal: AbortSignal.timeout(5000) });
    registry.checkFreshness = snapshot => { checkEvents.emit('requested'); return new Promise(resolve => { release = async () => resolve(await realCheck(snapshot)); }); };
    const refreshing = session.refresh(registry);
    await entered;
    registry.checkFreshness = realCheck;
    const newest = await session.import({ ...request, manifest: { ...request.manifest, stage: 'newest' } });
    await release(); await refreshing;
    assert.equal(session.getState().current, newest);
});
test('manifest validation rejects fabricated shapes and callers cannot mutate an in-flight identity', async t => {
    const { request } = await setup(t);
    for (const extra of [{ sourceInputs: {} }, { toolchain: [] }, { dependencyFingerprint: 'not-a-hash' },
        { passSequence: 'proc' }, { concreteParameters: [] }, { sourceInputs: [{ pathRef: '/outside', contentHash: hash('a'), role: 'source' }] },
        { gitCommit: 'not-build-identity' }, { tops: ['top', 'top'] }]) {
        await assert.rejects(h.importArtifact({ ...request, manifest: { ...request.manifest, ...extra } }), { code: 'INVALID_INPUT' });
    }
    const manifest = completeManifest();
    const session = h.createImportSession();
    const pending = session.import({ ...request, manifest });
    manifest.concreteParameters.changed = 'after-call';
    manifest.stage = 'after-call';
    const result = await pending;
    assert.equal(result.snapshot.stage, 'hierarchical-rtl-proc');
    assert.deepEqual(Object.keys(result.snapshot.concreteParameters), []);
    assert.throws(() => { result.implementation.roots.push('fake'); }, TypeError);
    assert.throws(() => { result.snapshot.artifact.hash = '0'.repeat(64); }, TypeError);
    const controller = new AbortController(); controller.abort();
    await assert.rejects(h.importArtifact({ ...request, signal: controller.signal }), { code: 'CANCELLED' });
});

for (const [name, top] of [['A', 'mkConnected'], ['B', 'mkControl'], ['C', 'mkReuse']]) {
    test(`actual ${name} artifact passes registry/worker import with full reference structure`, async () => {
        const directory = path.resolve(`docs/hardware/evidence/toolchain/${name}`);
        const registry = h.createArtifactRegistry({ artifactRoots: [directory], workspaceTrusted: false });
        await registry.registerArtifact({ pathRef: `artifact-${name}`, path: path.join(directory, 'design.json') });
        const text = await fs.readFile(path.join(directory, 'design.json'), 'utf8');
        const recipe = JSON.parse(await fs.readFile(path.join(directory, 'recipe.json'), 'utf8'));
        const result = await h.importArtifact({ registry, artifactRef: `artifact-${name}`,
            manifest: { stage: recipe.stage, tops: [top] }, expectedArtifactHash: hash(text) });
        const reference = require('../experiments/hardware/importer').importYosys(text, {
            artifact: { pathRef: `artifact-${name}`, hash: hash(text) }, stage: recipe.stage, tops: [top],
            toolchain: [{ name: 'comparison', version: 'comparison', identity: 'comparison' }],
            passSequence: [], buildOptionsFingerprint: 'comparison-only' });
        const tables = ['raw', 'roots', 'definitions', 'occurrences', 'cells', 'ports', 'pins', 'bits', 'aliases', 'memories', 'boundaries', 'entities'];
        const normalize = (value, id) => JSON.parse(JSON.stringify(value).split(id).join('SNAPSHOT'));
        for (const key of tables) assert.deepEqual(normalize(result.implementation[key], result.snapshot.id), normalize(reference[key], reference.snapshot.id), key);
        assert.equal(result.snapshot.toolchain, null);
        assert.equal(result.snapshot.passSequence, null);
        assert.equal(Object.getPrototypeOf(result.implementation.raw.modules), null);
        for (const entity of Object.values(result.implementation.entities)) {
            const evidence = h.getGeneratedEvidence(result.implementation, entity.id);
            assert.deepEqual(evidence.originalBsv, { status: 'unmapped', refs: [] });
            assert.ok(evidence.generatedRtl.every(item => item.access === 'unvalidated-no-file-read'));
        }
    });
}
test('invalid newest request also supersedes an older in-flight reply', async t => {
    const { request } = await setup(t);
    const session = h.createImportSession();
    const previous = await session.import(request);
    const started = once(session, 'worker', { signal: AbortSignal.timeout(5000) });
    const old = session.import(request);
    const rejection = assert.rejects(old, { code: 'SUPERSEDED' });
    await started;
    await assert.rejects(session.import({ ...request, manifest: { stage: 'invalid', tops: [] } }), { code: 'INVALID_INPUT' });
    await rejection;
    assert.equal(session.getState().current, previous);
    assert.equal(session.getState().status, 'failed');
});

test('overlapping freshness requests publish only the newest captured filesystem result', async t => {
    const { request, registry, dir } = await setup(t);
    const sourcePath = path.join(dir, 'Main.bsv');
    const contentHash = hash(await fs.readFile(sourcePath));
    await registry.registerSource({ pathRef: 'source', path: sourcePath, contentHash });
    const session = h.createImportSession();
    const previous = await session.import({ ...request, manifest: completeManifest({ sourceInputs: [{ pathRef: 'source', contentHash, role: 'source' }] }) });
    const realCheck = registry.checkFreshness.bind(registry);
    const signals = new EventEmitter();
    const releases = [];
    registry.checkFreshness = async snapshot => {
        const result = await realCheck(snapshot);
        return new Promise(resolve => { releases.push(() => resolve(result)); signals.emit('captured'); });
    };
    const firstCapture = once(signals, 'captured', { signal: AbortSignal.timeout(5000) });
    const older = session.refresh(registry);
    await firstCapture;
    await fs.writeFile(sourcePath, 'changed source');
    const secondCapture = once(signals, 'captured', { signal: AbortSignal.timeout(5000) });
    const newer = session.refresh(registry);
    await secondCapture;
    releases[0](); await older;
    assert.equal(session.getState().current, previous, 'superseded freshness reply cannot publish');
    releases[1](); await newer;
    assert.equal(session.getState().current.availability.freshness, 'stale');
    assert.equal(session.getState().current.snapshot, previous.snapshot);
});

test('omitted manifest imports existing bytes while stage and declared tops remain explicitly unknown', async t => {
    const { request, dir } = await setup(t);
    const result = await h.importArtifact({ registry: request.registry, artifactRef: request.artifactRef });
    assert.equal(result.snapshot.stage, null);
    assert.equal(result.snapshot.tops, null);
    assert.deepEqual(result.snapshot.topSelection, { basis: 'uninstantiated-definitions', tops: ['top'] });
    assert.ok(result.snapshot.unknownInputs.includes('stage'));
    assert.ok(result.snapshot.unknownInputs.includes('tops'));
    for (const key of ['toolchain', 'passSequence', 'sourceInputs', 'dependencyFingerprint', 'buildOptionsFingerprint', 'concreteParameters']) assert.equal(result.snapshot[key], null);
    const raw = { modules: { marked: { attributes: { top: '0001' } }, other: {} } };
    await fs.writeFile(path.join(dir, 'design.json'), JSON.stringify(raw));
    const marked = await h.createImportSession().import({ registry: request.registry, artifactRef: request.artifactRef });
    assert.deepEqual(marked.snapshot.topSelection, { basis: 'artifact-top-attribute', tops: ['marked'] });
    assert.equal(marked.implementation.roots.length, 1);
    assert.equal(Object.keys(marked.implementation.definitions).length, 2);
    for (const manifest of [null, false, [], 'invalid', { stage: [] }, { tops: [] }, { tops: 3 }]) {
        await assert.rejects(h.importArtifact({ registry: request.registry, artifactRef: request.artifactRef, manifest }), { code: 'INVALID_INPUT' });
    }
});
