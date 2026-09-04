'use strict';

const { test, expect } = require('@playwright/test');
const fs = require('node:fs');

fs.mkdirSync('.build/visual-qa', { recursive: true });

const MATMUL_SCHEDULER_METHODS = [
    'startReady',
    'start',
    'publishReady',
    'publishStripe',
    'workValid',
    'currentWork',
    'completeWork',
    'lookaheadValid',
    'lookaheadStripe',
    'completionValid',
    'completion',
    'consumeCompletion'
];

function browserErrors(page) {
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
        if (message.type() === 'error') errors.push(message.text());
    });
    return errors;
}

async function focusMatmulScheduler(page) {
    await page.goto('/');
    await page.locator('#search').fill('mkMatmulScheduler');
    await page.locator('#search').press('Enter');
    await expect(page.locator('#inspector')).toContainText('mkMatmulScheduler');
    await page.getByRole('button', { name: 'Set as focus' }).click();
    await page.locator('#search').press('Escape');
    await page.locator('[data-level="module"]').click();
    await expect(page.locator('.kind-module')).toContainText('mkMatmulScheduler');
}

async function expectAllGraphNodesInsideCanvas(page) {
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

test('AQuA MatmulScheduler renders exact methods with semantic source navigation', async ({ page }) => {
    const errors = browserErrors(page);
    await focusMatmulScheduler(page);
    const methods = page.locator('.kind-member-group').filter({ hasText: 'Methods' });
    await methods.click();
    await expect(methods).toHaveAttribute('aria-expanded', 'true');
    await page.locator('#fit').click();
    await expectAllGraphNodesInsideCanvas(page);

    expect((await page.locator('.kind-method .node-title').allTextContents()).sort())
        .toEqual([...MATMUL_SCHEDULER_METHODS].sort());
    await expect(page.locator('.kind-method').filter({ hasText: 'isValid' })).toHaveCount(0);

    await page.locator('.kind-method').filter({ hasText: 'workValid' }).click();
    await expect(page.locator('#inspector')).toContainText('workValid');
    await expect(page.locator('#inspector')).toContainText('method Bool workValid');
    await expect(page.locator('#inspector')).toContainText('Return Type');
    await expect(page.locator('#inspector')).toContainText('Category');
    await page.screenshot({
        path: '.build/visual-qa/aqua-matmul-methods.png',
        fullPage: true
    });
    const sourceRequested = page.waitForFunction(() =>
        window.__hostMessages.some((message) =>
            message.type === 'openSource' && message.nodeId?.includes('workValid')
        )
    );
    await page.getByRole('button', { name: 'Open source' }).click();
    await sourceRequested;
    expect(errors).toEqual([]);
});

test('AQuA MatmulScheduler state visibility follows OFF ON OFF filter state', async ({ page }) => {
    const errors = browserErrors(page);
    await focusMatmulScheduler(page);
    const stateGroup = page.locator('.kind-member-group').filter({ hasText: 'State' });
    const stateNodes = page.locator(
        '.kind-register, .kind-fifo, .kind-memory, .kind-wire, .kind-vector'
    );

    await expect(stateGroup).toContainText('0/7 visible');
    await stateGroup.click();
    await expect(stateGroup).toHaveAttribute('aria-expanded', 'true');
    await expect(stateNodes).toHaveCount(0);

    await page.locator('#show-primitives').check();
    await expect(stateGroup).toContainText('7/7 visible');
    await expect(stateNodes).toHaveCount(7);
    await page.locator('#fit').click();
    await expectAllGraphNodesInsideCanvas(page);
    await page.screenshot({
        path: '.build/visual-qa/aqua-matmul-state-on.png',
        fullPage: true
    });
    await page.locator('.kind-register').filter({ hasText: 'activeDescriptor' }).click();
    expect(await page.evaluate(() => window.__savedState.selectedId)).toContain('activeDescriptor');

    await page.locator('#show-primitives').uncheck();
    await expect(stateGroup).toContainText('0/7 visible');
    await expect(stateNodes).toHaveCount(0);
    expect(await page.evaluate(() => window.__savedState.selectedId)).toBeNull();

    await page.locator('#show-primitives').check();
    await expect(stateGroup).toContainText('7/7 visible');
    await expect(stateNodes).toHaveCount(7);
    expect(await page.evaluate(() => window.__savedState.selectedId)).toBeNull();

    await page.locator('#show-primitives').uncheck();
    await expect(stateGroup).toContainText('0/7 visible');
    await expect(stateNodes).toHaveCount(0);
    expect(await page.evaluate(() => window.__savedState.selectedId)).toBeNull();
    await page.screenshot({
        path: '.build/visual-qa/aqua-matmul-state-off.png',
        fullPage: true
    });
    expect(errors).toEqual([]);
});
