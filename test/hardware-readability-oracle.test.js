'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { measurePage, validateMeasurement } = require('../experiments/hardware/g5-readability/oracle.cjs');
const label = (id, text = id) => ({ id, ownerId: id, role: 'node-title', text, fullText: text,
    visible: true, effectiveFont: 12, clipFraction: 1, occluders: [] });
const measurement = () => ({ labels: [label('root'), label('left'), label('right')], collisions: [], interference: [],
    canvas: { x: 0, y: 0, width: 420, height: 300 }, topology: [{ ownerId: 'root', kind: 'node', bounds: { x: 10, y: 10, width: 390, height: 270 } }],
    identity: { snapshotId: 'snapshot-A', provider: 'stock', queryId: 'query-A', resultId: 'result-A', selectedEntityId: 'left',
        analysisContext: { snapshotId: 'snapshot-A', implementationProvider: 'stock' } }, history: { back: 2, forward: 0 } });
const expectations = { mandatory: ['root', 'left', 'right'].map(ownerId => ({ ownerId, role: 'node-title' })), minimumFont: 9, fitAll: true };
const failures = (sample, expected = expectations) => validateMeasurement(sample, expected).findings.map(f => f.kind);

test('Readability oracle requires visible canonical names as well as final CSS font sizes', () => {
    assert.equal(validateMeasurement(measurement(), expectations).status, 'pass');
    const small = measurement(); small.labels[1].declaredFont = 12; small.labels[1].effectiveFont = 4;
    assert.ok(failures(small).includes('small-font'), 'V01 declared font cannot replace final font');
    for (const size of [8.99, 8.995]) {
        const belowFloor = measurement(); belowFloor.labels[1].effectiveFont = size;
        assert.ok(failures(belowFloor).includes('small-font'), `V01 ${size} CSS px remains below the 9px floor`);
    }
    const hidden = measurement(); hidden.labels.forEach(l => { l.visible = false; });
    assert.ok(failures(hidden).includes('missing-mandatory'), 'V02 empty visible subset fails');
    const padded = measurement(); padded.labels[1].effectiveFont = 4; padded.labels[1].elementBounds = { height: 100 };
    assert.ok(failures(padded).includes('small-font'), 'V03 large container cannot replace glyph font');
    const overlap = measurement(); overlap.collisions.push({ first: 'left', second: 'right' }); overlap.interference.push({ labelId: 'left', contactId: 'right-port' });
    assert.ok(failures(overlap).includes('label-collision')); assert.ok(failures(overlap).includes('hit-interference'), 'V04 enlarged labels obstruct targets');
    const clipped = measurement(); clipped.labels[1].clipFraction = 0.1;
    assert.ok(failures(clipped).includes('unreadable-mandatory'), 'V05 DOM text with mostly clipped glyphs fails');
    const ambiguous = measurement(); ambiguous.labels[1].text = 'stage…'; ambiguous.labels[2].text = 'stage…';
    assert.ok(failures(ambiguous).includes('ambiguous-abbreviation'), 'V06 two occurrence names cannot collapse to one');
    const fakeFit = measurement(); fakeFit.topology[0].bounds.width = 900;
    assert.ok(failures(fakeFit).includes('fit-clipped-topology'), 'V07 whole Fit must contain topology');
});

test('Readability-only transitions retain history and canonical query identity', () => {
    const before = measurement(), after = measurement(); after.history.back++;
    assert.ok(failures(after, { ...expectations, referenceHistory: before.history }).includes('navigation-changed'), 'V09 label threshold is not navigation');
    const mismatch = measurement(); mismatch.identity.resultId = 'result-B';
    assert.ok(failures(mismatch, { ...expectations, referenceIdentity: { resultId: before.identity.resultId } }).includes('identity-changed'), 'V10 result swapped under unchanged selection');
    mismatch.identity.analysisContext.snapshotId = 'snapshot-B';
    assert.ok(failures(mismatch).includes('analysis-context-mismatch'), 'V10 stale snapshot rejected');
});

