'use strict';

const path = require('node:path');
const { runTests } = require('@vscode/test-electron');

const root = path.resolve(__dirname, '..');

runTests({
    extensionDevelopmentPath: root,
    extensionTestsPath: path.join(root, 'test', 'extension-host', 'index.js'),
    launchArgs: [
        path.join(root, 'examples', 'bsv-mini-accelerator'),
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
