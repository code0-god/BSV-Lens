#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { launchNative } = require('../g6/native-driver.cjs');
const { createRun } = require('../g6/run.cjs');
const { workspaceInventory } = require('../g6/live-compiler.cjs');
const { settled, chooseObject } = require('../g6/development-smoke.cjs');
const { analyze, sourceReveal, identity } = require('../g6/native-acceptance.cjs');
const { measureNative, validateNativeTypography, clickWire } = require('../g6/native-oracle.cjs');
const { validateGeometry } = require('../g4-fix/oracle/geometry.cjs');
const { assertConnectionDisclosure } = require('./native-contracts.cjs');
const ROOT = path.resolve(__dirname, '../../..');
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const write = (output, name, value) => fs.writeFileSync(path.join(output, name), JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });

async function run({ vsix, workspace = process.env.G6_WORKSPACE || path.join(os.homedir(), 'aisa-lab/DynDNN/AQuA'), output = process.env.G6_OUTPUT_DIR || createRun('usability-native'),
    observerVsix = path.join(ROOT, '.build/hardware/runs/g6-observer-resources-final-xQD0Ig/g6/bsv-lens-g6-observer-0.0.1.vsix') }) {
    assert.ok(vsix); workspace = fs.realpathSync(workspace);
    const before = workspaceInventory(workspace); write(output, 'workspace-before.json', before);
    const report = { schema: 'g6-usability-native-acceptance-v1', startedAt: new Date().toISOString(), status: 'running',
        output, workspace, vsix, vsixSha256: hash(fs.readFileSync(vsix)), lane: 'installed-vsix-actual-workspace',
        userVisualDesignAcceptance: 'PENDING', steps: [], captures: [],
        driverBoundary: 'Actual command, design QuickPick and pointer/keyboard controls only. Source ranges come from product query and are independently checked against actual editor text. No source registration, mocked query, injected scene or compiler.' };
    write(output, 'acceptance-contract.json', report);
    let native, frame, page;
    const pass = (id, detail) => { report.steps.push({ id, status: 'pass', ...detail }); write(output, `${id}.json`, detail); console.log('USABILITY_PASS', id); };
    try {
        native = await launchNative({ vsix, observerVsix, workspace, output, restricted: true,
            harnessFiles: [__filename, path.join(__dirname, 'native-contracts.cjs')] });
        page = native.context.pages()[0];
        const noTrust = page.getByRole('button', { name: "No, I don't trust the authors", exact: true });
        if (await noTrust.isVisible()) await noTrust.click();
        assert.equal((await native.channel.request('observeEditors')).trusted, false);
        await native.channel.request('openProductCommand', { command: 'bsvArchitecture.openHardwareSchematic' });
        ({ frame, page } = await native.findWebview());
        page.on('pageerror', error => fs.appendFileSync(path.join(output, 'renderer-errors.jsonl'), JSON.stringify({ at: new Date().toISOString(), message: error.message, stack: error.stack }) + '\n'));
        await frame.waitForFunction(() => !!window.BsvHardwareTransport.identity());
        await page.locator('.quick-input-title').filter({ hasText: 'Choose a source design' }).waitFor({ state: 'visible', timeout: 90000 });
        const roots = await page.locator('.quick-input-list .label-name').allTextContents();
        write(output, 'source-design-candidates.json', roots); await native.capture('automatic-source-design-choice', page);
        const memory = roots.filter(name => name === 'mkAquaMemorySubsystem'); assert.equal(memory.length, 1);
        await native.nativeInput({ choice: memory[0] }, page);
        const waitOwner = async owner => {
            await frame.waitForFunction(value => {
                const state = window.bsvHardware.getState();
                if (state.error) throw new Error(JSON.stringify(state.error));
                return state.scene?.shell.id === value && !state.pending && !state.transition;
            }, owner, { timeout: 90000 }); return settled(frame);
        };
        await frame.waitForFunction(() => {
            const state = window.bsvHardware.getState(); if (state.error) throw new Error(JSON.stringify(state.error));
            return state.scene?.shell.label === 'mkAquaMemorySubsystem' && !state.pending;
        }, null, { timeout: 90000 });
        let state = await settled(frame);
        const initial = identity(state), memoryId = state.scene.shell.id;
        assert.equal(state.scene.sceneKind, 'bsv'); assert.equal(state.current.snapshotId, null);
        assert.deepEqual(state.scene.children.map(item => item.label), ['load', 'staging', 'accumulators', 'store']);
        const posts = await frame.evaluate(() => window.__bsvVsixSmoke.posts.map(item => ({ action: item.action, payload: item.payload })));
        assert.ok(posts.some(item => item.action === 'discover-workspace'));
        assert.equal(posts.some(item => ['choose-source', 'choose-manifest', 'choose-artifact', 'choose-origin'].includes(item.action)), false);
        assert.ok(native.receipt.nativeInputs.every(item => item.choice === 'mkAquaMemorySubsystem' && item.text === undefined));
        pass('A01-automatic-start', { roots, current: state.current, nativeInputs: native.receipt.nativeInputs,
            host: await native.channel.request('observeHardware'), inventory: await frame.locator('#native-discovery-inventory').textContent() });

        const capture = async (name, requiredChildren = [], options = {}) => {
            await native.traceCheckpoint(`before-${name}`); await page.mouse.move(3, 3);
            const current = await settled(frame), measurement = await measureNative({ native, frame, page });
            const typography = validateNativeTypography(current, measurement, { root: true, children: requiredChildren,
                allowOverviewAbbreviation: true, ...options });
            const geometry = validateGeometry(current.scene, current.geometry);
            const dom = await frame.evaluate(() => ({ selector: { value: document.querySelector('#build-select').value,
                text: document.querySelector('#build-select').selectedOptions[0]?.textContent },
                title: document.querySelector('#scene-title').textContent, context: document.querySelector('#readability-context').textContent,
                inspector: document.querySelector('#inspector').innerText, inputStatus: document.querySelector('#native-input-status').textContent,
                status: document.querySelector('#status').textContent, display: document.querySelector('#display-status').textContent,
                feedback: document.querySelector('#navigation-feedback').innerText,
                sourceOnly: { hidden: document.querySelector('#native-source-only').hidden, text: document.querySelector('#native-source-only').innerText },
                renderedRoutes: [...document.querySelectorAll('.connection[data-active="true"]')].map(node => ({
                    id: node.dataset.semanticId, path: node.querySelector('.route')?.getAttribute('d'), bits: node.dataset.canonicalBits })),
                activeNodeIds: [...document.querySelectorAll('#shells-layer [data-active="true"]')].map(node => node.dataset.semanticId),
                labelStyles: [...document.querySelectorAll('#viewport text')].map(node => ({ text: node.textContent, ownerId: node.parentElement?.dataset.semanticId,
                    display: getComputedStyle(node).display, fontSize: getComputedStyle(node).fontSize, transform: node.getAttribute('transform') })),
                messages: window.__bsvVsixSmoke.posts.map(item => ({ action: item.action, requestId: item.requestId, generation: item.generation })) }));
            if (dom.renderedRoutes.length !== current.geometry.routes.length) geometry.findings.push({ kind: 'rendered-route-count',
                actual: dom.renderedRoutes.length, expected: current.geometry.routes.length });
            for (const route of dom.renderedRoutes) if (route.path !== current.geometry.routes.find(item => item.id === route.id)?.path)
                geometry.findings.push({ kind: 'rendered-route-path', id: route.id });
            const nodeIds = [current.scene.shell, ...current.scene.children, ...current.scene.storages].map(item => item.id);
            if (JSON.stringify([...dom.activeNodeIds].sort()) !== JSON.stringify(nodeIds.sort())) geometry.findings.push({ kind: 'active-node-membership',
                actual: dom.activeNodeIds, expected: nodeIds });
            write(output, `${name}.state.json`, current); write(output, `${name}.measurement.json`, measurement);
            write(output, `${name}.dom.json`, dom); write(output, `${name}.oracle.json`, { typography, geometry });
            await native.capture(`${name}-window`, page);
            await frame.locator('body').screenshot({ path: path.join(output, `${name}-webview.png`) });
            const result = { name, root: current.scene.shell.label, owner: current.scene.shell.id, children: current.scene.children.map(item => item.label),
                contacts: current.scene.contacts.length, groups: current.scene.interfaceGroups.length, summaries: current.scene.connections.length,
                routed: current.geometry.routes.length, deferred: current.geometry.routing?.deferred || [],
                minimumTitleCssPx: Math.min(...measurement.labels.filter(item => item.visible && item.role === 'node-title').map(item => item.effectiveFont)),
                typographyFindings: typography.findings, geometryFindings: geometry.findings, dom };
            report.captures.push(result); console.log('USABILITY_CAPTURE', JSON.stringify({ ...result, dom: undefined }));
            await native.traceCheckpoint(`capture-${name}`); return current;
        };
        await frame.locator('#fit').click(); state = await capture('A02-memory-overview', ['load', 'staging', 'accumulators', 'store']);
        assert.ok(state.geometry.routes.length > 0); assert.deepEqual(state.geometry.routing?.deferred || [], []);
        assert.ok(state.scene.contacts.length < 109, 'Overview still exposes the old full method contact set');
        assert.equal((await frame.locator('#display-status').innerText()).includes('labels not shown'), false);
        pass('A02-memory-overview', { current: state.current, projection: state.scene.projection, routing: state.geometry.routing,
            visibleContacts: state.scene.contacts.map(item => ({ id: item.id, label: item.label, path: item.interfacePath })) });
        const enterChild = async (name, surface = 'body') => {
            const beforeEnter = await settled(frame), child = beforeEnter.scene.children.find(item => item.label === name); assert.ok(child);
            const target = frame.locator(`[data-semantic-id=${JSON.stringify(child.id)}][data-active="true"]`);
            if (surface === 'keyboard') { await target.focus(); await target.press('Enter'); }
            else await target.locator(surface === 'title' ? '.title' : '.body').click();
            const entered = await waitOwner(child.id);
            assert.equal(entered.current.ownerInstanceId, child.id);
            assert.equal(entered.history.back.length, beforeEnter.history.back.length + 1);
            return entered;
        };
        for (const [index, name] of ['load', 'staging', 'accumulators', 'store'].entries()) {
            const surface = index % 2 ? 'title' : 'body';
            state = await enterChild(name, surface); await capture(`A03-${name}-inside`, state.scene.children.map(item => item.label));
            assert.deepEqual(state.geometry.routing?.deferred || [], [], 'Ordinary source overview must route without deferred fallback');
            if (name === 'load') {
                const expected = new Map(state.scene.storages.map(item => [item.id, item.label])), visited = new Map();
                const historyLength = state.history.back.length, owner = state.scene.shell.id;
                await frame.getByRole('button', { name: `${state.scene.shell.label}, module-occurrence, inspect`, exact: true }).focus();
                const focusPath = [], limit = (state.scene.storages.length + state.scene.interfaceGroups.length + state.scene.connections.length + 20) * 2;
                for (let step = 0; step < limit && visited.size < expected.size; step++) {
                    await page.keyboard.press('Tab');
                    const focused = await frame.evaluate(() => ({ id: document.activeElement?.dataset?.semanticId,
                        aria: document.activeElement?.getAttribute('aria-label'), tag: document.activeElement?.tagName }));
                    focusPath.push(focused);
                    if (!focused.aria?.includes(', storage,') || visited.has(focused.id)) continue;
                    await page.keyboard.press('Enter');
                    await frame.waitForFunction(id => window.bsvHardware.getState().current.selectedEntityId === id, focused.id);
                    state = await settled(frame); assert.equal(state.scene.shell.id, owner); assert.equal(state.history.back.length, historyLength);
                    const title = await frame.locator('#selection-title').evaluate(node => {
                        const range = document.createRange(); range.selectNodeContents(node);
                        return { text: node.textContent, fontCss: Number.parseFloat(getComputedStyle(node).fontSize),
                            rects: [...range.getClientRects()].map(rect => rect.toJSON()),
                            inspector: node.closest('#inspector').getBoundingClientRect().toJSON(), visible: node.checkVisibility() };
                    });
                    assert.equal(title.text, expected.get(focused.id)); assert.ok(title.visible && title.fontCss >= 12 && title.rects.length);
                    assert.ok(title.rects.every(rect => rect.width > 0 && rect.left >= title.inspector.left && rect.right <= title.inspector.right
                        && rect.top >= title.inspector.top && rect.bottom <= title.inspector.bottom), 'Full storage name must be inside the visible Inspector');
                    visited.set(focused.id, { focused, title, sourceRefs: state.scene.inspector.sourceRefs.map(ref => ref.id) });
                    if (visited.size % 3 === 0) await native.traceCheckpoint(`U11-storages-${visited.size}`);
                }
                assert.equal(visited.size, expected.size, 'Keyboard exploration must reach every directly displayed storage without a known entity ID');
                pass('U11-load-storage-keyboard', { interaction: 'Focus the visible load module by its accessible name, then actual Tab/Enter. Entity IDs are observed after focus, not used to choose or click a target.',
                    expectedNames: [...expected.values()], focusPath, inspected: [...visited.values()], historyUnchanged: true });
                await native.capture('U11-load-storage-keyboard', page); await native.traceCheckpoint('U11-storage-keyboard');
                await frame.locator('#clear-selection').click(); state = await settled(frame);
            }
            const entered = identity(state); await frame.locator('#back').click(); state = await waitOwner(memoryId);
            assert.equal(state.current.rootInstanceId, initial.owner);
            pass(`A03-${name}`, { action: `single pointer ${surface} click`, entered, restored: identity(state) });
        }
        const infoTarget = state.scene.children.find(item => item.label === 'load'), beforeInfo = identity(state), infoHistory = state.history.back.length,
            infoSourceRevision = state.current.sourceRevision;
        await frame.locator(`[data-inspect-entity-id=${JSON.stringify(infoTarget.id)}]`).click();
        await frame.waitForFunction(id => window.bsvHardware.getState().current.selectedEntityId === id, infoTarget.id);
        state = await settled(frame);
        assert.equal(state.scene.shell.id, memoryId); assert.equal(state.current.ownerInstanceId, beforeInfo.owner);
        assert.equal(state.history.back.length, infoHistory); assert.equal(state.current.sourceRevision, infoSourceRevision);
        await frame.locator('#native-inputs > summary').click();
        assert.equal(await frame.locator('#native-inputs').evaluate(node => node.open), true);
        await frame.locator('#native-inputs > summary').click();
        const afterSettings = await settled(frame);
        assert.equal(afterSettings.scene.shell.id, memoryId); assert.equal(afterSettings.current.selectedEntityId, infoTarget.id);
        assert.equal(afterSettings.history.back.length, infoHistory);
        await capture('U03-module-information');
        pass('U03-module-information', { target: infoTarget.id, before: beforeInfo, after: identity(afterSettings), historyUnchanged: true });
        await frame.locator('#clear-selection').click(); state = await settled(frame);
        const group = state.scene.interfaceGroups.find(item => item.ownerId === memoryId && item.memberContactIds.length > 0 && !item.continuation);
        assert.ok(group, 'Actual module interface group required');
        await frame.locator(`[data-semantic-id=${JSON.stringify(group.id)}][data-active="true"] .group-anchor`).click();
        await frame.waitForFunction(id => window.bsvHardware.getState().current.selectedEntityId === id, group.id);
        state = await settled(frame); assert.equal(state.scene.shell.id, memoryId);
        assert.ok(state.scene.inspector.interfaceMembers?.length > 0); assert.ok(await frame.locator('[data-section-id="interface-members"] button').count());
        await capture('U04-interface-members');
        pass('U04-interface-members', { group, members: state.scene.inspector.interfaceMembers, current: state.current });
        await frame.locator('#clear-selection').click(); state = await settled(frame);
        const connection = state.scene.connections.find(item => state.geometry.routes.some(route => route.id === item.id)); assert.ok(connection);
        const wire = await clickWire({ frame, page, connectionId: connection.id });
        assert.equal(wire.state.scene.shell.id, memoryId);
        const detailId = `inspector-relations:${wire.state.scene.inspector.id}`;
        const details = frame.locator(`[data-disclosure-id=${JSON.stringify(detailId)}]`);
        if (!await details.evaluate(node => node.open)) await details.locator(':scope > summary').click();
        const renderedDisclosure = await frame.evaluate(() => ({
            text: document.querySelector('[data-section-id="connection-essentials"]')?.textContent || '',
            endpoints: [...document.querySelectorAll('[data-connection-endpoint-id]')].map(node => ({
                role: node.dataset.connectionEndpointRole, id: node.dataset.connectionEndpointId, label: node.textContent })),
            memberIds: [...document.querySelectorAll('[data-relation-member-id]')].map(node => node.dataset.relationMemberId)
        }));
        const connectionDisclosure = assertConnectionDisclosure(connection, wire.state.scene.inspector, renderedDisclosure);
        await capture('U03-relation-selection');
        pass('U03-relation-selection', { connection, current: wire.state.current, point: wire.point, connectionDisclosure });
        await details.locator(':scope > summary').click();
        await frame.waitForFunction(id => window.bsvHardware.getState().current.disclosureState.analysis?.disclosures?.[id] === false, detailId);
        const closedSummary = await settled(frame), closedSource = closedSummary.current.sourceContext;
        await enterChild('load'); await frame.locator('#back').click(); state = await waitOwner(memoryId);
        assert.equal(state.current.selectedRelationId, connection.id);
        assert.equal(state.current.disclosureState.analysis.disclosures[detailId], false);
        assert.equal(await details.evaluate(node => node.open), false);
        assert.deepEqual(state.current.sourceContext, closedSource);
        pass('U09-summary-disclosure-back', { detailId, current: state.current, sourceContextPreserved: true });
        await details.locator(':scope > summary').click();
        const originalMember = connection.members[0];
        await frame.locator(`[data-relation-member-id=${JSON.stringify(originalMember.id)}]`).click();
        await frame.waitForFunction(id => window.bsvHardware.getState().current.selectedRelationId === id, originalMember.id);
        state = await settled(frame);
        assert.equal(state.scene.shell.id, memoryId); assert.equal(state.current.ownerInstanceId, memoryId);
        assert.deepEqual(state.scene.inspector.relationMembers.map(item => item.id), [originalMember.id]);
        const summaryWire = frame.locator(`[data-semantic-id=${JSON.stringify(connection.id)}][data-active="true"]`);
        assert.equal(await summaryWire.evaluate(node => node.classList.contains('selected')), true);
        assert.ok(state.scene.inspector.sourceRefs.length > 0);
        assert.ok(await frame.locator('[data-source-open-id]').count() > 0);
        assert.ok(await frame.locator('[data-analysis-kind="behavior"]').count() > 0);
        assert.equal(state.current.sourceContext.selectedRelationId, originalMember.id);
        const validatedMemberSources = [];
        for (const id of originalMember.sourceRefIds) {
            const reference = state.scene.inspector.sourceRefs.find(item => item.id === id); assert.ok(reference);
            assert.ok(state.current.sourceContext.sourceRefs.some(item => item.id === id));
            assert.ok(await frame.locator(`[data-source-open-id=${JSON.stringify(id)}]`).count() > 0);
            assert.equal(path.isAbsolute(reference.pathRef), false);
            const source = path.resolve(workspace, reference.pathRef), relative = path.relative(workspace, source);
            assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative));
            assert.ok(!path.relative(workspace, fs.realpathSync(source)).startsWith('..'));
            const text = fs.readFileSync(source, 'utf8'); assert.equal(hash(text), reference.revision);
            assert.equal(text.slice(reference.range.start, reference.range.end), reference.text);
            validatedMemberSources.push({ id, pathRef: reference.pathRef, revision: reference.revision, range: reference.range });
        }
        await capture('U03-original-relation');
        pass('U03-original-relation', { originalMember, current: state.current, inspector: state.scene.inspector,
            summaryHaloId: connection.id, validatedMemberSources });
        await frame.locator('#clear-selection').click(); await settled(frame);

        const chooseDesign = async name => {
            const options = await frame.locator('#build-select option').evaluateAll(nodes => nodes.map(node => ({ value: node.value, text: node.textContent })));
            const choice = options.filter(item => item.text === name); assert.equal(choice.length, 1, `Unambiguous design ${name}`);
            await frame.locator('#build-select').selectOption(choice[0].value);
            await frame.waitForFunction(label => {
                const state = window.bsvHardware.getState(); if (state.error) throw new Error(JSON.stringify(state.error));
                return state.scene?.shell.label === label && !state.pending;
            }, name, { timeout: 90000 });
            const current = await settled(frame);
            assert.equal(await frame.locator('#build-select').inputValue(), choice[0].value);
            assert.equal(current.current.ownerInstanceId, current.scene.shell.id); return current;
        };
        state = await chooseDesign('mkAquaLoopMatmul');
        await capture('A04-loop-overview', state.scene.children.map(item => item.label));
        assert.ok(state.geometry.routes.length > 0); assert.deepEqual(state.geometry.routing?.deferred || [], []);
        const loopId = state.scene.shell.id, loopChild = state.scene.children.find(item => item.interaction.kind === 'enter'); assert.ok(loopChild);
        await enterChild(loopChild.label, 'keyboard'); await capture('A04-loop-child');
        await frame.locator('#back').click(); state = await waitOwner(loopId);
        pass('A04-loop-root-and-child', { current: state.current, firstChild: loopChild });
        state = await chooseDesign('mkAquaMemorySubsystem');
        state = await enterChild('load');
        const storage = state.scene.storages.find(item => item.label === 'active') || state.scene.storages[0]; assert.ok(storage);
        await chooseObject(frame, storage.id); state = await analyze(frame, 'state-accesses');
        assert.ok(state.current.analysis.result.writers.length);
        await capture('A05-state-accesses', [], { selected: true });
        const accesses = identity(state);
        await frame.locator('[data-code-section="writer"] [data-analysis-kind="behavior"]').first().click();
        await frame.waitForFunction(() => window.bsvHardware.getState().current.analysis?.result.kind === 'behavior'); state = await settled(frame);
        const referenceId = await frame.locator('#code-drawer pre[data-source-reference-id]').first().getAttribute('data-source-reference-id');
        const reference = state.current.analysis.result.sourceRefs.find(item => item.id === referenceId); assert.ok(reference);
        const sourcePath = fs.realpathSync(path.resolve(workspace, reference.pathRef));
        assert.ok(!path.relative(workspace, sourcePath).startsWith('..'), 'Product reference must remain within actual workspace');
        const reveal = await sourceReveal({ native, frame, referenceId, fixture: { sourceFiles: [{ pathRef: reference.pathRef, path: sourcePath }] } });
        await native.capture('A05-actual-editor-range', page);
        pass('A05-actual-editor-range', { reveal, current: state.current });
        await frame.locator('#back').click(); state = await settled(frame);
        const restored = identity(state);
        for (const field of ['buildId', 'owner', 'selected', 'queryId', 'resultHash']) assert.equal(restored[field], accesses[field]);
        const ownerContext = await frame.locator('#readability-context').evaluate(node => ({ text: node.textContent,
            fontSize: Number.parseFloat(getComputedStyle(node).fontSize), bounds: node.getBoundingClientRect().toJSON(),
            visible: getComputedStyle(node).visibility !== 'hidden' && getComputedStyle(node).display !== 'none' }));
        assert.ok(ownerContext.visible && ownerContext.fontSize >= 12 && ownerContext.bounds.width > 0 && ownerContext.bounds.height > 0);
        assert.ok(ownerContext.text.includes(state.current.occurrencePath.join('.')) && ownerContext.text.includes(storage.label));
        write(output, 'A05-restored-owner-context.json', ownerContext);
        await capture('A05-source-back', [], { root: false, selected: true, mandatory: [
            { id: 'readability-context', minFont: 12, text: state.current.occurrencePath.join('.') },
            { ownerId: storage.id, role: 'node-title', minFont: 12, text: storage.label }
        ] });
        await frame.locator('#forward').click(); state = await settled(frame);
        assert.equal(state.current.analysis.result.kind, 'behavior');
        await frame.locator('#back').click(); await settled(frame);
        pass('A05-source-back-forward', { accesses, restored, editor: await native.channel.request('observeEditors') });
        const beforeFit = await settled(frame);
        await frame.locator('#fit-selection').click(); state = await settled(frame);
        assert.equal(state.history.back.length, beforeFit.history.back.length);
        assert.equal(state.current.analysis.result.queryId, beforeFit.current.analysis.result.queryId);
        await capture('A05-selected-fit', [], { root: false, selected: true });
        pass('A05-selected-fit', { current: state.current, historyUnchanged: true,
            relatedRoutes: state.geometry.routes.filter(route => state.scene.connections.find(item => item.id === route.id)?.endpointIds?.includes(storage.id)).map(item => item.id),
            scopeDisplay: await frame.locator('#display-status').innerText(), projection: state.scene.projection });
        assert.equal(await frame.locator('#native-source-only').isVisible(), true);
        assert.equal(await frame.locator('#connect-rtl').isEnabled(), true);
        assert.equal(await frame.locator('#rtl').isVisible(), false);
        assert.equal((await frame.locator('#readability-context').innerText()).includes('stock'), false);
        pass('A06-source-only', { message: await frame.locator('#native-source-only').innerText(), host: await native.channel.request('observeHardware') });
        report.status = report.captures.some(item => item.typographyFindings.length || item.geometryFindings.length)
            || native.receipt.errors.length ? 'oracle-failed' : 'passed';
    } catch (error) {
        report.status = 'failed'; report.failure = error.stack;
        console.error('USABILITY_FIRST_FAILURE', error.stack);
        if (native && frame) {
            write(output, 'failure-state.json', await frame.evaluate(() => window.bsvHardware?.getState()).catch(() => null));
            write(output, 'failure-host.json', await native.channel.request('observeHardware').catch(cause => ({ error: cause.message })));
            write(output, 'failure-dom.json', await frame.evaluate(() => ({ text: document.body.innerText, transport: window.__bsvVsixSmoke })).catch(() => null));
            await native.capture('failure-window', page).catch(cause => { report.captureError = cause.message; });
        }
    } finally {
        if (native) await native.close(report.status === 'passed' ? 'passed' : 'failed', report.status === 'passed' ? null : report.failure || report.status);
        const after = workspaceInventory(workspace); write(output, 'workspace-after.json', after);
        report.workspacePreserved = JSON.stringify(before.files) === JSON.stringify(after.files);
        report.finishedAt = new Date().toISOString(); write(output, 'acceptance-report.json', report);
        console.log(`USABILITY_REPORT ${path.join(output, 'acceptance-report.json')}`);
        assert.equal(report.workspacePreserved, true);
    }
    assert.equal(report.status, 'passed', report.failure || 'Actual native typography/geometry findings remain');
    return report;
}
if (require.main === module) run({ vsix: process.argv[2] }).catch(error => { console.error(error.stack); process.exitCode = 1; });
module.exports = { run };
