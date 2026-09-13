'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { collectFiles, writeZip } = require('../../scripts/zip');

const root = path.resolve(__dirname, '../..');
const g3 = process.argv.includes('--g3');
const sourceOnly = process.argv.includes('--source');
const delivery = g3 ? require('./g3/validate-delivery') : null;
if (sourceOnly && !g3) throw new Error('--source requires --g3');
const g2 = process.argv.includes('--g2') || g3;
const offline = process.argv.includes('--offline') || g2;
const bsv = process.argv.includes('--bsv') || offline;
const evidenceDirectories = ['g0', 'importer', 'prototype', ...(bsv ? ['bsv-model', 'bsv-ui', 'bsv-evidence', 'bsv-ui/rtl-regression'] : []),
    ...(g2 ? ['g2-product'] : []), ...(g3 ? ['g3-a'] : [])]
    .map(name => `.build/hardware/${name}`);
const required = [
    'docs/hardware/G1_REPORT.md',
    '.build/hardware/g0/results.json',
    '.build/hardware/importer/README.md',
    '.build/hardware/prototype/receipt.json',
    '.build/hardware/prototype/intermediate-receipt.json',
    ...['a', 'b', 'c'].map(name => `.build/hardware/prototype/intermediate-50-${name}.svg`),
    '.build/hardware/lead-final-wire.png',
    '.build/hardware/lead-final-bsv.png'
];
if (bsv) required.push('docs/hardware/G1_BSV_REPORT.md', 'docs/hardware/G1_BSV_CONTRACT.md',
    'docs/hardware/evidence/bsv/verification.json', '.build/hardware/bsv-model/API.md',
    '.build/hardware/bsv-ui/receipt.json', '.build/hardware/bsv-ui/rtl-regression/receipt.json');
if (g2) required.push('docs/hardware/G2_CONTRACT.md', 'docs/hardware/G2_REPORT.md',
    '.build/hardware/g2-product/API.md',
    ...['index', 'registry', 'snapshot', 'import-worker', 'json', 'yosys-json'].map(name => `src/hardware/${name}.js`),
    ...['import', 'snapshot', 'independent'].map(name => `test/hardware-${name}.test.js`));
if (g3) required.push(...['G3_CONTRACT.md', 'G3_A_CHECKPOINT.md', 'G3_ARCHITECTURE.md',
    'G3_CORRESPONDENCE_SCHEMA.md', 'G3_ORIGIN_EXPERIMENT.md', 'G3_COVERAGE.json', 'G3_COVERAGE.md', 'G3_REPORT.md']
    .map(name => `docs/hardware/${name}`), 'experiments/hardware/g3/query.js',
    '.build/hardware/g3-a/CHECKPOINT.json',
    ...['index', 'source', 'stock', 'build', 'schema', 'worker'].map(name => `src/hardware/correspondence/${name}.js`),
    'test/hardware-correspondence.test.js', 'test/hardware-correspondence-independent.test.js');
if (offline) {
    required.push('docs/hardware/OFFLINE_REPRODUCIBILITY.md',
        'docs/hardware/evidence/bsv/offline-inputs.json',
        'experiments/hardware/bsv-evidence/check.py',
        'experiments/hardware/bsv-evidence/check_author.py');
    const scope = JSON.parse(fs.readFileSync(path.join(root, 'docs/hardware/evidence/bsv/offline-inputs.json'), 'utf8'));
    const preserved = JSON.parse(fs.readFileSync(path.join(root, scope.preservedManifest.path), 'utf8'));
    required.push(scope.preservedManifest.path, ...scope.files.map(item => item.path),
        ...preserved.files.filter(item => !scope.authorCompanions.includes(item.path)).map(item => item.path));
}
const requiredFiles = required.filter(relative => !sourceOnly || !relative.startsWith('.build/'));
for (const relative of requiredFiles) {
    if (!fs.statSync(path.join(root, relative)).isFile()) throw new Error(`Missing review evidence: ${relative}`);
}

const entries = collectFiles(root, {
    prefix: 'bsv-lens',
    exclude(relative, entry) {
        if (delivery?.forbidden(relative)) return true;
        const segments = relative.split('/');
        if (segments.some(segment => ['.git', '.omo', '.vscode-test', 'node_modules', 'dist', '__pycache__'].includes(segment))) return true;
        if (segments[0] === '.build') {
            if (sourceOnly) return true;
            if (relative === '.build' || relative === '.build/hardware' || evidenceDirectories.includes(relative)) return false;
            if (evidenceDirectories.some(directory => relative.startsWith(`${directory}/`))) {
                return entry.isDirectory() || !/\.(json|md|txt|tap|png|svg)$/.test(relative);
            }
            return !/^\.build\/hardware\/lead-final-[^/]+\.png$/.test(relative)
                && !(bsv && /^\.build\/hardware\/lead-bsv-final-[^/]+\.png$/.test(relative));
        }
        if (g3 && /^docs\/hardware\/evidence\/g3-origin(?:-retry|-ghc96)?\/.+\.log$/.test(relative)) return false;
        return entry.isFile() && /(?:\.log|\.DS_Store|\.pyc)$/.test(relative);
    }
});
const names = new Set(entries.map(entry => entry.name));
for (const relative of requiredFiles) {
    if (!names.has(`bsv-lens/${relative}`)) throw new Error(`Evidence excluded from review archive: ${relative}`);
}
const output = path.join(root, 'dist', g3 ? `bsv-lens-hardware-g3-${sourceOnly ? 'source' : 'review'}.zip`
    : g2 ? 'bsv-lens-hardware-g2-review.zip' : offline ? 'bsv-lens-hardware-g1-bsv-offline-review.zip'
    : bsv ? 'bsv-lens-hardware-g1-bsv-review.zip' : 'bsv-lens-hardware-g1-review.zip');
if (delivery) {
    delivery.validateEntries(entries, sourceOnly, root);
    delivery.assertNewOutput(output);
}
const result = writeZip(output, entries);
execFileSync('unzip', ['-t', output], { stdio: 'pipe' });
const sha256 = crypto.createHash('sha256').update(fs.readFileSync(output)).digest('hex');
fs.writeFileSync(`${output}.sha256`, `${sha256}  ${path.basename(output)}\n`);
console.log(`review: ${result.entries} entries, ${result.bytes} bytes, ZIP CRCs valid`);
console.log(`sha256: ${sha256}`);
