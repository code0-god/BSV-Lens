'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const strings = require('../media/hardware-strings');
const { hardwareHtml } = require('../src/panel/hardware-html');
global.BsvHardwareAnalysis = require('../media/hardware-analysis');
require('../media/hardware-inspector');

test('native Korean text has English fallback, preserves identifiers and escapes host HTML', () => {
    assert.equal(strings.translate('ko', 'Back'), '뒤로');
    assert.equal(strings.translate('ko-KR', 'Open {name}', { name: 'left.입력' }), 'left.입력 내부 보기');
    assert.equal(strings.translate('fr', 'Open {name}', { name: 'right' }), 'Open right');
    assert.equal(strings.translate('ko', 'unknown identifier'), 'unknown identifier');
    for (const language of ['ko', 'en']) {
        const html = hardwareHtml({ cspSource: 'webview:', asWebviewUri: uri => uri }, { fsPath: path.resolve(__dirname, '..') },
            { env: { language }, Uri: { joinPath: (uri, ...parts) => path.join(uri.fsPath, ...parts) } },
            { buildId: 'build<unsafe>', protocol: 1 });
        assert.ok(html.includes(`lang="${language}"`));
        assert.ok(html.includes(language === 'ko' ? '>뒤로</button>' : '>Back</button>'));
        assert.match(html, /build&lt;unsafe&gt;/);
        assert.doesNotMatch(html, /\{\{[^}]+\}\}|unsafe-eval|localhost|onClick=/);
        assert.ok(html.indexOf('hardware-strings.js') < html.indexOf('hardware-view.js'));
        assert.ok(html.includes('data-native-action="open-settings"'));
        for (const id of ['native-empty-title', 'native-empty-message', 'native-empty-detail', 'connect-rtl',
            'navigation-feedback', 'navigation-message', 'retry-navigation', 'navigation-diagnostic', 'copy-diagnostics', 'native-select-design',
            'native-history-recovery', 'native-new-history']) assert.ok(html.includes(`id="${id}"`));
    }
});

test('source design cancellation describes discovered files rather than reporting an empty workspace', () => {
    const { nativeSelectionStatus } = require('../media/hardware-view');
    assert.equal(nativeSelectionStatus({ sourceFiles: 67, designs: 66, preserved: false }, key => key.replace('{count}', '67')),
        'Found 67 BSV files. Choose a design to open.');
    const ko = (key, values) => strings.translate('ko', key, values);
    assert.equal(nativeSelectionStatus({ sourceFiles: 4, designs: 2 }, ko), 'BSV 파일 4개를 찾았습니다. 열 설계를 선택하세요.');
    assert.equal(nativeSelectionStatus({ sourceFiles: 4, preserved: true }, ko), '설계 선택을 닫았습니다. 현재 설계는 그대로 유지합니다.');
});

test('hardware glyph presentation classifies semantic families without changing diagram geometry', () => {
    const { glyphPresentation, familyShape, selectionContext } = require('../media/hardware-view');
    assert.deepEqual(glyphPresentation({ kind: 'module-occurrence' }, 'node'), { kind: 'module', family: 'module' });
    for (const kind of ['register', 'fifo', 'memory']) {
        assert.deepEqual(glyphPresentation({ kind: 'storage', primitiveKind: kind }, 'node'), { kind, family: 'storage' });
    }
    assert.deepEqual(glyphPresentation({ kind: 'method-contact' }, 'contact'), { kind: 'contact', family: 'contact' });
    assert.deepEqual(glyphPresentation({ kind: 'rtl-cell', status: 'unknown-semantics' }, 'node'), { kind: 'unresolved', family: 'unresolved' });
    assert.deepEqual(glyphPresentation({ kind: 'interface-group', membershipStatus: 'unresolved' }, 'group'), { kind: 'unresolved', family: 'unresolved' });
    assert.equal(familyShape({ family: { resolutionStatus: 'exact', dimensions: [{ status: 'concrete' }] }, multiplicity: { status: 'exact' } }), 'vector');
    assert.equal(familyShape({ family: { resolutionStatus: 'exact', dimensions: [{ status: 'concrete' }, { status: 'concrete' }] }, multiplicity: { status: 'exact' } }), 'matrix');
    assert.equal(familyShape({ family: { resolutionStatus: 'symbolic', dimensions: [{ status: 'symbolic' }] }, multiplicity: { status: 'parameterized', count: null } }), 'symbolic');
    assert.equal(familyShape({ family: { resolutionStatus: 'unresolved', dimensions: [{ status: 'concrete' }] }, multiplicity: { status: 'exact', count: 2 } }), 'symbolic');
    const routeContext = selectionContext([
        { id: 'summary', memberRelationIds: ['relation:a'], endpointIds: ['left', 'right'] },
        { id: 'other', memberRelationIds: ['relation:b'], endpointIds: ['right', 'out'] }
    ], null, 'relation:a');
    assert.deepEqual([...routeContext.routes], ['summary']);
    assert.deepEqual([...routeContext.peers], ['left', 'right']);
    const source = require('node:fs').readFileSync(path.resolve(__dirname, '../media/hardware-view.js'), 'utf8');
    const styles = require('node:fs').readFileSync(path.resolve(__dirname, '../media/hardware.css'), 'utf8');
    assert.match(source, /dataset\.glyphKind/); assert.match(source, /dataset\.glyphFamily/);
    for (const selector of ['.hardware-object:hover .interaction-ring', '.hardware-object:focus-visible .interaction-ring',
        '.interface-group.glyph-unresolved .group-glyph',
        '#world[data-detail-level="overview"] .hardware-object .kind-glyph',
        '.hardware-object.family-scalar .family-stack', '.contact.glyph-operation .contact-glyph',
        '.analysis-result .kind-glyph', '.analysis-seed .kind-glyph', '.analysis-boundary .kind-glyph']) assert.ok(styles.includes(selector));
});

