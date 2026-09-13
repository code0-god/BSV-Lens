'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { poll } = require('../g6/native-security-attacks.cjs');
const { settled } = require('../g6/development-smoke.cjs');
const { identity } = require('../g6/native-acceptance.cjs');
const { sourceInventory } = require('../g6-discovery-cancel/native.cjs');
const HISTORY_LIMIT = 'Prepared design history reached its bounded limit. Reopen Hardware Schematic to start a new design history.';
async function waitTransition(frame, name, from) {
    const handle = await frame.waitForFunction(({ name, from }) => {
        const state = window.bsvHardware.getState();
        const request = window.__bsvVsixSmoke.posts.slice(from).find(row => row.action === 'choose-design' || row.action === 'discover-workspace');
        const response = request && window.__bsvVsixSmoke.host.find(row => row.kind === 'response'
            && ['requestId', 'action', 'sessionId', 'panelId', 'generation'].every(key => row[key] === request[key]));
        if (response?.error) return { error: response.error, response };
        if (state.error) return { error: state.error };
        return state.scene?.shell.label === name && !state.pending && !state.transition ? { ready: true } : null;
    }, { name, from }, { timeout: 90000 });
    const result = await handle.jsonValue(); await handle.dispose(); return result;
}
function rethrow(error) { throw Object.assign(new Error(error.message || JSON.stringify(error)), { code: error.code }); }
async function viewportFrame(frame) {
    await frame.waitForFunction(() => {
        const state = window.bsvHardware.getState(), view = window.bsvHardware.persistableState().view;
        const svg = document.getElementById('viewport');
        return state.current && !state.pending && !state.transition && view?.viewportSize.width === svg.clientWidth
            && view.viewportSize.height === svg.clientHeight;
    }, null, { timeout: 30000 });
    return frame.evaluate(() => {
        const state = window.bsvHardware.getState(), current = state.current, geometry = state.geometry;
        const saved = window.bsvHardware.persistableState().view, svg = document.getElementById('viewport');
        const id = current.selectedEntityId ?? current.selectedRelationId;
        const node = geometry.nodes.find(row => row.id === id), contact = geometry.contacts.find(row => row.id === id), route = geometry.routes.find(row => row.id === id);
        const anchor = node ? { x: node.x + node.width / 2, y: node.y + node.height / 2 }
            : contact ? { x: contact.x, y: contact.y } : route ? { x: route.labelX, y: route.labelY }
                : { x: geometry.bounds.x + geometry.bounds.width / 2, y: geometry.bounds.y + geometry.bounds.height / 2 };
        return { viewport: current.viewport, fit: current.disclosureState.presentation?.fit || 'structure',
            drawable: { width: svg.clientWidth, height: svg.clientHeight }, bounds: svg.getBoundingClientRect().toJSON(),
            frame: { size: saved.viewportSize, anchor: saved.viewportAnchor }, anchor,
            anchorGeometry: node ? { id: node.id, x: node.x, y: node.y, width: node.width, height: node.height }
                : contact ? { id: contact.id, x: contact.x, y: contact.y }
                    : route ? { id: route.id, labelX: route.labelX, labelY: route.labelY } : { bounds: geometry.bounds },
            identity: { buildId: current.buildId, sceneId: state.scene.id, owner: current.ownerInstanceId,
                selected: current.selectedEntityId, relation: current.selectedRelationId } };
    });
}
function assertViewportPreserved(before, after) {
    assert.deepEqual(after.identity, before.identity); assert.equal(after.fit, before.fit);
    for (const value of [before, after]) {
        assert.deepEqual(value.frame.size, value.drawable, 'Navigation size must match the actual drawable SVG');
        assert.deepEqual(value.frame.anchor, value.anchor, 'Saved viewport anchor must match the observed canonical geometry');
    }
    assert.equal(after.viewport.scale, before.viewport.scale, 'An error banner must not automatically Fit or zoom the scene');
    const sameSize = before.drawable.width === after.drawable.width && before.drawable.height === after.drawable.height;
    const expected = { x: before.viewport.x + (after.drawable.width - before.drawable.width) / 2 + (before.anchor.x - after.anchor.x) * before.viewport.scale,
        y: before.viewport.y + (after.drawable.height - before.drawable.height) / 2 + (before.anchor.y - after.anchor.y) * before.viewport.scale,
        scale: before.viewport.scale };
    if (sameSize) assert.deepEqual(after.viewport, before.viewport, 'Same drawable size requires exact viewport preservation');
    for (const key of ['x', 'y']) assert.ok(Math.abs(after.viewport[key] - expected[key]) < 1e-7, 'Viewport must preserve the semantic anchor across actual SVG resize: ' + key);
    return { policy: sameSize ? 'same-size-exact' : 'observed-anchor-resize', before, after, expected };
}
async function newHistoryAfterLimit({ native, frame, page, target, previous, previousFrame, response, capture, workspace, sourceBefore }) {
    if (response.error?.code !== 'LIMIT_EXCEEDED' || response.error.message !== HISTORY_LIMIT) rethrow(response.error);
    const button = frame.locator('#native-new-history'); await button.waitFor({ state: 'visible' });
    assert.equal(await button.textContent(), 'Open ' + target + ' in a new history');
    assert.match(await frame.locator('#native-history-recovery').textContent(), /previous Back and Forward entries only after the design opens/);
    const held = await capture('history-limit-' + target, previous.scene.shell.label, { recovery: true });
    assert.equal(held.scene.shell.id, previous.scene.shell.id); assert.equal(held.selector.text, previous.scene.shell.label);
    assert.equal(held.selectionTitle, previous.scene.shell.label); assert.notEqual(held.status, HISTORY_LIMIT);
    assert.match(held.status, /history/i);
    const beforeIdentity = identity(previous), heldIdentity = identity(held);
    for (const field of ['buildId', 'snapshotId', 'provider', 'owner', 'occurrence', 'selected', 'relation', 'queryId', 'resultHash'])
        assert.equal(heldIdentity[field], beforeIdentity[field]);
    assert.deepEqual(held.history, previous.history); assert.deepEqual(sourceInventory(workspace), sourceBefore);
    const viewportPreservation = assertViewportPreserved(previousFrame, await viewportFrame(frame));
    const host = await native.channel.request('observeHardware'), panel = held.transport;
    const session = host.sessions.find(row => row.protocol.sessionId === panel.sessionId); assert.ok(session);
    assert.ok(session.state.preparedDesigns <= 8 && session.state.preparedDesignBytes <= 64 * 1024 * 1024);
    assert.equal(session.current.ownerInstanceId, previous.current.ownerInstanceId);
    assert.ok(response.response?.requestId, 'History recovery requires the actual matching Host limit response');
    const failed = await frame.evaluate(id => window.__bsvVsixSmoke.posts.find(row => row.requestId === id), response.response.requestId);
    assert.equal(failed.action, 'choose-design');
    const from = await frame.evaluate(() => window.__bsvVsixSmoke.posts.length);
    await button.click();
    await frame.waitForFunction(from => window.__bsvVsixSmoke.posts.slice(from).some(row => row.action === 'choose-design' && row.payload.newHistory === true), from);
    const intent = await frame.evaluate(from => ({ request: window.__bsvVsixSmoke.posts.slice(from).find(row => row.action === 'choose-design'),
        state: window.bsvHardware.getState(), busy: document.querySelector('#build-select').getAttribute('aria-busy') }), from);
    assert.deepEqual(intent.request.payload, { entryId: failed.payload.entryId, newHistory: true });
    const observedPending = intent.busy === 'true' && intent.state.scene?.shell.label !== target;
    if (observedPending) {
        assert.equal(intent.state.scene.shell.id, previous.scene.shell.id);
        assert.equal(intent.state.current.ownerInstanceId, previous.current.ownerInstanceId);
        assert.deepEqual(intent.state.history, previous.history);
    }
    const result = await waitTransition(frame, target, from);
    if (result.error) rethrow(result.error);
    const state = await settled(frame), currentPanel = await frame.evaluate(() => window.BsvHardwareTransport.identity());
    assert.equal(currentPanel.sessionId, panel.sessionId); assert.equal(currentPanel.panelId, panel.panelId);
    assert.ok(currentPanel.generation > panel.generation, 'New-history candidate must advance the validated model generation');
    assert.equal(state.scene.shell.label, target); assert.equal(state.current.ownerInstanceId, state.scene.shell.id);
    assert.deepEqual(state.history, { back: [], forward: [] }); assert.notEqual(state.current.buildId, previous.current.buildId);
    assert.equal(state.current.analysis ?? null, null); assert.equal(state.current.selectedEntityId, null);
    const committed = await poll(() => native.channel.request('observeHardware'), value => value.sessions.some(row =>
        row.protocol.sessionId === panel.sessionId && row.current?.buildId === state.current.buildId && row.state.preparedDesigns === 1),
        'Explicit new-history target commit and cache release');
    const next = committed.sessions.find(row => row.protocol.sessionId === panel.sessionId);
    assert.equal(next.current.ownerInstanceId, state.current.ownerInstanceId);
    assert.equal(next.state.pendingInputIdentity, null); assert.ok(next.state.preparedDesignBytes <= 64 * 1024 * 1024);
    assert.equal(await button.isVisible(), false); assert.deepEqual(sourceInventory(workspace), sourceBefore);
    const detail = { requestedRoot: target, reason: response.error, configuredCap: { designs: 8, bytes: 64 * 1024 * 1024 },
        retained: { before: beforeIdentity, after: heldIdentity, viewportPreservation, message: held.status, preparedDesigns: session.state.preparedDesigns,
            preparedDesignBytes: session.state.preparedDesignBytes }, explicitIntent: intent.request,
        pendingObserved: observedPending, pendingOwner: observedPending ? intent.state.current.ownerInstanceId : null,
        sameSession: currentPanel.sessionId, samePanel: currentPanel.panelId, recovered: identity(state), recoveredHistory: state.history,
        preparedAfter: { designs: next.state.preparedDesigns, bytes: next.state.preparedDesignBytes },
        sourcePreserved: true, historyReset: 'Explicit user action; Back and Forward cleared only on successful target commit.',
        userAction: 'Click the visible Open ' + target + ' in a new history button. No close, memento edit or implicit cache eviction.' };
    fs.writeFileSync(path.join(native.output, 'history-reset-' + target + '.json'), JSON.stringify(detail, null, 2) + '\n', { flag: 'wx' });
    await native.capture('history-reset-' + target, page); await native.traceCheckpoint('history-reset-' + target);
    return { state, detail };
}
module.exports = { HISTORY_LIMIT, waitTransition, newHistoryAfterLimit, rethrow, viewportFrame, assertViewportPreserved };
