'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { createRun } = require('./run.cjs');
const { open, close, settled } = require('./browser-helpers.cjs');
const { measurePage, validateMeasurement } = require('./oracle.cjs');
const { runtimeHashes } = require('./before.cjs');
const { loadCorpus } = require('../g4-fix/geometry-check.cjs');
const { validateGeometry, validateMembership } = require('../g4-fix/oracle/geometry.cjs');
const { runCore } = require('./browser-core.cjs');
const { runExtra } = require('./browser-extra.cjs');
const write = (directory, name, value) => fs.writeFileSync(path.join(directory, name), `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' });
const driverHashes = () => ['browser.cjs', 'browser-core.cjs', 'browser-extra.cjs', 'browser-helpers.cjs', 'oracle.cjs', 'display-fixture.cjs']
    .map(name => ({ path: `experiments/hardware/g5-readability/${name}`,
        sha256: createHash('sha256').update(fs.readFileSync(path.join(__dirname, name))).digest('hex') }));

function mandatoryStructure(scene) {
    return [scene.shell, ...scene.children.filter(item => item.kind.includes('occurrence')), ...scene.storages]
        .map(item => ({ ownerId: item.id, role: 'node-title', text: item.label }));
}

async function run() {
    const directory = process.env.G5_READABILITY_OUTPUT_DIR || createRun('browser'), output = path.join(directory, 'browser');
    fs.mkdirSync(output);
    const initial = runtimeHashes(), { authority } = await loadCorpus();
    const receipt = { schema: 'g5-readability-browser-v1', status: 'running', output,
        journeys: [], captures: [], timings: [], runtimeInputs: initial, driverInputs: driverHashes() };
    const session = await open({ output });
    receipt.environment = { node: process.version, platform: process.platform, arch: process.arch,
        browser: session.browser.version(), channel: 'chrome', playwrightEntry: require.resolve(process.env.G5_READABILITY_PLAYWRIGHT || '@playwright/test'),
        headless: process.env.G4_HEADED !== '1' };

    async function capture(name, expectations = {}, page = session.page) {
        if (!expectations.synthetic) await settled(page);
        await page.mouse.move(3, 3);
        const measurement = await measurePage(page, expectations.synthetic ? expectations.canonicalScene || null : null);
        const state = expectations.synthetic ? null : await page.evaluate(() => window.bsvHardware.getState());
        const mandatory = [...(state ? [{ id: 'readability-context', minFont: 11 }] : []),
            ...(expectations.mandatory || (state && expectations.fitAll ? mandatoryStructure(state.scene) : []))];
        const verdict = validateMeasurement(measurement, { minimumFont: 9, ...expectations, mandatory });
        const files = { screenshot: `${name}.png`, measurement: `${name}.measurement.json`, state: `${name}.state.json` };
        await page.screenshot({ path: path.join(output, files.screenshot) });
        write(output, files.measurement, measurement);
        if (state) {
            const facts = authority.get(state.current.buildId);
            const geometry = validateGeometry(state.scene, state.geometry);
            const membership = validateMembership(state.scene, { model: facts.models[state.current.provider], architecture: facts.architecture });
            assert.deepEqual(geometry.findings, [], `${name}: canonical geometry`);
            assert.deepEqual(membership.findings, [], `${name}: canonical membership`);
            const paths = await page.locator('.connection[data-active="true"]').evaluateAll(groups => groups.map(group => ({
                id: group.dataset.semanticId, path: group.querySelector('.route').getAttribute('d'), bits: JSON.parse(group.dataset.canonicalBits) })));
            assert.equal(paths.length, state.scene.connections.length);
            for (const row of paths) {
                assert.equal(row.path, state.geometry.routes.find(route => route.id === row.id).path);
                assert.deepEqual(row.bits, state.scene.connections.find(connection => connection.id === row.id).bits || []);
            }
            assert.equal(state.error, null);
            assert.equal(state.current.snapshotId, state.scene.snapshotId);
            assert.equal(state.current.provider, state.scene.implementationContext.provider);
            assert.equal(state.scene.capabilities.completeOriginSets, false);
            for (const item of measurement.source || []) {
                if (!item.sourceReferenceId) continue;
                const ref = state.current.analysis?.result.sourceRefs.find(row => row.id === item.sourceReferenceId);
                if (ref) assert.equal(await page.locator(`pre[data-source-reference-id=${JSON.stringify(ref.id)}]`).first().textContent(), ref.range.text);
            }
            write(output, files.state, { current: state.current, scene: state.scene, geometry: state.geometry,
                history: { back: state.history.back.map(frame => frame.current), forward: state.history.forward.map(frame => frame.current) },
                labelPreparation: state.runtime.readability });
        } else write(output, files.state, { schema: 'g5-readability-standalone-context-v1',
            evidenceKind: expectations.evidenceKind, scene: expectations.canonicalScene,
            note: 'Captured input scene for a standalone display fixture or metadata-verified export; not live application navigation state.' });
        receipt.captures.push({ name, ...files, standalone: !!expectations.synthetic,
            synthetic: !!expectations.synthetic && expectations.evidenceKind !== 'actual-export-intrinsic',
            evidenceKind: expectations.evidenceKind || 'actual-product', mandatory, fitAll: !!expectations.fitAll,
            verdict, viewport: measurement.viewport, canvas: measurement.canvas,
            minimumTitle: Math.min(...measurement.labels.filter(label => label.visible && label.role === 'node-title').map(label => label.effectiveFont)) });
        assert.equal(verdict.status, 'pass', `${name}: ${JSON.stringify(verdict.findings.slice(0, 12))}`);
        assert.deepEqual(runtimeHashes(), initial, 'Runtime changed during browser acceptance');
        return { name, ...files, measurementFile: files.measurement, measurement, verdict, state };
    }

    function record(id, extra = {}) {
        assert.match(id, /^J(?:0[1-9]|1[0-9]|20)$/);
        assert.ok(!receipt.journeys.some(row => row.id === id), `Duplicate journey ${id}`);
        receipt.journeys.push({ id, status: 'pass', ...extra });
        console.log(`READABILITY_BROWSER_PASS ${id}`);
    }

    try {
        await runCore({ session, output, receipt, capture, record });
        await session.context.tracing.stopChunk({ path: path.join(output, 'trace-core.zip') });
        await session.context.tracing.startChunk({ title: 'G5 readability J11-J20' });
        await runExtra({ session, output, receipt, capture, record });
        assert.deepEqual(receipt.journeys.map(row => row.id).sort(), Array.from({ length: 20 }, (_, i) => `J${String(i + 1).padStart(2, '0')}`));
        assert.deepEqual(session.pageErrors, []); assert.deepEqual(runtimeHashes(), initial);
        assert.deepEqual(driverHashes(), receipt.driverInputs, 'Acceptance driver changed during final run');
        receipt.status = 'pass';
    } catch (error) {
        receipt.status = /ERR_BLOCKED_BY_ADMINISTRATOR/.test(String(error)) ? 'blocked' : 'fail';
        receipt.error = String(error.stack || error); process.exitCode = 1;
        await session.page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {});
        write(output, 'failure.measurement.json', await measurePage(session.page).catch(error => ({ error: error.message })));
        console.error(receipt.error);
    } finally {
        await close(session); receipt.pageErrors = session.pageErrors; receipt.runtimeAfter = runtimeHashes();
        receipt.traces = fs.readdirSync(output).filter(name => /^trace.*\.zip$/.test(name));
        write(output, 'receipt.json', receipt); console.log(`READABILITY_BROWSER_RECEIPT ${path.join(output, 'receipt.json')}`);
    }
}

if (require.main === module) run().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { run, mandatoryStructure };
