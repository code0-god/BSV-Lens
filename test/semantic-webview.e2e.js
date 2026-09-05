'use strict';

const fs = require('node:fs');
const { test, expect } = require('@playwright/test');

fs.mkdirSync('.build/visual-qa-v040', { recursive: true });

function browserErrors(page) {
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
        if (message.type() === 'error') errors.push(message.text());
    });
    return errors;
}

async function focusNode(page, name) {
    const node = page.locator('.arch-node').filter({ hasText: name }).first();
    await node.click();
    await page.getByRole('button', { name: 'Set as focus' }).click();
    return node;
}

async function expectNodesInsideCanvas(page) {
    expect(await page.locator('.arch-node').evaluateAll((nodes) => {
        const canvas = document.getElementById('architecture-canvas').getBoundingClientRect();
        return nodes.filter((node) => {
            const rect = node.getBoundingClientRect();
            return rect.left < canvas.left - 1
                || rect.right > canvas.right + 1
                || rect.top < canvas.top - 1
                || rect.bottom > canvas.bottom + 1;
        }).map((node) => node.dataset.nodeId);
    })).toEqual([]);
}

test('System Structure defaults to instance architecture and drills into channels', async ({ page }) => {
    const errors = browserErrors(page);

    // Given
    await page.goto('/');

    // Then
    await expect(page.locator('#packages-filter')).toContainText('Source Map');
    await expect(page.locator('#show-packages')).not.toBeChecked();
    await expect(page.locator('.kind-package')).toHaveCount(0);
    await expect(page.locator('.kind-instance .node-title')).toContainText([
        'mkFlowTop',
        'scheduler',
        'worker'
    ]);
    await expect(exactNavigationNode(page, 'scheduler', 'instance'))
        .toContainText('mkScheduler');
    await page.locator('#fit').click();
    await expectNodesInsideCanvas(page);
    await page.screenshot({
        path: '.build/visual-qa-v040/system-architecture.png',
        fullPage: true
    });

    // When
    await focusNode(page, 'scheduler');
    await page.locator('[data-level="module"]').click();

    // Then
    await expect(page.locator('#breadcrumbs')).toContainText('scheduler');
    await expect(page.locator('.kind-member-group').filter({ hasText: 'Protocol Channels' }))
        .toBeVisible();
    await expect(page.locator('.kind-member-group').filter({ hasText: 'State' }))
        .toBeVisible();
    await expect(page.locator('.kind-member-group').filter({ hasText: 'Methods' }))
        .toBeVisible();
    await expect(page.locator('.kind-protocol-channel .node-title')).toContainText([
        'Completion',
        'Lookahead',
        'Publish',
        'Start',
        'Work'
    ]);
    await expect(page.locator('.kind-endpoint')).toHaveCount(0);
    await page.locator('#fit').click();
    await expectNodesInsideCanvas(page);
    await page.screenshot({
        path: '.build/visual-qa-v040/system-instance-structure.png',
        fullPage: true
    });
    expect(errors).toEqual([]);
});

