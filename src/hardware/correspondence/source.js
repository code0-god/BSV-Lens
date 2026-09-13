'use strict';

const { parseBsvFile } = require('../../architecture/parser');
const { buildSemanticModel } = require('../../architecture/semantic/model');
const { buildSourceReferenceIndex } = require('../../architecture/semantic/source-references');
const { createLineStarts, offsetToPosition, maskCommentsAndStrings } = require('../../architecture/source-utils');
const { analyzeCode } = require('../../architecture/code-analysis');
const { hash, failure } = require('../json');
const { serialize, deserialize } = require('node:v8');
const { performance } = require('node:perf_hooks');
const { selectSourceEntry } = require('./source-entry');

function createSourceParseCache(previous = []) {
    const old = new Map(previous.map(entry => [entry.pathRef, entry]));
    const entries = [], metrics = { parsedSourceFiles: 0, reusedSourceFiles: 0, sourceParseMs: 0, sourceCacheDecodeMs: 0,
        sourceCacheFiles: 0, sourceCacheBytes: 0, sourceCacheDroppedFiles: 0 };
    return {
        parse(document) {
            // Registry reads still establish authority; cache keys only avoid repeated parsing.
            if (hash(document.text) !== document.contentHash) throw failure('ARTIFACT_HASH_MISMATCH', 'Parser source bytes mismatch');
            const existing = old.get(document.pathRef), start = performance.now();
            let parsed, bytes;
            if (existing?.contentHash === document.contentHash) {
                bytes = existing.bytes;
                parsed = deserialize(bytes);
                metrics.reusedSourceFiles++;
                metrics.sourceCacheDecodeMs += performance.now() - start;
            } else {
                parsed = parseBsvFile(document.text, { uri: document.pathRef, relativePath: document.pathRef });
                metrics.parsedSourceFiles++;
                metrics.sourceParseMs += performance.now() - start;
            }
            // Serialize before Semantic projection can annotate parser records; hits deserialize a fresh copy.
            bytes ||= serialize(parsed);
            if (entries.length < 256 && metrics.sourceCacheBytes + bytes.byteLength <= 32 * 1024 * 1024) {
                entries.push({ pathRef: document.pathRef, contentHash: document.contentHash, bytes });
                metrics.sourceCacheFiles++;
                metrics.sourceCacheBytes += bytes.byteLength;
            } else metrics.sourceCacheDroppedFiles++;
            return parsed;
        },
        finish() { return { entries, metrics }; }
    };
}

