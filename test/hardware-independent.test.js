'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { once } = require('node:events');
const hardware = require('../src/hardware');
const root = path.resolve(__dirname, '..');
const hash = text => crypto.createHash('sha256').update(text).digest('hex');
const simple = { modules: { top: {
    attributes: { top: '1' },
    ports: { input: { direction: 'input', bits: [2, 3] } },
    cells: { opaque: { type: 'unknown_vendor_cell', port_directions: { A: 'input' },
        connections: { A: [3, 2, '0', 'x', 'z'] }, parameters: {}, attributes: { src: '../../outside.v:1.1-1.4' } } },
    netnames: { reversed: { bits: [3, 2], offset: 4, upto: 1, signed: 1, attributes: {} } }
} } };

async function sandbox(t) {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bsv-g2-independent-'));
    t.after(() => fs.rm(directory, { recursive: true, force: true }));
    return directory;
}

async function requestFor(directory, raw = simple) {
    const file = path.join(directory, 'design.json');
    await fs.writeFile(file, JSON.stringify(raw));
    const registry = hardware.createArtifactRegistry({ artifactRoots: [directory], sourceRoots: [directory], workspaceTrusted: false });
    await registry.registerArtifact({ pathRef: 'design', path: file });
    return { registry, artifactRef: 'design' };
}

test('product imports all three real artifacts with every ordered raw connection preserved', async () => {
    const evidence = path.join(root, 'docs/hardware/evidence/toolchain');
    for (const key of ['A', 'B', 'C']) {
        const file = path.join(evidence, key, 'design.json');
        const raw = JSON.parse(await fs.readFile(file, 'utf8'));
        const registry = hardware.createArtifactRegistry({ artifactRoots: [evidence], sourceRoots: [] });
        await registry.registerArtifact({ pathRef: 'design', path: file });
        const result = await hardware.importArtifact({ registry, artifactRef: 'design' });
        const model = result.implementation;
        assert.equal(result.snapshot.structure, 'verified');
        assert.ok(Object.isFrozen(result) && Object.isFrozen(model) && Object.isFrozen(result.snapshot));
        for (const occurrence of Object.values(model.occurrences)) {
            const definition = raw.modules[model.definitions[occurrence.definitionId].name];
            assert.deepEqual(occurrence.cells.map(id => model.cells[id].name).sort(), Object.keys(definition.cells).sort());
            assert.deepEqual(occurrence.ports.map(id => model.ports[id].name).sort(), Object.keys(definition.ports).sort());
            for (const id of occurrence.ports) {
                const port = model.ports[id];
                assert.deepEqual(port.rawBits, definition.ports[port.name].bits);
                assert.deepEqual(port.bits.map(bit => model.bits[bit].value), port.rawBits);
            }
            for (const id of occurrence.cells) {
                const cell = model.cells[id], expected = definition.cells[cell.name];
                assert.equal(cell.type, expected.type);
                assert.deepEqual(JSON.parse(JSON.stringify(cell.parameters)), expected.parameters);
                assert.deepEqual(JSON.parse(JSON.stringify(cell.attributes)), expected.attributes);
                for (const pinId of cell.pins) {
                    const pin = model.pins[pinId];
                    assert.deepEqual(pin.rawBits, expected.connections[pin.name]);
                    assert.deepEqual(pin.bits.map(bit => model.bits[bit].value), pin.rawBits);
                }
            }
            for (const id of occurrence.aliases) {
                const alias = model.aliases[id];
                assert.deepEqual(alias.rawBits, definition.netnames[alias.name].bits);
                assert.deepEqual(JSON.parse(JSON.stringify(alias.raw)), definition.netnames[alias.name]);
            }
            for (const id of occurrence.boundaries) {
                const binding = model.boundaries[id];
                const parent = model.occurrences[binding.parentOccurrenceId];
                const parentDefinition = raw.modules[model.definitions[parent.definitionId].name];
                const actual = parentDefinition.cells[model.cells[occurrence.cellId].name].connections[binding.portName][binding.index];
                const formal = definition.ports[binding.portName].bits[binding.index];
                assert.equal(model.bits[binding.actualBitId].value, actual);
                assert.equal(model.bits[binding.formalBitId].value, formal);
            }
        }
        assert.equal(result.contracts.correspondence.status, 'not-attached');
    }
});

test('logical import identity survives approved-root relocation and preserves opaque constants/aliases', async t => {
    const first = await requestFor(await sandbox(t));
    const second = await requestFor(await sandbox(t));
    const [a, b] = await Promise.all([hardware.importArtifact(first), hardware.importArtifact(second)]);
    assert.equal(a.snapshot.id, b.snapshot.id);
    assert.equal(a.snapshot.inputCompleteness, 'partial');
    assert.ok(a.snapshot.unknownInputs.includes('toolchain'));
    assert.equal(a.snapshot.toolchain, null);
    const cell = Object.values(a.implementation.cells)[0];
    const pin = a.implementation.pins[cell.pins[0]];
    assert.deepEqual(pin.rawBits, [3, 2, '0', 'x', 'z']);
    assert.equal(cell.type, 'unknown_vendor_cell');
    assert.ok(Object.isFrozen(pin.rawBits));
    assert.throws(() => pin.rawBits.reverse(), TypeError);
});

