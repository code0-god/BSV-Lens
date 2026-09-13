'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL, fileURLToPath } = require('node:url');
const { createHardwareSource } = require('../src/panel/hardware-source');
const { loadNativeInput } = require('../src/hardware/native-input');
const { hash } = require('../src/hardware/json');
const { responsePayload } = require('../src/panel/hardware-protocol');

class Uri {
    constructor(value) { this.value = new URL(value); this.scheme = this.value.protocol.slice(0, -1); this.path = this.value.pathname; }
    static file(value) { return new Uri(pathToFileURL(value)); }
    static parse(value) { return new Uri(value); }
    toString() { return this.value.href; }
}
class Selection {
    constructor(start, end) { this.start = start; this.end = end; this.anchor = start; this.active = end; }
}
class Position {
    constructor(line, character) { this._line = line; this._character = character; }
    get line() { return this._line; }
    get character() { return this._character; }
}
function textDocument(uri, text) {
    return { uri, text, version: 1, isDirty: false,
        positionAt(offset) { const before = this.text.slice(0, offset).split('\n'); return new Position(before.length - 1, before.at(-1).length); },
        offsetAt(position) { const lines = this.text.split('\n'); return lines.slice(0, position.line).reduce((n, line) => n + line.length + 1, 0) + position.character; },
        getText(range) { return range ? this.text.slice(this.offsetAt(range.start), this.offsetAt(range.end)) : this.text; }
    };
}
async function fixture(t, extra = '') {
    const runs = path.resolve(__dirname, '../.build/hardware/runs'); await fs.mkdir(runs, { recursive: true });
    const root = path.join(await fs.mkdtemp(path.join(runs, 'g6-native-source-')), 'g6'); await fs.mkdir(root);
    const sourceRoot = path.join(root, 'source'); await fs.mkdir(sourceRoot);
    const file = path.join(sourceRoot, 'Connected.bsv');
    const original = await fs.readFile(path.resolve(__dirname, '../experiments/hardware/fixtures/Connected.bsv'), 'utf8');
    const text = `// Display-only Unicode variant: 한😀e\u0301\t\r\n${original.replaceAll('\n', '\r\n')}`;
    await fs.writeFile(file, text);
    if (extra) await fs.writeFile(path.join(sourceRoot, 'Other.bsv'), extra);
    const input = await loadNativeInput({ sourceRoot });
    const query = input.catalog.find(item => item.getCatalogEntry().label.includes('mkConnected')) || input.catalog[0];
    const entry = query.getCatalogEntry();
    const overall = query.getScene({ buildId: entry.buildId, snapshotId: null, queryGeneration: 0 }).scene;
    const left = overall.children.find(item => item.label === 'left');
    const inside = query.getScene({ buildId: entry.buildId, snapshotId: null, queryGeneration: 0, rootInstanceId: left.id }).scene;
    const live = textDocument(Uri.file(file), text), diagnostics = [], statuses = [], reveals = [], opened = [], shown = [], picks = [];
    let current = { buildId: entry.buildId, rootInstanceId: overall.ownerInstanceId, ownerInstanceId: overall.ownerInstanceId, sceneKind: 'bsv' };
    const control = { sourceHook: null, openHook: null, showHook: null, pick: null };
    let adapter;
    const vscode = { Uri, Selection, ViewColumn: { One: 1, Beside: -2 }, TextEditorRevealType: { InCenterIfOutsideViewport: 2 }, TextEditorSelectionChangeKind: { Keyboard: 1, Mouse: 2, Command: 3 },
        workspace: { async openTextDocument(uri) {
            opened.push(uri.toString()); await control.openHook?.(uri);
            return uri.scheme === 'file' ? live : textDocument(uri, adapter.capturedProvider.provideTextDocumentContent(uri));
        } }, window: { async showTextDocument(document, options) {
            const editor = { document, options, selection: options.selection, revealRange(range) { this.revealed = range; } };
            shown.push(editor); await control.showHook?.(document); return editor;
        }, async showQuickPick(choices) { picks.push(choices); return control.pick?.(choices); } } };
    adapter = createHardwareSource({ vscode, sessionId: 'test-session', getInput: () => input,
        getQuery: buildId => { assert.equal(buildId, entry.buildId); return control.sourceHook ? { ...query, getSource: control.sourceHook } : query; }, getCurrent: () => current,
        onReveal: value => reveals.push(value), onStatus: value => statuses.push(value), onDiagnostic: value => diagnostics.push(value) });
    t.after(() => adapter.dispose()); t.diagnostic(`native source boundary evidence: ${root}`);
    const eventAt = (offset, kind = 1) => { const position = live.positionAt(offset); return { textEditor: { document: live }, selections: [new Selection(position, position)], kind }; };
    return { root, file, text, input, query, entry, overall, inside, left, live, adapter, opened, shown, picks, reveals, statuses, diagnostics, control, eventAt,
        setCurrent(value) { current = { ...current, ...value }; } };
}

