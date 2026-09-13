'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('node:child_process');
const { hash } = require('../../../src/hardware/json');
const { inspectHardwareBuild } = require('../../../src/panel/hardware-build');
const { writeZip } = require('../../../scripts/zip');
const { collectProductFiles, verifyVsix, readVsix } = require('../g6/package-vsix.cjs');
const ROOT = path.resolve(__dirname, '../../..');
const TESTS = ['parser-typeclass-scopes', 'graph-typeclass-scope', 'hardware-generated-bundle',
    'hardware-range-index', 'hardware-bsv-large-overview', 'hardware-native-session', 'hardware-usability-ui']
    .map(name => `test/${name}.test.js`);
const LIMITS = { member: 64 * 1024 * 1024, aggregate: 768 * 1024 * 1024 };
const write = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
function inventory(files) {
    return [...files].map(([file, data]) => ({ path: file, bytes: data.length, sha256: hash(data) }))
        .sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
}
function inputFile(file) {
    assert.ok(!path.isAbsolute(file) && !file.split('/').some(part => !part || part === '.' || part === '..'));
    const absolute = path.join(ROOT, file);
    assert.equal(fs.realpathSync(absolute), absolute, 'Archive input must not traverse a symlink');
    assert.ok(fs.lstatSync(absolute).isFile());
    assert.ok(fs.statSync(absolute).size <= LIMITS.member);
    return fs.readFileSync(absolute);
}
function build(vsix, evidenceIndex, output) {
    assert.equal(path.basename(output), 'g6'); fs.mkdirSync(output, { recursive: true });
    const source = collectProductFiles(ROOT), packaged = JSON.parse(fs.readFileSync(vsix + '.validation.json'));
    assert.deepEqual(inspectHardwareBuild(ROOT), packaged.nativeBuild);
    const verified = verifyVsix(vsix, { expectedBuild: packaged.nativeBuild });
    const id = packaged.nativeBuild.runtimeFingerprint;
    const base = new Map(source.files.map(row => [row.path, inputFile(row.path)]));
    for (const file of [...TESTS, 'package-lock.json', 'experiments/hardware/g4-fix/oracle/geometry.cjs',
        'scripts/zip.js', 'scripts/build-metadata.js', 'experiments/hardware/g6/run.cjs',
        'experiments/hardware/g6/package-vsix.cjs', 'experiments/hardware/g6-typeclass/delivery.cjs',
        'docs/hardware/g6-usability/TYPECLASS_SCOPE_FIX.md']) base.set(file, inputFile(file));
    const toolsSeen = new Set();
    function addTool(file) {
        if (toolsSeen.has(file)) return;
        toolsSeen.add(file);
        const data = inputFile(file); base.set(file, data);
        if (file.endsWith('.json')) return;
        for (const match of data.toString().matchAll(/require\(['"](\.{1,2}\/[^'"]+)['"]\)/g)) {
            const target = path.posix.normalize(path.posix.join(path.posix.dirname(file), match[1]));
            const dependency = [target, target + '.js', target + '.cjs', target + '.json', target + '/index.js']
                .find(candidate => fs.existsSync(path.join(ROOT, candidate)) && fs.statSync(path.join(ROOT, candidate)).isFile());
            if (dependency) addTool(dependency);
        }
    }
    for (const file of ['native.cjs', 'native-limit.cjs', 'workspace.cjs'])
        addTool('experiments/hardware/g6-typeclass/' + file);
    const installedFiles = readVsix(vsix);
    for (const file of ['media/hardware-build.json', 'media/build-metadata.js'])
        base.set(file, installedFiles.get('extension/' + file));
    const contract = { schema: 'g6-typeclass-scoped-replay-v1', runtime: source,
        vsix: { name: path.basename(vsix), sha256: verified.sha256 }, tests: TESTS,
        scope: 'Self-contained repair regression replay. Full historical G6 archives, author-companion contracts and compiler evidence remain separate and unchanged. This archive does not replace their full shipped/core replay contract.',
        command: 'node --test ' + TESTS.join(' '),
        outputPolicy: 'Tests create new run directories under .build/hardware/runs; archived input files must stay unchanged.',
        compilerExecuted: false, userVisualDesignAcceptance: 'PENDING', limits: LIMITS };
    base.set('TYPECLASS_FIX_REPLAY.json', Buffer.from(JSON.stringify(contract, null, 2) + '\n'));
    const evidence = JSON.parse(fs.readFileSync(evidenceIndex)), review = new Map(base);
    assert.equal(evidence.schema, 'g6-typeclass-evidence-v1');
    for (const row of evidence.files) {
        assert.ok(row.path.startsWith('.build/hardware/runs/') || row.path.startsWith('docs/hardware/g6-usability/'));
        const data = inputFile(row.path); assert.equal(data.length, row.bytes); assert.equal(hash(data), row.sha256);
        review.set(row.path, data);
    }
    review.set('TYPECLASS_FIX_EVIDENCE.json', Buffer.from(JSON.stringify(evidence, null, 2) + '\n'));
    const results = [];
    for (const [kind, files] of [['source', base], ['review', review]]) {
        const original = inventory(files), total = original.reduce((sum, row) => sum + row.bytes, 0);
        assert.ok(total <= LIMITS.aggregate); assert.ok(original.every(row => row.bytes <= LIMITS.member));
        const name = `bsv-lens-hardware-g6-typeclass-${id.slice(0, 16)}-${kind}.zip`, zip = path.join(output, name);
        assert.equal(fs.existsSync(zip), false);
        writeZip(zip, [...files].map(([name, data]) => ({ name, data })));
        const entries = readVsix(zip);
        assert.equal(entries.size, files.size);
        for (const [file, data] of files) assert.equal(hash(entries.get(file)), hash(data));
        const extracted = path.join(output, `fresh-${kind}`); fs.mkdirSync(extracted);
        execFileSync('/usr/bin/unzip', ['-q', zip, '-d', extracted]);
        assert.equal(collectProductFiles(extracted).fingerprint, source.fingerprint);
        fs.mkdirSync(path.join(extracted, '.build/hardware/runs'), { recursive: true });
        const run = spawnSync(process.execPath, ['--test', ...TESTS], { cwd: extracted, encoding: 'utf8' });
        fs.writeFileSync(path.join(output, `${kind}.stdout`), run.stdout, { flag: 'wx' });
        fs.writeFileSync(path.join(output, `${kind}.stderr`), run.stderr, { flag: 'wx' });
        assert.equal(run.status, 0, `${kind} replay failed; see logs`);
        for (const row of original) assert.equal(hash(fs.readFileSync(path.join(extracted, row.path))), row.sha256);
        const receipt = { status: 'PASS', kind, zip, sha256: hash(fs.readFileSync(zip)), crc: 'PASS',
            entries: original.length, expandedBytes: total, originalInventory: original,
            runtimeFingerprint: source.fingerprint, installedVsixSha256: verified.sha256,
            freshExtraction: extracted, replay: { args: ['--test', ...TESTS], exit: run.status,
                summary: run.stdout.split('\n').filter(line => /^[ℹ#] (tests|pass|fail|skipped|cancelled)/.test(line)) },
            archivedInputsUnchanged: true, historicalArchivesReplaced: false, limits: LIMITS };
        write(zip + '.validation.json', receipt);
        fs.writeFileSync(zip + '.sha256', receipt.sha256 + '  ' + name + '\n', { flag: 'wx' });
        results.push(receipt);
    }
    assert.equal(collectProductFiles(ROOT).fingerprint, source.fingerprint);
    write(path.join(output, 'delivery.json'), { status: 'PASS', results });
    return results;
}
if (require.main === module) {
    const [vsix, evidence, output] = process.argv.slice(2);
    assert.ok(vsix && evidence && output, 'Usage: delivery.cjs VSIX EVIDENCE_INDEX FRESH_RUN/g6');
    console.log(JSON.stringify(build(path.resolve(vsix), path.resolve(evidence), path.resolve(output))
        .map(({ zip, sha256, entries, replay }) => ({ zip, sha256, entries, replay }))));
}
module.exports = { build };
