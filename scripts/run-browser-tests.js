'use strict';

const { spawnSync } = require('node:child_process');
const { randomBytes } = require('node:crypto');

const config = process.argv[2];
if (!config) throw new Error('A Playwright config path is required.');

const result = spawnSync(
    process.execPath,
    [require.resolve('@playwright/test/cli'), 'test', '--config', config, ...process.argv.slice(3)],
    {
        cwd: process.cwd(),
        env: {
            ...process.env,
            BSV_PREVIEW_TOKEN: randomBytes(32).toString('hex')
        },
        stdio: 'inherit'
    }
);

if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