function coordinates(text) {
    const offsets = {utf16:[0],utf8:[0],codepoint:[0]};
    let u = 0, b = 0, c = 0;
    for (const scalar of text) {
        const point = scalar.codePointAt(0);
        if (point >= 0xd800 && point <= 0xdfff) throw failure('INVALID_RANGE','Unpaired Unicode surrogate');
        u += scalar.length; b += Buffer.byteLength(scalar); c++;
        offsets.utf16.push(u); offsets.utf8.push(b); offsets.codepoint.push(c);
    }
    return offsets;
}
let lastRangeDocument = null;
function rangeDocument(text) {
    if (lastRangeDocument?.text === text) return lastRangeDocument;
    const value = { text, tables: coordinates(text), starts: createLineStarts(text) };
    // ponytail: one small document index; larger files work without retaining their coordinate arrays.
    lastRangeDocument = text.length <= 256 * 1024 ? value : null;
    return value;
}
function normalizeRange(text, range) {
    if (typeof text !== 'string' || !range || range.endInclusive !== undefined || range.convention !== undefined) throw failure('INVALID_RANGE','Half-open range required');
    const allowed=range.unit==='position'?['unit','encoding','base','start','end']:['unit','start','end'];
    if(Object.keys(range).some(k=>!allowed.includes(k)))throw failure('UNSUPPORTED','Unknown range convention field');
    if(Buffer.byteLength(text)>16777216)throw failure('LIMIT_EXCEEDED','Source range document byte limit');
    const { tables, starts } = rangeDocument(text);
    const scalarIndex = (unit, offset, table = tables) => {
        if (!['utf16','utf8','codepoint'].includes(unit)) throw failure('UNSUPPORTED','Unknown coordinate encoding');
        if (!Number.isSafeInteger(offset) || offset < 0) throw failure('INVALID_RANGE','Invalid offset');
        const index = table[unit].indexOf(offset);
        if (index < 0) throw failure('INVALID_RANGE','Offset outside text or inside Unicode scalar');
        return index;
    };
    let start, end;
    if (range.unit === 'position') {
        if (![0,1].includes(range.base)) throw failure('UNSUPPORTED','Explicit coordinate base required');
        const offset = p => {
            if (!p || !Number.isSafeInteger(p.line) || !Number.isSafeInteger(p.column)) throw failure('INVALID_RANGE','Invalid position');
            const line = p.line - range.base, column = p.column - range.base;
            if (line < 0 || line >= starts.length) throw failure('INVALID_RANGE','Line outside document');
            let last = line + 1 < starts.length ? starts[line+1] - 1 : text.length;
            if (last > starts[line] && text[last-1] === '\r') last--;
            const local = coordinates(text.slice(starts[line],last));
            return scalarIndex('utf16', starts[line] + local.utf16[scalarIndex(range.encoding,column,local)]);
        };
        start = offset(range.start); end = offset(range.end);
    } else {
        start = scalarIndex(range.unit,range.start); end = scalarIndex(range.unit,range.end);
    }
    if (end < start) throw failure('INVALID_RANGE','Reversed range');
    const slice = text.slice(tables.utf16[start],tables.utf16[end]);
    return {unit:'utf16',start:tables.utf16[start],end:tables.utf16[end],
        utf8:{start:tables.utf8[start],end:tables.utf8[end]},codepoint:{start,end},text:slice,sliceHash:hash(slice)};
}
function sourceRange(document, range) {
    if (!range || range.uri !== document.pathRef) throw failure('INVALID_RANGE','Foreign source range');
    return normalizeRange(document.text,{unit:'position',encoding:'utf16',base:0,
        start:{line:range.line,column:range.column},end:{line:range.endLine,column:range.endColumn}});
}
function parseSourceDocuments(documents, parseCache) {
    return documents.map(d=>parseCache ? parseCache.parse(d) : parseBsvFile(d.text,{uri:d.pathRef,relativePath:d.pathRef}));
}
function buildSource(documents, top, parseCache, sourceEntry) {
    // ponytail: rebuild the contextual graph per revision; reuse file parsing until graph rebuild is the measured bottleneck.
    let parsed = parseSourceDocuments(documents,parseCache), sourceScope;
    if (sourceEntry) ({ parsed, documents, top, sourceScope } = selectSourceEntry(documents,parsed,sourceEntry));
    const semantic = buildSemanticModel(parsed,top ? {entrypoints:[top]} : {});
    const allIds = new Map();
    for (const definition of semantic.definitions) {
        const previous = allIds.get(definition.id);
        if (previous) {
            const at = item => `${item.uri}:${(item.sourceRange?.line ?? item.location?.line ?? 0) + 1}`;
            throw failure('AMBIGUOUS_SOURCE', `Duplicate source declaration ${JSON.stringify(definition.name)}: ${at(previous)}; ${at(definition)}`);
        }
        allIds.set(definition.id, definition);
    }
    const references = buildSourceReferenceIndex(semantic).references;
    const supplements = [];
    // Reuse the existing bounded analyzer for the module-return gap in Source IR.
    for (const definition of semantic.definitions.filter(d=>d.kind==='module-definition')) {
        const document = documents.find(d=>d.pathRef===definition.uri);
        const excluded = [...definition.childInstanceDeclarations,...definition.methods,...definition.rules,
            ...definition.localFunctions,...definition.providedInterfaces].map(x=>x.range).filter(Boolean).sort((a,b)=>a.start-b.start);
        let cursor = definition.range.bodyStart;
        const spans = [];
        for (const r of excluded) { if (cursor<r.start) spans.push([cursor,r.start]); cursor=Math.max(cursor,r.end); }
        if (cursor<definition.range.bodyEnd) spans.push([cursor,definition.range.bodyEnd]);
        const starts=createLineStarts(document.text);
        for (const [bodyStart,bodyEnd] of spans) {
            const code=analyzeCode({source:document.text,masked:maskCommentsAndStrings(document.text),uri:document.pathRef,
                revision:document.contentHash,callableId:`${definition.id}:module-body`,bodyStart,bodyEnd,
                makeLocation:(a,b)=>{const s=offsetToPosition(starts,a),e=offsetToPosition(starts,b);return {uri:document.pathRef,line:s.line,column:s.column,endLine:e.line,endColumn:e.column};}});
            for (const statement of code.statements.filter(s=>s.kind==='return')) {
                const expression=code.expressions.find(e=>e.id===statement.expressionId);
                if (expression?.kind==='identifier') supplements.push({...statement,expression,ownerDefinitionId:definition.id,
                    provider:'source-parser-v1',scope:'explicit-interface-return'});
            }
        }
    }
    return {semantic,references,supplements,documents,sourceScope};
}
module.exports = {normalizeRange,sourceRange,buildSource,createSourceParseCache,parseSourceDocuments};
