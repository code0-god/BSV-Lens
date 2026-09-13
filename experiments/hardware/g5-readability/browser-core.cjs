'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { reset, settled, enter, select, analyze, object } = require('./browser-helpers.cjs');
const get = page => page.evaluate(() => window.bsvHardware.getState());
const identity = state => ({ snapshot: state.current.snapshotId, provider: state.current.provider,
    owner: state.current.ownerInstanceId, occurrence: state.current.implementationContext,
    selection: state.current.selectedEntityId, relation: state.current.selectedRelationId, analysis: state.current.analysis });

async function stateAnalysis(session) {
    await reset(session); await enter(session.page, 'left');
    const state = await get(session.page), storage = state.scene.storages.find(item => item.label === 'state');
    await select(session.page, storage.id); await analyze(session.page, 'state-accesses');
    return storage;
}

async function dependency(session) {
    const { page } = session;
    await reset(session, 'B'); let state = await settled(page, () => page.locator('#rtl').click());
    const cell = state.scene.children.find(item => item.type === '$add'); await select(page, cell.id);
    state = await get(page); const pin = state.scene.contacts.find(item => item.ownerId === cell.id && item.label === 'Y');
    await page.locator(`[data-analysis-pin-id=${JSON.stringify(pin.id)}]`).click();
    const before = await get(page); state = await analyze(page, 'dependencies', 'backward');
    assert.deepEqual(state.current.viewport, before.current.viewport, 'Analysis must not auto-fit');
    return cell;
}

