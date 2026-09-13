'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const os = require('node:os');
const { execFileSync, spawnSync } = require('node:child_process');
const { collectFiles, writeZip } = require('../../scripts/zip');

for (const mode of ['bsv', 'offline', 'g2', 'g3', 'g3-source']) {
const offline = mode !== 'bsv', g3 = mode.startsWith('g3'), g2 = mode === 'g2' || g3;
const sourceOnly = mode === 'g3-source';
test(`packaging retains prior evidence and selects the ${mode} artifact`, () => {
    const source = fs.readFileSync(path.join(__dirname, 'package-review.js'), 'utf8');
    const outputs = [];
    let exclude;
    const files = [
        'docs/hardware/G1_REPORT.md', 'docs/hardware/G1_BSV_REPORT.md',
        'docs/hardware/G1_BSV_CONTRACT.md', 'docs/hardware/evidence/bsv/verification.json',
        '.build/hardware/g0/results.json', '.build/hardware/importer/README.md',
        '.build/hardware/prototype/receipt.json', '.build/hardware/prototype/intermediate-receipt.json',
        ...['a', 'b', 'c'].map(name => `.build/hardware/prototype/intermediate-50-${name}.svg`),
        '.build/hardware/lead-final-wire.png', '.build/hardware/lead-final-bsv.png',
        '.build/hardware/bsv-model/API.md', '.build/hardware/bsv-ui/receipt.json',
        '.build/hardware/bsv-ui/rtl-regression/receipt.json'
    ];
    const scope = { preservedManifest: { path: 'docs/hardware/evidence/bsv/preserved-inputs.json' },
        authorCompanions: ['.build/hardware/toolchain/A/bdir/Connected.bo'],
        files: [{ path: 'docs/hardware/evidence/bsv/A/supplemental.json' }] };
    if (offline) files.push('docs/hardware/OFFLINE_REPRODUCIBILITY.md',
        'docs/hardware/evidence/bsv/offline-inputs.json', scope.preservedManifest.path,
        'experiments/hardware/bsv-evidence/check.py', 'experiments/hardware/bsv-evidence/check_author.py',
        scope.files[0].path, 'experiments/hardware/fixtures/Connected.bsv');
    if (g2) files.push('docs/hardware/G2_CONTRACT.md', 'docs/hardware/G2_REPORT.md',
        '.build/hardware/g2-product/API.md',
        ...['index', 'registry', 'snapshot', 'import-worker', 'json', 'yosys-json'].map(name => `src/hardware/${name}.js`),
        ...['import', 'snapshot', 'independent'].map(name => `test/hardware-${name}.test.js`));
    if (g3) files.push(...['G3_CONTRACT.md', 'G3_A_CHECKPOINT.md', 'G3_ARCHITECTURE.md',
        'G3_CORRESPONDENCE_SCHEMA.md', 'G3_ORIGIN_EXPERIMENT.md', 'G3_COVERAGE.json', 'G3_COVERAGE.md', 'G3_REPORT.md']
        .map(name => `docs/hardware/${name}`), 'experiments/hardware/g3/query.js',
        '.build/hardware/g3-a/CHECKPOINT.json',
        ...['index', 'source', 'stock', 'build', 'schema', 'worker']
            .map(name => `src/hardware/correspondence/${name}.js`),
        'test/hardware-correspondence.test.js', 'test/hardware-correspondence-independent.test.js');
    const delivery = g3 ? require('./g3/validate-delivery') : null;
    const captured = new Map();
    if (g3) {
        // G3 validates complete runtime/capture bytes; only ZIP output stays controlled.
        for (const entry of collectFiles(path.resolve(__dirname, '../..'), { exclude: relative =>
            relative.startsWith('.build') || delivery.forbidden(relative) })) {
            captured.set(entry.name, entry.data);
            if (!files.includes(entry.name)) files.push(entry.name);
        }
    }
    const modules = {
        './g3/validate-delivery': delivery && { ...delivery,
            assertNewOutput: output => assert.match(path.basename(output), /^bsv-lens-hardware-g3-(review|source)\.zip$/) },
        'node:fs': {
            statSync: () => ({ isFile: () => true }),
            readFileSync: file => file.endsWith('offline-inputs.json') ? JSON.stringify(scope)
                : file.endsWith('preserved-inputs.json') ? JSON.stringify({ files: [
                    { path: scope.authorCompanions[0] }, { path: 'experiments/hardware/fixtures/Connected.bsv' }
                ] }) : Buffer.from('controlled archive bytes'),
            writeFileSync: file => outputs.push(file)
        },
        'node:child_process': { execFileSync: (file, args) => {
            assert.equal(file, 'unzip');
            assert.equal(args[0], '-t');
        } },
        '../../scripts/zip': {
            collectFiles: (_root, options) => {
                exclude = options.exclude;
                return files.filter(name => !sourceOnly || !name.startsWith('.build/'))
                    .map(name => ({ name: `bsv-lens/${name}`, data: captured.get(name) || '' }));
            },
            writeZip: file => {
                outputs.push(file);
                return { entries: files.length, bytes: 24 };
            }
        }
    };
    vm.runInNewContext(source, {
        __dirname, Buffer, console: { log() {} },
        process: { argv: ['node', 'package-review.js', ...(sourceOnly ? ['--g3', '--source'] : [`--${mode}`])] },
        require: name => modules[name] || require(name)
    });
    assert.equal(path.basename(outputs[0]), g3 ? `bsv-lens-hardware-g3-${sourceOnly ? 'source' : 'review'}.zip`
        : g2 ? 'bsv-lens-hardware-g2-review.zip'
        : offline ? 'bsv-lens-hardware-g1-bsv-offline-review.zip' : 'bsv-lens-hardware-g1-bsv-review.zip');
    for (const directory of ['prototype', 'bsv-model', 'bsv-ui', 'bsv-evidence', 'bsv-ui/rtl-regression',
        ...(g2 ? ['g2-product'] : []), ...(g3 ? ['g3-a'] : [])]) {
        assert.equal(exclude(`.build/hardware/${directory}`, { isDirectory: () => true }), sourceOnly);
    }
    assert.equal(outputs.some(file => path.basename(file) === 'bsv-lens-hardware-g1-review.zip'), false);
    if (g2) assert.equal(outputs.some(file => path.basename(file) === 'bsv-lens-hardware-g1-bsv-offline-review.zip'), false);
    if (g3) {
        assert.equal(outputs.some(file => path.basename(file) === 'bsv-lens-hardware-g2-review.zip'), false);
        assert.equal(exclude('.build/hardware/g3-origin/run/tools/compiler', { isDirectory: () => true }), true);
        assert.equal(exclude('docs/hardware/evidence/g3-origin/sidecar.json', { isFile: () => true }), false);
        assert.equal(exclude('docs/hardware/evidence/g3-origin/receipts/baseline-build.log', { isFile: () => true }), false);
        assert.equal(exclude('docs/hardware/evidence/g3-origin-retry/receipts/build.log', { isFile: () => true }), false);
        assert.equal(exclude('docs/hardware/evidence/g3-origin-ghc96/receipts/build.log', { isFile: () => true }), false);
        assert.equal(exclude('unrelated.log', { isFile: () => true }), true);
    }
    if (offline) {
        assert.equal(outputs.some(file => path.basename(file) === 'bsv-lens-hardware-g1-bsv-review.zip'), false);
        files.splice(files.indexOf(scope.files[0].path), 1);
        assert.throws(() => vm.runInNewContext(source, {
            __dirname, Buffer, console: { log() {} },
            process: { argv: ['node', 'package-review.js', ...(sourceOnly ? ['--g3', '--source'] : [`--${mode}`])] },
            require: name => modules[name] || require(name)
        }), /docs\/hardware\/evidence\/bsv\/A\/supplemental\.json/);
    }
});
}

