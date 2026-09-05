'use strict';

const fs = require('node:fs');
const path = require('node:path');

function getBuildInfo(context) {
    const root = context.extensionPath;
    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    const metadataPath = path.join(root, 'media', 'build-metadata.js');
    const metadata = fs.existsSync(metadataPath) ? require(metadataPath) : null;
    return {
        extensionId: `${manifest.publisher}.${manifest.name}`,
        version: manifest.version,
        sourceCommit: metadata?.sourceCommit || null,
        buildId: metadata?.buildId || 'unpackaged',
        buildVersion: metadata?.version || null,
        dirty: metadata?.dirty ?? null,
        metadataStatus: metadata ? 'packaged' : 'unpackaged',
        extensionMode: { 1: 'installed', 2: 'development', 3: 'test' }[context.extensionMode] || 'unknown',
        extensionPath: root
    };
}

module.exports = { getBuildInfo };
