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

async function focusInstanceByTarget(page, targetName) {
    const node = page.locator('.kind-instance').filter({ hasText: targetName }).first();
    await expect(node).toBeVisible();
    await node.click();
    await page.getByRole('button', { name: 'Set as focus' }).click();
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

async function expectEdgeLabelsSeparated(page) {
    expect(await page.locator('.edge-label-bg').evaluateAll((labels) => {
        const boxes = labels.map((label) => label.getBoundingClientRect());
        const overlaps = [];
        for (let left = 0; left < boxes.length; left += 1) {
            for (let right = left + 1; right < boxes.length; right += 1) {
                const width = Math.min(boxes[left].right, boxes[right].right)
                    - Math.max(boxes[left].left, boxes[right].left);
                const height = Math.min(boxes[left].bottom, boxes[right].bottom)
                    - Math.max(boxes[left].top, boxes[right].top);
                if (width > 1 && height > 1) overlaps.push([left, right]);
            }
        }
        return overlaps;
    })).toEqual([]);
}

test('AQuA System and Module Structure expose source-derived memory instances', async ({ page }) => {
    const errors = browserErrors(page);

    // Given
    await page.goto('/');

    // Then
    await expect(page.locator('.kind-package')).toHaveCount(0);
    await page.locator('#fit').click();
    await expectNodesInsideCanvas(page);
    await page.screenshot({
        path: '.build/visual-qa-v040/aqua-system-architecture.png',
        fullPage: true
    });
    await focusInstanceByTarget(page, 'mkAquaMemorySubsystem');

    // When
    await page.locator('[data-level="module"]').click();

    // Then
    for (const name of ['load', 'staging', 'accumulators', 'store']) {
        await expect(page.locator('.kind-instance .node-title').filter({ hasText: name }))
            .toBeVisible();
    }
    await expect(page.locator('.kind-member-group').filter({ hasText: 'Child Instances' }))
        .toBeVisible();
    await expect(page.locator('.kind-member-group').filter({ hasText: 'Protocol Channels' }))
        .toBeVisible();
    await page.locator('#fit').click();
    await expectNodesInsideCanvas(page);
    await page.screenshot({
        path: '.build/visual-qa-v040/aqua-memory-structure.png',
        fullPage: true
    });
    expect(errors).toEqual([]);
});

test('AQuA Module Data Flow renders exact nested interface forwarding', async ({ page }) => {
    const errors = browserErrors(page);

    // Given
    await page.goto('/');
    await focusInstanceByTarget(page, 'mkAquaMemorySubsystem');
    await page.locator('[data-level="module"]').click();

    // When
    await page.locator('[data-analysis-mode="data-flow"]').click();

    // Then
    for (const [outer, inner] of [
        ['activationPort.requests', 'load.activationPort.requests'],
        ['activationPort.responses', 'staging.activationResponses'],
        ['outputPort', 'store.outputPort']
    ]) {
        const label = page.locator('.edge-label').filter({ hasText: outer });
        await expect(label).toBeVisible();
        await label.click();
        await expect(page.locator('#inspector')).toContainText(inner);
    }
    await page.locator('#fit').click();
    await expectNodesInsideCanvas(page);
    await expectEdgeLabelsSeparated(page);
    await page.screenshot({
        path: '.build/visual-qa-v040/aqua-memory-forwarding.png',
        fullPage: true
    });
    expect(errors).toEqual([]);
});

test('AQuA Behavior shows completeWork state effects protocol and evidence', async ({ page }) => {
    const errors = browserErrors(page);

    // Given
    await page.goto('/');
    await focusInstanceByTarget(page, 'mkMatmulScheduler');

    // When
    await page.locator('[data-level="behavior"]').click();
    await page.locator('[data-analysis-mode="data-flow"]').click();
    await page.locator('#fit').click();
    await expectNodesInsideCanvas(page);
    await page.locator('.kind-method').filter({ hasText: 'completeWork' }).click();

    // Then
    await expect(page.locator('#inspector')).toContainText('State reads');
    await expect(page.locator('#inspector')).toContainText('activeDescriptor');
    await expect(page.locator('#inspector')).toContainText('State writes');
    await expect(page.locator('#inspector')).toContainText('completions');
    await expect(page.locator('#inspector')).toContainText('Protocol membership');
    await expect(page.locator('#inspector')).toContainText('Work');
    await expect(page.locator('#inspector')).toContainText('Source evidence');
    const sourceRequested = page.waitForFunction(() =>
        window.__hostMessages.some((message) =>
            message.type === 'openSource' && message.nodeId?.includes('completeWork')
        )
    );
    await page.getByRole('button', { name: 'Open source' }).click();
    await sourceRequested;
    await page.getByRole('button', { name: 'Focus', exact: true }).click();
    await page.locator('[data-hop="1"]').click();
    await page.locator('#fit').click();
    await expectNodesInsideCanvas(page);
    await expectEdgeLabelsSeparated(page);
    await page.screenshot({
        path: '.build/visual-qa-v040/aqua-complete-work.png',
        fullPage: true
    });
    expect(errors).toEqual([]);
});
