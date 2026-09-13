#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const write = (output, name, value) => fs.writeFileSync(path.join(output, name), JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });

function semanticState(state) {
    const current = state.current;
    return { buildId: current.buildId, snapshotId: current.snapshotId, sourceRevision: state.scene.sourceRevision,
        rootInstanceId: current.rootInstanceId, ownerInstanceId: current.ownerInstanceId, sceneKind: current.sceneKind,
        provider: current.provider, implementationContext: current.implementationContext,
        selectedEntityId: current.selectedEntityId, selectedRelationId: current.selectedRelationId,
        query: current.analysis?.request || null, resultHash: hash(JSON.stringify(current.analysis?.result || null)),
        history: { back: state.history.back.length, forward: state.history.forward.length } };
}

function assertExport(metadata, state) {
    assert.equal(metadata.snapshotId, state.scene.snapshotId);
    assert.equal(metadata.ownerInstanceId, state.current.ownerInstanceId);
    assert.equal(metadata.sourceRevision, state.scene.sourceRevision);
    assert.deepEqual(metadata.projection, state.scene.projection);
    assert.deepEqual(metadata.routing, state.geometry.routing);
    assert.deepEqual(metadata.connections, JSON.parse(JSON.stringify(state.scene.connections.map(connection => ({
        id: connection.id, bits: connection.bits, rawBits: connection.rawBits,
        members: connection.members, memberRelationIds: connection.memberRelationIds
    })))));
    assert.match(metadata.displayScope, /BSV overview/);
    assert.doesNotMatch(metadata.displayScope, /complete topology/);
    return { ownerInstanceId: metadata.ownerInstanceId, sourceRevision: metadata.sourceRevision,
        displayScope: metadata.displayScope, projection: metadata.projection, routing: metadata.routing,
        connectionIds: metadata.connections.map(item => item.id) };
}

async function anchor(frame) {
    return frame.evaluate(() => {
        const state = window.bsvHardware.getState(), id = state.current.selectedEntityId;
        const node = state.geometry.nodes.find(item => item.id === id);
        if (!node) throw new Error('Selected node required for independent viewport anchor measurement');
        const viewport = document.getElementById('viewport'), bounds = viewport.getBoundingClientRect();
        const point = new DOMPoint(node.x + node.width / 2, node.y + node.height / 2)
            .matrixTransform(document.getElementById('world').getScreenCTM());
        return { id, scale: state.current.viewport.scale, clientWidth: viewport.clientWidth, clientHeight: viewport.clientHeight,
            bounds: bounds.toJSON(), point: { x: point.x, y: point.y },
            offset: { x: point.x - bounds.left - viewport.clientWidth / 2, y: point.y - bounds.top - viewport.clientHeight / 2 } };
    });
}

function assertAnchor(before, after) {
    assert.equal(after.id, before.id); assert.equal(after.scale, before.scale);
    for (const axis of ['x', 'y']) assert.ok(Math.abs(after.offset[axis] - before.offset[axis]) <= 0.02,
        `Selected anchor ${axis} changed relative to client canvas center: ${JSON.stringify({ before, after })}`);
}

function assertKoreanWord(label, word) {
    assert.equal(label.text, word); assert.equal(label.lineRects.length, 1, `${word} wraps across lines`);
    assert.equal(label.glyphs.map(glyph => glyph.text).join(''), word, `${word} glyphs are missing`);
    assert.ok(label.glyphs.every(glyph => glyph.visible), `${word} is clipped or offscreen`);
    assert.ok(label.effectiveFont >= 9, `${word} is below 9 CSS px`);
}
const assertKoreanDesignLabel = label => assertKoreanWord(label, '설계');

