'use strict';
const path = require('node:path');
const { HardwareProtocol } = require('./hardware-protocol');
const { getHardwareBuild } = require('./hardware-build');
const { hardwareHtml } = require('./hardware-html');
const { createHardwareSession } = require('./hardware-session');
const { createHardwareSource, capturedScheme } = require('./hardware-source');
const { createArtifactRegistry } = require('../hardware');
const { checkedJson } = require('../hardware/correspondence/schema');
const { DEFAULT_LIMITS, failure, hash } = require('../hardware/json');
const { grantDirectory, grantSubdirectory, verifyDirectoryGrant } = require('./hardware-authority');
const { discoverWorkspace, watchWorkspace } = require('./hardware-discovery');
const { createSourceSession } = require('../hardware/correspondence');
const { translate } = require('../../media/hardware-strings');
const { discoverArtifactCandidates } = require('./hardware-artifact-candidates');
const VIEW_TYPE = 'bsvArchitecture.hardwareSchematic';
const COMMAND = 'bsvArchitecture.openHardwareSchematic';
const relativePath = value => typeof value === 'string' && value.length <= 2048 && !path.isAbsolute(value)
    && !value.includes('\\') && value.split('/').every(part => part && part !== '..' && part !== '.');
const plain = value => JSON.parse(JSON.stringify(value));

