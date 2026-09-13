'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { performance } = require('node:perf_hooks');
const { parseSourceDocuments } = require('../../../src/hardware/correspondence/source');
const { buildSourceIndex, selectSourceEntry } = require('../../../src/hardware/correspondence/source-entry');
const { buildDefinitions } = require('../../../src/architecture/semantic/definitions');
const { loadNativeInput } = require('../../../src/hardware/native-input');
const { createSourceSession, validateBundle } = require('../../../src/hardware/correspondence');
const { DEFAULT_LIMITS } = require('../../../src/hardware/json');
const { layout } = require('../../../media/hardware-layout');
const { createArchitecture } = require('../../../src/hardware/architecture');
const { validateGeometry, validateMembership } = require('../g4-fix/oracle/geometry.cjs');

const repo = path.resolve(__dirname, '../../..');
const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
const representatives = new Set(['mkExecuteController', 'mkPE', 'mkSystolicArrayA16W16D64',
    'mkVectorUnit', 'mkIM2PCore', 'mkSynthA8W8D16']);
const write = (directory, name, value) => fs.writeFileSync(path.join(directory, name), JSON.stringify(value, null, 2) + '\n');

function runtimeInventory() {
    const paths = ['package.json', 'package-lock.json'];
    function visit(directory) {
        for (const entry of fs.readdirSync(path.join(repo, directory), { withFileTypes: true })) {
            const relative = path.posix.join(directory, entry.name);
            if (entry.isDirectory()) visit(relative);
            else if (entry.isFile() && entry.name.endsWith('.js')) paths.push(relative);
        }
    }
    visit('src');
    paths.push(...fs.readdirSync(path.join(repo, 'media')).filter(name => name.startsWith('hardware'))
        .map(name => `media/${name}`));
    return paths.sort().map(relative => {
        const bytes = fs.readFileSync(path.join(repo, relative));
        return { path: relative, bytes: bytes.length, sha256: sha256(bytes) };
    });
}

function duplicateIds(definitions) {
    const grouped = new Map();
    for (const definition of definitions) grouped.set(definition.id, [...(grouped.get(definition.id) || []), definition]);
    return [...grouped].filter(([, values]) => values.length > 1).map(([id, values]) => ({ id,
        definitions: values.map(({ kind, name, uri, sourceRange }) => ({ kind, name, uri, sourceRange })) }));
}

function sceneChecks(input, directory, prefix) {
    const results = [];
    for (const query of input.catalog) {
        const entry = query.getCatalogEntry();
        const base = { buildId: entry.buildId, snapshotId: entry.snapshotId,
            queryGeneration: 0, rootInstanceId: entry.rootInstanceId, sceneKind: 'bsv' };
        let root;
        try { root = query.getScene(base).scene; }
        catch (error) {
            results.push({ status: 'failure', owner: entry.rootInstanceId, label: entry.label,
                code: error.code, message: error.message });
            continue;
        }
        const targets = [{ id: root.ownerInstanceId, label: root.shell.label }, ...root.children];
        for (const target of targets) {
            const started = performance.now();
            let scene;
            try {
                scene = query.getScene({ ...base, ownerInstanceId: target.id }).scene;
                assert.equal(scene.ownerInstanceId, target.id);
                const geometry = layout(scene, { width: 1000, height: 700 });
                const name = `${prefix}-scene-${results.length + 1}.json`;
                write(directory, name, { scene, geometry });
                results.push({ status: 'pass', owner: target.id, label: target.label, file: name,
                    children: scene.children.map(({ id, label }) => ({ id, label })),
                    storages: scene.storages.map(({ id, label }) => ({ id, label })),
                    connections: scene.connections.length, routes: geometry.routes.length,
                    routing: geometry.routing, elapsedMs: performance.now() - started });
            } catch (error) {
                const file = scene ? `${prefix}-failed-scene-${results.length + 1}.json` : null;
                if (file) write(directory, file, { scene });
                results.push({ status: 'failure', owner: target.id, label: target.label,
                    file, code: error.code, message: error.message, elapsedMs: performance.now() - started });
            }
        }
    }
    return results;
}