async function koreanWord(frame, selector, word, frameScale) {
    const label = await frame.locator(selector).evaluate((element, word) => {
        const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
        let text;
        while (walker.nextNode()) if (walker.currentNode.textContent.includes(word)) { text = walker.currentNode; break; }
        if (!text) throw new Error(`Actual ${word} text node is missing`);
        const start = text.textContent.indexOf(word), range = document.createRange();
        range.setStart(text, start); range.setEnd(text, start + word.length);
        const lineRects = [...range.getClientRects()].filter(rect => rect.width > 0 && rect.height > 0).map(rect => rect.toJSON());
        let matrix = new DOMMatrix(), visible = true;
        for (let ancestor = element; ancestor; ancestor = ancestor.parentElement) {
            const style = getComputedStyle(ancestor);
            visible &&= style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) > 0;
            if (style.transform !== 'none') matrix = new DOMMatrix(style.transform).multiply(matrix);
            const zoom = Number.parseFloat(style.zoom); if (Number.isFinite(zoom) && zoom !== 1) matrix = new DOMMatrix().scale(zoom).multiply(matrix);
        }
        const { a, b, c, d } = matrix, sum = a * a + b * b + c * c + d * d, determinant = a * d - b * c;
        const localScale = Math.sqrt(Math.max(0, (sum - Math.sqrt(Math.max(0, sum * sum - 4 * determinant * determinant))) / 2));
        const bounds = element.getBoundingClientRect(), glyphs = [];
        for (let index = start; index < start + word.length; index++) {
            const glyph = document.createRange(); glyph.setStart(text, index); glyph.setEnd(text, index + 1);
            const rect = glyph.getBoundingClientRect();
            glyphs.push({ text: text.textContent[index], bounds: rect.toJSON(), visible: visible && rect.width > 0 && rect.height > 0
                && rect.left >= Math.max(bounds.left, 0) && rect.right <= Math.min(bounds.right, innerWidth)
                && rect.top >= Math.max(bounds.top, 0) && rect.bottom <= Math.min(bounds.bottom, innerHeight) });
        }
        return { text: word, fullText: element.textContent, lineRects, glyphs, localScale, declaredFont: Number.parseFloat(getComputedStyle(element).fontSize) };
    }, word);
    label.effectiveFont = label.declaredFont * label.localScale * frameScale;
    return label;
}

async function stablePane(frame) {
    await frame.evaluate(() => new Promise(resolve => {
        let previous = '', count = 0;
        const tick = () => { const viewport = document.getElementById('viewport');
            const next = [innerWidth, innerHeight, viewport.clientWidth, viewport.clientHeight].join(':');
            count = next === previous ? count + 1 : 0; previous = next;
            if (count >= 4) resolve(); else requestAnimationFrame(tick);
        }; requestAnimationFrame(tick);
    }));
}

async function measureControls(frame, frameScale) {
    const controls = await frame.evaluate(() => ['back', 'forward', 'up', 'fit', 'fit-selection', 'toggle-inspector', 'connect-rtl'].map(id => {
        const element = document.getElementById(id), style = getComputedStyle(element), bounds = element.getBoundingClientRect();
        let matrix = new DOMMatrix(), visible = bounds.width > 0 && bounds.height > 0;
        for (let ancestor = element; ancestor; ancestor = ancestor.parentElement) {
            const computed = getComputedStyle(ancestor);
            visible &&= computed.display !== 'none' && computed.visibility !== 'hidden' && Number(computed.opacity) > 0;
            if (computed.transform !== 'none') matrix = new DOMMatrix(computed.transform).multiply(matrix);
            const zoom = Number.parseFloat(computed.zoom); if (Number.isFinite(zoom) && zoom !== 1) matrix = new DOMMatrix().scale(zoom).multiply(matrix);
        }
        const { a, b, c, d } = matrix, sum = a * a + b * b + c * c + d * d, determinant = a * d - b * c;
        const scale = Math.sqrt(Math.max(0, (sum - Math.sqrt(Math.max(0, sum * sum - 4 * determinant * determinant))) / 2));
        const glyphs = [], text = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
        while (text.nextNode()) for (let index = 0; index < text.currentNode.length; index++) {
            const range = document.createRange(); range.setStart(text.currentNode, index); range.setEnd(text.currentNode, index + 1);
            for (const rect of range.getClientRects()) glyphs.push({ text: text.currentNode.textContent[index], ...rect.toJSON(),
                unclipped: rect.left >= bounds.left - 0.02 && rect.right <= bounds.right + 0.02 && rect.top >= bounds.top - 0.02
                    && rect.bottom <= bounds.bottom + 0.02 && rect.left >= 0 && rect.top >= 0 && rect.right <= innerWidth && rect.bottom <= innerHeight });
        }
        return { id, text: element.textContent, visible, declaredFont: Number.parseFloat(style.fontSize), effectiveFont: Number.parseFloat(style.fontSize) * scale,
            bounds: bounds.toJSON(), glyphs };
    }));
    const findings = [];
    for (const control of controls) { control.effectiveFont *= frameScale;
        if (!control.visible || !control.glyphs.length || control.glyphs.some(glyph => !glyph.unclipped)) findings.push({ id: control.id, kind: 'missing-or-clipped-control' });
        if (control.effectiveFont < 9) findings.push({ id: control.id, kind: 'small-control-font', effectiveFont: control.effectiveFont });
    }
    return { controls, findings };
}

