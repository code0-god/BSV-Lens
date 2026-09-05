'use strict';

const { findMatchingDelimiter, normalizeWhitespace } = require('./source-utils');

const ASSERTIONS = new Set(['dynamicAssert', 'staticAssert']);
const BUILTINS = new Set([
    'dynamicAssert', 'staticAssert', 'fromInteger', 'fromMaybe', 'isValid', 'pack',
    'truncate', 'unpack', 'valueOf', 'zeroExtend'
]);

function analyzeCode(options) {
    const { source, masked, uri, revision, callableId,
        bodyStart, bodyEnd, parameters = [], stateNames = [], predicate = null,
        inlineReturn = false, makeLocation } = options;
    const result = { statements: [], expressions: [], callSites: [], bindingEnvironments: [] };
    const root = environment(result, callableId, null, null, 'exact');
    const scope = new Map();
    for (const parameter of parameters) {
        const symbol = { id: symbolId(callableId, 'parameter', parameter.name, bodyStart),
            name: parameter.name, kind: 'parameter', type: parameter.type || null,
            originExpressionIds: [], resolutionStatus: 'exact' };
        scope.set(parameter.name, symbol);
        root.bindings[parameter.name] = { ...symbol };
    }
    const context = { source, masked, uri, revision, callableId, makeLocation, result,
        states: new Set(stateNames), paths: [], environment: root, scope };
    if (predicate && predicate.start < predicate.end) {
        result.predicateExpressionId = expression(context, predicate.start, predicate.end, null, null).id;
    }
    if (inlineReturn) parseInlineReturn(context, bodyStart, bodyEnd);
    else parseSequence(context, bodyStart, bodyEnd, null, new Set());
    return result;
}

function parseSequence(context, start, end, parentStatementId, terminators) {
    let cursor = skipSpace(context.masked, start, end);
    while (cursor < end) {
        const word = wordAt(context.masked, cursor);
        if (word && terminators.has(word.value)) return cursor;
        if (word?.value === 'begin') {
            cursor = parseLexicalBlock(context, word.end, end, parentStatementId);
        } else if (word?.value === 'if') cursor = parseIf(context, cursor, end, parentStatementId);
        else if (word?.value === 'case') cursor = parseCase(context, cursor, end, parentStatementId);
        else cursor = parseSimple(context, cursor, end, parentStatementId);
        cursor = skipSpace(context.masked, cursor, end);
    }
    return cursor;
}

function parseInlineReturn(context, start, end) {
    const range = trimRange(context.source, start, end);
    if (range.start >= range.end) return;
    const value = expression(context, range.start, range.end, null, null);
    const id = entityId(context.callableId, 'statement', range.start);
    value.parentStatementId = id;
    for (const call of context.result.callSites) {
        if (!call.parentStatementId && call.range.start >= range.start && call.range.end <= range.end) {
            call.parentStatementId = id;
        }
    }
    context.result.statements.push(makeStatement(
        context, id, 'return', range.start, range.end, null,
        { expressionId: value.id, inline: true, resolutionStatus: value.resolutionStatus }
    ));
}

function parseLexicalBlock(context, start, end, parentStatementId) {
    const before = cloneScope(context.scope);
    const child = { ...context, scope: cloneScope(before), environment: environment(
        context.result, context.callableId, context.environment.id, parentStatementId, 'exact'
    ) };
    initializeEnvironment(child.environment, child.scope);
    let cursor = parseSequence(child, start, end, parentStatementId, new Set(['end']));
    for (const [name, outer] of before) {
        const inner = child.scope.get(name);
        if (inner?.id === outer.id) context.scope.set(name, { ...inner });
    }
    advanceEnvironment(context, parentStatementId);
    const close = wordAt(context.masked, skipSpace(context.masked, cursor, end));
    return close?.value === 'end' ? close.end : cursor;
}

