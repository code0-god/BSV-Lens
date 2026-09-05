'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createSemanticQueries } = require('../media/semantic-query');
const { normalizeConfig } = require('../src/architecture/config');
const { parseBsvFile } = require('../src/architecture/parser');
const { buildSemanticModel } = require('../src/architecture/semantic/model');
const { buildSemanticSource } = require('./semantic-fixture');

function buildSemanticFiles(files, config = {}) {
    return buildSemanticModel(files.map(([name, source]) => parseBsvFile(source, {
        uri: `file:///${name}`,
        relativePath: name
    })), normalizeConfig(config), { limits: { maxNodes: 1000, maxEdges: 2000 } });
}

test('resolves repeated pure-function callsites with actual-to-formal bindings and no fake occurrence', () => {
    const source = `package Functions;
function UInt#(8) add1(UInt#(8) value); return value + 1; endfunction
module mkTop(Empty);
 Reg#(UInt#(8)) r <- mkReg(0);
 rule go; let a = add1(r); let b = add1(a); r <= b; endrule
endmodule endpackage`;
    const model = buildSemanticSource(source, 'Functions.bsv', { entrypoints: ['mkTop'] });
    const fn = model.functionDefinitions.find((item) => item.name === 'add1');
    assert.ok(fn);
    assert.equal(model.instances.some((item) => item.targetDefinitionId === fn.id), false);
    const calls = model.callSites.filter((item) => item.calleeName === 'add1');
    assert.equal(calls.length, 2);
    assert.notEqual(calls[0].id, calls[1].id);
    for (const call of calls) {
        assert.equal(call.resolutionStatus, 'exact');
        assert.equal(call.calleeDefinitionId, fn.id);
        assert.equal(call.actualToFormal.length, 1);
        assert.equal(call.actualToFormal[0].formalName, 'value');
        assert.ok(call.bindingEnvironmentId);
    }
    const queries = createSemanticQueries(model);
    const direct = queries.getExpressionDependencies(fn.id);
    assert.equal(direct.status, 'exact');
    assert.equal(direct.callSite, null);
    const occurrence = queries.getExpressionDependencies(calls[1].expressionId);
    assert.equal(occurrence.status, 'exact');
    assert.equal(occurrence.callSite.id, calls[1].id);
    assert.equal(occurrence.callee.id, fn.id);
});

test('leaves ambiguous names, specialization, and arity mismatch unresolved', () => {
    const source = `package Calls; import A::*; import B::*;
function Bit#(8) local(Bit#(8) x); return x; endfunction
module mkTop(Empty); rule go; let a = missing(1); let b = local(1, 2); let c = local#(8)(1); endrule endmodule endpackage`;
    const model = buildSemanticSource(source, 'Calls.bsv', { entrypoints: ['mkTop'] });
    const byText = new Map(model.callSites.map((item) => [item.text.replace(/\s/g, ''), item]));
    assert.equal(byText.get('missing(1)').resolutionStatus, 'unresolved');
    assert.equal(byText.get('local(1,2)').resolutionStatus, 'unresolved');
    assert.equal(byText.get('local#(8)(1)').resolutionStatus, 'unresolved');
});

