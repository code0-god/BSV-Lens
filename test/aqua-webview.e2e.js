'use strict';

const { test, expect } = require('@playwright/test');

function browserErrors(page) {
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
        if (message.type() === 'error') errors.push(message.text());
    });
    return errors;
}

test('AQuA system graph supports analysis modes focus navigation and exports', async ({ page }) => {
    const errors = browserErrors(page);
    await page.goto('/');
    await expect(page.locator('#architecture-title')).toContainText('AQuA');
    await expect(page.locator('.arch-node').first()).toBeVisible();

    expect(await page.evaluate(() => ({
        files: window.__model.stats.files,
        nodes: window.__model.stats.nodes,
        edges: window.__model.stats.edges,
        errors: window.__model.diagnostics.filter((item) => item.severity === 'error').length
    }))).toEqual({
        files: 14,
        nodes: expect.any(Number),
        edges: expect.any(Number),
        errors: 0
    });
    expect(await page.evaluate(() => window.__model.stats.nodes)).toBeGreaterThanOrEqual(300);
    expect(await page.evaluate(() => window.__model.stats.edges)).toBeGreaterThanOrEqual(900);
    expect(await page.locator('.arch-node').count()).toBeGreaterThan(20);

    await page.locator('#search').fill('MKaQuAlOoPmAtMuL');
    await page.locator('#search').press('Enter');
    await expect(page.locator('#inspector')).toContainText('mkAquaLoopMatmul');
    await page.getByRole('button', { name: 'Set as focus' }).click();
    await expect(page.locator('#focus-summary')).toContainText('mkAquaLoopMatmul');
    await page.locator('#search').press('Escape');

    await page.locator('[data-level="module"]').click();
    await expect(page.locator('.kind-module')).toContainText('mkAquaLoopMatmul');
    const rules = page.locator('.kind-member-group').filter({ hasText: 'Rules' });
    await expect(rules).toHaveAttribute('aria-expanded', 'false');
    await rules.click();
    await expect(rules).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('.kind-rule')).toHaveCount(5);

    await page.locator('[data-level="behavior"]').click();
    await page.locator('[data-analysis-mode="data-flow"]').click();
    await expect(page.locator('[data-analysis-mode="data-flow"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.edge-group').first()).toBeVisible();
    expect(await page.evaluate(() => window.__savedState.selectedId)).toBeNull();
    await expect(page.locator('.selection-dimmed')).toHaveCount(0);
    const componentDataFlowNodes = await page.locator('.arch-node').count();
    await page.locator('[data-hop="1"]').click();
    expect(await page.locator('.arch-node').count()).toBeLessThanOrEqual(componentDataFlowNodes);
    await page.locator('[data-hop="all"]').click();

    await page.locator('[data-analysis-mode="scheduling"]').click();
    await expect(page.locator('#schedule-legend')).toBeVisible();
    await expect(page.locator('#schedule-origin')).toContainText('HEURISTIC');
    expect(await page.locator('.edge-group').count()).toBeGreaterThan(0);
    expect(await page.locator('.arch-node').evaluateAll((nodes) => {
        const canvas = document.getElementById('architecture-canvas').getBoundingClientRect();
        return nodes.filter((node) => {
            const rect = node.getBoundingClientRect();
            const width = Math.max(0, Math.min(rect.right, canvas.right) - Math.max(rect.left, canvas.left));
            const height = Math.max(0, Math.min(rect.bottom, canvas.bottom) - Math.max(rect.top, canvas.top));
            return width * height >= rect.width * rect.height * 0.5;
        }).length;
    })).toBeGreaterThan(0);

    await page.locator('#search').fill('BEGINARRAYWORK');
    await page.locator('#search').press('Enter');
    await expect(page.locator('#inspector')).toContainText('beginArrayWork');
    await page.getByRole('button', { name: 'Set as focus' }).click();
    await page.locator('#search').press('Escape');
    await page.locator('[data-hop="1"]').click();
    const focusedScheduling = await page.evaluate(() => {
        const selectedId = window.__savedState.selectedId;
        const edges = [...document.querySelectorAll('.edge[data-source][data-target]')];
        return {
            count: edges.length,
            unrelated: edges.filter((edge) =>
                edge.dataset.source !== selectedId && edge.dataset.target !== selectedId
            ).length
        };
    });
    expect(focusedScheduling.count).toBeGreaterThan(0);
    expect(focusedScheduling.unrelated).toBe(0);
    expect(await page.locator('.edge-group').count()).toBeLessThan(60);
    await page.locator('[data-analysis-mode="data-flow"]').click();
    const focusedDataFlowNodes = await page.locator('.arch-node').count();
    const focusedDataFlowEdges = await page.locator('.edge-group').count();
    expect(focusedDataFlowNodes).toBeGreaterThan(0);
    expect(focusedDataFlowNodes).toBeLessThan(12);
    expect(focusedDataFlowEdges).toBeGreaterThan(0);
    expect(focusedDataFlowEdges).toBeLessThan(12);

    const refreshed = page.waitForFunction(() =>
        window.__hostMessages.some((message) => message.type === 'refresh')
    );
    await page.locator('#refresh').click();
    await refreshed;

    const svgExported = page.waitForFunction(() => typeof window.__lastSvg === 'string');
    await page.locator('#export-svg').click();
    await svgExported;
    expect(await page.evaluate(() => ({
        svg: window.__lastSvg.includes('<svg'),
        nodes: (window.__lastSvg.match(/class="arch-node/g) || []).length,
        scripts: /<script\b/i.test(window.__lastSvg)
    }))).toEqual({ svg: true, nodes: expect.any(Number), scripts: false });
    expect(await page.evaluate(() =>
        (window.__lastSvg.match(/class="arch-node/g) || []).length
    )).toBeGreaterThan(0);

    const jsonRequested = page.waitForFunction(() => window.__lastJsonExport === true);
    await page.locator('#export-json').click();
    await jsonRequested;

    const sourceRequested = page.waitForFunction(() =>
        window.__hostMessages.some((message) => message.type === 'openSource')
    );
    await page.getByRole('button', { name: 'Open source' }).click();
    await sourceRequested;
    expect(await page.evaluate(() =>
        window.__hostMessages.findLast((message) => message.type === 'openSource')?.nodeId
    )).toContain('beginArrayWork');
    expect(errors).toEqual([]);
});

test('AQuA current-file scope and state filters remain usable', async ({ page }) => {
    const errors = browserErrors(page);
    await page.goto('/?scope=current-file&level=behavior');
    await expect(page.locator('.kind-module')).toContainText('mkAquaLoopMatmul');
    expect(await page.locator('.arch-node').count()).toBeGreaterThan(20);
    expect(await page.evaluate(() => {
        const activeFile = window.__model.activeFile;
        const byId = new Map(window.__model.nodes.map((node) => [node.id, node]));
        return [...document.querySelectorAll('.arch-node')]
            .map((element) => byId.get(element.dataset.nodeId))
            .filter((node) => node?.relativePath && node.relativePath !== activeFile)
            .map((node) => node.relativePath);
    })).toEqual([]);

    await page.locator('#show-primitives').check();
    expect(await page.locator('.kind-register').count()).toBeGreaterThan(0);
    await page.locator('#show-rules').uncheck();
    await expect(page.locator('.kind-rule')).toHaveCount(0);
    await page.locator('#show-rules').check();
    expect(await page.locator('.kind-rule').count()).toBeGreaterThan(0);

    expect(await page.evaluate(() => ({
        viewport: window.innerWidth,
        document: document.documentElement.scrollWidth
    }))).toEqual({ viewport: 2048, document: 2048 });
    expect(errors).toEqual([]);
});

test('AQuA CJK labels and populated inspector remain contained', async ({ page }) => {
    const errors = browserErrors(page);
    await page.goto('/?cjk=true&level=module');
    const moduleNode = page.locator('.kind-module').first();
    await expect(moduleNode).toContainText('행렬 가속기 제어');
    await moduleNode.click();
    await expect(page.locator('#inspector')).toContainText('행렬 가속기 제어');
    await expect(page.locator('#inspector')).not.toContainText('[]');
    expect(await moduleNode.evaluate((element) => {
        const body = element.querySelector('.node-body').getBoundingClientRect();
        const label = element.querySelector('.node-title').getBoundingClientRect();
        return {
            contained: label.left >= body.left && label.right <= body.right - 8,
            replacementCharacter: element.textContent.includes('\uFFFD')
        };
    })).toEqual({ contained: true, replacementCharacter: false });
    expect(errors).toEqual([]);
});
