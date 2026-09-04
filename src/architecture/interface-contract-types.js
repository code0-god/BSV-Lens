'use strict';

const { normalizeWhitespace } = require('./source-utils');

const CONCRETE_TYPE_IDENTIFIERS = new Set([
    'Action',
    'ActionValue',
    'Bit',
    'Bool',
    'Int',
    'Maybe',
    'Tuple2',
    'Tuple3',
    'Tuple4',
    'UInt',
    'Vector'
]);

function compareContractTypes(expected, actual) {
    const expectedType = normalizeWhitespace(expected);
    const actualType = normalizeWhitespace(actual);
    if (expectedType === actualType) {
        return { status: 'exact', expected: expectedType, actual: actualType };
    }
    return {
        status: uncertainType(expectedType) || uncertainType(actualType)
            ? 'unresolved'
            : 'mismatch',
        expected: expectedType,
        actual: actualType
    };
}

function uncertainType(type) {
    if (!type || type === 'inferred' || type.includes('?')) return true;
    if (/^[a-z_$]/.test(type) || /^[A-Z]$/.test(type)) return true;
    const hash = type.indexOf('#');
    if (hash < 0) return false;
    const identifiers = type.slice(hash + 1).match(/\b[A-Za-z_$][\w$]*\b/g) || [];
    return identifiers.some((identifier) => !CONCRETE_TYPE_IDENTIFIERS.has(identifier));
}

module.exports = {
    compareContractTypes
};
