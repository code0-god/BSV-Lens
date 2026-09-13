'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { collectFiles } = require('../../../scripts/zip');
const root = path.resolve(__dirname, '../../..');
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

function finalize(run) {
    run = path.resolve(run);
    const relative = path.relative(path.join(root, '.build/hardware/runs'), run);
    assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative), 'A G4 run-specific directory is required');
    const receiptBytes = fs.readFileSync(path.join(run, 'acceptance.json'));
    const receipt = JSON.parse(receiptBytes);
    assert.equal(receipt.status, 'pass');
    assert.deepEqual(receipt.journeys.map(journey => journey.id), Array.from({ length: 23 }, (_, i) => `J${String(i + 1).padStart(2, '0')}`));
    assert.ok(receipt.journeys.every(journey => journey.status === 'pass'));
    assert.equal(receipt.keyboard.status, 'pass');
    assert.deepEqual(receipt.errors, []);
    assert.ok(receipt.stockConnectivity && receipt.rhs && receipt.control && receipt.inlined.length === 2);
    const renderedFiles = [
        ...['architecture', 'scene', 'scene-summary', 'scene-query'].map(name => `src/hardware/${name}.js`),
        ...['view', 'navigation', 'layout', 'inspector'].map(name => `media/hardware-${name}.js`),
        'media/hardware.css', 'experiments/hardware/g4/index.html', 'experiments/hardware/g4/server.js',
        'experiments/hardware/g4/acceptance.js'
    ];
    const firstCaptureTime = fs.statSync(path.join(run, 'bsv-overall.png')).mtimeMs;
    for (const name of renderedFiles) assert.ok(fs.statSync(path.join(root, name)).mtimeMs <= firstCaptureTime,
        `Rendered source is newer than acceptance evidence: ${name}`);
    const destination = path.join(root, 'docs/hardware/evidence/g4/final');
    assert.ok(!fs.existsSync(destination), 'Final evidence already exists; never overwrite it');
    fs.mkdirSync(destination);
    const browser = path.join(destination, 'browser');
    fs.mkdirSync(browser);
    const images = fs.readdirSync(run).filter(name => name.endsWith('.png')).sort();
    const files = [];
    for (const name of [...images, 'acceptance.json']) {
        assert.match(name, /^[A-Za-z0-9_.-]+$/);
        const bytes = fs.readFileSync(path.join(run, name));
        const metadata = {};
        if (name.endsWith('.png')) {
            assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', `Invalid PNG: ${name}`);
            metadata.width = bytes.readUInt32BE(16); metadata.height = bytes.readUInt32BE(20);
            assert.ok(metadata.width > 0 && metadata.height > 0);
        }
        fs.writeFileSync(path.join(browser, name), bytes, { flag: 'wx' });
        assert.equal(hash(fs.readFileSync(path.join(browser, name))), hash(bytes));
        files.push({ path: `browser/${name}`, bytes: bytes.length, sha256: hash(bytes), ...metadata });
    }
    const runtime = collectFiles(root, {
        exclude: relative => !['src', 'media', 'scripts', 'experiments', 'test', 'package.json', 'package-lock.json'].includes(relative.split('/')[0])
            || relative.split('/').some(part => ['node_modules', '__pycache__'].includes(part)),
        include: relative => /^(?:src|media|scripts)\//.test(relative)
            || /^experiments\/hardware\/.+\.(?:js|py|sh|tcl|html|css)$/.test(relative)
            || /^test\/hardware-.*\.test\.js$/.test(relative) || /^package(?:-lock)?\.json$/.test(relative)
    }).map(file => ({ path: file.name, bytes: file.data.length, sha256: hash(file.data) }));
    const index = {
        schema: 'g4-final-evidence-v1', sourceRun: run, browser: receipt.browser,
        journeys: receipt.journeys.map(({ id, status, screenshot }) => ({ id, status, screenshot: `browser/${screenshot}` })),
        keyboard: receipt.keyboard, responsive: receipt.responsive.map(({ width, screenshot }) => ({ width, screenshot: `browser/${screenshot}` })),
        runtimeIdentity: { definition: 'SHA256 of JSON-encoded sorted runtime/test/package byte inventory; not Git HEAD', sha256: hash(JSON.stringify(runtime)), files: runtime },
        transition: { geometryFrames: receipt.transitionGeometry.frames.length, screenshotFrames: receipt.transitionSequence.length,
            source: 'Actual Chrome CDP screencast and requestAnimationFrame getBoundingClientRect measurements' },
        files, userVisualAcceptance: 'PENDING', productionReplacement: 'NOT PERFORMED'
    };
    fs.writeFileSync(path.join(destination, 'index.json'), `${JSON.stringify(index, null, 2)}\n`, { flag: 'wx' });
    console.log(JSON.stringify({ destination, images: images.length, journeys: index.journeys.length,
        transition: index.transition, runtimeSha256: index.runtimeIdentity.sha256 }, null, 2));
    return index;
}

if (require.main === module) {
    assert.equal(process.argv.length, 3, 'Usage: node experiments/hardware/g4/finalize-evidence.js .build/hardware/runs/g4-acceptance-RUN');
    finalize(process.argv[2]);
}
module.exports = { finalize };
