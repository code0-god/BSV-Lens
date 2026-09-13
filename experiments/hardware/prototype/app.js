'use strict';
(() => {
    const $ = id => document.getElementById(id);
    const svg = $('canvas'), world = $('world');
    const NS = 'http://www.w3.org/2000/svg';
    const nodePool = new Map(), portPool = new Map(), evidenceCache = new Map();
    const textMetrics = document.createElement('canvas').getContext('2d');
    textMetrics.font = `12px ${getComputedStyle(document.documentElement).fontFamily}`;
    const measureText = text => textMetrics.measureText(text).width;
    function fitLabel(text, width) {
        if (measureText(text) <= width) return text;
        let short = text;
        while (short.length && measureText(`${short}...`) > width) short = short.slice(0, -1);
        return `${short}...`;
    }
    let model = null, architecture = null, nav = null, scene = null, buildKey = null, version = 0, loadVersion = 0;
    const initialMode = new URLSearchParams(location.search).get('mode') === 'rtl' ? 'rtl' : 'bsv';
    const bsv = BsvRenderer.create({ world, el, se, measureText,
        state: () => nav.state, architecture: () => architecture, model: () => model,
        activate: (event, id, primary) => activate(event, id, primary), inspect,
        openSource: async (id, index) => {
            const context = model.snapshot.id;
            try {
                const source = await request(apiUrl('bsv-source', id, index));
                if (model.snapshot.id !== context || nav.state.selectedId !== id) return;
                nav.source({ ...source, entityId: id }); renderSource(); notify('source');
            } catch (failure) { error = failure.message; $('status').textContent = error; notify('error'); }
        },
        openRTL: async id => {
            const context = model.snapshot.id;
            try {
                const rtl = await request(apiUrl('bsv-context', id));
                if (model.snapshot.id !== context) return;
                const owner = rtl.implementationOccurrenceId || rtl.contextOccurrenceId;
                if (!owner) throw new Error('No verified implementation owner or containing context is available for this BSV occurrence.');
                if (nav.openRTL(rtl.ownerOccurrenceId, owner, rtl.highlightEntityIds)) { render(); notify('rtl'); }
            } catch (failure) { error = failure.message; $('status').textContent = error; notify('error'); }
        },
        discloseSignals: () => { nav.state.rtlSignals = !nav.state.rtlSignals; renderDetails(); notify('rtl-signals'); },
        clear: () => { nav.inspect(null); render(); notify('clear'); }
    });
    let evidence = [], evidenceEntity = null, error = null, drag = null, suppressClick = false;
    const timings = [];
    const notify = action => {
        version++;
        window.dispatchEvent(new CustomEvent('hardware:commit', { detail: { action, version } }));
    };
    Object.defineProperty(window, 'hardwareDebug', { get: () => JSON.stringify({ version, buildKey,
        state: nav?.snapshot() || null, history: nav?.history || null, scene, error, timings,
        architectureSnapshot: architecture?.snapshotId || null,
        counts: model ? { canonicalBits: Object.keys(model.bits).length, cells: Object.keys(model.cells).length } : null }), configurable: false });
    function el(tag, text, parent, attrs = {}) {
        const item = document.createElement(tag);
        if (text !== null) item.textContent = text;
        for (const [name, value] of Object.entries(attrs)) item.setAttribute(name, value);
        if (parent) parent.append(item);
        return item;
    }
    function se(tag, attrs = {}, parent, text) {
        const item = document.createElementNS(NS, tag);
        for (const [name, value] of Object.entries(attrs)) item.setAttribute(name, value);
        if (text !== undefined) item.textContent = text;
        if (parent) parent.append(item);
        return item;
    }
    function attr(item, attrs) { for (const [name, value] of Object.entries(attrs)) item.setAttribute(name, value); }
    async function request(url) {
        const response = await fetch(url);
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || `Read failed: ${response.status}`);
        return result;
    }
    const apiUrl = (route, entity, index) => `/api/${route}?${new URLSearchParams({ build: buildKey,
        ...(entity ? { entity } : {}), ...(index !== undefined ? { index } : {}) })}`;
    function provenance(entity) {
        return entity.providerRefs.map(ref => `${ref.pathRef}#${ref.pointer}\nsha256 ${ref.artifactHash}`).join('\n');
    }
    function fit() {
        if (!scene) return;
        const box = svg.getBoundingClientRect(), b = scene.bounds;
        const scale = Math.min((box.width - 32) / b.width, (box.height - 58) / b.height);
        const width = box.width / scale, height = box.height / scale;
        nav.viewport({ x: b.x - (width - b.width) / 2, y: b.y - (height - b.height) / 2, width, height });
        applyViewport();
    }
    function applyViewport() {
        const view = nav?.state.viewport;
        if (!view) return;
        svg.setAttribute('viewBox', `${view.x} ${view.y} ${view.width} ${view.height}`);
        const scale = svg.clientWidth / view.width;
        $('canvas-note').textContent = scale < .75
            ? `Overview scale - use Detail zoom or wheel for readable ${nav.state.sceneKind === 'bsv' ? 'BSV contacts' : 'pins'}. All visible objects fit.`
            : 'Single click enters. Info / Space inspects. Wheel only zooms. Drag pans.';
    }
    function navigate(action, id) {
        if (!nav) return;
        const start = performance.now();
        const changed = action === 'enter' ? nav.enter(id) : action === 'go' ? nav.go(id) : nav[action]();
        if (!changed) return;
        evidenceEntity = nav.state.selectedId;
        evidence = evidenceCache.get(evidenceEntity) || [];
        render();
        timings.push({ action, ms: performance.now() - start });
        notify(action);
    }
    function activate(event, id, primary) {
        event.stopPropagation();
        if (event.type === 'click' && (suppressClick || event.detail > 1)) { suppressClick = false; return; }
        if (event.type === 'keydown') {
            if (!['Enter', ' '].includes(event.key)) return;
            event.preventDefault();
            if (event.repeat) return;
            if (event.key === ' ') primary = false;
        }
        const item = nav.state.sceneKind === 'bsv' ? bsv.entity(id) : model.entities[id];
        if (primary && nav.state.sceneKind === 'bsv' && architecture.occurrences[id] && id !== nav.state.rootId) navigate('enter', id);
        else if (primary && item.kind === 'occurrence' && item.id !== nav.state.rootId && !item.blackbox && item.cells.length) navigate('enter', id);
        else inspect(id);
    }
    function makeNode(id) {
        const group = se('g', { id: HardwareLayout.domId(id), class: 'node', tabindex: '0', role: 'button', 'data-entity': id });
        const body = se('rect', { class: 'node-body' }, group);
        const title = se('text', { class: 'node-title' }, group);
        const type = se('text', { class: 'node-type' }, group);
        const tooltip = se('title', {}, group);
        const routes = se('g', { class: 'internal-routes' }, group);
        const children = se('g', { class: 'internal-nodes' }, group);
        const ports = se('g', { class: 'external-ports' }, group);
        const info = se('g', { class: 'info', tabindex: '0', role: 'button', 'aria-label': 'Inspect block without entering' }, group);
        const infoRect = se('rect', { width: 38, height: 26, rx: 4 }, info);
        const infoText = se('text', {}, info, 'Info');
        group.addEventListener('click', event => activate(event, id, true));
        group.addEventListener('keydown', event => activate(event, id, true));
        info.addEventListener('click', event => activate(event, id, false));
        info.addEventListener('keydown', event => activate(event, id, false));
        const entry = { group, body, title, type, tooltip, routes, children, ports, info, infoRect, infoText };
        nodePool.set(id, entry);
        return entry;
    }
    function renderCanvas() {
        bsv.hide();
        for (const entry of nodePool.values()) entry.group.setAttribute('display', 'none');
        for (const entry of portPool.values()) entry.group.setAttribute('display', 'none');
        world.querySelectorAll('.scene-routes, .continuations').forEach(item => item.remove());
        for (const entry of nodePool.values()) entry.routes.replaceChildren();
        if (nav.state.sceneKind === 'bsv') { bsv.renderCanvas(scene); return; }
        const current = scene.nodes.find(n => n.expanded);
        for (const node of scene.nodes) {
            const entry = nodePool.get(node.id) || makeNode(node.id);
            entry.group.removeAttribute('display');
            entry.group.setAttribute('class', `node${node.expanded ? ' expanded' : ''}${nav.state.selectedId === node.id ? ' selected' : ''}${nav.state.trace?.verifiedEntityIds.includes(node.id) ? ' verified-mapping' : ''}`);
            attr(entry.group, { 'aria-label': `${node.name}, ${node.type}. ${node.expandable ? 'Enter expands, Space inspects' : 'Inspect; no further entry'}`,
                'aria-expanded': String(node.expanded), 'data-expanded': String(node.expanded), 'data-expandable': String(node.expandable),
                'data-snapshot': model.snapshot.id, 'data-pointer': model.entities[node.id].providerRefs[0].pointer });
            attr(entry.body, { x: node.x, y: node.y, width: node.width, height: node.height });
            attr(entry.title, { x: node.x + 14, y: node.y + 24 });
            entry.title.textContent = fitLabel(node.displayName, (node.width - 78) * .8);
            attr(entry.type, { x: node.x + 14, y: node.y + 44 });
            entry.type.textContent = fitLabel(`${node.blackbox ? 'Black box / ' : ''}${node.kind === 'cell' ? node.name : node.type}`, node.width - 28);
            entry.tooltip.textContent = `${node.name}\n${node.type}\n${provenance(model.entities[node.id])}`;
            attr(entry.infoRect, { x: node.x + node.width - 50, y: node.y + 10 });
            attr(entry.infoText, { x: node.x + node.width - 44, y: node.y + 28 });
            const parent = current && current.id !== node.id ? nodePool.get(current.id).children : world;
            parent.append(entry.group);
        }
        const routeLayer = se('g', { class: 'scene-routes' });
        if (current) nodePool.get(current.id).routes.append(routeLayer); else world.prepend(routeLayer);
        for (const route of scene.routes) {
            const selected = route.bits.includes(nav.state.selectedBit) || route.id === nav.state.selectedId;
            const g = se('g', { id: route.domId, class: `route${selected ? ' selected' : ''}`, tabindex: 0,
                role: 'button', 'aria-label': `Inspect bus ${route.name}, ${route.bits.length} ordered bits`,
                'data-entity': route.id, 'data-bits': JSON.stringify(route.bits), 'data-snapshot': model.snapshot.id,
                'data-pointer': model.entities[route.id].providerRefs[0].pointer }, routeLayer);
            se('path', { class: 'route-line', d: route.path }, g);
            se('path', { class: 'route-hit', d: route.path }, g);
            route.junctions.forEach(p => se('circle', { class: 'junction', cx: p.x, cy: p.y, r: 3, 'data-net': route.id }, g));
            if (route.constantMarker) {
                const marker = route.constantMarker, labelWidth = measureText(marker.label) + 8;
                const constant = se('g', { class: 'constant-site', 'data-bits': JSON.stringify(marker.bitIds),
                    'data-values': JSON.stringify(marker.values), 'data-presentation-only': 'true' }, g);
                se('rect', { class: 'constant-label-bg', x: marker.x - labelWidth / 2, y: marker.y - 23, width: labelWidth, height: 17 }, constant);
                se('text', { class: 'constant-label', x: marker.x, y: marker.y - 10, 'text-anchor': 'middle' }, constant, marker.label);
                se('rect', { class: 'constant-mark', x: marker.x - 3, y: marker.y - 3, width: 6, height: 6 }, constant);
                se('title', {}, constant, `Connection-local constant values in provider order: ${marker.values.join(', ')}. Not a physical or global driver.`);
            }
            se('title', {}, g, `${route.name}\nOrdered bits ${route.rawBits.join(', ')}\n${provenance(model.entities[route.id])}`);
            g.addEventListener('click', event => {
                event.stopPropagation();
                if (suppressClick || event.detail > 1) { suppressClick = false; return; }
                const matrix = svg.getScreenCTM();
                const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
                const tolerance = 5 / matrix.a;
                const choices = scene.routes.filter(candidate => candidate.segments.some(([x1, y1, x2, y2]) => {
                    const x = Math.max(Math.min(x1, x2), Math.min(Math.max(x1, x2), point.x));
                    const y = Math.max(Math.min(y1, y2), Math.min(Math.max(y1, y2), point.y));
                    return Math.hypot(point.x - x, point.y - y) <= tolerance;
                }));
                if (choices.length <= 1) { inspect(route.id); return; }
                const panel = $('details'); panel.hidden = false; panel.replaceChildren();
                el('h2', 'Choose signal at this crossing', panel);
                el('p', 'Overlapping hit areas are not electrical connections.', panel);
                for (const choice of choices) {
                    const button = el('button', `${choice.name} [${choice.bits.length}]`, panel, { 'data-route-choice': choice.id });
                    button.addEventListener('click', () => inspect(choice.id));
                }
                notify('wire-choice');
            });
            g.addEventListener('keydown', event => activate(event, route.id, false));
        }
        for (const anchor of scene.anchors) {
            let entry = portPool.get(anchor.id);
            if (!entry) {
                const group = se('g', { id: anchor.domId, class: 'port', tabindex: 0, role: 'button', 'data-entity': anchor.id });
                const hit = se('rect', { class: 'pin-hit', width: 26, height: 26 }, group);
                const mark = se('rect', { class: 'pin-mark', width: 8, height: 8 }, group);
                const label = se('text', { class: 'pin-label' }, group);
                const tooltip = se('title', {}, group);
                group.addEventListener('click', event => activate(event, anchor.id, false));
                group.addEventListener('keydown', event => activate(event, anchor.id, false));
                entry = { group, hit, mark, label, tooltip }; portPool.set(anchor.id, entry);
            }
            const right = anchor.side === 'right';
            entry.group.removeAttribute('display');
            attr(entry.group, { class: `port${nav.state.selectedId === anchor.id ? ' selected' : ''}${nav.state.trace?.verifiedEntityIds.includes(anchor.id) ? ' verified-mapping' : ''}`,
                'aria-label': `Inspect ${anchor.direction || 'unknown direction'} port ${anchor.name}, ${anchor.bits.length} ordered bits`,
                'data-bits': JSON.stringify(anchor.bits), 'data-raw-bits': JSON.stringify(anchor.rawBits),
                'data-bindings': JSON.stringify((model.occurrences[anchor.ownerId]?.boundaries || []).map(id => model.boundaries[id]).filter(b => b.portId === anchor.id)),
                'data-snapshot': model.snapshot.id, 'data-pointer': model.entities[anchor.id].providerRefs[0].pointer });
            const labelRight = anchor.boundary ? !right : right;
            // The visible label and anchor share one hit owner, painted after internal routes.
            attr(entry.hit, { x: anchor.x - (labelRight ? anchor.labelWidth + 16 : 13),
                y: anchor.y - (anchor.boundary ? 23 : 13), width: anchor.labelWidth + 29,
                height: anchor.boundary ? 36 : 26 });
            attr(entry.mark, { x: anchor.x - 4, y: anchor.y - 4 });
            attr(entry.label, { x: anchor.x + (labelRight ? -12 : 12), y: anchor.y + (anchor.boundary ? -7 : 4),
                'text-anchor': labelRight ? 'end' : 'start', 'data-boundary': String(anchor.boundary) });
            entry.label.textContent = anchor.label;
            entry.tooltip.textContent = `${anchor.name}\nOrdered bits ${anchor.rawBits.join(', ')}\n${provenance(model.entities[anchor.id])}`;
            nodePool.get(anchor.ownerId).ports.append(entry.group);
        }
        const continuations = se('g', { class: 'continuations' }, world);
        for (const c of scene.continuations) {
            const group = se('g', { 'data-port': c.portId, 'data-bindings': JSON.stringify(c.bindings),
                'data-presentation-only': 'true' }, continuations);
            se('path', { class: 'continuation', d: `M${c.x},${c.y}H${c.endX}` }, group);
            se('title', {}, group, JSON.stringify(c.bindings.map(b => ({ formal: b.formalBitId, actual: b.actualBitId, index: b.index }))));
        }
    }
    function render() {
        scene = nav.state.sceneKind === 'bsv' ? BsvLayout.layout(architecture, nav.state, measureText) : HardwareLayout.layout(model, nav.state, measureText);
        document.documentElement.dataset.sceneKind = nav.state.sceneKind;
        $('return-bsv').hidden = nav.state.sceneKind !== 'rtl' || !nav.state.bsvContext;
        renderCanvas();
        $('empty').hidden = true;
        $('back').disabled = !nav.history.back.length;
        $('forward').disabled = !nav.history.forward.length;
        $('up').disabled = nav.state.rootId === null;
        $('fit').disabled = $('detail-zoom').disabled = false;
        $('breadcrumbs').replaceChildren();
        const overall = el('button', 'Overall', $('breadcrumbs'));
        overall.addEventListener('click', () => navigate('go', null));
        for (const id of nav.state.expanded) {
            el('span', '/', $('breadcrumbs'));
            const button = el('button', (nav.state.sceneKind === 'bsv' ? architecture : model).occurrences[id].name, $('breadcrumbs'));
            button.addEventListener('click', () => navigate('go', id));
        }
        $('build-status').textContent = `${nav.state.sceneKind === 'bsv' ? 'BSV Architecture' : 'RTL Implementation'} | Top ${model.snapshot.tops.join(', ')} | ${model.snapshot.stage} | ${model.snapshot.id.slice(0, 19)}...`;
        $('owner-context').hidden = !nav.state.bsvContext;
        const bsvOwner = nav.state.bsvContext ? architecture.occurrences[nav.state.ownerId] : null;
        const bsvSelected = nav.state.bsvContext?.selectedId ? bsv.entity(nav.state.bsvContext.selectedId) : null;
        $('owner-context').textContent = bsvOwner ? `BSV owner: ${bsvOwner.path} | Selected source: ${bsvSelected?.name || bsvSelected?.kind || 'none'} | ${bsvOwner.rtlContext.status}: ${bsvOwner.rtlContext.reason}. Only verified port correspondence is highlighted; other cells have unresolved source cause.` : '';
        $('owner-context').title = nav.state.bsvContext ? JSON.stringify({ ownerId: nav.state.ownerId, selectedId: nav.state.bsvContext.selectedId, rtlContext: bsvOwner.rtlContext }, null, 2) : '';
        $('legend').textContent = nav.state.sceneKind === 'bsv' ? 'Dashed arrows = BSV semantic relations, not netlist wires. State is declared storage; behavior appears on selection.' : 'Dot = branch; no dot = crossing; dashed stub = parent net; square value = local constant';
        $('build-status').title = JSON.stringify(model.snapshot, null, 2);
        $('hierarchy').replaceChildren();
        el('h3', nav.state.sceneKind === 'bsv' ? 'BSV containment' : 'Implementation hierarchy', $('hierarchy'));
        for (const occurrence of Object.values(nav.state.sceneKind === 'bsv' ? architecture.occurrences : model.occurrences)) {
            const occurrencePath = nav.state.sceneKind === 'bsv' ? occurrence.path.split('.') : occurrence.path;
            const button = el('button', `${'  '.repeat(occurrencePath.length - 1)}${occurrencePath.join(' / ')}`, $('hierarchy'));
            button.addEventListener('click', () => nav.state.sceneKind === 'bsv' || (occurrence.cells.length && !occurrence.blackbox) ? navigate('enter', occurrence.id) : inspect(occurrence.id));
        }
        $('hierarchy').hidden = !nav.state.panels.hierarchy;
        $('hierarchy-toggle').setAttribute('aria-expanded', String(nav.state.panels.hierarchy));
        renderDetails(); renderSource();
        if (!nav.state.viewport) fit(); else applyViewport();
        $('status').textContent = nav.state.sceneKind === 'bsv'
            ? `${scene.nodes.length} BSV occurrences/storage; ${scene.anchors.length} typed contacts; ${scene.routes.length} semantic relations. Source-derived facts and compiler confirmation remain separate.`
            : `${scene.nodes.filter(n => !n.expanded).length} visible blocks/cells; ${scene.routes.length} bus groups; canonical ${Object.keys(model.bits).length} bits retained`;
    }
    async function inspect(id, bit = null) {
        const started = performance.now();
        nav.inspect(id, bit);
        evidence = []; evidenceEntity = id;
        if (innerWidth <= 600) { $('hierarchy').hidden = true; nav.state.panels.hierarchy = false; }
        render();
        if (architecture && bsv.entity(id)) { notify('inspect'); return; }
        const context = model.snapshot.id, selected = id;
        try {
            const result = await request(apiUrl('evidence', id));
            if (model.snapshot.id !== context || nav.state.selectedId !== selected) return;
            evidence = result; evidenceCache.set(id, result); renderDetails();
            timings.push({ action: 'inspect', ms: performance.now() - started });
            notify('inspect');
        } catch (failure) { error = failure.message; $('status').textContent = error; notify('error'); }
    }
    function renderDetails() {
        const panel = $('details'), id = nav.state.selectedId;
        panel.hidden = !id; panel.replaceChildren();
        if (!id) return;
        if (architecture && bsv.entity(id)) { bsv.renderDetails(panel, id); return; }
        const item = model.entities[id];
        const route = scene.routes.find(r => r.id === id);
        const heading = el('div', null, panel, { class: 'drawer-head' });
        el('h2', route ? `${route.name} [${route.bits.length}]` : item.name || `Bit ${item.value}`, heading);
        const close = el('button', 'Close details', heading);
        close.addEventListener('click', () => { nav.inspect(null); render(); notify('clear'); });
        el('p', route ? 'Signal bus / ordered connectivity' : `${item.kind} / ${item.type || item.direction || (item.blackbox ? 'black box' : 'implementation object')}`, panel);
        if (item.kind === 'occurrence') {
            el('p', `${item.path.join(' / ')} -> ${model.definitions[item.definitionId].name}`, panel, { class: 'evidence' });
            el('p', item.blackbox ? 'Black box: internal implementation unavailable. Known ports are preserved.' : `${item.cells.length} immediate cells; ${item.ports.length} ports. Real implementation boundary.`, panel);
        }
        if (item.kind === 'cell') {
            el('p', `Raw cell type ${item.type}; semantics are not inferred from its name.`, panel);
            el('pre', JSON.stringify({ parameters: item.parameters, pins: item.pins.map(pin => ({ name: model.pins[pin].name,
                direction: model.pins[pin].direction, orderedBits: model.pins[pin].rawBits })) }, null, 2), panel);
        }
        const bits = route?.bits || item.bits || (item.kind === 'signal-bit' || item.kind === 'constant' ? [item.id] : []);
        if (bits.length) {
            el('h3', route?.ordering === 'unique-provider-bits' ? 'Unique signal bits (presentation order)' : 'Ordered bits (provider vector order)', panel);
            el('p', bits.map(bit => model.bits[bit].value).join(', '), panel, { class: 'evidence', id: 'ordered-bits' });
            const list = el('div', null, panel, { class: 'bits' });
            bits.forEach((bit, index) => {
                const button = el('button', `[${index}] ${model.bits[bit].value}`, list,
                    { 'aria-pressed': String(nav.state.selectedBit === bit), 'data-bit': bit });
                button.addEventListener('click', () => { nav.state.selectedBit = bit; render(); notify('bit'); });
            });
            const selected = nav.state.selectedBit || bits[0];
            const b = model.bits[selected];
            el('h3', `Bit ${b.value}: drivers / loads`, panel);
            el('p', `Kind: ${b.kind}. Roles from actual port directions; unknown stays unknown.`, panel);
            for (const endpoint of b.endpoints) {
                const entity = model.entities[endpoint.entityId];
                const owner = model.occurrences[entity.occurrenceId];
                el('p', `${endpoint.role}: ${owner.path.join('/')} / ${entity.cellId ? `${model.cells[entity.cellId].name}.` : ''}${entity.name}[${endpoint.index}]`, panel, { class: 'evidence' });
            }
            el('h3', 'Aliases', panel);
            el('p', b.aliases.map(a => `${model.aliases[a.aliasId].name}[${a.index}]`).join(', ') || 'No alias supplied for this bit', panel, { class: 'evidence' });
            const crossings = Object.values(model.boundaries).filter(binding => binding.actualBitId === selected || binding.formalBitId === selected);
            el('h3', 'Formal / actual hierarchy crossings', panel);
            for (const crossing of crossings) el('p', `${model.occurrences[crossing.childOccurrenceId].path.join('/')} ${crossing.portName}[${crossing.index}]: formal ${model.bits[crossing.formalBitId].value} <-> actual ${model.bits[crossing.actualBitId].value}\n${crossing.providerRefs.map(ref => ref.pointer).join('\n')}`, panel, { class: 'evidence' });
            if (!crossings.length) el('p', 'No hierarchy binding for this selected bit in the artifact.', panel);
        }
        el('h3', 'Source correspondence', panel);
        const available = evidenceEntity === id ? evidence : [];
        const original = available.filter(ref => ref.role === 'original-bsv');
        el('p', original.length ? 'Verified compiler instance declaration; not complete cell-to-BSV correspondence.'
            : available.some(ref => ref.role === 'original-bsv-context') ? 'Verified compiler port contract; BSV module context only. Exact method source range unknown.'
                : 'Original BSV mapping unknown. Generated RTL is not an exact BSV source map.', panel, { id: 'mapping-status' });
        available.forEach(ref => {
            const button = el('button', `${ref.role === 'generated-rtl' ? (ref.scope === 'object-attribute' ? 'Open generated RTL' : 'Open generated RTL context') : ref.role === 'original-bsv-context' ? 'Open BSV compiler context' : 'Open verified BSV'} ${ref.line1}-${ref.endLine1}`, panel, { 'data-source-index': ref.index });
            button.addEventListener('click', async () => {
                const context = model.snapshot.id;
                try {
                    const source = await request(apiUrl('source', id, ref.index));
                    if (model.snapshot.id !== context || nav.state.selectedId !== id) return;
                    nav.source({ ...source, entityId: id }); renderSource(); notify('source');
                } catch (failure) { error = failure.message; $('status').textContent = error; notify('error'); }
            });
        });
        el('h3', 'Implementation evidence', panel);
        el('p', `Snapshot ${model.snapshot.id}\nStage ${model.snapshot.stage}`, panel, { class: 'evidence' });
        el('pre', provenance(item), panel, { id: 'artifact-pointer' });
        const buildEvidence = el('details', null, panel);
        el('summary', 'Build tools, inputs and emitted parameters', buildEvidence);
        el('pre', JSON.stringify({ toolchain: model.snapshot.toolchain, dependencyInputs: model.snapshot.dependencyInputs,
            concreteParameters: model.snapshot.concreteParameters, parameterEvidence: model.snapshot.parameterEvidence }, null, 2), buildEvidence);
    }
    function renderSource() {
        const source = nav.state.source;
        $('source-drawer').hidden = !source;
        if (!source) return;
        $('source-title').textContent = `${source.role === 'generated-rtl' ? 'Generated RTL' : source.role === 'original-bsv-context' ? 'BSV compiler module context' : source.role === 'bsv-source' ? 'Original BSV source' : 'Verified BSV declaration'} - ${source.path.split('/').at(-1)}`;
        $('source-meta').textContent = `${source.path}:${source.line1}${source.column1 === null ? '' : `.${source.column1}`}-${source.endLine1}${source.endColumn1 === null ? '' : `.${source.endColumn1}`} | sha256 ${source.hash}\n${source.convention}\n${source.scope || 'verified-instance-declaration'}\nRelation: ${source.relation}`;
        $('source-code').textContent = source.text;
    }
    $('load').addEventListener('click', async () => {
        const key = $('build').value, token = ++loadVersion, started = performance.now();
        $('load').disabled = true; $('load').textContent = 'Importing...'; $('canvas-region').setAttribute('aria-busy', 'true');
        try {
            const [candidate, bsvCandidate] = await Promise.all([
                request(`/api/model?build=${encodeURIComponent(key)}`),
                initialMode === 'bsv' ? request(`/api/bsv-model?build=${encodeURIComponent(key)}`) : Promise.resolve(null)
            ]);
            if (token !== loadVersion) return;
            model = candidate; architecture = bsvCandidate; buildKey = key;
            nav = HardwareNavigation.createNavigation(model, { architecture, mode: initialMode });
            nodePool.clear(); portPool.clear(); evidenceCache.clear(); world.replaceChildren(); bsv.reset(); evidence = []; error = null;
            render(); timings.push({ action: 'load', ms: performance.now() - started }); notify('load');
        } catch (failure) { error = failure.message; $('status').textContent = `Import failed; last successful scene retained. ${error}`; notify('error'); }
        finally { $('load').disabled = !$('build').value; $('load').textContent = 'Import build'; $('canvas-region').removeAttribute('aria-busy'); }
    });
    $('build').addEventListener('change', () => { $('load').disabled = !$('build').value; });
    $('return-bsv').addEventListener('click', () => navigate('returnBSV'));
    for (const action of ['back', 'forward', 'up']) $(action).addEventListener('click', () => navigate(action));
    $('fit').addEventListener('click', () => { fit(); notify('fit'); });
    $('detail-zoom').addEventListener('click', () => {
        const view = nav.state.viewport;
        nav.viewport({ x: view.x + view.width / 4, y: view.y + view.height / 4, width: view.width / 2, height: view.height / 2 });
        applyViewport(); notify('zoom');
    });
    $('close-source').addEventListener('click', () => { nav.source(null); renderSource(); notify('close-source'); });
    $('theme').addEventListener('change', () => { document.documentElement.dataset.theme = $('theme').value; notify('theme'); });
    $('hierarchy-toggle').addEventListener('click', () => {
        $('hierarchy').hidden = !$('hierarchy').hidden;
        $('hierarchy-toggle').setAttribute('aria-expanded', String(!$('hierarchy').hidden));
        if (nav) nav.state.panels.hierarchy = !$('hierarchy').hidden;
        if (innerWidth <= 600 && !$('hierarchy').hidden) $('details').hidden = true;
        notify('hierarchy');
    });
    svg.addEventListener('click', event => { if (event.target === svg || event.target === world) {
        if (suppressClick) { suppressClick = false; return; }
        if (nav) { nav.inspect(null); render(); notify('clear'); }
    } });
    svg.addEventListener('pointerdown', event => {
        if (!nav || event.button !== 0) return;
        suppressClick = event.detail > 1;
        drag = { x: event.clientX, y: event.clientY, view: { ...nav.state.viewport }, moved: false };
    });
    svg.addEventListener('pointermove', event => {
        if (!drag || !nav) return;
        const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
        if (Math.hypot(dx, dy) > 5) drag.moved = true;
        if (!drag.moved) return;
        const scale = drag.view.width / svg.clientWidth;
        nav.viewport({ ...drag.view, x: drag.view.x - dx * scale, y: drag.view.y - dy * scale }); applyViewport();
    });
    window.addEventListener('pointerup', () => { if (drag?.moved) { suppressClick = true; notify('pan'); } drag = null; });
    svg.addEventListener('wheel', event => {
        if (!nav) return;
        event.preventDefault();
        const view = nav.state.viewport, factor = Math.exp(Math.max(-1, Math.min(1, event.deltaY / 500)));
        const box = svg.getBoundingClientRect(), px = (event.clientX - box.x) / box.width, py = (event.clientY - box.y) / box.height;
        nav.viewport({ x: view.x + view.width * px * (1 - factor), y: view.y + view.height * py * (1 - factor),
            width: view.width * factor, height: view.height * factor }); applyViewport(); notify('wheel');
    }, { passive: false });
    request('/api/builds').then(builds => {
        for (const build of builds) el('option', `${build.label}${build.status === 'failed' ? ' (unavailable)' : ''}`, $('build'), { value: build.key });
        window.dispatchEvent(new CustomEvent('hardware:ready'));
    }).catch(failure => { error = failure.message; $('status').textContent = error; window.dispatchEvent(new CustomEvent('hardware:ready')); });
})();
