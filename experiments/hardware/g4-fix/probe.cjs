'use strict';

const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(process.env.G4_REVIEW_ROOT || path.join(__dirname, '../../..'));
const { createCatalog } = require(path.join(root, 'experiments/hardware/g4/server.js'));
const { layout } = require(path.join(root, 'media/hardware-layout.js'));
const { createRunOutput } = require('../g4/run-output');
const EPSILON = 1e-7;

function metrics(scene, geometry) {
    let length = 0, bends = 0, crossings = 0;
    const overlaps = [], pairs = new Set();
    const connection = new Map(scene.connections.map(item => [item.id, item]));
    for (const route of geometry.routes) {
        length += route.segments.reduce((sum, s) => sum + Math.abs(s[2] - s[0]) + Math.abs(s[3] - s[1]), 0);
        const corners = new Set();
        for (const a of route.segments) for (const b of route.segments) {
            if ((a[1] === a[3]) === (b[1] === b[3])) continue;
            for (const p of [[a[0], a[1]], [a[2], a[3]]]) {
                if ([[b[0], b[1]], [b[2], b[3]]].some(q => Math.abs(p[0] - q[0]) < EPSILON && Math.abs(p[1] - q[1]) < EPSILON)) corners.add(p.join(','));
            }
        }
        bends += corners.size;
    }
    for (let i = 0; i < geometry.routes.length; i++) for (let j = i + 1; j < geometry.routes.length; j++) {
        const a = geometry.routes[i], b = geometry.routes[j];
        for (const x of a.segments) for (const y of b.segments) {
            const hx = Math.abs(x[1] - x[3]) <= EPSILON, hy = Math.abs(y[1] - y[3]) <= EPSILON;
            if (hx === hy) {
                const axis = hx ? 0 : 1;
                if (Math.abs(x[1 - axis] - y[1 - axis]) > EPSILON) continue;
                const overlap = Math.min(Math.max(x[axis], x[axis + 2]), Math.max(y[axis], y[axis + 2]))
                    - Math.max(Math.min(x[axis], x[axis + 2]), Math.min(y[axis], y[axis + 2]));
                if (overlap > EPSILON) {
                    pairs.add(`${a.id}|${b.id}`);
                    overlaps.push({ a: a.id, b: b.id, aLabel: connection.get(a.id).label, bLabel: connection.get(b.id).label,
                        aBits: connection.get(a.id).rawBits, bBits: connection.get(b.id).rawBits, segmentA: x, segmentB: y, length: overlap });
                }
            } else {
                const horizontal = hx ? x : y, vertical = hx ? y : x;
                if (vertical[0] > Math.min(horizontal[0], horizontal[2]) + EPSILON && vertical[0] < Math.max(horizontal[0], horizontal[2]) - EPSILON
                    && horizontal[1] > Math.min(vertical[1], vertical[3]) + EPSILON && horizontal[1] < Math.max(vertical[1], vertical[3]) - EPSILON) crossings++;
            }
        }
    }
    return { bounds: geometry.bounds, totalRouteLength: length, bends, crossings, overlappingPairs: pairs.size,
        overlappingSegments: overlaps.length, overlaps, labelMeasurement: geometry.labels ? 'available' : 'not-present-in-original-geometry' };
}

(async () => {
    const output = await createRunOutput(path.resolve(__dirname, '../../..'), 'g4-fix-product-probe');
    const results = [];
    for (const query of await createCatalog()) {
        const entry = query.getCatalogEntry();
        for (const provider of ['stock', 'instrumented']) {
            const queue = [null], seen = new Set();
            while (queue.length) {
                const context = queue.shift();
                const scene = query.getScene({ buildId: entry.buildId, snapshotId: entry.snapshotId, queryGeneration: results.length + 1,
                    rootInstanceId: entry.rootInstanceId, ownerInstanceId: entry.rootInstanceId,
                    sceneKind: 'rtl', implementationProvider: provider, ...(context ? { implementationContext: context } : {}) }).scene;
                if (seen.has(scene.shell.id)) continue;
                seen.add(scene.shell.id);
                const geometry = layout(scene, { width: 1100, height: 650 });
                results.push({ buildId: entry.buildId, provider, snapshotId: scene.snapshotId, ownerInstanceId: scene.ownerInstanceId,
                    shellId: scene.shell.id, implementationContext: scene.implementationContext, scene, geometry, metrics: metrics(scene, geometry) });
                for (const child of scene.children.filter(item => item.interaction.kind === 'enter')) {
                    queue.push({ ...scene.implementationContext, contextOccurrenceId: child.id });
                }
            }
        }
        const sourceQueue = [entry.rootInstanceId];
        while (sourceQueue.length) {
            const ownerInstanceId = sourceQueue.shift();
            const scene = query.getScene({ buildId: entry.buildId, snapshotId: entry.snapshotId, queryGeneration: results.length + 1,
                rootInstanceId: ownerInstanceId, ownerInstanceId, sceneKind: 'bsv' }).scene;
            const geometry = layout(scene, { width: 1100, height: 650 });
            results.push({ buildId: entry.buildId, provider: 'bsv', ownerInstanceId, scene, geometry, metrics: metrics(scene, geometry) });
            sourceQueue.push(...scene.children.map(child => child.id));
        }
    }
    fs.writeFileSync(path.join(output, 'product-probe.json'), `${JSON.stringify({ sourceRoot: root, epsilon: EPSILON, results }, null, 2)}\n`, { flag: 'wx' });
    console.log(JSON.stringify({ output, scenes: results.length,
        summary: results.map(item => ({ build: item.buildId, provider: item.provider,
            path: item.implementationContext?.occurrencePath || item.scene.occurrencePath,
            ...item.metrics, overlaps: undefined })) }, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; });
