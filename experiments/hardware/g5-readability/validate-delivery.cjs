'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const legacy = require('../g5/validate-review.cjs');
const base = require('../g4/validate-delivery');
const fix = require('../g4-fix/package.cjs');
const { createRun } = require('./run.cjs');
const root = path.resolve(__dirname, '../../..');
const evidenceRoot = 'docs/hardware/evidence/g5-readability/';
const companionPath = 'docs/hardware/g5-readability/DELIVERY_COMPANION.json';
const omittedRoot = 'docs/hardware/evidence/g5/run-YTGBZS/';
const tracePath = name => /^docs\/hardware\/evidence\/g5-readability\/run-[A-Za-z0-9_-]+\/browser\/(?:before|after)\/trace(?:-[A-Za-z0-9_-]+)?\.zip$/.test(name);
const inventory = entries => entries.map(entry => ({ path: entry.name, bytes: entry.data.length, sha256: base.hash(entry.data) }))
    .sort((a, b) => a.path.localeCompare(b.path));

function relativeReference(name) {
    assert.ok(typeof name === 'string' && name && !/[:\\\0]/.test(name)
        && name.split('/').every(part => part && part !== '.' && part !== '..'), `Unsafe readability reference: ${name}`);
    assert.ok(!name.split('/').some(part => ['.omx', '.codegraph'].includes(part)), `Forbidden readability reference: ${name}`);
    return name;
}
function safe(name) {
    relativeReference(name);
    assert.ok(!base.forbidden(name) || tracePath(name) || legacy.tracePath(name), `Forbidden readability reference: ${name}`);
    return name;
}

