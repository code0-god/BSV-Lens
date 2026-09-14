'use strict';

(function expose(root) {
    const PITCH = 12, CLEARANCE = 6;
    const ROUTING_LIMITS = Object.freeze({ maxNodes: 256, maxContacts: 2048, maxGroups: 512, maxConnections: 512, maxIncidences: 2048,
        maxMembers: 16384, maxVertices: 250000, maxExpansions: 2000000, maxChecks: 50000000,
        maxHeapEntries: 1000000, maxSegments: 65536, maxDimension: 8192, maxPasses: 3, maxLabelCandidates: 2048 });
    const snap = n => Math.ceil(n / PITCH) * PITCH;
    const key = (a, b) => JSON.stringify([a, b]);
    const error = (code, message, details = {}) => Object.assign(new Error(message), { code, ...details });
    const shorter = (value, width) => {
        const text = String(value ?? ''), count = Math.max(1, Math.floor(width / 7.5));
        return text.length <= count ? text : `${text.slice(0, Math.max(1, count - 3))}...`;
    };
    const boxHits = (a, b, pad = 0) => a.x < b.x + b.width + pad && a.x + a.width > b.x - pad
        && a.y < b.y + b.height + pad && a.y + a.height > b.y - pad;
    function hits(s, b, pad = 0) {
        return s[1] === s[3] ? s[1] > b.y - pad && s[1] < b.y + b.height + pad
            && Math.max(s[0], s[2]) > b.x - pad && Math.min(s[0], s[2]) < b.x + b.width + pad
            : s[0] > b.x - pad && s[0] < b.x + b.width + pad
            && Math.max(s[1], s[3]) > b.y - pad && Math.min(s[1], s[3]) < b.y + b.height + pad;
    }
    function label(id, ownerId, role, value, x, y, width, anchor = 'start') {
        const fullText = String(value ?? '');
        if (!fullText) throw error('INVALID_ROUTING_INPUT', `Missing ${role} label: ${ownerId}`);
        const text = shorter(fullText, width), w = text.length * 7.5 + 4;
        return { id, ownerId, role, fullText, text, textWidth: text.length * 7.5, x, y, anchor,
            bounds: { x: x - (anchor === 'end' ? w : 0) - 2, y: y - 14, width: w + 4, height: 20 } };
    }
    class Heap {
        constructor() { this.items = []; }
        push(value) {
            const a = this.items; let i = a.length; a.push(value);
            while (i) { const p = (i - 1) >> 1; if (a[p].cost <= value.cost) break; a[i] = a[p]; i = p; }
            a[i] = value;
        }
        pop() {
            const a = this.items, first = a[0], last = a.pop();
            if (a.length) { let i = 0;
                while (i * 2 + 1 < a.length) { let c = i * 2 + 1;
                    if (c + 1 < a.length && a[c + 1].cost < a[c].cost) c++;
                    if (a[c].cost >= last.cost) break; a[i] = a[c]; i = c;
                } a[i] = last;
            } return first;
        }
    }

    function layout(scene, size, options = {}) {
        if (!scene.shell || !Number.isFinite(size.width) || !Number.isFinite(size.height)
            || size.width <= 0 || size.height <= 0) throw error('INVALID_ROUTING_INPUT', 'Scene shell and positive canvas size required');
        const limits = { ...ROUTING_LIMITS };
        for (const [name, value] of Object.entries(options.limits || {})) {
            if (!(name in limits) || !Number.isSafeInteger(value) || value < 0 || value > limits[name])
                throw error('INVALID_ROUTING_INPUT', `Invalid routing limit: ${name}`);
            limits[name] = value;
        }
        const counts = { expansions: 0, checks: 0, passes: 0 };
        const overview = scene.sceneKind === 'bsv' && scene.projection?.kind === 'bsv-overview';
        const incidencePitch = overview ? PITCH * 2 : PITCH;
        if (overview && (scene.projection.ownerInstanceId !== scene.shell.id
            || typeof scene.projection.sourceRevision !== 'string'
            || scene.projection.sourceRevision !== scene.shell.sourceRefs?.[0]?.revision))
            throw error('INVALID_ROUTING_INPUT', 'Overview owner/source revision mismatch');
        function budget(name, value) {
            if (value > limits[name]) throw error('ROUTING_BUDGET_EXCEEDED', `Routing budget ${name}: ${value} > ${limits[name]}`, { budget: name, counts: { ...counts } });
        }
        const primaryLayout = overview && scene.storages.filter(storage => storage.primitiveKind === 'register').length > 16;
        const majorStorage = scene.storages.filter(storage => ['memory', 'fifo'].includes(storage.primitiveKind));
        const primaryIds = new Set([...scene.children, ...majorStorage].map(item => item.id));
        const objects = [...scene.children, ...(primaryLayout
            ? [...majorStorage, ...scene.storages.filter(storage => !primaryIds.has(storage.id))] : scene.storages)];
        budget('maxNodes', objects.length); budget('maxConnections', scene.connections.length);
        budget('maxContacts', scene.contacts.length); budget('maxGroups', (scene.interfaceGroups || []).length);
        const objectIds = new Set([scene.shell.id, ...objects.map(n => n.id)]);
        const sourceContacts = new Map(scene.contacts.map(c => [c.id, c]));
        const sourceGroups = new Map((scene.interfaceGroups || []).map(g => [g.id, g]));
        const entries = new Map();
        const sideOf = c => c.direction === 'output' ? 'right' : 'left';
        for (const c of [...scene.contacts, ...(scene.interfaceGroups || [])]) {
            if (!objectIds.has(c.ownerId)) throw error('INVALID_ROUTING_INPUT', `Missing contact/group owner: ${c.id}`);
            entries.set(c.id, { id: c.id, ownerId: c.ownerId, side: sideOf(c), source: c,
                type: sourceGroups.has(c.id) ? 'group' : 'contact', incidences: [] });
        }
        let memberCount = 0, incidenceCount = 0;
        const connectionIds = new Set(), incidenceIds = new Set();
        for (const connection of scene.connections) {
            if (!connection.id || connectionIds.has(connection.id)) throw error('INVALID_ROUTING_INPUT', 'Duplicate/missing connection identity');
            connectionIds.add(connection.id);
            const ids = connection.endpointIds || [connection.fromId, connection.toId];
            for (const [ordinal, id] of [...new Set(ids)].entries()) {
                let entry = entries.get(id);
                if (!entry && objectIds.has(id)) {
                    const incoming = ordinal > 0, boundary = id === scene.shell.id;
                    entry = { id, ownerId: id, side: incoming !== boundary ? 'left' : 'right', type: 'node', incidences: [] };
                    entries.set(id, entry);
                }
                if (!entry) throw error('INVALID_ROUTING_INPUT', `Missing scene connection endpoint: ${id}`);
                const explicit = connection.incidences?.find(i => i.contactId === id);
                const members = explicit ? explicit.members : (connection.members || []).flatMap(m =>
                    (m.endpoints || []).filter(e => e.entityId === id).map(e => ({ bitId: m.bitId,
                        endpointId: e.entityId, index: e.index, contactIndex: e.index, boundaryId: null })));
                if (sourceContacts.get(id)?.bits && connection.members?.length && !members.length)
                    throw error('INVALID_ROUTING_INPUT', `Missing canonical incidence projection: ${connection.id} / ${id}`);
                for (const m of members) {
                    if (!Number.isSafeInteger(m.contactIndex) || m.contactIndex < 0 || !Number.isSafeInteger(m.index)
                        || m.index < 0 || typeof m.bitId !== 'string' || !connection.members?.some(v => v.bitId === m.bitId
                            && v.endpoints?.some(e => e.entityId === m.endpointId && e.index === m.index)))
                        throw error('INVALID_ROUTING_INPUT', `Invalid incidence member: ${connection.id} / ${id}`);
                    if (sourceContacts.get(id)?.bits && m.contactIndex >= sourceContacts.get(id).bits.length)
                        throw error('INVALID_ROUTING_INPUT', `Out-of-range incidence index: ${id}`);
                }
                memberCount += members.length; incidenceCount++;
                budget('maxMembers', memberCount); budget('maxIncidences', incidenceCount);
                const incidenceId = explicit?.id ?? key(connection.id, id);
                if (typeof incidenceId !== 'string' || !incidenceId || incidenceIds.has(incidenceId))
                    throw error('INVALID_ROUTING_INPUT', `Duplicate/missing incidence identity: ${connection.id}`);
                incidenceIds.add(incidenceId);
                entry.incidences.push({ id: incidenceId, connectionId: connection.id, contactId: id,
                    indices: members.map(m => m.contactIndex),
                    bitIds: members.map(m => m.bitId), members });
            }
        }
        budget('maxMembers', memberCount); budget('maxIncidences', incidenceCount);
        for (const e of entries.values()) e.incidences.sort((a, b) => Math.min(...a.indices, Infinity) - Math.min(...b.indices, Infinity)
            || a.connectionId.localeCompare(b.connectionId));
        let failure, partial;
        for (let pass = 0; pass < limits.maxPasses; pass++) {
            counts.passes++;
            try {
                const geometry = routePass(pass);
                if (!geometry.routing?.deferred.length) return geometry;
                if (!partial || geometry.routing.deferred.length < partial.routing.deferred.length) partial = geometry;
            }
            catch (cause) { if (cause.code !== 'ROUTING_BLOCKED') throw cause; failure = cause; }
        }
        if (partial) { Object.assign(partial.metrics, counts); return partial; }
        throw failure || error('ROUTING_BUDGET_EXCEEDED', 'No routing passes permitted', { budget: 'maxPasses' });

        function routePass(pass) {
            const initialSpacing = scene.sceneKind === 'bsv' ? primaryLayout ? 168 : 120 : 192;
            const gap = initialSpacing + pass * 48;
            const outer = initialSpacing + pass * (scene.sceneKind === 'bsv' ? 48 : 24);
            const ownerEntries = id => [...entries.values()].filter(e => e.ownerId === id)
                .sort((a, b) => (a.type === 'group' ? 0 : 1) - (b.type === 'group' ? 0 : 1));
            const rowSize = e => Math.max(48, (Math.max(1, e.incidences.length) - 1) * incidencePitch + 48);
            const sideSize = (id, side) => ownerEntries(id).filter(e => e.side === side).reduce((sum, e) => sum + rowSize(e), 0);
            const dimensions = objects.map(object => {
                const owned = ownerEntries(object.id);
                const textWidth = side => Math.max(0, ...owned.filter(e => e.type === 'contact' && e.side === side)
                    .flatMap(e => [e.source.label, e.source.detail].map(text => shorter(text, 144).length * 7.5 + 8)));
                const primary = primaryLayout && primaryIds.has(object.id);
                return { width: snap(Math.max(primaryLayout && !primary ? 168 : 240, textWidth('left') + textWidth('right') + 48)),
                    height: snap(Math.max(primary ? 384 : 156, (primary ? 288 : 84)
                        + Math.max(sideSize(object.id, 'left'), sideSize(object.id, 'right')))) };
            });
            const columnEstimate = Math.sqrt(objects.length * Math.max(0.6, size.width / size.height) / 1.5);
            const columns = Math.max(1, Math.min(objects.length || 1, overview && objects.length > 64 ? objects.length : scene.sceneKind === 'bsv' ? 3 : 6,
                scene.sceneKind === 'bsv' ? Math.round(columnEstimate) : Math.ceil(columnEstimate)));
            function grid(boxes, count, spacing) {
                const rows = Math.ceil(boxes.length / count);
                const widths = Array.from({ length: count }, (_, i) => Math.max(0, ...boxes.filter((_, j) => j % count === i).map(d => d.width)));
                const heights = Array.from({ length: rows }, (_, i) => Math.max(0, ...boxes.slice(i * count, (i + 1) * count).map(d => d.height)));
                return { width: widths.reduce((a, b) => a + b, 0) + Math.max(0, count - 1) * spacing,
                    height: heights.reduce((a, b) => a + b, 0) + Math.max(0, rows - 1) * spacing,
                    boxes: boxes.map((box, i) => ({ ...box,
                        x: widths.slice(0, i % count).reduce((a, b) => a + b, 0) + i % count * spacing,
                        y: heights.slice(0, Math.floor(i / count)).reduce((a, b) => a + b, 0) + Math.floor(i / count) * spacing })) };
            }
            let arrangement = grid(dimensions, columns, gap);
            if (primaryLayout) {
                const aspect = Math.max(0.6, size.width / size.height), primaryCount = primaryIds.size;
                const storageColumns = Math.max(1, Math.ceil(Math.sqrt((objects.length - primaryCount) * aspect * 2)));
                const storage = grid(dimensions.slice(primaryCount), storageColumns, 72);
                const primaryColumns = Math.max(1, Math.min(primaryCount, 3, Math.ceil(Math.sqrt(primaryCount * aspect / 3))));
                const primaryWidth = Math.max(1440, snap((storage.width - (primaryColumns - 1) * gap) / primaryColumns));
                const primary = grid(dimensions.slice(0, primaryCount).map(box => ({ ...box, width: Math.max(box.width, primaryWidth) })), primaryColumns, gap);
                const storageY = primaryCount ? primary.height + gap : 0;
                arrangement = { width: Math.max(primary.width, storage.width), height: storageY + storage.height,
                    boxes: [...primary.boxes, ...storage.boxes.map(box => ({ ...box, y: box.y + storageY }))] };
            }
            const detached = scene.connections.filter(c => (c.endpointIds || [c.fromId, c.toId]).length === 0);
            const header = (primaryLayout ? 288 : 84) + Math.ceil(detached.length / 3) * 36;
            const boundaryLabelWidth = Math.max(0, ...ownerEntries(scene.shell.id).flatMap(entry => entry.source
                ? [entry.source.label, entry.source.detail].filter(Boolean).map(value => Math.min(144, String(value).length * 7.5 + 8))
                : []));
            const rail = overview ? snap(Math.max(48, Math.min(180, boundaryLabelWidth + 24))) : 180;
            const shell = { id: scene.shell.id, x: rail, y: 24,
                width: snap(Math.max(720, arrangement.width + outer * 2)),
                height: snap(Math.max(360, header + outer * 2 + arrangement.height,
                    header + outer + Math.max(sideSize(scene.shell.id, 'left'), sideSize(scene.shell.id, 'right')))) };
            const nodes = [shell, ...objects.map((object, i) => ({ id: object.id,
                ...arrangement.boxes[i], x: shell.x + outer + arrangement.boxes[i].x,
                y: shell.y + header + outer + arrangement.boxes[i].y }))];
            const bounds = { x: 0, y: 0, width: shell.x + shell.width + rail, height: shell.y + shell.height + (scene.sceneKind === 'bsv' ? 24 : 36) };
            budget('maxDimension', Math.max(bounds.width, bounds.height));
            const contacts = [], groups = [], attachments = new Map(), labels = [], obstacles = [];
            function addLabel(value) { labels.push(value); obstacles.push({ ...value.bounds, id: value.id, ownerId: value.ownerId, type: 'label' }); }
            for (const node of nodes) {
                const object = node.id === shell.id ? scene.shell : objects.find(o => o.id === node.id);
                addLabel(label(`${node.id}:title`, node.id, 'node-title', object.label, node.x + 16, node.y + 27, node.width - 40));
                if (object.secondaryLabel || object.detail) addLabel(label(`${node.id}:detail`, node.id, 'node-detail',
                    object.secondaryLabel || object.detail, node.x + 16, node.y + 47, node.width - 40));
                if (node.id !== shell.id) obstacles.push({ ...node, ownerId: node.id, type: 'body' });
                for (const side of ['left', 'right']) {
                    let y = node.y + (node.id === shell.id ? header + outer
                        : primaryLayout && primaryIds.has(node.id) ? 288 : 72);
                    for (const e of ownerEntries(node.id).filter(v => v.side === side)) {
                        const x = node.x + (side === 'right' ? node.width : 0), boundary = node.id === shell.id;
                        const slots = e.incidences.map((incidence, i) => ({ id: incidence.id, connectionId: incidence.connectionId,
                            contactId: e.id, x, y: y + i * incidencePitch, indices: incidence.indices, bitIds: incidence.bitIds }));
                        const centerY = y + Math.max(0, slots.length - 1) * incidencePitch / 2;
                        const point = { id: e.id, ownerId: node.id, side, boundary, x, y: centerY, slots };
                        if (e.type === 'contact') {
                            point.markBounds = { x: x - 4, y: y - 4, width: 8, height: Math.max(0, slots.length - 1) * incidencePitch + 8 };
                            contacts.push(point);
                            const sign = (side === 'left' ? 1 : -1) * (boundary ? -1 : 1), anchor = sign < 0 ? 'end' : 'start';
                            addLabel(label(`${e.id}:label`, e.id, 'contact-label', e.source.label, x + sign * 16, centerY - 4, 144, anchor));
                            if (e.source.detail) addLabel(label(`${e.id}:detail`, e.id, 'contact-detail', e.source.detail, x + sign * 16, centerY + 16, 144, anchor));
                            for (const p of slots.length ? slots : [point]) obstacles.push({ id: e.id, ownerId: node.id, type: 'contact',
                                x: p.x - 4, y: p.y - 4, width: 8, height: 8 });
                        } else if (e.type === 'group') {
                            const sign = (side === 'left' ? 1 : -1) * (boundary ? -1 : 1);
                            const l = label(`${e.id}:label`, e.id, 'interface-group', e.source.label,
                                x + sign * 16, centerY - 4, 144, sign < 0 ? 'end' : 'start');
                            addLabel(l); groups.push({ ...point, memberContactIds: e.source.memberContactIds || [], labelBounds: l.bounds });
                        }
                        for (const slot of slots) attachments.set(key(slot.connectionId, slot.contactId), { id: e.id, ownerId: node.id,
                            ...(e.type === 'contact' ? { contactId: e.id } : {}), ...(e.type === 'group' ? { groupId: e.id } : {}),
                            slotId: slot.id, side, boundary, x: slot.x, y: slot.y, indices: slot.indices, bitIds: slot.bitIds,
                            escapeX: slot.x + (side === 'right' ? 1 : -1) * (boundary ? -1 : 1) * 24 });
                        y += rowSize(e);
                    }
                }
            }
            // Header is structural reserved space; enclosure interior remains routable.
            obstacles.push({ id: shell.id, ownerId: shell.id, type: 'header', x: shell.x, y: shell.y, width: shell.width, height: header });
            const routes = scene.connections.map(c => {
                const points = [...new Set(c.endpointIds || [c.fromId, c.toId])].map(id => attachments.get(key(c.id, id)));
                return { id: c.id, points, attachments: points, segments: [], junctions: [], unconnected: !points.length };
            });
            // Place labels before maze search: paths must route around disclosed text,
            // rather than consuming every available text pocket before labels exist.
            const labelOffsets = scene.sceneKind === 'bsv' ? [-12, 26, -36, 50, -84] : [-12, 26, -36, 50];
            const labelOrder = [...routes].sort((a, b) => a.points.length - b.points.length || a.id.localeCompare(b.id));
            for (const r of labelOrder) {
                const c = scene.connections.find(v => v.id === r.id);
                let placed, attempts = 0;
                if (r.unconnected) {
                    const index = detached.findIndex(v => v.id === r.id), x = shell.x + 24 + (index % 3) * 216;
                    const y = shell.y + 84 + Math.floor(index / 3) * 36;
                    r.segments.push([x, y, x + 12, y]);
                    placed = label(`${r.id}:label`, r.id, 'connection', `No contacts: ${c.label}`, x + 24, y + 4, 168);
                } else if (!overview) {
                    for (const offset of [36, 60, 84]) for (const dy of labelOffsets) for (const p of r.points) {
                        if (placed || ++attempts > limits.maxLabelCandidates) continue;
                        const sign = Math.sign(p.escapeX - p.x);
                        const l = label(`${r.id}:label`, r.id, 'connection', c.label, p.x + sign * offset, p.y + dy, 144, sign < 0 ? 'end' : 'start');
                        const b = l.bounds;
                        if (b.x < shell.x + 12 || b.y < shell.y + header + 12 || b.x + b.width > shell.x + shell.width - 12
                            || b.y + b.height > shell.y + shell.height - 12) continue;
                        if (obstacles.some(o => { budget('maxChecks', ++counts.checks); return boxHits(b, o, 4); })) continue;
                        if (routes.some(other => other.points.some(p => { budget('maxChecks', ++counts.checks);
                            return hits([p.x, p.y, p.x + Math.sign(p.escapeX - p.x) * 60, p.y], b, 8); }))) continue;
                        placed = l;
                    }
                }
                if (!placed) {
                    budget('maxLabelCandidates', attempts);
                    placed = { id: `${r.id}:label`, ownerId: r.id, role: 'connection', fullText: String(c.label), text: String(c.label),
                        x: r.points[0].x, y: r.points[0].y, anchor: 'start', bounds: null,
                        foldedReason: overview ? 'overview-detail' : 'no-label-clearance' };
                }
                if (placed.foldedReason) labels.push(placed); else addLabel(placed);
                Object.assign(r, { labelX: placed.x, labelY: placed.y, labelAnchor: placed.anchor,
                    labelBounds: placed.bounds, label: placed });
            }
            const nx = shell.width / PITCH + 1, ny = shell.height / PITCH + 1, vertices = nx * ny;
            budget('maxVertices', vertices);
            const vertex = (x, y) => (y - shell.y) / PITCH * nx + (x - shell.x) / PITCH;
            const coords = v => [shell.x + (v % nx) * PITCH, shell.y + Math.floor(v / nx) * PITCH];
            const protectedEscape = new Uint16Array(vertices);
            const blocked = new Uint8Array(vertices), ho = new Uint16Array(vertices), vo = new Uint16Array(vertices);
            const hm = new Uint8Array(vertices), vm = new Uint8Array(vertices);
            const edgesH = new Uint16Array(vertices), edgesV = new Uint16Array(vertices);
            const horizontal = new Map(), vertical = new Map();
            function checkBudget() { budget('maxChecks', ++counts.checks); }
            for (const o of obstacles) {
                const x0 = Math.max(0, Math.ceil((o.x - CLEARANCE - shell.x) / PITCH));
                const x1 = Math.min(nx - 1, Math.floor((o.x + o.width + CLEARANCE - shell.x) / PITCH));
                const y0 = Math.max(0, Math.ceil((o.y - CLEARANCE - shell.y) / PITCH));
                const y1 = Math.min(ny - 1, Math.floor((o.y + o.height + CLEARANCE - shell.y) / PITCH));
                for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { checkBudget(); blocked[y * nx + x] = 1; }
            }
            for (let x = 0; x < nx; x++) blocked[x] = blocked[(ny - 1) * nx + x] = 1;
            for (let y = 0; y < ny; y++) blocked[y * nx] = blocked[y * nx + nx - 1] = 1;
            const baseBlocked = overview ? blocked.slice() : null, deferred = [];
            function reserve(s, owner) {
                const h = s[1] === s[3], axis = h ? 0 : 1, fixed = s[1 - axis];
                const lo = Math.min(s[axis], s[axis + 2]), hi = Math.max(s[axis], s[axis + 2]);
                const table = h ? horizontal : vertical;
                if (!table.has(fixed)) table.set(fixed, []);
                const list = table.get(fixed);
                for (const r of list) { checkBudget();
                    if (r.owner !== owner && Math.min(hi, r.hi) > Math.max(lo, r.lo))
                        throw error('ROUTING_BLOCKED', `Reserved interval collision: ${routes[owner - 1].id}`);
                }
                list.push({ lo, hi, owner }); list.sort((a, b) => a.lo - b.lo);
                for (let n = lo; n < hi; n += PITCH) {
                    const a = vertex(h ? n : fixed, h ? fixed : n), b = a + (h ? 1 : nx);
                    if (h) { edgesH[a] = owner; ho[a] = ho[b] = owner; hm[a] |= 2; hm[b] |= 1; }
                    else { edgesV[a] = owner; vo[a] = vo[b] = owner; vm[a] |= 2; vm[b] |= 1; }
                }
            }
            function compatible(v, axis, owner) {
                if (protectedEscape[v] && protectedEscape[v] !== owner) return false;
                if (axis === 0) return (!ho[v] || ho[v] === owner) && (!vo[v] || vo[v] === owner || vm[v] === 3);
                return (!vo[v] || vo[v] === owner) && (!ho[v] || ho[v] === owner || hm[v] === 3);
            }
            function foreign(v, owner) { return (ho[v] && ho[v] !== owner) || (vo[v] && vo[v] !== owner); }
            for (const [i, r] of routes.entries()) {
                if (r.unconnected) continue;
                for (const p of r.points) {
                    const s = [p.x, p.y, p.escapeX, p.y];
                    for (const o of obstacles) { checkBudget();
                        const own = o.type === 'body' && o.id === p.ownerId || o.type === 'contact' && o.id === p.id;
                        if (!own && hits(s, o, 2)) throw error('ROUTING_BLOCKED', `Escape obstacle: ${r.id} / ${p.id} / ${o.id}`);
                    }
                    const a = vertex(p.x, p.y), b = vertex(p.escapeX, p.y);
                    if (!Number.isInteger(a) || !Number.isInteger(b)) throw error('INVALID_ROUTING_INPUT', `Off-grid endpoint: ${p.id}`);
                    for (let v = Math.min(a, b); v <= Math.max(a, b); v++) {
                        if (!compatible(v, 0, i + 1) || foreign(v, i + 1))
                            throw error('ROUTING_BLOCKED', `Escape reservation collision: ${r.id} / ${p.id}`);
                    }
                    for (let v = Math.min(a, b); v <= Math.max(a, b); v++) {
                        protectedEscape[v] = i + 1;
                        // Only the tip is a maze terminal. Entering an escape midway
                        // would leave an unevidenced dangling tip after canonicalization.
                        if (v !== b) blocked[v] = 1;
                    }
                    reserve(s, i + 1); r.segments.push(s);
                }
            }
            let provisionalSegments = routes.reduce((sum, r) => sum + r.segments.length, 0);
            budget('maxSegments', provisionalSegments);
            const ordered = routes.filter(r => !r.unconnected).sort((a, b) => b.points.length - a.points.length || a.id.localeCompare(b.id));
            for (const r of ordered) {
                const owner = routes.indexOf(r) + 1, tree = new Set();
                const first = r.points[0]; tree.add(vertex(first.escapeX, first.y));
                try {
                    for (const p of r.points.slice(1)) {
                        const start = vertex(p.escapeX, p.y), chain = search(start, tree, owner);
                        for (let j = 1; j < chain.length; j++) {
                            const a = coords(chain[j - 1]), b = coords(chain[j]);
                            const s = [...a, ...b]; budget('maxSegments', ++provisionalSegments); r.segments.push(s); reserve(s, owner);
                        }
                        for (const v of chain) tree.add(v);
                    }
                } catch (cause) {
                    const connection = scene.connections[owner - 1];
                    if (!overview || cause.code !== 'ROUTING_BLOCKED' || cause.connectionId !== r.id
                        || connection.style !== 'semantic' || !connection.memberRelationIds?.length) throw cause;
                    deferred.push({ connectionId: r.id, memberRelationIds: [...connection.memberRelationIds],
                        code: cause.code, message: cause.message });
                    r.deferred = true; r.segments = [];
                    // Rebuild reservations from intact routes; a deferred relation leaves no painted stub or occupied track.
                    blocked.set(baseBlocked); horizontal.clear(); vertical.clear();
                    for (const table of [protectedEscape, ho, vo, hm, vm, edgesH, edgesV]) table.fill(0);
                    for (const [index, route] of routes.entries()) if (!route.deferred) {
                        for (const point of route.points) {
                            const a = vertex(point.x, point.y), b = vertex(point.escapeX, point.y);
                            for (let v = Math.min(a, b); v <= Math.max(a, b); v++) {
                                protectedEscape[v] = index + 1; if (v !== b) blocked[v] = 1;
                            }
                        }
                        for (const segment of route.segments) reserve(segment, index + 1);
                    }
                    continue;
                }
                r.segments = canonical(r.segments);
                budget('maxSegments', routes.reduce((sum, v) => sum + v.segments.length, 0));
            }
            function search(start, targets, owner) {
                const goals = [...targets].map(coords), distance = v => {
                    const [x, y] = coords(v); let best = Infinity;
                    for (const [gx, gy] of goals) best = Math.min(best, Math.abs(x - gx) + Math.abs(y - gy));
                    return best;
                };
                if (targets.has(start)) return [start];
                const heap = new Heap(), costs = new Float64Array(vertices * 2), previous = new Int32Array(vertices * 2);
                costs.fill(Infinity); previous.fill(-1);
                costs[start * 2] = 0; heap.push({ state: start * 2, cost: distance(start), g: 0 });
                while (heap.items.length) {
                    const item = heap.pop(), state = item.state, v = state >> 1, incoming = state & 1;
                    if (item.g !== costs[state]) continue;
                    budget('maxExpansions', ++counts.expansions);
                    if (targets.has(v) && !foreign(v, owner)) {
                        const chain = []; for (let s = state; s !== -1; s = previous[s]) chain.push(s >> 1);
                        return chain.reverse();
                    }
                    const x = v % nx, y = Math.floor(v / nx);
                    const neighbors = [[v - 1, 0, x > 0], [v + 1, 0, x + 1 < nx], [v - nx, 1, y > 0], [v + nx, 1, y + 1 < ny]];
                    for (const [n, axis, within] of neighbors) {
                        checkBudget();
                        if (!within || blocked[n] || !compatible(v, axis, owner) || !compatible(n, axis, owner)
                            || foreign(v, owner) && incoming !== axis) continue;
                        const edge = axis === 0 ? edgesH[Math.min(n, v)] : edgesV[Math.min(n, v)];
                        if (edge && edge !== owner) continue;
                        const next = n * 2 + axis, g = item.g + PITCH + (incoming === axis ? 0 : 18) + (foreign(n, owner) ? 24 : 0);
                        if (g >= costs[next]) continue;
                        costs[next] = g; previous[next] = state;
                        heap.push({ state: next, cost: g + distance(n), g });
                    }
                    budget('maxHeapEntries', heap.items.length);
                }
                throw error('ROUTING_BLOCKED', `No orthogonal path: ${routes[owner - 1].id}`, { connectionId: routes[owner - 1].id, start: coords(start), targets: [...targets].map(coords), attachments: routes[owner - 1].points, counts: { ...counts } });
            }
            const crossings = [];
            for (let v = 0; v < vertices; v++) {
                if (ho[v] && vo[v]) {
                    const [x, y] = coords(v);
                    if (ho[v] !== vo[v]) {
                        if (hm[v] !== 3 || vm[v] !== 3) throw error('ROUTING_BLOCKED', 'Non-proper foreign crossing');
                        crossings.push({ x, y, connectionIds: [routes[ho[v] - 1].id, routes[vo[v] - 1].id] });
                    } else if ((hm[v] === 3 || vm[v] === 3) && scene.connections[ho[v] - 1].style === 'physical')
                        routes[ho[v] - 1].junctions.push({ x, y });
                }
            }
            for (const r of routes) {
                r.path = r.segments.map(([x1, y1, x2, y2]) => `M${x1},${y1}L${x2},${y2}`).join(' ');
            }
            const geometry = { nodes, contacts, groups, routes: routes.filter(route => !route.deferred),
                labels: labels.filter(label => !deferred.some(item => item.connectionId === label.ownerId)), crossings, bounds,
                metrics: { bounds, totalRouteLength: routes.reduce((sum, r) => sum + r.segments.reduce((n, s) => n + Math.abs(s[2] - s[0]) + Math.abs(s[3] - s[1]), 0), 0),
                    bends: routes.reduce((sum, r) => sum + cornerCount(r.segments), 0), crossings: crossings.length,
                    segments: routes.reduce((sum, r) => sum + r.segments.length, 0), ...counts } };
            if (overview) geometry.routing = { status: deferred.length ? 'partial' : 'complete',
                routedRelationIds: geometry.routes.map(route => route.id), deferred };
            validate(geometry, scene, obstacles, checkBudget);
            geometry.metrics.checks = counts.checks;
            return geometry;
        }
    }
    function canonical(segments) {
        const lines = new Map();
        for (const s of segments) {
            const h = s[1] === s[3], axis = h ? 0 : 1, k = key(h, s[1 - axis]);
            if (!lines.has(k)) lines.set(k, { h, fixed: s[1 - axis], values: [] });
            lines.get(k).values.push([Math.min(s[axis], s[axis + 2]), Math.max(s[axis], s[axis + 2])]);
        }
        const result = [];
        for (const { h, fixed, values } of lines.values()) {
            values.sort((a, b) => a[0] - b[0]); let last;
            for (const [lo, hi] of values) {
                if (last && lo <= last[1]) last[1] = Math.max(last[1], hi);
                else { last = [lo, hi]; result.push({ h, fixed, range: last }); }
            }
        }
        return result.map(({ h, fixed, range: [lo, hi] }) => h ? [lo, fixed, hi, fixed] : [fixed, lo, fixed, hi]);
    }
    function cornerCount(segments) {
        const points = new Set();
        for (const a of segments) for (const b of segments) {
            if ((a[1] === a[3]) === (b[1] === b[3])) continue;
            for (const i of [0, 2]) for (const j of [0, 2]) if (a[i] === b[j] && a[i + 1] === b[j + 1]) points.add(key(a[i], a[i + 1]));
        } return points.size;
    }
    function validate(g, scene, obstacles, tick) {
        const inside = (x, y) => Number.isFinite(x) && Number.isFinite(y) && x >= 0 && y >= 0 && x <= g.bounds.width && y <= g.bounds.height;
        const shell = g.nodes[0];
        for (const r of g.routes) {
            if (!r.segments.length || !r.label || !r.path) throw error('INVALID_ROUTING_GEOMETRY', `Incomplete route: ${r.id}`);
            for (const s of r.segments) {
                if (!inside(s[0], s[1]) || !inside(s[2], s[3]) || (s[0] === s[2]) === (s[1] === s[3]))
                    throw error('INVALID_ROUTING_GEOMETRY', `Invalid segment: ${r.id}`);
                if (Math.min(s[0], s[2]) < shell.x || Math.max(s[0], s[2]) > shell.x + shell.width
                    || Math.min(s[1], s[3]) < shell.y || Math.max(s[1], s[3]) > shell.y + shell.height)
                    throw error('INVALID_ROUTING_GEOMETRY', `Shell boundary escape: ${r.id}`);
                if (s[0] === s[2] && (s[0] === shell.x || s[0] === shell.x + shell.width)
                    || s[1] === s[3] && (s[1] === shell.y || s[1] === shell.y + shell.height))
                    throw error('INVALID_ROUTING_GEOMETRY', `Route along shell boundary: ${r.id}`);
                for (const o of obstacles) { tick();
                    if (r.unconnected && o.type === 'header') continue;
                    if (o.type === 'contact' && r.points.some(p => p.id === o.id && p.y === s[1] && s[1] === s[3]
                        && (s[0] === p.x || s[2] === p.x))) continue;
                    if (hits(s, o)) throw error('INVALID_ROUTING_GEOMETRY', `Route obstacle: ${r.id} / ${o.id}`);
                }
            }
            const graph = new Map();
            const pointKey = (x, y) => `${x},${y}`;
            function connect(x, y, xx, yy) {
                const a = pointKey(x, y), b = pointKey(xx, yy);
                if (!graph.has(a)) graph.set(a, new Set());
                if (!graph.has(b)) graph.set(b, new Set());
                graph.get(a).add(b); graph.get(b).add(a);
            }
            for (const s of r.segments) {
                const length = Math.abs(s[2] - s[0]) + Math.abs(s[3] - s[1]);
                const dx = Math.sign(s[2] - s[0]), dy = Math.sign(s[3] - s[1]);
                for (let step = 0; step < length; step += PITCH) { tick();
                    connect(s[0] + dx * step, s[1] + dy * step, s[0] + dx * (step + PITCH), s[1] + dy * (step + PITCH));
                }
            }
            const terminals = new Set(r.points.map(p => pointKey(p.x, p.y)));
            if (r.points.length === 1) terminals.add(pointKey(r.points[0].escapeX, r.points[0].y));
            const expectedDots = new Set();
            for (const [id, edges] of graph) {
                if (!r.unconnected && edges.size === 1 && !terminals.has(id))
                    throw error('INVALID_ROUTING_GEOMETRY', `Unexpected dangling route: ${r.id} / ${id}`);
                if (edges.size >= 3) expectedDots.add(id);
            }
            const visited = new Set(), queue = [graph.keys().next().value];
            while (queue.length) { tick(); const id = queue.pop();
                if (visited.has(id)) continue; visited.add(id); queue.push(...graph.get(id));
            }
            if (visited.size !== graph.size || r.points.some(p => !visited.has(pointKey(p.x, p.y))))
                throw error('INVALID_ROUTING_GEOMETRY', `Disconnected route: ${r.id}`);
            if (scene.connections.find(c => c.id === r.id).style !== 'physical') expectedDots.clear();
            if (r.junctions.length !== expectedDots.size || r.junctions.some(p => !expectedDots.has(pointKey(p.x, p.y))))
                throw error('INVALID_ROUTING_GEOMETRY', `Unsupported junction: ${r.id}`);
        }
        const crossings = new Set();
        for (let i = 0; i < g.routes.length; i++) for (let j = i + 1; j < g.routes.length; j++) {
            for (const a of g.routes[i].segments) for (const b of g.routes[j].segments) { tick();
                const ah = a[1] === a[3], bh = b[1] === b[3];
                if (ah === bh) {
                    const k = ah ? 0 : 1;
                    if (a[1-k] === b[1-k] && Math.min(Math.max(a[k], a[k+2]), Math.max(b[k], b[k+2]))
                        >= Math.max(Math.min(a[k], a[k+2]), Math.min(b[k], b[k+2])))
                        throw error('INVALID_ROUTING_GEOMETRY', `Foreign collinear contact: ${g.routes[i].id} / ${g.routes[j].id}`);
                } else {
                    const h = ah ? a : b, v = ah ? b : a;
                    const x = v[0], y = h[1], left = Math.min(h[0], h[2]), right = Math.max(h[0], h[2]);
                    const top = Math.min(v[1], v[3]), bottom = Math.max(v[1], v[3]);
                    if (x < left || x > right || y < top || y > bottom) continue;
                    if (x === left || x === right || y === top || y === bottom)
                        throw error('INVALID_ROUTING_GEOMETRY', `Foreign non-proper crossing: ${g.routes[i].id} / ${g.routes[j].id}`);
                    crossings.add(key([x, y], [g.routes[i].id, g.routes[j].id].sort()));
                }
            }
        }
        const declaredCrossings = new Set(g.crossings.map(p => key([p.x, p.y], [...p.connectionIds].sort())));
        if (crossings.size !== declaredCrossings.size || [...crossings].some(k => !declaredCrossings.has(k)))
            throw error('INVALID_ROUTING_GEOMETRY', 'Incorrect crossing metadata');
        for (const l of g.labels) {
            if (l.foldedReason !== undefined) {
                const route = g.routes.find(r => r.id === l.ownerId), connection = scene.connections.find(c => c.id === l.ownerId);
                const overviewFold = scene.sceneKind === 'bsv' && scene.projection?.kind === 'bsv-overview' && l.foldedReason === 'overview-detail';
                if (!(l.foldedReason === 'no-label-clearance' || overviewFold) || l.role !== 'connection' || l.bounds !== null
                    || !connection || l.fullText !== connection.label || l.text !== connection.label
                    || !inside(l.x, l.y) || !route?.attachments.some(a => a.x === l.x && a.y === l.y))
                    throw error('INVALID_ROUTING_GEOMETRY', `Invalid folded connection label: ${l.id}`);
            } else if (!inside(l.bounds.x, l.bounds.y) || !inside(l.bounds.x + l.bounds.width, l.bounds.y + l.bounds.height))
                throw error('INVALID_ROUTING_GEOMETRY', `Label outside bounds: ${l.id}`);
        }
        const deferred = g.routing?.deferred || [], represented = [...g.routes.map(route => route.id), ...deferred.map(item => item.connectionId)];
        if (represented.length !== scene.connections.length || new Set(represented).size !== represented.length
            || scene.connections.some(connection => !represented.includes(connection.id))
            || deferred.some(item => item.code !== 'ROUTING_BLOCKED' || scene.sceneKind !== 'bsv'
                || scene.projection?.kind !== 'bsv-overview' || JSON.stringify(item.memberRelationIds)
                    !== JSON.stringify(scene.connections.find(connection => connection.id === item.connectionId)?.memberRelationIds)))
            throw error('INVALID_ROUTING_GEOMETRY', 'Dropped connection');
    }
    function fitViewport(geometry, size) {
        const bounds = geometry.bounds;
        const scale = Math.min(1.3, Math.max(0.001, (size.width - 48) / bounds.width),
            Math.max(0.001, (size.height - 60) / bounds.height));
        return { x: (size.width - bounds.width * scale) / 2 - bounds.x * scale,
            y: (size.height - bounds.height * scale) / 2 - bounds.y * scale - 8, scale };
    }
    const api = { layout, fitViewport, ROUTING_LIMITS };
    if (typeof module === 'object' && module.exports) module.exports = api;
    root.BsvHardwareLayout = api;
})(globalThis);
