'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { runTests } = require('@vscode/test-electron');
const { assertAquaFixture } = require('./aqua-fixture');

const root = path.resolve(__dirname, '..');
const workspace = process.env.AQUA_WORKSPACE;
const fixture = assertAquaFixture(workspace);
const receiptPath = path.join(root, '.build', 'aqua-extension-host-receipt.json');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'bsv-aqua-'));
console.log(`Extension Host profile: ${profile}`);
process.env.AQUA_WORKSPACE = fixture.root;

runTests({
    extensionDevelopmentPath: root,
    extensionTestsPath: path.join(root, 'test', 'extension-host', 'aqua.js'),
    launchArgs: [
        fixture.root,
        `--user-data-dir=${path.join(profile, 'user-data')}`,
        `--extensions-dir=${path.join(profile, 'extensions')}`,
        '--disable-extensions',
        '--skip-welcome',
        '--skip-release-notes',
        '--disable-updates'
    ]
}).then(() => {
    writeReceipt('passed');
}).catch((error) => {
    writeReceipt('failed', error);
    console.error(error);
    process.exitCode = 1;
});

function writeReceipt(status, error = null) {
    fs.mkdirSync(path.dirname(receiptPath), { recursive: true });
    fs.writeFileSync(receiptPath, `${JSON.stringify({
        status,
        revision: fixture.revision,
        sourceFingerprint: fixture.fingerprint,
        sourceFiles: fixture.files,
        profile,
        completedAt: new Date().toISOString(),
        error: error ? String(error.message || error) : null
    }, null, 2)}\n`);
}
