'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { hash } = require('../g4/validate-delivery');
const { fileEntry } = require('../g5/preservation.cjs');
const { createRun } = require('./run.cjs');
const allowed = new Set(['media/hardware-view.js', 'media/hardware-navigation.js', 'media/hardware.css',
    'experiments/hardware/g4/index.html', 'experiments/hardware/g4/server.js', 'experiments/hardware/g4/package.js',
    'experiments/hardware/g5/validate-review.cjs']);

async function verify(baselineFile) {
    const baseline = JSON.parse(fs.readFileSync(baselineFile, 'utf8'));
    assert.equal(baseline.schema, 'g5-readability-baseline-v1');
    assert.equal(hash(JSON.stringify(baseline.entries)), baseline.fingerprint);
    const changes = [];
    for (const before of baseline.entries) {
        const after = await fileEntry(before.path);
        if (JSON.stringify(before) !== JSON.stringify(after)) changes.push({ before, after });
    }
    const directory = process.env.G5_READABILITY_OUTPUT_DIR || createRun('preservation');
    const unauthorized = changes.filter(change => !allowed.has(change.before.path));
    const report = { schema: 'g5-readability-preservation-v1', status: unauthorized.length ? 'fail' : 'pass',
        baseline: path.resolve(baselineFile), baselineFingerprint: baseline.fingerprint,
        checked: baseline.entries.length, unchanged: baseline.entries.length - changes.length, changes, unauthorized,
        protected: 'Every pre-existing fixture, compiler artifact, evidence, receipt and archive remains byte-identical.' };
    fs.writeFileSync(path.join(directory, 'preservation.json'), `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
    console.log(JSON.stringify({ directory, status: report.status, checked: report.checked,
        unchanged: report.unchanged, changes: changes.map(change => change.before.path) }));
    assert.deepEqual(unauthorized, [], 'Unexpected baseline changes');
    return report;
}
if (require.main === module) verify(process.argv[2]).catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { verify };
