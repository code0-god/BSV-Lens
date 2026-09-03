'use strict';

const { splitTopLevel } = require('./source-utils');

const SIMPLE_WIDTH_TYPES = new Set(['Bit', 'UInt', 'Int']);
const TUPLE_ARITIES = new Map([
    ['Tuple2', 2],
    ['Tuple3', 3],
    ['Tuple4', 4]
]);

function analyzeTypeWidth(typeExpression, typeDefinitions = []) {
    const expression = normalizeExpression(typeExpression);
    const definitions = indexTypeDefinitions(typeDefinitions);
    return resolveType(expression, definitions, new Set(), expression);
}

function resolveType(expression, definitions, resolving, origin) {
    if (!expression) return unresolved('empty type expression');

    const unwrapped = unwrapParentheses(expression);
    if (unwrapped === null) return unresolved(`unbalanced type expression ${expression}`);
    if (unwrapped !== expression) return resolveType(unwrapped, definitions, resolving, origin);

    if (expression === 'Bool') return exact(1, origin);

    const application = parseTypeApplication(expression);
    if (application) {
        if (SIMPLE_WIDTH_TYPES.has(application.name)) {
            if (application.arguments.length !== 1) {
                return unresolved(`${application.name} requires one numeric width`);
            }
            const width = parseNumericLiteral(application.arguments[0]);
            if (width === null) return unresolvedNumeric(application.arguments[0]);
            return exact(width, origin);
        }

        if (application.name === 'Maybe') {
            if (application.arguments.length !== 1) return unresolved('Maybe requires one payload type');
            const payload = resolveType(application.arguments[0], definitions, resolving, application.arguments[0]);
            if (payload.status !== 'exact') return unresolved(`Maybe payload: ${payload.reason}`);
            return exactSum([1, payload.bits], origin);
        }

        if (TUPLE_ARITIES.has(application.name)) {
            const arity = TUPLE_ARITIES.get(application.name);
            if (application.arguments.length !== arity) {
                return unresolved(`${application.name} requires ${arity} element types`);
            }
            const widths = [];
            for (const argument of application.arguments) {
                const element = resolveType(argument, definitions, resolving, argument);
                if (element.status !== 'exact') {
                    return unresolved(`${application.name} element: ${element.reason}`);
                }
                widths.push(element.bits);
            }
            return exactSum(widths, origin);
        }

        if (isTypeLevelExpression(application.name)) {
            return unresolved(`unsupported type-level expression ${application.name}`);
        }
        return unresolved(`unsupported type expression ${expression}`);
    }

    if (expression.includes('::')) return unresolved(`external type ${expression}`);
    if (!/^[A-Za-z_$][\w$]*$/.test(expression)) {
        return unresolved(`unsupported type expression ${expression}`);
    }

    const definition = definitions.get(expression);
    if (!definition) return unresolved(`unknown type ${expression}`);
    if (definition.ambiguous) return unresolved(`ambiguous type ${expression}`);
    if (resolving.has(expression)) return unresolved(`typedef cycle involving ${expression}`);

    resolving.add(expression);
    const result = resolveDefinition(definition, definitions, resolving, origin);
    resolving.delete(expression);
    return result;
}

function resolveDefinition(definition, definitions, resolving, origin) {
    if (definition.kind === 'alias') {
        const target = definition.details?.target ?? definition.target;
        if (typeof target !== 'string' || !target.trim()) return unresolved(`typedef ${definition.name} has no direct target`);
        if (hasTypeParameters(definition)) return unresolved(`parameterized typedef ${definition.name}`);
        return resolveType(normalizeExpression(target), definitions, resolving, origin);
    }

    if (definition.kind === 'struct') {
        if (hasTypeParameters(definition)) return unresolved(`parameterized struct ${definition.name}`);
        const fields = definition.details?.fields ?? definition.fields;
        if (!Array.isArray(fields)) return unresolved(`struct ${definition.name} has no fields`);
        const widths = [];
        for (const field of fields) {
            if (!field || typeof field.type !== 'string') {
                return unresolved(`struct ${definition.name} has an unsupported field`);
            }
            const fieldWidth = resolveType(normalizeExpression(field.type), definitions, resolving, field.type);
            if (fieldWidth.status !== 'exact') {
                return unresolved(`struct ${definition.name} field ${field.name || '?'}: ${fieldWidth.reason}`);
            }
            widths.push(fieldWidth.bits);
        }
        return exactSum(widths, origin);
    }

    if (definition.kind === 'enum') {
        if (hasTypeParameters(definition)) return unresolved(`parameterized enum ${definition.name}`);
        const variants = definition.details?.variants ?? definition.variants;
        if (!Array.isArray(variants) || variants.length === 0) {
            return unresolved(`enum ${definition.name} has no variants`);
        }
        let maximumValue = -1;
        for (const variant of definition.details?.variantValues || definition.variantValues || []) {
            if (variant?.value === null || variant?.value === undefined) continue;
            const value = String(variant.value).trim();
            if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value))) {
                return unresolved(`enum ${definition.name} has nonliteral encoding ${value}`);
            }
            maximumValue = Math.max(maximumValue, Number(value));
        }
        const countBits = Math.max(1, Math.ceil(Math.log2(variants.length)));
        const valueBits = maximumValue < 0 ? 1 : Math.max(1, Math.ceil(Math.log2(maximumValue + 1)));
        return exact(Math.max(countBits, valueBits), origin);
    }

    return unresolved(`unsupported typedef kind ${definition.kind || 'unknown'} for ${definition.name}`);
}

