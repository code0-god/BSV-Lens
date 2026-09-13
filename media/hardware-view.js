'use strict';

(function startHardwareView() {
    function nativeSourceStatus(discovery, translate) {
        let message = translate('BSV files analyzed: {count} · Source-based', { count: discovery.analyzedFiles || 0 });
        if (discovery.status === 'partial' || discovery.truncated || discovery.unanalysed?.length
            || discovery.sourceIndexStatus?.status === 'limited') {
            message += ` · ${translate('Partial source inventory. Review source settings.')}`;
        }
        if (discovery.sourceIndexStatus?.status === 'limited') message += ` ${translate('Only {count} of {total} source designs are listed.',
            { count: discovery.sourceIndexStatus.returnedEntries, total: discovery.sourceIndexStatus.totalEntries })}`;
        return message;
    }
    function nativeDesignLimit(error) {
        return error?.code === 'LIMIT_EXCEEDED' && ['Generated correspondence shared payload byte limit', 'Prepared design exceeds its bounded byte limit.',
            'Prepared design history reached its bounded limit. Reopen Hardware Schematic to start a new design history.'].includes(error.message);
    }
    function nativeHistoryPending(catalog, publication) {
        return catalog?.options.newHistory === true && publication?.pending() === true;
    }
    function nativeInputAction(action) {
        return action.startsWith('choose-') || action === 'refresh-input' || action === 'discover-workspace';
    }
    function nativeSelectionStatus(selection, translate) {
        if (['limited', 'history-full'].includes(selection.status)) return translate(selection.status === 'history-full'
            ? 'This design history is full. Start a new history to open another design.'
            : 'This design exceeds the supported analysis size. Choose a smaller module.')
            + (selection.preserved ? ` ${translate('Still showing {name}.', { name: selection.current })}` : '');
        return selection.preserved ? translate('Design selection closed. The current design is unchanged.')
            : translate('Found {count} BSV files. Choose a design to open.', { count: selection.sourceFiles });
    }
    function nativeCommittedStatus(payload, translate) {
        const labels = { 'source-only': 'BSV source analysis', 'artifact-only': 'RTL result connected. BSV source correspondence is not attached.',
            'source-and-artifact': 'BSV sources and RTL result loaded.', 'no-input': 'Select a design' };
        return payload?.inputStatus && labels[payload.inputStatus]
            ? { ...payload, message: translate(labels[payload.inputStatus]) } : payload;
    }
    function fitNativeInitialViewport(navigation, target, getSize, fitViewport) {
        const state = navigation.getState(), current = state.current;
        if (!target || !current || current.buildId !== target.buildId || state.queryGeneration !== target.queryGeneration || state.pending || state.error
            || current.selectedEntityId || current.selectedRelationId || current.analysis
            || ['manual', 'selection'].includes(current.disclosureState.presentation?.fit)) return false;
        if (!navigation.resize(false)) return false;
        navigation.setViewport(fitViewport(navigation.getState().geometry, getSize()), { fit: 'structure' });
        return true;
    }
    function createNativeStatusOverlay() {
        const records = new Map();
        function keys(payload, inputIdentity, buildId) {
            const input = payload.inputIdentity || payload.summary?.inputIdentity || inputIdentity;
            const builds = payload.catalog?.map(item => item.buildId) || [payload.selectedBuildId || buildId].filter(Boolean);
            return [...(input ? [`input:${input}`] : []), ...builds.map(id => `build:${id}`)];
        }
        return {
            observe(payload, inputIdentity, buildId) {
                const ids = keys(payload, inputIdentity, buildId);
                if (!ids.length || !payload.discovery && !['stale', 'dirty-source', 'captured'].includes(payload.status)) return;
                const input = ids.find(id => id.startsWith('input:'))?.slice(6);
                const record = ids.map(id => records.get(id)).find(value => value
                    && (!input || !value.inputIdentity || value.inputIdentity === input)) || {};
                if (payload.discovery) {
                    const previous = record.discovery?.invalidationRevision, next = payload.discovery.invalidationRevision;
                    if (Number.isSafeInteger(previous) && Number.isSafeInteger(next) && next < previous) return;
                    const revalidated = !record.discovery || payload.status === 'unchanged' || payload.replaceMode === 'refresh'
                        || Number.isSafeInteger(next) && (!Number.isSafeInteger(previous) || next > previous);
                    record.discovery = structuredClone(payload.discovery);
                    if (revalidated && !payload.discovery.dirtyDocuments?.length) record.notice = null;
                } else record.notice = { status: payload.status, message: payload.message };
                if (input) record.inputIdentity = input;
                for (const id of ids) {
                    const previous = records.get(id);
                    if (id.startsWith('build:') && previous && previous !== record
                        && (previous.inputIdentity && previous.inputIdentity !== input
                            || buildId && !payload.catalog && !payload.selectedBuildId)) continue;
                    records.set(id, record);
                }
            },
            resolve(payload) {
                if (!payload) return payload;
                const record = keys(payload).map(id => records.get(id)).find(Boolean);
                return record ? { ...payload, ...(record.inputIdentity ? { inputIdentity: record.inputIdentity } : {}),
                    ...(record.discovery ? { discovery: record.discovery } : {}), notice: record.notice || null } : payload;
            },
            retain(inputIds, buildIds = []) {
                const allowed = new Set([...inputIds.map(id => `input:${id}`), ...buildIds.map(id => `build:${id}`)]);
                for (const key of records.keys()) if (!allowed.has(key)) records.delete(key);
            },
            clear() { records.clear(); }
        };
    }
    function createNativePublication({ navigation, send, generation, capture = () => null, restore = () => {},
        saveState = () => {}, onAccepted = () => {}, onError = () => {}, onSettled = () => {} }) {
        let revision = 0, acceptedRevision = 0, timer = null, postedSemantic = '', pendingEncoded = '';
        let accepted = { checkpoint: navigation.checkpoint(), metadata: capture(), state: { schema: 1, view: null }, encoded: '' };
        const pending = new Set();
        const rejectedBeforeCommit = new Set(['STALE_SOURCE', 'SOURCE_REVISION_MISMATCH', 'SNAPSHOT_MISMATCH',
            'ARTIFACT_HASH_MISMATCH', 'PATH_DENIED', 'FORBIDDEN', 'INVALID_INPUT', 'COMMIT_REJECTED']);
        function publish(state, { immediate = false } = {}) {
            clearTimeout(timer); timer = null;
            const encoded = JSON.stringify(state), semantic = JSON.stringify(state.view && { ...state.view,
                viewport: undefined, viewportSize: undefined, viewportAnchor: undefined, disclosureState: undefined, activePanel: undefined });
            if (encoded === pendingEncoded || encoded === accepted.encoded && !pendingEncoded && semantic === postedSemantic)
                return Promise.resolve(true);
            const submit = () => {
                timer = null;
                const version = ++revision, epoch = generation(), queryGeneration = navigation.getState().queryGeneration;
                const metadata = capture();
                const candidate = { checkpoint: navigation.checkpoint({ historyBuildIds: metadata?.historyBuildIds }),
                    metadata, state: structuredClone(state), encoded };
                const latest = () => version === revision && epoch === generation()
                    && queryGeneration === navigation.getState().queryGeneration;
                pendingEncoded = encoded; postedSemantic = semantic; pending.add(version);
                let response;
                try { response = send({ state, revision: version }); } catch (error) { response = Promise.reject(error); }
                const accept = () => {
                    if (epoch !== generation()) return false;
                    if (version > acceptedRevision) {
                        accepted = candidate; acceptedRevision = version;
                        if (metadata?.historyBuildIds) navigation.retainHistory(metadata.historyBuildIds);
                    }
                    if (latest()) { saveState(state); onAccepted(candidate.metadata, state); }
                    return true;
                };
                return Promise.resolve(response).then(accept).catch(error => {
                    if (error.code === 'COMMITTED_UNSAVED') {
                        const result = accept(); if (latest()) onError(error); return result;
                    }
                    if (!latest()) return false;
                    postedSemantic = '';
                    if (rejectedBeforeCommit.has(error.code)) {
                        restore(accepted.metadata);
                        navigation.restoreCheckpoint(accepted.checkpoint, queryGeneration, error);
                        saveState(accepted.state);
                    }
                    onError(error, candidate.metadata); return false;
                }).finally(() => {
                    pending.delete(version);
                    if (version === revision) pendingEncoded = '';
                    onSettled();
                });
            };
            if (immediate || semantic !== postedSemantic) return submit();
            timer = setTimeout(submit, 200); return Promise.resolve(false);
        }
        return { publish, pending: () => !!timer || pending.size > 0,
            cancelScheduled() { clearTimeout(timer); timer = null; },
            reset({ retain = false } = {}) {
                clearTimeout(timer); timer = null; revision++; acceptedRevision = 0;
                pending.clear(); pendingEncoded = ''; postedSemantic = '';
                if (!retain) accepted = { checkpoint: navigation.checkpoint(), metadata: capture(), state: { schema: 1, view: null }, encoded: '' };
            } };
    }
    // Screen-space interaction, separate from electrical identity and routing.
    function findRouteCandidates(routes, point) {
        const candidates = [];
        for (const route of routes) {
            let distance = Infinity;
            for (const [x1, y1, x2, y2] of route.segments) {
                const dx = x2 - x1, dy = y2 - y1, lengthSquared = dx * dx + dy * dy;
                const t = lengthSquared ? Math.max(0, Math.min(1, ((point.x - x1) * dx + (point.y - y1) * dy) / lengthSquared)) : 0;
                distance = Math.min(distance, Math.hypot(point.x - x1 - t * dx, point.y - y1 - t * dy));
            }
            if (distance <= 6) candidates.push({ id: route.id, distance });
        }
        candidates.sort((a, b) => a.distance - b.distance || a.id.localeCompare(b.id));
        return candidates.filter(candidate => candidate.distance <= candidates[0].distance + 1.5);
    }
    if (typeof module === 'object' && module.exports) module.exports = { findRouteCandidates, createNativePublication, nativeSourceStatus, nativeSelectionStatus, nativeDesignLimit, nativeHistoryPending, createNativeStatusOverlay,
        restoreNativeViewport,
        nativeCommittedStatus, fitNativeInitialViewport };
    if (typeof document === 'undefined') return;
    const $ = id => document.getElementById(id);
    const svg = $('viewport'), world = $('world');
    const layers = { node: $('shells-layer'), contact: $('contacts-layer'), group: $('contacts-layer'), connection: $('connections-layer') };
    const records = new Map();
    const analysisContexts = new Map();
    const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
    const nativeTransport = window.BsvHardwareTransport;
    const t = window.BsvHardwareStrings?.t || ((key, values = {}) => key.replace(/\{([A-Za-z]+)\}/g,
        (token, name) => Object.hasOwn(values, name) ? String(values[name]) : token));
    let catalog = [], navigation, rendered = null, animations = [], transitionToken = 0;
    let transition = null, lastTransition = null, gesture = null, suppressClick = false, renderRevision = 0;
    let hoveredRoutes = [];
    let sourceRequest = null;
    let labelProjection = null, labelLevel = null;
    const fontCanvas = document.createElement('canvas').getContext('2d'), fontCache = new Map();
    let catalogGeneration = 0, nativeGeneration = null, nativePublication = null, pendingCatalog = null;
    let pendingNativeInitialFit = null;
    let committedNativeStatus = null;
    let nativeDiscovery = null, discoveryRequest = null, discoveryAgain = false, nativeSelectionRequired = null;
    let sourceDesigns = [], designRequest = null;
    const designForBuild = new Map();
    const inputStatusForBuild = new Map();
    const nativeStatusOverlay = createNativeStatusOverlay();
    const pendingAnalysisContexts = new Set();

    async function request(action, payload = {}, options = {}) {
        if (nativeTransport) {
            if (nativeInputAction(action) && nativeHistoryPending(pendingCatalog, nativePublication))
                throw Object.assign(new Error(t('Finishing the new design history...')), { code: 'INPUT_BUSY' });
            return nativeTransport.request(action, payload, options);
        }
        const parameters = new URLSearchParams();
        for (const [key, value] of Object.entries(payload)) {
            parameters.set(key === 'buildId' ? 'build' : key, typeof value === 'string' ? value : JSON.stringify(value));
        }
        const response = await fetch(`/api/${action}${parameters.size ? `?${parameters}` : ''}`, options);
        const body = await response.json();
        if (!response.ok) throw Object.assign(new Error(body.error || 'Registered build catalog unavailable'), { code: body.code });
        return body;
    }

    function measureLabel(value, fontSize, role) {
        const family = getComputedStyle(document.documentElement).getPropertyValue('--vscode-editor-font-family');
        const weight = ['node-title', 'contact-label'].includes(role) ? 600 : 400;
        const font = `${weight} ${fontSize}px ${family}`, key = `${font}\n${value}`;
        if (!fontCache.has(key)) {
            fontCanvas.font = font;
            const measured = fontCanvas.measureText(value);
            if (fontCache.size >= 4096) fontCache.clear();
            fontCache.set(key, { width: measured.width,
                ascent: Math.max(measured.actualBoundingBoxAscent, measured.fontBoundingBoxAscent ?? 0),
                descent: Math.max(measured.actualBoundingBoxDescent, measured.fontBoundingBoxDescent ?? 0) });
        }
        return fontCache.get(key);
    }
    function displayLabels(target, projection, geometry) {
        const origins = new Map([...geometry.nodes, ...geometry.contacts, ...geometry.groups].map(item => [item.id, item]));
        for (const route of geometry.routes) origins.set(route.id, { x: 0, y: 0 });
        const elements = new Map([...target.querySelectorAll('[data-label-id]')].map(element => [element.dataset.labelId, element]));
        for (const label of projection.labels) {
            const element = elements.get(label.id), origin = origins.get(label.ownerId);
            if (!element || !origin) continue;
            element.setAttribute('x', label.x - origin.x); element.setAttribute('y', label.y - origin.y);
            element.setAttribute('text-anchor', label.anchor);
            element.style.fontSize = `${label.fontSize}px`; element.style.visibility = label.visible ? 'visible' : 'hidden';
            element.style.stroke = 'none';
            element.style.pointerEvents = label.pointerPolicy === 'none' ? 'none' : 'visiblePainted';
            element.dataset.fullText = label.fullText; element.dataset.labelOwner = label.ownerId;
            element.dataset.labelRole = label.role; element.dataset.displayReason = label.reason || 'full-name';
            text(element, label.text);
        }
        for (const element of target.querySelectorAll('.origin-label')) {
            element.style.visibility = 'hidden'; element.dataset.displayReason = 'readable-context-summary';
        }
    }
    function applyReadability() {
        if (!rendered) return;
        const started = performance.now(), current = rendered.current;
        labelLevel = BsvHardwareReadability.detailLevel(current.viewport.scale, labelLevel);
        world.dataset.detailLevel = labelLevel;
        labelProjection = BsvHardwareReadability.projectLabels({ scene: rendered.scene, geometry: rendered.geometry,
            viewport: current.viewport, canvas: size(), current, measure: measureLabel, level: labelLevel,
            projection: BsvHardwareAnalysis.projectAnalysis(rendered.scene, current.analysis?.result) });
        displayLabels(svg, labelProjection, rendered.geometry);
        labelProjection.preparationMs = performance.now() - started;
        displayContext();
    }
    function displayContext() {
        const { scene, current, geometry } = rendered;
        const selectedItem = [scene.shell, ...scene.children, ...scene.storages, ...scene.contacts, ...(scene.interfaceGroups || []), ...scene.connections]
            .find(item => item.id === (current.selectedEntityId || current.selectedRelationId));
        const selected = selectedItem?.kind === 'rtl-cell' ? selectedItem.secondaryLabel
            : selectedItem?.label || scene.inspector.title || scene.shell.label;
        const actual = current.implementationContext?.occurrencePath?.join('/') || 'Not attached';
        const analysis = current.analysis?.result;
        const owner = scene.ownerInstanceId == null ? 'Not attached' : scene.header.sourceOccurrencePath || scene.header.occurrencePath;
        const sourceOnly = nativeTransport && scene.snapshotId === null;
        const context = nativeTransport ? sourceOnly ? owner : `BSV: ${owner} | RTL: ${actual}`
            : `${scene.sceneKind.toUpperCase()}: ${scene.shell.label}${scene.shell.secondaryLabel ? ` / ${scene.shell.secondaryLabel}` : ''}`;
        text($('readability-context'), context
            + ` | ${t(current.selectedEntityId || current.selectedRelationId ? 'Selected: {name}' : 'Current module: {name}', { name: selected })}`
            + (nativeTransport ? '' : ` | ${current.provider}`)
            + (nativeTransport ? '' : ` | RTL: ${actual}` + (scene.sceneKind === 'rtl' ? ` | BSV owner: ${scene.header.sourceOccurrencePath}` : ''))
            + (analysis ? ` | ${analysis.kind}: ${analysis.status} | Scope: ${analysis.scope.kind}` : '')
            + (scene.correspondence.origin.available ? ' | Partial origin; complete set not established' : ''));
        const open = current.disclosureState.presentation?.inspectorOpen !== false;
        $('inspector').hidden = !open;
        document.querySelector('.workspace').dataset.inspectorOpen = String(open);
        $('toggle-inspector').setAttribute('aria-expanded', String(open));
        text($('toggle-inspector'), t(open ? 'Hide Inspector' : 'Show Inspector'));
        const projection = BsvHardwareAnalysis.projectAnalysis(scene, current.analysis?.result);
        $('fit-selection').disabled = !BsvHardwareReadability.fitSelection({ scene, geometry, current, canvas: size(), projection });
        const view = current.viewport, canvas = size();
        const outside = point => point.x * view.scale + view.x < 0 || point.x * view.scale + view.x > canvas.width
            || point.y * view.scale + view.y < 0 || point.y * view.scale + view.y > canvas.height;
        const hiddenNodes = geometry.nodes.filter(node => outside(node) || outside({ x: node.x + node.width, y: node.y + node.height })).length;
        const hiddenRoutes = geometry.routes.filter(route => route.segments.some(([x1, y1, x2, y2]) => outside({ x: x1, y: y1 }) || outside({ x: x2, y: y2 }))).length;
        const mode = current.disclosureState.presentation?.fit || 'structure';
        text($('display-status'), t(mode === 'structure' ? 'Structure overview' : mode === 'selection' ? 'Selection detail' : 'Manual viewport')
            + (scene.projection?.stateRelations ? ` · ${t('State connections appear when you select storage or behavior.')}` : '')
            + (nativeTransport ? scene.sceneKind === 'bsv' ? ` · ${t('Overview · Select an interface for its details.')}` : ''
                : ` | ${labelProjection.hiddenCount} labels not shown`)
            + (hiddenNodes || hiddenRoutes ? ` | ${t('Outside: {blocks} blocks, {routes} route continuations', { blocks: hiddenNodes, routes: hiddenRoutes })}`
                : ` | ${nativeTransport || scene.projection?.stateRelations ? t('All displayed structure in view') : 'All topology in view'}`));
    }

    function svgElement(tag, attributes = {}, parent) {
        const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
        for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
        if (parent) parent.append(node);
        return node;
    }
    function text(node, value) { node.textContent = value ?? ''; }
    function drawLabels(geometry) {
        const origins = new Map([...geometry.nodes, ...geometry.contacts, ...geometry.groups].map(item => [item.id, item]));
        for (const route of geometry.routes) origins.set(route.id, { x: 0, y: 0 });
        const selectors = { 'node-title': '.title', 'node-detail': '.secondary', 'contact-label': '.label',
            'contact-detail': '.detail', 'interface-group': '.label', connection: '.connection-label' };
        for (const label of geometry.labels) {
            const record = records.get(label.ownerId), origin = origins.get(label.ownerId);
            if (!record || !origin || !selectors[label.role]) throw new Error(`Unknown geometry label owner/role: ${label.id}`);
            const element = record.group.querySelector(selectors[label.role]);
            element.dataset.labelId = label.id;
            element.setAttribute('x', label.x - origin.x); element.setAttribute('y', label.y - origin.y);
            element.setAttribute('text-anchor', label.anchor);
            text(element, label.text);
        }
    }
    function shortened(value, width) {
        const label = String(value || ''), limit = Math.max(8, Math.floor(width / 6.6));
        return label.length > limit ? `${label.slice(0, limit - 3)}...` : label;
    }
    function size() { return { width: svg.clientWidth, height: svg.clientHeight }; }
    function rect(element) {
        const box = element.getBoundingClientRect(), canvas = svg.getBoundingClientRect();
        return { x: box.left - canvas.left, y: box.top - canvas.top, width: box.width, height: box.height };
    }
    function runtime() {
        const canvas = size(), current = navigation.getState().current;
        const active = [...records.values()].filter(record => record.active);
        const boxes = active.map(record => ({ id: record.id, kind: record.item.kind,
            ...rect(record.group.querySelector('.body, .contact-marks, .group-anchor') || record.group),
            opacity: Number(getComputedStyle(record.group).opacity) }));
        return {
            canvas, renderRevision, shell: boxes.find(box => box.id === rendered?.scene.shell.id) || null,
            objects: boxes,
            contacts: boxes.filter(box => records.get(box.id).type === 'contact'),
            slots: [...svg.querySelectorAll('[data-slot-id]')].map(element => ({ id: element.dataset.slotId,
                connectionId: element.dataset.connectionId, contactId: element.dataset.contactId,
                indices: JSON.parse(element.dataset.indices), ...rect(element) })),
            labels: [...svg.querySelectorAll('[data-label-id]')].map(element => ({ id: element.dataset.labelId,
                visible: getComputedStyle(element).visibility !== 'hidden', ...rect(element) })),
            visibleSemanticIds: boxes.filter(box => box.opacity > 0 && box.x + box.width > 0 && box.y + box.height > 0
                && box.x < canvas.width && box.y < canvas.height).map(box => box.id),
            inspector: rect($('inspector')),
            provider: current?.provider,
            correspondence: rendered?.scene.correspondence.origin.status,
            readability: labelProjection
        };
    }
    function emit(name, detail) { window.dispatchEvent(new CustomEvent(`hardware:${name}`, { detail })); }
    function connectionCaption(id) {
        const connection = rendered.scene.connections.find(item => item.id === id);
        const contacts = new Map([...rendered.scene.contacts, ...(rendered.scene.interfaceGroups || [])].map(item => [item.id, item]));
        const nodes = new Map([rendered.scene.shell, ...rendered.scene.children, ...rendered.scene.storages].map(item => [item.id, item]));
        const endpoints = connection.endpointIds.map(endpoint => {
            const contact = contacts.get(endpoint);
            const owner = contact && nodes.get(contact.ownerId);
            const ownerName = owner?.kind === 'rtl-cell' ? owner.secondaryLabel || owner.label : owner?.label || owner?.secondaryLabel;
            return contact ? `${ownerName || contact.ownerId}/${contact.label}` : nodes.get(endpoint)?.label || endpoint;
        });
        return `${connection.label}${connection.rawBits ? ` [${connection.rawBits.join(', ')}]` : ''}${endpoints.length ? ` | ${endpoints.join(', ')}` : ' | No contacts'}`;
    }
    function wireCandidates(event, record) {
        if (event.target.classList.contains('connection-label')) return [{ id: record.id, distance: 0 }];
        const routes = rendered.geometry.routes.flatMap(route => {
            const view = records.get(route.id);
            if (!view?.active || Number(getComputedStyle(view.group).opacity) === 0) return [];
            const matrix = view.group.getScreenCTM();
            return [{ id: route.id, segments: route.segments.map(([x1, y1, x2, y2]) => {
                const start = new DOMPoint(x1, y1).matrixTransform(matrix);
                const end = new DOMPoint(x2, y2).matrixTransform(matrix);
                return [start.x, start.y, end.x, end.y];
            }) }];
        });
        return findRouteCandidates(routes, { x: event.clientX, y: event.clientY });
    }
    function clearWireHover() {
        for (const id of hoveredRoutes) records.get(id)?.group.classList.remove('hovered');
        hoveredRoutes = [];
        $('wire-tooltip').hidden = true;
    }
    function closeWireChoices() { $('wire-choices').hidden = true; $('wire-choices').replaceChildren(); }
    function chooseWire(event, record) {
        const candidates = wireCandidates(event, record);
        clearWireHover(); closeWireChoices();
        if (candidates.length === 1) return navigation.select(candidates[0].id, { relation: true });
        if (!candidates.length) return;
        const choices = $('wire-choices'), bounds = $('canvas').getBoundingClientRect();
        const heading = document.createElement('strong');
        heading.textContent = `${candidates.length} connections at this position`;
        choices.append(heading);
        for (const candidate of candidates) {
            const button = document.createElement('button');
            button.textContent = connectionCaption(candidate.id);
            button.dataset.connectionId = candidate.id;
            button.setAttribute('aria-label', `${button.textContent}; ${candidate.id}`);
            button.addEventListener('click', event => {
                event.stopPropagation();
                closeWireChoices();
                navigation.select(candidate.id, { relation: true });
            });
            choices.append(button);
        }
        choices.hidden = false;
        choices.style.left = `${Math.max(8, Math.min(event.clientX - bounds.left, bounds.width - choices.offsetWidth - 8))}px`;
        choices.style.top = `${Math.max(8, Math.min(event.clientY - bounds.top, bounds.height - choices.offsetHeight - 8))}px`;
        choices.querySelector('button').focus();
        emit('wire-candidates', { ids: candidates.map(candidate => candidate.id) });
    }
    function serializeSceneSvg() {
        const clone = svg.cloneNode(true);
        const originalElements = [svg, ...svg.querySelectorAll('*')];
        const clonedElements = [clone, ...clone.querySelectorAll('*')];
        const properties = ['fill', 'stroke', 'stroke-width', 'stroke-dasharray', 'stroke-linecap', 'stroke-linejoin',
            'font-family', 'font-size', 'font-weight', 'paint-order', 'text-anchor', 'vector-effect', 'visibility', 'opacity'];
        originalElements.forEach((element, index) => {
            const style = getComputedStyle(element);
            for (const property of properties) clonedElements[index].style.setProperty(property, style.getPropertyValue(property));
        });
        const bounds = rendered.geometry.bounds;
        clone.setAttribute('viewBox', `${bounds.x} ${bounds.y} ${bounds.width} ${bounds.height}`);
        clone.setAttribute('width', bounds.width);
        clone.setAttribute('height', bounds.height);
        clone.style.width = `${bounds.width}px`; clone.style.height = `${bounds.height}px`;
        clone.style.background = getComputedStyle(document.body).backgroundColor;
        clone.querySelector('#world').removeAttribute('transform');
        for (const leaving of clone.querySelectorAll('[data-active="false"]')) leaving.remove();
        const exportedLabels = BsvHardwareReadability.projectLabels({ scene: rendered.scene, geometry: rendered.geometry,
            viewport: { x: -bounds.x, y: -bounds.y, scale: 1 }, canvas: bounds, current: rendered.current,
            measure: measureLabel, level: 'detail' });
        displayLabels(clone, exportedLabels, rendered.geometry);
        const metadata = svgElement('metadata');
        metadata.textContent = JSON.stringify({ snapshotId: rendered.scene.snapshotId, sceneKind: rendered.scene.sceneKind,
            ownerInstanceId: rendered.current.ownerInstanceId, implementationContext: rendered.scene.implementationContext,
            bounds, displayScope: rendered.scene.projection?.kind === 'bsv-overview'
                ? 'BSV overview at intrinsic scale 1; folded semantic members and deferred routes are listed separately'
                : 'complete topology at intrinsic scale 1; folded labels remain in metadata',
            ...(rendered.scene.projection ? { sourceRevision: rendered.scene.sourceRevision,
                projection: rendered.scene.projection, routing: rendered.geometry.routing } : {}),
            labels: exportedLabels.labels, connections: rendered.scene.connections.map(connection => ({ id: connection.id,
                bits: connection.bits, rawBits: connection.rawBits, members: connection.members, memberRelationIds: connection.memberRelationIds })) });
        clone.prepend(metadata);
        return new XMLSerializer().serializeToString(clone);
    }
    function analysisProjection() {
        return BsvHardwareAnalysis.projectAnalysis(rendered.scene, rendered.current.analysis?.result, runtime().visibleSemanticIds);
    }
    function applyAnalysisHighlights() {
        const projection = analysisProjection();
        const focused = projection.references.find(r => r.entityId === rendered.current.disclosureState.analysis?.resultSelection);
        for (const item of [...projection.nodes, ...projection.contacts, ...projection.routes]) {
            const group = records.get(item.id)?.group;
            if (!group) continue;
            for (const cue of ['result', 'seed', 'boundary']) group.classList.toggle(`analysis-${cue}`, item[cue]);
            group.classList.toggle('analysis-reference-selected', !!focused?.displayIds.includes(item.id));
            const cues = ['seed', 'result', 'boundary'].filter(cue => item[cue]);
            group.dataset.analysisCues = cues.join(' ');
            if (cues.length) group.setAttribute('aria-label', `${group.getAttribute('aria-label')}; analysis ${cues.join(', ')}`);
        }
        BsvHardwareInspector.updateAnalysisCounts(projection.counts);
    }
    function state() { return { ...navigation.getState(), runtime: runtime(), transition, lastTransition,
        analysisProjection: rendered ? analysisProjection() : null }; }
    function settle(token) {
        if (token !== transitionToken) return;
        animations = [];
        if (transition) {
            transition.frames.push({ progress: 1, ...runtime() });
            lastTransition = transition;
            transition = null;
        }
        emit('settled', { current: navigation.getState().current });
    }
    function stopAnimation() {
        ++transitionToken;
        for (const animation of animations) animation.cancel();
        animations = [];
        transition = null;
        for (const [id, record] of records) if (!record.active) { record.group.remove(); records.delete(id); }
    }
    function beginAnimation(group, from, to, extra = {}) {
        const animation = group.animate([from, to], { duration: 320, easing: 'cubic-bezier(0.2, 0, 0, 1)', ...extra });
        animations.push(animation);
    }
    function interactive(id, type, item) {
        let record = records.get(id);
        if (!record) {
            const group = svgElement('g', { 'data-semantic-id': id, tabindex: '0', role: 'button' }, layers[type]);
            group.style.transformOrigin = '0 0';
            svgElement('title', {}, group);
            record = { id, group, type, item, active: true };
            records.set(id, record);
            group.addEventListener('click', event => {
                event.stopPropagation();
                if (suppressClick || event.detail > 1 || !record.active) return;
                if (record.type === 'connection') chooseWire(event, record);
                else activate(record.item, record.type);
            });
            group.addEventListener('dblclick', event => { event.preventDefault(); event.stopPropagation(); });
            group.addEventListener('keydown', event => {
                if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault(); event.stopPropagation();
                    activate(record.item, record.type);
                }
            });
            if (type === 'node') {
                svgElement('rect', { class: 'body', rx: 7 }, group);
                svgElement('text', { class: 'title', x: 16, y: 27 }, group);
                svgElement('text', { class: 'secondary', x: 16, y: 47 }, group);
                svgElement('path', { class: 'storage-lines' }, group);
                svgElement('text', { class: 'origin-label', x: 16 }, group);
            } else if (type === 'contact') {
                svgElement('g', { class: 'contact-marks' }, group);
                svgElement('text', { class: 'label', y: -4 }, group);
                svgElement('text', { class: 'detail', y: 12 }, group);
            } else if (type === 'group') {
                svgElement('path', { class: 'group-anchor', d: 'M4,-4H1Q-3,-4 -3,0Q-3,4 1,4H4' }, group);
                svgElement('text', { class: 'label' }, group);
                group.addEventListener('pointerenter', () => {
                    for (const id of record.item.memberContactIds) records.get(id)?.group.classList.add('group-member');
                });
                group.addEventListener('pointerleave', () => {
                    for (const id of record.item.memberContactIds) records.get(id)?.group.classList.remove('group-member');
                });
            } else {
                svgElement('path', { class: 'route' }, group);
                svgElement('path', { class: 'hit-route' }, group);
                svgElement('g', { class: 'junctions' }, group);
                svgElement('text', { class: 'connection-label' }, group);
            }
        }
        record.active = true; record.item = item;
        record.group.setAttribute('tabindex', '0');
        record.group.dataset.active = 'true';
        return record;
    }
    function activate(item, type) {
        const current = navigation.getState().current;
        if (type === 'connection') return navigation.select(item.id, { relation: true });
        if (item.interaction.kind !== 'enter' || item.id === rendered.scene.shell.id) return navigation.select(item.id);
        if (current.sceneKind === 'bsv') {
            return navigation.navigate({ sceneKind: 'bsv', implementationProvider: 'stock',
                rootInstanceId: item.id, ownerInstanceId: item.id, selectedEntityId: null, selectedRelationId: null }, { reason: 'enter' });
        }
        return navigation.navigate({ implementationContext: { ...current.implementationContext,
            contextOccurrenceId: item.id },
            selectedEntityId: null, selectedRelationId: null }, { reason: 'enter' });
    }
    function draw(next, previous, { reason }) {
        ++renderRevision;
        clearWireHover(); closeWireChoices();
        const before = rendered ? runtime() : null;
        const oldBoxes = new Map(before?.objects.map(box => [box.id, box]) || []);
        stopAnimation();
        const token = transitionToken;
        if (!next.current) {
            rendered = null; labelProjection = null; labelLevel = null; lastTransition = null; gesture = null;
            records.clear();
            for (const layer of new Set(Object.values(layers))) layer.replaceChildren();
            world.removeAttribute('transform'); delete world.dataset.sceneKind; delete world.dataset.detailLevel;
            for (const id of ['scene-path', 'provider-status', 'readability-context', 'display-status', 'breadcrumb',
                'source-breadcrumb', 'inspector-content', 'capability-content']) $(id).replaceChildren();
            text($('scene-title'), 'Hardware Schematic'); text($('selection-title'), 'Hardware details');
            $('return-bsv').hidden = true; $('source-breadcrumb').hidden = true;
            $('rtl').disabled = true; $('fit-selection').disabled = true;
            if (nativeTransport) $('native-empty').hidden = false;
            settle(token); return;
        }
        const oldScene = rendered?.scene;
        rendered = next;
        const { scene, geometry, current } = next;
        const view = current.viewport;
        world.setAttribute('transform', `translate(${view.x} ${view.y}) scale(${view.scale})`);
        if (oldScene?.shell.id !== scene.shell.id) labelLevel = null;
        world.dataset.sceneKind = scene.sceneKind;
        if (reason === 'viewport') {
            applyReadability();
            BsvHardwareInspector.updateAnalysisCounts(analysisProjection().counts);
            emit('viewport', { current });
            settle(token);
            return;
        }
        const changedPlace = oldScene && (oldScene.shell.id !== scene.shell.id || oldScene.sceneKind !== scene.sceneKind);
        const expanding = changedPlace && oldBoxes.has(scene.shell.id) && !reducedMotion.matches;
        const oldShell = expanding ? oldBoxes.get(scene.shell.id) : null;
        const newShell = geometry.nodes.find(node => node.id === scene.shell.id);
        const objectById = new Map([scene.shell, ...scene.children, ...scene.storages].map(item => [item.id, item]));
        const contactById = new Map(scene.contacts.map(item => [item.id, item]));
        const connectionById = new Map(scene.connections.map(item => [item.id, item]));
        const highlight = new Set(scene.implementationContext.highlightEntityIds);
        const selection = new Set([current.selectedEntityId, current.selectedRelationId]);
        for (const record of records.values()) record.active = false;
        for (const box of geometry.nodes) {
            const item = objectById.get(box.id), record = interactive(box.id, 'node', item), group = record.group;
            const storage = scene.storages.some(value => value.id === box.id);
            group.setAttribute('class', ['hardware-object', box.id === scene.shell.id ? 'expanded' : '',
                storage ? 'storage' : '', selection.has(box.id) ? 'selected' : '', highlight.has(box.id) ? 'contributor' : ''].join(' '));
            group.setAttribute('transform', `translate(${box.x} ${box.y})`);
            group.setAttribute('aria-label', `${item.kind === 'rtl-cell' ? `${item.secondaryLabel}, ${item.label}` : item.label}, ${item.kind}, ${selection.has(box.id) ? 'selected, ' : ''}${item.interaction.kind === 'enter' && box.id !== scene.shell.id ? 'enter interior' : 'inspect'}`);
            group.setAttribute('aria-pressed', String(selection.has(box.id)));
            group.querySelector('.body').setAttribute('width', box.width);
            group.querySelector('.body').setAttribute('height', box.height);
            group.querySelector('.body').setAttribute('fill', box.id === scene.shell.id ? 'none' : 'var(--vscode-editorWidget-background)');
            text(group.querySelector('title'), `${item.interaction.kind === 'enter' && box.id !== scene.shell.id
                ? t('Click to see inside {name}', { name: item.label }) : item.label}\n${item.secondaryLabel || ''}\n${item.id}`);
            text(group.querySelector('.title'), shortened(item.label, box.width - 32));
            text(group.querySelector('.secondary'), shortened(item.secondaryLabel, box.width - 32));
            group.querySelector('.storage-lines').setAttribute('d', storage ? `M16 ${box.height - 27}H${box.width - 16}M16 ${box.height - 21}H${box.width - 16}` : '');
            group.querySelector('.origin-label').setAttribute('y', box.height - 10);
            text(group.querySelector('.origin-label'), highlight.has(box.id) ? 'Verified contributor / partial' : '');
            animateBox(record, box, oldBoxes.get(box.id));
        }
        for (const point of geometry.contacts) {
            const item = contactById.get(point.id), record = interactive(point.id, 'contact', item), group = record.group;
            group.setAttribute('class', `contact${selection.has(point.id) ? ' selected' : ''}${item.status === 'compiler-confirmed-method-port' ? ' confirmed' : ''}`);
            group.setAttribute('transform', `translate(${point.x} ${point.y})`);
            group.setAttribute('aria-label', `${item.label}, ${item.kind}, ${item.direction}, ${item.detail}, inspect`);
            group.setAttribute('aria-pressed', String(selection.has(point.id)));
            text(group.querySelector('title'), `${item.label}\n${item.detail}\n${item.status}\n${item.id}`);
            const marks = group.querySelector('.contact-marks');
            marks.replaceChildren();
            const slots = point.slots.length ? point.slots : [{ x: point.x, y: point.y, indices: [], bitIds: [] }];
            for (const slot of slots) {
                const selected = slot.connectionId === current.selectedRelationId || slot.bitIds.some(id => highlight.has(id));
                const mark = svgElement('rect', { class: `mark${selected ? ' selected' : ''}`,
                    x: slot.x - point.x - 4, y: slot.y - point.y - 4, width: 8, height: 8 }, marks);
                if (slot.id) {
                    mark.dataset.slotId = slot.id; mark.dataset.connectionId = slot.connectionId;
                    mark.dataset.contactId = point.id; mark.dataset.indices = JSON.stringify(slot.indices);
                    text(svgElement('title', {}, mark), `${item.label}: ${slot.indices.length ? `indices [${slot.indices.join(', ')}]` : 'BSV relation attachment'}`);
                }
            }
            const outward = point.boundary, sign = (point.side === 'left' ? 1 : -1) * (outward ? -1 : 1);
            for (const name of ['label', 'detail']) {
                const label = group.querySelector(`.${name}`);
                label.setAttribute('x', sign * 12);
                label.setAttribute('text-anchor', sign < 0 ? 'end' : 'start');
                text(label, name === 'label' ? item.label : shortened(item.detail, outward ? 170 : 150));
            }
            if (expanding) {
                const old = oldBoxes.get(point.id);
                const start = old ? { x: (old.x + old.width / 2 - view.x) / view.scale, y: (old.y + old.height / 2 - view.y) / view.scale }
                    : withinOldShell(point);
                beginAnimation(group, { transform: `translate(${start.x}px, ${start.y}px)`, opacity: old ? 1 : 0 },
                    { transform: `translate(${point.x}px, ${point.y}px)`, opacity: 1 });
            }
        }
        const groups = new Map((scene.interfaceGroups || []).map(item => [item.id, item]));
        for (const point of geometry.groups) {
            const item = groups.get(point.id), record = interactive(point.id, 'group', item), group = record.group;
            group.setAttribute('class', `interface-group${selection.has(point.id) ? ' selected' : ''}`);
            group.setAttribute('transform', `translate(${point.x} ${point.y})`);
            group.setAttribute('aria-label', `${item.label}, BSV interface group, not a physical port, inspect members`);
            group.setAttribute('aria-pressed', String(selection.has(point.id)));
            text(group.querySelector('title'), `${item.label}\n${t('Overview · Select an interface for its details.')}\n${item.id}`);
            if (expanding) {
                const old = oldBoxes.get(point.id);
                const start = old ? { x: (old.x + old.width / 2 - view.x) / view.scale,
                    y: (old.y + old.height / 2 - view.y) / view.scale } : withinOldShell(point);
                beginAnimation(group, { transform: `translate(${start.x}px, ${start.y}px)`, opacity: old ? 1 : 0 },
                    { transform: `translate(${point.x}px, ${point.y}px)`, opacity: 1 });
            }
        }
        for (const route of geometry.routes) {
            const item = connectionById.get(route.id), record = interactive(route.id, 'connection', item), group = record.group;
            const selected = selection.has(route.id) || item.memberRelationIds?.includes(current.selectedRelationId)
                || item.bits?.some(id => highlight.has(id));
            group.setAttribute('class', `connection ${item.style}${item.kind === 'constant-connection' ? ' constant' : ''}${selected ? ' selected' : ''}`);
            group.setAttribute('aria-label', `${item.style === 'semantic' ? 'BSV relation' : 'RTL net'}: ${item.label}, inspect`);
            group.setAttribute('aria-pressed', String(selection.has(route.id)));
            text(group.querySelector('title'), '');
            group.dataset.connectionId = item.id;
            group.dataset.canonicalBits = JSON.stringify(item.bits || []);
            group.querySelector('.route').setAttribute('d', route.path);
            group.querySelector('.hit-route').setAttribute('d', route.path);
            const junctions = group.querySelector('.junctions');
            junctions.replaceChildren();
            for (const junction of route.junctions) svgElement('circle', { class: 'junction', cx: junction.x, cy: junction.y, r: 2.4 }, junctions);
            const label = group.querySelector('.connection-label');
            label.setAttribute('x', route.labelX); label.setAttribute('y', route.labelY);
            label.setAttribute('text-anchor', route.labelAnchor);
            text(label, shortened(`${route.unconnected ? 'No contacts: ' : ''}${item.label}`, Math.max(240, newShell.width - 70)));
            if (expanding) {
                const origin = withinOldShell({ x: 0, y: 0 });
                beginAnimation(group, { transform: `matrix(${oldShell.width / (newShell.width * view.scale)},0,0,${oldShell.height / (newShell.height * view.scale)},${origin.x},${origin.y})`, opacity: 0 },
                    { transform: 'matrix(1,0,0,1,0,0)', opacity: 1 });
            }
        }
        for (const [id, record] of records) if (!record.active) {
            record.group.dataset.active = 'false';
            record.group.setAttribute('tabindex', '-1');
            record.group.classList.add('leaving');
            if (expanding) beginAnimation(record.group, { opacity: 0.5 }, { opacity: 0 });
            else { record.group.remove(); records.delete(id); }
        }
        drawLabels(geometry);
        applyReadability();
        applyAnalysisHighlights();
        header(next);
        if (reason !== 'patch') rootInspector(scene, current);
        emit('commit', { current, reason });
        if (expanding) {
            transition = { fromOwner: oldScene.ownerInstanceId, toOwner: current.ownerInstanceId,
                shellId: scene.shell.id, duration: 320, reducedMotion: false, before, frames: [] };
            const started = performance.now();
            const frame = timestamp => {
                if (token !== transitionToken || !transition) return;
                const evidence = { progress: Math.max(0, Math.min(1, (timestamp - started) / 320)), ...runtime() };
                transition.frames.push(evidence);
                emit('transition-frame', evidence);
                if (evidence.progress < 1) requestAnimationFrame(frame);
            };
            requestAnimationFrame(frame);
            Promise.allSettled(animations.map(animation => animation.finished)).then(() => {
                if (token !== transitionToken) return;
                for (const [id, record] of records) if (!record.active) { record.group.remove(); records.delete(id); }
                requestAnimationFrame(() => settle(token));
            });
        } else {
            if (changedPlace) lastTransition = { fromOwner: oldScene.ownerInstanceId, toOwner: current.ownerInstanceId,
                shellId: scene.shell.id, reducedMotion: reducedMotion.matches, duration: 0, before, frames: [{ progress: 1, ...runtime() }] };
            requestAnimationFrame(() => settle(token));
        }

        function withinOldShell(point) {
            return { x: (oldShell.x - view.x) / view.scale + (point.x - newShell.x) * oldShell.width / (newShell.width * view.scale),
                y: (oldShell.y - view.y) / view.scale + (point.y - newShell.y) * oldShell.height / (newShell.height * view.scale) };
        }
        function animateBox(record, box, old) {
            if (!expanding) return;
            const from = old ? { x: (old.x - view.x) / view.scale, y: (old.y - view.y) / view.scale,
                scaleX: old.width / (box.width * view.scale), scaleY: old.height / (box.height * view.scale) }
                : { ...withinOldShell(box), scaleX: oldShell.width / (newShell.width * view.scale),
                    scaleY: oldShell.height / (newShell.height * view.scale) };
            beginAnimation(record.group,
                { transform: `matrix(${from.scaleX},0,0,${from.scaleY},${from.x},${from.y})`, opacity: old ? 1 : 0 },
                { transform: `matrix(1,0,0,1,${box.x},${box.y})`, opacity: 1 });
        }
    }
    function patchInspector(changes) {
        const current = navigation.getState().current;
        return navigation.patchCurrent({ disclosureState: { ...current.disclosureState,
            inspector: { ...current.disclosureState.inspector, ...changes } } });
    }
    function patchAnalysis(changes, repaint = true) {
        const current = navigation.getState().current;
        navigation.patchCurrent({ disclosureState: { ...current.disclosureState,
            analysis: { ...current.disclosureState.analysis, ...changes } } });
        if (repaint) rootInspector(rendered.scene, navigation.getState().current);
    }
    function revealAnalysis(ref) {
        return navigation.revealAnalysis(ref);
    }
    function sourceSelectionKey(visit) {
        return JSON.stringify([BsvHardwareNavigation.visitKey(visit),
            visit.selectedEntityId, visit.selectedRelationId,
            visit.disclosureState.analysis?.codeSelection,
            visit.disclosureState.analysis?.sourceMode]);
    }
    async function openSource(ref) {
        sourceRequest?.controller.abort();
        const current = navigation.getState(), controller = new AbortController();
        const active = { controller, selectionKey: sourceSelectionKey(current.current), referenceId: ref.id };
        sourceRequest = active;
        const feedback = $('analysis-feedback');
        if (feedback) { text(feedback, 'Opening approved source; previous source retained'); feedback.setAttribute('aria-busy', 'true'); }
        emit('source', { status: 'pending', referenceId: ref.id });
        try {
            const body = await request('source', { buildId: current.current.buildId, reference: ref }, { signal: controller.signal });
            if (sourceRequest !== active || controller.signal.aborted) return false;
            if (body.id !== ref.id || body.revision !== ref.revision || body.pathRef !== ref.pathRef
                || body.range?.start !== ref.range.start || body.range?.end !== ref.range.end
                || body.sliceHash !== ref.sliceHash || body.readOnly !== true) throw new Error('Approved source response identity mismatch');
            patchAnalysis({ source: { referenceId: ref.id, result: body }, codeOpen: true });
            if (nativeTransport) {
                const opened = await request('source-open', { buildId: current.current.buildId, reference: ref }, { signal: controller.signal });
                if (sourceRequest !== active || controller.signal.aborted) return false;
                emit('source-editor', opened);
            }
            sourceRequest = null;
            emit('source', { status: 'complete', referenceId: ref.id });
            return true;
        } catch (error) {
            if (sourceRequest !== active || controller.signal.aborted) return false;
            sourceRequest = null;
            patchAnalysis({ source: { ...navigation.getState().current.disclosureState.analysis?.source,
                error: error.message, referenceId: ref.id }, codeOpen: true });
            emit('source', { status: 'error', referenceId: ref.id, error: error.message });
            return false;
        }
    }
    function openImplementation() {
        const current = navigation.getState().current, analysis = current.analysis;
        if (!rendered.scene.inspector.implementationAction) return false;
        const seed = BsvHardwareAnalysis.isSourceResult(analysis?.result) ? analysis.result.seed : null;
        return navigation.navigate({ ...rendered.scene.inspector.implementationAction,
            sceneKind: 'rtl', implementationProvider: 'instrumented',
            selectedEntityId: seed?.domain === 'source' ? seed.entityId : current.selectedEntityId,
            selectedRelationId: null }, { reason: 'implementation' });
    }
    function rootInspector(scene, current) {
        BsvHardwareInspector.render(scene, current, {
            native: !!nativeTransport,
            analysisContext: analysisContexts.get(`${current.buildId}:${current.implementationContext?.provider || current.provider}`),
            analysisProjection: analysisProjection(),
            analyze: input => navigation.analyze(input),
            revealAnalysis, patchAnalysis, openSource, openImplementation,
            enter: id => {
                const item = [scene.shell, ...scene.children].find(node => node.id === id);
                return item ? activate(item, 'node') : false;
            },
            codeScroll: (id, scroll) => patchAnalysis({ codeScroll: {
                ...navigation.getState().current.disclosureState.analysis?.codeScroll, [id]: scroll } }, false),
            sourceOwner: (ownerInstanceId, entityId) => navigation.navigate({ sceneKind: 'bsv', implementationProvider: 'stock',
                rootInstanceId: ownerInstanceId, ownerInstanceId, selectedEntityId: entityId, selectedRelationId: null,
                sourceContext: null, implementationContext: null }, { reason: 'source-context' }),
            analysisDisclosure: (id, open) => patchAnalysis({ disclosures: {
                ...navigation.getState().current.disclosureState.analysis?.disclosures, [id]: open } }, false),
            select: (id, relation) => navigation.select(id, { relation }),
            toggleDetail: id => {
                const visit = navigation.getState().current;
                navigation.navigate({ viewport: visit.viewport,
                    disclosureState: { ...visit.disclosureState, [id]: !visit.disclosureState[id] } },
                { recordHistory: false, reason: 'detail' });
            },
            disclose: (id, open, ref) => {
                const visit = navigation.getState().current;
                if (nativeTransport) return patchAnalysis({ disclosures: {
                    ...visit.disclosureState.analysis?.disclosures, [id]: open } }, false);
                navigation.patchCurrent({ disclosureState: { ...visit.disclosureState, [id]: open,
                    ...(ref ? { inspector: { ...visit.disclosureState.inspector,
                        source: { ...visit.disclosureState.inspector?.source, referenceId: ref.id, open } } } : {}) } });
            }
        });
        const panel = $('capability-panel');
        panel.open = !!current.disclosureState.capabilities;
    }
    function header(next) {
        const { current, scene } = next;
        text($('scene-title'), scene.header.title);
        text($('scene-path'), scene.header.subtitle);
        $('scene-path').title = scene.header.subtitle;
        text($('provider-status'), nativeTransport && scene.snapshotId === null ? t('BSV source analysis')
            : `${scene.header.buildLabel} | ${scene.header.provider} | ${scene.correspondence.origin.available ? 'Instrumented partial origin available' : 'Origin provider not present'}`);
        if (nativeTransport) {
            $('native-source-only').hidden = scene.snapshotId !== null;
            $('rtl').hidden = scene.sceneKind === 'rtl' || !scene.inspector.implementationAction;
        }
        const trail = document.createDocumentFragment();
        scene.breadcrumb.forEach((entry, index) => {
            if (index) { const separator = document.createElement('span'); separator.className = 'separator'; separator.textContent = '/'; trail.append(separator); }
            const button = document.createElement('button');
            button.textContent = entry.label;
            button.dataset.ownerId = entry.id;
            if (entry.id === scene.shell.id) button.setAttribute('aria-current', 'location');
            button.addEventListener('click', () => navigation.breadcrumb(entry.id));
            trail.append(button);
        });
        $('breadcrumb').setAttribute('aria-label', current.sceneKind === 'rtl' ? 'Actual RTL occurrence path' : 'BSV occurrence path');
        const sourceTrail = document.createDocumentFragment();
        if (current.sceneKind === 'rtl') {
            for (const entry of scene.sourceBreadcrumb) {
                const button = document.createElement('button');
                button.textContent = entry.label;
                button.dataset.sourceOwnerId = entry.id;
                button.addEventListener('click', () => navigation.returnBsv(entry.id));
                sourceTrail.append(button);
            }
        }
        $('source-breadcrumb').replaceChildren(sourceTrail);
        $('source-breadcrumb').hidden = current.sceneKind !== 'rtl';
        $('return-bsv').hidden = current.sceneKind !== 'rtl' || !scene.sourceBreadcrumb.length;
        $('breadcrumb').replaceChildren(trail);
        syncBuildSelection(current);
        $('rtl').disabled = current.sceneKind === 'rtl' || !scene.inspector.implementationAction;
        const origin = scene.inspector.implementationAction?.implementationProvider;
        const providers = catalog.find(build => build.buildId === current.buildId)?.implementationProviders || [];
        const preferred = current.disclosureState.presentation?.preferredImplementationProvider;
        $('provider-select').value = current.sceneKind === 'rtl' ? current.provider
            : providers.includes(preferred) ? preferred : origin || 'stock';
        for (const option of $('provider-select').options) option.disabled = !providers.includes(option.value);
    }
    function onStatus(next) {
        nativePublication?.cancelScheduled();
        // Inspector scroll/disclosure patches advance navigation generation,
        // but do not change the source being opened.
        if (sourceRequest && (!next.current || next.pending || sourceRequest.selectionKey !== sourceSelectionKey(next.current))) {
            const referenceId = sourceRequest.referenceId;
            sourceRequest.controller.abort(); sourceRequest = null;
            emit('source', { status: 'cancelled', referenceId });
        }
        $('canvas').setAttribute('aria-busy', String(next.pending));
        syncBuildSelection(next.current);
        $('build-select').setAttribute('aria-busy', String(next.pending && next.operation?.reason === 'build'));
        if (nativeTransport && next.current) $('native-empty').hidden = true;
        $('up').disabled = !next.scene || next.current.sceneKind === 'bsv'
            && next.scene.breadcrumb.findIndex(entry => entry.id === next.current.ownerInstanceId) <= 0;
        $('up').title = next.current?.sceneKind === 'rtl' ? 'Actual RTL hierarchy parent' : 'Actual BSV hierarchy parent';
        const message = $('canvas-message');
        message.hidden = !!next.current || !!nativeTransport && !next.pending && !next.error;
        message.classList.toggle('error', !!next.error);
        const target = next.operation?.target;
        const requestedName = target?.label || (target?.buildId && target.buildId !== next.current?.buildId
            ? catalog.find(build => build.buildId === target.buildId)?.label || target.buildId
            : [next.scene?.shell, ...(next.scene?.children || [])].find(item => item?.id === target?.ownerInstanceId)?.label
                || next.scene?.shell.label || t('Select a design'));
        const userError = nativeTransport && next.error ? next.operation?.reason === 'publication' && !target
            ? t('Source changed. This is the captured previous structure; refresh to analyse saved changes.') : t(next.current
            ? 'Could not open {name}. Still showing {current}.' : 'Could not open {name}.',
        { name: requestedName, current: next.scene?.shell.label || '' }) : next.error?.message;
        const pendingMessage = nativeTransport && next.operation?.kind === 'scene'
            ? t('Opening {name}...', { name: requestedName }) : 'Pending query; current hardware and previous result retained. Back cancels.';
        const navigationFeedback = $('navigation-feedback');
        if (navigationFeedback) {
            const deferred = next.geometry?.routing?.deferred || [];
            $('unrouted-connections').hidden = !deferred.length;
            const unresolved = document.createDocumentFragment();
            for (const item of deferred) {
                const button = document.createElement('button'); button.dataset.unroutedId = item.connectionId;
                button.textContent = connectionCaption(item.connectionId);
                button.addEventListener('click', () => navigation.select(item.connectionId, { relation: true }));
                unresolved.append(button);
            }
            $('unrouted-list').replaceChildren(unresolved);
            navigationFeedback.hidden = !next.error && !next.pending && !deferred.length;
            text($('navigation-message'), next.error ? userError : next.pending ? pendingMessage
                : t('Some connections could not be placed. Module structure and source analysis remain available.'));
            $('retry-navigation').hidden = !next.error && !deferred.length;
            $('retry-navigation').disabled = next.pending;
            $('navigation-problem').hidden = !next.error && !deferred.length;
            text($('navigation-diagnostic'), JSON.stringify({ error: next.error, outcome: next.outcome,
                operation: next.operation || null, committed: next.current && { buildId: next.current.buildId,
                    ownerInstanceId: next.current.ownerInstanceId, sourceRevision: next.current.sourceRevision }, deferred }, null, 2));
        }
        const feedback = $('analysis-feedback');
        if (feedback) {
            text(feedback, next.error ? nativeTransport ? userError : `${next.outcome?.status || 'Error'}: ${next.error.message}; previous result retained`
                : next.pending ? pendingMessage
                : next.outcome?.status === 'cancelled' ? 'Cancelled; previous result retained'
                : next.outcome?.status === 'blocked' ? next.outcome.message : '');
            feedback.classList.toggle('error', !!next.error);
            feedback.setAttribute('aria-busy', String(next.pending));
        }
        text($('status'), next.error ? userError : next.pending ? pendingMessage
            : next.outcome?.status === 'blocked' ? next.outcome.message
            : nativeTransport && ['limited', 'history-full'].includes(nativeSelectionRequired?.status)
                ? nativeSelectionStatus({ ...nativeSelectionRequired, current: next.scene?.shell.label || '' }, t)
            : next.scene ? nativeTransport && nativeDiscovery && next.scene.snapshotId === null
                ? nativeSourceStatus(nativeDiscovery, t)
                : `${next.scene.children.length + next.scene.storages.length} internal blocks | ${next.scene.connections.length} ${next.current.sceneKind === 'bsv' ? 'BSV summaries' : 'RTL vectors'}`
                : nativeTransport ? nativeSelectionRequired ? nativeSelectionStatus(nativeSelectionRequired, t) : t(nativeDiscovery?.status === 'no-module'
                    ? 'BSV files were found, but no hardware module roots are available.'
                    : nativeDiscovery?.status === 'no-bsv' ? 'No BSV files found' : 'Finding BSV sources in this workspace...') : 'Reading captured build');
        if (!next.current && next.error) text(message, userError);
        emit('status', { current: next.current, pending: next.pending, error: next.error, outcome: next.outcome });
        if (nativeTransport && next.current && !next.pending && !next.error) {
            ensureAnalysisContexts(next.current.buildId);
            nativeTransport.setSnapshot(next.current.snapshotId);
            nativePublication?.publish(persistableState());
        }
        const historyPending = nativeHistoryPending(pendingCatalog, nativePublication);
        $('back').disabled = historyPending || !next.history.back.length && !next.pending;
        $('forward').disabled = historyPending || !next.history.forward.length;
        $('build-select').disabled = historyPending;
        if (nativeTransport) for (const button of document.querySelectorAll('[data-native-action]'))
            button.disabled = button.dataset.nativeBusy === 'true' || historyPending && nativeInputAction(button.dataset.nativeAction);
        if (historyPending) text($('status'), t('Finishing the new design history...'));
    }
    navigation = BsvHardwareNavigation.createNavigation({
        canStartIntent: () => !nativeHistoryPending(pendingCatalog, nativePublication),
        getSize: size, layoutScene: BsvHardwareLayout.layout, fitViewport: BsvHardwareLayout.fitViewport,
        queryScene: async (intent, { signal }) => {
            return request('scene', { buildId: intent.buildId, intent }, { signal });
        },
        queryAnalysis: async (query, { signal }) => {
            const buildId = navigation.getState().current.buildId;
            return request('analysis', { buildId, query }, { signal });
        },
        resolveAnalysisTarget: async (query, { signal }) => {
            return request('analysis-reveal', { buildId: query.buildId, query }, { signal });
        },
        onCommit: draw, onStatus
    });
    if (nativeTransport) nativePublication = createNativePublication({ navigation, generation: () => nativeGeneration,
        send: payload => request('persist', payload), saveState: state => nativeTransport.saveState(state),
        capture: captureNativeCatalog, restore: applyNativeCatalog,
        onAccepted: metadata => { applyNativeCatalog(metadata); onStatus(navigation.getState()); },
        onError: (error, metadata) => {
            if (navigation.getState().error && metadata?.status?.newHistory)
                nativeSelectionRequired = { status: 'history-retry', entryId: metadata.status.selectedDesignId };
            if (!navigation.getState().error) nativeStatus({ message: t(error.message) });
            emit('native-publication', { status: error.code === 'COMMITTED_UNSAVED' ? 'committed-unsaved' : 'rejected', code: error.code, message: error.message });
        }, onSettled: () => { flushDiscovery(); emit('settled', state()); } });
    window.bsvHardware = {
        getState: state,
        serializeSceneSvg,
        setCatalog, revealNative, persistableState,
        whenSettled() {
            if (!navigation.getState().pending && !transition && !nativePublication?.pending()) return Promise.resolve(state());
            return new Promise(resolve => {
                const check = () => {
                    if (navigation.getState().pending || transition || nativePublication?.pending()) return;
                    window.removeEventListener('hardware:settled', check);
                    window.removeEventListener('hardware:status', check);
                    resolve(state());
                };
                window.addEventListener('hardware:settled', check);
                window.addEventListener('hardware:status', check);
            });
        }
    };
    $('back').addEventListener('click', () => { designRequest?.abort(); navigation.back(); });
    $('retry-navigation')?.addEventListener('click', () => {
        const state = navigation.getState();
        if (nativeTransport && state.operation?.reason === 'publication' && state.outcome?.code === 'STALE_SOURCE')
            request('refresh-input').catch(error => nativeStatus({ message: error.message }));
        else if (nativeTransport && state.operation?.reason === 'publication' && nativeSelectionRequired?.status === 'history-retry')
            chooseDesign(nativeSelectionRequired.entryId, { newHistory: true });
        else if (state.error) navigation.retry();
        else if (state.current) navigation.navigate({ viewport: state.current.viewport },
            { recordHistory: false, reason: 'retry-layout' });
    });
    $('copy-diagnostics')?.addEventListener('click', async () => {
        try {
            await request('copy-diagnostics', { viewDiagnostic: $('navigation-diagnostic').textContent.slice(0, 12000) });
            nativeStatus({ message: t('Diagnostics copied') });
        } catch (error) { nativeStatus({ message: error.message }); }
    });
    $('forward').addEventListener('click', () => navigation.forward());
    $('up').addEventListener('click', () => navigation.up());
    $('return-bsv').addEventListener('click', () => navigation.returnBsv());
    $('provider-select').addEventListener('change', event => {
        const current = navigation.getState().current;
        if (current?.sceneKind === 'rtl') {
            navigation.navigate({ implementationProvider: event.target.value }, { reason: 'provider' });
        } else if (current) {
            navigation.patchCurrent({ disclosureState: { ...current.disclosureState,
                presentation: { ...current.disclosureState.presentation, preferredImplementationProvider: event.target.value } } });
        }
    });
    $('clear-selection').addEventListener('click', () => navigation.select(null));
    $('fit').addEventListener('click', () => {
        const current = navigation.getState();
        if (current.geometry) navigation.setViewport(BsvHardwareLayout.fitViewport(current.geometry, size()), { fit: 'structure' });
    });
    $('fit-selection').addEventListener('click', () => {
        if (!rendered) return;
        const fit = BsvHardwareReadability.fitSelection({ ...rendered, canvas: size(), projection: analysisProjection() });
        if (fit) navigation.setViewport(fit.viewport, { fit: 'selection', selectionIds: fit.ids });
    });
    $('toggle-inspector').addEventListener('click', () => {
        const current = navigation.getState().current;
        if (current) navigation.patchCurrent({ disclosureState: { ...current.disclosureState,
            presentation: { ...current.disclosureState.presentation, inspectorOpen: current.disclosureState.presentation?.inspectorOpen === false } } });
    });
    $('export-svg').addEventListener('click', async () => {
        await window.bsvHardware.whenSettled();
        if (!rendered) return;
        if (nativeTransport) {
            try { await request('export-svg', { svg: serializeSceneSvg(), suggestedName: 'hardware-schematic.svg' });
                emit('export', { snapshotId: rendered.scene.snapshotId, bounds: rendered.geometry.bounds }); }
            catch (error) { nativeStatus({ message: error.message }); }
            return;
        }
        const link = document.createElement('a');
        const url = URL.createObjectURL(new Blob([serializeSceneSvg()], { type: 'image/svg+xml;charset=utf-8' }));
        link.href = url;
        link.download = `bsv-lens-${rendered.scene.sceneKind}.svg`;
        link.click();
        URL.revokeObjectURL(url);
        emit('export', { snapshotId: rendered.scene.snapshotId, bounds: rendered.geometry.bounds });
    });
    $('rtl').addEventListener('click', () => {
        const current = navigation.getState().current;
        if (!current || current.sceneKind === 'rtl') return;
        navigation.navigate({ ...rendered.scene.inspector.implementationAction,
            sceneKind: 'rtl', implementationProvider: $('provider-select').value,
            selectedEntityId: current.selectedEntityId, selectedRelationId: current.selectedRelationId }, { reason: 'implementation' });
    });
    $('theme-select').addEventListener('change', event => {
        document.documentElement.dataset.theme = event.target.value;
        fontCache.clear(); applyReadability();
        emit('theme', { theme: event.target.value });
    });
    $('capability-panel').addEventListener('toggle', () => {
        const current = navigation.getState().current;
        if (current && !!current.disclosureState.capabilities !== $('capability-panel').open) {
            navigation.patchCurrent({ disclosureState: { ...current.disclosureState, capabilities: $('capability-panel').open } });
        }
    });
    $('inspector').addEventListener('scroll', () => {
        const state = navigation.getState(), current = state.current;
        if (!current || state.pending) return;
        const key = $('inspector-content').dataset.inspectorKey, scrollTop = $('inspector').scrollTop;
        if (current.disclosureState.inspector?.key !== key || current.disclosureState.inspector?.scrollTop !== scrollTop) {
            patchInspector({ key, scrollTop });
        }
    });
    $('build-select').addEventListener('change', event => {
        if (nativeHistoryPending(pendingCatalog, nativePublication)) { syncBuildSelection(navigation.getState().current); return; }
        const value = event.target.value;
        if (value.startsWith('design:')) chooseDesign(value.slice(7));
        else loadBuild(value);
    });
    window.addEventListener('keydown', event => {
        if (event.key === 'Escape') {
            event.preventDefault();
            if (!$('wire-choices').hidden) closeWireChoices();
            else navigation.select(null);
        }
        if (event.altKey && event.key === 'ArrowLeft') { event.preventDefault(); navigation.back(); }
        if (event.altKey && event.key === 'ArrowRight') { event.preventDefault(); navigation.forward(); }
    });
    svg.addEventListener('wheel', event => {
        event.preventDefault();
        const current = navigation.getState().current;
        if (!current) return;
        const bounds = svg.getBoundingClientRect(), px = event.clientX - bounds.left, py = event.clientY - bounds.top;
        const old = current.viewport, scale = Math.max(0.08, Math.min(4, old.scale * Math.exp(-event.deltaY * 0.0015)));
        navigation.setViewport({ scale, x: px - (px - old.x) * scale / old.scale, y: py - (py - old.y) * scale / old.scale }, { fit: 'manual' });
    }, { passive: false });
    svg.addEventListener('click', event => {
        if (event.target !== svg || suppressClick || event.detail > 1 || !rendered) return;
        const body = records.get(rendered.scene.shell.id).group.querySelector('.body').getBoundingClientRect();
        if (event.clientX >= body.left && event.clientX <= body.right && event.clientY >= body.top && event.clientY <= body.bottom) {
            navigation.select(rendered.scene.shell.id);
        }
    });
    svg.addEventListener('pointerdown', event => {
        if (event.button !== 0 || !navigation.getState().current) return;
        suppressClick = false;
        gesture = { x: event.clientX, y: event.clientY, viewport: navigation.getState().current.viewport, dragged: false };
    });
    svg.addEventListener('pointermove', event => {
        if (!gesture?.dragged && rendered) {
            const group = event.target.closest('.connection');
            const record = group && records.get(group.dataset.semanticId);
            clearWireHover();
            if (record?.active) {
                const candidates = wireCandidates(event, record);
                hoveredRoutes = candidates.map(candidate => candidate.id);
                for (const id of hoveredRoutes) records.get(id).group.classList.add('hovered');
                const tooltip = $('wire-tooltip'), bounds = $('canvas').getBoundingClientRect();
                tooltip.textContent = candidates.length > 1 ? `${candidates.length} connections; click to choose`
                    : candidates.length ? connectionCaption(candidates[0].id) : '';
                tooltip.hidden = !candidates.length;
                tooltip.style.left = `${Math.max(8, Math.min(event.clientX - bounds.left + 12, bounds.width - tooltip.offsetWidth - 8))}px`;
                tooltip.style.top = `${Math.max(8, Math.min(event.clientY - bounds.top + 12, bounds.height - tooltip.offsetHeight - 8))}px`;
            }
        }
        if (!gesture) return;
        const dx = event.clientX - gesture.x, dy = event.clientY - gesture.y;
        if (!gesture.dragged && Math.hypot(dx, dy) < 4) return;
        gesture.dragged = true; suppressClick = true;
        svg.setPointerCapture(event.pointerId);
        svg.classList.add('panning');
        navigation.setViewport({ ...gesture.viewport, x: gesture.viewport.x + dx, y: gesture.viewport.y + dy }, { fit: 'manual' });
    });
    const endGesture = event => {
        if (svg.hasPointerCapture(event.pointerId)) svg.releasePointerCapture(event.pointerId);
        gesture = null; svg.classList.remove('panning');
    };
    svg.addEventListener('pointerup', endGesture);
    svg.addEventListener('pointercancel', endGesture);
    svg.addEventListener('pointerleave', clearWireHover);
    new ResizeObserver(() => {
        if (rendered && size().width > 0 && size().height > 0) navigation.resize();
    }).observe(svg);
    document.fonts.addEventListener('loadingdone', () => { fontCache.clear(); applyReadability(); });
    async function loadBuild(buildId, { refresh = false, refreshIntent, refreshTarget } = {}) {
        const build = catalog.find(item => item.buildId === buildId);
        if (!build) return;
        if (nativeTransport && !build.rootInstanceId) {
            nativeStatus({ message: 'Select a source root before opening its structure.' }); return;
        }
        const previous = navigation.getState().current;
        const refreshed = refresh && refreshIntent ? Object.fromEntries(['sceneKind', 'rootInstanceId', 'ownerInstanceId',
            'selectedEntityId', 'selectedRelationId', 'activePanel'].filter(key => refreshIntent[key] !== undefined)
            .map(key => [key, refreshIntent[key]])) : {};
        const preserveViewport = refresh && previous && (refreshTarget ? refreshTarget.preserveViewport
            && refreshed.ownerInstanceId === previous.ownerInstanceId : previous.ownerInstanceId === build.rootInstanceId);
        return navigation.navigate({ buildId, snapshotId: build.snapshotId, implementationProvider: 'stock',
            sceneKind: build.sceneKind || 'bsv', rootInstanceId: build.rootInstanceId,
            ownerInstanceId: build.sceneKind === 'rtl' ? build.ownerInstanceId ?? null : build.rootInstanceId,
            selectedEntityId: null, selectedRelationId: null, disclosureState: {}, sourceContext: null,
            implementationContext: null, ...refreshed, ...(preserveViewport
                ? { viewport: previous.viewport, disclosureState: persistableState().view.disclosureState } : {}) },
        { reason: refresh ? 'refresh' : 'build', recordHistory: !refresh, replaceHistory: refresh && !nativeTransport });
    }
    function ensureAnalysisContexts(buildId) {
        const build = catalog.find(item => item.buildId === buildId), generation = catalogGeneration;
        if (!build) return;
        for (const provider of build.implementationProviders) {
            const key = `${buildId}:${provider}`;
            if (analysisContexts.has(key) || pendingAnalysisContexts.has(key)) continue;
            pendingAnalysisContexts.add(key);
            request('analysis-context', { buildId, provider }).then(value => {
                if (generation === catalogGeneration) analysisContexts.set(key, value);
            }).catch(error => {
                if (generation === catalogGeneration) analysisContexts.set(key, { error: error.message });
            }).finally(() => {
                pendingAnalysisContexts.delete(key);
                const state = navigation.getState();
                if (generation === catalogGeneration && state.current?.buildId === buildId && !state.pending)
                    rootInspector(state.scene, state.current);
            });
        }
    }
    function captureNativeCatalog() {
        const current = navigation?.getState().current;
        const options = nativeStatusOverlay.resolve(current ? inputStatusForBuild.get(current.buildId) || committedNativeStatus
            : pendingCatalog?.options || committedNativeStatus);
        const refreshed = pendingCatalog?.options.replaceMode === 'refresh'
            && (!current || pendingCatalog.items.some(item => item.buildId === current.buildId));
        const visible = refreshed ? pendingCatalog.items : catalog;
        return { catalog: structuredClone(visible), sourceDesigns: structuredClone(options?.designs || sourceDesigns),
            designForBuild: [...designForBuild], statuses: [...inputStatusForBuild].filter(([id]) => visible.some(item => item.buildId === id)),
            historyBuildIds: refreshed ? pendingCatalog.options.newHistory ? [] : visible.map(item => item.buildId) : null,
            status: structuredClone(options || null) };
    }
    function applyNativeCatalog(saved) {
        if (!saved) return;
        catalog = saved.catalog; sourceDesigns = saved.sourceDesigns;
        designForBuild.clear(); saved.designForBuild.forEach(([id, value]) => designForBuild.set(id, value));
        inputStatusForBuild.clear(); saved.statuses.forEach(([id, value]) => inputStatusForBuild.set(id, nativeStatusOverlay.resolve(value)));
        pendingCatalog = null; committedNativeStatus = nativeCommittedStatus(nativeStatusOverlay.resolve(saved.status), t); nativeDiscovery = committedNativeStatus?.discovery || null;
        nativeStatusOverlay.retain([...inputStatusForBuild.values(), committedNativeStatus]
            .map(value => value?.inputIdentity || value?.summary?.inputIdentity).filter(Boolean), catalog.map(item => item.buildId));
        renderCatalogOptions();
        if (committedNativeStatus) nativeStatus(committedNativeStatus);
        nativeTransport.setSnapshot(navigation.getState().current?.snapshotId ?? null);
        if (pendingNativeInitialFit && navigation.getState().current?.buildId === pendingNativeInitialFit.buildId) {
            const target = pendingNativeInitialFit; pendingNativeInitialFit = null;
            $('native-empty').hidden = true;
            fitNativeInitialViewport(navigation, target, size, BsvHardwareLayout.fitViewport);
        }
    }
    function renderCatalogOptions() {
        $('build-select').replaceChildren();
        if (nativeTransport) {
            const option = document.createElement('option'); option.value = '';
            const sourceStatus = pendingCatalog?.options.discovery?.status || nativeDiscovery?.status;
            option.textContent = catalog.length || nativeSelectionRequired ? t('Select a design')
                : t(sourceStatus === 'no-module' ? 'BSV source analysis' : sourceStatus === 'no-bsv' ? 'No BSV files found' : 'Select a design');
            $('build-select').append(option);
        }
        for (const entry of sourceDesigns) {
            const option = document.createElement('option'); option.value = `design:${entry.id}`;
            option.textContent = entry.label || entry.name; option.title = entry.pathRef;
            $('build-select').append(option);
        }
        for (const build of catalog.filter(item => !sourceDesigns.some(entry => entry.id === designForBuild.get(item.buildId)))) {
            const option = document.createElement('option');
            option.value = build.buildId; option.textContent = build.label; $('build-select').append(option);
        }
        syncBuildSelection(navigation.getState().current);
    }
    async function setCatalog(items, selectedBuildId = null, options = {}) {
        const generation = ++catalogGeneration;
        if (nativeTransport) { nativeSelectionRequired = null; $('native-select-design').hidden = true; $('native-history-recovery').hidden = true; }
        pendingNativeInitialFit = null;
        const previous = navigation.getState().current;
        const refresh = options.replaceMode === 'refresh' && !!previous;
        const design = ['design', 'artifact'].includes(options.replaceMode) && !!previous;
        const authorityGeneration = nativeTransport?.identity()?.generation;
        if (nativeTransport && authorityGeneration !== nativeGeneration) {
            nativeGeneration = authorityGeneration;
            if (selectedBuildId) $('native-inputs').open = false;
            if (!refresh && !design) {
                analysisContexts.clear(); navigation.reset(); nativeTransport.setSnapshot(null);
                nativeTransport.saveState({ schema: 1, view: null });
                designForBuild.clear(); inputStatusForBuild.clear(); catalog = []; sourceDesigns = [];
                nativeDiscovery = null; committedNativeStatus = null; pendingCatalog = null;
                nativeStatusOverlay.clear();
            }
            nativePublication.reset({ retain: refresh || design });
        }
        if (nativeTransport) {
            nativeStatusOverlay.observe(options);
            options = nativeStatusOverlay.resolve(options);
            pendingCatalog = { items, options };
            for (const item of items) inputStatusForBuild.set(item.buildId, options);
        }
        if (options.designs) sourceDesigns = options.designs;
        if (options.selectedDesignId) for (const item of items) designForBuild.set(item.buildId, options.selectedDesignId);
        const retained = refresh || design ? catalog.filter(build => (design || build.buildId === previous.buildId)
            && !items.some(item => item.buildId === build.buildId)) : [];
        catalog = [...retained, ...items];
        renderCatalogOptions();
        const loadContexts = build => Promise.all(build.implementationProviders.map(async provider => {
            const key = `${build.buildId}:${provider}`;
            try {
                const body = await request('analysis-context', { buildId: build.buildId, provider });
                if (generation !== catalogGeneration) return;
                analysisContexts.set(key, body);
            } catch (error) { if (generation === catalogGeneration) analysisContexts.set(key, { error: error.message }); }
        }));
        if (!nativeTransport) await Promise.all(catalog.map(loadContexts));
        if (generation !== catalogGeneration) return;
        const selected = selectedBuildId || (!nativeTransport && catalog[0]?.buildId);
        if (selected) {
            if (nativeTransport && !options.restoreState?.view && !options.refreshTarget?.preserveViewport)
                pendingNativeInitialFit = { buildId: selected, queryGeneration: navigation.getState().queryGeneration + 1 };
            const committed = await loadBuild(selected, { refresh, refreshIntent: options.refreshIntent, refreshTarget: options.refreshTarget });
            if (!committed && pendingNativeInitialFit?.buildId === selected) pendingNativeInitialFit = null;
            if (!nativeTransport && refresh && committed && generation === catalogGeneration) {
                catalog = items;
                for (const item of retained) $('build-select').querySelector(`option[value="${CSS.escape(item.buildId)}"]`)?.remove();
            }
        } else if (nativeTransport && !items.length) {
            navigation.reset(); nativeTransport.setSnapshot(null);
            if (options.summary?.inputIdentity) await nativePublication.publish({ schema: 1, view: null }, { immediate: true });
        }
        syncBuildSelection(navigation.getState().current);
        if (nativeTransport) $('native-empty').hidden = !!navigation.getState().current;
        return generation === catalogGeneration;
    }
    function syncBuildSelection(current) {
        const designId = current && designForBuild.get(current.buildId);
        const value = designId && sourceDesigns.some(entry => entry.id === designId)
            ? `design:${designId}` : current?.buildId || '';
        if (current && ![...$('build-select').options].some(option => option.value === value)) {
            const option = document.createElement('option'); option.value = value;
            option.textContent = catalog.find(entry => entry.buildId === current.buildId)?.label
                || navigation.getState().scene?.shell.label || current.ownerInstanceId;
            $('build-select').append(option);
        }
        $('build-select').value = value;
    }
    async function chooseDesign(entryId, { newHistory = false } = {}) {
        const entry = sourceDesigns.find(item => item.id === entryId);
        syncBuildSelection(navigation.getState().current);
        if (!entry || nativeHistoryPending(pendingCatalog, nativePublication)) return;
        nativeSelectionRequired = null;
        designRequest?.abort();
        const controller = new AbortController(); designRequest = controller;
        $('build-select').setAttribute('aria-busy', 'true'); $('back').disabled = false;
        nativeStatus({ message: t('Opening {name}...', { name: entry.label || entry.name }) });
        try { await request('choose-design', { entryId, ...(newHistory ? { newHistory: true } : {}) }, { signal: controller.signal }); }
        catch (error) { if (!controller.signal.aborted) nativeStatus({ code: error.code, entryId, message: nativeDesignLimit(error) ? error.message : t('Could not open {name}. Still showing {current}.',
            { name: entry.label || entry.name, current: navigation.getState().scene?.shell.label || '' }) }); }
        finally {
            if (designRequest === controller) {
                designRequest = null;
                $('build-select').setAttribute('aria-busy', String(navigation.getState().pending));
                syncBuildSelection(navigation.getState().current);
            }
        }
    }
    function restoreNativeViewport(view, frame) {
        if (!view.viewport) return null;
        if (!view.viewportSize || !view.viewportAnchor) return { ...view.viewport };
        const after = frame.viewportAnchor, before = view.viewportAnchor, { x, y, scale } = view.viewport;
        return { x: x + (frame.viewportSize.width - view.viewportSize.width) / 2 + (before.x - after.x) * scale,
            y: y + (frame.viewportSize.height - view.viewportSize.height) / 2 + (before.y - after.y) * scale, scale };
    }
    function persistableState() {
        const state = navigation.getState(), current = state.current;
        if (!current) return { schema: 1, view: null };
        const select = (value, keys) => Object.fromEntries(keys.filter(key => value?.[key] !== undefined).map(key => [key, value[key]]));
        const view = select(current, ['buildId', 'snapshotId', 'sourceRevision', 'sceneKind', 'provider', 'rootInstanceId',
            'ownerInstanceId', 'selectedEntityId', 'selectedRelationId', 'viewport', 'activePanel']);
        const frame = navigation.getViewportFrame();
        Object.assign(view, { viewportSize: frame.viewportSize, viewportAnchor: frame.viewportAnchor });
        view.sourceContext = current.sourceContext === null ? null : select(current.sourceContext, ['buildId', 'snapshotId', 'provider', 'rootInstanceId',
            'ownerInstanceId', 'occurrencePath', 'selectedEntityId', 'selectedRelationId']);
        view.implementationContext = select(current.implementationContext, ['snapshotId', 'provider', 'modelId', 'stage',
            'contextOccurrenceId', 'rootOccurrenceId', 'parentOccurrenceId', 'occurrencePath']);
        const disclosure = current.disclosureState;
        view.disclosureState = { capabilities: !!disclosure.capabilities,
            ...(disclosure.presentation ? { presentation: disclosure.presentation } : {}),
            inspector: select(disclosure.inspector, ['key', 'scrollTop']),
            analysis: select(disclosure.analysis, ['codeSelection', 'sourceMode', 'codeOpen', 'codeScroll', 'disclosures']) };
        view.query = current.analysis?.request ? select(current.analysis.request, ['kind', 'analysisId', 'snapshotId',
            'implementationProvider', 'stage', 'ownerInstanceId', 'implementationOccurrenceId', 'seed', 'scope',
            'direction', 'semanticsProfile', 'limits', 'mode']) : null;
        return { schema: 1, view };
    }
    async function revealNative(payload) {
        if (!nativeTransport || !payload.intent) return false;
        const current = navigation.getState().current, intent = payload.intent;
        if (payload.selectionOnly) {
            if (!current || current.buildId !== intent.buildId || current.snapshotId !== intent.snapshotId
                || current.sceneKind !== intent.sceneKind || current.ownerInstanceId !== intent.ownerInstanceId) return false;
            return navigation.select(intent.selectedRelationId || intent.selectedEntityId, { relation: !!intent.selectedRelationId });
        }
        return navigation.navigate(intent, { reason: 'editor-source' });
    }
    function nativeStatus(payload) {
        if (!nativeTransport) return;
        payload = nativeStatusOverlay.resolve(payload);
        const limit = nativeDesignLimit(payload);
        if (limit) {
            const current = navigation.getState();
            const entry = sourceDesigns.find(entry => entry.id === payload.entryId);
            nativeSelectionRequired = { status: payload.message === 'Prepared design history reached its bounded limit. Reopen Hardware Schematic to start a new design history.' ? 'history-full' : 'limited',
                preserved: !!current.current, current: current.scene?.shell.label || '', entryId: entry?.id };
        }
        if (payload.discovery) {
            nativeDiscovery = payload.discovery;
            text($('native-input-status'), nativeSourceStatus(nativeDiscovery, t)
                + (payload.refreshTarget?.message ? ` · ${t(payload.refreshTarget.message)}` : ''));
            text($('native-empty-title'), t(nativeDiscovery.status === 'no-bsv' ? 'No BSV files found'
                : nativeDiscovery.status === 'no-module' ? 'BSV source analysis' : 'Select a design'));
            text($('native-empty-message'), t(nativeDiscovery.status === 'no-module'
                ? 'BSV files were found, but no hardware module roots are available.'
                : nativeDiscovery.status === 'no-bsv'
                    ? 'No BSV files were found inside this workspace. Check source settings or choose source inputs in Settings.'
                : 'Workspace sources are discovered automatically. Select a design when several roots are found.'));
            text($('native-empty-detail'), t('Source analysis works without a compiler or RTL result. Additional inputs are available in Settings.'));
            const inventory = $('native-discovery-inventory');
            if (inventory) text(inventory, JSON.stringify(nativeDiscovery, null, 2));
            const current = navigation?.getState();
            if (current?.current && current.scene.snapshotId === null && !current.pending && !current.error)
                text($('status'), nativeSourceStatus(nativeDiscovery, t));
        } else if (!limit) {
            const message = payload.message || payload.inputStatus || t('Select a design');
            text($('native-input-status'), message);
            if (!navigation?.getState().current) text($('status'), message);
        }
        const selection = nativeSelectionRequired;
        const actionable = ['limited', 'history-full'].includes(selection?.status);
        const entry = actionable && sourceDesigns.find(entry => entry.id === selection.entryId);
        $('native-history-recovery').hidden = !entry || selection.status !== 'history-full';
        if (actionable) {
            const current = navigation.getState();
            nativeSelectionRequired = { ...selection, preserved: !!current.current, current: current.scene?.shell.label || '' };
            const message = nativeSelectionStatus(nativeSelectionRequired, t);
            if (entry && selection.status === 'history-full') text($('native-new-history'),
                t('Open {name} in a new history', { name: entry.label || entry.name }));
            if (!current.current) {
                renderCatalogOptions();
                $('native-select-design').hidden = selection.status === 'history-full';
                text($('native-empty-title'), t('Select a design')); text($('native-empty-message'), message);
            }
            text($('native-input-status'), message); text($('status'), message);
        }
        const notice = payload.notice?.message || (['stale', 'dirty-source', 'captured'].includes(payload.status) ? payload.message : null);
        if (notice) $('native-input-status').append(document.createTextNode(` · ${t(notice)}`));
        emit('native-status', payload);
    }
    async function discoverWorkspace() {
        if (nativeHistoryPending(pendingCatalog, nativePublication)) { discoveryAgain = true; return; }
        if (discoveryRequest) { discoveryAgain = true; return discoveryRequest; }
        nativeSelectionRequired = null;
        const requested = navigation.getState().current;
        const requestedStatus = nativeStatusOverlay.resolve(requested ? inputStatusForBuild.get(requested.buildId) : committedNativeStatus);
        const requestedInput = requestedStatus?.inputIdentity || requestedStatus?.summary?.inputIdentity;
        nativeStatus({ message: t('Finding BSV sources in this workspace...') });
        discoveryRequest = request('discover-workspace').then(result => {
            if (result.discovery) {
                nativeStatusOverlay.observe(result, undefined,
                    !requestedInput || requestedInput === result.inputIdentity ? requested?.buildId : undefined);
                const current = navigation.getState().current;
                const currentStatus = nativeStatusOverlay.resolve(current ? inputStatusForBuild.get(current.buildId) : committedNativeStatus);
                if ((currentStatus?.inputIdentity || currentStatus?.summary?.inputIdentity) === result.inputIdentity) nativeStatus(result);
            }
        }).catch(error => nativeStatus({ code: error.code, message: error.message })).finally(() => {
            discoveryRequest = null;
            flushDiscovery();
        });
        return discoveryRequest;
    }
    function flushDiscovery() {
        if (!discoveryAgain || discoveryRequest || nativePublication?.pending()) return;
        discoveryAgain = false; discoverWorkspace();
    }
    function nativeTheme(theme) {
        if (!['dark', 'light', 'high-contrast'].includes(theme)) return;
        document.documentElement.dataset.theme = theme; $('theme-select').value = theme;
        fontCache.clear(); applyReadability();
    }
    async function restoreNativeState(saved, selectedBuildId) {
        if (saved?.schema !== 1 || !saved.view || !selectedBuildId || saved.view.buildId !== selectedBuildId) return;
        const entry = catalog.find(build => build.buildId === selectedBuildId);
        if (!entry) return;
        const { query, sourceRevision, provider, viewport, viewportSize, viewportAnchor, ...intent } = saved.view;
        const viewportRevision = navigation.getViewportFrame().revision;
        let work = navigation.navigate({ ...intent, implementationProvider: provider }, { recordHistory: false, reason: 'restore' });
        let generation = navigation.getState().queryGeneration;
        await work;
        const restored = navigation.getState();
        if (restored.queryGeneration !== generation) return;
        if (!restored.error && restored.current?.buildId === selectedBuildId && query) {
            work = navigation.analyze(query); generation = navigation.getState().queryGeneration; await work;
        }
        const complete = navigation.getState();
        if (complete.queryGeneration !== generation || complete.error || complete.current?.buildId !== selectedBuildId) return;
        if (!navigation.resize(false)) return;
        const frame = navigation.getViewportFrame(), manual = frame.revision !== viewportRevision ? frame.intent : null;
        const restoredViewport = restoreNativeViewport(manual || saved.view, frame);
        if (manual) {
            const sameScope = Object.entries(manual.context).every(([key, value]) => complete.current[key] === value);
            const presentation = sameScope ? { fit: manual.presentation.fit, selectionIds: manual.presentation.selectionIds || [] }
                : { fit: 'manual', selectionIds: [] };
            navigation.setViewport(restoredViewport, presentation);
        } else if (restoredViewport) navigation.setViewport(restoredViewport);
    }
    if (nativeTransport) {
        $('native-new-history').addEventListener('click', async () => {
            const selection = nativeSelectionRequired;
            if (selection?.status !== 'history-full' || !selection.entryId) return;
            const button = $('native-new-history'); button.disabled = true;
            try { await chooseDesign(selection.entryId, { newHistory: true }); }
            finally { button.disabled = false; }
        });
        for (const button of document.querySelectorAll('[data-native-action]')) {
            button.addEventListener('click', async () => {
                button.dataset.nativeBusy = 'true'; button.disabled = true;
                try { await (button.dataset.nativeAction === 'discover-workspace' ? discoverWorkspace() : request(button.dataset.nativeAction)); }
                catch (error) { nativeStatus({ message: error.message }); }
                finally { delete button.dataset.nativeBusy; button.disabled = nativeInputAction(button.dataset.nativeAction) && nativeHistoryPending(pendingCatalog, nativePublication); }
            });
        }
        nativeTransport.subscribe((action, payload) => {
            if (action === 'catalog') {
                nativeStatus({ message: payload.message || t('Select a design') });
                setCatalog(payload.catalog || [], payload.selectedBuildId, payload)
                    .then(active => active && restoreNativeState(payload.restoreState, payload.selectedBuildId))
                    .catch(error => nativeStatus({ message: error.message }));
            } else if (action === 'source-selection') {
                nativeSelectionRequired = payload;
                if (!navigation.getState().current) {
                    renderCatalogOptions();
                    $('native-select-design').hidden = false;
                    text($('native-empty-title'), t('Select a design'));
                    text($('native-empty-message'), nativeSelectionStatus(payload, t));
                }
                nativeStatus({ message: nativeSelectionStatus(payload, t) });
            } else if (action === 'reveal') revealNative(payload).catch(error => nativeStatus({ message: error.message }));
            else if (action === 'discovery-progress') nativeStatus(payload);
            else if (action === 'discovery-invalidated') {
                nativeStatus({ message: t(payload.autoRefresh ? 'Sources changed. Preparing the saved revision...'
                    : 'Sources changed. Refresh to analyze the saved revision.') });
                if (payload.autoRefresh) discoverWorkspace();
            }
            else if (action === 'status') {
                const current = navigation.getState().current, input = current && inputStatusForBuild.get(current.buildId);
                const inputId = input?.inputIdentity || input?.summary?.inputIdentity;
                const committedId = committedNativeStatus?.inputIdentity || committedNativeStatus?.summary?.inputIdentity;
                if (current && inputId === committedId) nativeStatusOverlay.observe(payload, inputId, current.buildId);
                nativeStatus(payload);
            }
            else if (action === 'theme') nativeTheme(payload.theme);
        });
        nativeTransport.ready.then(async welcome => {
            const identity = nativeTransport.identity();
            text($('native-build'), `Build ${identity.buildId} · protocol ${identity.protocol}`);
            nativeStatus(welcome); nativeTheme(welcome.theme);
            $('canvas-message').hidden = true;
            if (await setCatalog(welcome.catalog || [], welcome.selectedBuildId, welcome)) {
                await restoreNativeState(welcome.restoreState, welcome.selectedBuildId);
                if (welcome.discoveryAvailable && !welcome.catalog?.length) await discoverWorkspace();
            }
        }).catch(error => {
            nativeStatus({ message: error.message });
            for (const button of document.querySelectorAll('[data-native-action]')) button.disabled = true;
        });
    } else request('catalog').then(items => setCatalog(items)).catch(error => {
        text($('canvas-message'), error.message); $('canvas-message').classList.add('error');
    });
})();
