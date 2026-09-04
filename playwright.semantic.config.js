'use strict';

const path = require('node:path');
const { defineConfig } = require('@playwright/test');

const previewToken = process.env.BSV_PREVIEW_TOKEN;
if (!previewToken) throw new Error('BSV_PREVIEW_TOKEN is required.');

module.exports = defineConfig({
    testDir: './test',
    testMatch: 'semantic-webview.e2e.js',
    outputDir: '.build/playwright-semantic-results',
    reporter: 'line',
    fullyParallel: false,
    workers: 1,
    use: {
        baseURL: 'http://127.0.0.1:4175',
        channel: 'chrome',
        headless: true,
        extraHTTPHeaders: { 'x-bsv-preview-token': previewToken },
        viewport: { width: 1280, height: 900 },
        screenshot: 'only-on-failure',
        trace: 'retain-on-failure'
    },
    webServer: {
        command: 'node scripts/preview-webview.js',
        url: 'http://127.0.0.1:4175/health',
        env: {
            ...process.env,
            PORT: '4175',
            BSV_PREVIEW_TOKEN: previewToken,
            BSV_TEST_WORKSPACE: path.resolve(
                __dirname,
                'test',
                'fixtures',
                'semantic-workspace'
            ),
            BSV_TEST_WORKSPACE_NAME: 'Semantic Flow Architecture',
            BSV_TEST_ACTIVE_FILE: 'src/SemanticFlowFixture.bsv'
        },
        reuseExistingServer: false
    }
});