test('native editor reveals canonical BSV range using actual UTF-16 text, CRLF and Unicode offsets', async t => {
    const f = await fixture(t), ref = f.inside.storages[0].sourceRefs[0];
    const result = await f.adapter.open(f.entry.buildId, ref);
    assert.equal(result.status, 'current'); assert.equal(result.uri, Uri.file(f.file).toString());
    assert.equal(result.documentHash, hash(f.text)); assert.equal(result.text, f.text.slice(ref.range.start, ref.range.end));
    assert.equal(f.live.offsetAt(f.shown[0].selection.start), ref.range.start);
    assert.equal(f.live.offsetAt(f.shown[0].selection.end), ref.range.end);
    assert.equal(f.shown[0].revealed, f.shown[0].selection);
    assert.equal(f.shown[0].options.viewColumn, 1); assert.equal(f.shown[0].options.preserveFocus, false);
    assert.equal(result.sourceKind, 'original-bsv'); assert.equal(f.reveals.length, 0);
});
test('native source-open result serializes real Position-shaped editor selections through the strict response boundary', async t => {
    const f = await fixture(t), ref = f.inside.storages[0].sourceRefs[0];
    const result = await f.adapter.open(f.entry.buildId, ref), selection = f.shown[0].selection;
    assert.ok(selection.start instanceof Position); assert.ok(selection.end instanceof Position);
    assert.equal(Object.getPrototypeOf(result.selection.start), Object.prototype);
    assert.equal(Object.getPrototypeOf(result.selection.end), Object.prototype);
    const payload = JSON.parse(JSON.stringify(responsePayload(result)));
    assert.deepEqual(payload.selection, {
        start: { line: selection.start.line, character: selection.start.character },
        end: { line: selection.end.line, character: selection.end.character }
    });
    assert.equal(payload.documentHash, hash(f.text)); assert.equal(payload.text, ref.text);
});
test('native editor refuses altered or foreign issued source references before reading documents', async t => {
    const f = await fixture(t), ref = f.inside.storages[0].sourceRefs[0];
    for (const changed of [{ ...ref, id: 'foreign' }, { ...ref, pathRef: '/etc/passwd' }, { ...ref, range: { start: 0, end: 1 } }]) {
        await assert.rejects(f.adapter.open(f.entry.buildId, changed));
    }
    assert.equal(f.opened.length, 0);
});
test('dirty editor buffer uses full read-only historical capture and never applies old range to live editor', async t => {
    const f = await fixture(t), ref = f.inside.storages[0].sourceRefs[0];
    f.live.text = `// unsaved shift\n${f.text}`; f.live.version++; f.live.isDirty = true;
    const result = await f.adapter.open(f.entry.buildId, ref);
    assert.equal(result.status, 'captured'); assert.match(result.uri, /^bsv-hardware-capture:/);
    assert.equal(f.shown.length, 1); assert.equal(f.shown[0].document.getText(), f.text);
    assert.equal(f.shown[0].document.getText(f.shown[0].selection), ref.text);
    assert.equal(f.live.text, `// unsaved shift\n${f.text}`);
    assert.throws(() => f.adapter.capturedProvider.provideTextDocumentContent(Uri.parse('bsv-hardware-capture://foreign/x')), { code: 'PATH_DENIED' });
});
test('missing live source opens verified capture; absent capture reports stale without forced selection', async t => {
    const f = await fixture(t), ref = f.inside.storages[0].sourceRefs[0];
    await fs.rename(f.file, `${f.file}.removed`);
    assert.equal((await f.adapter.open(f.entry.buildId, ref)).status, 'captured');
    f.input.sources[0].capturedText = null;
    assert.equal((await f.adapter.open(f.entry.buildId, ref)).status, 'stale'); assert.equal(f.shown.length, 1);
});
test('symlink replacement is denied before opening and during awaited editor load', async t => {
    for (const during of [false, true]) {
        const f = await fixture(t), ref = f.inside.storages[0].sourceRefs[0], outside = path.join(f.root, 'outside.bsv');
        await fs.writeFile(outside, f.text);
        const replace = async () => { await fs.rename(f.file, `${f.file}.original`); await fs.symlink(outside, f.file); };
        if (during) f.control.openHook = replace; else await replace();
        await assert.rejects(f.adapter.open(f.entry.buildId, ref), { code: 'PATH_DENIED' });
        assert.equal(f.shown.length, 0); assert.equal(f.opened.length, during ? 1 : 0);
    }
});
test('reverse editor selection reuses canonical instance declaration and storage/behavior/source-operation IDs', async t => {
    const f = await fixture(t);
    await f.adapter.handleSelection(f.eventAt(f.text.indexOf('Stage left')));
    assert.equal(f.reveals[0].intent.ownerInstanceId, f.left.id);
    assert.equal(f.reveals[0].intent.selectedEntityId, f.left.id);
    f.setCurrent({ ownerInstanceId: f.left.id, rootInstanceId: f.left.id });
    for (const [needle, expected] of [['Reg#(Bit#(8)) state', f.inside.storages[0].id], ['method Action put(Bit#(8) value);\r\n      state', null], ['state <= value + 1', null]]) {
        const result = await f.adapter.handleSelection(f.eventAt(f.text.indexOf(needle)));
        assert.ok(result); assert.equal(result.intent.ownerInstanceId, f.left.id);
        if (expected) assert.equal(result.intent.selectedEntityId, expected);
        assert.equal(result.source.revision, hash(f.text));
    }
    assert.equal(f.picks.length, 0);
});
test('ambiguous repeated definition requires real occurrence choice, current owner resolves it', async t => {
    const f = await fixture(t), offset = f.text.indexOf('module mkStage');
    assert.equal(await f.adapter.handleSelection(f.eventAt(offset)), undefined);
    assert.equal(f.reveals.length, 0); assert.equal(f.picks.length, 1);
    assert.deepEqual(f.picks[0].map(item => item.description).sort(), ['mkConnected.left', 'mkConnected.right']);
    f.setCurrent({ ownerInstanceId: f.left.id });
    const result = await f.adapter.handleSelection(f.eventAt(offset));
    assert.equal(result.intent.selectedEntityId, f.left.id);
});
test('reverse refuses dirty buffer and never silently switches RTL or independent source root', async t => {
    const f = await fixture(t, 'package Other; module mkOther(Empty); endmodule endpackage');
    f.setCurrent({ sceneKind: 'rtl' });
    assert.equal((await f.adapter.handleSelection(f.eventAt(f.text.indexOf('Stage left')))).status, 'available-in-bsv');
    f.setCurrent({ sceneKind: 'bsv' }); f.live.text += '\n// dirty'; f.live.version++; f.live.isDirty = true;
    assert.equal((await f.adapter.handleSelection(f.eventAt(f.text.indexOf('Stage left')))).status, 'stale');
    const other = f.input.sources.find(row => row.pathRef === 'Other.bsv'), document = textDocument(Uri.file(other.path), other.capturedText);
    const position = document.positionAt(document.text.indexOf('module mkOther'));
    assert.equal((await f.adapter.handleSelection({ textEditor: { document }, selections: [new Selection(position, position)], kind: 1 })).status, 'outside-scope');
    assert.equal(f.reveals.length, 0);
});
test('one-shot programmatic reveal echo is suppressed; later user selection is processed and deduplicated', async t => {
    const f = await fixture(t), ref = f.inside.storages[0].sourceRefs[0];
    f.setCurrent({ ownerInstanceId: f.left.id });
    await f.adapter.open(f.entry.buildId, ref);
    const selection = f.shown[0].selection, event = { textEditor: f.shown[0], selections: [selection], kind: 3 };
    await f.adapter.handleSelection(event); assert.equal(f.reveals.length, 0);
    await f.adapter.handleSelection(f.eventAt(ref.range.start)); assert.equal(f.reveals.length, 1);
    await f.adapter.handleSelection(f.eventAt(ref.range.start)); assert.equal(f.reveals.length, 1);
});
test('dispose or source generation change during document await prevents reveal and diagnostic publication', async t => {
    const f = await fixture(t), ref = f.inside.storages[0].sourceRefs[0];
    f.control.openHook = () => f.adapter.dispose();
    await assert.rejects(f.adapter.open(f.entry.buildId, ref), { code: 'CANCELLED' });
    assert.equal(f.shown.length, 0); assert.equal(f.diagnostics.length, 0);
});
test('late reverse selection and edits during authority revalidation never publish stale targets', async t => {
    const f = await fixture(t), read = f.input.registry.readSource.bind(f.input.registry);
    let release, entered;
    const started = new Promise(resolve => { entered = resolve; });
    f.input.registry.readSource = async request => { entered(); await new Promise(resolve => { release = resolve; }); return read(request); };
    const pending = f.adapter.handleSelection(f.eventAt(f.text.indexOf('Stage left')));
    await started;
    f.input.registry.readSource = read;
    await f.adapter.handleSelection(f.eventAt(f.text.indexOf('Stage right')));
    release(); await pending;
    assert.equal(f.reveals.length, 1);
    assert.equal(f.reveals[0].intent.ownerInstanceId, f.overall.children.find(item => item.label === 'right').id);
    f.input.registry.readSource = async request => { f.live.version++; f.live.text += '\n// unsaved'; return read(request); };
    await f.adapter.handleSelection(f.eventAt(f.text.indexOf('Stage left')));
    assert.equal(f.reveals.length, 1);
});
test('presentation-only current updates keep an in-flight reverse source lookup alive', async t => {
    const f = await fixture(t), read = f.input.registry.readSource.bind(f.input.registry);
    let release, entered;
    const started = new Promise(resolve => { entered = resolve; });
    f.input.registry.readSource = async request => { entered(); await new Promise(resolve => { release = resolve; }); return read(request); };
    const pending = f.adapter.handleSelection(f.eventAt(f.text.indexOf('Stage left')));
    await started;
    f.setCurrent({ viewport: { x: 7, y: 8, scale: 2 }, disclosureState: { inspector: { scrollTop: 50 } }, activePanel: 'code' });
    release();
    assert.equal((await pending)?.intent.ownerInstanceId, f.left.id);
    assert.equal(f.reveals.length, 1);
});
test('semantic selection or analysis changes still invalidate an in-flight reverse source lookup', async t => {
    for (const field of ['ownerInstanceId', 'selectedEntityId', 'query']) {
        const f = await fixture(t), read = f.input.registry.readSource.bind(f.input.registry);
        let release, entered;
        const started = new Promise(resolve => { entered = resolve; });
        f.input.registry.readSource = async request => { entered(); await new Promise(resolve => { release = resolve; }); return read(request); };
        const pending = f.adapter.handleSelection(f.eventAt(f.text.indexOf('Stage left')));
        await started;
        f.setCurrent({ [field]: field === 'query' ? { kind: 'state-accesses', seed: { entityId: f.inside.storages[0].id } } : f.left.id });
        release(); assert.equal(await pending, undefined); assert.equal(f.reveals.length, 0);
        f.input.registry.readSource = read;
        await f.adapter.handleSelection(f.eventAt(f.text.indexOf('Stage left')));
        assert.equal(f.reveals.length, 1, `${field}: a later actual selection must not be deduplicated against obsolete context`);
    }
});
test('document edit while showTextDocument awaits never receives the old source range', async t => {
    const f = await fixture(t), ref = f.inside.storages[0].sourceRefs[0];
    f.control.showHook = document => { document.text += '\n// edit during reveal'; document.version++; };
    await assert.rejects(f.adapter.open(f.entry.buildId, ref), { code: 'SOURCE_REVISION_MISMATCH' });
    assert.equal(f.shown[0].selection, undefined); assert.equal(f.shown[0].revealed, undefined);
    assert.equal(f.diagnostics.length, 0);
});
test('request cancellation fences every awaited source, registry and editor boundary', async t => {
    for (const boundary of ['before-source', 'source', 'registry', 'recheck', 'live-document', 'captured-document', 'show-editor']) {
        const f = await fixture(t), ref = f.inside.storages[0].sourceRefs[0], controller = new AbortController();
        const signal = controller.signal;
        if (boundary === 'before-source') controller.abort();
        if (boundary === 'source') f.control.sourceHook = async reference => { const result = f.query.getSource(reference); controller.abort(); return result; };
        if (boundary === 'registry' || boundary === 'recheck') {
            const read = f.input.registry.readSource.bind(f.input.registry); let reads = 0;
            f.input.registry.readSource = async request => {
                const result = await read(request);
                if (++reads === (boundary === 'registry' ? 1 : 2)) controller.abort();
                return result;
            };
        }
        if (boundary === 'live-document') f.control.openHook = () => controller.abort();
        if (boundary === 'captured-document') {
            f.live.text += '\n// unsaved'; f.live.isDirty = true; f.live.version++;
            f.control.openHook = uri => { if (uri.scheme === 'bsv-hardware-capture') controller.abort(); };
        }
        if (boundary === 'show-editor') f.control.showHook = document => { document.text += '\n// concurrent edit'; controller.abort(); };
        await assert.rejects(f.adapter.open(f.entry.buildId, ref, { signal }), { code: 'CANCELLED' }, boundary);
        assert.ok(f.shown.every(editor => editor.selection === undefined && editor.revealed === undefined), boundary);
        assert.equal(f.diagnostics.length, 0, boundary); assert.equal(f.statuses.length, 0, boundary);
        if (['before-source', 'source', 'registry'].includes(boundary)) assert.equal(f.opened.length, 0, boundary);
    }
});
