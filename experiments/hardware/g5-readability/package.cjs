'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { collectFiles } = require('../../../scripts/zip');
const inherited = require('../g5/package-review.cjs');
const { saveCandidate } = require('../g4/package');
const base = require('../g4/validate-delivery');
const legacy = require('../g5/validate-review.cjs');
const delivery = require('./validate-delivery.cjs');
const { createRun } = require('./run.cjs');
const root = path.resolve(__dirname, '../../..');
const archiveNames = (workspace = root) => ['review', 'source'].map(mode => path.join(workspace, 'dist', `bsv-lens-hardware-g5-readability-${mode}.zip`));

function hashFile(file) {
    const hash = crypto.createHash('sha256'), descriptor = fs.openSync(file, 'r'), buffer = Buffer.allocUnsafe(1024 * 1024);
    try { let count; while ((count = fs.readSync(descriptor, buffer, 0, buffer.length, null))) hash.update(buffer.subarray(0, count)); }
    finally { fs.closeSync(descriptor); }
    return hash.digest('hex');
}

function companionManifest(workspace = root) {
    const inventory = delivery.inventory(collectFiles(path.join(workspace, delivery.omittedRoot), { prefix: delivery.omittedRoot.slice(0, -1) }));
    assert.ok(inventory.length, 'Historical QA supplement must exist before companion packaging');
    const archives = inherited.archiveNames(workspace).map(file => ({ path: path.relative(workspace, file).split(path.sep).join('/'),
        bytes: fs.statSync(file).size, sha256: hashFile(file) }));
    return { schema: 'g5-readability-companion-v1', omittedRoot: delivery.omittedRoot,
        purpose: 'Historical G5 resume QA supplement only; preserved source/compiler/query evidence remains inline.',
        archives, inventory, inventorySha256: base.hash(JSON.stringify(inventory)),
        replayRequirement: 'Optional historical QA companion. Core/readability replay requires no historical archive. Author-input preservation still fails without its separate 14 inputs.',
        preservation: 'Original supplement and both original G5 ZIPs remain unchanged on disk. Recover omitted files from bsv-lens/ paths in either named archive.' };
}

function collectEntries({ workspace = root, evidenceDirectories = [], companion } = {}) {
    const entries = inherited.collectEntries({ workspace }).filter(entry =>
        !entry.name.startsWith(`bsv-lens/${delivery.evidenceRoot}`) && !entry.name.startsWith(`bsv-lens/${delivery.omittedRoot}`)
        && entry.name !== `bsv-lens/${delivery.companionPath}`);
    const local = path.join(workspace, delivery.evidenceRoot);
    if (fs.existsSync(local)) entries.push(...collectFiles(local, { prefix: `bsv-lens/${delivery.evidenceRoot.slice(0, -1)}` }));
    for (const directory of evidenceDirectories) {
        assert.match(path.basename(directory), /^run-[A-Za-z0-9_-]+$/, 'Evidence directory must be named run-ID');
        entries.push(...collectFiles(directory, { prefix: `bsv-lens/${delivery.evidenceRoot}${path.basename(directory)}` }));
    }
    if (companion) entries.push({ name: `bsv-lens/${delivery.companionPath}`, data: Buffer.from(`${JSON.stringify(companion, null, 2)}\n`) });
    return entries.map(entry => ({ name: entry.name, data: entry.data, mode: 0o100644, date: new Date('2026-09-09T00:00:00Z') }))
        .sort((a, b) => a.name.localeCompare(b.name));
}

function checkLimits(entries) {
    for (const entry of entries) assert.ok(entry.data.length <= 64 * 1024 * 1024, `ARCHIVE_MEMBER_SIZE: ${entry.name}`);
    assert.ok(entries.reduce((total, entry) => total + entry.data.length, 0) <= 768 * 1024 * 1024, 'ARCHIVE_TOTAL_SIZE');
}

