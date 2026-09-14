'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { parseBsvFile } = require('../src/architecture/parser');
const { normalizeConfig } = require('../src/architecture/config');
const { buildSemanticModel } = require('../src/architecture/semantic/model');

const names = ['multiply', 'widen', 'accumulate', 'zero', 'add'];
const declarations = names.map((name) => `function t ${name}(t x);`).join('\n');
const implementations = (width) => names.map((name, index) =>
    index === 0 ? `function Bit#(${width}) ${name}(Bit#(${width}) x) = x + ${width};`
        : `function Bit#(${width}) ${name}(Bit#(${width}) x); return x; endfunction`
).join('\n');
const SOURCE = `package Overloads;
// 😀 function bogus(); endfunction instance Bogus#(int);
typeclass Arithmetic#(type t) provisos (Bits#(t, n));
${declarations}
endtypeclass: Arithmetic
instance Arithmetic#(Bit#(8));
${implementations(8)}
endinstance
instance Arithmetic#(Bit#(16)) provisos (Add#(8, 8, 16));
${implementations(16)}
endinstance
function Bit#(8) ordinary(Bit#(8) x); return x; endfunction
module mkTop(Empty);
function Bit#(8) local(Bit#(8) x); return x; endfunction
rule go; let x = multiply(1); let y = ordinary(x); endrule
endmodule endpackage`;

function parse(source = SOURCE, packageName = 'Overloads') {
    return parseBsvFile(source, { uri: `file:///${packageName}.bsv`, relativePath: `${packageName}.bsv` });
}

function model(files = [parse()]) {
    return buildSemanticModel(files, normalizeConfig({ entrypoints: ['mkTop'] }), {});
}

test('typeclass signatures stop at their semicolon and preserve every instance implementation', () => {
    const parsed = parse();
    assert.equal(parsed.functions.length, 17);
    const scoped = parsed.functions.filter((fn) => fn.declarationScope);
    assert.equal(scoped.length, 15);
    for (const fn of scoped) {
        const scope = fn.declarationScope;
        assert.ok(scope.head.startsWith(`${scope.kind} Arithmetic#(`));
        assert.ok(fn.range.start >= scope.range.bodyStart && fn.range.end <= scope.range.bodyEnd);
        assert.equal(scope.sourceRange.uri, parsed.uri);
        assert.equal(SOURCE.slice(scope.range.start, scope.range.end).startsWith(scope.head), true);
        if (scope.kind === 'typeclass') {
            assert.equal(fn.declarationOnly, true);
            assert.equal(fn.range.bodyStart, fn.range.bodyEnd);
            assert.equal(SOURCE.slice(fn.range.start, fn.range.end), `function t ${fn.name}(t x);`);
            assert.deepEqual(fn.codeAnalysis.statements, []);
            assert.deepEqual(fn.calls, []);
            assert.deepEqual(fn.returns, []);
        } else {
            const body = SOURCE.slice(fn.range.bodyStart, fn.range.bodyEnd).trim();
            assert.match(body, fn.name === 'multiply' ? /^x \+ (8|16)$/ : /^return x;$/);
            assert.equal(fn.codeAnalysis.statements.length, 1);
        }
    }
    assert.equal(parsed.diagnostics.some((item) => item.message.includes('endfunction')), false);
});

test('declaration scope distinguishes legal overload IDs without changing ordinary function IDs', () => {
    const semantic = model();
    const functions = semantic.definitions.filter((entry) => entry.kind === 'function-definition');
    assert.equal(functions.length, 17);
    assert.equal(new Set(functions.map((entry) => entry.id)).size, 17);
    assert.ok(functions.some((entry) => entry.id === 'def:Overloads:ordinary'));
    assert.ok(functions.some((entry) => entry.id === 'def:Overloads:mkTop.local'));
    for (const name of names) assert.equal(functions.filter((entry) => entry.name === name).length, 3);
    assert.deepEqual(model([parse('\n\n' + SOURCE)]).definitions.map((entry) => entry.id),
        semantic.definitions.map((entry) => entry.id));
    assert.equal(semantic.functionDefinitions.filter((entry) => entry.declarationOnly).length, 5);
    const ordinary = semantic.callSites.find((call) => call.calleeName === 'ordinary');
    assert.equal(ordinary.calleeDefinitionId, 'def:Overloads:ordinary');
    assert.equal(ordinary.targetResolutionStatus, 'exact');
    assert.equal(ordinary.resolutionStatus, 'unresolved');
});

test('imported and intra-instance calls never infer typeclass dispatch from one or several implementations', () => {
    for (const count of [1, 2]) {
        const source = `package Overloads;
${[8, 16].slice(0, count).map((width) => `instance C#(Bit#(${width}));
function Bit#(${width}) convert(Bit#(${width}) x); return convert(x); endfunction
endinstance`).join('\n')}
endpackage`;
        const caller = parse(`package Caller; import Overloads::*;
module mkTop(Empty); rule go; let x = convert(1); endrule endmodule endpackage`, 'Caller');
        const semantic = model([parse(source), caller]);
        const candidates = semantic.definitions.filter((entry) => entry.name === 'convert').map((entry) => entry.id).sort();
        const calls = semantic.callSites.filter((call) => call.calleeName === 'convert');
        assert.equal(calls.length, count + 1);
        for (const call of calls) {
            assert.equal(call.resolutionStatus, 'unresolved');
            assert.equal(call.calleeDefinitionId, null);
            assert.deepEqual(call.actualToFormal, []);
            assert.deepEqual(call.candidateDefinitionIds, candidates);
            assert.equal(call.resolutionReason, 'typeclass-dispatch-not-resolved');
        }
    }
});

test('a builtin name with a visible typeclass implementation does not bypass dispatch uncertainty', () => {
    const semantic = model([parse(`package Overloads;
instance Bits#(T, 8); function Bit#(8) pack(T x); return 0; endfunction endinstance
module mkTop(Empty); rule go; let x = pack(1); endrule endmodule endpackage`)]);
    const call = semantic.callSites.find((entry) => entry.calleeName === 'pack');
    assert.equal(call.resolutionStatus, 'unresolved');
    assert.equal(call.calleeDefinitionId, null);
    assert.equal(call.candidateDefinitionIds.length, 1);
});

test('unterminated instance functions cannot consume the following package function body', () => {
    const source = `package Overloads;
instance C#(Bit#(8)); function Bit#(8) missing(Bit#(8) x); endinstance
function Bit#(8) ordinary(Bit#(8) x); return x; endfunction endpackage`;
    const parsed = parse(source);
    assert.deepEqual(parsed.functions.map((entry) => entry.name), ['missing', 'ordinary']);
    assert.equal(parsed.functions[0].range.bodyStart, parsed.functions[0].range.bodyEnd);
    assert.equal(parsed.functions[0].returns.length, 0);
    assert.equal(parsed.functions[1].returns.length, 1);
    assert.equal(parsed.diagnostics.filter((entry) => entry.message.includes('endfunction')).length, 1);
});
