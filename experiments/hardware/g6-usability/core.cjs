'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { isDeepStrictEqual } = require('node:util');
const { snapshotCore, collectEntries } = require('./package-review.cjs');
const { createOutput } = require('./baseline.cjs');
const { inventory } = require('../g6/historical-companions.cjs');
const { copyTestDependencies, counts, changedInputs } = require('../g6/core.cjs');
const ROOT = path.resolve(__dirname, '../../..');
function run({ author = ROOT, output = process.env.G6_USABILITY_OUTPUT_DIR || createOutput('core') } = {}) {
    const snapshot = snapshotCore({ workspace: author, output }), workspace = snapshot.workspace;
    const dependencies = copyTestDependencies(author, workspace), generated = path.join(output, 'generated'); fs.mkdirSync(generated);
    const tests = fs.readdirSync(path.join(workspace, 'test')).filter(name => name.endsWith('.test.js')).sort().map(name => `test/${name}`);
    const extra = 'experiments/hardware/g6-usability/package.test.cjs';
    const args = ['--no-global-search-paths', '--test', '--test-reporter=tap', ...tests, extra];
    const environment = { ...process.env, G4_REVIEW_ROOT: workspace, G5_OUTPUT_DIR: generated, G5_READABILITY_OUTPUT_DIR: generated,
        G6_OUTPUT_DIR: generated, G6_USABILITY_OUTPUT_DIR: generated, GIT_CEILING_DIRECTORIES: output };
    delete environment.NODE_PATH; delete environment.G5_READABILITY_BROWSER_NEGATIVE;
    const startedAt = new Date().toISOString();
    const child = spawnSync(process.execPath, args, { cwd: workspace, env: environment, encoding: 'utf8', timeout: 300000, maxBuffer: 64 * 1024 * 1024 });
    for (const name of ['stdout', 'stderr']) fs.writeFileSync(path.join(output, `${name}.log`), child[name] || '', { flag: 'wx' });
    const changed = changedInputs(workspace, snapshot.inventory), dependencyChanges = changedInputs(workspace, dependencies.files);
    const current = inventory(collectEntries({ workspace: author, companion: snapshot.companion, historicalCompanion: snapshot.historicalCompanion }));
    const authorChanged = !isDeepStrictEqual(current, snapshot.inventory);
    const receipt = { schema: 'g6-usability-core-v1', status: child.status === 0 && !child.error && !changed.length && !dependencyChanges.length && !authorChanged ? 'pass' : 'fail',
        executable: process.execPath, args, cwd: workspace, startedAt, finishedAt: new Date().toISOString(), exit: child.status, signal: child.signal,
        error: child.error?.message, counts: counts(child.stdout || ''), changedInputs: changed, dependencyChanges, authorContentChangedDuringExecution: authorChanged,
        featureIdentity: snapshot.featureIdentity, inputFiles: snapshot.inventory.length, testFiles: tests.length, extraTests: [extra], dependencies,
        environment: { node: process.version, platform: process.platform, arch: process.arch, G4_REVIEW_ROOT: workspace, G5_OUTPUT_DIR: generated,
            G5_READABILITY_OUTPUT_DIR: generated, G6_OUTPUT_DIR: generated, G6_USABILITY_OUTPUT_DIR: generated, NODE_OPTIONS: environment.NODE_OPTIONS || null, NODE_PATH: null },
        stdout: 'stdout.log', stderr: 'stderr.log',
        scope: 'All current test/*.test.js plus follow-up packaging negatives from an exact copied source/current-evidence snapshot. Installed native/browser execution remains a separate lane.' };
    fs.writeFileSync(path.join(output, 'core.json'), JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx' });
    console.log(JSON.stringify({ output, status: receipt.status, counts: receipt.counts, testFiles: tests.length, changedInputs: changed, authorChanged, featureIdentity: snapshot.featureIdentity }));
    assert.equal(receipt.status, 'pass', 'Core failure or frozen-input drift; see core.json/stdout.log/stderr.log'); return receipt;
}
if (require.main === module) { try { run(); } catch (error) { console.error(error); process.exitCode = 1; } }
module.exports = { run };
