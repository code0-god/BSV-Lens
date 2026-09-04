'use strict';

const { defineConfig } = require('@playwright/test');

const previewToken = process.env.BSV_PREVIEW_TOKEN;
if (!previewToken) throw new Error('BSV_PREVIEW_TOKEN is required.');

module.exports = defineConfig({
    testDir: './test',
    testMatch: 'browser-webview.e2e.js',
    outputDir: '.build/playwright-results',
    reporter: 'line',
    fullyParallel: false,
    workers: 1,
    use: {
        baseURL: 'http://127.0.0.1:4173',
        channel: 'chrome',
        headless: true,
        extraHTTPHeaders: { 'x-bsv-preview-token': previewToken },
        viewport: { width: 1280, height: 900 },
        screenshot: 'only-on-failure',
        trace: 'retain-on-failure'
    },
    webServer: {
        command: 'node scripts/preview-webview.js',
        url: 'http://127.0.0.1:4173/health',
        env: { ...process.env, PORT: '4173', BSV_PREVIEW_TOKEN: previewToken },
        reuseExistingServer: false
    }
});
