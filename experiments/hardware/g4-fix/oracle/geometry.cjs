"use strict";
const { createHash } = require('node:crypto');

// Independent predicates: no product layout, scene builder or validator imports.
const EPS = 1e-7;
const near = (a, b) => Math.abs(a - b) <= EPS;
const between = (x, a, b) => x >= Math.min(a, b) - EPS && x <= Math.max(a, b) + EPS;
const point = p => Array.isArray(p) ? p : [p.x, p.y];
const samePoint = (a, b) => near(point(a)[0], point(b)[0]) && near(point(a)[1], point(b)[1]);
const stable = value => JSON.stringify(value, function (_key, item) {
    return item && typeof item === 'object' && !Array.isArray(item)
        ? Object.fromEntries(Object.keys(item).sort().map(k => [k, item[k]])) : item;
});
const equal = (a, b) => stable(a) === stable(b);
const sorted = values => [...values].sort();
const unique = values => [...new Set(values)];
const multiset = (a, b) => equal(sorted(a.map(stable)), sorted(b.map(stable)));
const endpoints = s => [s.slice(0, 2), s.slice(2)];
const horizontal = s => near(s[1], s[3]);
const on = (p, s) => horizontal(s) ? near(point(p)[1], s[1]) && between(point(p)[0], s[0], s[2])
    : near(point(p)[0], s[0]) && between(point(p)[1], s[1], s[3]);
const validSegment = s => Array.isArray(s) && s.length === 4 && s.every(Number.isFinite)
    && (near(s[0], s[2]) !== near(s[1], s[3]));
function intersection(a, b) {
    const ha = horizontal(a), hb = horizontal(b);
    if (ha === hb) {
        const axis = ha ? 0 : 1;
        if (!near(a[1 - axis], b[1 - axis])) return null;
        const lo = Math.max(Math.min(a[axis], a[axis + 2]), Math.min(b[axis], b[axis + 2]));
        const hi = Math.min(Math.max(a[axis], a[axis + 2]), Math.max(b[axis], b[axis + 2]));
        if (hi < lo - EPS) return null;
        return hi - lo > EPS ? { kind: 'overlap', length: hi - lo }
            : { kind: 'point', point: ha ? [lo, a[1]] : [a[0], lo], proper: false };
    }
    const h = ha ? a : b, v = ha ? b : a, p = [v[0], h[1]];
    if (!on(p, h) || !on(p, v)) return null;
    return { kind: 'point', point: p, proper: !endpoints(h).some(q => samePoint(p, q)) && !endpoints(v).some(q => samePoint(p, q)) };
}
const validBox = b => b && [b.x, b.y, b.width, b.height].every(Number.isFinite) && b.width >= 0 && b.height >= 0;
const inside = (p, b) => between(point(p)[0], b.x, b.x + b.width) && between(point(p)[1], b.y, b.y + b.height);
const contains = (a, b) => inside([b.x, b.y], a) && inside([b.x + b.width, b.y + b.height], a);
const boxOverlap = (a, b) => Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x) > EPS
    && Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y) > EPS;
function penetrates(s, b) {
    if (horizontal(s)) return s[1] > b.y + EPS && s[1] < b.y + b.height - EPS
        && Math.min(Math.max(s[0], s[2]), b.x + b.width) - Math.max(Math.min(s[0], s[2]), b.x) > EPS;
    return s[0] > b.x + EPS && s[0] < b.x + b.width - EPS
        && Math.min(Math.max(s[1], s[3]), b.y + b.height) - Math.max(Math.min(s[1], s[3]), b.y) > EPS;
}
const perimeter = b => [[b.x, b.y, b.x + b.width, b.y], [b.x + b.width, b.y, b.x + b.width, b.y + b.height],
    [b.x + b.width, b.y + b.height, b.x, b.y + b.height], [b.x, b.y + b.height, b.x, b.y]];
const markBox = p => p.markBounds || p.bounds || { x: p.x - 4, y: p.y - 4, width: 8, height: 8 };
function rays(p, segments) {
    const result = new Set();
    for (const s of segments) if (on(p, s)) for (const q of endpoints(s)) {
        if (samePoint(p, q)) continue;
        result.add(horizontal(s) ? q[0] < point(p)[0] ? 'W' : 'E' : q[1] < point(p)[1] ? 'N' : 'S');
    }
    return result;
}
const straight = r => r.size === 2 && (r.has('W') && r.has('E') || r.has('N') && r.has('S'));
function localEscape(s, attachment, contact) {
    if (!endpoints(s).some(p => samePoint(p, attachment))) return false;
    const other = endpoints(s).find(p => !samePoint(p, attachment));
    const inward = contact.boundary ? -1 : 1;
    const dx = other[0] - attachment.x, dy = other[1] - attachment.y;
    return contact.side === 'left' ? near(dy, 0) && dx * inward < -EPS
        : contact.side === 'right' ? near(dy, 0) && dx * inward > EPS
            : contact.side === 'top' ? near(dx, 0) && dy * inward < -EPS
                : contact.side === 'bottom' && near(dx, 0) && dy * inward > EPS;
}
const slotId = s => s.incidenceId || s.slotId || s.id;
const attachmentContact = a => a.contactId || a.groupId || a.id;
const incidenceId = (connection, incidence) => incidence.id || JSON.stringify([connection.id, incidence.contactId]);
const slotIndices = s => s.indices || s.memberIndices;
function selectionIdentity(scene) {
    const entities = [scene.shell, ...(scene.children || []), ...(scene.storages || []), ...(scene.contacts || []), ...(scene.interfaceGroups || [])];
    return stable({ snapshotId: scene.snapshotId, sceneKind: scene.sceneKind, ownerInstanceId: scene.ownerInstanceId,
        entities: entities.map(e => ({ id: e.id, kind: e.kind, ownerId: e.ownerId, bits: e.bits, rawBits: e.rawBits })),
        connections: (scene.connections || []).map(c => ({ id: c.id, direction: c.direction, style: c.style, bits: c.bits,
            rawBits: c.rawBits, endpointIds: c.endpointIds, memberRelationIds: c.memberRelationIds, members: c.members, incidences: c.incidences })) });
}

