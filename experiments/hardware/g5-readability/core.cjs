'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { createRun } = require('./run.cjs');
const { collectEntries, companionManifest } = require('./package.cjs');
const { hash } = require('../g4/validate-delivery');
const { runtime } = require('../g4-fix/package.cjs');

function run() {
    const output = process.env.G5_READABILITY_OUTPUT_DIR || createRun('core');
    const workspace = path.join(output, 'workspace'), generated = path.join(output, 'generated'), suite = path.join(output, 'suite');
    fs.mkdirSync(workspace); fs.mkdirSync(generated); fs.mkdirSync(suite);
    const entries = collectEntries({ companion: companionManifest() });
    for (const entry of entries) {
        const target = path.join(workspace, entry.name.slice('bsv-lens/'.length));
        fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, entry.data, { flag: 'wx' });
    }
    const tests = fs.readdirSync(path.join(workspace, 'test')).filter(name => name.endsWith('.test.js')).sort().map(name => `test/${name}`);
    const args = ['--no-global-search-paths', '--test', '--test-reporter=tap', ...tests];
    const environment = { ...process.env, G4_REVIEW_ROOT: workspace, G5_OUTPUT_DIR: generated,
        G5_READABILITY_OUTPUT_DIR: generated, GIT_CEILING_DIRECTORIES: output };
    delete environment.G5_READABILITY_BROWSER_NEGATIVE;
    const startedAt = new Date().toISOString();
    const child = spawnSync(process.execPath, args, { cwd: workspace, env: environment, encoding: 'utf8', timeout: 240000, maxBuffer: 64 * 1024 * 1024 });
    fs.writeFileSync(path.join(suite, 'stdout.log'), child.stdout || '', { flag: 'wx' });
    fs.writeFileSync(path.join(suite, 'stderr.log'), child.stderr || '', { flag: 'wx' });
    const changed = entries.filter(entry => {
        const target = path.join(workspace, entry.name.slice('bsv-lens/'.length));
        return !fs.existsSync(target) || hash(fs.readFileSync(target)) !== hash(entry.data);
    }).map(entry => entry.name);
    const counts = Object.fromEntries(['tests', 'pass', 'fail', 'skipped', 'cancelled'].map(key =>
        [key, Number((child.stdout || '').match(new RegExp(`# ${key} (\\d+)`))?.[1] ?? -1)]));
    const sourceRuntime = runtime(entries).sort((a, b) => a.path.localeCompare(b.path));
    const receipt = { schema: 'g5-readability-core-v1', status: child.status === 0 && !child.error && !changed.length ? 'pass' : 'fail',
        executable: process.execPath, args, cwd: workspace, startedAt, finishedAt: new Date().toISOString(),
        exit: child.status, signal: child.signal, error: child.error?.message, counts, changedInputs: changed,
        runtime: sourceRuntime, featureIdentity: hash(JSON.stringify(sourceRuntime)), inputFiles: entries.length,
        environment: { node: process.version, G4_REVIEW_ROOT: workspace, G5_OUTPUT_DIR: generated, G5_READABILITY_OUTPUT_DIR: generated,
            NODE_OPTIONS: environment.NODE_OPTIONS || null, PATH: environment.PATH, GIT_CEILING_DIRECTORIES: output },
        stdout: 'suite/stdout.log', stderr: 'suite/stderr.log',
        scope: 'Exact current source/evidence copy. Legacy tests may create run outputs only inside this unique readability workspace. Browser-negative lane is separate.' };
    fs.writeFileSync(path.join(output, 'core.json'), `${JSON.stringify(receipt, null, 2)}\n`, { flag: 'wx' });
    console.log(JSON.stringify({ output, status: receipt.status, counts, changedInputs: changed, featureIdentity: receipt.featureIdentity }));
    assert.ifError(child.error); assert.equal(child.status, 0, child.stderr || 'See core.stdout.log');
    assert.deepEqual(changed, [], 'Core tests modified original copied inputs');
    return receipt;
}
if (require.main === module) { try { run(); } catch (error) { console.error(error); process.exitCode = 1; } }
module.exports = { run };
