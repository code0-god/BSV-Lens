'use strict';

const {
    createLineStarts,
    maskCommentsAndStrings,
    offsetToPosition
} = require('./source-utils');

const SOURCE_ATTRIBUTE_KINDS = new Map([
    ['descending_urgency', 'descending-urgency'],
    ['execution_order', 'execution-order'],
    ['mutually_exclusive', 'mutually-exclusive'],
    ['conflict_free', 'conflict-free'],
    ['preempts', 'preempts']
]);

function parseSourceScheduling(text, options = {}) {
    const source = String(text || '');
    const uri = options.uri || options.relativePath || 'untitled.bsv';
    const masked = maskCommentsAndStrings(source);
    const lineStarts = createLineStarts(source);
    const relations = [];
    const annotationPattern = /\(\*/g;
    let annotation;

    while ((annotation = annotationPattern.exec(masked)) !== null) {
        const attributeEnd = masked.indexOf('*)', annotationPattern.lastIndex);
        if (attributeEnd < 0) break;
        const annotationMask = masked.slice(annotationPattern.lastIndex, attributeEnd);
        const attributePattern = /(descending_urgency|execution_order|mutually_exclusive|conflict_free|preempts)\s*=/g;
        let match;

        while ((match = attributePattern.exec(annotationMask)) !== null) {
            const valueStart = annotationPattern.lastIndex + attributePattern.lastIndex;
            const quote = source.indexOf('"', valueStart);
            if (quote < 0 || quote >= attributeEnd || masked.slice(valueStart, quote).trim()) continue;
            const valueEnd = findStringEnd(source, quote);
            if (valueEnd < 0 || valueEnd >= attributeEnd) continue;

            const names = source.slice(quote + 1, valueEnd)
                .split(',')
                .map(normalizeRuleName)
                .filter(Boolean);
            const kind = SOURCE_ATTRIBUTE_KINDS.get(match[1]);
            const evidence = source.slice(annotation.index, attributeEnd + 2);
            const location = makeLocation(uri, lineStarts, annotation.index, attributeEnd + 2);

            if (kind === 'mutually-exclusive' || kind === 'conflict-free') {
                addAllPairs(relations, names, kind, true, evidence, location);
            } else if (kind === 'preempts') {
                for (let index = 1; index < names.length; index += 1) {
                    relations.push(makeSourceRelation(names[0], names[index], kind, false, evidence, location));
                }
            } else {
                addAllPairs(relations, names, kind, false, evidence, location);
            }
        }
        annotationPattern.lastIndex = attributeEnd + 2;
    }

    return relations;
}

function addAllPairs(relations, names, kind, bidirectional, evidence, location) {
    for (let left = 0; left < names.length; left += 1) {
        for (let right = left + 1; right < names.length; right += 1) {
            relations.push(makeSourceRelation(
                names[left], names[right], kind, bidirectional, evidence, location
            ));
        }
    }
}

function makeSourceRelation(from, to, kind, bidirectional, evidence, location) {
    return {
        from,
        to,
        kind,
        origin: 'source-attribute',
        confidence: 'explicit',
        bidirectional,
        evidence,
        location
    };
}

function findStringEnd(text, quote) {
    let escaped = false;
    for (let index = quote + 1; index < text.length; index += 1) {
        if (text[index] === '"' && !escaped) return index;
        if (text[index] === '\\' && !escaped) escaped = true;
        else escaped = false;
    }
    return -1;
}

function normalizeRuleName(value) {
    return String(value || '')
        .trim()
        .replace(/^['"]|['"]$/g, '')
        .trim();
}

function makeLocation(uri, lineStarts, startOffset, endOffset) {
    const start = offsetToPosition(lineStarts, startOffset);
    const end = offsetToPosition(lineStarts, endOffset);
    return {
        uri,
        line: start.line,
        column: start.column,
        endLine: end.line,
        endColumn: end.column
    };
}

class SourceScheduleProvider {
    isAvailable(context = {}) {
        return sourceEntries(context).length > 0;
    }

    async analyze(context = {}, token) {
        if (isCancelled(token)) return unavailableResult('source', 'Scheduling analysis was cancelled.');
        const entries = sourceEntries(context);
        if (entries.length === 0) return unavailableResult('source', 'No BSV source text is available.');

        const relations = [];
        for (const entry of entries) {
            if (isCancelled(token)) return unavailableResult('source', 'Scheduling analysis was cancelled.');
            relations.push(...parseSourceScheduling(entry.text, {
                uri: entry.uri,
                relativePath: entry.relativePath
            }));
        }
        return { provider: 'source', available: true, relations, diagnostics: [] };
    }
}

function sourceEntries(context) {
    const candidates = context.sourceFiles || context.sources || context.files || context.documents;
    if (Array.isArray(candidates)) return candidates.map(normalizeSourceEntry).filter(Boolean);
    if (typeof context.text === 'string' || typeof context.sourceText === 'string') {
        return [normalizeSourceEntry(context)].filter(Boolean);
    }
    return [];
}

function normalizeSourceEntry(entry, index = 0) {
    if (typeof entry === 'string') return { text: entry, uri: `source-${index}.bsv` };
    if (!entry || typeof entry !== 'object') return null;
    const text = entry.text ?? entry.sourceText ?? entry.content;
    if (typeof text !== 'string') return null;
    const uri = uriString(entry.uri) || entry.relativePath || entry.path || `source-${index}.bsv`;
    return { text, uri, relativePath: entry.relativePath || entry.path };
}

function uriString(uri) {
    if (!uri) return '';
    return typeof uri === 'string' ? uri : uri.toString();
}

function isCancelled(token) {
    return token?.isCancellationRequested === true || token?.aborted === true;
}

function unavailableResult(provider, reason) {
    return { provider, available: false, relations: [], diagnostics: [], reason };
}

module.exports = {
    SourceScheduleProvider,
    parseScheduleAttributes: parseSourceScheduling,
    parseSchedulingAttributes: parseSourceScheduling,
    parseSourceScheduleAttributes: parseSourceScheduling,
    parseSourceScheduling
};
