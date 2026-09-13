'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { collectFiles } = require('../../../scripts/zip');
const inherited = require('../g5/package-review.cjs');
const readability = require('../g5-readability/package.cjs');
const oldReadability = require('../g5-readability/validate-delivery.cjs');
const oldG6 = require('../g6/historical-companions.cjs');
const previous = require('../g6/validate-delivery.cjs');
const legacy = require('../g5/validate-review.cjs');
const base = require('../g4/validate-delivery');
const { saveCandidate } = require('../g4/package');
const { createOutput } = require('./baseline.cjs');
const delivery = require('./validate-delivery.cjs');
const ROOT = path.resolve(__dirname, '../../..');
const archiveNames = (workspace = ROOT) => ['review', 'source'].map(mode => path.join(workspace, 'dist', `bsv-lens-hardware-g6-usability-${mode}.zip`));
function companionManifest(workspace = ROOT) {
    const inventory = oldG6.inventory(collectFiles(path.join(workspace, previous.evidenceRoot), { prefix: previous.evidenceRoot.slice(0, -1) }));
    assert.ok(inventory.length, 'Original G6 evidence missing');
    return { schema: 'g6-usability-historical-v1', omittedRoot: previous.evidenceRoot, inventory, inventorySha256: base.hash(JSON.stringify(inventory)),
        archives: require('../g6/package-review.cjs').archiveNames(workspace).map(file => ({ path: path.relative(workspace, file).split(path.sep).join('/'), bytes: fs.statSync(file).size, sha256: readability.hashFile(file) })),
        coreReplayRequiresHistoricalArchive: false, authorCompanionCount: 14,
        scope: 'Previous G6 native/source/compiler execution records only; original files and archives remain immutable. Current usability before/after traces, inputs and final installed proof remain inline.',
        separateContracts: { readability: oldG6.companionPath, optionalHistorical70: oldReadability.companionPath, author: 'The independent 14 required author inputs remain absent and explicitly fail author preservation.' } };
}
function collectEntries({ workspace = ROOT, evidenceDirectories = [], companion, historicalCompanion } = {}) {
    const omitted = [previous.evidenceRoot, delivery.evidenceRoot, oldG6.omittedRoot, oldReadability.omittedRoot];
    const entries = inherited.collectEntries({ workspace }).filter(row => !omitted.some(prefix => row.name.startsWith(`bsv-lens/${prefix}`)) && row.name !== `bsv-lens/${delivery.companionPath}`);
    const local = path.join(workspace, delivery.evidenceRoot);
    if (fs.existsSync(local)) entries.push(...collectFiles(local, { prefix: `bsv-lens/${delivery.evidenceRoot.slice(0, -1)}` }));
    for (const directory of evidenceDirectories) { assert.match(path.basename(directory), /^run-[A-Za-z0-9_-]+$/);
        entries.push(...collectFiles(directory, { prefix: `bsv-lens/${delivery.evidenceRoot}${path.basename(directory)}` })); }
    const manifest = companion || (fs.existsSync(path.join(workspace, delivery.companionPath)) ? JSON.parse(fs.readFileSync(path.join(workspace, delivery.companionPath))) : null);
    if (manifest) entries.push({ name: `bsv-lens/${delivery.companionPath}`, data: Buffer.from(JSON.stringify(manifest, null, 2) + '\n') });
    if (historicalCompanion) {
        const name = `bsv-lens/${oldG6.companionPath}`, at = entries.findIndex(row => row.name === name);
        if (at >= 0) entries.splice(at, 1);
        entries.push({ name, data: Buffer.from(JSON.stringify(historicalCompanion, null, 2) + '\n') });
    }
    return entries.map(row => ({ name: row.name, data: row.data, mode: 0o100644, date: new Date('2026-09-12T00:00:00Z') })).sort((a, b) => a.name.localeCompare(b.name));
}
function verifyHistorical(manifest, workspace, directory) {
    const file = path.join(directory, 'historical-g6.json'); fs.writeFileSync(file, JSON.stringify(manifest, null, 2), { flag: 'wx' });
    const receipt = { schema: 'g6-usability-historical-preservation-v1', commands: [] };
    legacy.command(receipt, 'python3', ['-E', '-s', '-S', '-B', '-c', 'import hashlib,json,pathlib,sys,zipfile\nw=pathlib.Path(sys.argv[1]);m=json.loads(pathlib.Path(sys.argv[2]).read_text())\nfor a in m["archives"]:\n p=w/a["path"];assert p.stat().st_size==a["bytes"]\n with p.open("rb") as f: assert hashlib.file_digest(f,"sha256").hexdigest()==a["sha256"]\n with zipfile.ZipFile(p) as z:\n  for r in m["inventory"]:\n   b=z.read("bsv-lens/"+r["path"]);assert len(b)==r["bytes"] and hashlib.sha256(b).hexdigest()==r["sha256"],r["path"]\nprint("Both preserved G6 archives contain the exact historical inventory")', workspace, file], workspace, { PATH: process.env.PATH });
    receipt.status = 'pass'; fs.writeFileSync(path.join(directory, 'historical-g6-validation.json'), JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx' }); return receipt;
}
function snapshotCore({ workspace = ROOT, output = createOutput('core-snapshot') } = {}) {
    const fromFile = (name, generate) => fs.existsSync(path.join(workspace, name)) ? JSON.parse(fs.readFileSync(path.join(workspace, name))) : generate();
    const companion = fromFile(delivery.companionPath, () => companionManifest(workspace));
    const historicalCompanion = fromFile(oldG6.companionPath, () => oldG6.companionManifest(workspace));
    const entries = collectEntries({ workspace, companion, historicalCompanion }); readability.checkLimits(entries);
    const destination = path.join(output, 'workspace'); fs.mkdirSync(destination);
    for (const row of entries) { const file = path.join(destination, row.name.slice(9)); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, row.data, { flag: 'wx' }); }
    const runtime = require('../g4-fix/package.cjs').runtime(entries).sort((a, b) => a.path.localeCompare(b.path));
    return { output, workspace: destination, inventory: oldG6.inventory(entries), runtime, featureIdentity: base.hash(JSON.stringify(runtime)), companion, historicalCompanion };
}
async function build({ workspace = ROOT, evidenceDirectories = [], publish = false, allowIncompleteNative = false, report, vsix, nativeReplay } = {}) {
    assert.ok(!publish || (!allowIncompleteNative && typeof nativeReplay === 'function'), 'Final delivery requires current complete native evidence and fresh installed replay');
    const outputs = archiveNames(workspace); if (publish) { assert.match(report || '', /^docs\/hardware\/g6-usability\/[A-Za-z0-9_-]+\.md$/); outputs.forEach(base.assertNewOutput); assert.ok(vsix); }
    const directory = createOutput('package'), companion = companionManifest(workspace);
    verifyHistorical(companion, workspace, directory);
    const inheritedCompanion = oldG6.companionManifest(workspace), prior = JSON.parse(fs.readFileSync(path.join(workspace, oldReadability.companionPath)));
    const historyDirectory = path.join(directory, 'earlier-companions'); fs.mkdirSync(historyDirectory);
    oldG6.verifyCompanion(inheritedCompanion, workspace, historyDirectory); readability.verifyCompanion(prior, workspace, historyDirectory);
    const review = collectEntries({ workspace, evidenceDirectories, companion, historicalCompanion: inheritedCompanion }), source = review.filter(row => !row.name.startsWith('bsv-lens/.build/'));
    const members = [review, source].map((rows, i) => { readability.checkLimits(rows); return delivery.validateEntries(rows, !!i, workspace, { allowIncompleteNative }); });
    assert.deepEqual(members[0].runtime, members[1].runtime);
    const identity = vsix ? require('../g6/package-vsix.cjs').verifyVsix(path.resolve(vsix), { expectedBuild: require('../../../src/panel/hardware-build').inspectHardwareBuild(workspace) }) : null;
    if (identity) for (const build of members[0].evidence.current.builds) { assert.equal(build.sha256, identity.sha256); assert.deepEqual(build.build, identity.nativeBuild); }
    if (publish) for (const rows of [review, source]) assert.deepEqual(rows.find(row => row.name === `bsv-lens/${report}`)?.data, fs.readFileSync(path.join(workspace, report)));
    const archives = ['review', 'source'].map(mode => path.join(directory, `${mode}.zip`)); saveCandidate(archives[0], review); saveCandidate(archives[1], source);
    const receipts = await delivery.validateDelivery({ workspace, archives, directory, allowIncompleteNative, nativeReplay });
    for (const row of [...companion.archives, ...inheritedCompanion.archives, ...prior.archives]) assert.equal(readability.hashFile(path.join(workspace, row.path)), row.sha256, 'Historical archive changed');
    const published = [];
    if (publish) {
        outputs.forEach(base.assertNewOutput); assert.equal(readability.hashFile(path.resolve(vsix)), identity.sha256, 'Final VSIX changed');
        for (const [i, output] of outputs.entries()) { assert.equal(receipts[i].status, 'pass'); assert.equal(receipts[i].nativeReplay.status, 'PASS');
            assert.equal(readability.hashFile(archives[i]), receipts[i].sha256); fs.linkSync(archives[i], output);
            fs.writeFileSync(`${output}.sha256`, `${receipts[i].sha256}  ${path.basename(output)}\n`, { flag: 'wx' });
            legacy.writeReceipt(output, { ...receipts[i], archive: output, validatedCandidate: archives[i], report, reportSha256: base.hash(fs.readFileSync(path.join(workspace, report))),
                deliveredVsix: { sha256: identity.sha256, bytes: identity.bytes, buildId: identity.nativeBuild.buildId } }); published.push(output); }
    }
    const summary = { schema: 'g6-usability-package-v1', directory, status: members[0].evidence.current.complete ? 'pass' : 'candidate-native-incomplete', finalArchivesCreated: publish,
        published, expandedBytes: review.reduce((sum, row) => sum + row.data.length, 0), members: review.length, featureIdentity: receipts[0].featureIdentity,
        archives: receipts.map(row => ({ archive: row.archive, status: row.status, sha256: row.sha256 })) };
    fs.writeFileSync(path.join(directory, 'summary.json'), JSON.stringify(summary, null, 2) + '\n', { flag: 'wx' }); return summary;
}
if (require.main === module) {
    const args = process.argv.slice(2), mode = args.shift(), options = { publish: mode === '--build', evidenceDirectories: [] };
    assert.ok(['--stage', '--build'].includes(mode), 'Usage: package-review.cjs --stage|--build [--allow-incomplete-native] [--evidence DIR] [--vsix FILE] [--report FILE]; final build also requires an explicit nativeReplay callback through build()');
    while (args.length) { const option = args.shift(); if (option === '--allow-incomplete-native') options.allowIncompleteNative = true;
        else if (option === '--evidence') options.evidenceDirectories.push(path.resolve(args.shift())); else if (option === '--vsix') options.vsix = path.resolve(args.shift());
        else if (option === '--report') options.report = args.shift(); else throw new Error(`Unknown option: ${option}`); }
    build(options).then(value => console.log(JSON.stringify(value))).catch(error => { console.error(error); process.exitCode = 1; });
}
module.exports = { archiveNames, collectEntries, companionManifest, verifyHistorical, snapshotCore, build, checkLimits: readability.checkLimits };
