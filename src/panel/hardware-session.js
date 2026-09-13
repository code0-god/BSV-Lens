'use strict';
const { loadNativeInput } = require('../hardware/native-input');
const { failure, stable, copyJson, DEFAULT_LIMITS } = require('../hardware/json');
const { fields, json, stateValue, queryKey, intentFor, visitFor } = require('./hardware-state');
const { responsePayload } = require('./hardware-protocol');

async function interruptible(operation, signal) {
    let abort;
    const cancelled = new Promise((resolve, reject) => {
        abort = () => reject(failure('CANCELLED', 'Native input dialog cancelled'));
        signal.addEventListener('abort', abort, { once: true }); if (signal.aborted) abort();
    });
    try { return await Promise.race([operation, cancelled]); }
    finally { signal.removeEventListener('abort', abort); }
}

function refreshedVisit(previousInput, proposed, current, picked) {
    const query = proposed.catalog.find(query => query.getCatalogEntry().buildId === picked);
    if (!query) return {};
    const entry = query.getCatalogEntry(), previous = previousInput.sourceModel?.instances.find(instance => instance.id === current.ownerInstanceId);
    const next = proposed.sourceModel?.instances.find(instance => instance.id === current.ownerInstanceId);
    const definitionUri = (model, instance) => model?.definitions.find(definition => definition.id === instance?.targetDefinitionId)?.uri;
    const sameOwner = current.sceneKind === 'bsv' && previous && next && previous.path === next.path
        && previous.targetDefinitionId === next.targetDefinitionId && previous.sourceRange?.uri === next.sourceRange?.uri
        && definitionUri(previousInput.sourceModel, previous) === definitionUri(proposed.sourceModel, next);
    const intent = { buildId: picked, snapshotId: entry.snapshotId ?? null, queryGeneration: 0, sceneKind: 'bsv',
        implementationProvider: 'stock', rootInstanceId: sameOwner ? current.rootInstanceId : entry.rootInstanceId,
        ownerInstanceId: sameOwner ? next.id : entry.rootInstanceId, selectedEntityId: null, selectedRelationId: null,
        activePanel: current.activePanel || 'inspector' };
    query.getScene(intent);
    let status = sameOwner ? 'preserved' : current.sceneKind === 'bsv' ? 'owner-unavailable' : 'surface-changed';
    if (sameOwner && (current.selectedEntityId || current.selectedRelationId)) {
        const selected = { ...intent, selectedEntityId: current.selectedEntityId || null, selectedRelationId: current.selectedRelationId || null };
        try { query.getScene(selected); Object.assign(intent, selected); }
        catch (error) { if (error.code !== 'INVALID_INPUT') throw error; status = 'selection-unavailable'; }
    }
    const messages = { preserved: null,
        'selection-unavailable': 'The selected object is no longer available in this revision. The current module is preserved.',
        'owner-unavailable': 'The previous module is no longer available in this revision. Showing the selected design overview.',
        'surface-changed': 'The workspace source revision changed. Showing its source-based design overview.' };
    return { refreshIntent: intent, refreshTarget: { status, previousOwnerInstanceId: current.ownerInstanceId,
        ownerInstanceId: intent.ownerInstanceId, selectedEntityId: intent.selectedEntityId, selectedRelationId: intent.selectedRelationId,
        preserveViewport: !!sameOwner, message: messages[status] } };
}

