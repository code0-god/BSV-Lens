'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { buildArchitectureModel } = require('../src/architecture/graph-builder');
const { normalizeConfig } = require('../src/architecture/config');
const { parseBsvFile } = require('../src/architecture/parser');
const { resolveArchitectureSymbol } = require('../src/architecture/symbol-resolver');

function node(id, name, packageName, parentId = null, kind = 'module') {
    return { id, name, sourceId: name, packageName, parentId, kind };
}

test('strict resolver follows scoped order and returns explicit statuses', () => {
    const modules = [
        node('module:PE.mkPE', 'mkPE', 'PE'),
        node('module:Controller.mkController', 'mkController', 'Controller')
    ];
    const members = [
        node('rule:module:PE.mkPE:step:1', 'step', 'PE', modules[0].id, 'rule'),
        node('rule:module:Controller.mkController:step:1', 'step', 'Controller', modules[1].id, 'rule'),
        node('rule:module:Controller.mkController:drain:2', 'drain', 'Controller', modules[1].id, 'rule')
    ];
    const nodes = [...modules, ...members];
    const nodeById = new Map(nodes.map((item) => [item.id, item]));

    assert.equal(resolveArchitectureSymbol(modules[0].id, { nodes, nodeById }).status, 'exact');
    assert.equal(resolveArchitectureSymbol('PE.step', { nodes, nodeById }).node.id, members[0].id);
    assert.equal(resolveArchitectureSymbol('Controller.mkController.step', { nodes, nodeById }).node.id, members[1].id);
    assert.equal(resolveArchitectureSymbol('step', {
        nodes,
        nodeById,
        packageName: 'PE'
    }).node.id, members[0].id);
    assert.equal(resolveArchitectureSymbol('drain', {
        nodes,
        nodeById,
        importedPackages: ['Controller']
    }).node.id, members[2].id);
    assert.equal(resolveArchitectureSymbol('step', {
        nodes,
        nodeById,
        topModule: 'mkController'
    }).node.id, members[1].id);
    assert.equal(resolveArchitectureSymbol('drain', { nodes, nodeById }).node.id, members[2].id);

    const ambiguous = resolveArchitectureSymbol('step', { nodes, nodeById });
    assert.equal(ambiguous.status, 'ambiguous');
    assert.deepEqual(ambiguous.candidates.map((item) => item.id), [
        members[1].id,
        members[0].id
    ].sort());
    assert.equal(resolveArchitectureSymbol('missing', { nodes, nodeById }).status, 'unresolved');
});

test('package-qualified ambiguity cannot fall through to weaker scopes', () => {
    const modules = [
        node('module:PE.mkFirst', 'mkFirst', 'PE'),
        node('module:PE.mkSecond', 'mkSecond', 'PE')
    ];
    const members = [
        node('rule:module:PE.mkFirst:step:1', 'step', 'PE', modules[0].id, 'rule'),
        node('rule:module:PE.mkSecond:step:1', 'step', 'PE', modules[1].id, 'rule')
    ];
    const nodes = [...modules, ...members];
    const result = resolveArchitectureSymbol('PE.step', {
        nodes,
        nodeById: new Map(nodes.map((item) => [item.id, item]))
    });

    assert.equal(result.status, 'ambiguous');
    assert.deepEqual(result.candidates.map((item) => item.id), members.map((item) => item.id));
});

test('ambiguous module constructor does not create instantiate edge', () => {
    const parsed = [
        parse('A', 'module mkWorker(Empty); endmodule'),
        parse('B', 'module mkWorker(Empty); endmodule'),
        parse('Top', 'module mkTop(Empty); Empty worker <- mkWorker; endmodule')
    ];
    const model = buildArchitectureModel(parsed, normalizeConfig({}), {});
    const top = model.nodes.find((item) => item.name === 'mkTop');

    assert.equal(model.edges.some((edge) => edge.source === top.id && edge.kind === 'instantiate'), false);
    assert.ok(model.diagnostics.some((item) =>
        item.message.includes('Ambiguous reference: mkWorker')
        && item.message.includes('module:A.mkWorker')
        && item.message.includes('module:B.mkWorker')
    ));
});