async function resizePane(frame, page, targetCssWidth) {
    const before = await (await frame.frameElement()).boundingBox(), inner = await frame.evaluate(() => innerWidth);
    const candidates = await page.locator('.part.editor .monaco-sash.vertical').evaluateAll(nodes => nodes.map(node => {
        const bounds = node.getBoundingClientRect(), style = getComputedStyle(node);
        return { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height, display: style.display, visibility: style.visibility };
    }));
    const handles = candidates.filter(item => item.display !== 'none' && item.visibility !== 'hidden'
        && item.width > 0 && item.height > before.height / 2 && Math.abs(item.x - before.x - before.width) < 12);
    assert.ok(handles.length, 'Actual split editor sash beside Webview not found');
    const handle = handles.sort((a, b) => b.height - a.height)[0], x = handle.x + handle.width / 2, y = handle.y + handle.height / 2;
    await page.mouse.move(x, y); await page.mouse.down();
    await page.mouse.move(x + (targetCssWidth - inner) * before.width / inner, y, { steps: 12 }); await page.mouse.up();
    await stablePane(frame);
    return { requestedWebviewCssWidth: targetCssWidth, before, handle,
        after: await (await frame.frameElement()).boundingBox(), actualWebviewCssWidth: await frame.evaluate(() => innerWidth),
        method: 'Actual pointer drag on VS Code editor group sash; no emulated viewport or CSS sizing' };
}

async function setTheme(frame, page, name, expected) {
    await page.keyboard.press('ControlOrMeta+K'); await page.keyboard.press('ControlOrMeta+T');
    const picker = page.locator('.quick-input-widget'); await picker.waitFor({ state: 'visible' });
    await picker.locator('input').fill(name);
    const option = picker.getByRole('option').filter({ hasText: name });
    await option.first().waitFor({ state: 'visible' }); assert.equal(await option.count(), 1, 'Ambiguous built-in theme');
    const text = await option.innerText(); await option.click(); await picker.waitFor({ state: 'hidden' });
    await frame.waitForFunction(value => document.documentElement.dataset.theme === value, expected);
    return { requested: name, actualChoice: text, actualTheme: expected, method: 'Actual VS Code theme QuickPick' };
}

