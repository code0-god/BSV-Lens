'use strict';

(function expose(root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.BsvArchitectureNavigation = api;
}(typeof globalThis === 'undefined' ? null : globalThis, function createApi() {
    const STATE_VERSION = 2;
    const HISTORY_LIMIT = 100;
    const SNAPSHOT_KEYS = Object.freeze([
        'analysisContext', 'sourceScope', 'level', 'analysisMode', 'hopScope',
        'focusStack', 'projectionFocusId', 'selectedId', 'selectedRelationId', 'filters', 'collapsedGroups',
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
            presentationId: null,
            sourceRevision: null,
            codeContainerId: null,
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
            presentationId: value.presentationId || value.subject?.id || null,
            sourceRevision: value.sourceRevision || null,
            codeContainerId: value.codeContainerId || null,
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
        const resolveCodeSubject = typeof options.resolveCodeSubject === 'function'
            ? options.resolveCodeSubject : () => null;
        let modelRevision = Number.isInteger(options.modelRevision) ? options.modelRevision : 0;
        let semanticParentSnapshot = null;

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

        function contextFor(candidate, presentationNode, semanticSubject = presentationNode, metadata = {}) {
            const semanticOwner = exactNode(semanticSubject?.ownerInstanceId);
            const owner = metadata.definitionOnly ? null
                : semanticOwner?.architectureInstance ? semanticOwner
                    : ownerInstance(presentationNode)
                        || ownerInstance(exactNode(candidate.focusStack?.at(-1)));
            const root = metadata.definitionOnly ? null
                : owner ? rootFor(owner.id) : presentationNode ? rootFor(presentationNode.id) : null;
            const path = owner ? focusPath(owner.id) : [];
            return {
                modelRevision,
                rootInstanceId: root?.id || null,
                ownerInstanceId: owner?.id || semanticSubject?.ownerInstanceId || null,
                occurrencePath: path,
                subject: {
                    kind: semanticSubject?.kind || presentationNode?.kind || null,
                    id: semanticSubject?.id || presentationNode?.id || null
                },
                presentationId: metadata.presentationId || presentationNode?.id || null,
                sourceRevision: metadata.sourceRevision || semanticSubject?.sourceRevision || null,
                codeContainerId: metadata.codeContainerId || candidate.analysisContext?.codeContainerId || null,
                entryCallSiteId: metadata.entryCallSiteId
                    || semanticSubject?.entryCallSiteId
                    || presentationNode?.entryCallSiteId
                    || presentationNode?.details?.entryCallSiteId || null,
                bindingEnvironmentId: metadata.bindingEnvironmentId
                    || semanticSubject?.bindingEnvironmentId
                    || presentationNode?.bindingEnvironmentId
                    || presentationNode?.details?.bindingEnvironmentId || null,
                level: candidate.level,
                mode: candidate.analysisMode
            };
        }

        function candidateFor(node, changes, semanticSubject = node, metadata = {}) {
            const candidate = clone(state);
            Object.assign(candidate, changes);
            if (Object.prototype.hasOwnProperty.call(changes, 'selectedId')) {
                candidate.selectedRelationId = null;
            }
            candidate.analysisContext = contextFor(candidate, node, semanticSubject, metadata);
            candidate.navigationRecovery = null;
            candidate.navigationVersion = STATE_VERSION;
            return candidate;
        }

        function applyCandidate(candidate, recordHistory, historySource = null) {
            if (!project(candidate)) return { status: 'unresolved' };
            if (recordHistory) {
                state.navigationHistory.back.push(clone(historySource) || snapshot(state));
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
                    projectionFocusId: node.architectureInstance ? null : node.id,
                    selectedId: node.id
                };
            }, { history: true });
        }

        function enterInstance(nodeId) {
            return transition(nodeId, (node) => ({
                level: 'module',
                focusStack: focusPath(node.id),
                projectionFocusId: null,
                selectedId: node.id
            }), {
                history: true,
                accept: (node) => node.architectureInstance === true
            });
        }

        function inspectChannel(subject, presentationId = subject?.id || subject) {
            const presentation = exactNode(presentationId);
            const semantic = typeof subject === 'object' ? subject : presentation;
            if (!presentation || presentation.kind !== 'protocol-channel' || !semantic?.id) {
                return { status: 'unresolved' };
            }
            const candidate = candidateFor(presentation, { selectedId: presentation.id }, semantic);
            const result = applyCandidate(candidate, true);
            if (result.status === 'committed') semanticParentSnapshot = snapshot(state);
            return result;
        }

        function inspectEndpoint(subject, presentationId = subject?.id || subject) {
            const presentation = exactNode(presentationId);
            const semantic = typeof subject === 'object' ? subject : presentation;
            if (!presentation || presentation.kind !== 'endpoint' || !semantic?.id) {
                return { status: 'unresolved' };
            }
            return applyCandidate(candidateFor(presentation, {
                selectedId: presentation.id
            }, semantic), false);
        }

        function enterBehavior(nodeId, metadata = {}) {
            const node = exactNode(nodeId);
            if (!node || !['rule', 'method', 'function'].includes(node.kind)) {
                return { status: 'unresolved' };
            }
            const owner = ownerInstance(node);
            const candidate = candidateFor(node, {
                level: 'behavior',
                focusStack: owner ? focusPath(owner.id) : state.focusStack,
                projectionFocusId: null,
                selectedId: node.id
            }, metadata.subject || node, metadata);
            const historySource = metadata.fromSemanticParent ? semanticParentSnapshot : null;
            const result = applyCandidate(candidate, metadata.replaceCurrent !== true, historySource);
            if (result.status === 'committed') semanticParentSnapshot = null;
            return result;
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

        function inspectFlow(subject, presentationId) {
            if (!subject?.id || !presentationId) return { status: 'unresolved' };
            const candidate = candidateFor(null, {
                selectedId: null,
                selectedRelationId: presentationId
            }, subject, { presentationId });
            candidate.selectedRelationId = presentationId;
            return applyCandidate(candidate, false);
        }

        function enterCodeDefinition(subject) {
            if (!subject?.id || !subject.sourceRevision) return { status: 'unresolved' };
            const candidate = candidateFor(null, {
                level: 'behavior',
                focusStack: [],
                projectionFocusId: null,
                selectedId: null
            }, subject, {
                definitionOnly: true,
                sourceRevision: subject.sourceRevision,
                codeContainerId: subject.id,
                entryCallSiteId: null,
                bindingEnvironmentId: null
            });
            return applyCandidate(candidate, true);
        }

        function inspectCode(subject, presentationId = subject?.id || subject, metadata = {}) {
            const semantic = typeof subject === 'object' ? subject : resolveCodeSubject(subject);
            const presentation = exactNode(presentationId);
            if (!semantic?.id || presentationId && !presentation) return { status: 'unresolved' };
            const candidate = candidateFor(presentation, {
                level: 'behavior',
                selectedId: presentation?.id || null
            }, semantic, metadata);
            return applyCandidate(candidate, false);
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
            candidate.analysisContext = {
                ...candidate.analysisContext,
                modelRevision,
                level: candidate.level,
                mode: candidate.analysisMode
            };
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

        function staleCodeSubject(value) {
            const subjectId = value.analysisContext?.subject?.id;
            const presentationId = value.analysisContext?.presentationId;
            if (!subjectId || subjectId === presentationId || !value.analysisContext?.sourceRevision) return null;
            const current = resolveCodeSubject(subjectId);
            return !current || current.sourceRevision !== value.analysisContext.sourceRevision
                ? subjectId : null;
        }

        function staleIdentity(value) {
            const staleCodeId = staleCodeSubject(value);
            if (staleCodeId) return staleCodeId;
            if (value.selectedId && !exactNode(value.selectedId)) return value.selectedId;
            const path = Array.isArray(value.focusStack) ? value.focusStack : [];
            const missingPathId = path.find((id) => !exactNode(id));
            if (missingPathId) return missingPathId;
            const subjectId = value.analysisContext?.subject?.id;
            const presentationId = value.analysisContext?.presentationId;
            return subjectId && (!presentationId || presentationId === subjectId) && !exactNode(subjectId)
                ? subjectId : null;
        }

        function reconcileValue(value) {
            const original = clone(value || {});
            const missingIdentity = staleIdentity(original);
            const validPath = reconcilePath(original.focusStack);
            const staleCodeId = staleCodeSubject(original);
            if (staleCodeId) {
                const presentation = exactNode(original.analysisContext?.presentationId);
                if (presentation) {
                    const candidate = {
                        ...original,
                        selectedId: presentation.id,
                        navigationRecovery: {
                            status: 'stale',
                            missingIdentity: staleCodeId,
                            reason: 'code-source-revision-stale'
                        }
                    };
                    candidate.analysisContext = contextFor(candidate, presentation);
                    if (project(candidate)) return candidate;
                }
            }
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
            inspectFlow,
            enterCodeDefinition,
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
