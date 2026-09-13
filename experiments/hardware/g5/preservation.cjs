'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { createRun } = require('./run.cjs');
const root = path.resolve(__dirname, '../../..');
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const git = (...args) => execFileSync('git', ['--no-pager', ...args], { cwd: root, encoding: 'utf8' });

async function fileEntry(relative) {
    assert.ok(relative && !path.isAbsolute(relative) && !relative.split('/').includes('..'));
    const file = path.join(root, relative), before = fs.lstatSync(file);
    if (before.isSymbolicLink()) {
        const link = fs.readlinkSync(file);
        return { path: relative, kind: 'symlink', bytes: Buffer.byteLength(link), sha256: digest(link) };
    }
    assert.ok(before.isFile(), `Not a regular baseline file: ${relative}`);
    const hash = crypto.createHash('sha256');
    for await (const bytes of fs.createReadStream(file)) hash.update(bytes);
    const after = fs.lstatSync(file);
    assert.equal(before.size, after.size, `Baseline file changed: ${relative}`);
    assert.equal(before.mtimeMs, after.mtimeMs, `Baseline file changed: ${relative}`);
    return { path: relative, kind: 'file', bytes: before.size, sha256: hash.digest('hex') };
}

function walk(directory, names, excluded) {
    for (const item of fs.readdirSync(path.join(root, directory), { withFileTypes: true })) {
        const relative = `${directory}/${item.name}`;
        if (excluded && (relative === excluded || relative.startsWith(`${excluded}/`))) continue;
        if (item.isDirectory()) walk(relative, names, excluded);
        else if (item.isFile() || item.isSymbolicLink()) names.add(relative);
    }
}

async function capture() {
    const output = await createRun('baseline');
    const prior = JSON.parse(fs.readFileSync(path.join(root, 'dist/bsv-lens-hardware-g4-fix-source.zip.validation.json'), 'utf8'));
    assert.equal(prior.status, 'pass');
    for (const item of prior.commonRuntime) {
        const actual = await fileEntry(item.path.slice('bsv-lens/'.length));
        assert.equal(actual.sha256, item.sha256, `G4 submitted runtime differs: ${actual.path}`);
        assert.equal(actual.bytes, item.bytes);
    }
    const names = new Set(git('ls-files', '-z', '--cached', '--others', '--exclude-standard').split('\0')
        .filter(name => name && !name.startsWith('experiments/hardware/g5/')));
    const previous = JSON.parse(fs.readFileSync(path.join(root,
        '.build/hardware/runs/g4-fix-preservation-capture-647jUL/baseline.json'), 'utf8'));
    for (const item of previous.entries) names.add(item.path);
    walk('.build/hardware/runs', names, path.relative(root, path.dirname(output)).replace(/\\/g, '/'));
    const entries = [];
    for (const name of [...names].sort()) entries.push(await fileEntry(name));
    const baseline = {
        schema: 'g5-preservation-v1', capturedAt: new Date().toISOString(), directory: output,
        scope: 'All pre-existing tracked/nonignored files, previous protected inputs, and prior hardware run files; excludes this G5 run and its new author tools.',
        identity: {
            branch: git('branch', '--show-current').trim(), head: git('rev-parse', 'HEAD').trim(),
            originMain: git('rev-parse', 'origin/main').trim(), status: git('status', '--short'),
            staged: git('diff', '--cached'), unstaged: git('diff'),
            untracked: git('ls-files', '--others', '--exclude-standard').trim().split('\n'),
            packageVersion: JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version,
            lockfileVersion: JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8')).version
        },
        g4FeatureIdentity: prior.featureIdentity, g4Runtime: prior.commonRuntime,
        fingerprint: digest(JSON.stringify(entries)), entries
    };
    assert.equal(baseline.identity.branch, 'feat/hardware-schematic');
    assert.equal(baseline.identity.packageVersion, '0.4.1');
    assert.equal(baseline.identity.lockfileVersion, '0.4.1');
    fs.writeFileSync(path.join(output, 'baseline.json'), `${JSON.stringify(baseline, null, 2)}\n`, { flag: 'wx' });
    console.log(`G5_BASELINE ${JSON.stringify({ file: path.join(output, 'baseline.json'), files: entries.length,
        fingerprint: baseline.fingerprint, g4FeatureIdentity: baseline.g4FeatureIdentity })}`);
}

async function verify(baselinePath, allowed) {
    const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
    assert.equal(baseline.schema, 'g5-preservation-v1');
    assert.equal(digest(JSON.stringify(baseline.entries)), baseline.fingerprint);
    for (const relative of allowed) assert.ok(!/^(?:dist\/|\.build\/|docs\/hardware\/evidence\/|experiments\/hardware\/fixtures\/)/.test(relative),
        `Historical input cannot be allowed to change: ${relative}`);
    const changes = [];
    for (const before of baseline.entries) {
        const after = await fileEntry(before.path);
        if (JSON.stringify(before) !== JSON.stringify(after)) changes.push({ before, after });
    }
    const unauthorized = changes.filter(item => !allowed.includes(item.before.path));
    const directory = await createRun('preservation');
    const receipt = { schema: 'g5-preservation-check-v1', baseline: path.resolve(baselinePath),
        checked: baseline.entries.length, unchanged: baseline.entries.length - changes.length,
        changes, unauthorized, status: unauthorized.length ? 'fail' : 'pass' };
    fs.writeFileSync(path.join(directory, 'receipt.json'), `${JSON.stringify(receipt, null, 2)}\n`, { flag: 'wx' });
    console.log(`G5_PRESERVATION ${JSON.stringify({ directory, checked: receipt.checked,
        unchanged: receipt.unchanged, changes: changes.map(item => item.before.path), status: receipt.status })}`);
    assert.deepEqual(unauthorized, [], 'Pre-G5 evidence or unauthorized source changed');
}

if (require.main === module) {
    const [mode, baseline, ...allowed] = process.argv.slice(2);
    assert.ok(mode === 'capture' && !baseline || mode === 'verify' && baseline,
        'Usage: preservation.cjs capture | verify BASELINE [ALLOWED_PRODUCT_FILES...]');
    (mode === 'capture' ? capture() : verify(baseline, allowed)).catch(error => {
        console.error(error); process.exitCode = 1;
    });
}
module.exports = { fileEntry };