test('repeated hardware labels distinguish rank from certainty without losing exact counts', () => {
    const { familySummary } = require('../src/hardware/scene');
    const register = { kind: 'storage', primitiveKind: 'register', family: {
        resolutionStatus: 'exact', dimensions: [{ expression: '2', status: 'concrete', size: 2 }] },
    multiplicity: { status: 'exact', count: 2 } };
    assert.equal(familySummary(register), 'Reg × 2');
    const module = { kind: 'module-occurrence', family: { resolutionStatus: 'symbolic', dimensions: [
        { expression: 'arrayDim', status: 'symbolic' }, { expression: 'arrayDim', status: 'symbolic' }
    ] }, multiplicity: { status: 'parameterized', count: null } };
    assert.equal(familySummary(module), 'Module array · 2D · symbolic');
    assert.equal(familySummary({ ...module, family: { ...module.family, resolutionStatus: 'unresolved' } }),
        'Module array · 2D · unresolved');
});

test('generated design size limits explain smaller-module recovery without mislabeling unrelated failures', () => {
    const { nativeDesignLimit, nativeSelectionStatus } = require('../media/hardware-view');
    const error = { code: 'LIMIT_EXCEEDED', message: 'Generated correspondence shared payload byte limit' };
    assert.equal(nativeDesignLimit(error), true);
    assert.equal(nativeDesignLimit({ ...error, code: 'INVALID_INPUT' }), false);
    assert.equal(nativeDesignLimit({ ...error, message: 'Native concurrent request limit' }), false);
    assert.equal(nativeDesignLimit({ ...error, message: 'Prepared design exceeds its bounded byte limit.' }), true);
    const selection = { status: 'limited', preserved: false };
    const en = (key, values) => strings.translate('en', key, values);
    const ko = (key, values) => strings.translate('ko', key, values);
    assert.equal(nativeSelectionStatus(selection, en), 'This design exceeds the supported analysis size. Choose a smaller module.');
    assert.equal(nativeSelectionStatus(selection, ko), '이 설계는 지원하는 분석 크기를 초과합니다. 더 작은 모듈을 선택하세요.');
    assert.equal(nativeSelectionStatus({ ...selection, preserved: true, current: 'mkRoot' }, en),
        'This design exceeds the supported analysis size. Choose a smaller module. Still showing mkRoot.');
    assert.equal(nativeSelectionStatus({ ...selection, preserved: true, current: 'mkRoot' }, ko),
        '이 설계는 지원하는 분석 크기를 초과합니다. 더 작은 모듈을 선택하세요. 현재 mkRoot 화면을 유지하고 있습니다.');
    assert.deepEqual(error, { code: 'LIMIT_EXCEEDED', message: 'Generated correspondence shared payload byte limit' });
});

