'use strict';

(function expose(root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.BsvArchitectureNavigation = api;
}(typeof globalThis === 'undefined' ? null : globalThis, function createApi() {
    const STATE_VERSION = 1;
    const HISTORY_LIMIT = 100;
    const SNAPSHOT_KEYS = Object.freeze([
        'analysisContext', 'sourceScope', 'level', 'analysisMode', 'hopScope',
        'focusStack', 'selectedId', 'filters', 'collapsedGroups',
        'expandedAggregations', 'trace', 'transform', 'search', 'navigationRecovery'
    ]);

    function clone(value) {
        if (value === undefined) return undefined;
        return JSON.parse(JSON.stringify(value));
    }

    function emptyContext(state = {}, modelRevision = 0) {
        return {
            modelRevision: Number.isInteger(modelRevision) ? modelRevision : 0,
            rootInstanceId: null,
            ownerInstanceId: null,
            occurrencePath: [],
            subject: { kind: null, id: null },
            entryCallSiteId: null,
            bindingEnvironmentId: null,
            level: state.level || 'system',
            mode: state.analysisMode || 'structure'
        };
    }

    function normalizeContext(value, state, modelRevision) {
        const base = emptyContext(state, modelRevision);
        if (!value || typeof value !== 'object') return base;
        return {
            modelRevision: Number.isInteger(modelRevision)
                ? modelRevision
                : Number.isInteger(value.modelRevision) ? value.modelRevision : 0,
            rootInstanceId: value.rootInstanceId || null,
            ownerInstanceId: value.ownerInstanceId || null,
            occurrencePath: Array.isArray(value.occurrencePath)
                ? value.occurrencePath.filter((id) => typeof id === 'string') : [],
            subject: {
                kind: value.subject?.kind || null,
                id: value.subject?.id || null
            },
            entryCallSiteId: value.entryCallSiteId || null,
            bindingEnvironmentId: value.bindingEnvironmentId || null,
            level: state.level || value.level || 'system',
            mode: state.analysisMode || value.mode || 'structure'
        };
    }

    function normalizeHistory(value) {
        return {
            back: Array.isArray(value?.back) ? value.back.slice(-HISTORY_LIMIT).map(clone) : [],
            forward: Array.isArray(value?.forward) ? value.forward.slice(-HISTORY_LIMIT).map(clone) : []
        };
    }

    function migrateState(saved) {
        const state = saved && typeof saved === 'object' ? saved : {};
        state.navigationVersion = STATE_VERSION;
        state.analysisContext = normalizeContext(
            state.analysisContext,
            state,
            state.analysisContext?.modelRevision
        );
        state.navigationHistory = normalizeHistory(state.navigationHistory);
        state.navigationRecovery = state.navigationRecovery?.status === 'stale'
            ? clone(state.navigationRecovery)
            : null;
        return state;
    }

    function snapshot(state) {
        const result = {};
        for (const key of SNAPSHOT_KEYS) result[key] = clone(state[key]);
        return result;
    }

    function restore(state, value) {
        for (const key of SNAPSHOT_KEYS) {
            if (Object.prototype.hasOwnProperty.call(value, key)) state[key] = clone(value[key]);
        }
    }

    function createIntentController(options) {
        const state = migrateState(options.state || {});
        const getNode = options.getNode;
        const focusPath = options.focusPath;
        const rootFor = options.rootFor;
        const project = typeof options.project === 'function' ? options.project : () => true;
        let modelRevision = Number.isInteger(options.modelRevision) ? options.modelRevision : 0;

        function exactNode(id) {
            return typeof id === 'string' && id ? getNode(id) || null : null;
        }

        function ownerInstance(node) {
            let current = node;
            const seen = new Set();
            while (current && !seen.has(current.id)) {
                seen.add(current.id);
                if (current.architectureInstance) return current;
                current = current.parentId ? exactNode(current.parentId) : null;
            }
            return null;
        }

        function contextFor(candidate, subjectNode) {
            const owner = ownerInstance(subjectNode)
                || ownerInstance(exactNode(candidate.focusStack?.at(-1)));
            const root = owner ? rootFor(owner.id) : subjectNode ? rootFor(subjectNode.id) : null;
            const path = owner ? focusPath(owner.id) : [];
            return {
                modelRevision,
                rootInstanceId: root?.id || null,
                ownerInstanceId: owner?.id || null,
                occurrencePath: path,
                subject: {
                    kind: subjectNode?.kind || null,
                    id: subjectNode?.id || null
                },
                entryCallSiteId: subjectNode?.entryCallSiteId
                    || subjectNode?.details?.entryCallSiteId || null,
                bindingEnvironmentId: subjectNode?.bindingEnvironmentId
                    || subjectNode?.details?.bindingEnvironmentId || null,
                level: candidate.level,
                mode: candidate.analysisMode
            };
        }

        function candidateFor(node, changes) {
            const candidate = clone(state);
            Object.assign(candidate, changes);
            candidate.analysisContext = contextFor(candidate, node);
            candidate.navigationRecovery = null;
            candidate.navigationVersion = STATE_VERSION;
            return candidate;
        }

        function applyCandidate(candidate, recordHistory) {
            if (!project(candidate)) return { status: 'unresolved' };
            if (recordHistory) {
                state.navigationHistory.back.push(snapshot(state));
                state.navigationHistory.back = state.navigationHistory.back.slice(-HISTORY_LIMIT);
                state.navigationHistory.forward = [];
            }
            const history = state.navigationHistory;
            restore(state, candidate);
            state.navigationVersion = STATE_VERSION;
            state.navigationHistory = history;
            return { status: 'committed' };
        }

        function transition(nodeId, changes, rules = {}) {
            const node = exactNode(nodeId);
            if (!node || rules.accept && !rules.accept(node)) return { status: 'unresolved' };
            const resolvedChanges = typeof changes === 'function' ? changes(node) : changes;
            return applyCandidate(candidateFor(node, resolvedChanges), rules.history === true);
        }

        function selectEntity(nodeId) {
            return transition(nodeId, { selectedId: nodeId }, { history: false });
        }

        function clearSelection() {
            const subject = exactNode(state.focusStack?.at(-1));
            return applyCandidate(candidateFor(subject, { selectedId: null }), false);
        }

        function focusEntity(nodeId) {
            return transition(nodeId, (node) => {
                const owner = ownerInstance(node);
                return {
                    focusStack: owner ? focusPath(owner.id) : [node.id],
                    selectedId: node.id
                };
            }, { history: true });
        }

        function enterInstance(nodeId) {
            return transition(nodeId, (node) => ({
                level: 'module',
                focusStack: focusPath(node.id),
                selectedId: node.id
            }), {
                history: true,
                accept: (node) => node.architectureInstance === true
            });
        }

        function inspectChannel(nodeId) {
            return transition(nodeId, { selectedId: nodeId }, {
                accept: (node) => node.kind === 'protocol-channel'
            });
        }

        function inspectEndpoint(nodeId) {
            return transition(nodeId, { selectedId: nodeId }, {
                accept: (node) => node.kind === 'endpoint'
            });
        }

        function enterBehavior(nodeId) {
            return transition(nodeId, (node) => {
                const owner = ownerInstance(node);
                return {
                    level: 'behavior',
                    focusStack: owner ? focusPath(owner.id) : state.focusStack,
                    selectedId: node.id
                };
            }, {
                history: true,
                accept: (node) => ['rule', 'method', 'function'].includes(node.kind)
            });
        }

        function enterFunctionCall(nodeId) {
            return transition(nodeId, (node) => {
                const owner = ownerInstance(node);
                return {
                    level: 'behavior',
                    focusStack: owner ? focusPath(owner.id) : state.focusStack,
                    selectedId: node.id
                };
            }, {
                history: true,
                accept: (node) => ['function', 'method'].includes(node.kind)
            });
        }

        function inspectCode(nodeId) {
            return selectEntity(nodeId);
        }

        function effect(type, nodeId) {
            const node = exactNode(nodeId);
            if (!node) return { status: 'unresolved' };
            return {
                status: 'effect',
                effect: {
                    type,
                    nodeId: node.id,
                    modelRevision,
                    revision: modelRevision,
                    context: state.analysisContext
                }
            };
        }

        function openDefinition(nodeId) {
            const node = exactNode(nodeId);
            const targetId = node?.details?.targetId;
            return targetId && exactNode(targetId)
                ? effect('openDefinition', targetId)
                : { status: 'unresolved' };
        }

        function openSource(nodeId) {
            return effect('openSource', nodeId);
        }

        function setProjection(changes) {
            const subject = exactNode(state.selectedId) || exactNode(state.focusStack?.at(-1));
            return applyCandidate(candidateFor(subject, changes), true);
        }

        function navigateBreadcrumb(index) {
            const path = Array.isArray(state.focusStack) ? state.focusStack : [];
            const nextPath = index < 0 ? [] : path.slice(0, index + 1);
            const subject = exactNode(nextPath.at(-1));
            return applyCandidate(candidateFor(subject, {
                focusStack: nextPath,
                selectedId: subject?.id || null
            }), false);
        }

        function navigateHistory(from, to) {
            if (!state.navigationHistory[from].length) return { status: 'unresolved' };
            const target = state.navigationHistory[from].at(-1);
            const candidate = clone(state);
            restore(candidate, target);
            candidate.analysisContext = reconcileContext(candidate, modelRevision);
            if (!project(candidate)) return { status: 'unresolved' };
            state.navigationHistory[from].pop();
            state.navigationHistory[to].push(snapshot(state));
            restore(state, candidate);
            return { status: 'committed' };
        }

        function goBack() { return navigateHistory('back', 'forward'); }
        function goForward() { return navigateHistory('forward', 'back'); }

        function reconcilePath(path) {
            const valid = [];
            for (const id of Array.isArray(path) ? path : []) {
                if (!exactNode(id)) break;
                valid.push(id);
            }
            return valid;
        }

        function staleIdentity(value) {
            if (value.selectedId && !exactNode(value.selectedId)) return value.selectedId;
            const path = Array.isArray(value.focusStack) ? value.focusStack : [];
            const missingPathId = path.find((id) => !exactNode(id));
            if (missingPathId) return missingPathId;
            const subjectId = value.analysisContext?.subject?.id;
            return subjectId && !exactNode(subjectId) ? subjectId : null;
        }

        function reconcileValue(value) {
            const original = clone(value || {});
            const missingIdentity = staleIdentity(original);
            const validPath = reconcilePath(original.focusStack);
            if (!missingIdentity) {
                const candidate = { ...original, focusStack: validPath, navigationRecovery: null };
                candidate.analysisContext = reconcileContext(candidate);
                return project(candidate) ? candidate : null;
            }

            const ownerId = original.analysisContext?.ownerInstanceId;
            const pathOwner = exactNode(validPath.at(-1));
            const owner = exactNode(ownerId)?.architectureInstance
                ? exactNode(ownerId)
                : pathOwner?.architectureInstance ? pathOwner : null;
            const rootId = original.analysisContext?.rootInstanceId;
            const rootExists = rootId ? Boolean(exactNode(rootId)) : Boolean(owner && rootFor(owner.id));
            if (owner && rootExists) {
                const candidate = {
                    ...original,
                    level: 'module',
                    focusStack: focusPath(owner.id),
                    selectedId: owner.id,
                    navigationRecovery: {
                        status: 'stale',
                        missingIdentity,
                        reason: 'subject-missing-owner-recovered'
                    }
                };
                candidate.analysisContext = contextFor(candidate, owner);
                if (project(candidate)) return candidate;
            }

            const workspace = {
                ...original,
                level: 'system',
                focusStack: [],
                selectedId: null,
                navigationRecovery: {
                    status: 'stale',
                    missingIdentity,
                    reason: 'root-missing-workspace-recovered'
                }
            };
            workspace.analysisContext = contextFor(workspace, null);
            return project(workspace) ? workspace : null;
        }

        function reconcileSnapshot(value) {
            return reconcileValue(value);
        }

        function reconcileContext(value) {
            const focus = reconcilePath(value.focusStack);
            const subject = exactNode(value.selectedId) || exactNode(focus.at(-1));
            const candidate = { ...value, focusStack: focus };
            return contextFor(candidate, subject);
        }

        function reconcileModel(revision) {
            if (Number.isInteger(revision)) modelRevision = revision;
            state.navigationHistory.back = state.navigationHistory.back
                .map(reconcileSnapshot).filter(Boolean);
            state.navigationHistory.forward = state.navigationHistory.forward
                .map(reconcileSnapshot).filter(Boolean);
            const candidate = reconcileValue(state);
            if (candidate) restore(state, candidate);
            else state.navigationRecovery = {
                status: 'stale',
                missingIdentity: staleIdentity(state),
                reason: 'recovery-projection-unavailable'
            };
            state.analysisContext.modelRevision = modelRevision;
            state.navigationVersion = STATE_VERSION;
            return state.analysisContext;
        }

        return {
            selectEntity,
            clearSelection,
            focusEntity,
            enterInstance,
            inspectChannel,
            inspectEndpoint,
            enterBehavior,
            enterFunctionCall,
            inspectCode,
            openDefinition,
            openSource,
            goBack,
            goForward,
            setProjection,
            navigateBreadcrumb,
            reconcileModel,
            get modelRevision() { return modelRevision; }
        };
    }

    return { STATE_VERSION, SNAPSHOT_KEYS, migrateState, createIntentController };
}));
