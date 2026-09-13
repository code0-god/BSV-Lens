'use strict';

// Browser CSS px throughout. Effective font uses the smallest singular value
// of the complete SVG screen CTM; glyph cells, measured ink metrics and clip
// area are separate observations. No renderer readability/visibility flags.
async function measurePage(page, fixtureScene = null) {
    return page.evaluate(async fixtureScene => {
        await document.fonts.ready;
        const state = window.bsvHardware?.getState();
        if (fixtureScene && state) throw new Error('CANONICAL_SCENE_OVERRIDE_FORBIDDEN');
        const scene = state?.scene || fixtureScene;
        const box = r => ({ x: r.x, y: r.y, width: r.width, height: r.height });
        const area = r => Math.max(0, r.width) * Math.max(0, r.height);
        const overlap = (a, b) => ({ x: Math.max(a.x, b.x), y: Math.max(a.y, b.y),
            width: Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)),
            height: Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)) });
        const union = boxes => boxes.length ? { x: Math.min(...boxes.map(b => b.x)), y: Math.min(...boxes.map(b => b.y)),
            width: Math.max(...boxes.map(b => b.x + b.width)) - Math.min(...boxes.map(b => b.x)),
            height: Math.max(...boxes.map(b => b.y + b.height)) - Math.min(...boxes.map(b => b.y)) } : { x: 0, y: 0, width: 0, height: 0 };
        const transformBox = (r, m) => union([[r.x, r.y], [r.x + r.width, r.y], [r.x, r.y + r.height], [r.x + r.width, r.y + r.height]]
            .map(([x, y]) => new DOMPoint(x, y).matrixTransform(m)).map(p => ({ x: p.x, y: p.y, width: 0, height: 0 })));
        const viewport = { x: 0, y: 0, width: innerWidth, height: innerHeight };
        const container = document.querySelector('#canvas'), canvasContainer = container ? box(container.getBoundingClientRect()) : null;
        const drawing = document.querySelector('#viewport') || container?.querySelector('svg') || document.querySelector('svg');
        const canvas = drawing ? box(drawing.getBoundingClientRect()) : canvasContainer || viewport;
        const canonical = new Map([scene?.shell, ...scene?.children || [], ...scene?.storages || [], ...scene?.contacts || [], ...scene?.interfaceGroups || [], ...scene?.connections || []]
            .filter(Boolean).map(item => [item.id, item]));
        const svgPaint = [...document.querySelectorAll('svg .body, svg .mark')];
        const opaqueAt = (element, point) => {
            for (let parent = element; parent; parent = parent.parentElement) {
                const style = getComputedStyle(parent);
                if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) <= .01) return false;
            }
            const style = getComputedStyle(element), color = element instanceof SVGElement ? style.fill : style.backgroundColor;
            if (color === 'none' || color === 'transparent' || color === 'rgba(0, 0, 0, 0)') return false;
            if (element instanceof SVGElement) return element.matches('.body, .mark') && Number(style.fillOpacity) > .01
                && element.isPointInFill(new DOMPoint(point.x, point.y).matrixTransform(element.getScreenCTM().inverse()));
            return !element.closest('svg');
        };
        const texts = [...document.querySelectorAll('svg text, [data-label-id], #scene-title, #scene-path, #selection-title, #provider-status, #display-status, #canvas-instructions, [data-readability-context], [data-oracle-label], #code-drawer pre')].map((element, index) => {
            const style = getComputedStyle(element), svgText = element instanceof SVGTextContentElement;
            const sourceText = element.matches('#code-drawer pre');
            const group = element.closest('[data-semantic-id]'), ownerId = group?.dataset.semanticId || element.dataset.ownerId || null;
            let matrix = svgText ? element.getScreenCTM() : null;
            if (!svgText) {
                matrix = new DOMMatrix();
                for (let ancestor = element; ancestor; ancestor = ancestor.parentElement) {
                    const ancestorStyle = getComputedStyle(ancestor);
                    if (ancestorStyle.transform !== 'none') matrix = new DOMMatrix(ancestorStyle.transform).multiply(matrix);
                    const zoom = parseFloat(ancestorStyle.zoom);
                    if (Number.isFinite(zoom) && zoom !== 1) matrix = new DOMMatrix().scale(zoom).multiply(matrix);
                }
            }
            const declaredFont = parseFloat(style.fontSize);
            const coefficients = matrix ? [matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f] : [1, 0, 0, 1, 0, 0];
            const [a, b, c, d] = coefficients, sum = a * a + b * b + c * c + d * d, determinant = a * d - b * c;
            const scale = Math.sqrt(Math.max(0, (sum - Math.sqrt(Math.max(0, sum * sum - 4 * determinant * determinant))) / 2));
            let glyphBoxes = [];
            if (svgText && matrix) for (let i = 0; i < element.getNumberOfChars(); i++) glyphBoxes.push(transformBox(element.getExtentOfChar(i), matrix));
            else {
                const walk = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
                while (walk.nextNode()) for (let i = 0; i < walk.currentNode.length; i++) {
                    const range = document.createRange(); range.setStart(walk.currentNode, i); range.setEnd(walk.currentNode, i + 1);
                    glyphBoxes.push(...[...range.getClientRects()].map(box));
                }
            }
            const bounds = union(glyphBoxes), elementBounds = box(element.getBoundingClientRect());
            let clip = viewport, hiddenReason = null, opacity = 1;
            const scrollContainers = [];
            for (let ancestor = element; ancestor; ancestor = ancestor.parentElement) {
                const s = getComputedStyle(ancestor); opacity *= Number(s.opacity);
                if (s.display === 'none' || s.visibility === 'hidden' || s.visibility === 'collapse') hiddenReason = 'css-hidden';
                if (/(hidden|clip|scroll|auto)/.test(`${s.overflowX} ${s.overflowY}`)) {
                    clip = overlap(clip, box(ancestor.getBoundingClientRect()));
                    if (sourceText) scrollContainers.push({ id: ancestor.id || null, tag: ancestor.tagName,
                        bounds: box(ancestor.getBoundingClientRect()), left: ancestor.scrollLeft, top: ancestor.scrollTop,
                        width: ancestor.scrollWidth, height: ancestor.scrollHeight, clientWidth: ancestor.clientWidth, clientHeight: ancestor.clientHeight });
                }
                if (s.clipPath !== 'none') {
                    const id = s.clipPath.match(/#([^"')]+)/)?.[1], target = id && document.getElementById(id);
                    if (target instanceof SVGElement && typeof target.getBBox === 'function' && matrix) clip = overlap(clip, transformBox(target.getBBox(), ancestor.getScreenCTM()));
                }
            }
            if (svgText) clip = overlap(clip, canvas);
            if (opacity <= 0.01) hiddenReason = 'transparent';
            const visibleBounds = overlap(bounds, clip), clipFraction = area(bounds) ? area(visibleBounds) / area(bounds) : 0;
            const samples = [0.2, 0.5, 0.8].flatMap(x => [0.25, 0.75].map(y => ({ x: bounds.x + x * bounds.width, y: bounds.y + y * bounds.height })));
            const occluders = samples.map(point => {
                const stack = document.elementsFromPoint(point.x, point.y), textIndex = stack.findIndex(hit => hit === element || element.contains(hit));
                const anchorIndex = textIndex >= 0 ? textIndex : stack.findIndex(hit => hit.contains(element));
                const candidates = stack.slice(0, anchorIndex < 0 ? stack.length : anchorIndex);
                // Pointer-transparent SVG text/shapes are absent from hit stacks;
                // their observed SVG document order is the native paint order.
                if (svgText) candidates.push(...svgPaint.filter(hit => textIndex < 0 || getComputedStyle(hit).pointerEvents === 'none'));
                return candidates.find(hit => {
                    if (hit === element || element.contains(hit) || hit.contains(element) || !opaqueAt(hit, point)) return false;
                    if (svgText && hit instanceof SVGElement && hit.ownerSVGElement === element.ownerSVGElement) {
                        const hitIndex = stack.indexOf(hit);
                        return textIndex >= 0 && hitIndex >= 0 ? hitIndex < textIndex
                            : !!(element.compareDocumentPosition(hit) & Node.DOCUMENT_POSITION_FOLLOWING);
                    }
                    if (!svgText && textIndex < 0 && hit instanceof SVGElement && style.pointerEvents === 'none') {
                        return !!(element.compareDocumentPosition(hit.ownerSVGElement || hit) & Node.DOCUMENT_POSITION_FOLLOWING);
                    }
                    return stack.indexOf(hit) >= 0 && (anchorIndex < 0 || stack.indexOf(hit) < anchorIndex);
                });
            }).filter(Boolean).map(hit => hit.id || hit.closest('[data-semantic-id]')?.dataset.semanticId || hit.tagName);
            const text = element.textContent || '', item = canonical.get(ownerId);
            const fullText = element.dataset.fullText || (element.classList.contains('secondary') ? item?.secondaryLabel || item?.detail
                : element.classList.contains('detail') ? item?.detail : element.matches('.title, .label, .connection-label') ? item?.label : null) || text;
            const context = document.createElement('canvas').getContext('2d'); context.font = style.font;
            const ink = context.measureText(text);
            return { id: element.dataset.labelId || element.id || `label-${index}`, ownerId, nodeOwnerId: item?.ownerId || item?.ownerInstanceId || null,
                surface: svgText ? 'svg' : 'html',
                role: element.classList.contains('title') ? 'node-title' : element.classList.contains('label') ? 'contact-label' : element.id ? 'context' : 'detail',
                text, fullText, declaredFont, effectiveFont: declaredFont * scale, singularScale: scale, matrix: coefficients,
                fontFamily: style.fontFamily, fontWeight: style.fontWeight, cssTransform: style.transform,
                glyphBounds: bounds, elementBounds, visibleBounds, glyphBoxes, lineCount: new Set(glyphBoxes.map(b => Math.round(b.y * 10) / 10)).size,
                inkMetrics: { ascent: ink.actualBoundingBoxAscent, descent: ink.actualBoundingBoxDescent, width: ink.width },
                clipFraction, opacity, hiddenReason, occluders: [...new Set(occluders)],
                visible: !hiddenReason && !!text.trim() && clipFraction > 0.05 && occluders.length < samples.length,
                pointerEvents: style.pointerEvents, sourceText,
                ...(sourceText ? { sourceReferenceId: element.dataset.sourceReferenceId || null,
                    scroll: { left: element.scrollLeft, top: element.scrollTop, width: element.scrollWidth, height: element.scrollHeight,
                        clientWidth: element.clientWidth, clientHeight: element.clientHeight },
                    scrollContainers, sourceRange: { start: element.dataset.rangeStart || null, end: element.dataset.rangeEnd || null } } : {}) };
        });
        // Scrollable source has separate bounds/font evidence; full source clip
        // is not a failure of the mandatory on-canvas label contract.
        const source = texts.filter(text => text.sourceText), labels = texts.filter(text => !text.sourceText);
        const visible = labels.filter(l => l.visible), collisions = [];
        for (let i = 0; i < visible.length; i++) for (let j = i + 1; j < visible.length; j++) {
            const shared = overlap(visible[i].glyphBounds, visible[j].glyphBounds);
            if (area(shared) > 1) collisions.push({ first: visible[i].id, second: visible[j].id, bounds: shared });
        }
        const topology = [...document.querySelectorAll('[data-active="true"] > .body, [data-active="true"] > .route')]
            .map(e => ({ ownerId: e.closest('[data-semantic-id]')?.dataset.semanticId, kind: e.classList.contains('body') ? 'node' : 'route',
                expanded: e.parentElement.classList.contains('expanded'), bounds: box(e.getBoundingClientRect()) }));
        const contacts = [...document.querySelectorAll('[data-active="true"] .mark')].map(e => {
            const bounds = box(e.getBoundingClientRect()), center = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
            const hit = document.elementFromPoint(center.x, center.y);
            return { ownerId: e.closest('[data-semantic-id]')?.dataset.semanticId, bounds, center,
                centerHitOwnerId: hit?.closest('[data-semantic-id]')?.dataset.semanticId || null, centerHitTag: hit?.tagName || null };
        });
        const interference = visible.flatMap(label => contacts.filter(contact => contact.ownerId !== label.ownerId && area(overlap(label.glyphBounds, overlap(contact.bounds, canvas))) > 1)
            .map(contact => ({ labelId: label.id, contactId: contact.ownerId, kind: 'contact' })));
        for (const label of visible.filter(l => l.surface === 'svg' && (l.role === 'node-title' || l.nodeOwnerId))) {
            for (const node of topology.filter(n => n.kind === 'node' && n.ownerId !== label.ownerId && n.ownerId !== label.nodeOwnerId
                && n.ownerId !== scene?.shell.id && !(scene == null && n.expanded))) {
                if (area(overlap(label.glyphBounds, overlap(node.bounds, canvas))) > 1) interference.push({ labelId: label.id, nodeId: node.ownerId, kind: 'node' });
            }
        }
        for (const route of document.querySelectorAll('[data-active="true"] > .route')) {
            const routeId = route.closest('[data-semantic-id]').dataset.semanticId, bounds = box(route.getBoundingClientRect());
            const candidates = visible.filter(label => label.ownerId !== routeId && area(overlap(label.glyphBounds,
                { x: bounds.x - 1, y: bounds.y - 1, width: bounds.width + 2, height: bounds.height + 2 })) > 0);
            const matrix = route.getScreenCTM(), length = route.getTotalLength();
            const steps = Math.min(4096, Math.max(1, Math.ceil(length * Math.hypot(matrix.a, matrix.b) / 2)));
            const hits = new Set();
            for (let i = 0; candidates.length && i <= steps; i++) {
                const point = route.getPointAtLength(length * i / steps).matrixTransform(matrix);
                if (point.x < canvas.x || point.x > canvas.x + canvas.width || point.y < canvas.y || point.y > canvas.y + canvas.height) continue;
                for (const label of candidates) if (label.glyphBoxes.some(b => point.x >= b.x && point.x <= b.x + b.width && point.y >= b.y && point.y <= b.y + b.height)) hits.add(label.id);
            }
            for (const labelId of hits) interference.push({ labelId, routeId, kind: 'wire' });
        }
        const current = state?.current;
        return { schema: 'g5-readability-measurement-v1', measuredAt: new Date().toISOString(), viewport,
            devicePixelRatio, browserZoom: { visualViewportScale: visualViewport?.scale || 1, cssZoom: getComputedStyle(document.documentElement).zoom,
                note: 'Fresh browser context; browser page zoom not changed. DPR is recorded, never multiplied into CSS font size.' },
            canvas, canvasContainer, inspector: document.querySelector('#inspector') ? box(document.querySelector('#inspector').getBoundingClientRect()) : null,
            inspectorScroll: document.querySelector('#inspector')?.scrollTop || 0,
            drawer: document.querySelector('#code-drawer') ? { bounds: box(document.querySelector('#code-drawer').getBoundingClientRect()), hidden: document.querySelector('#code-drawer').hidden } : null,
            theme: document.documentElement.dataset.theme, reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
            labels, source, collisions, interference, topology, contacts, topologyBounds: union(topology.map(item => item.bounds)),
            fontsStatus: document.fonts.status, identity: current ? { buildId: current.buildId, sceneId: current.sceneId, sceneKind: current.sceneKind,
                snapshotId: current.snapshotId, provider: current.provider, sourceRevision: current.sourceRevision, ownerInstanceId: current.ownerInstanceId,
                occurrenceId: current.implementationContext?.contextOccurrenceId, occurrencePath: current.implementationContext?.occurrencePath,
                selectedEntityId: current.selectedEntityId, selectedRelationId: current.selectedRelationId,
                queryId: current.analysis?.result.queryId || null, resultId: current.analysis?.result.id || null,
                analysisKind: current.analysis?.result.kind || null, analysisStatus: current.analysis?.result.status || null,
                analysisCompleteness: current.analysis?.result.completeness || null,
                analysisContext: current.analysis?.result.context || null, scope: current.analysis?.request.scope || null,
                seed: current.analysis?.request.seed || null, viewport: current.viewport, disclosureState: current.disclosureState,
                activePanel: current.activePanel } : null,
            history: state ? { back: state.history.back.length, forward: state.history.forward.length } : null,
            sceneRoles: scene ? { shell: scene.shell, children: scene.children, storages: scene.storages, contacts: scene.contacts } : null };
    }, fixtureScene);
}

