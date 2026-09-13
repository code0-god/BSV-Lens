'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const { createRun } = require('./run.cjs');
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const encode = value => `${JSON.stringify(value, null, 2)}\n`;
const root = path.resolve(__dirname, '../../..');
const originalSha256 = '3504decafff6ad0c600b2a8c2d0c2651edee3f84a33c408e522d85663b23c686';
const semantic = result => Object.fromEntries(Object.entries(result).filter(([key]) => !['metrics', 'request'].includes(key)));

async function capture(workspace, supplied) {
    const local = name => require(path.join(workspace, name));
    const { createCatalog } = local('experiments/hardware/g4/server.js');
    const { loadCapturedCase } = local('experiments/hardware/g3/query.js');
    const { loadOriginCase } = local('experiments/hardware/g3/origin-query.js');
    const { createArchitecture } = local('src/hardware/architecture.js');
    const catalog = await createCatalog(), requests = [], identities = [];
    for (const query of catalog) {
        const buildId = query.getCatalogEntry().buildId;
        const stock = await loadCapturedCase(buildId), origin = await loadOriginCase(buildId);
        const source = stock.analysis.sourceModel, model = stock.request.importResult.implementation;
        const architecture = createArchitecture({ importResult: stock.request.importResult, analysis: stock.analysis });
        identities.push({ buildId, stock: query.getAnalysisContext('stock'), instrumented: query.getAnalysisContext('instrumented'),
            sources: source.sourceDocuments.map(doc => ({ path: doc.relativePath, revision: doc.revision, sha256: sha256(doc.content) })) });
        function input(kind, entity, ownerInstanceId, extra = {}, provider = 'stock') {
            const context = query.getAnalysisContext(provider), hardware = provider === 'stock' ? model : origin.request.importResult.implementation;
            const owner = stock.analysis.correspondence.contexts.find(item => item.occurrenceId === ownerInstanceId);
            const stockId = owner?.contextOccurrenceId || owner?.implementationOccurrenceId || entity.occurrenceId;
            const occurrence = provider === 'stock' ? stockId : Object.values(hardware.occurrences)
                .find(item => JSON.stringify(item.path) === JSON.stringify(model.occurrences[stockId].path))?.id;
            assert.ok(occurrence, `Unattached actual occurrence: ${buildId}/${entity.id}`);
            return { kind, analysisId: context.analysisId, snapshotId: context.snapshotId,
                implementationProvider: provider, implementationOccurrenceId: occurrence, ownerInstanceId,
                seed: { entityId: entity.id, ...(entity.sourceRevision ? { sourceRevision: entity.sourceRevision } : {}) },
                scope: { kind: 'design', rootOccurrenceId: hardware.roots[0] }, queryGeneration: 1, ...extra };
        }
        const add = (label, value) => requests.push({ buildId, label, input: value });
        const port = Object.values(model.ports).filter(item => item.occurrenceId === model.roots[0] && item.bits.length > 1)
            .sort((a, b) => a.id.localeCompare(b.id))[0];
        assert.ok(port);
        add('ordered-half-open-slice', input('same-net', port, null, { seed: { entityId: port.id, slice: { start: 0, end: 2 } } }));
        add('occurrence-scoped-dependency', input('dependencies', port, null, {
            seed: { entityId: port.id, indices: [0, 1, 0] }, direction: 'backward',
            semanticsProfile: 'yosys-0.68-structural-v1', scope: { kind: 'occurrence', rootOccurrenceId: model.roots[0] } }));
        for (const behavior of source.stateBehaviors) {
            const owner = source.instances.find(item => item.id === behavior.ownerInstanceId);
            add(`${owner.path}/${behavior.name}`, input('behavior', behavior, owner.id));
            const expression = source.expressions.filter(item => item.enclosingCallableId === behavior.definitionId)
                .sort((a, b) => b.text.length - a.text.length || a.id.localeCompare(b.id))[0];
            if (expression) add(`${owner.path}/${behavior.name}/expression`, input('source-dependencies', expression, owner.id, { direction: 'backward' }));
        }
        for (const call of source.callSites) {
            const owners = source.stateBehaviors.filter(item => item.definitionId === call.enclosingCallableId).map(item => item.ownerInstanceId);
            assert.ok(owners.length, `Call has no actual owner: ${call.id}`);
            for (const owner of new Set(owners)) add(call.calleeName, input('call-site', call, owner));
        }
        for (const storage of Object.values(architecture.storage)) for (const provider of ['stock', 'instrumented'])
            add(`${storage.path}/correspondence`, input('correspondence', storage, storage.ownerInstanceId, {}, provider));
        const rootOwner = source.instances.find(item => item.root);
        const method = Object.values(architecture.contacts).filter(item => item.method && item.ownerInstanceId === rootOwner.id)
            .sort((a, b) => a.id.localeCompare(b.id))[0];
        assert.ok(method, `Missing actual root method: ${buildId}`);
        add(`${rootOwner.path}/${method.label}/stock-correspondence`, input('correspondence', method, rootOwner.id));
    }
    const selected = supplied || requests;
    assert.ok(selected.length > 0 && selected.length <= 128, 'Bounded public-query inventory required');
    if (supplied) assert.deepEqual(requests, supplied, 'Canonical request generation changed');
    const queries = [];
    for (const item of selected) {
        const query = catalog.find(candidate => candidate.getCatalogEntry().buildId === item.buildId);
        const result = semantic(await query.analyze(item.input));
        const sources = result.sourceRefs.map(reference => query.getSource(reference));
        assert.ok(!['stale', 'error'].includes(result.status));
        for (const claim of result.correspondence?.origin.claims || []) {
            assert.equal(claim.completeOriginSet, false);
            assert.equal(claim.status, 'verified-known-contributor');
        }
        queries.push({ ...item, result, sources });
    }
    return { schema: 'g5-readability-semantic-details-capture-v1', identities, requests, queries };
}