function createHardwareSession({ protocol, chooseInput, selectBuild, selectSourceEntry, openSource, exportSvg, saveState,
    sourceSession, copyDiagnostics = async () => ({ status: 'unsupported' }), openSettings = async () => ({ status: 'unsupported' }),
    getRestoreState = () => null, onInput = () => {}, onCurrent = () => {}, onDiagnostic = () => {} }) {
    let input = null, options = {}, current = null, selectedBuildId = null, disposed = false, loadGeneration = 0, loading = null;
    let pendingInput = null;
    const preparedDesigns = new Map();
    let commitRevision = 0, commitSessionId = null, saves = Promise.resolve();
    const active = new Set(), events = [], issuedQueries = new Set();
    const counts = Object.create(null);
    function record(event) {
        const row = { at: Date.now(), ...event }; events.push(row); if (events.length > 256) events.shift();
        onDiagnostic(row);
    }
    function live(ctx) {
        if (disposed || ctx.signal.aborted || !ctx.isCurrent()) throw failure('CANCELLED', 'Native session operation cancelled');
    }
    const catalog = () => input?.catalog.map(query => query.getCatalogEntry()) || [];
    const registeredInputs = () => [...new Set([input, pendingInput?.input, ...[...preparedDesigns.values()].map(entry => entry.input)].filter(Boolean))];
    const designs = () => input?.summary.sourceEntries || [...preparedDesigns.values()].find(entry => entry.input.summary.sourceEntries)?.input.summary.sourceEntries || [];
    function sourceDesign(entryId) {
        const matches = [{ input, options }, ...preparedDesigns.values()].filter(entry => entry.input?.summary.sourceEntries?.some(design => design.id === entryId));
        if (!matches.length || new Set(matches.map(entry => `${entry.options.sourceRoot}\0${entry.input.summary.sourceSetIdentity}`)).size !== 1)
            throw failure('FORBIDDEN', 'Source design is not uniquely registered in this workspace');
        return { entry: matches[0].input.summary.sourceEntries.find(entry => entry.id === entryId), options: matches[0].options };
    }
    function queryFor(buildId) {
        const query = input?.catalog.find(query => query.getCatalogEntry().buildId === buildId)
            || pendingInput?.input.catalog.find(query => query.getCatalogEntry().buildId === buildId)
            || [...preparedDesigns.values()].flatMap(entry => entry.input.catalog).find(query => query.getCatalogEntry().buildId === buildId);
        if (!query) throw failure('FORBIDDEN', 'Build is not registered in this native session');
        return query;
    }
    function checkSnapshot(ctx) {
        const value = ctx.input.snapshotId;
        const registered = registeredInputs();
        if (value === null && (!current || registered.some(input => !input.importResult))) return;
        if (!registered.flatMap(input => [input.importResult?.snapshot.id, input.originCase?.request.importResult.snapshot.id]).filter(Boolean).includes(value)) {
            throw failure('SNAPSHOT_MISMATCH', 'Native envelope snapshot is not registered');
        }
    }
    function publishCurrent(value) { current = value; selectedBuildId = value?.buildId || selectedBuildId; onCurrent(value); }
    async function replace(action, ctx, payload = {}) {
        const generation = ++loadGeneration;
        const newHistory = payload.newHistory === true;
        loading?.controller.abort();
        const controller = new AbortController(), abort = () => controller.abort();
        ctx.signal.addEventListener('abort', abort, { once: true });
        if (ctx.signal.aborted) abort();
        const entry = { controller, promise: null }; loading = entry;
        const operationCurrent = () => { live(ctx); if (generation !== loadGeneration || controller.signal.aborted) throw failure('CANCELLED', 'Input selection was superseded'); };
        entry.promise = (async () => {
            const candidate = await interruptible(chooseInput(action, structuredClone(options), { signal: controller.signal, ...payload }), controller.signal); operationCurrent();
            if (!candidate) return { status: 'cancelled', preserved: !!input };
            fields(candidate, ['sourceRoot', 'artifactRoot', 'rootGrants', 'manifest', 'artifactPath', 'originApproved', 'manifestFile', 'manifestHash', 'pendingOriginManifest', 'discovery', 'sourceEntry', 'independentArtifact'], 'host input options');
            if (candidate.independentArtifact !== undefined && candidate.independentArtifact !== true) throw failure('INVALID_INPUT', 'Invalid independent artifact intent');
            let chosen = copyJson(candidate, { ...DEFAULT_LIMITS, maxBytes: 1048576, maxJsonDepth: 20, maxJsonNodes: 40000 });
            const cached = action === 'choose-design' && [...preparedDesigns.values()].find(entry =>
                (!input?.summary.sourceSetIdentity || entry.input.summary.sourceSetIdentity === input.summary.sourceSetIdentity)
                && entry.options.sourceRoot === chosen.sourceRoot && stable(entry.options.sourceEntry) === stable(chosen.sourceEntry));
            if (cached) for (const source of cached.input.sources) {
                operationCurrent();
                if ((await cached.input.registry.readSource(source)).status !== 'current') throw failure('STALE_SOURCE', 'Prepared design sources changed; refresh the workspace first');
            }
            let selectionRequired = null, proposed;
            try { proposed = cached ? cached.input : await loadNativeInput({ ...chosen, sourceSession,
                ...(chosen.discovery && selectSourceEntry ? { selectSourceEntry: async (entries, context) => {
                    const selected = await selectSourceEntry(entries, { ...context, preferred: options.sourceEntry });
                    operationCurrent();
                    if (!selected) selectionRequired = { status: 'selection-required', sourceFiles: chosen.manifest.sources.length,
                        designs: context.indexStatus.totalEntries, preserved: !!current };
                    return selected;
                } } : {}),
                signal: controller.signal, onProgress: event => {
                record({ action, phase: event.phase, ...(event.threadId === undefined ? {} : { threadId: event.threadId }),
                    ...(event.exitCode === undefined ? {} : { exitCode: event.exitCode, cancelled: !!event.cancelled }) });
            } }); } catch (error) {
                if (!selectionRequired || error.code !== 'CANCELLED') throw error;
                operationCurrent();
                ctx.afterReply(() => {
                    if (!disposed && generation === loadGeneration && !controller.signal.aborted && ctx.isCurrent())
                        protocol.event('source-selection', selectionRequired);
                });
                return selectionRequired;
            }
            operationCurrent();
            if (proposed.selectedSourceEntry) chosen = { ...chosen, sourceEntry: proposed.selectedSourceEntry };
            if ((action === 'choose-design' || chosen.independentArtifact) && (newHistory || !preparedDesigns.has(proposed.inputIdentity))) {
                const candidateBytes = Buffer.byteLength(JSON.stringify(proposed.analysis || proposed.importResult));
                if (candidateBytes > 67108864) throw failure('LIMIT_EXCEEDED', 'Prepared design exceeds its bounded byte limit.');
                const bytes = (newHistory ? 0 : [...preparedDesigns.values()].reduce((sum, entry) => sum + entry.bytes, 0))
                    + candidateBytes;
                if (!newHistory && preparedDesigns.size >= 8 || bytes > 67108864) throw failure('LIMIT_EXCEEDED', 'Prepared design history reached its bounded limit. Reopen Hardware Schematic to start a new design history.');
            }
            if (!newHistory && chosen.discovery && proposed.inputIdentity === input?.inputIdentity) {
                pendingInput = null; options = chosen;
                input.summary.discovery = proposed.summary.discovery;
                for (const prepared of preparedDesigns.values()) prepared.options = { ...prepared.options, discovery: chosen.discovery };
                return { status: 'unchanged', inputIdentity: input.inputIdentity, discovery: proposed.summary.discovery };
            }
            const entries = proposed.catalog.map(query => query.getCatalogEntry());
            const previousEntry = input?.catalog.find(query => query.getCatalogEntry().buildId === selectedBuildId)?.getCatalogEntry();
            const sourceLocation = (model, id) => model?.instances.find(instance => instance.id === id)?.sourceRange?.uri;
            const retained = chosen.discovery && previousEntry && chosen.sourceRoot === options.sourceRoot
                ? entries.filter(entry => entry.rootInstanceId === previousEntry.rootInstanceId
                    && sourceLocation(input.sourceModel, previousEntry.rootInstanceId)
                    && sourceLocation(input.sourceModel, previousEntry.rootInstanceId) === sourceLocation(proposed.sourceModel, entry.rootInstanceId)) : [];
            const picked = retained.length === 1 ? retained[0].buildId : entries.length === 1 ? entries[0].buildId : entries.length
                ? await interruptible(selectBuild(entries, { signal: controller.signal }), controller.signal) : null;
            operationCurrent();
            if (entries.length && !picked) return { status: 'cancelled', preserved: !!input };
            if (picked && !entries.some(entry => entry.buildId === picked)) throw failure('FORBIDDEN', 'Selected build is not a registered root');
            let restoreState = null;
            try {
                const stored = newHistory ? null : await getRestoreState(proposed, picked); operationCurrent();
                if (stored) {
                    fields(stored, ['schema', 'inputIdentity', 'view', 'sourceEntry'], 'restored state');
                    if (stored.inputIdentity !== proposed.inputIdentity || stored.view?.buildId !== picked) throw failure('STALE_SOURCE', 'Restored input identity differs');
                    if (stored.sourceEntry && stable(stored.sourceEntry) !== stable(proposed.selectedSourceEntry)) throw failure('SOURCE_REVISION_MISMATCH', 'Restored source design differs');
                    restoreState = stateValue({ schema: stored.schema, view: stored.view });
                    const restoredQuery = proposed.catalog.find(query => query.getCatalogEntry().buildId === picked);
                    const scene = restoredQuery.getScene(intentFor(restoreState.view)).scene;
                    if (restoreState.view.sourceRevision !== scene.sourceRevision) throw failure('SOURCE_REVISION_MISMATCH', 'Restored source revision differs');
                    if (restoreState.view.query) {
                        const requested = restoreState.view.query, context = restoredQuery.getAnalysisContext(requested.implementationProvider);
                        if (requested.analysisId !== context.analysisId || requested.snapshotId !== context.snapshotId) throw failure('SNAPSHOT_MISMATCH', 'Restored query context differs');
                    }
                }
            } catch (error) {
                operationCurrent(); restoreState = null; record({ action, phase: 'restore-rejected', code: error.code || 'INVALID_INPUT' });
            }
            await protocol.abortExcept(ctx.input.requestId); operationCurrent();
            if ((chosen.discovery || chosen.independentArtifact) && input && current) {
                const replaceMode = newHistory ? 'refresh' : chosen.independentArtifact ? 'artifact' : action === 'choose-design' ? 'design' : 'refresh', previousInputIdentity = input.inputIdentity;
                const refresh = newHistory ? { newHistory: true, refreshTarget: { preserveViewport: false } }
                    : replaceMode === 'refresh' ? refreshedVisit(input, proposed, current, picked) : {};
                operationCurrent();
                pendingInput = { input: proposed, options: chosen, selectedBuildId: picked, replaceMode };
                protocol.generation++;
                ctx.afterReply(() => protocol.event('catalog', { catalog: entries, selectedBuildId: picked,
                    inputStatus: proposed.summary.status, summary: proposed.summary, discovery: proposed.summary.discovery,
                    designs: proposed.summary.sourceEntries || designs(), selectedDesignId: proposed.summary.selectedDesignId || null,
                    replaceMode, previousInputIdentity, ...refresh,
                    message: 'Updated sources are ready. Opening the current module…' }));
                return { status: 'prepared', inputIdentity: proposed.inputIdentity, selectedBuildId: picked };
            }
            const previous = { input, options, selectedBuildId, current };
            input = proposed; options = chosen; selectedBuildId = picked; current = null;
            try { await onInput(input, options, picked); operationCurrent(); }
            catch (error) {
                ({ input, options, selectedBuildId, current } = previous);
                try { await onInput(input, options, selectedBuildId); } catch (_) { record({ action, phase: 'restore-listeners-failed' }); }
                throw error;
            }
            pendingInput = null; preparedDesigns.clear(); issuedQueries.clear(); commitRevision = 0; commitSessionId = null; protocol.generation++; onCurrent(null);
            ctx.afterReply(() => protocol.event('catalog', { catalog: entries, selectedBuildId: picked,
                inputStatus: proposed.summary.status, message: `${proposed.summary.status}: ${proposed.summary.label}`, summary: proposed.summary,
                designs: proposed.summary.sourceEntries || [], selectedDesignId: proposed.summary.selectedDesignId || null,
                ...(proposed.summary.discovery ? { discovery: proposed.summary.discovery } : {}),
                ...(restoreState ? { restoreState } : {}) }));
            return { status: 'registered', inputIdentity: proposed.inputIdentity, selectedBuildId: picked };
        })();
        try { return await entry.promise; }
        finally { ctx.signal.removeEventListener('abort', abort); if (loading === entry) loading = null; }
    }
    async function persist(payload, ctx) {
        fields(payload, ['state', 'revision'], 'persist payload'); const state = stateValue(payload.state), revision = payload.revision;
        if (!Number.isSafeInteger(revision) || revision <= 0) throw failure('INVALID_INPUT', 'Positive native commit revision required');
        if (commitSessionId === ctx.input.sessionId && revision <= commitRevision) throw failure('SUPERSEDED', 'Native commit revision is stale');
        const sessionId = ctx.input.sessionId, view = state.view;
        let committed = null;
        if (view) {
            const query = queryFor(view.buildId), intent = intentFor(view), scene = query.getScene(intent).scene;
            if (view.sourceRevision !== scene.sourceRevision) throw failure('SOURCE_REVISION_MISMATCH', 'Saved view source revision differs');
            for (const field of ['sourceContext', 'implementationContext']) if (view[field]) {
                for (const [key, value] of Object.entries(view[field])) if (stable(value) !== stable(scene[field]?.[key])) {
                    throw failure('INVALID_INPUT', 'Saved context contradicts canonical scene');
                }
            }
            if (view.query && !issuedQueries.has(queryKey(view.buildId, view.query))) throw failure('FORBIDDEN', 'Saved analysis was not issued by this session');
            committed = { ...visitFor(scene, intent), query: view.query || null };
        }
        live(ctx);
        const pending = pendingInput && (view === null && pendingInput.input.catalog.length === 0
            || pendingInput.input.catalog.some(query => query.getCatalogEntry().buildId === view?.buildId)) ? pendingInput : null;
        const candidate = pending || [...preparedDesigns.values()].find(entry => entry.input !== input
            && entry.input.catalog.some(query => query.getCatalogEntry().buildId === view?.buildId));
        if (candidate) {
            try {
                if (pending) for (const source of candidate.input.sources) {
                    live(ctx);
                    if ((await candidate.input.registry.readSource(source)).status !== 'current')
                        throw failure('STALE_SOURCE', 'Prepared source changed before the new scene could be committed');
                }
                if (pending && candidate.input.importResult) {
                    const artifact = candidate.input.importResult.snapshot.artifact;
                    if ((await candidate.input.registry.readArtifact(artifact.pathRef)).contentHash !== artifact.hash)
                        throw failure('STALE_SOURCE', 'Prepared artifact changed before the new scene could be committed');
                    live(ctx);
                }
                await onInput(candidate.input, candidate.options, candidate.selectedBuildId, { retained: !pending }); live(ctx);
                if (pending && pendingInput !== candidate || commitSessionId === sessionId && revision <= commitRevision) throw failure('SUPERSEDED', 'A newer input or visit owns publication');
            } catch (error) {
                try { await onInput(input, options, selectedBuildId, { retained: true }); } catch (_) { record({ action: 'persist', phase: 'restore-listeners-failed' }); }
                if (!['CANCELLED', 'SUPERSEDED', 'STALE_SOURCE', 'SOURCE_REVISION_MISMATCH', 'SNAPSHOT_MISMATCH',
                    'ARTIFACT_HASH_MISMATCH', 'PATH_DENIED', 'FORBIDDEN', 'INVALID_INPUT'].includes(error.code)) {
                    record({ action: 'persist', phase: 'commit-rejected', code: error.code || 'HOST_ERROR', message: String(error.message).slice(0, 1024) });
                    throw failure('COMMIT_REJECTED', 'The new design could not be committed. The previous design is still available.');
                }
                throw error;
            }
            if (candidate.replaceMode === 'refresh') preparedDesigns.clear();
            input = candidate.input; options = candidate.options; selectedBuildId = candidate.selectedBuildId; pendingInput = null;
        }
        if ((input?.selectedSourceEntry || options.independentArtifact) && !preparedDesigns.has(input.inputIdentity)) preparedDesigns.set(input.inputIdentity,
            { input, options, selectedBuildId, replaceMode: options.independentArtifact ? 'artifact' : 'design',
                bytes: Buffer.byteLength(JSON.stringify(input.analysis || input.importResult)) });
        const authority = input;
        commitSessionId = sessionId; commitRevision = revision;
        if (committed || view === null) publishCurrent(committed);
        const latest = () => {
            live(ctx);
            if (input !== authority || protocol.sessionId !== sessionId || commitSessionId !== sessionId || commitRevision !== revision)
                throw failure('SUPERSEDED', 'A newer displayed visit owns native selection');
        };
        const stored = { schema: 1, inputIdentity: input?.inputIdentity || null, view,
            ...(input?.selectedSourceEntry ? { sourceEntry: input.selectedSourceEntry } : {}) };
        saves = saves.catch(() => {}).then(async () => {
            latest();
            try { await saveState(stored); }
            catch (error) { record({ action: 'persist', phase: 'save-failed', revision, code: error.code || 'HOST_ERROR', message: String(error.message).slice(0, 1024) }); throw error; }
        });
        try { await saves; } catch (error) {
            latest();
            throw failure('COMMITTED_UNSAVED', 'The design is open, but its state could not be saved for restart.');
        }
        latest();
        return { status: 'saved' };
    }
    async function route(action, payload, ctx) {
        live(ctx); checkSnapshot(ctx);
        if (action === 'choose-design') {
            fields(payload, ['entryId', 'newHistory'], 'source design');
            if (typeof payload.entryId !== 'string' || payload.entryId.length > 2048) throw failure('INVALID_INPUT', 'Source design identity required');
            if (payload.newHistory !== undefined && typeof payload.newHistory !== 'boolean') throw failure('INVALID_INPUT', 'New history must be a boolean');
            sourceDesign(payload.entryId);
            return replace(action, ctx, payload);
        }
        if (action.startsWith('choose-') || action === 'refresh-input' || action === 'discover-workspace') { fields(payload, [], 'input selection'); return replace(action, ctx); }
        if (action === 'copy-diagnostics') {
            fields(payload, ['viewDiagnostic'], 'copy diagnostics');
            if (payload.viewDiagnostic !== undefined && (typeof payload.viewDiagnostic !== 'string' || Buffer.byteLength(payload.viewDiagnostic) > 16384))
                throw failure('INVALID_INPUT', 'Display diagnostic exceeds its text limit');
            return copyDiagnostics(payload.viewDiagnostic || '');
        }
        if (action === 'open-settings') { fields(payload, [], 'settings'); return openSettings(); }
        if (action === 'catalog') { fields(payload, [], 'catalog'); return catalog(); }
        if (action === 'persist') return persist(payload, ctx);
        if (action === 'export-svg') {
            fields(payload, ['svg', 'suggestedName'], 'SVG export');
            if (typeof payload.svg !== 'string' || Buffer.byteLength(payload.svg) > 1048576 || typeof payload.suggestedName !== 'string') throw failure('INVALID_INPUT', 'Invalid SVG export');
            return exportSvg(payload.svg, payload.suggestedName, { signal: ctx.signal });
        }
        const allowed = { scene: ['buildId', 'intent'], 'analysis-context': ['buildId', 'provider'], analysis: ['buildId', 'query'],
            'analysis-reveal': ['buildId', 'query'], source: ['buildId', 'reference'], 'source-open': ['buildId', 'reference'] };
        if (!allowed[action]) throw failure('FORBIDDEN', 'Unknown native session action');
        fields(payload, allowed[action], action);
        const query = queryFor(payload.buildId);
        if (action === 'analysis-context') return query.getAnalysisContext(payload.provider);
        if (action === 'scene') {
            const intent = json(payload.intent); if (intent.buildId !== payload.buildId) throw failure('FORBIDDEN', 'Contradictory scene build');
            const result = query.getScene(intent); responsePayload(result); live(ctx); return result;
        }
        if (action === 'analysis-reveal') {
            const request = json(payload.query); if (request.buildId !== payload.buildId) throw failure('FORBIDDEN', 'Contradictory reveal build');
            return query.revealAnalysisTarget(request);
        }
        if (action === 'source' || action === 'source-open') {
            const reference = json(payload.reference), result = query.getSource(reference);
            return action === 'source' ? result : openSource(payload.buildId, reference, { signal: ctx.signal });
        }
        const request = json(payload.query);
        const result = await query.analyze(request, { signal: ctx.signal, onProgress: event => record({ action,
            phase: event.phase, threadId: event.threadId ?? null, exitCode: event.exitCode ?? null,
            cancelled: !!event.cancelled, elapsedMs: event.elapsedMs ?? null, cancellationMs: event.cancellationMs ?? null }) });
        responsePayload(result); live(ctx);
        issuedQueries.add(queryKey(payload.buildId, request));
        if (issuedQueries.size > 256) issuedQueries.delete(issuedQueries.values().next().value);
        return result;
    }
    function dispatch(action, payload, ctx) {
        const controller = new AbortController(), abort = () => controller.abort();
        ctx.signal.addEventListener('abort', abort, { once: true }); if (ctx.signal.aborted) abort();
        const entry = { controller, promise: null }; active.add(entry);
        counts[action] = (counts[action] || 0) + 1; const started = performance.now();
        entry.promise = Promise.resolve().then(() => route(action, payload, { ...ctx, signal: controller.signal }))
            .then(result => { record({ action, phase: 'complete', requestId: ctx.input.requestId,
                generation: ctx.input.generation, elapsedMs: performance.now() - started }); return result; })
            .catch(error => { record({ action, phase: 'failed', requestId: ctx.input.requestId,
                generation: ctx.input.generation, code: error.code || 'HOST_ERROR',
                message: String(error.message || error).slice(0, 1024),
                ...(error.stack ? { stack: String(error.stack).slice(0, 4096) } : {}),
                elapsedMs: performance.now() - started }); throw error; })
            .finally(() => { ctx.signal.removeEventListener('abort', abort); active.delete(entry); });
        return entry.promise;
    }
    return { dispatch, getInput: () => input, getCurrent: () => current, getCatalog: catalog, getOptions: () => options,
        getDesigns: designs, getSourceDesign: sourceDesign,
        getDiagnostics: () => ({ disposed, activeOperations: active.size, loading: !!loading,
            preparedDesigns: preparedDesigns.size, preparedDesignBytes: [...preparedDesigns.values()].reduce((sum, entry) => sum + entry.bytes, 0),
            pendingInputIdentity: pendingInput?.input.inputIdentity || null, counts: { ...counts }, events: [...events], selectedBuildId, commitRevision }),
        async dispose() {
            disposed = true; loadGeneration++; loading?.controller.abort();
            const pending = [...active]; for (const item of pending) item.controller.abort();
            await Promise.allSettled(pending.map(item => item.promise));
            input = null; pendingInput = null; preparedDesigns.clear(); options = {}; current = null; issuedQueries.clear();
        } };
}
module.exports = { createHardwareSession };
