'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { createRun } = require('./run.cjs');
const { open, close, reset, settled, enter, select, analyze } = require('./browser-helpers.cjs');
const { measurePage, validateMeasurement } = require('./oracle.cjs');
const root = path.resolve(__dirname, '../../..');
const write = (directory, name, value) => fs.writeFileSync(path.join(directory, name), JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
function runtimeHashes() {
    const names = [...fs.readdirSync(path.join(root, 'media')).filter(name => /^hardware.*\.(js|css)$/.test(name)).map(name => `media/${name}`),
        'experiments/hardware/g4/index.html', 'experiments/hardware/g4/server.js'];
    return names.sort().map(name => ({ path: name, sha256: crypto.createHash('sha256').update(fs.readFileSync(path.join(root, name))).digest('hex') }));
}

async function run() {
    const runDirectory = process.env.G5_READABILITY_OUTPUT_DIR || createRun('before'), output = path.join(runDirectory, 'before');
    fs.mkdirSync(output);
    const runtimeBefore = runtimeHashes(), receipt = { schema: 'g5-readability-before-v1', status: 'running', output, captures: [], runtimeBefore };
    const session = await open({ output }), { page } = session;
    receipt.environment = { node: process.version, platform: process.platform, arch: process.arch, browser: session.browser.version(),
        playwright: require('@playwright/test/package.json').version, browserChannel: 'chrome', headless: process.env.G4_HEADED !== '1' };
    async function capture(name, notes) {
        await settled(page); await page.mouse.move(3, 3);
        const measurement = await measurePage(page), roles = measurement.sceneRoles;
        const mandatory = [roles.shell, ...roles.children.filter(c => c.kind.includes('occurrence')), ...roles.storages]
            .map(item => ({ ownerId: item.id, role: 'node-title', text: item.label }));
        const verdict = validateMeasurement(measurement, { mandatory, minimumFont: 9, fitAll: true });
        await page.screenshot({ path: path.join(output, `${name}.png`) });
        write(output, `${name}.measurement.json`, measurement);
        const state = await page.evaluate(() => window.bsvHardware.getState());
        write(output, `${name}.state.json`, { current: state.current, scene: state.scene, geometry: state.geometry,
            history: { back: state.history.back.map(item => item.current), forward: state.history.forward.map(item => item.current) } });
        receipt.captures.push({ name, notes, screenshot: `${name}.png`, measurement: `${name}.measurement.json`, state: `${name}.state.json`, mandatory, verdict });
        console.log(`READABILITY_BEFORE ${name} min=${verdict.minimumVisibleFont} findings=${verdict.findings.length}`);
    }
    try {
        await reset(session); await capture('A-overall-desktop', 'Ordinary initial A BSV overview, no selection.');
        await enter(page, 'left'); let state = await page.evaluate(() => window.bsvHardware.getState());
        const storage = state.scene.storages.find(s => s.label === 'state'); await select(page, storage.id); await analyze(page, 'state-accesses');
        for (const [width, theme, motion] of [[1440, 'dark', 'no-preference'], [960, 'light', 'no-preference'], [420, 'high-contrast', 'reduce']]) {
            await page.emulateMedia({ reducedMotion: motion }); await page.setViewportSize({ width, height: 900 });
            await page.locator('#theme-select').selectOption(theme); await settled(page, () => page.locator('#fit').click());
            await capture(`A-left-${width}-${theme}`, 'Exact historical variant sequence: viewport width, Fit, state-accesses.');
            await page.locator('#code-drawer pre[data-source-reference-id]').first().scrollIntoViewIfNeeded();
            await capture(`A-left-source-${width}-${theme}`, 'Same scene after original source scrollIntoView, matching historical source capture.');
        }
        await reset(session); await page.emulateMedia({ reducedMotion: 'no-preference' });
        await settled(page, () => page.locator('#rtl').click());
        state = await page.evaluate(() => window.bsvHardware.getState());
        await select(page, state.scene.contacts.find(c => c.ownerId === state.scene.shell.id && c.label === 'get').id);
        await analyze(page, 'same-net');
        const seen = Promise.withResolvers(), release = Promise.withResolvers(), finished = Promise.withResolvers();
        let held = false;
        const handler = async route => {
            if (held) return route.continue(); held = true;
            const response = await route.fetch(); seen.resolve(); await release.promise; await route.fulfill({ response }); finished.resolve();
        };
        await page.route('**/api/analysis?*', handler);
        await page.locator('[data-analysis-kind="drivers-loads"]').first().click(); await seen.promise;
        await settled(page, () => page.locator('#provider-select').selectOption('instrumented'));
        const instrumented = await page.evaluate(() => window.bsvHardware.getState().current);
        release.resolve(); await finished.promise; await page.unroute('**/api/analysis?*', handler);
        assert.deepEqual(await page.evaluate(() => window.bsvHardware.getState().current), instrumented);
        await capture('J11-exact-instrumented-root', 'Exact original J11: held stock drivers-loads, provider switch, release stale response.');
        await reset(session, 'B'); state = await page.evaluate(() => window.bsvHardware.getState());
        await select(page, state.scene.storages.find(s => s.label === 'count').id); state = await analyze(page, 'state-accesses');
        const increment = state.current.analysis.result.writers.find(b => b.name === 'increment');
        await settled(page, () => page.locator(`[data-code-section="writer"] [data-analysis-entity-id=${JSON.stringify(increment.id)}]`).click());
        await capture('B-source-desktop', 'Actual B count/increment source predicate and code.');
        state = await settled(page, () => page.locator('#rtl').click());
        const logic = state.scene.children.find(c => c.type === '$add'); state = await select(page, logic.id);
        const pin = state.scene.contacts.find(c => c.ownerId === logic.id && c.label === 'Y');
        await page.locator(`[data-analysis-pin-id=${JSON.stringify(pin.id)}]`).click();
        await analyze(page, 'dependencies', 'backward'); await settled(page, () => page.locator('#fit').click());
        await capture('B-dense-rtl-desktop', 'Actual selected add Y dependency query followed by explicit whole-scene Fit.');
        for (const name of ['narrow', 'wide']) {
            await reset(session, 'C'); await enter(page, name); state = await enter(page, 'implementation');
            await select(page, state.scene.storages[0].id); await analyze(page, 'state-accesses');
            await capture(`C-${name}-source-desktop`, 'Actual generic BSV owner and implementation source.');
            state = await settled(page, () => page.locator('#rtl').click());
            await select(page, state.scene.contacts.find(c => c.ownerId === state.scene.shell.id && c.label === 'get').id);
            await analyze(page, 'same-net'); await capture(`C-${name}-rtl-desktop`, 'Actual retained RTL occurrence and get vector width.');
        }
        assert.deepEqual(session.pageErrors, []); assert.deepEqual(runtimeHashes(), runtimeBefore, 'Runtime changed during before capture');
        receipt.status = 'captured';
    } catch (error) {
        receipt.status = /ERR_BLOCKED_BY_ADMINISTRATOR/.test(String(error)) ? 'blocked' : 'fail';
        receipt.error = String(error.stack || error); process.exitCode = 1;
        await page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {});
    } finally {
        receipt.runtimeAfter = runtimeHashes(); receipt.pageErrors = session.pageErrors;
        await close(session); write(output, 'receipt.json', receipt);
        console.log(`R0_READY ${path.join(output, 'receipt.json')}`);
    }
}

if (require.main === module) run().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { run, runtimeHashes };