function summary(row) {
    const r = row.result, mappings = r.callMappings || [];
    return { buildId: row.buildId, label: row.label, input: row.input, status: 'pass', resultStatus: r.status,
        queryId: r.queryId, resultId: r.id, context: r.context, scope: r.scope,
        semanticSha256: sha256(encode(r)), sourceSha256: sha256(encode(row.sources)),
        counts: { objects: r.objects.length, relations: r.relations.length, sourceReferences: r.sourceRefs.length,
            predicate: r.conditions?.predicate ? 1 : 0, bodyConditions: r.conditions?.body.length || 0,
            callMappings: mappings.length, actualToFormal: mappings.reduce((sum, item) => sum + item.actualToFormal.length, 0),
            stockClaims: r.correspondence?.stock.claims.length || 0, knownContributors: r.correspondence?.origin.claims.length || 0 },
        stopReasons: r.limits.stopReasons };
}

function inventory(workspace, directories) {
    const rows = [];
    function visit(relative) {
        const absolute = path.join(workspace, relative), stat = fs.lstatSync(absolute);
        assert.ok(!stat.isSymbolicLink(), `Unexpected input link: ${relative}`);
        if (stat.isDirectory()) for (const name of fs.readdirSync(absolute).sort()) visit(`${relative}/${name}`);
        else { const bytes = fs.readFileSync(absolute); rows.push({ path: relative, bytes: bytes.length, sha256: sha256(bytes) }); }
    }
    directories.forEach(visit);
    return rows.sort((a, b) => a.path.localeCompare(b.path));
}