// Mandatory labels come from the caller's scenario/canonical roles, never from
// the measured visible subset. referenceIdentity excludes viewport by choice.
function validateMeasurement(measurement, expectations = {}) {
    const findings = [], visible = measurement.labels.filter(label => label.visible);
    const add = (kind, detail) => findings.push({ ...detail, kind });
    for (const label of visible) {
        if (label.effectiveFont + 1e-6 < (expectations.minimumFont || 9)) add('small-font', { id: label.id, actual: label.effectiveFont });
        if (label.clipFraction < 0.98) add('clipped-label', { id: label.id, fraction: label.clipFraction });
        if (label.occluders.length) add('occluded-label', { id: label.id, occluders: label.occluders });
    }
    for (const mandatory of expectations.mandatory || []) {
        const candidates = visible.filter(label => (!mandatory.ownerId || label.ownerId === mandatory.ownerId)
            && (!mandatory.id || label.id === mandatory.id) && (!mandatory.role || label.role === mandatory.role)
            && (!mandatory.text || label.text.includes(mandatory.text)));
        if (!candidates.length) add('missing-mandatory', mandatory);
        else if (!candidates.some(label => label.clipFraction >= 0.98 && !label.occluders.length && label.effectiveFont + 1e-6 >= (mandatory.minFont || expectations.minimumFont || 9))) add('unreadable-mandatory', mandatory);
    }
    for (const collision of measurement.collisions) add('label-collision', collision);
    for (const hit of measurement.interference) add('hit-interference', hit);
    const mandatoryOwners = new Set((expectations.mandatory || []).map(m => m.ownerId).filter(Boolean));
    for (const label of visible.filter(l => mandatoryOwners.has(l.ownerId))) {
        if (visible.some(other => other.ownerId !== label.ownerId && mandatoryOwners.has(other.ownerId) && other.text === label.text && other.fullText !== label.fullText)) add('ambiguous-abbreviation', { id: label.id, text: label.text });
    }
    if (expectations.fitAll) for (const item of measurement.topology) {
        const b = item.bounds, c = measurement.canvas;
        if (b.x < c.x - 2 || b.y < c.y - 2 || b.x + b.width > c.x + c.width + 2 || b.y + b.height > c.y + c.height + 2) add('fit-clipped-topology', { ownerId: item.ownerId, geometryKind: item.kind });
    }
    if (expectations.referenceHistory && JSON.stringify(expectations.referenceHistory) !== JSON.stringify(measurement.history)) add('navigation-changed', {});
    if (expectations.referenceIdentity) for (const [key, value] of Object.entries(expectations.referenceIdentity)) {
        if (JSON.stringify(measurement.identity?.[key]) !== JSON.stringify(value)) add('identity-changed', { key });
    }
    const identity = measurement.identity, context = identity?.analysisContext;
    if (context && (context.snapshotId !== identity.snapshotId || context.implementationProvider !== identity.provider)) add('analysis-context-mismatch', {});
    return { schema: 'g5-readability-verdict-v1', status: findings.length ? 'fail' : 'pass', findings,
        minimumVisibleFont: visible.length ? Math.min(...visible.map(l => l.effectiveFont)) : null,
        visibleCount: visible.length, hiddenCount: measurement.labels.length - visible.length };
}

module.exports = { measurePage, validateMeasurement };
