'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const crypto = require('node:crypto');
const path = require('node:path');
const { chromium } = require('@playwright/test');
const { createServer } = require('../g4/server');
const { createRunOutput } = require('../g4/run-output');
const root = path.resolve(__dirname, '../../..');
const deferred = () => Promise.withResolvers();
const frame = state => ({ current: state.current, scene: state.scene, geometry: state.geometry });
function bounded(promise, name) {
    let timer;
    return Promise.race([promise, new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Timed out: ${name}`)), 15000);
    })]).finally(() => clearTimeout(timer));
}

async function run() {
    const output = await createRunOutput(root, 'g4-fix-browser');
    const runtimePaths = [...['architecture', 'scene', 'scene-query', 'scene-summary'].map(name => `src/hardware/${name}.js`),
        ...['view', 'navigation', 'layout', 'inspector'].map(name => `media/hardware-${name}.js`),
        'media/hardware.css', 'experiments/hardware/g4/index.html', 'experiments/hardware/g4/server.js'];
    const runtimeHashes = async () => Promise.all(runtimePaths.map(async name => ({ path: name,
        sha256: crypto.createHash('sha256').update(await fs.readFile(path.join(root, name))).digest('hex') })));
    const receipt = { schema: 'g4-fix-browser-v1', status: 'running', journeys: [], pageErrors: [], screenshots: [], output,
        runtimeInputs: await runtimeHashes(), environment: { node: process.version, platform: process.platform,
            arch: process.arch, playwright: require.resolve('@playwright/test') } };
    const server = await createServer();
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const browser = await chromium.launch({ channel: 'chrome', headless: process.env.G4_HEADED !== '1' });
    receipt.browser = browser.version();
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
    await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
    const page = await context.newPage();
    page.on('pageerror', error => receipt.pageErrors.push(error.message));
    const base = `http://127.0.0.1:${server.address().port}`;
    let state;
    const object = id => page.locator(`[data-semantic-id=${JSON.stringify(id)}][data-active="true"]`);
    async function waitAction(trigger, unchanged = false) {
        await page.evaluate(unchanged => {
            const before = window.bsvHardware.getState();
            window.__fixAction = new Promise((resolve, reject) => {
                const finish = () => {
                    const next = window.bsvHardware.getState();
                    if (next.error) { cleanup(); reject(new Error(next.error.message)); return; }
                    if (next.pending || next.transition) return;
                    if (unchanged ? next.queryGeneration <= before.queryGeneration : next.runtime.renderRevision <= before.runtime.renderRevision) return;
                    cleanup(); resolve(next);
                };
                const cleanup = () => {
                    window.removeEventListener('hardware:settled', finish);
                    window.removeEventListener('hardware:status', finish);
                };
                window.addEventListener('hardware:settled', finish);
                window.addEventListener('hardware:status', finish);
            });
        }, unchanged);
        await trigger();
        state = await bounded(page.evaluate(() => window.__fixAction), 'completed navigation/layout');
        return state;
    }
    async function reset(buildId = 'A') {
        await page.setViewportSize({ width: 1440, height: 900 });
        await page.addInitScript(() => { window.__fixBoot = new Promise(resolve => window.addEventListener('hardware:settled', resolve, { once: true })); });
        await page.goto(base);
        await bounded(page.evaluate(() => window.__fixBoot), 'initial scene');
        state = await page.evaluate(() => window.bsvHardware.getState());
        if (buildId !== 'A') await waitAction(() => page.locator('#build-select').selectOption(buildId));
        return state;
    }
    async function clickBody(id) {
        const body = object(id).locator('.body'), bounds = await body.boundingBox();
        return waitAction(() => body.click({ position: { x: bounds.width - 10, y: 12 } }));
    }
    async function enter(name) {
        const child = state.scene.children.find(item => item.label === name);
        assert.ok(child, `Missing child ${name}`);
        await clickBody(child.id);
        return child;
    }
    async function pan(dx, dy) {
        const canvas = await page.locator('#canvas').boundingBox();
        await page.mouse.move(canvas.x + 20, canvas.y + 20);
        await page.mouse.down();
        await page.mouse.move(canvas.x + 20 + dx, canvas.y + 20 + dy, { steps: 3 });
        await page.mouse.up();
        state = await page.evaluate(() => window.bsvHardware.getState());
    }
    async function screenshot(name) {
        const filename = `${name}.png`;
        await page.mouse.move(4, 4);
        await page.screenshot({ path: path.join(output, filename) });
        receipt.screenshots.push(filename);
        return filename;
    }
    async function record(id, expected = {}) {
        state = await page.evaluate(() => window.bsvHardware.getState());
        assert.equal(state.error, null);
        assert.equal(state.pending, false);
        assert.equal(state.current.sceneKind, state.scene.sceneKind);
        assert.equal(state.current.ownerInstanceId, state.scene.ownerInstanceId);
        assert.equal(state.current.snapshotId, state.scene.snapshotId);
        assert.equal(state.current.provider, state.scene.implementationContext.provider);
        assert.ok(Object.values(state.current.viewport).every(Number.isFinite));
        for (const [key, value] of Object.entries(expected)) assert.deepEqual(state.current[key], value, `${id}: ${key}`);
        if (state.current.sceneKind === 'rtl') {
            assert.equal(state.scene.shell.id, state.current.implementationContext.contextOccurrenceId);
            assert.deepEqual(state.scene.header.implementationOccurrencePath, state.current.implementationContext.occurrencePath);
            assert.equal(state.scene.header.stage, state.current.implementationContext.stage);
        }
        const dom = await page.evaluate(() => {
            const state = window.bsvHardware.getState();
            return { paths: [...document.querySelectorAll('.connection[data-active="true"]')].map(group => ({
                id: group.dataset.semanticId, d: group.querySelector('.route').getAttribute('d'),
                bits: JSON.parse(group.dataset.canonicalBits) })),
            labels: state.runtime.labels, slots: state.runtime.slots,
            overflow: document.documentElement.scrollWidth > innerWidth,
            implementationPath: document.getElementById('scene-path').textContent };
        });
        assert.equal(dom.overflow, false);
        assert.equal(dom.paths.length, state.geometry.routes.length);
        for (const actual of dom.paths) {
            const route = state.geometry.routes.find(item => item.id === actual.id);
            const connection = state.scene.connections.find(item => item.id === actual.id);
            assert.equal(actual.d, route.path);
            assert.deepEqual(actual.bits, connection.bits || []);
        }
        assert.equal(state.scene.capabilities.completeOriginSets, false);
        assert.deepEqual(receipt.pageErrors, []);
        assert.deepEqual(await runtimeHashes(), receipt.runtimeInputs, 'Product runtime changed during browser evidence capture');
        receipt.journeys.push({ id, status: 'PASS', current: state.current, shellId: state.scene.shell.id,
            history: { back: state.history.back.map(item => item.current), forward: state.history.forward.map(item => item.current) },
            geometry: state.geometry, runtime: state.runtime, dom,
            inspector: state.scene.inspector, screenshot: await screenshot(id) });
        console.log(`G4_FIX_BROWSER_PASS ${id}`);
    }
    async function holdChild(id) {
        const seen = deferred(), release = deferred(), finished = deferred();
        const handler = async route => {
            const intent = JSON.parse(new URL(route.request().url()).searchParams.get('intent'));
            if (intent.implementationContext?.contextOccurrenceId !== id) return route.continue();
            const response = await route.fetch();
            seen.resolve();
            await release.promise;
            await route.fulfill({ response });
            finished.resolve();
        };
        await page.route('**/api/scene?*', handler);
        return { seen, release, finished, close: () => page.unroute('**/api/scene?*', handler) };
    }
    async function uniqueWirePoint(id) {
        return page.evaluate(id => {
            const state = window.bsvHardware.getState(), canvas = document.getElementById('canvas').getBoundingClientRect();
            const routes = state.geometry.routes.map(route => {
                const group = document.querySelector(`[data-semantic-id=${JSON.stringify(route.id)}]`);
                const matrix = group.getScreenCTM();
                return { id: route.id, segments: route.segments.map(([x1, y1, x2, y2]) => {
                    const a = new DOMPoint(x1, y1).matrixTransform(matrix), b = new DOMPoint(x2, y2).matrixTransform(matrix);
                    return [a.x, a.y, b.x, b.y];
                }) };
            });
            const obstacles = [...document.querySelectorAll('[data-label-id], .contact .mark, .hardware-object:not(.expanded) .body')]
                .filter(element => getComputedStyle(element).visibility !== 'hidden').map(element => element.getBoundingClientRect());
            const target = routes.find(route => route.id === id);
            for (const segment of [...target.segments].sort((a, b) =>
                Math.hypot(b[2] - b[0], b[3] - b[1]) - Math.hypot(a[2] - a[0], a[3] - a[1]))) {
                if (Math.hypot(segment[2] - segment[0], segment[3] - segment[1]) < 16) continue;
                for (const t of [0.5, 0.3, 0.7, 0.15, 0.85]) {
                    const point = { x: segment[0] + t * (segment[2] - segment[0]), y: segment[1] + t * (segment[3] - segment[1]) };
                    if (point.x < canvas.left + 8 || point.x > canvas.right - 8 || point.y < canvas.top + 8 || point.y > canvas.bottom - 8) continue;
                    if (obstacles.some(box => point.x >= box.left - 3 && point.x <= box.right + 3 && point.y >= box.top - 3 && point.y <= box.bottom + 3)) continue;
                    const nearOther = routes.filter(route => route.id !== id).some(route => route.segments.some(([x1, y1, x2, y2]) => {
                        const dx = x2 - x1, dy = y2 - y1, len = dx * dx + dy * dy;
                        const u = len ? Math.max(0, Math.min(1, ((point.x - x1) * dx + (point.y - y1) * dy) / len)) : 0;
                        return Math.hypot(point.x - x1 - u * dx, point.y - y1 - u * dy) < 4;
                    }));
                    if (!nearOther) return point;
                }
            }
            return null;
        }, id);
    }
    try {
        await reset();
        const bsvOwner = state.current.ownerInstanceId;
        await waitAction(() => page.locator('#rtl').click());
        const rtlRoot = state.scene.shell.id, rootFrame = frame(state);
        const left = state.scene.children.find(item => item.label === 'left');
        const right = state.scene.children.find(item => item.label === 'right');
        await clickBody(left.id);
        assert.equal(state.current.implementationContext.contextOccurrenceId, left.id);
        await record('B01', { sceneKind: 'rtl', ownerInstanceId: bsvOwner });
        const cell = state.scene.children.find(item => item.type === '$dff');
        await clickBody(cell.id); await pan(20, 12);
        const savedLeft = frame(state);
        await waitAction(() => page.locator('#back').click());
        assert.deepEqual(frame(state), rootFrame);
        await waitAction(() => page.locator('#forward').click());
        assert.deepEqual(frame(state), savedLeft);
        await record('B02');
        await waitAction(() => page.locator('#up').click());
        await clickBody(right.id);
        assert.equal(state.current.implementationContext.contextOccurrenceId, right.id);
        assert.notEqual(state.scene.shell.id, left.id);
        await record('B03', { ownerInstanceId: bsvOwner });
        await waitAction(() => page.locator('#up').click());
        assert.equal(state.scene.shell.id, rtlRoot);
        const rootBeforeUp = frame(state), rootHistory = state.history.back.length;
        await page.evaluate(() => {
            window.__rootUp = new Promise(resolve => {
                const listener = event => {
                    if (event.detail.outcome?.code !== 'RTL_ROOT') return;
                    window.removeEventListener('hardware:status', listener);
                    resolve(window.bsvHardware.getState());
                };
                window.addEventListener('hardware:status', listener);
            });
        });
        await page.locator('#up').click();
        state = await bounded(page.evaluate(() => window.__rootUp), 'explicit RTL-root Up outcome');
        assert.equal(state.outcome.status, 'blocked');
        assert.equal(state.history.back.length, rootHistory);
        assert.deepEqual(frame(state), rootBeforeUp);
        await record('B04', { sceneKind: 'rtl', ownerInstanceId: bsvOwner });
        await clickBody(left.id);
        await waitAction(() => page.locator(`#breadcrumb button[data-owner-id=${JSON.stringify(rtlRoot)}]`).click());
        assert.equal(state.scene.shell.id, rtlRoot);
        await record('B05', { sceneKind: 'rtl' });
        await clickBody(left.id);
        const repeated = frame(state), historyLength = state.history.back.length;
        await waitAction(() => page.locator('#breadcrumb [aria-current="location"]').click(), true);
        assert.deepEqual(frame(state), repeated);
        assert.equal(state.history.back.length, historyLength);
        assert.equal(state.outcome.status, 'unchanged');
        await record('B06');
        await waitAction(() => page.locator('#up').click());
        const leftBox = await object(left.id).locator('.body').boundingBox();
        await waitAction(() => page.mouse.click(leftBox.x + leftBox.width - 10, leftBox.y + 12));
        const single = frame(state), singleHistory = state.history.back.length;
        await page.mouse.move(leftBox.x + leftBox.width - 10, leftBox.y + 12);
        await page.mouse.down({ clickCount: 2 });
        await page.mouse.up({ clickCount: 2 });
        await page.evaluate(() => window.bsvHardware.whenSettled());
        state = await page.evaluate(() => window.bsvHardware.getState());
        assert.deepEqual(frame(state), single);
        assert.equal(state.history.back.length, singleHistory);
        await record('B07');
        await waitAction(() => page.locator('#up').click());
        const held = await holdChild(left.id);
        const body = object(left.id).locator('.body'), box = await body.boundingBox();
        await body.click({ position: { x: box.width - 10, y: 12 } });
        await bounded(held.seen.promise, 'held left query');
        await clickBody(right.id);
        await waitAction(() => page.locator('#back').click());
        const afterBack = frame(state);
        held.release.resolve(); await bounded(held.finished.promise, 'stale query released'); await held.close();
        assert.deepEqual(frame(await page.evaluate(() => window.bsvHardware.getState())), afterBack);
        await record('B08', { sceneKind: 'rtl' });

        await reset(); await enter('left');
        const stateId = state.scene.storages.find(item => item.label === 'state').id;
        await clickBody(stateId);
        await waitAction(() => page.locator('#rtl').click());
        assert.equal(state.current.provider, 'instrumented');
        const identities = [[2], [30,31,32,33,34,35,36,37], [12], [4,5,6,7,8,9,10,11], [21,22,23,24,25,26,27,28], [3], [29]];
        receipt.wireSelections = [];
        for (const bits of identities) {
            const connection = state.scene.connections.find(item => JSON.stringify(item.rawBits) === JSON.stringify(bits));
            assert.ok(connection, `Missing actual vector ${bits}`);
            const point = await uniqueWirePoint(connection.id);
            assert.ok(point, `No visible unambiguous segment for ${connection.label}`);
            const geometry = state.geometry, history = state.history.back.length;
            await waitAction(() => page.mouse.click(point.x, point.y));
            assert.equal(state.current.selectedRelationId, connection.id);
            assert.equal(state.scene.inspector.connectivity.id, connection.id);
            assert.deepEqual(state.scene.inspector.connectivity.bits, connection.bits);
            assert.deepEqual(state.scene.inspector.connectivity.rawBits, bits);
            assert.deepEqual(state.geometry, geometry);
            assert.equal(state.history.back.length, history);
            receipt.wireSelections.push({ id: connection.id, bits, canonicalBits: connection.bits, point,
                inspector: state.scene.inspector.connectivity, screenshot: await screenshot(`wire-${bits[0]}`) });
        }
        await record('B09');
        const crossing = state.geometry.crossings[0];
        assert.ok(crossing);
        const crossingPoint = await page.evaluate(point => {
            const matrix = document.getElementById('world').getScreenCTM();
            const result = new DOMPoint(point.x, point.y).matrixTransform(matrix);
            return { x: result.x, y: result.y };
        }, crossing);
        await page.mouse.click(crossingPoint.x, crossingPoint.y);
        await page.locator('#wire-choices').waitFor({ state: 'visible' });
        const choices = await page.locator('#wire-choices button').evaluateAll(buttons => buttons.map(button => button.dataset.connectionId));
        assert.deepEqual([...choices].sort(), [...crossing.connectionIds].sort());
        receipt.crossing = { crossing, point: crossingPoint, choices, screenshot: await screenshot('crossing-candidates') };
        await waitAction(() => page.locator(`#wire-choices button[data-connection-id=${JSON.stringify(choices[0])}]`).click());
        assert.equal(state.current.selectedRelationId, choices[0]);
        const fanout = state.geometry.routes.find(route => route.junctions.length);
        assert.ok(fanout);
        const junctionPoint = await page.evaluate(point => {
            const result = new DOMPoint(point.x, point.y).matrixTransform(document.getElementById('world').getScreenCTM());
            return { x: result.x, y: result.y };
        }, fanout.junctions[0]);
        await waitAction(() => page.mouse.click(junctionPoint.x, junctionPoint.y));
        assert.equal(state.current.selectedRelationId, fanout.id);
        await record('B10');

        const downloadPromise = page.waitForEvent('download');
        const beforeExport = frame(state);
        await page.locator('#export-svg').click();
        const download = await downloadPromise;
        const svgFile = path.join(output, 'actual-export.svg');
        await download.saveAs(svgFile);
        const exported = await page.evaluate(text => {
            const document = new DOMParser().parseFromString(text, 'image/svg+xml');
            return { metadata: JSON.parse(document.querySelector('metadata').textContent),
                viewBox: document.documentElement.getAttribute('viewBox'),
                worldTransform: document.querySelector('#world').getAttribute('transform'),
                paths: [...document.querySelectorAll('.connection[data-active="true"]')].map(group =>
                    ({ id: group.dataset.semanticId, d: group.querySelector('.route').getAttribute('d') })) };
        }, await fs.readFile(svgFile, 'utf8'));
        assert.equal(exported.metadata.snapshotId, state.current.snapshotId);
        assert.equal(exported.worldTransform, null);
        assert.deepEqual(exported.metadata.bounds, state.geometry.bounds);
        for (const vector of exported.metadata.connections) {
            const original = state.scene.connections.find(item => item.id === vector.id);
            assert.deepEqual(vector.bits, original.bits);
            assert.deepEqual(vector.rawBits, original.rawBits);
        }
        assert.deepEqual(frame(await page.evaluate(() => window.bsvHardware.getState())), beforeExport);
        receipt.export = { status: 'PASS', file: 'actual-export.svg', ...exported };

        await reset(); await enter('left'); await clickBody(stateId); await pan(25, 16);
        await waitAction(() => page.locator('#capability-panel summary').click());
        const bsvState = frame(state);
        await waitAction(() => page.locator('#rtl').click());
        const contributor = state.scene.implementationContext.highlightEntityIds[0];
        await clickBody(contributor);
        await pan(18, 12);
        await waitAction(() => page.locator('#fit').click());
        await waitAction(() => page.locator('#back').click());
        assert.deepEqual(frame(state), bsvState);
        const rhs = state.scene.inspector.sections.flatMap(section => section.actions).find(action => action.label === 'value + 1');
        assert.ok(rhs);
        await waitAction(() => page.locator(`button[data-entity-id=${JSON.stringify(rhs.id)}]`).click());
        const bsvRhs = frame(state);
        await waitAction(() => page.locator('#rtl').click());
        assert.equal(state.scene.children.find(child => child.id === state.scene.implementationContext.highlightEntityIds[0]).type, '$add');
        await pan(18, 12);
        await waitAction(() => page.locator('#fit').click());
        await waitAction(() => page.locator('#back').click());
        assert.deepEqual(frame(state), bsvRhs);
        await record('B11', { sceneKind: 'bsv', selectedEntityId: rhs.id });

        await reset();
        await page.locator('#fit').focus();
        let reached = false;
        for (let count = 0; count < 40; count++) {
            await page.keyboard.press('Tab');
            const active = await page.evaluate(() => document.activeElement?.getAttribute('data-semantic-id'));
            if (active === state.scene.children.find(child => child.label === 'left').id) { reached = true; break; }
        }
        assert.ok(reached);
        await waitAction(() => page.keyboard.press('Enter'));
        await object(stateId).focus();
        await waitAction(() => page.keyboard.press('Space'));
        assert.equal(state.current.selectedEntityId, stateId);
        await waitAction(() => page.keyboard.press('Escape'));
        assert.equal(state.current.selectedEntityId, null);
        await waitAction(() => page.keyboard.press('Alt+ArrowLeft'));
        assert.equal(state.current.ownerInstanceId, bsvOwner);
        receipt.keyboard = { status: 'PASS', screenshot: await screenshot('keyboard') };

        await waitAction(() => page.locator('#rtl').click()); await clickBody(left.id);
        const canonical = state.scene.connections.map(connection => ({ id: connection.id, bits: connection.bits, rawBits: connection.rawBits }));
        receipt.variants = [];
        for (const [width, theme, motion] of [[1440, 'dark', 'no-preference'], [960, 'light', 'no-preference'], [420, 'high-contrast', 'reduce']]) {
            await page.emulateMedia({ reducedMotion: motion });
            await page.setViewportSize({ width, height: 900 });
            await page.evaluate(() => window.bsvHardware.whenSettled());
            await page.locator('#theme-select').selectOption(theme);
            if (motion === 'reduce') {
                await waitAction(() => page.locator('#up').click());
                await clickBody(left.id);
                assert.equal(state.lastTransition.duration, 0);
            }
            await pan(12, 8);
            await waitAction(() => page.locator('#fit').click());
            assert.deepEqual(state.scene.connections.map(connection => ({ id: connection.id, bits: connection.bits, rawBits: connection.rawBits })), canonical);
            assert.equal(state.scene.shell.id, left.id);
            receipt.variants.push({ width, theme, motion, current: state.current, geometry: state.geometry,
                screenshot: await screenshot(`variant-${width}-${theme}`) });
        }
        await record('B12', { sceneKind: 'rtl', ownerInstanceId: bsvOwner });
        receipt.abc = [];
        await page.emulateMedia({ reducedMotion: 'no-preference' });
        for (const buildId of ['A', 'B', 'C']) {
            await reset(buildId);
            receipt.abc.push({ buildId, scene: state.scene, geometry: state.geometry, screenshot: await screenshot(`${buildId}-BSV`) });
            await waitAction(() => page.locator('#rtl').click());
            receipt.abc.push({ buildId, scene: state.scene, geometry: state.geometry, screenshot: await screenshot(`${buildId}-RTL`) });
        }
        assert.deepEqual(receipt.pageErrors, []);
        assert.equal(receipt.journeys.length, 12);
        receipt.status = 'PASS';
        console.log(`G4_FIX_BROWSER_COMPLETE ${output}`);
    } catch (error) {
        receipt.status = String(error).includes('ERR_BLOCKED_BY_ADMINISTRATOR') ? 'BLOCKED' : 'FAIL';
        receipt.error = String(error.stack || error);
        receipt.lastState = await page.evaluate(() => window.bsvHardware?.getState()).catch(() => null);
        await screenshot('failure');
        console.error(receipt.error);
        process.exitCode = 1;
    } finally {
        await context.tracing.stop({ path: path.join(output, 'trace.zip') });
        await fs.writeFile(path.join(output, 'browser.json'), `${JSON.stringify(receipt, null, 2)}\n`, { flag: 'wx' });
        await browser.close();
        await new Promise(resolve => server.close(resolve));
        console.log(`G4_FIX_BROWSER_RECEIPT ${path.join(output, 'browser.json')}`);
    }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
