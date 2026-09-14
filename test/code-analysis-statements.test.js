'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { buildSemanticSource } = require('./semantic-fixture');

const SOURCE = `package CodeStatements;
// emoji before code: 😀
module mkTop(Empty);
  Reg#(UInt#(8)) state <- mkReg(0);
  Reg#(UInt#(8)) other <- mkReg(0);
  rule run (state < 9);
    let x = state + 1;
    Bool small = x <= 4;
    let result <- worker.get(x);
    x = result;
    if (small) begin
      state <= x;
    end else begin
      other <= x;
    end
    case (x)
      0: state <= 0;
      default: dynamicAssert(x != 3, "bad");
    endcase
    return;
  endrule
endmodule
endpackage
`;

function expressionTree(model, rootId) {
    const byId = new Map(model.expressions.map((item) => [item.id, item]));
    const project = (id) => {
        const item = byId.get(id);
        assert.ok(item, `missing expression ${id}`);
        const node = {
            kind: item.kind,
            text: item.text,
            range: [item.range.start, item.range.end],
            sourceRange: [
                item.sourceRange.line,
                item.sourceRange.column,
                item.sourceRange.endLine,
                item.sourceRange.endColumn
            ]
        };
        if (item.operator !== null) node.operator = item.operator;
        if (item.operandIds.length) node.operands = item.operandIds.map(project);
        if (item.argumentIds.length) node.arguments = item.argumentIds.map(project);
        return node;
    };
    return project(rootId);
}

test('builds source-linked bounded statement IR and does not classify comparison <= as a write', () => {
    const model = buildSemanticSource(SOURCE, 'CodeStatements.bsv', { entrypoints: ['mkTop'] });
    assert.equal(model.codeAnalysisVersion, 2);
    assert.equal(model.sourceDocuments.length, 1);
    assert.equal(model.sourceDocuments[0].content, SOURCE);
    assert.match(model.sourceDocuments[0].revision, /^[a-f0-9]{64}$/);
    const behavior = model.stateBehaviors.find((item) => item.name === 'run');
    const statements = model.statements.filter((item) => item.enclosingCallableId === behavior.definitionId);
    assert.ok(statements.some((item) => item.kind === 'local-declaration' && item.localSymbol?.name === 'x'));
    assert.ok(statements.some((item) => item.kind === 'result-binding' && item.resultSymbol?.name === 'result'));
    assert.ok(statements.some((item) => item.kind === 'local-assignment' && item.targetSymbol?.name === 'x'));
    assert.equal(statements.filter((item) => item.kind === 'state-assignment').length, 3);
    assert.ok(statements.some((item) => item.kind === 'if'));
    assert.ok(statements.some((item) => item.kind === 'case'));
    assert.ok(statements.some((item) => item.kind === 'assertion'));
    assert.deepEqual(behavior.writes.sort(), ['other', 'state']);
    assert.ok(behavior.predicateExpressionId);
    const comparison = model.expressions.find((item) => item.text === 'x <= 4');
    assert.equal(comparison.kind, 'operator');
    assert.equal(comparison.operator, '<=');
    for (const entity of [...statements, ...model.expressions.filter((item) => item.enclosingCallableId === behavior.definitionId)]) {
        assert.equal(SOURCE.slice(entity.range.start, entity.range.end), entity.text);
        assert.equal(entity.sourceRevision, model.sourceDocuments[0].revision);
    }
});

test('invalidates stale origins through reassignment, shadowing, branch merge, and dynamic alias', () => {
    const source = `package Scope; module mkTop(Empty); Reg#(Bit#(8)) r <- mkReg(0); rule go; let x = r; if (r > 0) begin let x = 1; end else begin x = 2; end r <= x; endrule endmodule endpackage`;
    const model = buildSemanticSource(source, 'Scope.bsv', { entrypoints: ['mkTop'] });
    const finalWrite = model.statements.find((item) => item.kind === 'state-assignment');
    const use = model.expressions.find((item) => item.parentStatementId === finalWrite.id && item.text === 'x');
    assert.equal(use.resolutionStatus, 'unresolved');
    assert.deepEqual(use.definitionIds, []);
});

