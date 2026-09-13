'use strict';

// Author delivery only: no compiler command, dependency install, or implicit replay.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { collectFiles } = require('../../../scripts/zip');
const root = path.resolve(__dirname, '../../..');
const hash = data => crypto.createHash('sha256').update(data).digest('hex');
const originBases = ['g3-origin', 'g3-origin-retry', 'g3-origin-ghc96'].map(name => `docs/hardware/evidence/${name}`);
const required = [
    ...['index', 'registry', 'snapshot', 'json', 'import-worker', 'yosys-json'].map(name => `src/hardware/${name}.js`),
    ...['index', 'build', 'schema', 'source', 'stock', 'worker', 'origin', 'origin-data', 'origin-worker']
        .map(name => `src/hardware/correspondence/${name}.js`),
    ...['import', 'snapshot', 'independent', 'correspondence', 'correspondence-independent', 'origin']
        .map(name => `test/hardware-${name}.test.js`),
    ...['query.js', 'origin-query.js', 'validate-delivery.js', 'coverage.test.js'].map(name => `experiments/hardware/g3/${name}`),
    ...['G3_CONTRACT.md', 'G3_A_CHECKPOINT.md', 'G3_ARCHITECTURE.md', 'G3_CORRESPONDENCE_SCHEMA.md',
        'G3_ORIGIN_EXPERIMENT.md', 'G3_COVERAGE.json', 'G3_COVERAGE.md', 'G3_REPORT.md', 'OFFLINE_REPRODUCIBILITY.md']
        .map(name => `docs/hardware/${name}`),
    ...['A', 'B', 'C', 'coverage'].map(name => `docs/hardware/evidence/g3-a/${name}.json`),
    'docs/hardware/evidence/bsv/offline-inputs.json', 'docs/hardware/evidence/toolchain/manifest.json',
    'experiments/hardware/bsv-evidence/check.py', 'experiments/hardware/bsv-evidence/check_author.py',
    'experiments/hardware/toolchain/run.py', 'scripts/check.js', 'scripts/zip.js',
    ...['verify.py', 'retry-verify.py', 'ghc96-origin.py', 'ghc96-reader.py', 'ghc96-compare.py', 'ghc96-test.py',
        'test_verify.py', 'retry-test.py', 'ghc96-stage.py', 'ghc96-provision.sh']
        .map(name => `experiments/hardware/g3-origin/${name}`),
    ...originBases.map(base => `${base}/INVENTORY.json`)
];

function forbidden(relative) {
    const segments = relative.split('/');
    return segments.some(segment => ['.git', '.omo', '.vscode-test', 'node_modules', 'dist', '__pycache__',
        '.cache', 'cache', 'caches', 'tools', 'credentials', 'profiles', 'browser-profile', '.ssh', '.aws', '.gnupg'].includes(segment))
        || segments.some(segment => /^\.env(?:\.|$)/.test(segment))
        || /(?:\.pyc|\.DS_Store|\.pem|\.key|\.tar(?:\.gz|\.xz)?|\.dylib|\.so|\.exe)$/.test(relative)
        // G4-fix ships original browser traces; its wrapper verifies indexed size/hash closure.
        || relative.endsWith('.zip') && !/^docs\/hardware\/evidence\/g4-fix\/run-[A-Za-z0-9_-]+\/browser\/trace\.zip$/.test(relative);
}

function safeRef(relative) {
    assert.equal(typeof relative, 'string');
    assert.ok(relative && !relative.includes('\\') && !relative.includes('\0') && !path.posix.isAbsolute(relative)
        && relative.split('/').every(part => part && part !== '.' && part !== '..'), `Unsafe delivery path: ${relative}`);
    return relative;
}

