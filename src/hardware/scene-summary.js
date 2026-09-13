'use strict';
const { hash, stable } = require('./json');

function summarizeRelations(architecture, ownerId, endpoint, selectedId = null) {
    const groups = new Map(), foldedRelationIds = [], continuationRelationIds = [];
    const stateRelations = architecture.occurrences[ownerId].storages.filter(id => architecture.storage[id].primitiveKind === 'register').length > 16
        ? { mode: 'on-selection', selectedId, foldedRelationIds: [] } : null;
    const canonical = Object.values(architecture.relations).filter(relation => relation.ownerInstanceId === ownerId);
    const projected = canonical.map(member => {
        const from = endpoint(member.fromId), to = endpoint(member.toId);
        const key = stable({ ownerId, family: member.kind, from, to, direction: member.direction });
        return { member, from, to, key, summaryId: `semantic-summary-${hash(key)}` };
    });
    const selectedStorages = new Set(projected.filter(item => selectedId === item.summaryId || selectedId === item.member.id)
        .flatMap(({ member }) => [member.fromId, member.toId].filter(id => architecture.storage[id])));
    for (const { member, from, to, key, summaryId } of projected) {
        const fromEntity = architecture.contacts[member.fromId] || architecture.behaviors[member.fromId];
        const toEntity = architecture.contacts[member.toId] || architecture.behaviors[member.toId];
        if (stateRelations && ['state-read', 'state-write'].includes(member.kind)
            && [member.fromId, member.toId].some(id => architecture.storage[id]?.primitiveKind === 'register')
            && !(selectedId && [summaryId, member.id, member.fromId, member.toId, member.behaviorId].includes(selectedId))
            && !selectedStorages.has(member.fromId) && !selectedStorages.has(member.toId)) {
            foldedRelationIds.push(member.id); stateRelations.foldedRelationIds.push(member.id); continue;
        }
        if (from.id === to.id || fromEntity?.ownerInstanceId === ownerId && toEntity?.ownerInstanceId === ownerId) {
            foldedRelationIds.push(member.id); continue;
        }
        if (!groups.has(key)) groups.set(key, { id: summaryId, kind: 'semantic-connection',
            label: member.kind, detail: 'Source relation summary; select for members and code', style: 'semantic',
            ownerInstanceId: ownerId, fromId: from.id, toId: to.id, endpointIds: [from.id, to.id],
            endpointContexts: [from.context, to.context], relationFamily: member.kind,
            direction: ['constructor-binding', 'interface-forward', 'interface-return'].includes(member.kind) ? 'binding' : member.direction,
            memberRelationIds: [], members: [], sourceRefs: [], sourceRefIds: [], status: 'source-derived' });
        const group = groups.get(key);
        group.memberRelationIds.push(member.id);
        group.members.push({ id: member.id, kind: member.kind, fromId: member.fromId, toId: member.toId,
            behaviorId: member.behaviorId, expressionId: member.expressionId, sourceRefIds: member.sourceRefs.map(ref => ref.id) });
        for (const ref of member.sourceRefs) if (!group.sourceRefIds.includes(ref.id)) group.sourceRefIds.push(ref.id);
        if (from.continuation || to.continuation) continuationRelationIds.push(member.id);
    }
    const connections = [...groups.values()].map(group => ({ ...group,
        incidences: group.endpointIds.map(contactId => ({ contactId, members: [] })),
        interaction: { kind: 'inspect', entityId: group.id, relationId: group.id } }));
    return { connections, canonicalRelationIds: canonical.map(relation => relation.id), foldedRelationIds,
        scopeOutsideRelationIds: [], continuationRelationIds, stateRelations };
}
module.exports = { summarizeRelations };