test('native size and history failures retain the committed selector, scene and raw diagnostic with distinct recovery', async () => {
    const fs = require('node:fs'), vm = require('node:vm');
    const { nativeDesignLimit, nativeSelectionStatus } = require('../media/hardware-view');
    const source = fs.readFileSync(path.resolve(__dirname, '../media/hardware-view.js'), 'utf8');
    const code = source.slice(source.indexOf('    function nativeStatus(payload)'), source.indexOf('    function nativeTheme(theme)'))
        + source.slice(source.indexOf('    function syncBuildSelection(current)'), source.indexOf('    function restoreNativeViewport(view'))
        + source.slice(source.indexOf("        $('native-new-history').addEventListener('click'"), source.indexOf("        for (const button of document.querySelectorAll('[data-native-action]'))"));
    for (const [preserved, historyFull] of [[false, false], [true, false], [true, true]]) {
        const current = preserved ? Object.freeze({ buildId: 'current-build', ownerInstanceId: 'owner', selectedEntityId: 'storage' }) : null;
        const state = Object.freeze({ current, pending: false, scene: preserved ? Object.freeze({ shell: { label: 'mkCurrent' } }) : null });
        const nodes = new Map(), events = [], calls = [], selectionAtRequests = [];
        const node = id => {
            if (!nodes.has(id)) nodes.set(id, { hidden: true, setAttribute(key, value) { this[key] = value; },
                addEventListener(kind, callback) { this[kind] = callback; }, append(value) { this.textContent += value; } });
            return nodes.get(id);
        };
        Object.assign(node('build-select'), { value: 'design:next', options: [{ value: 'design:current' }, { value: 'design:next' }] });
        const status = { inputIdentity: 'approved-current-input' };
        const error = Object.assign(new Error(historyFull
            ? 'Prepared design history reached its bounded limit. Reopen Hardware Schematic to start a new design history.'
            : 'Generated correspondence shared payload byte limit'), { code: 'LIMIT_EXCEEDED' });
        const harness = vm.runInNewContext(`let nativeSelectionRequired = null, nativeDiscovery = null, discoveryRequest = null, discoveryAgain = false, designRequest = null;
            ${code}\n({ discoverWorkspace, chooseDesign, nativeStatus, selection: () => nativeSelectionRequired })`, {
            AbortController, sourceDesigns: [{ id: 'current', name: 'mkCurrent' }, { id: 'next', name: 'mkNext' }],
            pendingCatalog: null, nativePublication: null, nativeHistoryPending: require('../media/hardware-view').nativeHistoryPending,
            designForBuild: new Map([['current-build', 'current']]),
            nativeTransport: true, nativeDesignLimit, nativeSelectionStatus,
            nativeSourceStatus: require('../media/hardware-view').nativeSourceStatus, document: { createTextNode: value => value },
            navigation: { getState: () => state }, committedNativeStatus: status,
            nativeStatusOverlay: { resolve: value => value }, inputStatusForBuild: new Map([['current-build', status]]),
            t: (key, values) => strings.translate('en', key, values),
            $: node,
            text: (node, value) => { node.textContent = value; }, emit: (action, payload) => events.push({ action, payload }),
            renderCatalogOptions: () => calls.push('render-options'),
            request: async (action, payload) => { selectionAtRequests.push(harness.selection()); calls.push(action); events.push({ request: action, payload }); throw error; }
        });
        const run = () => preserved ? harness.chooseDesign('next') : harness.discoverWorkspace();
        await run();
        assert.equal(nodes.get('native-input-status').textContent, nativeSelectionStatus(harness.selection(), strings.t));
        assert.match(nodes.get('status').textContent, historyFull ? /history is full\. Start a new history/ : /exceeds the supported analysis size/);
        if (historyFull) assert.doesNotMatch(nodes.get('status').textContent, /smaller module/);
        assert.doesNotMatch(nodes.get('status').textContent, /No BSV|Generated correspondence/);
        assert.equal(harness.selection().preserved, preserved);
        if (!preserved) {
            assert.equal(nodes.get('native-select-design').hidden, false);
            assert.equal(nodes.get('native-empty-message').textContent, nodes.get('status').textContent);
        } else {
            assert.equal(nodes.has('native-select-design'), false);
            assert.equal(node('build-select').value, 'design:current');
            assert.equal(node('build-select')['aria-busy'], 'false');
        }
        assert.equal(state.current, current);
        assert.equal(events.at(-1).action, 'native-status');
        assert.equal(events.at(-1).payload.code, error.code);
        assert.equal(events.at(-1).payload.message, error.message);
        assert.equal(nodes.get('native-history-recovery').hidden, !historyFull);
        if (historyFull) {
            assert.equal(nodes.get('native-new-history').textContent, 'Open mkNext in a new history');
            assert.equal(harness.selection().entryId, 'next');
            const committed = { ...status, inputStatus: 'source-only', discovery: { status: 'ready', analyzedFiles: 67 } };
            harness.nativeStatus(committed);
            assert.equal(nodes.get('native-history-recovery').hidden, false, 'Passive viewport/catalog ACK must not hide recovery');
            assert.match(nodes.get('native-input-status').textContent, /history is full/);
            assert.match(nodes.get('status').textContent, /history is full/);
            harness.nativeStatus({ ...committed, notice: { status: 'dirty-source', message: 'Unsaved source edits remain.' } });
            assert.equal(nodes.get('native-history-recovery').hidden, false);
            assert.match(nodes.get('native-input-status').textContent, /history is full.*Unsaved source edits remain/);
            await node('native-new-history').click();
            assert.equal(events.findLast(event => event.request === 'choose-design').payload.newHistory, true);
            assert.equal(node('native-new-history').disabled, false);
            assert.equal(node('build-select').value, 'design:current');
        }
        await run();
        assert.ok(selectionAtRequests.every(selection => selection === null), 'A new input intent clears the old actionable failure before dispatch');
        assert.equal(calls.filter(action => action === (preserved ? 'choose-design' : 'discover-workspace')).length, historyFull ? 3 : 2);
    }
});

