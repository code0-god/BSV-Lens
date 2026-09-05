'use strict';

const KIND_PRIORITY = new Map([
    ['method', 0],
    ['rule', 0],
    ['function', 0],
    ['register', 1],
    ['fifo', 1],
    ['wire', 1],
    ['memory', 1],
    ['instance', 2],
    ['module', 3],
    ['interface', 4],
    ['package', 5]
]);

function findSmallestNodesAtPosition(nodes, uri, line, column) {
    const candidates = (nodes || []).filter((node) => {
        const range = node.sourceRange || node.location;
        return range?.uri === uri && positionInRange(line, column, range);
    });
    if (candidates.length === 0) return [];
    const weight = (node) => {
        const range = node.sourceRange || node.location;
        return [rangeWeight(range), KIND_PRIORITY.get(node.kind) ?? 9];
    };
    const minimum = candidates.reduce((best, node) => {
        const current = weight(node);
        return current[0] < best[0] || current[0] === best[0] && current[1] < best[1]
            ? current : best;
    }, [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY]);
    return candidates.filter((node) => {
        const current = weight(node);
        return current[0] === minimum[0] && current[1] === minimum[1];
    }).sort((left, right) => String(left.id).localeCompare(String(right.id)));
}

function findSmallestNodeAtPosition(nodes, uri, line, column) {
    const candidates = findSmallestNodesAtPosition(nodes, uri, line, column);
    return candidates.length === 1 ? candidates[0] : null;
}

function positionInRange(line, column, range) {
    if (!range || !Number.isInteger(line) || !Number.isInteger(column)) return false;
    const afterStart = line > range.line || line === range.line && column >= (range.column || 0);
    const endLine = Number.isInteger(range.endLine) ? range.endLine : range.line;
    const endColumn = Number.isInteger(range.endColumn) ? range.endColumn : (range.column || 0) + 1;
    const beforeEnd = line < endLine || line === endLine && column <= endColumn;
    return afterStart && beforeEnd;
}

function rangeWeight(range) {
    const lines = Math.max(0, (range.endLine ?? range.line) - range.line);
    const columns = lines === 0
        ? Math.max(0, (range.endColumn ?? range.column) - range.column)
        : Math.max(0, range.endColumn || 0);
    return lines * 1000000 + columns;
}

module.exports = {
    findSmallestNodeAtPosition,
    findSmallestNodesAtPosition,
    positionInRange,
    ...require('./semantic/source-references')
};
