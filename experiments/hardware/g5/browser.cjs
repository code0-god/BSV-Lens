'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const crypto = require('node:crypto');
const path = require('node:path');
const { chromium } = require('@playwright/test');
const { createServer } = require('../g4/server');
const { createRun } = require('./run.cjs');
const { loadCorpus } = require('../g4-fix/geometry-check.cjs');
const { validateGeometry, validateMembership } = require('../g4-fix/oracle/geometry.cjs');
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
    const output = path.join(await createRun('browser'), 'browser');
    await fs.mkdir(output);
    const { authority } = await loadCorpus();
    const runtimePaths = [...['architecture', 'scene', 'scene-query', 'scene-summary'].map(name => `src/hardware/${name}.js`),
        ...(await fs.readdir(path.join(root, 'src/hardware/analysis'))).map(name => `src/hardware/analysis/${name}`),
        ...['view', 'navigation', 'layout', 'inspector', 'analysis'].map(name => `media/hardware-${name}.js`),
        'media/hardware.css', 'experiments/hardware/g4/index.html', 'experiments/hardware/g4/server.js'];
    const runtimeHashes = async () => Promise.all(runtimePaths.map(async name => ({ path: name,
        sha256: crypto.createHash('sha256').update(await fs.readFile(path.join(root, name))).digest('hex') })));
    const receipt = { schema: 'g5-browser-v1', status: 'running', journeys: [], pageErrors: [], screenshots: [], output,
        runtimeInputs: await runtimeHashes(), environment: { node: process.version, platform: process.platform,
            arch: process.arch, playwright: require.resolve('@playwright/test') } };
    const server = await createServer();
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const browser = await chromium.launch({ channel: 'chrome', headless: process.env.G4_HEADED !== '1' });
    receipt.browser = browser.version();
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
    await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
    const page = await context.newPage();
    page.setDefaultTimeout(12000);
    receipt.latencies = [];
    page.on('pageerror', error => receipt.pageErrors.push(error.message));
    const base = `http://127.0.0.1:${server.address().port}`;
    let state;
    const object = id => page.locator(`[data-semantic-id=${JSON.stringify(id)}][data-active="true"]`);
    async function waitAction(trigger, unchanged = false, expectedAnalysis = null) {
        const started = performance.now();
        await page.evaluate(([unchanged, expectedAnalysis]) => {
            const before = window.bsvHardware.getState();
            window.__fixAction = new Promise((resolve, reject) => {
                const finish = () => {
                    const next = window.bsvHardware.getState();
                    if (next.error) { cleanup(); reject(new Error(next.error.message)); return; }
                    if (next.pending || next.transition) return;
                    if (expectedAnalysis) {
                        const analysis = next.current.analysis;
                        if (!analysis || analysis.result.kind !== expectedAnalysis.kind
                            || expectedAnalysis.direction && analysis.result.direction !== expectedAnalysis.direction
                            || analysis.request.queryGeneration !== next.queryGeneration && next.outcome.status !== 'unchanged') return;
                    }
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
        }, [unchanged, expectedAnalysis]);
        await trigger();
        state = await bounded(page.evaluate(() => window.__fixAction), 'completed navigation/layout');
        receipt.latencies.push({ kind: state.current.analysis?.result.kind || state.current.sceneKind, milliseconds: performance.now() - started });
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
            const source = document.querySelector('#code-drawer pre[data-source-reference-id]');
            const record = document.querySelector('#code-drawer [data-code-record-id]');
            return { paths: [...document.querySelectorAll('.connection[data-active="true"]')].map(group => ({
                id: group.dataset.semanticId, d: group.querySelector('.route').getAttribute('d'),
                bits: JSON.parse(group.dataset.canonicalBits) })),
            labels: state.runtime.labels, slots: state.runtime.slots,
            sourceBeforeRecords: !source || !record || !!(source.compareDocumentPosition(record) & Node.DOCUMENT_POSITION_FOLLOWING),
            overflow: document.documentElement.scrollWidth > innerWidth,
            implementationPath: document.getElementById('scene-path').textContent };
        });
        assert.equal(dom.overflow, false);
        assert.equal(dom.sourceBeforeRecords, true);
        assert.equal(dom.paths.length, state.geometry.routes.length);
        for (const actual of dom.paths) {
            const route = state.geometry.routes.find(item => item.id === actual.id);
            const connection = state.scene.connections.find(item => item.id === actual.id);
            assert.equal(actual.d, route.path);
            assert.deepEqual(actual.bits, connection.bits || []);
        }
        const facts = authority.get(state.current.buildId);
        const geometry = validateGeometry(state.scene, state.geometry);
        const membership = validateMembership(state.scene, { model: facts.models[state.current.provider], architecture: facts.architecture });
        assert.deepEqual(geometry.findings, []); assert.deepEqual(membership.findings, []);
        const result = state.current.analysis?.result;
        if (result) {
            assert.equal(result.context.snapshotId, state.current.snapshotId);
            assert.equal(result.context.implementationProvider, state.current.provider);
            assert.equal(result.kind, state.current.analysis.request.kind);
            for (const source of await page.locator('pre[data-source-reference-id]').evaluateAll(elements => elements.map(e => ({id:e.dataset.sourceReferenceId,text:e.textContent,start:Number(e.dataset.rangeStart),end:Number(e.dataset.rangeEnd)})))) {
                const ref = result.sourceRefs.find(r => r.id === source.id);
                assert.ok(ref); assert.equal(source.text, ref.range.text);
                assert.equal(source.start, ref.range.start); assert.equal(source.end, ref.range.end);
            }
        }
        assert.equal(state.scene.capabilities.completeOriginSets, false);
        assert.deepEqual(receipt.pageErrors, []);
        assert.deepEqual(await runtimeHashes(), receipt.runtimeInputs, 'Product runtime changed during browser evidence capture');
        receipt.journeys.push({ id, status: 'pass', scene: state.scene, current: state.current, shellId: state.scene.shell.id,
            history: { back: state.history.back.map(item => item.current), forward: state.history.forward.map(item => item.current) },
            geometry: state.geometry, runtime: state.runtime, dom,
            inspector: state.scene.inspector, screenshot: await screenshot(id) });
        console.log(`G5_BROWSER_PASS ${id}`);
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

    const analysis = (kind, direction) => page.locator('[data-analysis-kind=' + JSON.stringify(kind) + ']' +
        (direction ? '[data-analysis-direction=' + JSON.stringify(direction) + ']' : '')).first();
    async function analyze(kind, direction) {
        // An input blur can repaint the Inspector before this click starts its
        // query. Only a new settled query generation is analysis completion.
        await waitAction(() => analysis(kind, direction).click(), true, { kind, direction });
        assert.equal(state.current.analysis.result.kind, kind);
        if (direction) assert.equal(state.current.analysis.result.direction, direction);
        return state.current.analysis.result;
    }
    async function contact(label) {
        const target = state.scene.contacts.find(c => c.ownerId === state.scene.shell.id && c.label === label);
        assert.ok(target, 'Missing contact ' + label);
        await waitAction(() => object(target.id).locator('.mark').click());
        return target;
    }
    async function pin(cell, name) {
        await clickBody(cell.id);
        const target = state.scene.contacts.find(c => c.ownerId === cell.id && c.label === name);
        assert.ok(target, 'Missing pin ' + name);
        const choice = page.locator('[data-analysis-pin-id=' + JSON.stringify(target.id) + ']');
        if (await choice.count()) await choice.click();
        state = await page.evaluate(() => window.bsvHardware.getState());
        return target;
    }
    async function openSource(ref) {
        const seen = deferred(), release = deferred(), finished = deferred();
        const handler = async route => {
            const response = await route.fetch();
            seen.resolve();
            await release.promise;
            await route.fulfill({ response });
            finished.resolve();
        };
        await page.route('**/api/source?*', handler);
        await page.evaluate(id => {
            window.__sourceDone = new Promise((resolve, reject) => {
                const listener = event => {
                    if (event.detail.referenceId !== id || event.detail.status === 'pending') return;
                    window.removeEventListener('hardware:source', listener);
                    event.detail.status === 'complete' ? resolve() : reject(new Error(event.detail.error || event.detail.status));
                };
                window.addEventListener('hardware:source', listener);
            });
        }, ref.id);
        await page.locator('[data-analysis-source-id=' + JSON.stringify(ref.id) + ']').first().click();
        await bounded(seen.promise, 'source response barrier');
        const before = await page.evaluate(() => window.bsvHardware.getState().queryGeneration);
        await page.locator('[data-analysis-disclosure-id$=":selected-record"] > summary').click();
        const after = await page.evaluate(() => window.bsvHardware.getState().queryGeneration);
        assert.ok(after > before, 'The regression must include a real Inspector patch');
        release.resolve();
        await bounded(finished.promise, 'released source response');
        await page.unroute('**/api/source?*', handler);
        await bounded(page.evaluate(() => window.__sourceDone), 'approved source');
        state = await page.evaluate(() => window.bsvHardware.getState());
        assert.equal(state.current.disclosureState.analysis.source.result.text, ref.range.text);
        assert.equal(state.current.disclosureState.analysis.source.result.readOnly, true);
        receipt.sourceDisclosureRegression = { referenceId: ref.id, before, after, status: 'pass' };
    }
    async function holdAnalysis() {
        const seen = deferred(), release = deferred(), finished = deferred();
        let held = false;
        const handler = async route => {
            if (held) return route.continue();
            held = true;
            const response = await route.fetch();
            seen.resolve();
            await release.promise;
            await route.fulfill({ response });
            finished.resolve();
        };
        await page.route('**/api/analysis?*', handler);
        return { seen, release, finished, close: () => page.unroute('**/api/analysis?*', handler) };
    }

    try {
        await reset(); await enter('left'); await contact('get');
        const owner = state.current.ownerInstanceId;
        assert.ok(state.scene.contacts.find(c => c.id === state.current.selectedEntityId).result);
        await record('J01');
        await waitAction(() => page.locator('[data-analysis-signal-id]').filter({ hasText: '/ result [8]' }).click());
        let result = await analyze('same-net');
        assert.deepEqual(result.seed.positions.map(p => p.index), [0,1,2,3,4,5,6,7]);
        assert.ok(result.groups.every(g => g.boundaryIds.length && g.drivers.length === 1 && g.loads.length));
        receipt.orderedGet = result;
        result = await analyze('drivers-loads');
        assert.ok(result.groups.every(g => g.boundaryContacts.length));
        await record('J02');

        await reset(); await waitAction(() => page.locator('#rtl').click());
        const rootFrame = frame(state), rtlRoot = state.scene.shell.id;
        const left = state.scene.children.find(c => c.label === 'left'), right = state.scene.children.find(c => c.label === 'right');
        await clickBody(left.id); const leftFrame = frame(state);
        await waitAction(() => page.locator('#back').click()); assert.deepEqual(frame(state), rootFrame);
        await waitAction(() => page.locator('#forward').click()); assert.deepEqual(frame(state), leftFrame);
        await waitAction(() => page.locator('#up').click()); assert.equal(state.scene.shell.id, rtlRoot);
        await clickBody(right.id); assert.equal(state.scene.shell.id, right.id); assert.notEqual(right.id, left.id);
        await waitAction(() => page.locator('#up').click()); await clickBody(left.id);
        await record('J03');
        let selectedWire;
        for (const wire of state.scene.connections.filter(c => c.bits.length > 2)) {
            const point = await uniqueWirePoint(wire.id);
            if (!point) continue;
            await waitAction(() => page.mouse.click(point.x, point.y));
            assert.equal(state.current.selectedRelationId, wire.id);
            assert.equal(state.scene.inspector.connectivity.id, wire.id);
            assert.deepEqual(state.scene.inspector.connectivity.bits, wire.bits);
            selectedWire = wire; break;
        }
        assert.ok(selectedWire, 'Visible independently hit-tested vector required');
        await record('J04');
        await page.locator('.analysis-controls label').filter({ hasText: /^Positions/ }).locator('select').selectOption('indices');
        await page.getByLabel('Zero-based positions (order and repeats kept)', { exact: true }).fill('0, 2, 1, 2');
        result = await analyze('same-net');
        assert.deepEqual(result.seed.positions.map(p => p.bitId), [0,2,1,2].map(i => selectedWire.bits[i]));
        receipt.orderedSelection = result;
        await page.locator('.analysis-controls label').filter({ hasText: /^Positions/ }).locator('select').selectOption('slice');
        await page.getByLabel('Start position', { exact: true }).fill('1');
        await page.getByLabel('End position (exclusive)', { exact: true }).fill('3');
        result = await analyze('same-net'); assert.deepEqual(result.seed.positions.map(p => p.bitId), selectedWire.bits.slice(1,3));
        await record('J05');

        await contact('get'); result = await analyze('dependencies', 'backward');
        assert.ok(result.boundaries.some(b => b.reason === 'sequential')); receipt.registerStop = result;
        const add = state.scene.children.find(c => c.type === '$add'); assert.ok(add);
        await pin(add, 'Y'); result = await analyze('dependencies', 'backward');
        assert.ok(result.relations.some(r => r.kind === 'data-dependency'));
        assert.ok(result.cellDescriptions.some(c => c.type === '$add' && c.status === 'supported'));
        await record('J06');
        result = await analyze('dependencies', 'forward');
        assert.ok(result.boundaries.some(b => b.reason === 'sequential'));
        await record('J07');

        await reset(); await enter('left');
        const storage = state.scene.storages.find(s => s.label === 'state'); await clickBody(storage.id);
        result = await analyze('state-accesses'); assert.equal(result.writers.length, 1); assert.equal(result.readers.length, 1);
        const writer = result.writers[0];
        await waitAction(() => page.locator('[data-code-section="writer"] [data-analysis-kind="behavior"]').click());
        result = state.current.analysis.result; assert.equal(result.code.behavior.id, writer.id);
        assert.ok(result.sourceRefs.some(r => r.range.text === 'state <= value + 1;'));
        const primary = result.sourceRefs.find(r => r.semanticId === result.seed.entityId);
        await openSource(primary); await record('J08');
        const rhs = result.code.expressions.find(e => e.text === 'value + 1'); assert.ok(rhs);
        await page.locator('[data-code-record-id][data-analysis-entity-id=' + JSON.stringify(rhs.id) + ']').first().click();
        await analyze('source-dependencies', 'backward');
        assert.equal(state.current.analysis.result.seed.entityId, rhs.id);
        receipt.rhs = state.current.analysis.result;
        // The actual A caller retains separate producer and consumer occurrences.
        await reset();
        const relation = state.scene.connections.find(c => c.members.some(m => m.bindingId)); assert.ok(relation);
        const point = await uniqueWirePoint(relation.id); assert.ok(point);
        await waitAction(() => page.mouse.click(point.x, point.y));
        await analyze('call-site');
        assert.ok(state.current.analysis.result.callMappings.length);
        await record('J09');

        await reset(); await enter('left'); await clickBody(storage.id); await analyze('state-accesses');
        await waitAction(() => page.locator('[data-code-section="writer"] [data-analysis-kind="behavior"]').click());
        await page.locator('[data-code-record-id][data-analysis-entity-id=' + JSON.stringify(rhs.id) + ']').first().click();
        await waitAction(() => page.getByRole('button', { name: 'Explain implementation mapping', exact: true }).last().click());
        result = state.current.analysis.result; assert.equal(result.kind, 'correspondence');
        const claim = result.correspondence.origin.claims.find(c => c.source.kind === 'rhs-binary'); assert.ok(claim);
        assert.equal(result.correspondence.completeOriginSet, false);
        await page.locator('[data-claim-id=' + JSON.stringify(claim.id) + '] > summary').click();
        await pan(18, 12); const sourceFrame = frame(state);
        await waitAction(() => page.locator('[data-analysis-reveal-id=' + JSON.stringify(claim.target.entityId) + ']').click());
        assert.equal(state.current.provider, 'instrumented');
        assert.ok(state.scene.children.some(c => c.id === claim.target.entityId && c.type === '$add'));
        await pin(state.scene.children.find(c => c.id === claim.target.entityId), 'Y'); const contributorFrame = frame(state);
        await analyze('same-net'); await analyze('dependencies', 'forward');
        await waitAction(() => page.locator('#back').click()); assert.equal(state.current.analysis.result.kind, 'same-net');
        await waitAction(() => page.locator('#back').click()); assert.deepEqual(frame(state), contributorFrame);
        await waitAction(() => page.locator('#back').click()); assert.deepEqual(frame(state), sourceFrame);
        await record('J10');

        await reset(); await waitAction(() => page.locator('#rtl').click()); await contact('get'); await analyze('same-net');
        let held = await holdAnalysis();
        await analysis('drivers-loads').click(); await bounded(held.seen.promise, 'held stock query');
        await waitAction(() => page.locator('#provider-select').selectOption('instrumented'));
        const newProvider = frame(state); assert.equal(state.current.provider, 'instrumented');
        held.release.resolve(); await bounded(held.finished.promise, 'late stock response'); await held.close();
        assert.deepEqual(frame(await page.evaluate(() => window.bsvHardware.getState())), newProvider);
        await record('J11');

        await reset(); await waitAction(() => page.locator('#rtl').click()); await contact('get'); await analyze('same-net');
        held = await holdAnalysis();
        await analysis('dependencies', 'backward').click(); await bounded(held.seen.promise, 'held net A query');
        await contact('put_value'); await analyze('same-net'); const netB = frame(state);
        await enter('left'); await waitAction(() => page.locator('#back').click()); assert.deepEqual(frame(state), netB);
        held.release.resolve(); await bounded(held.finished.promise, 'late net A response'); await held.close();
        assert.deepEqual(frame(await page.evaluate(() => window.bsvHardware.getState())), netB);
        await record('J12');
        const visits = state.history.back.length, sameFrame = frame(state);
        await analyze('same-net');
        assert.equal(state.history.back.length, visits); assert.deepEqual(frame(state), sameFrame);
        await record('J13');

        receipt.reuse = [];
        for (const [name, width] of [['narrow',8],['wide',12]]) {
            await reset('C'); await enter(name); await enter('implementation');
            const stateStorage = state.scene.storages[0]; await clickBody(stateStorage.id); await analyze('state-accesses');
            assert.equal(state.current.analysis.result.code.owner.path, 'mkReuse.' + name + '.implementation');
            await screenshot('C-' + name + '-source');
            await waitAction(() => page.locator('#rtl').click());
            assert.deepEqual(state.current.implementationContext.occurrencePath, ['mkReuse',name]);
            const get = state.scene.contacts.find(c => c.ownerId === state.scene.shell.id && c.label === 'get'); assert.equal(get.bits.length,width);
            await contact('get'); result = await analyze('same-net');
            receipt.reuse.push({name,width,current:state.current,result});
        }
        const outside = result.objects.find(o => o.occurrenceId === state.current.implementationContext.parentOccurrenceId && o.kind !== 'source'); assert.ok(outside);
        const reveal = page.locator('[data-analysis-reveal-id=' + JSON.stringify(outside.entityId) + ']');
        while (!await reveal.count()) await page.getByRole('button', { name: /^Show next references/ }).click();
        state = await page.evaluate(() => window.bsvHardware.getState()); const beforeReveal = frame(state);
        await waitAction(() => reveal.click()); assert.equal(state.current.implementationContext.contextOccurrenceId,outside.occurrenceId);
        assert.equal(state.current.selectedEntityId,outside.entityId);
        await waitAction(() => page.locator('#back').click()); assert.deepEqual(frame(state),beforeReveal);
        await record('J14');

        await reset('B');
        const count = state.scene.storages.find(s => s.label === 'count'); await clickBody(count.id); result = await analyze('state-accesses');
        const increment = result.writers.find(b => b.name === 'increment'); assert.ok(increment);
        await waitAction(() => page.locator('[data-code-section="writer"] [data-analysis-entity-id=' + JSON.stringify(increment.id) + ']').click());
        assert.equal(state.current.analysis.result.conditions.predicate.text,'count < 8');
        assert.equal(state.current.analysis.result.code.scheduling.compiler.status,'not-attached');
        await screenshot('B-code');
        await waitAction(() => page.locator('#rtl').click());
        const logic = state.scene.children.find(c => c.type === '$add'); assert.ok(logic);
        await pin(logic,'Y'); await analyze('dependencies','backward');
        await pan(12,8); await waitAction(() => page.locator('#fit').click());
        assert.ok(state.runtime.visibleSemanticIds.includes(logic.id), 'Dense Fit must leave the selected logic visible');
        receipt.control = { current:state.current, screenshot:await screenshot('B-dependencies') };
        await reset(); await enter('left'); await clickBody(storage.id); await analyze('state-accesses');
        receipt.variants = [];
        for (const [width, theme, motion] of [[1440,'dark','no-preference'],[960,'light','no-preference'],[420,'high-contrast','reduce']]) {
            await page.emulateMedia({ reducedMotion:motion });
            await page.setViewportSize({width,height:900});
            await page.locator('#theme-select').selectOption(theme);
            await waitAction(() => page.locator('#fit').click());
            assert.ok(state.runtime.visibleSemanticIds.includes(storage.id), 'Fit must leave storage visible');
            assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),false);
            const variant = {width,theme,motion,current:state.current,runtime:state.runtime,screenshot:await screenshot('variant-'+width+'-'+theme)};
            await page.locator('#code-drawer pre[data-source-reference-id]').first().scrollIntoViewIfNeeded();
            variant.sourceScreenshot = await screenshot('source-'+width+'-'+theme);
            receipt.variants.push(variant);
        }
        await page.locator('#back').focus(); await waitAction(() => page.keyboard.press('Enter'));
        await page.locator('#forward').focus(); await waitAction(() => page.keyboard.press('Space'));
        assert.equal(state.current.analysis.result.kind,'state-accesses');
        await record('J15');
        assert.equal(receipt.journeys.length,15); assert.deepEqual(receipt.pageErrors,[]);
        receipt.status='pass'; console.log('G5_BROWSER_COMPLETE '+output);
    } catch (error) {
        receipt.status=String(error).includes('ERR_BLOCKED_BY_ADMINISTRATOR')?'blocked':'fail';
        receipt.error=String(error.stack||error);
        receipt.lastState=await page.evaluate(() => window.bsvHardware?.getState()).catch(() => null);
        await screenshot('failure'); console.error(receipt.error); process.exitCode=1;
    } finally {
        await context.tracing.stop({path:path.join(output,'trace.zip')});
        await fs.writeFile(path.join(output,'receipt.json'),JSON.stringify(receipt,null,2)+'\n',{flag:'wx'});
        await browser.close(); await new Promise(resolve => server.close(resolve));
        console.log('G5_BROWSER_RECEIPT '+path.join(output,'receipt.json'));
    }
}
run().catch(error => {console.error(error);process.exitCode=1;});
