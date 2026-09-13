'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const hardware = require('../../../src/hardware');
const correspondence = require('../../../src/hardware/correspondence');
const root = path.resolve(__dirname, '../../..');
const hash = text => crypto.createHash('sha256').update(text).digest('hex');

async function loadCapturedCase(key) {
    if (!['A', 'B', 'C'].includes(key)) throw new Error('Choose captured corpus A, B or C');
    const base = `docs/hardware/evidence/toolchain/${key}`;
    const inventory = JSON.parse(await fs.readFile(path.join(root, 'docs/hardware/evidence/toolchain/manifest.json'), 'utf8'));
    const expected = new Map(inventory.files.map(file => [file.path, file.sha256]));
    const checked = async pathRef => {
        const text = await fs.readFile(path.join(root, pathRef), 'utf8');
        if (!expected.has(pathRef) || hash(text) !== expected.get(pathRef)) throw new Error(`Captured corpus hash mismatch: ${pathRef}`);
        return text;
    };
    const recipe = JSON.parse(await checked(`${base}/recipe.json`));
    const registry = hardware.createArtifactRegistry({ artifactRoots: [root], sourceRoots: [root], workspaceTrusted: false });
    const artifactRef = `${base}/design.json`;
    await registry.registerArtifact({ pathRef: artifactRef, path: path.join(root, artifactRef) });
    const source = { pathRef: recipe.source.path, contentHash: recipe.source.sha256, revision: recipe.source.sha256 };
    await checked(source.pathRef);
    await registry.registerSource({ ...source, path: path.join(root, source.pathRef), capture: true });
    const metadataRef = `${base}/bluetcl.json`;
    const metadataText = await checked(metadataRef);
    await registry.registerArtifact({ pathRef: metadataRef, path: path.join(root, metadataRef) });
    const generatedRtl = [];
    for (const name of (await fs.readdir(path.join(root, base, 'rtl'))).filter(name => name.endsWith('.v')).sort()) {
        const pathRef = `${base}/rtl/${name}`;
        const text = await checked(pathRef);
        await registry.registerArtifact({ pathRef, path: path.join(root, pathRef) });
        generatedRtl.push({ pathRef, contentHash: hash(text) });
    }
    const importResult = await hardware.importArtifact({ registry, artifactRef,
        expectedArtifactHash: expected.get(artifactRef), manifest: {
        stage: recipe.stage, tops: [JSON.parse(metadataText).top],
        sourceInputs: [{ pathRef: source.pathRef, contentHash: source.contentHash, role: 'source' }]
    } });
    const request = { registry, importResult, sources: [source],
        metadata: { pathRef: metadataRef, contentHash: hash(metadataText), provider: 'stock-bluetcl-v1',
            sourceInputs: [{ pathRef: source.pathRef, contentHash: source.contentHash }] }, generatedRtl };
    return { request, analysis: await correspondence.attachCorrespondence(request) };
}

async function main() {
    const [key, occurrencePath, method, family = 'connectivity'] = process.argv.slice(2);
    const { request, analysis } = await loadCapturedCase(key);
    const query = { ...(occurrencePath ? { occurrencePath } : {}), ...(method ? { method } : {}), family };
    const result = correspondence.sourceToImplementation(analysis, query);
    const first = result.claims.find(claim => claim.relationKind === 'ordered-port-binding') || result.claims[0];
    console.log(JSON.stringify({ corpus: key, snapshotId: request.importResult.snapshot.id,
        analysisId: analysis.id, correspondenceId: analysis.correspondence.id, query, result,
        explanation: first ? correspondence.explainMapping(analysis, first.id) : null,
        coverage: correspondence.getCoverage(analysis) }, null, 2));
}
if (require.main === module) main().catch(error => {
    console.error(error.code || 'INVALID_INPUT', error.message);
    process.exitCode = 1;
});
module.exports = { loadCapturedCase };
