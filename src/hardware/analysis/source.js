'use strict';
const { setImmediate: yieldWork } = require('node:timers/promises');
const { failure, deepFreeze, hash, stable } = require('../json');
const { identityValue, inside } = require('./input');
const { callMapping, signedConditions } = require('./source-calls');
const { correspondenceDetails } = require('./source-correspondence');
async function executeSource(attached, q, signal, onProgress) {
    const started = performance.now(), source = attached.source;
    let ticks = 0, recordsVisited = 0, error = null;
    const check = () => {
        if (signal?.aborted) throw failure('CANCELLED', 'Source analysis cancelled');
        if (performance.now() - started >= q.limits.timeoutMs) throw failure('TIMEOUT', 'Source analysis deadline exceeded');
    };
    const progress = phase => { onProgress?.(deepFreeze({ phase, execution: 'host', threadId: null })); check(); };
    const work = { async checkpoint() { check(); if (++ticks % 32 === 0) { await yieldWork(); check(); } } };
    const objects = [], relations = [], sourceRefs = [], frontier = [], boundaries = [], evidenceRefs = [], candidates = [];
    const objectsSeen = new Set(), refsSeen = new Set(), relationsSeen = new Set(), stops = new Set();
    const owner = q.ownerInstanceId, occurrence = q.implementationOccurrenceId;
    const at = entityId => ({ kind: 'source', entityId, ownerInstanceId: owner, occurrenceId: occurrence });
    const allowsOwner = id => !attached.model || id === null || id === owner || !!attached.owners[id] && inside(attached.model, attached.owners[id], q.scope);
    function boundary(reason, entityId, details = {}) {
        const key = stable({ reason, entityId, ...details });
        if (!stops.has(key)) { stops.add(key); frontier.push({ kind: 'frontier', reason, at: at(entityId), ...details }); }
    }
    function limited(budget, entityId) { boundary('resource-limit', entityId, { budget }); return false; }
    function add(entity, entityOwner = owner, entityOccurrence = occurrence) {
        if (!entity) return false;
        if (!allowsOwner(entityOwner)) { boundary('scope', entity.id, { ownerInstanceId: entityOwner, occurrenceId: entityOccurrence }); return false; }
        const key = `${entity.id}\0${entityOwner}\0${entityOccurrence}`;
        if (objectsSeen.has(key)) return true;
        if (recordsVisited >= q.limits.maxBits) return limited('maxBits', entity.id);
        const ref = source?.reference(entity, entityOwner, entityOccurrence);
        recordsVisited++;
        if (ref && !refsSeen.has(ref.id)) { refsSeen.add(ref.id); sourceRefs.push(ref); }
        objectsSeen.add(key); objects.push({ kind: 'source', entityId: entity.id, objectKind: entity.kind || 'source',
            ownerInstanceId: entityOwner, occurrenceId: entityOccurrence, label: entity.name || entity.text || entity.kind || entity.id,
            sourceRefs: ref ? [ref.id] : [], record: entity });
        return true;
    }
    function relation(kind, from, to, details = {}) {
        const value = { family: 'source', kind, from: typeof from === 'string' ? at(from) : from,
            to: typeof to === 'string' ? at(to) : to, ...details };
        const id = `analysis-source-relation-${hash(stable(value))}`;
        if (relationsSeen.has(id)) return true;
        if (relations.length >= q.limits.maxEdges) return limited('maxEdges', q.seed.entityId);
        relationsSeen.add(id); relations.push({ id, ...value }); return true;
    }
    const code = { sourceMode: q.mode, freshness: source?.freshness || { status: 'not-attached', documents: [] },
        entity: null, owner: source?.instances.get(owner) || null, storage: null, behavior: null, functionDefinition: null,
        statements: [], expressions: [], bindings: [], dependencies: [], assertions: [], stateEffects: [],
        readiness: { status: 'not-attached', evidence: [] },
        scheduling: { compiler: { status: 'not-attached', relations: [] }, sourceRelations: [], potentialDependencies: [] }, limitations: [] };
    const conditions = { predicate: null, body: [] }, callMappings = [], readers = [], writers = [];
    const conditionKeys = new Set();
    function bodyConditions(ids) {
        for (const c of signedConditions(source, ids)) if (!conditionKeys.has(c.signedExpressionId)) {
            if (c.expression && !add(c.expression)) continue;
            conditionKeys.add(c.signedExpressionId); conditions.body.push(c);
            relation('condition', c.expressionId, q.seed.entityId, { signedExpressionId: c.signedExpressionId, polarity: c.polarity, evaluated: false });
        }
    }
    async function bindingDetails(binding) {
        await work.checkpoint();
        if (code.bindings.some(b => b.id === binding.id)) return;
        if (code.bindings.length >= q.limits.maxPins) { limited('maxPins', binding.id); return; }
        if (!add(binding)) return;
        code.bindings.push(binding); bodyConditions(binding.pathConditionExpressionIds);
        const target = source.instances.get(binding.targetInstanceId);
        if (target) add(target, source.ownerOf(target), attached.owners[source.ownerOf(target)] || null);
        const read = binding.accessKind === 'read', write = binding.accessKind === 'write', inbound = read || binding.accessKind === 'return';
        const targetOwner = target ? source.ownerOf(target) : null;
        const targetAt = { ...at(binding.endpointId || binding.targetInstanceId), ownerInstanceId: targetOwner, occurrenceId: attached.owners[targetOwner] || null };
        relation(read ? 'read' : write ? 'write' : binding.accessKind === 'return' ? 'return' : 'call',
            inbound ? targetAt : binding.behaviorId, inbound ? binding.behaviorId : targetAt,
            { bindingId: binding.id, behaviorId: binding.behaviorId, statementId: binding.statementId, callSiteId: binding.callSiteId,
                resolution: binding.resolutionStatus, record: binding });
    }
    async function mappingDetails(selected) {
        await work.checkpoint();
        if (callMappings.length >= q.limits.maxCells) { limited('maxCells', selected.id); return; }
        const mapping = callMapping(source, selected, owner, { allowsOwner, maxBits: q.limits.maxBits }); callMappings.push(mapping);
        if (mapping.truncated) limited('maxBits', selected.id);
        if (mapping.returnAvailability === 'scope-boundary') boundary('scope', selected.id, { ownerInstanceId: mapping.callee.ownerInstanceId });
        if (mapping.callSite) add(mapping.callSite);
        if (mapping.binding && !code.bindings.some(b => b.id === mapping.binding.id)) await bindingDetails(mapping.binding);
        candidates.push(...mapping.candidates);
        if (mapping.resolution !== 'exact') boundary(mapping.reason, selected.id, { candidates: mapping.candidates });
        const target = mapping.callee;
        const endpoint = target ? { kind: 'source', entityId: target.endpointId || target.definitionId,
            ownerInstanceId: target.ownerInstanceId, occurrenceId: attached.owners[target.ownerInstanceId] || null } : null;
        if (endpoint) relation('call', selected.id, endpoint, { caller: mapping.caller, callSiteId: mapping.callSite?.id || null, resolution: mapping.resolution });
        for (const m of mapping.actualToFormal) {
            if (m.actual) add(m.actual);
            if (endpoint) relation('argument', m.actualExpressionId, endpoint, { formalIndex: m.formalIndex, formalName: m.formalName, callSiteId: mapping.callSite.id });
        }
        for (const producer of mapping.producer) {
            await bindingDetails(producer.binding);
            const producerAt = { ...at(producer.endpointId), ownerInstanceId: producer.ownerInstanceId, occurrenceId: attached.owners[producer.ownerInstanceId] || null };
            relation('return', producerAt, producer.expressionId, { bindingId: producer.bindingId, callSiteId: mapping.callSite.id });
        }
        for (const ret of mapping.returns) {
            if (add(ret, target.ownerInstanceId, endpoint.occurrenceId)) relation('return', { ...endpoint, entityId: ret.expressionId || ret.id }, selected.id,
                { callSiteId: mapping.callSite.id, statementId: ret.id });
        }
    }
    try {
        progress('started'); await yieldWork(); progress('ready'); await yieldWork(); check();
        const stale = q.mode === 'current-source' && code.freshness.status !== 'current';
        let correspondence = null;
        if (!stale) {
            const entity = source?.records.get(q.seed.entityId);
            if (entity) { add(entity); code.entity = entity; }
            if (code.owner) add(code.owner);
            if (q.seed.entryCallSiteId) {
                await mappingDetails(source.calls.get(q.seed.entryCallSiteId));
                code.entryCallMapping = callMappings.at(-1) || null;
            }
            if (q.kind === 'state-accesses') {
                code.storage = source.architecture?.storage[entity.id] || entity;
                const bindings = [...source.bindings.values()].filter(b => b.targetInstanceId === entity.id && b.ownerInstanceId === owner && ['read', 'write'].includes(b.accessKind));
                for (const binding of bindings) {
                    await bindingDetails(binding);
                    const behavior = source.behaviors.find(b => b.id === binding.behaviorId);
                    if (!behavior || !add(behavior)) continue;
                    const list = binding.accessKind === 'read' ? readers : writers;
                    if (!list.some(b => b.id === behavior.id)) list.push(behavior);
                    const statement = source.statements.get(binding.statementId); if (statement) add(statement);
                }
            } else if (q.kind === 'behavior') {
                const endpoint = source.endpoints.get(entity.id);
                const resolution = endpoint ? source.semantic.resolveEndpointImplementation(entity.id, { ownerInstanceId: owner }) : null;
                const behavior = resolution?.behavior || source.behaviors.find(b => b.id === entity.id);
                const fn = source.functions.get(entity.id);
                const slice = behavior ? source.semantic.getBehaviorSlice(behavior.id, { ownerInstanceId: owner }) : null;
                code.behavior = behavior || null; code.functionDefinition = fn || null;
                if (fn?.declarationOnly) boundary('unsupported-source', entity.id, { detail: 'declaration-only' });
                if (!behavior && !fn) { candidates.push(...(resolution?.candidates || [])); boundary('unresolved-behavior', entity.id); }
                const callable = behavior?.definitionId || fn?.id;
                if (behavior) add(behavior);
                const predicate = slice?.predicateExpression;
                if (predicate && add(predicate)) conditions.predicate = { expressionId: predicate.id, text: predicate.text, expression: predicate, evaluated: false };
                const statements = slice?.statements || [...source.statements.values()].filter(s => s.enclosingCallableId === callable);
                const expressions = slice?.expressions || [...source.expressions.values()].filter(e => e.enclosingCallableId === callable);
                for (const s of statements) {
                    await work.checkpoint(); if (!add(s)) break;
                    code.statements.push(s); bodyConditions(s.pathConditionExpressionIds);
                    if (s.kind === 'assertion') code.assertions.push(s);
                    if (s.stateEffect) code.stateEffects.push({ statementId: s.id, effect: s.stateEffect });
                    if (s.resolutionStatus === 'unsupported') boundary('unsupported-statement', s.id);
                    if (s.kind === 'return' && s.expressionId) relation('return', s.expressionId, entity.id, { statementId: s.id });
                    if (s.rightExpressionId) relation('assignment', s.rightExpressionId, s.id, { statementId: s.id, stateEffect: s.stateEffect || null });
                }
                for (const e of expressions) { await work.checkpoint(); if (!add(e)) break; code.expressions.push(e); }
                for (const b of slice?.bindings || []) await bindingDetails(b);
                for (const c of slice?.callSites || [...source.calls.values()].filter(c => c.enclosingCallableId === callable)) await mappingDetails(c);
                for (const s of slice?.scheduleRelations || []) {
                    await work.checkpoint();
                    if (s.origin === 'bsc') { code.scheduling.compiler.status = 'attached'; code.scheduling.compiler.relations.push(s); }
                    else if (s.origin === 'source-heuristic') code.scheduling.potentialDependencies.push(s);
                    else code.scheduling.sourceRelations.push(s);
                }
            } else if (q.kind === 'call-site') await mappingDetails(entity);
            else if (q.kind === 'source-dependencies') {
                const statement = source.statements.get(entity.id), fn = source.functions.get(entity.id);
                const seeds = fn ? fn.returnExpressionIds : statement ? [statement.rightExpressionId || statement.expressionId || statement.conditionExpressionId].filter(Boolean) : [entity.id];
                const queue = seeds.map(id => ({ id, depth: 0 })), visited = new Set();
                if (!queue.length) boundary('unsupported-statement', entity.id);
                for (let cursor = 0; cursor < queue.length; cursor++) {
                    await work.checkpoint(); const { id, depth } = queue[cursor];
                    if (visited.has(id)) continue; visited.add(id);
                    const expression = source.expressions.get(id); if (!expression || !add(expression)) break;
                    const rawDependency = source.semantic.getExpressionDependencies(id);
                    const parent = source.statements.get(expression.parentStatementId);
                    // Correct only the query projection; canonical statement IDs, including !, are untouched.
                    const dependency = { ...rawDependency, pathConditions: signedConditions(source, parent?.pathConditionExpressionIds) };
                    code.dependencies.push(dependency); code.expressions.push(expression); bodyConditions(parent?.pathConditionExpressionIds);
                    if (dependency.status !== 'exact') boundary(dependency.status === 'unsupported' ? 'unsupported-source' : 'unresolved-source', id,
                        { resolution: dependency.status, candidateDefinitionIds: expression.definitionIds || [], bindingEnvironmentId: expression.bindingEnvironmentId });
                    const next = q.direction === 'forward' ? [...source.expressions.values()].filter(e => [...e.operandIds, ...e.definitionIds, ...e.argumentIds].includes(id)).map(e => e.id) :
                        [...(expression.operandIds || []), ...(expression.definitionIds || []), ...(expression.argumentIds || [])].filter(id => source.expressions.has(id));
                    for (const target of [...new Set(next)]) {
                        if (depth >= q.limits.maxHierarchyDepth) { boundary('resource-limit', id, { budget: 'maxHierarchyDepth' }); break; }
                        if (!relation('expression-dependency', q.direction === 'forward' ? id : target, q.direction === 'forward' ? target : id,
                            { resolution: dependency.status, direction: q.direction || 'backward' })) break;
                        queue.push({ id: target, depth: depth + 1 });
                    }
                    if (expression.callSiteId) await mappingDetails(expression);
                    if (frontier.some(f => f.reason === 'resource-limit')) break;
                }
            } else if (q.kind === 'correspondence') {
                correspondence = await correspondenceDetails(attached, q, work);
                for (const ref of correspondence.sourceRefs) if (!refsSeen.has(ref.id)) { refsSeen.add(ref.id); sourceRefs.push(ref); }
                for (const result of [correspondence.stock, correspondence.origin]) {
                    candidates.push(...(result.candidates || []));
                    if (result.truncated) limited('maxEdges', q.seed.entityId);
                    for (const explanation of result.explanations) evidenceRefs.push(explanation);
                }
                if (q.seed.domain === 'implementation') objects.push({ kind: 'implementation', entityId: q.seed.entityId,
                    objectKind: attached.model.entities[q.seed.entityId].kind, occurrenceId: occurrence, snapshotId: q.context.snapshotId });
            }
        }
        if (stale) boundary('current-source-unavailable', q.seed.entityId, { freshness: code.freshness.status });
        check();
        const mappingResults = correspondence ? [correspondence.stock, correspondence.origin] : [];
        const unsupported = mappingResults.length && mappingResults.every(r => r.availability === 'not-attached');
        const status = stale || mappingResults.some(r => r.resolution === 'stale') ? 'stale' : unsupported ? 'unsupported' :
            mappingResults.some(r => r.resolution === 'ambiguous') || callMappings.some(m => m.resolution === 'multiple') ? 'ambiguous' :
                frontier.length ? 'partial' : !objects.length ? 'empty' : 'complete';
        const result = { schemaVersion: 1, queryId: q.queryId, kind: q.kind, status,
            availability: status === 'stale' || unsupported ? 'unavailable' : 'available',
            completeness: ['unsupported', 'ambiguous'].includes(status) ? 'unknown' : frontier.length ? 'partial' : 'complete',
            context: q.context, seed: q.seed, scope: q.scope, direction: q.direction, semanticsProfile: q.semanticsProfile,
            objects, relations, boundaries, frontier, sourceRefs, evidenceRefs, candidates, limits: { ...q.limits, stopReasons: [...new Set(frontier.map(f => f.reason))] },
            code, conditions, callMappings, readers, writers, ...(correspondence ? { correspondence } : {}) };
        result.id = `analysis-result-${hash(stable(identityValue(result)))}`;
        result.request = q.request; result.metrics = { execution: 'host', recordsVisited, elapsedMs: performance.now() - started, resultBytes: 0 };
        for (let i = 0; i < 3; i++) result.metrics.resultBytes = Buffer.byteLength(JSON.stringify(result));
        if (result.metrics.resultBytes > q.limits.maxResultBytes) throw failure('LIMIT_EXCEEDED', 'Source result envelope exceeds byte budget');
        check(); return deepFreeze(result);
    } catch (cause) {
        error = cause; cause.metrics = { execution: 'host', elapsedMs: performance.now() - started, workerExited: false };
        cause.frontier = [{ kind: 'frontier', reason: cause.code === 'CANCELLED' ? 'cancelled' : cause.code === 'TIMEOUT' ? 'deadline' : 'execution-failure', seed: q.seed }];
        throw cause;
    } finally {
        onProgress?.(deepFreeze({ phase: 'exited', execution: 'host', threadId: null, cancelled: error?.code === 'CANCELLED', timedOut: error?.code === 'TIMEOUT', elapsedMs: performance.now() - started }));
    }
}
module.exports = { executeSource };
