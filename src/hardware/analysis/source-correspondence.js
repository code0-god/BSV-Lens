'use strict';
const stock = require('../correspondence');
const origin = require('../correspondence/origin');
const { normalizeRange } = require('../correspondence/source');
const { failure, hash, stable } = require('../json');
async function correspondenceDetails(attached, q, work) {
    const { source, analysis, originCase, sourceBindings, stockModel, model } = attached;
    const entity = source?.records.get(q.seed.entityId), selected = source?.architecture?.entities[q.seed.entityId];
    const empty = { resolution: 'unsupported', availability: 'not-attached', claims: [], candidates: [], explanations: [] };
    let stockResult = empty, originResult = empty;
    if (analysis && q.context.implementationProvider === 'stock') {
        if (q.seed.domain === 'implementation') stockResult = stock.implementationToSource(analysis, {
            entityId: q.seed.entityId, snapshotId: stockModel.snapshot.id, mode: q.mode, limit: q.limits.maxEdges });
        else {
            const method = source.architecture?.contacts[entity.id]?.method;
            const semanticId = method?.semanticId || selected?.sourceRefs[0]?.semanticId || entity.definitionId || entity.id;
            stockResult = stock.sourceToImplementation(analysis, { semanticId, occurrenceId: q.ownerInstanceId,
                snapshotId: stockModel?.snapshot.id || null, ...(q.seed.sourceRevision ? { sourceRevision: q.seed.sourceRevision } : {}), mode: q.mode, limit: q.limits.maxEdges });
        }
        stockResult = { ...stockResult, availability: 'available', explanations: [] };
        for (const claim of stockResult.claims) { await work.checkpoint(); stockResult.explanations.push(stock.explainMapping(analysis, claim.id)); }
    }
    if (originCase) {
        originResult = { ...empty, availability: 'available', resolution: 'unmapped' };
        if (q.seed.domain === 'implementation' && q.context.implementationProvider === 'instrumented') {
            originResult = origin.implementationToSource(originCase.analysis, { entityId: q.seed.entityId,
                snapshotId: model.snapshot.id, family: 'origin', contribution: 'known', mode: q.mode, limit: q.limits.maxEdges });
        } else if (entity && source?.architecture) {
            // This is the same explicit equal-revision RHS/storage join as G4. No adjacency, labels, or inferred origin propagation.
            const selections = [];
            if (selected?.kind === 'storage') for (const ref of selected.sourceRefs) selections.push({ ref, kind: 'binding' });
            else {
                const statement = source.statements.get(entity.id);
                for (const id of [entity.id, statement?.rightExpressionId, statement?.expressionId]) {
                    const expression = source.expressions.get(id);
                    if (expression && source.behaviors.some(b => b.ownerInstanceId === q.ownerInstanceId && b.definitionId === expression.enclosingCallableId))
                        selections.push({ ref: source.reference(expression, q.ownerInstanceId, q.implementationOccurrenceId), kind: 'rhs-binary', definitionId: expression.enclosingCallableId });
                }
            }
            const owner = analysis.correspondence.contexts.find(c => c.occurrenceId === q.ownerInstanceId);
            const occurrence = stockModel.occurrences[owner?.implementationOccurrenceId || owner?.contextOccurrenceId];
            const claims = [], candidates = [], unresolved = [];
            if (occurrence) for (const selection of selections) {
                await work.checkpoint();
                const binding = sourceBindings.find(b => b.sourcePathRef === selection.ref.pathRef && b.sourceRevision === selection.ref.revision);
                if (!binding) continue;
                const result = origin.sourceToImplementation(originCase.analysis, { sourceRevision: binding.originRevision,
                    occurrencePath: occurrence.path, family: 'origin', contribution: 'known', mode: q.mode,
                    snapshotId: originCase.request.importResult.snapshot.id, limit: q.limits.maxEdges });
                unresolved.push(...(result.unresolved || [])); candidates.push(...(result.candidates || []));
                for (const claim of result.claims) {
                    const ref = claim.source;
                    if (ref.pathRef !== binding.originPathRef || ref.revision !== binding.originRevision || ref.contentHash !== binding.originRevision || ref.kind !== selection.kind) continue;
                    const exact = selection.kind === 'binding' ? ref.semanticId === selection.ref.semanticId &&
                        ref.range.start >= selection.ref.range.start && ref.range.end <= selection.ref.range.end :
                        ref.range.start === selection.ref.range.start && ref.range.end === selection.ref.range.end && ref.definitionId === selection.definitionId;
                    if (!exact) continue;
                    const doc = [...source.documents.values()].find(d => d.relativePath === binding.sourcePathRef);
                    const range = normalizeRange(doc.content, { unit: 'utf16', start: ref.range.start, end: ref.range.end });
                    if (range.text !== ref.range.text || range.text !== ref.text || range.sliceHash !== ref.range.sliceHash)
                        throw failure('INVALID_RANGE', 'Origin source range contradicts equal-revision source');
                    if (!claims.some(c => c.id === claim.id)) claims.push(claim);
                }
            }
            originResult = { ...originResult, claims, candidates, unresolved, resolution: claims.length ? 'resolved' : 'unmapped' };
        }
        originResult = { ...originResult, availability: 'available', explanations: [] };
        for (const claim of originResult.claims) { await work.checkpoint(); originResult.explanations.push(origin.explainMapping(originCase.analysis, claim.id)); }
    }
    const sourceRefs = [];
    for (const claim of [...stockResult.claims, ...originResult.claims]) {
        await work.checkpoint();
        const ref = claim.tuple?.source || claim.source;
        const binding = sourceBindings.find(b => b.originPathRef === ref.pathRef && b.originRevision === ref.revision);
        const document = source && [...source.documents.values()].find(d => d.relativePath === (binding?.sourcePathRef || ref.pathRef) && d.revision === ref.revision);
        let range = ref.range;
        if (document) {
            if (hash(document.content) !== ref.contentHash) throw failure('SOURCE_REVISION_MISMATCH', 'Claim full source text hash mismatch');
            range = normalizeRange(document.content, { unit: 'utf16', start: ref.range.start, end: ref.range.end });
            if (range.text !== ref.range.text) throw failure('INVALID_RANGE', 'Claim source range differs from captured text');
        }
        // Without an equal-revision document the genuine G3 reference remains evidence-only;
        // its path never becomes a filesystem read capability.
        const value = { pathRef: ref.pathRef, revision: ref.revision, contentHash: ref.contentHash,
            sourceKind: ref.sourceKind || ref.kind, semanticId: ref.semanticId, ownerInstanceId: ref.occurrenceId || q.ownerInstanceId,
            occurrenceId: claim.target?.occurrenceId || claim.tuple?.target.occurrenceId || q.implementationOccurrenceId,
            range: { start: range.start, end: range.end, text: range.text }, text: range.text, sliceHash: hash(range.text),
            availability: document ? 'captured' : 'evidence-only' };
        const id = `analysis-source-${hash(stable(value))}`;
        if (!sourceRefs.some(r => r.id === id)) sourceRefs.push({ id, ...value });
    }
    return { stock: stockResult, origin: originResult, sourceRefs, completeOriginSet: false, completeOriginSetStatus: 'not-established' };
}
module.exports = { correspondenceDetails };
