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
    await expect(page.locator('.kind-instance').filter({ hasText: 'scheduler' }))
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
    await expect(page.locator('.kind-instance').filter({ hasText: 'scheduler' })).toBeVisible();
    await expect(page.locator('.kind-instance').filter({ hasText: 'worker' })).toBeVisible();
    await expect(page.locator('.edge-label')).toContainText('ArrayWork#(arrayDim)');

    // When
    await page.locator('.kind-instance').filter({ hasText: 'scheduler' }).click();
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
    await expect(page.locator('#inspector')).toContainText('Guard');
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
