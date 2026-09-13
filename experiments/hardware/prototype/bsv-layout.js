'use strict';
(function (root) {
    const domId = id => `bsv-${encodeURIComponent(id)}`;
    const entity = (view, id) => view.occurrences[id] || view.storage[id] || view.boundaries[id] || view.behaviors[id] || view.relations[id];
    const ports = (view, occurrence) => occurrence.ports.map(id => view.boundaries[id]).filter(p => p.kind === 'method-boundary');
    const signature = port => `${port.methodKind} ${port.name}${port.arguments.length ? `(${port.arguments.map(arg => `${arg.type} ${arg.name}`).join(', ')})` : ''}${port.result.status === 'typed' ? ` : ${port.result.type}` : port.result.status === 'unknown' ? ' : unknown' : ''}`;
    function layout(view, state, measure = text => text.length * 7) {
        const nodes = [], anchors = [], routes = [];
        const owners = state.rootId ? [view.occurrences[state.rootId]] : view.roots.map(id => view.occurrences[id]);
        let nextY = 24;
        for (const owner of owners) {
            const items = [...owner.children.map(id => view.occurrences[id]), ...owner.storage.map(id => view.storage[id])];
            const relations = Object.values(view.relations).filter(r => r.ownerOccurrenceId === owner.id);
            const columns = Math.max(1, Math.min(2, items.length));
            const sizes = items.map(item => {
                const contacts = view.occurrences[item.id] ? ports(view, item) : [];
                return { width: Math.max(240, measure(item.declaredType || item.name) + 40,
                    ...contacts.map(port => measure(signature(port)) + 48)), height: Math.max(120, 70 + contacts.length * 32) };
            });
            const columnWidths = Array.from({ length: columns }, (_, col) => Math.max(240, ...sizes.filter((_, i) => i % columns === col).map(s => s.width)));
            const rows = Math.ceil(items.length / columns);
            const rowHeights = Array.from({ length: rows }, (_, row) => Math.max(...sizes.slice(row * columns, (row + 1) * columns).map(s => s.height)));
            const ownerPorts = ports(view, owner), headerHeight = 76 + ownerPorts.length * 32;
            const relationBand = relations.length * 28 + 24;
            const width = Math.max(640, columnWidths.reduce((sum, w) => sum + w, 0) + (columns - 1) * 80 + 144,
                ...ownerPorts.map(port => measure(signature(port)) + 160));
            const height = headerHeight + relationBand + rowHeights.reduce((sum, h) => sum + h, 0) + Math.max(0, rows - 1) * 64 + 72;
            const shell = { id: owner.id, domId: domId(owner.id), name: owner.name, type: owner.declaredType,
                kind: 'module-occurrence', expanded: true, x: 24, y: nextY, width, height, parentId: null };
            nodes.push(shell);
            function addPorts(item, box, boundary) {
                for (const port of item.ports.map(id => view.boundaries[id]).filter(p => p.kind !== 'method-boundary')) {
                    const label = port.interfacePath.length ? `${port.interfacePath.join('.')}: ${port.interfaceType}`
                        : item.declaredType === 'inferred' ? item.compilerType || port.interfaceType : item.declaredType || port.interfaceType;
                    anchors.push({ id: port.id, domId: domId(port.id), ownerId: item.id, name: port.name,
                        kind: port.kind, label, labelWidth: measure(label), boundary,
                        x: box.x + box.width, y: box.y + 44, side: 'right' });
                }
                ports(view, item).forEach((port, i) => {
                    const output = port.methodKind === 'Value';
                    anchors.push({ id: port.id, domId: domId(port.id), ownerId: item.id, name: port.name,
                        kind: port.kind, label: signature(port), labelWidth: measure(signature(port)), boundary,
                        x: output ? box.x + box.width : box.x, y: box.y + 72 + i * 32, side: output ? 'right' : 'left' });
                });
            }
            addPorts(owner, shell, true);
            items.forEach((item, i) => {
                const col = i % columns, row = Math.floor(i / columns);
                const box = { ...sizes[i], x: shell.x + 72 + columnWidths.slice(0, col).reduce((sum, w) => sum + w, 0) + col * 80,
                    y: shell.y + headerHeight + relationBand + rowHeights.slice(0, row).reduce((sum, h) => sum + h, 0) + row * 64 };
                nodes.push({ id: item.id, domId: domId(item.id), name: item.name, type: item.declaredType,
                    kind: view.storage[item.id] ? 'storage' : 'module-occurrence', expanded: false, parentId: owner.id, ...box });
                if (view.occurrences[item.id]) addPorts(item, box, false);
            });
            const endpoint = (id, index, end) => {
                const anchor = anchors.find(a => a.id === id);
                if (anchor) return { x: anchor.x, y: anchor.y, id, side: anchor.side, boundary: anchor.boundary };
                const node = nodes.find(n => n.id === id);
                if (node) return { x: node.x + (end ? node.width : 0), y: node.y + node.height / 2, id, side: end ? 'right' : 'left', boundary: node.expanded };
                const behavior = view.behaviors[id];
                if (behavior) {
                    const contact = ownerPorts.find(port => port.behaviorIds.includes(id));
                    if (contact) return endpoint(contact.id, index, end);
                    // A rule is a behavior origin on its owner's boundary, never a physical block.
                    return { x: shell.x, y: shell.y + headerHeight + 16 + index * 28, id, behaviorOrigin: true };
                }
                const item = entity(view, id);
                if (item?.ownerOccurrenceId === owner.id) return { x: shell.x + (end ? shell.width : 0), y: shell.y + headerHeight + 16 + index * 28, id, boundaryContext: true };
                return null;
            };
            relations.forEach((relation, index) => {
                const from = endpoint(relation.fromId, index, false), to = endpoint(relation.toId, index, true);
                if (!from || !to) throw new Error(`Semantic relation endpoint unavailable: ${relation.id}`);
                const trackY = shell.y + headerHeight + 16 + index * 28;
                const escape = 16 + index * 2;
                const escapeX = p => p.side ? p.x + (p.side === 'right' ? 1 : -1) * (p.boundary ? -1 : 1) * escape
                    : p.x === shell.x ? p.x + 32 : p.x - 32;
                const fromX = escapeX(from), toX = escapeX(to);
                const behavior = view.behaviors[relation.behaviorId];
                routes.push({ id: relation.id, domId: domId(relation.id), kind: relation.kind, from, to,
                    label: `${relation.kind}${behavior ? ` / ${behavior.name}` : ''}`,
                    labelX: shell.x + 48, labelY: trackY - 6, trackY, toApproach: Math.sign(toX - to.x),
                    path: `M${from.x},${from.y}H${fromX}V${trackY}H${toX}V${to.y}H${to.x}` });
            });
            nextY += height + 48;
        }
        return { kind: 'bsv', nodes, anchors, routes, bounds: { x: 0, y: 0,
            width: Math.max(0, ...nodes.map(n => n.x + n.width)) + 24, height: nextY },
            policy: 'source-owned-containment-and-typed-semantic-lanes', snapshotId: view.snapshotId };
    }
    const api = { layout, entity, signature, domId };
    if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.BsvLayout = api;
})(globalThis);
