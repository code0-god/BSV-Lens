'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { selectInputs, archivedPath, outside, assertSourceEntry, assertRestoredViewport, inventory } = require('./native-fresh-replay.cjs');
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function fixture(t) {
    const root = fs.mkdtempSync(path.join(process.env.G6_OUTPUT_DIR || os.tmpdir(), 'fresh-contract-'));
    if (!process.env.G6_OUTPUT_DIR) t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const cwd = path.join(root, 'extracted'), directory = 'docs/hardware/evidence/g6-usability/run-test';
    const put = (relative, value) => { const file = path.join(cwd, relative); fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, Buffer.isBuffer(value) || typeof value === 'string' ? value : JSON.stringify(value)); };
    const source = Buffer.from('module mkExample(Empty); endmodule\n'), vsix = Buffer.from('Explicit synthetic archive bytes for input-selection contract test only');
    const workspace = { id: 'captured', root: `${directory}/workspace`, manifest: `${directory}/manifest.json`, inventory: `${directory}/inventory.json`,
        sourceEntry: { pathRef: 'src/Example.bsv', definitionId: 'def:Example:mkExample', revision: hash(source) } };
    put(`${workspace.root}/src/Example.bsv`, source);
    put(workspace.manifest, { version: 1, label: 'Captured display label', sources: [{ path: 'src/Example.bsv', contentHash: hash(source) }] });
    put(workspace.inventory, { files: [{ path: 'src/Example.bsv', bytes: source.length, sha256: hash(source) }] });
    const descriptor = { file: 'current.vsix', bytes: vsix.length, sha256: hash(vsix) }, index = `${directory}/index.json`;
    put(`${directory}/current.vsix`, vsix); put(index, { vsix: descriptor });
    return { root, cwd, workspace, put, directory, index, descriptor,
        context: { cwd, evidence: { indexes: [{ path: index }], builds: [{ sha256: hash(vsix) }] }, workspaces: [workspace] } };
}
test('selects physically shipped VSIX and exact source inventory with captured display label', t => {
    const f = fixture(t), result = selectInputs(f.context);
    assert.equal(result.label, 'Captured display label'); assert.equal(result.vsix.sha256, f.descriptor.sha256);
    assert.equal(outside(f.cwd, result.vsix.path), false); assert.equal(result.sourceInventory.files.length, 1);
});
test('multiple workspace descriptors require explicit selection', t => {
    const f = fixture(t); f.context.workspaces.push({ ...f.workspace, id: 'second' });
    assert.throws(() => selectInputs(f.context), /exactly one/);
    assert.equal(selectInputs({ ...f.context, workspaceId: 'second' }).workspace.id, 'second');
});
test('rejects traversal and source symlink escape', t => {
    const f = fixture(t); assert.throws(() => archivedPath(f.cwd, '../outside'), /relative archived path/);
    const external = path.join(f.root, 'external.bsv'); fs.writeFileSync(external, 'not an approved source');
    const link = path.join(f.cwd, f.workspace.root, 'escape.bsv'); fs.symlinkSync(external, link);
    assert.throws(() => archivedPath(f.cwd, `${f.workspace.root}/escape.bsv`), /escapes/);
});
test('rejects source content changed after inventory capture', t => {
    const f = fixture(t); f.put(`${f.workspace.root}/src/Example.bsv`, 'changed'); assert.throws(() => selectInputs(f.context));
});
test('does not substitute an author VSIX for a missing shipped file', t => {
    const f = fixture(t); f.put(f.index, { vsix: { sha256: f.descriptor.sha256, bytes: f.descriptor.bytes } });
    assert.throws(() => selectInputs(f.context), /physically included/);
});
test('rejects conflicting final VSIX identities across indexes', t => {
    const f = fixture(t), index = `${f.directory}/second-index.json`; f.put(index, { vsix: { ...f.descriptor, sha256: '0'.repeat(64) } });
    f.context.evidence.indexes.push({ path: index }); assert.throws(() => selectInputs(f.context), /Conflicting/);
});
test('rejects artifact-backed manifests in the source-only fresh lane', t => {
    const f = fixture(t); f.put(f.workspace.manifest, { version: 1, label: 'Captured', artifact: {} });
    assert.throws(() => selectInputs(f.context), /source-only/);
});
test('source occurrence reference is distinct from its definition identity', () => {
    const entry = { definitionId: 'def:Example:mkExample', pathRef: 'src/Example.bsv', revision: 'a'.repeat(64) };
    const ownerId = 'instance:def:Example:mkExample:mkExample';
    const state = { current: { ownerInstanceId: ownerId }, scene: { shell: { id: ownerId, kind: 'module-occurrence', definitionId: entry.definitionId,
        sourceRefs: [{ id: 'source-occurrence', semanticId: ownerId, sourceKind: 'module-occurrence', pathRef: entry.pathRef,
            revision: entry.revision, contentHash: entry.revision }] } } };
    assert.equal(assertSourceEntry(state, entry).referenceId, 'source-occurrence');
    const wrong = structuredClone(state); wrong.scene.shell.sourceRefs[0].semanticId = entry.definitionId;
    assert.throws(() => assertSourceEntry(wrong, entry), /Selected occurrence/);
    assert.throws(() => assertSourceEntry(state, { ...entry, definitionId: 'foreign-definition' }));
    assert.throws(() => assertSourceEntry(state, { ...entry, revision: 'b'.repeat(64) }));
});
test('Back viewport is exact at equal size and preserves selected anchor through resize quantization', () => {
    const before = { viewport: { x: 10, y: 20, scale: 0.5 }, selected: { id: 'selected', x: 100, y: 200, width: 240, height: 120 },
        client: { width: 800, height: 600 }, canvas: { width: 800, height: 600.25 } };
    assertRestoredViewport(before, structuredClone(before));
    const after = { ...before, viewport: { x: -90, y: -80, scale: 0.5 },
        client: { width: 600, height: 400 }, canvas: { width: 600, height: 400.75 } };
    assertRestoredViewport(before, after);
    assert.throws(() => assertRestoredViewport(before, { ...after, viewport: { ...after.viewport, x: -89 } }), /anchor shifted/);
    assert.throws(() => assertRestoredViewport(before, { ...after, viewport: { ...after.viewport, scale: 0.6 } }));
    assert.throws(() => assertRestoredViewport(before, { ...before, viewport: { ...before.viewport, y: 21 } }), /exact restored viewport/);
});

test('native replay distinguishes core-generated authority fixtures from every original archive member', t => {
    const f = fixture(t), generated = path.join(f.cwd, '.build/hardware/runs/security-case/g6');
    const before = inventory(f.cwd);
    fs.mkdirSync(generated, { recursive: true });
    fs.symlinkSync(f.root, path.join(generated, 'selected'));
    assert.deepEqual(inventory(f.cwd), before, 'Existing core replay output is not an original archive member');
    const other = path.join(f.cwd, '.build/original-capture'); fs.symlinkSync(f.root, other);
    assert.throws(() => inventory(f.cwd), /Unexpected original symlink/); fs.unlinkSync(other);
    const file = path.join(f.cwd, f.workspace.root, 'src/Example.bsv'); fs.appendFileSync(file, '// changed');
    assert.notDeepEqual(inventory(f.cwd), before, 'Original source changes still fail full inventory comparison');
    fs.rmSync(path.join(f.cwd, '.build/hardware/runs'), { recursive: true });
    fs.symlinkSync(f.root, path.join(f.cwd, '.build/hardware/runs'));
    assert.throws(() => inventory(f.cwd), /Unexpected original symlink/);
});
