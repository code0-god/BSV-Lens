'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { collectFiles } = require('../../../scripts/zip');
const inherited = require('../g5-readability/package.cjs');
const oldDelivery = require('../g5-readability/validate-delivery.cjs');
const legacy = require('../g5/validate-review.cjs');
const base = require('../g4/validate-delivery');
const { saveCandidate } = require('../g4/package');
const historical = require('./historical-companions.cjs');
const delivery = require('./validate-delivery.cjs');
const { createRun } = require('./run.cjs');
const root = path.resolve(__dirname, '../../..');
const archiveNames = (workspace = root) => ['review', 'source'].map(mode => path.join(workspace, 'dist', `bsv-lens-hardware-g6-${mode}.zip`));
function collectEntries({ workspace = root, evidenceDirectories = [], companion, priorCompanion } = {}) {
    const entries = inherited.collectEntries({ workspace, companion: priorCompanion }).filter(row =>
        !row.name.startsWith(`bsv-lens/${historical.omittedRoot}`) && !row.name.startsWith(`bsv-lens/${delivery.evidenceRoot}`)
        && row.name !== `bsv-lens/${historical.companionPath}`);
    const local = path.join(workspace, delivery.evidenceRoot);
    if (fs.existsSync(local)) entries.push(...collectFiles(local, { prefix: `bsv-lens/${delivery.evidenceRoot.slice(0, -1)}` }));
    for (const directory of evidenceDirectories) {
        assert.match(path.basename(directory), /^run-[A-Za-z0-9_-]+$/);
        entries.push(...collectFiles(directory, { prefix: `bsv-lens/${delivery.evidenceRoot}${path.basename(directory)}` }));
    }
    if (companion) entries.push({ name: `bsv-lens/${historical.companionPath}`, data: Buffer.from(JSON.stringify(companion, null, 2) + '\n') });
    return entries.map(row => ({ name: row.name, data: row.data, mode: 0o100644, date: new Date('2026-09-09T00:00:00Z') }))
        .sort((a, b) => a.name.localeCompare(b.name));
}
function snapshotCore({ workspace = root, output = createRun('core-snapshot') } = {}) {
    const entries = collectEntries({ workspace, companion: historical.companionManifest(workspace), priorCompanion: inherited.companionManifest(workspace) });
    inherited.checkLimits(entries); const destination = path.join(output, 'workspace'); fs.mkdirSync(destination);
    for (const row of entries) { const file = path.join(destination, row.name.slice(9)); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, row.data, { flag: 'wx' }); }
    return { output, workspace: destination, inventory: historical.inventory(entries),
        featureIdentity: base.hash(JSON.stringify(require('../g4-fix/package.cjs').runtime(entries).sort((a, b) => a.path.localeCompare(b.path)))) };
}
async function build({ workspace = root, evidenceDirectories = [], publish = false, allowIncompleteNative = false, report, vsix, nativeReplay } = {}) {
    assert.ok(!publish || !allowIncompleteNative, 'Final archive requires complete native evidence');
    const outputs = archiveNames(workspace);
    if (publish) { assert.match(report || '', /^docs\/hardware\/g6\/[A-Za-z0-9_-]+\.md$/); outputs.forEach(base.assertNewOutput); assert.ok(vsix, 'Explicit final VSIX required'); }
    const directory = createRun('review-package'), companion = historical.companionManifest(workspace), prior = inherited.companionManifest(workspace);
    historical.verifyCompanion(companion, workspace, directory); inherited.verifyCompanion(prior, workspace, directory);
    const review = collectEntries({ workspace, evidenceDirectories, companion, priorCompanion: prior }), source = review.filter(row => !row.name.startsWith('bsv-lens/.build/'));
    const members = [review, source].map((entries, i) => { inherited.checkLimits(entries); return delivery.validateEntries(entries, !!i, workspace, { allowIncompleteNative }); });
    assert.deepEqual(members[0].runtime, members[1].runtime);
    let vsixIdentity = null;
    if (vsix) {
        const { inspectHardwareBuild } = require('../../../src/panel/hardware-build');
        vsixIdentity = require('./package-vsix.cjs').verifyVsix(path.resolve(vsix), { expectedBuild: inspectHardwareBuild(workspace) });
        for (const build of members[0].evidence.native.builds) { assert.equal(build.sha256, vsixIdentity.sha256); assert.deepEqual(build.build, vsixIdentity.nativeBuild); }
    }
    if (publish) for (const entries of [review, source]) assert.deepEqual(entries.find(row => row.name === `bsv-lens/${report}`)?.data, fs.readFileSync(path.join(workspace, report)));
    const archives = ['review', 'source'].map(mode => path.join(directory, `${mode}.zip`)); saveCandidate(archives[0], review); saveCandidate(archives[1], source);
    const receipts = await delivery.validateDelivery({ workspace, archives, directory, allowIncompleteNative, nativeReplay });
    const published = [];
    for (const row of [...companion.archives, ...prior.archives]) assert.equal(inherited.hashFile(path.join(workspace, row.path)), row.sha256, 'Historical archive changed');
    if (publish) {
        outputs.forEach(base.assertNewOutput);
        assert.equal(inherited.hashFile(path.resolve(vsix)), vsixIdentity.sha256, 'Final VSIX bytes changed');
        for (const [i, output] of outputs.entries()) {
            assert.equal(receipts[i].status, 'pass'); assert.equal(inherited.hashFile(archives[i]), receipts[i].sha256);
            fs.linkSync(archives[i], output); fs.writeFileSync(`${output}.sha256`, `${receipts[i].sha256}  ${path.basename(output)}\n`, { flag: 'wx' });
            legacy.writeReceipt(output, { ...receipts[i], archive: output, validatedCandidate: archives[i], report,
                reportSha256: base.hash(fs.readFileSync(path.join(workspace, report))), deliveredVsix: { sha256: vsixIdentity.sha256, bytes: vsixIdentity.bytes, buildId: vsixIdentity.nativeBuild.buildId } });
            published.push(output);
        }
    }
    const summary = { schema: 'g6-review-package-v1', directory, status: members[0].evidence.native.complete ? 'pass' : 'candidate-native-incomplete',
        finalArchivesCreated: publish, published, expandedBytes: review.reduce((sum, row) => sum + row.data.length, 0), members: review.length,
        featureIdentity: receipts[0].featureIdentity, archives: receipts.map(row => ({ archive: row.archive, sha256: row.sha256, status: row.status })) };
    fs.writeFileSync(path.join(directory, 'summary.json'), JSON.stringify(summary, null, 2) + '\n', { flag: 'wx' }); return summary;
}
if (require.main === module) {
    const args = process.argv.slice(2), mode = args.shift(), options = { publish: mode === '--build', evidenceDirectories: [] };
    assert.ok(['--stage', '--build'].includes(mode), 'Usage: package-review.cjs --stage|--build [--allow-incomplete-native] [--evidence DIR] [--report PATH] [--vsix FILE]');
    while (args.length) { const option = args.shift();
        if (option === '--allow-incomplete-native') options.allowIncompleteNative = true;
        else if (option === '--evidence') options.evidenceDirectories.push(path.resolve(args.shift()));
        else if (option === '--report') options.report = args.shift();
        else if (option === '--vsix') options.vsix = args.shift();
        else throw new Error(`Unknown option: ${option}`);
    }
    build(options).then(value => console.log(JSON.stringify(value, null, 2))).catch(error => { console.error(error); process.exitCode = 1; });
}
module.exports = { archiveNames, collectEntries, snapshotCore, build, checkLimits: inherited.checkLimits, companionManifest: historical.companionManifest };