async function exportThroughDialog(native, frame, page, output, state) {
    await page.keyboard.press('ControlOrMeta+,');
    const editor = page.locator('.settings-editor'); await editor.waitFor({ state: 'visible' });
    const search = page.locator('.monaco-editor[data-uri^="settingseditor:searchinput"]');
    await search.click(); await page.keyboard.press('ControlOrMeta+A'); await page.keyboard.insertText('files.simpleDialog.enable');
    const checkbox = editor.getByRole('checkbox', { name: 'files.simpleDialog.enable', exact: true });
    await checkbox.waitFor({ state: 'visible' });
    assert.equal(await checkbox.count(), 1, 'Simple file dialog setting must be the sole filtered checkbox');
    if (await checkbox.getAttribute('aria-checked') !== 'true') await checkbox.click();
    assert.equal(await checkbox.getAttribute('aria-checked'), 'true');
    const settingsFile = path.join(native.receipt.isolation.userDataDir, 'User/settings.json');
    await new Promise((resolve, reject) => {
        const watcher = fs.watch(path.dirname(settingsFile), () => check());
        const done = error => { clearTimeout(timer); watcher.close(); if (error) reject(error); else resolve(); };
        const timer = setTimeout(() => done(new Error('Private simple-dialog setting did not persist')), 15000);
        function check() {
            try { if (JSON.parse(fs.readFileSync(settingsFile))['files.simpleDialog.enable'] === true) done(); }
            catch (error) { if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) done(error); }
        }
        check();
    });
    await page.keyboard.press('Escape'); await editor.waitFor({ state: 'hidden' });
    const settings = JSON.parse(fs.readFileSync(settingsFile));
    assert.equal(settings['files.simpleDialog.enable'], true);
    if (!await frame.locator('#native-inputs').evaluate(node => node.open)) await frame.locator('#native-inputs > summary').click();
    const filename = path.join(output, 'native-export.svg'); assert.equal(fs.existsSync(filename), false);
    await frame.locator('#export-svg').click();
    const picker = page.locator('.quick-input-widget'); await picker.waitFor({ state: 'visible', timeout: 15000 });
    await picker.locator('input').fill(filename); await picker.locator('input').press('Enter');
    await frame.waitForFunction(() => window.__bsvVsixSmoke.host.some(message => message.kind === 'response'
        && message.action === 'export-svg' && message.payload?.status === 'complete'), null, { timeout: 30000 });
    assert.ok(fs.existsSync(filename), 'Actual save dialog did not write the chosen SVG');
    const bytes = fs.readFileSync(filename), metadata = await frame.evaluate(svg => {
        const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
        if (doc.querySelector('parsererror')) throw new Error('Saved SVG is malformed');
        return JSON.parse(doc.querySelector('metadata').textContent);
    }, bytes.toString('utf8'));
    return { file: path.basename(filename), bytes: bytes.length, sha256: hash(bytes), setting: 'Isolated user Settings GUI enabled files.simpleDialog.enable',
        ...assertExport(metadata, state) };
}

async function bootstrapKorean({ vsix, observerVsix, workspace, languagePackVsix, output }) {
    const { launchNative } = require('../g6/native-driver.cjs');
    output ||= require('../g6/run.cjs').createRun('usability-ko-language-bootstrap');
    const native = await launchNative({ vsix, observerVsix, workspace, languagePackVsix, locale: 'ko',
        output, restricted: true, harnessFiles: [__filename] });
    try {
        const diagnostics = await native.channel.request('observeHardware');
        assert.deepEqual(diagnostics.sessions, [], 'Language preparation must not open a Hardware session');
        const commands = native.channel.records.filter(record => record.type === 'driverInput' && record.action === 'openProductCommand');
        assert.deepEqual(commands, [], 'Language preparation must not execute a product command');
        const configFile = path.join(native.receipt.isolation.userDataDir, 'languagepacks.json');
        const bytes = fs.readFileSync(configFile), config = JSON.parse(bytes);
        assert.equal(hash(fs.readFileSync(config.ko.translations.vscode)), native.receipt.languagePack.translationSha256);
        native.receipt.scope = 'language-pack-first-GUI-preparation-only';
        native.receipt.languageBootstrap = { source: 'Unmodified VS Code generated its own languagepacks.json after first GUI startup',
            configSha256: hash(bytes), configCreatedAt: fs.statSync(configFile).birthtime.toISOString(),
            productCommands: commands, hardwareSessions: diagnostics.sessions,
            discovery: 'NOT RUN: no Hardware session or product command', import: 'NOT RUN' };
        native.save(); await native.capture('language-bootstrap-before-restart');
        await native.close(); assert.equal(native.receipt.status, 'passed');
        return path.join(output, 'native-receipt.json');
    } catch (error) { await native.close('failed', error); throw error; }
}