function validateEntries(entries, sourceOnly, workspace = root) {
    const files = new Map();
    for (const entry of entries) {
        assert.ok(entry.name.startsWith('bsv-lens/'), `Unexpected ZIP root: ${entry.name}`);
        const relative = safeRef(entry.name.slice('bsv-lens/'.length));
        assert.ok(!files.has(relative), `Duplicate delivery member: ${relative}`);
        assert.ok(!forbidden(relative), `Forbidden delivery member: ${relative}`);
        assert.ok(!sourceOnly || !relative.startsWith('.build/'), `Source archive contains historical .build evidence: ${relative}`);
        files.set(relative, Buffer.from(entry.data));
    }
    const get = relative => {
        const bytes = files.get(safeRef(relative));
        assert.ok(bytes, `Missing G3 delivery member: ${relative}`);
        return bytes;
    };
    for (const relative of required) get(relative);
    if (!sourceOnly) for (const relative of ['.build/hardware/g0/results.json', '.build/hardware/g2-product/API.md',
        '.build/hardware/g3-a/CHECKPOINT.json']) get(relative);
    const json = relative => JSON.parse(get(relative).toString('utf8'));
    const inventories = [];
    const verify = (manifest, base = '') => {
        const inventory = json(manifest);
        for (const item of inventory.files) {
            const relative = base + safeRef(item.path);
            assert.notEqual(relative, manifest, `Self-referencing inventory: ${manifest}`);
            const bytes = get(relative);
            assert.equal(hash(bytes), item.sha256, `Delivery input SHA mismatch: ${relative}`);
            if (item.bytes !== undefined) assert.equal(bytes.length, item.bytes, `Delivery input size mismatch: ${relative}`);
        }
        inventories.push({ path: manifest, sha256: hash(get(manifest)), members: inventory.files.length });
    };
    const scope = json('docs/hardware/evidence/bsv/offline-inputs.json');
    assert.equal(scope.authorCompanions.length, 14, 'Author companion contract changed');
    assert.equal(new Set(scope.authorCompanions).size, 14);
    for (const companion of scope.authorCompanions) assert.ok(!files.has(companion), `Author companion shipped: ${companion}`);
    assert.equal(hash(get(scope.preservedManifest.path)), scope.preservedManifest.sha256);
    for (const row of json(scope.preservedManifest.path).files.filter(row => !scope.authorCompanions.includes(row.path))) {
        assert.equal(hash(get(row.path)), row.sha256, `Preserved input SHA mismatch: ${row.path}`);
    }
    verify('docs/hardware/evidence/bsv/offline-inputs.json');
    verify('docs/hardware/evidence/toolchain/manifest.json');
    for (const base of originBases) verify(`${base}/INVENTORY.json`, `${base}/`);
    // Compare product/Source/Semantic bytes and the executable offline harness, not only named workers.
    const isRuntime = relative => relative.startsWith('src/') || relative.startsWith('media/')
        || relative.startsWith('scripts/') || /^experiments\/hardware\/.+\.(js|py|sh|tcl)$/.test(relative);
    const runtime = collectFiles(workspace, { include: isRuntime,
        exclude: relative => forbidden(relative) || !['src', 'media', 'scripts', 'experiments'].includes(relative.split('/')[0]) });
    const runtimeNames = new Set(runtime.map(entry => entry.name));
    assert.deepEqual([...files.keys()].filter(isRuntime).sort(),
        [...runtimeNames].sort(), 'Runtime member set differs from workspace');
    for (const entry of runtime) assert.ok(get(entry.name).equals(entry.data), `Runtime bytes differ from workspace: ${entry.name}`);
    for (const name of fs.readdirSync(path.join(workspace, 'test')).filter(name => /^hardware-.*\.test\.js$/.test(name)))
        assert.ok(get(`test/${name}`).equals(fs.readFileSync(path.join(workspace, 'test', name))), `Hardware test differs: ${name}`);
    return { members: files.size, inventories, authorCompanions: scope.authorCompanions,
        runtime: runtime.map(entry => ({ path: entry.name, bytes: entry.data.length, sha256: hash(entry.data) })),
        inventory: [...files].map(([name, bytes]) => ({ path: name, bytes: bytes.length, sha256: hash(bytes) })) };
}