test('System Data Flow renders typed instance flow and directed trace', async ({ page }) => {
    const errors = browserErrors(page);

    // Given
    await page.goto('/');

    // When
    await page.locator('[data-analysis-mode="data-flow"]').click();

    // Then
    await expect(exactNavigationNode(page, 'scheduler', 'instance')).toBeVisible();
    await expect(page.locator('.kind-instance').filter({ hasText: 'worker' })).toBeVisible();
    await expect(page.locator('.edge-label')).toContainText('ArrayWork#(arrayDim)');
    const aggregateFlow = await page.evaluate(() => {
        const scheduler = window.__model.nodes.find((node) => node.architectureInstance && node.name === 'scheduler');
        const worker = window.__model.nodes.find((node) => node.architectureInstance && node.name === 'worker');
        const edge = window.__model.edges.find((candidate) =>
            candidate.kind === 'payload' && candidate.source === scheduler.id && candidate.target === worker.id
        );
        const flow = window.__model.semanticFlows.find((candidate) => candidate.id === edge.semanticId);
        return { edgeId: edge.id, behaviorId: flow.causeBehaviorId, callSiteId: flow.callSiteId,
            ownerInstanceId: flow.ownerInstanceId,
            evidenceRange: flow.evidenceRefs[0].sourceRange };
    });
    const aggregateFlowEdgeId = aggregateFlow.edgeId;
    await page.locator(`.edge-group[data-edge-id="${aggregateFlowEdgeId}"]`).click();
    await expect(page.locator('#inspector')).toContainText('Semantic Flow ID');
    await expect(page.locator('#inspector')).toContainText('currentWork');
    await expect(page.locator('#inspector')).toContainText('start');
    await expect(page.locator('#inspector')).toContainText('Consumer argument');
    await expect(page.locator('#inspector')).toContainText('work');
    await expect(page.locator('#inspector')).toContainText('Cause behavior');
    await expect(page.locator('#inspector')).toContainText('bridge');
    await expect(page.getByRole('button', { name: 'Inspect producer', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Inspect consumer', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Inspect transfer code', exact: true })).toBeVisible();
    await subscribeToHostMessage(page, 'openSource');
    await page.getByRole('button', { name: 'Open source evidence', exact: true }).click();
    expect(await nextHostMessage(page)).toMatchObject({
        type: 'openSource',
        nodeId: aggregateFlow.behaviorId,
        location: aggregateFlow.evidenceRange
    });
    const transferState = {
        level: 'behavior',
        selectedId: aggregateFlow.behaviorId,
        analysisContext: {
            ownerInstanceId: aggregateFlow.ownerInstanceId,
            presentationId: aggregateFlow.behaviorId,
            subject: { kind: 'rule', id: aggregateFlow.behaviorId },
            entryCallSiteId: aggregateFlow.callSiteId
        }
    };
    await subscribeToState(page, transferState);
    await page.getByRole('button', { name: 'Inspect transfer code', exact: true }).click();
    expect(await nextState(page)).toMatchObject(transferState);
    await expect(page.locator('#inspector')).toContainText('worker.start(work, priorAccumulation);');
    await subscribeToState(page, { level: 'system', analysisMode: 'data-flow', selectedId: null });
    await page.getByRole('button', { name: 'Back', exact: true }).click();
    await nextState(page);

    // When
    await exactNavigationNode(page, 'scheduler', 'instance').click();
    await page.getByRole('button', { name: 'Trace from here' }).click();
    await page.locator('.kind-instance').filter({ hasText: 'worker' }).click();
    await page.getByRole('button', { name: 'Trace to here' }).click();

    // Then
    await expect(page.locator('#tracebar')).toContainText('Path 1 of');
    await expect(page.locator('#tracebar')).toContainText('ArrayWork#(arrayDim)');
    await page.locator('#fit').click();
    await expectNodesInsideCanvas(page);
    await page.screenshot({
        path: '.build/visual-qa-v040/system-typed-flow.png',
        fullPage: true
    });

    await page.getByRole('button', { name: 'Clear trace', exact: true }).click();
    await exactNavigationNode(page, 'scheduler', 'instance').click();
    await page.getByRole('button', { name: 'Trace from here', exact: true }).click();
    await exactNavigationNode(page, 'schedulerMirror', 'instance').click();
    await subscribeToState(page, { trace: { status: 'no-path' } });
    await page.getByRole('button', { name: 'Trace to here', exact: true }).click();
    expect(await nextState(page)).toMatchObject({ trace: { status: 'no-path' } });
    await expect(page.locator('#tracebar')).toContainText('No canonical semantic payload path');
    await expect(page.locator('#tracebar')).not.toContainText('current view');
    expect(errors).toEqual([]);
});

test('Behavior view exposes deterministic semantic evidence and source navigation', async ({ page }) => {
    const errors = browserErrors(page);

    // Given
    await page.goto('/');
    await focusNode(page, 'mkFlowTop');

    // When
    await page.locator('[data-level="behavior"]').click();
    await page.locator('[data-analysis-mode="data-flow"]').click();
    const bridge = page.locator('.kind-rule').filter({ hasText: 'bridge' });
    const bridgeId = await bridge.getAttribute('data-node-id');
    await subscribeToState(page, { selectedId: bridgeId });
    await bridge.click();
    await nextState(page);

    // Then
    await expect(page.locator('#inspector')).toContainText('Summary');
    await expect(page.locator('#inspector')).toContainText('Callable predicate');
    await expect(page.locator('#inspector')).toContainText('Inputs');
    await expect(page.locator('#inspector')).toContainText('Outputs');
    await expect(page.locator('#inspector')).toContainText('State reads');
    await expect(page.locator('#inspector')).toContainText('State writes');
    await expect(page.locator('#inspector')).toContainText('Invocations');
    await expect(page.locator('#inspector')).toContainText('Protocol membership');
    await expect(page.locator('#inspector')).toContainText('Upstream');
    await expect(page.locator('#inspector')).toContainText('Downstream');
    await expect(page.locator('#inspector')).toContainText('Source evidence');
    const sourceRequested = page.waitForFunction(() =>
        window.__hostMessages.some((message) =>
            message.type === 'openSource' && message.nodeId?.includes('bridge')
        )
    );
    await page.getByRole('button', { name: 'Open source' }).click();
    await sourceRequested;
    await page.locator('#fit').click();
    await expectNodesInsideCanvas(page);
    await page.screenshot({
        path: '.build/visual-qa-v040/behavior-evidence.png',
        fullPage: true
    });
    expect(errors).toEqual([]);
});

