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

test('builds source-linked bounded statement IR and does not classify comparison <= as a write', () => {
    const model = buildSemanticSource(SOURCE, 'CodeStatements.bsv', { entrypoints: ['mkTop'] });
    assert.equal(model.codeAnalysisVersion, 1);
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
