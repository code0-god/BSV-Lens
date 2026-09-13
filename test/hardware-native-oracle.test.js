'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { validateNativeTypography } = require('../experiments/hardware/g6/native-oracle.cjs');

function fixture() {
    const scene = { shell: { id: 'root', label: 'memory' }, children: [{ id: 'acc', label: 'accumulators' },
        { id: 'load', label: 'load' }], storages: [], contacts: [], inspector: { title: 'memory' } };
    const state = { scene, current: { selectedEntityId: null, disclosureState: {} } };
    const label = (ownerId, text) => ({ id: `${ownerId}:title`, ownerId, role: 'node-title', text, fullText: text,
        visible: true, effectiveFont: 12, clipFraction: 1, occluders: [] });
    const measurement = { labels: [{ ...label(null, 'BSV memory'), id: 'readability-context', role: 'context' },
        label('root', 'memory'), { ...label('acc', 'accumulators'), text: 'acc…tors' }, label('load', 'load')],
        collisions: [], interference: [], topology: [], canvas: { x: 0, y: 0, width: 800, height: 600 } };
    const expectations = { root: 'memory', children: ['accumulators', 'load'], allowOverviewAbbreviation: true };
    return { state, measurement, expectations };
}
const verdict = input => validateNativeTypography(input.state, input.measurement, input.expectations);

test('native overview abbreviation requires explicit opt-in and independent canonical identity', () => {
    const input = fixture(), original = structuredClone(input);
    const result = verdict(input); assert.equal(result.status, 'pass');
    assert.deepEqual(result.nativePrimaryAbbreviations[0], { ownerId: 'acc', fullText: 'accumulators', displayedText: 'acc…tors',
        prefix: 'acc', suffix: 'tors', meaningfulGraphemes: 7, matchingOwners: ['acc'], accepted: true });
    assert.deepEqual(input, original);
    delete input.expectations.allowOverviewAbbreviation;
    assert.equal(verdict(input).status, 'fail', 'Default full-name contract remains strict');
    input.expectations.allowOverviewAbbreviation = true;
    input.expectations.detail = true; assert.equal(verdict(input).status, 'fail', 'Detail titles do not opt in');
    input.expectations.detail = false;
    input.state.current.selectedEntityId = 'acc'; assert.equal(verdict(input).status, 'fail', 'Selected title remains strict');
    input.state.current.selectedEntityId = null;
    for (const fit of ['selection', 'manual']) {
        input.state.current.disclosureState.presentation = { fit }; assert.equal(verdict(input).status, 'fail');
    }
});

test('wrong names, ellipsis-only, weak fragments and ambiguous hidden canonical peers fail', () => {
    for (const text of ['other…tors', 'acc…wrong', '…', 'a…s', 'acc…', '…tors', 'acc…u…tors']) {
        const input = fixture(); input.measurement.labels[2].text = text;
        assert.equal(verdict(input).status, 'fail', text);
    }
    const wrongFull = fixture(); wrongFull.measurement.labels[2].fullText = 'foreign';
    assert.equal(verdict(wrongFull).status, 'fail', 'DOM fullText must equal the canonical expected name');
    const wrongOwner = fixture(); wrongOwner.state.scene.children[0].label = 'foreign';
    assert.throws(() => verdict(wrongOwner), /Explicit mandatory semantic object is missing/);
    const ambiguous = fixture();
    ambiguous.state.scene.children.push({ id: 'other-acc', label: 'accelerators' });
    assert.equal(verdict(ambiguous).status, 'fail', 'Even an unrendered non-mandatory canonical peer prevents ambiguous abbreviation');
    assert.deepEqual(verdict(ambiguous).nativePrimaryAbbreviations[0].matchingOwners, ['acc', 'other-acc']);
    ambiguous.measurement.labels.push({ ...ambiguous.measurement.labels[2], id: 'other:title', ownerId: 'other-acc', fullText: 'accelerators' });
    assert.equal(verdict(ambiguous).status, 'fail', 'Two visible occurrences with the same abbreviated name fail');
});

test('accepted canonical abbreviation still requires visible unoccluded full glyphs and font floor', () => {
    for (const mutation of [label => { label.visible = false; }, label => { label.clipFraction = .4; },
        label => { label.occluders = ['neighbor']; }, label => { label.effectiveFont = 8.99; }]) {
        const input = fixture(); mutation(input.measurement.labels[2]); assert.equal(verdict(input).status, 'fail');
    }
    const overlap = fixture(); overlap.measurement.collisions.push({ first: 'acc:title', second: 'load:title' });
    assert.equal(verdict(overlap).status, 'fail');
    const port = fixture(); port.measurement.interference.push({ labelId: 'acc:title', contactId: 'load:port' });
    assert.equal(verdict(port).status, 'fail');
});
