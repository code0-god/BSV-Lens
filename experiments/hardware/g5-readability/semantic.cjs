'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { hash } = require('../g4/validate-delivery');
const { replay } = require('../g5/delivery-replay.cjs');
const { createRun } = require('./run.cjs');

async function capture(expectedFile) {
    const directory = process.env.G5_READABILITY_OUTPUT_DIR || createRun(expectedFile ? 'semantic-after' : 'semantic-before');
    const result = await replay();
    const queries = result.queries.map(row => ({ buildId: row.buildId, kind: row.result.kind,
        request: row.request, snapshotId: row.result.context.snapshotId, queryId: row.result.queryId,
        resultId: row.result.id, semanticSha256: hash(JSON.stringify(row.result)),
        sourceSha256: hash(JSON.stringify(row.sources)) }));
    const correspondence = [];
    const commands = [];
    for (const [build, source, actual, method] of [['A', 'mkConnected.left', 'mkConnected/left', 'get'],
        ['B', 'mkControl', 'mkControl', 'read'], ['C', 'mkReuse.wide', 'mkReuse/wide', 'get']]) {
        for (const [family, args] of [
            ['stock-connectivity', ['experiments/hardware/g3/query.js', build, source, method, 'connectivity']],
            ['stock-origin', ['experiments/hardware/g3/query.js', build, source, method, 'origin']],
            ['instrumented-contributors', ['experiments/hardware/g3/origin-query.js', build, actual]]
        ]) {
            const child = spawnSync(process.execPath, ['--no-global-search-paths', ...args], { encoding: 'utf8', timeout: 60000, maxBuffer: 16 * 1024 * 1024 });
            assert.ifError(child.error); assert.equal(child.status, 0, child.stderr);
            const { attachAndQueryMs, ...semantic } = JSON.parse(child.stdout);
            correspondence.push({ build, family, semanticSha256: hash(JSON.stringify(semantic)) });
            const stem = `${build}-${family}`;
            fs.writeFileSync(path.join(directory, `${stem}.json`), `${JSON.stringify(semantic, null, 2)}\n`, { flag: 'wx' });
            commands.push({ executable: process.execPath, args, exit: child.status, stderr: child.stderr, output: `${stem}.json` });
        }
    }
    const semantic = { queries, correspondence, cancellation: result.cancellation };
    if (expectedFile) assert.deepEqual(semantic, JSON.parse(fs.readFileSync(expectedFile, 'utf8')).semantic, 'Readability changed G5 semantic results');
    const report = { schema: 'g5-readability-semantic-v1', status: 'pass', semantic,
        comparedTo: expectedFile ? path.resolve(expectedFile) : null, commands,
        notes: 'Fresh public CLI/HTTP queries compare every semantic field against immutable G5 result files. Hashes summarize complete results; metrics/request generation excluded by existing G5 adapter only.' };
    fs.writeFileSync(path.join(directory, 'semantic.json'), `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
    console.log(JSON.stringify({ directory, status: report.status, queries: queries.length,
        correspondence: correspondence.length, comparedTo: report.comparedTo }));
    return report;
}

if (require.main === module) capture(process.argv[2]).catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { capture };
