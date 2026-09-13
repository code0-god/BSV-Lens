'use strict';

// Independent evidence checker, NOT a BSV parser or a G5 query implementation.
// Expected spans come from bounded original-byte anchors supplied by the test.
// Canonical Source/Semantic records may supply IDs, never expected normalized ranges.
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { TextDecoder } = require('node:util');
const MAX_BYTES = 1024 * 1024;
const MAX_REFERENCES = 8192;
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
function check(ok, code, detail) {
    if (!ok) throw Object.assign(new Error(detail || code), { code });
}
function equal(actual, expected, code) {
    try { assert.deepStrictEqual(actual, expected); }
    catch (cause) { throw Object.assign(new Error(code, { cause }), { code }); }
}
function document(pathRef, bytes, revision = sha256(bytes)) {
    check(Buffer.isBuffer(bytes) && bytes.length <= MAX_BYTES, 'SOURCE_BYTE_BOUND');
    check(typeof pathRef === 'string' && pathRef.length > 0, 'SOURCE_PATH');
    check(sha256(bytes) === revision, 'SOURCE_REVISION');
    let text;
    try { text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); }
    catch (cause) { throw Object.assign(new Error('SOURCE_ENCODING', { cause }), { code: 'SOURCE_ENCODING' }); }
    equal(Buffer.from(text), bytes, 'SOURCE_ENCODING');
    return { pathRef, bytes: Buffer.from(bytes), text, revision };
}
function boundary(doc, offset) {
    check(Number.isSafeInteger(offset) && offset >= 0 && offset <= doc.text.length, 'SOURCE_RANGE');
    const previous = doc.text.charCodeAt(offset - 1), next = doc.text.charCodeAt(offset);
    check(!(previous >= 0xd800 && previous <= 0xdbff && next >= 0xdc00 && next <= 0xdfff), 'SPLIT_SCALAR');
    return Buffer.byteLength(doc.text.slice(0, offset), 'utf8');
}
function slice(doc, range) {
    check(range && range.end >= range.start, 'SOURCE_RANGE');
    const start = boundary(doc, range.start), end = boundary(doc, range.end);
    const bytes = doc.bytes.subarray(start, end), text = bytes.toString('utf8');
    equal(text, doc.text.slice(range.start, range.end), 'SOURCE_BYTES');
    return { text, sliceHash: sha256(bytes), utf8: { start, end }, codepoint: {
        start: Array.from(doc.text.slice(0, range.start)).length,
        end: Array.from(doc.text.slice(0, range.end)).length
    } };
}
function locate(doc, needle, within = { start: 0, end: doc.text.length }) {
    slice(doc, within);
    check(typeof needle === 'string' && needle.length > 0, 'REFERENCE_ANCHOR');
    // Literal fixture anchors only. No tokenization, syntax inference or production IR ranges.
    const haystack = doc.bytes.subarray(boundary(doc, within.start), boundary(doc, within.end));
    const bytes = Buffer.from(needle), offset = haystack.indexOf(bytes);
    check(offset >= 0 && haystack.indexOf(bytes, offset + 1) < 0, 'REFERENCE_ANCHOR');
    const start = within.start + haystack.subarray(0, offset).toString('utf8').length;
    const range = { start, end: start + needle.length };
    equal(slice(doc, range).text, needle, 'REFERENCE_ANCHOR');
    return range;
}
function section(doc, opening, closing) {
    const start = locate(doc, opening).start;
    const end = doc.text.indexOf(closing, start + opening.length);
    check(end >= 0, 'REFERENCE_ANCHOR');
    return { start, end: end + closing.length };
}
function assertSourceReference(ref, doc, expected = {}) {
    check(ref && typeof ref === 'object', 'SOURCE_REFERENCE');
    equal(ref.pathRef, doc.pathRef, 'SOURCE_PATH');
    equal(ref.revision, doc.revision, 'SOURCE_REVISION');
    equal(ref.contentHash, sha256(doc.bytes), 'SOURCE_HASH');
    if (ref.range?.unit !== undefined) equal(ref.range.unit, 'utf16', 'SOURCE_UNIT');
    const proof = slice(doc, ref.range);
    check(typeof ref.text === 'string' || typeof ref.range.text === 'string', 'SOURCE_TEXT');
    check(typeof ref.sliceHash === 'string' || typeof ref.range.sliceHash === 'string', 'SOURCE_SLICE_HASH');
    for (const object of [ref, ref.range]) {
        if (object.text !== undefined) equal(object.text, proof.text, 'SOURCE_TEXT');
        if (object.sliceHash !== undefined) equal(object.sliceHash, proof.sliceHash, 'SOURCE_SLICE_HASH');
    }
    for (const key of ['utf8', 'codepoint']) if (ref.range[key] !== undefined) equal(ref.range[key], proof[key], 'SOURCE_COORDINATES');
    if (expected.range) equal({ start: ref.range.start, end: ref.range.end }, expected.range, 'SOURCE_EXPECTED_POSITION');
    for (const key of ['semanticId', 'ownerInstanceId', 'occurrenceId', 'occurrencePath', 'sourceKind', 'definitionId']) {
        if (Object.hasOwn(expected, key)) equal(ref[key], expected[key], key.includes('owner') || key.startsWith('occurrence') ? 'SOURCE_OWNER' : 'SOURCE_CONTEXT');
    }
    return { pathRef: ref.pathRef, revision: ref.revision, semanticId: ref.semanticId,
        range: { start: ref.range.start, end: ref.range.end }, ...proof };
}
function assertSourceReferences(refs, documents, expected) {
    check(Array.isArray(refs) && refs.length <= MAX_REFERENCES, 'SOURCE_REFERENCE_BOUND');
    check(Array.isArray(expected) && expected.length <= MAX_REFERENCES, 'SOURCE_REFERENCE_BOUND');
    for (const ref of refs) {
        const doc = documents.find(d => d.pathRef === ref.pathRef);
        check(doc, 'SOURCE_PATH');
        assertSourceReference(ref, doc);
    }
    for (const want of expected) {
        const matches = refs.filter(ref => ref.semanticId === want.semanticId && ref.pathRef === want.pathRef &&
            ['ownerInstanceId', 'occurrenceId'].every(key => !Object.hasOwn(want, key) || ref[key] === want[key]));
        check(matches.length === 1, 'SOURCE_EXPECTED_REFERENCE');
        assertSourceReference(matches[0], documents.find(d => d.pathRef === want.pathRef), want);
    }
    return refs.length;
}
function assertCodeRecord(record, doc, expectedRange) {
    equal(record.sourceRevision, doc.revision, 'SOURCE_REVISION');
    equal({ ...record.range }, expectedRange, 'SOURCE_EXPECTED_POSITION');
    const proof = slice(doc, expectedRange);
    equal(record.text, proof.text, 'SOURCE_TEXT');
    const position = offset => {
        const prefix = doc.text.slice(0, offset), line = prefix.split('\n').length - 1;
        return { line, column: offset - (prefix.lastIndexOf('\n') + 1) };
    };
    const start = position(expectedRange.start), end = position(expectedRange.end);
    equal({ ...record.sourceRange }, { uri: doc.pathRef, line: start.line, column: start.column,
        endLine: end.line, endColumn: end.column }, 'SOURCE_COORDINATES');
    return proof;
}
function assertConditions(actual, expected) {
    // Known G4 machine fields. Do not infer polarity from rendered prose.
    const project = item => item === null ? null : { expressionId: item.expressionId, polarity: item.polarity, evaluated: item.evaluated };
    equal(project(actual.predicate), project(expected.predicate), 'SOURCE_PREDICATE');
    equal(actual.body.map(project), expected.body.map(project), 'SOURCE_POLARITY');
}
function assertClaims(actualClaims, directResult) {
    check(Array.isArray(actualClaims) && actualClaims.length <= MAX_REFERENCES, 'CORRESPONDENCE_BOUND');
    // Exact shipped-copy equality to an independently invoked public G3 result.
    // No connectivity, dependency or containing occurrence can add a claim.
    equal(actualClaims, directResult.claims, 'CORRESPONDENCE_CLAIMS');
    for (const claim of actualClaims) if (claim.scope === 'origin') {
        equal(claim.status, 'verified-known-contributor', 'ORIGIN_STRENGTH');
        equal(claim.completeOriginSet, false, 'ORIGIN_STRENGTH');
    }
    return actualClaims.length;
}
function assertPayload(flow, expected) {
    equal(flow.kind, 'payload', 'PAYLOAD_FAMILY');
    for (const key of ['fromId', 'toId', 'ownerInstanceId', 'causeBehaviorId', 'callSiteId',
        'producerEndpointId', 'consumerEndpointId', 'consumerArgumentIndex', 'consumerArgumentName']) {
        check(Object.hasOwn(expected, key), 'PAYLOAD_EXPECTATION');
        equal(flow[key], expected[key], 'PAYLOAD_CONTEXT');
    }
}
function assertCallContext(mapping, expected) {
    // Expected IDs identify independently selected lexical/occurrence records;
    // expected roles and relationships must come from the original fixture.
    const actual = { resolution: mapping.resolution, caller: mapping.caller,
        consumer: mapping.consumer, callee: mapping.callee === null ? null : {
            ownerInstanceId: mapping.callee.ownerInstanceId, endpointId: mapping.callee.endpointId,
            definitionId: mapping.callee.definitionId, behaviorId: mapping.callee.behaviorId },
        actualToFormal: mapping.actualToFormal.map(m => ({ actualExpressionId: m.actualExpressionId,
            formalIndex: m.formalIndex, formalName: m.formalName, ownerInstanceId: m.ownerInstanceId })),
        producer: mapping.producer.map(p => ({ endpointId: p.endpointId, ownerInstanceId: p.ownerInstanceId,
            implementationBehaviorId: p.implementationBehaviorId, expressionId: p.expressionId,
            argumentExpressionId: p.argumentExpressionId, formalIndex: p.formalIndex, resolution: p.resolution })),
        returnIds: mapping.returns.map(r => r.id), returnAvailability: mapping.returnAvailability,
        resultBindingId: mapping.resultBinding?.id || null };
    equal(actual, expected, 'SOURCE_CALL_CONTEXT');
}
function assertSignedConditions(actual, expected) {
    assertConditions(actual, expected);
    equal(actual.body.map(c => c.signedExpressionId), expected.body.map(c =>
        `${c.polarity ? '' : '!'}${c.expressionId}`), 'SOURCE_POLARITY');
}
module.exports = { MAX_BYTES, MAX_REFERENCES, sha256, document, slice, locate, section,
    assertSourceReference, assertSourceReferences, assertCodeRecord, assertConditions, assertClaims, assertPayload,
    assertCallContext, assertSignedConditions };
