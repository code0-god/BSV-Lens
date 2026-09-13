'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { pathToFileURL } = require('node:url');
const { chromium } = require('@playwright/test');
const { createCatalog } = require('./server');

const ROOT = path.resolve(__dirname, '../../..');
const OUT = path.join(ROOT, '.build/hardware/prototype');
const FRACTION = 0.5;
const digest = text => crypto.createHash('sha256').update(text).digest('hex');
const xml = value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const tag = (name, attrs, body = '') => `<${name} ${Object.entries(attrs).map(([key, value]) => `${key}="${xml(value)}"`).join(' ')}>${body}</${name}>`;
const text = (x, y, value, attrs = {}) => tag('text', { x, y, ...attrs }, xml(value));
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-7, `${actual} != ${expected}`);
const mix = (a, b) => a + (b - a) * FRACTION;
const pointer = (raw, ref) => ref.pointer.slice(1).split('/').map(key => key.replace(/~1/g, '/').replace(/~0/g, '~')).reduce((value, key) => {
    assert.ok(value && Object.hasOwn(value, key), `Missing artifact pointer ${ref.pointer}`);
    return value[key];
}, raw);

function interpolate(collapsed, expanded, occurrenceId) {
    const before = collapsed.nodes.find(node => node.id === occurrenceId);
    const after = expanded.nodes.find(node => node.id === occurrenceId);
    assert.ok(before && after && !before.expanded && after.expanded);
    const middle = Object.fromEntries(['x', 'y', 'width', 'height'].map(key => [key, mix(before[key], after[key])]));
    const x = value => middle.x + (value - after.x) * middle.width / after.width;
    const knots = [[after.y, middle.y], [after.y + after.height, middle.y + middle.height]];
    const external = expanded.anchors.filter(anchor => anchor.ownerId === occurrenceId);
    for (const anchor of external) {
        const original = collapsed.anchors.find(item => item.id === anchor.id);
        assert.ok(original); assert.equal(original.domId, anchor.domId);
        assert.deepEqual(original.bits, anchor.bits); assert.deepEqual(original.rawBits, anchor.rawBits);
        close(x(anchor.x), mix(original.x, anchor.x));
        knots.push([anchor.y, mix(original.y, anchor.y)]);
    }
    knots.sort((a, b) => a[0] - b[0]);
    const unique = knots.filter((knot, index) => {
        if (index && knot[0] === knots[index - 1][0]) { close(knot[1], knots[index - 1][1]); return false; }
        return true;
    });
    for (let i = 1; i < unique.length; i++) assert.ok(unique[i][1] > unique[i - 1][1], 'Coordinate warp must remain monotonic');
    // One separable warp moves every node, anchor, segment and junction coherently.
    // Boundary knots retain the exact midpoint of each real collapsed/expanded port.
    const y = value => {
        let index = unique.findIndex((knot, i) => i && value <= knot[0]);
        if (index < 1) index = value < unique[0][0] ? 1 : unique.length - 1;
        const a = unique[index - 1], b = unique[index];
        return a[1] + (value - a[0]) * (b[1] - a[1]) / (b[0] - a[0]);
    };
    const rect = item => ({ ...item, x: x(item.x), y: y(item.y), width: x(item.x + item.width) - x(item.x), height: y(item.y + item.height) - y(item.y) });
    const scene = { ...expanded, nodes: expanded.nodes.map(rect), bounds: rect(expanded.bounds),
        anchors: expanded.anchors.map(anchor => ({ ...anchor, x: x(anchor.x), y: y(anchor.y) })),
        routes: expanded.routes.map(route => ({ ...route,
            points: route.points.map(point => ({ ...point, x: x(point.x), y: y(point.y), escapeX: x(point.escapeX) })),
            segments: route.segments.map(([x1, y1, x2, y2]) => [x(x1), y(y1), x(x2), y(y2)]),
            junctions: route.junctions.map(point => ({ x: x(point.x), y: y(point.y) })),
            constantMarker: route.constantMarker ? { ...route.constantMarker, x: x(route.constantMarker.x), y: y(route.constantMarker.y) } : null })),
        continuations: expanded.continuations.map(item => ({ ...item, x: x(item.x), y: y(item.y), endX: x(item.endX) })) };
    for (const route of scene.routes) {
        route.path = route.segments.map(([x1, y1, x2, y2]) => `M${x1},${y1}H${x2}V${y2}`).join(' ');
        for (const point of route.points) {
            const anchor = scene.anchors.find(item => item.id === point.anchorId);
            close(anchor.x, point.x); close(anchor.y, point.y);
            assert.ok(route.segments.some(segment => segment[0] === point.x && segment[1] === point.y), 'Route must still reach its port');
        }
    }
    for (const anchor of scene.anchors.filter(item => item.ownerId === occurrenceId)) {
        const a = collapsed.anchors.find(item => item.id === anchor.id), b = expanded.anchors.find(item => item.id === anchor.id);
        close(anchor.x, mix(a.x, b.x)); close(anchor.y, mix(a.y, b.y));
    }
    return { scene, before, after, middle, yKnots: unique };
}

