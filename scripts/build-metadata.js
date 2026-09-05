'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

function writeBuildMetadata(root, sourceCommit, dirty) {
    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    const files = ['package.json', ...['src', 'media'].flatMap((directory) =>
        fs.readdirSync(path.join(root, directory), { recursive: true })
            .map((name) => `${directory}/${name.replaceAll(path.sep, '/')}`)
            .filter((name) => name !== 'media/build-metadata.js'
                && fs.statSync(path.join(root, name)).isFile())
    )].sort();
    const digest = crypto.createHash('sha256').update(`${sourceCommit}\0${dirty}\0`);
    for (const file of files) {
        digest.update(`${file}\0`).update(fs.readFileSync(path.join(root, file))).update('\0');
    }
    const metadata = {
        metadataVersion: 1,
        extensionId: `${manifest.publisher}.${manifest.name}`,
        version: manifest.version,
        sourceCommit,
        buildId: `sha256:${digest.digest('hex')}`,
        dirty
    };
    const serialized = JSON.stringify(metadata, null, 2).replaceAll('<', '\\u003c');
    fs.writeFileSync(path.join(root, 'media', 'build-metadata.js'),
        `'use strict';\n(function () {\nconst info = Object.freeze(${serialized});\n`
        + "if (typeof module === 'object' && module.exports) module.exports = info;\n"
        + 'else globalThis.BsvLensBuildInfo = info;\n}());\n');
    return metadata;
}

module.exports = { writeBuildMetadata };