test('restores the outer lexical binding after a begin/end shadow', () => {
    const source = `package BlockScope; function Bit#(8) f(Bit#(8) x); begin let x = 1; end return x; endfunction endpackage`;
    const model = buildSemanticSource(source, 'BlockScope.bsv');
    const returned = model.statements.find((item) => item.kind === 'return');
    const use = model.expressions.find((item) => item.id === returned.expressionId);
    const inner = model.statements.find((item) => item.kind === 'local-declaration');
    assert.equal(use.resolutionStatus, 'exact');
    assert.notEqual(use.useSymbolIds[0], inner.localSymbolId);
    assert.equal(use.useSymbolIds[0].includes(':parameter:x:'), true);
    assert.deepEqual(use.definitionIds, []);
});

test('single-statement if/else and nested-if writes remain in canonical StateBehavior effects', () => {
    const source = `package SingleIf; module mkTop(Empty); Reg#(Bit#(8)) r <- mkReg(0); Reg#(Bit#(8)) s <- mkReg(0); Reg#(Bit#(8)) t <- mkReg(0); rule go; Bool comparison = r <= s; if (comparison) r <= 1; else s <= 2; if (comparison) if (r == 0) t <= 3; endrule endmodule endpackage`;
    const model = buildSemanticSource(source, 'SingleIf.bsv', { entrypoints: ['mkTop'] });
    const behavior = model.stateBehaviors.find((item) => item.name === 'go');
    assert.deepEqual([...behavior.writes].sort(), ['r', 's', 't']);
    const assignments = model.statements.filter((item) => item.kind === 'state-assignment');
    assert.deepEqual(assignments.map((item) => item.targetSymbol.name).sort(), ['r', 's', 't']);
    for (const assignment of assignments) {
        const transition = behavior.transitions.find((item) =>
            item.state === assignment.targetSymbol.name && item.statementId === assignment.id
        );
        assert.ok(transition);
        assert.deepEqual(transition.pathConditionExpressionIds, assignment.pathConditionExpressionIds);
    }
    assert.equal(assignments.find((item) => item.targetSymbol.name === 't').pathConditionExpressionIds.length, 2);
    assert.equal(behavior.writes.includes('comparison'), false);
});

test('retains unsupported syntax as exact source without guessed dependencies', () => {
    const source = `package Unsupported; function Bit#(8) f(Bit#(8) x); matches tagged Valid .v = x; return v; endfunction endpackage`;
    const model = buildSemanticSource(source, 'Unsupported.bsv');
    const unsupported = model.statements.find((item) => item.kind === 'unsupported');
    assert.ok(unsupported);
    assert.equal(source.slice(unsupported.range.start, unsupported.range.end), unsupported.text);
    assert.equal(unsupported.resolutionStatus, 'unsupported');
});

test('does not promote unsupported expression structure through bindings or returns', () => {
    const source = `package UnsupportedFlow; function Bit#(8) f(Bit#(8) x); let y = tagged Valid x; return y; endfunction endpackage`;
    const model = buildSemanticSource(source, 'UnsupportedFlow.bsv');
    const declaration = model.statements.find((item) => item.kind === 'local-declaration');
    const returned = model.statements.find((item) => item.kind === 'return');
    assert.equal(declaration.resolutionStatus, 'unsupported');
    assert.equal(declaration.localSymbol.resolutionStatus, 'unsupported');
    assert.equal(model.expressions.find((item) => item.id === returned.expressionId).resolutionStatus, 'unsupported');
    assert.equal(returned.resolutionStatus, 'unsupported');
});