async function run({ vsix, observerVsix, workspace, locale = 'en', languagePackVsix, reuseProfileReceipt, output }) {
    assert.ok(vsix && observerVsix && workspace); assert.ok(['en', 'ko'].includes(locale));
    const { launchNative } = require('../g6/native-driver.cjs');
    const { createRun } = require('../g6/run.cjs');
    const { workspaceInventory } = require('../g6/live-compiler.cjs');
    const { settled, chooseObject } = require('../g6/development-smoke.cjs');
    const { analyze, sourceReveal } = require('../g6/native-acceptance.cjs');
    const { measureNative, validateNativeTypography } = require('../g6/native-oracle.cjs');
    const { validateGeometry } = require('../g4-fix/oracle/geometry.cjs');
    output ||= process.env.G6_OUTPUT_DIR || createRun(`usability-responsive-${locale}`);
    workspace = fs.realpathSync(workspace); const before = workspaceInventory(workspace);
    const report = { schema: 'g6-usability-native-responsive-v1', status: 'running', startedAt: new Date().toISOString(),
        vsix, vsixSha256: hash(fs.readFileSync(vsix)), workspace, localeRequested: locale, captures: [], actions: [],
        userVisualDesignAcceptance: 'PENDING', globalWindowResize: 'NOT RUN: only actual workbench pane resizing',
        sourceFixtureScope: 'Actual unchanged AQuA; Korean UI with original identifiers, no synthetic compiler/CJK source claim' };
    if (reuseProfileReceipt) report.localeBootstrap = { path: path.resolve(reuseProfileReceipt), sha256: hash(fs.readFileSync(reuseProfileReceipt)) };
    let localizedThemes;
    if (locale === 'ko') {
        assert.ok(languagePackVsix, 'Actual Korean environment requires the explicit official language pack');
        const member = 'extension/translations/extensions/vscode.theme-defaults.i18n.json';
        const bytes = require('node:child_process').execFileSync('/usr/bin/unzip', ['-p', languagePackVsix, member], { maxBuffer: 1048576 });
        localizedThemes = JSON.parse(bytes).contents.package;
        report.themeLocalization = { member, sha256: hash(bytes), labels: localizedThemes };
    }
    write(output, 'responsive-contract.json', { ...report, fontFloorCssPx: 9, selectedTargetCssPx: 12,
        narrowPaneRequestedCssPx: 420, noSourceRegistration: true, noCompiler: true, noProductEdits: true });
    write(output, 'workspace-before.json', before);
    let native, frame, page;
    try {
        native = await launchNative({ vsix, observerVsix, workspace, locale, languagePackVsix, reuseProfileReceipt, output, restricted: true, harnessFiles: [__filename,
            path.resolve(__dirname, '../g5-readability/oracle.cjs'), path.resolve(__dirname, '../g4-fix/oracle/geometry.cjs'),
            path.resolve(__dirname, '../g6/live-compiler.cjs')] });
        page = native.context.pages()[0];
        const noTrust = page.getByRole('button', { name: /^(No, I don't trust the authors|아니요, 작성자를 신뢰하지 않습니다)(?:\.|$)/ });
        if (await noTrust.isVisible()) await noTrust.click();
        await native.channel.request('openProductCommand', { command: 'bsvArchitecture.openHardwareSchematic' });
        ({ frame, page } = await native.findWebview());
        report.localeActual = await frame.locator('html').getAttribute('lang');
        assert.equal(report.localeActual, locale, 'Requested locale was not supplied by the actual Extension Host');
        const picker = page.locator('.quick-input-widget'); await picker.waitFor({ state: 'visible', timeout: 90000 });
        await native.nativeInput({ choice: 'mkAquaMemorySubsystem' }, page);
        await frame.waitForFunction(() => window.bsvHardware.getState().scene?.shell.label === 'mkAquaMemorySubsystem', null, { timeout: 90000 });
        let state = await settled(frame); const memoryId = state.scene.shell.id;
        assert.equal(state.current.snapshotId, null); assert.equal((await native.channel.request('observeEditors')).trusted, false);
        const posted = await frame.evaluate(() => window.__bsvVsixSmoke.posts.map(message => message.action));
        assert.ok(posted.includes('discover-workspace'));
        assert.equal(posted.some(action => ['choose-source', 'choose-manifest', 'choose-artifact'].includes(action)), false);
        if (locale === 'ko') for (const [id, label] of [['back', '뒤로'], ['up', '상위'], ['fit', '전체 구조 맞춤'], ['connect-rtl', 'RTL 결과 연결']])
            assert.equal(await frame.locator(`#${id}`).innerText(), label);
        for (const [selector, command] of [['.part.sidebar', 'workbench.action.toggleSidebarVisibility'], ['.part.auxiliarybar', 'workbench.action.toggleAuxiliaryBar']])
            if (await page.locator(selector).isVisible()) await native.channel.request('uiCommand', { command });
        const capture = async (name, expectations) => {
            await native.traceCheckpoint(`before-${name}`); await page.mouse.move(3, 3); state = await settled(frame);
            const measurement = await measureNative({ native, frame, page });
            const controls = await measureControls(frame, measurement.native.frameScale);
            const designLabel = locale === 'ko' ? await koreanWord(frame, '.native-design-select', '설계', measurement.native.frameScale) : null;
            const continuationWord = locale === 'ko' && (await frame.locator('#display-status').innerText()).includes('이어지는')
                ? await koreanWord(frame, '#display-status', '이어지는', measurement.native.frameScale) : null;
            const typography = validateNativeTypography(state, measurement, { allowOverviewAbbreviation: true, ...expectations });
            const geometry = validateGeometry(state.scene, state.geometry);
            write(output, `${name}.measurement.json`, measurement); write(output, `${name}.state.json`, state);
            write(output, `${name}.oracle.json`, { typography, geometry, controls, designLabel, continuationWord, inspectedVisually: false });
            await native.capture(`${name}-window`, page);
            await frame.locator('body').screenshot({ path: path.join(output, `${name}-webview.png`) });
            report.captures.push({ name, typography: typography.findings, geometry: geometry.findings,
                window: measurement.native.hostWindow, webview: measurement.native.webview, canvas: measurement.canvas });
            await native.traceCheckpoint(`capture-${name}`);
            assert.deepEqual(typography.findings, [], name); assert.deepEqual(geometry.findings, [], name); assert.deepEqual(controls.findings, [], name);
            if (designLabel) assertKoreanDesignLabel(designLabel);
            if (continuationWord) assertKoreanWord(continuationWord, '이어지는');
            if (locale === 'ko' && name === 'U08-narrow-source') assert.ok(continuationWord, 'Narrow selection continuation caption is required');
            console.log('NATIVE_RESPONSIVE_PASS', name); return state;
        };
        await frame.locator('#fit').click();
        const overview = { children: ['load', 'staging', 'accumulators', 'store'], fitAll: true };
        await capture('U08-regular-overview', overview);
        for (const [fallback, expected, key] of [['Light Modern', 'light', 'lightModernThemeLabel'], ['Dark Modern', 'dark', 'darkModernThemeLabel'],
            ['Dark High Contrast', 'high-contrast', 'hcColorThemeLabel']]) {
            const name = locale === 'ko' ? localizedThemes[key] : fallback;
            assert.ok(typeof name === 'string' && name.length, 'Verified language-pack theme label is missing');
            const identity = semanticState(state); report.actions.push(await setTheme(frame, page, name, expected));
            state = await capture(`U11-${expected}`, overview); assert.deepEqual(semanticState(state), identity);
        }
        const load = state.scene.children.find(item => item.label === 'load'); assert.ok(load);
        const block = frame.locator(`[data-semantic-id=${JSON.stringify(load.id)}][data-active="true"]`);
        await block.focus(); await block.press('Enter');
        await frame.waitForFunction(id => window.bsvHardware.getState().current.ownerInstanceId === id, load.id); state = await settled(frame);
        const storage = state.scene.storages.find(item => item.label === 'active'); assert.ok(storage);
        await chooseObject(frame, storage.id); state = await analyze(frame, 'state-accesses');
        await frame.locator('#fit-selection').click(); state = await capture('U11-keyboard-selection', { root: false, selected: true });
        await frame.locator('[data-code-section="writer"] [data-analysis-kind="behavior"]').first().click();
        await frame.waitForFunction(() => window.bsvHardware.getState().current.analysis?.result.kind === 'behavior'); state = await settled(frame);
        const referenceId = await frame.locator('#code-drawer pre[data-source-reference-id]').first().getAttribute('data-source-reference-id');
        const reference = state.current.analysis.result.sourceRefs.find(item => item.id === referenceId);
        assert.ok(reference); const sourceFile = fs.realpathSync(path.resolve(workspace, reference.pathRef));
        assert.ok(!path.relative(workspace, sourceFile).startsWith('..'));
        report.sourceReveal = await sourceReveal({ native, frame, referenceId, fixture: { sourceFiles: [{ pathRef: reference.pathRef, path: sourceFile }] } });
        state = await settled(frame); const same = semanticState(state), beforeResize = await anchor(frame);
        report.actions.push(await resizePane(frame, page, 420)); state = await settled(frame);
        assert.deepEqual(semanticState(state), same); assertAnchor(beforeResize, await anchor(frame));
        await capture('U08-narrow-source', { root: false, selected: true });
        const beforePanel = await anchor(frame);
        await frame.locator('#toggle-inspector').click(); state = await settled(frame);
        assert.deepEqual(semanticState(state), same); assertAnchor(beforePanel, await anchor(frame));
        await capture('U09-inspector-hidden', { root: false, selected: true });
        await frame.locator('#toggle-inspector').click(); state = await settled(frame);
        assert.deepEqual(semanticState(state), same); assertAnchor(beforePanel, await anchor(frame));
        await capture('U09-inspector-restored', { root: false, selected: true });
        await frame.locator('#breadcrumb button').first().click(); state = await settled(frame); assert.equal(state.scene.shell.id, memoryId);
        await page.emulateMedia({ reducedMotion: 'reduce' }); await frame.waitForFunction(() => matchMedia('(prefers-reduced-motion: reduce)').matches);
        await frame.locator(`[data-semantic-id=${JSON.stringify(load.id)}][data-active="true"]`).focus();
        await frame.locator(`[data-semantic-id=${JSON.stringify(load.id)}][data-active="true"]`).press('Enter'); state = await settled(frame);
        assert.equal(state.current.ownerInstanceId, load.id); assert.equal(state.lastTransition.reducedMotion, true); assert.equal(state.lastTransition.duration, 0);
        report.reducedMotion = { status: 'PASS', scope: 'Chromium per-page user preference; OS setting unchanged', transition: state.lastTransition };
        await frame.locator('#back').click(); state = await settled(frame); assert.equal(state.scene.shell.id, memoryId);
        await page.emulateMedia({ reducedMotion: 'no-preference' });
        report.export = await exportThroughDialog(native, frame, page, output, state);
        if (locale === 'ko') {
            const relative = 'hw/bsv/src/control/MatmulScheduler.bsv', file = fs.realpathSync(path.join(workspace, relative));
            assert.ok(!path.relative(workspace, file).startsWith('..'));
            const bytes = fs.readFileSync(file), source = bytes.toString('utf8'), line = source.split('\n').findIndex(text => /[가-힣]/u.test(text)) + 1;
            assert.ok(line > 0, 'Actual workspace source no longer contains Korean comments');
            const sourceEditor = (await native.channel.request('observeEditors')).visible.find(item => item.uri === report.sourceReveal.editor.uri);
            assert.ok(sourceEditor && [1, 2].includes(sourceEditor.viewColumn));
            await native.channel.request('uiCommand', { command: sourceEditor.viewColumn === 1
                ? 'workbench.action.focusFirstEditorGroup' : 'workbench.action.focusSecondEditorGroup' });
            await page.keyboard.press('ControlOrMeta+P');
            await native.nativeInput({ text: relative, accept: false }, page);
            const candidate = page.locator('.quick-input-widget').getByRole('option').filter({ hasText: 'MatmulScheduler.bsv' });
            await candidate.waitFor({ state: 'visible' }); assert.equal(await candidate.count(), 1);
            const actualChoice = await candidate.innerText(); await native.nativeInput({ choice: 'MatmulScheduler.bsv' }, page);
            await page.locator('.quick-input-widget').waitFor({ state: 'hidden' });
            const uri = require('node:url').pathToFileURL(file).href;
            const editor = page.locator(`.monaco-editor[data-uri=${JSON.stringify(uri)}]`);
            await editor.waitFor({ state: 'visible' });
            assert.equal((await native.channel.request('observeEditors')).active.uri, uri);
            await page.keyboard.press('Control+G'); await native.nativeInput({ text: `:${line}` }, page);
            await page.locator('.quick-input-widget').waitFor({ state: 'hidden' });
            await page.waitForFunction(expected => [...document.querySelectorAll('.monaco-editor')]
                .some(node => node.dataset.uri === expected && [...node.querySelectorAll('.view-line')].some(row => /[가-힣]/u.test(row.textContent))), uri);
            const rows = await editor.locator('.view-line').evaluateAll(nodes => nodes.filter(node => /[가-힣]/u.test(node.textContent)).map(node => {
                const range = document.createRange(); range.selectNodeContents(node);
                return { text: node.textContent, font: getComputedStyle(node).font, bounds: node.getBoundingClientRect().toJSON(),
                    glyphBounds: [...range.getClientRects()].map(rect => rect.toJSON()) };
            }));
            assert.ok(rows.length && rows.every(row => row.glyphBounds.some(bounds => bounds.width > 0 && bounds.height > 0)));
            const editors = await native.channel.request('observeEditors');
            assert.equal(editors.active.uri, uri); assert.equal(editors.active.fullTextSha256, hash(bytes)); assert.equal(editors.active.dirty, false);
            await native.capture('U11-actual-korean-source-editor', page);
            report.koreanSourceDisplay = { scope: 'Actual saved workspace file opened through QuickOpen for text rendering; not a replacement for product writer-range validation',
                path: relative, actualChoice, requestedLine: line, sourceSha256: hash(bytes), rows, editor: editors.active,
                diagramAfter: semanticState(await settled(frame)), userVisualDesignAcceptance: 'PENDING' };
            write(output, 'U11-actual-korean-source-editor.json', report.koreanSourceDisplay);
        }
        report.hardware = await native.channel.request('observeHardware'); report.status = 'PASS';
    } catch (error) {
        report.status = 'FAIL'; report.error = error.stack;
        if (native && frame) {
            write(output, 'failure-state.json', await frame.evaluate(() => window.bsvHardware.getState()).catch(() => null));
            write(output, 'failure-dom.json', await frame.locator('body').innerText().catch(() => null));
            await native.capture('responsive-failure-window', page).catch(cause => { report.captureError = cause.message; });
        }
    } finally {
        if (native) { await native.close(report.status === 'PASS' ? 'passed' : 'failed', report.error);
            if (native.receipt.status !== 'passed') report.status = 'FAIL'; }
        const after = workspaceInventory(workspace); write(output, 'workspace-after.json', after);
        report.workspacePreserved = JSON.stringify(before.files) === JSON.stringify(after.files);
        report.vsixPreserved = hash(fs.readFileSync(vsix)) === report.vsixSha256;
        if (!report.workspacePreserved || !report.vsixPreserved) report.status = 'FAIL';
        report.finishedAt = new Date().toISOString(); write(output, 'responsive-report.json', report);
        console.log(JSON.stringify({ output, status: report.status, error: report.error }));
    }
    assert.equal(report.status, 'PASS', report.error); return report;
}

if (require.main === module) {
    if (process.argv.includes('--help')) console.log('node native-responsive.cjs PRODUCT.vsix OBSERVER.vsix WORKSPACE [en|ko]\nUses a fresh isolated installed VSIX, automatic actual-workspace sources, real pane/theme/keyboard/save controls. No product or workspace edits.');
    else { const [vsix, observerVsix, workspace, locale] = process.argv.slice(2); run({ vsix, observerVsix, workspace, locale })
        .catch(error => { console.error(error.stack); process.exitCode = 1; }); }
}
module.exports = { run, bootstrapKorean, semanticState, assertExport, assertAnchor, assertKoreanDesignLabel, assertKoreanWord };
