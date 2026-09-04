'use strict';

const { defineConfig } = require('@playwright/test');
const { assertAquaFixture } = require('./scripts/aqua-fixture');

const workspace = process.env.AQUA_WORKSPACE;
const fixture = assertAquaFixture(workspace);
const previewToken = process.env.BSV_PREVIEW_TOKEN;
if (!previewToken) throw new Error('BSV_PREVIEW_TOKEN is required.');

module.exports = defineConfig({
    testDir: './test',
    testMatch: ['aqua-webview.e2e.js', 'aqua-matmul-webview.e2e.js'],
    outputDir: '.build/playwright-aqua-results',
    reporter: 'line',
    fullyParallel: false,
    workers: 1,
    use: {
        baseURL: 'http://127.0.0.1:4174',
        channel: 'chrome',
        headless: true,
        extraHTTPHeaders: { 'x-bsv-preview-token': previewToken },
        viewport: { width: 2048, height: 1152 },
        screenshot: 'only-on-failure',
        trace: 'retain-on-failure'
    },
    webServer: {
        command: 'node scripts/preview-webview.js',
        url: 'http://127.0.0.1:4174/health',
        env: {
            ...process.env,
            PORT: '4174',
            BSV_PREVIEW_TOKEN: previewToken,
            BSV_TEST_WORKSPACE: fixture.root,
            BSV_TEST_WORKSPACE_NAME: 'AQuA',
            BSV_TEST_ACTIVE_FILE: 'hw/bsv/src/control/AquaLoopMatmul.bsv'
        },
        reuseExistingServer: false
    }
});