test('ambiguous compiler relation stays diagnostic without authoritative edge', () => {
    const parsed = [
        parse('PE', 'module mkPE(Empty); rule step; noAction; endrule rule drain; noAction; endrule endmodule'),
        parse('Controller', 'module mkController(Empty); rule step; noAction; endrule rule drain; noAction; endrule endmodule')
    ];
    const model = buildArchitectureModel(parsed, normalizeConfig({}), {
        scheduleRelations: [{
            from: 'step',
            to: 'drain',
            kind: 'execution-order',
            origin: 'bsc',
            confidence: 'authoritative'
        }],
        scheduleProvider: 'bsc'
    });

    assert.equal(model.edges.some((edge) => edge.origin === 'bsc'), false);
    assert.ok(model.diagnostics.some((item) => item.message.includes('Ambiguous compiler reference: step')));
});

test('compiler module scope resolves only matching behavior nodes', () => {
    const parsed = [
        parse('PE', 'module mkPE(Empty); rule step; noAction; endrule rule drain; noAction; endrule endmodule'),
        parse('Controller', 'module mkController(Empty); rule step; noAction; endrule rule drain; noAction; endrule endmodule')
    ];
    const model = buildArchitectureModel(parsed, normalizeConfig({}), {
        scheduleRelations: [{
            from: 'step',
            to: 'drain',
            moduleName: 'mkController',
            kind: 'execution-order',
            origin: 'bsc',
            confidence: 'authoritative'
        }],
        scheduleProvider: 'bsc'
    });
    const edge = model.edges.find((item) => item.origin === 'bsc');

    assert.ok(edge);
    assert.match(edge.source, /Controller\.mkController/);
    assert.match(edge.target, /Controller\.mkController/);
});

test('configured top module scopes compiler relations without report module metadata', () => {
    const parsed = [
        parse('PE', 'module mkPE(Empty); rule step; noAction; endrule rule drain; noAction; endrule endmodule'),
        parse('Controller', 'module mkController(Empty); rule step; noAction; endrule rule drain; noAction; endrule endmodule')
    ];
    const model = buildArchitectureModel(parsed, normalizeConfig({}), {
        scheduleRelations: [{
            from: 'step',
            to: 'drain',
            kind: 'execution-order',
            origin: 'bsc',
            confidence: 'authoritative'
        }],
        scheduleProvider: 'bsc',
        scheduleTopModule: 'mkController'
    });
    const edge = model.edges.find((item) => item.origin === 'bsc');

    assert.ok(edge);
    assert.match(edge.source, /Controller\.mkController/);
    assert.match(edge.target, /Controller\.mkController/);
});

test('compiler package scope disambiguates duplicate module names', () => {
    const parsed = [
        parse('First', 'module mkWorker(Empty); rule step; noAction; endrule rule drain; noAction; endrule endmodule'),
        parse('Second', 'module mkWorker(Empty); rule step; noAction; endrule rule drain; noAction; endrule endmodule')
    ];
    const model = buildArchitectureModel(parsed, normalizeConfig({}), {
        scheduleRelations: [{
            from: 'step',
            to: 'drain',
            packageName: 'Second',
            moduleName: 'mkWorker',
            kind: 'execution-order',
            origin: 'bsc',
            confidence: 'authoritative'
        }],
        scheduleProvider: 'bsc'
    });
    const edge = model.edges.find((item) => item.origin === 'bsc');

    assert.ok(edge);
    assert.match(edge.source, /Second\.mkWorker/);
    assert.match(edge.target, /Second\.mkWorker/);
});

function parse(packageName, body) {
    return parseBsvFile(`package ${packageName}; ${body} endpackage`, {
        uri: `file:///${packageName}.bsv`,
        relativePath: `${packageName}.bsv`
    });
}