function validateGeometry(scene, geometry, options = {}) {
    const findings = [], add = (code, kind, data = {}) => findings.push({ ...data, code, kind });
    const array = (obj, key, owner) => {
        if (!Array.isArray(obj?.[key])) { add('SCHEMA', 'missing-array', { owner, field: key }); return []; }
        return obj[key];
    };
    const nodes = array(geometry, 'nodes'), contacts = array(geometry, 'contacts'), routes = array(geometry, 'routes');
    const labels = array(geometry, 'labels'), groups = array(geometry, 'groups');
    const connections = array(scene, 'connections'), canonicalContacts = array(scene, 'contacts');
    const sceneGroups = scene.sceneKind === 'bsv' ? array(scene, 'interfaceGroups') : scene.interfaceGroups || [];
    const byConnection = new Map(connections.map(c => [c.id, c])), byContact = new Map(contacts.map(c => [c.id, c]));
    const byNode = new Map(nodes.map(n => [n.id, n])), shell = byNode.get(scene.shell.id);
    const coverage = (expected, actual, kind) => {
        if (!multiset(expected, actual)) add('G09', kind, { expected, actual });
    };
    for (const [kind, items] of [['canonical-connections', connections], ['routes', routes], ['nodes', nodes], ['contacts', contacts], ['groups', groups], ['labels', labels]]) {
        if (items.some(i => typeof i.id !== 'string') || unique(items.map(i => i.id)).length !== items.length) add('SCHEMA', 'duplicate-or-missing-identity', { objectKind: kind });
    }
    const deferred = geometry.routing ? array(geometry.routing, 'deferred', 'routing') : [];
    const overview = scene.sceneKind === 'bsv' && scene.projection?.kind === 'bsv-overview';
    if (geometry.routing) {
        if (!overview || scene.projection.ownerInstanceId !== scene.shell.id
            || typeof scene.projection.sourceRevision !== 'string' || scene.projection.sourceRevision !== scene.shell.sourceRefs?.[0]?.revision
            || geometry.routing.status !== (deferred.length ? 'partial' : 'complete')
            || !equal(geometry.routing.routedRelationIds, routes.map(route => route.id))) add('SCHEMA', 'routing-scope-status');
        for (const item of deferred) {
            const connection = byConnection.get(item.connectionId);
            if (!connection || connection.style !== 'semantic' || !connection.memberRelationIds?.length
                || !equal(item.memberRelationIds, connection.memberRelationIds) || item.code !== 'ROUTING_BLOCKED'
                || typeof item.message !== 'string' || !item.message || routes.some(route => route.id === item.connectionId)
                || labels.some(label => label.ownerId === item.connectionId)) add('SCHEMA', 'invalid-deferred-relation', { item });
        }
    }
    coverage(connections.map(c => c.id), [...routes.map(r => r.id), ...deferred.map(item => item.connectionId)], 'route-coverage');
    coverage([scene.shell, ...(scene.children || []), ...(scene.storages || [])].map(n => n.id), nodes.map(n => n.id), 'node-coverage');
    coverage(canonicalContacts.map(c => c.id), contacts.map(c => c.id), 'contact-coverage');
    coverage(sceneGroups.map(g => g.id), groups.map(g => g.id), 'interface-group-coverage');
    const bounds = geometry.bounds;
    if (!validBox(bounds) || !bounds.width || !bounds.height) add('SCHEMA', 'bounds');
    const checkBox = (box, owner, kind) => {
        if (!validBox(box)) add('SCHEMA', 'invalid-box', { owner, objectKind: kind });
        else if (validBox(bounds) && !contains(bounds, box)) add('G10', 'out-of-bounds', { owner, objectKind: kind, box, bounds });
    };
    for (const n of nodes) checkBox(n, n.id, 'node');
    for (const g of groups) {
        const original = sceneGroups.find(group => group.id === g.id);
        if (original && !equal(g.memberContactIds, original.memberContactIds)) add('G09', 'geometry-group-members', { groupId: g.id });
        checkBox(g.labelBounds || g.bounds, g.id, 'group');
        for (const slot of array(g, 'slots', g.id)) checkBox(markBox(slot), slotId(slot), 'group-slot');
    }
    const slots = [];
    for (const contact of contacts) {
        checkBox(markBox(contact), contact.id, 'contact');
        const original = canonicalContacts.find(c => c.id === contact.id);
        if (original && original.ownerId !== contact.ownerId) add('G09', 'contact-owner', { contactId: contact.id });
        for (const slot of array(contact, 'slots', contact.id)) {
            slots.push({ ...slot, contact });
            checkBox(markBox(slot), slotId(slot), 'slot');
            if (slot.contactId !== contact.id || !byConnection.has(slot.connectionId) || typeof slotId(slot) !== 'string'
                || !Array.isArray(slotIndices(slot)) || !Array.isArray(slot.bitIds)) add('SCHEMA', 'slot-membership', { slot });
            const node = byNode.get(contact.ownerId);
            if (node && !perimeter(node).some(edge => on(slot, edge))) add('G09', 'slot-off-owner-boundary', { slot });
        }
    }
    const allSegments = [], routeSegments = new Map(), routeAttachments = new Map();
    let length = 0, bends = 0;
    for (const route of routes) {
        const connection = byConnection.get(route.id);
        const segments = array(route, 'segments', route.id).filter(s => {
            if (!validSegment(s)) { add('SCHEMA', 'non-orthogonal-or-zero-segment', { owner: route.id, segment: s }); return false; }
            return true;
        });
        routeSegments.set(route.id, segments);
        for (const s of segments) {
            allSegments.push({ owner: route.id, s }); length += Math.abs(s[2] - s[0]) + Math.abs(s[3] - s[1]);
            if (validBox(bounds) && endpoints(s).some(p => !inside(p, bounds))) add('G10', 'route-out-of-bounds', { owner: route.id, segment: s });
        }
        // The shipped surface uses M/L independent segments. Reject unparsed SVG commands, not just a numeric subset.
        const expression = /M\s*(-?[\d.]+(?:e[+-]?\d+)?)\s*[, ]\s*(-?[\d.]+(?:e[+-]?\d+)?)\s*L\s*(-?[\d.]+(?:e[+-]?\d+)?)\s*[, ]\s*(-?[\d.]+(?:e[+-]?\d+)?)/gi;
        const text = typeof route.path === 'string' ? route.path : '';
        const parsed = [...text.matchAll(expression)].map(m => m.slice(1).map(Number));
        if (text.replace(expression, '').trim() || parsed.length !== segments.length || parsed.some((s, i) => s.some((v, j) => !near(v, segments[i][j])))) {
            add('G09', 'svg-path-segment-disagreement', { owner: route.id });
        }
        const normalizeAttachment = a => ({ ...a, contactId: attachmentContact(a), connectionId: a.connectionId || route.id });
        const attachments = array(route, 'attachments', route.id).map(normalizeAttachment), points = array(route, 'points', route.id).map(normalizeAttachment);
        routeAttachments.set(route.id, attachments);
        const dots = array(route, 'junctions', route.id);
        if (!connection) continue;
        const endpointIds = connection.endpointIds || [connection.fromId, connection.toId].filter(Boolean);
        const incidences = array(connection, 'incidences', connection.id).map(i => ({ ...i, id: incidenceId(connection, i) }));
        coverage(endpointIds, incidences.map(i => i.contactId), 'incidence-endpoint-coverage');
        coverage(incidences.map(i => i.id), attachments.map(slotId), 'attachment-incidence-coverage');
        const attachmentFields = a => [slotId(a), a.contactId, a.connectionId, a.x, a.y, slotIndices(a), a.bitIds];
        coverage(attachments.map(attachmentFields), points.map(attachmentFields), 'points-attachment-agreement');
        for (const incidence of incidences) {
            const matching = slots.filter(s => s.connectionId === route.id && s.contactId === incidence.contactId && slotId(s) === incidence.id);
            // Non-contact BSV anchors are explicit route incidences on real nodes/groups, never fabricated physical ports.
            const group = groups.find(g => g.id === incidence.contactId);
            const anchor = byNode.get(incidence.contactId) || (group && byNode.get(group.ownerId));
            const a = attachments.find(a => slotId(a) === incidence.id);
            if (group && (!a || !(group.slots || []).some(slot => slotId(slot) === incidence.id && slot.connectionId === route.id && samePoint(a, slot)))) add('G09', 'group-slot-attachment', { owner: route.id, incidenceId: incidence.id });
            if (matching.length !== 1 && !(scene.sceneKind === 'bsv' && anchor && matching.length === 0 && a)) {
                add('G09', 'incidence-slot-coverage', { owner: route.id, incidenceId: incidence.id, count: matching.length });
            }
            const members = array(incidence, 'members', incidence.id);
            const expectedIndices = members.map(m => m.contactIndex).filter(i => i != null);
            const expectedBits = members.map(m => m.bitId).filter(i => i != null);
            if (a && (!equal(slotIndices(a), expectedIndices) || !equal(a.bitIds, expectedBits))) add('G09', 'attachment-index-membership', { owner: route.id, incidenceId: incidence.id, expectedIndices, expectedBits });
            for (const s of matching) {
                if (!equal(slotIndices(s), expectedIndices) || !equal(s.bitIds, expectedBits) || s.members !== undefined && !equal(s.members, members)) add('G09', 'slot-index-membership', { owner: route.id, incidenceId: incidence.id, expectedIndices, expectedBits, slot: s });
                if (!a || !samePoint(a, s) || a.contactId !== s.contactId || a.connectionId !== route.id) add('G09', 'shifted-or-foreign-attachment', { owner: route.id, incidenceId: incidence.id });
            }
            if (a && anchor && !byContact.has(incidence.contactId) && !perimeter(anchor.bounds || anchor).some(s => on(a, s))) add('G09', 'anchor-off-boundary', { owner: route.id, attachment: a });
            if (a && (!segments.some(s => endpoints(s).some(p => samePoint(a, p))) || !segments.some(s => on(a, s)))) add('G09', 'unattached-canonical-endpoint', { owner: route.id, attachment: a });
        }
        const vertices = [];
        const insert = p => { if (!vertices.some(q => samePoint(p, q))) vertices.push(p); };
        for (const s of segments) endpoints(s).forEach(insert);
        for (let i = 0; i < segments.length; i++) for (let j = i + 1; j < segments.length; j++) {
            const hit = intersection(segments[i], segments[j]); if (hit?.kind === 'point') insert(hit.point);
        }
        let loose = 0;
        for (const p of vertices) {
            const r = rays(p, segments);
            if (r.size === 2 && !straight(r)) bends++;
            if (r.size === 1 && !attachments.some(a => samePoint(a, p))) { loose++; if (endpointIds.length >= 2) add('G08', 'dangling-endpoint', { owner: route.id, point: p }); }
            if (connection.style === 'physical' && r.size >= 3 && !dots.some(d => samePoint(d, p))) add('G03', 'missing-fanout-dot', { owner: route.id, point: p });
        }
        for (const d of dots) if (connection.style !== 'physical' || rays(d, segments).size < 3) add('G03', 'unsupported-junction-dot', { owner: route.id, point: d });
        const reached = new Set(segments.length ? [0] : []), pending = [...reached];
        while (pending.length) {
            const i = pending.pop();
            for (let j = 0; j < segments.length; j++) if (!reached.has(j) && intersection(segments[i], segments[j])) { reached.add(j); pending.push(j); }
        }
        if (!segments.length || reached.size !== segments.length) add('G08', 'disconnected-owner-route', { owner: route.id });
        if (endpointIds.length === 0 && (route.unconnected !== true || segments.length !== 1 || attachments.length !== 0 || dots.length !== 0)
            || endpointIds.length === 1 && (loose !== 1 || dots.length !== 0 || route.unconnected === true)
            || endpointIds.length > 0 && route.unconnected === true) add('G08', 'unevidenced-stub-or-detached-exception', { owner: route.id, endpointCount: endpointIds.length, loose });
    }
    for (const slot of slots) {
        const connection = byConnection.get(slot.connectionId);
        if (!connection?.incidences?.some(i => incidenceId(connection, i) === slotId(slot) && i.contactId === slot.contactId)) add('G09', 'orphan-slot', { slotId: slotId(slot) });
    }
    const overlapPairs = new Set(), crossings = new Set();
    for (let i = 0; i < allSegments.length; i++) for (let j = i + 1; j < allSegments.length; j++) {
        const a = allSegments[i], b = allSegments[j]; if (a.owner === b.owner) continue;
        const hit = intersection(a.s, b.s); if (!hit) continue;
        const pair = sorted([a.owner, b.owner]);
        if (hit.kind === 'overlap') {
            overlapPairs.add(stable(pair)); add('G01', 'different-owner-overlap', { owners: pair, segmentA: a.s, segmentB: b.s, length: hit.length });
        } else {
            const ar = rays(hit.point, routeSegments.get(a.owner)), br = rays(hit.point, routeSegments.get(b.owner));
            const dot = routes.some(r => pair.includes(r.id) && (r.junctions || []).some(d => samePoint(d, hit.point)));
            const terminal = pair.some(id => (routeAttachments.get(id) || []).some(p => samePoint(p, hit.point)));
            if (straight(ar) && straight(br) && [...ar].every(ray => !br.has(ray)) && !dot && !terminal) crossings.add(stable([pair, hit.point]));
            else add('G02', 'foreign-touch-or-junction', { owners: pair, point: hit.point });
        }
    }
    for (const { owner, s } of allSegments) {
        const attachments = routeAttachments.get(owner) || [];
        for (const n of nodes) if (n.id !== scene.shell.id && validBox(n) && penetrates(s, n)) add('G04', 'node-body-penetration', { owner, nodeId: n.id, segment: s });
        for (const contact of contacts) {
            const own = attachments.filter(a => a.contactId === contact.id);
            if (penetrates(s, markBox(contact)) && !own.some(a => localEscape(s, a, contact))) add('G05', 'contact-penetration', { owner, contactId: contact.id, segment: s });
            for (const slot of contact.slots || []) if (penetrates(s, markBox(slot))
                && !(slot.connectionId === owner && own.some(a => slotId(a) === slotId(slot) && samePoint(a, slot) && localEscape(s, a, contact)))) {
                add('G05', 'slot-penetration', { owner, slotId: slotId(slot), contactId: contact.id, segment: s });
            }
        }
        if (validBox(shell)) for (const edge of perimeter(shell)) {
            const hit = intersection(s, edge); if (!hit) continue;
            const authorized = hit.kind === 'point' && attachments.some(a => samePoint(a, hit.point)
                && (byContact.get(a.contactId)?.ownerId === shell.id || groups.find(g => g.id === a.contactId)?.ownerId === shell.id || a.contactId === shell.id)
                && endpoints(s).some(p => samePoint(a, p)) && endpoints(s).every(p => inside(p, shell)));
            if (!authorized) add('G07', 'shell-boundary-crossing', { owner, segment: s, boundary: edge });
        }
    }
    const entityOwners = new Map([...canonicalContacts, ...sceneGroups].map(c => [c.id, c.ownerId]));
    const validOwners = new Set([...nodes.map(n => n.id), ...canonicalContacts.map(c => c.id), ...sceneGroups.map(g => g.id), ...connections.map(c => c.id)]);
    for (const label of labels) {
        if (typeof label.ownerId !== 'string' || !validOwners.has(label.ownerId) || typeof label.role !== 'string' || typeof label.text !== 'string') add('SCHEMA', 'label-identity', { label });
        if (label.foldedReason !== undefined) {
            const connection = byConnection.get(label.ownerId), route = routes.find(r => r.id === label.ownerId);
            const fields = ['id', 'ownerId', 'role', 'fullText', 'text', 'x', 'y', 'anchor', 'bounds', 'foldedReason'];
            const overviewFold = scene.sceneKind === 'bsv' && scene.projection?.kind === 'bsv-overview' && label.foldedReason === 'overview-detail';
            if (Object.keys(label).some(key => !fields.includes(key)) || !(label.foldedReason === 'no-label-clearance' || overviewFold)
                || label.role !== 'connection' || !connection || label.fullText !== connection.label || label.text !== connection.label
                || !label.text || label.bounds !== null || !route || label.id !== `${route.id}:label` || label.anchor !== 'start'
                || !Number.isFinite(label.x) || !Number.isFinite(label.y) || !validBox(bounds) || !inside(label, bounds)
                || !route.attachments?.some(a => samePoint(a, label)) || !equal(route.label, label) || route.labelBounds !== null
                || !near(route.labelX, label.x) || !near(route.labelY, label.y) || route.labelAnchor !== label.anchor)
                add('SCHEMA', 'invalid-folded-connection-label', { label });
            continue;
        }
        checkBox(label.bounds, label.ownerId, 'label'); if (!validBox(label.bounds)) continue;
        for (const { owner, s } of allSegments) if (penetrates(s, label.bounds)) add('G06', 'wire-label', { owner, labelOwner: label.ownerId, role: label.role, segment: s, box: label.bounds });
        for (const node of nodes) if (node.id !== scene.shell.id && validBox(node) && boxOverlap(node, label.bounds)
            && node.id !== label.ownerId && entityOwners.get(label.ownerId) !== node.id) add('G06', 'label-node', { labelOwner: label.ownerId, nodeId: node.id });
        for (const contact of contacts) for (const mark of [contact, ...(contact.slots || [])]) if (boxOverlap(label.bounds, markBox(mark))) add('G06', 'label-contact', { labelOwner: label.ownerId, contactId: contact.id });
    }
    for (let i = 0; i < labels.length; i++) for (let j = i + 1; j < labels.length; j++) if (validBox(labels[i].bounds) && validBox(labels[j].bounds) && boxOverlap(labels[i].bounds, labels[j].bounds)) add('G06', 'label-label', { a: labels[i], b: labels[j] });
    // Coverage is per displayed nonempty field. Truncation is allowed but dropping a field is not.
    for (const entity of [scene.shell, ...(scene.children || []), ...(scene.storages || []), ...canonicalContacts, ...sceneGroups,
        ...connections.filter(connection => !deferred.some(item => item.connectionId === connection.id))]) {
        const required = [entity.label, byConnection.has(entity.id) || sceneGroups.some(g => g.id === entity.id) ? null : entity.detail || entity.secondaryLabel].filter(text => typeof text === 'string' && text.length);
        if (labels.filter(l => l.ownerId === entity.id && typeof l.text === 'string' && l.text.length).length < required.length) add('SCHEMA', 'incomplete-label-coverage', { owner: entity.id, requiredFields: required.length });
    }
    if (options.selectedScene && selectionIdentity(scene) !== selectionIdentity(options.selectedScene)) add('G11', 'selection-mutated-canonical-membership');
    const metrics = { bounds, totalRouteLength: length, bends, crossings: crossings.size, overlappingPairs: overlapPairs.size,
        overlappingSegments: findings.filter(f => f.code === 'G01').length,
        counts: Object.fromEntries(unique(findings.map(f => f.code)).sort().map(code => [code, findings.filter(f => f.code === code).length])) };
    return { valid: findings.length === 0, epsilon: EPS, findings, metrics };
}