function validateMembership(model, scene, occurrenceId) {
    const artifactText = fs.readFileSync(path.join(ROOT, model.snapshot.artifact.pathRef), 'utf8');
    assert.equal(digest(artifactText), model.snapshot.artifact.hash);
    const raw = JSON.parse(artifactText), refs = new Set();
    const check = id => {
        const entity = model.entities[id]; assert.ok(entity, `Unknown hardware reference ${id}`);
        for (const ref of entity.providerRefs) {
            assert.equal(ref.artifactHash, model.snapshot.artifact.hash);
            assert.equal(ref.pathRef, model.snapshot.artifact.pathRef);
            assert.notEqual(pointer(raw, ref), undefined); refs.add(ref.pointer);
        }
        return entity;
    };
    for (const node of scene.nodes) check(node.id);
    let orderedPortBits = 0;
    for (const anchor of scene.anchors) {
        const entity = check(anchor.id), emitted = pointer(raw, entity.providerRefs[0]);
        assert.deepEqual(anchor.rawBits, entity.kind === 'port' ? emitted.bits : emitted);
        assert.deepEqual(anchor.bits, entity.bits); orderedPortBits += anchor.bits.length;
        for (let i = 0; i < anchor.bits.length; i++) assert.equal(check(anchor.bits[i]).value, anchor.rawBits[i]);
    }
    for (const route of scene.routes) {
        route.aliases.forEach(check);
        for (let i = 0; i < route.bits.length; i++) {
            const bit = check(route.bits[i]); assert.equal(bit.value, route.rawBits[i]);
            for (const point of route.points) assert.ok(bit.endpoints.some(endpoint => endpoint.entityId === point.endpointId));
        }
    }
    const occurrence = check(occurrenceId);
    assert.deepEqual(scene.representedBits.slice().sort(), occurrence.bits.filter(id => model.bits[id].endpoints.length).sort());
    let boundaryBits = 0;
    for (const anchor of scene.anchors.filter(item => item.ownerId === occurrenceId)) {
        const port = model.ports[anchor.id];
        const bindings = occurrence.boundaries.map(check).filter(binding => binding.portId === port.id);
        const actual = occurrence.cellId ? pointer(raw, model.cells[occurrence.cellId].providerRefs[0]).connections[port.name] : [];
        assert.equal(bindings.length, actual.length);
        bindings.forEach((binding, index) => {
            assert.equal(binding.index, index); assert.equal(binding.formalBitId, port.bits[index]);
            assert.equal(check(binding.actualBitId).value, actual[index]);
            assert.equal(check(binding.formalBitId).value, port.rawBits[index]);
            assert.equal(pointer(raw, binding.providerRefs[0]), actual[index]);
            assert.equal(pointer(raw, binding.providerRefs[1]), port.rawBits[index]);
        });
        const continuation = scene.continuations.find(item => item.portId === port.id);
        if (bindings.length) assert.deepEqual(continuation.bindings, bindings);
        else assert.equal(continuation, undefined);
        boundaryBits += bindings.length;
    }
    return { externalPorts: occurrence.ports.length, externalOrderedBits: occurrence.ports.reduce((sum, id) => sum + model.ports[id].bits.length, 0),
        allPortAnchors: scene.anchors.length, allOrderedPortBits: orderedPortBits, formalActualBindings: boundaryBits,
        representedSignalOrConstantBits: scene.representedBits.length, checkedProviderPointers: refs.size };
}

