#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { launchNative } = require('../g6/native-driver.cjs');
const { createRun } = require('../g6/run.cjs');
const { settled, chooseObject } = require('../g6/development-smoke.cjs');
const { identity, enter, analyze, sourceReveal } = require('../g6/native-acceptance.cjs');
const { poll, attack, revealButton, openWorkspacePanel } = require('../g6/native-security-attacks.cjs');
const { measureNative } = require('../g6/native-oracle.cjs');
const { validateGeometry } = require('../g4-fix/oracle/geometry.cjs');
const { prepare, digest } = require('./native-lifecycle-inputs.cjs');
const { runInteractions } = require('./native-lifecycle-interactions.cjs');
const ROOT = path.resolve(__dirname, '../../..');
const write = (output, name, value) => fs.writeFileSync(path.join(output, name), JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });

async function run({ vsix, lane = 'all', output = process.env.G6_OUTPUT_DIR || createRun('usability-native-lifecycle'),
    observerVsix = path.join(ROOT, '.build/hardware/runs/g6-observer-resources-final-xQD0Ig/g6/bsv-lens-g6-observer-0.0.1.vsix') }) {
    assert.ok(vsix); assert.ok(['all', 'interactions'].includes(lane));
    const inputs = prepare(output), startedAt = new Date().toISOString();
    if (lane === 'interactions') { inputs.write(inputs.sourceRelative, inputs.design); inputs.write('deep/types/Types.bsv', inputs.types); }
    const report = { schema: 'g6-usability-native-lifecycle-v1', startedAt, status: 'running', vsix: path.resolve(vsix),
        vsixSha256: digest(fs.readFileSync(vsix)), scope: 'Installed VSIX, isolated generic BSV workspace',
        lane, normalAssets: true, compilerExecuted: false, steps: [], captures: [], notRun: [], userVisualDesignAcceptance: 'PENDING' };
    write(output, 'lifecycle-contract.json', { ...report, source: inputs.design, workspaceFile: inputs.workspaceFile,
        budgets: { settleMs: 60000, sourceFiles: 12, sourceBytes: 262144, nativeConcurrency: 4 },
        driverBoundary: 'Pointer/keyboard and explicit source modifications inside this generated fixture. Product queries/resolvers/registry remain real.' });
    let native, frame, page, sequence = 0;
    const pass = (id, detail) => { report.steps.push({ ...detail, ...(detail?.status ? { detailStatus: detail.status } : {}),
        id, status: 'PASS', executed: true }); write(output, `${id}.json`, detail); console.log('LIFECYCLE_PASS', id); };
    const hardware = () => native.channel.request('observeHardware');
    const currentSession = async () => {
        const id = await frame.evaluate(() => window.BsvHardwareTransport.identity().panelId);
        return (await hardware()).sessions.find(session => session.protocol.panelId === id);
    };
    const waitSource = async predicate => poll(currentSession, session => !!session && session.state.activeOperations === 0
        && predicate(session), 'Latest native source inventory', 60000);
    const chooseRoot = async (name = 'mkController') => {
        let usedChooser = false;
        await poll(async () => {
            if (await frame.evaluate(name => window.bsvHardware?.getState().scene?.shell.label === name, name)) return true;
            if (await page.locator('.quick-input-title').filter({ hasText: 'Choose a source design' }).isVisible()) {
                usedChooser = true; await native.nativeInput({ choice: name }, page);
            }
            return false;
        }, Boolean, 'Source-derived root selection', 60000);
        return { usedChooser };
    };
    const waitOwner = async label => {
        await frame.waitForFunction(name => { const s = window.bsvHardware.getState();
            return !s.pending && !s.error && s.scene?.shell.label === name; }, label, { timeout: 60000 });
        return settled(frame);
    };
    const capture = async label => {
        await native.traceCheckpoint(`before-${label}`);
        const state = await frame.evaluate(async () => { await document.fonts.ready; return window.bsvHardware.whenSettled(); }), host = await currentSession();
        const dom = await frame.evaluate(() => ({ selector: document.getElementById('build-select').value,
            selectedLabel: document.getElementById('build-select').selectedOptions[0]?.textContent,
            title: document.getElementById('scene-title').textContent, inspector: document.getElementById('inspector').innerText,
            input: document.getElementById('native-input-status').innerText, status: document.getElementById('status').innerText,
            empty: document.getElementById('native-empty').innerText, feedback: document.getElementById('navigation-feedback').innerText,
            posts: window.__bsvVsixSmoke.posts.map(message => ({ action: message.action, requestId: message.requestId, generation: message.generation })) }));
        const measurement = state.scene ? await measureNative({ native, frame, page }) : null;
        const geometry = state.scene ? validateGeometry(state.scene, state.geometry) : null;
        write(output, `${label}.state.json`, state); write(output, `${label}.host.json`, host); write(output, `${label}.dom.json`, dom);
        write(output, `${label}.measurement.json`, measurement); write(output, `${label}.geometry.json`, geometry);
        await native.capture(`${label}-window`, page); await frame.locator('body').screenshot({ path: path.join(output, `${label}-webview.png`) });
        if (state.current) assert.equal(host.current?.ownerInstanceId, state.current.ownerInstanceId, 'Host and drawable owner differ');
        else assert.equal(host.current, null);
        if (geometry) assert.equal(geometry.valid, true, JSON.stringify(geometry.findings));
        report.captures.push(label); return { state, host, dom, measurement };
    };
    const settingsOpen = async () => { if (!await frame.locator('#native-inputs').evaluate(node => node.open)) await frame.locator('#native-inputs > summary').click(); };
    const refresh = async () => { await settingsOpen(); await frame.locator('[data-native-action="refresh-input"]').click(); };
    const selection = async name => {
        const values = await frame.locator('#build-select option').evaluateAll(nodes => nodes.map(node => ({ value: node.value, text: node.textContent })));
        const matches = values.filter(value => value.text === name); assert.equal(matches.length, 1);
        await frame.locator('#build-select').selectOption(matches[0].value); return waitOwner(name);
    };
    try {
        native = await launchNative({ vsix, observerVsix, workspace: inputs.main, workspaceFile: inputs.workspaceFile,
            output, restricted: true, harnessFiles: [__filename, require.resolve('./native-lifecycle-inputs.cjs'), require.resolve('./native-lifecycle-interactions.cjs')] });
        inputs.attachSettings(path.join(native.receipt.isolation.userDataDir, 'User/settings.json'), native.receipt.isolation.userDataDir);
        page = native.context.pages()[0];
        const trust = page.getByRole('button', { name: "No, I don't trust the authors", exact: true }); if (await trust.isVisible()) await trust.click();
        assert.equal((await native.channel.request('observeEditors')).trusted, false);
        ({ frame, page } = await openWorkspacePanel(native, path.basename(inputs.main)));
        if (lane === 'interactions') {
            await chooseRoot(); await waitOwner('mkController'); await capture('interactions-source-start');
        } else {
        await waitSource(session => session.discovery?.status === 'no-bsv' && !session.discovery.rules.exclude.includes('**/build/**'));
        pass('D04-no-bsv', await capture('D04-no-bsv'));
        inputs.write('deep/types/Types.bsv', inputs.types);
        await waitSource(session => session.discovery?.status === 'no-module');
        const functions = await capture('D04-function-only'); assert.match(functions.dom.empty, /no hardware module roots/);
        assert.equal(functions.state.current, null); assert.notEqual(functions.dom.selectedLabel, 'No BSV files found'); pass('D04-function-only', functions);
        inputs.write(inputs.sourceRelative, inputs.design); const rootChoice = await chooseRoot(); let state = await waitOwner('mkController');
        assert.equal(rootChoice.usedChooser, false, 'A single source-derived root must open without selecting an internal module');
        assert.deepEqual(state.scene.children.map(child => child.label), ['west', 'east']);
        const initial = await capture('D01-deep-discovery');
        assert.ok(initial.dom.posts.some(message => message.action === 'discover-workspace'));
        assert.ok(!initial.dom.posts.some(message => ['choose-source', 'choose-manifest', 'choose-artifact'].includes(message.action)));
        pass('D01-D03-R01', { current: state.current, discovery: initial.host.discovery });

        const firstProtocol = await frame.evaluate(() => window.BsvHardwareTransport.identity());
        const firstIdentity = identity(state), second = await openWorkspacePanel(native, path.basename(inputs.other));
        const primary = { frame, page }; frame = second.frame; page = second.page; await chooseRoot(); state = await waitOwner('mkController');
        const other = await capture('D02-independent-workspace'); assert.notEqual(other.host.protocol.panelId, firstProtocol.panelId);
        assert.notEqual(other.state.current.buildId, firstIdentity.buildId);
        const foreign = await attack({ native, frame, id: 'foreign-panel', change: { panelId: firstProtocol.panelId, sessionId: firstProtocol.sessionId }, expectedCode: 'FORBIDDEN' });
        pass('D02-multi-root', { first: firstIdentity, other: identity(state), foreign });
        ({ frame, page } = await openWorkspacePanel(native, path.basename(inputs.main))); state = await settled(frame);
        assert.equal(frame, primary.frame); assert.deepEqual(identity(state), firstIdentity);

        state = await enter(frame, 'west'); const west = state.current.ownerInstanceId;
        await chooseObject(frame, state.scene.storages.find(item => item.label === 'state').id); await analyze(frame, 'state-accesses');
        await frame.locator('[data-code-section="writer"] [data-analysis-kind="behavior"]').first().click();
        await frame.waitForFunction(() => window.bsvHardware.getState().current?.analysis?.result.kind === 'behavior'); state = await settled(frame);
        const referenceId = await frame.locator('#code-drawer pre[data-source-reference-id]').first().getAttribute('data-source-reference-id');
        const reference = state.current.analysis.result.sourceRefs.find(item => item.id === referenceId); assert.ok(reference);
        const revealed = await sourceReveal({ native, frame, referenceId, fixture: { sourceFiles: [{ pathRef: inputs.sourceRelative, path: inputs.source }] } });
        const diskHash = digest(fs.readFileSync(inputs.source));
        const dirty = await native.channel.request('editBuffer', { path: inputs.source, start: { line: 0, character: 0 }, text: '// unsaved native fixture\n' });
        const since = native.channel.records.length; await revealButton(frame, referenceId);
        const captured = await native.channel.waitFor('editorSelection', event => event.editor?.uri.startsWith('bsv-hardware-capture:')
            && event.editor.selectionSha256 === reference.sliceHash, 30000, since);
        assert.equal(captured.editor.fullTextSha256, reference.revision); assert.equal(digest(fs.readFileSync(inputs.source)), diskHash);
        pass('D12-dirty-source', { revealed, dirty, captured, diskHash }); await native.capture('D12-captured-editor', page);
        await native.channel.request('revertBuffer', { path: inputs.source }); ({ frame, page } = await openWorkspacePanel(native, path.basename(inputs.main)));
        state = await settled(frame); const sourceBefore = state.current.sourceRevision;
        inputs.write(inputs.sourceRelative, inputs.design.replace('state + 1', 'state + 2'));
        await waitSource(session => session.current?.sourceRevision !== sourceBefore); state = await settled(frame);
        const changed = await capture('D05-external-save');
        if (changed.state.current.ownerInstanceId !== west) {
            const failure = { id: 'D05-external-save', status: 'FAIL', executed: true, expectedOwner: west,
                actualOwner: changed.state.current.ownerInstanceId, reason: 'External source refresh silently reset the child scope' };
            report.steps.push(failure); write(output, 'D05-external-save.json', failure); console.error('LIFECYCLE_CASE_FAIL', failure);
        } else pass('D05-external-save', { beforeOwner: west, beforeRevision: sourceBefore, current: state.current });
        await frame.locator('#breadcrumb button').first().click(); await waitOwner('mkController');
        inputs.write('deep/service/Service.bsv', inputs.maintenance);
        await waitSource(session => session.discovery?.included.some(file => file.path === 'deep/service/Service.bsv'));
        await selection('mkMaintenance'); await capture('D05-created-module'); await frame.locator('#back').click(); await waitOwner('mkController');
        inputs.rename('deep/service/Service.bsv', 'deep/service/Moved.bsv');
        await waitSource(session => session.discovery?.included.some(file => file.path === 'deep/service/Moved.bsv')
            && !session.discovery.included.some(file => file.path === 'deep/service/Service.bsv'));
        inputs.remove('deep/service/Moved.bsv'); await waitSource(session => !session.discovery?.included.some(file => file.path === 'deep/service/Moved.bsv'));
        pass('D05-create-rename-delete', await capture('D05-file-events'));

        inputs.write('build/Library.bsv', 'package Library; typedef Bit#(16) Word; endpackage\n');
        inputs.write('tb/Types.bsv', 'package BenchTypes; typedef Bool Flag; endpackage\n');
        await waitSource(session => session.discovery?.included.some(file => file.path === 'build/Library.bsv') && session.discovery.included.some(file => file.path === 'tb/Types.bsv'));
        const classification = (await currentSession()).discovery; assert.equal(classification.included.find(file => file.path === 'tb/Types.bsv').classification, 'testbench-path-candidate');
        pass('D07-library-testbench', classification);
        inputs.settings({ 'bsvArchitecture.exclude': ['build/**'] });
        await waitSource(session => session.discovery?.excluded.some(file => file.path === 'build/Library.bsv' && file.reason === 'configured-exclude'));
        inputs.settings({ 'bsvArchitecture.exclude': ['build/**'], 'bsvArchitecture.hardwareInclude': ['build/**'] });
        await waitSource(session => session.discovery?.included.some(file => file.path === 'build/Library.bsv' && file.inclusion === 'explicit-include'));
        pass('D06-exclude-include', await capture('D06-reincluded'));
        const outside = path.join(inputs.root, 'Outside.bsv'); fs.writeFileSync(outside, 'package Outside; module mkOutside(Empty); endmodule endpackage');
        const link = path.join(inputs.main, 'deep/Escape.bsv'); fs.symlinkSync(outside, link);
        await waitSource(session => session.discovery?.unanalysed.some(file => file.path === 'deep/Escape.bsv'));
        assert.equal((await currentSession()).discovery.unanalysed.find(file => file.path === 'deep/Escape.bsv').reason, 'symlink-or-authority');
        fs.unlinkSync(link); await waitSource(session => !session.discovery?.unanalysed.some(file => file.path === 'deep/Escape.bsv'));
        pass('D08-symlink', { outsideHash: digest(fs.readFileSync(outside)), externalModuleImported: false });
        inputs.write('deep/Huge.bsv', '// oversized test-only source\n' + ' '.repeat(70000)); inputs.settings({ 'bsvArchitecture.maxSourceBytes': 65536 });
        await waitSource(session => session.discovery?.status === 'partial' && session.discovery.unanalysed.some(file => file.reason === 'file-byte-limit'));
        const limited = await capture('D09-partial-limit');
        assert.match(`${limited.dom.input} ${limited.dom.status}`, /partial|incomplete|limit|only some|부분|일부|제한/i,
            'Incomplete source inventory must be visible without opening diagnostic JSON');
        pass('D09-partial-limit', limited); inputs.remove('deep/Huge.bsv'); inputs.settings();
        await waitSource(session => session.discovery?.status === 'ready');
        const envelopeFailures = [];
        for (const [id, action, payload, change, expectedCode] of [
            ['path', 'discover-workspace', { sourceRoot: outside }, {}, 'INVALID_INPUT'],
            ['entry', 'choose-design', { entryId: 'foreign-entry' }, {}, 'FORBIDDEN'],
            ['snapshot', 'catalog', {}, { snapshotId: 'foreign-snapshot' }, 'SNAPSHOT_MISMATCH']])
            envelopeFailures.push(await attack({ native, frame, id: `lifecycle-${id}`, action, payload, change, expectedCode }));
        envelopeFailures.push(await attack({ native, frame, id: 'lifecycle-oversized', oversized: true, expectedCode: 'LIMIT_EXCEEDED' }));
        pass('F04-authority-envelope', envelopeFailures);
        assert.equal(fs.existsSync(inputs.marker), false); pass('R07-no-execution', { markerAbsent: true, trusted: false });
        }

        await runInteractions({ native, inputs, frame, page, pass, capture, waitOwner, waitSource, refresh, selection, output });
        const protocol = await frame.evaluate(() => window.BsvHardwareTransport.identity());
        await native.channel.request('uiCommand', { command: 'workbench.action.closeActiveEditor' });
        const closed = await poll(hardware, value => value.retired.some(row => row.protocol.panelId === protocol.panelId), 'Native watcher disposal');
        const retired = closed.retired.find(row => row.protocol.panelId === protocol.panelId);
        assert.equal(retired.watchers, 0); assert.equal(retired.listeners, 0); assert.equal(retired.state.activeOperations, 0); pass('D10-dispose', retired);
        ({ frame, page } = await openWorkspacePanel(native, path.basename(inputs.main))); await waitOwner('mkController');
        const reopened = await capture('D11-revalidated-reopen'); assert.notEqual(reopened.host.protocol.sessionId, protocol.sessionId);
        pass('D11-panel-reopen', reopened);
        report.notRun.push({ ids: ['F01', 'F02', 'F03', 'F07'], status: 'NOT RUN IN THIS LANE',
            reason: 'BSV controlled fault has its own installed native-routing-fault lane; strict RTL routing rejection remains a separately recorded core regression.' },
        { ids: ['D11-process-restart'], status: 'NOT RUN IN THIS LANE', reason: 'D11 above covers actual panel dispose/reopen and revalidation; full Code restart is a separate driver replay.' });
        report.status = report.steps.some(step => step.status === 'FAIL') ? 'failed' : 'passed';
    } catch (error) {
        report.status = 'failed'; report.failure = error.stack; console.error('LIFECYCLE_FAILURE', error.stack);
        if (native && frame) {
            write(output, `failure-${++sequence}.json`, { state: await frame.evaluate(() => window.bsvHardware?.getState()).catch(() => null), host: await hardware().catch(() => null) });
            await native.capture('lifecycle-failure', page).catch(() => {});
        }
    } finally {
        write(output, 'fixture-mutations.json', inputs.changes);
        if (native) await native.close(report.status === 'passed' ? 'passed' : 'failed', report.failure || report.status);
        report.finishedAt = new Date().toISOString(); write(output, 'lifecycle-report.json', report); console.log('LIFECYCLE_REPORT', path.join(output, 'lifecycle-report.json'));
    }
    assert.equal(report.status, 'passed', report.failure); return report;
}
if (require.main === module) {
    if (process.argv.includes('--help')) console.log('Usage: node native-lifecycle.cjs FINAL.vsix [--interactions-only]\nInstalled-only isolated generic source lifecycle; no actual user source writes.');
    else run({ vsix: process.argv[2], lane: process.argv.includes('--interactions-only') ? 'interactions' : 'all' }).catch(error => { console.error(error.stack); process.exitCode = 1; });
}
module.exports = { run };