// Canonical authority is the genuine imported G2 model or source architecture supplied by the runner.
// Never infer ownership from a label, raw integer, driver direction or contact overlap.
function validateMembership(scene, { model, architecture } = {}) {
    const findings = [], incidences = new Map(), add = (kind, data = {}) => findings.push({ code: 'G09', kind, ...data });
    if (scene.sceneKind === 'rtl') {
        const root = model?.occurrences?.[scene.shell.id];
        if (!root || model.snapshot.id !== scene.snapshotId) return { valid: false, findings: [{ code: 'G09', kind: 'missing-or-foreign-canonical-model' }], incidences };
        const children = root.cells.map(id => model.cells[id]).map(c => c.childOccurrenceId ? model.occurrences[c.childOccurrenceId] : c);
        if (!multiset(children.map(c => c.id), scene.children.map(c => c.id))) add('invented-or-missing-rtl-child');
        if (scene.storages.length) add('source-storage-in-rtl');
        const subjects = [root, ...children];
        const expectedContacts = subjects.flatMap(o => (o.kind === 'occurrence' ? o.ports : o.pins).map(id => ({ ...model.entities[id], ownerId: o.id })));
        const contacts = new Map(expectedContacts.map(c => [c.id, c]));
        if (!multiset(expectedContacts.map(c => c.id), scene.contacts.map(c => c.id))) add('canonical-contact-coverage');
        for (const c of scene.contacts) {
            const expected = contacts.get(c.id);
            if (!expected || c.ownerId !== expected.ownerId || !equal(c.bits, expected.bits) || !equal(c.rawBits, expected.rawBits) || c.direction !== (expected.direction || 'unknown')) add('canonical-contact-membership', { contactId: c.id });
        }
        const bits = root.bits.map(id => model.bits[id]);
        const signature = bit => bit.endpoints.length ? stable([bit.kind, bit.endpoints.map(e => [e.entityId, e.kind, e.direction, e.role])]) : bit.id;
        const groups = new Map();
        for (const bit of bits) { const key = signature(bit); if (!groups.has(key)) groups.set(key, []); groups.get(key).push(bit.id); }
        const observed = [];
        if (unique(scene.connections.map(c => c.id)).length !== scene.connections.length) add('duplicate-canonical-connection-owner');
        for (const c of scene.connections) {
            observed.push(...(c.bits || []));
            if (c.direction !== 'net' || c.style !== 'physical') add('directed-or-semantic-rtl-net', { connectionId: c.id });
            if (!equal(c.bits, c.members.map(m => m.bitId)) || !equal(c.bits, c.memberRelationIds)) add('ordered-member-disagreement', { connectionId: c.id });
            const canonical = (c.bits || []).map(id => model.bits[id]);
            if (canonical.some(b => !b || b.occurrenceId !== root.id)) { add('foreign-bit-scope', { connectionId: c.id }); continue; }
            if (!canonical.length || !multiset(c.bits, groups.get(signature(canonical[0])) || [])) add('partial-slice-union-or-split', { connectionId: c.id });
            const aliases = root.aliases.map(id => model.aliases[id]).filter(a => a.bits.length === c.bits.length && unique(a.bits).length === c.bits.length && multiset(a.bits, c.bits));
            const ordered = aliases.length ? aliases[0].bits : bits.filter(b => c.bits.includes(b.id)).map(b => b.id);
            if (!equal(c.bits, ordered)) add('alias-or-vector-order', { connectionId: c.id, expected: ordered, actual: c.bits });
            if (!equal(c.rawBits, canonical.map(b => b.value))) add('raw-bit-value', { connectionId: c.id });
            const projected = new Map();
            for (const [i, b] of canonical.entries()) {
                const m = c.members[i];
                if (!m || m.kind !== b.kind || m.value !== b.value || !equal(m.endpoints, b.endpoints) || !equal(m.aliases, b.aliases)) add('canonical-member-endpoints', { connectionId: c.id, bitId: b.id });
                for (const e of b.endpoints) {
                    let contactId = contacts.has(e.entityId) ? e.entityId : null, boundary = null;
                    if (!contactId) {
                        const bindings = children.filter(o => o.kind === 'occurrence').flatMap(o => o.boundaries.map(id => model.boundaries[id]))
                            .filter(binding => binding.pinId === e.entityId && binding.index === e.index && binding.actualBitId === b.id && contacts.has(binding.portId));
                        if (bindings.length !== 1) { add('missing-or-ambiguous-boundary', { connectionId: c.id, endpoint: e }); continue; }
                        boundary = bindings[0]; contactId = boundary.portId;
                        if (contacts.get(contactId).bits[boundary.index] !== boundary.formalBitId) add('formal-boundary-index', { boundaryId: boundary.id });
                    } else if (contacts.get(contactId).bits[e.index] !== b.id) add('direct-contact-index', { contactId, endpoint: e });
                    if (!projected.has(contactId)) projected.set(contactId, []);
                    projected.get(contactId).push({ bitId: b.id, endpointId: e.entityId, index: e.index, contactIndex: boundary ? boundary.index : e.index, boundaryId: boundary?.id || null, formalBitId: boundary?.formalBitId || null });
                }
            }
            if (!equal(c.endpointIds, [...projected.keys()])) add('canonical-endpoint-projection', { connectionId: c.id, expected: [...projected.keys()], actual: c.endpointIds });
            incidences.set(c.id, projected);
            if (!Array.isArray(c.incidences)) add('missing-canonical-incidences', { connectionId: c.id });
            else {
                if (!multiset(c.incidences.map(i => i.contactId), [...projected.keys()])) add('incidence-contact-coverage', { connectionId: c.id });
                for (const incidence of c.incidences) if (incidence.connectionId !== undefined && incidence.connectionId !== c.id || !equal(incidence.members, projected.get(incidence.contactId))) add('canonical-incidence-members', { connectionId: c.id, incidenceId: incidenceId(c, incidence), expected: projected.get(incidence.contactId), actual: incidence.members });
            }
        }
        if (!multiset(observed, root.bits)) add('occurrence-bit-exact-coverage');
    } else {
        const owner = architecture?.occurrences?.[scene.shell.id];
        if (!owner) return { valid: false, findings: [{ code: 'G09', kind: 'missing-canonical-source-architecture' }], incidences };
        if (!multiset(owner.children, scene.children.map(c => c.id)) || !multiset(owner.storages, scene.storages.map(c => c.id))) add('invented-or-missing-bsv-block');
        const visible = new Set([owner.id, ...owner.children]);
        const canonicalContacts = [...visible].flatMap(id => architecture.occurrences[id].contacts.map(id => architecture.contacts[id]));
        if (scene.projection?.kind === 'bsv-overview') {
            const projection = scene.projection, expected = Object.values(architecture.relations).filter(relation => relation.ownerInstanceId === owner.id);
            if (scene.ownerInstanceId !== owner.id || projection.ownerInstanceId !== owner.id
                || projection.sourceRevision !== owner.sourceRefs[0].revision || scene.sourceRevision !== projection.sourceRevision) add('overview-source-identity');
            const startsWith = (parent, child) => Array.isArray(parent) && Array.isArray(child)
                && parent.length <= child.length && parent.every((part, index) => child[index] === part);
            const methods = canonicalContacts.filter(contact => contact.category !== 'Interface');
            const leaves = methods.filter(contact => contact.interfacePath.length === 1
                && methods.filter(other => other.ownerId === contact.ownerId && other.interfacePath.length === 1).length <= 4);
            const boundary = canonicalContacts.filter(contact => contact.category === 'Interface'
                && (contact.interfacePath.length === 1 || contact.interfacePath.length === 0
                    && methods.some(method => method.ownerId === contact.ownerId && method.interfacePath.length === 1 && !leaves.includes(method))));
            const continuations = (scene.interfaceGroups || []).filter(group => group.continuation);
            if (!multiset(leaves.map(contact => contact.id), scene.contacts.map(contact => contact.id))) add('overview-mandatory-contact-coverage');
            if (!multiset(boundary.map(group => group.id), (scene.interfaceGroups || []).filter(group => !group.continuation).map(group => group.id))) add('overview-boundary-coverage');
            for (const contact of scene.contacts) if (!equal(contact.interfacePath, architecture.contacts[contact.id]?.interfacePath)
                || contact.ownerId !== architecture.contacts[contact.id]?.ownerId) add('overview-contact-identity', { contactId: contact.id });
            const grouped = [];
            for (const group of (scene.interfaceGroups || []).filter(group => !group.continuation)) {
                const source = architecture.contacts[group.id];
                const members = methods.filter(contact => source && !leaves.includes(contact) && contact.ownerId === source.ownerId
                    && startsWith(source.interfacePath, contact.interfacePath) && !boundary.some(other => other.ownerId === source.ownerId
                        && other.interfacePath.length > source.interfacePath.length && startsWith(other.interfacePath, contact.interfacePath))).map(contact => contact.id);
                grouped.push(...(group.memberContactIds || []));
                if (!source || source.ownerId !== group.ownerId || !equal(source.interfacePath, group.interfacePath)
                    || !multiset(members, group.memberContactIds || [])) add('overview-interface-members', { groupId: group.id });
            }
            const foldedContacts = methods.filter(contact => !leaves.includes(contact)).map(contact => contact.id);
            if (!multiset(foldedContacts, projection.foldedContactIds || []) || !multiset(foldedContacts, grouped)) add('overview-folded-contact-partition');
            const entityFor = id => architecture.contacts[id] || architecture.storage[id] || architecture.occurrences[id] || architecture.behaviors[id];
            for (const group of continuations) {
                const external = group.continuation, subject = architecture.occurrences[external.ownerInstanceId];
                if (group.ownerId !== owner.id || !subject || subject.path !== external.path || visible.has(external.ownerInstanceId)
                    || !Array.isArray(external.canonicalEndpointIds) || !external.canonicalEndpointIds.length) add('overview-continuation-authority', { groupId: group.id });
                for (const id of external.canonicalEndpointIds || []) {
                    const entity = entityFor(id), entityOwner = entity?.ownerId || entity?.ownerInstanceId;
                    if (!entity || entityOwner !== external.ownerInstanceId || !expected.some(member => member.fromId === id || member.toId === id)) add('overview-continuation-membership', { groupId: group.id, endpointId: id });
                }
            }
            const project = id => {
                const entity = entityFor(id); if (!entity) return null;
                const actualOwner = entity.ownerId || entity.ownerInstanceId;
                if (architecture.storage[id] && actualOwner === owner.id || architecture.occurrences[id] && visible.has(id)) return id;
                if (visible.has(actualOwner)) {
                    if (architecture.storage[id] || architecture.behaviors[id]) return actualOwner;
                    if (leaves.some(contact => contact.id === id)) return id;
                    return boundary.filter(group => group.ownerId === actualOwner && startsWith(group.interfacePath, entity.interfacePath))
                        .sort((a, b) => b.interfacePath.length - a.interfacePath.length)[0]?.id || actualOwner;
                }
                return continuations.find(group => group.continuation.canonicalEndpointIds.includes(id))?.id || null;
            };
            const seen = [];
            for (const connection of scene.connections) {
                if (connection.style !== 'semantic' || connection.bits?.length || connection.rawBits?.length) add('fabricated-bsv-physical-net', { connectionId: connection.id });
                if (!equal(connection.memberRelationIds, connection.members.map(member => member.id))) add('source-member-order', { connectionId: connection.id });
                const refs = [];
                for (const member of connection.members) {
                    const canonical = architecture.relations[member.id]; seen.push(member.id);
                    const compact = canonical && { id: canonical.id, kind: canonical.kind, fromId: canonical.fromId, toId: canonical.toId,
                        behaviorId: canonical.behaviorId, expressionId: canonical.expressionId, sourceRefIds: canonical.sourceRefs.map(ref => ref.id) };
                    if (!canonical || canonical.ownerInstanceId !== owner.id || !equal(member, compact)
                        || connection.relationFamily !== canonical.kind) add('overview-canonical-source-relation', { connectionId: connection.id, memberId: member.id });
                    if (!canonical) continue;
                    refs.push(...canonical.sourceRefs.map(ref => ref.id));
                    if (!equal(connection.endpointIds, [project(canonical.fromId), project(canonical.toId)])) add('overview-source-endpoint-projection', { connectionId: connection.id, memberId: member.id });
                    const direction = ['constructor-binding', 'interface-forward', 'interface-return'].includes(canonical.kind) ? 'binding' : canonical.direction;
                    if (connection.direction !== direction) add('overview-relation-direction', { connectionId: connection.id });
                }
                if (!multiset(unique(refs), connection.sourceRefIds || [])) add('overview-source-reference-coverage', { connectionId: connection.id });
                if (!multiset(connection.endpointIds, (connection.incidences || []).map(incidence => incidence.contactId))
                    || connection.incidences.some(incidence => incidence.members.length)) add('overview-source-incidences', { connectionId: connection.id });
            }
            const folded = projection.foldedRelationIds || [];
            const selected = scene.selection?.selectedRelationId || scene.selection?.selectedEntityId || null;
            const endpointContext = id => {
                const entity = entityFor(id), actualOwner = entity.ownerId || entity.ownerInstanceId;
                const interfacePath = entity.interfacePath
                    ? entity.category === 'Interface' ? entity.interfacePath : entity.interfacePath.slice(0, -1) : null;
                return { id: project(id), context: { ownerInstanceId: actualOwner, interfacePath,
                    ...(architecture.storage[id] ? { storageId: id } : {}) },
                    ...(!visible.has(actualOwner) ? { continuation: true } : {}) };
            };
            const summaryId = relation => `semantic-summary-${createHash('sha256').update(stable({ ownerId: owner.id,
                family: relation.kind, from: endpointContext(relation.fromId), to: endpointContext(relation.toId), direction: relation.direction })).digest('hex')}`;
            const selectedStorages = new Set(expected.filter(relation => selected === relation.id || selected === summaryId(relation))
                .flatMap(relation => [relation.fromId, relation.toId].filter(id => architecture.storage[id])));
            const denseRegisters = owner.storages.filter(id => architecture.storage[id].primitiveKind === 'register').length > 16;
            const stateFold = relation => denseRegisters && ['state-read', 'state-write'].includes(relation.kind)
                && [relation.fromId, relation.toId].some(id => architecture.storage[id]?.primitiveKind === 'register')
                && !(selected && [summaryId(relation), relation.id, relation.fromId, relation.toId, relation.behaviorId].includes(selected))
                && !selectedStorages.has(relation.fromId) && !selectedStorages.has(relation.toId);
            const expectedStateFolds = expected.filter(stateFold).map(relation => relation.id);
            if (denseRegisters ? projection.stateRelations?.mode !== 'on-selection'
                || projection.stateRelations.selectedId !== selected
                || !multiset(expectedStateFolds, projection.stateRelations.foldedRelationIds || [])
                : projection.stateRelations !== undefined) add('overview-state-disclosure-policy');
            for (const id of folded) {
                const relation = architecture.relations[id], from = relation && (architecture.contacts[relation.fromId] || architecture.behaviors[relation.fromId]);
                const to = relation && (architecture.contacts[relation.toId] || architecture.behaviors[relation.toId]);
                if (!relation || relation.ownerInstanceId !== owner.id || !(project(relation.fromId) === project(relation.toId)
                    || from?.ownerInstanceId === owner.id && to?.ownerInstanceId === owner.id
                    || stateFold(relation))) add('overview-invalid-folded-relation', { memberId: id });
            }
            if (!multiset(seen, projection.summaryRelationIds || []) || !multiset(expected.map(relation => relation.id), projection.canonicalRelationIds || [])
                || !multiset(expected.map(relation => relation.id), [...seen, ...folded]) || projection.scopeOutsideRelationIds?.length !== 0) add('source-relation-exact-coverage');
            return { valid: findings.length === 0, findings, incidences };
        }
        const expectedGroups = canonicalContacts.filter(c => c.category === 'Interface');
        for (const group of scene.interfaceGroups || []) {
            const source = architecture.source.endpoints.find(e => e.id === group.id);
            const expectedMembers = architecture.source.endpoints.filter(e => e.kind === 'method-endpoint' && source
                && e.ownerInstanceId === source.ownerInstanceId && e.interfaceDefinitionId === source.interfaceDefinitionId
                && equal(e.interfacePath.slice(0, -1), source.interfacePath)).map(e => e.id);
            if (!source || group.ownerId !== source.ownerInstanceId || !multiset(group.memberContactIds || [], expectedMembers)) add('canonical-source-interface-members', { groupId: group.id, expected: expectedMembers, actual: group.memberContactIds });
        }
        if (!multiset(expectedGroups.map(c => c.id), (scene.interfaceGroups || []).map(c => c.id))
            || !multiset(canonicalContacts.filter(c => c.category !== 'Interface').map(c => c.id), scene.contacts.map(c => c.id))) add('interface-group-is-not-physical-contact');
        const project = id => {
            const contact = architecture.contacts[id];
            if (contact && visible.has(contact.ownerId) || architecture.storage[id] || architecture.occurrences[id]) return id;
            const behavior = architecture.behaviors[id];
            if (behavior) return canonicalContacts.find(c => c.ownerId === behavior.ownerInstanceId && c.behaviorIds.includes(id))?.id || behavior.ownerInstanceId;
            return architecture.entities[id]?.ownerInstanceId;
        };
        const expected = Object.values(architecture.relations).filter(r => r.ownerInstanceId === owner.id), seen = [];
        for (const c of scene.connections) {
            if (c.style !== 'semantic' || c.bits?.length || c.rawBits?.length) add('fabricated-bsv-physical-net', { connectionId: c.id });
            if (!equal(c.memberRelationIds, c.members.map(m => m.id))) add('source-member-order', { connectionId: c.id });
            const endpoints = [];
            for (const m of c.members) {
                seen.push(m.id);
                if (!equal(m, architecture.relations[m.id]) || m.ownerInstanceId !== owner.id) add('canonical-source-relation', { connectionId: c.id, memberId: m.id });
                for (const id of [project(m.fromId), project(m.toId)]) if (!endpoints.includes(id)) endpoints.push(id);
            }
            if (!multiset(endpoints, c.endpointIds)) add('canonical-source-endpoint-projection', { connectionId: c.id, expected: endpoints, actual: c.endpointIds });
            if (!Array.isArray(c.incidences)) add('missing-source-incidences', { connectionId: c.id });
            else if (c.incidences.some(i => i.members?.some(m => m.bitId != null || m.index != null || m.contactIndex != null))) add('fabricated-source-bit-index', { connectionId: c.id });
        }
        if (!multiset(expected.map(r => r.id), seen)) add('source-relation-exact-coverage');
    }
    return { valid: findings.length === 0, findings, incidences };
}
module.exports = { EPS, intersection, validateGeometry, validateMembership, selectionIdentity, stable };
