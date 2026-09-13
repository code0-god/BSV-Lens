'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { collectFiles } = require('../../../scripts/zip');
const inherited = require('../g4/package');
const base = require('../g4/validate-delivery');
const { createRun } = require('./run.cjs');
const delivery = require('./validate-review.cjs');
const root = path.resolve(__dirname, '../../..');
const archiveNames = (workspace = root) => ['review', 'source'].map(mode => path.join(workspace, 'dist', `bsv-lens-hardware-g5-${mode}.zip`));

function collectEntries({ workspace = root, evidenceDirectories = [] } = {}) {
    // Retain the inherited collector's frozen inputs and historical review payload.
    // G5 evidence is collected separately so only the precise indexed trace path
    // may cross its existing no-archive rule; G4 excludes this G5-owned payload.
    const entries = inherited.collectEntries({ workspace }).filter(entry => !entry.name.startsWith(`bsv-lens/${delivery.evidenceRoot}`)
        && !entry.name.split('/').some(part => ['.omx', '.codegraph'].includes(part)));
    const local = path.join(workspace, delivery.evidenceRoot);
    if (fs.existsSync(local)) entries.push(...collectFiles(local, { prefix: `bsv-lens/${delivery.evidenceRoot.slice(0, -1)}` }));
    for (const directory of evidenceDirectories) {
        assert.match(path.basename(directory), /^run-[A-Za-z0-9_-]+$/, 'Evidence directory must be named run-ID');
        entries.push(...collectFiles(directory, { prefix: `bsv-lens/${delivery.evidenceRoot}${path.basename(directory)}` }));
    }
    // Constant metadata makes identical inputs byte-reproducible independent of
    // author permissions, mtimes, timezone and SOURCE_DATE_EPOCH.
    return entries.map(entry => ({ name: entry.name, data: entry.data, mode: 0o100644, date: new Date('2026-09-08T00:00:00Z') }))
        .sort((a, b) => a.name.localeCompare(b.name));
}
async function build({ workspace = root, evidenceDirectories = [], publish = false, allowIncompleteBrowser = false, report } = {}) {
    assert.ok(!publish || !allowIncompleteBrowser, 'Final build cannot allow incomplete browser evidence');
    const directory = await createRun('package-review');
    const outputs = archiveNames(workspace);
    if (publish) {
        assert.ok(report && /^docs\/hardware\/g5\/[A-Za-z0-9_-]+\.md$/.test(report), 'Final build requires --report docs/hardware/g5/REPORT.md');
        for (const output of outputs) base.assertNewOutput(output);
    }
    const review = collectEntries({ workspace, evidenceDirectories });
    const source = review.filter(entry => !entry.name.startsWith('bsv-lens/.build/'));
    const options = { allowIncompleteBrowser };
    const members = [review, source].map((entries, index) => delivery.validateEntries(entries, !!index, workspace, options));
    assert.deepEqual(members[0].runtime, members[1].runtime);
    if (publish) for (const entries of [review, source]) {
        const member = entries.find(entry => entry.name === `bsv-lens/${report}`); assert.ok(member?.data.length, 'Missing final G5 report');
        assert.deepEqual(member.data, fs.readFileSync(path.join(workspace, report)));
    }
    const archives = ['review', 'source'].map(mode => path.join(directory, `${mode}.zip`));
    inherited.saveCandidate(archives[0], review); inherited.saveCandidate(archives[1], source);
    const receipts = await delivery.validateDelivery({ workspace, archives, directory, allowIncompleteBrowser });
    const published = [];
    if (publish) {
        for (const output of outputs) base.assertNewOutput(output);
        fs.mkdirSync(path.dirname(outputs[0]), { recursive: true });
        for (const [index, output] of outputs.entries()) {
            const receipt = receipts[index], candidate = archives[index]; assert.equal(receipt.status, 'pass');
            assert.equal(base.hash(fs.readFileSync(candidate)), receipt.sha256, 'Validated candidate bytes changed');
            fs.linkSync(candidate, output);
            fs.writeFileSync(`${output}.sha256`, `${receipt.sha256}  ${path.basename(output)}\n`, { flag: 'wx' });
            delivery.writeReceipt(output, { ...receipt, archive: output, validatedCandidate: candidate, report,
                reportSha256: base.hash(fs.readFileSync(path.join(workspace, report))) });
            published.push(output);
        }
    }
    const summary = { schema: 'g5-package-review-v1', directory, status: receipts[0].status,
        finalArchivesCreated: publish, featureIdentity: receipts[0].featureIdentity,
        archives: receipts.map(receipt => ({ archive: receipt.archive, status: receipt.status, sha256: receipt.sha256 })), published };
    fs.writeFileSync(path.join(directory, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`, { flag: 'wx' });
    return summary;
}
if (require.main === module) {
    const args = process.argv.slice(2), mode = args.shift(), options = { evidenceDirectories: [], publish: mode === '--build' };
    try {
        assert.ok(['--stage', '--build'].includes(mode), 'Usage: package-review.cjs --stage|--build [--evidence ABSOLUTE_RUN_DIRECTORY] [--report docs/hardware/g5/REPORT.md] [--allow-incomplete-browser]');
        while (args.length) {
            const option = args.shift();
            if (option === '--allow-incomplete-browser') options.allowIncompleteBrowser = true;
            else if (option === '--evidence') { assert.ok(args[0] && !args[0].startsWith('--')); options.evidenceDirectories.push(path.resolve(args.shift())); }
            else if (option === '--report') { assert.ok(args[0] && !args[0].startsWith('--')); options.report = args.shift(); }
            else throw new Error(`Unknown option: ${option}`);
        }
        build(options).then(value => console.log(JSON.stringify(value, null, 2))).catch(error => { console.error(error); process.exitCode = 1; });
    } catch (error) { console.error(error); process.exitCode = 1; }
}
module.exports = { archiveNames, collectEntries, build };
