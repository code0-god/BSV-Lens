'use strict';
(function expose(root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    root.BsvHardwareReadability = api;
}(globalThis, function createApi() {
    const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
    const letters = text => [...segmenter.segment(String(text))].map(item => item.segment);
    const overlap = (a, b, gap = 2) => a.x < b.x + b.width + gap && a.x + a.width + gap > b.x
        && a.y < b.y + b.height + gap && a.y + a.height + gap > b.y;
    const inside = (a, b) => a.x >= b.x && a.y >= b.y && a.x + a.width <= b.x + b.width && a.y + a.height <= b.y + b.height;
    const union = boxes => ({ x: Math.min(...boxes.map(b => b.x)), y: Math.min(...boxes.map(b => b.y)),
        width: Math.max(...boxes.map(b => b.x + b.width)) - Math.min(...boxes.map(b => b.x)),
        height: Math.max(...boxes.map(b => b.y + b.height)) - Math.min(...boxes.map(b => b.y)) });
    function detailLevel(scale, previous) {
        if (previous === 'overview' && scale < 0.65 || scale < 0.5) return 'overview';
        if (previous === 'detail' && scale > 1 || scale > 1.2) return 'detail';
        return 'normal';
    }
    function compactFamily(item) {
        const dimensions = item?.family?.dimensions;
        if (!dimensions?.length) return null;
        const kind = item.kind === 'module-occurrence' ? 'Module'
            : { register: 'Reg', fifo: 'FIFO', memory: 'Memory' }[item.primitiveKind] || 'Storage';
        if (item.family.resolutionStatus === 'exact' && item.multiplicity?.status === 'exact') {
            return dimensions.length === 1 ? [`${kind} × ${item.multiplicity.count}`, kind]
                : [`${kind} ${dimensions.map(dimension => dimension.expression).join(' × ')}`, kind];
        }
        const status = item.family.resolutionStatus === 'symbolic' ? 'symbolic' : 'unresolved';
        return [`${kind} · ${dimensions.length}D · ${status}`, `${dimensions.length}D · ${status}`, kind];
    }
    function shorten(fullText, width, size, role, measure, peers) {
        if (measure(fullText, size, role).width <= width) return fullText;
        const units = letters(fullText);
        const words = String(fullText).match(/[A-Z]+(?=[A-Z][a-z]|\d|$)|[A-Z]?[a-z]+|\d+/g) || [];
        if (words.length > 1) {
            const suffix = words.slice(1).join('');
            for (let prefix = words[0].length; prefix >= 1; prefix--) {
                const text = `${words[0].slice(0, prefix)}…${suffix}`;
                const ambiguous = peers.some(peer => {
                    if (peer === fullText) return false;
                    const peerWords = String(peer).match(/[A-Z]+(?=[A-Z][a-z]|\d|$)|[A-Z]?[a-z]+|\d+/g) || [];
                    return peerWords.length > 1
                        && `${peerWords[0].slice(0, prefix)}…${peerWords.slice(1).join('')}` === text;
                });
                if (!ambiguous && measure(text, size, role).width <= width) return text;
            }
        }
        const tail = letters(fullText.split(/[\s_./$]+/u).at(-1));
        let suffix = Math.min(tail.length <= 12 && tail.length < units.length ? Math.max(4, tail.length) : 4, units.length);
        while (suffix < units.length && peers.some(text => text !== fullText && text.endsWith(units.slice(-suffix).join('')))) suffix++;
        for (let prefix = units.length - suffix - 1; prefix >= 1; prefix--) {
            const text = `${units.slice(0, prefix).join('')}…${units.slice(-suffix).join('')}`;
            if (measure(text, size, role).width <= width) return text;
        }
        for (const token of fullText.split(/[\s_./$]+/u).reverse().filter(Boolean)) {
            const text = `…${token}`;
            if (!peers.some(peer => peer !== fullText && peer.split(/[\s_./$]+/u).includes(token))
                && measure(text, size, role).width <= width) return text;
        }
        return null;
    }
    function wrapTitle(fullText, width, size, measure, maxLines = 3) {
        const value = String(fullText);
        if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(value)) return null;
        const words = value.match(/[A-Z]+(?=[A-Z][a-z]|\d|$)|[A-Z]?[a-z]+|\d+|[_$]+/g) || [];
        if (words.length < 2 || words.join('') !== value) return null;
        const lines = [];
        for (const word of words) {
            const joined = `${lines.at(-1) || ''}${word}`;
            if (lines.length && measure(joined, size, 'node-title').width <= width) lines[lines.length - 1] = joined;
            else {
                if (measure(word, size, 'node-title').width > width || lines.length === maxLines) return null;
                lines.push(word);
            }
        }
        if (lines.length < 2) return null;
        const metrics = lines.map(line => measure(line, size, 'node-title'));
        const lineHeight = Math.max(size, ...metrics.map(metric => metric.ascent + metric.descent)) + 1;
        return { lines, lineHeight, width: Math.max(...metrics.map(metric => metric.width)),
            ascent: metrics[0].ascent, descent: (lines.length - 1) * lineHeight + metrics.at(-1).descent };
    }
    function projectLabels({ scene, geometry, viewport, canvas, current, measure, level = detailLevel(viewport.scale), projection }) {
        const { x: vx, y: vy, scale } = viewport;
        const screen = box => ({ x: vx + box.x * scale, y: vy + box.y * scale,
            width: box.width * scale, height: box.height * scale });
        const frame = { x: 2, y: 2, width: Math.max(0, canvas.width - 4), height: Math.max(0, canvas.height - 4) };
        const objects = new Map([scene.shell, ...scene.children, ...scene.storages].map(item => [item.id, item]));
        const nodeBoxes = new Map(geometry.nodes.map(box => [box.id, screen(box)]));
        const points = new Map([...geometry.contacts, ...(geometry.groups || [])].map(point => [point.id, point]));
        const selected = new Set([current.selectedEntityId, current.selectedRelationId,
            ...(projection?.references.find(r => r.entityId === current.disclosureState.analysis?.resultSelection)?.displayIds || [])]);
        const related = new Set([...(projection?.nodes || []), ...(projection?.contacts || []), ...(projection?.routes || [])]
            .filter(item => item.seed || item.result || item.boundary).map(item => item.id));
        const ports = geometry.contacts.flatMap(point => (point.slots?.length ? point.slots : [point])
            .map(slot => ({ ...screen({ x: slot.x - 4, y: slot.y - 4, width: 8, height: 8 }), ownerId: point.id })));
        const wires = geometry.routes.flatMap(route => route.segments.map(([x1, y1, x2, y2]) => ({
            x: vx + Math.min(x1, x2) * scale - 1, y: vy + Math.min(y1, y2) * scale - 1,
            width: Math.abs(x2 - x1) * scale + 2, height: Math.abs(y2 - y1) * scale + 2, ownerId: route.id })));
        const names = [...objects.values()].map(item => item.kind === 'rtl-cell' ? item.secondaryLabel || item.label : item.label);
        const interfaceNames = new Map();
        for (const label of geometry.labels) if (label.role === 'interface-group') {
            const owner = points.get(label.ownerId)?.ownerId;
            if (!interfaceNames.has(owner)) interfaceNames.set(owner, []);
            interfaceNames.get(owner).push(label.fullText);
        }
        const candidates = geometry.labels.map(label => {
            const item = objects.get(label.ownerId), primary = label.role === 'node-title';
            const fullText = item?.kind === 'rtl-cell' ? primary ? item.secondaryLabel || item.label : item.label : label.fullText;
            const priority = (selected.has(label.ownerId) ? 100 : label.ownerId === scene.shell.id ? 90
                : primary ? 80 : related.has(label.ownerId) ? 70 : label.role === 'contact-label' ? 60 : 20) - (primary ? 0 : 1);
            return { ...label, fullText, priority };
        }).sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));
        const labels = [], occupied = [], visibleTitles = new Map();
        for (const label of candidates) {
            const overviewFold = scene.sceneKind === 'bsv' && scene.projection?.kind === 'bsv-overview' && label.foldedReason === 'overview-detail';
            if (label.role === 'connection' && (label.foldedReason === 'no-label-clearance' || overviewFold) && label.bounds === null) {
                labels.push({ id: label.id, ownerId: label.ownerId, role: label.role, fullText: label.fullText, text: label.fullText,
                    visible: false, reason: label.foldedReason, priority: label.priority, x: label.x, y: label.y, anchor: label.anchor,
                    fontSize: 12 / scale, screenFontSize: 12, bounds: null, pointerPolicy: 'none' });
                continue;
            }
            const primary = label.role === 'node-title', node = nodeBoxes.get(label.ownerId), point = points.get(label.ownerId);
            const groupOwner = scene.sceneKind === 'bsv' && label.role === 'interface-group' && point && !point.boundary
                ? nodeBoxes.get(point.ownerId) : null;
            const groupStrip = groupOwner ? { x: groupOwner.x + (point.side === 'right' ? groupOwner.width * 0.75 : 0),
                y: groupOwner.y + Math.max(20, 72 * scale), width: groupOwner.width / 4,
                height: Math.max(0, groupOwner.height - Math.max(20, 72 * scale)) } : null;
            const important = selected.has(label.ownerId) || related.has(label.ownerId);
            const secondary = ['node-detail', 'contact-detail'].includes(label.role);
            let folded = null;
            if (label.role === 'node-detail' && label.fullText === objects.get(label.ownerId)?.label) folded = 'duplicate-name';
            if (secondary && level === 'overview' && label.ownerId !== scene.shell.id
                && !(label.role === 'node-detail' && objects.get(label.ownerId)?.family)) folded = 'overview-detail';
            if (label.role === 'connection' && !important && level !== 'detail') folded = 'overview-wire-name';
            if (point && scene.sceneKind === 'rtl' && level === 'overview' && !important) folded = 'overview-pin-detail';
            const targetSize = primary || important || label.role === 'contact-label' || label.ownerId === scene.shell.id ? 12 : Math.max(9, Math.min(11, 11 * scale));
            const sizes = primary && !important && level === 'overview' ? [12, 11, 10, 9] : [targetSize];
            let selectedAttempt = null, abbreviated = null, attempt;
            for (const size of sizes) {
                let reason = folded, x = vx + label.x * scale, y = vy + label.y * scale, anchor = label.anchor;
                let width = label.bounds.width * scale;
                if (node) {
                    const inset = Math.max(primary && !important && level === 'overview' ? 2 : 4, 16 * scale);
                    x = node.x + inset; anchor = 'start';
                    y = node.y + Math.max(size + 4, 27 * scale) + (primary ? 0 : Math.max(16, 20 * scale));
                    width = Math.max(0, node.width - 2 * inset - (level === 'overview' ? 0 : 28 * scale + 2));
                } else if (point) {
                    const sign = (point.side === 'left' ? 1 : -1) * (point.boundary ? -1 : 1);
                    x = vx + point.x * scale + sign * Math.max(6, 16 * scale); anchor = sign < 0 ? 'end' : 'start';
                    y = vy + point.y * scale - Math.max(4, 4 * scale) - 4;
                    if (label.role === 'contact-detail') y += Math.max(24, 20 * scale);
                    width = Math.max(width, Math.min(144 * scale, 120));
                    if (groupStrip) width = Math.max(0, Math.min(width,
                        anchor === 'end' ? x - groupStrip.x : groupStrip.x + groupStrip.width - x));
                }
                const peers = primary ? names : label.role === 'interface-group' ? interfaceNames.get(point?.ownerId) || [] : [];
                const wrapped = primary && level === 'overview' ? wrapTitle(label.fullText, width, size, measure) : null;
                const compact = label.role === 'node-detail' ? compactFamily(objects.get(label.ownerId)) : null;
                const useCompact = compact && measure(label.fullText, size, label.role).width > width;
                const shown = wrapped ? label.fullText : useCompact
                    ? compact.find(value => measure(value, size, label.role).width <= width) || null
                    : shorten(label.fullText, width, size, label.role, measure, peers);
                if (!shown) reason ||= groupStrip ? 'interface-boundary-space' : 'insufficient-name-space';
                const metrics = wrapped || measure(shown || label.fullText, size, label.role);
                if (node && wrapped) y = node.y + metrics.ascent + 2;
                if (node && compact) {
                    const title = visibleTitles.get(label.ownerId);
                    if (title) y = Math.max(y, title.y + title.height + metrics.ascent + 2);
                }
                let box, placement = null;
                const offsets = node ? primary ? wrapped ? [0] : [0, node.y + metrics.ascent + 2 - y] : [0] : [0, -8, 8, -16, 16];
                const positions = [x, ...(node && primary ? [x + width - metrics.width] : [])]
                    .flatMap(left => offsets.map(dy => ({ x: left, y: y + dy })));
                if (node && primary && selected.has(label.ownerId)) positions.push({
                    x: Math.max(x, frame.x + 4), y: Math.max(y, frame.y + metrics.ascent + 4) });
                for (const position of positions) {
                    box = { x: position.x - (anchor === 'end' ? metrics.width : 0), y: position.y - metrics.ascent,
                        width: metrics.width, height: metrics.ascent + metrics.descent };
                    if (!inside(box, frame) || node && !inside(box, { x: node.x + 2, y: node.y + 2, width: node.width - 4, height: node.height - 4 })) continue;
                    if (groupStrip && !inside(box, groupStrip)) continue;
                    if (occupied.some(other => overlap(box, other))) continue;
                    if (ports.some(port => overlap(box, port, 1))) continue;
                    // Routes render below node bodies. A selected title inside its own node stays mandatory;
                    // rejecting it for an already-occluded route can leave the selected object nameless.
                    if (!(node && primary && selected.has(label.ownerId))
                        && wires.some(wire => overlap(box, wire, 1))) continue;
                    if ([...nodeBoxes].some(([id, other]) => id !== scene.shell.id && id !== label.ownerId && id !== point?.ownerId && overlap(box, other, 1))) continue;
                    placement = { box, ...position }; break;
                }
                if (!placement) reason ||= !inside(box, frame) ? 'outside-viewport' : groupStrip ? 'interface-boundary-space' : 'label-clearance';
                if (placement) { box = placement.box; x = placement.x; y = placement.y; }
                attempt = { size, x, y, anchor, box, shown, reason, compacted: useCompact && !!shown,
                    lines: wrapped?.lines || null,
                    lineHeight: wrapped?.lineHeight || null };
                if (!reason && shown === label.fullText) { selectedAttempt = attempt; break; }
                if (!reason) abbreviated ||= attempt;
            }
            const overviewOccurrence = level === 'overview' && scene.sceneKind === 'rtl' && objects.get(label.ownerId)?.kind === 'rtl-occurrence';
            if (!selectedAttempt && primary && node && (selected.has(label.ownerId) || overviewOccurrence)) {
                for (const size of selected.has(label.ownerId) ? [12] : [12, 11, 10, 9]) {
                    const metrics = measure(label.fullText, size, label.role), height = metrics.ascent + metrics.descent;
                    const middleX = node.x + (node.width - metrics.width) / 2, middleY = node.y + (node.height - height) / 2;
                    const positions = [{ x: middleX, y: node.y - height - 6 }, { x: middleX, y: node.y + node.height + 6 },
                        { x: node.x - metrics.width - 6, y: middleY }, { x: node.x + node.width + 6, y: middleY }];
                    for (const position of positions) {
                        const box = { ...position, width: metrics.width, height };
                        if (!inside(box, frame) || !inside(box, screen(geometry.bounds))
                            || occupied.some(other => overlap(box, other)) || ports.some(port => overlap(box, port, 1))
                            || wires.some(wire => overlap(box, wire, 1))
                            || (geometry.groups || []).some(point => overlap(box, screen({ x: point.x - 4, y: point.y - 4, width: 8, height: 8 }), 1))
                            || [...nodeBoxes].some(([id, other]) => id !== scene.shell.id && id !== label.ownerId && overlap(box, other, 1))) continue;
                        selectedAttempt = { size, x: box.x, y: box.y + metrics.ascent, anchor: 'start', box,
                            shown: label.fullText, reason: null, callout: true };
                        break;
                    }
                    if (selectedAttempt) break;
                }
            }
            if (!selectedAttempt && primary && node && selected.has(label.ownerId)) {
                const size = 12, metrics = measure(label.fullText, size, label.role), height = metrics.ascent + metrics.descent;
                const middleX = node.x + (node.width - metrics.width) / 2, middleY = node.y + (node.height - height) / 2;
                const positions = [{ x: middleX, y: node.y - height - 6 }, { x: middleX, y: node.y + node.height + 6 },
                    { x: node.x - metrics.width - 6, y: middleY }, { x: node.x + node.width + 6, y: middleY }];
                for (const position of positions) {
                    const box = { ...position, width: metrics.width, height };
                    if (!inside(box, frame)
                        || occupied.some(other => overlap(box, other)) || ports.some(port => overlap(box, port, 1))
                        || (geometry.groups || []).some(point => overlap(box, screen({ x: point.x - 4, y: point.y - 4, width: 8, height: 8 }), 1))
                        || [...nodeBoxes].some(([id, other]) => id !== scene.shell.id && id !== label.ownerId && overlap(box, other, 1))) continue;
                    selectedAttempt = { size, x: box.x, y: box.y + metrics.ascent, anchor: 'start', box,
                        shown: label.fullText, reason: null, callout: true, overlay: true, pointerPolicy: 'none' };
                    break;
                }
            }
            const { size, x, y, anchor, box, shown, reason, callout, lines, lineHeight, compacted } = selectedAttempt || abbreviated || attempt;
            const visible = !reason;
            if (visible) {
                occupied.push(box);
                if (primary) visibleTitles.set(label.ownerId, box);
            }
            labels.push({ id: label.id, ownerId: label.ownerId, role: label.role, fullText: label.fullText,
                text: shown || label.fullText, visible, reason: reason || (selectedAttempt?.overlay ? 'selected-title-overlay'
                    : callout ? selected.has(label.ownerId) ? 'selected-title-callout' : 'overview-title-callout'
                    : compacted ? 'family-summary' : shown !== label.fullText ? 'measured-abbreviation'
                    : size < targetSize ? 'overview-title-fit' : null),
                priority: label.priority, x: (x - vx) / scale, y: (y - vy) / scale, anchor,
                lines, lineHeight: lineHeight ? lineHeight / scale : null,
                fontSize: Math.ceil(size / scale * 1000) / 1000, screenFontSize: Math.ceil(size / scale * 1000) / 1000 * scale,
                bounds: box, pointerPolicy: selectedAttempt?.pointerPolicy || (secondary ? 'none' : 'canonical-owner') });
        }
        return { level, labels, candidateCount: labels.length, visibleCount: labels.filter(label => label.visible).length,
            hiddenCount: labels.filter(label => !label.visible).length };
    }
    function fitSelection({ scene, geometry, current, canvas, projection }) {
        const ids = new Set([current.selectedEntityId, current.selectedRelationId].filter(Boolean));
        const focused = projection?.references.find(ref => ref.entityId === current.disclosureState.analysis?.resultSelection);
        for (const id of focused?.displayIds || []) ids.add(id);
        if (!ids.size && current.analysis) for (const item of [...(projection?.nodes || []), ...(projection?.contacts || []), ...(projection?.routes || [])]) {
            if (item.seed) ids.add(item.id);
        }
        const boxes = [];
        for (const node of geometry.nodes) if (ids.has(node.id)) boxes.push(node);
        for (const contact of geometry.contacts) if (ids.has(contact.id)) boxes.push({ x: contact.x - 72, y: contact.y - 48, width: 144, height: 96 });
        const routes = geometry.routes.filter(route => ids.has(route.id) || scene.connections.find(connection => connection.id === route.id)
            ?.endpointIds.some(id => ids.has(id) || geometry.contacts.some(c => c.id === id && ids.has(c.ownerId))));
        for (const route of routes) {
            ids.add(route.id);
            for (const [x1, y1, x2, y2] of route.segments) boxes.push({ x: Math.min(x1, x2), y: Math.min(y1, y2),
                width: Math.max(1, Math.abs(x2 - x1)), height: Math.max(1, Math.abs(y2 - y1)) });
        }
        if (!boxes.length) return null;
        const bounds = union(boxes), scale = Math.max(0.8, Math.min(1.6, (canvas.width - 48) / bounds.width, (canvas.height - 60) / bounds.height));
        const seedId = focused?.displayIds[0] || current.selectedEntityId;
        const seed = geometry.nodes.find(n => n.id === seedId) || geometry.contacts.find(n => n.id === seedId);
        const clippedSeed = seed && ((seed.width || 0) * scale > canvas.width - 48 || (seed.height || 0) * scale > canvas.height - 60);
        const attachment = clippedSeed ? routes.flatMap(route => route.attachments || [])
            .find(point => point.ownerId === seedId) : null;
        const center = attachment ? { x: attachment.x, y: attachment.y }
            : scale * bounds.width > canvas.width - 48 || scale * bounds.height > canvas.height - 60
            ? seed ? { x: seed.x + (seed.width || 0) / 2, y: seed.y + (seed.height || 0) / 2 }
                : { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }
            : { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
        return { viewport: { x: canvas.width / 2 - center.x * scale, y: canvas.height / 2 - center.y * scale, scale }, ids: [...ids], bounds };
    }
    return { projectLabels, detailLevel, fitSelection };
}));
