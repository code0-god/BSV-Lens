'use strict';

const { hash, failure, stable } = require('../hardware/json');
const { normalizeRange } = require('../hardware/correspondence/source');
const { createArchitecture } = require('../hardware/architecture');
const { buildSourceReferenceIndex, findSourceReferenceAtPosition } = require('../architecture/semantic/source-references');
const capturedScheme = 'bsv-hardware-capture';
const selectionContext = current => stable(current && Object.fromEntries(['buildId', 'snapshotId', 'sourceRevision',
    'sceneKind', 'provider', 'rootInstanceId', 'ownerInstanceId', 'selectedEntityId', 'selectedRelationId',
    'sourceContext', 'implementationContext', 'query'].map(key => [key, current[key]])));

function createHardwareSource({ vscode, sessionId, getInput, getQuery, getCurrent, onReveal,
    onStatus = () => {}, onDiagnostic = () => {}, isCurrent = () => true }) {
    const captures = new Map(), indexes = new WeakMap();
    let disposed = false, generation = 0, selectionGeneration = 0, opening = false, echo = null, lastSelection = null;
    const alive = (input, ticket) => !disposed && generation === ticket && getInput() === input && isCurrent();
    function assertAlive(input, ticket, signal) {
        if (signal?.aborted || !alive(input, ticket)) throw failure('CANCELLED', 'Source request is no longer current');
    }
    function status(value, message) { const result = { status: value, message }; onStatus(result); return result; }
    async function registered(input, source) {
        const result = await input.registry.readSource({ pathRef: source.pathRef, contentHash: source.revision });
        if (result.currentError?.code === 'PATH_DENIED' || result.reason?.code === 'PATH_DENIED') {
            throw failure('PATH_DENIED', 'Registered source path no longer has read authority');
        }
        return result;
    }
    async function open(buildId, reference, { signal } = {}) {
        const input = getInput(), ticket = ++generation;
        opening = false; echo = null;
        assertAlive(input, ticket, signal);
        const ref = await getQuery(buildId).getSource(reference);
        assertAlive(input, ticket, signal);
        const source = input.sources.find(row => row.pathRef === ref.pathRef && row.revision === ref.revision);
        if (!source) throw failure('PATH_DENIED', 'Source reference has no registered editor input');
        assertAlive(input, ticket, signal);
        const verified = await registered(input, source);
        assertAlive(input, ticket, signal);
        let document, historical = verified.status !== 'current';
        opening = true;
        try {
            if (!historical) {
                assertAlive(input, ticket, signal);
                document = await vscode.workspace.openTextDocument(vscode.Uri.file(source.path));
                assertAlive(input, ticket, signal);
                const rechecked = await registered(input, source);
                assertAlive(input, ticket, signal);
                historical = rechecked.status !== 'current' || hash(document.getText()) !== ref.revision;
            }
            if (historical) {
                if (typeof source.capturedText !== 'string' || hash(source.capturedText) !== ref.revision) {
                    return status('stale', 'Source changed; no verified captured revision is available.');
                }
                const uri = vscode.Uri.parse(`${capturedScheme}://${encodeURIComponent(sessionId)}/${ref.revision}/${encodeURIComponent(ref.pathRef)}?historical=1`);
                captures.set(uri.toString(), source.capturedText);
                assertAlive(input, ticket, signal);
                document = await vscode.workspace.openTextDocument(uri);
                assertAlive(input, ticket, signal);
            }
            if (hash(document.getText()) !== ref.revision) throw failure('SOURCE_REVISION_MISMATCH', 'Editor text differs from verified source revision');
            const range = normalizeRange(document.getText(), { unit: 'utf16', start: ref.range.start, end: ref.range.end });
            if (range.sliceHash !== ref.sliceHash || range.text !== ref.text) throw failure('INVALID_RANGE', 'Editor range differs from canonical source');
            const selection = new vscode.Selection(document.positionAt(range.start), document.positionAt(range.end));
            echo = { uri: document.uri.toString(), version: document.version, start: range.start, end: range.end, until: Date.now() + 2000 };
            assertAlive(input, ticket, signal);
            const editor = await vscode.window.showTextDocument(document, { preview: false, preserveFocus: false,
                ...(vscode.ViewColumn?.One !== undefined ? { viewColumn: vscode.ViewColumn.One } : {}) });
            assertAlive(input, ticket, signal);
            if (hash(document.getText()) !== ref.revision) throw failure('SOURCE_REVISION_MISMATCH', 'Source changed during editor reveal');
            assertAlive(input, ticket, signal);
            editor.selection = selection;
            editor.revealRange(selection, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
            const diagnostic = { action: 'source-open', buildId, sessionId, status: historical ? 'captured' : 'current',
                sourceKind: source.sourceKind || 'original-bsv', historical, pathRef: ref.pathRef, revision: ref.revision,
                uri: document.uri.toString(), documentVersion: document.version, documentHash: hash(document.getText()),
                documentDirty: document.isDirty, range: { start: range.start, end: range.end },
                selection: { start: { line: selection.start.line, character: selection.start.character },
                    end: { line: selection.end.line, character: selection.end.character } }, text: document.getText(selection) };
            onDiagnostic(diagnostic);
            onStatus({ status: diagnostic.status, message: historical ? 'Historical captured BSV source (read-only); current source differs.' : 'Current original BSV source.' });
            return diagnostic;
        } finally { if (generation === ticket) opening = false; }
    }
    function context(input) {
        if (!indexes.has(input)) indexes.set(input, { index: buildSourceReferenceIndex(input.sourceModel),
            architecture: createArchitecture({ importResult: input.importResult, analysis: input.analysis }) });
        return indexes.get(input);
    }
    function candidates(input, reference, index, architecture) {
        const ids = new Set([
            ...(index.occurrenceIdsByDefinitionId.get(reference.id) || []),
            ...(index.occurrenceIdsByInstanceDeclarationId.get(reference.id) || []),
            ...(index.endpointIdsByInterfaceMethodId.get(reference.id) || [])
        ]);
        for (const entity of Object.values(architecture.entities)) {
            if (entity.ownerInstanceId && entity.definitionId === reference.id || entity.sourceRefs.some(ref => ref.semanticId === reference.id)) ids.add(entity.id);
        }
        const result = [];
        for (const id of ids) {
            const entity = architecture.entities[id];
            if (!entity) continue;
            let owners = entity.ownerInstanceId ? [entity.ownerInstanceId] : [];
            if (!owners.length) owners = input.sourceModel.stateBehaviors.filter(behavior => behavior.definitionId === entity.definitionId).map(behavior => behavior.ownerInstanceId);
            for (const owner of new Set(owners)) {
                if (!architecture.occurrences[owner]) continue;
                const value = { entityId: id, ownerInstanceId: owner, label: entity.label,
                    description: architecture.occurrences[owner].path, sourceKind: reference.kind, semanticId: reference.id };
                if (!result.some(row => row.entityId === id && row.ownerInstanceId === owner)) result.push(value);
            }
        }
        return result;
    }
    function rootOf(architecture, id) {
        let current = architecture.occurrences[id];
        while (current?.parentInstanceId) current = architecture.occurrences[current.parentInstanceId];
        return current?.id;
    }
    async function handleSelection(event) {
        const input = getInput(), current = getCurrent(), editor = event?.textEditor;
        if (disposed || opening || !isCurrent() || !input?.sourceModel || !current || !editor) return;
        const document = editor.document, selection = event.selections?.[0];
        if (!selection || document.uri.scheme !== 'file') return;
        const source = input.sources.find(row => vscode.Uri.file(row.path).toString() === document.uri.toString());
        if (!source) return;
        const start = document.offsetAt(selection.start), end = document.offsetAt(selection.end);
        const userEvent = event.kind === vscode.TextEditorSelectionChangeKind.Keyboard || event.kind === vscode.TextEditorSelectionChangeKind.Mouse;
        if (echo && !userEvent && echo.until >= Date.now() && echo.uri === document.uri.toString() && echo.version === document.version && echo.start === start && echo.end === end) {
            echo = null; return;
        }
        echo = null;
        const contextKey = selectionContext(current);
        const key = JSON.stringify([document.uri.toString(), document.version, start, end, contextKey]);
        if (lastSelection === key) return;
        lastSelection = key;
        const ticket = generation, selectedTicket = ++selectionGeneration, version = document.version, text = document.getText();
        const selectionCurrent = () => alive(input, ticket) && selectedTicket === selectionGeneration && document.version === version
            && selectionContext(getCurrent()) === contextKey;
        if (hash(text) !== source.revision) return status('stale', 'Editor buffer differs from the registered source revision. Re-register inputs to analyze changes.');
        const verified = await registered(input, source);
        if (!selectionCurrent()) return;
        if (verified.status !== 'current') return status('stale', 'Registered source is no longer current.');
        const { index, architecture } = context(input);
        const modelDocument = input.sourceModel.sourceDocuments.find(row => row.relativePath === source.pathRef && row.revision === source.revision);
        if (!modelDocument) return status('unsupported', 'Source document is not part of this source model.');
        const match = findSourceReferenceAtPosition(index, { uri: modelDocument.id, line: selection.active.line, column: selection.active.character });
        const all = match.references.flatMap(ref => candidates(input, ref, index, architecture));
        const scopeRoot = rootOf(architecture, current.ownerInstanceId);
        let choices = all.filter(candidate => rootOf(architecture, candidate.ownerInstanceId) === scopeRoot);
        if (!choices.length) return status(all.length ? 'outside-scope' : 'unsupported', all.length ? 'Source belongs to a different root; select that input root explicitly.' : 'No supported schematic target for this source selection.');
        if (current.sceneKind === 'rtl') return status('available-in-bsv', 'Source target is available in the BSV view; return to BSV explicitly.');
        const owned = choices.filter(candidate => candidate.ownerInstanceId === current.ownerInstanceId);
        if (owned.length) choices = owned;
        const unique = new Map(choices.map(candidate => [`${candidate.ownerInstanceId}:${candidate.entityId}`, candidate]));
        choices = [...unique.values()];
        const picked = choices.length === 1 ? choices[0] : await vscode.window.showQuickPick(choices, { title: 'BSV source occurrence', placeHolder: 'Choose the actual occurrence to reveal' });
        if (!picked || !selectionCurrent()) return;
        const intent = { sceneKind: 'bsv', implementationProvider: 'stock', rootInstanceId: picked.ownerInstanceId, ownerInstanceId: picked.ownerInstanceId,
            selectedEntityId: picked.entityId, selectedRelationId: null };
        getQuery(current.buildId).getScene({ ...intent, buildId: current.buildId,
            snapshotId: input.importResult?.snapshot.id ?? null, queryGeneration: 0 });
        const result = { buildId: current.buildId, intent, source: { pathRef: source.pathRef, revision: source.revision, semanticId: picked.semanticId } };
        await onReveal(result);
        onDiagnostic({ action: 'source-selection', ...result, uri: document.uri.toString(), documentVersion: document.version,
            documentHash: hash(text), range: { start, end }, selectedEntityId: picked.entityId });
        return result;
    }
    return { open, handleSelection, capturedScheme,
        capturedProvider: { provideTextDocumentContent(uri) {
            if (disposed || !captures.has(uri.toString())) throw failure('PATH_DENIED', 'Unknown captured source document');
            return captures.get(uri.toString());
        } },
        dispose() { disposed = true; generation++; opening = false; captures.clear(); echo = null; lastSelection = null; }
    };
}

module.exports = { createHardwareSource, capturedScheme };