function parseIf(context, start, end, parentStatementId) {
    const open = skipSpace(context.masked, start + 2, end);
    if (context.masked[open] !== '(') return parseSimple(context, start, end, parentStatementId);
    const close = findMatchingDelimiter(context.masked, open, '(', ')');
    if (close < 0 || close >= end) return parseSimple(context, start, end, parentStatementId);
    const id = entityId(context.callableId, 'statement', start);
    const condition = expression(context, open + 1, close, id, null);
    const statement = makeStatement(context, id, 'if', start, close + 1, parentStatementId, {
        conditionExpressionId: condition.id
    });
    context.result.statements.push(statement);
    const before = cloneScope(context.scope);
    const thenContext = branchContext(context, condition.id, cloneScope(before), id);
    let cursor = parseControlledBody(thenContext, close + 1, end, id);
    const thenScope = thenContext.scope;
    cursor = skipSpace(context.masked, cursor, end);
    let elseScope = cloneScope(before);
    const elseWord = wordAt(context.masked, cursor);
    if (elseWord?.value === 'else') {
        const elseContext = branchContext(context, `!${condition.id}`, elseScope, id);
        cursor = parseControlledBody(elseContext, elseWord.end, end, id);
        elseScope = elseContext.scope;
    }
    context.scope = mergeScopes(before, thenScope, elseScope);
    advanceEnvironment(context, id);
    statement.range.end = cursor;
    statement.text = context.source.slice(start, cursor);
    statement.sourceRange = context.makeLocation(start, cursor);
    return cursor;
}

function parseControlledBody(context, start, end, parentId) {
    let cursor = skipSpace(context.masked, start, end);
    const begin = wordAt(context.masked, cursor);
    if (begin?.value === 'begin') return parseLexicalBlock(context, begin.end, end, parentId);
    const word = wordAt(context.masked, cursor);
    if (word?.value === 'if') return parseIf(context, cursor, end, parentId);
    return parseSimple(context, cursor, end, parentId);
}

function parseCase(context, start, end, parentStatementId) {
    const open = skipSpace(context.masked, start + 4, end);
    const close = context.masked[open] === '(' ? findMatchingDelimiter(context.masked, open, '(', ')') : -1;
    if (close < 0) return parseSimple(context, start, end, parentStatementId);
    const id = entityId(context.callableId, 'statement', start);
    const condition = expression(context, open + 1, close, id, null);
    const statement = makeStatement(context, id, 'case', start, close + 1, parentStatementId,
        { conditionExpressionId: condition.id });
    context.result.statements.push(statement);
    let cursor = close + 1;
    const branches = [];
    while (cursor < end) {
        cursor = skipSpace(context.masked, cursor, end);
        const endWord = wordAt(context.masked, cursor);
        if (endWord?.value === 'endcase') { cursor = endWord.end; break; }
        const colon = findTopLevel(context.masked, cursor, end, ':');
        if (colon < 0) break;
        const labelStart = cursor;
        const branch = branchContext(context, condition.id, cloneScope(context.scope), id);
        cursor = parseControlledBody(branch, colon + 1, end, id);
        branches.push(branch.scope);
        if (cursor <= colon + 1) { cursor = colon + 1; break; }
        // Labels are evidence, not dependency expressions.
        void labelStart;
    }
    if (branches.length) context.scope = mergeManyScopes(context.scope, branches);
    advanceEnvironment(context, id);
    statement.range.end = cursor;
    statement.text = context.source.slice(start, cursor);
    statement.sourceRange = context.makeLocation(start, cursor);
    return cursor;
}

