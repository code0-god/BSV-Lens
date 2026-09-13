'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const os = require('node:os');
const { once } = require('node:events');
const hardware = require('../src/hardware');
const correspondence = require('../src/hardware/correspondence');
const root = path.resolve(__dirname, '..');
const hash = text => crypto.createHash('sha256').update(text).digest('hex');

async function fixture(key, physicalSource = null) {
    const base = `docs/hardware/evidence/toolchain/${key}`;
    const recipe = JSON.parse(await fs.readFile(path.join(root, base, 'recipe.json'), 'utf8'));
    const raw = JSON.parse(await fs.readFile(path.join(root, base, 'design.json'), 'utf8'));
    const registry = hardware.createArtifactRegistry({ artifactRoots: [root],
        sourceRoots: [root, ...(physicalSource ? [path.dirname(physicalSource)] : [])], workspaceTrusted: false });
    const artifactRef = `${base}/design.json`;
    await registry.registerArtifact({ pathRef: artifactRef, path: path.join(root, artifactRef) });
    const source = { pathRef: recipe.source.path, contentHash: recipe.source.sha256, revision: recipe.source.sha256 };
    await registry.registerSource({ ...source, path: physicalSource || path.join(root, source.pathRef), capture: true });
    const metadataRef = `${base}/bluetcl.json`;
    const metadataText = await fs.readFile(path.join(root, metadataRef), 'utf8');
    const metadata = { pathRef: metadataRef, contentHash: hash(metadataText), provider: 'stock-bluetcl-v1',
        sourceInputs: [{ pathRef: source.pathRef, contentHash: source.contentHash }] };
    await registry.registerArtifact({ pathRef: metadataRef, path: path.join(root, metadataRef) });
    const generatedRtl = [];
    for (const name of (await fs.readdir(path.join(root, base, 'rtl'))).filter(name => name.endsWith('.v'))) {
        const pathRef = `${base}/rtl/${name}`, text = await fs.readFile(path.join(root, pathRef), 'utf8');
        await registry.registerArtifact({ pathRef, path: path.join(root, pathRef) });
        generatedRtl.push({ pathRef, contentHash: hash(text) });
    }
    const importResult = await hardware.importArtifact({ registry, artifactRef, manifest: {
        stage: recipe.stage, tops: [JSON.parse(metadataText).top],
        sourceInputs: [{ pathRef: source.pathRef, contentHash: source.contentHash, role: 'source' }]
    } });
    return { request: { registry, importResult, sources: [source], metadata, generatedRtl }, raw };
}

test('G3-A public chain matches raw ordered bindings and independent oracle without altering G2', async () => {
    const { request, raw } = await fixture('A');
    const original = JSON.stringify(request.importResult);
    const analysis = await correspondence.attachCorrespondence(request);
    assert.equal(JSON.stringify(request.importResult), original);
    assert.equal(request.importResult.snapshot.capabilities.originalBsvCorrespondence, false);
    assert.ok(Object.isFrozen(analysis) && Object.isFrozen(analysis.correspondence));
    const query = { occurrencePath: 'mkConnected.left', method: 'get', role: 'result', family: 'connectivity' };
    const result = correspondence.sourceToImplementation(analysis, query);
    assert.equal(result.resolution, 'resolved');
    const binding = result.claims.find(claim => claim.relationKind === 'ordered-port-binding');
    assert.ok(binding);
    const formal = raw.modules.mkStage.ports.get.bits;
    const actual = raw.modules.mkConnected.cells.left.connections.get;
    assert.deepEqual(binding.orderedBindings.map(bit => bit.formalValue), formal);
    assert.deepEqual(binding.orderedBindings.map(bit => bit.actualValue), actual);
    const oracle = JSON.parse(await fs.readFile(path.join(root, 'docs/hardware/evidence/bsv/representative-chain.json'), 'utf8'));
    assert.deepEqual(formal, oracle.formalBitsLsbFirst);
    assert.deepEqual(actual, oracle.actualBitsLsbFirst);
    const expectedPin = Object.values(request.importResult.implementation.pins).find(pin => {
        const cell = request.importResult.implementation.cells[pin.cellId];
        return cell.name === oracle.parentLeafEndpoints[0].cell && pin.name === oracle.parentLeafEndpoints[0].pin;
    });
    const contact = result.claims.find(claim => claim.relationKind === 'same-net-contact' &&
        claim.tuple.target.entityId === expectedPin.id);
    assert.ok(contact);
    const reverse = correspondence.implementationToSource(analysis, { entityId: expectedPin.id, ...query });
    assert.ok(reverse.claims.some(claim => claim.id === contact.id));
    const explanation = JSON.stringify(correspondence.explainMapping(analysis, contact.id));
    assert.ok(explanation.includes(contact.id));
    for (const id of contact.premises) assert.ok(explanation.includes(id));
    const origin = correspondence.implementationToSource(analysis, { entityId: expectedPin.id, family: 'origin' });
    assert.equal(origin.claims.length, 0);
    assert.ok(['unmapped', 'unsupported'].includes(origin.resolution));
    assert.equal(JSON.stringify(request.importResult), original);
});