async function runCore({ session, output, receipt, capture, record }) {
    const { page } = session;
    let storage = await stateAnalysis(session), state;
    const captures = [];
    for (const [width, theme, motion] of [[1440, 'dark', 'no-preference'], [960, 'light', 'no-preference'], [420, 'high-contrast', 'reduce']]) {
        await page.emulateMedia({ reducedMotion: motion });
        if (page.viewportSize().width !== width || page.viewportSize().height !== 900)
            await settled(page, () => page.setViewportSize({ width, height: 900 }));
        await page.locator('#theme-select').selectOption(theme); state = await settled(page, () => page.locator('#fit').click());
        const mandatory = [{ ownerId: state.scene.shell.id, role: 'node-title', text: 'left' },
            { ownerId: storage.id, role: 'node-title', text: 'state', minFont: 12 },
            ...state.scene.contacts.filter(item => ['put', 'get'].includes(item.label)).map(item => ({ ownerId: item.id, text: item.label }))];
        const name = `J01-left-${width}-${theme}`;
        await capture(name, { mandatory, fitAll: true }); captures.push(name);
    }
    await page.locator('#code-drawer pre[data-source-reference-id]').first().scrollIntoViewIfNeeded();
    await capture('J01-source-420', { fitAll: true }); captures.push('J01-source-420');
    record('J01', { captures, reproduction: 'Original three-width state-accesses/Fit sequence; 420 is browser viewport CSS width.' });

    await reset(session); await page.emulateMedia({ reducedMotion: 'no-preference' });
    state = await settled(page, () => page.locator('#rtl').click());
    await select(page, state.scene.contacts.find(item => item.ownerId === state.scene.shell.id && item.label === 'get').id);
    await analyze(page, 'same-net');
    const seen = Promise.withResolvers(), release = Promise.withResolvers(), finished = Promise.withResolvers();
    let held = false;
    const handler = async route => {
        if (held) return route.continue(); held = true;
        const response = await route.fetch(); seen.resolve(); await release.promise; await route.fulfill({ response }); finished.resolve();
    };
    await page.route('**/api/analysis?*', handler);
    await page.locator('[data-analysis-kind="drivers-loads"]').first().click(); await seen.promise;
    state = await settled(page, () => page.locator('#provider-select').selectOption('instrumented'));
    const instrumented = state.current;
    release.resolve(); await finished.promise; await page.unroute('**/api/analysis?*', handler);
    assert.deepEqual((await get(page)).current, instrumented);
    assert.equal(instrumented.selectedEntityId, null); assert.equal(instrumented.analysis ?? null, null);
    await capture('J02-original-J11', { fitAll: true });
    record('J02', { captures: ['J02-original-J11'], provider: instrumented.provider, occurrence: instrumented.implementationContext });

    await reset(session); const overviews = [];
    assert.match(await page.locator('#readability-context').textContent(), /Current module:/);
    assert.equal(await page.locator('#fit-selection').isDisabled(), true);
    for (const [width, height] of [[1440, 900], [1920, 1080], [360, 800]]) {
        if (page.viewportSize().width !== width || page.viewportSize().height !== height) {
            const started = performance.now(); await settled(page, () => page.setViewportSize({ width, height }));
            receipt.timings.push({ action: 'resize-settled', width, height, milliseconds: performance.now() - started });
        }
        const started = performance.now(); await settled(page, () => page.locator('#fit').click());
        receipt.timings.push({ action: 'fit-structure-settled', milliseconds: performance.now() - started });
        const name = `J03-overall-${width}`; await capture(name, { fitAll: true }); overviews.push(name);
    }
    record('J03', { captures: overviews });

    await reset(session); await page.emulateMedia({ reducedMotion: 'no-preference' });
    state = await get(page); const left = state.scene.children.find(item => item.label === 'left');
    await capture('J04-start', { fitAll: true });
    await page.evaluate(() => {
        window.__readabilityMotion = [];
        window.__readabilityMotionListener = event => window.__readabilityMotion.push({ progress: event.detail.progress,
            labels: [...document.querySelectorAll('#viewport text')].map(element => ({ text: element.textContent,
                owner: element.closest('[data-semantic-id]')?.dataset.semanticId,
                bounds: { x: element.getBoundingClientRect().x, y: element.getBoundingClientRect().y,
                    width: element.getBoundingClientRect().width, height: element.getBoundingClientRect().height } })) });
        window.addEventListener('hardware:transition-frame', window.__readabilityMotionListener);
    });
    const body = object(page, left.id).locator('.body'), bounds = await body.boundingBox();
    await body.click({ position: { x: bounds.width - 10, y: 12 } });
    await page.waitForFunction(() => document.getAnimations().some(animation => {
        const progress = animation.effect.getComputedTiming().progress; return progress > 0.15 && progress < 0.85;
    }));
    await page.screenshot({ path: path.join(output, 'J04-mid.png'), animations: 'allow' });
    await settled(page); const motion = await page.evaluate(() => {
        window.removeEventListener('hardware:transition-frame', window.__readabilityMotionListener); return window.__readabilityMotion;
    });
    assert.ok(motion.some(frame => frame.progress > 0 && frame.progress < 1));
    fs.writeFileSync(path.join(output, 'J04-motion.json'), JSON.stringify(motion, null, 2) + '\n', { flag: 'wx' });
    state = await get(page); assert.equal(state.scene.shell.id, left.id);
    await capture('J04-left', { fitAll: true, mandatory: [
        { ownerId: left.id, role: 'node-title', text: 'left', minFont: 12 },
        ...state.scene.storages.map(item => ({ ownerId: item.id, text: 'state', minFont: 12 })),
        ...state.scene.contacts.filter(item => ['put', 'get'].includes(item.label)).map(item => ({ ownerId: item.id, text: item.label, minFont: 12 }))] });
    record('J04', { captures: ['J04-start', 'J04-left'], motion: { frames: 'J04-motion.json', mid: 'J04-mid.png' } });

    await reset(session, 'B'); state = await get(page);
    await select(page, state.scene.storages.find(item => item.label === 'count').id); state = await analyze(page, 'state-accesses');
    const increment = state.current.analysis.result.writers.find(item => item.name === 'increment');
    await settled(page, () => page.locator(`[data-code-section="writer"] [data-analysis-entity-id=${JSON.stringify(increment.id)}]`).click());
    await capture('J05-B-source', { fitAll: true });
    const logic = await dependency(session);
    await settled(page, () => page.locator('#fit').click()); await capture('J05-B-overview', { fitAll: true });
    const previous = identity(await get(page));
    await settled(page, () => page.locator('#fit-selection').click());
    const detail = await capture('J05-B-selection', { mandatory: [{ ownerId: logic.id, role: 'node-title', minFont: 12 }] });
    assert.deepEqual(identity(detail.state), previous);
    record('J05', { captures: ['J05-B-source', 'J05-B-overview', 'J05-B-selection'], selected: logic.id });

    const reuse = [];
    for (const [name, width] of [['narrow', 8], ['wide', 12]]) {
        await reset(session, 'C'); await enter(page, name); state = await enter(page, 'implementation');
        await select(page, state.scene.storages[0].id); await analyze(page, 'state-accesses');
        await capture(`J06-${name}-source`, { fitAll: true });
        state = await settled(page, () => page.locator('#rtl').click());
        assert.equal(state.current.implementationContext.occurrencePath.at(-1), name);
        const port = state.scene.contacts.find(item => item.ownerId === state.scene.shell.id && item.label === 'get');
        assert.equal(port.bits.length, width); await select(page, port.id); await analyze(page, 'same-net');
        await capture(`J06-${name}-rtl`, { fitAll: true });
        reuse.push({ name, width, occurrence: state.current.implementationContext });
    }
    record('J06', { captures: ['J06-narrow-source', 'J06-narrow-rtl', 'J06-wide-source', 'J06-wide-rtl'], reuse });

    storage = await stateAnalysis(session); const zoomBefore = await get(page), zoomIdentity = identity(zoomBefore), levels = [];
    const canvas = await page.locator('#viewport').boundingBox();
    await page.mouse.move(canvas.x + canvas.width / 2, canvas.y + canvas.height / 2);
    await page.evaluate(() => {
        window.__readabilityFrameTimes = []; window.__readabilityFrameRun = true;
        const frame = time => {
            if (!window.__readabilityFrameRun) return;
            if (window.__readabilityFrameTimes.length < 2048) window.__readabilityFrameTimes.push(time);
            requestAnimationFrame(frame);
        }; requestAnimationFrame(frame);
    });
    const timings = [];
    for (const delta of [...Array(9).fill(80), ...Array(9).fill(-80)]) {
        const start = performance.now(); state = await settled(page, () => page.mouse.wheel(0, delta));
        timings.push(performance.now() - start); levels.push(state.runtime.readability.level);
        assert.deepEqual(identity(state), zoomIdentity); assert.equal(state.history.back.length, zoomBefore.history.back.length);
    }
    assert.ok(levels.includes('overview') && levels.some(level => level !== 'overview'));
    assert.ok(levels.filter((level, i) => i && level !== levels[i - 1]).length <= 4, 'Unstable zoom detail boundary');
    await capture('J07-zoom-restored');
    const frameIntervals = await page.evaluate(() => {
        window.__readabilityFrameRun = false;
        return window.__readabilityFrameTimes.slice(1).map((time, i) => time - window.__readabilityFrameTimes[i]);
    });
    receipt.timings.push({ action: 'wheel-zoom', milliseconds: timings, rafIntervalsMs: frameIntervals });
    record('J07', { captures: ['J07-zoom-restored'], levels, history: zoomBefore.history.back.length });

    const fitBefore = await get(page), fitting = [];
    for (const id of ['fit', 'fit-selection']) {
        const started = performance.now(); await settled(page, () => page.locator(`#${id}`).click()); const first = await get(page);
        receipt.timings.push({ action: `${id}-settled`, milliseconds: performance.now() - started,
            labelPreparationMs: first.runtime.readability.preparationMs, candidates: first.runtime.readability.candidateCount });
        await settled(page, () => page.locator(`#${id}`).click()); const second = await get(page);
        assert.deepEqual(second.current.viewport, first.current.viewport);
        assert.deepEqual(identity(second), identity(fitBefore)); assert.equal(second.history.back.length, fitBefore.history.back.length);
        fitting.push({ action: id, viewport: second.current.viewport, presentation: second.current.disclosureState.presentation });
    }
    await capture('J08-selection', { mandatory: [{ ownerId: storage.id, role: 'node-title', minFont: 12 }] });
    record('J08', { captures: ['J08-selection'], fitting });

    await reset(session); state = await get(page);
    const rootPort = state.scene.contacts.find(item => item.ownerId === state.scene.shell.id && item.label === 'get');
    await select(page, rootPort.id); state = await get(page); assert.equal(state.current.selectedEntityId, rootPort.id);
    const relation = state.geometry.routes.find(route => route.segments.some(segment => Math.hypot(segment[2] - segment[0], segment[3] - segment[1]) > 60));
    const segment = relation.segments.toSorted((a, b) => Math.hypot(b[2] - b[0], b[3] - b[1]) - Math.hypot(a[2] - a[0], a[3] - a[1]))[0];
    const point = await object(page, relation.id).locator('.route').evaluate((element, segment) => {
        const p = new DOMPoint((segment[0] + segment[2]) / 2, (segment[1] + segment[3]) / 2).matrixTransform(element.getScreenCTM()); return { x: p.x, y: p.y };
    }, segment);
    await page.mouse.click(point.x, point.y);
    if (await page.locator('#wire-choices').isVisible()) await page.locator(`[data-connection-id=${JSON.stringify(relation.id)}]`).click();
    state = await settled(page); assert.equal(state.current.selectedRelationId, relation.id);
    const label = await object(page, state.scene.children.find(item => item.label === 'left').id).locator('.title').boundingBox();
    await page.mouse.click(label.x + label.width / 2, label.y + label.height / 2); state = await settled(page);
    assert.equal(state.scene.shell.label, 'left'); await select(page, state.scene.storages[0].id);
    await capture('J09-click-targets', { fitAll: true });
    record('J09', { captures: ['J09-click-targets'], port: rootPort.id, connection: relation.id, labelEntered: state.scene.shell.id });

    const selected = await dependency(session), result = (await get(page)).current.analysis;
    await settled(page, () => page.locator('#fit-selection').click());
    await capture('J10-dependency-detail', { mandatory: [{ ownerId: selected.id, role: 'node-title', minFont: 12 }] });
    await settled(page, () => page.locator('#fit').click()); state = await get(page);
    assert.deepEqual(state.current.analysis, result);
    await capture('J10-structure-return', { fitAll: true });
    record('J10', { captures: ['J10-dependency-detail', 'J10-structure-return'], resultId: result.result.id, scope: result.request.scope });
}

module.exports = { runCore, stateAnalysis, dependency, identity };