function validateEvidence(entries, { allowIncompleteBrowser = false, expected } = {}) {
    const files = new Map(), indexes = [], covered = new Set(), journeys = new Set(), checks = new Set();
    let beforeCount = 0, afterCount = 0, semanticCount = 0, semanticDetailsCount = 0;
    for (const entry of entries) {
        assert.ok(entry.name.startsWith('bsv-lens/'), 'Unexpected readability archive root');
        const name = safe(entry.name.slice('bsv-lens/'.length));
        assert.ok(!files.has(name), `Duplicate readability member: ${name}`); files.set(name, entry.data);
    }
    for (const [name, bytes] of files) {
        if (!name.startsWith(evidenceRoot) || !name.endsWith('/index.json')) continue;
        assert.match(name, /^docs\/hardware\/evidence\/g5-readability\/run-[A-Za-z0-9_-]+\/index\.json$/, 'Unapproved readability evidence root');
        const index = JSON.parse(bytes), members = new Set(), directory = path.posix.dirname(name);
        assert.equal(index.schema, 'g5-readability-evidence-v1');
        assert.ok(Array.isArray(index.files) && index.files.length, 'Empty readability index');
        assert.deepEqual(index.files.map(row => row.path), index.files.map(row => row.path).sort((a, b) => a.localeCompare(b)), 'Readability index must be path-sorted');
        for (const row of index.files) {
            const target = safe(`${directory}/${relativeReference(row.path)}`), data = files.get(target);
            assert.ok(target !== name && !members.has(target), `Duplicate/self readability reference: ${target}`);
            assert.ok(data, `Missing readability reference: ${target}`);
            assert.ok(Number.isSafeInteger(row.bytes) && row.bytes >= 0, `Invalid readability size: ${target}`);
            assert.equal(data.length, row.bytes, `Readability size mismatch: ${target}`);
            assert.equal(base.hash(data), row.sha256, `Readability SHA mismatch: ${target}`);
            members.add(target); covered.add(target);
        }
        const ref = value => {
            const target = safe(`${directory}/${relativeReference(value)}`);
            assert.ok(members.has(target), `Unindexed readability receipt reference: ${target}`); return target;
        };
        const json = value => JSON.parse(files.get(ref(value)));
        for (const phase of ['before', 'after']) {
            const browser = index.browser?.[phase];
            if (!browser) continue;
            for (const [key, extension] of [['traces', /\.zip$/], ['captures', /\.png$/], ['measurements', /\.json$/]]) {
                assert.ok(Array.isArray(browser[key]) && browser[key].length, `Missing ${phase} ${key}`);
                for (const value of browser[key]) {
                    const target = ref(value); assert.match(target, extension);
                    assert.ok(target.startsWith(`${directory}/browser/${phase}/`), `Wrong ${phase} browser attachment: ${target}`);
                    if (key === 'traces') assert.ok(tracePath(target), 'Unapproved readability trace');
                }
            }
            assert.ok(ref(browser.receipt).startsWith(`${directory}/browser/${phase}/`), `Wrong ${phase} browser receipt`);
            const receipt = json(browser.receipt);
            if (phase === 'before') { assert.equal(receipt.status, 'captured'); beforeCount++; }
            else {
                assert.equal(receipt.status, 'pass', 'Readability browser did not pass'); afterCount++;
                for (const journey of receipt.journeys || []) {
                    assert.match(journey.id, /^J(?:0[1-9]|1[0-9]|20)$/); assert.equal(journey.status, 'pass'); journeys.add(journey.id);
                }
            }
        }
        if (index.semanticComparison) {
            const comparison = json(index.semanticComparison);
            assert.equal(comparison.status, 'pass'); assert.ok(comparison.comparedTo, 'Semantic before/after comparison missing');
            assert.equal(comparison.semantic.queries.length, 12); assert.equal(comparison.semantic.correspondence.length, 9); semanticCount++;
        }
        if (index.semanticDetails) {
            const details = index.semanticDetails, receipt = json(details.receipt), requests = json(details.requests), results = json(details.results);
            assert.equal(receipt.schema, 'g5-readability-semantic-details-v1'); assert.equal(receipt.status, 'pass');
            assert.equal(results.schema, 'g5-readability-semantic-details-capture-v1');
            assert.equal(requests.length, 75, '75 detailed semantic requests required');
            for (const kind of ['behavior', 'source-dependencies', 'call-site', 'correspondence', 'same-net', 'dependencies'])
                assert.ok(requests.some(row => row.input.kind === kind), `Missing detailed semantic kind: ${kind}`);
            assert.deepEqual([...new Set(requests.map(row => row.buildId))].sort(), ['A', 'B', 'C']);
            assert.equal(results.queries.length, requests.length, 'Detailed semantic result count');
            assert.equal(receipt.queries.length, requests.length, 'Detailed semantic receipt count');
            assert.deepEqual(results.requests, requests, 'Detailed semantic requests differ');
            const requestOf = ({ buildId, label, input }) => ({ buildId, label, input });
            assert.deepEqual(results.queries.map(requestOf), requests, 'Detailed semantic query inputs differ');
            assert.deepEqual(receipt.queries.map(requestOf), requests, 'Detailed semantic receipt inputs differ');
            for (const row of receipt.queries) assert.equal(row.status, 'pass');
            for (const row of results.queries) assert.equal(row.result.kind, row.input.kind);
            assert.deepEqual(receipt.before.identities, results.identities); assert.deepEqual(receipt.after.identities, results.identities);
            semanticDetailsCount++;
        }
        for (const check of index.checks || []) {
            assert.ok(typeof check.id === 'string' && check.id, 'Missing readability check identity');
            const receipt = json(check.receipt);
            assert.ok(receipt.status === 'pass' || receipt.exit === 0 || receipt.exitCode === 0, `Failed readability check: ${check.id}`);
            assert.ok((receipt.status === undefined || receipt.status === 'pass') && (receipt.exit === undefined || receipt.exit === 0)
                && (receipt.exitCode === undefined || receipt.exitCode === 0) && !receipt.error && !receipt.spawnError, `Failed readability check: ${check.id}`);
            checks.add(check.id);
        }
        indexes.push({ path: name, sha256: base.hash(bytes), members: members.size });
    }
    assert.ok(indexes.length, 'Missing readability evidence index');
    for (const name of files.keys()) if (name.startsWith(evidenceRoot) && !indexes.some(index => index.path === name))
        assert.ok(covered.has(name), `Unindexed readability evidence: ${name}`);
    const complete = beforeCount > 0 && afterCount > 0 && journeys.size === 20 && semanticCount > 0 && semanticDetailsCount > 0
        && ['negative-tests', 'f1-f2', 'core', 'preservation'].every(id => checks.has(id));
    assert.ok(complete || allowIncompleteBrowser, 'Missing readability before/after, J01-J20, semantic or required checks');
    const result = { indexes: indexes.sort((a, b) => a.path.localeCompare(b.path)),
        browser: complete ? 'indexed-pass' : 'MISSING - CANDIDATE ONLY', journeys: [...journeys].sort(), checks: [...checks].sort() };
    if (expected) assert.deepEqual(result, expected, 'Post-replay readability evidence changed');
    return result;
}

