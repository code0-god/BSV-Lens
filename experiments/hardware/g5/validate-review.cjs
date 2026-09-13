'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { collectFiles } = require('../../../scripts/zip');
const base = require('../g4/validate-delivery');
const fix = require('../g4-fix/package.cjs');
const { checkAuthor } = require('../g3/validate-delivery');
const { createRun } = require('./run.cjs');
const root = path.resolve(__dirname, '../../..');
const evidenceRoot = 'docs/hardware/evidence/g5/';
const replayOutputRoot = 'bsv-lens/.build/hardware/runs/';
const replayEntries = entries => entries.filter(entry => !entry.name.startsWith(replayOutputRoot));
const tracePath = name => /^docs\/hardware\/evidence\/g5\/run-[A-Za-z0-9_-]+\/browser\/trace\.zip$/.test(name);
const relativeReference = name => {
    assert.ok(typeof name === 'string' && name && !/[:\\\0]/.test(name)
        && name.split('/').every(part => part && part !== '.' && part !== '..'), `Unsafe G5 reference: ${name}`);
    return name;
};
const safe = name => {
    relativeReference(name);
    assert.ok(!name.split('/').some(part => ['.omx', '.codegraph'].includes(part)), `Forbidden G5 reference: ${name}`);
    assert.ok(!base.forbidden(name) || tracePath(name), `Forbidden G5 reference: ${name}`);
    return name;
};
const semantic = result => Object.fromEntries(Object.entries(result).filter(([key]) => !['metrics', 'request'].includes(key)));