test('Packages filter exposes secondary Source Map and clears stale selection', async ({ page }) => {
    const errors = browserErrors(page);

    // Given
    await page.goto('/');
    await page.locator('#show-packages').check();
    const packageNode = page.locator('.kind-package').first();
    await expect(packageNode).toBeVisible();
    await packageNode.click();
    expect(await page.evaluate(() => window.__savedState.selectedId)).not.toBeNull();

    // When
    await page.locator('#show-packages').uncheck();

    // Then
    await expect(page.locator('.kind-package')).toHaveCount(0);
    await expect(page.locator('.kind-instance')).not.toHaveCount(0);
    expect(await page.evaluate(() => window.__savedState.selectedId)).toBeNull();
    expect(errors).toEqual([]);
});

function exactNavigationNode(page, name, kind) {
    return page.locator(`.arch-node.kind-${kind}`).filter({
        has: page.locator('.node-title', { hasText: new RegExp(`^${name}$`) })
    });
}

async function subscribeToState(page, expected) {
    await page.evaluate((match) => {
        const matches = (actual, wanted) => Object.entries(wanted).every(([key, value]) =>
            value && typeof value === 'object' && !Array.isArray(value)
                ? matches(actual?.[key], value)
                : JSON.stringify(actual?.[key]) === JSON.stringify(value)
        );
        window.__nextBsvState = new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                window.removeEventListener('bsv-webview-state', onState);
                reject(new Error(`Timed out waiting for state ${JSON.stringify(match)}`));
            }, 5000);
            const onState = (event) => {
                if (!matches(event.detail, match)) return;
                clearTimeout(timeout);
                window.removeEventListener('bsv-webview-state', onState);
                resolve(event.detail);
            };
            window.addEventListener('bsv-webview-state', onState);
        });
    }, expected);
}

async function nextState(page) {
    return page.evaluate(() => window.__nextBsvState);
}

async function subscribeToHostMessage(page, type) {
    await page.evaluate((messageType) => {
        window.__nextBsvHostMessage = new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                window.removeEventListener('bsv-host-message', onMessage);
                reject(new Error(`Timed out waiting for host message ${messageType}`));
            }, 5000);
            const onMessage = (event) => {
                if (event.detail?.type !== messageType) return;
                clearTimeout(timeout);
                window.removeEventListener('bsv-host-message', onMessage);
                resolve(event.detail);
            };
            window.addEventListener('bsv-host-message', onMessage);
        });
    }, type);
}

async function nextHostMessage(page) {
    return page.evaluate(() => window.__nextBsvHostMessage);
}