test('reused occurrences, concrete widths and inlined scopes do not collapse into first matches', async () => {
    const a = await correspondence.attachCorrespondence((await fixture('A')).request);
    const left = correspondence.sourceToImplementation(a, { occurrencePath: 'mkConnected.left', method: 'get', family: 'connectivity' });
    const right = correspondence.sourceToImplementation(a, { occurrencePath: 'mkConnected.right', method: 'get', family: 'connectivity' });
    const leftIds = new Set(left.claims.map(claim => claim.id));
    assert.ok(right.claims.length && right.claims.every(claim => !leftIds.has(claim.id)));
    const unscoped = correspondence.sourceToImplementation(a, { method: 'get', family: 'connectivity' });
    const occurrences = new Set(unscoped.claims.map(claim => claim.tuple.source.occurrencePath).filter(Boolean));
    assert.ok(unscoped.resolution === 'ambiguous' || occurrences.size > 1);
    const { request } = await fixture('C');
    const c = await correspondence.attachCorrespondence(request);
    for (const [occurrencePath, width] of [['mkReuse.low', 8], ['mkReuse.high', 8], ['mkReuse.narrow', 8], ['mkReuse.wide', 12]]) {
        const result = correspondence.sourceToImplementation(c, { occurrencePath, method: 'get', role: 'result', family: 'connectivity' });
        const binding = result.claims.find(claim => claim.relationKind === 'ordered-port-binding');
        assert.ok(binding);
        assert.equal(binding.orderedBindings.length, width);
    }
    const inlined = correspondence.sourceToImplementation(c, { occurrencePath: 'mkReuse.wide.implementation', family: 'origin' });
    assert.equal(inlined.claims.length, 0);
    assert.ok(['unmapped', 'unsupported'].includes(inlined.resolution));
});

test('Unicode ranges preserve scalar boundaries and explicit CRLF/tab conventions', () => {
    const text = '\t한😀e\u0301\r\nnext 한글\n';
    const start = 1, end = text.indexOf('\r');
    const expected = text.slice(start, end);
    for (const range of [
        { unit: 'utf16', start, end },
        { unit: 'utf8', start: Buffer.byteLength(text.slice(0, start)), end: Buffer.byteLength(text.slice(0, end)) },
        { unit: 'codepoint', start: Array.from(text.slice(0, start)).length, end: Array.from(text.slice(0, end)).length },
        { unit: 'position', encoding: 'utf16', base: 0, start: { line: 0, column: start }, end: { line: 0, column: end } }
    ]) {
        const actual = correspondence.normalizeRange(text, range);
        assert.equal(actual.text, expected);
        assert.equal(actual.start, start); assert.equal(actual.end, end);
        assert.equal(actual.sliceHash, hash(expected));
    }
    assert.throws(() => correspondence.normalizeRange(text, { unit: 'utf16', start: 3, end }), { code: 'INVALID_RANGE' });
    assert.throws(() => correspondence.normalizeRange(text, { unit: 'utf8', start: 2, end: 4 }), { code: 'INVALID_RANGE' });
    assert.throws(() => correspondence.normalizeRange(text, { unit: 'visual-column', start: 0, end: 1 }), { code: 'UNSUPPORTED' });
});