function parseSimple(context, start, end, parentStatementId) {
    const semicolon = statementEnd(context.masked, start, end);
    const finish = semicolon >= 0 ? semicolon + 1 : end;
    const trimmed = trimRange(context.source, start, finish);
    if (trimmed.start >= trimmed.end) return finish;
    const rawMasked = context.masked.slice(trimmed.start, trimmed.end);
    const bodyEnd = rawMasked.endsWith(';') ? trimmed.end - 1 : trimmed.end;
    const code = context.masked.slice(trimmed.start, bodyEnd).trim();
    const codeOffset = trimmed.start + context.masked.slice(trimmed.start, bodyEnd).indexOf(code);
    let kind = 'unsupported';
    let details = {};
    let match;
    if ((match = /^return\b([\s\S]*)$/.exec(code))) {
        kind = 'return';
        const exprRange = trimRange(context.source, codeOffset + 'return'.length, bodyEnd);
        if (exprRange.start < exprRange.end) details.expressionId = expression(context, exprRange.start, exprRange.end, null, null).id;
    } else if ((match = /^(?:let|([A-Za-z_$][\w$]*(?:\s*#\s*\([^;]*\))?))\s+([A-Za-z_$][\w$]*)\s*<-\s*([\s\S]+)$/.exec(code))) {
        kind = 'result-binding';
        details = declaration(context, match[2], match[1] || 'inferred', codeOffset + match.index,
            codeOffset + code.lastIndexOf(match[3]), match[3], kind);
    } else if ((match = /^(?:let|([A-Za-z_$][\w$]*(?:\s*#\s*\([^;]*\))?))\s+([A-Za-z_$][\w$]*)\s*=\s*([\s\S]+)$/.exec(code))) {
        kind = 'local-declaration';
        details = declaration(context, match[2], match[1] || 'inferred', codeOffset + match.index,
            codeOffset + code.lastIndexOf(match[3]), match[3], kind);
    } else if ((match = /^([A-Za-z_$][\w$]*)\s*<=\s*([\s\S]+)$/.exec(code)) && context.states.has(match[1])) {
        kind = 'state-assignment';
        const rhsStart = codeOffset + code.lastIndexOf(match[2]);
        const rhs = expression(context, rhsStart, rhsStart + match[2].length, null, null);
        details = { targetSymbol: { name: match[1], kind: 'state' }, rightExpressionId: rhs.id,
            stateEffect: { state: match[1], effect: 'write', expressionId: rhs.id } };
    } else if ((match = /^([A-Za-z_$][\w$]*)\s*=\s*([\s\S]+)$/.exec(code))) {
        kind = 'local-assignment';
        const rhsStart = codeOffset + code.lastIndexOf(match[2]);
        const rhs = expression(context, rhsStart, rhsStart + match[2].length, null, null);
        const binding = context.scope.get(match[1]);
        if (binding) {
            binding.originExpressionIds = [rhs.id]; binding.resolutionStatus = 'exact';
            advanceEnvironment(context, entityId(context.callableId, 'statement', trimmed.start));
            details = { targetSymbol: { ...binding }, targetSymbolId: binding.id, rightExpressionId: rhs.id };
        } else details = { targetSymbol: { name: match[1], resolutionStatus: 'unresolved' }, rightExpressionId: rhs.id };
    } else {
        const expr = expression(context, codeOffset, codeOffset + code.length, null, null);
        kind = expr.callSiteId && ASSERTIONS.has(context.result.callSites.find((call) => call.id === expr.callSiteId)?.calleeName)
            ? 'assertion' : expr.callSiteId ? 'call' : 'unsupported';
        details = { expressionId: expr.id };
    }
    const id = entityId(context.callableId, 'statement', trimmed.start);
    const statement = makeStatement(context, id, kind, trimmed.start, trimmed.end, parentStatementId, details);
    for (const expressionItem of context.result.expressions) {
        if (!expressionItem.parentStatementId && expressionItem.range.start >= trimmed.start && expressionItem.range.end <= trimmed.end) {
            expressionItem.parentStatementId = id;
        }
    }
    for (const call of context.result.callSites) if (!call.parentStatementId && call.range.start >= trimmed.start && call.range.end <= trimmed.end) call.parentStatementId = id;
    context.result.statements.push(statement);
    return finish;
}

function declaration(context, name, type, declarationStart, rhsStart, rhsText, kind) {
    const rhs = expression(context, rhsStart, rhsStart + rhsText.length, null, null);
    const symbol = { id: symbolId(context.callableId, kind, name, declarationStart), name,
        kind: kind === 'result-binding' ? 'result' : 'local', type,
        originExpressionIds: [rhs.id], resolutionStatus: 'exact' };
    context.scope.set(name, symbol);
    advanceEnvironment(context, entityId(context.callableId, 'statement', declarationStart));
    return kind === 'result-binding'
        ? { resultSymbol: symbol, resultSymbolId: symbol.id, rightExpressionId: rhs.id }
        : { localSymbol: symbol, localSymbolId: symbol.id, rightExpressionId: rhs.id };
}

function expression(context, start, end, parentStatementId, parentExpressionId) {
    const range = trimRange(context.source, start, end);
    const text = context.source.slice(range.start, range.end);
    const id = `${entityId(context.callableId, 'expression', range.start)}:${range.end}`;
    const base = { id, kind: 'unsupported', enclosingCallableId: context.callableId,
        parentStatementId, parentExpressionId, sourceDocumentId: context.uri,
        sourceRevision: context.revision, sourceRange: context.makeLocation(range.start, range.end),
        range, text, type: null, operator: null, operandIds: [], argumentIds: [],
        definitionIds: [], useSymbolIds: [], callSiteId: null, resolutionStatus: 'unsupported',
        bindingEnvironmentId: context.environment.id };
    if (!text) { context.result.expressions.push(base); return base; }
    const call = fullCall(text);
    if (call) {
        base.kind = 'call';
        const builtin = !call.name.includes('.') && BUILTINS.has(call.name);
        base.resolutionStatus = call.specialization ? 'unresolved' : builtin ? 'exact' : 'pending';
        const openAbsolute = range.start + call.open;
        const parts = splitRanges(context.source, openAbsolute + 1, range.end - 1, ',');
        base.argumentIds = parts.filter((part) => context.source.slice(part.start, part.end).trim())
            .map((part) => expression(context, part.start, part.end, parentStatementId, id).id);
        const callSiteId = `${entityId(context.callableId, 'callsite', range.start)}:${range.end}`;
        base.callSiteId = callSiteId;
        context.result.callSites.push({ id: callSiteId, enclosingCallableId: context.callableId,
            parentStatementId, expressionId: id, calleeName: call.name, calleeDefinitionId: null,
            candidateDefinitionIds: [], argumentExpressionIds: [...base.argumentIds], actualToFormal: [],
            bindingEnvironmentId: context.environment.id, sourceDocumentId: context.uri,
            sourceRevision: context.revision, sourceRange: base.sourceRange, range: { ...range }, text,
            specialization: call.specialization, builtin, resolutionStatus: base.resolutionStatus });
    } else {
        const operator = topLevelOperator(text);
        if (operator) {
            base.kind = 'operator'; base.operator = operator.value;
            const operands = [
                expression(context, range.start, range.start + operator.index, parentStatementId, id),
                expression(context, range.start + operator.index + operator.value.length, range.end, parentStatementId, id)
            ];
            base.operandIds = operands.map((item) => item.id);
            base.resolutionStatus = operands.every((item) => item.resolutionStatus === 'exact')
                ? 'exact' : 'unresolved';
        } else if (/^[A-Za-z_$][\w$]*(?:\s*\.\s*[A-Za-z_$][\w$]*)+$/.test(text)) {
            base.kind = 'member-reference';
            const root = /^[A-Za-z_$][\w$]*/.exec(text)[0];
            const binding = context.scope.get(root);
            if (binding) {
                base.useSymbolIds = [binding.id];
                base.definitionIds = [...(binding.originExpressionIds || [])];
                base.resolutionStatus = binding.resolutionStatus || 'exact';
            } else if (context.states.has(root)) base.resolutionStatus = 'exact';
            else base.resolutionStatus = 'unresolved';
        } else if (/^[A-Za-z_$][\w$]*$/.test(text)) {
            base.kind = 'identifier';
            const binding = context.scope.get(text);
            if (binding) {
                base.useSymbolIds = [binding.id];
                base.definitionIds = [...(binding.originExpressionIds || [])];
                base.resolutionStatus = binding.resolutionStatus || 'exact';
            } else if (context.states.has(text)) {
                base.kind = 'state-reference'; base.resolutionStatus = 'exact';
            } else base.resolutionStatus = 'unresolved';
        } else if (/^(?:\d+|'[^']*'|"[\s\S]*"|True|False)$/.test(text)) {
            base.kind = 'literal'; base.resolutionStatus = 'exact';
        }
    }
    context.result.expressions.push(base);
    return base;
}

function fullCall(text) {
    const match = /^([A-Za-z_$][\w$]*(?:\s*\.\s*[A-Za-z_$][\w$]*)*)(\s*#\s*\([^)]*\))?\s*\(/.exec(text);
    if (!match) return null;
    const open = match[0].lastIndexOf('(');
    const close = findMatchingDelimiter(text, open, '(', ')');
    if (close !== text.length - 1) return null;
    return { name: normalizeWhitespace(match[1]).replace(/\s*\.\s*/g, '.'), open,
        specialization: match[2] ? normalizeWhitespace(match[2]) : null };
}

function topLevelOperator(text) {
    const operators = ['||', '&&', '==', '!=', '<=', '>=', '<', '>', '+', '-', '*', '/', '%'];
    let parens = 0, brackets = 0;
    for (let index = 0; index < text.length; index += 1) {
        if (text[index] === '(') parens += 1;
        else if (text[index] === ')') parens -= 1;
        else if (text[index] === '[') brackets += 1;
        else if (text[index] === ']') brackets -= 1;
        if (parens || brackets) continue;
        const value = operators.find((item) => text.startsWith(item, index));
        if (value) return { index, value };
    }
    return null;
}

function makeStatement(context, id, kind, start, end, parentStatementId, details) {
    return { id, kind, enclosingCallableId: context.callableId, parentStatementId,
        parentBlockId: parentStatementId, conditionExpressionId: null,
        pathConditionExpressionIds: [...context.paths], sourceDocumentId: context.uri,
        sourceRevision: context.revision, sourceRange: context.makeLocation(start, end),
        range: { start, end }, text: context.source.slice(start, end), resolutionStatus:
            kind === 'unsupported' ? 'unsupported' : 'exact', ...details };
}
function environment(result, callableId, parentEnvironmentId, parentStatementId, status) {
    const env = { id: `${callableId}:environment:${result.bindingEnvironments.length}`,
        enclosingCallableId: callableId, parentEnvironmentId, parentStatementId,
        bindings: {}, resolutionStatus: status };
    result.bindingEnvironments.push(env); return env;
}
function initializeEnvironment(target, scope) {
    target.bindings = Object.fromEntries([...scope].map(([name, value]) =>
        [name, { ...value, originExpressionIds: [...(value.originExpressionIds || [])] }]
    ));
    target.resolutionStatus = [...scope.values()].some((item) =>
        item.resolutionStatus !== 'exact'
    ) ? 'unresolved' : 'exact';
}
function advanceEnvironment(context, parentStatementId) {
    const next = environment(context.result, context.callableId, context.environment.id,
        parentStatementId, 'exact');
    initializeEnvironment(next, context.scope);
    context.environment = next;
    return next;
}
function branchContext(context, path, scope, parentStatementId) {
    const env = environment(context.result, context.callableId, context.environment.id, parentStatementId, 'exact');
    initializeEnvironment(env, scope);
    return { ...context, paths: [...context.paths, path], scope, environment: env };
}
function cloneScope(scope) { return new Map([...scope].map(([key, value]) => [key, { ...value, originExpressionIds: [...(value.originExpressionIds || [])] }])); }
function mergeScopes(before, left, right) {
    const result = cloneScope(before);
    for (const [name, original] of before) {
        const a = left.get(name), b = right.get(name);
        if (!a || !b || a.id !== original.id || b.id !== original.id
            || a.resolutionStatus !== 'exact' || b.resolutionStatus !== 'exact'
            || a.originExpressionIds.join() !== b.originExpressionIds.join()) {
            result.set(name, { ...original, originExpressionIds: [], resolutionStatus: 'unresolved' });
        } else result.set(name, { ...a });
    }
    return result;
}
function mergeManyScopes(before, branches) { return branches.reduce((merged, branch) => mergeScopes(before, merged, branch), cloneScope(before)); }
function statementEnd(text, start, end) {
    let p = 0, b = 0, c = 0;
    for (let i = start; i < end; i += 1) {
        if (text[i] === '(') p++; else if (text[i] === ')') p--;
        else if (text[i] === '[') b++; else if (text[i] === ']') b--;
        else if (text[i] === '{') c++; else if (text[i] === '}') c--;
        else if (text[i] === ';' && p === 0 && b === 0 && c === 0) return i;
    }
    return -1;
}
function findTopLevel(text, start, end, target) { let p = 0; for (let i = start; i < end; i++) { if (text[i] === '(') p++; else if (text[i] === ')') p--; else if (!p && text[i] === target) return i; } return -1; }
function splitRanges(text, start, end, delimiter) { const values = []; let cursor = start, p = 0, b = 0; for (let i = start; i < end; i++) { if (text[i] === '(') p++; else if (text[i] === ')') p--; else if (text[i] === '[') b++; else if (text[i] === ']') b--; else if (text[i] === delimiter && !p && !b) { values.push({ start: cursor, end: i }); cursor = i + 1; } } values.push({ start: cursor, end }); return values; }
function trimRange(text, start, end) { while (start < end && /\s/.test(text[start])) start++; while (end > start && /\s/.test(text[end - 1])) end--; return { start, end }; }
function skipSpace(text, cursor, end) { while (cursor < end && /\s/.test(text[cursor])) cursor++; return cursor; }
function wordAt(text, start) { const match = /^[A-Za-z_$][\w$]*/.exec(text.slice(start)); return match ? { value: match[0], start, end: start + match[0].length } : null; }
function entityId(callableId, kind, offset) { return `${callableId}:${kind}:${offset}`; }
function symbolId(callableId, kind, name, offset) { return `${callableId}:symbol:${kind}:${name}:${offset}`; }

module.exports = { analyzeCode };
