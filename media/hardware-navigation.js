'use strict';

(function expose(root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.BsvHardwareNavigation = api;
}(typeof globalThis === 'undefined' ? null : globalThis, function createApi() {
    const clone = value => structuredClone(value);
    const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
    const PATCH_FIELDS = new Set(['selectedEntityId', 'selectedRelationId', 'sourceContext',
        'viewport', 'disclosureState', 'activePanel']);

    function canonical(value) {
        if (Array.isArray(value)) return value.map(canonical);
        if (value && typeof value === 'object') {
            return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
        }
        return value;
    }

    // A scene's generated ID is presentation identity, not a distinct semantic visit.
    function visitKey(visit) {
        if (!visit) return null;
        return JSON.stringify(canonical({
            snapshotId: visit.snapshotId ?? null, sceneKind: visit.sceneKind ?? 'bsv',
            buildId: visit.buildId ?? visit.provenance?.buildId ?? null,
            provider: visit.provider ?? visit.implementationContext?.provider ?? null,
            rootInstanceId: visit.rootInstanceId ?? null, ownerInstanceId: visit.ownerInstanceId ?? null,
            sourceRevision: visit.sourceRevision ?? null,
            // The product's normalized query identity excludes execution IDs and metrics.
            ...(visit.analysis ? { analysis: visit.analysis.result.queryId } : {}),
            implementation: visit.sceneKind === 'rtl' ? {
                snapshotId: visit.implementationContext?.snapshotId ?? null,
                modelId: visit.implementationContext?.modelId ?? null,
                provider: visit.implementationContext?.provider ?? null,
                stage: visit.implementationContext?.stage ?? null,
                contextOccurrenceId: visit.implementationContext?.contextOccurrenceId ?? null,
                rootOccurrenceId: visit.implementationContext?.rootOccurrenceId ?? null,
                parentOccurrenceId: visit.implementationContext?.parentOccurrenceId ?? null,
                occurrencePath: visit.implementationContext?.occurrencePath ?? null
            } : null
        }));
    }

    function point(value, description) {
        if (!value || !Number.isFinite(value.x) || !Number.isFinite(value.y)) {
            throw new Error(`Invalid ${description}: expected finite coordinates`);
        }
    }

    function rectangle(value, description) {
        point(value, description);
        if (!Number.isFinite(value.width) || value.width <= 0 || !Number.isFinite(value.height) || value.height <= 0) {
            throw new Error(`Invalid ${description}: expected finite positive dimensions`);
        }
    }

    function validateViewport(value) {
        point(value, 'viewport');
        if (!Number.isFinite(value.scale) || value.scale <= 0) throw new Error('Invalid viewport scale');
    }

    function validateGeometry(geometry) {
        rectangle(geometry?.bounds, 'geometry bounds');
        const bounds = geometry.bounds;
        const inside = value => {
            point(value, 'geometry point');
            if (value.x < bounds.x - 1e-6 || value.y < bounds.y - 1e-6
                || value.x > bounds.x + bounds.width + 1e-6 || value.y > bounds.y + bounds.height + 1e-6) {
                throw new Error('Invalid geometry: primitive outside scene bounds');
            }
        };
        for (const key of ['nodes', 'contacts', 'routes']) {
            if (!Array.isArray(geometry[key])) throw new Error(`Invalid geometry ${key}: expected records`);
            const ids = new Set();
            for (const record of geometry[key]) {
                if (!record || typeof record.id !== 'string' || !record.id || ids.has(record.id)) {
                    throw new Error(`Invalid geometry ${key}: missing or duplicate identity`);
                }
                ids.add(record.id);
                if (key === 'nodes') {
                    rectangle(record, 'geometry node');
                    inside(record);
                    inside({ x: record.x + record.width, y: record.y + record.height });
                } else if (key === 'contacts') inside(record);
                else {
                    if (!Array.isArray(record.segments) || !record.segments.length
                        || typeof record.path !== 'string' || !record.path.trim()
                        || /NaN|Infinity/.test(record.path) || !Array.isArray(record.junctions)) {
                        throw new Error('Invalid geometry route: expected a finite routed path');
                    }
                    for (const segment of record.segments) {
                        if (!Array.isArray(segment) || segment.length !== 4) throw new Error('Invalid geometry route segment');
                        inside({ x: segment[0], y: segment[1] });
                        inside({ x: segment[2], y: segment[3] });
                    }
                    record.junctions.forEach(inside);
                    inside({ x: record.labelX, y: record.labelY });
                }
            }
        }
    }

    /**
     * Geometry owns no semantic inference; rendering/animation remains with the caller.
     * Async navigation and selection resolve true for a committed location or detail update.
     * Local methods return booleans. Failures publish onStatus({ ...state, error: {name, message} }).
     * getState and callbacks return detached data, including full saved history frames.
     * Optional queryAnalysis(request, {signal, onProgress}) returns a G5 result, not a scene.
     * analyze(input) accepts query fields except controller-owned queryGeneration; omitted
     * identity assertions come from the current view. It resolves true only for a new
     * normalized analysis visit. current.analysis holds the immutable full {request, result}.
     * Cancellation settles when the query callback settles (worker exit is its responsibility).
     * Optional resolveAnalysisTarget(request, {signal}) returns Scene Query's reveal envelope.
     * revealAnalysis({entityId, occurrenceId, snapshotId, provider?}) resolves inside navigate's
     * transaction before querying a scene. Provider defaults to the current actual context.
     * A committed visit exposes current.analysisReveal = {target, context}; context broadening
     * does not claim source origin. Even same-scene Reveal detail changes save a Back frame.
     */
    function createNavigation(options) {
        const { queryScene, queryAnalysis, resolveAnalysisTarget, layoutScene, getSize, fitViewport,
            onCommit = () => {}, onStatus = () => {}, canStartIntent = () => true } = options;
        let current = null, scene = null, geometry = null, measuredSize = null, viewportRevision = 0, viewportIntent = null;
        let pending = false, error = null, outcome = null, queryGeneration = 0, controller = null;
        let operation = null, retryAction = null;
        const history = { back: [], forward: [] };
        const checkpoints = new WeakMap();

        function publicFrame(entry) {
            return { current: entry.current, scene: entry.scene, geometry: entry.geometry };
        }
        function getState() {
            return clone({ current, scene, geometry,
                history: { back: history.back.map(publicFrame), forward: history.forward.map(publicFrame) },
                pending, error, outcome, queryGeneration, ...(operation ? { operation } : {}) });
        }
        function status() { onStatus(getState()); }
        function diagnostic(status, code = null, message = null) {
            outcome = { status, code, message: message == null ? null : String(message).slice(0, 512), queryGeneration };
        }
        function fail(cause, result = 'error') {
            error = { name: cause.name || 'Error', message: cause.message || String(cause),
                ...(cause.stack ? { stack: String(cause.stack).slice(0, 8192) } : {}) };
            diagnostic(result, cause.code || null, error.message);
            status();
            return false;
        }
        function capture() { return { current, scene, geometry, size: measuredSize }; }
        function restore(entry) {
            ({ current, scene, geometry, size: measuredSize } = entry);
        }
        function publish(previous, reason) {
            operation = null; retryAction = null;
            diagnostic('committed');
            onCommit(getState(), previous, { reason });
            status();
            return true;
        }
        function invalidate() {
            queryGeneration += 1;
            const obsolete = controller;
            controller = null;
            pending = false;
            error = null;
            operation = null; retryAction = null;
            obsolete?.abort();
        }
        function sizeNow() {
            const size = clone(getSize());
            rectangle({ x: 0, y: 0, ...size }, 'viewport size');
            return size;
        }
        function measure(candidateScene) {
            const size = sizeNow();
            // Layout receives detached input so a failed/mutating layout cannot damage
            // the currently displayed scene or historical geometry.
            const result = layoutScene(clone(candidateScene), clone(size));
            validateGeometry(result);
            return { geometry: clone(result), size };
        }

        function resolveIntent(intent) {
            intent = { ...intent };
            if (own(intent, 'implementationProvider') && !own(intent, 'provider')) intent.provider = intent.implementationProvider;
            const kind = intent.sceneKind ?? current?.sceneKind ?? 'bsv';
            if (!['bsv', 'rtl'].includes(kind)) throw new Error('Unknown scene kind');
            // BSV expands a source occurrence itself. RTL keeps source ownership
            // separate from the implementation occurrence chosen by the query.
            if (kind === 'bsv') {
                if (own(intent, 'ownerInstanceId') && !own(intent, 'rootInstanceId')) intent.rootInstanceId = intent.ownerInstanceId;
                if (own(intent, 'rootInstanceId') && !own(intent, 'ownerInstanceId')) intent.ownerInstanceId = intent.rootInstanceId;
            }
            const base = {
                buildId: current?.buildId ?? null, provider: kind === current?.sceneKind ? current.provider : null,
                snapshotId: current?.snapshotId ?? null, sceneKind: kind,
                rootInstanceId: current?.rootInstanceId ?? null, ownerInstanceId: current?.ownerInstanceId ?? null
            };
            const samePlace = current && ['buildId', 'provider', 'snapshotId', 'sceneKind', 'rootInstanceId', 'ownerInstanceId']
                .every(key => (own(intent, key) ? intent[key] : base[key]) === current[key]);
            const sameSource = current && ['buildId', 'rootInstanceId', 'ownerInstanceId']
                .every(key => (own(intent, key) ? intent[key] : base[key]) === current[key]);
            let sourceContext = sameSource ? current.sourceContext : null;
            if (kind === 'rtl' && current?.sceneKind === 'bsv') {
                sourceContext = { ...current.sourceContext, buildId: current.buildId, provider: current.provider,
                    snapshotId: current.snapshotId, rootInstanceId: current.rootInstanceId,
                    ownerInstanceId: current.ownerInstanceId, occurrencePath: current.occurrencePath,
                    selectedEntityId: current.selectedEntityId, selectedRelationId: current.selectedRelationId };
            }
            const resolved = clone({ ...base,
                selectedEntityId: samePlace ? current.selectedEntityId : null,
                selectedRelationId: samePlace ? current.selectedRelationId : null,
                disclosureState: samePlace ? current.disclosureState : {},
                activePanel: samePlace ? current.activePanel : 'inspector',
                sourceContext, implementationContext: samePlace ? current.implementationContext : null,
                ...intent, queryGeneration
            });
            if (own(intent, 'selection')) {
                resolved.selectedEntityId = intent.selection?.entityId ?? null;
                resolved.selectedRelationId = intent.selection?.relationId ?? null;
            }
            if (current && !samePlace && kind === 'rtl' && !own(intent, 'implementationContext')) {
                // A locator belongs to its provider snapshot, not the BSV owner.
                resolved.implementationContext = null;
            }
            resolved.selection = { entityId: resolved.selectedEntityId, relationId: resolved.selectedRelationId };
            return resolved;
        }

        function makeVisit(request, result, resultGeometry, size) {
            if (!result || typeof result.id !== 'string' || !result.id
                || !(typeof result.snapshotId === 'string' && result.snapshotId
                    || result.snapshotId === null && result.sceneKind === 'bsv'
                        && typeof result.presentationIdentity === 'string' && result.presentationIdentity.startsWith('source-model-'))
                || result.sceneKind !== request.sceneKind
                || !(typeof result.occurrencePath === 'string' || Array.isArray(result.occurrencePath))
                || !Array.isArray(result.breadcrumb) || !result.shell
                || result.shell.id !== (result.sceneKind === 'bsv' ? result.ownerInstanceId
                    : result.implementationContext?.contextOccurrenceId)) {
                throw new Error('Invalid scene identity or hierarchy');
            }
            if (request.ownerInstanceId != null && result.ownerInstanceId !== request.ownerInstanceId) {
                throw new Error('Scene owner does not match request');
            }
            const identity = {
                buildId: result.buildId ?? result.provenance?.buildId ?? request.buildId,
                provider: result.provider ?? result.implementationContext?.provider ?? result.header?.provider ?? request.provider
            };
            for (const key of ['buildId', 'provider']) {
                if (request[key] != null && identity[key] !== request[key]) {
                    throw new Error(`Scene ${key} does not match request`);
                }
            }
            const viewport = own(request, 'viewport') ? clone(request.viewport)
                : fitViewport(clone(resultGeometry), clone(size));
            validateViewport(viewport);
            const sourceContext = result.sourceContext === null ? null : request.sceneKind === 'bsv' ? {
                buildId: identity.buildId, provider: identity.provider, snapshotId: result.snapshotId,
                rootInstanceId: result.rootInstanceId, ownerInstanceId: result.ownerInstanceId,
                occurrencePath: result.occurrencePath, ...request.sourceContext, ...result.sourceContext
            } : { ...request.sourceContext, ...result.sourceContext };
            return clone({
                ...identity,
                snapshotId: result.snapshotId, sceneId: result.id, sceneKind: result.sceneKind,
                sourceRevision: result.sourceRevision ?? null,
                rootInstanceId: result.rootInstanceId, ownerInstanceId: result.ownerInstanceId,
                occurrencePath: result.occurrencePath,
                selectedEntityId: result.selection && own(result.selection, 'selectedEntityId')
                    ? result.selection.selectedEntityId : request.selectedEntityId,
                selectedRelationId: result.selection && own(result.selection, 'selectedRelationId')
                    ? result.selection.selectedRelationId : request.selectedRelationId,
                sourceContext,
                implementationContext: own(result, 'implementationContext') ? result.implementationContext : request.implementationContext,
                viewport, disclosureState: result.disclosureState ?? request.disclosureState,
                activePanel: result.activePanel ?? request.activePanel, queryGeneration: request.queryGeneration
            });
        }

        function revealRequest(ref) {
            const context = current.implementationContext;
            if (!ref || typeof ref.entityId !== 'string' || !ref.entityId
                || typeof ref.occurrenceId !== 'string' || !ref.occurrenceId
                || ref.snapshotId !== context.snapshotId || ref.provider != null && ref.provider !== context.provider) {
                throw Object.assign(new Error('Analysis reveal target does not match current actual context'), { code: 'INVALID_INPUT' });
            }
            return { buildId: current.buildId, snapshotId: context.snapshotId, queryGeneration,
                implementationProvider: context.provider, rootInstanceId: current.rootInstanceId, ownerInstanceId: current.ownerInstanceId,
                target: { entityId: ref.entityId, occurrenceId: ref.occurrenceId, snapshotId: ref.snapshotId, provider: context.provider } };
        }

        function validateReveal(request, response) {
            const invalid = message => { throw Object.assign(new Error(message), { code: 'INVALID_REVEAL_RESULT' }); };
            if (response?.requestSnapshotId !== request.snapshotId || response.queryGeneration !== request.queryGeneration) {
                throw Object.assign(new Error('Reveal response snapshot/generation echo mismatch'), { code: 'STALE_RESPONSE' });
            }
            if (['unavailable', 'ambiguous'].includes(response.status)) {
                throw Object.assign(new Error(`Analysis reveal ${response.status}`), { code: response.status === 'ambiguous' ? 'AMBIGUOUS' : 'UNAVAILABLE' });
            }
            if (response.status !== 'resolved' || !response.intent || !response.context) invalid('Invalid reveal resolution');
            for (const [key, value] of Object.entries(request.target)) {
                if (response.target?.[key] !== value) invalid(`Reveal target ${key} mismatch`);
            }
            const intent = response.intent, context = response.context;
            const ownerChanged = intent.ownerInstanceId !== request.ownerInstanceId;
            const artifactOnly = current.ownerInstanceId === null && scene.sourceContext === null && scene.sceneKind === 'rtl';
            if ((!artifactOnly && !scene.sourceBreadcrumb?.some(entry => entry.id === intent.ownerInstanceId))
                || (artifactOnly && (intent.ownerInstanceId !== null || context.ownership !== 'unmapped'
                    || !scene.breadcrumb.some(entry => entry.id === context.anchorOccurrenceId)))
                || context.ownerInstanceId !== intent.ownerInstanceId || context.previousOwnerInstanceId !== request.ownerInstanceId
                || context.ownerChanged !== ownerChanged || context.status !== (ownerChanged ? 'owner-broadened' : 'owner-preserved')
                || typeof context.anchorOccurrenceId !== 'string' || !context.anchorOccurrenceId
                || (!artifactOnly && !['containing-only', 'retained-boundary'].includes(context.ownership))) invalid('Invalid reveal source-owner context');
            if (intent.sceneKind !== 'rtl' || intent.buildId !== request.buildId || intent.snapshotId !== request.snapshotId
                || intent.queryGeneration !== request.queryGeneration || intent.implementationProvider !== request.implementationProvider
                || intent.rootInstanceId !== (ownerChanged ? intent.ownerInstanceId : request.rootInstanceId)
                || intent.selectedEntityId !== request.target.entityId || intent.selectedRelationId !== null
                || intent.implementationContext?.snapshotId !== request.snapshotId
                || intent.implementationContext?.contextOccurrenceId !== request.target.occurrenceId) invalid('Invalid reveal navigation intent');
            // Only ordinary validated locator fields may influence navigation. A resolver
            // cannot inject viewport/source state or override the provider through an alias.
            return { buildId: intent.buildId, snapshotId: intent.snapshotId, sceneKind: 'rtl',
                implementationProvider: intent.implementationProvider, rootInstanceId: intent.rootInstanceId,
                ownerInstanceId: intent.ownerInstanceId, selectedEntityId: intent.selectedEntityId, selectedRelationId: null,
                implementationContext: { snapshotId: request.snapshotId, contextOccurrenceId: request.target.occurrenceId },
                sourceContext: ownerChanged ? null : current.sourceContext };
        }

        async function navigate(intent, { recordHistory = true, reason = 'navigate', analysisTarget = null, replaceHistory = false } = {}) {
            if (!canStartIntent()) return false;
            invalidate();
            const generation = queryGeneration;
            const active = new AbortController();
            controller = active;
            let request;
            try { request = resolveIntent(intent); }
            catch (cause) { controller = null; return fail(cause); }
            operation = { kind: 'scene', reason, target: Object.fromEntries(['buildId', 'rootInstanceId',
                'ownerInstanceId', 'sceneKind', 'selectedEntityId', 'selectedRelationId'].map(key => [key, request[key]])) };
            const retryIntent = clone(intent);
            retryAction = () => navigate(retryIntent, { recordHistory, reason, analysisTarget, replaceHistory });
            pending = true;
            status();
            let candidate, reveal = null, phase = 'unresolved';
            try {
                if (analysisTarget) {
                    const targetRequest = revealRequest(analysisTarget);
                    const response = await resolveAnalysisTarget(clone(targetRequest), { signal: active.signal });
                    if (generation !== queryGeneration || active.signal.aborted) return false;
                    request = resolveIntent(validateReveal(targetRequest, response));
                    reveal = clone({ target: response.target, context: response.context });
                }
                // The host accepts standard query fields, not presentation metadata or
                // the public visit's provider alias. Never spread a complete visit onto the wire.
                const wire = {};
                for (const key of ['buildId', 'snapshotId', 'queryGeneration', 'sceneId', 'sceneKind',
                    'rootInstanceId', 'ownerInstanceId', 'occurrencePath', 'selectedEntityId', 'selectedRelationId',
                    'sourceContext', 'implementationContext', 'viewport', 'disclosureState', 'activePanel']) {
                    if (own(request, key)) wire[key] = request[key];
                }
                wire.implementationProvider = request.provider;
                const response = await queryScene(clone(wire), { signal: active.signal });
                if (generation !== queryGeneration || active.signal.aborted) return false;
                if (response?.requestSnapshotId !== request.snapshotId || response.queryGeneration !== generation) {
                    throw Object.assign(new Error('Scene response snapshot/generation echo mismatch'), { code: 'STALE_RESPONSE' });
                }
                const resultScene = clone(response.scene);
                if (reveal && (resultScene?.snapshotId !== reveal.target.snapshotId
                    || resultScene.implementationContext?.provider !== reveal.target.provider
                    || resultScene.implementationContext?.snapshotId !== reveal.target.snapshotId
                    || resultScene.implementationContext?.contextOccurrenceId !== reveal.target.occurrenceId
                    || resultScene.implementationContext?.modelId !== current.implementationContext.modelId
                    || resultScene.implementationContext?.stage !== current.implementationContext.stage
                    || resultScene.implementationContext?.providerIdentity !== current.implementationContext.providerIdentity
                    || resultScene.rootInstanceId !== request.rootInstanceId
                    || !resultScene.breadcrumb?.some(entry => entry.id === reveal.context.anchorOccurrenceId)
                    || resultScene.shell?.id !== reveal.target.occurrenceId
                    || resultScene.selection?.selectedEntityId !== reveal.target.entityId
                    || resultScene.selection?.selectedRelationId !== null)) {
                    throw Object.assign(new Error('Reveal scene does not identify the requested actual target'), { code: 'INVALID_REVEAL_RESULT' });
                }
                // Query first: only canonical resolved identity is eligible for reuse.
                // These are the complete inputs consumed by the product layout.
                const layoutInput = value => canonical(Object.fromEntries(['sceneKind', 'shell', 'children', 'storages', 'contacts', 'interfaceGroups', 'connections', 'projection']
                    .map(key => [key, value[key]])));
                const sameLocation = visitKey(current && { ...current, analysis: null }) === visitKey(resultScene);
                const size = sizeNow();
                const reuse = sameLocation && geometry.routing?.status !== 'partial' && JSON.stringify(size) === JSON.stringify(measuredSize)
                    && JSON.stringify(layoutInput(scene)) === JSON.stringify(layoutInput(resultScene));
                phase = 'error';
                const measured = reuse ? { geometry, size } : measure(resultScene);
                validateGeometry(measured.geometry);
                if (sameLocation && !own(intent, 'viewport')) request.viewport = current.viewport;
                const visit = makeVisit(request, resultScene, measured.geometry, measured.size);
                // Detail/selection queries retain the analysis; actual hierarchy/provider
                // entry starts a scene visit and leaves the full old analysis in history.
                if (sameLocation && current.analysis) visit.analysis = current.analysis;
                if (reveal) visit.analysisReveal = reveal;
                candidate = { current: visit, scene: resultScene, ...measured };
            } catch (cause) {
                if (generation !== queryGeneration || active.signal.aborted) return false;
                pending = false;
                controller = null;
                return fail(cause, cause.code === 'STALE_RESPONSE' ? 'stale' : cause.code === 'CANCELLED' ? 'cancelled' : phase);
            }
            if (generation !== queryGeneration || active.signal.aborted) return false;
            const previous = getState();
            pending = false;
            controller = null;
            const sameLocation = visitKey(current) === visitKey(candidate.current);
            if (sameLocation) {
                const savedDetail = visit => canonical(Object.fromEntries(['selectedEntityId', 'selectedRelationId',
                    'sourceContext', 'implementationContext', 'viewport', 'disclosureState', 'activePanel'].map(key => [key, visit[key]])));
                const sceneDetail = value => { const { id, ...detail } = value; return canonical(detail); };
                if (geometry.routing?.status !== 'partial' && JSON.stringify(savedDetail(current)) === JSON.stringify(savedDetail(candidate.current))
                    && JSON.stringify(sceneDetail(scene)) === JSON.stringify(sceneDetail(candidate.scene))) {
                    diagnostic('unchanged');
                    operation = null; retryAction = null;
                    status();
                    return false;
                }
            }
            if ((!sameLocation || reveal) && current && recordHistory) history.back.push(capture());
            if ((!sameLocation || reveal) && reason !== 'select') history.forward.length = 0;
            if (replaceHistory) { history.back.length = 0; history.forward.length = 0; }
            restore(candidate);
            return publish(previous, reason);
        }

        function analysisIdentity() {
            const context = current.implementationContext;
            return { analysisId: scene.provenance?.analysisId, snapshotId: context.snapshotId,
                implementationProvider: context.provider, stage: context.stage ?? null,
                ownerInstanceId: current.ownerInstanceId, implementationOccurrenceId: context.contextOccurrenceId };
        }

        function analysisRequest(input) {
            const fields = ['kind', 'analysisId', 'snapshotId', 'implementationProvider', 'stage',
                'ownerInstanceId', 'implementationOccurrenceId', 'seed', 'scope', 'direction', 'semanticsProfile', 'limits', 'mode'];
            if (!input || typeof input !== 'object' || Array.isArray(input)
                || Object.keys(input).some(key => !fields.includes(key))) {
                throw Object.assign(new Error('Invalid analysis input fields'), { code: 'INVALID_INPUT' });
            }
            const identity = analysisIdentity();
            for (const [key, value] of Object.entries(identity)) {
                if (own(input, key) && input[key] !== value && !(key === 'stage' && input[key] === null)) {
                    throw Object.assign(new Error(`Analysis ${key} does not match current view`), { code: 'INVALID_INPUT' });
                }
            }
            // Seed/scope/kind/limits normalization and canonical model authority belong
            // to the product query, not this presentation controller.
            return clone({ ...identity, ...input, queryGeneration });
        }

        function validateAnalysis(request, result) {
            const invalid = message => { throw Object.assign(new Error(message), { code: 'INVALID_ANALYSIS_RESULT' }); };
            const stale = message => { throw Object.assign(new Error(message), { code: 'STALE_RESPONSE' }); };
            if (result?.request?.queryGeneration !== request.queryGeneration
                || result?.request?.snapshotId !== request.snapshotId) stale('Analysis response snapshot/generation echo mismatch');
            if (result.schemaVersion !== 1 || typeof result.id !== 'string' || !result.id
                || typeof result.queryId !== 'string' || !result.queryId || result.kind !== request.kind) invalid('Invalid analysis result identity');
            if (result.status === 'stale' || result.freshness === 'stale' || result.context?.freshness === 'stale') stale('Stale analysis result');
            const completeness = { complete: 'complete', empty: 'complete', partial: 'partial', unsupported: 'unknown', ambiguous: 'unknown' };
            if (!own(completeness, result.status) || result.completeness !== completeness[result.status]
                || !['available', 'unavailable', 'not-implemented'].includes(result.availability)
                || ['complete', 'empty', 'partial'].includes(result.status) && result.availability !== 'available') {
                invalid('Invalid analysis status/completeness/availability');
            }
            const expected = { ...analysisIdentity(), modelId: current.implementationContext.modelId,
                providerIdentity: current.implementationContext.providerIdentity,
                sourceModelIdentity: scene.provenance?.sourceModelIdentity };
            for (const [key, value] of Object.entries(expected)) {
                // Owner and actual occurrence may be carried by a kind-specific seed
                // instead of the attachment context. Never accept a contradictory echo.
                if (['ownerInstanceId', 'implementationOccurrenceId'].includes(key) && !own(result.context || {}, key)) continue;
                if (value !== undefined && JSON.stringify(canonical(result.context?.[key])) !== JSON.stringify(canonical(value))) {
                    invalid(`Analysis result context ${key} does not match current view`);
                }
            }
            if (!result.seed || typeof result.seed !== 'object' || Array.isArray(result.seed)) invalid('Invalid analysis seed');
            if (result.seed.occurrenceId != null && result.seed.occurrenceId !== request.implementationOccurrenceId) invalid('Foreign analysis seed occurrence');
            if (request.seed?.entityId != null && result.seed.entityId !== request.seed.entityId) invalid('Analysis seed identity mismatch');
            const equal = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
            for (const key of ['sourceRevision', 'entryCallSiteId']) {
                if (own(request.seed, key) && !equal(result.seed[key], request.seed[key])) invalid(`Analysis source ${key} mismatch`);
            }
            if (request.mode !== undefined && result.code?.sourceMode !== request.mode) invalid('Analysis source mode mismatch');
            if (!equal(result.scope, request.scope) || !equal(result.direction ?? null, request.direction ?? null)
                || !equal(result.semanticsProfile ?? null, request.semanticsProfile ?? null)) invalid('Analysis query context mismatch');
            if (request.seed?.indices && !equal(result.seed.positions?.map(p => p.index), request.seed.indices)) invalid('Analysis seed order mismatch');
            if (request.seed?.slice && (!Array.isArray(result.seed.positions)
                || result.seed.positions.length !== request.seed.slice.end - request.seed.slice.start
                || result.seed.positions.some((p, i) => p.index !== request.seed.slice.start + i))) invalid('Analysis seed slice mismatch');
            if (request.seed?.bitIds && !equal(result.seed.positions?.map(p => p.bitId), request.seed.bitIds)) invalid('Analysis bit order mismatch');
            for (const key of ['objects', 'relations', 'boundaries', 'frontier', 'sourceRefs', 'evidenceRefs', 'candidates']) {
                if (!Array.isArray(result[key])) invalid(`Invalid analysis ${key}`);
            }
        }

        async function analyze(input) {
            if (!canStartIntent()) return false;
            if (!current) return blocked('NO_SCENE', 'No current scene to analyze');
            if (typeof queryAnalysis !== 'function') return blocked('ANALYSIS_UNAVAILABLE', 'Analysis query is not attached');
            invalidate();
            const generation = queryGeneration, active = new AbortController();
            controller = active;
            let request;
            try { request = analysisRequest(input); }
            catch (cause) { controller = null; return fail(cause, 'unresolved'); }
            operation = { kind: 'analysis', target: { buildId: current.buildId,
                ownerInstanceId: current.ownerInstanceId, kind: request.kind } };
            const retryInput = clone(input);
            retryAction = () => analyze(retryInput);
            pending = true;
            diagnostic('pending');
            status();
            let candidate, phase = 'unresolved';
            try {
                const result = clone(await queryAnalysis(clone(request), { signal: active.signal,
                    onProgress(progress) {
                        if (generation !== queryGeneration || active.signal.aborted || !pending) return;
                        diagnostic('progress', null, progress?.phase);
                        status();
                    } }));
                if (generation !== queryGeneration || active.signal.aborted) return false;
                validateAnalysis(request, result);
                phase = 'error';
                // Overlay consumers project canonical IDs onto this existing geometry.
                // No analysis fact is merged into Scene Query's G2/G3 truth or layout inputs.
                const measured = measure(scene);
                validateViewport(current.viewport);
                const freeze = value => {
                    if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
                    return value;
                };
                candidate = { current: { ...current, analysis: freeze({ request, result }), queryGeneration: generation },
                    scene, ...measured };
            } catch (cause) {
                if (generation !== queryGeneration || active.signal.aborted) return false;
                pending = false;
                controller = null;
                return fail(cause, cause.code === 'STALE_RESPONSE' ? 'stale' : cause.code === 'CANCELLED' ? 'cancelled' : phase);
            }
            if (generation !== queryGeneration || active.signal.aborted) return false;
            const previous = getState();
            pending = false;
            controller = null;
            if (visitKey(current) === visitKey(candidate.current)) {
                operation = null; retryAction = null;
                diagnostic('unchanged'); status(); return false;
            }
            history.back.push(capture());
            history.forward.length = 0;
            restore(candidate);
            return publish(previous, 'analyze');
        }

        function travel(from, to) {
            if (!canStartIntent()) return false;
            const previous = getState();
            // Back is an intent even when there is nowhere to travel.
            const wasPending = pending;
            invalidate();
            if (!history[from].length) {
                diagnostic(wasPending ? 'cancelled' : 'blocked', 'NO_HISTORY'); status(); return false;
            }
            if (current) history[to].push(capture());
            restore(history[from].pop());
            if (JSON.stringify(sizeNow()) !== JSON.stringify(measuredSize)) resize(false);
            return publish(previous, from === 'back' ? 'back' : 'forward');
        }

        function reset() {
            const previous = getState();
            invalidate();
            current = scene = geometry = measuredSize = null;
            history.back.length = 0; history.forward.length = 0;
            return publish(previous, 'input-reset');
        }

        function checkpoint({ historyBuildIds } = {}) {
            const token = Object.freeze({});
            const allowed = entry => !historyBuildIds || historyBuildIds.includes(entry.current.buildId);
            checkpoints.set(token, { frame: capture(), back: history.back.filter(allowed), forward: history.forward.filter(allowed) });
            return token;
        }
        function retainHistory(buildIds) {
            let changed = false;
            for (const key of ['back', 'forward']) {
                const retained = history[key].filter(entry => buildIds.includes(entry.current.buildId));
                changed ||= retained.length !== history[key].length;
                history[key].splice(0, history[key].length, ...retained);
            }
            if (changed) status();
        }
        function restoreCheckpoint(token, expectedGeneration, cause) {
            const saved = checkpoints.get(token);
            if (!saved || expectedGeneration !== queryGeneration || pending) return false;
            const previous = getState(), rejected = current, rejectedLabel = scene?.shell.label;
            invalidate(); restore(clone(saved.frame));
            history.back.splice(0, history.back.length, ...clone(saved.back));
            history.forward.splice(0, history.forward.length, ...clone(saved.forward));
            if (current && JSON.stringify(sizeNow()) !== JSON.stringify(measuredSize)) resize(false);
            operation = { kind: 'scene', reason: 'publication', target: rejected && { ...Object.fromEntries(
                ['buildId', 'rootInstanceId', 'ownerInstanceId', 'sceneKind', 'selectedEntityId', 'selectedRelationId']
                    .map(key => [key, rejected[key]])), label: rejectedLabel } };
            if (rejected) retryAction = () => navigate(Object.fromEntries(['buildId', 'snapshotId', 'provider', 'sceneKind',
                'rootInstanceId', 'ownerInstanceId', 'selectedEntityId', 'selectedRelationId', 'viewport', 'disclosureState',
                'sourceContext', 'implementationContext'].map(key => [key, rejected[key]])), { reason: 'retry' });
            error = { name: cause.name || 'Error', message: cause.message || String(cause),
                ...(cause.stack ? { stack: String(cause.stack).slice(0, 8192) } : {}) };
            diagnostic('stale', cause.code || null, error.message);
            onCommit(getState(), previous, { reason: 'publication-rollback' }); status();
            return true;
        }

        function blocked(code, message) {
            if (!canStartIntent()) return false;
            invalidate(); diagnostic('blocked', code, message); status(); return Promise.resolve(false);
        }
        function breadcrumb(occurrenceId) {
            if (!current || !scene.breadcrumb.some(entry => entry.id === occurrenceId)) {
                return blocked('UNKNOWN_BREADCRUMB', 'Occurrence is not in the current hierarchy path');
            }
            if (current.sceneKind === 'rtl') {
                return navigate({ implementationContext: { snapshotId: current.implementationContext.snapshotId,
                    contextOccurrenceId: occurrenceId }, selectedEntityId: null, selectedRelationId: null }, { reason: 'breadcrumb' });
            }
            return navigate({ sceneKind: 'bsv', ownerInstanceId: occurrenceId, rootInstanceId: occurrenceId,
                sourceContext: null }, { reason: 'breadcrumb' });
        }
        function up() {
            if (current?.sceneKind === 'rtl') {
                const parent = current.implementationContext.parentOccurrenceId;
                if (!parent) return blocked('RTL_ROOT', 'Already at the actual RTL root; Return BSV is a separate action');
                return navigate({ implementationContext: { snapshotId: current.implementationContext.snapshotId,
                    contextOccurrenceId: parent }, selectedEntityId: null, selectedRelationId: null }, { reason: 'up' });
            }
            const index = scene?.breadcrumb.findIndex(entry => entry.id === current?.ownerInstanceId) ?? -1;
            if (index <= 0) return blocked('BSV_ROOT', 'Already at the BSV root');
            return navigate({ sceneKind: 'bsv', ownerInstanceId: scene.breadcrumb[index - 1].id,
                rootInstanceId: scene.breadcrumb[index - 1].id, sourceContext: null }, { reason: 'up' });
        }
        function returnBsv(occurrenceId = current?.sourceContext?.ownerInstanceId) {
            if (!current || !scene.sourceBreadcrumb?.some(entry => entry.id === occurrenceId)) {
                return blocked('UNKNOWN_SOURCE_BREADCRUMB', 'Occurrence is not in the BSV source path');
            }
            const source = current.sourceContext;
            const atOwner = occurrenceId === source.ownerInstanceId;
            return navigate({ sceneKind: 'bsv', buildId: source.buildId, snapshotId: source.snapshotId,
                provider: source.provider, rootInstanceId: atOwner ? source.rootInstanceId : occurrenceId,
                ownerInstanceId: occurrenceId, selectedEntityId: atOwner ? source.selectedEntityId : null,
                selectedRelationId: atOwner ? source.selectedRelationId : null,
                sourceContext: null, implementationContext: null }, { reason: 'source' });
        }

        function patch(changes, reason, cancelPending) {
            if (!current || cancelPending && !canStartIntent()) return false;
            let next;
            try {
                for (const key of Object.keys(changes)) {
                    if (!PATCH_FIELDS.has(key)) throw new Error(`Cannot patch visit identity: ${key}`);
                }
                next = clone({ ...current, ...changes });
                validateViewport(next.viewport);
            } catch (cause) { return fail(cause); }
            const previous = getState();
            if (cancelPending) invalidate();
            current = next;
            if (own(changes, 'viewport')) {
                viewportRevision++;
                const frame = getViewportFrame();
                viewportIntent = clone({ viewport: current.viewport, viewportSize: frame.viewportSize, viewportAnchor: frame.viewportAnchor,
                    presentation: current.disclosureState?.presentation || {}, context: Object.fromEntries(
                        ['buildId', 'snapshotId', 'sceneKind', 'provider', 'rootInstanceId', 'ownerInstanceId'].map(key => [key, current[key]])) });
            }
            if (!cancelPending && (pending || error)) {
                onCommit(getState(), previous, { reason }); status(); return true;
            }
            return publish(previous, reason);
        }

        function anchor(value, visit) {
            const id = visit.selectedEntityId ?? visit.selectedRelationId;
            const node = value.nodes.find(item => item.id === id);
            if (node) return { x: node.x + node.width / 2, y: node.y + node.height / 2 };
            const contact = value.contacts.find(item => item.id === id);
            if (contact) return contact;
            const route = value.routes.find(item => item.id === id);
            if (route) return { x: route.labelX, y: route.labelY };
            return { x: value.bounds.x + value.bounds.width / 2, y: value.bounds.y + value.bounds.height / 2 };
        }

        function getViewportFrame() {
            const point = current && anchor(geometry, current);
            return clone({ revision: viewportRevision, intent: viewportIntent, ...(point ? {
                viewportSize: measuredSize, viewportAnchor: { x: point.x, y: point.y } } : {}) });
        }

        function resize(notify = true) {
            if (!current) return false;
            let measured, viewport;
            try {
                measured = measure(scene);
                const before = anchor(geometry, current), after = anchor(measured.geometry, current);
                const { x, y, scale } = current.viewport;
                viewport = {
                    x: x + (measured.size.width - measuredSize.width) / 2 + (before.x - after.x) * scale,
                    y: y + (measured.size.height - measuredSize.height) / 2 + (before.y - after.y) * scale,
                    scale
                };
                validateViewport(viewport);
            } catch (cause) { return fail(cause); }
            const previous = getState();
            geometry = measured.geometry;
            measuredSize = measured.size;
            current = { ...current, viewport };
            if (notify) { onCommit(getState(), previous, { reason: 'resize' }); status(); }
            return true;
        }

        return {
            navigate, analyze,
            retry() { return !pending && error && retryAction ? retryAction() : Promise.resolve(false); },
            revealAnalysis(ref) {
                if (!current) return blocked('NO_SCENE', 'No current scene for analysis reveal');
                if (typeof resolveAnalysisTarget !== 'function') return blocked('REVEAL_UNAVAILABLE', 'Analysis target resolver is not attached');
                if (!ref) return blocked('INVALID_INPUT', 'Analysis reveal target required');
                return navigate({}, { reason: 'analysis-reveal', analysisTarget: ref });
            },
            select(entityId, { relation = false } = {}) {
                if (!current) return blocked('NO_SCENE', 'No current scene to inspect');
                return navigate({ selectedEntityId: relation ? null : entityId,
                    selectedRelationId: relation ? entityId : null, viewport: current.viewport
                }, { recordHistory: false, reason: 'select' });
            },
            back: () => travel('back', 'forward'), forward: () => travel('forward', 'back'),
            up, breadcrumb, returnBsv,
            patchCurrent: changes => patch(changes, 'patch', Object.keys(changes)
                .some(key => ['selectedEntityId', 'selectedRelationId', 'sourceContext'].includes(key))),
            setViewport: (viewport, presentation) => patch({ viewport, ...(presentation ? {
                disclosureState: { ...current.disclosureState, presentation: { ...current.disclosureState.presentation, ...presentation } }
            } : {}) }, 'viewport', false),
            reset, resize, getState, getViewportFrame, checkpoint, restoreCheckpoint, retainHistory
        };
    }

    return { createNavigation, visitKey };
}));
