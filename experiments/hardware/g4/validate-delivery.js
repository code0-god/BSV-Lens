'use strict';

// G4 only. Importing the G3 validator does not execute its guarded CLI.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { collectFiles } = require('../../../scripts/zip');
const g3 = require('../g3/validate-delivery');
const root = path.resolve(__dirname, '../../..');
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const suffixes = ['', '.sha256', '.validation.json', '.validation.json.sha256'];
const required = [
    ...['architecture', 'scene', 'scene-query'].map(name => `src/hardware/${name}.js`),
    ...['view', 'navigation', 'layout', 'inspector'].map(name => `media/hardware-${name}.js`),
    'media/hardware.css', 'experiments/hardware/g4/index.html',
    ...['server', 'package', 'validate-delivery', 'run-output'].map(name => `experiments/hardware/g4/${name}.js`),
    'docs/hardware/g4/CONTRACT.md', 'docs/hardware/g4/DESIGN.md'
];

function assertAbsent(files) {
    for (const file of files) {
        let present = true;
        try { fs.lstatSync(file); } catch (error) { if (error.code !== 'ENOENT') throw error; present = false; }
        assert.ok(!present, `Refusing to overwrite prior delivery: ${file}`);
    }
}
function assertNewOutput(output) { assertAbsent(suffixes.map(suffix => output + suffix)); }
function archiveNames(workspace = root) {
    return ['review', 'source'].map(mode => path.join(workspace, 'dist', `bsv-lens-hardware-g4-${mode}.zip`));
}
function createRun(workspace = root) {
    const runs = path.join(workspace, '.build/hardware/runs');
    fs.mkdirSync(runs, { recursive: true });
    return fs.mkdtempSync(path.join(runs, 'g4-delivery-'));
}
function forbidden(relative) {
    return g3.forbidden(relative) || relative.split('/').some(part =>
        ['compiler-source', 'compiler-build', 'inst', 'bdir', 'tmp', 'temp', 'extracted', 'runtimes-only'].includes(part));
}
function replayPlan(entries) {
    const names = entries.map(entry => entry.name.replace(/^bsv-lens\//, ''));
    const tests = names.filter(name => /\.test\.js$/.test(name) &&
        (/^test\/hardware-/.test(name) || name.startsWith('experiments/hardware/g4/')));
    const browser = tests.filter(name => /(?:browser|e2e|acceptance)/i.test(path.basename(name)));
    const offline = tests.filter(name => !browser.includes(name) && name !== 'experiments/hardware/g4/package.test.js');
    const lanes = {};
    for (const lane of ['scene', 'navigation', 'layout', 'server']) {
        lanes[lane] = offline.filter(name => new RegExp(`(?:^|[-/])${lane}(?:[-.]|$)`).test(name));
        assert.ok(lanes[lane].length, `Missing G4 offline test lane: ${lane}`);
    }
    return { offline: offline.sort(), lanes, browser: { status: 'not-run', optionalDependencyLane: true,
        dependencies: ['@playwright/test', 'Playwright browser installation'], tests: browser.sort() } };
}
function validateEntries(entries, sourceOnly, workspace = root, { report } = {}) {
    const members = g3.validateEntries(entries, sourceOnly, workspace);
    const files = new Map(entries.map(entry => [entry.name.slice('bsv-lens/'.length), entry.data]));
    for (const name of files.keys()) assert.ok(!forbidden(name), `Forbidden G4 delivery member: ${name}`);
    for (const name of required) assert.ok(files.has(name), `Missing G4 delivery member: ${name}`);
    if (report) {
        assert.ok(/^docs\/hardware\/(?:g4\/|evidence\/g4\/|G4_)/.test(report) && !report.split('/').includes('..'), 'Report must be G4 documentation');
        assert.ok(files.get(report)?.length, `Missing G4 report: ${report}`);
    }
    return { ...members, g4: replayPlan(entries), report: report || null };
}

function command(receipt, executable, args, cwd, env, expectedExit = 0) {
    const started = new Date().toISOString();
    const result = spawnSync(executable, args, { cwd, env, encoding: 'utf8', timeout: 180000, maxBuffer: 64 * 1024 * 1024 });
    const row = { executable, args, cwd, started, finished: new Date().toISOString(), exit: result.status,
        signal: result.signal, stdout: result.stdout || '', stderr: result.stderr || '', expectedExit,
        error: result.error ? String(result.error) : null };
    receipt.commands.push(row);
    assert.ifError(result.error);
    assert.equal(result.status, expectedExit, `${executable} ${args.join(' ')}\n${row.stdout}\n${row.stderr}`);
    return row;
}
const extractPython = `import pathlib, stat, sys, zipfile
archive, destination = sys.argv[1:]
root = pathlib.Path(destination)
assert root.is_dir() and not list(root.iterdir()), 'Extraction directory must be empty'
with zipfile.ZipFile(archive) as z:
    seen = set()
    for info in z.infolist():
        name = info.filename
        assert name.startswith('bsv-lens/') and all(p not in ('', '.', '..') for p in name.split('/')), name
        assert '\\\\' not in name and '\\x00' not in name and name not in seen, name
        assert stat.S_IFMT(info.external_attr >> 16) in (0, stat.S_IFREG), name
        assert info.file_size <= 64*1024*1024, name
        seen.add(name)
    assert sum(i.file_size for i in z.infolist()) <= 512*1024*1024, 'Archive size limit'
    assert z.testzip() is None, 'ZIP CRC mismatch'
    z.extractall(root)
print('ZIP CRCs valid; extracted into fresh empty directory')`;

// Runs against the extracted public host/catalog, never mocked scene answers.
const publicSceneReplay = `const assert=require('node:assert/strict');
const {once}=require('node:events');
const {createServer}=require('./experiments/hardware/g4/server');
(async()=>{
 const server=await createServer();
 const ready=once(server,'listening',{signal:AbortSignal.timeout(30000)});
 server.listen(0,'127.0.0.1'); await ready;
 try {
  const base='http://127.0.0.1:'+server.address().port;
  const get=async url=>{const r=await fetch(base+url,{signal:AbortSignal.timeout(30000)});assert.equal(r.status,200);return r.json();};
  const catalog=await get('/api/catalog');assert.equal(catalog.length,3);
  let generation=0;
  for(const item of catalog){
   const intent={buildId:item.buildId,snapshotId:item.snapshotId,queryGeneration:++generation,sceneKind:'bsv'};
   const response=await get('/api/scene?build='+encodeURIComponent(item.buildId)+'&intent='+encodeURIComponent(JSON.stringify(intent)));
   assert.equal(response.requestSnapshotId,intent.snapshotId);assert.equal(response.queryGeneration,intent.queryGeneration);
   assert.equal(response.scene.sceneKind,'bsv');assert.ok(response.scene.shell.id);
   const child=response.scene.children[0];
   if(child){const entered=await get('/api/scene?build='+encodeURIComponent(item.buildId)+'&intent='+encodeURIComponent(JSON.stringify({...intent,queryGeneration:++generation,rootInstanceId:child.id,ownerInstanceId:child.id})));
    assert.equal(entered.scene.shell.id,child.id);}
   console.log(JSON.stringify({buildId:item.buildId,snapshotId:item.snapshotId,sceneId:response.scene.id,shellId:response.scene.shell.id,children:response.scene.children.length}));
  }
 } finally {await new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}
})().catch(error=>{console.error(error);process.exitCode=1;});`;

function replay(receipt, cwd, python, env) {
    const js = (...args) => command(receipt, process.execPath, ['--no-global-search-paths', ...args], cwd, env);
    const py = (...args) => command(receipt, python, ['-E', '-s', '-S', '-B', ...args], cwd, env);
    js('--version'); py('--version');
    // Check the actual resolver and compiler PATH boundary, not just receipt labels.
    js('-e', `const a=require('node:assert/strict'),fs=require('node:fs'),p=require('node:path');
const {spawnSync}=require('node:child_process');
a.deepEqual(fs.readdirSync(process.env.PATH).sort(),['node','python3']);
a.deepEqual(require('node:module').globalPaths,[]);
a.throws(()=>require.resolve('@playwright/test'),{code:'MODULE_NOT_FOUND'});
for(const c of ['bsc','bluetcl','yosys'])a.equal(spawnSync(c,['--version']).error.code,'ENOENT');
console.log('runtimes-only PATH; global lookup disabled; browser dependencies absent');`);
    js('--test', '--test-reporter=tap', ...receipt.members.g4.offline, 'experiments/hardware/g3/coverage.test.js');
    for (const args of [['A', 'mkConnected.left', 'get'], ['B', 'mkControl', 'read'], ['C', 'mkReuse.wide', 'get']]) {
        const result = JSON.parse(js('experiments/hardware/g3/query.js', ...args, 'connectivity').stdout);
        assert.ok(result.result.claims.length, `Empty stock public query: ${args[0]}`);
    }
    const stock = JSON.parse(js('experiments/hardware/g3/query.js', 'A', 'mkConnected.left', 'get', 'origin').stdout);
    assert.equal(stock.result.claims.length, 0);
    for (const args of [['A', 'mkConnected/left'], ['B', 'mkControl'], ['C', 'mkReuse/wide']]) {
        const result = JSON.parse(js('experiments/hardware/g3/origin-query.js', ...args).stdout);
        if (args[0] === 'B') assert.equal(result.result.claims.length, 0);
        else assert.ok(result.result.claims.length);
    }
    receipt.publicScenes = js('-e', publicSceneReplay).stdout.trim().split('\n').map(line => JSON.parse(line));
    py('experiments/hardware/bsv-evidence/check.py');
    py('experiments/hardware/toolchain/run.py', '--verify-evidence');
    py('experiments/hardware/g3-origin/verify.py');
    py('experiments/hardware/g3-origin/retry-verify.py');
    const base = 'docs/hardware/evidence/g3-origin-ghc96';
    py('experiments/hardware/g3-origin/ghc96-origin.py', '--run', base, '--verify', `${base}/results/origin-sidecar.json`);
    const comparison = path.join(path.dirname(cwd), 'noninterference.json');
    py('experiments/hardware/g3-origin/ghc96-compare.py', '--run', base, '--output', comparison);
    receipt.noninterference = JSON.parse(fs.readFileSync(comparison, 'utf8'));
    // Historical mutation tests use fixed scratch names only INSIDE this fresh copy.
    for (const script of ['test_verify.py', 'retry-test.py', 'ghc96-test.py']) py(`experiments/hardware/g3-origin/${script}`);
    const author = command(receipt, python, ['-E', '-s', '-S', '-B', 'experiments/hardware/bsv-evidence/check_author.py'], cwd, env, 1);
    receipt.authorPreservation = g3.checkAuthor(author, receipt.members.authorCompanions);
    js('scripts/check.js');
    receipt.browser = receipt.members.g4.browser;
    receipt.shippedOffline = 'pass';
}

function validateDelivery({ workspace = root, archives = archiveNames(workspace), python, report,
    retainExtraction = false, runDirectory = createRun(workspace) } = {}) {
    workspace = path.resolve(workspace);
    assert.equal(archives.length, 2, 'Provide review and source archives in that order');
    archives = archives.map(file => path.resolve(file));
    assert.notEqual(archives[0], archives[1]);
    for (const [index, archive] of archives.entries()) {
        const relative = path.relative(path.join(workspace, '.build/hardware/runs'), archive);
        assert.ok(archive === archiveNames(workspace)[index] || relative && !relative.startsWith('..') && !path.isAbsolute(relative),
            'Validation accepts only final G4 names or run-local candidates');
        assertAbsent([`${archive}.validation.json`, `${archive}.validation.json.sha256`]);
    }
    if (!python) {
        const found = spawnSync('python3', ['-E', '-s', '-S', '-B', '-c', 'import sys; print(sys.executable)'],
            { env: { PATH: process.env.PATH }, encoding: 'utf8', timeout: 10000 });
        assert.ifError(found.error); assert.equal(found.status, 0, found.stderr); python = found.stdout.trim();
    }
    assert.ok(path.isAbsolute(python), 'Python executable must be absolute');
    const results = [];
    for (const [index, archive] of archives.entries()) {
        const receipt = { schema: 'g4-delivery-validation-v1', archive, mode: index ? 'source' : 'review',
            status: 'fail', commands: [], liveCompilerReplay: 'not-run' };
        const temporary = fs.mkdtempSync(path.join(os.tmpdir(), `bsv-g4-${receipt.mode}-replay-`));
        const destination = path.join(temporary, 'extracted'), home = path.join(temporary, 'home'), bin = path.join(temporary, 'runtimes-only');
        for (const directory of [destination, home, bin]) fs.mkdirSync(directory);
        fs.symlinkSync(process.execPath, path.join(bin, 'node')); fs.symlinkSync(python, path.join(bin, 'python3'));
        const env = { PATH: bin, HOME: home, TMPDIR: temporary, LANG: 'C.UTF-8',
            PYTHONDONTWRITEBYTECODE: '1', NODE_OPTIONS: '--no-global-search-paths' };
        receipt.isolation = { environment: env, node: process.execPath, python,
            freshEmptyExtraction: destination, extractionRetained: retainExtraction };
        try {
            const digest = hash(fs.readFileSync(archive));
            assert.equal(fs.readFileSync(`${archive}.sha256`, 'utf8'), `${digest}  ${path.basename(archive)}\n`, `Archive SHA mismatch: ${archive}`);
            receipt.sha256 = digest;
            command(receipt, python, ['-E', '-s', '-S', '-B', '-c', extractPython, archive, destination], temporary, env);
            receipt.crc = 'pass';
            const cwd = path.join(destination, 'bsv-lens');
            receipt.members = validateEntries(collectFiles(cwd, { prefix: 'bsv-lens' }), !!index, workspace, { report });
            receipt.runtimeWorkspaceEquality = true;
            if (index) {
                assert.deepEqual(receipt.members.runtime, results[0].members.runtime, 'Review/source runtime mismatch');
                receipt.runtimeReviewEquality = true;
            }
            replay(receipt, cwd, python, env);
            receipt.status = 'pass'; results.push(receipt);
        } catch (error) { receipt.error = String(error.stack || error); throw error; }
        finally {
            const text = `${JSON.stringify(receipt, null, 2)}\n`;
            fs.writeFileSync(`${archive}.validation.json`, text, { flag: 'wx' });
            fs.writeFileSync(`${archive}.validation.json.sha256`, `${hash(text)}  ${path.basename(archive)}.validation.json\n`, { flag: 'wx' });
            if (!retainExtraction) fs.rmSync(temporary, { recursive: true, force: true });
        }
    }
    return results;
}

if (require.main === module) {
    const args = process.argv.slice(2);
    if (args.includes('--help')) console.log('Usage: node experiments/hardware/g4/validate-delivery.js [--retain-extraction] [REVIEW.zip SOURCE.zip]\nOnly G4 final names or candidates under .build/hardware/runs are accepted. Existing receipts are never replaced.');
    else {
        const positional = args.filter(arg => arg !== '--retain-extraction');
        try {
            assert.ok(!positional.some(arg => arg.startsWith('--')) && [0, 2].includes(positional.length), 'Provide review/source paths or --help');
            const results = validateDelivery({ archives: positional.length ? positional : undefined, retainExtraction: args.includes('--retain-extraction') });
            console.log(JSON.stringify(results.map(({ archive, status, sha256 }) => ({ archive, status, sha256 })), null, 2));
        } catch (error) { console.error(error.stack || error); process.exitCode = 1; }
    }
}
module.exports = { archiveNames, assertAbsent, assertNewOutput, createRun, forbidden, hash,
    replayPlan, validateEntries, validateDelivery };
