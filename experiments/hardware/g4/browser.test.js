'use strict';

// Browser dependency lane; the shipped offline core never imports Playwright.
const test = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require('@playwright/test');
const { createServer } = require('./server');

test('J01 actual product BSV scene enters left with one pointer click', async t => {
    const server = await createServer();
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    t.after(() => new Promise(resolve => server.close(resolve)));
    const browser = await chromium.launch({ channel: 'chrome', headless: true });
    t.after(() => browser.close());
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.addInitScript(() => {
        window.__firstScene = new Promise(resolve => window.addEventListener('hardware:settled', resolve, { once: true }));
    });
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.evaluate(() => Promise.race([
        window.__firstScene,
        new Promise((_, reject) => setTimeout(() => reject(new Error('No committed hardware scene')), 10000))
    ]));
    const before = await page.evaluate(() => window.bsvHardware.getState());
    assert.equal(before.current.sceneKind, 'bsv');
    const left = before.scene.children.find(child => child.label === 'left');
    assert.ok(left);
    await page.evaluate(() => {
        window.__entered = new Promise(resolve => window.addEventListener('hardware:settled', resolve, { once: true }));
    });
    await page.locator(`[data-semantic-id=${JSON.stringify(left.id)}] .body`).click();
    await page.evaluate(() => Promise.race([
        window.__entered,
        new Promise((_, reject) => setTimeout(() => reject(new Error('No completed shell expansion')), 10000))
    ]));
    const after = await page.evaluate(() => window.bsvHardware.getState());
    assert.equal(after.current.sceneKind, 'bsv');
    assert.equal(after.current.ownerInstanceId, left.id);
    assert.equal(after.current.selectedEntityId, null);
    assert.equal(after.history.back.length, 1);
    assert.ok(after.scene.storages.some(storage => storage.label === 'state'));
    assert.ok(after.runtime.visibleSemanticIds.includes(left.id));
    assert.ok(after.runtime.shell.width > 100 && after.runtime.shell.height > 100);
    assert.ok(after.scene.correspondence.stock.analysisId);
});
