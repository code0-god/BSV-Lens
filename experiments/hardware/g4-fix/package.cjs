'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { collectFiles } = require('../../../scripts/zip');
const { collectEntries, saveCandidate } = require('../g4/package');
const base = require('../g4/validate-delivery');
const { createRunOutput } = require('../g4/run-output');
const root = path.resolve(__dirname, '../../..');
const report = 'docs/hardware/g4-fix/G4_FIX_REPORT.md';
const runtime = entries => entries.filter(entry =>
    /^bsv-lens\/(?:src|media|scripts|experiments|test)\//.test(entry.name)
        && /\.(?:js|cjs|mjs|py|sh|tcl|html|css)$/.test(entry.name)
        || /^bsv-lens\/package(?:-lock)?\.json$/.test(entry.name))
    .map(entry => ({ path: entry.name, bytes: entry.data.length, sha256: base.hash(entry.data) }));

const evidenceRoot = 'docs/hardware/evidence/g4-fix/';

function validateEvidence(entries, expectedIndexes) {
    const files = new Map();
    const safe = relative => {
        assert.ok(typeof relative === 'string' && relative && !/[:\\\\\0]/.test(relative)
            && relative.split('/').every(part => part && part !== '.' && part !== '..'),
        `Unsafe G4-fix evidence path: ${relative}`);
        return relative;
    };
    for (const entry of entries.filter(item => item.name.startsWith(`bsv-lens/${evidenceRoot}`))) {
        const relative = safe(entry.name.slice('bsv-lens/'.length));
        assert.ok(!base.forbidden(relative), `Forbidden G4-fix evidence member: ${relative}`);
        assert.ok(!files.has(relative), `Duplicate G4-fix evidence member: ${relative}`);
        files.set(relative, entry.data);
    }
    const indexed = new Set(), indexes = [];
    for (const [name, data] of files) {
        if (!name.endsWith('/index.json')) continue;
        const index = JSON.parse(data.toString('utf8'));
        assert.ok(Array.isArray(index.files), `Missing G4-fix evidence files: ${name}`);
        const seen = new Set();
        for (const item of index.files) {
            const relative = `${name.slice(0, -'index.json'.length)}${safe(item.path)}`;
            assert.ok(!base.forbidden(relative), `Forbidden G4-fix evidence reference: ${relative}`);
            assert.ok(relative !== name && !seen.has(relative), `Duplicate/self G4-fix evidence reference: ${relative}`);
            seen.add(relative);
            const bytes = files.get(relative);
            assert.ok(bytes, `Missing G4-fix evidence member: ${relative}`);
            assert.ok(Number.isSafeInteger(item.bytes) && item.bytes >= 0, `Invalid G4-fix evidence size: ${relative}`);
            assert.equal(bytes.length, item.bytes, `G4-fix evidence size mismatch: ${relative}`);
            assert.equal(base.hash(bytes), item.sha256, `G4-fix evidence SHA mismatch: ${relative}`);
            indexed.add(relative);
        }
        indexes.push({ path: name, sha256: base.hash(data), members: index.files.length });
    }
    assert.ok(indexes.length, 'Missing G4-fix evidence indexes');
    for (const name of files.keys()) if (name.endsWith('.zip')) {
        assert.ok(indexed.has(name), `Unindexed G4-fix browser trace: ${name}`);
    }
    indexes.sort((left, right) => left.path.localeCompare(right.path));
    if (expectedIndexes) assert.deepEqual(indexes, expectedIndexes, 'Extracted G4-fix evidence indexes differ');
    return indexes;
}

function validateExtractedEvidence(workspace, expectedIndexes) {
    return validateEvidence(collectFiles(path.join(workspace, evidenceRoot), {
        prefix: `bsv-lens/${evidenceRoot.slice(0, -1)}`
    }), expectedIndexes);
}

function command(receipt, executable, args, cwd, env) {
    let exitCode = 0, stdout = '', stderr = '';
    try { stdout = execFileSync(executable, args, { cwd, env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 240000 }); }
    catch (error) { exitCode = error.status ?? -1; stdout = String(error.stdout || ''); stderr = String(error.stderr || error.message); }
    receipt.commands.push({ executable, args, cwd, environment: env, exitCode, stdout, stderr });
    assert.equal(exitCode, 0, `${executable} ${args.join(' ')}\n${stdout}\n${stderr}`);
}