function verifyCompanion(manifest, workspace, directory) {
    const file = path.join(directory, 'companion.json');
    fs.writeFileSync(file, `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' });
    const receipt = { commands: [] };
    const script = `import hashlib,json,pathlib,sys,zipfile
workspace=pathlib.Path(sys.argv[1]); manifest=json.loads(pathlib.Path(sys.argv[2]).read_text())
for archive in manifest['archives']:
 with zipfile.ZipFile(workspace/archive['path']) as z:
  for row in manifest['inventory']:
   data=z.read('bsv-lens/'+row['path'])
   assert len(data)==row['bytes'] and hashlib.sha256(data).hexdigest()==row['sha256'],row['path']
print('Both preserved G5 archives contain every omitted historical QA byte')`;
    legacy.command(receipt, 'python3', ['-E', '-s', '-S', '-B', '-c', script, workspace, file], workspace, { PATH: process.env.PATH });
    fs.writeFileSync(path.join(directory, 'companion-validation.json'), `${JSON.stringify(receipt, null, 2)}\n`, { flag: 'wx' });
}

async function build({ workspace = root, evidenceDirectories = [], publish = false, allowIncompleteBrowser = false,
    report, playwrightEntry, browserScript } = {}) {
    assert.ok(!publish || !allowIncompleteBrowser, 'Final build cannot allow incomplete readability evidence');
    const outputs = archiveNames(workspace);
    if (publish) {
        assert.match(report || '', /^docs\/hardware\/g5-readability\/[A-Za-z0-9_-]+\.md$/, 'Final build requires readability report');
        outputs.forEach(base.assertNewOutput);
    }
    const directory = createRun('package'), companion = companionManifest(workspace);
    verifyCompanion(companion, workspace, directory);
    const review = collectEntries({ workspace, evidenceDirectories, companion }), source = review.filter(entry => !entry.name.startsWith('bsv-lens/.build/'));
    for (const entries of [review, source]) checkLimits(entries);
    const members = [review, source].map((entries, i) => delivery.validateEntries(entries, !!i, workspace, { allowIncompleteBrowser }));
    assert.deepEqual(members[0].runtime, members[1].runtime);
    if (publish) for (const entries of [review, source]) {
        const entry = entries.find(row => row.name === `bsv-lens/${report}`); assert.ok(entry?.data.length, 'Missing readability report');
        assert.deepEqual(entry.data, fs.readFileSync(path.join(workspace, report)));
    }
    const archives = ['review', 'source'].map(mode => path.join(directory, `${mode}.zip`));
    saveCandidate(archives[0], review); saveCandidate(archives[1], source);
    const receipts = await delivery.validateDelivery({ workspace, archives, directory, allowIncompleteBrowser, playwrightEntry, browserScript });
    for (const archive of companion.archives) assert.equal(hashFile(path.join(workspace, archive.path)), archive.sha256, 'Historical G5 archive changed');
    const published = [];
    if (publish) {
        outputs.forEach(base.assertNewOutput); fs.mkdirSync(path.dirname(outputs[0]), { recursive: true });
        for (const [i, output] of outputs.entries()) {
            const receipt = receipts[i]; assert.equal(receipt.status, 'pass'); assert.equal(hashFile(archives[i]), receipt.sha256);
            fs.linkSync(archives[i], output);
            fs.writeFileSync(`${output}.sha256`, `${receipt.sha256}  ${path.basename(output)}\n`, { flag: 'wx' });
            legacy.writeReceipt(output, { ...receipt, archive: output, validatedCandidate: archives[i], report,
                reportSha256: base.hash(fs.readFileSync(path.join(workspace, report))) }); published.push(output);
        }
    }
    const summary = { schema: 'g5-readability-package-v1', directory, status: receipts[0].status, finalArchivesCreated: publish,
        featureIdentity: receipts[0].featureIdentity, companion, published,
        archives: receipts.map(receipt => ({ archive: receipt.archive, status: receipt.status, sha256: receipt.sha256 })) };
    fs.writeFileSync(path.join(directory, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`, { flag: 'wx' });
    return summary;
}

if (require.main === module) {
    const args = process.argv.slice(2), mode = args.shift(), options = { publish: mode === '--build', evidenceDirectories: [] };
    assert.ok(['--stage', '--build'].includes(mode), 'Usage: package.cjs --stage|--build [--report PATH] [--evidence RUN_DIRECTORY] [--playwright-entry ABSOLUTE_MODULE]');
    while (args.length) {
        const option = args.shift();
        if (option === '--allow-incomplete-browser') options.allowIncompleteBrowser = true;
        else if (option === '--evidence') options.evidenceDirectories.push(path.resolve(args.shift()));
        else if (option === '--report') options.report = args.shift();
        else if (option === '--playwright-entry') options.playwrightEntry = args.shift();
        else if (option === '--browser-script') options.browserScript = args.shift();
        else throw new Error(`Unknown option: ${option}`);
    }
    build(options).then(value => console.log(JSON.stringify(value, null, 2))).catch(error => { console.error(error); process.exitCode = 1; });
}
module.exports = { archiveNames, hashFile, companionManifest, collectEntries, checkLimits, verifyCompanion, build };
