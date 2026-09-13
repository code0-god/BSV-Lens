'use strict';
(function (root) {
    const clone = value => JSON.parse(JSON.stringify(value));
    function createNavigation(model, { architecture = null, mode = architecture ? 'bsv' : 'rtl' } = {}) {
        const state = { snapshotId: model.snapshot.id, stage: model.snapshot.stage, sceneKind: mode,
            ownerId: null, bsvContext: null, rtlSignals: false, rootId: null,
            expanded: [], selectedId: null, selectedBit: null, source: null,
            viewport: null, panels: { hierarchy: false }, trace: null };
        const history = { back: [], forward: [] };
        const snapshot = () => clone(state);
        const restore = value => Object.assign(state, clone(value));
        const occurrences = () => state.sceneKind === 'bsv' ? architecture.occurrences : model.occurrences;
        function go(id) {
            if (id === state.rootId) return false;
            const items = occurrences();
            if (id !== null && !items[id]) throw new Error('Unknown navigation occurrence');
            history.back.push(snapshot());
            history.forward.length = 0;
            const path = [];
            for (let item = items[id]; item; item = items[item.parentId]) path.unshift(item.id);
            Object.assign(state, { rootId: id, expanded: path, selectedId: null, selectedBit: null,
                source: null, viewport: null, trace: null, rtlSignals: false,
                ...(state.sceneKind === 'bsv' ? { ownerId: id } : {}) });
            return true;
        }
        function travel(from, to) {
            if (!history[from].length) return false;
            history[to].push(snapshot());
            restore(history[from].pop());
            return true;
        }
        return { state, history, snapshot, go,
            enter(id) {
                const item = occurrences()[id];
                if (!item || item.blackbox || (state.sceneKind === 'rtl' && !item.cells.length) || id === state.rootId) return false;
                return go(id);
            },
            inspect(id, bit = null) {
                if (id !== state.selectedId) state.rtlSignals = false;
                state.selectedId = id; state.selectedBit = bit; state.source = null;
            },
            viewport(value) { state.viewport = clone(value); },
            source(value) { state.source = clone(value); },
            openRTL(ownerId, rtlOwnerId, verifiedEntityIds = []) {
                if (!architecture?.occurrences[ownerId]) throw new Error('Unknown BSV owner');
                if (!model.occurrences[rtlOwnerId]) throw new Error('Unknown implementation owner');
                if (state.sceneKind === 'rtl' && state.ownerId === ownerId && state.rootId === rtlOwnerId) return false;
                const context = snapshot();
                history.back.push(context); history.forward.length = 0;
                const path = [];
                for (let item = model.occurrences[rtlOwnerId]; item; item = model.occurrences[item.parentId]) path.unshift(item.id);
                Object.assign(state, { sceneKind: 'rtl', ownerId, rootId: rtlOwnerId, expanded: path,
                    bsvContext: context, viewport: null, trace: { verifiedEntityIds: [...verifiedEntityIds] } });
                return true;
            },
            returnBSV() {
                if (state.sceneKind !== 'rtl' || !state.bsvContext) return false;
                const context = state.bsvContext;
                history.back.push(snapshot()); history.forward.length = 0; restore(context);
                return true;
            },
            up() { return state.rootId !== null && go(occurrences()[state.rootId].parentId); },
            back: () => travel('back', 'forward'), forward: () => travel('forward', 'back') };
    }
    const api = { createNavigation };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.HardwareNavigation = api;
})(globalThis);