function serialize(model, result, membership) {
    const { scene, before, after, middle, yKnots } = result;
    const metadata = { kind: 'static-model-derived-intermediate-not-runtime-animation', fraction: FRACTION,
        snapshotId: model.snapshot.id, artifact: model.snapshot.artifact, occurrenceId: after.id,
        collapsedBounds: before, expandedBounds: after, interpolatedBounds: middle, yKnots, membership };
    const attrs = (id, hardwareRefs, extra = {}) => ({ id, 'data-hardware-refs': JSON.stringify(hardwareRefs),
        'data-provider-refs': JSON.stringify(hardwareRefs.flatMap(ref => model.entities[ref].providerRefs)), ...extra });
    let drawing = '';
    const nodeShape = node => {
        const label = node.displayName.length > 22 ? `${node.displayName.slice(0, 19)}...` : node.displayName;
        return tag('g', attrs(node.domId, [node.id], { 'data-kind': node.expanded ? 'shell' : 'node' }),
            tag('title', {}, xml(`${node.name}\n${model.entities[node.id].providerRefs.map(ref => ref.pointer).join('\n')}`)) +
            tag('rect', { class: node.expanded ? 'shell' : 'cell', x: node.x, y: node.y, width: node.width, height: node.height, rx: 3 }) +
            text(node.x + 7, node.y + 17, label, { class: 'node-label' }));
    };
    drawing += nodeShape(scene.nodes.find(node => node.expanded));
    for (const route of scene.routes) {
        let body = tag('path', { d: route.path, class: 'wire' });
        for (const dot of route.junctions) body += tag('circle', { cx: dot.x, cy: dot.y, r: 2, class: 'junction' });
        if (route.constantMarker) {
            const c = route.constantMarker;
            body += tag('rect', { x: c.x - 2, y: c.y - 2, width: 4, height: 4, class: 'junction' }) +
                text(c.x, c.y - 5, c.label, { class: 'constant', 'text-anchor': 'middle' });
        }
        drawing += tag('g', attrs(route.domId, route.bits, { 'data-kind': 'route', 'data-bits': JSON.stringify(route.bits) }), body);
    }
    for (const node of scene.nodes.filter(node => !node.expanded)) drawing += nodeShape(node);
    for (const continuation of scene.continuations) {
        drawing += tag('path', attrs(continuation.id, continuation.bindings.map(binding => binding.id), {
            'data-kind': 'continuation', 'data-bindings': JSON.stringify(continuation.bindings),
            'data-presentation-only': 'true', class: 'continuation', d: `M${continuation.x},${continuation.y}H${continuation.endX}` }));
    }
    for (const anchor of scene.anchors) {
        const inwardRight = anchor.boundary ? anchor.side === 'left' : anchor.side === 'right';
        const label = `${anchor.name} [${anchor.bits.length}]`;
        const bindings = (model.occurrences[anchor.ownerId]?.boundaries || []).map(id => model.boundaries[id]).filter(binding => binding.portId === anchor.id);
        drawing += tag('g', attrs(anchor.domId, [anchor.id], { 'data-kind': 'port', 'data-bits': JSON.stringify(anchor.bits),
            'data-raw-bits': JSON.stringify(anchor.rawBits), 'data-bindings': JSON.stringify(bindings), 'data-x': anchor.x, 'data-y': anchor.y }),
        tag('rect', { class: 'pin', x: anchor.x - 2.5, y: anchor.y - 2.5, width: 5, height: 5 }) +
        text(anchor.x + (inwardRight ? -7 : 7), anchor.y + (anchor.boundary ? -5 : 3), label,
            { class: 'port-label', 'text-anchor': inwardRight ? 'end' : 'start' }));
    }
    const b = scene.bounds;
    return '<?xml version="1.0" encoding="UTF-8"?>\n' + tag('svg', { xmlns: 'http://www.w3.org/2000/svg', width: 1280, height: 900, viewBox: '0 0 1280 900',
        'aria-labelledby': 'intermediate-title intermediate-description', 'data-fraction': FRACTION },
    tag('title', { id: 'intermediate-title' }, 'Static model-derived 50% expansion intermediate - not runtime animation') +
    tag('desc', { id: 'intermediate-description' }, 'Actual collapsed and expanded measured layout bounds are interpolated at 50 percent. One coordinate warp preserves real shell, ordered port, route and formal/actual binding memberships. This static artifact is not proof of runtime animation or interactive completion.') +
    tag('metadata', { id: 'intermediate-metadata' }, xml(JSON.stringify(metadata))) +
    tag('style', {}, 'svg{font-family:system-ui,sans-serif;background:#1e1e1e;color:#d4d4d4}text{fill:#d4d4d4}.shell{fill:#1e1e1e;stroke:#969696;stroke-width:1.5}.cell{fill:#252526;stroke:#969696}.wire{fill:none;stroke:#b5b5b5;stroke-width:1;vector-effect:non-scaling-stroke}.junction{fill:#d4d4d4}.pin{fill:#1e1e1e;stroke:#d4d4d4}.continuation{fill:none;stroke:#75beff;stroke-dasharray:4 3}.node-label{font-size:10px;font-weight:600}.port-label,.constant{font-size:8px}.constant{paint-order:stroke;stroke:#1e1e1e;stroke-width:3}.caption{font-size:13px}') +
    tag('rect', { width: 1280, height: 900, fill: '#1e1e1e' }) +
    text(24, 32, 'Static model-derived intermediate / 50% geometry', { 'font-size': 20, 'font-weight': 600 }) +
    text(24, 57, `${model.occurrences[after.id].path.join(' / ')} | ${membership.externalPorts} external ports | ${membership.formalActualBindings} ordered boundary bindings`, { class: 'caption' }) +
    text(24, 79, 'Not runtime animation. Real click endpoints are verified separately.', { class: 'caption' }) +
    tag('svg', { x: 24, y: 100, width: 1232, height: 744, viewBox: `${b.x - 24} ${b.y - 24} ${b.width + 48} ${b.height + 48}` }, drawing) +
    text(24, 865, `Artifact SHA-256 ${model.snapshot.artifact.hash}`, { class: 'caption' }) +
    text(24, 888, 'Dashed stubs retain real parent-net bindings. No synthetic hardware or global constant driver.', { class: 'caption' })) + '\n';
}

