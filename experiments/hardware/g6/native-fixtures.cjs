'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { hash } = require('../../../src/hardware/json');
const { validateNativeManifest } = require('../../../src/hardware/native-input');
const { loadOriginCase } = require('../g3/origin-query');
const { createRun } = require('./run.cjs');
const ROOT = path.resolve(__dirname, '../../..');
async function prepareFixtures(output = createRun('native-fixtures')) {
    const workspace = path.join(output, 'captured-workspace'); fs.mkdirSync(workspace);
    const rows = new Map(), fixtures = {};
    const inventory = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs/hardware/evidence/toolchain/manifest.json')));
    const expected = new Map(inventory.files.map(row => [row.path, row.sha256]));
    function copy(pathRef, expectedHash) {
        if (!pathRef || path.isAbsolute(pathRef) || pathRef.split('/').some(part => !part || part === '..' || part === '.')) throw new Error('Unsafe fixture reference');
        const source = path.join(ROOT, pathRef), bytes = fs.readFileSync(source), sha256 = hash(bytes);
        if (expectedHash && sha256 !== expectedHash) throw new Error(`Fixture identity changed: ${pathRef}`);
        if (!rows.has(pathRef)) {
            const target = path.join(workspace, pathRef); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, bytes, { flag: 'wx' });
            rows.set(pathRef, { path: pathRef, bytes: bytes.length, sha256 });
        } else if (rows.get(pathRef).sha256 !== sha256) throw new Error('Conflicting fixture capture');
        return { path: pathRef, pathRef, contentHash: sha256 };
    }
    for (const key of ['A', 'B', 'C']) {
        const base = `docs/hardware/evidence/toolchain/${key}`, recipePath = `${base}/recipe.json`;
        copy(recipePath, expected.get(recipePath));
        const recipe = JSON.parse(fs.readFileSync(path.join(ROOT, recipePath)));
        const source = copy(recipe.source.path, recipe.source.sha256);
        const metadata = copy(`${base}/bluetcl.json`, expected.get(`${base}/bluetcl.json`));
        const rawMetadata = JSON.parse(fs.readFileSync(path.join(ROOT, metadata.path)));
        const artifact = copy(`${base}/design.json`, expected.get(`${base}/design.json`));
        const generatedRtl = fs.readdirSync(path.join(ROOT, base, 'rtl')).filter(name => name.endsWith('.v')).sort()
            .map(name => copy(`${base}/rtl/${name}`, expected.get(`${base}/rtl/${name}`)));
        const captured = await loadOriginCase(key), request = captured.request;
        const sidecar = copy(request.sidecar.pathRef, request.sidecar.contentHash);
        const files = request.files.map(file => ({ ...copy(file.pathRef, file.contentHash), captureRef: file.captureRef, kind: file.kind }));
        const originArtifact = copy(request.importResult.snapshot.artifact.pathRef, request.importResult.snapshot.artifact.hash);
        const { kind, ...authority } = request.authority;
        const manifest = { version: 1, label: `${rawMetadata.top} · captured ${key}`, sources: [source],
            artifact: { ...artifact, manifest: { stage: recipe.stage, tops: [rawMetadata.top],
                sourceInputs: [{ pathRef: source.pathRef, contentHash: source.contentHash, role: 'source' }] } },
            metadata: { ...metadata, provider: 'stock-bluetcl-v1', sourceInputs: [{ pathRef: source.pathRef, contentHash: source.contentHash }] },
            generatedRtl, origin: { artifact: { ...originArtifact, manifest: { stage: request.importResult.snapshot.stage } }, sidecar, files, authority } };
        validateNativeManifest(manifest);
        const manifestRelative = `native-${key}.json`; fs.writeFileSync(path.join(workspace, manifestRelative), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' });
        const { origin, ...stock } = manifest; const stockManifestRelative = `native-${key}-stock.json`;
        fs.writeFileSync(path.join(workspace, stockManifestRelative), JSON.stringify(stock, null, 2) + '\n', { flag: 'wx' });
        fixtures[key] = { key, workspaceRootChoice: path.basename(workspace), manifestRelative, stockManifestRelative,
            sourceRootChoice: path.basename(workspace), sourceRelative: '.', manifest, sourceFiles: [{ path: path.join(workspace, source.path), pathRef: source.pathRef,
                contentHash: source.contentHash }], artifact: path.join(workspace, artifact.path), expectedRoot: rawMetadata.top };
    }
    for (const row of rows.values()) {
        if (hash(fs.readFileSync(path.join(ROOT, row.path))) !== row.sha256 || hash(fs.readFileSync(path.join(workspace, row.path))) !== row.sha256) throw new Error('Source/copy preservation failure');
    }
    const result = { schema: 'g6-native-fixtures-v1', status: 'pass', purpose: 'External controlled captured A/B/C input; never product VSIX runtime or actual-workspace evidence.',
        workspace, fixtures, inventory: [...rows.values()].sort((a, b) => a.path.localeCompare(b.path)), compilerExecuted: false };
    fs.writeFileSync(path.join(output, 'fixtures.json'), JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
    console.log(JSON.stringify({ output, workspace, files: rows.size, manifests: Object.keys(fixtures) })); return result;
}
if (require.main === module) prepareFixtures(process.env.G6_OUTPUT_DIR).catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { prepareFixtures };
