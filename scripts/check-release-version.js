'use strict';

const manifest = require('../package.json');

function assertReleaseTag(version, tag) {
    const expected = `v${version}`;
    if (tag !== expected) {
        throw new Error(`Release tag ${tag || '(missing)'} must equal ${expected}.`);
    }
    return expected;
}

if (require.main === module) {
    console.log(`release-tag: ${assertReleaseTag(manifest.version, process.env.RELEASE_TAG || process.env.GITHUB_REF_NAME)}`);
}

module.exports = { assertReleaseTag };