function indexTypeDefinitions(input) {
    let values;
    if (input instanceof Map) {
        values = [...input.entries()].map(([name, value]) => normalizeDefinition(name, value));
    } else if (Array.isArray(input)) {
        values = input.flatMap((value) => Array.isArray(value?.types) ? value.types : [value]);
    } else if (Array.isArray(input?.types)) {
        values = input.types;
    } else if (input && typeof input === 'object') {
        values = Object.entries(input).map(([name, value]) => normalizeDefinition(name, value));
    } else values = [];

    const definitions = new Map();
    for (const value of values) {
        if (!value || typeof value.name !== 'string' || !value.name) continue;
        if (definitions.has(value.name)) definitions.set(value.name, { name: value.name, ambiguous: true });
        else definitions.set(value.name, value);
    }
    return definitions;
}

function normalizeDefinition(name, value) {
    if (typeof value === 'string') return { kind: 'alias', name, details: { target: value } };
    return value && typeof value === 'object' ? { name, ...value } : null;
}

function parseTypeApplication(expression) {
    const match = /^([A-Za-z_$][\w$]*)\s*#\s*\(/.exec(expression);
    if (!match) return null;
    const opening = expression.indexOf('(', match[1].length);
    const closing = matchingParenthesis(expression, opening);
    if (closing !== expression.length - 1) return null;
    const content = expression.slice(opening + 1, closing);
    const argumentsList = splitTopLevel(content, ',').map(normalizeExpression);
    if (argumentsList.some((argument) => !argument)) return null;
    return { name: match[1], arguments: argumentsList };
}

function parseNumericLiteral(expression) {
    const value = unwrapParentheses(normalizeExpression(expression));
    if (value === null || !/^\d+$/.test(value)) return null;
    const number = Number(value);
    return Number.isSafeInteger(number) ? number : null;
}

function unwrapParentheses(expression) {
    let value = normalizeExpression(expression);
    while (value.startsWith('(')) {
        const closing = matchingParenthesis(value, 0);
        if (closing < 0) return null;
        if (closing !== value.length - 1) break;
        value = normalizeExpression(value.slice(1, -1));
    }
    return delimitersBalanced(value) ? value : null;
}

function matchingParenthesis(expression, opening) {
    let depth = 0;
    for (let index = opening; index < expression.length; index += 1) {
        if (expression[index] === '(') depth += 1;
        else if (expression[index] === ')') {
            depth -= 1;
            if (depth === 0) return index;
            if (depth < 0) return -1;
        }
    }
    return -1;
}

function delimitersBalanced(expression) {
    const stack = [];
    const pairs = { ')': '(', ']': '[', '}': '{' };
    for (const character of expression) {
        if ('([{'.includes(character)) stack.push(character);
        else if (')]}'.includes(character) && stack.pop() !== pairs[character]) return false;
    }
    return stack.length === 0;
}

function hasTypeParameters(definition) {
    const escapedName = String(definition.name || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`\\b${escapedName}\\s*#\\s*\\(`).test(definition.signature || '')
        || (Array.isArray(definition.parameters) && definition.parameters.length > 0)
        || (Array.isArray(definition.typeParameters) && definition.typeParameters.length > 0);
}

function isTypeLevelExpression(name) {
    return /^(?:TAdd|TSub|TMul|TDiv|TLog|TExp|TMax|TMin)$/i.test(name);
}

function normalizeExpression(value) {
    return typeof value === 'string' ? value.trim() : '';
}

function unresolvedNumeric(expression) {
    const value = unwrapParentheses(normalizeExpression(expression));
    if (value !== null && /^[A-Za-z_$][\w$]*$/.test(value)) {
        return unresolved(`numeric type parameter ${value}`);
    }
    const application = value === null ? null : parseTypeApplication(value);
    if (application && isTypeLevelExpression(application.name)) {
        return unresolved(`unsupported type-level expression ${application.name}`);
    }
    return unresolved(`unsupported numeric expression ${normalizeExpression(expression) || '(empty)'}`);
}

function exactSum(widths, origin) {
    let bits = 0;
    for (const width of widths) {
        bits += width;
        if (!Number.isSafeInteger(bits)) return unresolved('resolved width exceeds safe integer range');
    }
    return exact(bits, origin);
}

function exact(bits, origin) {
    return { bits, status: 'exact', origin };
}

function unresolved(reason) {
    return { bits: null, status: 'unresolved', reason };
}

module.exports = {
    analyzeTypeWidth
};