test('Gate A double-click entry preserves occurrences with full Back and Forward snapshots', async ({ page }) => {
    const errors = browserErrors(page);
    await page.goto('/');

    const identities = await page.evaluate(() => {
        const root = window.__model.nodes.find((node) =>
            node.architectureInstance && node.details?.root && node.name === 'mkFlowTop'
        );
        const child = window.__model.nodes.find((node) =>
            node.architectureInstance && node.parentId === root.id && node.name === 'scheduler'
        );
        const method = window.__model.nodes.find((node) =>
            node.parentId === child.id && node.kind === 'method' && node.name === 'currentWork'
        );
        return { root: root.id, child: child.id, method: method.id };
    });

    const rootState = {
        level: 'module',
        focusStack: [identities.root],
        selectedId: identities.root,
        analysisContext: {
            rootInstanceId: identities.root,
            ownerInstanceId: identities.root,
            occurrencePath: [identities.root],
            subject: { kind: 'instance', id: identities.root },
            level: 'module',
            mode: 'structure'
        }
    };
    await subscribeToState(page, rootState);
    await exactNavigationNode(page, 'mkFlowTop', 'instance').dblclick();
    expect(await nextState(page)).toMatchObject(rootState);
    await expect(exactNavigationNode(page, 'scheduler', 'instance')).toBeVisible();

    const childState = {
        level: 'module',
        focusStack: [identities.root, identities.child],
        selectedId: identities.child,
        analysisContext: {
            rootInstanceId: identities.root,
            ownerInstanceId: identities.child,
            occurrencePath: [identities.root, identities.child],
            subject: { kind: 'instance', id: identities.child }
        }
    };
    await subscribeToState(page, childState);
    await exactNavigationNode(page, 'scheduler', 'instance').dblclick();
    expect(await nextState(page)).toMatchObject(childState);

    const methods = exactNavigationNode(page, 'Methods', 'member-group');
    await expect(methods).toHaveAttribute('aria-expanded', 'false');
    await methods.click();
    await expect(methods).toHaveAttribute('aria-expanded', 'true');
    const methodState = {
        level: 'behavior',
        focusStack: [identities.root, identities.child],
        selectedId: identities.method,
        analysisContext: {
            rootInstanceId: identities.root,
            ownerInstanceId: identities.child,
            occurrencePath: [identities.root, identities.child],
            subject: { kind: 'method', id: identities.method },
            level: 'behavior',
            mode: 'structure'
        }
    };
    await subscribeToState(page, methodState);
    await exactNavigationNode(page, 'currentWork', 'method').dblclick();
    expect(await nextState(page)).toMatchObject(methodState);

    const childBackState = {
        ...childState,
        collapsedGroups: { [identities.child]: { methods: false } }
    };
    await subscribeToState(page, childBackState);
    await page.getByRole('button', { name: 'Back', exact: true }).click();
    expect(await nextState(page)).toMatchObject(childBackState);

    await subscribeToState(page, rootState);
    await page.getByRole('button', { name: 'Back', exact: true }).click();
    expect(await nextState(page)).toMatchObject(rootState);

    await subscribeToState(page, childBackState);
    await page.getByRole('button', { name: 'Forward', exact: true }).click();
    expect(await nextState(page)).toMatchObject(childBackState);

    await subscribeToState(page, methodState);
    await page.getByRole('button', { name: 'Forward', exact: true }).click();
    expect(await nextState(page)).toMatchObject(methodState);

    const staleRecovery = {
        level: 'module',
        focusStack: [identities.root, identities.child],
        selectedId: identities.child,
        navigationRecovery: {
            status: 'stale',
            missingIdentity: identities.method,
            reason: 'subject-missing-owner-recovered'
        }
    };
    await page.evaluate((methodId) => {
        window.__model.nodes = window.__model.nodes.filter((node) => node.id !== methodId);
    }, identities.method);
    await subscribeToState(page, { navigationRecovery: { status: 'stale' } });
    await page.locator('#refresh').click();
    expect(await nextState(page)).toMatchObject(staleRecovery);
    await expect(page.locator('#reveal-notice')).toBeVisible();
    await expect(page.locator('#reveal-notice')).toContainText('Recovered its owning instance');

    expect(errors).toEqual([]);
});

