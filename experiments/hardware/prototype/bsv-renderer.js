'use strict';
(function (root) {
    function create(host) {
        const { el, se } = host;
        let layer = null;
        const nodePool = new Map(), portPool = new Map();
        const view = () => host.architecture(), state = () => host.state();
        const entity = id => BsvLayout.entity(view(), id);
        function attrs(item, values) { for (const [key, value] of Object.entries(values)) item.setAttribute(key, value); }
        function evidenceAttrs(item) {
            return { 'data-entity': item.id, 'data-definition': item.definitionId,
                'data-owner': item.ownerOccurrenceId, 'data-snapshot': view().snapshotId,
                'data-source-refs': JSON.stringify(item.sourceEvidence),
                'data-compiler-status': item.compilerConfirmation.status,
                'data-rtl-status': item.rtlCorrespondence.status };
        }
        const title = item => `${item.name || item.kind}\nDefinition ${item.definitionId}\nOccurrence ${item.ownerOccurrenceId}\n${item.sourceEvidence.map(ref => `${ref.pathRef}:${ref.sourceRange.line + 1} sha256 ${ref.revision}`).join('\n')}\nCompiler: ${item.compilerConfirmation.status}; RTL: ${item.rtlCorrespondence.status}`;
        function bind(group, id, primary) {
            group.addEventListener('click', event => host.activate(event, id, primary));
            group.addEventListener('keydown', event => host.activate(event, id, primary));
        }
        function makeNode(id) {
            const group = se('g', { id: BsvLayout.domId(id), class: 'bsv-node', tabindex: 0, role: 'button' });
            const body = se('rect', { class: 'node-body' }, group);
            const name = se('text', { class: 'node-title' }, group), type = se('text', { class: 'node-type' }, group);
            const storage = se('path', { class: 'storage-mark' }, group);
            const tooltip = se('title', {}, group);
            const routes = se('g', { class: 'bsv-routes' }, group), children = se('g', { class: 'bsv-children' }, group);
            const ports = se('g', { class: 'bsv-contacts' }, group);
            const info = se('g', { class: 'info', tabindex: 0, role: 'button', 'aria-label': 'Inspect BSV object without entering' }, group);
            const infoRect = se('rect', { width: 38, height: 26, rx: 4 }, info), infoText = se('text', {}, info, 'Info');
            bind(group, id, true); bind(info, id, false);
            const result = { group, body, name, type, storage, tooltip, routes, children, ports, infoRect, infoText };
            nodePool.set(id, result); return result;
        }
        function renderCanvas(scene) {
            if (!layer) layer = se('g', { class: 'bsv-scene' }, host.world);
            layer.removeAttribute('display');
            for (const entry of nodePool.values()) { entry.group.setAttribute('display', 'none'); entry.routes.replaceChildren(); }
            for (const entry of portPool.values()) entry.group.setAttribute('display', 'none');
            for (const node of scene.nodes) {
                const item = entity(node.id), entry = nodePool.get(node.id) || makeNode(node.id);
                entry.group.removeAttribute('display');
                attrs(entry.group, { ...evidenceAttrs(item), class: `bsv-node ${node.kind}${node.expanded ? ' expanded' : ''}${state().selectedId === node.id ? ' selected' : ''}`,
                    'aria-label': `${item.name}, ${node.type}. ${node.kind === 'storage' ? 'Inspect source storage' : 'Enter opens BSV interior; Space inspects'}`,
                    'aria-expanded': String(node.expanded), 'data-kind': node.kind });
                attrs(entry.body, { x: node.x, y: node.y, width: node.width, height: node.height });
                attrs(entry.name, { x: node.x + 16, y: node.y + 24 }); entry.name.textContent = item.name;
                attrs(entry.type, { x: node.x + 16, y: node.y + 44 });
                entry.type.textContent = node.kind === 'storage' ? node.type : item.definitionId.split(':').at(-1);
                attrs(entry.storage, { d: node.kind === 'storage' ? `M${node.x + 12},${node.y + 58}H${node.x + node.width - 12}M${node.x + 12},${node.y + 64}H${node.x + node.width - 12}` : '' });
                entry.tooltip.textContent = title(item);
                attrs(entry.infoRect, { x: node.x + node.width - 50, y: node.y + 10 });
                attrs(entry.infoText, { x: node.x + node.width - 44, y: node.y + 28 });
                (node.parentId ? nodePool.get(node.parentId).children : layer).append(entry.group);
            }
            for (const route of scene.routes) {
                const item = entity(route.id);
                const group = se('g', { ...evidenceAttrs(item), id: route.domId, class: `bsv-relation${state().selectedId === route.id ? ' selected' : ''}`,
                    'data-kind': route.kind, 'data-from': item.fromId, 'data-to': item.toId, tabindex: 0, role: 'button', 'aria-label': `Inspect ${route.label}` }, nodePool.get(item.ownerOccurrenceId).routes);
                se('path', { class: 'semantic-line', d: route.path }, group);
                se('path', { class: 'route-hit', d: route.path }, group);
                const dx = route.toApproach;
                se('path', { class: 'semantic-arrow', d: `M${route.to.x + dx * 8},${route.to.y - 4}L${route.to.x},${route.to.y}L${route.to.x + dx * 8},${route.to.y + 4}` }, group);
                const width = host.measureText(route.label) + 16;
                se('rect', { class: 'semantic-label-bg', x: route.labelX - 4, y: route.labelY - 14, width, height: 24 }, group);
                se('text', { class: 'semantic-label', x: route.labelX + 4, y: route.labelY + 2 }, group, route.label);
                se('title', {}, group, `${title(item)}\n${item.sourceEvidence.map(ref => ref.text).join('\n')}`);
                bind(group, route.id, false);
            }
            for (const anchor of scene.anchors) {
                const item = entity(anchor.id);
                let entry = portPool.get(anchor.id);
                if (!entry) {
                    const group = se('g', { id: anchor.domId, class: 'bsv-port', tabindex: 0, role: 'button' });
                    const background = se('rect', { class: 'semantic-label-bg' }, group);
                    const hit = se('rect', { class: 'pin-hit' }, group), mark = se('path', { class: 'method-contact' }, group);
                    const label = se('text', { class: 'pin-label' }, group), tooltip = se('title', {}, group);
                    bind(group, anchor.id, false); entry = { group, background, hit, mark, label, tooltip }; portPool.set(anchor.id, entry);
                }
                entry.group.removeAttribute('display');
                attrs(entry.group, { ...evidenceAttrs(item), class: `bsv-port${state().selectedId === anchor.id ? ' selected' : ''}`,
                    'aria-label': `Inspect ${anchor.label}`, 'data-kind': item.kind, 'data-method-kind': item.methodKind || 'interface' });
                const right = anchor.side === 'right';
                attrs(entry.background, { x: right ? anchor.x - anchor.labelWidth - 20 : anchor.x + 12, y: anchor.y - 12, width: anchor.labelWidth + 8, height: 24 });
                attrs(entry.hit, { x: right ? anchor.x - anchor.labelWidth - 20 : anchor.x - 12, y: anchor.y - 14, width: anchor.labelWidth + 32, height: 28 });
                attrs(entry.mark, { d: `M${anchor.x - 5},${anchor.y - 8}H${anchor.x + 5}V${anchor.y + 8}H${anchor.x - 5}Z` });
                attrs(entry.label, { x: anchor.x + (right ? -16 : 16), y: anchor.y + 4, 'text-anchor': right ? 'end' : 'start' });
                entry.label.textContent = anchor.label; entry.tooltip.textContent = title(item);
                nodePool.get(anchor.ownerId).ports.append(entry.group);
            }
        }
        function section(panel, label, value, id) {
            el('h3', label, panel);
            el('pre', typeof value === 'string' ? value : JSON.stringify(value, null, 2), panel, id ? { id } : {});
        }
        function renderSignals(panel, item) {
            const hardware = host.model();
            const endpoints = records => [...new Set(records.map(e => e.entityId))].map(id => {
                const pin = hardware.entities[id], occurrence = hardware.occurrences[pin.occurrenceId];
                return { id, occurrence: occurrence.path, cell: pin.cellId ? hardware.cells[pin.cellId].name : null,
                    port: pin.name, providerRefs: pin.providerRefs };
            });
            const chains = item.rtlSignals.map(signal => ({ role: signal.role, port: signal.port, status: signal.status,
                formalOrderedBits: signal.implementationPortId ? hardware.entities[signal.implementationPortId].rawBits : [],
                actualOrderedBits: signal.boundaryCrossings.map(b => hardware.bits[b.actualBitId].value),
                localEndpoints: endpoints(signal.connectivity.flatMap(c => c.endpoints)),
                parentEndpoints: endpoints(signal.boundaryCrossings.flatMap(b => b.actualEndpoints)),
                compilerEvidence: signal.evidence, exactInvocationToWire: false, exactLeafCellCause: false }));
            const disclosure = el('section', null, panel, { id: 'rtl-signal-detail' });
            el('h3', 'Verified method / port / net / pin connectivity', disclosure);
            const roleOrder = ['result', 'argument', 'enable', 'ready'];
            for (const chain of [...chains].sort((a, b) => roleOrder.indexOf(a.role) - roleOrder.indexOf(b.role))) {
                el('h3', `${chain.role}: ${chain.port} (${chain.status})`, disclosure);
                el('p', `Formal ordered entries: ${chain.formalOrderedBits.map(bit => typeof bit === 'string' ? `constant ${bit}` : bit).join(', ')}${chain.actualOrderedBits.length ? `; parent actual bits: ${chain.actualOrderedBits.join(', ')}` : ''}`, disclosure);
                const label = e => `${e.occurrence.join('/')} / ${e.cell ? `${e.cell}.` : ''}${e.port}`;
                el('pre', `Inside: ${chain.localEndpoints.map(label).join('\n')}\nParent: ${chain.parentEndpoints.map(label).join('\n') || 'no bound parent net'}`, disclosure);
            }
            el('p', 'Connectivity is verified, not exact invocation-to-wire or leaf-cell cause. No register or expression origin is assigned.', disclosure);
            const raw = el('details', null, disclosure); el('summary', 'Ordered connectivity and compiler artifact records', raw);
            section(raw, 'Method connectivity', chains, 'method-connectivity');
            section(raw, 'Compiler-supplied signal records', item.rtlSignals, 'rtl-signal-json');
        }
        function renderDetails(panel, id) {
            const item = entity(id), owner = view().occurrences[item.ownerOccurrenceId];
            const heading = el('div', null, panel, { class: 'drawer-head' });
            el('h2', item.name || item.kind, heading); el('button', 'Close details', heading).addEventListener('click', host.clear);
            el('p', `${item.kind} | ${item.declaredType === 'inferred' ? `source let; compiler type ${item.compilerType || 'unknown'}` : item.declaredType || item.methodKind || item.interfaceType || 'BSV semantic relation'}`, panel);
            el('p', owner.path, panel, { class: 'evidence' });
            if (owner.rtlContext.status !== 'verified') el('p', `${owner.rtlContext.status}: ${owner.rtlContext.reason}. No owned retained RTL boundary; containing context is not exact cell ownership.`, panel);
            el('button', 'Open RTL Implementation', panel, { id: 'open-rtl' }).addEventListener('click', () => host.openRTL(id));
            item.sourceEvidence.forEach((ref, index) => {
                const button = el('button', `Open original source ${ref.sourceRange.line + 1}-${ref.sourceRange.endLine + 1}`, panel, { 'data-bsv-source-index': index });
                button.addEventListener('click', () => host.openSource(id, index));
            });
            if (item.kind === 'method-boundary') {
                section(panel, 'Typed BSV method', BsvLayout.signature(item));
                el('p', `Interface: ${item.interfaceType}; path: ${item.interfacePath.join('.')}`, panel);
                const contract = el('details', null, panel); el('summary', 'Typed method fields', contract);
                section(contract, 'Method contract', { interfacePath: item.interfacePath, kind: item.methodKind,
                    arguments: item.arguments, result: item.result }, 'method-contract');
                el('button', state().rtlSignals ? 'Hide RTL signals' : 'Expand RTL signals', panel,
                    { id: 'rtl-signals', 'aria-expanded': String(state().rtlSignals), 'aria-controls': 'rtl-signal-detail' }).addEventListener('click', host.discloseSignals);
                if (state().rtlSignals) renderSignals(panel, item);
            }
            const relations = Object.values(view().relations).filter(r => r.id === id || r.fromId === id || r.toId === id ||
                (item.behaviorIds || []).includes(r.behaviorId) || (view().occurrences[id] && r.ownerOccurrenceId === id));
            const conditions = relation => `Explicit predicate: ${relation.explicitPredicate.text || relation.explicitPredicate.status}\nBody path: ${relation.bodyPathConditions.length ? relation.bodyPathConditions.map(p => `${p.polarity}: ${p.text}`).join('; ') : 'no source branch condition recorded'}`;
            if (view().relations[id]) {
                section(panel, 'Source statement / semantic relation', item.sourceEvidence.map(ref => ref.text).join('\n'));
                el('pre', conditions(item), panel);
                el('p', `Relation: ${item.kind}. Compiler: ${item.compilerConfirmation.status}. Net mapping: ${item.rtlCorrespondence.status}.`, panel);
                const technical = el('details', null, panel); el('summary', 'Exact relation IDs and evidence', technical);
                section(technical, 'Semantic relation - not a netlist wire', { kind: item.kind, fromId: item.fromId, toId: item.toId,
                    statementId: item.statementId, expressionId: item.expressionId, sourceStatement: item.sourceEvidence.map(ref => ref.text),
                    explicitPredicate: item.explicitPredicate, bodyPathConditions: item.bodyPathConditions,
                    compilerConfirmation: item.compilerConfirmation, netMapping: item.rtlCorrespondence }, 'relation-evidence');
            }
            const behaviorIds = [...new Set([...relations.map(r => r.behaviorId), ...(item.behaviorIds || [])].filter(Boolean))];
            if (behaviorIds.length) {
                const overlay = el('section', null, panel, { class: 'behavior-overlay', id: 'behavior-overlay', 'aria-label': 'Selected source behavior, not physical hardware' });
                el('h3', 'Using behavior / semantic operation', overlay);
                for (const behaviorId of behaviorIds) {
                    const behavior = view().behaviors[behaviorId];
                    el('h3', `${behavior.kind} ${behavior.name}`, overlay);
                    el('button', 'Inspect source implementation', overlay, { 'data-inspect-behavior': behaviorId }).addEventListener('click', () => host.inspect(behaviorId));
                    section(overlay, 'Source implementation', behavior.sourceEvidence.map(ref => ref.text).join('\n'));
                    for (const relation of relations.filter(r => r.behaviorId === behaviorId)) {
                        const button = el('button', relation.kind, overlay, { 'data-inspect-relation': relation.id });
                        button.addEventListener('click', () => host.inspect(relation.id));
                        el('pre', `${relation.sourceEvidence.map(ref => ref.text).join('\n')}\n${conditions(relation)}`, overlay);
                    }
                }
            }
            const provenance = el('details', null, panel); el('summary', 'Definition, occurrence, ranges, revision and compiler provenance', provenance);
            section(provenance, 'Source and compiler provenance', { definitionId: item.definitionId, occurrence: owner.path,
                declaredType: item.declaredType, compilerType: item.compilerType, parameterBindings: item.parameterBindings,
                occurrenceId: owner.id, sourceEvidence: item.sourceEvidence, compilerConfirmation: item.compilerConfirmation,
                rtlCorrespondence: { status: item.rtlCorrespondence.status, scope: item.rtlCorrespondence.scope,
                    reason: item.rtlCorrespondence.reason, verifiedEntityCount: item.rtlCorrespondence.entityIds.length },
                snapshotId: view().snapshotId }, 'bsv-provenance');
            el('p', 'Source-derived relation evidence is not an exact generated-cell cause. Unmapped implementation remains visible in explicit RTL detail.', panel);
        }
        return { entity, renderCanvas, renderDetails,
            hide() { if (layer) layer.setAttribute('display', 'none'); },
            reset() { layer = null; nodePool.clear(); portPool.clear(); } };
    }
    root.BsvRenderer = { create };
})(globalThis);
