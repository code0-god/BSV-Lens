'use strict';
const { hash, stable, failure } = require('./json');

const prefix = (parent, child) => parent.length <= child.length && parent.every((part, index) => child[index] === part);
function interfaceMembers(architecture, group) {
    return Object.values(architecture.contacts).filter(contact => contact.ownerId === group.ownerId
        && contact.interfacePath.length === group.interfacePath.length + 1 && prefix(group.interfacePath, contact.interfacePath));
}
function projectBoundary(architecture, ownerId, display) {
    const owner = architecture.occurrences[ownerId], visibleOwners = new Set([ownerId, ...owner.children]);
    const boundary = [...visibleOwners].flatMap(id => architecture.occurrences[id].contacts.map(id => architecture.contacts[id]));
    const methods = boundary.filter(contact => contact.category !== 'Interface');
    const groups = boundary.filter(contact => contact.category === 'Interface');
    const contacts = methods.filter(contact => contact.interfacePath.length === 1
        && methods.filter(other => other.ownerId === contact.ownerId && other.interfacePath.length === 1).length <= 4);
    const visible = groups.filter(group => group.interfacePath.length === 1 || group.interfacePath.length === 0
        && methods.some(contact => contact.ownerId === group.ownerId && contact.interfacePath.length === 1 && !contacts.includes(contact)));
    const interfaceGroups = visible.map(group => ({ ...display(group), kind: 'interface-group',
        memberContactIds: methods.filter(contact => !contacts.includes(contact) && contact.ownerId === group.ownerId
            && prefix(group.interfacePath, contact.interfacePath) && !visible.some(other => other.ownerId === group.ownerId
                && other.interfacePath.length > group.interfacePath.length && prefix(other.interfacePath, contact.interfacePath))).map(contact => contact.id),
        childGroupIds: interfaceMembers(architecture, group).filter(contact => contact.category === 'Interface').map(contact => contact.id),
        memberCount: interfaceMembers(architecture, group).length,
        membershipStatus: group.interfaceDefinitionId ? 'resolved' : 'unresolved', direction: 'unknown' }));
    const continuations = new Map();
    function endpoint(id) {
        const entity = architecture.contacts[id] || architecture.storage[id] || architecture.occurrences[id] || architecture.behaviors[id];
        if (!entity) throw failure('INVALID_INPUT', `Unknown canonical relation endpoint: ${id}`);
        const actualOwner = entity.ownerId || entity.ownerInstanceId;
        const interfacePath = entity.interfacePath
            ? entity.category === 'Interface' ? entity.interfacePath : entity.interfacePath.slice(0, -1) : null;
        const context = { ownerInstanceId: actualOwner, interfacePath, ...(entity.kind === 'storage' ? { storageId: id } : {}) };
        if (entity.kind === 'storage' && actualOwner === ownerId || architecture.occurrences[id] && visibleOwners.has(id)) return { id, context };
        if (visibleOwners.has(actualOwner)) {
            if (entity.kind === 'storage') return { id: actualOwner, context };
            if (architecture.behaviors[id]) return { id: actualOwner, context };
            if (contacts.includes(entity)) return { id, context };
            const group = visible.filter(group => group.ownerId === actualOwner && prefix(group.interfacePath, entity.interfacePath))
                .sort((a, b) => b.interfacePath.length - a.interfacePath.length)[0];
            return { id: group?.id || actualOwner, context };
        }
        const key = stable({ ownerId, context }), groupId = `source-continuation-${hash(key)}`;
        if (!continuations.has(groupId)) {
            const path = architecture.occurrences[actualOwner]?.path || architecture.storage[id]?.path;
            if (!path) throw failure('INVALID_INPUT', `Missing canonical continuation owner: ${id}`);
            const label = [architecture.occurrences[actualOwner]?.label || entity.label, ...(interfacePath || [])].join('.');
            const group = { id: groupId, kind: 'interface-group', category: 'Interface', ownerId, ownerInstanceId: ownerId,
                label, secondaryLabel: 'Outside this module', detail: 'Outside this module', direction: 'unknown',
                interfacePath: [], interfaceDefinitionId: null, memberContactIds: [], childGroupIds: [], memberCount: 0,
                sourceRefs: [], semanticRefs: [], membershipStatus: 'scope-boundary', status: 'source-derived',
                continuation: { ownerInstanceId: actualOwner, path, interfacePath, canonicalEndpointIds: [] },
                interaction: { kind: 'inspect', entityId: groupId } };
            continuations.set(groupId, group); interfaceGroups.push(group);
        }
        const group = continuations.get(groupId);
        if (!group.continuation.canonicalEndpointIds.includes(id)) group.continuation.canonicalEndpointIds.push(id);
        for (const ref of entity.sourceRefs || []) if (!group.sourceRefs.some(other => other.id === ref.id)) group.sourceRefs.push(ref);
        group.memberCount = group.continuation.canonicalEndpointIds.length;
        return { id: groupId, context, continuation: true };
    }
    return { contacts: contacts.map(display), interfaceGroups, endpoint,
        foldedContactIds: methods.filter(contact => !contacts.includes(contact)).map(contact => contact.id) };
}
module.exports = { projectBoundary, interfaceMembers };
