'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRunOutput } = require('../g4/run-output');
const root = path.resolve(__dirname, '../../..');
const PIXEL_TOLERANCE = 0.75;

(async () => {
    const file = process.argv[2];
    assert.ok(file, 'Usage: browser-audit.cjs browser.json');
    const browser = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.equal(browser.status, 'PASS');
    const findings = [];
    let labels = 0, slots = 0;
    for (const visit of browser.journeys) {
        const viewport = visit.current.viewport;
        const expectedLabels = new Map(visit.geometry.labels.map(label => [label.id, label]));
        for (const actual of visit.runtime.labels) {
            if (!actual.visible) continue;
            labels++;
            const model = expectedLabels.get(actual.id);
            assert.ok(model, `Unknown DOM label ${actual.id}`);
            const expected = { x: viewport.x + model.bounds.x * viewport.scale,
                y: viewport.y + model.bounds.y * viewport.scale,
                width: model.bounds.width * viewport.scale, height: model.bounds.height * viewport.scale };
            if (actual.x < expected.x - PIXEL_TOLERANCE || actual.y < expected.y - PIXEL_TOLERANCE
                || actual.x + actual.width > expected.x + expected.width + PIXEL_TOLERANCE
                || actual.y + actual.height > expected.y + expected.height + PIXEL_TOLERANCE) {
                findings.push({ journey: visit.id, kind: 'DOM_LABEL_OUTSIDE_RESERVED_BOX', id: actual.id, actual, expected });
            }
        }
        const expectedSlots = new Map(visit.geometry.contacts.flatMap(contact => contact.slots.map(slot => [slot.id, slot])));
        assert.equal(visit.runtime.slots.length, expectedSlots.size, `${visit.id}: missing/extra DOM slot`);
        for (const actual of visit.runtime.slots) {
            slots++;
            const expected = expectedSlots.get(actual.id);
            assert.ok(expected);
            assert.equal(actual.connectionId, expected.connectionId);
            assert.deepEqual(actual.indices, expected.indices);
            const x = viewport.x + expected.x * viewport.scale, y = viewport.y + expected.y * viewport.scale;
            if (Math.abs(actual.x + actual.width / 2 - x) > PIXEL_TOLERANCE
                || Math.abs(actual.y + actual.height / 2 - y) > PIXEL_TOLERANCE) {
                findings.push({ journey: visit.id, kind: 'DOM_SLOT_POSITION_MISMATCH', id: actual.id, actual, expected: { x, y } });
            }
        }
    }
    const output = await createRunOutput(root, 'g4-fix-browser-geometry-audit');
    const result = { schema: 'g4-fix-dom-geometry-audit-v1', input: path.resolve(file),
        pixelTolerance: PIXEL_TOLERANCE, diagramTolerance: 'Independent routing oracle uses 1e-7 diagram units separately',
        labels, slots, findings, status: findings.length ? 'FAIL' : 'PASS' };
    fs.writeFileSync(path.join(output, 'audit.json'), `${JSON.stringify(result, null, 2)}\n`, { flag: 'wx' });
    console.log(JSON.stringify({ output, labels, slots, findings: findings.length, status: result.status }));
    assert.deepEqual(findings, [], 'Actual browser geometry escaped the reserved layout boxes');
})().catch(error => { console.error(error); process.exitCode = 1; });
