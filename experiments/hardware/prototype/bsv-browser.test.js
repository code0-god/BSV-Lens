'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { chromium } = require('@playwright/test');
const { createServer, createCatalog, bsvArchitecture } = require('./server');
const Adapter = require('../bsv-architecture');
const Layout = require('./bsv-layout');
const OUT = '.build/hardware/bsv-ui';
const debug = page => page.evaluate(() => JSON.parse(window.hardwareDebug));
const hash = text => crypto.createHash('sha256').update(text).digest('hex');
async function action(page, actionName, trigger) {
    await page.evaluate(name => {
        window.nextBsvCommit = new Promise((resolve, reject) => {
            const listener = event => {
                if (event.detail.action !== name && event.detail.action !== 'error') return;
                clearTimeout(timeout); window.removeEventListener('hardware:commit', listener);
                if (event.detail.action === 'error') reject(new Error(JSON.parse(window.hardwareDebug).error)); else resolve(event.detail);
            };
            const timeout = setTimeout(() => { window.removeEventListener('hardware:commit', listener); reject(new Error(`Missing exact ${name} commit`)); }, 8000);
            window.addEventListener('hardware:commit', listener);
        });
    }, actionName);
    await trigger(); return page.evaluate(() => window.nextBsvCommit);
}
const locator = (page, id) => page.locator(`[id="${Layout.domId(id)}"]`);
const clickBody = (page, id, actionName = 'enter') => action(page, actionName, () => locator(page, id).locator(':scope > .node-title').click());
async function capture(page, name, captures) {
    await page.evaluate(() => Promise.all(document.getAnimations().map(animation => animation.finished)));
    await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true }); captures.push(name);
}
async function assertBsv(page, view) {
    const data = await debug(page);
    assert.equal(data.state.sceneKind, 'bsv'); assert.equal(data.state.snapshotId, view.snapshotId);
    const dom = await page.evaluate(() => ({
        objects: [...document.querySelectorAll('.bsv-scene [data-entity]')].filter(e => e.getClientRects().length && !e.closest('[display="none"]')).map(e => ({
            id: e.dataset.entity, definition: e.dataset.definition, owner: e.dataset.owner, snapshot: e.dataset.snapshot,
            refs: JSON.parse(e.dataset.sourceRefs), kind: e.dataset.kind })),
        cells: [...document.querySelectorAll('.node')].filter(e => e.getClientRects().length && !e.closest('[display="none"]')).length,
        overflow: document.documentElement.scrollWidth > innerWidth,
        fonts: [...document.querySelectorAll('.bsv-port .pin-label')].filter(e => e.getClientRects().length && !e.closest('[display="none"]')).map(e => parseFloat(getComputedStyle(e).fontSize) * e.getScreenCTM().a)
    }));
    assert.equal(dom.cells, 0); assert.equal(dom.overflow, false);
    assert.ok(data.scene.nodes.every(n => n.kind === 'module-occurrence' || n.kind === 'storage'));
    assert.equal(dom.objects.length, data.scene.nodes.length + data.scene.anchors.length + data.scene.routes.length);
    for (const object of dom.objects) {
        const item = Layout.entity(view, object.id); assert.ok(item);
        assert.equal(object.definition, item.definitionId); assert.equal(object.owner, item.ownerOccurrenceId);
        assert.equal(object.snapshot, view.snapshotId); assert.deepEqual(object.refs, item.sourceEvidence);
        assert.ok(!['rule', 'method', 'cell'].includes(object.kind));
    }
    return { minContactPx: Math.min(...dom.fonts), nodes: data.scene.nodes.length, relations: data.scene.routes.length, overflow: dom.overflow };
}

