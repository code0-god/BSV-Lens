'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { chromium } = require('@playwright/test');
const { createServer, createCatalog } = require('./server');
const OUT = '.build/hardware/bsv-ui/rtl-regression';
const debug = page => page.evaluate(() => JSON.parse(window.hardwareDebug));

async function arm(page, actions) {
    await page.evaluate(actions => {
        window.nextCommit = new Promise((resolve, reject) => {
            const timeout = setTimeout(() => { window.removeEventListener('hardware:commit', listener); reject(new Error(`Missing exact commit: ${actions}`)); }, 8000);
            const listener = event => {
                if (!actions.includes(event.detail.action)) return;
                clearTimeout(timeout); window.removeEventListener('hardware:commit', listener); resolve(event.detail);
            };
            window.addEventListener('hardware:commit', listener);
        });
    }, actions);
}
async function action(page, name, trigger) {
    await arm(page, Array.isArray(name) ? name : [name]);
    await trigger();
    return page.evaluate(() => window.nextCommit);
}
async function settle(page) { await page.evaluate(() => Promise.all(document.getAnimations().map(animation => animation.finished))); }
async function capture(page, name) { await settle(page); await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true }); }
async function point(page, x, y) {
    return page.evaluate(({ x, y }) => {
        const p = new DOMPoint(x, y).matrixTransform(document.getElementById('canvas').getScreenCTM());
        return { x: p.x, y: p.y };
    }, { x, y });
}
async function bodyClick(page, id, expected = 'enter') {
    const scene = (await debug(page)).scene, node = scene.nodes.find(node => node.id === id);
    const p = await point(page, node.x + 100, node.y + 23);
    return action(page, expected, () => page.mouse.click(p.x, p.y));
}
async function assertGeometry(page) {
    const data = await debug(page);
    const surface = await page.evaluate(() => {
        const svg = document.getElementById('canvas'), box = svg.getBoundingClientRect();
        const visible = [...svg.querySelectorAll('.node')].filter(node => node.getAttribute('display') !== 'none' && node.getClientRects().length);
        return { box: { x: box.x, y: box.y, right: box.right, bottom: box.bottom },
            nodes: visible.map(node => { const b = node.querySelector(':scope > .node-body').getBoundingClientRect();
                return { id: node.dataset.entity, x: b.x, y: b.y, right: b.right, bottom: b.bottom }; }),
            routes: [...svg.querySelectorAll('.route')].map(route => ({ id: route.dataset.entity,
                bits: JSON.parse(route.dataset.bits), path: route.querySelector('.route-line').getAttribute('d'),
                dots: [...route.querySelectorAll('.junction')].map(dot => ({ x: +dot.getAttribute('cx'), y: +dot.getAttribute('cy') })) })),
            labels: [...svg.querySelectorAll('.port')].filter(port => port.getClientRects().length && port.getAttribute('display') !== 'none').map(port => {
                const label = port.querySelector('.pin-label'), bounds = label.getBBox();
                return { boundary: label.dataset.boundary === 'true', x: bounds.x, y: bounds.y, right: bounds.x + bounds.width,
                    bottom: bounds.y + bounds.height, fontPx: parseFloat(getComputedStyle(label).fontSize) * label.getScreenCTM().a };
            }),
            constants: [...svg.querySelectorAll('.constant-site')].map(marker => ({ bits: JSON.parse(marker.dataset.bits),
                values: JSON.parse(marker.dataset.values), label: marker.querySelector('.constant-label').textContent })),
            overflow: document.documentElement.scrollWidth > innerWidth };
    });
    assert.equal(surface.overflow, false);
    assert.equal(surface.nodes.length, data.scene.nodes.length);
    for (const node of surface.nodes) {
        assert.ok(node.x >= surface.box.x - 1 && node.y >= surface.box.y - 1 && node.right <= surface.box.right + 1 && node.bottom <= surface.box.bottom + 1, `clipped node ${node.id}`);
    }
    const shellId = data.scene.nodes.find(node => node.expanded)?.id;
    if (shellId) {
        const shell = surface.nodes.find(node => node.id === shellId);
        for (const node of surface.nodes.filter(node => node.id !== shellId)) {
            assert.ok(node.x > shell.x && node.y > shell.y && node.right < shell.right && node.bottom < shell.bottom, 'internal cell must be contained in its real shell');
        }
    }
    for (const label of surface.labels.filter(label => label.boundary)) {
        for (const route of data.scene.routes) for (const [x1, y1, x2, y2] of route.segments) {
            assert.equal(Math.max(x1, x2) > label.x && Math.min(x1, x2) < label.right &&
                Math.max(y1, y2) > label.y && Math.min(y1, y2) < label.bottom, false, 'route crosses reserved boundary label rail');
        }
    }
    for (const marker of surface.constants) {
        const route = data.scene.routes.find(route => route.constantMarker && JSON.stringify(route.constantMarker.bitIds) === JSON.stringify(marker.bits));
        assert.ok(route); assert.deepEqual(marker.values, route.rawBits); assert.equal(marker.label, route.constantMarker.label);
        assert.ok(marker.values.every(value => ['0', '1', 'x', 'z'].includes(value)));
        assert.equal(route.points.length, 1, 'constant remains connection-local');
    }
    assert.equal(surface.constants.length, data.scene.routes.filter(route => route.constantMarker).length);
    for (const route of surface.routes) {
        const geometry = data.scene.routes.find(r => r.id === route.id);
        assert.deepEqual(route.bits, geometry.bits);
        assert.equal(route.path, geometry.path);
        assert.deepEqual(route.dots, geometry.junctions);
        for (const dot of route.dots) {
            const incident = geometry.segments.filter(([x1, y1, x2, y2]) => dot.x >= Math.min(x1, x2) && dot.x <= Math.max(x1, x2) && dot.y >= Math.min(y1, y2) && dot.y <= Math.max(y1, y2));
            assert.ok(incident.length >= 2, 'dot must join same-net branches');
            for (const other of data.scene.routes.filter(r => r.id !== route.id)) {
                assert.equal(other.segments.some(([x1, y1, x2, y2]) => dot.x >= Math.min(x1, x2) && dot.x <= Math.max(x1, x2) && dot.y >= Math.min(y1, y2) && dot.y <= Math.max(y1, y2)), false, 'false junction at another net crossing');
            }
        }
    }
    return surface;
}

