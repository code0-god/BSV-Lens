'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const hardware = require('../../../src/hardware');
const origin = require('../../../src/hardware/correspondence/origin');
const root = path.resolve(__dirname, '../../..');
const base = 'docs/hardware/evidence/g3-origin-ghc96';
const hash = value => crypto.createHash('sha256').update(value).digest('hex');

async function loadOriginCase(key) {
    if (!['A', 'B', 'C'].includes(key)) throw new Error('Choose captured corpus A, B or C');
    const registry = hardware.createArtifactRegistry({
        artifactRoots: [path.join(root, base)], sourceRoots: [path.join(root, base, 'inputs/fixtures')], workspaceTrusted: false
    });
    const sidecarRef = `${base}/results/origin-sidecar.json`;
    const sidecarText = await fs.readFile(path.join(root, sidecarRef), 'utf8'), payload = JSON.parse(sidecarText);
    const execution = JSON.parse(await fs.readFile(path.join(root, base, 'inputs/execution-identities.json'), 'utf8'));
    await registry.registerArtifact({ pathRef: sidecarRef, path: path.join(root, sidecarRef) });
    const refs = new Set(['inputs/build-inputs.json', 'inputs/execution-identities.json',
        'receipts/instrumented-compile-final.json', 'receipts/instrumented-compile-final.log']);
    for (const item of payload.sourceOrigins) refs.add(item.pathRef);
    for (const label of Object.keys(payload.artifacts)) {
        if (!['A', 'B', 'C'].includes(label)) throw new Error('Unknown captured corpus ref');
        refs.add(`results/instrumented/${label}/design.json`);
        const directory = `results/instrumented/${label}/rtl`;
        for (const name of await fs.readdir(path.join(root, base, directory))) if (name.endsWith('.v')) refs.add(`${directory}/${name}`);
    }
    for (const link of payload.links) for (const capture of link.readerTransport) refs.add(capture.path);
    const files = [];
    for (const captureRef of [...refs].sort()) {
        if (path.isAbsolute(captureRef) || captureRef.split('/').some(part => part === '..' || part === '.') || captureRef.includes('\\')) throw new Error('Unsafe capture ref');
        const pathRef = `${base}/${captureRef}`;
        await registry.registerArtifact({ pathRef, path: path.join(root, pathRef) });
        const { text } = await registry.readArtifact(pathRef);
        const kind = captureRef.startsWith('inputs/fixtures/') ? 'source' : 'artifact';
        if (kind === 'source') await registry.registerSource({ pathRef, path: path.join(root, pathRef), contentHash: hash(text), capture: true });
        files.push({ captureRef, pathRef, contentHash: hash(text), kind });
    }
    const artifactRef = `${base}/results/instrumented/${key}/design.json`;
    const importResult = await hardware.importArtifact({ registry, artifactRef, expectedArtifactHash: payload.artifacts[key],
        manifest: { stage: 'bsc-instrumented-origin/yosys-hierarchy-proc-noopt' } });
    const request = { registry, importResult, sidecar: { pathRef: sidecarRef, contentHash: hash(sidecarText) }, files,
        authority: { provider: 'isolated-bsc-ghc96-root-observer-v1', compilerBinarySha256: execution.instrumentedBscSha256,
            patchSha256: execution.patchSha256, originAdapterSha256: execution.originAdapterSha256,
            sourcePin: execution.sourcePin, kind: 'caller-approved-instrumented-capture' } };
    return { request, analysis: await origin.attachOrigins(request) };
}
async function main() {
    const [key, occurrence, contribution = 'known'] = process.argv.slice(2);
    const started = performance.now();
    const { request, analysis } = await loadOriginCase(key);
    const query = { ...(occurrence ? { occurrencePath: occurrence.split('/') } : {}), contribution };
    const result = origin.sourceToImplementation(analysis, query);
    console.log(JSON.stringify({ corpus: key, snapshotId: request.importResult.snapshot.id,
        originAnalysisId: analysis.id, originBundleId: analysis.bundle.id, authority: analysis.bundle.provider,
        query, result, coverage: origin.getCoverage(analysis), attachAndQueryMs: performance.now() - started,
        explanations: result.claims.map(claim => origin.explainMapping(analysis, claim.id)) }, null, 2));
}
if (require.main === module) main().catch(error => {
    console.error(error.code || 'INVALID_INPUT', error.message);
    process.exitCode = 1;
});
module.exports = { loadOriginCase };
