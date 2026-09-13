'use strict';

const hardware = require('./index');
const stock = require('./correspondence');
const origin = require('./correspondence/origin');
const { checkedJson } = require('./correspondence/schema');
const { normalizeRange } = require('./correspondence/source');
const { createArchitecture } = require('./architecture');
const { bsvContent, rtlContent, buildScene } = require('./scene');
const { interfaceMembers } = require('./scene-overview');
const { deepFreeze, hash, stable, failure, DEFAULT_LIMITS } = require('./json');
const invalid = message => { throw failure('INVALID_INPUT', message); };

function createSceneQuery({ buildId, label, importResult = null, analysis = null, originCase = null, sourceBindings = [], defaultRootInstanceId = null }) {
    if (typeof buildId !== 'string' || !buildId || typeof label !== 'string') invalid('Build ID and label required');
    if (!Array.isArray(sourceBindings)) invalid('Explicit source binding array required');
    if (!analysis) {
        if (!importResult) invalid('Source analysis or hardware import required');
        if (originCase || sourceBindings.length) throw failure('UNSUPPORTED', 'Origin binding requires attached source analysis');
        return require('./artifact-scene').createArtifactSceneQuery({ buildId, label, importResult, defaultRootInstanceId });
    }
    const architecture = createArchitecture({ importResult, analysis }), stockModel = importResult?.implementation || null;
    if (originCase && !stockModel) throw failure('UNSUPPORTED', 'Origin binding requires the stock implementation');
    const roots = architecture.roots.map(id => ({ id, label: architecture.occurrences[id].label,
        path: architecture.occurrences[id].path, sceneKind: 'bsv', snapshotId: stockModel?.snapshot.id ?? null,
        sourceRevision: architecture.occurrences[id].sourceRefs[0].revision }));
    if (defaultRootInstanceId !== null && !roots.some(root => root.id === defaultRootInstanceId)) invalid('Unknown default source root');
    const defaultRoot = defaultRootInstanceId || (roots.length === 1 ? roots[0].id : null);
    const originModel = originCase?.request.importResult.implementation || null;
    const coverage = originCase ? origin.getCoverage(originCase.analysis) : null;
    if (originCase && (!Object.isFrozen(originCase.request.importResult) || originCase.analysis.bundle.implementationSnapshotId !== originModel.snapshot.id ||
        originCase.analysis.bundle.implementationModelId !== originModel.id)) throw failure('SNAPSHOT_MISMATCH', 'Foreign origin implementation');
    const bindings = checkedJson(sourceBindings);
    if (!Array.isArray(bindings)) invalid('Explicit source binding array required');
    const seenSources = new Set(), seenOrigins = new Set();
    for (const binding of bindings) {
        if (Object.keys(binding).some(k => !['sourcePathRef', 'sourceRevision', 'originPathRef', 'originRevision'].includes(k))) invalid('Unknown source binding field');
        const document = architecture.source.sourceDocuments.find(d => d.relativePath === binding.sourcePathRef && d.revision === binding.sourceRevision);
        const captured = originCase?.request.files.find(f => f.kind === 'source' && f.pathRef === binding.originPathRef && f.contentHash === binding.originRevision);
        if (!document || !captured || binding.sourceRevision !== binding.originRevision || hash(document.content) !== captured.contentHash) {
            throw failure('SOURCE_REVISION_MISMATCH', 'Source binding does not identify equal registered source revisions');
        }
        if (seenSources.has(binding.sourcePathRef) || seenOrigins.has(binding.originPathRef)) invalid('Ambiguous duplicate source binding');
        seenSources.add(binding.sourcePathRef); seenOrigins.add(binding.originPathRef);
    }
    const contexts = new Map(analysis.correspondence.contexts.map(c => [c.occurrenceId, c]));
    const allowedSnapshots = new Set([stockModel?.snapshot.id ?? null, ...(originModel ? [originModel.snapshot.id] : [])]);
    const allowedSourceRefs = new Map(Object.values(architecture.references).map(r => [r.id, r]));
    const sourceReferenceBySemanticId = new Map(Object.values(architecture.references).map(ref => [ref.semanticId, ref]));
    const sourceBehaviorById = new Map(architecture.source.stateBehaviors.map(behavior => [behavior.id, behavior]));
    const documentFor = ref => architecture.source.sourceDocuments.find(d => d.relativePath === ref.pathRef && d.revision === ref.revision);
    function resolveSourceOwner(id, fallback) {
        const entity = architecture.entities[id];
        return entity?.ownerInstanceId || fallback;
    }
    function sourceSelections(selected, ownerId) {
        if (!selected) return [];
        if (selected.kind === 'storage') return selected.sourceRefs.filter(r => r.sourceKind === 'state-declaration').map(r => ({ ref: r, kind: 'binding' }));
        const statement = architecture.source.statements.find(s => s.id === selected.id);
        const ids = new Set([selected.id, ...(statement?.rightExpressionId ? [statement.rightExpressionId] : []),
            ...(selected.expressionId ? [selected.expressionId] : []), ...(selected.members || []).map(m => m.expressionId).filter(Boolean)]);
        const owner = architecture.occurrences[ownerId];
        const callableIds = new Set(owner.behaviorIds.map(id => architecture.behaviors[id].definitionId));
        return architecture.source.expressions.filter(e => ids.has(e.id) && callableIds.has(e.enclosingCallableId)).map(e => ({
            ref: Object.values(architecture.references).find(r => r.semanticId === e.id), kind: 'rhs-binary', definitionId: e.enclosingCallableId }));
    }
    function originResult(selected, ownerId, provider) {
        const empty = { available: !!originCase, resolution: originCase ? 'unmapped' : 'unsupported', claims: [],
            coverage, completeOriginSet: 'not-established', status: 'unmapped', limitations: ['Known contributors only', 'Complete origin set not established'] };
        if (!originCase || !selected) return empty;
        if (provider === 'instrumented' && originModel.entities[selected.id]) {
            if (originModel.entities[selected.id].kind !== 'cell') return empty;
            const result = origin.implementationToSource(originCase.analysis, { entityId: selected.id, contribution: 'known', family: 'origin', snapshotId: originModel.snapshot.id });
            return { ...empty, ...result, status: result.claims.length ? 'verified-contributor' : 'unmapped' };
        }
        const context = contexts.get(ownerId), stockOccurrence = stockModel.occurrences[context?.implementationOccurrenceId || context?.contextOccurrenceId];
        if (!stockOccurrence) return empty;
        const claims = [];
        for (const selection of sourceSelections(selected, ownerId)) {
            const binding = bindings.find(b => b.sourcePathRef === selection.ref.pathRef && b.sourceRevision === selection.ref.revision);
            if (!binding) continue;
            const result = origin.sourceToImplementation(originCase.analysis, { sourceRevision: binding.originRevision,
                occurrencePath: stockOccurrence.path, family: 'origin', contribution: 'known', snapshotId: originModel.snapshot.id });
            for (const claim of result.claims) {
                const ref = claim.source;
                if (ref.pathRef !== binding.originPathRef || ref.revision !== binding.originRevision || ref.contentHash !== binding.originRevision || ref.kind !== selection.kind) continue;
                const exact = selection.kind === 'binding' ? ref.semanticId === selection.ref.semanticId &&
                    ref.range.start >= selection.ref.range.start && ref.range.end <= selection.ref.range.end
                    : ref.range.start === selection.ref.range.start && ref.range.end === selection.ref.range.end && ref.definitionId === selection.definitionId;
                if (!exact || ref.range.text !== documentFor(selection.ref).content.slice(ref.range.start, ref.range.end)) continue;
                if (claim.status !== 'verified-known-contributor' || claim.target.snapshotId !== originModel.snapshot.id || !originModel.cells[claim.target.entityId]) continue;
                if (!claims.some(c => c.id === claim.id)) claims.push(claim);
            }
        }
        return { ...empty, claims, resolution: claims.length ? 'resolved' : 'unmapped', status: claims.length ? 'verified-contributor' : 'unmapped' };
    }
    function stockResult(selected) {
        const method = selected && architecture.contacts[selected.id]?.method;
        let result = { analysisId: analysis.id, resolution: 'unmapped', claims: [], candidates: [], unresolved: [], freshness: analysis.freshness };
        if (method) result = stock.sourceToImplementation(analysis, { occurrenceId: method.occurrenceId, semanticId: method.semanticId,
            method: method.method, snapshotId: stockModel.snapshot.id, family: 'connectivity' });
        else if (selected && stockModel?.entities[selected.id]) result = stock.implementationToSource(analysis, { entityId: selected.id, family: 'connectivity', snapshotId: stockModel.snapshot.id });
        return { ...result, sourceModelIdentity: analysis.sourceModelIdentity, coverage: stock.getCoverage(analysis) };
    }
    function claimSource(claim) {
        const s = claim.source, binding = bindings.find(b => b.originPathRef === s.pathRef && b.originRevision === s.revision);
        if (!binding) return null;
        const document = architecture.source.sourceDocuments.find(d => d.relativePath === binding.sourcePathRef && d.revision === binding.sourceRevision);
        const range = normalizeRange(document.content, { unit: 'utf16', start: s.range.start, end: s.range.end });
        if (range.text !== s.text || range.sliceHash !== s.range.sliceHash) throw failure('INVALID_RANGE', 'Origin range differs from bound source');
        const value = { pathRef: s.pathRef, revision: s.revision, contentHash: s.contentHash, semanticId: s.semanticId,
            sourceKind: s.kind, range: { start: range.start, end: range.end }, text: range.text, sliceHash: range.sliceHash };
        const ref = { id: `scene-origin-source-${hash(stable(value))}`, ...value };
        allowedSourceRefs.set(ref.id, ref); return ref;
    }
    function inspectorFor(selected, ownerId, context, correspondence, content, disclosureState) {
        const entity = selected || architecture.occurrences[ownerId];
        const sourceRefs = [...(entity.sourceRefs || [])];
        for (const claim of correspondence.origin.claims) {
            const ref = claimSource(claim); if (ref && !sourceRefs.some(r => r.id === ref.id)) sourceRefs.push(ref);
        }
        const sections = [];
        const section = (id, title, rows, refs = []) => { if (!rows.length && !refs.length) return;
            const fields = rows.map(([label, value, status = 'source-derived']) => ({ label, value, status }));
            sections.push({ id, title, fields, rows: fields, sourceRefs: refs, actions: [] }); };
        const module = architecture.occurrences[entity.id];
        section('identity', 'Instance context', [...(entity.path && entity.path !== architecture.occurrences[ownerId].path ? [['Selected path', entity.path]] : []),
            ...(module ? [['Definition', module.secondaryLabel],
                ...(module.children.length ? [['Child instances', module.children.length]] : []),
                ...(module.storages.length ? [['Storage', module.storages.length]] : []),
                ['Typed methods', module.contacts.filter(id => architecture.contacts[id].category !== 'Interface').length]] : []),
            ['BSV owner', architecture.occurrences[ownerId].path],
            ['Actual RTL path', stockModel ? context.occurrencePath.join('/') : 'Not attached', stockModel ? 'verified-structure' : 'not-attached'],
            ['RTL provider', stockModel ? context.provider : 'Not attached', stockModel ? 'verified-structure' : 'not-attached'],
            ['RTL stage', stockModel ? context.stage : 'Unknown', stockModel ? 'verified-structure' : 'not-attached'],
            ['Implementation', context.status, context.status],
            ...(context.ownership === 'containing-only' ? [['Containing RTL module', context.occurrencePath.join('/'), 'containing-only']] : [])]);
        const behaviorIds = new Set([...(entity.readers || []).map(b => b.id), ...(entity.writers || []).map(b => b.id),
            ...(entity.behaviorIds || []), ...(entity.behaviorId ? [entity.behaviorId] : []), ...(entity.members || []).map(m => m.behaviorId).filter(Boolean)]);
        if (architecture.behaviors[entity.id]) behaviorIds.add(entity.id);
        const behaviorRefs = [...behaviorIds].map(id => architecture.behaviors[id]).filter(Boolean).map(b => ({ id: b.id, label: b.label, kind: b.kind, sourceRefs: b.sourceRefs,
            interaction: { kind: 'inspect', entityId: b.id } }));
        if (entity.kind === 'storage') section('storage', 'Declared storage', [['Constructor', entity.constructor],
            ['Initial expression', entity.defaultExpressions.length ? entity.defaultExpressions.join(', ') : 'Not present'],
            ['Written by', entity.writers.map(b => b.label).join(', ') || 'Not present in source model'],
            ['Read by', entity.readers.map(b => b.label).join(', ') || 'Not present in source model']], sourceRefs);
        if (entity.category === 'Interface') {
            const group = content.interfaceGroups?.find(item => item.id === entity.id);
            section('interface-group', 'Source interface group', [['Meaning', 'Interface grouping, not a physical port'],
                ['Path', entity.continuation?.path || entity.interfacePath.join('.') || architecture.occurrences[entity.ownerId].path],
                ['Members', entity.continuation ? 'Outside the current module boundary'
                    : interfaceMembers(architecture, entity).map(contact => contact.label).join(', ') || 'Unresolved']]);
        } else if (entity.category) section('contact', 'Typed contact', [['Category', entity.category],
            ['Direction', entity.direction], ['Input', (entity.arguments || []).map(a => `${a.name} : ${a.type || 'Unknown'}`).join(', ') || 'None'],
            ['Result', entity.result?.status === 'none' ? 'None' : entity.result?.type || entity.result?.status || 'Not applicable']]);
        if (behaviorRefs.length) {
            section('behavior-actions', 'Related behavior', [['Role', 'Source behavior, not a physical hardware block']]);
            sections.at(-1).actions = behaviorRefs.map(behavior => ({ id: behavior.id, label: behavior.label }));
        }
        for (const behavior of behaviorRefs) {
            const original = architecture.source.stateBehaviors.find(item => item.id === behavior.id);
            const predicate = architecture.source.expressions.find(item => item.id === original.predicateExpressionId);
            const uses = Object.values(architecture.relations).filter(relation => relation.behaviorId === behavior.id);
            const bodyConditions = [...new Map(uses.flatMap(relation => relation.conditions.body)
                .map(condition => [`${condition.expressionId}:${condition.polarity}`, condition])).values()];
            section(`behavior:${behavior.id}`, `${behavior.kind} ${behavior.label}`, [
                ['Explicit guard', predicate ? predicate.text : 'Not present'],
                ...(bodyConditions.length ? [['Body conditions', bodyConditions.map(condition => `${condition.polarity ? '' : 'not '}(${condition.text})`).join('; ')]] : []),
                ...(original.reads.length ? [['Reads', original.reads.join(', ')]] : []),
                ...(original.writes.length ? [['Writes', original.writes.join(', ')]] : []),
                ...(original.invocations.length ? [['Calls', original.invocations.map(call => typeof call === 'string' ? call : call.method || call.target || call.text || JSON.stringify(call)).join(', ')]] : [])
            ], module ? [] : behavior.sourceRefs);
            const currentSection = sections.at(-1);
            currentSection.behaviorId = behavior.id;
            currentSection.guard = { status: predicate ? 'present' : 'not-present', expressionId: predicate?.id || null };
            currentSection.bodyConditions = bodyConditions;
            currentSection.actions = original.statementIds.map(id => architecture.source.statements.find(statement => statement.id === id))
                .map(statement => architecture.source.expressions.find(expression => expression.id === statement?.rightExpressionId))
                .filter(Boolean).map(expression => ({ id: expression.id, label: expression.text }));
        }
        const connectivity = entity.bits && entity.members ? {
            id: entity.id, snapshotId: context.snapshotId, occurrenceId: context.contextOccurrenceId,
            bits: entity.bits, rawBits: entity.rawBits, incidences: entity.incidences, members: entity.members,
            aliases: entity.aliases, ordering: entity.ordering
        } : null;
        if (connectivity) {
            section('connectivity', 'Actual RTL connectivity', [['Vector ID', entity.id, 'verified-connectivity'],
                ['Ordered bits', `[${entity.rawBits.join(', ')}]`, 'verified-connectivity'],
                ['Hardware snapshot', context.snapshotId, 'verified-structure'],
                ['Contacts', entity.incidences.map(incidence => {
                    const contact = content.contacts.find(item => item.id === incidence.contactId);
                    return `${contact.label} [${incidence.members.map(member => member.contactIndex).join(', ')}]`;
                }).join('; ') || 'No contacts', 'verified-connectivity']], entity.sourceRefs || []);
        } else if (entity.members) {
            section('relations', 'Connection evidence', entity.members.map(member => [member.kind || 'bit',
                member.sourceRefs?.map(ref => ref.text).join('\n') || String(member.value), member.confirmationScope || 'verified-connectivity']),
            entity.sourceRefs || []);
            const expressions = [...new Set(entity.members.map(member => member.expressionId).filter(Boolean))];
            sections.at(-1).actions = expressions.map(id => architecture.entities[id]).filter(Boolean).map(expression => ({ id: expression.id, label: expression.label }));
        }
        const methodConnectivity = correspondence.stock.claims.filter(c => c.relationKind === 'ordered-port-binding');
        if (methodConnectivity.length) section('signals', 'Verified method connectivity', methodConnectivity.map(c => [c.role,
            `${c.method}: formal [${c.orderedBindings.map(b => b.formalValue).join(', ')}]; actual [${c.orderedBindings.map(b => b.actualValue).join(', ')}]`, 'verified-connectivity']));
        if (entity.signalDetails?.length) {
            sections.push({ id: 'signal-disclosure', title: 'Compiler port mappings', fields: [], sourceRefs: [],
                actions: [{ id: 'rtlSignals', kind: 'disclosure', open: !!disclosureState.rtlSignals,
                    label: disclosureState.rtlSignals ? 'Collapse RTL signals' : 'Expand RTL signals' }] });
            if (disclosureState.rtlSignals) section('rtl-signals', 'Actual compiler signals',
                entity.signalDetails.map(signal => [signal.port, `${signal.role} / ${signal.width} bits`, 'verified-connectivity']));
        }
        section('origin', 'Implementation correspondence', [['Contributor', correspondence.origin.claims.length ? 'Verified implementation contributor' : 'Unmapped', correspondence.origin.status],
            ...(correspondence.origin.claims.length ? [['Origin scope', 'Partial origin', 'partial']] : []),
            ['Complete origin set', 'Not established', 'unsupported']]);
        const actual = context.provider === 'instrumented' ? originModel?.entities[entity.id] : stockModel?.entities[entity.id];
        if (actual) {
            section('implementation', 'Actual implementation object', [['Name', actual.name || String(actual.value), 'verified-structure'],
                ['Type', actual.type || actual.kind, 'verified-structure'], ['Semantics', actual.semantics || 'Not applicable', actual.semantics || 'not-applicable']]);
            if (actual.rawBits) section('bits', 'Ordered bits', [['Provider vector', actual.rawBits.join(', '), 'verified-connectivity']]);
            if (actual.kind === 'cell') section('pins', 'Actual pins', actual.pins.map(id => {
                const pin = (context.provider === 'instrumented' ? originModel : stockModel).pins[id];
                return [pin.name, `${pin.direction || 'unknown'} [${pin.rawBits.join(', ')}]`, 'verified-connectivity'];
            }));
        }
        if (!selected && content.aliases?.length) section('aliases', 'Actual aliases', content.aliases.map(a => [a.name, `[${a.rawBits.join(', ')}]`, 'verified-connectivity']));
        const implementationAction = stockModel ? { sceneKind: 'rtl', implementationProvider: correspondence.origin.claims.length ? 'instrumented' : 'stock',
            rootInstanceId: ownerId, ownerInstanceId: ownerId, selectedEntityId: entity.id } : null;
        const members = entity.category === 'Interface' && !entity.continuation ? interfaceMembers(architecture, entity) : [];
        const relationOwner = module || architecture.occurrences[ownerId];
        const selectedRelations = entity.kind === 'semantic-connection' ? entity.members
            : architecture.relations[entity.id] ? [architecture.relations[entity.id]] : [];
        const relativePath = value => value?.startsWith(`${relationOwner.path}.`) ? value.slice(relationOwner.path.length + 1) : value;
        const endpointLabel = id => {
            const endpoint = architecture.entities[id], parent = architecture.occurrences[endpoint.ownerId || endpoint.ownerInstanceId];
            const parentLabel = parent && parent.id !== relationOwner.id ? relativePath(parent.path) : '';
            if (endpoint.interfacePath) return [parentLabel, ...endpoint.interfacePath].filter(Boolean).join('.') || endpoint.label;
            if (endpoint.path) return relativePath(endpoint.path);
            const behavior = sourceBehaviorById.get(id), name = [...(behavior?.interfacePath || []), endpoint.label].join('.');
            return [parentLabel, `${endpoint.kind} ${name}`].filter(Boolean).join('.');
        };
        const relationMembers = (module ? Object.values(architecture.relations).filter(relation => relation.ownerInstanceId === module.id) : selectedRelations)
            .map(relation => {
                const fromLabel = endpointLabel(relation.fromId), toLabel = endpointLabel(relation.toId);
                return { id: relation.id, kind: relation.kind, label: `${relation.kind}: ${fromLabel} / ${toLabel}`, fromLabel, toLabel,
                    fromId: relation.fromId, toId: relation.toId, sourceRefIds: relation.sourceRefs.map(ref => ref.id),
                    interaction: { kind: 'inspect', entityId: relation.id, relationId: relation.id } };
            });
        const labelCounts = new Map();
        for (const relation of relationMembers) labelCounts.set(relation.label, (labelCounts.get(relation.label) || 0) + 1);
        for (const relation of relationMembers) if (labelCounts.get(relation.label) > 1) {
            const original = architecture.relations[relation.id];
            const reference = sourceReferenceBySemanticId.get(original.expressionId)
                || sourceReferenceBySemanticId.get(original.statementId) || original.sourceRefs[0];
            const document = documentFor(reference);
            const before = document.content.slice(0, reference.range.start);
            relation.label += ` · ${reference.pathRef}:${before.split('\n').length}:${reference.range.start - before.lastIndexOf('\n')}`;
        }
        const repeatedLocations = new Map();
        for (const relation of relationMembers) {
            if (!repeatedLocations.has(relation.label)) repeatedLocations.set(relation.label, []);
            repeatedLocations.get(relation.label).push(relation);
        }
        for (const repeated of repeatedLocations.values()) if (repeated.length > 1)
            repeated.forEach((relation, index) => { relation.label += ` · #${index + 1}/${repeated.length}`; });
        let connectionEssentials = null, title = entity.label;
        if (selectedRelations.length) {
            const endpoints = field => [...new Set(selectedRelations.map(relation => relation[field]))].map(id => {
                const endpoint = architecture.entities[id], sourceOwner = architecture.occurrences[endpoint.ownerId || endpoint.ownerInstanceId];
                const behavior = sourceBehaviorById.get(id);
                return { id, label: endpointLabel(id), ownerInstanceId: sourceOwner.id, ownerPath: sourceOwner.path,
                    interfacePath: endpoint.interfacePath || (behavior ? [...behavior.interfacePath, behavior.name] : null) };
            });
            const family = entity.relationFamily || selectedRelations[0].kind;
            const meaning = ['constructor-binding', 'interface-forward', 'interface-return'].includes(family) ? 'binding' : 'source-relation';
            connectionEssentials = { family, meaning, direction: meaning === 'binding' ? 'binding' : entity.direction,
                ownerInstanceId: relationOwner.id, ownerPath: relationOwner.path, memberCount: selectedRelations.length,
                memberRelationIds: selectedRelations.map(relation => relation.id), from: endpoints('fromId'), to: endpoints('toId') };
            const caption = values => `${values[0].label}${values.length > 1 ? ` (+${values.length - 1})` : ''}`;
            title = `${family}: ${caption(connectionEssentials.from)} / ${caption(connectionEssentials.to)}`;
        }
        return { id: `inspector:${entity.id}`, title, connectionEssentials,
            interfaceMembers: members.map(member => ({ id: member.id, label: member.label, kind: member.kind,
                ownerInstanceId: member.ownerInstanceId, interfacePath: member.interfacePath, category: member.category,
                declaredType: member.declaredType, arguments: member.arguments, result: member.result,
                sourceRefs: member.sourceRefs, interaction: { kind: 'inspect', entityId: member.id } })),
            relationMembers,
            kind: ({ 'module-occurrence': 'BSV MODULE INSTANCE', storage: 'BSV STORAGE', 'method-contact': 'TYPED METHOD CONTACT',
                'semantic-connection': 'BSV RELATION', 'interface-contact': 'BSV INTERFACE GROUP',
                'rtl-connection': 'RTL VECTOR', 'constant-connection': 'RTL LITERAL VECTOR',
                'rtl-cell': 'RTL CELL', 'rtl-occurrence': 'RTL MODULE' })[entity.kind] || entity.kind,
            subtitle: entity.secondaryLabel || '', sourceExpanded: !module,
            status: entity.status || 'unknown', sections, sourceRefs, behaviorRefs, implementationAction, connectivity };
    }
    function getScene(input) {
        const intent = checkedJson(input);
        const allowed = ['buildId', 'snapshotId', 'queryGeneration', 'sceneKind', 'rootInstanceId', 'ownerInstanceId', 'selectedEntityId', 'selectedRelationId', 'implementationProvider', 'disclosureState', 'activePanel',
            'sceneId', 'occurrencePath', 'sourceContext', 'implementationContext', 'viewport'];
        if (!intent || Array.isArray(intent) || Object.keys(intent).some(k => !allowed.includes(k))) invalid('Unknown scene intent field');
        if (intent.buildId !== buildId) invalid('Foreign build');
        if (!allowedSnapshots.has(intent.snapshotId)) throw failure('SNAPSHOT_MISMATCH', 'Foreign request snapshot');
        if (!Number.isSafeInteger(intent.queryGeneration) || intent.queryGeneration < 0) invalid('Invalid query generation');
        const sceneKind = intent.sceneKind || 'bsv', provider = intent.implementationProvider || 'stock';
        if (!['bsv', 'rtl'].includes(sceneKind) || !['stock', 'instrumented'].includes(provider)) invalid('Unknown scene/provider');
        if (sceneKind === 'rtl' && !stockModel) throw failure('UNAVAILABLE', 'Implementation artifact is not attached');
        if (provider === 'instrumented' && !originModel) throw failure('UNSUPPORTED', 'Instrumented capture not attached');
        for (const key of ['rootInstanceId', 'ownerInstanceId', 'selectedEntityId', 'selectedRelationId', 'activePanel']) if (intent[key] != null && typeof intent[key] !== 'string') invalid(`Invalid ${key}`);
        if (intent.disclosureState != null && (typeof intent.disclosureState !== 'object' || Array.isArray(intent.disclosureState))) invalid('Invalid disclosure state');
        const selectedId = intent.selectedRelationId || intent.selectedEntityId || null;
        const sourceRoot = architecture.occurrences[intent.rootInstanceId] ? intent.rootInstanceId : null;
        let ownerId = intent.ownerInstanceId || sourceRoot || defaultRoot;
        ownerId = intent.ownerInstanceId || resolveSourceOwner(selectedId, ownerId);
        if (!ownerId) throw failure(roots.length > 1 ? 'AMBIGUOUS_ROOT' : 'UNAVAILABLE', roots.length > 1 ? 'Select an explicit source root' : 'No source root is available');
        if (!architecture.occurrences[ownerId]) invalid('Unknown BSV owner');
        const context = contexts.get(ownerId), stockOccurrenceId = context?.contextOccurrenceId;
        if (intent.rootInstanceId && !sourceRoot && !stockModel?.occurrences[intent.rootInstanceId]
            && !originModel?.occurrences[intent.rootInstanceId]) invalid('Unknown root occurrence');
        const model = sceneKind === 'rtl' && provider === 'instrumented' ? originModel : stockModel;
        let selected = architecture.entities[selectedId] || null;
        const visibleOwners = new Set([ownerId, ...architecture.occurrences[ownerId].children]);
        if (selected?.ownerInstanceId && (!visibleOwners.has(selected.ownerInstanceId)
            || selected.kind === 'storage' && selected.ownerInstanceId !== ownerId)) invalid('Selected source entity belongs to another owner');
        if (selected && !selected.ownerInstanceId && selected.definitionId && !architecture.occurrences[ownerId].behaviorIds.some(id => architecture.behaviors[id].definitionId === selected.definitionId)) invalid('Source operation belongs to another owner');
        let origins = originResult(selected, ownerId, provider);
        let rootId = sceneKind === 'bsv' ? ownerId : null;
        if (sceneKind === 'bsv' && intent.rootInstanceId && !sourceRoot) invalid('Unknown source occurrence');
        if (sceneKind === 'rtl') {
            const requested = intent.implementationContext;
            if (requested != null && (typeof requested !== 'object' || Array.isArray(requested))) invalid('Invalid implementation context');
            if (requested) {
                if (requested.snapshotId !== model.snapshot.id) throw failure('SNAPSHOT_MISMATCH', 'Foreign implementation context snapshot');
                if (requested.provider != null && requested.provider !== provider
                    || requested.modelId != null && requested.modelId !== model.id
                    || requested.stage != null && requested.stage !== model.snapshot.stage
                    || requested.ownerInstanceId != null && requested.ownerInstanceId !== ownerId) invalid('Contradictory implementation context');
            }
            if (requested?.contextOccurrenceId) {
                rootId = requested.contextOccurrenceId;
                if (!model.occurrences[rootId]) invalid('Unknown implementation context');
                if (intent.rootInstanceId && !sourceRoot && intent.rootInstanceId !== rootId) invalid('Contradictory implementation targets');
            } else if (intent.rootInstanceId && model.occurrences[intent.rootInstanceId]) rootId = intent.rootInstanceId;
            else {
                if (intent.rootInstanceId && !sourceRoot) invalid('Foreign implementation occurrence');
                if (provider === 'stock') rootId = stockOccurrenceId;
                else {
                    const path = stockModel.occurrences[stockOccurrenceId]?.path;
                    rootId = origins.claims[0]?.target.occurrenceId || Object.values(model.occurrences).find(o => stable(o.path) === stable(path))?.id;
                }
            }
            if (!rootId || !model.occurrences[rootId]) throw failure('UNMAPPED', 'No implementation context available');
            // Accept the old child-entry request (both IDs equal), but never use its
            // claimed anchor as evidence. The BSV anchor comes only from G3 below.
            if (requested?.implementationOccurrenceId != null
                && requested.implementationOccurrenceId !== rootId
                && requested.implementationOccurrenceId !== context?.implementationOccurrenceId) invalid('Contradictory BSV implementation anchor');
        }
        const content = sceneKind === 'bsv' ? bsvContent(architecture, rootId, intent.disclosureState || {}, selectedId) : rtlContent(model, rootId, ownerId);
        if (!selected && selectedId) selected = [...content.connections, content.shell, ...content.children, ...content.contacts,
            ...(content.interfaceGroups || [])].find(e => e.id === selectedId) || null;
        if (sceneKind === 'bsv' && selected && (selected.kind === 'semantic-connection' || architecture.relations[selected.id])) {
            const members = selected.kind === 'semantic-connection'
                ? selected.memberRelationIds.map(id => architecture.relations[id]) : [architecture.relations[selected.id]];
            const sourceRefs = [...new Map(members.flatMap(member => member.sourceRefs).map(ref => [ref.id, ref])).values()];
            selected = { ...selected, members, sourceRefs };
        }
        if (!selected && selectedId && model?.entities[selectedId] && sceneKind === 'rtl') {
            const item = model.entities[selectedId];
            selected = { id: item.id, kind: item.kind, label: item.name || String(item.value), sourceRefs: [], secondaryLabel: item.type || '', status: 'verified-structure' };
        }
        if (selectedId && !selected) invalid('Unknown or foreign selected entity/relation');
        if (sceneKind === 'rtl' && model.entities[selectedId]) {
            const actual = model.entities[selectedId];
            if (actual.id !== rootId && actual.occurrenceId !== rootId && actual.parentId !== rootId
                && !content.contacts.some(contact => contact.id === selectedId)) invalid('Selected implementation entity belongs to another occurrence');
        }
        origins = originResult(selected, ownerId, provider);
        const stockCorrespondence = stockResult(selected);
        const highlights = sceneKind === 'rtl' && provider === 'instrumented' ? origins.claims.map(c => c.target.entityId)
            : sceneKind === 'rtl' ? [...new Set(stockCorrespondence.claims.flatMap(c =>
                [c.tuple.target.entityId, c.bitId, ...(c.orderedBindings || []).flatMap(b => [b.formalBitId, b.actualBitId])]).filter(id => model.entities[id]))] : [];
        const actualOccurrence = model?.occurrences[sceneKind === 'bsv' ? stockOccurrenceId : rootId];
        let actualRoot = actualOccurrence;
        while (actualRoot?.parentId) actualRoot = model.occurrences[actualRoot.parentId];
        const implementationContext = { provider: sceneKind === 'bsv' ? 'stock' : provider, snapshotId: model?.snapshot.id ?? null, modelId: model?.id ?? null,
            ownerInstanceId: ownerId, implementationOccurrenceId: context?.implementationOccurrenceId || null,
            implementationSnapshotId: stockModel?.snapshot.id ?? null,
            stage: model?.snapshot.stage ?? null, providerIdentity: model?.snapshot.providerIdentity ?? null,
            rootOccurrenceId: actualRoot?.id || null, parentOccurrenceId: actualOccurrence?.parentId || null,
            contextOccurrenceId: sceneKind === 'bsv' ? stockOccurrenceId || null : rootId,
            occurrencePath: sceneKind === 'bsv' ? stockModel?.occurrences[stockOccurrenceId]?.path || [] : model.occurrences[rootId].path,
            ownership: context?.ownership || 'unmapped', highlightEntityIds: [...new Set(highlights)],
            status: !stockModel ? 'not-attached' : sceneKind === 'rtl' && provider === 'instrumented' ? origins.claims.length ? 'verified-contributor-context' : 'unmapped-source-context'
                : context?.ownership === 'retained-boundary' ? 'verified-boundary' : context?.contextOccurrenceId ? 'containing-only' : 'unmapped' };
        const correspondence = { stock: stockCorrespondence, origin: origins };
        const inspector = inspectorFor(selected, ownerId, implementationContext, correspondence, content, intent.disclosureState || {});
        const sourceRevision = architecture.occurrences[ownerId].sourceRefs[0].revision;
        let sourceSelection = sceneKind === 'rtl' && model.entities[selectedId] ? null : selected;
        if (sceneKind === 'rtl' && intent.sourceContext) {
            if (intent.sourceContext.ownerInstanceId !== ownerId
                || intent.sourceContext.snapshotId != null && intent.sourceContext.snapshotId !== stockModel.snapshot.id
                || intent.sourceContext.buildId != null && intent.sourceContext.buildId !== buildId) invalid('Foreign BSV source context');
            const id = intent.sourceContext.selectedRelationId || intent.sourceContext.selectedEntityId;
            sourceSelection = architecture.entities[id] || null;
            if (id && !sourceSelection) {
                const sourceContent = bsvContent(architecture, ownerId, {});
                sourceSelection = [...sourceContent.connections, ...sourceContent.interfaceGroups].find(item => item.id === id) || null;
            }
            if (id && (!sourceSelection || sourceSelection.ownerInstanceId && !visibleOwners.has(sourceSelection.ownerInstanceId))) invalid('Foreign BSV source selection');
        }
        const sourceRootId = sourceRoot || intent.sourceContext?.rootInstanceId || ownerId;
        const ancestors = new Set();
        for (let owner = architecture.occurrences[ownerId]; owner; owner = architecture.occurrences[owner.parentInstanceId]) ancestors.add(owner.id);
        if (!ancestors.has(sourceRootId) || intent.sourceContext?.rootInstanceId != null
            && intent.sourceContext.rootInstanceId !== sourceRootId) invalid('Foreign BSV source root');
        const sourceContext = { buildId, provider: 'stock', snapshotId: stockModel?.snapshot.id ?? null, rootInstanceId: sourceRootId,
            ownerInstanceId: ownerId, occurrencePath: architecture.occurrences[ownerId].path.split('.'), sourceRevision,
            selectedEntityId: sourceSelection && !sourceSelection.members ? sourceSelection.id : null,
            selectedRelationId: sourceSelection?.members ? sourceSelection.id : null,
            sourceRefs: sourceSelection?.sourceRefs || [] };
        const result = buildScene({ buildId, label, architecture, intent: { ...intent, sceneKind }, model, rootId, ownerId,
            context: implementationContext, correspondence, inspector, selected, sourceRevision, sourceContext, preparedContent: content });
        return deepFreeze({ requestSnapshotId: input.snapshotId, queryGeneration: input.queryGeneration, scene: result });
    }
    // Resolve an explicit actual-object Reveal, not source correspondence. A containing
    // context may authorize a view without owning any of its cells (notably inlined BSV).
    function revealAnalysisTarget(input) {
        const request = checkedJson(input, { ...DEFAULT_LIMITS, maxBytes: 16384, maxJsonDepth: 12, maxJsonNodes: 1024 });
        const fields = ['buildId', 'snapshotId', 'queryGeneration', 'implementationProvider', 'rootInstanceId', 'ownerInstanceId', 'target'];
        if (!request || Array.isArray(request) || Object.keys(request).some(key => !fields.includes(key))) invalid('Invalid analysis reveal fields');
        if (request.buildId !== buildId) invalid('Foreign reveal build');
        if (!Number.isSafeInteger(request.queryGeneration) || request.queryGeneration < 0) invalid('Invalid reveal generation');
        const provider = request.implementationProvider;
        if (!['stock', 'instrumented'].includes(provider)) invalid('Unknown reveal provider');
        const model = provider === 'stock' ? stockModel : originModel;
        if (!model) throw failure('UNSUPPORTED', 'Instrumented capture not attached');
        if (request.snapshotId !== model.snapshot.id) throw failure('SNAPSHOT_MISMATCH', 'Foreign reveal snapshot/provider');
        const target = request.target;
        if (!target || Array.isArray(target) || Object.keys(target).some(key => !['entityId', 'occurrenceId', 'snapshotId', 'provider'].includes(key))
            || ['entityId', 'occurrenceId', 'snapshotId', 'provider'].some(key => typeof target[key] !== 'string' || !target[key])) invalid('Invalid reveal target');
        if (target.snapshotId !== request.snapshotId) throw failure('SNAPSHOT_MISMATCH', 'Foreign reveal target snapshot');
        if (target.provider !== provider) invalid('Foreign reveal target provider');
        const actual = model.entities[target.entityId];
        if (!actual || !model.occurrences[target.occurrenceId]
            || (actual.kind === 'occurrence' ? actual.id : actual.occurrenceId) !== target.occurrenceId) invalid('Unknown or contradictory actual reveal target');
        if (typeof request.ownerInstanceId !== 'string' || !architecture.occurrences[request.ownerInstanceId]) invalid('Unknown reveal BSV owner');
        const ancestors = [];
        for (let owner = architecture.occurrences[request.ownerInstanceId]; owner; owner = architecture.occurrences[owner.parentInstanceId]) ancestors.push(owner.id);
        const sourceRoot = request.rootInstanceId ?? request.ownerInstanceId;
        if (!ancestors.includes(sourceRoot)) invalid('Foreign reveal BSV root');
        const envelope = { requestSnapshotId: request.snapshotId, queryGeneration: request.queryGeneration, target };
        const unresolved = status => deepFreeze({ ...envelope, status, intent: null,
            context: { status, previousOwnerInstanceId: request.ownerInstanceId, ownerInstanceId: null,
                ownerChanged: false, anchorOccurrenceId: null, ownership: 'unmapped' } });
        const targetAncestors = new Set();
        for (let occurrence = model.occurrences[target.occurrenceId]; occurrence; occurrence = model.occurrences[occurrence.parentId]) targetAncestors.add(occurrence.id);
        for (const ownerInstanceId of ancestors) {
            const sourceContext = contexts.get(ownerInstanceId);
            const stockOccurrence = stockModel.occurrences[sourceContext?.contextOccurrenceId];
            if (!stockOccurrence) continue;
            // This is the exact captured occurrence-path join already used by getScene,
            // never label similarity, connectivity, origin coverage, or a synthetic anchor.
            if (provider === 'instrumented') {
                const matches = Object.values(model.occurrences).filter(o => stable(o.path) === stable(stockOccurrence.path));
                if (matches.length > 1) return unresolved('ambiguous');
                if (!matches.length) continue;
            }
            const ownerIntent = { buildId, snapshotId: request.snapshotId, queryGeneration: request.queryGeneration,
                sceneKind: 'rtl', implementationProvider: provider, ownerInstanceId, rootInstanceId: ownerInstanceId };
            const anchor = getScene(ownerIntent).scene.implementationContext.contextOccurrenceId;
            if (!targetAncestors.has(anchor)) continue;
            const ownerChanged = ownerInstanceId !== request.ownerInstanceId;
            const intent = { ...ownerIntent, rootInstanceId: ownerChanged ? ownerInstanceId : sourceRoot,
                implementationContext: { snapshotId: model.snapshot.id, contextOccurrenceId: target.occurrenceId },
                selectedEntityId: target.entityId, selectedRelationId: null };
            getScene(intent); // Ordinary Scene Query remains the final selection/scene authority.
            return deepFreeze({ ...envelope, status: 'resolved', intent,
                context: { status: ownerChanged ? 'owner-broadened' : 'owner-preserved', previousOwnerInstanceId: request.ownerInstanceId,
                    ownerInstanceId, ownerChanged, anchorOccurrenceId: anchor, ownership: sourceContext.ownership } });
        }
        return unresolved('unavailable');
    }
    function getSource(input) {
        const ref = checkedJson(input), known = allowedSourceRefs.get(ref.id);
        if (!known) throw failure('INVALID_RANGE', 'Source reference was not supplied by this scene query');
        if (ref.revision !== known.revision || ref.pathRef !== known.pathRef) throw failure('SOURCE_REVISION_MISMATCH', 'Foreign source document/revision');
        if (stable(ref.range) !== stable(known.range) || ref.sliceHash !== known.sliceHash) throw failure('INVALID_RANGE', 'Altered source range');
        const binding = bindings.find(b => b.originPathRef === known.pathRef && b.originRevision === known.revision);
        const document = documentFor(known) || (binding && architecture.source.sourceDocuments.find(d => d.relativePath === binding.sourcePathRef && d.revision === binding.sourceRevision));
        if (!document || hash(document.content) !== known.revision) throw failure('SOURCE_REVISION_MISMATCH', 'Source bytes unavailable');
        const text = document.content.slice(known.range.start, known.range.end);
        if (hash(text) !== known.sliceHash) throw failure('INVALID_RANGE', 'Source slice mismatch');
        return deepFreeze({ ...known, text, readOnly: true, freshness: analysis.freshness.status, convention: 'utf16-0-based-half-open' });
    }
    let analysisQuery;
    const getAnalysisQuery = () => analysisQuery ||= require('./analysis').createAnalysisQuery({
        importResult, analysis, originCase, sourceBindings: bindings
    });
    return Object.freeze({ getScene, getSource, revealAnalysisTarget, inspect: intent => getScene(intent).scene.inspector,
        async analyze(input, options) {
            const result = await getAnalysisQuery().query(input, options);
            if (result.status !== 'stale') for (const ref of result.sourceRefs) allowedSourceRefs.set(ref.id, ref);
            return result;
        },
        getAnalysisContext: provider => getAnalysisQuery().getContext(provider),
        getRootCandidates: () => deepFreeze(roots),
        getCatalogEntry: () => deepFreeze({ buildId, label, snapshotId: stockModel?.snapshot.id ?? null, rootInstanceId: defaultRoot,
            sourceRevision: defaultRoot ? architecture.occurrences[defaultRoot].sourceRefs[0].revision : null,
            ...(!stockModel ? { sceneKind: 'bsv', presentationIdentity: `source-model-${analysis.sourceModelIdentity}` } : {}),
            implementationProviders: ['stock', ...(originCase ? ['instrumented'] : [])] }) });
}
module.exports = { createSceneQuery };