function coreDetailChecks(input, directory) {
    const query = input.catalog[0], entry = query.getCatalogEntry();
    const base = { buildId: entry.buildId, snapshotId: entry.snapshotId,
        queryGeneration: 0, rootInstanceId: entry.rootInstanceId, sceneKind: 'bsv' };
    const root = query.getScene(base).scene, owner = root.children.find(child => child.label === 'core');
    assert.ok(owner, 'Actual core child required');
    base.ownerInstanceId = owner.id;
    const overview = query.getScene(base).scene, storage = overview.storages.find(item => item.label === 'commandReg');
    assert.ok(storage, 'Actual commandReg source state required');
    const selected = query.getScene({ ...base, selectedEntityId: storage.id }).scene;
    const summaryId = selected.connections.find(connection => connection.relationFamily === 'state-write'
        && connection.endpointIds.includes(storage.id))?.id;
    assert.ok(summaryId, 'Actual selected state-write summary required');
    const summary = query.getScene({ ...base, selectedRelationId: summaryId }).scene;
    assert.ok(summary.connections.some(connection => connection.id === summaryId));
    const ref = summary.inspector.sourceRefs[0];
    assert.ok(ref, 'Summary source evidence required');
    const opened = query.getSource(ref);
    assert.equal(opened.text, ref.text);
    const architecture = createArchitecture({ analysis: input.analysis }), results = [];
    for (const [mode, scene] of [['overview', overview], ['state', selected], ['summary-source', summary]]) {
        const membership = validateMembership(scene, { architecture });
        assert.equal(membership.valid, true, JSON.stringify(membership.findings));
        for (const size of [{ width: 420, height: 650 }, { width: 1000, height: 700 }, { width: 1800, height: 900 }]) {
            const geometry = layout(scene, size), check = validateGeometry(scene, geometry);
            assert.equal(check.valid, true, JSON.stringify(check.findings));
            assert.equal(geometry.routing.status, 'complete');
            const file = `core-${mode}-${size.width}.json`;
            write(directory, file, { scene, geometry, membership, check, source: mode === 'summary-source' ? opened : null });
            results.push({ status: 'pass', mode, size, owner: owner.id, file, selectedStorage: storage.id,
                summaryId, sourceRefId: ref.id, sourceRange: ref.range, routes: geometry.routes.length,
                children: scene.children.length, storages: scene.storages.length });
        }
    }
    return results;
}

