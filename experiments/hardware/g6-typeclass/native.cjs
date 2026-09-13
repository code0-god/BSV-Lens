#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { pathToFileURL } = require('node:url');
const { launchNative } = require('../g6/native-driver.cjs');
const { createRun } = require('../g6/run.cjs');
const { settled } = require('../g6/development-smoke.cjs');
const { identity } = require('../g6/native-acceptance.cjs');
const { coreDetail } = require('./native-core-detail.cjs');
const { waitTransition, newHistoryAfterLimit, viewportFrame } = require('./native-history.cjs');
const { measureNative, validateNativeTypography, mandatoryFor } = require('../g6/native-oracle.cjs');
const LABEL_AUTHORITY = require('./native-label-authority.json');
const { sourceInventory } = require('../g6-discovery-cancel/native.cjs');
const ROOT = path.resolve(__dirname, '../../..');
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const save = (output, name, value) => fs.writeFileSync(path.join(output, name), JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
const position = (text, offset) => { const lines = text.slice(0, offset).split('\n'); return { line: lines.length - 1, character: lines.at(-1).length }; };
const ROOTS = ['mkPE', 'mkSystolicArrayA16W16D64', 'mkVectorUnit', 'mkIM2PCore', 'mkDensePipeline', 'mkFullReplay', 'mkSynthA8W8D16', 'mkExecuteController'];
async function run({ mode, vsix, workspace, output = createRun('typeclass-native-' + mode) }) {
    assert.ok(['before', 'after'].includes(mode)); workspace = fs.realpathSync(workspace);
    const before = sourceInventory(workspace); save(output, 'source-before.json', before);
    if (mode === 'after') assert.equal(before.files.find(row => row.path === LABEL_AUTHORITY.source.path)?.sha256, LABEL_AUTHORITY.source.sha256,
        'Independent core label authority requires its original source revision');
    save(output, 'label-authority.json', LABEL_AUTHORITY);
    const report = { schema: 'g6-typeclass-native-v1', mode, status: 'running', startedAt: new Date().toISOString(), workspace,
        vsix, vsixSha256: sha(fs.readFileSync(vsix)), input: { sourceFiles: before.bsvFiles, fingerprint: before.fingerprint }, steps: [],
        boundary: 'Actual installed extension; real native command, QuickPick, root selector and pointer actions. Read-only actual IM2P sources; no model injection or compiler.' };
    save(output, 'contract.json', report);
    let native, page, frame, expectedOwnerName = null;
    report.typography = []; report.historyResets = [];
    report.panelPolicy = 'Same panel and session throughout. Only the exact prepared-history limit permits the explicit Open design in a new history action; each successful user-authorized history reset is reported separately.';
    report.typographyContract = { minimumVisibleCssPx: 9, selectedNodeCssPx: 12, source: 'Independent browser DOM/transform/glyph oracle; core child mandatory set is hash-bound historical canonical Scene, not renderer visible labels.', otherChildren: 'Canonical scene children and their registered source references, independent of geometry and label visibility.' };
    async function capture(name, ownerName = expectedOwnerName, { recovery = false } = {}) {
        const dom = await frame.evaluate(() => {
            const state = window.bsvHardware.getState(), item = value => ({ id: value.id, kind: value.kind, label: value.label,
                secondaryLabel: value.secondaryLabel, primitiveKind: value.primitiveKind, interaction: value.interaction, sourceRefs: value.sourceRefs });
            return { transport: window.BsvHardwareTransport.identity(), title: document.querySelector('#scene-title').textContent,
                selector: { value: document.querySelector('#build-select').value, text: document.querySelector('#build-select').selectedOptions[0]?.textContent },
                status: document.querySelector('#native-input-status').textContent, footer: document.querySelector('#status').textContent,
                inspector: document.querySelector('#inspector').innerText, selectionTitle: document.querySelector('#selection-title').textContent, current: state.current, error: state.error,
                pending: state.pending, history: state.history, scene: state.scene && { sceneKind: state.scene.sceneKind,
                    shell: item(state.scene.shell), children: state.scene.children.map(item), storages: state.scene.storages.map(item),
                    inspector: { title: state.scene.inspector.title },
                    projection: state.scene.projection, connectionIds: state.scene.connections.map(row => row.id) },
                geometry: state.geometry && { bounds: state.geometry.bounds, routing: state.geometry.routing,
                    routes: state.geometry.routes.map(row => ({ id: row.id, path: row.path })) },
                posts: window.__bsvVsixSmoke.posts.map(row => ({ action: row.action, requestId: row.requestId, generation: row.generation })),
                host: window.__bsvVsixSmoke.host.map(row => ({ action: row.action, requestId: row.requestId, kind: row.kind,
                    generation: row.generation, status: row.status, error: row.error })) };
        });
        save(output, name + '.dom.json', dom);
        const host = await native.channel.request('observeHardware'); save(output, name + '.host.json', host);
        if (mode === 'after' && dom.scene && !dom.error && !dom.pending) {
            assert.equal(host.activePanels, 1); assert.equal(dom.transport.sessionId, report.panel.sessionId);
            assert.equal(host.sessions[0].protocol.sessionId, report.panel.sessionId);
            assert.equal(host.sessions[0].current.ownerInstanceId, dom.scene.shell.id);
            assert.equal(host.sessions[0].current.buildId, dom.current.buildId);
            assert.equal(host.sessions[0].current.sourceRevision, dom.current.sourceRevision);
        }
        let typography = null;
        if (mode === 'after' && dom.scene && !dom.error && !dom.pending) {
            assert.ok(ownerName, 'Expected module name must come from the requested root or canonical entered child');
            let children = dom.scene.children.map(child => child.label);
            for (const child of dom.scene.children) for (const ref of child.sourceRefs || []) {
                assert.equal(before.files.find(row => row.path === ref.pathRef)?.sha256, ref.revision,
                    'Mandatory child must retain registered original source evidence: ' + child.label);
            }
            if (dom.scene.shell.id === LABEL_AUTHORITY.ownerId) {
                assert.equal(dom.scene.shell.label, LABEL_AUTHORITY.ownerLabel);
                const expected = LABEL_AUTHORITY.children.map(row => ({ id: row.id, label: row.name }));
                assert.deepEqual(dom.scene.children.map(row => ({ id: row.id, label: row.label })), expected);
                children = LABEL_AUTHORITY.children.map(row => row.name);
            }
            await frame.evaluate(async () => { await document.fonts.ready; await window.bsvHardware.whenSettled(); });
            await page.mouse.move(3, 3);
            const measurement = await measureNative({ native, frame, page });
            const detail = dom.current.disclosureState.presentation?.fit === 'selection';
            const selected = [dom.scene.shell, ...dom.scene.children, ...dom.scene.storages].find(row => row.id === dom.current.selectedEntityId);
            if (detail) assert.ok(selected, 'Selection-fit capture requires the canonical selected module or storage');
            const expectations = recovery ? { mandatory: [
                { id: 'readability-context', text: dom.current.occurrencePath.join('.'), minFont: 12 }
            ], root: false, children: [], selected: false, allowOverviewAbbreviation: true, recovery: true }
                : detail ? { mandatory: [
                { id: 'readability-context', text: dom.current.occurrencePath.join('.'), minFont: 12 },
                { ownerId: selected.id, role: 'node-title', text: selected.label, minFont: 12 }
            ], root: false, children: [], selected: true, allowOverviewAbbreviation: false }
                : { root: ownerName, children, selected: true, allowOverviewAbbreviation: true };
            if (!recovery && !detail) expectations.mandatory = [...mandatoryFor(dom, expectations),
                ...dom.scene.storages.filter(item => ['memory', 'fifo'].includes(item.primitiveKind)).map(item =>
                    ({ ownerId: item.id, role: 'node-title', text: item.label, minFont: 9 }))];
            typography = validateNativeTypography(dom, measurement, expectations);
            save(output, name + '.measurement.json', measurement);
            save(output, name + '.typography.json', { expectations, ...typography });
            report.typography.push({ name, findings: typography.findings, mandatory: expectations,
                minimumVisibleCssPx: Math.min(...measurement.labels.filter(row => row.visible).map(row => row.effectiveFont)) });
        }
        await native.capture(name, page); await native.traceCheckpoint(name);
        console.log('NATIVE_CHECKPOINT', name);
        if (typography) assert.deepEqual(typography.findings, [], 'Native typography/mandatory-label failure: ' + name);
        return dom;
    }
    const chooser = async name => {
        await page.locator('.quick-input-title').filter({ hasText: 'Choose a source design' }).waitFor({ state: 'visible', timeout: 90000 });
        await page.locator('.quick-input-widget input').fill(name);
        await native.nativeInput({ choice: name }, page);
        await page.locator('.quick-input-widget').waitFor({ state: 'hidden' });
    };
    const waitRoot = async name => {
        await frame.waitForFunction(name => {
            const state = window.bsvHardware.getState();
            if (state.error) throw new Error(JSON.stringify(state.error));
            return state.scene?.shell.label === name && !state.pending && !state.transition;
        }, name, { timeout: 90000 }); return settled(frame);
    };
    try {
        native = await launchNative({ vsix, workspace, output, restricted: true,
            observerVsix: path.join(ROOT, '.build/hardware/runs/g6-observer-resources-final-xQD0Ig/g6/bsv-lens-g6-observer-0.0.1.vsix'),
            harnessFiles: [__filename, path.join(__dirname, 'native-label-authority.json'), path.join(__dirname, 'native-core-detail.cjs'), path.join(__dirname, 'native-history.cjs'), path.join(__dirname, '../g6-discovery-cancel/native.cjs')] });
        page = native.context.pages()[0];
        const untrusted = page.getByRole('button', { name: "No, I don't trust the authors", exact: true });
        if (await untrusted.isVisible()) await untrusted.click();
        assert.equal((await native.channel.request('observeEditors')).trusted, false);
        await native.channel.request('openProductCommand', { command: 'bsvArchitecture.openHardwareSchematic' });
        ({ page, frame } = await native.findWebview());
        await frame.waitForFunction(() => !!window.BsvHardwareTransport.identity());
        report.panel = await frame.evaluate(() => window.BsvHardwareTransport.identity());
        if (mode === 'before') {
            for (const [index, name] of ['mkPE', 'mkVectorUnit'].entries()) {
                if (index) {
                    await native.channel.request('uiCommand', { command: 'workbench.action.closeActiveEditor' });
                    await native.channel.request('openProductCommand', { command: 'bsvArchitecture.openHardwareSchematic' });
                    ({ page, frame } = await native.findWebview());
                    await frame.waitForFunction(() => !!window.BsvHardwareTransport.identity());
                }
                await chooser(name);
                await frame.waitForFunction(() => document.querySelector('#native-input-status').textContent.includes('Duplicate semantic definition'), null, { timeout: 90000 });
                const evidence = await capture('before-' + name);
                assert.match(evidence.status, /Duplicate semantic definition across source documents/);
                assert.equal(evidence.scene, null);
                report.steps.push({ root: name, status: 'reproduced', error: evidence.status });
            }
        } else {
            await chooser(ROOTS[0]);
            for (const [index, name] of ROOTS.entries()) {
                let entryMethod = index ? 'same-panel-selector' : 'initial-quick-pick';
                if (index) {
                    const previousFrame = await viewportFrame(frame), previous = await settled(frame), from = await frame.evaluate(() => window.__bsvVsixSmoke.posts.length);
                    const options = await frame.locator('#build-select option').evaluateAll(nodes => nodes.map(node => ({ value: node.value, label: node.textContent })));
                    const option = options.filter(row => row.value.startsWith('design:') && row.label === name);
                    assert.equal(option.length, 1, 'Unique actual root selector entry required: ' + name);
                    await frame.locator('#build-select').selectOption(option[0].value);
                    const outcome = await waitTransition(frame, name, from);
                    if (outcome.error) {
                        const reset = await newHistoryAfterLimit({ native, frame, page, target: name, previous, previousFrame, response: outcome, capture, workspace, sourceBefore: before });
                        report.historyResets.push(reset.detail);
                        entryMethod = 'explicit-new-history';
                    }
                }
                expectedOwnerName = name;
                let state = await waitRoot(name), original = identity(state);
                assert.equal(state.scene.sceneKind, 'bsv'); assert.equal(state.current.snapshotId, null);
                const scene = await capture('after-' + name);
                assert.equal(scene.selector.text, name); assert.equal(scene.selectionTitle, name);
                assert.equal(scene.current.selectedEntityId, null);
                assert.equal(scene.current.analysis ?? null, null);
                assert.equal(scene.current.ownerInstanceId, scene.scene.shell.id);
                assert.equal(scene.error, null);
                const step = { root: name, status: 'pass', entryMethod, fromRoot: index ? ROOTS[index - 1] : null, sessionId: report.panel.sessionId, identity: original, children: state.scene.children.map(row => row.label),
                    storages: state.scene.storages.map(row => row.label), routes: state.geometry.routes.length,
                    deferred: state.geometry.routing?.deferred || [] };
                const child = name === 'mkIM2PCore'
                    ? state.scene.children.find(row => row.label === 'core' && row.interaction?.kind === 'enter')
                    : state.scene.children.find(row => row.interaction?.kind === 'enter');
                if (name === 'mkIM2PCore') assert.ok(child, 'Actual IM2PCore core occurrence must be entered');
                if (child) {
                    await frame.locator('[data-semantic-id=' + JSON.stringify(child.id) + '][data-active="true"] .title').click();
                    await frame.waitForFunction(id => window.bsvHardware.getState().scene?.shell.id === id && !window.bsvHardware.getState().pending, child.id, { timeout: 90000 });
                    const inside = await settled(frame); expectedOwnerName = child.label; await capture('inside-' + name);
                    assert.equal(inside.current.ownerInstanceId, child.id);
                    if (name === 'mkIM2PCore') step.coreState = await coreDetail({ native, frame, workspace, inside, capture });
                    await frame.locator('#back').click(); state = await waitRoot(name); expectedOwnerName = name;
                    assert.deepEqual(identity(state), original);
                    assert.equal(state.current.disclosureState.presentation?.fit || 'structure', 'structure');
                    step.child = { id: child.id, label: child.label, restored: true, restoredFit: state.current.disclosureState.presentation?.fit || 'structure' };
                }
                if (name === 'mkDensePipeline') {
                    const memory = state.scene.storages.find(item => item.primitiveKind === 'memory'); assert.ok(memory);
                    await frame.locator('[data-semantic-id=' + JSON.stringify(memory.id) + '][data-active="true"] .title').click();
                    await settled(frame); await frame.locator('#fit-selection').click(); await settled(frame);
                    const detail = await capture('dense-memory-selection');
                    assert.equal(detail.current.selectedEntityId, memory.id);
                    const visibleWires = await frame.locator('.connection[data-active="true"] .route').evaluateAll(paths => paths.filter(path => {
                        const matrix = path.getScreenCTM();
                        if (!matrix) return false;
                        for (let i = 0; i <= 40; i++) {
                            const point = path.getPointAtLength(path.getTotalLength() * i / 40).matrixTransform(matrix);
                            const hit = document.elementFromPoint(point.x, point.y);
                            if (hit?.closest('.connection') === path.closest('.connection')) return true;
                        }
                        return false;
                    }).length);
                    assert.ok(visibleWires > 0, 'Selected BRAM must show an actual hit-testable connection');
                    await frame.locator('#clear-selection').click(); await settled(frame);
                    await frame.locator('#fit').click(); state = await settled(frame);
                    await capture('dense-memory-overview-return');
                    step.memory = { id: memory.id, visibleWires, restoredOwner: state.current.ownerInstanceId };
                }
                if (name === 'mkPE') {
                    const reference = state.scene.inspector.sourceRefs.find(row => row.range && row.id); assert.ok(reference);
                    const sourcePath = fs.realpathSync(path.resolve(workspace, reference.pathRef));
                    assert.ok(!path.relative(workspace, sourcePath).startsWith('..'));
                    const text = fs.readFileSync(sourcePath, 'utf8'); assert.equal(sha(text), reference.revision);
                    const since = native.channel.records.length;
                    await frame.locator('[data-source-open-id=' + JSON.stringify(reference.id) + ']').first().click();
                    const event = await native.channel.waitFor('editorSelection', value => value.editor?.uri === pathToFileURL(sourcePath).href
                        && value.editor.selectionText === text.slice(reference.range.start, reference.range.end), 30000, since);
                    assert.equal(event.editor.fullTextSha256, reference.revision); assert.equal(event.editor.dirty, false);
                    assert.deepEqual(event.editor.selection, { start: position(text, reference.range.start), end: position(text, reference.range.end) });
                    await capture('source-mkPE'); step.source = { reference, editor: event.editor };
                    const afterSource = identity(await settled(frame));
                    for (const field of ['buildId', 'snapshotId', 'provider', 'owner', 'occurrence', 'selected', 'relation', 'queryId', 'resultHash'])
                        assert.equal(afterSource[field], original[field]);
                    step.source.viewportBefore = original.viewport; step.source.viewportAfter = afterSource.viewport;
                }
                report.steps.push(step);
            }
        }
        report.build = (await native.channel.request('observeHardware')).sessions[0].build;
        report.status = 'pass'; await native.close(); assert.equal(native.receipt.status, 'passed');
    } catch (error) {
        report.status = 'fail'; report.error = error.stack || String(error);
        if (native && frame) await capture('failure').catch(value => { report.captureError = value.message; });
        await native?.close('failed', error); throw error;
    } finally {
        const after = sourceInventory(workspace); save(output, 'source-after.json', after);
        report.sourcePreserved = JSON.stringify(before) === JSON.stringify(after);
        if (!report.sourcePreserved) report.status = 'fail';
        report.finishedAt = new Date().toISOString(); save(output, 'validation.json', report);
        console.log(JSON.stringify({ output, mode, status: report.status }));
        assert.ok(report.sourcePreserved, 'Original workspace sources or settings changed during native validation');
    }
    return report;
}
if (require.main === module) {
    const [mode, vsix, workspace] = process.argv.slice(2);
    if (mode === '--help') console.log('node native.cjs before|after VSIX WORKSPACE');
    else run({ mode, vsix, workspace }).catch(error => { console.error(error); process.exitCode = 1; });
}
module.exports = { run };