test('a revised recovery index refreshes the visible selector without replacing the committed scene', () => {
    const fs = require('node:fs'), vm = require('node:vm'), renders = [];
    const source = fs.readFileSync(path.resolve(__dirname, '../media/hardware-view.js'), 'utf8');
    const code = source.slice(source.indexOf("        nativeTransport.subscribe((action, payload) => {"),
        source.indexOf('        nativeTransport.ready.then'));
    const state = Object.freeze({ current: Object.freeze({ buildId: 'committed-build', ownerInstanceId: 'owner' }),
        scene: Object.freeze({ shell: Object.freeze({ label: 'mkCommitted' }) }) });
    const harness = vm.runInNewContext(`let sourceDesigns = [{ id: 'old-revision', name: 'mkCurrent' }];
        let nativeDiscovery = null, nativeSelectionRequired = null, subscribed;
        const nativeTransport = { subscribe: callback => { subscribed = callback; } };
        const renderCatalogOptions = () => renders.push(sourceDesigns.map(entry => entry.id));
        ${code}
        ({ dispatch: payload => subscribed('source-selection', payload), designs: () => sourceDesigns,
            selection: () => nativeSelectionRequired })`, {
        renders, navigation: { getState: () => state }, $: () => ({ hidden: true }), text: () => {},
        t: value => value, nativeSelectionStatus: () => 'limited', nativeStatus: () => {}
    });
    harness.dispatch({ status: 'limited', entryId: 'new-revision',
        designEntries: [{ id: 'new-revision', name: 'mkCurrent' }, { id: 'new-small', name: 'mkSmall' }],
        discovery: { status: 'ready', analyzedFiles: 2 } });
    assert.deepEqual(Array.from(harness.designs(), entry => entry.id), ['new-revision', 'new-small']);
    assert.deepEqual(renders[0], ['new-revision', 'new-small']);
    assert.equal(harness.selection().entryId, 'new-revision');
    assert.equal(state.current.buildId, 'committed-build'); assert.equal(state.scene.shell.label, 'mkCommitted');
});

test('full design history describes explicit new history rather than changing the selected module size', () => {
    const { nativeDesignLimit, nativeSelectionStatus } = require('../media/hardware-view');
    const error = { code: 'LIMIT_EXCEEDED',
        message: 'Prepared design history reached its bounded limit. Reopen Hardware Schematic to start a new design history.' };
    assert.equal(nativeDesignLimit(error), true);
    assert.equal(nativeDesignLimit({ ...error, code: 'INVALID_INPUT' }), false);
    const selection = { status: 'history-full', preserved: true, current: 'mkRoot' };
    assert.equal(nativeSelectionStatus(selection, (key, values) => strings.translate('en', key, values)),
        'This design history is full. Start a new history to open another design. Still showing mkRoot.');
    assert.equal(nativeSelectionStatus(selection, (key, values) => strings.translate('ko', key, values)),
        '설계 탐색 기록이 가득 찼습니다. 다른 설계를 열려면 새 탐색 기록을 시작하세요. 현재 mkRoot 화면을 유지하고 있습니다.');
});

