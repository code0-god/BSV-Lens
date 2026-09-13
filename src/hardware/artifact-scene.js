'use strict';
const { createAnalysisQuery } = require('./analysis');
const { checkedJson } = require('./correspondence/schema');
const { deepFreeze, failure } = require('./json');
const { rtlContent, buildScene } = require('./scene');
const invalid = message => { throw failure('INVALID_INPUT', message); };
const ENTRY_LIMIT = 128;

function createArtifactSceneQuery({ buildId, label, importResult, defaultRootInstanceId }) {
    const analysis = createAnalysisQuery({ importResult }), model = importResult.implementation;
    const context = analysis.getContext('stock');
    const roots = model.roots.map(id => ({ id, label: model.occurrences[id].name,
        path: model.occurrences[id].path, sceneKind: 'rtl', sourceRevision: null, snapshotId: model.snapshot.id }));
    const entries = [], totalCandidates = roots.length + model.roots.reduce((sum, id) => sum + model.occurrences[id].children.length, 0);
    function addEntry(id, designRootId) {
        if (entries.length >= ENTRY_LIMIT) return;
        const occurrence = model.occurrences[id];
        entries.push({ id, label: occurrence.name, path: occurrence.path, parentId: occurrence.parentId,
            designRootId, isDesignRoot: id === designRootId, sceneKind: 'rtl', sourceRevision: null, snapshotId: model.snapshot.id });
    }
    for (const id of model.roots) addEntry(id, id);
    for (const rootId of model.roots) for (const id of model.occurrences[rootId].children) addEntry(id, rootId);
    const entryCandidates = deepFreeze({ entries, status: totalCandidates > ENTRY_LIMIT ? 'limited' : 'complete',
        limit: ENTRY_LIMIT, totalCandidates, omitted: Math.max(0, totalCandidates - ENTRY_LIMIT) });
    if (defaultRootInstanceId !== null && !model.roots.includes(defaultRootInstanceId)
        && !entries.some(entry => entry.id === defaultRootInstanceId)) invalid('Unknown default RTL entry');
    const defaultEntry = defaultRootInstanceId || (roots.length === 1 ? roots[0].id : null);
    const defaultRoot = entries.find(entry => entry.id === defaultEntry)?.designRootId
        || (model.roots.includes(defaultEntry) ? defaultEntry : null);
    const correspondence = deepFreeze({ stock: { analysisId: context.analysisId, sourceModelIdentity: null,
        resolution: 'unmapped', claims: [], candidates: [], unresolved: [], freshness: { status: 'not-attached' }, coverage: null },
        origin: { available: false, resolution: 'unsupported', claims: [], coverage: null,
            completeOriginSet: 'not-established', status: 'unmapped', limitations: ['Source and origin evidence are not attached'] } });
    function isInside(id, root) {
        for (let item = model.occurrences[id]; item; item = model.occurrences[item.parentId]) if (item.id === root) return true;
        return false;
    }
    function inspect(selected, content, occurrence) {
        const entity = selected || content.shell, actual = model.entities[entity.id];
        const fields = [['Actual RTL path', occurrence.path.join('/')], ['Object', entity.secondaryLabel || entity.label],
            ['Type', actual?.type || actual?.kind || entity.kind], ['Source', 'Not attached'], ['Stage', model.snapshot.stage ?? 'Unknown']];
        if (entity.rawBits) fields.push(['Ordered bits', `[${entity.rawBits.join(', ')}]`]);
        const rows = fields.map(([label, value]) => ({ label, value, status: label === 'Source' ? 'not-attached' : 'verified-structure' }));
        const connectivity = entity.bits && entity.members ? { id: entity.id, snapshotId: model.snapshot.id,
            occurrenceId: occurrence.id, bits: entity.bits, rawBits: entity.rawBits, incidences: entity.incidences,
            members: entity.members, aliases: entity.aliases, ordering: entity.ordering } : null;
        return { id: `inspector:${entity.id}`, title: entity.label, subtitle: entity.secondaryLabel || '', kind: entity.kind,
            status: entity.status || 'verified-structure', sourceExpanded: false, sourceRefs: [], behaviorRefs: [],
            implementationAction: null, connectivity, sections: [{ id: 'implementation', title: 'Actual implementation object', fields: rows,
                rows, sourceRefs: [], actions: [] }] };
    }
    function getScene(input) {
        const intent = checkedJson(input), allowed = ['buildId', 'snapshotId', 'queryGeneration', 'sceneKind', 'rootInstanceId',
            'ownerInstanceId', 'selectedEntityId', 'selectedRelationId', 'implementationProvider', 'disclosureState', 'activePanel',
            'sceneId', 'occurrencePath', 'sourceContext', 'implementationContext', 'viewport'];
        if (!intent || Array.isArray(intent) || Object.keys(intent).some(key => !allowed.includes(key))) invalid('Unknown scene intent field');
        if (intent.buildId !== buildId) invalid('Foreign build');
        if (intent.snapshotId !== model.snapshot.id) throw failure('SNAPSHOT_MISMATCH', 'Foreign request snapshot');
        if (!Number.isSafeInteger(intent.queryGeneration) || intent.queryGeneration < 0) invalid('Invalid query generation');
        if (intent.sceneKind !== undefined && !['bsv', 'rtl'].includes(intent.sceneKind)) invalid('Unknown scene kind');
        if (intent.sceneKind === 'bsv') throw failure('UNAVAILABLE', 'Source is not attached');
        if (intent.implementationProvider != null && intent.implementationProvider !== 'stock') throw failure('UNSUPPORTED', 'Requested provider is not attached');
        if (intent.ownerInstanceId != null || intent.sourceContext != null) invalid('Artifact-only scene has no BSV owner');
        for (const key of ['rootInstanceId', 'selectedEntityId', 'selectedRelationId', 'activePanel']) if (intent[key] != null && typeof intent[key] !== 'string') invalid(`Invalid ${key}`);
        if (intent.disclosureState != null && (typeof intent.disclosureState !== 'object' || Array.isArray(intent.disclosureState))) invalid('Invalid disclosure state');
        const root = intent.rootInstanceId || defaultRoot;
        if (!root) throw failure(roots.length > 1 ? 'AMBIGUOUS_ROOT' : 'UNAVAILABLE', 'Select an explicit RTL root');
        if (!model.roots.includes(root)) invalid('Unknown RTL root');
        const requested = intent.implementationContext;
        if (requested != null && (typeof requested !== 'object' || Array.isArray(requested))) invalid('Invalid implementation context');
        if (requested && requested.snapshotId !== model.snapshot.id) throw failure('SNAPSHOT_MISMATCH', 'Foreign implementation context snapshot');
        if (requested && (requested.provider != null && requested.provider !== 'stock' || requested.modelId != null && requested.modelId !== model.id
            || requested.stage != null && requested.stage !== model.snapshot.stage || requested.ownerInstanceId != null)) invalid('Contradictory implementation context');
        const occurrence = model.occurrences[requested?.contextOccurrenceId || (root === defaultRoot ? defaultEntry : root)];
        if (!occurrence || !isInside(occurrence.id, root)) invalid('Implementation occurrence is outside selected root');
        const content = rtlContent(model, occurrence.id, null), selectedId = intent.selectedRelationId || intent.selectedEntityId || null;
        let selected = selectedId ? [content.shell, ...content.children, ...content.contacts, ...content.connections].find(item => item.id === selectedId) : null;
        if (!selected && selectedId) {
            const actual = model.entities[selectedId];
            if (!actual || actual.occurrenceId !== occurrence.id) invalid('Unknown or foreign selected implementation object');
            selected = { id: actual.id, kind: actual.kind, label: actual.name || String(actual.value), secondaryLabel: actual.type || '',
                sourceRefs: [], status: 'verified-structure', ...(actual.rawBits ? { rawBits: actual.rawBits } : {}) };
        }
        const implementationContext = { provider: 'stock', snapshotId: model.snapshot.id, modelId: model.id,
            ownerInstanceId: null, implementationOccurrenceId: null, implementationSnapshotId: model.snapshot.id,
            stage: model.snapshot.stage, providerIdentity: model.snapshot.providerIdentity, rootOccurrenceId: root,
            parentOccurrenceId: occurrence.parentId, contextOccurrenceId: occurrence.id, occurrencePath: occurrence.path,
            ownership: 'unmapped', highlightEntityIds: [], status: 'source-not-attached' };
        const scene = buildScene({ buildId, label, architecture: null, intent: { ...intent, rootInstanceId: root, sceneKind: 'rtl' },
            model, rootId: occurrence.id, ownerId: null, context: implementationContext, correspondence,
            inspector: inspect(selected, content, occurrence), selected, sourceRevision: null, sourceContext: null });
        return deepFreeze({ requestSnapshotId: intent.snapshotId, queryGeneration: intent.queryGeneration, scene });
    }
    function revealAnalysisTarget(input) {
        const request = checkedJson(input), allowed = ['buildId', 'snapshotId', 'queryGeneration', 'implementationProvider', 'rootInstanceId', 'ownerInstanceId', 'target'];
        if (!request || Array.isArray(request) || Object.keys(request).some(key => !allowed.includes(key))) invalid('Invalid analysis reveal fields');
        if (request.buildId !== buildId || request.ownerInstanceId != null || request.implementationProvider !== 'stock') invalid('Foreign reveal context');
        if (request.snapshotId !== model.snapshot.id) throw failure('SNAPSHOT_MISMATCH', 'Foreign reveal snapshot');
        if (!Number.isSafeInteger(request.queryGeneration) || request.queryGeneration < 0) invalid('Invalid reveal generation');
        const target = request.target;
        if (!target || Array.isArray(target) || Object.keys(target).some(key => !['entityId', 'occurrenceId', 'snapshotId', 'provider'].includes(key))
            || ['entityId', 'occurrenceId', 'snapshotId', 'provider'].some(key => typeof target[key] !== 'string' || !target[key])) invalid('Invalid reveal target');
        const actual = model.entities[target.entityId];
        if (target.snapshotId !== model.snapshot.id || target.provider !== 'stock' || !actual
            || (actual.kind === 'occurrence' ? actual.id : actual.occurrenceId) !== target.occurrenceId) invalid('Foreign reveal target');
        const root = request.rootInstanceId || defaultRoot;
        if (!model.roots.includes(root)) invalid('Unknown reveal root');
        const envelope = { requestSnapshotId: request.snapshotId, queryGeneration: request.queryGeneration, target };
        if (!isInside(target.occurrenceId, root)) return deepFreeze({ ...envelope, status: 'unavailable', intent: null,
            context: { status: 'outside-selected-root', previousOwnerInstanceId: null, ownerInstanceId: null, ownerChanged: false,
                anchorOccurrenceId: root, ownership: 'unmapped' } });
        const intent = { buildId, snapshotId: model.snapshot.id, queryGeneration: request.queryGeneration, sceneKind: 'rtl',
            implementationProvider: 'stock', rootInstanceId: root, ownerInstanceId: null, selectedEntityId: actual.id, selectedRelationId: null,
            implementationContext: { snapshotId: model.snapshot.id, contextOccurrenceId: target.occurrenceId } };
        getScene(intent);
        return deepFreeze({ ...envelope, status: 'resolved', intent,
            context: { status: 'owner-preserved', previousOwnerInstanceId: null, ownerInstanceId: null, ownerChanged: false,
                anchorOccurrenceId: root, ownership: 'unmapped' } });
    }
    return Object.freeze({ getScene, inspect: input => getScene(input).scene.inspector, revealAnalysisTarget,
        getSource() { throw failure('UNAVAILABLE', 'Source is not attached'); },
        analyze: (input, options) => analysis.query(input, options), getAnalysisContext: provider => analysis.getContext(provider),
        getRootCandidates: () => deepFreeze(roots), getEntryCandidates: () => entryCandidates,
        getCatalogEntry: () => deepFreeze({ buildId, label, snapshotId: model.snapshot.id,
            rootInstanceId: defaultRoot, entryOccurrenceId: defaultEntry, ownerInstanceId: null, sourceRevision: null, sceneKind: 'rtl', implementationProviders: ['stock'] }) });
}
module.exports = { createArtifactSceneQuery };
