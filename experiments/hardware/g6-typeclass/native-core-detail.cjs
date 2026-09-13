'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { settled, chooseObject } = require('../g6/development-smoke.cjs');
const { identity, analyze, sourceReveal } = require('../g6/native-acceptance.cjs');
async function coreDetail({ native, frame, workspace, inside, capture }) {
    assert.equal(inside.scene.projection.stateRelations?.mode, 'on-selection');
    const storage = inside.scene.storages.find(row => row.label === 'commandReg'); assert.ok(storage);
    await chooseObject(frame, storage.id); let selected = await settled(frame);
    assert.equal(selected.current.selectedEntityId, storage.id);
    assert.equal(selected.scene.projection.stateRelations.selectedId, storage.id);
    assert.deepEqual(selected.scene.projection.canonicalRelationIds, inside.scene.projection.canonicalRelationIds);
    const stateConnections = selected.scene.connections.filter(row => ['state-read', 'state-write'].includes(row.relationFamily));
    assert.ok(stateConnections.length > 0, 'Selected storage must disclose its actual state relationships');
    assert.ok(stateConnections.every(row => row.endpointIds.includes(storage.id)));
    const beforeFit = { viewport: selected.current.viewport, fit: selected.current.disclosureState.presentation?.fit,
        history: selected.history, selected: selected.current.selectedEntityId };
    await frame.locator('#fit-selection').click(); selected = await settled(frame);
    assert.equal(selected.current.disclosureState.presentation.fit, 'selection');
    assert.equal(selected.current.selectedEntityId, storage.id); assert.deepEqual(selected.history, beforeFit.history);
    const visibility = await frame.evaluate(ids => {
        const canvas = document.getElementById('viewport').getBoundingClientRect();
        const inside = point => point.x > canvas.left + 1 && point.x < canvas.right - 1
            && point.y > canvas.top + 1 && point.y < canvas.bottom - 1;
        return { canvas: canvas.toJSON(), status: document.getElementById('display-status').textContent,
            routes: ids.map(id => {
                const route = [...document.querySelectorAll('[data-active="true"] > .route')]
                    .find(node => node.parentElement.dataset.semanticId === id);
                if (!route) return { id, exists: false };
                const matrix = route.getScreenCTM(), length = route.getTotalLength(), style = getComputedStyle(route);
                const points = Array.from({ length: 513 }, (_, index) => length * index / 512);
                for (let offset = 0; offset <= 128; offset += 4) points.push(Math.min(length, offset), Math.max(0, length - offset));
                let sample = null, displayed = style.stroke !== 'none' && Number(style.strokeOpacity) > 0 && parseFloat(style.strokeWidth) > 0;
                for (let node = route; node; node = node.parentElement) {
                    const css = getComputedStyle(node);
                    if (css.display === 'none' || css.visibility === 'hidden' || Number(css.opacity) <= .01) displayed = false;
                }
                for (const at of points) {
                    const point = route.getPointAtLength(at).matrixTransform(matrix);
                    if (!inside(point)) continue;
                    const hit = document.elementFromPoint(point.x, point.y)?.closest('[data-semantic-id]')?.dataset.semanticId;
                    if (hit === id) { sample = { at, x: point.x, y: point.y, hit }; break; }
                }
                return { id, exists: true, path: route.getAttribute('d'), length, sample,
                    displayed, stroke: style.stroke, strokeOpacity: style.strokeOpacity, strokeWidth: style.strokeWidth };
            }),
            outsideNodes: [...document.querySelectorAll('[data-active="true"] > .body')].filter(node => {
                const box = node.getBoundingClientRect();
                return box.left < canvas.left || box.top < canvas.top || box.right > canvas.right || box.bottom > canvas.bottom;
            }).length };
    }, stateConnections.map(row => row.id));
    assert.ok(visibility.routes.every(row => row.exists && row.displayed && row.sample), 'Each related state route needs a visible hit-testable fragment');
    assert.match(visibility.status, /Selection detail/);
    if (visibility.outsideNodes) assert.match(visibility.status, /Outside: \d+ blocks, \d+ route continuations/);
    for (const row of visibility.routes) assert.equal(row.path, selected.geometry.routes.find(route => route.id === row.id)?.path);
    fs.writeFileSync(path.join(native.output, 'core-selection-scope.json'), JSON.stringify({ beforeFit, current: selected.current,
        visibility }, null, 2) + '\n', { flag: 'wx' });
    await capture('core-selected-state-connections');
    selected = await analyze(frame, 'state-accesses'); const accesses = identity(selected);
    assert.ok(selected.current.analysis.result.writers.length);
    assert.equal(selected.current.disclosureState.presentation.fit, 'selection');
    await frame.locator('[data-code-section="writer"] [data-analysis-kind="behavior"]').first().click();
    await frame.waitForFunction(() => window.bsvHardware.getState().current.analysis?.result.kind === 'behavior');
    selected = await settled(frame);
    const referenceId = await frame.locator('#code-drawer pre[data-source-reference-id]').first().getAttribute('data-source-reference-id');
    const reference = selected.current.analysis.result.sourceRefs.find(row => row.id === referenceId); assert.ok(reference);
    const sourcePath = fs.realpathSync(path.resolve(workspace, reference.pathRef));
    assert.ok(!path.relative(workspace, sourcePath).startsWith('..'));
    const reveal = await sourceReveal({ native, frame, referenceId, fixture: { sourceFiles: [{ pathRef: reference.pathRef, path: sourcePath }] } });
    await capture('core-state-writer-source');
    await frame.locator('#back').click(); selected = await settled(frame); const restored = identity(selected);
    for (const field of ['buildId', 'owner', 'selected', 'queryId', 'resultHash']) assert.equal(restored[field], accesses[field]);
    assert.equal(selected.current.disclosureState.presentation.fit, 'selection');
    await capture('core-state-source-back');
    let visits = 0;
    while (selected.history.back.length > inside.history.back.length) {
        assert.ok(++visits <= 8, 'Source analysis restoration exceeded its bounded history');
        await frame.locator('#back').click(); selected = await settled(frame);
    }
    assert.equal(selected.scene.shell.id, inside.scene.shell.id);
    return { storage: { id: storage.id, label: storage.label }, canonicalRelations: inside.scene.projection.canonicalRelationIds.length,
        foldedStateRelations: inside.scene.projection.stateRelations.foldedRelationIds.length,
        selectedConnections: stateConnections.map(row => ({ id: row.id, family: row.relationFamily, members: row.memberRelationIds })),
        explicitFit: { before: beforeFit, visibility, sourceBackFit: 'selection' }, reveal, accesses, restored };
}
module.exports = { coreDetail };