function assertNewOutput(output) {
    for (const suffix of ['', '.sha256', '.validation.json'])
        assert.ok(!fs.existsSync(`${output}${suffix}`), `Refusing to overwrite prior delivery: ${output}${suffix}`);
}

function run(receipt, executable, args, cwd, env, expectedExit = 0) {
    const started = new Date().toISOString();
    const result = spawnSync(executable, args, { cwd, env, encoding: 'utf8', timeout: 180000,
        maxBuffer: 64 * 1024 * 1024 });
    const command = { executable, args, cwd, environment: env, started, finished: new Date().toISOString(),
        exit: result.status, signal: result.signal, stdout: result.stdout || '', stderr: result.stderr || '',
        error: result.error ? String(result.error) : null, expectedExit };
    receipt.commands.push(command);
    assert.ifError(result.error);
    assert.equal(result.status, expectedExit, `${executable} ${args.join(' ')}\n${command.stdout}\n${command.stderr}`);
    return command;
}

const extractPython = `import pathlib, stat, sys, zipfile
archive, destination = sys.argv[1:]
root = pathlib.Path(destination)
assert root.is_dir() and not list(root.iterdir()), 'Extraction directory must be empty'
with zipfile.ZipFile(archive) as z:
    seen = set()
    for info in z.infolist():
        name = info.filename
        parts = name.split('/')
        assert name.startswith('bsv-lens/') and all(p not in ('', '.', '..') for p in parts), name
        assert '\\\\' not in name and '\\x00' not in name and name not in seen, name
        assert not stat.S_ISLNK(info.external_attr >> 16), name
        assert info.file_size <= 64*1024*1024, name
        seen.add(name)
    assert sum(i.file_size for i in z.infolist()) <= 512*1024*1024, 'Archive size limit'
    assert z.testzip() is None, 'ZIP CRC mismatch'
    z.extractall(root)
print('ZIP CRCs valid; extracted into fresh empty directory')`;

function checkAuthor(command, expected) {
    assert.equal(command.exit, 1);
    const marker = 'Missing required author inputs:\n';
    const at = command.stderr.indexOf(marker);
    assert.ok(at >= 0, 'Author checker did not report missing inputs');
    const actual = command.stderr.slice(at + marker.length).split(/\r?\n\r?\n/)[0].split(/\r?\n/);
    assert.deepEqual(actual, expected, 'Author checker must report exactly the 14 missing companions');
    assert.match(command.stderr, /FAILED \(failures=1\)/);
    assert.doesNotMatch(command.stdout + command.stderr, /\bskipped\b/i);
    return { status: 'expected-fail', exit: 1, missing: actual };
}