async function build({ publish = false } = {}) {
    const directory = await createRunOutput(root, 'g4-fix-package');
    const outputs = ['review', 'source'].map(mode => path.join(root, 'dist', `bsv-lens-hardware-g4-fix-${mode}.zip`));
    if (publish) {
        assert.ok(fs.existsSync(path.join(root, report)), 'Current G4_FIX_REPORT is required');
        for (const output of outputs) base.assertNewOutput(output);
    }
    const entries = collectEntries({ workspace: root });
    const source = entries.filter(entry => !entry.name.startsWith('bsv-lens/.build/'));
    const reportBytes = publish ? fs.readFileSync(path.join(root, report)) : null;
    if (publish) for (const members of [entries, source]) {
        const included = members.find(entry => entry.name === `bsv-lens/${report}`);
        assert.ok(included, 'Missing G4 fix report in archive');
        assert.deepEqual(included.data, reportBytes, 'Fix report bytes differ from workspace');
    }
    const evidenceIndexes = validateEvidence(entries);
    for (const members of [entries, source]) {
        validateEvidence(members, evidenceIndexes);
        for (const required of ['experiments/hardware/g4-fix/oracle/regressions.test.cjs',
            'experiments/hardware/g4-fix/oracle/geometry.cjs', 'experiments/hardware/g4-fix/geometry-check.cjs',
            'experiments/hardware/g4-fix/positive-smoke.cjs', 'test/hardware-navigation-context.test.js',
            'test/check.test.js', 'test/hardware-delivery.test.js']) {
            assert.ok(members.some(entry => entry.name === `bsv-lens/${required}`), `Missing fix payload ${required}`);
        }
    }
    const feature = runtime(entries);
    assert.deepEqual(runtime(source), feature, 'Review/source common runtime differs');
    const featureIdentity = base.hash(JSON.stringify(feature));
    const inputArtifacts = entries.filter(entry =>
        /^bsv-lens\/(?:docs\/hardware\/evidence\/(?:toolchain|g3-origin-ghc96)|experiments\/hardware\/fixtures)\//.test(entry.name))
        .map(entry => ({ path: entry.name, bytes: entry.data.length, sha256: base.hash(entry.data) }));
    const archives = ['review', 'source'].map(mode => path.join(directory, `${mode}.zip`));
    saveCandidate(archives[0], entries); saveCandidate(archives[1], source);
    // The historical G4 validator accepts only historical G4 report directories.
    // Its checks remain intact; this wrapper validates the new fix report itself.
    const validated = base.validateDelivery({ workspace: root, archives,
        retainExtraction: true, runDirectory: directory });
    const receipts = [];
    for (let index = 0; index < validated.length; index++) {
        const original = validated[index], candidate = archives[index];
        const extracted = path.join(original.isolation.freshEmptyExtraction, 'bsv-lens');
        const receipt = { ...original, schema: 'g4-fix-delivery-validation-v1', status: 'running',
            featureIdentity, commonRuntime: feature, inputArtifacts, commands: [...original.commands],
            isolation: { ...original.isolation, extractionRetained: false },
            browser: { status: 'NOT RUN IN OFFLINE LANE', dependency: '@playwright/test and actual Chrome',
                command: 'node experiments/hardware/g4-fix/browser.cjs' } };
        const env = { ...original.isolation.environment, G4_REVIEW_ROOT: extracted };
        try {
            for (const file of feature.filter(item => item.path.endsWith('.cjs'))) {
                command(receipt, process.execPath, ['--check', path.join(extracted, file.path.slice('bsv-lens/'.length))], extracted, env);
            }
            command(receipt, process.execPath, ['--no-global-search-paths', '--test',
                'experiments/hardware/g4-fix/oracle/regressions.test.cjs', 'test/check.test.js'], extracted, env);
            command(receipt, process.execPath, ['--no-global-search-paths',
                'experiments/hardware/g4-fix/positive-smoke.cjs'], extracted, env);
            command(receipt, process.execPath, ['--no-global-search-paths',
                'experiments/hardware/g4-fix/geometry-check.cjs'], extracted, env);
            const extractedEntries = collectEntries({ workspace: extracted });
            assert.deepEqual(runtime(extractedEntries), feature, 'Extracted public runtime bytes differ');
            if (publish) {
                assert.deepEqual(fs.readFileSync(path.join(extracted, report)), reportBytes, 'Extracted fix report changed');
                receipt.fixReport = { path: report, sha256: base.hash(reportBytes), matchedWorkspace: true };
            }
            receipt.evidenceIndexes = validateExtractedEvidence(extracted, evidenceIndexes);
            receipt.extractedEvidenceEquality = true;
            receipt.extractedRuntimeEquality = true;
            receipt.status = 'pass';
            receipt.sha256 = base.hash(fs.readFileSync(candidate));
            receipts.push(receipt);
        } catch (error) {
            receipt.error = String(error.stack || error); receipt.status = 'fail';
            throw error;
        } finally {
            fs.writeFileSync(path.join(directory, `${index ? 'source' : 'review'}-fix-validation.json`),
                `${JSON.stringify(receipt, null, 2)}\n`, { flag: 'wx' });
            fs.rmSync(path.dirname(original.isolation.freshEmptyExtraction), { recursive: true, force: true });
        }
    }
    if (publish) for (let index = 0; index < receipts.length; index++) {
        const receipt = receipts[index], output = outputs[index], candidate = archives[index];
        base.assertNewOutput(output);
        fs.linkSync(candidate, output);
        fs.writeFileSync(`${output}.sha256`, `${receipt.sha256}  ${path.basename(output)}\n`, { flag: 'wx' });
        receipt.archive = output; receipt.sourceCandidate = candidate;
        const validation = Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`);
        fs.writeFileSync(`${output}.validation.json`, validation, { flag: 'wx' });
        fs.writeFileSync(`${output}.validation.json.sha256`,
            `${base.hash(validation)}  ${path.basename(output)}.validation.json\n`, { flag: 'wx' });
    }
    const summary = { directory, status: 'pass', finalArchivesCreated: publish, featureIdentity,
        archives: receipts.map(receipt => ({ archive: receipt.archive, sha256: receipt.sha256, status: receipt.status })) };
    fs.writeFileSync(path.join(directory, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`, { flag: 'wx' });
    console.log(JSON.stringify(summary, null, 2));
    return summary;
}
if (require.main === module) {
    assert.ok(process.argv.length === 3 && ['--stage', '--build'].includes(process.argv[2]), 'Usage: package.cjs --stage | --build');
    build({ publish: process.argv[2] === '--build' }).catch(error => { console.error(error); process.exitCode = 1; });
}
module.exports = { build, runtime, validateEvidence, validateExtractedEvidence };