function validateEvidence(entries, { allowIncompleteBrowser = false, expected } = {}) {
    const files = new Map();
    for (const entry of entries) {
        assert.ok(entry.name.startsWith('bsv-lens/'), 'Unexpected archive root');
        const name = safe(entry.name.slice('bsv-lens/'.length));
        assert.ok(!files.has(name), `Duplicate G5 member: ${name}`);
        files.set(name, entry.data);
    }
    const get = name => { const data = files.get(safe(name)); assert.ok(data, `Missing G5 reference: ${name}`); return data; };
    const indexes = [], indexed = new Set(), queries = [], journeys = new Set();
    const verify = (basePath, rows) => {
        assert.ok(Array.isArray(rows) && rows.length, `Empty G5 index: ${basePath}`);
        const seen = new Set();
        for (const item of rows) {
            const name = safe(`${path.posix.dirname(basePath)}/${relativeReference(item.path)}`);
            assert.ok(name !== basePath && !seen.has(name), `Duplicate/self G5 reference: ${name}`); seen.add(name);
            assert.ok(Number.isSafeInteger(item.bytes) && item.bytes >= 0, `Invalid G5 size: ${name}`);
            const data = get(name);
            assert.equal(data.length, item.bytes, `G5 size mismatch: ${name}`);
            assert.equal(base.hash(data), item.sha256, `G5 SHA mismatch: ${name}`);
            indexed.add(name);
        }
        return seen;
    };
    for (const [name, bytes] of files) {
        if (!name.startsWith(evidenceRoot) || !name.endsWith('/index.json')) continue;
        const index = JSON.parse(bytes);
        const members = verify(name, index.files);
        indexes.push({ path: name, sha256: base.hash(bytes), members: index.files.length });
        const ref = relative => {
            const target = safe(`${path.posix.dirname(name)}/${relativeReference(relative)}`);
            assert.ok(members.has(target), `Unindexed G5 receipt reference: ${target}`); return target;
        };
        for (const query of index.queries || []) {
            assert.ok(['A', 'B', 'C'].includes(query.buildId), 'Actual A/B/C build required');
            const request = ref(query.request), result = ref(query.result), receipt = ref(query.receipt);
            const command = JSON.parse(get(receipt));
            assert.equal(command.exit, 0, 'Failed indexed query receipt');
            assert.equal(command.buildId, query.buildId);
            assert.equal(command.requestSha256, base.hash(get(request)));
            assert.equal(command.resultSha256, base.hash(get(result)));
            const input = JSON.parse(get(request)), output = JSON.parse(get(result));
            assert.equal(input.kind, output.kind); assert.ok(output.id && output.queryId);
            queries.push({ buildId: query.buildId, request, result, receipt, kind: input.kind });
        }
        if (index.browser) {
            assert.equal(index.browser.status, 'pass', 'Browser evidence did not pass');
            assert.equal(index.browser.interaction, 'real-pointer-keyboard');
            assert.ok(tracePath(ref(index.browser.trace)), 'Browser trace must use narrow G5 trace path');
            assert.ok(Array.isArray(index.browser.captures) && index.browser.captures.length, 'Missing G5 captures');
            for (const capture of index.browser.captures) assert.match(ref(capture), /\.(png|webp)$/);
            const browserReceipt = JSON.parse(get(ref(index.browser.receipt)));
            assert.equal(browserReceipt.status, 'pass');
            for (const journey of browserReceipt.journeys || []) {
                assert.equal(journey.status, 'pass'); assert.match(journey.id, /^J(?:0[1-9]|1[0-5])$/);
                journeys.add(journey.id);
            }
        }
    }
    assert.ok(indexes.length, 'Missing G5 evidence indexes');
    for (const name of files.keys()) if (name.startsWith(evidenceRoot) && !name.endsWith('/index.json')
        && !name.startsWith(`${evidenceRoot}semantics/`)) assert.ok(indexed.has(name), `Unindexed G5 evidence: ${name}`);
    for (const build of ['A', 'B', 'C']) for (const kind of ['same-net', 'drivers-loads', 'dependencies', 'state-accesses'])
        assert.ok(queries.some(query => query.buildId === build && query.kind === kind), `Missing G5 actual query: ${build}/${kind}`);
    const manifestPath = `${evidenceRoot}semantics/manifest.json`, manifest = JSON.parse(get(manifestPath));
    verify(manifestPath, [...manifest.references, manifest.census]);
    indexes.push({ path: manifestPath, sha256: base.hash(get(manifestPath)), members: manifest.references.length + 1 });
    indexes.sort((a, b) => a.path.localeCompare(b.path));
    const browserComplete = journeys.size === 15;
    assert.ok(browserComplete || allowIncompleteBrowser, 'Missing G5 browser journeys J01-J15');
    const result = { indexes, queries, browser: browserComplete ? 'indexed-pass' : 'MISSING - CANDIDATE ONLY' };
    if (expected) assert.deepEqual(result, expected, 'Post-replay G5 evidence changed');
    return result;
}

