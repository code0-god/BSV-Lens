'use strict';

const hardware = require('./index');
const correspondence = require('./correspondence');
const { buildSemanticIndexes } = require('../architecture/semantic/indexes');
const { normalizeRange } = require('./correspondence/source');
const { deepFreeze, hash, stable, failure, table } = require('./json');

function createArchitecture({ importResult = null, analysis }) {
    correspondence.getCoverage(analysis); // Requires a genuine product analysis, not a serialized lookalike.
    if (importResult && (!Object.isFrozen(importResult) || !Object.isFrozen(importResult.implementation)) ||
        analysis.implementationSnapshotId !== (importResult?.snapshot.id ?? null) ||
        analysis.implementationModelId !== (importResult?.implementation.id ?? null) ||
        analysis.correspondence.targetArtifactHash !== (importResult?.snapshot.artifact.hash ?? null)) {
        throw failure('SNAPSHOT_MISMATCH', 'Architecture requires the attached immutable implementation');
    }
    const source = analysis.sourceModel, indexes = buildSemanticIndexes(source), model = importResult?.implementation || null;
    const documents = new Map(source.sourceDocuments.map(d => [d.id, d]));
    const references = table(), entities = table(), occurrences = table(), storage = table(), contacts = table(), behaviors = table(), relations = table();
    const contexts = new Map(analysis.correspondence.contexts.map(c => [c.occurrenceId, c]));
    const methods = new Map(analysis.correspondence.methods.map(m => [m.endpointId, m]));
    function sourceRef(range, semanticId, sourceKind) {
        const document = documents.get(range?.uri);
        if (!document) throw failure('INVALID_RANGE', 'Source range has no captured source document');
        const normalized = normalizeRange(document.content, { unit: 'position', encoding: 'utf16', base: 0,
            start: { line: range.line, column: range.column }, end: { line: range.endLine, column: range.endColumn } });
        const value = { pathRef: document.relativePath, revision: document.revision, contentHash: document.revision,
            semanticId, sourceKind, range: { start: normalized.start, end: normalized.end },
            text: normalized.text, sliceHash: normalized.sliceHash };
        const id = `scene-source-${hash(stable(value))}`;
        return references[id] ||= { id, ...value };
    }
    const lexical = new Map(source.sourceReferences.map(r => [r.id, r]));
    for (const r of source.sourceReferences) sourceRef(r.sourceRange || r.location, r.id, r.kind);
    function record(item, kind, ownerInstanceId, definitionId, refs, secondaryLabel, enter = false) {
        const value = { id: item.id, kind, label: item.name || item.kind, secondaryLabel: secondaryLabel || '',
            ownerInstanceId, definitionId, sourceRefs: refs, semanticRefs: [item.id],
            interaction: { kind: enter ? 'enter' : 'inspect', entityId: item.id }, status: 'source-derived' };
        entities[item.id] = value;
        return value;
    }
    for (const item of source.instances) {
        if (item.primitiveKind && !['register', 'fifo', 'memory'].includes(item.primitiveKind)) continue;
        const definition = indexes.definitionById.get(item.targetDefinitionId);
        if (!item.primitiveKind && !definition) continue;
        const parent = indexes.instanceById.get(item.parentInstanceId);
        const declaration = source.sourceReferences.find(r => r.kind === 'state-declaration' &&
            r.parentDefinitionId === parent?.targetDefinitionId && r.location?.uri === item.location?.uri &&
            r.location?.line === item.location?.line && r.location?.column === item.location?.column);
        const storageItem = !!item.primitiveKind;
        const refs = [sourceRef(item.sourceRange, declaration?.id || item.id, storageItem ? 'state-declaration' : 'module-occurrence')];
        const value = record(item, storageItem ? 'storage' : 'module-occurrence', storageItem ? item.parentInstanceId : item.id,
            declaration?.id || definition?.id || null, refs, storageItem ? item.declaredType : definition.name, !storageItem);
        Object.assign(value, { path: item.path, parentInstanceId: item.parentInstanceId, declaredType: item.declaredType || 'inferred',
            constructor: item.constructor || null, defaultExpressions: item.arguments || [], parameterBindings: item.parameterBindings || [] });
        if (storageItem) { Object.assign(value, { primitiveKind: item.primitiveKind, readers: [], writers: [] }); storage[value.id] = value; }
        else { Object.assign(value, { children: [], storages: [], contacts: [], behaviorIds: [], context: contexts.get(item.id) || null }); occurrences[value.id] = value; }
    }
    for (const item of [...Object.values(occurrences), ...Object.values(storage)]) {
        const parent = occurrences[item.parentInstanceId];
        if (parent) parent[item.kind === 'storage' ? 'storages' : 'children'].push(item.id);
    }
    for (const item of source.stateBehaviors) {
        if (!occurrences[item.ownerInstanceId]) continue;
        const value = record(item, item.kind, item.ownerInstanceId, item.definitionId,
            [sourceRef(item.sourceRange, item.definitionId, item.kind)], item.guard || '');
        Object.assign(value, { statementIds: item.statementIds, expressionIds: item.expressionIds, predicateExpressionId: item.predicateExpressionId });
        behaviors[value.id] = value; occurrences[item.ownerInstanceId].behaviorIds.push(value.id);
    }
    function concrete(type, owner) {
        if (!type) return null;
        const instance = indexes.instanceById.get(owner), context = contexts.get(owner);
        const ifaceId = source.endpoints.find(e => e.ownerInstanceId === owner && e.interfacePath.length === 0)?.interfaceDefinitionId;
        const iface = indexes.definitionById.get(ifaceId);
        // These are compiler/source type records, not parsing BSV source text.
        const compilerType = context?.compilerType || instance.declaredType || '';
        const args = /#\((.*)\)$/.exec(compilerType)?.[1].split(',').map(s => s.trim()) || [];
        const bindings = new Map((iface?.typeParameters || []).map((p, i) => [p.name, args[i] || p.name]));
        return type.replace(/\b[A-Za-z_][\w]*\b/g, token => bindings.get(token) || token);
    }
    for (const item of source.endpoints) {
        if (!occurrences[item.ownerInstanceId]) continue;
        const method = methods.get(item.id), isMethod = item.kind === 'method-endpoint';
        const declaration = isMethod ? source.sourceReferences.find(r => r.kind === 'interface-method' &&
            r.interfaceDefinitionId === item.interfaceDefinitionId && r.name === item.name) : lexical.get(item.interfaceDefinitionId);
        const ref = declaration ? sourceRef(declaration.sourceRange || declaration.location, declaration.id, declaration.kind)
            : sourceRef(item.location, item.id, item.kind);
        const category = isMethod ? ({ action: 'Action', value: 'Value', 'action-value': 'ActionValue' }[item.category] || 'Unknown') : 'Interface';
        const args = (item.parameters || []).map(p => ({ name: p.name, type: concrete(p.type, item.ownerInstanceId), declaredType: p.type }));
        const resultType = method?.concreteResultType || concrete(item.resultType, item.ownerInstanceId);
        const result = { status: category === 'Action' ? 'none' : resultType ? 'typed' : 'unknown', type: resultType };
        const value = record(item, isMethod ? 'method-contact' : 'interface-contact', item.ownerInstanceId, declaration?.id || item.interfaceDefinitionId, [ref], '');
        const signalDetails = method ? method.signals.map(signal => ({ ...signal,
            localEndpoints: hardware.getNetEndpoints(model, method.implementationOccurrenceId, model.ports[signal.portId].bits),
            boundaryBindings: signal.orderedBindings.map(b => hardware.crossHierarchyBoundary(model, method.implementationOccurrenceId, signal.port, b.index)) })) : [];
        value.status = signalDetails.length ? 'compiler-confirmed-method-port' : 'source-derived';
        Object.assign(value, { ownerId: item.ownerInstanceId, direction: category === 'Value' ? 'output' : category === 'ActionValue' ? 'inout' : category === 'Interface' ? 'unknown' : 'input',
            category, declaredType: item.resultType || item.returnType || item.interfaceType || '', concreteType: resultType,
            arguments: args, result, interfaceDefinitionId: item.interfaceDefinitionId || null,
            interfacePath: item.interfacePath, signalDetails, method: method || null,
            behaviorIds: Object.values(behaviors).filter(b => b.ownerInstanceId === item.ownerInstanceId && b.definitionId === item.implementationMethodId).map(b => b.id) });
        value.secondaryLabel = isMethod ? `${category}${args.length ? ` (${args.map(a => `${a.type} ${a.name}`).join(', ')})` : ''}${resultType ? ` : ${resultType}` : ''}`
            : contexts.get(item.ownerInstanceId)?.compilerType || occurrences[item.ownerInstanceId].declaredType;
        contacts[value.id] = value; occurrences[item.ownerInstanceId].contacts.push(value.id);
    }
    for (const binding of source.bindings) {
        const target = storage[binding.targetInstanceId], behavior = behaviors[binding.behaviorId];
        if (!target || !behavior || !['read', 'write'].includes(binding.accessKind)) continue;
        const list = target[binding.accessKind === 'read' ? 'readers' : 'writers'];
        if (!list.some(b => b.id === behavior.id)) list.push({ id: behavior.id, label: behavior.label, kind: behavior.kind });
    }
    const ownerOf = id => entities[id]?.ownerInstanceId || null;
    function relationOwner(flow) {
        if (flow.ownerInstanceId) return flow.ownerInstanceId;
        let a = ownerOf(flow.fromId), b = ownerOf(flow.toId);
        const ancestors = new Set();
        for (let n = occurrences[a]; n; n = occurrences[n.parentInstanceId]) ancestors.add(n.id);
        for (let n = occurrences[b]; n; n = occurrences[n.parentInstanceId]) if (ancestors.has(n.id)) return n.id;
        return a || b;
    }
    function conditions(flow, binding) {
        const behavior = indexes.stateBehaviorById.get(flow.behaviorId || flow.causeBehaviorId || binding?.behaviorId);
        const predicate = indexes.expressionById.get(behavior?.predicateExpressionId);
        const statement = indexes.statementById.get(binding?.statementId);
        return { predicate: predicate ? { expressionId: predicate.id, text: predicate.text, evaluated: false } : null,
            body: (statement?.pathConditionExpressionIds || binding?.pathConditionExpressionIds || []).map(id => {
                const polarity = !id.startsWith('!'), expression = indexes.expressionById.get(polarity ? id : id.slice(1));
                return { expressionId: expression?.id || id, polarity, text: expression?.text || '', evaluated: false };
            }) };
    }
    for (const flow of source.semanticFlows) {
        if (!entities[flow.fromId] || !entities[flow.toId]) continue;
        const bindingId = flow.bindingId || flow.evidenceRefs?.find(e => e.bindingId)?.bindingId;
        const binding = indexes.bindingById.get(bindingId), ownerInstanceId = relationOwner(flow);
        if (!occurrences[ownerInstanceId]) continue;
        const refs = (flow.evidenceRefs || []).filter(r => r.sourceRange).map(r => sourceRef(r.sourceRange, r.bindingId || flow.id, 'semantic-relation'));
        if (!refs.length && binding?.sourceRange) refs.push(sourceRef(binding.sourceRange, binding.id, 'semantic-relation'));
        if (!refs.length) refs.push(...entities[flow.fromId].sourceRefs);
        const value = record({ id: flow.id, name: flow.kind }, 'semantic-relation', ownerInstanceId, null, refs, '');
        Object.assign(value, { kind: flow.kind, fromId: flow.fromId, toId: flow.toId, direction: 'forward',
            memberRelationIds: [flow.id], bindingId: binding?.id || null, behaviorId: flow.behaviorId || flow.causeBehaviorId
                || binding?.behaviorId || behaviors[flow.fromId]?.id || behaviors[flow.toId]?.id || null,
            statementId: binding?.statementId || null, expressionId: indexes.statementById.get(binding?.statementId)?.rightExpressionId || null,
            payloadType: flow.payloadType || null, conditions: conditions(flow, binding), confirmationScope: 'source-derived',
            semanticRefs: [flow.id, ...(binding ? [binding.id] : [])] });
        relations[value.id] = value;
    }
    // The product attachment already supplied these exact bounded module-return records.
    for (const supplement of source.supplements) for (const owner of Object.values(occurrences).filter(o => o.definitionId === supplement.ownerDefinitionId)) {
        const children = owner.children.map(id => occurrences[id]).filter(c => c.label === supplement.expression.text);
        if (children.length !== 1) continue;
        const from = children[0].contacts.map(id => contacts[id]).find(c => c.category === 'Interface');
        const to = owner.contacts.map(id => contacts[id]).find(c => c.category === 'Interface');
        if (!from || !to) continue;
        const id = `source-return:${owner.id}:${supplement.id}`;
        const value = record({ id, name: 'interface return' }, 'interface-return', owner.id, supplement.id,
            [sourceRef(supplement.sourceRange, supplement.id, 'interface-return')], '');
        Object.assign(value, { fromId: from.id, toId: to.id, direction: 'forward', memberRelationIds: [id],
            bindingId: null, behaviorId: null, statementId: supplement.id, expressionId: supplement.expression.id,
            payloadType: null, conditions: { predicate: null, body: [] }, confirmationScope: 'source-derived', semanticRefs: [supplement.id, supplement.expression.id] });
        relations[id] = value;
    }
    for (const item of [...source.statements, ...source.expressions]) {
        const ref = sourceRef(item.sourceRange, item.id, item.kind);
        entities[item.id] = { id: item.id, kind: item.kind, label: item.text || item.kind, secondaryLabel: '', ownerInstanceId: null,
            definitionId: item.enclosingCallableId, sourceRefs: [ref], semanticRefs: [item.id],
            interaction: { kind: 'inspect', entityId: item.id }, status: 'source-derived' };
    }
    const roots = source.roots.map(r => r.instanceId).filter(id => occurrences[id]);
    return deepFreeze({ id: `architecture-${hash(stable({ snapshot: model?.snapshot.id ?? null, analysis: analysis.id }))}`,
        snapshotId: model?.snapshot.id ?? null, modelId: model?.id ?? null, source, roots, entities, occurrences, storage, contacts, behaviors, relations, references });
}
module.exports = { createArchitecture };