async function compareArchive(archive) {
    archive = path.resolve(archive);
    assert.equal(sha256(fs.readFileSync(archive)), originalSha256, 'Original G5 source ZIP identity mismatch');
    const directory = process.env.G5_READABILITY_OUTPUT_DIR || createRun('semantic-details');
    const extraction = path.join(directory, 'baseline-workspace'); fs.mkdirSync(extraction);
    const commands = [], startedAt = new Date().toISOString();
    const write = (name, bytes) => fs.writeFileSync(path.join(directory, name), bytes, { flag: 'wx' });
    function execute(executable, args, cwd, output, duplicateOf) {
        const started = new Date().toISOString();
        const result = spawnSync(executable, args, { cwd, env: { ...process.env, G4_REVIEW_ROOT: cwd, NODE_OPTIONS: '--no-global-search-paths' },
            encoding: 'utf8', timeout: 240000, maxBuffer: 32 * 1024 * 1024 });
        if (duplicateOf) assert.equal(result.stdout, fs.readFileSync(path.join(directory, duplicateOf), 'utf8'), 'Full public query stdout changed');
        else write(output, result.stdout || '');
        write(`${output}.stderr.log`, result.stderr || '');
        commands.push({ executable, args, cwd, startedAt: started, finishedAt: new Date().toISOString(), exit: result.status,
            signal: result.signal, stdout: duplicateOf || output, stdoutBytes: Buffer.byteLength(result.stdout || ''),
            stdoutSha256: sha256(result.stdout || ''), stdoutDeduplicatedByExactByteComparison: Boolean(duplicateOf),
            stderr: `${output}.stderr.log`, environment: { G4_REVIEW_ROOT: cwd, NODE_OPTIONS: '--no-global-search-paths' } });
        assert.ifError(result.error); assert.equal(result.status, 0, result.stderr);
        return result.stdout;
    }
    execute('python3', ['-E', '-s', '-S', '-B', '-c', require('../g5/validate-review.cjs').extraction, archive, extraction], root, 'extraction.log');
    const beforeRoot = path.join(extraction, 'bsv-lens');
    const preservedPaths = ['src/hardware', 'src/architecture', 'experiments/hardware/fixtures',
        'docs/hardware/evidence/toolchain', 'docs/hardware/evidence/g3'];
    const beforeInputs = inventory(beforeRoot, preservedPaths), afterInputs = inventory(root, preservedPaths);
    assert.deepEqual(afterInputs, beforeInputs, 'Canonical/source/compiler input inventory changed');
    write('inputs.inventory.json', encode(beforeInputs));
    const before = JSON.parse(execute(process.execPath, ['--no-global-search-paths', __filename, '--capture', beforeRoot], beforeRoot, 'before.capture.json'));
    write('requests.json', encode(before.requests));
    const after = JSON.parse(execute(process.execPath, ['--no-global-search-paths', __filename, '--capture', root,
        path.join(directory, 'requests.json')], root, 'after.capture.json', 'before.capture.json'));
    assert.deepEqual(after, before, 'G5 detailed semantic results changed');
    assert.deepEqual(inventory(beforeRoot, preservedPaths), beforeInputs, 'Baseline replay changed preserved inputs');
    assert.deepEqual(inventory(root, preservedPaths), afterInputs, 'Current replay changed preserved inputs');
    const queries = after.queries.map(summary);
    const report = { schema: 'g5-readability-semantic-details-v1', status: 'pass', startedAt, finishedAt: new Date().toISOString(),
        provenance: 'Baseline-extraction replay of exact original G5 source ZIP, executed now; not chronological pre-edit execution.',
        before: { root: beforeRoot, archive, archiveSha256: originalSha256, identities: before.identities },
        after: { root, identities: after.identities }, queries, commands,
        inputPreservation: { status: 'pass', files: beforeInputs.length, inventory: 'inputs.inventory.json', sha256: sha256(encode(beforeInputs)) },
        fullResults: 'before.capture.json', identicalAfterStdoutRetainedOnce: true, excludedFields: ['metrics', 'request'],
        limitations: ['Formal-token ranges, generic implementation joins and source specialization remain exactly as the original G5 API reports.',
            'Actual A/B/C sources contain no signed else body branch; empty body conditions are compared. Existing synthetic signed-condition tests provide that distinct coverage.',
            'No compiler invocation, fixture mutation or origin-coverage extension. Equality is regression evidence, not a new correctness/origin claim.'] };
    write('semantic-details.json', encode(report));
    console.log(JSON.stringify({ directory, status: report.status, queries: queries.length,
        kinds: [...new Set(queries.map(row => row.input.kind))], preservedInputs: beforeInputs.length }));
    return report;
}

if (require.main === module) (async () => {
    const [mode, workspace, requestFile] = process.argv.slice(2);
    if (mode === '--capture') console.log(JSON.stringify(await capture(path.resolve(workspace), requestFile ? JSON.parse(fs.readFileSync(requestFile)) : null), null, 2));
    else { assert.ok(mode && !workspace, 'Usage: semantic-details.cjs ORIGINAL_SOURCE.zip | --capture ROOT [REQUESTS.json]'); await compareArchive(mode); }
})().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { capture, compareArchive };
