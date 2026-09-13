'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadNativeInput, validateNativeManifest } = require('../../../src/hardware/native-input');
const { relative } = require('../g6/validate-delivery.cjs');
function sourceEntry(value, manifest, inventory) {
    if (value === undefined) return undefined;
    assert.ok(value && typeof value === 'object' && !Array.isArray(value), 'Source entry object required');
    assert.deepEqual(Object.keys(value).sort(), ['definitionId', 'pathRef', 'revision']);
    for (const key of ['definitionId', 'pathRef']) assert.ok(typeof value[key] === 'string' && value[key].length > 0 && value[key].length <= 2048);
    assert.match(value.revision, /^[a-f0-9]{64}$/);
    const sources = manifest.sources?.filter(row => row.pathRef === value.pathRef || row.pathRef === undefined && row.path === value.pathRef) || [];
    assert.equal(sources.length, 1, 'Chosen source entry must belong to the full registered source inventory');
    const recorded = inventory?.filter(row => row.path === sources[0].path);
    if (recorded) assert.equal(recorded.length, 1, 'Chosen source file absent from captured inventory');
    const revision = sources[0].contentHash ?? recorded?.[0].sha256;
    if (revision !== undefined) assert.equal(revision, value.revision, 'Chosen source entry revision differs from inventory');
    return value;
}
async function run(manifestFile, sourceRoot, selected) {
    const manifest = validateNativeManifest(JSON.parse(fs.readFileSync(relative(manifestFile))));
    const selectedSourceEntry = sourceEntry(selected, manifest);
    const result = await loadNativeInput({ manifest, sourceRoot: path.resolve(relative(sourceRoot)), sourceEntry: selectedSourceEntry });
    if (selectedSourceEntry) assert.deepEqual(result.selectedSourceEntry, selectedSourceEntry);
    const catalog = result.catalog.map(query => query.getCatalogEntry());
    const scenes = result.catalog.map(query => { const entry = query.getCatalogEntry(); return query.getScene({ buildId: entry.buildId, snapshotId: entry.snapshotId,
        queryGeneration: 0, rootInstanceId: entry.rootInstanceId, sceneKind: entry.sceneKind || 'bsv' }).scene; });
    for (const scene of scenes) assert.ok(scene.shell.id && scene.shell.label);
    return { schema: 'g6-usability-workspace-input-replay-v1', status: 'PASS', compilerExecuted: false, inputIdentity: result.inputIdentity,
        sourceEntry: result.selectedSourceEntry, summary: result.summary, registeredSources: result.sources.map(({ pathRef, revision }) => ({ pathRef, revision })), catalog,
        scenes: scenes.map(scene => ({ id: scene.id, snapshotId: scene.snapshotId, ownerInstanceId: scene.ownerInstanceId, shell: { id: scene.shell.id, label: scene.shell.label },
            children: scene.children.map(child => ({ id: child.id, label: child.label })), storages: scene.storages.map(storage => ({ id: storage.id, label: storage.label })),
            connections: scene.connections.map(connection => ({ id: connection.id, members: connection.members?.map(member => typeof member === 'string' ? member : member.id), bits: connection.bits || null })) })) };
}
if (require.main === module) {
    const [manifest, root, selected, ...rest] = process.argv.slice(2); assert.ok(manifest && root && !rest.length, 'Usage: replay-input.cjs MANIFEST SOURCE_ROOT [SOURCE_ENTRY_JSON]');
    run(manifest, root, selected ? JSON.parse(selected) : undefined).then(value => console.log(JSON.stringify(value))).catch(error => { console.error(error); process.exitCode = 1; });
}
module.exports = { run, sourceEntry };
