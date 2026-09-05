'use strict';

const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { runTests } = require('@vscode/test-electron');

const root = path.resolve(__dirname, '..');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'bsv-host-'));
console.log(`Extension Host profile: ${profile}`);

runTests({
    extensionDevelopmentPath: root,
    extensionTestsPath: path.join(root, 'test', 'extension-host', 'index.js'),
    launchArgs: [
        path.join(root, 'examples', 'bsv-mini-accelerator'),
        `--user-data-dir=${path.join(profile, 'user-data')}`,
        `--extensions-dir=${path.join(profile, 'extensions')}`,
        '--disable-extensions',
        '--disable-workspace-trust',
        '--skip-welcome',
        '--skip-release-notes',
        '--disable-updates'
    ]
}).catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
