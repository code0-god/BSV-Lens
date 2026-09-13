'use strict';
(function (root) {
    const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
    const domId = id => `hw-${encodeURIComponent(id)}`;
    const portLabel = p => `${p.direction === 'input' ? 'in' : p.direction === 'output' ? 'out' : p.direction || '?'} ${p.name} [${p.bits.length}]`;
    function layout(model, state, measure = text => [...text].length * 7) {
        const nodes = [], anchors = [], routes = [], continuations = [];
        const rootOccurrence = model.occurrences[state.rootId];
        const subjects = rootOccurrence ? rootOccurrence.cells.map(id => {
            const cell = model.cells[id];
            return cell.childOccurrenceId ? model.occurrences[cell.childOccurrenceId] : cell;
        }) : model.roots.map(id => model.occurrences[id]);
        subjects.sort((a, b) => compare(a.id, b.id));
        const endpointNode = new Map();
        const portsFor = item => (item.kind === 'occurrence' ? item.ports : item.pins).map(id => model.entities[id]);
        const portSide = p => p.direction === 'output' ? 'right' : 'left';
        function addAnchors(item, rect, boundary) {
            const ports = portsFor(item);
            for (const side of ['left', 'right']) {
                ports.filter(p => portSide(p) === side).forEach((p, i) => {
                    const a = { id: p.id, domId: domId(p.id), ownerId: item.id, side,
                        x: side === 'left' ? rect.x : rect.x + rect.width,
                        y: rect.y + 70 + i * 28, bits: p.bits, rawBits: p.rawBits,
                        direction: p.direction, name: p.name, label: portLabel(p), labelWidth: measure(portLabel(p)), boundary };
                    anchors.push(a); endpointNode.set(p.id, a);
                    if (item.kind === 'occurrence' && item.cellId) {
                        for (const bindingId of item.boundaries) {
                            const binding = model.boundaries[bindingId];
                            if (binding.portId === p.id) endpointNode.set(binding.pinId, a);
                        }
                    }
                });
            }
        }
        const groups = [];
        if (rootOccurrence) {
            const bySignature = new Map();
            for (const id of rootOccurrence.bits) {
                const bit = model.bits[id];
                if (!bit.endpoints.length) continue;
                const signature = `${bit.kind}:` + bit.endpoints.map(e => e.entityId).sort(compare).join('\n');
                if (!bySignature.has(signature)) bySignature.set(signature, []);
                bySignature.get(signature).push(bit);
            }
            for (const bits of bySignature.values()) {
                const order = model.entities[bits[0].endpoints[0].entityId].bits;
                bits.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
                groups.push({ bits, id: bits[0].id, constant: bits.every(bit => bit.kind === 'constant') });
            }
            groups.sort((a, b) => compare(a.id, b.id));
        }
        // Unique orthogonal lanes tolerate feedback. Constants stay at their connection site.
        const routed = groups.filter(group => !group.constant);
        const lanePitch = 7;
        const constantLabel = group => {
            const values = [...new Set(group.bits.map(bit => bit.value))];
            return values.length === 1 ? `${values[0]}${group.bits.length > 1 ? ` x${group.bits.length}` : ''}` : `${values.join('/')} x${group.bits.length}`;
        };
        const escapeStart = Math.ceil(Math.max(20, ...groups.filter(group => group.constant).map(group => 34 + measure(constantLabel(group)) / 2)));
        const laneBand = Math.max(30, routed.length * lanePitch + escapeStart + 8);
        const columnCount = Math.min(3, Math.max(1, Math.ceil(Math.sqrt(subjects.length))));
        const gutter = laneBand * 2 + 24;
        const externalRail = rootOccurrence ? Math.max(72, ...portsFor(rootOccurrence).map(p => measure(portLabel(p)) + 20)) : 24;
        const shellX = externalRail + 20, shellY = 28;
        const sizes = subjects.map(item => {
            const ports = portsFor(item);
            const left = ports.filter(p => portSide(p) === 'left'), right = ports.filter(p => portSide(p) === 'right');
            const labelWidth = list => Math.max(0, ...list.map(p => measure(portLabel(p))));
            return { width: Math.ceil(Math.max(190, labelWidth(left) + labelWidth(right) + 52)),
                height: Math.max(126, 88 + 28 * Math.max(left.length, right.length)) };
        });
        const columnWidths = Array.from({ length: columnCount }, (_, col) => Math.max(190, ...sizes.filter((_, i) => i % columnCount === col).map(s => s.width)));
        const rowCount = Math.ceil(subjects.length / columnCount);
        const rowHeights = Array.from({ length: rowCount }, (_, row) => Math.max(...sizes.slice(row * columnCount, (row + 1) * columnCount).map(s => s.height)) + 28);
        const innerX = shellX + laneBand + 24, innerY = shellY + 68 + laneBand;
        subjects.forEach((item, index) => {
            const col = index % columnCount, row = Math.floor(index / columnCount);
            const rect = { x: innerX + columnWidths.slice(0, col).reduce((a, b) => a + b, 0) + col * gutter,
                y: innerY + rowHeights.slice(0, row).reduce((a, b) => a + b, 0) + col * 3, ...sizes[index] };
            const type = item.kind === 'occurrence' ? model.definitions[item.definitionId].name : item.type;
            nodes.push({ id: item.id, domId: domId(item.id), ...rect, expanded: false,
                kind: item.kind, name: item.name, displayName: item.kind === 'cell' ? type : item.name, type,
                expandable: item.kind === 'occurrence' && !item.blackbox && item.cells.length > 0, blackbox: item.blackbox === true });
            addAnchors(item, rect, false);
        });
        const shellRight = Math.max(innerX + 190, ...nodes.map(node => node.x + node.width)) + laneBand + 24;
        const shellBottom = Math.max(innerY + 126, ...nodes.map(node => node.y + node.height)) + 28;
        if (rootOccurrence) {
            const shell = { id: rootOccurrence.id, domId: domId(rootOccurrence.id), x: shellX, y: shellY,
                width: shellRight - shellX, height: Math.max(shellBottom - shellY, 100 + rootOccurrence.ports.length * 28),
                expanded: true, kind: 'occurrence', name: rootOccurrence.name, displayName: rootOccurrence.name,
                type: model.definitions[rootOccurrence.definitionId].name, expandable: false, blackbox: rootOccurrence.blackbox };
            nodes.unshift(shell); addAnchors(rootOccurrence, shell, true);
            for (const anchor of anchors.filter(a => a.boundary)) {
                anchor.y += laneBand;
                const bindings = rootOccurrence.boundaries.map(id => model.boundaries[id]).filter(b => b.portId === anchor.id);
                if (bindings.length) continuations.push({ id: `continuation:${anchor.id}`, portId: anchor.id,
                    x: anchor.x, y: anchor.y, endX: anchor.x + (anchor.side === 'left' ? -18 : 18),
                    bits: anchor.bits, bindings, presentationOnly: true });
            }
            groups.forEach(group => {
                const index = routed.indexOf(group);
                const points = [];
                for (const endpoint of group.bits[0].endpoints) {
                    const anchor = endpointNode.get(endpoint.entityId);
                    if (anchor && !points.some(point => point.anchorId === anchor.id)) {
                        const sign = (anchor.side === 'left' ? -1 : 1) * (anchor.boundary ? -1 : 1);
                        const escapeX = anchor.x + sign * (group.constant ? 22 : escapeStart + index * lanePitch);
                        points.push({ x: anchor.x, y: anchor.y, escapeX, anchorId: anchor.id, endpointId: endpoint.entityId });
                    }
                }
                const trackY = shellY + 62 + index * lanePitch;
                const xs = points.map(point => point.escapeX);
                const left = Math.min(...xs), right = Math.max(...xs);
                const segments = [], junctions = [];
                let constantMarker = null;
                if (group.constant) {
                    const p = points[0];
                    segments.push([p.x, p.y, p.escapeX, p.y]);
                    constantMarker = { x: p.escapeX, y: p.y, values: group.bits.map(bit => bit.value),
                        label: constantLabel(group),
                        anchorId: p.anchorId, bitIds: group.bits.map(bit => bit.id), presentationOnly: true };
                } else if (points.length) {
                    segments.push([left, trackY, right, trackY]);
                    const escapes = new Map();
                    for (const p of points) {
                        segments.push([p.x, p.y, p.escapeX, p.y]);
                        if (!escapes.has(p.escapeX)) escapes.set(p.escapeX, []);
                        escapes.get(p.escapeX).push(p.y);
                    }
                    for (const [x, ys] of escapes) {
                        segments.push([x, trackY, x, Math.max(...ys)]);
                        if (x > left && x < right) junctions.push({ x, y: trackY });
                        for (const y of ys) if (y < Math.max(...ys)) junctions.push({ x, y });
                    }
                }
                const bitIds = group.bits.map(bit => bit.id);
                const aliases = [...new Set(group.bits.flatMap(bit => bit.aliases.map(alias => alias.aliasId)))];
                const exactAlias = aliases.map(id => model.aliases[id]).find(alias => alias.bits.length === bitIds.length &&
                    new Set(alias.bits).size === bitIds.length && alias.bits.every(id => bitIds.includes(id)));
                routes.push({ id: group.id, domId: domId(`route:${group.id}`), bits: exactAlias ? exactAlias.bits : bitIds,
                    rawBits: (exactAlias ? exactAlias.bits : bitIds).map(id => model.bits[id].value),
                    name: exactAlias ? exactAlias.name : `bits ${group.bits.map(bit => bit.value).join(',')}`,
                    ordering: exactAlias ? 'net-alias-vector' : 'unique-provider-bits', constantMarker,
                    aliases, points, segments, junctions, trackY, left, right,
                    path: segments.map(([x1, y1, x2, y2]) => `M${x1},${y1}H${x2}V${y2}`).join(' ') });
            });
        }
        return { nodes, anchors, routes, continuations,
            bounds: { x: 0, y: 0, width: shellRight + externalRail + 20, height: Math.max(shellBottom, ...nodes.map(n => n.y + n.height)) + 24 },
            policy: 'measured-bounded-generic-lanes-v2', representedBits: routes.flatMap(route => route.bits) };
    }
    const api = { layout, domId, portLabel };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.HardwareLayout = api;
})(globalThis);