test('resolves only source-visible functions across multiple packages', () => {
    const functionSource = (packageName) => `package ${packageName}; function Bit#(8) choose(Bit#(8) x); return x; endfunction endpackage`;
    const inaccessible = buildSemanticFiles([
        ['A.bsv', functionSource('A')],
        ['B.bsv', 'package B; module mkB(Empty); rule go; let y = choose(1); endrule endmodule endpackage']
    ], { entrypoints: ['mkB'] });
    const hiddenCall = inaccessible.callSites.find((item) => item.calleeName === 'choose');
    assert.equal(hiddenCall.resolutionStatus, 'unresolved');
    assert.deepEqual(hiddenCall.candidateDefinitionIds, []);

    const imported = buildSemanticFiles([
        ['A.bsv', functionSource('A')],
        ['B.bsv', 'package B; import A::*; module mkB(Empty); rule go; let y = choose(1); endrule endmodule endpackage']
    ], { entrypoints: ['mkB'] });
    const importedCall = imported.callSites.find((item) => item.calleeName === 'choose');
    assert.equal(importedCall.resolutionStatus, 'exact');
    assert.equal(importedCall.calleeDefinitionId, 'def:A:choose');

    const ambiguous = buildSemanticFiles([
        ['A.bsv', functionSource('A')],
        ['C.bsv', functionSource('C')],
        ['B.bsv', 'package B; import A::*; import C::*; module mkB(Empty); rule go; let y = choose(1); endrule endmodule endpackage']
    ], { entrypoints: ['mkB'] });
    const ambiguousCall = ambiguous.callSites.find((item) => item.calleeName === 'choose');
    assert.equal(ambiguousCall.resolutionStatus, 'unresolved');
    assert.deepEqual(ambiguousCall.candidateDefinitionIds, ['def:A:choose', 'def:C:choose']);
});

test('binding environments contain parameters and the current reassignment origin', () => {
    const source = `package Environments; function Bit#(8) f(Bit#(8) p); let x = p; x = 7; return x; endfunction endpackage`;
    const model = buildSemanticSource(source, 'Environments.bsv');
    const returned = model.statements.find((item) => item.kind === 'return');
    const use = model.expressions.find((item) => item.id === returned.expressionId);
    const assignment = model.statements.find((item) => item.kind === 'local-assignment');
    const environment = model.bindingEnvironments.find((item) => item.id === use.bindingEnvironmentId);
    assert.ok(environment.bindings.p);
    assert.equal(environment.bindings.p.kind, 'parameter');
    assert.deepEqual(environment.bindings.x.originExpressionIds, [assignment.rightExpressionId]);
    assert.equal(environment.resolutionStatus, 'exact');
});

test('inline expression functions expose a source-faithful return dependency', () => {
    const source = `package Inline; function Bit#(8) inc(Bit#(8) x) = x + 1; endpackage`;
    const model = buildSemanticSource(source, 'Inline.bsv');
    const fn = model.functionDefinitions.find((item) => item.name === 'inc');
    const result = createSemanticQueries(model).getExpressionDependencies(fn.id);
    assert.equal(result.status, 'exact');
    assert.equal(result.returns.length, 1);
    assert.equal(result.returns[0].text, 'x + 1');
    assert.equal(source.slice(result.returns[0].range.start, result.returns[0].range.end), 'x + 1');

    const unsupportedSource = `package InlineUnknown; function Bit#(8) taggedValue(Bit#(8) x) = tagged Valid x; endpackage`;
    const unsupportedModel = buildSemanticSource(unsupportedSource, 'InlineUnknown.bsv');
    const unsupportedFn = unsupportedModel.functionDefinitions.find((item) => item.name === 'taggedValue');
    const unsupported = createSemanticQueries(unsupportedModel).getExpressionDependencies(unsupportedFn.id);
    assert.equal(unsupported.status, 'unsupported');
    assert.equal(unsupported.returns.length, 1);
    assert.equal(unsupported.returns[0].text, 'tagged Valid x');
    assert.equal(unsupported.returns[0].resolutionStatus, 'unsupported');
});

test('masking and ranges use UTF-16 offsets after astral characters', () => {
    const source = `package Utf; // 😀\nfunction Bit#(8) f(Bit#(8) x); return x; endfunction endpackage`;
    const model = buildSemanticSource(source, 'Utf.bsv');
    const returned = model.statements.find((item) => item.kind === 'return');
    assert.equal(source.slice(returned.range.start, returned.range.end), 'return x;');
    assert.equal(returned.sourceRange.column, source.split('\n')[1].indexOf('return'));
});
