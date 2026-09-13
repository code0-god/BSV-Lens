'use strict';

const assert = require('node:assert/strict');
const { chromium } = require(process.env.G5_READABILITY_PLAYWRIGHT || '@playwright/test');
const { createServer } = require('../g4/server');

async function open(options = {}) {
    const server = await createServer();
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const browser = await chromium.launch({ channel: 'chrome', headless: process.env.G4_HEADED !== '1' });
    const context = await browser.newContext({ viewport: options.viewport || { width: 1440, height: 900 },
        deviceScaleFactor: options.deviceScaleFactor || 1, acceptDownloads: true });
    if (options.output) await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
    const page = await context.newPage(), pageErrors = [];
    page.setDefaultTimeout(15000);
    page.on('pageerror', error => pageErrors.push(error.message));
    return { page, context, browser, server, pageErrors, output: options.output,
        base: `http://127.0.0.1:${server.address().port}` };
}

async function close(session) {
    if (session.output) await session.context.tracing.stop({ path: require('node:path').join(session.output, 'trace.zip') });
    await session.browser.close();
    await new Promise(resolve => session.server.close(resolve));
}

async function settled(page, action, options = {}) {
    const before = await page.evaluate(() => {
        const state = window.bsvHardware?.getState();
        return { revision: state?.runtime.renderRevision || 0, generation: state?.queryGeneration || 0 };
    });
    if (action) await action();
    await page.waitForFunction(({ before, options, acted }) => {
        const state = window.bsvHardware?.getState();
        if (!state?.current || state.pending || state.transition) return false;
        if (state.error) throw new Error(state.error.message);
        if (options.analysis) {
            const result = state.current.analysis?.result;
            if (result?.kind !== options.analysis.kind || options.analysis.direction && result.direction !== options.analysis.direction) return false;
            if (state.queryGeneration <= before.generation) return false;
        } else if (acted && options.changed !== false && state.runtime.renderRevision <= before.revision) return false;
        return true;
    }, { before, options, acted: !!action });
    await page.evaluate(async () => { await document.fonts.ready; await window.bsvHardware.whenSettled(); });
    return page.evaluate(() => window.bsvHardware.getState());
}

async function reset(session, buildId = 'A') {
    await session.page.setViewportSize({ width: 1440, height: 900 });
    await session.page.goto(session.base);
    let state = await settled(session.page);
    if (buildId !== 'A') state = await settled(session.page, () => session.page.locator('#build-select').selectOption(buildId));
    return state;
}

const object = (page, id) => page.locator(`[data-semantic-id=${JSON.stringify(id)}][data-active="true"]`);

async function select(page, id) {
    const target = object(page, id), body = target.locator('.body');
    if (await body.count()) {
        const bounds = await body.boundingBox();
        assert.ok(bounds, `Missing visible body ${id}`);
        return settled(page, () => body.click({ position: { x: Math.max(1, bounds.width - 10), y: Math.min(12, bounds.height / 2) } }));
    }
    return settled(page, () => target.locator('.mark').first().click());
}

async function enter(page, name) {
    const state = await page.evaluate(() => window.bsvHardware.getState());
    const child = state.scene.children.find(item => item.label === name);
    assert.ok(child, `Missing child ${name}`);
    return select(page, child.id);
}

async function analyze(page, kind, direction) {
    const selector = `[data-analysis-kind=${JSON.stringify(kind)}]` +
        (direction ? `[data-analysis-direction=${JSON.stringify(direction)}]` : '');
    return settled(page, () => page.locator(selector).first().click(), { analysis: { kind, direction } });
}

module.exports = { open, close, reset, settled, enter, select, analyze, object };