test('Gate B drills Work channel through endpoint implementation and semantic Back history', async ({ page }) => {
    const errors = browserErrors(page);
    await page.goto('/');
    const ids = await page.evaluate(() => {
        const root = window.__model.nodes.find((node) =>
            node.architectureInstance && node.details?.root && node.name === 'mkFlowTop'
        );
        const owner = window.__model.nodes.find((node) =>
            node.architectureInstance && node.parentId === root.id && node.name === 'scheduler'
        );
        const channel = window.__model.protocolChannels.find((item) =>
            item.ownerInstanceId === owner.id && item.name === 'Work'
        );
        const endpoint = window.__model.endpoints.find((item) =>
            item.ownerInstanceId === owner.id && item.name === 'currentWork'
        );
        const implementation = window.__model.stateBehaviors.find((item) =>
            item.ownerInstanceId === owner.id && item.definitionId === endpoint.implementationMethodId
        );
        const returned = window.__model.statements.find((item) =>
            item.enclosingCallableId === implementation.definitionId && item.kind === 'return'
        );
        const returnExpression = window.__model.expressions.find((item) => item.id === returned.expressionId);
        const sourceReference = window.__model.sourceReferences.find((item) =>
            item.id === returnExpression.id
        );
        const directFunction = window.__model.functionDefinitions.find((item) => item.name === 'callChoose');
        return { root: root.id, owner: owner.id, channel: channel.id,
            endpoint: endpoint.id, implementation: implementation.id,
            returnExpression: returnExpression.id, returnKind: returnExpression.kind,
            sourceRevision: returnExpression.sourceRevision, sourceRange: returnExpression.sourceRange,
            sourceReference,
            directFunction: directFunction.id, directFunctionRevision: directFunction.sourceRevision };
    });

    await subscribeToState(page, { selectedId: ids.root, level: 'module' });
    await exactNavigationNode(page, 'mkFlowTop', 'instance').dblclick();
    await nextState(page);
    await subscribeToState(page, { selectedId: ids.owner, level: 'module' });
    await exactNavigationNode(page, 'scheduler', 'instance').dblclick();
    await nextState(page);

    const channelState = {
        level: 'module', selectedId: ids.channel,
        analysisContext: {
            ownerInstanceId: ids.owner, presentationId: ids.channel,
            subject: { kind: 'protocol-channel', id: ids.channel }
        }
    };
    const ownerState = {
        level: 'module', selectedId: ids.owner,
        analysisContext: {
            ownerInstanceId: ids.owner, presentationId: ids.owner,
            subject: { kind: 'instance', id: ids.owner }
        }
    };
    await subscribeToState(page, channelState);
    await exactNavigationNode(page, 'Work', 'protocol-channel').dblclick();
    expect(await nextState(page)).toMatchObject(channelState);
    await expect(page.locator('#inspector')).toContainText('Owner');
    await expect(page.locator('#inspector')).toContainText('scheduler');
    await expect(page.locator('#inspector')).toContainText('Members');
    await expect(page.locator('#inspector')).toContainText('payload');
    await expect(page.locator('#inspector')).toContainText('ArrayWork#(arrayDim)');
    await expect(page.locator('#inspector')).toContainText('Provenance');
    await expect(page.locator('#inspector')).toContainText('Source-derived interface declarations');
    await expect(page.locator('#inspector')).toContainText('Grouping confidence');
    await expect(page.locator('#inspector')).toContainText('Heuristic');
    await expect(page.locator('#inspector')).toContainText('Inference basis');
    await expect(page.locator('#inspector')).toContainText('Method name and type convention');
    await expect(page.locator('#inspector')).toContainText('Source evidence');
    await expect(page.locator('#inspector')).toContainText('method ArrayWork#(arrayDim) currentWork');
    await expect(page.locator('#inspector')).not.toContainText('exact-method-contract');
    await expect(page.locator('#inspector')).not.toContainText('endpointIds');
    await expect(page.getByRole('button', { name: 'Open currentWork source', exact: true })).toBeVisible();
    expect(await page.locator('.arch-node.kind-endpoint, .arch-node.kind-instance').evaluateAll((nodes) =>
        nodes.map((node) => ({
            id: node.dataset.nodeId,
            dimmed: node.classList.contains('dimmed'),
            opacity: getComputedStyle(node).opacity
        }))
    )).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: ids.owner, dimmed: false, opacity: '1' }),
        expect.objectContaining({ id: ids.endpoint, dimmed: false, opacity: '1' })
    ]));
    await page.screenshot({ path: '.build/system-code/gate-b-work-channel.png', fullPage: true });

    const endpointState = {
        selectedId: ids.endpoint,
        analysisContext: {
            ownerInstanceId: ids.owner, presentationId: ids.endpoint,
            subject: { kind: 'endpoint', id: ids.endpoint }
        }
    };
    await subscribeToState(page, endpointState);
    await page.getByRole('button', { name: 'Inspect currentWork endpoint', exact: true }).click();
    expect(await nextState(page)).toMatchObject(endpointState);
    await expect(page.locator('#inspector')).toContainText('Declaration');
    await expect(page.locator('#inspector')).toContainText('Implementation');
    await expect(page.locator('#inspector')).toContainText('Incoming uses');
    await expect(page.locator('#inspector')).toContainText('Outgoing uses');
    await expect(page.locator('#inspector')).toContainText('Source evidence');
    await expect(page.locator('#inspector')).not.toContainText('Unresolved implementation');

    const implementationState = {
        level: 'behavior', selectedId: ids.implementation,
        analysisContext: {
            ownerInstanceId: ids.owner, presentationId: ids.implementation,
            subject: { kind: 'method', id: ids.implementation }
        }
    };
    await subscribeToState(page, implementationState);
    await page.getByRole('button', { name: 'Inspect currentWork implementation', exact: true }).click();
    expect(await nextState(page)).toMatchObject(implementationState);
    await expect(page.locator('#inspector')).toContainText('method ArrayWork#(arrayDim) currentWork if (active);');
    await expect(page.locator('#inspector')).toContainText('Callable predicate');
    await expect(page.locator('#inspector')).not.toContainText('Always eligible');

    const codeState = {
        level: 'behavior', selectedId: ids.implementation,
        analysisContext: {
            ownerInstanceId: ids.owner, presentationId: ids.implementation,
            subject: { kind: ids.returnKind, id: ids.returnExpression },
            sourceRevision: ids.sourceRevision
        }
    };
    await subscribeToState(page, codeState);
    await page.getByRole('button', { name: 'Inspect return expression', exact: true }).click();
    expect(await nextState(page)).toMatchObject(codeState);
    await expect(page.locator('#code-detail')).toBeVisible();
    await expect(page.locator('#code-detail')).toContainText('makeArrayWork');
    await expect(page.locator('#architecture-canvas')).toBeHidden();
    await subscribeToHostMessage(page, 'openSource');
    await page.getByRole('button', { name: 'Open selected source', exact: true }).click();
    expect(await nextHostMessage(page)).toMatchObject({
        type: 'openSource', nodeId: null, location: ids.sourceRange
    });
    expect(ids.sourceReference).toMatchObject({
        id: ids.returnExpression,
        kind: 'expression',
        sourceRange: ids.sourceRange
    });
    const echo = await page.evaluate((sourceReference) => {
        const before = structuredClone(window.__savedState);
        window.dispatchEvent(new MessageEvent('message', {
            data: {
                type: 'revealSource', revision: 0,
                sourceReference: { status: 'exact', references: [sourceReference] }
            }
        }));
        return { before, after: structuredClone(window.__savedState) };
    }, ids.sourceReference);
    expect(echo.after).toEqual(echo.before);

    await subscribeToState(page, channelState);
    await page.getByRole('button', { name: 'Back', exact: true }).click();
    expect(await nextState(page)).toMatchObject(channelState);
    await subscribeToState(page, ownerState);
    await page.getByRole('button', { name: 'Back', exact: true }).click();
    expect(await nextState(page)).toMatchObject(ownerState);
    await subscribeToState(page, channelState);
    await page.getByRole('button', { name: 'Forward', exact: true }).click();
    expect(await nextState(page)).toMatchObject(channelState);
    await subscribeToState(page, codeState);
    await page.getByRole('button', { name: 'Forward', exact: true }).click();
    expect(await nextState(page)).toMatchObject(codeState);
    await page.screenshot({ path: '.build/system-code/gate-c-current-work-code.png', fullPage: true });

    const directFunctionState = {
        level: 'behavior', selectedId: null,
        analysisContext: {
            rootInstanceId: null, ownerInstanceId: null, occurrencePath: [],
            subject: { kind: 'function-definition', id: ids.directFunction },
            presentationId: null, sourceRevision: ids.directFunctionRevision,
            entryCallSiteId: null, bindingEnvironmentId: null
        }
    };
    await subscribeToState(page, directFunctionState);
    await page.evaluate((id) => window.dispatchEvent(new MessageEvent('message', {
        data: {
            type: 'revealSource', revision: 0,
            sourceReference: { references: [{ id, name: 'callChoose' }] }
        }
    })), ids.directFunction);
    expect(await nextState(page)).toMatchObject(directFunctionState);
    await expect(page.locator('#code-detail')).toContainText('callChoose');
    await subscribeToState(page, codeState);
    await page.getByRole('button', { name: 'Back', exact: true }).click();
    expect(await nextState(page)).toMatchObject(codeState);
    await page.screenshot({ path: '.build/system-code/gate-c-cross-context-function.png', fullPage: true });

    await subscribeToState(page, channelState);
    await page.getByRole('button', { name: 'Back', exact: true }).click();
    expect(await nextState(page)).toMatchObject(channelState);
    await subscribeToState(page, codeState);
    await page.getByRole('button', { name: 'Forward', exact: true }).click();
    expect(await nextState(page)).toMatchObject(codeState);
    await subscribeToState(page, channelState);
    await page.getByRole('button', { name: 'Back', exact: true }).click();
    expect(await nextState(page)).toMatchObject(channelState);
    await expect(page.locator('#inspector')).toContainText('Work');
    await expect(page.locator('#inspector')).toContainText('currentWork');

    await subscribeToState(page, ownerState);
    await page.getByRole('button', { name: 'Back', exact: true }).click();
    expect(await nextState(page)).toMatchObject(ownerState);
    await expect(page.locator('#focus-summary')).toContainText('scheduler');
    expect(errors).toEqual([]);
});