function replay(receipt, cwd, node, python, env) {
    const js = (...args) => run(receipt, node, ['--no-global-search-paths', ...args], cwd, env);
    const py = (...args) => run(receipt, python, ['-E', '-s', '-S', '-B', ...args], cwd, env);
    js('--version'); py('--version');
    // Exercise G2 directly, independently of the overlays.
    js('-e', `const h=require('./src/hardware'); const p=require('node:path');
(async()=>{ const registry=h.createArtifactRegistry({artifactRoots:[process.cwd()],workspaceTrusted:false});
for(const key of ['A','B','C']) { const artifactRef='docs/hardware/evidence/toolchain/'+key+'/design.json';
await registry.registerArtifact({pathRef:artifactRef,path:p.resolve(artifactRef)});
const r=await h.importArtifact({registry,artifactRef});
require('node:assert/strict').ok(r.snapshot.id && Object.keys(r.implementation.cells).length);
console.log(JSON.stringify({corpus:key,snapshotId:r.snapshot.id,cells:Object.keys(r.implementation.cells).length})); }
})().catch(e=>{console.error(e);process.exitCode=1;});`);
    for (const args of [['A', 'mkConnected.left', 'get'], ['B', 'mkControl', 'read'], ['C', 'mkReuse.wide', 'get']]) {
        const output = JSON.parse(js('experiments/hardware/g3/query.js', ...args, 'connectivity').stdout);
        assert.ok(output.result.claims.length > 0, `Empty G3-A query: ${args[0]}`);
    }
    const stock = JSON.parse(js('experiments/hardware/g3/query.js', 'A', 'mkConnected.left', 'get', 'origin').stdout);
    assert.equal(stock.result.claims.length, 0, 'Stock connectivity promoted to origin');
    for (const args of [['A', 'mkConnected/left'], ['B', 'mkControl'], ['C', 'mkReuse/wide']]) {
        const output = JSON.parse(js('experiments/hardware/g3/origin-query.js', ...args).stdout);
        if (args[0] !== 'B') assert.ok(output.result.claims.length > 0, `Empty G3-B query: ${args[0]}`);
    }
    js('--test', ...fs.readdirSync(path.join(cwd, 'test')).filter(name => /^hardware-.*\.test\.js$/.test(name)).sort().map(name => `test/${name}`));
    js('--test', 'experiments/hardware/g3/coverage.test.js');
    py('experiments/hardware/bsv-evidence/check.py');
    py('experiments/hardware/toolchain/run.py', '--verify-evidence');
    py('experiments/hardware/g3-origin/verify.py');
    py('experiments/hardware/g3-origin/retry-verify.py');
    py('experiments/hardware/g3-origin/ghc96-origin.py', '--run', originBases[2], '--verify', `${originBases[2]}/results/origin-sidecar.json`);
    const comparisonPath = path.join(path.dirname(cwd), 'noninterference.json');
    py('experiments/hardware/g3-origin/ghc96-compare.py', '--run', originBases[2], '--output', comparisonPath);
    receipt.noninterference = JSON.parse(fs.readFileSync(comparisonPath, 'utf8'));
    for (const script of ['test_verify.py', 'retry-test.py', 'ghc96-test.py']) py(`experiments/hardware/g3-origin/${script}`);
    const author = run(receipt, python, ['-E', '-s', '-S', '-B', 'experiments/hardware/bsv-evidence/check_author.py'], cwd, env, 1);
    receipt.authorPreservation = checkAuthor(author, receipt.members.authorCompanions);
    js('scripts/check.js');
    receipt.shippedOffline = 'pass';
    receipt.liveCompilerReplay = 'not-run';
}