test('retry after rejected new-history publication prepares the registered target again with the explicit history policy', async () => {
    const fs = require('node:fs'), vm = require('node:vm'), calls = [];
    const source = fs.readFileSync(path.resolve(__dirname, '../media/hardware-view.js'), 'utf8');
    const code = source.slice(source.indexOf("    $('retry-navigation')?.addEventListener"), source.indexOf("    $('copy-diagnostics')?.addEventListener"));
    let click;
    vm.runInNewContext(code, {
        $: () => ({ addEventListener: (_kind, callback) => { click = callback; } }), nativeTransport: true,
        navigation: { getState: () => ({ error: {}, operation: { reason: 'publication' }, outcome: { code: 'COMMIT_REJECTED' } }),
            retry: () => assert.fail('Direct scene retry would lose new-history catalog metadata') },
        nativeSelectionRequired: { status: 'history-retry', entryId: 'registered-target' },
        chooseDesign: (entryId, options) => calls.push({ entryId, newHistory: options.newHistory })
    });
    await click(); assert.deepEqual(calls, [{ entryId: 'registered-target', newHistory: true }]);
});

function dom() {
    const nodes = [];
    class Node {
        constructor(tag) { this.tagName = tag; this.children = []; this.dataset = {}; this.attributes = {}; this.listeners = {};
            this.scrollTop = 0; this.classList = { add() {}, toggle() {} }; nodes.push(this); }
        get childNodes() { return this.children; }
        append(...children) { this.children.push(...children); }
        replaceChildren(...children) { this.children = children; }
        setAttribute(key, value) { this.attributes[key] = value; }
        addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
        querySelectorAll(selector) {
            const key = /^\[data-([a-z-]+)\]$/.exec(selector)?.[1]?.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
            assert.ok(key, selector);
            return this.children.flatMap(child => [...(Object.hasOwn(child.dataset, key) ? [child] : []), ...child.querySelectorAll(selector)]);
        }
        fire(type) { for (const fn of this.listeners[type] || []) fn({ target: this }); }
    }
    const ids = new Map(['selection-title', 'inspector-content', 'capability-content', 'inspector'].map(id => [id, new Node('div')]));
    global.document = { documentElement: { lang: 'ko' }, createElement: tag => new Node(tag),
        createDocumentFragment: () => new Node('fragment'), getElementById: id => ids.get(id) || nodes.find(n => n.id === id) };
    global.BsvHardwareStrings = strings;
    return { nodes, ids };
}

// Presentation-only records exercise DOM/callback contracts, not compiler evidence.
function presentation() {
    const ref = { id: 'source-ref', pathRef: 'src/design.bsv', revision: 'revision', range: { start: 2, end: 9, text: 'mkChild' } };
    const scene = { sceneKind: 'bsv', ownerInstanceId: 'root', snapshotId: null,
        shell: { id: 'root', label: 'mkRoot', interaction: { kind: 'enter' } },
        children: [{ id: 'left', label: 'left', interaction: { kind: 'enter' } }, { id: 'leaf', label: 'leaf', interaction: { kind: 'inspect' } }],
        storages: [], contacts: [], connections: [], interfaceGroups: [{ id: 'interface', ownerId: 'root', label: 'bus', interfacePath: ['bus'] }],
        capabilities: {}, correspondence: { origin: { claims: [] }, stock: { claims: [] } },
        inspector: { id: 'inspector:root', title: 'mkRoot', subtitle: 'RootIfc', kind: 'BSV MODULE INSTANCE', status: 'source-derived',
            sourceRefs: [ref], behaviorRefs: [], sections: [{ id: 'identity', title: 'Instance context', fields: [
                { label: 'Definition', value: 'mkRoot', status: 'source-derived' }, { label: 'BSV owner', value: 'mkRoot', status: 'source-derived' },
                { label: 'Actual RTL path', value: 'Not attached', status: 'not-attached' }] },
            { id: 'origin', title: 'Implementation correspondence', fields: [{ label: 'Complete origin set', value: 'Not established', status: 'unsupported' }] }] } };
    return { scene, ref, visit: { sceneKind: 'bsv', selectedEntityId: null, selectedRelationId: null, disclosureState: {} } };
}

