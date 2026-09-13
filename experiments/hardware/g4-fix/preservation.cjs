'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { collectFiles } = require('../../../scripts/zip');
const { createRunOutput } = require('../g4/run-output');
const root = path.resolve(__dirname, '../../..');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');

function entry(name) {
    assert.ok(!path.isAbsolute(name) && !name.split('/').includes('..'), 'Foreign preservation path');
    const file = path.join(root, name), stat = fs.lstatSync(file);
    const bytes = stat.isSymbolicLink() ? Buffer.from(fs.readlinkSync(file)) : fs.readFileSync(file);
    return { path: name, kind: stat.isSymbolicLink() ? 'symlink' : 'file', bytes: bytes.length, sha256: hash(bytes) };
}

(async () => {
    const [mode, baselinePath, ...allowedChanges] = process.argv.slice(2);
    assert.ok(mode === 'capture' || mode === 'verify', 'Usage: preservation.cjs capture | verify BASELINE [allowed paths...]');
    const output = await createRunOutput(root, `g4-fix-preservation-${mode}`);
    if (mode === 'capture') {
        const previous = JSON.parse(fs.readFileSync(path.join(root, 'docs/hardware/evidence/g4/g4-0/baseline.json'), 'utf8'));
        const submitted = JSON.parse(fs.readFileSync(path.join(root, 'docs/hardware/evidence/g4/final/index.json'), 'utf8'));
        const names = new Set([...previous.entries.map(item => item.path), ...submitted.runtimeIdentity.files.map(item => item.path)]);
        for (const prefix of ['docs/hardware/evidence', 'docs/hardware/g4', 'experiments/hardware/fixtures']) {
            for (const item of collectFiles(path.join(root, prefix))) names.add(`${prefix}/${item.name}`);
        }
        for (const item of fs.readdirSync(path.join(root, 'dist'), { withFileTypes: true })) {
            if (item.isFile() && item.name !== '.DS_Store') names.add(`dist/${item.name}`);
        }
        const entries = [...names].sort().map(entry);
        const identity = { branch: execFileSync('git', ['branch', '--show-current'], { cwd: root, encoding: 'utf8' }).trim(),
            head: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
            originMain: execFileSync('git', ['rev-parse', 'origin/main'], { cwd: root, encoding: 'utf8' }).trim(),
            packageVersion: JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version,
            lockfileVersion: JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8')).version };
        const baseline = { schema: 'g4-fix-preservation-v1', capturedAt: new Date().toISOString(), identity,
            sourceBaseline: 'e3ed0eb1eb60bd058287472a545ad1c27aeb6e1c98dbfdf1f993fba665820a07',
            fingerprint: hash(JSON.stringify(entries)), entries };
        const file = path.join(output, 'baseline.json');
        fs.writeFileSync(file, `${JSON.stringify(baseline, null, 2)}\n`, { flag: 'wx' });
        console.log(JSON.stringify({ baseline: file, files: entries.length, fingerprint: baseline.fingerprint }));
    } else {
        assert.ok(baselinePath);
        const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
        assert.equal(baseline.schema, 'g4-fix-preservation-v1');
        const changed = [];
        for (const before of baseline.entries) {
            const after = entry(before.path);
            if (JSON.stringify(before) !== JSON.stringify(after)) changed.push({ before, after });
        }
        const unauthorized = changed.filter(item => !allowedChanges.includes(item.before.path));
        const receipt = { schema: 'g4-fix-preservation-check-v1', baseline: path.resolve(baselinePath),
            checkedFiles: baseline.entries.length, unchangedFiles: baseline.entries.length - changed.length,
            allowedChanges, changed, unauthorized, status: unauthorized.length ? 'fail' : 'pass' };
        fs.writeFileSync(path.join(output, 'receipt.json'), `${JSON.stringify(receipt, null, 2)}\n`, { flag: 'wx' });
        console.log(JSON.stringify({ ...receipt, changed: changed.map(item => item.before.path), receipt: path.join(output, 'receipt.json') }));
        assert.deepEqual(unauthorized, [], 'Historical evidence or unauthorized source changed');
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
