#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { launchNative } = require('../g6/native-driver.cjs');
const { createRun } = require('../g6/run.cjs');
const { settled } = require('../g6/development-smoke.cjs');
const { identity } = require('../g6/native-acceptance.cjs');

const ROOT = path.resolve(__dirname, '../../..');
const DEFAULT_WORKSPACE = path.join(os.homedir(), 'aisa-lab/DynDNN/IM2P/IM2P.sim');
const DEFAULT_OBSERVER = path.join(ROOT, '.build/hardware/runs/g6-observer-resources-final-xQD0Ig/g6/bsv-lens-g6-observer-0.0.1.vsix');
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const escapeRegExp = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const fileIdentity = file => {
    const resolved = fs.realpathSync(file), bytes = fs.readFileSync(resolved);
    return { path: resolved, bytes: bytes.length, sha256: hash(bytes) };
};
const write = (output, name, value) => fs.writeFileSync(path.join(output, name), `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' });
const position = (text, offset) => {
    const lines = text.slice(0, offset).split('\n');
    return { line: lines.length - 1, character: lines.at(-1).length };
};

class ProductBlocker extends Error {
    constructor(message, evidence = {}) {
        super(message); this.name = 'ProductBlocker'; this.evidence = evidence;
    }
}
function requireProduct(value, message, evidence) {
    if (!value) throw new ProductBlocker(message, evidence);
    return value;
}
function parseArguments(argv) {
    if (argv.includes('--help')) return { help: true };
    const options = {};
    const names = { '--vsix': 'vsix', '--workspace': 'workspace', '--output': 'output', '--root': 'root',
        '--observer-vsix': 'observerVsix', '--vscode': 'vscodeExecutable' };
    for (let index = 0; index < argv.length; index += 1) {
        const key = names[argv[index]];
        assert.ok(key && argv[index + 1] && !argv[index + 1].startsWith('--'), `Unknown or incomplete argument: ${argv[index]}`);
        assert.equal(options[key], undefined, `Duplicate argument: ${argv[index]}`);
        options[key] = argv[++index];
    }
    options.vsix ||= process.env.IM2P_VSIX || process.env.G6_VSIX;
    options.workspace ||= process.env.IM2P_WORKSPACE || DEFAULT_WORKSPACE;
    options.root ||= process.env.IM2P_ROOT || 'mkIM2PCore';
    options.observerVsix ||= process.env.IM2P_OBSERVER_VSIX || process.env.G6_OBSERVER_VSIX || DEFAULT_OBSERVER;
    options.output ||= process.env.G6_OUTPUT_DIR || createRun('im2p-native');
    assert.ok(options.vsix, 'Pass --vsix or set IM2P_VSIX/G6_VSIX');
    return options;
}
function relativeWorkspaceFile(workspace, reference) {
    requireProduct(reference && typeof reference.pathRef === 'string' && reference.range, 'Selected item has no source reference/range', { reference });
    const source = fs.realpathSync(path.resolve(workspace, reference.pathRef));
    const relative = path.relative(workspace, source);
    requireProduct(relative && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative), 'Product source reference escapes IM2P workspace',
        { workspace, reference, source });
    return source;
}

async function run(options) {
    const config = { ...options, workspace: fs.realpathSync(options.workspace), vsix: fs.realpathSync(options.vsix),
        observerVsix: fs.realpathSync(options.observerVsix), output: path.resolve(options.output) };
    assert.ok(fs.statSync(config.workspace).isDirectory(), 'IM2P workspace must be a directory');
    assert.equal(path.basename(config.output), 'g6', 'Output must be a unique G6 run directory');
    fs.mkdirSync(config.output, { recursive: true });
    const report = { schema: 'g6-im2p-native-acceptance-v1', status: 'running', startedAt: new Date().toISOString(),
        workspace: config.workspace, requestedRoot: config.root, productVsix: fileIdentity(config.vsix), observerVsix: fileIdentity(config.observerVsix),
        boundary: 'Installed VSIXes only. The harness opens the actual product command, observes auto-discovery, and uses visible QuickPick, selector, and canvas labels. It never injects a scene, query, source range, compiler result, or development extension path.',
        steps: [], captures: [] };
    write(config.output, 'contract.json', { ...report, status: 'declared', lifecycle: 'preflight-contract' });
    let native, frame, page, failure;
    const capture = async name => {
        const current = await frame.evaluate(() => window.bsvHardware.getState());
        const state = current.current && current.scene && !current.pending && !current.transition ? await settled(frame) : current;
        const host = await native.channel.request('observeHardware');
        const dom = await frame.evaluate(() => ({
            transport: window.BsvHardwareTransport.identity(), current: window.bsvHardware.getState().current,
            scene: window.bsvHardware.getState().scene, error: window.bsvHardware.getState().error,
            pending: window.bsvHardware.getState().pending, history: window.bsvHardware.getState().history,
            status: document.querySelector('#native-input-status')?.textContent,
            selector: document.querySelector('#build-select')?.selectedOptions[0]?.textContent,
            title: document.querySelector('#scene-title')?.textContent
        }));
        write(config.output, `${name}.state.json`, state); write(config.output, `${name}.dom.json`, dom); write(config.output, `${name}.host.json`, host);
        await native.capture(name, page); await native.traceCheckpoint(name);
        report.captures.push({ name, state: `${name}.state.json`, dom: `${name}.dom.json`, host: `${name}.host.json`, png: `${name}.png` });
        return state;
    };
    const waitRoot = async name => {
        await frame.waitForFunction(label => {
            const state = window.bsvHardware.getState();
            if (state.error) throw new Error(JSON.stringify(state.error));
            return state.scene?.shell.label === label && !state.pending && !state.transition;
        }, name, { timeout: 120000 });
        return settled(frame);
    };
    const objectButton = async item => {
        const button = frame.locator(`[data-semantic-id=${JSON.stringify(item.id)}]`);
        requireProduct(await button.count() === 1, `Visible control for "${item.label}" is unavailable or ambiguous`, {
            item, matchingControls: await frame.locator('[data-semantic-id]').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-semantic-id')))
        });
        requireProduct(await button.isVisible(), `Visible control for "${item.label}" is hidden`, { item });
        return button;
    };
    const visibleObject = async (state, label) => {
        const objects = [...(state.scene?.children || []), ...(state.scene?.storages || [])];
        const choices = objects.filter(item => item.label === label);
        const child = requireProduct(choices.length === 1 ? choices[0] : null, `Required visible object label "${label}" is unavailable`, {
            shell: state.scene?.shell, visibleObjects: objects.map(item => ({ label: item.label, kind: item.kind, interaction: item.interaction }))
        });
        return { child, button: await objectButton(child) };
    };
    const enterVisibleChild = async (state, label, { keyboard = false } = {}) => {
        const { child, button } = await visibleObject(state, label);
        requireProduct(child.interaction?.kind === 'enter', `Child "${label}" is visible but cannot be entered`, { child });
        const title = button.locator('.title').first();
        requireProduct(await title.count() === 1 && await title.isVisible(), `Child "${label}" has no visible title glyph to enter`, { child });
        if (keyboard) {
            await button.focus();
            requireProduct(await button.evaluate(node => document.activeElement === node), `Child "${label}" cannot receive keyboard focus`, { child });
            await button.press('Enter');
        } else await title.click();
        await frame.waitForFunction(id => window.bsvHardware.getState().scene?.shell.id === id && !window.bsvHardware.getState().pending,
            child.id, { timeout: 120000 });
        return settled(frame);
    };
    const selectVisibleChild = async (state, label) => {
        const { child, button } = await visibleObject(state, label);
        requireProduct(child.interaction?.kind !== 'enter', `Object "${label}" enters an interior and cannot be inspected in place`, { child });
        await button.click();
        await frame.waitForFunction(id => window.bsvHardware.getState().current?.selectedEntityId === id, child.id, { timeout: 30000 });
        const current = await settled(frame), title = button.locator('.title').first();
        const glyph = await title.evaluate(node => {
            const rect = node.getBoundingClientRect(), style = getComputedStyle(node);
            const object = node.closest('[data-semantic-id]');
            return { text: node.textContent, visible: node.checkVisibility(), ariaLabel: object?.getAttribute('aria-label'),
                className: node.className.baseVal || node.className, glyphKind: object?.dataset.glyphKind, familyShape: object?.dataset.familyShape,
                rect: rect.toJSON(), fill: style.fill, fontSize: style.fontSize, opacity: style.opacity };
        });
        requireProduct(glyph.visible && glyph.rect.width > 0 && glyph.rect.height > 0, `Selected "${label}" glyph is not visibly rendered`, { child, glyph });
        return { state: current, child, glyph };
    };
    const selectRoot = async name => {
        const selector = frame.locator('#build-select');
        requireProduct(await selector.count() === 1 && await selector.isVisible(), 'Product does not expose the visible root selector #build-select', {});
        const choices = await selector.locator('option').evaluateAll(nodes => nodes.map(node => ({ value: node.value, text: node.textContent })));
        const choice = choices.filter(item => item.value.startsWith('design:') && item.text === name);
        requireProduct(choice.length === 1, `Required visible root selector option "${name}" is unavailable`, { choices });
        await selector.selectOption(choice[0].value);
        return waitRoot(name);
    };
    const openSelectedSource = async (state, stepId) => {
        const references = state.scene.inspector?.sourceRefs || [];
        const reference = requireProduct(references.find(item => item.range && item.id),
            `Selected ${state.scene.inspector?.title || state.scene.shell.label} item exposes no source reference/range for Open source`,
            { inspector: state.scene.inspector, references });
        const sourcePath = relativeWorkspaceFile(config.workspace, reference), sourceText = fs.readFileSync(sourcePath, 'utf8');
        assert.equal(hash(sourceText), reference.revision, 'Product source reference revision differs from actual IM2P editor file');
        const open = frame.locator(`[data-source-open-id=${JSON.stringify(reference.id)}]`).first();
        requireProduct(await open.count() === 1 && await open.isVisible(), 'Selected source reference has no visible Open source control', { reference });
        const since = native.channel.records.length;
        await open.click();
        const editor = await native.channel.waitFor('editorSelection', value => value.editor?.uri === pathToFileURL(sourcePath).href
            && value.editor.selectionText === sourceText.slice(reference.range.start, reference.range.end), 30000, since);
        assert.equal(editor.editor.fullTextSha256, reference.revision); assert.equal(editor.editor.dirty, false);
        assert.equal(editor.editor.viewColumn, 1, 'Open source must reuse the left source editor group');
        assert.deepEqual(editor.editor.selection, { start: position(sourceText, reference.range.start), end: position(sourceText, reference.range.end) });
        report.steps.push({ id: stepId, status: 'pass', reference, editor: editor.editor });
        return { reference, editor: editor.editor };
    };
    const selectLens = async lens => {
        const button = frame.locator(`[data-analysis-lens=${JSON.stringify(lens)}]`);
        requireProduct(await button.count() === 1 && await button.isVisible(), `Analysis lens "${lens}" is unavailable`, {});
        await button.click();
        await frame.waitForFunction(value => window.bsvHardware.getState().current?.disclosureState?.analysis?.lens === value,
            lens, { timeout: 30000 });
        const evidence = await frame.evaluate(value => ({
            lens: window.bsvHardware.getState().current.disclosureState.analysis.lens,
            pressed: document.querySelector(`[data-analysis-lens="${value}"]`)?.getAttribute('aria-pressed'),
            relatedRoutes: document.querySelectorAll('.connection.selection-related').length,
            mutedRoutes: document.querySelectorAll('.connection.selection-muted').length,
            visibleActions: [...document.querySelectorAll('[data-analysis-kind]')].filter(node => node.checkVisibility())
                .map(node => node.getAttribute('data-analysis-kind'))
        }), lens);
        assert.equal(evidence.pressed, 'true');
        return evidence;
    };
    try {
        native = await launchNative({ vsix: config.vsix, observerVsix: config.observerVsix, workspace: config.workspace, output: config.output,
            restricted: true, vscodeExecutable: config.vscodeExecutable, harnessFiles: [__filename] });
        page = native.context.pages()[0];
        const untrusted = page.getByRole('button', { name: "No, I don't trust the authors", exact: true });
        if (await untrusted.isVisible()) await untrusted.click();
        assert.equal((await native.channel.request('observeEditors')).trusted, false, 'Harness requires its private IM2P window to remain Restricted Mode');
        await native.channel.request('openProductCommand', { command: 'bsvArchitecture.openHardwareSchematic' });
        ({ frame, page } = await native.findWebview());
        await frame.waitForFunction(() => !!window.BsvHardwareTransport.identity(), null, { timeout: 30000 });

        const chooser = page.locator('.quick-input-title').filter({ hasText: 'Choose a source design' });
        await chooser.waitFor({ state: 'visible', timeout: 120000 });
        const initialVisibleCandidates = [...new Set((await page.locator('.quick-input-list .label-name').allTextContents())
            .map(value => value.trim()).filter(value => value.startsWith('mk')))];
        await native.nativeInput({ text: config.root, accept: false }, page);
        const rootOption = page.getByRole('option', { name: new RegExp(`^${escapeRegExp(config.root)},`) });
        await rootOption.waitFor({ state: 'visible', timeout: 30000 });
        requireProduct(await rootOption.count() === 1, `Requested root "${config.root}" is unavailable or ambiguous after searching actual auto-discovery`, {
            requestedRoot: config.root, matchingLabels: await page.locator('.quick-input-list .label-name').allTextContents()
        });
        report.discovery = { initialVisibleCandidates, searchedRoot: config.root,
            transport: await frame.evaluate(() => window.BsvHardwareTransport.identity()), host: await native.channel.request('observeHardware') };
        write(config.output, 'auto-discovery.json', report.discovery); await capture('01-auto-discovery');
        await rootOption.click();
        let state = await waitRoot(config.root);
        report.steps.push({ id: 'root', status: 'pass', root: config.root, identity: identity(state), visibleChildren: state.scene.children.map(item => item.label) });
        await capture('02-root');

        if (config.root !== 'mkIM2PCore') throw new ProductBlocker('The requested explicit root is not mkIM2PCore, so the required systolicArray → processingElements journey cannot be asserted.',
            { requestedRoot: config.root, visibleChildren: state.scene.children.map(item => item.label) });
        const core = identity(state);
        await page.emulateMedia({ reducedMotion: 'reduce' });
        requireProduct(await frame.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches),
            'Native Webview did not receive reduced-motion preference', {});
        state = await enterVisibleChild(state, 'systolicArray', { keyboard: true });
        await page.emulateMedia({ reducedMotion: 'no-preference' });
        const systolic = identity(state);
        report.steps.push({ id: 'systolic-array', status: 'pass', identity: identity(state), shell: state.scene.shell, visibleChildren: state.scene.children.map(item => item.label) });
        await capture('03-systolic-array');

        state = await enterVisibleChild(state, 'processingElements');
        requireProduct(state.scene.projection?.familyScope?.familyInstanceId === state.scene.shell.id,
            'Entered processingElements scene has no honest family scope', { shell: state.scene.shell, projection: state.scene.projection });
        requireProduct(state.scene.projection.familyScope.kind === 'symbolic-element'
            && state.scene.projection.familyScope.selectedIndices === null
            && /\[\*\]\[\*\]$/.test(state.scene.projection.familyScope.elementLabel),
        'Symbolic processingElements view does not expose an honest element identity', state.scene.projection.familyScope);
        const familyButton = await objectButton(state.scene.shell), familyTitle = familyButton.locator('.title').first();
        const familyGlyph = await familyTitle.evaluate(node => {
            const object = node.closest('[data-semantic-id]'), rect = node.getBoundingClientRect();
            return { text: node.textContent, visible: node.checkVisibility(), glyphKind: object?.dataset.glyphKind,
                familyShape: object?.dataset.familyShape, rect: rect.toJSON() };
        });
        const familyMetadata = { selected: state.scene.shell, inspector: state.scene.inspector,
            projection: state.scene.projection, glyph: familyGlyph };
        const familyElement = frame.locator('[data-section-id="family-element-view"]');
        requireProduct(await familyElement.count() === 1 && await familyElement.isVisible(),
            'Symbolic family element explanation is not visible in the Inspector', familyMetadata);
        familyMetadata.inspectorText = await familyElement.textContent();
        report.steps.push({ id: 'processing-elements-family', status: 'pass', familyMetadata });
        write(config.output, 'processing-elements-family.json', familyMetadata); await capture('04-processing-elements');

        await openSelectedSource(state, 'open-processing-elements-source');
        await capture('05-processing-elements-editor');

        await frame.locator('#back').click();
        await frame.waitForFunction(id => window.bsvHardware.getState().scene?.shell.id === id && !window.bsvHardware.getState().pending,
            systolic.owner, { timeout: 30000 });
        state = await settled(frame);
        report.steps.push({ id: 'back-restored-systolic-array', status: 'pass', before: systolic, restored: identity(state) });
        await capture('06-back-restored-systolic-array');
        await frame.locator('#back').click();
        await frame.waitForFunction(id => window.bsvHardware.getState().scene?.shell.id === id && !window.bsvHardware.getState().pending,
            core.owner, { timeout: 30000 });
        state = await settled(frame);
        report.steps.push({ id: 'back-restored-core', status: 'pass', before: core, restored: identity(state) });
        await capture('07-back-restored-core');

        for (const [name, captureName] of [['mkPE', '08-mkPE-root'], ['mkVectorUnit', '10-mkVectorUnit-root']]) {
            state = await selectRoot(name);
            report.steps.push({ id: `root-${name}`, status: 'pass', identity: identity(state), shell: state.scene.shell,
                visibleChildren: state.scene.children.map(item => item.label), visibleStorage: state.scene.storages.map(item => item.label) });
            await capture(captureName);
            if (name === 'mkPE') {
                for (const storageName of ['weightRegs', 'weightValidRegs']) {
                    const result = await selectVisibleChild(state, storageName); state = result.state;
                    requireProduct(['vector', 'symbolic'].includes(result.glyph.familyShape),
                        `${storageName} is not rendered as repeated storage`, { glyph: result.glyph, storage: result.child });
                    const lens = await selectLens('value');
                    report.steps.push({ id: `${storageName}-value-lens`, status: 'pass', lens });
                    await openSelectedSource(state, `open-${storageName}-source`);
                }
                await capture('09-mkPE-storage-families');
            } else {
                const result = await selectVisibleChild(state, 'groupIndexReg'); state = result.state;
                requireProduct(result.glyph.glyphKind === 'register' && result.glyph.familyShape === 'scalar',
                    'groupIndexReg is not rendered as scalar register state', { glyph: result.glyph, storage: result.child });
                const valueLens = await selectLens('value');
                requireProduct(valueLens.relatedRoutes > 0, 'Selected groupIndexReg has no visibly highlighted related relation', valueLens);
                const controlLens = await selectLens('control');
                requireProduct(controlLens.visibleActions.includes('behavior'), 'Control lens exposes no source behavior action for groupIndexReg', controlLens);
                report.steps.push({ id: 'group-index-lenses', status: 'pass', valueLens, controlLens });
                await openSelectedSource(state, 'open-groupIndexReg-source');
                await capture('11-vector-unit-group-index');
            }
        }
        report.status = 'pass'; report.installedRuntimeIdentity = native.receipt.installedRuntimeIdentity;
    } catch (error) {
        failure = error; report.status = error instanceof ProductBlocker ? 'blocked' : 'fail';
        report.blocker = error instanceof ProductBlocker ? { message: error.message, evidence: error.evidence } : undefined;
        report.error = error.stack || String(error);
        if (native && frame) {
            try { await capture('failure'); } catch (captureError) { report.captureError = captureError.message; }
        }
    } finally {
        if (native) await native.close(report.status === 'pass' ? 'passed' : 'failed', failure);
        report.finishedAt = new Date().toISOString();
        report.receipt = native ? { path: path.join(config.output, 'native-receipt.json'), status: native.receipt.status,
            installedRuntimeIdentity: native.receipt.installedRuntimeIdentity, installedTarget: native.receipt.installedTarget } : null;
        write(config.output, 'validation.json', report);
        console.log(JSON.stringify({ output: config.output, status: report.status, blocker: report.blocker?.message || null }));
    }
    if (failure) throw failure;
    return report;
}

if (require.main === module) {
    const options = parseArguments(process.argv.slice(2));
    if (options.help) console.log('node experiments/hardware/g6-im2p/native-acceptance.cjs --vsix PRODUCT.vsix [--workspace IM2P.sim] [--root mkIM2PCore] [--observer-vsix OBSERVER.vsix] [--output UNIQUE_RUN/g6]');
    else run(options).catch(error => { console.error(error.stack || error); process.exitCode = 1; });
}

module.exports = { run, parseArguments, ProductBlocker };
