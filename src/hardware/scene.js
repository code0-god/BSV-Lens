'use strict';
const hardware = require('./index');
const { hash, stable, deepFreeze } = require('./json');
const { summarizeRelations } = require('./scene-summary');
const { projectBoundary } = require('./scene-overview');

function familySummary(item) {
    const dimensions = item.family?.dimensions;
    if (!dimensions?.length) return null;
    const kind = item.kind === 'module-occurrence' ? 'Module'
        : { register: 'Reg', fifo: 'FIFO', memory: 'Memory' }[item.primitiveKind] || 'Storage';
    const exact = item.family.resolutionStatus === 'exact' && item.multiplicity?.status === 'exact'
        && dimensions.every(dimension => dimension.status === 'concrete');
    if (exact && dimensions.length === 1) return `${kind} × ${item.multiplicity.count}`;
    if (exact) return `${kind} array · ${dimensions.map(dimension => dimension.size).join(' × ')}`;
    const status = item.family.resolutionStatus === 'symbolic' ? 'symbolic' : 'unresolved';
    return `${kind} array · ${dimensions.length}D · ${status}`;
}
function display(item, disclosureState = {}) {
    const { context, method, ...visible } = item;
    return { ...visible, ...(item.family ? { displaySecondaryLabel: familySummary(item) } : {}), detail: item.secondaryLabel,
        ...(item.signalDetails ? { signalDetails: disclosureState.rtlSignals ? item.signalDetails : [] } : {}) };
}
function repeatedElementScope(root, disclosureState = {}) {
    if (!root.family) return null;
    const dimensions = root.family.dimensions.map(dimension => ({ expression: dimension.expression,
        status: dimension.status, min: 0,
        maxExclusive: dimension.status === 'concrete' ? dimension.indexDomain?.upperExclusive ?? dimension.size : null }));
    const selectedIndices = disclosureState.presentation?.familyElementIndices || null;
    const markers = selectedIndices || dimensions.map(() => '*');
    const elementLabel = `${root.label}${markers.map(index => `[${index}]`).join('')}`;
    return { familyInstanceId: root.id,
        kind: selectedIndices ? 'indexed-representative' : root.family.resolutionStatus === 'exact' ? 'representative' : 'symbolic-element',
        dimensions: dimensions.map(dimension => dimension.expression), indexDomains: dimensions,
        selectedIndices, elementIdentity: `${root.id}${markers.map(index => `[${index}]`).join('')}`,
        elementLabel, elementType: root.family.leafType };
}
function bsvContent(architecture, rootId, disclosureState, selectedId = null) {
    const root = architecture.occurrences[rootId];
    const familyScope = repeatedElementScope(root, disclosureState);
    const boundary = projectBoundary(architecture, rootId, item => display(item, disclosureState));
    const summary = summarizeRelations(architecture, rootId, boundary.endpoint, selectedId);
    return { shell: { ...display(root), ...(familyScope ? { label: familyScope.elementLabel } : {}), expanded: true }, children: root.children.map(id => ({ ...display(architecture.occurrences[id]), expanded: false })),
        storages: root.storages.map(id => display(architecture.storage[id])),
        contacts: boundary.contacts, interfaceGroups: boundary.interfaceGroups, connections: summary.connections, aliases: [],
        projection: { kind: 'bsv-overview', ownerInstanceId: rootId, sourceRevision: root.sourceRefs[0].revision,
            canonicalRelationIds: summary.canonicalRelationIds, summaryRelationIds: summary.connections.flatMap(connection => connection.memberRelationIds),
            foldedRelationIds: summary.foldedRelationIds, scopeOutsideRelationIds: summary.scopeOutsideRelationIds,
            continuationRelationIds: summary.continuationRelationIds, foldedContactIds: boundary.foldedContactIds,
            ...(familyScope ? { familyScope } : {}),
            ...(summary.stateRelations ? { stateRelations: summary.stateRelations } : {}) } };
}
function rtlContent(model, rootId, sourceOwnerId) {
    const root = model.occurrences[rootId];
    function object(item, expanded = false) {
        const occurrence = item.kind === 'occurrence';
        const type = occurrence ? model.definitions[item.definitionId].name : item.type;
        return { id: item.id, kind: occurrence ? 'rtl-occurrence' : 'rtl-cell', label: occurrence ? item.name : type,
            secondaryLabel: occurrence ? type : item.name, detail: type, type, expanded,
            ownerInstanceId: sourceOwnerId, sourceRefs: [], semanticRefs: [], providerRefs: item.providerRefs,
            interaction: { kind: occurrence && !item.blackbox && item.cells.length ? 'enter' : 'inspect', entityId: item.id },
            status: item.blackbox ? 'black-box' : occurrence ? 'verified-structure' : 'unknown-semantics', blackbox: !!item.blackbox,
            parameters: occurrence ? model.definitions[item.definitionId].parameters : item.parameters };
    }
    const children = root.cells.map(id => model.cells[id]).map(c => c.childOccurrenceId ? model.occurrences[c.childOccurrenceId] : c);
    const subjects = [root, ...children], contacts = [], endpointMap = new Map();
    for (const item of subjects) {
        const ports = item.kind === 'occurrence' ? hardware.getPorts(model, item.id) : item.pins.map(id => model.pins[id]);
        for (const port of ports) {
            contacts.push({ id: port.id, kind: 'rtl-contact', label: port.name,
                secondaryLabel: `${port.direction || 'unknown'} [${port.bits.length}]`, detail: `${port.direction || 'unknown'} [${port.bits.length}]`,
                ownerId: item.id, ownerInstanceId: sourceOwnerId, direction: port.direction || 'unknown', category: 'RTL',
                declaredType: null, concreteType: null, arguments: [], result: { status: 'not-applicable', type: null }, signalDetails: [],
                bits: port.bits, rawBits: port.rawBits, sourceRefs: [], semanticRefs: [], providerRefs: port.providerRefs,
                status: 'verified-connectivity', interaction: { kind: 'inspect', entityId: port.id } });
            endpointMap.set(port.id, port.id);
            if (item.kind === 'occurrence') for (const id of item.boundaries) {
                const binding = model.boundaries[id];
                if (binding.portId === port.id) endpointMap.set(binding.pinId, port.id);
            }
        }
    }
    const groups = new Map();
    for (const net of hardware.getNetEndpoints(model, root.id, root.bits)) {
        const key = net.endpoints.length ? stable({ kind: net.kind,
            endpoints: net.endpoints.map(e => [e.entityId, e.kind, e.direction, e.role]) }) : net.bitId;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(net);
    }
    const connections = [...groups.values()].map(members => {
        const bits = members.map(m => m.bitId), aliasIds = [...new Set(members.flatMap(m => m.aliases.map(a => a.aliasId)))];
        const exactAlias = aliasIds.map(id => model.aliases[id]).find(a => a.bits.length === bits.length && new Set(a.bits).size === bits.length && a.bits.every(id => bits.includes(id)));
        const orderedBits = exactAlias ? exactAlias.bits : bits;
        const ordered = orderedBits.map(id => members.find(m => m.bitId === id));
        const endpointIds = [...new Set(ordered.flatMap(m => m.endpoints.map(e => endpointMap.get(e.entityId)).filter(Boolean)))];
        const incidences = endpointIds.map(contactId => ({
            contactId,
            members: ordered.flatMap(net => net.endpoints.filter(endpoint => endpointMap.get(endpoint.entityId) === contactId).map(endpoint => {
                if (endpoint.entityId === contactId) return { bitId: net.bitId, endpointId: endpoint.entityId,
                    index: endpoint.index, contactIndex: endpoint.index, boundaryId: null, formalBitId: null };
                const contact = model.ports[contactId];
                const boundary = model.occurrences[contact.occurrenceId].boundaries.map(id => model.boundaries[id])
                    .find(item => item.portId === contactId && item.pinId === endpoint.entityId
                        && item.index === endpoint.index && item.actualBitId === net.bitId);
                if (!boundary) throw new Error(`Missing verified hierarchy incidence: ${contactId} / ${net.bitId}`);
                return { bitId: net.bitId, endpointId: endpoint.entityId, index: endpoint.index,
                    contactIndex: boundary.index, boundaryId: boundary.id, formalBitId: boundary.formalBitId };
            }))
        }));
        const id = `rtl-net-${hash(stable({ snapshot: model.snapshot.id, bits: orderedBits }))}`;
        return { id, kind: members[0].kind === 'constant' ? 'constant-connection' : 'rtl-connection', style: 'physical',
            label: exactAlias?.name || (members[0].kind === 'constant'
                ? new Set(ordered.map(member => member.value)).size === 1 ? `${members[0].value} x ${members.length}` : `const[${members.length}]`
                : `bits ${ordered.map(m => m.value).join(',')}`),
            detail: 'Actual ordered implementation connectivity', fromId: endpointIds[0] || null, toId: endpointIds[1] || null, endpointIds,
            direction: 'net', incidences, bits: orderedBits, rawBits: ordered.map(m => m.value), ordering: exactAlias ? 'alias-vector' : 'occurrence-bit-order',
            memberRelationIds: orderedBits, members: ordered, aliases: aliasIds.map(id => model.aliases[id]),
            sourceRefs: [], semanticRefs: [], status: 'verified-connectivity', interaction: { kind: 'inspect', entityId: id, relationId: id } };
    });
    return { shell: object(root, true), children: children.map(c => object(c)), storages: [], contacts, connections,
        aliases: root.aliases.map(id => model.aliases[id]),
        continuations: root.boundaries.map(id => ({ ...model.boundaries[id], presentationOnly: true })) };
}
function buildScene({ buildId, label, architecture, intent, model, rootId, ownerId, context, correspondence, inspector, selected, sourceRevision, sourceContext, preparedContent }) {
    const sceneKind = intent.sceneKind, disclosureState = intent.disclosureState || {};
    const content = preparedContent || (sceneKind === 'bsv' ? bsvContent(architecture, rootId, disclosureState,
        intent.selectedRelationId || intent.selectedEntityId || null) : rtlContent(model, rootId, ownerId));
    const sourceBreadcrumb = [];
    for (let owner = architecture?.occurrences[ownerId]; owner; owner = architecture.occurrences[owner.parentInstanceId]) {
        sourceBreadcrumb.unshift({ id: owner.id, label: owner.label, rootInstanceId: owner.id, interaction: { kind: 'enter', entityId: owner.id } });
    }
    const breadcrumb = sceneKind === 'bsv' ? sourceBreadcrumb : [];
    if (sceneKind === 'rtl') for (let actual = model.occurrences[rootId]; actual; actual = model.occurrences[actual.parentId]) {
        breadcrumb.unshift({ id: actual.id, label: actual.name, interaction: { kind: 'enter', entityId: actual.id } });
    }
    if (sceneKind === 'bsv' && content.projection?.familyScope && sourceBreadcrumb.length) {
        sourceBreadcrumb.at(-1).label = content.projection.familyScope.elementLabel;
    }
    const path = architecture?.occurrences[ownerId]?.path || null;
    const selection = { selectedEntityId: intent.selectedEntityId || null, selectedRelationId: intent.selectedRelationId || null };
    const sourceRefs = selected?.sourceRefs || [];
    const sourceAvailable = !!architecture, connectivityAvailable = sourceAvailable && !!model && Object.values(architecture.contacts).some(contact => contact.signalDetails?.length);
    const scene = { snapshotId: model?.snapshot.id ?? null, sourceRevision, sceneKind,
        ...(!model ? { presentationIdentity: `source-model-${correspondence.stock.sourceModelIdentity}` } : {}),
        rootInstanceId: sourceContext?.rootInstanceId || intent.rootInstanceId || rootId, ownerInstanceId: ownerId,
        occurrencePath: path ? path.split('.') : context.occurrencePath, ...content, correspondence,
        capabilities: { sourceRanges: sourceAvailable, methodPortConnectivity: connectivityAvailable,
            selectedStorageBinaryContributors: correspondence.origin.available, completeOriginSets: false,
            resetMuxOrigins: false, sharedMergedOrigins: false,
            providers: [{ label: 'Stock metadata', status: connectivityAvailable ? 'Verified declaration and method-port connectivity' : 'Not attached' },
                { label: 'Instrumented capture', status: correspondence.origin.available ? 'Partial origin provider attached' : 'Not present' }],
            items: [{ label: 'Source range', status: sourceAvailable ? 'Verified' : 'Not attached' }, { label: 'Method port connectivity', status: connectivityAvailable ? 'Verified' : 'Not attached' },
                { label: 'Selected storage contributor', status: correspondence.origin.available ? 'Supported subset' : 'Unsupported' },
                { label: 'Selected binary RHS contributor', status: correspondence.origin.available ? 'Supported subset' : 'Unsupported' },
                { label: 'Complete origin sets', status: 'Not established' }, { label: 'General reset / mux cause', status: 'Unsupported' },
                { label: 'Shared / merged cause', status: 'Unsupported' }] }, selection, disclosureState,
        sourceContext: sourceContext || (sourceAvailable ? { ownerInstanceId: ownerId, ...selection, sourceRefs } : null), activePanel: intent.activePanel || 'inspector',
        provenance: { buildId, analysisId: correspondence.stock.analysisId, snapshotId: model?.snapshot.id ?? null, modelId: model?.id ?? null,
            artifact: model?.snapshot.artifact ?? null, stage: model?.snapshot.stage ?? null, sourceModelIdentity: correspondence.stock.sourceModelIdentity },
        header: { title: sceneKind === 'bsv' ? 'BSV Architecture' : 'RTL Implementation',
            subtitle: sceneKind === 'bsv' ? path : path ? `BSV: ${path} | RTL: ${context.occurrencePath.join('/')}` : `RTL: ${context.occurrencePath.join('/')} | Source not attached`,
            sourceOccurrencePath: path, implementationOccurrencePath: context.occurrencePath,
            buildLabel: label, stage: model?.snapshot.stage ?? null, provider: context.provider, occurrencePath: path || context.occurrencePath.join('/') },
        breadcrumb, sourceBreadcrumb, implementationContext: context, inspector };
    return deepFreeze({ id: `scene-${hash(stable(scene))}`, ...scene });
}
module.exports = { bsvContent, rtlContent, buildScene, familySummary };