async function run(inventoryFile, workspaceRoot, expectedEntriesFile, output) {
    assert.ok(path.resolve(output).startsWith(path.join(repo, '.build/hardware/runs/g6-duplicate-definition-')));
    fs.mkdirSync(output, { recursive: true });
    assert.equal(fs.existsSync(path.join(output, 'receipt.json')), false, 'Use a fresh run');
    const expected = JSON.parse(fs.readFileSync(inventoryFile));
    const expectedEntries = JSON.parse(fs.readFileSync(expectedEntriesFile)).index;
    const read = () => expected.map(row => {
        assert.ok(typeof row.pathRef === 'string' && !path.isAbsolute(row.pathRef)
            && !row.pathRef.split(/[\\/]/).includes('..'));
        const file = path.resolve(workspaceRoot, row.pathRef);
        assert.equal(fs.realpathSync(file), file, 'Pinned source must not become a symlink');
        const text = fs.readFileSync(file, 'utf8'), contentHash = sha256(text);
        assert.equal(contentHash, row.contentHash, `Changed source: ${row.pathRef}`);
        return { pathRef: row.pathRef, text, contentHash, revision: contentHash };
    });
    const documents = read(), runtimeBefore = runtimeInventory(), parsed = parseSourceDocuments(documents);
    const harness = { path: path.relative(repo, __filename), sha256: sha256(fs.readFileSync(__filename)) };
    write(output, 'runtime-before.json', { harness, files: runtimeBefore });
    const index = buildSourceIndex(documents, parsed);
    assert.deepEqual(index.entries, expectedEntries, 'Parser fix must not silently change the chosen source inventory');
    const scopes = index.entries.map(entry => {
        const selection = selectSourceEntry(documents, parsed, entry);
        return { entry, analyzedFiles: selection.documents.length,
            duplicates: duplicateIds(buildDefinitions(selection.parsed)), sourceScope: selection.sourceScope };
    });
    write(output, 'scopes.json', scopes);
    const declarations = parsed.filter(file => /\/(Arithmetic|Scale)\.bsv$/.test(file.uri)).map(file => ({
        path: file.uri, functions: file.functions.map(({ name, declarationScope, declarationOnly, range, sourceRange }) => ({
            name, declarationScope, declarationOnly, range, sourceRange })),
        definitions: buildDefinitions([file]).filter(definition => definition.kind === 'function-definition')
            .map(({ id, name, declarationScope, declarationOnly, range, sourceRange }) => ({
                id, name, declarationScope, declarationOnly, range, sourceRange }))
    }));
    write(output, 'declarations.json', declarations);
    for (const [name, prototypes, implementations] of [['Arithmetic', 5, 10], ['Scale', 2, 4]]) {
        const declaration = declarations.find(item => item.path.endsWith(`/${name}.bsv`));
        assert.ok(declaration, `Missing actual ${name} source`);
        assert.equal(declaration.functions.filter(item => item.declarationOnly).length, prototypes);
        assert.equal(declaration.functions.filter(item => item.declarationScope?.kind === 'instance').length, implementations);
        assert.equal(new Set(declaration.definitions.map(item => item.id)).size, prototypes + implementations);
    }
    const results = [], sourceSession = createSourceSession();
    try {
        for (const [i, entry] of index.entries.entries()) {
            const sourceEntry = { pathRef: entry.pathRef, revision: entry.revision, definitionId: entry.definitionId };
            const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 30000);
            const started = performance.now(), progress = [], prefix = String(i + 1).padStart(2, '0');
            let result;
            try {
                const input = await loadNativeInput({ sourceRoot: workspaceRoot,
                    manifest: { version: 1, sources: expected.map(row => ({ path: row.pathRef, contentHash: row.contentHash })) },
                    sourceSession, sourceEntry, signal: controller.signal,
                    onProgress: row => progress.push({ ...row, elapsedMs: performance.now() - started }) });
                assert.deepEqual(input.selectedSourceEntry, sourceEntry);
                const duplicates = duplicateIds(input.sourceModel.definitions);
                assert.deepEqual(duplicates, [], 'Public source model IDs remain unique');
                assert.equal(validateBundle(input.analysis.correspondence, input.analysis), true);
                const encoded = JSON.stringify(input.analysis.correspondence), bundleJsonBytes = Buffer.byteLength(encoded);
                let copiedOversizeRejected = null;
                if (bundleJsonBytes > DEFAULT_LIMITS.maxBytes) {
                    assert.throws(() => validateBundle(JSON.parse(encoded), input.analysis), { code: 'LIMIT_EXCEEDED' });
                    copiedOversizeRejected = true;
                }
                result = { name: entry.name, sourceEntry, status: 'pass', inputIdentity: input.inputIdentity,
                    analyzedFiles: input.summary.analyzedSourceFiles, definitions: input.sourceModel.definitions.length,
                    bundleValidation: { ownBundleValid: true, bundleJsonBytes, copiedOversizeRejected,
                        externalJsonLimit: DEFAULT_LIMITS.maxBytes },
                    sourceModelIdentity: input.analysis.sourceModelIdentity, analysisMetrics: input.analysis.metrics, summary: input.summary,
                    scenes: representatives.has(entry.name) ? sceneChecks(input, output, prefix) : [],
                    coreDetails: entry.name === 'mkIM2PCore' ? coreDetailChecks(input, output) : [] };
            } catch (error) {
                result = { name: entry.name, sourceEntry, status: 'failure', code: error.code,
                    message: error.message, stack: error.stack };
            } finally { clearTimeout(timeout); }
            result.elapsedMs = performance.now() - started;
            result.progress = progress;
            write(output, `${prefix}-input.json`, result);
            results.push({ ...result, summary: undefined, progress: undefined });
            write(output, 'results.json', results);
            console.log(JSON.stringify({ index: i + 1, total: index.entries.length, name: entry.name,
                status: result.status, code: result.code, scenes: result.scenes?.length,
                sceneFailures: result.scenes?.filter(scene => scene.status !== 'pass').length,
                elapsedMs: Math.round(result.elapsedMs) }));
        }
    } finally { await sourceSession.dispose(); }
    const after = read(), runtimeAfter = runtimeInventory();
    const runtimeStable = JSON.stringify(runtimeBefore) === JSON.stringify(runtimeAfter);
    const scenes = results.flatMap(result => [...(result.scenes || []), ...(result.coreDetails || [])]);
    const receipt = { schema: 'g6-typeclass-workspace-v1', date: new Date().toISOString(), node: process.version,
        argv: process.argv, workspaceRoot, inventoryFile, expectedEntriesFile,
        status: results.every(result => result.status === 'pass') && scenes.every(scene => scene.status === 'pass')
            && scopes.every(scope => !scope.duplicates.length) && runtimeStable ? 'pass' : 'failure',
        sourceFiles: documents.length, sourcePreserved: documents.every((source, i) => source.contentHash === after[i].contentHash),
        sourceInventoryHash: sha256(JSON.stringify(documents.map(({ pathRef, contentHash }) => ({ pathRef, contentHash })))),
        selectedEntries: index.entries.length, publicLoadPass: results.filter(result => result.status === 'pass').length,
        publicLoadFail: results.filter(result => result.status !== 'pass').length, publicLoadCancel: results.filter(result => result.code === 'CANCELLED').length,
        scenePass: scenes.filter(scene => scene.status === 'pass').length, sceneFail: scenes.filter(scene => scene.status !== 'pass').length,
        duplicateScopes: scopes.filter(scope => scope.duplicates.length).length, runtimeStable, runtimeBefore, runtimeAfter,
        compilerExecuted: false, originalWorkspaceWritten: false, harness, results };
    write(output, 'receipt.json', receipt);
    return receipt;
}

if (require.main === module) {
    const [inventory, workspace, entries, output, ...rest] = process.argv.slice(2);
    assert.ok(inventory && workspace && entries && output && !rest.length,
        'Usage: workspace.cjs INVENTORY WORKSPACE OLD_AUDIT FRESH_RUN_DIRECTORY');
    run(inventory, workspace, entries, output).then(result => { process.exitCode = result.status === 'pass' ? 0 : 1; })
        .catch(error => { console.error(error); process.exitCode = 1; });
}
module.exports = { run, sceneChecks };