test('Gate B source reveal requires an explicit occurrence choice for shared definitions', async ({ page }) => {
    const errors = browserErrors(page);
    await page.goto('/');
    const reveal = await page.evaluate(() => {
        const mirrors = window.__model.stateBehaviors.filter((behavior) =>
            behavior.name === 'currentWork'
        );
        const selectedOwner = window.__model.nodes.find((node) =>
            node.architectureInstance && node.details?.path.endsWith('.scheduler')
        );
        const selectedEndpoint = window.__model.endpoints.find((endpoint) =>
            endpoint.ownerInstanceId === selectedOwner.id && endpoint.name === 'currentWork'
        );
        const reference = window.__model.sourceReferences.find((item) =>
            item.kind === 'implementation-method' && item.name === 'currentWork'
        );
        return {
            sourceReference: { status: 'exact', references: [reference] },
            selectedId: selectedEndpoint.id,
            selectedOwnerId: selectedEndpoint.ownerInstanceId
        };
    });
    await page.evaluate((sourceReference) => window.dispatchEvent(new MessageEvent('message', {
        data: { type: 'revealSource', sourceReference, revision: 0 }
    })), reveal.sourceReference);
    await expect(page.locator('#reveal-notice')).toContainText('Choose an occurrence');
    await expect(page.getByRole('button', { name: 'mkFlowTop.schedulerMirror · Work', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'mkFlowTop.scheduler · currentWork', exact: true })).toBeVisible();
    expect(await page.evaluate(() => window.__savedState.selectedId)).toBeNull();

    const selected = {
        level: 'module',
        selectedId: reveal.selectedId,
        analysisContext: {
            ownerInstanceId: reveal.selectedOwnerId,
            presentationId: reveal.selectedId,
            subject: { kind: 'endpoint', id: reveal.selectedId }
        }
    };
    await subscribeToState(page, selected);
    await page.getByRole('button', { name: 'mkFlowTop.scheduler · currentWork', exact: true }).click();
    expect(await nextState(page)).toMatchObject(selected);
    expect(errors).toEqual([]);
});