test('extracted shipped checker is independent and both modes fail closed', async t => {
    const root = path.resolve(__dirname, '../..');
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'bsv-offline-check-'));
    t.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
    const archive = path.join(temporary, 'review.zip');
    writeZip(archive, collectFiles(root, { prefix: 'bsv-lens', exclude: relative =>
        relative.split('/').some(segment => ['.git', '.omo', '.build', 'dist', 'node_modules', '.vscode-test', '__pycache__'].includes(segment)) }));
    const cases = [
        { name: 'shipped', script: 'check.py', exit: 0 },
        { name: 'missing-bsv', script: 'check.py', exit: 1, remove: 'docs/hardware/evidence/bsv/bsc-version.json' },
        { name: 'tampered-bsv', script: 'check.py', exit: 1, tamper: 'docs/hardware/evidence/bsv/A/supplemental.json' },
        { name: 'missing-original', script: 'check.py', exit: 1, remove: 'docs/hardware/evidence/toolchain/A/design.json' },
        { name: 'tampered-original', script: 'check.py', exit: 1, tamper: 'docs/hardware/evidence/toolchain/A/design.json' },
        { name: 'author-without-companions', script: 'check_author.py', exit: 1 }
    ];
    for (const scenario of cases) await t.test(scenario.name, () => {
        const destination = path.join(temporary, scenario.name);
        execFileSync('unzip', ['-q', archive, '-d', destination]);
        const cwd = path.join(destination, 'bsv-lens');
        for (const absent of ['node_modules', '.build/hardware/toolchain', 'dist']) assert.equal(fs.existsSync(path.join(cwd, absent)), false);
        if (scenario.remove) fs.unlinkSync(path.join(cwd, scenario.remove));
        if (scenario.tamper) fs.appendFileSync(path.join(cwd, scenario.tamper), '\n');
        const result = spawnSync('python3', ['-E', '-s', '-B', `experiments/hardware/bsv-evidence/${scenario.script}`], {
            cwd, encoding: 'utf8', timeout: 30000,
            env: { PATH: process.env.PATH, PYTHONDONTWRITEBYTECODE: '1', NODE_PATH: '', NODE_OPTIONS: '' }
        });
        assert.ifError(result.error);
        assert.equal(result.status, scenario.exit, result.stdout + result.stderr);
        if (scenario.remove || scenario.tamper) assert.ok(result.stderr.includes(scenario.remove || scenario.tamper), result.stderr);
        if (scenario.name === 'author-without-companions') {
            const scope = JSON.parse(fs.readFileSync(path.join(cwd, 'docs/hardware/evidence/bsv/offline-inputs.json'), 'utf8'));
            for (const companion of scope.authorCompanions) assert.ok(result.stderr.includes(companion), result.stderr);
        }
    });
});
