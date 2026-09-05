'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { writeBuildMetadata } = require('../scripts/build-metadata');
const { getBuildInfo } = require('../src/build-info');

test('packaging identifies exact runtime bytes without hashing generated metadata', (t) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bsv-build-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    fs.mkdirSync(path.join(root, 'src'));
    fs.mkdirSync(path.join(root, 'media'));
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({
        publisher: 'code0-god', name: 'bsv-lens', version: '0.4.1'
    }));
    fs.writeFileSync(path.join(root, 'src', 'extension.js'), "'use strict';\n");
    fs.writeFileSync(path.join(root, 'media', 'webview.js'), "'use strict';\n");
    const sourceCommit = 'a'.repeat(40);
    const metadata = writeBuildMetadata(root, sourceCommit, false);
    assert.equal(metadata.metadataVersion, 1);
    assert.equal(metadata.extensionId, 'code0-god.bsv-lens');
    assert.equal(metadata.version, '0.4.1');
    assert.equal(metadata.sourceCommit, sourceCommit);
    assert.equal(metadata.dirty, false);
    assert.ok(metadata.buildId);
    assert.deepEqual(writeBuildMetadata(root, sourceCommit, false), metadata);

    const browser = {};
    vm.runInNewContext(fs.readFileSync(path.join(root, 'media', 'build-metadata.js'), 'utf8'), browser);
    assert.deepEqual(JSON.parse(JSON.stringify(browser.BsvLensBuildInfo)), metadata);
    const host = getBuildInfo({ extensionPath: root, extensionMode: 1 });
    assert.equal(host.buildId, metadata.buildId);
    assert.equal(host.sourceCommit, sourceCommit);
    assert.equal(host.extensionMode, 'installed');
    assert.equal(host.extensionPath, root);
    assert.equal(host.metadataStatus, 'packaged');

    fs.writeFileSync(path.join(root, 'media', 'webview.js'), "'use strict';\nvoid 1;\n");
    assert.notEqual(writeBuildMetadata(root, sourceCommit, false).buildId, metadata.buildId);
    assert.equal(writeBuildMetadata(root, sourceCommit, true).dirty, true);
});

test('unpackaged development cannot claim a packaged source commit or build', (t) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bsv-build-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({
        publisher: 'code0-god', name: 'bsv-lens', version: '0.4.1'
    }));
    const info = getBuildInfo({ extensionPath: root, extensionMode: 2 });
    assert.equal(info.extensionId, 'code0-god.bsv-lens');
    assert.equal(info.version, '0.4.1');
    assert.equal(info.extensionMode, 'development');
    assert.equal(info.metadataStatus, 'unpackaged');
    assert.equal(info.sourceCommit, null);
    assert.equal(info.buildId, 'unpackaged');
});
