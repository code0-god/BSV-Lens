'use strict';

const assert = require('node:assert/strict');
const { measurePage, validateMeasurement } = require('./oracle.cjs');

async function runDisplayFixture({ session, capture }) {
    const page = await session.context.newPage();
    try {
        await page.setViewportSize({ width: 1100, height: 620 });
        await page.setContent('<html><body style="margin:0;background:#202020;color:#eee;font-family:monospace"><h1 style="font-size:16px;margin:16px">Display-only fixture: long English and CJK names; no compiler evidence</h1><div id="canvas" style="width:1100px;height:540px"><svg width="1100" height="540"><g id="world"></g></svg></div></body></html>');
        await page.addScriptTag({ url: `${session.base}/hardware-readability.js` });
        const evidence = await page.evaluate(() => {
            const ns = 'http://www.w3.org/2000/svg', create = (tag, attrs, parent) => {
                const element = document.createElementNS(ns, tag);
                for (const [name, value] of Object.entries(attrs)) element.setAttribute(name, String(value));
                parent.append(element); return element;
            };
            const names = ['LongDisplayFixture', 'processing_implementation_lane_with_long_name_left', 'processing_implementation_lane_with_long_name_right', '넓은_데이터경로_混合_Module_구현'];
            const nodes = names.map((name, index) => ({ id: `display-only:${index}`, label: name, kind: 'module-occurrence', secondaryLabel: 'display-only' }));
            const scene = { sceneKind: 'bsv', shell: nodes[0], children: nodes.slice(1), storages: [], contacts: [], connections: [] };
            const geometry = { nodes: nodes.map((node, index) => ({ id: node.id, x: index ? 30 + (index - 1) * 350 : 10, y: index ? 110 : 10,
                width: index ? 320 : 1080, height: index ? 180 : 500 })), contacts: [], groups: [], routes: [], labels: [] };
            geometry.labels = geometry.nodes.map((node, index) => ({ id: `${node.id}:title`, ownerId: node.id, role: 'node-title', fullText: names[index],
                x: node.x + 16, y: node.y + 27, anchor: 'start', bounds: { x: node.x + 16, y: node.y + 15, width: node.width - 40, height: 14 } }));
            const canvas = document.createElement('canvas').getContext('2d');
            const measure = (value, size) => {
                canvas.font = `600 ${size}px monospace`; const measured = canvas.measureText(value);
                return { width: measured.width, ascent: measured.actualBoundingBoxAscent, descent: measured.actualBoundingBoxDescent };
            };
            const input = { scene, geometry, canvas: { width: 1100, height: 540 }, viewport: { x: 0, y: 0, scale: 1 },
                current: { selectedEntityId: null, selectedRelationId: null, disclosureState: {} }, measure, level: 'normal' };
            const projection = BsvHardwareReadability.projectLabels(input), again = BsvHardwareReadability.projectLabels(input);
            for (const node of geometry.nodes) {
                const group = create('g', { 'data-semantic-id': node.id, 'data-active': 'true', tabindex: 0, role: 'button', 'aria-label': names[Number(node.id.split(':')[1])] }, document.querySelector('#world'));
                create('rect', { class: 'body', x: node.x, y: node.y, width: node.width, height: node.height, fill: 'none', stroke: '#aaa' }, group);
                const label = projection.labels.find(item => item.ownerId === node.id);
                const text = create('text', { class: 'title', 'data-label-id': label.id, 'data-full-text': label.fullText, x: label.x, y: label.y,
                    'font-size': label.fontSize, 'font-family': 'monospace', 'font-weight': 600, fill: '#eee', visibility: label.visible ? 'visible' : 'hidden' }, group);
                text.textContent = label.text; create('title', {}, group).textContent = label.fullText;
            }
            return { names, scene, canonicalIds: nodes.map(node => node.id), projection, deterministic: JSON.stringify(projection) === JSON.stringify(again) };
        });
        assert.equal(evidence.deterministic, true);
        const mandatory = evidence.canonicalIds.map(ownerId => ({ ownerId, role: 'node-title', minFont: 12 }));
        const measurement = await measurePage(page, evidence.scene), verdict = validateMeasurement(measurement, { mandatory, minimumFont: 9, fitAll: true });
        assert.equal(verdict.status, 'pass', JSON.stringify(verdict.findings));
        const shown = measurement.labels.filter(label => mandatory.some(m => m.ownerId === label.ownerId));
        assert.equal(new Set(shown.map(label => label.text)).size, shown.length, 'Distinct long occurrences keep distinct visible names');
        assert.ok(shown.every(label => label.lineCount === 1), 'No orphaned final glyph line');
        for (const id of evidence.canonicalIds) {
            await page.locator(`[data-semantic-id=${JSON.stringify(id)}]`).focus();
            assert.equal(await page.evaluate(() => document.activeElement.getAttribute('aria-label')), evidence.names[evidence.canonicalIds.indexOf(id)]);
            await page.keyboard.press('Tab');
        }
        const name = 'J18-display-only-long-cjk';
        await capture(name, { synthetic: true, canonicalScene: evidence.scene, evidenceKind: 'synthetic-display-only', mandatory, minimumFont: 9, fitAll: true }, page);
        return { captures: [name], evidenceKind: 'synthetic-display-only', runtimeApi: 'BsvHardwareReadability.projectLabels',
            names: evidence.names, labels: shown.map(({ ownerId, text, fullText, effectiveFont, lineCount }) => ({ ownerId, text, fullText, effectiveFont, lineCount })), deterministic: true };
    } finally { await page.close(); }
}

module.exports = { runDisplayFixture };