test('wrong hashes and self-declared origin/cyclic premise claims fail without mutating G2', async () => {
    const { request } = await fixture('A');
    const before = JSON.stringify(request.importResult);
    await assert.rejects(correspondence.attachCorrespondence({ ...request, metadata: {
        ...request.metadata, contentHash: '0'.repeat(64)
    } }));
    await assert.rejects(correspondence.attachCorrespondence({ ...request, generatedRtl: request.generatedRtl.map((ref, index) =>
        index === 0 ? { ...ref, contentHash: '0'.repeat(64) } : ref) }));
    const analysis = await correspondence.attachCorrespondence(request);
    const forged = JSON.parse(JSON.stringify(analysis.correspondence));
    const claim = forged.claims.find(item => item.scope === 'connectivity');
    claim.scope = 'origin'; claim.relationKind = 'compiler-recorded-source-origin';
    claim.resolution = 'resolved'; claim.validation = 'valid';
    assert.throws(() => correspondence.validateBundle(forged, analysis));
    const cycle = JSON.parse(JSON.stringify(analysis.correspondence));
    cycle.claims[0].premises.push(cycle.claims[0].id);
    assert.throws(() => correspondence.validateBundle(cycle, analysis));
    assert.equal(JSON.stringify(request.importResult), before);
});

test('captured queries are distinct from current selection and stale attachment cannot replace a valid mapping', async t => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bsv-g3-stale-'));
    t.after(() => fs.rm(directory, { recursive: true, force: true }));
    const physicalSource = path.join(directory, 'Connected.bsv');
    const originalText = await fs.readFile(path.join(root, 'experiments/hardware/fixtures/Connected.bsv'), 'utf8');
    await fs.writeFile(physicalSource, originalText);
    const { request } = await fixture('A', physicalSource);
    const before = JSON.stringify(request.importResult);
    const session = correspondence.createCorrespondenceSession();
    t.after(() => session.cancel());
    const initial = await session.attach(request);
    const id = initial.correspondence.id;
    await fs.writeFile(physicalSource, '// whitespace still changes revision\n' + originalText);
    const historical = await correspondence.refreshFreshness(initial, request.registry);
    assert.equal(historical.correspondence.id, id);
    assert.equal(historical.freshness.status, 'captured');
    const query = { occurrencePath: 'mkConnected.left', method: 'get', family: 'connectivity' };
    assert.equal(correspondence.sourceToImplementation(historical, query).resolution, 'resolved');
    const current = correspondence.sourceToImplementation(historical, { ...query, mode: 'current-source' });
    assert.equal(current.resolution, 'stale'); assert.equal(current.claims.length, 0);
    await assert.rejects(session.attach(request), { code: 'STALE_SOURCE' });
    assert.equal(session.getState().current, initial);
    assert.equal(JSON.stringify(request.importResult), before);
});

test('active attachment cancellation and supersession settle after worker exit without changing G2', async t => {
    const { request } = await fixture('A');
    const before = JSON.stringify(request.importResult);
    const session = correspondence.createCorrespondenceSession();
    t.after(() => session.cancel());
    const initial = await session.attach(request);
    const controller = new AbortController(), phases = [];
    await assert.rejects(session.attach({ ...request, signal: controller.signal, onProgress(event) {
        phases.push(event);
        if (event.phase !== 'exited') controller.abort();
    } }), { code: 'CANCELLED' });
    assert.ok(phases[0].threadId > 0);
    assert.equal(phases.at(-1).phase, 'exited');
    assert.equal(session.getState().current, initial);
    const started = once(session, 'worker', { signal: AbortSignal.timeout(10000) });
    const old = session.attach(request).catch(error => error);
    assert.notEqual((await started)[0].phase, 'exited');
    const latest = await session.attach(request);
    assert.equal((await old).code, 'SUPERSEDED');
    assert.equal(session.getState().current, latest);
    assert.equal(JSON.stringify(request.importResult), before);
});

test('malformed attachment envelope remains a typed failure and retains previous mapping', async t => {
    const { request } = await fixture('A');
    const session = correspondence.createCorrespondenceSession();
    t.after(() => session.cancel());
    const initial = await session.attach(request);
    await assert.rejects(async () => session.attach(null), { code: 'INVALID_INPUT' });
    assert.equal(session.getState().current, initial);
});