test('Synthetic browser mutations V01–V07 independently read DOM, CTM, glyphs and clipping', {
    skip: process.env.G5_READABILITY_BROWSER_NEGATIVE !== '1' && 'Run with G5_READABILITY_BROWSER_NEGATIVE=1; browser dependency belongs to browser QA lane'
}, async () => {
    const { chromium } = require(process.env.G5_READABILITY_PLAYWRIGHT || '@playwright/test');
    console.log(`READABILITY_BROWSER_DEPENDENCY ${require.resolve(process.env.G5_READABILITY_PLAYWRIGHT || '@playwright/test')} explicit=${!!process.env.G5_READABILITY_PLAYWRIGHT}`);
    const browser = await chromium.launch({ channel: 'chrome', headless: true });
    const page = await browser.newPage({ viewport: { width: 420, height: 300 }, deviceScaleFactor: 1 });
    const base = (body, style = '') => `<style>body{margin:0}#canvas{width:420px;height:300px;overflow:hidden}text{font:12px monospace}${style}</style><div id="canvas"><svg width="420" height="300">${body}</svg></div>`;
    const node = (name, x, extra = '') => `<g data-semantic-id="${name}" data-active="true" transform="translate(${x} 40)" ${extra}><rect class="body" width="70" height="100" fill="none" stroke="black"/><text data-label-id="${name}:title" class="title" x="4" y="20">${name}</text></g>`;
    const baseline = node('root', 10) + node('left', 110) + node('right', 220);
    async function check(html, kind, expected = expectations) {
        await page.setContent(html); const value = await measurePage(page);
        const verdict = validateMeasurement(value, expected);
        assert.ok(verdict.findings.some(f => f.kind === kind), `${kind}: ${JSON.stringify(verdict)}`);
        return value;
    }
    try {
        await page.setContent(base(baseline));
        assert.equal(validateMeasurement(await measurePage(page), expectations).status, 'pass');
        const fixtureScene = { shell: { id: 'root', label: 'root' }, children: [{ id: 'left', label: 'left' }, { id: 'right', label: 'right' }],
            contacts: [], storages: [], connections: [] };
        const enclosing = '<g data-semantic-id="root" data-active="true"><rect class="body" width="420" height="300" fill="none" stroke="black"/><text data-label-id="root:title" class="title" x="4" y="20">root</text></g>';
        await page.setContent(base(enclosing + node('left', 110) + node('right', 220)));
        assert.ok(failures(await measurePage(page)).includes('hit-interference'), 'Unknown standalone containment cannot silently establish ownership');
        assert.equal(validateMeasurement(await measurePage(page, fixtureScene), expectations).status, 'pass', 'Explicit standalone canonical root establishes the valid parent exemption');
        await page.evaluate(() => { window.bsvHardware = { getState: () => ({ scene: { shell: { id: 'real-owner' } } }) }; });
        await assert.rejects(measurePage(page, fixtureScene), /CANONICAL_SCENE_OVERRIDE_FORBIDDEN/, 'Supplied fixture scene cannot override an application state');
        await page.evaluate(() => { delete window.bsvHardware; });
        const ownedContact = '<g data-semantic-id="port" data-active="true"><text data-label-id="port:label" class="label" x="20" y="40">port name</text></g>';
        const opaqueNode = id => `<g data-semantic-id="${id}" data-active="true"><rect class="body" x="10" y="20" width="120" height="50" fill="gray"/></g>`;
        const ownedExpected = { mandatory: [{ ownerId: 'port', role: 'contact-label' }], minimumFont: 9 };
        async function ownedMeasurement(body, pointerEvents) {
            await page.setContent(base(body, `text{pointer-events:${pointerEvents}}`));
            await page.evaluate(() => { window.bsvHardware = { getState: () => ({ current: null, history: { back: [], forward: [] },
                scene: { shell: { id: 'owner', label: 'owner' }, children: [{ id: 'other', label: 'other' }], storages: [],
                    contacts: [{ id: 'port', label: 'port name', ownerId: 'owner' }], connections: [] } }) }; });
            return measurePage(page);
        }
        for (const pointerEvents of ['auto', 'none']) {
            const front = await ownedMeasurement(opaqueNode('owner') + ownedContact, pointerEvents);
            assert.equal(validateMeasurement(front, ownedExpected).status, 'pass', 'Contact text painted in front of its own module remains readable');
            assert.deepEqual(front.labels[0].occluders, []);
            const behind = await ownedMeasurement(ownedContact + opaqueNode('other'), pointerEvents);
            assert.equal(validateMeasurement(behind, ownedExpected).status, 'fail', 'Opaque node painted after text occludes it');
            assert.ok(behind.labels[0].occluders.includes('other'));
            const unrelated = await ownedMeasurement(opaqueNode('other') + ownedContact, pointerEvents);
            assert.deepEqual(unrelated.labels[0].occluders, [], 'Body behind text is not an occluder');
            assert.ok(failures(unrelated, ownedExpected).includes('hit-interference'), 'Text covering an unrelated module still fails clearance');
        }
        const transparentHitTarget = await ownedMeasurement(ownedContact + opaqueNode('other').replace('class="body"', 'class="body" style="pointer-events:none"'), 'auto');
        assert.ok(transparentHitTarget.labels[0].occluders.includes('other'), 'Pointer-transparent opaque paint still occludes text');
        await ownedMeasurement(opaqueNode('owner') + ownedContact, 'none');
        await page.evaluate(() => {
            const overlay = document.createElement('div'); overlay.id = 'opaque-html-overlay';
            overlay.style.cssText = 'position:absolute;left:10px;top:20px;width:120px;height:50px;background:white;z-index:10';
            document.body.append(overlay);
        });
        const htmlCovered = await measurePage(page);
        assert.ok(htmlCovered.labels[0].occluders.includes('opaque-html-overlay'), 'HTML overlay above the SVG remains an occluder');
        assert.equal(validateMeasurement(htmlCovered, ownedExpected).status, 'fail');
        await page.evaluate(() => { delete window.bsvHardware; });
        const origin = await check(base(baseline + '<g data-semantic-id="contributor"><text class="origin-label" x="20" y="200" style="font-size:4px">Verified contributor / partial</text></g>'), 'small-font');
        assert.ok(origin.labels.some(l => l.ownerId === 'contributor' && l.text === 'Verified contributor / partial'));
        await page.setContent(base(baseline) + '<div id="code-drawer"><pre data-source-reference-id="source-a" style="font-size:12px;width:90px;height:18px;overflow:auto">first source line\nsecond source line</pre></div>');
        const source = await measurePage(page);
        assert.equal(source.source.length, 1); assert.equal(source.source[0].effectiveFont, 12);
        assert.ok(source.source[0].scroll.height > source.source[0].scroll.clientHeight);
        assert.equal(validateMeasurement(source, expectations).status, 'pass', 'Original scrollable source is not a fully clipped mandatory canvas label');
        const scaled = await check(base(`<g transform="scale(.333333333)">${baseline}</g>`), 'small-font');
        assert.ok(scaled.labels.every(l => Math.abs(l.declaredFont - 12) < 0.01 && Math.abs(l.effectiveFont - 4) < 0.01));
        await check(base(baseline, 'text{font-size:8.99px}'), 'small-font');
        await check(base(baseline, 'text{visibility:hidden}'), 'missing-mandatory');
        const padded = await check('<div id="canvas"><div data-oracle-label data-owner-id="left" style="font-size:4px;padding:50px;line-height:100px">left</div></div>', 'small-font');
        assert.ok(padded.labels[0].elementBounds.height > padded.labels[0].glyphBounds.height);
        const cssScaled = await check('<div id="canvas"><div style="transform:scale(.333333333)"><span data-oracle-label style="font-size:12px">left</span></div></div>', 'small-font');
        assert.ok(Math.abs(cssScaled.labels[0].effectiveFont - 4) < 0.01);
        await check(base(node('left', 20) + node('right', 23)), 'label-collision');
        await check(base(baseline + '<g data-semantic-id="foreign-port" data-active="true"><rect class="mark" x="115" y="50" width="10" height="10" fill="black"/></g>'), 'hit-interference');
        const wire = await check(base(baseline + '<g data-semantic-id="foreign-wire" data-active="true"><path class="route" d="M110 55H155" fill="none" stroke="black"/></g>'), 'hit-interference');
        assert.ok(wire.interference.some(hit => hit.kind === 'wire'));
        const clippedGeometry = base(baseline + '<g data-semantic-id="clipped-wire" data-active="true"><path class="route" d="M0 -30H100" fill="none" stroke="black"/></g><g data-semantic-id="clipped-contact" data-active="true"><rect class="mark" x="10" y="-34" width="10" height="10" fill="black"/></g>')
            .replace('<div id="canvas">', '<div id="scene-path" data-readability-context style="font:12px monospace;height:40px">header owner</div><div id="canvas">');
        await page.setContent(clippedGeometry);
        const clippedPainting = await measurePage(page);
        assert.ok(clippedPainting.labels.some(label => label.id === 'scene-path' && label.visible));
        assert.equal(validateMeasurement(clippedPainting, { ...expectations, fitAll: false }).status, 'pass', 'Canvas-clipped geometry cannot paint over the HTML context header');
        await page.setViewportSize({ width: 420, height: 360 });
        const captionScene = (statusStyle = '') => base(baseline + '<g data-semantic-id="caption-wire" data-active="true"><path class="route" d="M260 155H360" fill="none" stroke="black"/></g>',
            `#canvas{height:340px}svg{display:block}.body{fill:#ddd}#display-status,#canvas-instructions{font:12px/16px monospace;pointer-events:none}#display-status{${statusStyle}}`)
            .replace('<svg ', '<svg id="viewport" ').replace('</svg></div>', '</svg><div id="display-status">Persistent status</div><div id="canvas-instructions">Interaction instructions</div></div>');
        const captionExpected = { ...expectations, mandatory: [...expectations.mandatory, { id: 'display-status' }, { id: 'canvas-instructions' }] };
        const labelCovered = await check(captionScene('position:absolute;left:114px;top:45px'), 'label-collision', captionExpected);
        assert.ok(labelCovered.labels.some(l => l.id === 'display-status' && l.visible), 'Transparent pointer-none status is still rendered text');
        await check(captionScene('position:absolute;left:270px;top:145px'), 'hit-interference', captionExpected);
        await page.setContent(captionScene());
        const flowCaptions = await measurePage(page);
        assert.equal(flowCaptions.canvas.height, 300); assert.equal(flowCaptions.canvasContainer.height, 340);
        assert.ok(flowCaptions.labels.filter(l => ['display-status', 'canvas-instructions'].includes(l.id)).every(l => l.glyphBounds.y >= flowCaptions.canvas.y + flowCaptions.canvas.height));
        assert.equal(validateMeasurement(flowCaptions, captionExpected).status, 'pass', 'Normal-flow captions below drawable SVG do not cover circuit labels or wires');
        await page.setViewportSize({ width: 420, height: 300 });
        await check(base(node('root', 10) + node('left', 410) + node('right', 220)), 'unreadable-mandatory');
        await check(base(node('root', 10) + node('left', 600) + node('right', 220)), 'missing-mandatory');
        await check(base('<g data-semantic-id="left"><text data-label-id="left:title" data-full-text="left-stage" class="title" x="10" y="30">stage…</text></g><g data-semantic-id="right"><text data-label-id="right:title" data-full-text="right-stage" class="title" x="120" y="30">stage…</text></g>'), 'ambiguous-abbreviation');
        await check(base(`<g transform="scale(2)">${baseline}</g>`), 'fit-clipped-topology');
        console.log('READABILITY_BROWSER_NEGATIVES V01 V02 V03 V04 V05 V06 V07 passed; synthetic DOM only');
    } finally { await browser.close(); }
});