function validateEntries(entries, sourceOnly, workspace, options) {
    assert.equal(replayEntries(entries).length, entries.length, 'Archive contains replay-only output');
    const evidence = validateEvidence(entries, options);
    // Only these independently hashed/indexed G5 trace bytes bypass the historical ZIP filter.
    const inherited = base.validateEntries(entries.filter(entry => !tracePath(entry.name.slice('bsv-lens/'.length))), sourceOnly, workspace);
    const fixIndexes = fix.validateEvidence(entries);
    for (const name of ['package-review.cjs', 'validate-review.cjs', 'delivery-replay.cjs', 'query.cjs', 'cell-reference.cjs', 'source-reference.cjs'])
        assert.ok(entries.some(entry => entry.name === `bsv-lens/experiments/hardware/g5/${name}`), `Missing G5 tool: ${name}`);
    for (const name of ['connectivity', 'dependencies', 'lifecycle', 'source', 'semantics-reference', 'source-reference', 'delivery'])
        assert.ok(entries.some(entry => entry.name === `bsv-lens/test/hardware-analysis-${name}.test.js`), `Missing G5 test: ${name}`);
    return { inherited, evidence, fixIndexes, runtime: fix.runtime(entries) };
}
function command(receipt, executable, args, cwd, env, expectedExit = 0) {
    const result = spawnSync(executable, args, { cwd, env, encoding: 'utf8', timeout: 240000, maxBuffer: 64 * 1024 * 1024 });
    const row = { executable, args, cwd, exit: result.status, signal: result.signal, stdout: result.stdout || '', stderr: result.stderr || '', expectedExit };
    receipt.commands.push(row); assert.ifError(result.error);
    assert.equal(result.status, expectedExit, `${executable} ${args.join(' ')}\n${row.stdout}\n${row.stderr}`); return row;
}
// Preserved G0-G4 and indexed G5 captures exceed the historical 512 MiB
// envelope. Keep a bounded 768 MiB budget without dropping original evidence.
const extraction = `import pathlib, stat, sys, zipfile
root = pathlib.Path(sys.argv[2]); assert root.is_dir() and not list(root.iterdir())
with zipfile.ZipFile(sys.argv[1]) as z:
 seen = set()
 for i in z.infolist():
  n = i.filename
  assert n.startswith('bsv-lens/') and all(p not in ('', '.', '..') for p in n.split('/')) and not any(c in n for c in ['\\\\', '\\x00', ':']), n
  assert n not in seen and stat.S_IFMT(i.external_attr >> 16) in (0, stat.S_IFREG), n
  assert i.file_size <= 64*1024*1024, 'ARCHIVE_MEMBER_SIZE'; seen.add(n)
 assert sum(i.file_size for i in z.infolist()) <= 768*1024*1024, 'ARCHIVE_TOTAL_SIZE'
 assert z.testzip() is None
 z.extractall(root)
print('CRC PASS; actual archive extracted into empty external directory')`;
function writeReceipt(archive, receipt) {
    const text = `${JSON.stringify(receipt, null, 2)}\n`;
    fs.writeFileSync(`${archive}.validation.json`, text, { flag: 'wx' });
    fs.writeFileSync(`${archive}.validation.json.sha256`, `${base.hash(text)}  ${path.basename(archive)}.validation.json\n`, { flag: 'wx' });
}
async function runPublicQueries(context, runner) {
    if (runner === undefined) return JSON.parse(context.js('experiments/hardware/g5/delivery-replay.cjs', '--replay').stdout);
    assert.equal(typeof runner, 'function', 'Explicit public query replay runner required');
    const { result, verification } = await runner(context);
    assert.equal(result?.status, 'pass'); assert.ok(Array.isArray(result.queries) && result.queries.length > 0, 'Replacement replay cannot skip original queries');
    assert.equal(result.cancellation?.status, 'pass'); assert.equal(result.cancellation.workerExited, true);
    assert.equal(verification?.status, 'pass'); assert.equal(verification.executedQueryCount, result.queries.length);
    for (const surface of ['cli', 'http', 'source']) assert.equal(verification[surface], 'PASS', `Replacement replay did not verify ${surface}`);
    context.receipt.publicQueriesReplacement = verification;
    return result;
}
async function validateDelivery({ archives, workspace = root, allowIncompleteBrowser = false, directory,
    validateMembers = validateEntries, replayExtra, publicQueriesRunner } = {}) {
    assert.ok(Array.isArray(archives) && archives.length === 2, 'Explicit review/source archives required; no companion discovery');
    archives = archives.map(file => path.resolve(file)); assert.notEqual(...archives);
    for (const archive of archives) base.assertAbsent([`${archive}.validation.json`, `${archive}.validation.json.sha256`]);
    directory ||= await createRun('delivery-validation');
    const discovery = { commands: [] };
    const python = command(discovery, 'python3', ['-E', '-s', '-S', '-B', '-c', 'import sys; print(sys.executable)'], workspace,
        { PATH: process.env.PATH }).stdout.trim();
    assert.ok(path.isAbsolute(python));
    const receipts = [];
    for (const [index, archive] of archives.entries()) {
        const receipt = { schema: 'g5-delivery-validation-v1', archive, mode: index ? 'source' : 'review', status: 'fail', commands: [],
            runtimeDiscovery: discovery.commands, liveCompilerReplay: 'not-run', browserReplay: 'not-run - offline lane verifies indexed evidence' };
        const temporary = fs.mkdtempSync(path.join(os.tmpdir(), `bsv-g5-${receipt.mode}-`));
        const destination = path.join(temporary, 'extracted'), bin = path.join(temporary, 'runtimes-only'), home = path.join(temporary, 'home');
        for (const name of [destination, bin, home]) fs.mkdirSync(name);
        assert.ok(!path.resolve(temporary).startsWith(`${path.resolve(workspace)}${path.sep}`), 'Extraction must be external');
        fs.symlinkSync(process.execPath, path.join(bin, 'node')); fs.symlinkSync(python, path.join(bin, 'python3'));
        const cwd = path.join(destination, 'bsv-lens');
        const env = { PATH: bin, HOME: home, TMPDIR: temporary, LANG: 'C.UTF-8', NODE_OPTIONS: '--no-global-search-paths',
            PYTHONDONTWRITEBYTECODE: '1', G4_REVIEW_ROOT: cwd, G5_OUTPUT_DIR: path.join(temporary, 'g5') };
        fs.mkdirSync(env.G5_OUTPUT_DIR);
        receipt.isolation = { freshEmptyExtraction: destination, environment: env, extractionRetained: false,
            automaticCompanionDiscovery: false, workspaceSymlinks: false };
        const js = (...args) => command(receipt, process.execPath, ['--no-global-search-paths', ...args], cwd, env);
        const py = (...args) => command(receipt, python, ['-E', '-s', '-S', '-B', ...args], cwd, env);
        try {
            receipt.sha256 = base.hash(fs.readFileSync(archive));
            assert.equal(fs.readFileSync(`${archive}.sha256`, 'utf8'), `${receipt.sha256}  ${path.basename(archive)}\n`, 'Archive SHA mismatch');
            command(receipt, python, ['-E', '-s', '-S', '-B', '-c', extraction, archive, destination], temporary, env); receipt.crc = 'pass';
            const entries = collectFiles(cwd, { prefix: 'bsv-lens' });
            const members = validateMembers(entries, !!index, workspace, { allowIncompleteBrowser });
            receipt.commonRuntime = members.runtime; receipt.featureIdentity = base.hash(JSON.stringify(members.runtime));
            if (index) {
                assert.notEqual(destination, receipts[0].isolation.freshEmptyExtraction);
                assert.deepEqual(members.runtime, receipts[0].commonRuntime, 'Common runtime bytes differ');
            }
            js('-e', `const a=require('node:assert/strict'),f=require('node:fs'),p=require('node:path'),s=require('node:child_process').spawnSync;
a.deepEqual(require('node:module').globalPaths,[]);a.deepEqual(f.readdirSync(process.env.PATH).sort(),['node','python3']);
a.throws(()=>require.resolve('@playwright/test'),{code:'MODULE_NOT_FOUND'});
for(const n of ['bsc','bluetcl','yosys'])a.equal(s(n,['--version']).error.code,'ENOENT');
function walk(d){for(const n of f.readdirSync(d)){const x=p.join(d,n),v=f.lstatSync(x);a.ok(!v.isSymbolicLink());a.notEqual(n,'node_modules');if(v.isDirectory())walk(x);}}walk(process.cwd());console.log('isolation PASS');`);
            for (const file of members.runtime.filter(row => /\.(?:js|cjs|mjs)$/.test(row.path))) js('--check', file.path.slice('bsv-lens/'.length));
            js('--test', '--test-reporter=tap', ...members.inherited.g4.offline,
                'experiments/hardware/g3/coverage.test.js', 'experiments/hardware/g4-fix/oracle/regressions.test.cjs', 'test/check.test.js');
            js('experiments/hardware/g4-fix/positive-smoke.cjs');
            js('-e', `require('./experiments/hardware/g4-fix/geometry-check.cjs').runCorpus().then(r=>{console.log(JSON.stringify(r));require('node:assert/strict').equal(r.valid,true)}).catch(e=>{console.error(e);process.exitCode=1})`);
            receipt.publicQueries = await runPublicQueries({ receipt, cwd, env, js, py, members }, publicQueriesRunner);
            if (index) assert.deepEqual(receipt.publicQueries, receipts[0].publicQueries, 'Review/source public ordered results differ');
            for (const args of [['A', 'mkConnected.left', 'get'], ['B', 'mkControl', 'read'], ['C', 'mkReuse.wide', 'get']])
                assert.ok(JSON.parse(js('experiments/hardware/g3/query.js', ...args, 'connectivity').stdout).result.claims.length);
            assert.equal(JSON.parse(js('experiments/hardware/g3/query.js', 'A', 'mkConnected.left', 'get', 'origin').stdout).result.claims.length, 0);
            for (const args of [['A', 'mkConnected/left'], ['B', 'mkControl'], ['C', 'mkReuse/wide']]) {
                const output = JSON.parse(js('experiments/hardware/g3/origin-query.js', ...args).stdout);
                assert.ok(args[0] === 'B' ? output.result.claims.length === 0 : output.result.claims.length > 0);
            }
            py('experiments/hardware/bsv-evidence/check.py'); py('experiments/hardware/toolchain/run.py', '--verify-evidence');
            for (const file of ['verify.py', 'retry-verify.py', 'test_verify.py', 'retry-test.py', 'ghc96-test.py']) py(`experiments/hardware/g3-origin/${file}`);
            const origin = 'docs/hardware/evidence/g3-origin-ghc96';
            py('experiments/hardware/g3-origin/ghc96-origin.py', '--run', origin, '--verify', `${origin}/results/origin-sidecar.json`);
            const comparison = path.join(env.G5_OUTPUT_DIR, 'noninterference.json');
            py('experiments/hardware/g3-origin/ghc96-compare.py', '--run', origin, '--output', comparison);
            receipt.noninterference = JSON.parse(fs.readFileSync(comparison));
            const author = command(receipt, python, ['-E', '-s', '-S', '-B', 'experiments/hardware/bsv-evidence/check_author.py'], cwd, env, 1);
            receipt.authorPreservation = checkAuthor(author, members.inherited.authorCompanions);
            js('scripts/check.js');
            if (replayExtra) await replayExtra({ receipt, cwd, env, js, py, members });
            const replayed = collectFiles(cwd, { prefix: 'bsv-lens' });
            receipt.generatedRunOutputs = replayed.filter(entry => entry.name.startsWith(replayOutputRoot))
                .map(entry => ({ path: entry.name, bytes: entry.data.length, sha256: base.hash(entry.data) }));
            const after = validateMembers(replayEntries(replayed), !!index, workspace,
                { allowIncompleteBrowser, expected: members.evidence });
            assert.deepEqual(after.fixIndexes, members.fixIndexes); assert.deepEqual(after.runtime, members.runtime);
            assert.deepEqual(after.inherited.inventory, members.inherited.inventory, 'Shipped files changed during replay');
            assert.equal(base.hash(fs.readFileSync(archive)), receipt.sha256, 'Archive changed during replay');
            receipt.evidence = after.evidence; receipt.postReplayClosure = 'pass';
            receipt.status = members.evidence.browser === 'indexed-pass' ? 'pass' : 'candidate-pass-browser-missing';
            receipts.push(receipt);
        } catch (error) { receipt.error = String(error.stack || error); throw error; }
        finally { writeReceipt(archive, receipt); fs.rmSync(temporary, { recursive: true, force: true }); }
    }
    return receipts;
}
if (require.main === module) {
    const args = process.argv.slice(2), allowIncompleteBrowser = args[0] === '--allow-incomplete-browser';
    if (allowIncompleteBrowser) args.shift();
    validateDelivery({ archives: args, allowIncompleteBrowser }).then(receipts => console.log(JSON.stringify(receipts.map(({ archive, status, sha256 }) => ({ archive, status, sha256 })), null, 2)))
        .catch(error => { console.error(error); process.exitCode = 1; });
}
module.exports = { evidenceRoot, tracePath, safe, semantic, validateEvidence, validateEntries, validateDelivery, command, writeReceipt, extraction, replayEntries, runPublicQueries };
