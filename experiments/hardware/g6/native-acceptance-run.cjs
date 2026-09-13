'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { loadNativeInput } = require('../../../src/hardware/native-input');
const { createArchitecture } = require('../../../src/hardware/architecture');
const { launchNative } = require('./native-driver.cjs');
const { runAcceptance } = require('./native-acceptance.cjs');
const { measureNative } = require('./native-oracle.cjs');
const { createRun } = require('./run.cjs');
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const write = (output, file, value) => fs.writeFileSync(path.join(output, file), `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' });

async function run({ vsix, fixturePath, observerVsix, output = process.env.G6_OUTPUT_DIR || createRun('native-acceptance') }) {
    assert.ok(vsix && fixturePath, 'Explicit VSIX and external fixture JSON are required');
    const fixtureBytes = fs.readFileSync(fixturePath), fixtureData = JSON.parse(fixtureBytes);
    assert.equal(fixtureData.schema, 'g6-native-fixtures-v1'); assert.equal(fixtureData.status, 'pass');
    const vsixSha256 = digest(fs.readFileSync(vsix));
    const report = { schema: 'g6-native-acceptance-run-v1', status: 'running', startedAt: new Date().toISOString(),
        targetMode: 'installed', vsix: path.resolve(vsix), vsixSha256, fixturePath: path.resolve(fixturePath),
        fixtureSha256: digest(fixtureBytes), workspace: fixtureData.workspace, completedSteps: [], authorityInputs: [],
        contract: 'Authority model is independent comparison input only. All product scenes, queries, source resolution and selection are driven by installed native UI/transport.',
        userVisualDesignAcceptance: 'PENDING' };
    write(output, 'native-acceptance-contract.json', { ...report, productEditsAllowed: false, requiredJourneys: Array.from({ length: 15 }, (_, index) => `N${String(index + 1).padStart(2, '0')}`) });
    let native, frame, page;
    try {
        for (const fixture of Object.values(fixtureData.fixtures)) {
            const input = await loadNativeInput({ sourceRoot: fixtureData.workspace, artifactRoot: fixtureData.workspace,
                manifest: fixture.manifest, originApproved: true });
            fixture.authority = { architecture: createArchitecture({ importResult: input.importResult, analysis: input.analysis }),
                models: { stock: input.importResult.implementation, instrumented: input.originCase.request.importResult.implementation } };
            report.authorityInputs.push({ key: fixture.key, inputIdentity: input.inputIdentity,
                stockSnapshot: input.importResult.snapshot.id, instrumentedSnapshot: input.originCase.request.importResult.snapshot.id });
        }
        native = await launchNative({ vsix, observerVsix, workspace: fixtureData.workspace, output,
            harnessFiles: [path.resolve(__dirname, '../g5-readability/oracle.cjs'), path.resolve(__dirname, '../g4-fix/oracle/geometry.cjs')] });
        await native.channel.request('openProductCommand', { command: 'bsvArchitecture.openHardwareSchematic' });
        ({ frame, page } = await native.findWebview());
        report.acceptance = await runAcceptance({ native, frame, page, output, fixtures: fixtureData.fixtures,
            record: async (id, result) => { report.completedSteps.push(id); write(output, `${id}.json`, result);
                await native.traceCheckpoint(id); console.log(`NATIVE_ACCEPTANCE_PASS ${id}`); } });
        assert.equal(report.completedSteps.length, 15);
        report.hardware = await native.channel.request('observeHardware');
        await native.close(); assert.equal(native.receipt.status, 'passed', JSON.stringify(native.receipt.errors));
        report.status = 'pass';
    } catch (error) {
        report.status = 'fail'; report.error = error?.stack || String(error);
        report.nextUnpassedJourney = `N${String(report.completedSteps.length + 1).padStart(2, '0')}`;
        if (native) {
            try { await native.capture('native-acceptance-failure', page); } catch (failure) { report.captureError = failure.message; }
            if (frame) {
                try { write(output, 'failure.measurement.json', await measureNative({ native, frame, page })); } catch (failure) { report.measurementError = failure.message; }
                try { write(output, 'failure.state.json', await frame.evaluate(() => window.bsvHardware?.getState()));
                    fs.writeFileSync(path.join(output, 'failure.dom.txt'), await frame.locator('body').innerText(), { flag: 'wx' }); }
                catch (failure) { report.stateError = failure.message; }
            }
            try { report.hardware = await native.channel.request('observeHardware'); } catch (failure) { report.diagnosticError = failure.message; }
            await native.close('failed', error);
        }
        console.error(report.error); process.exitCode = 1;
    } finally {
        report.vsixUnchanged = digest(fs.readFileSync(vsix)) === vsixSha256;
        report.fixtureJsonUnchanged = digest(fs.readFileSync(fixturePath)) === digest(fixtureBytes);
        report.originalInventoryPreserved = fixtureData.inventory.every(row => {
            const bytes = fs.readFileSync(path.join(fixtureData.workspace, row.path));
            return bytes.length === row.bytes && digest(bytes) === row.sha256;
        });
        if (!report.vsixUnchanged || !report.fixtureJsonUnchanged || !report.originalInventoryPreserved) { report.status = 'fail'; process.exitCode = 1; }
        report.finishedAt = new Date().toISOString(); write(output, 'native-acceptance.json', report);
        console.log(JSON.stringify({ output, status: report.status, completedSteps: report.completedSteps, error: report.error }));
    }
    return report;
}

if (require.main === module) {
    const [vsix, fixturePath, observerVsix] = process.argv.slice(2);
    run({ vsix, fixturePath, observerVsix }).catch(error => { console.error(error?.stack || error); process.exitCode = 1; });
}
module.exports = { run };
