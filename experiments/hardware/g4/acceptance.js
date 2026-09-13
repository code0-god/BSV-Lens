'use strict';

// Optional browser lane. All scene data comes from the real product HTTP queries.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require('@playwright/test');
const { createServer } = require('./server');
const { createRunOutput } = require('./run-output');
const root = path.resolve(__dirname, '../../..');
const exactVisit = state => ({ current: state.current, scene: state.scene, geometry: state.geometry });
const deferred = () => Promise.withResolvers();
const timeout = (promise, label) => {
    let timer;
    return Promise.race([promise, new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Timed out: ${label}`)), 15000);
    })]).finally(() => clearTimeout(timer));
};

async function run() {
    const output = await createRunOutput(root, 'g4-acceptance');
    const receipt = { schema: 'g4-browser-acceptance-v1', output, journeys: [], screenshots: [], errors: [], status: 'running' };
    const server = await createServer();
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const browser = await chromium.launch({ channel: 'chrome', headless: process.env.G4_HEADED !== '1' });
    receipt.browser = browser.version();
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    page.on('pageerror', error => receipt.errors.push(error.message));
    const base = `http://127.0.0.1:${server.address().port}`;
    let state;

    async function signal() {
        await page.evaluate(() => {
            const revision = window.bsvHardware.getState().runtime.renderRevision;
            window.__acceptanceSignal = new Promise((resolve, reject) => {
                const settled = () => {
                    const state = window.bsvHardware.getState();
                    if (state.pending || state.transition || state.runtime.renderRevision <= revision) return;
                    window.removeEventListener('hardware:settled', settled);
                    window.removeEventListener('hardware:status', failed);
                    resolve(state);
                };
                const failed = event => {
                    if (!event.detail.error) return;
                    window.removeEventListener('hardware:settled', settled);
                    window.removeEventListener('hardware:status', failed);
                    reject(new Error(event.detail.error.message));
                };
                window.addEventListener('hardware:settled', settled);
                window.addEventListener('hardware:status', failed);
            });
        });
    }
    async function action(trigger) {
        await signal();
        await trigger();
        state = await timeout(page.evaluate(() => window.__acceptanceSignal), 'scene settled');
        assert.equal(state.error, null, state.error?.message);
        return state;
    }
    async function reset(buildId = 'A') {
        await page.setViewportSize({ width: 1440, height: 900 });
        await page.addInitScript(() => {
            window.__boot = new Promise(resolve => window.addEventListener('hardware:settled', resolve, { once: true }));
        });
        await page.goto(base);
        await timeout(page.evaluate(() => window.__boot), 'initial scene');
        state = await page.evaluate(() => window.bsvHardware.getState());
        if (buildId !== 'A') await action(() => page.locator('#build-select').selectOption(buildId));
        return state;
    }
    const object = id => page.locator(`[data-semantic-id=${JSON.stringify(id)}][data-active="true"]`);
    const child = name => state.scene.children.find(item => item.label === name);
    async function enter(name) {
        const item = child(name);
        assert.ok(item, `Missing child ${name}`);
        return action(() => object(item.id).locator('.body').click());
    }
    async function select(id, relation = false) {
        return action(() => object(id).locator(relation ? '.hit-route' : '.body, .mark').click());
    }
    async function stateStorage() {
        const storage = state.scene.storages.find(item => item.label === 'state');
        assert.ok(storage);
        await select(storage.id);
        return storage;
    }
    async function capture(name) {
        await page.mouse.move(1120, 830);
        const file = `${name}.png`;
        await page.screenshot({ path: path.join(output, file), animations: 'allow' });
        receipt.screenshots.push(file);
        return file;
    }
    async function record(id, expected = {}) {
        state = await page.evaluate(() => window.bsvHardware.getState());
        const { current, scene, geometry, runtime, history } = state;
        assert.equal(state.error, null, state.error?.message);
        assert.equal(state.pending, false);
        assert.equal(current.sceneKind, scene.sceneKind);
        assert.equal(current.ownerInstanceId, scene.ownerInstanceId);
        assert.equal(current.rootInstanceId, scene.rootInstanceId);
        assert.equal(current.provider, scene.implementationContext.provider);
        assert.equal(current.selectedEntityId, scene.selection.selectedEntityId);
        assert.equal(current.selectedRelationId, scene.selection.selectedRelationId);
        for (const [key, value] of Object.entries(expected)) assert.deepEqual(current[key], value, `${id} ${key}`);
        assert.ok(current.viewport.scale > 0 && Object.values(current.viewport).every(Number.isFinite));
        assert.ok(geometry.bounds.width > 0 && geometry.bounds.height > 0);
        assert.ok(runtime.shell.width > 0 && runtime.shell.height > 0);
        assert.ok(runtime.visibleSemanticIds.includes(scene.shell.id));
        for (const item of [...scene.children, ...scene.storages]) {
            const actual = runtime.objects.find(box => box.id === item.id);
            assert.ok(actual && actual.width > 0 && actual.height > 0, `${id} missing actual geometry ${item.id}`);
        }
        for (const frame of [...history.back, ...history.forward]) {
            assert.ok(frame.current.snapshotId && frame.current.viewport.scale > 0);
            assert.equal(frame.current.ownerInstanceId, frame.scene.ownerInstanceId);
        }
        assert.equal(scene.capabilities.completeOriginSets, false);
        assert.equal(scene.correspondence.origin.completeOriginSet, 'not-established');
        assert.ok(scene.correspondence.origin.claims.every(claim => claim.status === 'verified-known-contributor' && claim.completeOriginSet === false));
        assert.ok(scene.correspondence.stock.analysisId);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
        const screenshot = await capture(id);
        receipt.journeys.push({ id, status: 'pass', current, history: { back: history.back.map(frame => frame.current), forward: history.forward.map(frame => frame.current) },
            visibleSemanticIds: runtime.visibleSemanticIds, geometry: runtime, modelGeometry: geometry,
            correspondence: { stockResolution: scene.correspondence.stock.resolution, originStatus: scene.correspondence.origin.status,
                originClaims: scene.correspondence.origin.claims.map(claim => claim.id), completeOriginSet: scene.correspondence.origin.completeOriginSet,
                capabilities: scene.capabilities }, screenshot });
        console.log(`G4_JOURNEY_PASS ${id}`);
    }
    async function pan(dx, dy) {
        const box = await page.locator('#canvas').boundingBox();
        await page.mouse.move(box.x + 25, box.y + 25);
        await page.mouse.down();
        await page.mouse.move(box.x + 25 + dx, box.y + 25 + dy, { steps: 4 });
        await page.mouse.up();
        state = await page.evaluate(() => window.bsvHardware.getState());
    }
    async function holdOwner(owner) {
        const received = deferred(), release = deferred(), finished = deferred();
        const handler = async route => {
            const intent = JSON.parse(new URL(route.request().url()).searchParams.get('intent'));
            if (intent.ownerInstanceId !== owner) return route.continue();
            const response = await route.fetch();
            received.resolve();
            await release.promise;
            await route.fulfill({ response });
            finished.resolve();
        };
        await page.route('**/api/scene?*', handler);
        return { received, release, finished, close: () => page.unroute('**/api/scene?*', handler) };
    }
    try {
        await reset();
        receipt.overall = await capture('bsv-overall');
        const rootId = state.current.ownerInstanceId, leftId = child('left').id;
        const beforeContacts = state.scene.contacts.filter(contact => contact.ownerId === leftId).map(contact => contact.id);
        await page.evaluate(id => { window.__originalShell = document.querySelector(`[data-semantic-id=${JSON.stringify(id)}]`); }, leftId);
        const cdp = await page.context().newCDPSession(page);
        const frameWrites = [];
        const screencast = [];
        cdp.on('Page.screencastFrame', event => {
            const file = `transition-frame-${String(screencast.length).padStart(3, '0')}.png`;
            screencast.push({ file, metadata: event.metadata });
            frameWrites.push(fs.writeFile(path.join(output, file), Buffer.from(event.data, 'base64')));
            void cdp.send('Page.screencastFrameAck', { sessionId: event.sessionId });
        });
        await cdp.send('Page.startScreencast', { format: 'png', everyNthFrame: 1 });
        await enter('left');
        assert.equal(await page.evaluate(id => window.__originalShell === document.querySelector(`[data-semantic-id=${JSON.stringify(id)}]`), leftId), true);
        assert.deepEqual(state.scene.contacts.filter(contact => contact.ownerId === leftId).map(contact => contact.id), beforeContacts);
        await cdp.send('Page.stopScreencast');
        await Promise.all(frameWrites);
        receipt.transitionSequence = screencast;
        receipt.transitionGeometry = state.lastTransition;
        const expandedOrdinary = state.scene.id;
        const transition = state.lastTransition;
        assert.ok(transition.frames.length >= 3);
        assert.ok(transition.frames.some(frame => frame.progress >= 0.2 && frame.progress <= 0.35));
        assert.ok(transition.frames.some(frame => frame.progress >= 0.45 && frame.progress <= 0.6));
        assert.ok(transition.frames.some(frame => frame.progress >= 0.7 && frame.progress <= 0.85));
        const beforeShell = transition.before.objects.find(item => item.id === leftId);
        assert.ok(Math.abs(transition.frames[0].shell.width - beforeShell.width) < 3);
        for (let i = 1; i < transition.frames.length; i++) assert.ok(transition.frames[i].shell.width >= transition.frames[i - 1].shell.width - 1);
        for (const frame of transition.frames) {
            assert.ok(frame.shell.x >= 0 && frame.shell.y >= 0);
            assert.ok(frame.shell.x + frame.shell.width <= frame.canvas.width + 2);
            assert.ok(frame.shell.y + frame.shell.height <= frame.canvas.height + 2);
            assert.equal(frame.inspector.width, transition.before.inspector.width);
            for (const contact of frame.contacts.filter(item => state.scene.contacts.find(c => c.id === item.id)?.ownerId === leftId)) {
                const center = contact.x + contact.width / 2;
                assert.ok(Math.min(Math.abs(center - frame.shell.x), Math.abs(center - frame.shell.x - frame.shell.width)) < 3, 'Boundary contact left its shell');
            }
        }
        await record('J01', { sceneKind: 'bsv', ownerInstanceId: leftId, selectedEntityId: null });
        const storage = await stateStorage();
        assert.deepEqual(state.scene.storages[0].writers.map(item => item.label), ['put']);
        assert.deepEqual(state.scene.storages[0].readers.map(item => item.label), ['get']);
        assert.equal(state.scene.correspondence.origin.claims.length, 1);
        await record('J02', { selectedEntityId: storage.id });
        for (const name of ['put', 'get']) {
            const contact = state.scene.contacts.find(item => item.ownerId === leftId && item.label === name);
            await select(contact.id);
            assert.ok(state.scene.inspector.sections.some(section => section.id === 'contact'));
            if (name === 'get') {
                assert.ok(state.scene.correspondence.stock.claims.some(claim => claim.relationKind === 'ordered-port-binding'));
                await action(() => page.locator('button[data-entity-id="rtlSignals"]').click());
                assert.equal(state.current.disclosureState.rtlSignals, true);
                assert.ok(state.scene.contacts.find(item => item.id === contact.id).signalDetails.length > 0);
            }
        }
        await record('J03');
        const connection = state.scene.connections.find(item => item.members.some(member => member.kind === 'state-write'));
        await select(connection.id, true);
        assert.ok(state.scene.inspector.sourceRefs.some(ref => ref.text.includes('state <= value + 1')));
        await record('J04', { selectedRelationId: connection.id });
        await select(storage.id);
        await action(() => page.locator('#capability-panel summary').click());
        const exactBsv = exactVisit(state);
        await action(() => page.locator('#rtl').click());
        assert.equal(state.scene.implementationContext.provider, 'instrumented');
        const known = state.scene.implementationContext.highlightEntityIds[0];
        assert.ok(state.scene.children.some(item => item.id === known && item.type === '$dff'));
        await record('J05', { sceneKind: 'rtl', ownerInstanceId: leftId });
        await select(known);
        assert.equal(state.scene.correspondence.origin.claims.length, 1);
        await record('J06', { selectedEntityId: known });
        const unknown = state.scene.children.find(item => item.type === '$mux');
        assert.ok(unknown);
        await select(unknown.id);
        assert.equal(state.scene.correspondence.origin.claims.length, 0);
        assert.deepEqual(state.scene.implementationContext.highlightEntityIds, []);
        await record('J07', { selectedEntityId: unknown.id });
        await action(() => page.locator('#back').click());
        assert.deepEqual(exactVisit(state), exactBsv);
        await record('J08', { sceneKind: 'bsv', selectedEntityId: storage.id, ownerInstanceId: leftId });
        await action(() => page.locator('#back').click());
        await record('J09', { ownerInstanceId: rootId, selectedEntityId: null });
        await action(() => page.locator('#forward').click());
        assert.deepEqual(exactVisit(state), exactBsv);
        await record('J10', { ownerInstanceId: leftId, selectedEntityId: storage.id });
        await action(() => page.locator('#up').click());
        await record('J11', { ownerInstanceId: rootId });
        await enter('left');
        await action(() => page.locator(`#breadcrumb button[data-owner-id=${JSON.stringify(rootId)}]`).click());
        await record('J12', { ownerInstanceId: rootId });
        await action(() => object(rootId).locator('.title').click());
        const historyBefore = state.history.back.length;
        await object(rootId).locator('.title').click();
        await page.evaluate(() => window.bsvHardware.whenSettled());
        state = await page.evaluate(() => window.bsvHardware.getState());
        assert.equal(state.history.back.length, historyBefore);
        await record('J13');

        await reset('C');
        const wide = child('wide');
        const box = await object(wide.id).locator('.body').boundingBox();
        await action(() => page.mouse.click(box.x + box.width / 2, box.y + 22));
        await page.mouse.click(box.x + box.width / 2, box.y + 22, { clickCount: 2 });
        await page.evaluate(() => window.bsvHardware.whenSettled());
        await record('J14', { ownerInstanceId: wide.id });
        assert.equal(state.history.back.length, 2); // Build A -> C -> wide; double-click adds nothing.

        await reset();
        await pan(55, 28);
        const pannedRoot = state.current.viewport;
        await enter('left');
        await pan(35, 20);
        await action(() => page.locator('#back').click());
        assert.deepEqual(state.current.viewport, pannedRoot);
        await record('J15', { ownerInstanceId: rootId });

        await enter('left'); await stateStorage();
        const target = await object(storage.id).locator('.body').boundingBox();
        await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2);
        await action(() => page.mouse.wheel(0, -120));
        const zoomed = exactVisit(state);
        await action(() => page.locator('#rtl').click());
        await action(() => page.locator('#fit').click());
        await action(() => page.locator('#back').click());
        assert.deepEqual(exactVisit(state), zoomed);
        await record('J16', { sceneKind: 'bsv', selectedEntityId: storage.id });

        await reset();
        await page.evaluate(() => {
            window.__quarter = new Promise(resolve => {
                const frame = event => {
                    if (event.detail.progress < 0.2) return;
                    window.removeEventListener('hardware:transition-frame', frame);
                    resolve();
                };
                window.addEventListener('hardware:transition-frame', frame);
            });
        });
        await object(child('left').id).locator('.body').click();
        await timeout(page.evaluate(() => window.__quarter), 'resize transition frame');
        await page.setViewportSize({ width: 1280, height: 820 });
        await page.evaluate(() => window.bsvHardware.whenSettled());
        await record('J17', { ownerInstanceId: leftId });

        await reset();
        let held = await holdOwner(leftId);
        await object(leftId).locator('.body').click();
        await timeout(held.received.promise, 'held left scene');
        assert.equal((await page.evaluate(() => window.bsvHardware.getState())).pending, true);
        const rightId = child('right').id;
        await action(() => object(rightId).locator('.body').click());
        const rightFrame = exactVisit(state);
        held.release.resolve(); await timeout(held.finished.promise, 'released stale scene'); await held.close();
        assert.deepEqual(exactVisit(await page.evaluate(() => window.bsvHardware.getState())), rightFrame);
        await record('J18', { ownerInstanceId: rightId });
        await reset();
        held = await holdOwner(leftId);
        await object(leftId).locator('.body').click(); await timeout(held.received.promise, 'pending scene before Back');
        await page.locator('#back').click();
        held.release.resolve(); await timeout(held.finished.promise, 'cancelled scene release'); await held.close();
        await record('J19', { ownerInstanceId: rootId });

        await enter('left'); await stateStorage();
        for (const [id, theme] of [['J20', 'light'], ['J21', 'dark'], ['J22', 'high-contrast']]) {
            const before = exactVisit(state);
            await page.locator('#theme-select').selectOption(theme);
            assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), theme);
            assert.deepEqual(exactVisit(await page.evaluate(() => window.bsvHardware.getState())), before);
            await record(id, { ownerInstanceId: leftId });
        }
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await reset(); await enter('left');
        assert.equal(state.lastTransition.duration, 0);
        assert.equal(state.lastTransition.reducedMotion, true);
        assert.equal(state.scene.id, expandedOrdinary);
        await record('J23', { ownerInstanceId: leftId });
        await page.emulateMedia({ reducedMotion: 'no-preference' });

        await reset();
        await page.locator('#fit').focus();
        let reached = false;
        for (let i = 0; i < 30; i++) {
            await page.keyboard.press('Tab');
            if (await page.evaluate(id => document.activeElement?.getAttribute('data-semantic-id') === id, leftId)) { reached = true; break; }
        }
        assert.ok(reached, 'Tab must reach the child module');
        await action(() => page.keyboard.press('Enter'));
        assert.equal(state.current.ownerInstanceId, leftId);
        await object(storage.id).focus();
        await action(() => page.keyboard.press('Space'));
        assert.equal(state.current.selectedEntityId, storage.id);
        await action(() => page.keyboard.press('Escape'));
        assert.equal(state.current.selectedEntityId, null);
        await action(() => page.keyboard.press('Alt+ArrowLeft'));
        assert.equal(state.current.ownerInstanceId, rootId);
        receipt.keyboard = { status: 'pass', screenshot: await capture('keyboard-restored') };

        receipt.responsive = [];
        for (const width of [375, 768, 1280]) {
            await page.setViewportSize({ width, height: 900 });
            await page.evaluate(() => window.bsvHardware.whenSettled());
            await action(() => page.locator('#fit').click());
            assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
            const sample = await page.evaluate(() => window.bsvHardware.getState());
            assert.ok(sample.scene.children.every(item => sample.runtime.visibleSemanticIds.includes(item.id)));
            receipt.responsive.push({ width, runtime: sample.runtime, screenshot: await capture(`width-${width}`) });
        }

        await reset(); await enter('left');
        const resultContact = state.scene.contacts.find(item => item.label === 'get' && item.ownerId === leftId);
        await select(resultContact.id);
        await action(() => page.locator('#rtl').click());
        assert.equal(state.current.provider, 'stock');
        assert.equal(state.scene.correspondence.origin.claims.length, 0);
        assert.ok(state.scene.correspondence.stock.claims.some(claim => claim.relationKind === 'same-net-contact'));
        assert.equal(await page.locator('.hardware-object.contributor').count(), 0);
        receipt.stockConnectivity = { scene: state.scene, screenshot: await capture('A-stock-get-RTL') };
        await reset(); await enter('left'); await stateStorage();
        const rhs = state.scene.inspector.sections.flatMap(section => section.actions).find(item => item.label === 'value + 1');
        assert.ok(rhs);
        await action(() => page.locator(`button[data-entity-id=${JSON.stringify(rhs.id)}]`).click());
        assert.equal(state.scene.correspondence.origin.claims[0].source.kind, 'rhs-binary');
        await action(() => page.locator('#rtl').click());
        const rhsCell = state.scene.children.find(item => item.id === state.scene.implementationContext.highlightEntityIds[0]);
        assert.equal(rhsCell.type, '$add');
        receipt.rhs = { scene: state.scene, screenshot: await capture('A-RHS-RTL') };

        // Real B/C data acceptance supplements the navigation journeys.
        await reset('B');
        assert.equal(state.scene.correspondence.origin.coverage.knownContributorObjects, 0);
        const count = state.scene.storages.find(item => item.label === 'count');
        await select(count.id);
        assert.ok(state.scene.inspector.behaviorRefs.some(item => item.label === 'increment'));
        receipt.control = { scene: state.scene, screenshot: await capture('B-control') };
        receipt.inlined = [];
        for (const [name, width] of [['narrow', 8], ['wide', 12]]) {
            await reset('C'); await enter(name);
            assert.equal(state.scene.contacts.find(item => item.label === 'get' && item.ownerId === state.current.ownerInstanceId).result.type, `Bit#(${width})`);
            await enter('implementation'); await stateStorage();
            const inlineSource = state.current.ownerInstanceId;
            assert.equal(state.scene.implementationContext.implementationOccurrenceId, null);
            await action(() => page.locator('#rtl').click());
            assert.equal(state.current.ownerInstanceId, inlineSource);
            assert.deepEqual(state.scene.implementationContext.occurrencePath, ['mkReuse', name]);
            receipt.inlined.push({ scene: state.scene, screenshot: await capture(`C-${name}-inlined-RTL`) });
        }
        assert.deepEqual(receipt.errors, []);
        assert.equal(receipt.journeys.length, 23);
        receipt.status = 'pass';
        console.log(`G4_ACCEPTANCE_PASS journeys=23 output=${output}`);
    } catch (error) {
        receipt.status = 'fail'; receipt.failure = String(error.stack || error);
        receipt.lastState = await page.evaluate(() => window.bsvHardware?.getState()).catch(() => null);
        await capture('failure');
        console.error(receipt.failure);
        process.exitCode = 1;
    } finally {
        await fs.writeFile(path.join(output, 'acceptance.json'), `${JSON.stringify(receipt, null, 2)}\n`, { flag: 'wx' });
        await browser.close();
        await new Promise(resolve => server.close(resolve));
        console.log(`G4_ACCEPTANCE_RECEIPT ${path.join(output, 'acceptance.json')}`);
    }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
