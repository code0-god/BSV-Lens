'use strict';

const {
    findMatchingDelimiter,
    normalizeWhitespace,
    splitStatements,
    splitTopLevel
} = require('./source-utils');

const PRIMITIVE_OPERATIONS = Object.freeze({
    register: Object.freeze({
        read: ['_read', 'read', 'value'],
        write: ['_write', 'write']
    }),
    fifo: Object.freeze({
        read: ['deq', 'first', 'notEmpty', 'notFull', 'peek'],
        write: ['enq', 'clear']
    }),
    wire: Object.freeze({
        read: ['_read', 'read', 'wget'],
        write: ['_write', 'write', 'wset', 'send']
    }),
    memory: Object.freeze({
        read: ['read', 'response', 'get'],
        write: ['write', 'request', 'put']
    })
});

const OPERATION_NAMES = Object.freeze({
    deq: 'dequeue',
    enq: 'enqueue',
    first: 'first',
    clear: 'clear',
    notEmpty: 'status-read',
    notFull: 'status-read',
    peek: 'peek',
    request: 'memory-request',
    response: 'memory-response',
    get: 'memory-response',
    put: 'memory-request',
    read: 'read',
    write: 'write',
    _read: 'read',
    _write: 'write',
    wget: 'read',
    wset: 'write',
    send: 'write',
    value: 'read'
});

function analyzeBehavior(options) {
    const {
        text,
        masked,
        baseOffset = 0,
        instances = [],
        callable = '',
        makeLocation
    } = options;
    const instanceByName = new Map(instances.map((instance) => [instance.name, instance]));
    const accesses = [];
    const seen = new Set();

    for (const statement of splitStatements(masked, baseOffset)) {
        const relativeStart = statement.start - baseOffset;
        const original = text.slice(relativeStart, relativeStart + statement.text.length);
        for (const instance of instanceByName.values()) {
            collectAssignments(instance, statement, original, callable, makeLocation, accesses, seen);
            collectMemberAccesses(instance, statement, original, callable, makeLocation, accesses, seen);
            if (instance.primitiveKind === 'register') {
                collectRegisterReads(instance, statement, original, callable, makeLocation, accesses, seen);
            }
        }
    }

    return {
        accesses,
        reads: uniqueNames(accesses.filter((item) => item.kind === 'read').map((item) => item.instance)),
        writes: uniqueNames(accesses.filter((item) => item.kind === 'write').map((item) => item.instance)),
        invocations: uniqueNames(accesses
            .filter((item) => ['invoke', 'return', 'access'].includes(item.kind))
            .map((item) => `${item.instance}.${item.member || ''}`.replace(/\.$/, '')))
    };
}

function collectAssignments(instance, statement, original, callable, makeLocation, accesses, seen) {
    const expression = new RegExp(`\\b${escapeRegExp(instance.name)}\\s*<=`, 'g');
    let match;
    while ((match = expression.exec(statement.text)) !== null) {
        addAccess({
            instance,
            member: null,
            kind: 'write',
            operation: instance.primitiveKind === 'register' ? 'register-write' : 'state-write',
            dataFlow: 'write',
            stateEffect: 'write',
            statement,
            original,
            matchIndex: match.index,
            callable,
            makeLocation
        }, accesses, seen);
    }
}

function collectMemberAccesses(instance, statement, original, callable, makeLocation, accesses, seen) {
    const expression = new RegExp(`\\b${escapeRegExp(instance.name)}((?:\\s*\\.\\s*[A-Za-z_$][\\w$]*)+)`, 'g');
    let match;
    while ((match = expression.exec(statement.text)) !== null) {
        const members = [...match[1].matchAll(/[A-Za-z_$][\w$]*/g)].map((entry) => entry[0]);
        if (members.length === 0) continue;
        const resultBinding = resultBindingBefore(statement.text, match.index);
        const valueBinding = valueBindingBefore(statement.text, match.index);
        const classification = classifyMemberOperation(instance.primitiveKind, members);
        const kind = resultBinding ? 'return' : classification.kind;
        const operation = resultBinding ? 'action-value-result' : classification.operation;
        addAccess({
            instance,
            member: members.at(-1),
            memberPath: members.join('.'),
            kind,
            operation,
            dataFlow: resultBinding ? 'return' : classification.dataFlow,
            stateEffect: classification.stateEffect,
            resultBinding,
            valueBinding,
            arguments: invocationArguments(statement.text, original, expression.lastIndex),
            statement,
            original,
            matchIndex: match.index,
            callable,
            makeLocation
        }, accesses, seen);
    }
}

