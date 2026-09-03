'use strict';

const { parseBsvFile } = require('./parser');

const SOURCE_ATTRIBUTE_KINDS = new Map([
    ['descending_urgency', { kind: 'descending-urgency', relation: 'ordered' }],
    ['execution_order', { kind: 'execution-order', relation: 'ordered' }],
    ['mutually_exclusive', { kind: 'mutually-exclusive', relation: 'unordered' }],
    ['conflict_free', { kind: 'conflict-free', relation: 'unordered' }],
    ['preempts', { kind: 'preempts', relation: 'preempts' }]
]);

function normalizeScheduleAttributes(parsedFiles = []) {
    const relations = [];
    const seen = new Set();
    for (const file of parsedFiles) {
        const scopes = [
            { moduleName: null, attributes: file.bsvAttributes || [] },
            ...(file.modules || []).map((module) => ({
                moduleName: module.name,
                attributes: moduleAttributes(module)
            }))
        ];
        for (const scope of scopes) {
            const attributes = scope.attributes;
            for (const attribute of attributes) {
                const descriptor = SOURCE_ATTRIBUTE_KINDS.get(String(attribute.name || '').toLowerCase());
                if (!descriptor || attribute.names.length < 2) continue;
                for (const [from, to] of relationPairs(attribute.names, descriptor.relation)) {
                    const relation = {
                        from,
                        to,
                        source: from,
                        target: to,
                        kind: descriptor.kind,
                        bidirectional: descriptor.relation === 'unordered',
                        origin: 'source-attribute',
                        confidence: 'explicit',
                        evidence: `(* ${attribute.name} = ${attribute.rawValue} *)`,
                        location: attribute.location,
                        sourceLocation: attribute.location,
                        packageName: file.packageName,
                        moduleName: attribute.moduleName
                            || (attribute.ownerKind === 'module' ? attribute.ownerName : scope.moduleName),
                        ownerKind: attribute.ownerKind || (scope.moduleName ? 'module' : 'file'),
                        ownerName: attribute.ownerName || scope.moduleName || file.packageName
                    };
                    const key = [
                        relation.packageName,
                        relation.moduleName,
                        relation.from,
                        relation.to,
                        relation.kind,
                        relation.location?.line,
                        relation.location?.column
                    ].join('|');
                    if (!seen.has(key)) {
                        seen.add(key);
                        relations.push(relation);
                    }
                }
            }
        }
    }
    return relations;
}

function parseSourceScheduling(text, options = {}) {
    const uri = options.uri || options.relativePath || 'untitled.bsv';
    return normalizeScheduleAttributes([parseBsvFile(String(text || ''), {
        uri,
        relativePath: options.relativePath || uri
    })]);
}

function relationPairs(names, relation) {
    if (relation === 'preempts') {
        return names.slice(1).map((name) => [names[0], name]);
    }
    const pairs = [];
    for (let left = 0; left < names.length; left += 1) {
        const firstRight = relation === 'ordered' ? left + 1 : left + 1;
        for (let right = firstRight; right < names.length; right += 1) {
            pairs.push([names[left], names[right]]);
        }
    }
    return pairs;
}

class SourceScheduleProvider {
    isAvailable(context = {}) {
        if (Array.isArray(context.parsedFiles)) {
            return context.parsedFiles.some((file) =>
                (file.bsvAttributes || []).length > 0
                || (file.modules || []).some((module) => moduleAttributes(module).length > 0)
            );
        }
        return sourceEntries(context).length > 0;
    }

    async analyze(context = {}, token) {
        if (isCancelled(token)) return unavailableResult('source', 'Scheduling analysis was cancelled.');
        const parsedFiles = Array.isArray(context.parsedFiles)
            ? context.parsedFiles
            : sourceEntries(context).map((entry) => parseBsvFile(entry.text, {
                uri: entry.uri,
                relativePath: entry.relativePath
            }));
        if (parsedFiles.length === 0) return unavailableResult('source', 'No BSV source text is available.');
        return {
            provider: 'source',
            available: true,
            relations: normalizeScheduleAttributes(parsedFiles),
            diagnostics: []
        };
    }
}

function moduleAttributes(module) {
    return [
        ...(module.bsvAttributes || []),
        ...(module.rules || []).flatMap((rule) => rule.bsvAttributes || []),
        ...(module.methods || []).flatMap((method) => method.bsvAttributes || [])
    ];
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
    normalizeScheduleAttributes,
    parseScheduleAttributes: parseSourceScheduling,
    parseSchedulingAttributes: parseSourceScheduling,
    parseSourceScheduleAttributes: parseSourceScheduling,
    parseSourceScheduling
};