test('native module essentials precede closed diagnostics; children and source keep exact callback identity', () => {
    const d = dom(), f = presentation(), original = JSON.stringify(f.scene), calls = [];
    global.BsvHardwareInspector.render(f.scene, f.visit, { native: true, enter: id => calls.push(['enter', id]),
        select: (id, relation) => calls.push(['select', id, relation]), openSource: ref => calls.push(['source', ref]),
        disclose: (...args) => calls.push(['disclose', ...args]) });
    const advanced = d.nodes.find(n => n.dataset.disclosureId === 'inspector-details:inspector:root');
    assert.ok(advanced); assert.equal(advanced.open, false);
    const texts = node => [node.textContent || '', ...(node.tagName === 'details' && !node.open ? [] : node.children.flatMap(texts))];
    const visible = texts(d.ids.get('inspector-content')).join(' ');
    assert.equal(d.ids.get('selection-title').textContent, 'mkRoot');
    assert.match(visible, /RootIfc/); assert.match(visible, /left/); assert.doesNotMatch(visible, /mkRoot|Not attached|Complete origin set/);
    d.nodes.find(n => n.dataset.childEntityId === 'left').fire('click');
    const info = d.nodes.find(n => n.dataset.inspectEntityId === 'left');
    assert.equal(info.attributes['aria-label'], 'left 정보'); info.fire('click');
    d.nodes.find(n => n.dataset.childEntityId === 'leaf').fire('click');
    d.nodes.find(n => n.dataset.sourceOpenId === f.ref.id).fire('click');
    assert.deepEqual(calls, [['enter', 'left'], ['select', 'left', false], ['select', 'leaf', false], ['source', f.ref]]);
    advanced.open = true; advanced.fire('toggle');
    assert.deepEqual(calls.at(-1), ['disclose', 'inspector-details:inspector:root', true]);
    assert.equal(JSON.stringify(f.scene), original);
});

test('interface member disclosure uses exact member ID and full path without module entry', () => {
    const d = dom(), f = presentation(), selected = [];
    f.scene.inspector.id = 'inspector:interface'; f.scene.inspector.title = 'bus';
    f.scene.inspector.interfaceMembers = [{ id: 'bus.request.put', label: 'put', interfacePath: ['bus', 'request', 'put'], category: 'Action' },
        { id: 'bus.response.put', label: 'put', interfacePath: ['bus', 'response', 'put'], category: 'Action' }];
    global.BsvHardwareInspector.render(f.scene, f.visit, { native: true, select: id => selected.push(id), disclose() {} });
    for (const member of f.scene.inspector.interfaceMembers) {
        const button = d.nodes.find(n => n.dataset.interfaceMemberId === member.id);
        assert.ok(button.title.includes(member.interfacePath.join('.'))); button.fire('click');
    }
    assert.deepEqual(selected, f.scene.inspector.interfaceMembers.map(member => member.id));
});

test('folded source relations stay selectable and create member controls only when disclosed', () => {
    const d = dom(), f = presentation(), calls = [];
    f.scene.inspector.relationMembers = [{ id: 'relation-one', kind: 'state-read', label: 'read counter', fromId: 'counter', toId: 'body' },
        { id: 'relation-two', kind: 'interface-binding', label: 'alias bus', fromId: 'bus', toId: 'left.bus' }];
    const before = JSON.stringify(f.scene);
    global.BsvHardwareInspector.render(f.scene, f.visit, { native: true,
        select: (...args) => calls.push(args), disclose: (...args) => calls.push(args) });
    const container = d.nodes.find(n => n.dataset.disclosureId === 'inspector-relations:inspector:root');
    assert.equal(container.open, false); assert.equal(d.nodes.filter(n => n.dataset.relationMemberId).length, 0);
    container.open = true; container.fire('toggle');
    assert.equal(d.nodes.filter(n => n.dataset.relationMemberId).length, 2);
    d.nodes.find(n => n.dataset.relationMemberId === 'relation-two').fire('click');
    assert.deepEqual(calls.at(-1), ['relation-two', true]);
    container.open = false; container.fire('toggle'); container.open = true; container.fire('toggle');
    assert.equal(d.nodes.filter(n => n.dataset.relationMemberId).length, 2);
    assert.equal(JSON.stringify(f.scene), before);
});