test('builds precedence-aware expression trees with exact source ranges', () => {
    // Given
    const source = `package ExprTrees;
function Bit#(8) probe();
  let e0 = a*b+c;
  let e1 = a-b-c;
  let e2 = a&&b||c;
  let e3 = (a+b)*c;
  let e4 = -a+b;
  let e5 = x[i+1];
  let e6 = obj.member;
  let e7 = f(a+b,c);
  return e0;
endfunction
endpackage
`;

    // When
    const model = buildSemanticSource(source, 'ExprTrees.bsv');
    const actual = model.statements
        .filter((item) => item.kind === 'local-declaration')
        .map((item) => ({
            name: item.localSymbol.name,
            expression: expressionTree(model, item.rightExpressionId)
        }));

    // Then
    assert.deepEqual(actual, [
        {
            name: 'e0',
            expression: {
                kind: 'operator', text: 'a*b+c', range: [56, 61], sourceRange: [2, 11, 2, 16], operator: '+',
                operands: [
                    {
                        kind: 'operator', text: 'a*b', range: [56, 59], sourceRange: [2, 11, 2, 14], operator: '*',
                        operands: [
                            { kind: 'identifier', text: 'a', range: [56, 57], sourceRange: [2, 11, 2, 12] },
                            { kind: 'identifier', text: 'b', range: [58, 59], sourceRange: [2, 13, 2, 14] }
                        ]
                    },
                    { kind: 'identifier', text: 'c', range: [60, 61], sourceRange: [2, 15, 2, 16] }
                ]
            }
        },
        {
            name: 'e1',
            expression: {
                kind: 'operator', text: 'a-b-c', range: [74, 79], sourceRange: [3, 11, 3, 16], operator: '-',
                operands: [
                    {
                        kind: 'operator', text: 'a-b', range: [74, 77], sourceRange: [3, 11, 3, 14], operator: '-',
                        operands: [
                            { kind: 'identifier', text: 'a', range: [74, 75], sourceRange: [3, 11, 3, 12] },
                            { kind: 'identifier', text: 'b', range: [76, 77], sourceRange: [3, 13, 3, 14] }
                        ]
                    },
                    { kind: 'identifier', text: 'c', range: [78, 79], sourceRange: [3, 15, 3, 16] }
                ]
            }
        },
        {
            name: 'e2',
            expression: {
                kind: 'operator', text: 'a&&b||c', range: [92, 99], sourceRange: [4, 11, 4, 18], operator: '||',
                operands: [
                    {
                        kind: 'operator', text: 'a&&b', range: [92, 96], sourceRange: [4, 11, 4, 15], operator: '&&',
                        operands: [
                            { kind: 'identifier', text: 'a', range: [92, 93], sourceRange: [4, 11, 4, 12] },
                            { kind: 'identifier', text: 'b', range: [95, 96], sourceRange: [4, 14, 4, 15] }
                        ]
                    },
                    { kind: 'identifier', text: 'c', range: [98, 99], sourceRange: [4, 17, 4, 18] }
                ]
            }
        },
        {
            name: 'e3',
            expression: {
                kind: 'operator', text: '(a+b)*c', range: [112, 119], sourceRange: [5, 11, 5, 18], operator: '*',
                operands: [
                    {
                        kind: 'group', text: '(a+b)', range: [112, 117], sourceRange: [5, 11, 5, 16],
                        operands: [{
                            kind: 'operator', text: 'a+b', range: [113, 116], sourceRange: [5, 12, 5, 15], operator: '+',
                            operands: [
                                { kind: 'identifier', text: 'a', range: [113, 114], sourceRange: [5, 12, 5, 13] },
                                { kind: 'identifier', text: 'b', range: [115, 116], sourceRange: [5, 14, 5, 15] }
                            ]
                        }]
                    },
                    { kind: 'identifier', text: 'c', range: [118, 119], sourceRange: [5, 17, 5, 18] }
                ]
            }
        },
        {
            name: 'e4',
            expression: {
                kind: 'operator', text: '-a+b', range: [132, 136], sourceRange: [6, 11, 6, 15], operator: '+',
                operands: [
                    {
                        kind: 'unary', text: '-a', range: [132, 134], sourceRange: [6, 11, 6, 13], operator: '-',
                        operands: [{ kind: 'identifier', text: 'a', range: [133, 134], sourceRange: [6, 12, 6, 13] }]
                    },
                    { kind: 'identifier', text: 'b', range: [135, 136], sourceRange: [6, 14, 6, 15] }
                ]
            }
        },
        {
            name: 'e5',
            expression: {
                kind: 'index', text: 'x[i+1]', range: [149, 155], sourceRange: [7, 11, 7, 17],
                operands: [
                    { kind: 'identifier', text: 'x', range: [149, 150], sourceRange: [7, 11, 7, 12] },
                    {
                        kind: 'operator', text: 'i+1', range: [151, 154], sourceRange: [7, 13, 7, 16], operator: '+',
                        operands: [
                            { kind: 'identifier', text: 'i', range: [151, 152], sourceRange: [7, 13, 7, 14] },
                            { kind: 'literal', text: '1', range: [153, 154], sourceRange: [7, 15, 7, 16] }
                        ]
                    }
                ]
            }
        },
        {
            name: 'e6',
            expression: { kind: 'member-reference', text: 'obj.member', range: [168, 178], sourceRange: [8, 11, 8, 21] }
        },
        {
            name: 'e7',
            expression: {
                kind: 'call', text: 'f(a+b,c)', range: [191, 199], sourceRange: [9, 11, 9, 19],
                arguments: [
                    {
                        kind: 'operator', text: 'a+b', range: [193, 196], sourceRange: [9, 13, 9, 16], operator: '+',
                        operands: [
                            { kind: 'identifier', text: 'a', range: [193, 194], sourceRange: [9, 13, 9, 14] },
                            { kind: 'identifier', text: 'b', range: [195, 196], sourceRange: [9, 15, 9, 16] }
                        ]
                    },
                    { kind: 'identifier', text: 'c', range: [197, 198], sourceRange: [9, 17, 9, 18] }
                ]
            }
        }
    ]);
});

