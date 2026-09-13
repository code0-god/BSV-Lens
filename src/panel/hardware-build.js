'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { hash, stable, failure } = require('../hardware/json');
const PROTOCOL = 1;
const MANIFEST_NORMALIZATION = 'canonical-json-without-vscode-metadata';
function manifestBytes(bytes) {
    const manifest = JSON.parse(bytes.toString('utf8'));
    delete manifest.__metadata;
    return Buffer.from(stable(manifest));
}
const excluded = new Set(['media/build-metadata.js', 'media/hardware-build.json']);
function inspectHardwareBuild(root) {
    const files = [];
    function walk(relative) {
        for (const name of fs.readdirSync(path.join(root, relative)).sort()) {
            const file = `${relative}/${name}`, stat = fs.lstatSync(path.join(root, file));
            if (stat.isSymbolicLink()) throw failure('BUILD_MISMATCH', 'Runtime symlink is unsupported');
            if (stat.isDirectory()) walk(file);
            else if (!excluded.has(file)) files.push({ path: file, bytes: stat.size, sha256: hash(fs.readFileSync(path.join(root, file))) });
        }
    }
    walk('src'); walk('media');
    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    const canonicalManifest = manifestBytes(fs.readFileSync(path.join(root, 'package.json')));
    files.push({ path: 'package.json', bytes: canonicalManifest.length, sha256: hash(canonicalManifest), normalization: MANIFEST_NORMALIZATION });
    files.sort((a, b) => a.path.localeCompare(b.path));
    const runtimeFingerprint = hash(stable(files));
    return { schema: 1, protocol: PROTOCOL, extensionId: `${manifest.publisher}.${manifest.name}`, version: manifest.version,
        buildId: `g6:${runtimeFingerprint}`, runtimeFingerprint,
        hostFingerprint: hash(stable(files.filter(file => file.path.startsWith('src/')))),
        webviewFingerprint: hash(stable(files.filter(file => file.path.startsWith('media/')))), files };
}
function getHardwareBuild(root) {
    const actual = inspectHardwareBuild(root), file = path.join(root, 'media/hardware-build.json');
    if (fs.existsSync(file)) {
        const expected = JSON.parse(fs.readFileSync(file, 'utf8'));
        if (stable(expected) !== stable(actual)) throw failure('BUILD_MISMATCH', 'Installed Host/Webview runtime differs from packaged build metadata');
    }
    return Object.freeze({ ...actual, installedManifestSha256: hash(fs.readFileSync(path.join(root, 'package.json'))), metadataStatus: fs.existsSync(file) ? 'packaged' : 'development-unpackaged' });
}
module.exports = { PROTOCOL, MANIFEST_NORMALIZATION, manifestBytes, inspectHardwareBuild, getHardwareBuild };