test('Gate C enters pure functions directly with callsite mappings and distinct shadow contexts', async ({ page }) => {
    const errors = browserErrors(page);
    await page.goto('/');
    const code = await page.evaluate(() => {
        const direct = window.__model.functionDefinitions.find((item) => item.name === 'callChoose');
        const callee = window.__model.functionDefinitions.find((item) => item.name === 'chooseValue');
        const callSite = window.__model.callSites.find((item) => item.calleeDefinitionId === callee.id);
        const callExpression = window.__model.expressions.find((item) => item.id === callSite.expressionId);
        const returns = callee.returnExpressionIds.map((id) => window.__model.expressions.find((item) => item.id === id));
        const markup = window.__model.functionDefinitions.find((item) => item.name === 'sourceMarkup');
        const markupReturn = window.__model.expressions.find((item) => item.id === markup.returnExpressionIds[0]);
        const query = window.BsvArchitectureSemanticQuery.createSemanticQueries(window.__model);
        const directDocument = window.__model.sourceDocuments.find((item) =>
            item.id === direct.sourceDocumentId && item.revision === direct.sourceRevision
        );
        return {
            direct, directSource: directDocument.content.slice(direct.range.start, direct.range.end),
            callee, callSite, callExpression, returns, markup, markupReturn,
            returnBindings: returns.map((item) => query.getExpressionDependencies(item.id).bindingEnvironment?.id || null),
            fakeRoots: window.__model.instances.filter((item) =>
                [direct.id, callee.id].includes(item.targetDefinitionId)
            ).map((item) => item.id),
            fakeEndpoints: window.__model.endpoints.filter((item) =>
                [direct.id, callee.id].includes(item.implementationMethodId)
            ).map((item) => item.id)
        };
    });
    expect(code.fakeRoots).toEqual([]);
    expect(code.fakeEndpoints).toEqual([]);
    expect(code.returnBindings[0]).not.toBe(code.returnBindings[1]);

    const directState = {
        level: 'behavior', selectedId: null,
        analysisContext: {
            rootInstanceId: null, ownerInstanceId: null, occurrencePath: [],
            presentationId: null,
            subject: { kind: 'function-definition', id: code.direct.id },
            sourceRevision: code.direct.sourceRevision,
            entryCallSiteId: null,
            bindingEnvironmentId: null
        }
    };
    await subscribeToState(page, directState);
    await page.evaluate((id) => window.dispatchEvent(new MessageEvent('message', {
        data: { type: 'revealSource', sourceReference: { references: [{ id, name: 'callChoose' }] }, revision: 0 }
    })), code.direct.id);
    expect(await nextState(page)).toMatchObject(directState);
    await expect(page.locator('#code-detail')).toContainText('callChoose');
    await expect(page.locator('#code-detail')).toContainText(code.direct.returnType);
    await expect(page.locator('#code-detail')).toContainText(code.directSource);

    const callState = {
        analysisContext: {
            subject: { kind: code.callExpression.kind, id: code.callExpression.id },
            sourceRevision: code.callExpression.sourceRevision,
            entryCallSiteId: code.callSite.id,
            bindingEnvironmentId: code.callSite.bindingEnvironmentId
        }
    };
    await subscribeToState(page, callState);
    await page.locator(`[data-code-id="${code.callExpression.id}"]`).click();
    expect(await nextState(page)).toMatchObject(callState);
    await expect(page.locator('#code-detail')).toContainText('Actual / formal map');
    await expect(page.locator('#code-detail')).toContainText('inputValue');
    await expect(page.locator('#code-detail')).toContainText('value');

    const calleeState = {
        selectedId: null,
        analysisContext: {
            subject: { kind: 'function-definition', id: code.callee.id },
            sourceRevision: code.callee.sourceRevision,
            entryCallSiteId: code.callSite.id,
            bindingEnvironmentId: code.callSite.bindingEnvironmentId
        }
    };
    await subscribeToState(page, calleeState);
    await page.getByRole('button', { name: 'Open chooseValue definition', exact: true }).click();
    expect(await nextState(page)).toMatchObject(calleeState);

    for (let index = 0; index < code.returns.length; index += 1) {
        const returned = code.returns[index];
        const expected = {
            analysisContext: {
                subject: { kind: returned.kind, id: returned.id },
                sourceRevision: returned.sourceRevision,
                bindingEnvironmentId: code.returnBindings[index]
            }
        };
        await subscribeToState(page, expected);
        await page.locator(`[data-code-id="${returned.id}"]`).click();
        expect(await nextState(page)).toMatchObject(expected);
    }
    const markupState = {
        analysisContext: {
            subject: { kind: 'function-definition', id: code.markup.id },
            sourceRevision: code.markup.sourceRevision
        }
    };
    await subscribeToState(page, markupState);
    await page.evaluate((id) => window.dispatchEvent(new MessageEvent('message', {
        data: { type: 'revealSource', sourceReference: { references: [{ id, name: 'sourceMarkup' }] }, revision: 0 }
    })), code.markup.id);
    expect(await nextState(page)).toMatchObject(markupState);
    const markupExpressionState = {
        analysisContext: {
            subject: { kind: code.markupReturn.kind, id: code.markupReturn.id },
            sourceRevision: code.markupReturn.sourceRevision
        }
    };
    await subscribeToState(page, markupExpressionState);
    await page.locator(`[data-code-id="${code.markupReturn.id}"]`).click();
    expect(await nextState(page)).toMatchObject(markupExpressionState);
    await expect(page.locator('#code-detail')).toContainText('<img src=x onerror=globalThis.__sourceInjected=True></script>');
    await expect(page.locator('#code-detail img')).toHaveCount(0);
    expect(await page.evaluate(() => globalThis.__sourceInjected)).toBeUndefined();
    await page.screenshot({ path: '.build/system-code/gate-c-pure-function.png', fullPage: true });
    expect(errors).toEqual([]);
});