test('shallow-frozen input cannot supply mutable aliases to a published reverse index', async () => {
    const { request } = await fixture('A');
    const genuine = await correspondence.attachCorrespondence(request);
    const contact = correspondence.sourceToImplementation(genuine, {
        occurrencePath: 'mkConnected.left', method: 'get', family: 'connectivity'
    }).claims.find(claim => claim.relationKind === 'same-net-contact');
    const query = { entityId: contact.tuple.target.entityId, family: 'connectivity' };
    const before = correspondence.implementationToSource(genuine, query);
    const shallow = structuredClone(request.importResult);
    Object.freeze(shallow.implementation);
    Object.freeze(shallow);
    await assert.rejects(correspondence.attachCorrespondence({ ...request, importResult: shallow }), { code: 'INVALID_INPUT' });
    const mutable = shallow.implementation.entities[query.entityId];
    assert.equal(Object.isFrozen(mutable), false, 'Validation must not freeze caller data as a side effect');
    mutable.kind = 'cell';
    mutable.pins = [];
    assert.deepEqual(correspondence.implementationToSource(genuine, query), before);
});

test('explicit G2 source identities cannot contradict attached compiler/source evidence', async () => {
    const { request } = await fixture('A');
    const snapshot = request.importResult.snapshot;
    for (const sourceInputs of [
        [{ pathRef: request.sources[0].pathRef, contentHash: '0'.repeat(64), role: 'source' }],
        []
    ]) {
        const inconsistent = await hardware.importArtifact({
            registry: request.registry, artifactRef: snapshot.artifact.pathRef,
            manifest: { stage: snapshot.stage, tops: snapshot.tops, sourceInputs }
        });
        const before = JSON.stringify(inconsistent);
        await assert.rejects(correspondence.attachCorrespondence({ ...request, importResult: inconsistent }),
            { code: 'SOURCE_REVISION_MISMATCH' });
        assert.equal(JSON.stringify(inconsistent), before);
    }
    const unknown = await hardware.importArtifact({ registry: request.registry, artifactRef: snapshot.artifact.pathRef });
    const analysis = await correspondence.attachCorrespondence({ ...request, importResult: unknown });
    assert.equal(unknown.snapshot.sourceInputs, null);
    assert.equal(correspondence.sourceToImplementation(analysis, {
        occurrencePath: 'mkConnected.left', method: 'get', family: 'connectivity'
    }).resolution, 'resolved');
});

test('coverage fixes actual populations and never converts stock source links into origins', async () => {
    for (const key of ['A', 'B', 'C']) {
        const { request, raw } = await fixture(key);
        const analysis = await correspondence.attachCorrespondence(request);
        const coverage = correspondence.getCoverage(analysis);
        for (const row of coverage.categories) {
            assert.equal(row.populationIds.length, row.total);
            assert.equal(new Set(row.populationIds).size, row.total);
            assert.equal(row.populationHash, hash(JSON.stringify(row.populationIds)));
            assert.equal(row.resolved + row.unmapped + row.ambiguous + row.partial + row.generated + row.removed + row.unsupported, row.total);
        }
        const origins = coverage.categories.filter(row => row.category === 'origin');
        const leafIds = Object.values(request.importResult.implementation.cells)
            .filter(cell => !cell.childOccurrenceId).map(cell => cell.id).sort();
        const leafPopulation = origins.find(row => JSON.stringify(row.populationIds) === JSON.stringify(leafIds));
        assert.ok(leafPopulation, 'Occurrence-expanded leaf population must retain exact implementation IDs');
        const aliasPopulation = origins.find(row => row.populationIds.some(id => id.includes('/netname/')));
        assert.equal(aliasPopulation.total, Object.values(raw.modules).reduce((sum, module) => sum + Object.keys(module.netnames).length, 0));
        for (const row of origins) {
            assert.equal(row.knownContributors, 0);
            assert.equal(row.completeContributorSets, 0);
            assert.equal(row.unsupported, row.total);
        }
    }
});
