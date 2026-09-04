'use strict';

const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const EXPECTED_AQUA_REVISION = '6692a52973fbb487a421b07fc8cd881d0542e964';
const EXPECTED_SOURCE_FINGERPRINT = 'dae0bb0cd7cbb77857b5bac36565a40a43e4bc5d9333e275d7cf3be459767475';

function fingerprintBsvSources(workspace) {
    const root = path.resolve(workspace);
    const sourceRoot = path.join(root, 'hw', 'bsv', 'src');
    const sourceFiles = walk(sourceRoot)
        .filter((filePath) => filePath.endsWith('.bsv'))
        .sort((left, right) => left.localeCompare(right));
    const hash = createHash('sha256');
    for (const filePath of sourceFiles) {
        hash.update(path.relative(root, filePath).replace(/\\/g, '/'));
        hash.update('\0');
        hash.update(fs.readFileSync(filePath));
        hash.update('\0');
    }
    return { files: sourceFiles.length, fingerprint: hash.digest('hex') };
}

function assertAquaFixture(workspace) {
    if (!workspace || !fs.existsSync(workspace)) {
        throw new Error('AQUA_WORKSPACE must point to the pinned AQuA repository.');
    }
    const root = fs.realpathSync(path.resolve(workspace));
    const revision = execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], {
        encoding: 'utf8'
    }).trim();
    const source = fingerprintBsvSources(root);
    if (revision !== EXPECTED_AQUA_REVISION) {
        throw new Error(`AQuA revision ${revision} does not match ${EXPECTED_AQUA_REVISION}.`);
    }
    if (source.fingerprint !== EXPECTED_SOURCE_FINGERPRINT) {
        throw new Error(`AQuA BSV source fingerprint ${source.fingerprint} does not match the pinned fixture.`);
    }
    return { root, revision, ...source };
}

function walk(directory) {
    return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const filePath = path.join(directory, entry.name);
        return entry.isDirectory() ? walk(filePath) : entry.isFile() ? [filePath] : [];
    });
}

module.exports = {
    EXPECTED_AQUA_REVISION,
    EXPECTED_SOURCE_FINGERPRINT,
    assertAquaFixture,
    fingerprintBsvSources
};
