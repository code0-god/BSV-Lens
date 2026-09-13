#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const { executeSmoke } = require('./development-smoke.cjs');

async function main() {
    const vsix = process.argv[2];
    assert.ok(vsix && process.argv.length === 3, 'Usage: node installed-smoke.cjs /absolute/candidate.vsix');
    await executeSmoke({ targetMode: 'installed', vsix });
}
if (require.main === module) main().catch(error => { console.error(error?.stack || error); process.exitCode = 1; });
module.exports = { main };
