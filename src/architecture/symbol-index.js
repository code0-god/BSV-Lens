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

function findSmallestNodeAtPosition(nodes, uri, line, column) {
    const candidates = (nodes || []).filter((node) => {
        const range = node.sourceRange || node.location;
        return range?.uri === uri && positionInRange(line, column, range);
    });
    candidates.sort((left, right) => {
        const leftRange = left.sourceRange || left.location;
        const rightRange = right.sourceRange || right.location;
        return rangeWeight(leftRange) - rangeWeight(rightRange)
            || (KIND_PRIORITY.get(left.kind) ?? 9) - (KIND_PRIORITY.get(right.kind) ?? 9)
            || String(left.id).localeCompare(String(right.id));
    });
    return candidates[0] || null;
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
    positionInRange
};
