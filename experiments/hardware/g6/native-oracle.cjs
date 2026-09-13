'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { measurePage, validateMeasurement } = require('../g5-readability/oracle.cjs');
const { validateGeometry, validateMembership } = require('../g4-fix/oracle/geometry.cjs');
const settled = frame => require('./development-smoke.cjs').settled(frame);
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const write = (output, name, value) => fs.writeFileSync(path.join(output, name), `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' });

function mandatoryFor(state, options = {}) {
    const scene = state.scene, mandatory = [{ id: 'readability-context', minFont: 11 }];
    const add = (item, role, minFont = 9, text) => {
        assert.ok(item, 'Explicit mandatory semantic object is missing');
        mandatory.push({ ownerId: item.id, role, minFont, ...(text ? { text } : {}) });
    };
    if (options.root !== false) add(scene.shell, 'node-title', options.detail ? 12 : 9, typeof options.root === 'string' ? options.root : undefined);
    for (const name of options.children || []) add(scene.children.find(item => item.label === name), 'node-title', 9, name);
    for (const name of options.storages || []) add(scene.storages.find(item => item.label === name), 'node-title', 12, name);
    for (const name of options.contacts || []) add(scene.contacts.find(item => item.ownerId === scene.shell.id && item.label === name), 'contact-label', options.detail ? 12 : 9, name);
    if (options.selected !== false && state.current.selectedEntityId) {
        const selected = [scene.shell, ...scene.children, ...scene.storages].find(item => item.id === state.current.selectedEntityId);
        if (selected) add(selected, 'node-title', 12);
        else mandatory.push({ id: 'readability-context', text: scene.inspector.title, minFont: 11 });
    }
    return mandatory;
}

function validateNativeTypography(state, measurement, expectations = {}) {
    const mandatory = expectations.mandatory || mandatoryFor(state, expectations), checks = [], abbreviations = [];
    const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
    const graphemes = text => [...segmenter.segment(text)].map(item => item.segment);
    const primary = [state.scene.shell, ...state.scene.children, ...state.scene.storages].map(item => ({
        id: item.id, name: item.kind === 'rtl-cell' ? item.secondaryLabel || item.label : item.label }));
    const overview = expectations.allowOverviewAbbreviation === true && expectations.detail !== true
        && (state.current.disclosureState?.presentation?.fit || 'structure') === 'structure';
    for (const required of mandatory) {
        let accepted = false;
        if (overview && required.role === 'node-title' && typeof required.text === 'string'
            && required.ownerId !== state.current.selectedEntityId) {
            const labels = measurement.labels.filter(label => label.visible && label.ownerId === required.ownerId
                && label.role === required.role && (!required.id || label.id === required.id));
            for (const label of labels.filter(label => label.text !== required.text)) {
                const parts = label.text.split('…'), prefix = parts[0], suffix = parts[1] || '';
                const units = graphemes(prefix + suffix), meaningful = units.filter(unit => /[\p{L}\p{N}]/u.test(unit)).length;
                const matches = name => typeof name === 'string' && name.startsWith(prefix) && name.endsWith(suffix)
                    && graphemes(name).length > units.length;
                const matchingOwners = primary.filter(item => matches(item.name)).map(item => item.id);
                const full = graphemes(required.text), start = graphemes(prefix), end = graphemes(suffix);
                const valid = parts.length === 2 && start.length >= 1 && end.length >= 2 && meaningful >= 5
                    && full.slice(0, start.length).join('') === prefix && full.slice(-end.length).join('') === suffix
                    && label.fullText === required.text && primary.some(item => item.id === required.ownerId && item.name === required.text)
                    && matchingOwners.length === 1 && matchingOwners[0] === required.ownerId;
                abbreviations.push({ ownerId: required.ownerId, fullText: required.text, displayedText: label.text,
                    prefix, suffix, meaningfulGraphemes: meaningful, matchingOwners, accepted: valid });
                accepted ||= valid;
            }
        }
        // Keep canonical owner/role and every geometric check; only replace the exact-text requirement after independent proof.
        if (accepted) { const { text, ...ownerRequirement } = required; checks.push(ownerRequirement); }
        else checks.push(required);
    }
    return { ...validateMeasurement(measurement, { minimumFont: 9, ...expectations, mandatory: checks }),
        nativePrimaryAbbreviations: abbreviations };
}

async function measureNative({ native, frame, page }) {
    assert.ok(frame.url().startsWith('vscode-webview:'), 'Measurement requires the actual native Webview');
    const measurement = await measurePage(frame);
    const hostWindow = await page.evaluate(() => ({ innerWidth, innerHeight, outerWidth, outerHeight, screenX, screenY,
        devicePixelRatio, visualViewport: visualViewport ? { width: visualViewport.width, height: visualViewport.height, scale: visualViewport.scale } : null,
        documentZoom: getComputedStyle(document.documentElement).zoom }));
    const webview = await frame.evaluate(() => ({ innerWidth, innerHeight, devicePixelRatio,
        font: getComputedStyle(document.body).font, theme: document.documentElement.dataset.theme,
        visualViewport: visualViewport ? { width: visualViewport.width, height: visualViewport.height, scale: visualViewport.scale } : null,
        build: window.BsvHardwareTransport.identity(), uri: location.href }));
    const frameElement = await frame.frameElement(), frameBounds = await frameElement.boundingBox();
    assert.ok(frameBounds && frameBounds.width > 0 && frameBounds.height > 0, 'Native Webview frame is not visible');
    const ancestors = [];
    for (let cursor = frame; cursor.parentFrame(); cursor = cursor.parentFrame()) {
        const element = await cursor.frameElement();
        ancestors.push(await element.evaluate(node => {
            const chain = [];
            for (let parent = node; parent; parent = parent.parentElement) {
                const style = getComputedStyle(parent);
                if (style.transform !== 'none' || !['normal', '1'].includes(style.zoom)) {
                    const matrix = new DOMMatrix(style.transform === 'none' ? undefined : style.transform);
                    chain.push({ tag: parent.tagName, id: parent.id, transform: style.transform, zoom: style.zoom,
                        axisAligned: matrix.a > 0 && matrix.d > 0 && [matrix.b, matrix.c, matrix.m13, matrix.m14,
                            matrix.m23, matrix.m24, matrix.m31, matrix.m32, matrix.m34].every(value => value === 0) && matrix.m44 === 1 });
                }
            }
            return { tag: node.tagName, id: node.id, clientWidth: node.clientWidth, clientHeight: node.clientHeight, chain };
        }));
    }
    const scaleX = frameBounds.width / webview.innerWidth, scaleY = frameBounds.height / webview.innerHeight;
    const frameScale = Math.min(scaleX, scaleY);
    for (const label of measurement.labels) { label.frameEffectiveFont = label.effectiveFont; label.effectiveFont *= frameScale; }
    for (const text of measurement.source) { text.frameEffectiveFont = text.effectiveFont; text.effectiveFont *= frameScale; }
    measurement.schema = 'g6-native-readability-measurement-v1';
    measurement.native = { targetMode: native.receipt.targetMode, vsixSha256: native.receipt.vsixSha256,
        hostEnvironment: native.receipt.environment, hostWindow, webview, frameBounds, ancestors, scaleX, scaleY, frameScale,
        coordinateContract: 'DOM glyph geometry is Webview CSS px; effective font includes observed outer-frame scale. DPR is never multiplied into CSS font size.' };
    measurement.browserZoom.note = 'Isolated VS Code window; this measurement records actual Webview and outer window dimensions/scales. No screenshot rescaling or CSS font injection.';
    return measurement;
}

async function captureNative({ native, frame, page, output = native.output, name, expectations = {}, authority }) {
    assert.match(name, /^[a-zA-Z0-9_-]+$/);
    await native.traceCheckpoint(`before-${name}`);
    const state = await settled(frame); await page.mouse.move(3, 3);
    const measurement = await measureNative({ native, frame, page });
    const mandatory = expectations.mandatory || mandatoryFor(state, expectations);
    const typography = validateNativeTypography(state, measurement, { ...expectations, mandatory });
    const geometry = validateGeometry(state.scene, state.geometry);
    const membership = authority ? validateMembership(state.scene, { model: authority.models?.[state.current.provider] || authority.model,
        architecture: authority.architecture }) : { valid: false, findings: [{ code: 'MISSING_AUTHORITY', kind: 'Independent canonical authority was not supplied' }] };
    const rendered = await frame.locator('.connection[data-active="true"]').evaluateAll(groups => groups.map(group => ({
        id: group.dataset.semanticId, path: group.querySelector('.route').getAttribute('d'), bits: JSON.parse(group.dataset.canonicalBits) })));
    const findings = [...typography.findings, ...geometry.findings, ...membership.findings];
    if (rendered.length !== state.scene.connections.length) findings.push({ kind: 'rendered-connection-count' });
    for (const row of rendered) {
        if (row.path !== state.geometry.routes.find(route => route.id === row.id)?.path) findings.push({ kind: 'rendered-route-path', id: row.id });
        if (JSON.stringify(row.bits) !== JSON.stringify(state.scene.connections.find(connection => connection.id === row.id)?.bits || [])) findings.push({ kind: 'rendered-bit-order', id: row.id });
    }
    if (state.current.snapshotId !== state.scene.snapshotId || state.current.provider !== state.scene.implementationContext.provider) findings.push({ kind: 'native-scene-context-mismatch' });
    for (const ancestor of measurement.native.ancestors) for (const item of ancestor.chain) {
        if (!item.axisAligned) findings.push({ kind: 'unverified-frame-transform', item });
    }
    const verdict = { schema: 'g6-native-oracle-verdict-v1', status: findings.length ? 'fail' : 'pass', findings, typography,
        geometry: { valid: !geometry.findings.length, metrics: geometry.metrics }, membership: { valid: !membership.findings.length },
        minimumTitle: Math.min(...measurement.labels.filter(label => label.visible && label.role === 'node-title').map(label => label.effectiveFont)),
        inspectedVisually: false, userVisualDesignAcceptance: 'PENDING' };
    const files = { measurement: `${name}.measurement.json`, state: `${name}.state.json`, verdict: `${name}.verdict.json`,
        webviewScreenshot: `${name}-webview.png`, windowScreenshot: `${name}-window.png` };
    write(output, files.measurement, measurement); write(output, files.state, state); write(output, files.verdict, { ...verdict, mandatory });
    await native.capture(`${name}-window`, page);
    assert.equal(fs.existsSync(path.join(output, files.webviewScreenshot)), false);
    await frame.locator('body').screenshot({ path: path.join(output, files.webviewScreenshot) });
    const inventory = Object.values(files).map(file => { const bytes = fs.readFileSync(path.join(output, file)); return { path: file, bytes: bytes.length, sha256: digest(bytes) }; });
    await native.traceCheckpoint(`capture-${name}`);
    return { name, ...files, inventory, measurement, state, verdict, mandatory };
}

async function clickWire({ frame, page, connectionId }) {
    const point = await frame.evaluate(id => {
        const route = document.querySelector(`[data-semantic-id=${JSON.stringify(id)}][data-active="true"] > .route`);
        if (!route) return null;
        const canvas = document.getElementById('viewport').getBoundingClientRect(), matrix = route.getScreenCTM(), length = route.getTotalLength();
        for (let i = 1; i < 200; i++) {
            const p = route.getPointAtLength(length * i / 200).matrixTransform(matrix);
            if (p.x < canvas.left + 8 || p.x > canvas.right - 8 || p.y < canvas.top + 8 || p.y > canvas.bottom - 8) continue;
            const hit = document.elementFromPoint(p.x, p.y);
            if (hit?.classList.contains('hit-route') && hit.closest('[data-semantic-id]')?.dataset.semanticId === id) return { x: p.x, y: p.y };
        }
        return null;
    }, connectionId);
    assert.ok(point, `No observed wire hit target for ${connectionId}`);
    const bounds = await (await frame.frameElement()).boundingBox();
    const viewport = await frame.evaluate(() => ({ width: innerWidth, height: innerHeight }));
    await page.mouse.click(bounds.x + point.x * bounds.width / viewport.width, bounds.y + point.y * bounds.height / viewport.height);
    const choices = frame.locator('#wire-choices');
    if (await choices.isVisible()) await choices.locator(`[data-connection-id=${JSON.stringify(connectionId)}]`).click();
    await frame.waitForFunction(id => window.bsvHardware.getState().current?.selectedRelationId === id, connectionId, { timeout: 30000 });
    return { point, frameBounds: bounds, state: await settled(frame) };
}

module.exports = { mandatoryFor, validateNativeTypography, measureNative, captureNative, clickWire };