function validateCompanion(entries) {
    assert.ok(!entries.some(entry => entry.name.startsWith(`bsv-lens/${omittedRoot}`)), 'Duplicate historical QA supplement in readability archive');
    const entry = entries.find(entry => entry.name === `bsv-lens/${companionPath}`);
    assert.ok(entry, 'Missing historical QA companion contract');
    const manifest = JSON.parse(entry.data);
    assert.equal(manifest.schema, 'g5-readability-companion-v1'); assert.equal(manifest.omittedRoot, omittedRoot);
    assert.equal(manifest.purpose, 'Historical G5 resume QA supplement only; preserved source/compiler/query evidence remains inline.');
    assert.ok(Array.isArray(manifest.inventory) && manifest.inventory.length);
    assert.equal(new Set(manifest.inventory.map(row => row.path)).size, manifest.inventory.length, 'Duplicate companion inventory member');
    assert.deepEqual(manifest.inventory.map(row => row.path), manifest.inventory.map(row => row.path).sort((a, b) => a.localeCompare(b)));
    for (const row of manifest.inventory) {
        assert.ok(safe(row.path).startsWith(omittedRoot)); assert.ok(Number.isSafeInteger(row.bytes) && row.bytes >= 0); assert.match(row.sha256, /^[a-f0-9]{64}$/);
    }
    assert.equal(manifest.inventorySha256, base.hash(JSON.stringify(manifest.inventory)));
    assert.deepEqual(manifest.archives.map(row => row.path), ['review', 'source'].map(mode => `dist/bsv-lens-hardware-g5-${mode}.zip`));
    for (const row of manifest.archives) { assert.ok(Number.isSafeInteger(row.bytes) && row.bytes > 0); assert.match(row.sha256, /^[a-f0-9]{64}$/); }
    return { path: companionPath, sha256: base.hash(entry.data), inventorySha256: manifest.inventorySha256, archives: manifest.archives };
}

function validateEntries(entries, sourceOnly, workspace = root, options = {}) {
    assert.equal(legacy.replayEntries(entries).length, entries.length, 'Archive contains replay-only output');
    const readability = validateEvidence(entries, { allowIncompleteBrowser: options.allowIncompleteBrowser, expected: options.expected?.readability });
    const companion = validateCompanion(entries);
    const members = legacy.validateEntries(entries.filter(entry => !tracePath(entry.name.slice('bsv-lens/'.length))), sourceOnly, workspace,
        { allowIncompleteBrowser: options.allowIncompleteBrowser });
    for (const name of ['package.cjs', 'validate-delivery.cjs', 'oracle.cjs', 'semantic.cjs', 'semantic-details.cjs', 'run.cjs'])
        assert.ok(entries.some(entry => entry.name === `bsv-lens/experiments/hardware/g5-readability/${name}`), `Missing readability tool: ${name}`);
    members.inherited.inventory = inventory(entries);
    members.runtime = fix.runtime(entries).sort((a, b) => a.path.localeCompare(b.path));
    members.evidence = { legacy: members.evidence, readability, companion, browser: readability.browser };
    if (options.expected) assert.deepEqual(members.evidence, options.expected, 'Post-replay delivery evidence changed');
    return members;
}

