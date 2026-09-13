'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { reset, settled, enter, select, analyze, object } = require('./browser-helpers.cjs');
const { measurePage } = require('./oracle.cjs');
const { runDisplayFixture } = require('./display-fixture.cjs');
const { loadCorpus } = require('../g4-fix/geometry-check.cjs');
const { validateGeometry, validateMembership } = require('../g4-fix/oracle/geometry.cjs');
const hash = value => crypto.createHash('sha256').update(JSON.stringify(value ?? null)).digest('hex');
const stateOf = page => page.evaluate(() => window.bsvHardware.getState());
async function bounded(promise, name) {
    let timer;
    try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${name} timed out`)), 15000); })]); }
    finally { clearTimeout(timer); }
}
const frame = state => {
    const current = structuredClone(state.current); delete current.queryGeneration;
    // Inspector cache ownership is derived on render; scroll/source/disclosure
    // and every semantic/presentation field remain part of restoration checks.
    if (current.disclosureState.inspector) delete current.disclosureState.inspector.key;
    return current;
};
const semantic = state => ({ build: state.current.buildId, provider: state.current.provider, snapshot: state.current.snapshotId,
    owner: state.current.ownerInstanceId, occurrence: state.current.implementationContext.contextOccurrenceId,
    selected: state.current.selectedEntityId, relation: state.current.selectedRelationId, analysis: hash(state.current.analysis) });
const detailExpected = state => ({ fitAll: false, mandatory: [{ id: 'readability-context', minFont: 11 },
    ...[...state.scene.children, ...state.scene.storages].filter(n => n.id === state.current.selectedEntityId).map(n => ({ ownerId: n.id, role: 'node-title', minFont: 12 }))] });
async function anchor(page) {
    return page.evaluate(() => {
        const state = window.bsvHardware.getState(), c = document.getElementById('viewport').getBoundingClientRect();
        const id = state.current.selectedEntityId, element = document.querySelector(`[data-semantic-id=${JSON.stringify(id)}][data-active="true"] .body`);
        const b = element.getBoundingClientRect();
        return { id, x: b.x + b.width / 2 - c.x - c.width / 2, y: b.y + b.height / 2 - c.y - c.height / 2,
            canvas: { width: c.width, height: c.height }, scale: state.current.viewport.scale };
    });
}
function sameAnchor(a, b) { assert.equal(a.id, b.id); assert.ok(Math.abs(a.x - b.x) < 2 && Math.abs(a.y - b.y) < 2, `Anchor drift ${JSON.stringify({ a, b })}`); assert.equal(a.scale, b.scale); }
async function sourceFrame(session) {
    const { page } = session; await reset(session); let state = await enter(page, 'left');
    const storage = state.scene.storages.find(n => n.label === 'state'); await select(page, storage.id); await analyze(page, 'state-accesses');
    return settled(page, () => page.locator('[data-code-section="writer"] [data-analysis-kind="behavior"]').click());
}
async function wirePoint(page, id) {
    return page.evaluate(id => {
        const s = window.bsvHardware.getState(), canvas = document.getElementById('viewport').getBoundingClientRect();
        const routes = s.geometry.routes.map(r => { const matrix = document.querySelector(`[data-semantic-id=${JSON.stringify(r.id)}]`).getScreenCTM();
            return { id: r.id, segments: r.segments.map(([x1, y1, x2, y2]) => { const a = new DOMPoint(x1, y1).matrixTransform(matrix), b = new DOMPoint(x2, y2).matrixTransform(matrix); return [a.x, a.y, b.x, b.y]; }) }; });
        const obstacles = [...document.querySelectorAll('svg text, .contact .mark, .hardware-object:not(.expanded) .body')]
            .filter(e => getComputedStyle(e).visibility !== 'hidden' && e.textContent?.trim() || e.matches('.mark,.body')).map(e => e.getBoundingClientRect());
        for (const [x1, y1, x2, y2] of routes.find(r => r.id === id).segments) for (const t of [.5, .3, .7]) {
            const point = { x: x1 + (x2 - x1) * t, y: y1 + (y2 - y1) * t };
            if (point.x < canvas.x + 8 || point.x > canvas.right - 8 || point.y < canvas.y + 8 || point.y > canvas.bottom - 8) continue;
            if (obstacles.some(b => point.x >= b.x - 3 && point.x <= b.right + 3 && point.y >= b.y - 3 && point.y <= b.bottom + 3)) continue;
            const near = routes.filter(r => r.id !== id).some(r => r.segments.some(([a, b, c, d]) => {
                const dx = c - a, dy = d - b, len = dx * dx + dy * dy, u = len ? Math.max(0, Math.min(1, ((point.x - a) * dx + (point.y - b) * dy) / len)) : 0;
                return Math.hypot(point.x - a - u * dx, point.y - b - u * dy) < 6;
            }));
            if (!near && document.elementFromPoint(point.x, point.y)?.closest('[data-semantic-id]')?.dataset.semanticId === id) return point;
        }
        return null;
    }, id);
}

async function runExtra({ session, output, receipt, capture, record }) {
    const { page } = session;
    let state = await sourceFrame(session), original = semantic(state), a = await anchor(page);
    const panelCaptures = [];
    for (const open of [false, true]) {
        await settled(page, () => page.locator('#toggle-inspector').click());
        await page.waitForFunction(open => document.querySelector('#toggle-inspector').getAttribute('aria-expanded') === String(open), open);
        state = await settled(page); const next = await anchor(page); sameAnchor(a, next); a = next;
        assert.deepEqual(semantic(state), original); const name = `J11-inspector-${open ? 'open' : 'closed'}`;
        await capture(name, detailExpected(state)); panelCaptures.push(name);
    }
    await settled(page, () => page.setViewportSize({ width: 960, height: 1000 })); state = await stateOf(page);
    sameAnchor(a, await anchor(page)); assert.deepEqual(semantic(state), original);
    await capture('J11-resized-source', detailExpected(state)); record('J11', { captures: [...panelCaptures, 'J11-resized-source'], semanticHash: hash(original), anchor: await anchor(page) });

    state = await sourceFrame(session); const ref = state.current.analysis.result.sourceRefs.find(r => r.semanticId === state.current.analysis.result.seed.entityId);
    assert.ok(ref); const seen = Promise.withResolvers(), release = Promise.withResolvers(), finished = Promise.withResolvers();
    const handler = async route => { const response = await route.fetch(); seen.resolve(); await release.promise; await route.fulfill({ response }); finished.resolve(); };
    await page.route('**/api/source?*', handler);
    await page.evaluate(() => { window.__readabilitySourceEvents = []; window.addEventListener('hardware:source', e => window.__readabilitySourceEvents.push(e.detail)); });
    await page.locator(`[data-analysis-source-id=${JSON.stringify(ref.id)}]`).first().click();
    await bounded(seen.promise, 'Source response barrier');
    const pendingIdentity = semantic(await stateOf(page));
    await settled(page, () => page.locator('[data-analysis-disclosure-id$=":selected-record"] > summary').click());
    await settled(page, () => page.locator('#toggle-inspector').click()); await settled(page, () => page.locator('#toggle-inspector').click());
    release.resolve(); await finished.promise; await page.unroute('**/api/source?*', handler);
    await page.waitForFunction(id => window.__readabilitySourceEvents.some(e => e.referenceId === id && e.status === 'complete'), ref.id);
    state = await stateOf(page); assert.deepEqual(semantic(state), pendingIdentity);
    assert.equal(state.current.disclosureState.analysis.source.result.text, ref.range.text);
    const sourceEvents = await page.evaluate(() => window.__readabilitySourceEvents);
    assert.ok(!sourceEvents.some(e => e.referenceId === ref.id && e.status === 'cancelled'));
    await page.locator('pre[data-approved-source-id]').scrollIntoViewIfNeeded();
    await capture('J12-source-survived-panel', detailExpected(state)); record('J12', { captures: ['J12-source-survived-panel'], referenceId: ref.id, textHash: hash(ref.range.text), events: sourceEvents });

    const bsv = await stateOf(page), bsvAnchor = await anchor(page); state = await settled(page, () => page.locator('#rtl').click());
    const logic = state.scene.children.find(c => c.type === '$add') || state.scene.storages[0] || state.scene.children[0]; assert.ok(logic);
    await select(page, logic.id); state = await settled(page, () => page.locator('#fit-selection').click()); const rtl = frame(state), rtlCacheKey = state.current.disclosureState.inspector?.key;
    await capture('J13-rtl-selection', detailExpected(state));
    state = await settled(page, () => page.locator('#back').click()); assert.deepEqual(frame(state), frame(bsv));
    await capture('J13-back-source', detailExpected(state));
    state = await settled(page, () => page.locator('#forward').click()); assert.deepEqual(frame(state), rtl);
    const restoredCacheKey = state.current.disclosureState.inspector?.key;
    await settled(page, () => page.setViewportSize({ width: 960, height: 1000 }));
    state = await settled(page, () => page.locator('#back').click()); assert.deepEqual(semantic(state), semantic(bsv)); sameAnchor(bsvAnchor, await anchor(page));
    await capture('J13-resized-back-source', detailExpected(state)); record('J13', { captures: ['J13-rtl-selection', 'J13-back-source', 'J13-resized-back-source'], bsvHash: hash(frame(bsv)), rtlHash: hash(rtl), adaptedAnchor: await anchor(page), inspectorCache: { initial: rtlCacheKey, restored: restoredCacheKey } });

    await reset(session); state = await settled(page, () => page.locator('#rtl').click()); const root = frame(state), rootId = state.scene.shell.id;
    const occurrences = state.scene.children.filter(c => c.kind === 'rtl-occurrence'), left = occurrences.find(c => c.label === 'left'), right = occurrences.find(c => c.label === 'right');
    assert.ok(left && right); assert.notEqual(left.id, right.id);
    await select(page, left.id); const leftFrame = frame(await stateOf(page)); assert.equal(leftFrame.implementationContext.contextOccurrenceId, left.id);
    state = await settled(page, () => page.locator('#back').click()); assert.deepEqual(frame(state), root);
    state = await settled(page, () => page.locator('#forward').click()); assert.deepEqual(frame(state), leftFrame);
    state = await settled(page, () => page.locator('#up').click()); assert.equal(state.scene.shell.id, rootId);
    state = await select(page, right.id); assert.equal(state.scene.shell.id, right.id);
    state = await settled(page, () => page.locator('#up').click()); assert.equal(state.scene.shell.id, rootId);
    const history = state.history.back.length; await settled(page, () => page.locator('#breadcrumb [aria-current="location"]').click(), { changed: false });
    assert.equal((await stateOf(page)).history.back.length, history);
    await capture('J14-rtl-occurrence-root', { fitAll: true }); record('J14', { captures: ['J14-rtl-occurrence-root'], rootId, leftId: left.id, rightId: right.id, dedupHistory: history });

    state = await enter(page, 'left'); const { authority } = await loadCorpus(), facts = authority.get('A');
    assert.deepEqual(validateGeometry(state.scene, state.geometry).findings, []);
    assert.deepEqual(validateMembership(state.scene, { model: facts.models[state.current.provider], architecture: facts.architecture }).findings, []);
    const hits = [];
    for (const route of state.scene.connections.filter(c => c.bits.length)) {
        const point = await wirePoint(page, route.id); if (!point) continue;
        state = await settled(page, () => page.mouse.click(point.x, point.y));
        assert.equal(state.current.selectedRelationId, route.id); assert.equal(state.scene.inspector.connectivity.id, route.id);
        assert.deepEqual(state.scene.inspector.connectivity.bits, route.bits); hits.push({ id: route.id, bits: route.bits, point }); if (hits.length === 2) break;
    }
    assert.equal(hits.length, 2); assert.ok(!hits[0].bits.some(bit => hits[1].bits.includes(bit)));
    const corruptGeometry = structuredClone(state.geometry); corruptGeometry.routes[1].segments = structuredClone(corruptGeometry.routes[0].segments);
    const geometryMutation = validateGeometry(state.scene, corruptGeometry).findings; assert.ok(geometryMutation.some(f => f.kind === 'different-owner-overlap'));
    const corruptScene = structuredClone(state.scene); corruptScene.connections[1].bits = [...corruptScene.connections[0].bits];
    const membershipMutation = validateMembership(corruptScene, { model: facts.models[state.current.provider], architecture: facts.architecture }).findings; assert.ok(membershipMutation.length);
    await capture('J15-distinct-net-hit', { fitAll: true }); record('J15', { captures: ['J15-distinct-net-hit'], hits, V08: { geometryMutation, membershipMutation } });

    await runVisualExtra({ session, output, receipt, capture, record });
    receipt.extraJourneysComplete = true;
}

async function runVisualExtra({ session, output, capture, record }) {
    const { page } = session;
    let state;
    await sourceFrame(session); const themes = [];
    for (const [width, height, theme] of [[1440, 900, 'dark'], [960, 1000, 'light'], [420, 900, 'high-contrast'], [1920, 1080, 'dark'], [420, 1100, 'light']]) {
        if (page.viewportSize().width !== width || page.viewportSize().height !== height) await settled(page, () => page.setViewportSize({ width, height }));
        await page.locator('#theme-select').selectOption(theme); state = await settled(page, () => page.locator('#fit').click());
        const name = `J16-${width}x${height}-${theme}`; await capture(name, { fitAll: true }); themes.push(name);
    }
    record('J16', { captures: themes });
    const motionStates = [], motionCaptures = [];
    for (const motion of ['no-preference', 'reduce']) {
        await page.emulateMedia({ reducedMotion: motion }); await reset(session);
        state = await stateOf(page); const child = state.scene.children.find(c => c.label === 'left');
        await object(page, child.id).focus(); state = await settled(page, () => page.keyboard.press('Enter'));
        assert.equal(state.transition, null);
        if (motion === 'reduce') { assert.equal(state.lastTransition.reducedMotion, true); assert.equal(state.lastTransition.duration, 0); }
        else assert.ok(state.lastTransition.duration > 0);
        const name = `J17-${motion}`; await capture(name, { fitAll: true }); motionCaptures.push(name);
        motionStates.push({ semantic: semantic(state), geometryHash: hash(state.geometry), transition: state.lastTransition ? { kind: state.lastTransition.kind, frames: state.lastTransition.frames.length } : null });
    }
    assert.deepEqual(motionStates[0].semantic, motionStates[1].semantic); assert.equal(motionStates[0].geometryHash, motionStates[1].geometryHash);
    record('J17', { captures: motionCaptures, motionStates }); await page.emulateMedia({ reducedMotion: 'no-preference' });
    record('J18', await runDisplayFixture({ session, capture }));

    await sourceFrame(session); state = await settled(page, () => page.locator('#fit').click());
    const dpr1 = await capture('J19-dpr1', { fitAll: true });
    const context2 = await session.browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
    await context2.tracing.start({ screenshots: true, snapshots: true, sources: true }); const page2 = await context2.newPage(), errors2 = [];
    page2.on('pageerror', error => errors2.push(error.message));
    try {
        await sourceFrame({ page: page2, base: session.base }); await settled(page2, () => page2.locator('#fit').click());
        const dpr2 = await capture('J19-dpr2', { fitAll: true }, page2);
        assert.equal(dpr1.measurement.devicePixelRatio, 1); assert.equal(dpr2.measurement.devicePixelRatio, 2);
        for (const label of dpr1.measurement.labels.filter(l => l.visible && l.role === 'node-title')) {
            const matching = dpr2.measurement.labels.find(l => l.id === label.id); assert.ok(matching?.visible);
            assert.ok(Math.abs(label.effectiveFont - matching.effectiveFont) < .02, 'DPR cannot change CSS-px typography result');
        }
        assert.deepEqual(errors2, []);
        record('J19', { captures: ['J19-dpr1', 'J19-dpr2'], trace: 'trace-dpr2.zip', cssPixelMeasurementIndependentOfDpr: true, pageErrors: errors2 });
    } finally { await context2.tracing.stop({ path: path.join(output, 'trace-dpr2.zip') }); await context2.close(); }

    state = await stateOf(page); const downloadPromise = page.waitForEvent('download'); await page.locator('#export-svg').click();
    const download = await downloadPromise, filename = path.join(output, 'J20-intrinsic.svg'); assert.equal(fs.existsSync(filename), false); await download.saveAs(filename);
    const svg = fs.readFileSync(filename, 'utf8'), exported = await page.evaluate(svg => {
        const document = new DOMParser().parseFromString(svg, 'image/svg+xml'), root = document.documentElement;
        return { metadata: JSON.parse(document.querySelector('metadata').textContent), width: Number(root.getAttribute('width')), height: Number(root.getAttribute('height')),
            worldTransform: document.querySelector('#world').getAttribute('transform'), routes: [...document.querySelectorAll('[data-active="true"] > .route')].map(e => ({ id: e.parentElement.dataset.semanticId, path: e.getAttribute('d') })) };
    }, svg);
    assert.equal(exported.metadata.snapshotId, state.current.snapshotId); assert.equal(exported.worldTransform, null);
    assert.deepEqual(exported.metadata.bounds, state.geometry.bounds);
    assert.deepEqual(exported.metadata.connections.map(c => ({ id: c.id, bits: c.bits })), state.scene.connections.map(c => ({ id: c.id, bits: c.bits })));
    assert.deepEqual(exported.routes, state.geometry.routes.map(r => ({ id: r.id, path: r.path })));
    const exportPage = await session.context.newPage();
    try {
        await exportPage.setViewportSize({ width: Math.ceil(exported.width), height: Math.ceil(exported.height) });
        await exportPage.setContent(`<html><body style="margin:0"><div id="canvas" style="width:${exported.width}px;height:${exported.height}px">${svg}</div></body></html>`);
        await capture('J20-export-intrinsic', { synthetic: true, canonicalScene: state.scene, evidenceKind: 'actual-export-intrinsic', fitAll: true,
            mandatory: [{ ownerId: state.scene.shell.id, role: 'node-title', minFont: 12 }] }, exportPage);
        const measured = await measurePage(exportPage, state.scene); assert.ok(measured.labels.filter(l => l.visible).every(l => l.effectiveFont + 1e-6 >= 9));
        record('J20', { captures: ['J20-export-intrinsic'], export: 'J20-intrinsic.svg', exportSHA256: crypto.createHash('sha256').update(svg).digest('hex'),
            displayScope: exported.metadata.displayScope, labels: exported.metadata.labels.map(l => ({ id: l.id, fullText: l.fullText, visible: l.visible, reason: l.reason })),
            bounds: exported.metadata.bounds, topologyIdentical: true, intrinsicFontMeasurement: true });
    } finally { await exportPage.close(); }
}

module.exports = { runExtra, runVisualExtra };