function validateDelivery({ workspace = root, archives, build = false, python, retainExtraction = false }) {
    const discovery = { commands: [] };
    if (!python) python = run(discovery, 'python3', ['-E', '-s', '-S', '-B', '-c', 'import sys; print(sys.executable)'],
        workspace, { PATH: process.env.PATH }).stdout.trim();
    archives ||= ['review', 'source'].map(mode => path.join(workspace, 'dist', `bsv-lens-hardware-g3-${mode}.zip`));
    assert.equal(archives.length, 2, 'Provide review and Source archives in that order');
    archives = archives.map(archive => path.resolve(archive));
    assert.notEqual(archives[0], archives[1]);
    for (const archive of archives) {
        if (build) assertNewOutput(archive);
        else assert.ok(!fs.existsSync(`${archive}.validation.json`), `Refusing to overwrite validation receipt: ${archive}`);
    }
    const results = [];
    for (const [index, archive] of archives.entries()) {
        const receipt = { schema: 'g3-delivery-validation-v1', archive, mode: index ? 'source' : 'review',
            status: 'fail', commands: [], runtimeDiscovery: discovery.commands, liveCompilerReplay: 'not-run' };
        const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'bsv-g3-delivery-'));
        const destination = path.join(temporary, 'extracted');
        const home = path.join(temporary, 'home');
        const bin = path.join(temporary, 'runtimes-only');
        for (const directory of [destination, home, bin]) fs.mkdirSync(directory);
        fs.symlinkSync(process.execPath, path.join(bin, 'node'));
        fs.symlinkSync(python, path.join(bin, 'python3'));
        const env = { PATH: bin, HOME: home, TMPDIR: temporary, LANG: 'C.UTF-8',
            PYTHONDONTWRITEBYTECODE: '1', NODE_OPTIONS: '--no-global-search-paths' };
        receipt.isolation = { environment: env, node: process.execPath, python,
            nodeGlobalSearchPaths: false, nodeModules: false, freshEmptyExtraction: destination,
            compilerOnPath: false, extractionRetained: retainExtraction };
        try {
            if (build) {
                const expected = path.join(workspace, 'dist', `bsv-lens-hardware-g3-${receipt.mode}.zip`);
                assert.equal(archive, expected, 'Build mode uses the standard dist archive names');
                // Only the packager needs unzip; replay PATH contains only Node/Python.
                run(receipt, process.execPath, ['--no-global-search-paths', 'experiments/hardware/package-review.js',
                    '--g3', ...(index ? ['--source'] : [])], workspace, { ...env, PATH: '/usr/bin:/bin' });
            }
            const digest = hash(fs.readFileSync(archive));
            const checksum = fs.readFileSync(`${archive}.sha256`, 'utf8');
            assert.equal(checksum, `${digest}  ${path.basename(archive)}\n`, `Archive SHA mismatch: ${archive}`);
            receipt.sha256 = digest;
            receipt.checksum = { path: `${archive}.sha256`, verified: true };
            run(receipt, python, ['-E', '-s', '-S', '-B', '-c', extractPython, archive, destination], temporary, env);
            receipt.crc = 'pass';
            const cwd = path.join(destination, 'bsv-lens');
            receipt.members = validateEntries(collectFiles(cwd, { prefix: 'bsv-lens' }), !!index, workspace);
            receipt.runtimeWorkspaceEquality = true;
            if (index) {
                assert.deepEqual(receipt.members.runtime, results[0].members.runtime, 'Review/Source runtime mismatch');
                receipt.runtimeReviewEquality = true;
            }
            replay(receipt, cwd, process.execPath, python, env);
            receipt.status = 'pass';
            results.push(receipt);
        } catch (error) {
            receipt.error = String(error.stack || error);
            throw error;
        } finally {
            fs.mkdirSync(path.dirname(archive), { recursive: true });
            fs.writeFileSync(`${archive}.validation.json`, `${JSON.stringify(receipt, null, 2)}\n`, { flag: 'wx' });
            if (!retainExtraction) fs.rmSync(temporary, { recursive: true, force: true });
        }
    }
    return results;
}

if (require.main === module) {
    const args = process.argv.slice(2);
    const validateOnly = args.includes('--validate-only');
    const positional = args.filter(arg => !['--validate-only', '--retain-extraction'].includes(arg));
    if (positional.some(arg => arg.startsWith('--')) || (positional.length && (!validateOnly || positional.length !== 2))) {
        console.error('Usage: node experiments/hardware/g3/validate-delivery.js [--validate-only [REVIEW.zip SOURCE.zip]] [--retain-extraction]');
        process.exitCode = 1;
    } else {
        try {
            const results = validateDelivery({ build: !validateOnly, archives: positional.length ? positional : undefined,
                retainExtraction: args.includes('--retain-extraction') });
            console.log(JSON.stringify(results.map(({ archive, sha256, status }) => ({ archive, sha256, status })), null, 2));
        } catch (error) { console.error(error.stack || error); process.exitCode = 1; }
    }
}
module.exports = { validateEntries, validateDelivery, forbidden, assertNewOutput, checkAuthor };
