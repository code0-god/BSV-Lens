'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { collectFiles } = require('../../../scripts/zip');
const previous = require('../g5-readability/package.cjs');
const oldDelivery = require('../g5-readability/validate-delivery.cjs');
const { hash } = require('../g4/validate-delivery');
const { command } = require('../g5/validate-review.cjs');
const omittedRoot = 'docs/hardware/evidence/g5-readability/';
const companionPath = 'docs/hardware/g6/G6_HISTORICAL_COMPANIONS.json';
const inventory = entries => entries.map(row => ({ path: row.name, bytes: row.data.length, sha256: hash(row.data) }))
    .sort((a, b) => a.path.localeCompare(b.path));
function companionManifest(workspace) {
    const files = inventory(collectFiles(path.join(workspace, omittedRoot), { prefix: omittedRoot.slice(0, -1) }));
    assert.ok(files.length, 'Historical readability evidence missing from author workspace');
    return { schema: 'g6-historical-companions-v1', omittedRoot, inventory: files, inventorySha256: hash(JSON.stringify(files)),
        archives: previous.archiveNames(workspace).map(file => ({ path: path.relative(workspace, file).split(path.sep).join('/'),
            bytes: fs.statSync(file).size, sha256: previous.hashFile(file) })),
        scope: 'Historical G5 readability QA only. Original files remain unchanged; G6 native evidence is inline.',
        coreReplay: 'No historical archive required.',
        separateContracts: { historicalG5Supplement: oldDelivery.companionPath, authorCompanions: '14 separately required author inputs; missing remains an expected failure.' } };
}
function validateCompanion(entries) {
    const prior = oldDelivery.validateCompanion(entries);
    assert.ok(!entries.some(row => row.name.startsWith(`bsv-lens/${omittedRoot}`)), 'Historical readability evidence duplicated');
    const file = entries.find(row => row.name === `bsv-lens/${companionPath}`); assert.ok(file, 'G6 historical companion contract missing');
    const manifest = JSON.parse(file.data);
    assert.equal(manifest.schema, 'g6-historical-companions-v1'); assert.equal(manifest.omittedRoot, omittedRoot);
    assert.ok(Array.isArray(manifest.inventory) && manifest.inventory.length, 'Empty historical readability inventory');
    assert.deepEqual(manifest.inventory.map(row => row.path), [...new Set(manifest.inventory.map(row => row.path))].sort((a, b) => a.localeCompare(b)));
    for (const row of manifest.inventory) {
        assert.ok(row.path.startsWith(omittedRoot) && !row.path.includes('..') && !/[\\:\0]/.test(row.path));
        assert.ok(Number.isSafeInteger(row.bytes) && row.bytes >= 0); assert.match(row.sha256, /^[a-f0-9]{64}$/);
    }
    assert.equal(manifest.inventorySha256, hash(JSON.stringify(manifest.inventory)));
    assert.deepEqual(manifest.archives.map(row => row.path), ['review', 'source'].map(mode => `dist/bsv-lens-hardware-g5-readability-${mode}.zip`));
    for (const row of manifest.archives) { assert.ok(Number.isSafeInteger(row.bytes) && row.bytes > 0); assert.match(row.sha256, /^[a-f0-9]{64}$/); }
    assert.equal(manifest.separateContracts.historicalG5Supplement, oldDelivery.companionPath);
    return { path: companionPath, sha256: hash(file.data), inventorySha256: manifest.inventorySha256, archives: manifest.archives, prior };
}
function verifyCompanion(manifest, workspace, directory) {
    const file = path.join(directory, 'historical-companion.json'); fs.writeFileSync(file, JSON.stringify(manifest, null, 2), { flag: 'wx' });
    const receipt = { schema: 'g6-historical-preservation-v1', commands: [] };
    const script = `import hashlib,json,pathlib,sys,zipfile
w=pathlib.Path(sys.argv[1]); m=json.loads(pathlib.Path(sys.argv[2]).read_text())
for a in m['archives']:
 p=w/a['path']; assert p.stat().st_size==a['bytes']
 h=hashlib.file_digest(p.open('rb'),'sha256').hexdigest(); assert h==a['sha256']
 with zipfile.ZipFile(p) as z:
  for r in m['inventory']:
   b=z.read('bsv-lens/'+r['path']); assert len(b)==r['bytes'] and hashlib.sha256(b).hexdigest()==r['sha256'],r['path']
print('Historical readability inventory exists byte-for-byte in both preserved archives')`;
    command(receipt, 'python3', ['-E', '-s', '-S', '-B', '-c', script, workspace, file], workspace, { PATH: process.env.PATH });
    receipt.status = 'pass'; fs.writeFileSync(path.join(directory, 'historical-preservation.json'), JSON.stringify(receipt, null, 2), { flag: 'wx' });
    return receipt;
}
module.exports = { omittedRoot, companionPath, inventory, companionManifest, validateCompanion, verifyCompanion };