test('BSV default A-F runtime on every real dataset; actual pointer/keyboard, source, modes and responsive evidence', { timeout: 120000 }, async t => {
    fs.mkdirSync(OUT, { recursive: true });
    const server = createServer(); await new Promise(r => server.listen(0, '127.0.0.1', r));
    const browser = await chromium.launch({ channel: 'chrome', headless: true });
    t.after(async () => { await browser.close(); await new Promise(r => server.close(r)); });
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, reducedMotion: 'no-preference' });
    const errors = [], captures = [], journeys = [], responsive = [], families = new Set();
    page.on('pageerror', e => errors.push(e.message));
    await page.addInitScript(() => { window.appReady = new Promise(resolve => window.addEventListener('hardware:ready', resolve, { once: true })); });
    await page.goto(`http://127.0.0.1:${server.address().port}`); await page.evaluate(() => window.appReady);
    await capture(page, '00-before-build', captures);
    const builds = createCatalog();
    for (const build of builds) {
        const view = bsvArchitecture(build), top = view.occurrences[view.roots[0]];
        await page.setViewportSize({ width: 1280, height: 900 });
        await action(page, 'theme', () => page.selectOption('#theme', 'dark'));
        await page.selectOption('#build', build.key); await action(page, 'load', () => page.click('#load'));
        await assertBsv(page, view); await capture(page, `${build.key}-A-overall`, captures);
        const owner = top.children.map(id => view.occurrences[id]).find(o => o.storage.length) || top;
        await page.evaluate(id => { window.sameShell = document.getElementById(id); }, Layout.domId(owner.id));
        await clickBody(page, top.id);
        if (owner.id !== top.id) await clickBody(page, owner.id);
        assert.equal((await debug(page)).state.rootId, owner.id);
        assert.equal(await page.evaluate(id => window.sameShell === document.getElementById(id), Layout.domId(owner.id)), true);
        await assertBsv(page, view); await capture(page, `${build.key}-B-interior`, captures);
        const storage = view.storage[owner.storage[0]];
        await clickBody(page, storage.id, 'inspect');
        assert.equal((await debug(page)).state.selectedId, storage.id);
        assert.equal((await debug(page)).state.rootId, owner.id);
        assert.equal(await page.locator('#behavior-overlay').count(), 1);
        await capture(page, `${build.key}-C-state-behavior`, captures);
        await action(page, 'clear', () => page.getByRole('button', { name: 'Close details', exact: true }).click());
        const local = Adapter.getRelations(view, owner.id);
        const write = local.find(r => r.kind === 'state-write');
        await action(page, 'inspect', () => locator(page, write.id).locator('.semantic-label-bg').click());
        assert.equal((await debug(page)).state.selectedId, write.id);
        const relationDetail = JSON.parse(await page.locator('#relation-evidence').textContent());
        assert.equal(relationDetail.kind, write.kind); assert.deepEqual(relationDetail.explicitPredicate, write.explicitPredicate);
        assert.deepEqual(relationDetail.bodyPathConditions, write.bodyPathConditions); assert.deepEqual(relationDetail.sourceStatement, write.sourceEvidence.map(r => r.text));
        await action(page, 'source', () => page.locator('[data-bsv-source-index="0"]').click());
        const source = (await debug(page)).state.source, text = fs.readFileSync(source.path, 'utf8');
        assert.equal(source.hash, hash(text)); assert.equal(source.text, text.slice(source.range.start, source.range.end));
        assert.equal(source.sliceHash, hash(source.text)); assert.equal(await page.locator('#source-code').textContent(), source.text);
        await capture(page, `${build.key}-D-original-source`, captures);
        const previous = (await debug(page)).state;
        await action(page, 'rtl', () => page.click('#open-rtl'));
        let rtl = await debug(page);
        assert.equal(rtl.state.sceneKind, 'rtl'); assert.equal(rtl.state.ownerId, owner.id);
        assert.equal(rtl.state.snapshotId, previous.snapshotId); assert.equal(rtl.state.selectedId, previous.selectedId);
        assert.deepEqual(rtl.state.source, previous.source);
        assert.deepEqual(rtl.state.bsvContext.viewport, previous.viewport);
        assert.deepEqual(rtl.state.trace.verifiedEntityIds, []);
        assert.ok(rtl.scene.nodes.some(n => n.kind === 'cell' && build.model.cells[n.id].type.startsWith('$')));
        for (const node of rtl.scene.nodes) assert.ok(build.model.entities[node.id]);
        const clippedAtEntry = await page.locator('.node:visible').evaluateAll(nodes => {
            const canvas = document.getElementById('canvas').getBoundingClientRect();
            return nodes.filter(node => {
                const box = node.getBoundingClientRect();
                return box.left < canvas.left || box.right > canvas.right
                    || box.top < canvas.top || box.bottom > canvas.bottom;
            }).map(node => node.getAttribute('data-entity'));
        });
        assert.deepEqual(clippedAtEntry, [], 'RTL detail must be visible before a manual Fit');
        await action(page, 'fit', () => page.click('#fit'));
        await capture(page, `${build.key}-E-explicit-rtl`, captures);
        const rtlScene = (await debug(page)).state;
        await action(page, 'back', () => page.click('#back'));
        assert.deepEqual((await debug(page)).state, previous); await assertBsv(page, view);
        await capture(page, `${build.key}-F-back`, captures);
        await action(page, 'forward', () => page.click('#forward')); assert.deepEqual((await debug(page)).state, rtlScene);
        await action(page, 'returnBSV', () => page.click('#return-bsv')); assert.deepEqual((await debug(page)).state, previous);
        await action(page, 'up', () => page.click('#up'));
        assert.equal((await debug(page)).state.rootId, owner.parentId);
        await action(page, 'back', () => page.click('#back')); assert.deepEqual((await debug(page)).state, previous);
        await action(page, 'clear', () => page.getByRole('button', { name: 'Close details', exact: true }).click());
        const contact = Adapter.getPorts(view, owner.id).find(p => p.kind === 'method-boundary' && p.methodKind === 'Value');
        const history = (await debug(page)).history;
        await action(page, 'inspect', () => locator(page, contact.id).click());
        assert.equal((await debug(page)).state.selectedId, contact.id); assert.equal((await debug(page)).state.rootId, owner.id);
        assert.deepEqual((await debug(page)).history, history);
        assert.equal(await page.locator('#rtl-signal-detail').count(), 0);
        assert.equal(/RDY_|EN_/.test(await page.locator('#details').innerText()), false);
        await action(page, 'rtl-signals', () => page.click('#rtl-signals'));
        assert.deepEqual(JSON.parse(await page.locator('#rtl-signal-json').textContent()), contact.rtlSignals);
        const chains = JSON.parse(await page.locator('#method-connectivity').textContent());
        assert.ok(chains.every(chain => chain.exactInvocationToWire === false && chain.exactLeafCellCause === false));
        const proof = JSON.parse(fs.readFileSync('docs/hardware/evidence/bsv/representative-chain.json', 'utf8'));
        if (owner.path.split('.').join('/') === proof.occurrence && contact.name === proof.sourceMethod.name) {
            const chain = chains.find(chain => chain.role === 'result');
            assert.deepEqual(chain.formalOrderedBits, proof.formalBitsLsbFirst);
            assert.deepEqual(chain.actualOrderedBits, proof.actualBitsLsbFirst);
            for (const endpoint of proof.parentLeafEndpoints) assert.ok(chain.parentEndpoints.some(e => e.cell === endpoint.cell && e.port === endpoint.pin));
            assert.ok(chain.localEndpoints.some(e => e.cell === proof.childOutputEndpoint.cell && e.port === proof.childOutputEndpoint.pin));
        }
        await capture(page, `${build.key}-C-typed-port-disclosure`, captures);
        await action(page, 'rtl', () => page.click('#open-rtl'));
        assert.deepEqual((await debug(page)).state.trace.verifiedEntityIds, contact.rtlCorrespondence.entityIds);
        const highlights = await page.locator('.port.verified-mapping').evaluateAll(items => items.map(item => item.dataset.entity));
        assert.deepEqual(highlights.sort(), [...contact.rtlCorrespondence.entityIds].sort());
        await action(page, 'back', () => page.click('#back'));
        const behavior = view.behaviors[contact.behaviorIds[0]];
        await action(page, 'inspect', () => page.locator(`[data-inspect-behavior="${behavior.id}"]`).click());
        await action(page, 'source', () => page.locator('[data-bsv-source-index="0"]').click());
        assert.equal((await debug(page)).state.source.text, behavior.sourceEvidence[0].text);
        await capture(page, `${build.key}-D-method-implementation`, captures);
        const length = (await debug(page)).history.back.length;
        await locator(page, owner.id).focus(); await action(page, 'inspect', () => page.keyboard.press('Space'));
        assert.equal((await debug(page)).history.back.length, length);
        await locator(page, storage.id).focus(); await action(page, 'inspect', () => page.keyboard.press('Enter'));
        assert.equal((await debug(page)).state.rootId, owner.id);
        await action(page, 'clear', () => page.getByRole('button', { name: 'Close details', exact: true }).click());
        await action(page, 'go', () => page.locator('#breadcrumbs button').first().click());
        // Visit each actual source occurrence and every local relation family; no fixture coordinates or controller calls.
        for (const occurrence of Object.values(view.occurrences)) {
            await action(page, 'hierarchy', () => page.click('#hierarchy-toggle'));
            const button = page.locator('#hierarchy').getByRole('button', { name: occurrence.path.split('.').join(' / '), exact: true });
            await action(page, 'enter', () => button.click());
            await action(page, 'hierarchy', () => page.click('#hierarchy-toggle'));
            await assertBsv(page, view);
            for (const relation of Adapter.getRelations(view, occurrence.id)) {
                await locator(page, relation.id).focus(); await action(page, 'inspect', () => page.keyboard.press('Enter'));
                assert.equal((await debug(page)).state.selectedId, relation.id);
                families.add(relation.kind);
            }
            if (occurrence.rtlContext.implementationOccurrenceId === null) {
                await clickBody(page, occurrence.id, 'inspect');
                await action(page, 'rtl', () => page.click('#open-rtl'));
                const inlined = (await debug(page)).state;
                assert.equal(inlined.ownerId, occurrence.id); assert.equal(inlined.rootId, occurrence.rtlContext.contextOccurrenceId);
                assert.deepEqual(inlined.trace.verifiedEntityIds, []);
                await action(page, 'back', () => page.click('#back'));
            }
            await action(page, 'go', () => page.locator('#breadcrumbs button').first().click());
        }
        await page.emulateMedia({ reducedMotion: 'reduce' });
        for (const width of [375, 768, 1280, 1440]) {
            await page.setViewportSize({ width, height: width === 1440 ? 1000 : 900 });
            for (const theme of ['dark', 'light', 'hc']) {
                await action(page, 'theme', () => page.selectOption('#theme', theme));
                await action(page, 'fit', () => page.click('#fit'));
                const geometry = await assertBsv(page, view);
                responsive.push({ dataset: build.key, width, theme, ...geometry });
                await capture(page, `${build.key}-${width}-${theme}-reduced-motion`, captures);
            }
            const port = Adapter.getPorts(view, top.id).find(p => p.kind === 'method-boundary');
            await action(page, 'inspect', () => locator(page, port.id).click());
            assert.equal((await debug(page)).state.rootId, null);
            assert.equal((await debug(page)).state.selectedId, port.id);
            await capture(page, `${build.key}-${width}-port-pointer-hc`, captures);
            await action(page, 'clear', () => page.getByRole('button', { name: 'Close details', exact: true }).click());
        }
        journeys.push({ dataset: build.key, snapshotId: view.snapshotId, ownerId: owner.id, source,
            occurrences: Object.keys(view.occurrences).length, storage: Object.keys(view.storage).length });
    }
    assert.deepEqual([...families].sort(), ['argument-flow', 'forwarding', 'invocation', 'result-flow', 'state-read', 'state-write']);
    assert.deepEqual(errors, []);
    fs.writeFileSync(`${OUT}/receipt.json`, JSON.stringify({ browser: browser.version(), platform: process.platform, arch: process.arch,
        surface: 'Real Chrome pointer and keyboard; event subscriptions before actions; no sleeps, polling or controller invocation',
        journeys, responsive, relationFamilies: [...families].sort(), captures, captureCount: captures.length,
        priorEvidence: 'Original RTL/static-50% artifacts unchanged; these captures prove actual immediate runtime commits, not animation midpoints' }, null, 2));
});