async function main() {
    fs.mkdirSync(OUT, { recursive: true });
    const browser = await chromium.launch({ channel: 'chrome', headless: true });
    const entries = [];
    try {
        const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
        page.setDefaultNavigationTimeout(10000);
        for (const build of createCatalog()) {
            assert.equal(build.status, 'ready', build.error);
            const model = build.model;
            const candidates = Object.values(model.occurrences).filter(item => !item.blackbox && item.cells.length);
            candidates.sort((a, b) => Number(!a.parentId) - Number(!b.parentId) || a.path.join('/').localeCompare(b.path.join('/')));
            const occurrence = candidates[0]; assert.ok(occurrence, 'No expandable occurrence in artifact');
            await page.goto('about:blank');
            await page.setContent('<!doctype html><html><body></body></html>');
            await page.addScriptTag({ path: path.join(__dirname, 'layout.js') });
            const scenes = await page.evaluate(({ model, occurrence }) => {
                const canvas = document.createElement('canvas'), context = canvas.getContext('2d');
                context.font = '12px system-ui';
                const measure = text => context.measureText(text).width;
                return { collapsed: HardwareLayout.layout(model, { rootId: occurrence.parentId }, measure),
                    expanded: HardwareLayout.layout(model, { rootId: occurrence.id }, measure) };
            }, { model, occurrence });
            const result = interpolate(scenes.collapsed, scenes.expanded, occurrence.id);
            const membership = validateMembership(model, result.scene, occurrence.id);
            const svg = serialize(model, result, membership);
            assert.equal(svg, serialize(model, interpolate(scenes.collapsed, scenes.expanded, occurrence.id), membership), 'Static output must be deterministic');
            const stem = `intermediate-50-${build.key.toLowerCase()}`, svgPath = path.join(OUT, `${stem}.svg`), pngPath = path.join(OUT, `${stem}.png`);
            fs.writeFileSync(svgPath, svg);
            await page.goto(pathToFileURL(svgPath).href);
            const rendered = await page.evaluate(async () => {
                await document.fonts.ready;
                return { parserErrors: document.querySelectorAll('parsererror').length,
                    metadata: JSON.parse(document.getElementById('intermediate-metadata').textContent),
                    objects: [...document.querySelectorAll('[data-hardware-refs]')].map(item => ({ id: item.id,
                        hardwareRefs: JSON.parse(item.dataset.hardwareRefs), providerRefs: JSON.parse(item.dataset.providerRefs) })),
                    ports: [...document.querySelectorAll('[data-kind="port"]')].map(item => ({ id: item.id,
                        bits: JSON.parse(item.dataset.bits), rawBits: JSON.parse(item.dataset.rawBits), bindings: JSON.parse(item.dataset.bindings),
                        x: +item.querySelector('rect').getAttribute('x') + 2.5, y: +item.querySelector('rect').getAttribute('y') + 2.5 })),
                    routes: [...document.querySelectorAll('[data-kind="route"]')].map(item => ({ id: item.id, path: item.querySelector('path').getAttribute('d') })),
                    shell: (() => { const rect = document.querySelector('[data-kind="shell"] rect');
                        return Object.fromEntries(['x', 'y', 'width', 'height'].map(key => [key, +rect.getAttribute(key)])); })() };
            });
            assert.equal(rendered.parserErrors, 0); assert.equal(rendered.metadata.fraction, FRACTION);
            assert.equal(new Set(rendered.objects.map(item => item.id)).size, rendered.objects.length);
            assert.equal(rendered.objects.length, result.scene.nodes.length + result.scene.routes.length + result.scene.anchors.length + result.scene.continuations.length);
            for (const object of rendered.objects) {
                assert.deepEqual(object.providerRefs, object.hardwareRefs.flatMap(id => model.entities[id].providerRefs));
                for (const ref of object.providerRefs) assert.notEqual(pointer(model.raw, ref), undefined);
            }
            for (const key of ['x', 'y', 'width', 'height']) close(rendered.shell[key], result.middle[key]);
            for (const anchor of result.scene.anchors) {
                const actual = rendered.ports.find(item => item.id === anchor.domId); assert.ok(actual);
                assert.deepEqual(actual.bits, anchor.bits); assert.deepEqual(actual.rawBits, anchor.rawBits);
                close(actual.x, anchor.x); close(actual.y, anchor.y);
                assert.deepEqual(actual.bindings, (model.occurrences[anchor.ownerId]?.boundaries || []).map(id => model.boundaries[id]).filter(binding => binding.portId === anchor.id));
            }
            for (const route of result.scene.routes) assert.equal(rendered.routes.find(item => item.id === route.domId).path, route.path);
            await page.screenshot({ path: pngPath });
            entries.push({ build: build.key, occurrenceId: occurrence.id, fraction: FRACTION, inputArtifact: model.snapshot.artifact,
                snapshotId: model.snapshot.id, shellId: result.after.domId, collapsedBounds: result.before, expandedBounds: result.after,
                interpolatedBounds: result.middle, membership, svgPath: path.relative(ROOT, svgPath), screenshotPath: path.relative(ROOT, pngPath),
                svgSha256: digest(svg), screenshotSha256: digest(fs.readFileSync(pngPath)), chromeDomAssertions: 'passed', deterministicSvg: true });
        }
        const receipt = { command: 'node experiments/hardware/prototype/intermediate.js', kind: 'static-model-derived-intermediate-not-runtime-animation',
            browser: browser.version(), geometryFraction: FRACTION,
            method: 'Measured real layout endpoints; affine X and monotonic port-constrained piecewise-linear Y warp applied coherently to all geometry',
            generatorSha256: digest(fs.readFileSync(__filename)), layoutSha256: digest(fs.readFileSync(path.join(__dirname, 'layout.js'))), entries };
        fs.writeFileSync(path.join(OUT, 'intermediate-receipt.json'), `${JSON.stringify(receipt, null, 2)}\n`);
        const receiptPath = path.join(OUT, 'receipt.json');
        const existing = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
        existing.staticIntermediate = receipt;
        fs.writeFileSync(receiptPath, `${JSON.stringify(existing, null, 2)}\n`);
        console.log(JSON.stringify({ command: receipt.command, geometryFraction: FRACTION, entries: entries.map(({ build, membership, svgPath, screenshotPath }) => ({ build, membership, svgPath, screenshotPath })) }, null, 2));
    } finally { await browser.close(); }
}
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