test('actual Chrome pointer/keyboard journeys on three compiled artifacts and responsive evidence', { timeout: 120000 }, async t => {
    fs.mkdirSync(OUT, { recursive: true });
    const server = createServer();
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const browser = await chromium.launch({ channel: 'chrome', headless: true });
    t.after(async () => { await browser.close(); await new Promise(resolve => server.close(resolve)); });
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, reducedMotion: 'no-preference' });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => { window.appReady = new Promise(resolve => window.addEventListener('hardware:ready', resolve, { once: true })); });
    await page.goto(`http://127.0.0.1:${server.address().port}/?mode=rtl`);
    await page.evaluate(() => window.appReady);
    assert.equal((await debug(page)).state, null);
    assert.equal(await page.locator('#build option').count(), 4);
    await capture(page, '01-before-build');
    await page.selectOption('#build', 'A');
    await action(page, 'load', () => page.click('#load'));
    let data = await debug(page);
    const snapshotId = data.state.snapshotId;
    const top = data.scene.nodes[0];
    await capture(page, '02-compiled-overall');
    await page.evaluate(id => { window.observedTop = document.getElementById(id); }, top.domId);
    const topAnchors = data.scene.anchors.map(a => ({ id: a.domId, bits: a.bits }));
    await page.evaluate(ids => { window.observedTopPorts = ids.map(id => document.getElementById(id)); }, topAnchors.map(a => a.id));
    await bodyClick(page, top.id);
    data = await debug(page);
    assert.equal(data.state.rootId, top.id); assert.equal(data.state.snapshotId, snapshotId);
    assert.equal(await page.evaluate(id => window.observedTop === document.getElementById(id), top.domId), true);
    assert.equal(await page.evaluate(ids => ids.every((id, i) => window.observedTopPorts[i] === document.getElementById(id)), topAnchors.map(a => a.id)), true);
    for (const anchor of topAnchors) assert.deepEqual(data.scene.anchors.find(a => a.domId === anchor.id).bits, anchor.bits);
    const readableTop = await assertGeometry(page);
    assert.ok(Math.min(...readableTop.labels.map(label => label.fontPx)) >= 11.5, 'small top pins must remain approximately 12 CSS px at 1280');
    await capture(page, '03-same-shell-top-expansion');
    const topGeometry = data.scene;
    const child = data.scene.nodes.find(node => node.expandable);
    const childAnchors = data.scene.anchors.filter(a => a.ownerId === child.id);
    await action(page, 'inspect', () => page.locator(`[id="${child.domId}"] > .info`).click());
    assert.equal((await debug(page)).state.rootId, top.id);
    await action(page, 'clear', () => page.getByRole('button', { name: 'Close details', exact: true }).click());
    await page.evaluate(({ id, ports }) => { window.observedChild = document.getElementById(id); window.observedChildPorts = ports.map(id => document.getElementById(id)); }, { id: child.domId, ports: childAnchors.map(a => a.domId) });
    await bodyClick(page, child.id);
    data = await debug(page);
    assert.equal(data.state.rootId, child.id);
    assert.equal(await page.evaluate(id => window.observedChild === document.getElementById(id), child.domId), true);
    assert.equal(await page.evaluate(ids => ids.every((id, i) => window.observedChildPorts[i] === document.getElementById(id)), childAnchors.map(a => a.domId)), true);
    for (const anchor of childAnchors) {
        assert.deepEqual(data.scene.anchors.find(a => a.id === anchor.id).bits, anchor.bits);
        const c = data.scene.continuations.find(c => c.portId === anchor.id);
        const raw = JSON.parse(fs.readFileSync('docs/hardware/evidence/toolchain/A/design.json', 'utf8'));
        const actual = raw.modules.mkConnected.cells[child.name].connections[anchor.name];
        const domBindings = JSON.parse(await page.locator(`[id="${anchor.domId}"]`).getAttribute('data-bindings'));
        if (!actual.length) { assert.equal(c, undefined); assert.deepEqual(domBindings, []); }
        else {
            assert.ok(c); assert.deepEqual(c.bindings.map(b => b.formalBitId), anchor.bits);
            assert.deepEqual(domBindings, c.bindings);
            assert.deepEqual(c.bindings.map(b => Number(b.actualBitId.split('/').at(-1))), actual);
        }
    }
    await assertGeometry(page); await capture(page, '04-child-internal-cells');
    const childGeometry = data.scene;
    // Exact data-driven route point, delivered through Chrome mouse events (never the controller).
    const route = data.scene.routes.find(r => r.bits.length > 1 && r.points.length > 1 && r.right - r.left > 50);
    const location = await point(page, (route.left + route.right) / 2, route.trackY);
    const wireEvent = await action(page, ['inspect', 'wire-choice'], () => page.mouse.click(location.x, location.y));
    if (wireEvent.action === 'wire-choice') await action(page, 'inspect', () => page.locator(`[data-route-choice="${route.id}"]`).click());
    data = await debug(page);
    assert.equal(data.state.rootId, child.id); assert.equal(data.state.selectedId, route.id);
    await action(page, 'bit', () => page.locator(`#details [data-bit="${route.bits[1]}"]`).click());
    data = await debug(page); assert.equal(data.state.selectedBit, route.bits[1]);
    assert.equal(await page.locator('#ordered-bits').textContent(), route.rawBits.join(', '));
    await capture(page, '05-bus-ordered-bit-and-fanout');
    await action(page, 'clear', () => page.getByRole('button', { name: 'Close details', exact: true }).click());
    const port = data.scene.anchors.find(a => a.ownerId === child.id && a.name === 'get');
    // Ordinary locator click includes the visible label, not a forced click or anchor-only workaround.
    await action(page, 'inspect', () => page.locator(`.port[id="${port.domId}"]`).click());
    assert.equal((await debug(page)).state.rootId, child.id);
    assert.equal((await debug(page)).state.selectedId, port.id);
    await action(page, 'source', () => page.getByRole('button', { name: /^Open generated RTL/ }).first().click());
    assert.equal((await debug(page)).state.source.role, 'generated-rtl');
    assert.equal((await debug(page)).state.source.scope, 'enclosing-rtl-context-not-selected-object-origin');
    await action(page, 'source', () => page.getByRole('button', { name: /^Open BSV compiler context/ }).click());
    const portSourceState = (await debug(page)).state;
    assert.equal(portSourceState.source.role, 'original-bsv-context');
    assert.equal(portSourceState.source.column1, null);
    assert.equal(portSourceState.source.scope, 'compiler-module-context-not-method-source-range');
    assert.equal(portSourceState.source.text, fs.readFileSync(portSourceState.source.path, 'utf8').split('\n')[portSourceState.source.line1 - 1]);
    await action(page, 'up', () => page.click('#up'));
    await action(page, 'back', () => page.click('#back'));
    assert.deepEqual((await debug(page)).state, portSourceState);
    assert.equal(await page.getByRole('button', { name: /^Open BSV compiler context/ }).count(), 1);
    await capture(page, 'expanded-get-port-source-back');
    await action(page, 'clear', () => page.getByRole('button', { name: 'Close details', exact: true }).click());
    const leaf = (await debug(page)).scene.nodes.find(n => n.kind === 'cell');
    await bodyClick(page, leaf.id, 'inspect');
    data = await debug(page); assert.equal(data.state.rootId, child.id); assert.equal(data.state.selectedId, leaf.id);
    await capture(page, '06-cell-evidence');
    await capture(page, '07-original-mapping-unknown');
    await action(page, 'source', () => page.getByRole('button', { name: /^Open generated RTL/ }).first().click());
    data = await debug(page);
    const source = data.state.source;
    assert.equal(await page.locator('#source-code').textContent(), source.text);
    const actualText = fs.readFileSync(source.path, 'utf8');
    assert.equal(crypto.createHash('sha256').update(actualText).digest('hex'), source.hash);
    const lines = actualText.split('\n');
    const start = lines.slice(0, source.line1 - 1).reduce((sum, line) => sum + line.length + 1, 0) + source.column1 - 1;
    const end = lines.slice(0, source.endLine1 - 1).reduce((sum, line) => sum + line.length + 1, 0) + source.endColumn1 - 1;
    assert.equal(source.text, actualText.slice(start, end));
    await capture(page, '08-hashed-source-range');
    const exactChildScene = data.state;
    await action(page, 'up', () => page.click('#up'));
    assert.equal((await debug(page)).state.rootId, top.id);
    await action(page, 'back', () => page.click('#back'));
    assert.deepEqual((await debug(page)).state, exactChildScene);
    assert.equal(await page.locator('#source-code').textContent(), source.text);
    await capture(page, '09-back-restores-selection-viewport-source');
    await action(page, 'forward', () => page.click('#forward'));
    assert.equal((await debug(page)).state.rootId, top.id);
    assert.deepEqual((await debug(page)).scene, topGeometry);
    // Explicit breadcrumb navigation clears stale focus and remains reversible.
    await bodyClick(page, child.id);
    await action(page, 'go', () => page.locator('#breadcrumbs button').nth(1).click());
    data = await debug(page); assert.equal(data.state.selectedId, null); assert.equal(data.state.source, null);
    await action(page, 'back', () => page.click('#back'));
    assert.equal((await debug(page)).state.rootId, child.id);
    assert.deepEqual((await debug(page)).scene, childGeometry);
    // Current boundary never enters again; Space inspects and Enter on a leaf inspects.
    const historyLength = (await debug(page)).history.back.length;
    await bodyClick(page, child.id, 'inspect');
    assert.equal((await debug(page)).history.back.length, historyLength);
    await page.locator(`[id="${leaf.domId}"]`).focus();
    await action(page, 'inspect', () => page.keyboard.press('Enter'));
    assert.equal((await debug(page)).state.rootId, child.id);
    await page.locator(`[id="${child.domId}"]`).focus();
    await action(page, 'inspect', () => page.keyboard.press('Space'));
    assert.equal((await debug(page)).state.rootId, child.id);
    // Compiler-backed BSV declaration opens a whole verified line, never a guessed range.
    await action(page, 'source', () => page.getByRole('button', { name: /^Open verified BSV/ }).click());
    const bsv = (await debug(page)).state.source;
    assert.equal(bsv.column1, null);
    assert.equal(bsv.text, fs.readFileSync(bsv.path, 'utf8').split('\n')[bsv.line1 - 1]);
    await capture(page, 'verified-bsv-instance-line');
    await action(page, 'up', () => page.click('#up'));
    // Double pointer activation must not enter the child and then a grandchild/leaf accidentally.
    const collapsedChild = (await debug(page)).scene.nodes.find(n => n.id === child.id);
    const doublePoint = await point(page, collapsedChild.x + 100, collapsedChild.y + 23);
    await action(page, 'enter', () => page.mouse.dblclick(doublePoint.x, doublePoint.y));
    assert.equal((await debug(page)).state.rootId, child.id);
    assert.equal((await debug(page)).state.selectedId, null);
    // Wheel changes viewport only; drag suppresses the synthetic click at release.
    data = await debug(page); const beforeWheel = data.state, beforeHistory = data.history;
    await page.mouse.move(500, 400);
    await action(page, 'wheel', () => page.mouse.wheel(0, -90));
    data = await debug(page); assert.equal(data.state.rootId, beforeWheel.rootId); assert.deepEqual(data.history, beforeHistory);
    assert.notDeepEqual(data.state.viewport, beforeWheel.viewport);
    await action(page, 'fit', () => page.click('#fit'));
    const node = (await debug(page)).scene.nodes.find(n => n.kind === 'cell');
    const from = await point(page, node.x + 100, node.y + 23);
    const beforeDrag = (await debug(page)).history;
    await action(page, 'pan', async () => { await page.mouse.move(from.x, from.y); await page.mouse.down(); await page.mouse.move(from.x + 50, from.y + 25); await page.mouse.up(); });
    assert.deepEqual((await debug(page)).history, beforeDrag);
    assert.equal((await debug(page)).state.selectedId, null);
    await action(page, 'fit', () => page.click('#fit')); await assertGeometry(page);
    // Read failure does not destroy the successful analysis state.
    const successful = (await debug(page)).state;
    await page.route('**/api/model?build=B', route => route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: 'Controlled artifact read failure' }) }));
    await page.selectOption('#build', 'B'); await action(page, 'error', () => page.click('#load'));
    assert.deepEqual((await debug(page)).state, successful);
    await capture(page, 'failed-import-retains-scene');
    await page.unroute('**/api/model?build=B');
    // A deliberately held real response exercises loading without timing assumptions.
    let releaseImport;
    const release = new Promise(resolve => { releaseImport = resolve; });
    let signalRequest;
    const requested = new Promise(resolve => { signalRequest = resolve; });
    await page.route('**/api/model?build=B', async route => { signalRequest(); await release; await route.continue(); });
    await arm(page, ['load']);
    await page.click('#load'); await requested;
    assert.deepEqual((await debug(page)).state, successful);
    assert.equal(await page.locator('#canvas-region').getAttribute('aria-busy'), 'true');
    releaseImport(); await page.evaluate(() => window.nextCommit);
    await page.unroute('**/api/model?build=B');
    const layouts = [];
    for (const key of ['B', 'C']) {
        await page.selectOption('#build', key); await action(page, 'load', () => page.click('#load'));
        const root = (await debug(page)).scene.nodes[0]; await bodyClick(page, root.id);
        await action(page, 'fit', () => page.click('#fit')); await assertGeometry(page);
        layouts.push({ key, root: root.name, bounds: (await debug(page)).scene.bounds, visible: (await debug(page)).scene.nodes.length });
        await capture(page, `design-${key.toLowerCase()}-compiled`);
    }
    await page.selectOption('#build', 'A'); await action(page, 'load', () => page.click('#load'));
    await bodyClick(page, (await debug(page)).scene.nodes[0].id);
    const responsive = [];
    await page.emulateMedia({ reducedMotion: 'reduce' });
    for (const width of [375, 768, 1280, 1440]) {
        await page.setViewportSize({ width, height: width === 1440 ? 1000 : 900 });
        for (const theme of ['dark', 'light', 'hc']) {
            await action(page, 'theme', () => page.selectOption('#theme', theme));
            await action(page, 'fit', () => page.click('#fit'));
            const geometry = await assertGeometry(page);
            await capture(page, `10-${width}-${theme}-reduced-motion`);
            const pinFontPx = Math.min(...geometry.labels.map(label => label.fontPx));
            if (width >= 1280) assert.ok(pinFontPx >= 11.5, 'small top remains readable at desktop fit');
            responsive.push({ width, theme, nodes: geometry.nodes.length, overflow: geometry.overflow, pinFontPx });
        }
    }
    await action(page, 'up', () => page.click('#up'));
    assert.equal((await debug(page)).state.rootId, null);
    assert.deepEqual(errors, []);
    const final = await debug(page);
    const receipt = { browser: browser.version(), platform: process.platform, arch: process.arch,
        inputSurface: 'Actual Chrome mouse and keyboard; read-only serialized debug assertions; no controller invocation',
        snapshots: createCatalog().map(build => ({ key: build.key, id: build.model.snapshot.id, artifact: build.model.snapshot.artifact, importMs: build.importMs })),
        timings: final.timings, layouts, responsive,
        screenshots: fs.readdirSync(OUT).filter(name => name.endsWith('.png') && !name.startsWith('initial-') && !name.startsWith('contact-')).sort(),
        assertions: ['same DOM shell/port objects', 'ordered actual/formal bindings', 'canonical visibility independence', 'bit/driver/alias inspection',
            'exact hashed RTL slice', 'verified compiler BSV line', 'exact Back/Forward source-selection-viewport restoration',
            'real-parent Up and breadcrumb history', 'double-click dedupe', 'wheel-only geometry', 'drag suppression',
            'Enter/Space/nonbubbling port/leaf', 'deterministic scene geometry', 'true junctions not other-net crossings',
            'fit has no clipped node', 'small top pin labels at least 11.5px at 1280/1440', 'boundary labels outside routing rails',
            'connection-local constant markers', 'ordinary expanded get-port label click and RTL/BSV-context/Back',
            'three real compiled designs', 'failure preserves scene', '375/768/1280/1440 dark/light/high-contrast reduced-motion'],
        limitations: ['No blackbox occurs in the three real compile artifacts; blackbox stop behavior unit-tested only',
            'No production VS Code source reveal', 'No S/M/L performance acceptance thresholds', 'Immediate same-shell commit, not animated intermediate interpolation'] };
    fs.writeFileSync(`${OUT}/receipt.json`, `${JSON.stringify(receipt, null, 2)}\n`);
});