test('selected source summary shows both canonical endpoints and original member selection before diagnostics', () => {
    const d = dom(), f = presentation(), calls = [];
    f.scene.inspector.id = 'inspector:summary'; f.scene.inspector.title = 'interface-binding';
    f.scene.inspector.connectionEssentials = { family: 'interface-binding', direction: 'binding', meaning: 'binding',
        ownerInstanceId: 'root', ownerPath: 'mkRoot', memberCount: 2, memberRelationIds: ['bind-requests', 'bind-responses'],
        from: [{ id: 'left.requests', label: 'left.requests', ownerInstanceId: 'left', ownerPath: 'mkRoot.left', interfacePath: ['requests'] }],
        to: [{ id: 'requests', label: 'requests', ownerInstanceId: 'root', ownerPath: 'mkRoot', interfacePath: ['requests'] }] };
    f.scene.inspector.relationMembers = [{ id: 'bind-requests', kind: 'interface-binding', label: 'interface-binding: left.requests / requests',
        fromLabel: 'left.requests', toLabel: 'requests', fromId: 'left.requests', toId: 'requests' },
    { id: 'bind-responses', kind: 'interface-binding', label: 'interface-binding: left.responses / responses',
        fromLabel: 'left.responses', toLabel: 'responses', fromId: 'left.responses', toId: 'responses' }];
    const original = JSON.stringify(f.scene);
    global.BsvHardwareInspector.render(f.scene, f.visit, { native: true, disclose() {},
        select: (...args) => calls.push(['select', ...args]), openSource: ref => calls.push(['source', ref]) });
    const endpoints = d.nodes.filter(n => n.dataset.connectionEndpointId);
    assert.deepEqual(endpoints.map(n => [n.dataset.connectionEndpointRole, n.dataset.connectionEndpointId, n.textContent]),
        [['from', 'left.requests', 'left.requests'], ['to', 'requests', 'requests']]);
    const memberList = d.nodes.find(n => n.dataset.disclosureId === 'inspector-relations:inspector:summary');
    assert.equal(memberList.open, true);
    const members = d.nodes.filter(n => n.dataset.relationMemberId);
    assert.deepEqual(members.map(n => n.dataset.relationMemberId), ['bind-requests', 'bind-responses']);
    members[1].fire('click'); assert.deepEqual(calls.at(-1), ['select', 'bind-responses', true]);
    d.nodes.find(n => n.dataset.sourceOpenId === f.ref.id).fire('click'); assert.deepEqual(calls.at(-1), ['source', f.ref]);
    assert.ok(d.nodes.some(n => n.textContent === '바인딩 또는 별칭 관계입니다. 데이터 흐름 방향을 뜻하지 않습니다.'));
    assert.equal(JSON.stringify(f.scene), original);
});

test('native source, technical and relation disclosures restore from the persisted map; preview keeps top-level keys', () => {
    const f = presentation(), technical = 'inspector-details:inspector:root', relations = 'inspector-relations:inspector:root';
    const source = `source:${f.ref.pathRef}:${f.ref.range.start}:${f.ref.range.end}`;
    f.scene.inspector.connectionEssentials = { family: 'state-read', meaning: 'source-relation', from: [], to: [], memberCount: 1 };
    f.scene.inspector.relationMembers = [{ id: 'read-counter', kind: 'state-read', label: 'read counter', fromId: 'counter', toId: 'body' }];
    f.visit.disclosureState = { [technical]: false, [source]: false, [relations]: true,
        analysis: { disclosures: { [technical]: true, [source]: true, [relations]: false } } };
    const d = dom(); global.BsvHardwareInspector.render(f.scene, f.visit, { native: true, disclose() {} });
    assert.equal(d.nodes.find(n => n.dataset.disclosureId === technical).open, true);
    assert.equal(d.nodes.find(n => n.dataset.disclosureId === source).open, true);
    assert.equal(d.nodes.find(n => n.dataset.disclosureId === relations).open, false);
    assert.equal(d.nodes.filter(n => n.dataset.relationMemberId).length, 0);
    f.visit.disclosureState[source] = true; f.visit.disclosureState.analysis.disclosures[source] = false;
    const preview = dom(); global.BsvHardwareInspector.render(f.scene, f.visit, { native: false, disclose() {} });
    assert.equal(preview.nodes.find(n => n.dataset.disclosureId === source).open, true);
});