function collectRegisterReads(instance, statement, original, callable, makeLocation, accesses, seen) {
    const expression = new RegExp(`\\b${escapeRegExp(instance.name)}\\b`, 'g');
    let match;
    while ((match = expression.exec(statement.text)) !== null) {
        const after = statement.text.slice(expression.lastIndex);
        if (/^\s*\./.test(after) || /^\s*<=/.test(after)) continue;
        addAccess({
            instance,
            member: null,
            kind: 'read',
            operation: 'register-read',
            dataFlow: 'read',
            stateEffect: 'read',
            statement,
            original,
            matchIndex: match.index,
            callable,
            makeLocation
        }, accesses, seen);
    }
}

function classifyMemberOperation(primitiveKind, members) {
    const operations = PRIMITIVE_OPERATIONS[primitiveKind];
    if (!operations) {
        return { kind: 'access', operation: 'unclassified-access', dataFlow: null, stateEffect: null };
    }
    const matched = [...members].reverse().find((member) =>
        operations.read.includes(member) || operations.write.includes(member)
    );
    if (!matched) return { kind: 'access', operation: 'unclassified-access', dataFlow: null, stateEffect: null };
    const kind = operations.write.includes(matched) ? 'write' : 'read';
    const operation = OPERATION_NAMES[matched] || `${primitiveKind}-${matched}`;
    if (primitiveKind === 'fifo') {
        if (matched === 'deq' || matched === 'clear') {
            return { kind, operation, dataFlow: null, stateEffect: operation };
        }
        if (['first', 'notEmpty', 'notFull', 'peek'].includes(matched)) {
            return { kind, operation, dataFlow: 'read', stateEffect: 'observe' };
        }
        if (matched === 'enq') return { kind, operation, dataFlow: 'write', stateEffect: 'enqueue' };
    }
    return { kind, operation, dataFlow: kind, stateEffect: kind };
}

function resultBindingBefore(statement, accessOffset) {
    const before = statement.slice(0, accessOffset);
    const match = /(?:\blet\s+|\b[A-Za-z_$][\w$#(),\s]*\s+)?([A-Za-z_$][\w$]*)\s*<-\s*$/.exec(before);
    return match ? match[1] : null;
}

function valueBindingBefore(statement, accessOffset) {
    const before = statement.slice(0, accessOffset);
    const match = /(?:\blet\s+|\b[A-Za-z_$][\w$]*(?:\s*#\s*\([^;]*\))?\s+)([A-Za-z_$][\w$]*)\s*=\s*$/.exec(before);
    return match ? match[1] : null;
}

function invocationArguments(masked, original, memberEnd) {
    let open = memberEnd;
    while (/\s/.test(masked[open] || '')) open += 1;
    if (masked[open] !== '(') return [];
    const close = findMatchingDelimiter(masked, open, '(', ')');
    if (close < 0) return [];
    return splitTopLevel(original.slice(open + 1, close), ',')
        .map(normalizeWhitespace)
        .filter(Boolean);
}

function addAccess(data, accesses, seen) {
    const absolute = data.statement.start + data.matchIndex;
    const snippet = normalizeWhitespace(data.original);
    const key = [
        data.instance.name,
        data.memberPath || data.member || '',
        data.kind,
        data.operation,
        data.resultBinding || '',
        data.valueBinding || '',
        absolute
    ].join('|');
    if (seen.has(key)) return;
    seen.add(key);
    const location = typeof data.makeLocation === 'function'
        ? data.makeLocation(absolute, absolute + data.instance.name.length)
        : null;
    accesses.push({
        instance: data.instance.name,
        primitiveKind: data.instance.primitiveKind || null,
        member: data.member || null,
        memberPath: data.memberPath || data.member || null,
        kind: data.kind,
        operation: data.operation,
        dataFlow: data.dataFlow ?? null,
        stateEffect: data.stateEffect ?? null,
        resultBinding: data.resultBinding || null,
        valueBinding: data.valueBinding || null,
        arguments: data.arguments || [],
        analysisOrigin: 'Source-derived',
        confidence: data.operation === 'unclassified-access' ? 'unknown' : 'explicit',
        sourceEvidence: snippet,
        location,
        evidence: {
            callable: data.callable,
            referencedInstance: data.instance.name,
            invokedMember: data.member || null,
            statementLine: Number.isInteger(location?.line) ? location.line + 1 : null,
            classification: data.operation,
            snippet
        }
    });
}

function uniqueNames(values) {
    return [...new Set(values)];
}

function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

module.exports = {
    PRIMITIVE_OPERATIONS,
    analyzeBehavior,
    classifyMemberOperation
};
