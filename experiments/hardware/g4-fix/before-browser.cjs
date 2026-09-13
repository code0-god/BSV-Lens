'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { chromium } = require('@playwright/test');
const { createRunOutput } = require('../g4/run-output');
const root = path.resolve(__dirname, '../../..');

(async () => {
    const output = await createRunOutput(root, 'g4-fix-before-browser');
    const extracted = path.join(output, 'submitted-source');
    fs.mkdirSync(extracted);
    const archive = path.join(root, 'dist/bsv-lens-hardware-g4-source.zip');
    execFileSync('unzip', ['-q', archive, '-d', extracted]);
    const archiveSha256 = crypto.createHash('sha256').update(fs.readFileSync(archive)).digest('hex');
    assert.equal(archiveSha256, '605c10c13026d085748f5414cf99fd5b9d9225c147e5b227d308f402bfc0aec3');
    const productRoot = path.join(extracted, 'bsv-lens');
    const { createServer } = require(path.join(productRoot, 'experiments/hardware/g4/server.js'));
    const server = await createServer();
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const browser = await chromium.launch({ channel: 'chrome', headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const pageErrors = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    const receipt = { schema: 'g4-fix-before-browser-v1', archive, archiveSha256, extracted: productRoot, browser: browser.version(), pageErrors };
    try {
        await page.addInitScript(() => { window.__ready = new Promise(resolve => window.addEventListener('hardware:settled', resolve, { once: true })); });
        await page.goto(`http://127.0.0.1:${server.address().port}`);
        await page.evaluate(() => Promise.race([window.__ready, new Promise((_, reject) => setTimeout(() => reject(new Error('Initial scene timeout')), 10000))]));
        await page.evaluate(() => {
            window.__rtl = new Promise(resolve => {
                const listener = event => {
                    if (event.detail.current.sceneKind !== 'rtl') return;
                    window.removeEventListener('hardware:settled', listener);
                    resolve();
                };
                window.addEventListener('hardware:settled', listener);
            });
        });
        await page.locator('#rtl').click();
        await page.evaluate(() => Promise.race([window.__rtl,
            new Promise((_, reject) => setTimeout(() => reject(new Error('RTL scene timeout')), 10000))]));
        const before = await page.evaluate(() => window.bsvHardware.getState());
        assert.equal(before.current.sceneKind, 'rtl');
        const left = before.scene.children.find(item => item.label === 'left');
        await page.screenshot({ path: path.join(output, 'rtl-root-before.png') });
        await page.evaluate(() => {
            window.__attempt = new Promise(resolve => {
                let requested = false;
                const listener = event => {
                    if (event.detail.pending) requested = true;
                    else if (requested) {
                        window.removeEventListener('hardware:status', listener);
                        resolve(window.bsvHardware.getState());
                    }
                };
                window.addEventListener('hardware:status', listener);
            });
        });
        await page.locator(`[data-semantic-id=${JSON.stringify(left.id)}] .body`).click();
        const after = await page.evaluate(() => Promise.race([window.__attempt,
            new Promise((_, reject) => setTimeout(() => reject(new Error('Child request did not finish')), 10000))]));
        assert.equal(after.scene.shell.id, before.scene.shell.id);
        assert.notEqual(after.scene.shell.id, left.id);
        assert.equal(after.history.back.length, before.history.back.length);
        assert.equal(after.error, null);
        await page.screenshot({ path: path.join(output, 'rtl-root-after-left-click.png') });
        Object.assign(receipt, { status: 'F1_REPRODUCED', requestedChild: left.id, before, after });
        console.log(`F1_BROWSER_REPRODUCED ${left.id}`);
    } catch (error) {
        Object.assign(receipt, { status: String(error).includes('ERR_BLOCKED_BY_ADMINISTRATOR') ? 'BLOCKED' : 'FAIL', error: String(error.stack || error) });
        process.exitCode = 1;
    } finally {
        fs.writeFileSync(path.join(output, 'browser-before.json'), `${JSON.stringify(receipt, null, 2)}\n`, { flag: 'wx' });
        await browser.close();
        await new Promise(resolve => server.close(resolve));
        console.log(`G4_FIX_BROWSER_BEFORE ${output}`);
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