async function validateDelivery({ workspace = root, archives, directory = createRun('delivery'), allowIncompleteBrowser = false,
    playwrightEntry, browserScript = 'experiments/hardware/g5-readability/browser.cjs' } = {}) {
    const replayExtra = async ({ receipt, cwd, env, members }) => {
        receipt.schema = 'g5-readability-delivery-validation-v1';
        const output = path.join(directory, `replay-${receipt.mode}`); fs.mkdirSync(output);
        const semantic = path.join(output, 'semantic'); fs.mkdirSync(semantic);
        const indexed = members.evidence.readability.indexes.map(row => ({ directory: path.posix.dirname(row.path), index: JSON.parse(fs.readFileSync(path.join(cwd, row.path))) }));
        const baseline = indexed.find(row => row.index.semanticComparison);
        if (baseline) {
            legacy.command(receipt, process.execPath, ['--no-global-search-paths', 'experiments/hardware/g5-readability/semantic.cjs',
                `${baseline.directory}/${baseline.index.semanticComparison}`], cwd, { ...env, G5_READABILITY_OUTPUT_DIR: semantic });
        }
        receipt.semanticDetailsReplay = [];
        for (const row of indexed.filter(row => row.index.semanticDetails)) {
            const details = row.index.semanticDetails, requestPath = path.join(cwd, row.directory, details.requests);
            const resultPath = path.join(cwd, row.directory, details.results), expected = fs.readFileSync(resultPath, 'utf8');
            const command = legacy.command(receipt, process.execPath, ['--no-global-search-paths',
                'experiments/hardware/g5-readability/semantic-details.cjs', '--capture', cwd, requestPath], cwd, env);
            assert.equal(command.stdout, expected, 'Fresh detailed semantic stdout differs from indexed results');
            receipt.semanticDetailsReplay.push({ status: 'pass', queryCount: JSON.parse(expected).queries.length,
                requests: path.relative(cwd, requestPath), results: path.relative(cwd, resultPath),
                bytes: Buffer.byteLength(command.stdout), sha256: base.hash(command.stdout) });
        }
        if (playwrightEntry) {
            const browserOutput = path.join(output, 'browser'); fs.mkdirSync(browserOutput);
            assert.match(browserScript, /^experiments\/hardware\/g5-readability\/[A-Za-z0-9_-]+\.cjs$/);
            assert.ok(path.isAbsolute(playwrightEntry), 'Explicit absolute Playwright module entry required');
            const dependencyVersion = require(path.join(path.dirname(playwrightEntry), 'package.json')).version;
            legacy.command(receipt, process.execPath, ['--no-global-search-paths', browserScript], cwd, { ...env,
                G5_READABILITY_PLAYWRIGHT: playwrightEntry, G5_READABILITY_OUTPUT_DIR: browserOutput });
            const browserReceipt = JSON.parse(fs.readFileSync(path.join(browserOutput, 'browser/receipt.json')));
            assert.equal(browserReceipt.status, 'pass');
            assert.deepEqual(browserReceipt.journeys.filter(row => row.status === 'pass').map(row => row.id).sort(),
                Array.from({ length: 20 }, (_, i) => `J${String(i + 1).padStart(2, '0')}`));
            receipt.browserReplay = { status: 'pass', dependencyEntry: playwrightEntry, dependencyVersion, script: browserScript,
                output: browserOutput, files: inventory(require('../../../scripts/zip').collectFiles(browserOutput)) };
        } else receipt.browserReplay = 'not-run - supply --playwright-entry for installed QA dependency';
        receipt.readabilityReplayOutputs = inventory(require('../../../scripts/zip').collectFiles(output));
    };
    return legacy.validateDelivery({ archives, workspace, directory, allowIncompleteBrowser, validateMembers: validateEntries, replayExtra });
}

if (require.main === module) {
    const args = process.argv.slice(2), options = { archives: [] };
    while (args.length) {
        const value = args.shift();
        if (value === '--playwright-entry') options.playwrightEntry = args.shift();
        else if (value === '--browser-script') options.browserScript = args.shift();
        else if (value === '--allow-incomplete-browser') options.allowIncompleteBrowser = true;
        else options.archives.push(value);
    }
    validateDelivery(options).then(rows => console.log(JSON.stringify(rows.map(({ archive, status, sha256 }) => ({ archive, status, sha256 })), null, 2)))
        .catch(error => { console.error(error); process.exitCode = 1; });
}
module.exports = { evidenceRoot, companionPath, omittedRoot, tracePath, inventory, safe, validateEvidence, validateCompanion,
    validateEntries, validateDelivery, extraction: legacy.extraction };