test('classifies BSV Boolean constructors as exact literals and keeps XOR above XNOR precedence', () => {
    const source = `package BooleanOperators;
function Bool yes() = True;
function Bool no() = False;
function Bit#(8) combine(Bit#(8) a, Bit#(8) b, Bit#(8) c) = a ^~ b ^ c;
endpackage
`;
    const model = buildSemanticSource(source, 'BooleanOperators.bsv');
    for (const text of ['True', 'False']) {
        const literal = model.expressions.find((item) => item.text === text);
        assert.equal(literal.kind, 'literal');
        assert.equal(literal.resolutionStatus, 'exact');
    }
    const root = model.expressions.find((item) => item.text === 'a ^~ b ^ c');
    assert.equal(root.operator, '^~');
    assert.equal(model.expressions.find((item) => item.id === root.operandIds[1]).operator, '^');
});

test('parses exponentiation before multiplication and left associatively', () => {
    // Given
    const source = `package PowerOperators;
function Integer power() = 2 * 3 ** 4 ** 5;
endpackage
`;

    // When
    const model = buildSemanticSource(source, 'PowerOperators.bsv');
    const root = model.expressions.find((item) => item.text === '2 * 3 ** 4 ** 5');
    const exponent = model.expressions.find((item) => item.id === root.operandIds[1]);
    const nested = model.expressions.find((item) => item.id === exponent.operandIds[0]);

    // Then
    assert.equal(root.operator, '*');
    assert.equal(root.resolutionStatus, 'exact');
    assert.equal(exponent.operator, '**');
    assert.equal(nested.operator, '**');
});

test('models case labels and defaults without treating selector as a generic path condition', () => {
    // Given
    const source = `package CasePaths;
function Bit#(8) choose(Bit#(8) selector, Bool gate);
  if (gate) begin
    case (selector)
      0: return 1;
      default: return 2;
    endcase
  end
  return 3;
endfunction
endpackage
`;

    // When
    const model = buildSemanticSource(source, 'CasePaths.bsv');
    const caseStatement = model.statements.find((item) => item.kind === 'case');
    const bodies = model.statements
        .filter((item) => item.parentStatementId === caseStatement.id && item.kind === 'return')
        .map((item) => ({
            id: item.id,
            text: item.text,
            caseArmId: item.caseArmId,
            pathConditionExpressionIds: item.pathConditionExpressionIds
        }));

    // Then
    assert.equal(caseStatement.conditionExpressionId,
        'code:file:///CasePaths.bsv:function:choose:19:expression:101:109');
    assert.deepEqual(expressionTree(model, caseStatement.conditionExpressionId), {
        kind: 'identifier', text: 'selector', range: [101, 109], sourceRange: [3, 10, 3, 18]
    });
    assert.deepEqual(caseStatement.caseArms, [
        {
            id: 'code:file:///CasePaths.bsv:function:choose:19:case-arm:117',
            kind: 'case-arm',
            selectorExpressionId: 'code:file:///CasePaths.bsv:function:choose:19:expression:101:109',
            labelExpressionIds: ['code:file:///CasePaths.bsv:function:choose:19:expression:117:118'],
            bodyStatementIds: ['code:file:///CasePaths.bsv:function:choose:19:statement:120'],
            range: { start: 117, end: 129 },
            sourceRange: { uri: 'file:///CasePaths.bsv', line: 4, column: 6, endLine: 4, endColumn: 18 },
            text: '0: return 1;',
            resolutionStatus: 'exact'
        },
        {
            id: 'code:file:///CasePaths.bsv:function:choose:19:case-arm:136',
            kind: 'case-default',
            selectorExpressionId: 'code:file:///CasePaths.bsv:function:choose:19:expression:101:109',
            labelExpressionIds: [],
            bodyStatementIds: ['code:file:///CasePaths.bsv:function:choose:19:statement:145'],
            range: { start: 136, end: 154 },
            sourceRange: { uri: 'file:///CasePaths.bsv', line: 5, column: 6, endLine: 5, endColumn: 24 },
            text: 'default: return 2;',
            resolutionStatus: 'exact'
        }
    ]);
    assert.deepEqual(expressionTree(model, caseStatement.caseArms[0].labelExpressionIds[0]), {
        kind: 'literal', text: '0', range: [117, 118], sourceRange: [4, 6, 4, 7]
    });
    assert.deepEqual(bodies, [
        {
            id: 'code:file:///CasePaths.bsv:function:choose:19:statement:120',
            text: 'return 1;',
            caseArmId: 'code:file:///CasePaths.bsv:function:choose:19:case-arm:117',
            pathConditionExpressionIds: ['code:file:///CasePaths.bsv:function:choose:19:expression:79:83']
        },
        {
            id: 'code:file:///CasePaths.bsv:function:choose:19:statement:145',
            text: 'return 2;',
            caseArmId: 'code:file:///CasePaths.bsv:function:choose:19:case-arm:136',
            pathConditionExpressionIds: ['code:file:///CasePaths.bsv:function:choose:19:expression:79:83']
        }
    ]);
});