function createHardwarePanels({ vscode, context, output }) {
    const t = (key, values) => translate(vscode.env.language || 'en', key, values);
    const panels = new Map(), captures = new Map(), retired = [], closing = new Set();
    let disposed = false, activeKey = null, disposal = null;
    const provider = vscode.workspace.registerTextDocumentContentProvider(capturedScheme, {
        provideTextDocumentContent(uri) {
            const adapter = captures.get(decodeURIComponent(uri.authority));
            if (!adapter) throw failure('PATH_DENIED', 'Captured session is no longer available');
            return adapter.capturedProvider.provideTextDocumentContent(uri);
        }
    });
    function supported() {
        if (vscode.env.remoteName || vscode.env.uiKind === vscode.UIKind.Web)
            throw failure('UNSUPPORTED', 'Hardware Schematic currently supports local desktop file workspaces only.');
    }
    async function rootChoice(title, preferred, signal) {
        const folders = (vscode.workspace.workspaceFolders || []).filter(folder => folder.uri.scheme === 'file');
        const choices = folders.map(folder => ({ label: folder.name, description: folder.uri.fsPath, root: folder.uri.fsPath }));
        if (preferred && !choices.some(choice => choice.root === preferred)) choices.unshift({ label: 'Registered root', description: preferred, root: preferred });
        choices.push({ label: 'Choose another folder…', browse: true });
        const selected = await vscode.window.showQuickPick(choices, { title, placeHolder: 'Explicitly approve this root for bounded data reads' });
        if (disposed || signal?.aborted || !selected) return null;
        if (selected.root) return grantDirectory(selected.root);
        const picked = await vscode.window.showOpenDialog({ title, canSelectFiles: false, canSelectFolders: true, canSelectMany: false });
        if (disposed || signal?.aborted || !picked?.[0]) return null;
        if (picked[0].scheme !== 'file') throw failure('UNSUPPORTED', 'Only local file roots are supported');
        return grantDirectory(picked[0].fsPath);
    }
    async function relativeInput(title, root, folder, signal) {
        const value = await vscode.window.showInputBox({ title, prompt: `Path relative to approved root: ${root}`,
            value: folder ? '.' : '', ignoreFocusOut: true,
            validateInput: text => folder && text === '.' || relativePath(text) ? null : 'Enter a relative path inside the approved root.' });
        if (disposed || signal?.aborted || value === undefined) return null;
        return value;
    }
    function theme() { return ({ 1: 'light', 2: 'dark', 3: 'high-contrast', 4: 'high-contrast' })[vscode.window.activeColorTheme.kind] || 'dark'; }
    async function make(panel, key, restored, folder = null) {
        if (disposed) { panel.dispose(); throw failure('CANCELLED', 'Hardware panels disposed'); }
        const build = getHardwareBuild(context.extensionPath), events = [], watchers = [];
        const sourceSession = createSourceSession();
        let current = null, source = null, sourceSessionId = null, closed = false, session, closePromise, discoveryWatcher = null;
        const discoveryChanges = new Set(); let fullDiscovery = true, discoveryRevision = 0;
        const discoveryAvailable = () => !!folder && !closed
            && vscode.workspace.getConfiguration?.('bsvArchitecture', folder.uri).get('hardwareAutoDiscover', true) !== false;
        const diagnostic = value => {
            const { text, ...safe } = value;
            const event = { ...safe, ...(typeof text === 'string' ? { textHash: hash(text), textBytes: Buffer.byteLength(text) } : {}) };
            events.push({ time: Date.now(), ...plain(event) }); if (events.length > 256) events.shift();
            output.appendLine(`Hardware Schematic: ${JSON.stringify(event)}`);
        };
        const protocol = new HardwareProtocol({ build, send: message => panel.webview.postMessage(message), diagnostic,
            dispatch: (...args) => session.dispatch(...args),
            welcome: () => ({ build, catalog: session.getCatalog(), selectedBuildId: current?.buildId || null,
                theme: theme(), inputStatus: session.getInput()?.summary.status || 'no-input',
                message: session.getInput() ? `${session.getInput().summary.status}: ${session.getInput().summary.label}` : 'Choose source or artifact inputs. No compiler is run.',
                restoreState: session.getInput() ? restored : null,
                discoveryAvailable: discoveryAvailable(), discovery: session.getInput()?.summary.discovery || null,
                designs: session.getDesigns(), selectedDesignId: session.getInput()?.summary.selectedDesignId || null }),
            reset: id => {
                if (sourceSessionId) captures.delete(sourceSessionId); source?.dispose(); sourceSessionId = id;
                source = createHardwareSource({ vscode, sessionId: id, getInput: () => session.getInput(),
                    getQuery: buildId => {
                        const query = session.getInput()?.catalog.find(query => query.getCatalogEntry().buildId === buildId);
                        if (!query) throw failure('FORBIDDEN', 'Unknown registered source build'); return query;
                    }, getCurrent: () => current, isCurrent: () => !closed && protocol.sessionId === id && activeKey === key,
                    onReveal: payload => protocol.event('reveal', payload),
                    onStatus: value => protocol.event('status', value), onDiagnostic: diagnostic });
                captures.set(id, source);
            }
        });
        function startDiscoveryWatch() {
            if (discoveryWatcher || !folder) return;
            discoveryWatcher = watchWorkspace({ vscode, folder, onInvalidated: event => {
                discoveryRevision++; event.changedFiles.forEach(name => discoveryChanges.add(name));
                if (['configuration-changed', 'workspace-folders-changed'].includes(event.reason)) fullDiscovery = true;
                const notice = { ...event, autoRefresh: event.autoRefresh && !!session.getOptions().discovery };
                diagnostic({ phase: 'discovery-invalidated', ...notice }); protocol.event('discovery-invalidated', notice);
            } });
        }
        async function chooseInput(action, previous, { signal, entryId }) {
            supported();
            if (action === 'choose-design') {
                const { entry, options } = session.getSourceDesign(entryId);
                return { ...options, sourceEntry: { pathRef: entry.pathRef, revision: entry.revision, definitionId: entry.definitionId } };
            }
            if (action === 'discover-workspace' || action === 'refresh-input' && previous.discovery) {
                if (!discoveryAvailable()) throw failure('FORBIDDEN', 'Automatic source discovery is not enabled for this workspace');
                startDiscoveryWatch();
                const changedFiles = !fullDiscovery && discoveryChanges.size ? [...discoveryChanges] : null;
                const revision = discoveryRevision; discoveryChanges.clear(); fullDiscovery = false;
                const candidate = await discoverWorkspace({ vscode, folder, signal, previous: previous.discovery, changedFiles,
                    onProgress: event => { diagnostic({ action, ...event }); protocol.event('discovery-progress', { ...event, message: t(event.message) }); } });
                if (revision !== discoveryRevision) throw failure('STALE_SOURCE', 'Sources changed during discovery; retrying the current revision is required');
                candidate.discovery.invalidationRevision = revision; return candidate;
            }
            if (action === 'refresh-input') return previous;
            const sourceWorkspace = !!previous.discovery || !!previous.independentArtifact;
            delete previous.discovery; delete previous.sourceEntry; delete previous.independentArtifact;
            if (action === 'choose-origin') {
                const originManifest = previous.pendingOriginManifest || previous.manifest;
                if (!originManifest?.origin) throw failure('INVALID_INPUT', 'Choose a manifest containing an instrumented origin capture first.');
                const answer = await vscode.window.showWarningMessage('Approve this separately registered instrumented capture for the supported known-contributor provider? This does not establish a complete origin set.',
                    { modal: true }, 'Approve captured provider');
                return !signal.aborted && answer === 'Approve captured provider' ? { ...Object.fromEntries(Object.entries(previous).filter(([key]) => key !== 'pendingOriginManifest')), manifest: originManifest, originApproved: true } : null;
            }
            if (action === 'choose-source') {
                const base = await rootChoice('Choose source authority root', previous.sourceRoot, signal); if (!base) return null;
                const relative = await relativeInput('Source folder', base.path, true, signal); if (relative === null) return null;
                const grant = await grantSubdirectory(base, relative);
                return { ...previous, sourceRoot: grant.path, rootGrants: { ...previous.rootGrants, sourceRoot: grant } };
            }
            const artifactGrant = await rootChoice('Choose artifact authority root', previous.artifactRoot, signal); if (!artifactGrant) return null;
            const artifactRoot = artifactGrant.path, rootGrants = { ...previous.rootGrants, artifactRoot: artifactGrant };
            if (action === 'choose-artifact') {
                const found = await discoverArtifactCandidates({ grant: artifactGrant, signal });
                diagnostic({ phase: 'artifact-candidates', ...found }); protocol.event('artifact-candidates', found);
                const choices = found.candidates.map(candidate => ({ label: candidate.filename, description: candidate.path,
                    detail: `${candidate.format} · ${candidate.bytes} bytes · ${candidate.modules.join(', ')} · ${t('Source correspondence is not established.')}`, candidate }));
                choices.push({ label: t('Choose a different artifact file…'), manual: true });
                const choice = await vscode.window.showQuickPick(choices, { title: t('Connect an RTL result'),
                    placeHolder: t('Choose one result explicitly. Source correspondence is not inferred.') });
                if (!choice || signal.aborted) return null;
                const selectedPath = choice.candidate?.path || await relativeInput('Implementation JSON artifact', artifactRoot, false, signal);
                if (selectedPath === null) return null;
                const descriptor = { path: selectedPath, ...(choice.candidate ? { contentHash: choice.candidate.contentHash } : {}) };
                if (sourceWorkspace) return { artifactRoot, rootGrants: { artifactRoot: artifactGrant },
                    independentArtifact: true, manifest: { version: 1, artifact: descriptor } };
                return { sourceRoot: previous.sourceRoot || null, artifactRoot, rootGrants,
                    manifest: { version: 1, artifact: descriptor, ...(previous.manifest?.sources ? { sources: previous.manifest.sources } : {}) } };
            }
            const relative = await relativeInput(action === 'choose-manifest' ? 'Hardware input manifest' : 'Implementation JSON artifact', artifactRoot, false, signal);
            if (relative === null) return null;
            await verifyDirectoryGrant(artifactGrant);
            const { artifactPath: previousArtifactPath, pendingOriginManifest: pendingOrigin, ...baseOptions } = previous;
            const registry = createArtifactRegistry({ artifactRoots: [artifactRoot], sourceRoots: [], workspaceTrusted: false, resolvedRoots: true });
            await registry.registerArtifact({ pathRef: 'native-input-manifest.json', path: path.join(artifactRoot, relative) });
            const file = await registry.readArtifact('native-input-manifest.json', 1048576);
            let manifest;
            try { manifest = checkedJson(JSON.parse(file.text), { ...DEFAULT_LIMITS, maxBytes: 1048576 }); }
            catch (error) { throw failure(error.code || 'INVALID_INPUT', error.message); }
            if (!baseOptions.sourceRoot && (manifest.sources?.length || manifest.metadata || manifest.origin)) {
                const sourceBase = await rootChoice('Choose source authority root for this bundle', null, signal); if (!sourceBase) return null;
                const relativeSource = await relativeInput('Bundle source folder', sourceBase.path, true, signal); if (relativeSource === null) return null;
                const sourceGrant = await grantSubdirectory(sourceBase, relativeSource);
                baseOptions.sourceRoot = sourceGrant.path; rootGrants.sourceRoot = sourceGrant;
            }
            if ((await registry.readArtifact('native-input-manifest.json', 1048576)).contentHash !== file.contentHash)
                throw failure('STALE_SOURCE', 'Input manifest changed during selection');
            let originApproved = false;
            if (manifest.origin) {
                const answer = await vscode.window.showWarningMessage('This input requests a separately captured instrumented provider. Approve its bounded known-contributor evidence? Complete origin coverage remains unverified.',
                    { modal: true }, 'Approve captured provider', 'Register stock inputs only');
                if (!answer || signal.aborted) return null;
                originApproved = answer === 'Approve captured provider';
                if (!originApproved) { const { origin, sourceBindings, ...stock } = manifest; return { ...baseOptions, artifactRoot,
                    rootGrants, manifest: stock, pendingOriginManifest: manifest, manifestFile: path.join(artifactRoot, relative), manifestHash: file.contentHash, originApproved: false }; }
            }
            await verifyDirectoryGrant(artifactGrant);
            return { ...baseOptions, artifactRoot, rootGrants, manifest, manifestFile: path.join(artifactRoot, relative), manifestHash: file.contentHash, originApproved };
        }
        async function onInput(input, options, _picked, { retained = false } = {}) {
            if (options.discovery && options.discovery.invalidationRevision !== discoveryRevision && !retained)
                throw failure('STALE_SOURCE', 'Sources changed while the next scene was being prepared');
            if (retained && options.discovery && options.discovery.invalidationRevision !== discoveryRevision)
                protocol.event('status', { status: 'stale', message: t('Source changed. This is the captured previous structure; refresh to analyse saved changes.') });
            if (retained && input?.importResult) {
                const artifact = input.importResult.snapshot.artifact;
                let currentHash;
                try { currentHash = (await input.registry.readArtifact(artifact.pathRef)).contentHash; } catch (_) { currentHash = null; }
                if (currentHash !== artifact.hash) {
                    input.summary.freshness = 'stale';
                    protocol.event('status', { status: 'stale', message: t('The artifact changed. This is the previously captured implementation.') });
                }
            }
            if (input && options.manifestFile) {
                await verifyDirectoryGrant(options.rootGrants.artifactRoot);
                const registry = createArtifactRegistry({ artifactRoots: [options.artifactRoot], resolvedRoots: true });
                await registry.registerArtifact({ pathRef: 'input-manifest.json', path: options.manifestFile });
                if ((await registry.readArtifact('input-manifest.json', 1048576)).contentHash !== options.manifestHash)
                    throw failure('STALE_SOURCE', 'Input manifest changed during preparation');
            }
            watchers.splice(0).forEach(watcher => watcher.dispose());
            if (!options.discovery && !options.independentArtifact) { discoveryWatcher?.dispose(); discoveryWatcher = null; }
            if (!input) return;
            if (options.discovery) startDiscoveryWatch();
            const files = [...new Set([...input.watchFiles, ...(options.manifestFile ? [options.manifestFile] : [])])];
            for (const file of files) {
                const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(vscode.Uri.file(path.dirname(file)), path.basename(file)));
                const changed = () => { diagnostic({ phase: 'input-stale', inputIdentity: input.inputIdentity });
                    if (options.discovery) return;
                    protocol.event('status', { status: 'stale', message: 'Registered source or artifact changed. The captured build is retained; refresh inputs explicitly.' }); };
                watcher.onDidChange(changed); watcher.onDidDelete(changed); watcher.onDidCreate(changed); watchers.push(watcher);
            }
        }
        session = createHardwareSession({ protocol, chooseInput, sourceSession, onInput, onCurrent: value => { current = value; }, onDiagnostic: diagnostic,
            selectSourceEntry: async (entries, { signal, preferred, indexStatus }) => {
                const reference = preferred || restored?.sourceEntry;
                const retained = reference && entries.filter(entry => entry.pathRef === reference.pathRef && entry.definitionId === reference.definitionId
                    && (preferred || entry.revision === reference.revision));
                if (retained?.length === 1) return retained[0].id;
                const roots = entries.filter(entry => entry.rootCandidate === true);
                if (!reference && roots.length === 1 && indexStatus?.status !== 'limited') return roots[0].id;
                const selected = await vscode.window.showQuickPick(entries.map(entry => ({ label: entry.label,
                    description: entry.pathRef, detail: t(entry.rootReason === 'uninstantiated'
                        ? 'No parent instance found in the analyzed sources.' : entry.rootReason === 'cycle-fallback'
                            ? 'Source design candidate; hierarchy contains a cycle.' : 'Used inside another source module.'), entryId: entry.id })),
                { title: t('Choose a source design'), placeHolder: indexStatus?.status === 'limited'
                    ? t('Showing {returned} of {total} designs · limit {limit}; narrow the source scope for more.',
                        { returned: indexStatus.returnedEntries, total: indexStatus.totalEntries, limit: indexStatus.entryLimit })
                    : t('Each design is analysed independently; no compiler is run.') });
                return !signal.aborted && selected ? selected.entryId : null;
            },
            copyDiagnostics: async viewDiagnostic => {
                if (viewDiagnostic) diagnostic({ phase: 'client-display-diagnostic', viewDiagnostic });
                const data = { buildId: build.buildId, protocol: protocol.identity(),
                    inputIdentity: session.getInput()?.inputIdentity || null, current,
                    clientReportedDisplayDiagnostic: viewDiagnostic, events: events.map(({ text, message, ...event }) => event) };
                await vscode.env.clipboard.writeText(JSON.stringify(data, null, 2)); return { status: 'copied' };
            },
            openSettings: async () => {
                await vscode.commands.executeCommand('workbench.action.openSettings', '@ext:code0-god.bsv-lens'); return { status: 'opened' };
            },
            selectBuild: async (entries, { signal }) => {
                if (entries.length === 1) return entries[0].buildId;
                const selected = await vscode.window.showQuickPick(entries.map(entry => ({ label: entry.label,
                    description: entry.sceneKind || 'BSV', buildId: entry.buildId })), { title: 'Choose an actual root', placeHolder: 'Independent roots remain independent' });
                return !signal.aborted && selected ? selected.buildId : null;
            }, openSource: async (buildId, reference, { signal }) => {
                if (signal.aborted || !source) throw failure('CANCELLED', 'Native source request cancelled');
                const result = await source.open(buildId, reference, { signal });
                if (!closed && !panel.visible) panel.reveal(vscode.ViewColumn.Two, true);
                return result;
            }, exportSvg: async (svg, suggestedName, { signal }) => {
                if (typeof svg !== 'string' || Buffer.byteLength(svg) > 1048576 || !/<svg\b/.test(svg)
                    || /<\s*(?:script|foreignObject)|\bon\w+\s*=|(?:javascript|file):|(?:href|src)\s*=\s*["'](?:https?:|\/\/)/i.test(svg))
                    throw failure('INVALID_INPUT', 'Unsupported or unsafe SVG export');
                const target = await vscode.window.showSaveDialog({ title: 'Export hardware scene SVG', filters: { SVG: ['svg'] } });
                if (!target || signal.aborted) return { status: 'cancelled' };
                if (target.scheme !== 'file') throw failure('UNSUPPORTED', 'Only local SVG export is supported');
                await vscode.workspace.fs.writeFile(target, Buffer.from(svg)); return { status: 'complete' };
            }, getRestoreState: () => restored || null,
            saveState: state => { restored = state; return context.workspaceState.update(`bsvArchitecture.hardwareSchematic.v1:${key}`, state); }
        });
        panel.webview.options = { enableScripts: true, localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'media')] };
        const subscriptions = [panel.webview.onDidReceiveMessage(message => protocol.receive(message)),
            panel.onDidChangeViewState(() => { if (panel.active) activeKey = key; }),
            vscode.window.onDidChangeTextEditorSelection(event => {
                if (activeKey === key && panel.visible && vscode.workspace.getConfiguration?.('bsvArchitecture', folder?.uri).get('syncWithEditor', true) !== false)
                    source?.handleSelection(event).catch(error => diagnostic({ phase: 'source-selection-error', code: error.code || 'HOST_ERROR' }));
            }),
            vscode.workspace.onDidChangeTextDocument(event => {
                if (event.document.uri.scheme === 'file' && session.getInput()?.sources.some(item => item.path === event.document.uri.fsPath))
                    protocol.event('status', { status: event.document.isDirty ? 'dirty-source' : 'stale',
                        message: t(event.document.isDirty
                            ? 'Unsaved edits are present. The structure uses saved source; old ranges are not applied to changed text.'
                            : 'Saved source changed. The previous structure remains available while the source index refreshes.') });
            }), vscode.window.onDidChangeActiveColorTheme(() => protocol.event('theme', { theme: theme() }))];
        const entry = { panel, key, build, protocol, session,
            diagnostics: () => ({ key, visible: panel.visible, active: panel.active, closed,
                build: { ...build, files: undefined, extensionPath: context.extensionPath,
                    extensionMode: { 1: 'installed', 2: 'development', 3: 'test' }[context.extensionMode],
                    vscodeVersion: vscode.version, versions: process.versions, platform: process.platform, arch: process.arch, remoteName: vscode.env.remoteName || null },
                protocol: protocol.identity(), state: session.getDiagnostics(), current,
                discovery: session.getInput()?.summary.discovery || null, discoveryWatchers: discoveryWatcher?.diagnostics() || null,
                watchers: watchers.length, events: [...events] }),
            dispose() {
                if (closePromise) return closePromise; closed = true; panels.delete(key);
                if (sourceSessionId) captures.delete(sourceSessionId); source?.dispose();
                discoveryWatcher?.dispose(); discoveryWatcher = null;
                watchers.splice(0).forEach(item => item.dispose()); subscriptions.splice(0).forEach(item => item.dispose());
                closePromise = Promise.allSettled([protocol.dispose(), session.dispose(), sourceSession.dispose()]).then(() => {
                    retired.push({ key, protocol: protocol.identity(), state: session.getDiagnostics(), watchers: watchers.length, listeners: subscriptions.length });
                    if (retired.length > 16) retired.shift();
                }).finally(() => closing.delete(closePromise));
                closing.add(closePromise); return closePromise;
            } };
        panels.set(key, entry); activeKey = key; subscriptions.push(panel.onDidDispose(() => entry.dispose()));
        panel.webview.html = hardwareHtml(panel.webview, context.extensionUri, vscode, build);
        return entry;
    }
    async function open() {
        if (disposed) return; supported();
        const folders = vscode.workspace.workspaceFolders || [];
        const folder = folders.length > 1 ? await vscode.window.showWorkspaceFolderPick({ placeHolder: 'Hardware Schematic workspace' }) : folders[0];
        if (disposed || folders.length > 1 && !folder) return;
        if (folder && folder.uri.scheme !== 'file') throw failure('UNSUPPORTED', 'Hardware Schematic requires a local file workspace');
        const key = folder?.uri.toString() || 'explicit-local-inputs';
        if (panels.has(key)) { activeKey = key; panels.get(key).panel.reveal(); return; }
        const panel = vscode.window.createWebviewPanel(VIEW_TYPE, 'Hardware Schematic (Experimental)', vscode.ViewColumn.Two,
            { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'media')] });
        try { return await make(panel, key, context.workspaceState.get(`bsvArchitecture.hardwareSchematic.v1:${key}`), folder); }
        catch (error) { panel.dispose(); throw error; }
    }
    async function revive(panel, state) {
        if (disposed) { panel.dispose(); return; }
        supported();
        const buildId = state?.schema === 1 && typeof state.view?.buildId === 'string' ? state.view.buildId : null;
        const matches = buildId ? (vscode.workspace.workspaceFolders || []).filter(folder => folder.uri.scheme === 'file')
            .map(folder => ({ key: folder.uri.toString(), saved: context.workspaceState.get(`bsvArchitecture.hardwareSchematic.v1:${folder.uri.toString()}`) }))
            .filter(entry => entry.saved?.schema === 1 && entry.saved.view?.buildId === buildId) : [];
        const match = matches.length === 1 ? matches[0] : null;
        const key = match?.key || `unregistered-restore:${require('node:crypto').randomUUID()}`;
        if (panels.has(key)) { panel.dispose(); return panels.get(key); }
        const folder = match ? (vscode.workspace.workspaceFolders || []).find(item => item.uri.toString() === key) : null;
        return make(panel, key, match?.saved || null, folder);
    }
    return { open, revive, getDiagnostics: () => plain({ activePanels: panels.size, closingPanels: closing.size, sessions: [...panels.values()].map(entry => entry.diagnostics()), retired: [...retired] }),
        dispose() {
            if (!disposal) {
                disposed = true;
                disposal = Promise.allSettled([...panels.values()].map(entry => entry.dispose()).concat([...closing])).then(() => provider.dispose());
            }
            return disposal;
        } };
}
module.exports = { createHardwarePanels, VIEW_TYPE, COMMAND, relativePath };
