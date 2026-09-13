'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { loadNativeInput } = require('../../../src/hardware/native-input');
const { hash } = require('../../../src/hardware/json');
const { relative } = require('./validate-delivery.cjs');
async function descriptor(file) { return { path: file, pathRef: file, contentHash: hash(await fs.readFile(file)) }; }
async function capturedManifest(key) {
    const base = `docs/hardware/evidence/toolchain/${key}`, recipe = JSON.parse(await fs.readFile(`${base}/recipe.json`));
    const metadata = JSON.parse(await fs.readFile(`${base}/bluetcl.json`)), source = await descriptor(recipe.source.path);
    assert.equal(source.contentHash, recipe.source.sha256);
    return { version: 1, label: `Captured ${key}`, sources: [source], artifact: { ...await descriptor(`${base}/design.json`),
        manifest: { stage: recipe.stage, tops: [metadata.top], sourceInputs: [{ pathRef: source.pathRef, contentHash: source.contentHash, role: 'source' }] } },
        metadata: { ...await descriptor(`${base}/bluetcl.json`), provider: 'stock-bluetcl-v1', sourceInputs: [{ pathRef: source.pathRef, contentHash: source.contentHash }] },
        generatedRtl: await Promise.all((await fs.readdir(`${base}/rtl`)).filter(name => name.endsWith('.v')).sort().map(name => descriptor(`${base}/rtl/${name}`))) };
}
async function run(manifestFile, sourceRoot, artifactRoot) {
    const inputs = manifestFile ? [{ label: 'explicit archived manifest', manifest: JSON.parse(await fs.readFile(relative(manifestFile))),
        sourceRoot: sourceRoot === '-' ? undefined : path.resolve(relative(sourceRoot)),
        artifactRoot: artifactRoot === '-' ? undefined : path.resolve(relative(artifactRoot)) }]
        : await Promise.all(['A', 'B', 'C'].map(async label => ({ label, manifest: await capturedManifest(label), sourceRoot: process.cwd(), artifactRoot: process.cwd() })));
    const results = [];
    for (const request of inputs) {
        const result = await loadNativeInput(request), catalog = result.catalog.map(query => query.getCatalogEntry());
        const scenes = result.catalog.map(query => { const entry = query.getCatalogEntry(); return query.getScene({ buildId: entry.buildId,
            snapshotId: entry.snapshotId, queryGeneration: 0, rootInstanceId: entry.rootInstanceId, sceneKind: entry.sceneKind || 'bsv' }).scene; });
        for (const scene of scenes) assert.ok(scene.shell.id && scene.shell.label);
        results.push({ label: request.label, inputIdentity: result.inputIdentity, status: result.summary.status,
            snapshotId: result.summary.snapshotId, sourceIdentities: result.sources.map(({ pathRef, revision }) => ({ pathRef, revision })),
            catalog, scenes: scenes.map(scene => ({ id: scene.id, snapshotId: scene.snapshotId, ownerInstanceId: scene.ownerInstanceId,
                shellId: scene.shell.id, children: scene.children.map(child => ({ id: child.id, label: child.label })),
                connections: scene.connections.map(connection => ({ id: connection.id,
                    members: connection.members?.map(member => typeof member === 'string' ? member : member.id), bits: connection.bits || null })) })) });
    }
    return { schema: 'g6-native-input-replay-v1', status: 'PASS', compilerExecuted: false, results };
}
if (require.main === module) run(...process.argv.slice(2)).then(value => console.log(JSON.stringify(value)))
    .catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { run, capturedManifest };
