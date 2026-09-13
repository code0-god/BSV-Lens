'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { once } = require('node:events');
const { setTimeout: delay } = require('node:timers/promises');
const { chromium } = require('@playwright/test');
const { HardwareProtocol } = require('../../../src/panel/hardware-protocol');
const { createHardwareSession } = require('../../../src/panel/hardware-session');
const { hardwareHtml } = require('../../../src/panel/hardware-html');
const { stateValue, intentFor } = require('../../../src/panel/hardware-state');
const { hash } = require('../../../src/hardware/json');
const { createRun } = require('./run.cjs');

async function main() {
    const output = process.env.G6_OUTPUT_DIR || createRun('view-context-regression'), root = path.resolve(__dirname, '../../..');
    const inputs = path.join(output, 'synthetic-input'); fs.mkdirSync(inputs);
    fs.writeFileSync(path.join(inputs, 'roots.json'), JSON.stringify({ creator: 'synthetic-native-context-regression',
        modules: Object.fromEntries(Array.from({ length: 10 }, (_, index) => [`Root${index}`, {
            attributes: { top: '1' }, ports: { signal: { direction: 'input', bits: [2, 3] } },
            cells: {}, netnames: { signal: { bits: [2, 3] } }
        }])) }), { flag: 'wx' });
    const build = { buildId: `component:${hash(fs.readFileSync(path.join(root, 'media/hardware-view.js')))}`, protocol: 1 };
    const sent = [], requests = [], saved = [], diagnostics = [], checks = [], errors = [];
    let page, session, activeContexts = 0, peakContexts = 0, holdSave = null, publicationRace = null;
    const protocol = new HardwareProtocol({ build,
        send: async message => { sent.push(message); await page.evaluate(value => {
            (window.componentReplies ||= []).push(value); window.dispatchEvent(new MessageEvent('message', { data: value }));
        }, message); },
        welcome: () => ({ catalog: [], selectedBuildId: null, inputStatus: 'No input', theme: 'dark' }),
        dispatch: async (action, payload, context) => {
            requests.push({ action, buildId: payload.buildId, provider: payload.provider });
            if (action !== 'analysis-context') return session.dispatch(action, payload, context);
            activeContexts++; peakContexts = Math.max(peakContexts, activeContexts);
            try { await delay(25); return await session.dispatch(action, payload, context); }
            finally { activeContexts--; }
        }, diagnostic: row => diagnostics.push(row) });
    session = createHardwareSession({ protocol,
        chooseInput: async () => ({ artifactRoot: inputs, artifactPath: 'roots.json' }),
        selectBuild: async entries => entries.at(-1).buildId,
        openSource: async () => { throw new Error('Source is not attached'); },
        exportSvg: async () => { throw new Error('Export is outside this component test'); },
        saveState: async value => {
            saved.push(value);
            if (holdSave?.buildId === value.view?.buildId) { holdSave.started(); await holdSave.pending; }
        } });
    const assets = new Set(['hardware.css', 'hardware-native.js', 'hardware-navigation.js', 'hardware-layout.js',
        'hardware-readability.js', 'hardware-analysis.js', 'hardware-inspector.js', 'hardware-view.js']);
    const server = http.createServer((request, response) => {
        const origin = `http://127.0.0.1:${server.address().port}`;
        if (request.url === '/') {
            const html = hardwareHtml({ cspSource: origin, asWebviewUri: uri => ({ toString: () => `${origin}/${path.basename(uri.fsPath)}` }) },
                { fsPath: root }, { Uri: { joinPath: (uri, ...parts) => ({ fsPath: path.join(uri.fsPath, ...parts) }) } }, build);
            response.writeHead(200, { 'Content-Type': 'text/html' }); response.end(html); return;
        }
        const name = request.url.slice(1);
        if (!assets.has(name)) { response.writeHead(404); response.end(); return; }
        response.writeHead(200, { 'Content-Type': name.endsWith('.css') ? 'text/css' : 'text/javascript' });
        response.end(fs.readFileSync(path.join(root, 'media', name)));
    });
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    const browser = await chromium.launch({ channel: 'chrome', headless: true });
    const context = await browser.newContext({ viewport: { width: 1100, height: 850 } });
    await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
    try {
        page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
        await page.exposeBinding('componentPostMessage', async (_context, message) => protocol.receive(message));
        await page.addInitScript(() => {
            window.componentPosts = [];
            window.acquireVsCodeApi = () => ({ postMessage: message => { window.componentPosts.push(message); return window.componentPostMessage(message); },
                setState: value => { window.componentSavedState = value; }, getState: () => window.componentSavedState });
        });
        await page.goto(`http://127.0.0.1:${server.address().port}`);
        await page.waitForFunction(() => window.BsvHardwareTransport?.identity());
        await page.locator('#native-empty [data-native-action="choose-artifact"]').click();
        await page.waitForFunction(() => {
            const state = window.bsvHardware?.getState(); return !state?.pending && (state?.current || state?.error);
        });
        if (await page.evaluate(() => !window.bsvHardware.getState().current)) {
            await page.locator('#build-select').selectOption(session.getCatalog().at(-1).buildId);
        }
        await page.waitForFunction(() => window.bsvHardware?.getState().current && !window.bsvHardware.getState().pending);
        await page.evaluate(async () => { await document.fonts.ready; await window.bsvHardware.whenSettled(); });
        const state = await page.evaluate(() => window.bsvHardware.getState());
        const check = async (name, action) => { try { await action(); checks.push({ name, status: 'PASS' }); }
            catch (error) { checks.push({ name, status: 'FAIL', message: error.message }); } };
        await check('ten-root native context loading respects unchanged request caps', async () => {
            const catalog = session.getCatalog(); assert.equal(catalog.length, 10);
            const responses = sent.filter(message => message.action === 'analysis-context');
            assert.equal(responses.length, 10); assert.ok(responses.every(message => message.status === 'ok'));
            assert.ok(peakContexts <= 2, `Observed ${peakContexts} concurrent contexts`);
            const pin = state.scene.contacts[0];
            await page.locator(`[data-semantic-id=${JSON.stringify(pin.id)}] .mark`).first().click();
            await page.waitForFunction(id => !window.bsvHardware.getState().pending && window.bsvHardware.getState().current.selectedEntityId === id, pin.id);
            await page.locator('[data-analysis-kind="same-net"]').first().click();
            await page.waitForFunction(() => window.bsvHardware.getState().current.analysis?.result.kind === 'same-net');
            const result = await page.evaluate(() => window.bsvHardware.getState().current.analysis.result);
            assert.equal(result.status, 'complete'); assert.deepEqual(result.seed.positions.map(position => position.index), [0, 1]);
        });
        await check('Back recommits an acknowledged visit while a different semantic commit awaits its metadata ACK', async () => {
            const acknowledged = await page.waitForFunction(() => {
                const value = window.bsvHardware.persistableState(), encoded = JSON.stringify(value);
                const post = window.componentPosts.findLast(message => message.action === 'persist' && JSON.stringify(message.payload.state) === encoded);
                return post && window.componentReplies.some(message => message.requestId === post.requestId && message.status === 'ok') && value;
            });
            const a = await acknowledged.jsonValue(), b = session.getCatalog().find(entry => entry.buildId !== a.view.buildId);
            let release, started;
            const entered = new Promise(resolve => { started = resolve; });
            holdSave = { buildId: b.buildId, started, pending: new Promise(resolve => { release = resolve; }) };
            try {
                await page.locator('#build-select').selectOption(b.buildId);
                await Promise.race([entered, delay(5000).then(() => { throw new Error('B metadata save did not start'); })]);
                assert.equal(session.getCurrent().buildId, b.buildId);
                const count = await page.evaluate(() => window.componentPosts.length);
                await page.locator('#back').click();
                await page.evaluate(() => window.bsvHardware.whenSettled());
                const after = await page.evaluate(() => window.bsvHardware.persistableState());
                publicationRace = { before: a, intermediateBuild: b.buildId, after,
                    hostAfterBack: session.getCurrent(), postsAfterBack: await page.evaluate(count => window.componentPosts.slice(count), count) };
                assert.deepEqual(after, a, 'Cached Back restored a different serialized visit');
                assert.ok(publicationRace.postsAfterBack.some(message => message.action === 'persist'
                    && JSON.stringify(message.payload.state) === JSON.stringify(a)), 'Back suppressed A because an older A ACK was cached');
                for (let i = 0; session.getCurrent().buildId !== a.view.buildId && i < 100; i++) await delay(10);
                assert.equal(session.getCurrent().buildId, a.view.buildId, 'Host still owns B after displayed Back A');
                release(); holdSave = null;
                await page.waitForFunction(expected => {
                    const post = window.componentPosts.findLast(message => message.action === 'persist' && JSON.stringify(message.payload.state) === expected);
                    return post && window.componentReplies.some(message => message.requestId === post.requestId && message.status === 'ok');
                }, JSON.stringify(a));
                assert.equal(saved.at(-1).view.buildId, a.view.buildId);
                assert.equal(session.getCurrent().buildId, a.view.buildId);
            } finally { release(); holdSave = null; }
        });
        await check('artifact-only saved state keeps null source context and roundtrips through the product resolver', async () => {
            const value = await page.evaluate(() => window.bsvHardware.persistableState());
            assert.equal(value.view.sourceContext, null); assert.equal(value.view.ownerInstanceId, null);
            const query = session.getInput().catalog.find(item => item.getCatalogEntry().buildId === value.view.buildId);
            const restored = query.getScene(intentFor(stateValue(value).view)).scene;
            assert.equal(restored.ownerInstanceId, null); assert.equal(restored.sourceContext, null);
            assert.equal(restored.shell.id, state.scene.shell.id);
            const persisted = await page.evaluate(value => {
                const revision = Math.max(0, ...window.componentPosts.filter(message => message.action === 'persist').map(message => message.payload.revision)) + 1;
                return window.BsvHardwareTransport.request('persist', { state: value, revision });
            }, value);
            assert.equal(persisted.status, 'saved'); assert.equal(saved.at(-1).view.sourceContext, null);
        });
        await check('native context labels distinguish missing BSV owner from actual RTL path', async () => {
            const caption = await page.locator('#readability-context').textContent();
            assert.match(caption, /BSV owner: Not attached \| RTL: Root9/);
            assert.equal(state.current.ownerInstanceId, null);
            assert.deepEqual(state.current.implementationContext.occurrencePath, ['Root9']);
        });
        await page.screenshot({ path: path.join(output, 'artifact-context.png') });
        fs.writeFileSync(path.join(output, 'state.json'), JSON.stringify(await page.evaluate(() => window.bsvHardware.getState()), null, 2) + '\n');
        fs.writeFileSync(path.join(output, 'component.json'), JSON.stringify({ scope: 'Browser component test; synthetic artifact, real importer/query/session/protocol/renderer; not installed VSIX acceptance',
            build, browser: browser.version(), viewport: { width: 1100, height: 850 }, contextDelayMs: 25, peakContexts,
            checks, errors, requests, publicationRace, responses: sent.filter(message => message.kind === 'response').map(({ action, status, error }) => ({ action, status, error })), diagnostics }, null, 2) + '\n');
        console.log(JSON.stringify({ output, checks, peakContexts, errors }, null, 2));
        assert.deepEqual(errors, []); assert.ok(checks.every(check => check.status === 'PASS'), 'Native view component regression failed');
    } catch (error) {
        if (page) {
            await page.screenshot({ path: path.join(output, 'failure.png') });
            fs.writeFileSync(path.join(output, 'failure.json'), JSON.stringify({ message: error.message, errors, requests,
                sent: sent.map(({ action, status, error }) => ({ action, status, error })), diagnostics,
                state: await page.evaluate(() => window.bsvHardware?.getState()),
                status: await page.locator('#native-input-status').textContent() }, null, 2) + '\n');
        }
        throw error;
    } finally {
        await protocol.dispose(); await session.dispose();
        await context.tracing.stop({ path: path.join(output, 'trace.zip') });
        await browser.close(); server.close(); await once(server, 'close');
    }
}
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { main };