test('approved roots reject traversal and symlinks; captured source never becomes shifted current text', async t => {
    const directory = await sandbox(t), safe = path.join(directory, 'safe');
    await fs.mkdir(safe);
    const outside = path.join(directory, 'outside.json');
    await fs.writeFile(outside, JSON.stringify(simple));
    await fs.symlink(outside, path.join(safe, 'escape.json'));
    const registry = hardware.createArtifactRegistry({ artifactRoots: [safe], sourceRoots: [safe], workspaceTrusted: true });
    await assert.rejects(registry.registerArtifact({ pathRef: 'outside', path: outside }), { code: 'PATH_DENIED' });
    await assert.rejects(registry.registerArtifact({ pathRef: 'traversal', path: `${safe}/../outside.json` }), { code: 'PATH_DENIED' });
    await assert.rejects(registry.registerArtifact({ pathRef: 'symlink', path: path.join(safe, 'escape.json') }), { code: 'PATH_DENIED' });
    await assert.rejects(hardware.importArtifact({ registry, artifactRef: 'unregistered' }), { code: 'PATH_DENIED' });
    const sourcePath = path.join(safe, 'source.bsv'), original = 'old source\n';
    await fs.writeFile(sourcePath, original);
    await registry.registerSource({ pathRef: 'captured', path: sourcePath, contentHash: hash(original), capture: true });
    await registry.registerSource({ pathRef: 'uncaptured', path: sourcePath, contentHash: hash(original) });
    await fs.writeFile(sourcePath, 'shifted current source\n');
    const ref = { contentHash: hash(original), range: { start: 0, end: original.length } };
    const captured = await registry.readSource({ ...ref, pathRef: 'captured' });
    assert.equal(captured.status, 'captured');
    assert.equal(captured.text, original);
    const stale = await registry.readSource({ ...ref, pathRef: 'uncaptured' });
    assert.equal(stale.status, 'stale');
    assert.equal(Object.hasOwn(stale, 'text'), false);
});

test('active cancellation and supersession settle after worker exit without replacing valid data', async t => {
    const request = await requestFor(await sandbox(t));
    const session = hardware.createImportSession();
    t.after(() => session.cancel());
    const initial = await session.import(request);
    const controller = new AbortController(), phases = [];
    await assert.rejects(session.import({ ...request, signal: controller.signal, onProgress(event) {
        phases.push(event);
        if (event.phase === 'importing') controller.abort();
    } }), { code: 'CANCELLED' });
    assert.ok(phases.some(event => event.phase === 'importing' && event.threadId > 0));
    assert.equal(phases.at(-1).phase, 'exited');
    assert.equal(session.getState().current, initial);
    const started = once(session, 'worker', { signal: AbortSignal.timeout(10000) });
    const first = session.import(request).catch(error => error);
    assert.equal((await started)[0].phase, 'importing');
    const latest = await session.import(request);
    assert.equal((await first).code, 'SUPERSEDED');
    assert.equal(session.getState().current, latest);
    const preAborted = new AbortController();
    preAborted.abort();
    await assert.rejects(hardware.importArtifact({ ...request, artifactRef: 'not-registered', signal: preAborted.signal }), { code: 'CANCELLED' });
});

test('malformed binding status is independent of provider-controlled names', async t => {
    const directory = await sandbox(t);
    for (const name of ['ordinary', 'Unsupported', 'limit', 'Artifact hash mismatch', 'vector/width']) {
        const raw = { modules: {
            top: { attributes: { top: '1' }, ports: {}, netnames: {},
                cells: { [name]: { type: 'child', connections: { missing: [2] } } } },
            child: { ports: { present: { direction: 'input', bits: [2] } }, cells: {}, netnames: {} }
        } };
        await assert.rejects(hardware.importArtifact(await requestFor(directory, raw)),
            { code: 'INVALID_INPUT' }, `Provider name must not choose status: ${name}`);
    }
});

test('malformed vectors, real width limits and unsupported processes retain distinct codes', async t => {
    const directory = await sandbox(t);
    const malformed = JSON.parse(JSON.stringify(simple));
    malformed.modules.top.ports.input.bits = null;
    await assert.rejects(hardware.importArtifact(await requestFor(directory, malformed)), { code: 'INVALID_INPUT' });
    await assert.rejects(hardware.importArtifact({
        ...await requestFor(directory), limits: { maxVectorWidth: 1 }
    }), { code: 'LIMIT_EXCEEDED' });
    const behavioral = JSON.parse(JSON.stringify(simple));
    behavioral.modules.top.processes = { ordinary: {} };
    await assert.rejects(hardware.importArtifact(await requestFor(directory, behavioral)), { code: 'UNSUPPORTED' });
});
