'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { collectFiles } = require('../../../scripts/zip');
const { collectEntries } = require('../g4/package');
const { runtime } = require('./package.cjs');
const root = path.resolve(__dirname, '../../..');
const runs = path.join(root, '.build/hardware/runs');
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const sources = {
    baseline: 'g4-fix-preservation-capture-647jUL',
    'before-regressions': 'g4-fix-before-regressions-5v24Nu',
    'before-positive': 'g4-fix-before-positive-ZMPyys',
    'before-browser': 'g4-fix-before-browser-hREnjc',
    'before-geometry': 'g4-fix-product-probe-2DDy2p',
    'after-geometry': 'g4-fix-product-probe-ryB45A',
    'geometry-oracle': 'g4-fix-geometry-oracle-corpus-Hx9CDX',
    'oracle-tests': 'g4-fix-geometry-oracle-schema-tests-XiSslO',
    'router-tests': 'g4-fix-router-bsv-spacing-final-tests-OTGEGa',
    'router-oracle': 'g4-fix-router-bsv-spacing-independent-bMfnHx',
    metrics: 'g4-fix-metrics-comparison-BsjXWW',
    browser: 'g4-fix-browser-yqqRAp',
    'browser-audit': 'g4-fix-browser-geometry-audit-pSTyhm',
    'hardware-tests': 'g4-fix-hardware-regressions-I97v5P',
    'repository-check': 'g4-fix-repository-check-34FDzC',
    'full-suite': 'g4-fix-full-suite-FsH1fW',
    'package-tests': 'g4-fix-packaging-regressions-qElze7',
    preservation: 'g4-fix-preservation-verify-RiMHmf',
    'package-stage': 'g4-fix-package-yb18da'
};

function main() {
    const browser = JSON.parse(fs.readFileSync(path.join(runs, sources.browser, 'browser.json'), 'utf8'));
    assert.equal(browser.status, 'PASS');
    assert.equal(browser.journeys.length, 12);
    for (const input of browser.runtimeInputs) assert.equal(hash(fs.readFileSync(path.join(root, input.path))), input.sha256,
        `Runtime differs from browser evidence: ${input.path}`);
    const oracle = fs.readFileSync(path.join(__dirname, 'oracle/regressions.test.cjs'));
    const before = JSON.parse(fs.readFileSync(path.join(runs, sources['before-regressions'], 'receipt.json'), 'utf8'));
    assert.equal(hash(oracle), before.oracle.sha256, 'Frozen local oracle changed');
    const parent = path.join(root, 'docs/hardware/evidence/g4-fix');
    fs.mkdirSync(parent, { recursive: true });
    const output = fs.mkdtempSync(path.join(parent, 'run-'));
    const files = [];
    const copy = (source, relative) => {
        const bytes = fs.readFileSync(source), target = path.join(output, relative);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, bytes, { flag: 'wx' });
        const metadata = {};
        if (relative.endsWith('.png')) {
            assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
            metadata.width = bytes.readUInt32BE(16); metadata.height = bytes.readUInt32BE(20);
        }
        assert.equal(hash(fs.readFileSync(target)), hash(bytes));
        files.push({ path: relative, bytes: bytes.length, sha256: hash(bytes), ...metadata });
    };
    const navigation = fs.readFileSync(path.join(root, 'docs/hardware/g4-fix/NAVIGATION.md'), 'utf8');
    for (const match of navigation.matchAll(/\b(g4-fix-f1-[A-Za-z0-9_-]+)(?=\/)/g)) {
        sources[`f1/${match[1]}`] = match[1];
    }
    assert.ok(Object.keys(sources).filter(label => label.startsWith('f1/')).length >= 6, 'Missing F1 receipt references');
    for (const [label, directory] of Object.entries(sources)) {
        const source = path.join(runs, directory);
        assert.ok(fs.existsSync(source), `Missing evidence source ${source}`);
        for (const entry of collectFiles(source, { exclude: relative =>
            relative.split('/').includes('submitted-source') || relative.split('/').includes('replay')
                || label === 'package-stage' && /\.zip(?:\.sha256)?$/.test(relative) })) {
            copy(path.join(source, entry.name), `${label}/${entry.name}`);
        }
    }
    copy(path.join(__dirname, 'oracle/regressions.test.cjs'), 'oracle/regressions.test.cjs');
    const currentRuntime = runtime(collectEntries({ workspace: root }));
    const index = { schema: 'g4-fix-evidence-index-v1', output, sources,
        oracle: { provenance: 'Locally reconstructed from supplied findings; original independent review files not supplied',
            sha256: hash(oracle), beforeExitCode: before.exitCode },
        featureIdentity: hash(JSON.stringify(currentRuntime)), runtime: currentRuntime, files,
        browser: { status: browser.status, version: browser.browser, journeys: browser.journeys.map(({ id, status, screenshot }) => ({ id, status, screenshot: `browser/${screenshot}` })),
            export: browser.export.status, keyboard: browser.keyboard.status },
        userVisualDesignAcceptance: 'PENDING', nativeVsCode: 'NOT RUN' };
    fs.writeFileSync(path.join(output, 'index.json'), `${JSON.stringify(index, null, 2)}\n`, { flag: 'wx' });
    console.log(JSON.stringify({ output, files: files.length, pngs: files.filter(file => file.path.endsWith('.png')).length,
        featureIdentity: index.featureIdentity, oracleSha256: index.oracle.sha256 }, null, 2));
}
if (require.main === module) main();
module.exports = { main };