test('Gate B keeps ungrouped endpoints direct and labels unresolved implementation', async ({ page }) => {
    const errors = browserErrors(page);
    await page.goto('/');
    const ids = await page.evaluate(() => {
        const root = window.__model.nodes.find((node) =>
            node.architectureInstance && node.details?.root && node.name === 'mkFlowTop'
        );
        const owner = window.__model.nodes.find((node) =>
            node.architectureInstance && node.parentId === root.id && node.name === 'loose'
        );
        const endpoint = window.__model.endpoints.find((item) =>
            item.ownerInstanceId === owner.id && item.name === 'orphan'
        );
        return { root: root.id, owner: owner.id, endpoint: endpoint.id };
    });
    await subscribeToState(page, { selectedId: ids.root, level: 'module' });
    await exactNavigationNode(page, 'mkFlowTop', 'instance').dblclick();
    await nextState(page);
    await subscribeToState(page, { selectedId: ids.owner, level: 'module' });
    await exactNavigationNode(page, 'loose', 'instance').dblclick();
    await nextState(page);
    await expect(page.locator('.kind-member-group').filter({ hasText: 'Ungrouped Endpoints' })).toBeVisible();

    const endpointState = {
        selectedId: ids.endpoint,
        analysisContext: {
            ownerInstanceId: ids.owner,
            presentationId: ids.endpoint,
            subject: { kind: 'endpoint', id: ids.endpoint }
        }
    };
    await subscribeToState(page, endpointState);
    await exactNavigationNode(page, 'orphan', 'endpoint').dblclick();
    expect(await nextState(page)).toMatchObject(endpointState);
    await expect(page.locator('#inspector')).toContainText('Unresolved implementation');
    await expect(page.locator('#inspector')).toContainText('method Bit#(8) orphan');
    await expect(page.locator('#inspector')).toContainText('Owner');
    await expect(page.locator('#inspector')).toContainText('loose');
    expect(errors).toEqual([]);
});