test('keeps nested case and if bodies attached to their case arms', () => {
    const source = `package NestedCase;
function Bit#(8) choose(Bit#(8) selector, Bit#(8) other, Bool gate);
  case (selector)
    0: if (gate) case (other)
         1: return 1;
         default: return 2;
       endcase
    default: return 3;
  endcase
endfunction
endpackage
`;
    const model = buildSemanticSource(source, 'NestedCase.bsv');
    const cases = model.statements.filter((item) => item.kind === 'case');
    assert.equal(cases.length, 2);
    assert.equal(model.statements.some((item) => item.kind === 'unsupported'), false);
    const outer = cases.find((item) => item.parentStatementId === null);
    const inner = cases.find((item) => item !== outer);
    const outerArm = outer.caseArms[0];
    const controlledIf = model.statements.find((item) => item.kind === 'if');
    assert.equal(controlledIf.caseArmId, outerArm.id);
    assert.equal(inner.caseArmId, outerArm.id);
    assert.deepEqual(inner.caseArms.map((arm) => arm.bodyStatementIds.length), [1, 1]);
    for (const arm of inner.caseArms) {
        const body = model.statements.find((item) => item.id === arm.bodyStatementIds[0]);
        assert.equal(body.caseArmId, arm.id);
        assert.deepEqual(body.caseArmIds, [outerArm.id, arm.id]);
    }
});

test('keeps case-arm boundaries around loop bodies', () => {
    const source = `package LoopCase;
module mkTop(Empty);
  Reg#(Bit#(8)) state <- mkReg(0);
  rule advance;
    case (state)
      0: begin
        for (Integer i = 0; i < 2; i = i + 1) begin
          state <= state + 1;
        end
        state <= 2;
      end
      default: state <= 3;
    endcase
  endrule
endmodule
endpackage
`;
    const model = buildSemanticSource(source, 'LoopCase.bsv', { entrypoints: ['mkTop'] });
    const statement = model.statements.find((item) => item.kind === 'case');
    assert.deepEqual(statement.caseArms.map((arm) => ({
        kind: arm.kind,
        text: arm.text.trim(),
        bodyKinds: arm.bodyStatementIds.map((id) => model.statements.find((item) => item.id === id).kind)
    })), [
        {
            kind: 'case-arm',
            text: `0: begin
        for (Integer i = 0; i < 2; i = i + 1) begin
          state <= state + 1;
        end
        state <= 2;
      end`,
            bodyKinds: ['for', 'state-assignment']
        },
        { kind: 'case-default', text: 'default: state <= 3;', bodyKinds: ['state-assignment'] }
    ]);
    assert.equal(model.statements.filter((item) => item.kind === 'state-assignment').length, 3);
});