test('native code folds only empty absent evidence and retains nonempty source evidence', async () => {
    const { buildSource } = require('../src/hardware/correspondence/source');
    const { hash } = require('../src/hardware/json');
    const { createAnalysisQuery } = require('../src/hardware/analysis');
    const text = 'package SourceEvidence; function Bit#(8) bump(Bit#(8) x); return x + 1; endfunction endpackage';
    const built = buildSource([{ pathRef: 'SourceEvidence.bsv', contentHash: hash(text), text }]);
    const sourceModel = { ...built.semantic, sourceReferences: built.references, supplements: built.supplements };
    const api = createAnalysisQuery({ sourceModel }), context = api.getContext();
    const request = { kind: 'behavior', analysisId: context.analysisId, snapshotId: null, implementationProvider: 'stock',
        ownerInstanceId: null, implementationOccurrenceId: null, seed: { entityId: sourceModel.functionDefinitions[0].id },
        scope: { kind: 'source-only', rootOccurrenceId: null }, mode: 'build', queryGeneration: 1 };
    const result = await api.query(request), original = JSON.stringify(result), f = presentation();
    f.scene.provenance = { sourceModelIdentity: result.context.sourceModelIdentity };
    f.visit.analysis = { result, request };
    const handlers = { native: true, disclose() {}, analysisDisclosure() {}, patchAnalysis() {},
        analysisProjection: global.BsvHardwareAnalysis.projectAnalysis(f.scene, result) };
    const d = dom(); global.BsvHardwareInspector.render(f.scene, f.visit, handlers);
    const absent = d.nodes.find(n => n.dataset.analysisDisclosureId === `${result.queryId}:unattached-evidence`);
    assert.ok(absent); assert.equal(absent.open, false);
    assert.equal(d.nodes.filter(n => ['readiness', 'scheduling'].includes(n.dataset.codeSection)).length, 0);
    assert.ok(d.nodes.some(n => n.dataset.codeSection === 'predicate'));
    assert.ok(d.nodes.some(n => n.dataset.codeSection === 'body-conditions'));
    assert.deepEqual(JSON.parse(absent.children.find(n => n.tagName === 'pre').textContent), {
        readiness: result.code.readiness, compilerScheduling: result.code.scheduling.compiler });
    const preview = dom(); global.BsvHardwareInspector.render(f.scene, f.visit, { ...handlers, native: false });
    assert.equal(preview.nodes.filter(n => ['readiness', 'scheduling'].includes(n.dataset.codeSection)).length, 2);
    const displayOnly = structuredClone(result);
    displayOnly.code.readiness.evidence.push({ kind: 'display-only-readiness', expression: 'ready' });
    displayOnly.code.scheduling.sourceRelations.push({ kind: 'display-only-source-schedule', before: 'a', after: 'b' });
    f.visit.analysis.result = displayOnly;
    const nonempty = dom(); global.BsvHardwareInspector.render(f.scene, f.visit, handlers);
    assert.equal(nonempty.nodes.filter(n => ['readiness', 'scheduling'].includes(n.dataset.codeSection)).length, 2);
    assert.ok(nonempty.nodes.some(n => n.dataset.analysisDisclosureId === `${result.queryId}:source-schedule`));
    assert.equal(JSON.stringify(result), original);
});
const { nativeSourceStatus } = require('../media/hardware-view');

test('partial source inventory and limited design choices remain visible outside Settings', () => {
    const translate = (key, values = {}) => require('../media/hardware-strings').translate('en', key, values);
    const ready = nativeSourceStatus({ status: 'ready', analyzedFiles: 1 }, translate);
    for (const limitation of [{ status: 'partial' }, { truncated: true }, { unanalysed: [{ reason: 'file-byte-limit' }] }]) {
        const message = nativeSourceStatus({ status: 'ready', analyzedFiles: 1, ...limitation }, translate);
        assert.notEqual(message, ready);
        assert.match(message, /Partial source inventory/);
        assert.match(message, /source settings/);
    }
    const limited = nativeSourceStatus({ status: 'partial', analyzedFiles: 1,
        sourceIndexStatus: { status: 'limited', totalEntries: 1025, returnedEntries: 1024, entryLimit: 1024 } }, translate);
    assert.match(limited, /1,?024 of 1,?025/);
    assert.match(limited, /source designs/);
    assert.equal(ready.includes('Partial'), false);
});
