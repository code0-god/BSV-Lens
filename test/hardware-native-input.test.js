'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { writeFileSync } = require('node:fs');
const path = require('node:path');
const { loadNativeInput, validateNativeManifest } = require('../src/hardware/native-input');
const { hash } = require('../src/hardware/json');
const { createArtifactRegistry } = require('../src/hardware/registry');

const source = 'package UserDesign;\ninterface Value; method Bit#(8) get; endinterface\n'
    + 'module mkUser(Value);\n Reg#(Bit#(8)) state <- mkReg(0);\n'
    + 'rule advance; state <= state + 1; endrule\n method Bit#(8) get = state;\nendmodule\nendpackage\n';
const artifact = JSON.stringify({ creator: 'synthetic-native-input-test', modules: {
    mkUser: { attributes: { top: '1' }, ports: { get: { direction: 'output', bits: [2, 3] } },
        cells: {}, netnames: { get: { hide_name: 0, bits: [2, 3], attributes: {} } } }
} });
async function sandbox(t) {
    const runs = path.resolve(__dirname, '../.build/hardware/runs');
    await fs.mkdir(runs, { recursive: true });
    const run = await fs.mkdtemp(path.join(runs, 'g6-native-input-'));
    const root = path.join(run, 'g6');
    await fs.mkdir(root);
    const sourceRoot = path.join(root, 'source'), artifactRoot = path.join(root, 'artifacts');
    await fs.mkdir(sourceRoot); await fs.mkdir(artifactRoot);
    await fs.writeFile(path.join(sourceRoot, 'UserDesign.bsv'), source);
    await fs.writeFile(path.join(artifactRoot, 'design.json'), artifact);
    t.diagnostic(`isolated native inputs: ${root}`);
    return { root, sourceRoot, artifactRoot };
}
test('native input starts empty and rejects descriptors as authority', async () => {
    assert.equal((await loadNativeInput()).summary.status, 'no-input');
    await assert.rejects(loadNativeInput({ manifest: { version: 1, artifact: { path: 'design.json' } } }), { code: 'PATH_DENIED' });
    await assert.rejects(loadNativeInput({ sourceRoot: 'vscode-remote://host/project' }), { code: 'PATH_DENIED' });
});
test('source-only native input uses genuine source parser and exposes independent root candidates', async t => {
    const { sourceRoot } = await sandbox(t);
    await fs.writeFile(path.join(sourceRoot, 'Other.bsv'), 'package Other; module mkOther(Empty); endmodule endpackage');
    const result = await loadNativeInput({ sourceRoot });
    assert.equal(result.summary.status, 'source-only');
    assert.equal(result.summary.compilerExecuted, false);
    assert.equal(result.importResult, null);
    assert.ok(result.sourceModel.instances.some(instance => instance.name === 'mkUser'));
    assert.ok(result.sourceModel.instances.some(instance => instance.name === 'mkOther'));
    assert.equal(result.catalog.length, 2);
    assert.equal(new Set(result.catalog.map(query => query.getCatalogEntry().rootInstanceId)).size, 2);
    assert.equal(result.sources.find(item => item.pathRef === 'UserDesign.bsv').capturedText, source);
    assert.equal(result.sources.find(item => item.pathRef === 'UserDesign.bsv').revision, hash(source));
    assert.equal(result.watchFiles.length, 2);
});
test('artifact-only import owns real ordered bits and leaves unknown build inputs unknown', async t => {
    const { artifactRoot } = await sandbox(t);
    const result = await loadNativeInput({ artifactRoot, artifactPath: 'design.json' });
    assert.equal(result.summary.status, 'artifact-only');
    assert.equal(result.sourceModel, null);
    assert.equal(result.importResult.snapshot.sourceInputs, null);
    assert.equal(result.importResult.snapshot.stage, null);
    const port = Object.values(result.importResult.implementation.ports).find(port => port.name === 'get');
    assert.equal(port.bits.length, 2);
    assert.notEqual(port.bits[0], port.bits[1]);
    assert.equal(result.catalog[0].getCatalogEntry().sceneKind, 'rtl');
});
test('artifact entry catalog distinguishes real design roots from bounded retained modules', async t => {
    const { artifactRoot } = await sandbox(t), cell = { type: 'Leaf', connections: {}, port_directions: {}, parameters: {}, attributes: {} };
    const design = { modules: { Top: { attributes: { top: '1' }, ports: {}, netnames: {}, cells: { left: cell, right: cell } },
        Leaf: { ports: {}, netnames: {}, cells: { nested: { ...cell, type: 'Inner' } } }, Inner: { ports: {}, netnames: {}, cells: {} } } };
    await fs.writeFile(path.join(artifactRoot, 'design.json'), JSON.stringify(design));
    const result = await loadNativeInput({ artifactRoot, artifactPath: 'design.json' });
    assert.equal(result.summary.roots.length, 1); assert.equal(result.summary.entrypoints.length, 3);
    assert.equal(result.summary.entrypointStatus.status, 'complete'); assert.equal(result.catalog.length, 3);
    assert.deepEqual(result.summary.entrypoints.map(entry => entry.path), [['Top'], ['Top', 'left'], ['Top', 'right']]);
    const queries = result.catalog.map(query => ({ query, entry: query.getCatalogEntry() }));
    assert.equal(new Set(queries.map(({ entry }) => entry.rootInstanceId)).size, 1);
    assert.equal(new Set(queries.map(({ entry }) => entry.entryOccurrenceId)).size, 3);
    assert.match(queries[0].entry.label, /RTL design root/); assert.match(queries[1].entry.label, /RTL module.*Top\/left/);
    const nested = Object.values(result.importResult.implementation.occurrences).find(occurrence => occurrence.path.length === 3);
    const { createSceneQuery } = require('../src/hardware/scene-query');
    assert.throws(() => createSceneQuery({ buildId: 'nested-entry', label: 'Nested', importResult: result.importResult, defaultRootInstanceId: nested.id }), { code: 'INVALID_INPUT' });
    const child = queries[1], scene = child.query.getScene({ buildId: child.entry.buildId, snapshotId: child.entry.snapshotId,
        queryGeneration: 1, rootInstanceId: child.entry.rootInstanceId }).scene;
    assert.equal(scene.shell.id, child.entry.entryOccurrenceId); assert.ok(scene.children.some(item => item.label === 'nested'));
    design.modules.Top.cells = Object.fromEntries(Array.from({ length: 129 }, (_, index) => [`child${index}`, cell]));
    await fs.writeFile(path.join(artifactRoot, 'design.json'), JSON.stringify(design));
    await assert.rejects(loadNativeInput({ artifactRoot, artifactPath: 'design.json' }), { code: 'LIMIT_EXCEEDED' });
    const registry = createArtifactRegistry({ artifactRoots: [artifactRoot] });
    await registry.registerArtifact({ pathRef: 'oversized.json', path: path.join(artifactRoot, 'design.json') });
    const imported = await require('../src/hardware').importArtifact({ registry, artifactRef: 'oversized.json' });
    const limited = createSceneQuery({ buildId: 'bounded-list', label: 'Bounded list', importResult: imported });
    const candidates = limited.getEntryCandidates();
    assert.equal(candidates.status, 'limited'); assert.equal(candidates.entries.length, 128);
    assert.equal(candidates.totalCandidates, 130); assert.equal(candidates.omitted, 2);
    assert.equal(limited.getRootCandidates().length, 1);
    assert.equal(Object.keys(imported.implementation.occurrences).length, 259);
});
test('explicit logical refs remain identity while actual local paths remain host owned', async t => {
    const { sourceRoot, artifactRoot } = await sandbox(t);
    const manifest = { version: 1, sources: [{ path: 'UserDesign.bsv', pathRef: 'build/src/UserDesign.bsv', contentHash: hash(source) }],
        artifact: { path: 'design.json', pathRef: 'build/design.json', contentHash: hash(artifact), manifest: {
            sourceInputs: [{ pathRef: 'build/src/UserDesign.bsv', contentHash: hash(source), role: 'source' }] } } };
    const result = await loadNativeInput({ sourceRoot, artifactRoot, manifest });
    assert.equal(result.summary.status, 'source-and-artifact');
    assert.equal(result.summary.freshness, 'fresh');
    assert.equal(result.sources[0].pathRef, 'build/src/UserDesign.bsv');
    assert.equal(result.sources[0].path, path.join(sourceRoot, 'UserDesign.bsv'));
    assert.equal(result.sourceModel.sourceDocuments[0].uri, 'build/src/UserDesign.bsv');
    assert.equal(result.catalog.length, 2);
    assert.match(result.catalog[1].getCatalogEntry().label, /source not mapped/);
    assert.equal(result.catalog[1].getCatalogEntry().sceneKind, 'rtl');
    assert.equal(result.summary.roots.length, 2); assert.equal(result.summary.entrypoints.length, 2);
    assert.deepEqual(result.summary.roots.map(root => root.sceneKind), ['bsv', 'rtl']);
    assert.equal(result.inputIdentity, (await loadNativeInput({ sourceRoot, artifactRoot, manifest })).inputIdentity);
});
test('native descriptor schema rejects traversal, prototype payloads, unknown authority and excessive data', () => {
    for (const file of ['../x', '/etc/passwd', 'file:///tmp/x', 'x\\y', './x', 'x//y', '%2e%2e/x']) {
        assert.throws(() => validateNativeManifest({ version: 1, sources: [{ path: file }] }));
    }
    assert.throws(() => validateNativeManifest(JSON.parse('{"version":1,"__proto__":{"x":1}}')), { code: 'INVALID_INPUT' });
    assert.throws(() => validateNativeManifest({ version: 1, constructor: 'bad' }), { code: 'INVALID_INPUT' });
    assert.throws(() => validateNativeManifest({ version: 2 }), { code: 'UNSUPPORTED' });
    assert.throws(() => validateNativeManifest({ version: 1, sourceRoot: '/tmp' }), { code: 'INVALID_INPUT' });
    assert.throws(() => validateNativeManifest({ version: 1, label: 'x'.repeat(1024 * 1024 + 1) }), { code: 'LIMIT_EXCEEDED' });
});
test('symlink escape and replacement fail even for selected directories', async t => {
    const { root, sourceRoot, artifactRoot } = await sandbox(t);
    const outside = path.join(root, 'outside'); await fs.mkdir(outside);
    await fs.writeFile(path.join(outside, 'Secret.bsv'), source);
    await fs.symlink(path.join(outside, 'Secret.bsv'), path.join(sourceRoot, 'Escaped.bsv'));
    await assert.rejects(loadNativeInput({ sourceRoot }), { code: 'PATH_DENIED' });
    await assert.rejects(loadNativeInput({ sourceRoot, manifest: { version: 1, sources: [{ path: 'Escaped.bsv' }] } }), { code: 'PATH_DENIED' });
    const result = await loadNativeInput({ sourceRoot, artifactRoot, manifest: { version: 1, sources: [{ path: 'UserDesign.bsv' }] } });
    await fs.rename(path.join(sourceRoot, 'UserDesign.bsv'), path.join(sourceRoot, 'Original.bsv'));
    await fs.symlink(path.join(outside, 'Secret.bsv'), path.join(sourceRoot, 'UserDesign.bsv'));
    const read = await result.registry.readSource({ pathRef: 'UserDesign.bsv', contentHash: hash(source) });
    assert.equal(read.status, 'captured');
    assert.equal(read.currentError.code, 'PATH_DENIED');
});
test('source discovery excludes build/config executables and caps file count', async t => {
    const { sourceRoot } = await sandbox(t);
    for (const directory of ['.hidden', 'node_modules', 'build', 'out']) {
        await fs.mkdir(path.join(sourceRoot, directory));
        await fs.writeFile(path.join(sourceRoot, directory, 'Invalid.bsv'), 'module invalid');
    }
    await fs.writeFile(path.join(sourceRoot, '.bsv-arch.json'), JSON.stringify({ scheduling: { provider: 'bsc', command: 'do-not-execute' } }));
    assert.equal((await loadNativeInput({ sourceRoot })).summary.sourceFiles, 1);
    await Promise.all(Array.from({ length: 256 }, (_, i) => fs.writeFile(path.join(sourceRoot, `${i}.bsv`), source)));
    await assert.rejects(loadNativeInput({ sourceRoot }), { code: 'LIMIT_EXCEEDED' });
});
test('cancellation and changed source never publish prepared input', async t => {
    const { sourceRoot, artifactRoot } = await sandbox(t);
    const controller = new AbortController(); controller.abort();
    await assert.rejects(loadNativeInput({ sourceRoot, signal: controller.signal }), { code: 'CANCELLED' });
    const active = new AbortController();
    await assert.rejects(loadNativeInput({ sourceRoot, artifactRoot, artifactPath: 'design.json', signal: active.signal,
        onProgress(event) { if (event.phase === 'artifact-import') active.abort(); } }), { code: 'CANCELLED' });
    await assert.rejects(loadNativeInput({ sourceRoot, manifest: { version: 1, sources: [{ path: 'UserDesign.bsv', contentHash: '0'.repeat(64) }] } }),
        { code: 'ARTIFACT_HASH_MISMATCH' });
    await assert.rejects(loadNativeInput({ sourceRoot, onProgress(event) {
        if (event.phase === 'correspondence-attach') writeFileSync(path.join(sourceRoot, 'UserDesign.bsv'), source + '// changed\n');
    } }), { code: 'STALE_SOURCE' });
});
test('source capture preserves exact UTF-8 hash, CRLF, tabs and mixed Unicode', async t => {
    const { sourceRoot } = await sandbox(t);
    const text = '// 한글 😀 e\u0301\t\r\n' + source.replaceAll('\n', '\r\n');
    await fs.writeFile(path.join(sourceRoot, 'UserDesign.bsv'), text);
    const result = await loadNativeInput({ sourceRoot });
    assert.equal(result.sources[0].capturedText, text);
    assert.equal(result.sources[0].revision, hash(Buffer.from(text, 'utf8')));
    assert.equal(result.sourceModel.sourceDocuments[0].content, text);
});
test('manifest origin evidence cannot grant caller approval', async () => {
    const sha = '0'.repeat(64), file = { path: 'file.json', contentHash: sha };
    const manifest = { version: 1, origin: { artifact: file, sidecar: file, files: [], authority: {
        provider: 'isolated-bsc-ghc96-root-observer-v1', compilerBinarySha256: sha, patchSha256: sha,
        originAdapterSha256: sha, sourcePin: 'pin' } } };
    await assert.rejects(loadNativeInput({ manifest }), { code: 'FORBIDDEN' });
    manifest.origin.authority.kind = 'caller-approved-instrumented-capture';
    assert.throws(() => validateNativeManifest(manifest), { code: 'INVALID_INPUT' });
});
test('host-pinned root grant rejects replacement before native first I/O', async t => {
    for (const symlink of [true, false]) {
        const { root, sourceRoot } = await sandbox(t), stat = await fs.stat(sourceRoot);
        const grant = { path: await fs.realpath(sourceRoot), dev: stat.dev, ino: stat.ino };
        const outside = path.join(root, 'outside'); await fs.mkdir(outside); await fs.writeFile(path.join(outside, 'UserDesign.bsv'), source);
        await fs.rename(sourceRoot, `${sourceRoot}.approved`);
        if (symlink) await fs.symlink(outside, sourceRoot);
        else { await fs.mkdir(sourceRoot); await fs.writeFile(path.join(sourceRoot, 'UserDesign.bsv'), source); }
        let progressed = false;
        await assert.rejects(loadNativeInput({ sourceRoot, rootGrants: { sourceRoot: grant }, onProgress() { progressed = true; } }), { code: 'PATH_DENIED' });
        assert.equal(progressed, false);
    }
});
test('resolved registry policy cannot reinterpret replaced root symlink on first registration', async t => {
    const { root, artifactRoot } = await sandbox(t), outside = path.join(root, 'outside');
    await fs.mkdir(outside); await fs.writeFile(path.join(outside, 'design.json'), artifact);
    const registry = createArtifactRegistry({ artifactRoots: [artifactRoot], resolvedRoots: true });
    await fs.rename(artifactRoot, `${artifactRoot}.approved`); await fs.symlink(outside, artifactRoot);
    await assert.rejects(registry.registerArtifact({ pathRef: 'design.json', path: path.join(artifactRoot, 'design.json') }), { code: 'PATH_DENIED' });
    assert.throws(() => createArtifactRegistry({ artifactRoots: [artifactRoot], resolvedRoots: 'true' }), { code: 'INVALID_INPUT' });
});
test('root grants are host-only copied policy and current directory grant permits generic analysis', async t => {
    const { sourceRoot } = await sandbox(t), stat = await fs.stat(sourceRoot);
    const grant = { path: await fs.realpath(sourceRoot), dev: stat.dev, ino: stat.ino };
    const rootGrants = { sourceRoot: grant };
    const result = await loadNativeInput({ sourceRoot, rootGrants, onProgress(event) {
        if (event.phase === 'source-registration') grant.ino = -1;
    } });
    assert.equal(result.summary.status, 'source-only');
    assert.throws(() => validateNativeManifest({ version: 1, rootGrants }), { code: 'INVALID_INPUT' });
    await assert.rejects(loadNativeInput({ sourceRoot, rootGrants }), { code: 'PATH_DENIED' });
});
test('source design index limits remain visible without deleting canonical definitions or conflating file counts', async t => {
    const { sourceRoot } = await sandbox(t), modules = Array.from({ length: 1025 }, (_, index) => `module mkUnit${index}(Empty); endmodule`).join('\n');
    await fs.writeFile(path.join(sourceRoot, 'UserDesign.bsv'), `package Many;\n${modules}\nendpackage`);
    let offered, indexStatus;
    const result = await loadNativeInput({ sourceRoot,
        discovery: { status: 'ready', discoveredFiles: 1, analyzedFiles: 1, included: [{ path: 'UserDesign.bsv' }] },
        selectSourceEntry(entries, context) { offered = entries.length; indexStatus = context.indexStatus; return entries[0].id; } });
    const expected = { status: 'limited', totalEntries: 1025, entryLimit: 1024, returnedEntries: 1024 };
    assert.deepEqual(indexStatus, expected); assert.deepEqual(result.summary.sourceIndexStatus, expected);
    assert.deepEqual(result.summary.discovery.sourceIndexStatus, expected); assert.equal(result.summary.discovery.status, 'partial');
    assert.equal(offered, 1024); assert.equal(result.summary.sourceEntries.length, 1024);
    assert.equal(result.summary.sourceFiles, 1); assert.equal(result.summary.discovery.discoveredFiles, 1);
    assert.equal(result.sourceModel.definitions.filter(definition => definition.kind === 'module-definition').length, 1025);
    assert.equal(result.summary.compilerExecuted, false);
});
