'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { normalizeConfig, parseJsonc } = require('../src/architecture/config');
const { buildArchitectureModel } = require('../src/architecture/graph-builder');
const { parseBsvFile } = require('../src/architecture/parser');

const ROOT = path.join(__dirname, '..');
const EXAMPLE = path.join(ROOT, 'examples', 'bsv-mini-accelerator');

function filesBelow(directory) {
    return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const fullPath = path.join(directory, entry.name);
        return entry.isDirectory() ? filesBelow(fullPath) : [fullPath];
    });
}

function exampleModel(configTransform = (raw) => raw) {
    const parsedFiles = filesBelow(path.join(EXAMPLE, 'hw', 'bsv', 'src'))
        .filter((filePath) => filePath.endsWith('.bsv'))
        .sort()
        .map((filePath) => parseBsvFile(fs.readFileSync(filePath, 'utf8'), {
            uri: `file://${filePath}`,
            relativePath: path.relative(EXAMPLE, filePath).replace(/\\/g, '/')
        }));
    const raw = parseJsonc(fs.readFileSync(path.join(EXAMPLE, '.bsv-arch.json'), 'utf8'));
    const config = normalizeConfig(configTransform(raw), { workspaceName: 'Mini BSV Accelerator' });
    return buildArchitectureModel(parsedFiles, config, {
        workspaceName: 'Mini BSV Accelerator',
        workspaceUri: 'file:///example/bsv-mini-accelerator',
        activeFile: 'hw/bsv/src/control/AcceleratorTop.bsv'
    });
}

test('architecture model resolves module hierarchy and entrypoint', () => {
    const model = exampleModel();
    const top = model.nodes.find((node) => node.name === 'mkAcceleratorTop');
    assert.ok(top);
    assert.equal(top.label, 'Mini Accelerator Top');
    assert.equal(top.entry, true);
    assert.deepEqual(model.roots, [top.id]);

    const instantiated = model.edges
        .filter((edge) => edge.source === top.id && edge.kind === 'instantiate')
        .map((edge) => model.nodes.find((node) => node.id === edge.target)?.name)
        .sort();
    assert.deepEqual(instantiated, [
        'mkAcceleratorController',
        'mkMemorySubsystem',
        'mkVectorQuantizer',
        'mkSystolicArray'
    ].sort());
});

test('manual architecture nodes and data/control edges are preserved', () => {
    const model = exampleModel();
    const host = model.nodes.find((node) => node.id === 'virtual:host-runtime');
    assert.ok(host);
    assert.equal(host.kind, 'host');

    const manualEdges = model.edges.filter((edge) => edge.inferred === false);
    assert.equal(manualEdges.length, 2);
    assert.ok(manualEdges.some((edge) => edge.kind === 'control' && edge.label === 'commands'));
    assert.ok(manualEdges.some((edge) => edge.kind === 'data' && edge.label === 'quantized activations'));
});

test('packages, source groups, and source locations survive normalization', () => {
    const model = exampleModel();
    const memoryModule = model.nodes.find((node) => node.name === 'mkMemorySubsystem');
    assert.equal(memoryModule.group, 'memory');
    assert.match(memoryModule.relativePath, /MemorySubsystem\.bsv$/);
    assert.equal(memoryModule.location.line >= 0, true);
    assert.ok(model.groups.some((group) => group.id === 'compute' && group.label === 'Compute Pipeline'));
    assert.equal(model.stats.files, 8);
    assert.equal(model.diagnostics.length, 0);
});

test('unresolvable manual relationships produce a non-fatal diagnostic', () => {
    const model = exampleModel((raw) => ({
        ...raw,
        edges: [...raw.edges, { from: 'missing-source', to: 'mkAcceleratorTop', kind: 'data' }]
    }));
    assert.ok(model.diagnostics.some((item) => item.message.includes('missing-source')));
});
