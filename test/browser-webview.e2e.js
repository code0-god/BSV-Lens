'use strict';

const { test, expect } = require('@playwright/test');
const fs = require('node:fs');

fs.mkdirSync('.build/visual-qa', { recursive: true });

function collectBrowserErrors(page) {
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
        if (message.type() === 'error') errors.push(message.text());
    });
    return errors;
}

test('real browser drives webview controls inspector refresh and exports', async ({ page }) => {
    const errors = collectBrowserErrors(page);
    await page.goto('/');
    await expect(page.locator('.arch-node').first()).toBeVisible();

    await page.locator('#search').fill('MKACCELERATORCONTROLLER');
    await page.locator('#search').press('Enter');
    await expect(page.locator('#inspector')).toContainText('mkAcceleratorController');
    await page.locator('#search').press('Escape');

    await page.locator('#show-packages').check();
    await page.locator('[data-analysis-mode="data-flow"]').click();
    await expect(page.locator('[data-analysis-mode="data-flow"]')).toHaveAttribute('aria-pressed', 'true');
    await page.evaluate(() => new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve))
    ));
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
    expect(await page.locator('.edge.data[data-source][data-target]').first().evaluate((edge) => {
        const source = document.querySelector(`[data-node-id="${CSS.escape(edge.dataset.source)}"]`);
        const target = document.querySelector(`[data-node-id="${CSS.escape(edge.dataset.target)}"]`);
        const sourceX = Number(/translate\(([^ ]+)/.exec(source.getAttribute('transform'))[1]);
        const targetX = Number(/translate\(([^ ]+)/.exec(target.getAttribute('transform'))[1]);
        return sourceX < targetX;
    })).toBe(true);
    await page.screenshot({ path: '.build/visual-qa/webview-desktop-overview.png', fullPage: true });
    await page.locator('.arch-node').first().click();
    await expect(page.locator('#inspector .inspector-empty')).toHaveCount(0);

    const refreshed = page.waitForFunction(() =>
        window.__hostMessages.some((message) => message.type === 'refresh')
    );
    await page.locator('#refresh').click();
    await refreshed;

    const svgExported = page.waitForFunction(() => typeof window.__lastSvg === 'string');
    await page.locator('#export-svg').click();
    await svgExported;
    expect(await page.evaluate(() => window.__lastSvg.includes('<svg'))).toBe(true);

    const jsonExported = page.waitForFunction(() => window.__lastJsonExport === true);
    await page.locator('#export-json').click();
    await jsonExported;

    expect(errors).toEqual([]);
    await page.screenshot({ path: '.build/visual-qa/webview-desktop.png', fullPage: true });
});

test('narrow browser viewport remains usable without page overflow', async ({ page }) => {
    const errors = collectBrowserErrors(page);
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/?level=module');
    const rootId = await page.evaluate(() => window.__model.architectureRoots[0]);
    const moduleNode = page.locator(`.arch-node[data-node-id="${rootId}"]`);
    await expect(moduleNode).toBeVisible();
    await expect(page.locator('#viewport')).not.toHaveAttribute('transform', 'translate(40 40) scale(1)');
    await expect(page.locator('#inspector')).toBeHidden();
    await expect(page.locator('.canvas-help')).toBeVisible();
    expect(await page.locator('.canvas-help').evaluate((element) =>
        element.getBoundingClientRect().right <= window.innerWidth
    )).toBe(true);

    expect(await page.evaluate(() => ({
        viewport: window.innerWidth,
        document: document.documentElement.scrollWidth,
        canvas: document.getElementById('architecture-canvas').getBoundingClientRect().width
    }))).toMatchObject({ viewport: 375, document: 375 });
    expect(await moduleNode.evaluate((element) => {
        const node = element.getBoundingClientRect();
        const canvas = document.getElementById('architecture-canvas').getBoundingClientRect();
        const centerX = node.left + node.width / 2;
        const centerY = node.top + node.height / 2;
        return centerX >= canvas.left
            && centerX <= canvas.right
            && centerY >= canvas.top
            && centerY <= canvas.bottom;
    })).toBe(true);
    await moduleNode.click();
    await expect(page.locator('#inspector')).toBeVisible();
    expect(await page.locator('.canvas-help').evaluate((cue) => {
        const cueRect = cue.getBoundingClientRect();
        const canvas = document.getElementById('architecture-canvas').getBoundingClientRect();
        const overlapsNode = [...document.querySelectorAll('.arch-node')].some((node) => {
            const rect = node.getBoundingClientRect();
            const visible = {
                left: Math.max(rect.left, canvas.left),
                right: Math.min(rect.right, canvas.right),
                top: Math.max(rect.top, canvas.top),
                bottom: Math.min(rect.bottom, canvas.bottom)
            };
            return visible.left < visible.right
                && visible.top < visible.bottom
                && cueRect.left < visible.right
                && cueRect.right > visible.left
                && cueRect.top < visible.bottom
                && cueRect.bottom > visible.top;
        });
        return {
            belowCanvas: cueRect.top >= canvas.bottom - 1,
            overlapsNode
        };
    })).toEqual({ belowCanvas: true, overlapsNode: false });
    expect(errors).toEqual([]);
    await page.screenshot({ path: '.build/visual-qa/webview-narrow.png', fullPage: true });
});

test('trusted and restricted host models preserve source graph with capability banner', async ({ page }) => {
    const errors = collectBrowserErrors(page);
    await page.goto('/');
    await expect(page.locator('.arch-node').first()).toBeVisible();
    const trustedNodeCount = await page.locator('.arch-node').count();
    await expect(page.locator('#restricted-mode')).toBeHidden();

    await page.goto('/?trusted=false');
    await expect(page.locator('.arch-node').first()).toBeVisible();
    await expect(page.locator('#restricted-mode')).toBeVisible();
    await expect(page.locator('#restricted-mode')).toContainText('BSC execution');
    await expect(page.locator('#source-scope')).toBeEnabled();
    expect(await page.locator('.arch-node').count()).toBe(trustedNodeCount);
    expect(await page.evaluate(() => window.__model.security)).toMatchObject({
        workspaceTrusted: false,
        restrictedMode: true,
        sourceAnalysisAvailable: true,
        bscExecutionEnabled: false,
        externalScheduleReportsEnabled: false
    });
    expect(errors).toEqual([]);
});

test('showMethodPorts host setting hides method cards without changing model IR', async ({ page }) => {
    await page.goto('/?level=module&ports=false');
    await expect(page.locator('.arch-node').first()).toBeVisible();

    await expect(page.locator('.kind-member-group').filter({ hasText: 'Methods' })).toHaveCount(0);
    await expect(page.locator('.kind-method')).toHaveCount(0);
    expect(await page.evaluate(() => ({
        setting: window.__model.viewDefaults.showMethodPorts,
        modelMethods: window.__model.nodes.filter((node) => node.kind === 'method').length
    }))).toMatchObject({ setting: false });
    expect(await page.evaluate(() =>
        window.__model.nodes.filter((node) => node.kind === 'method').length
    )).toBeGreaterThan(0);
});

test('member expansion and responsive resize preserve selected module anchor', async ({ page }) => {
    await page.goto('/?level=module');
    const rootId = await page.evaluate(() => window.__model.architectureRoots[0]);
    const moduleNode = page.locator(`.arch-node[data-node-id="${rootId}"]`);
    await expect(moduleNode).toBeVisible();
    const beforeExpansion = await moduleNode.boundingBox();

    const collapsedGroup = page.locator('.kind-member-group[aria-expanded="false"]').first();
    const groupId = await collapsedGroup.getAttribute('data-node-id');
    await collapsedGroup.click();
    await expect(page.locator(`[data-node-id="${groupId}"]`)).toHaveAttribute('aria-expanded', 'true');
    const afterExpansion = await moduleNode.boundingBox();
    expect(Math.abs(afterExpansion.x - beforeExpansion.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(afterExpansion.y - beforeExpansion.y)).toBeLessThanOrEqual(1);

    await moduleNode.click();
    await page.locator('#zoom-in').click();
    const beforeResizeScale = Number(/\bscale\(([^)]+)\)/.exec(
        await page.locator('#viewport').getAttribute('transform')
    )[1]);
    const oldModule = await moduleNode.elementHandle();
    const rerendered = page.waitForFunction((element) => !element.isConnected, oldModule);
    await page.setViewportSize({ width: 600, height: 900 });
    await rerendered;

    const afterResize = await moduleNode.evaluate((element) => {
        const node = element.getBoundingClientRect();
        const canvas = document.getElementById('architecture-canvas').getBoundingClientRect();
        return {
            left: node.left - canvas.left,
            top: node.top - canvas.top,
            right: node.right - canvas.left,
            bottom: node.bottom - canvas.top,
            canvasWidth: canvas.width,
            canvasHeight: canvas.height
        };
    });
    expect(afterResize.left).toBeGreaterThanOrEqual(8);
    expect(afterResize.top).toBeGreaterThanOrEqual(8);
    expect(afterResize.right).toBeLessThanOrEqual(afterResize.canvasWidth - 8);
    expect(afterResize.bottom).toBeLessThanOrEqual(afterResize.canvasHeight - 8);
    expect(Number(/\bscale\(([^)]+)\)/.exec(
        await page.locator('#viewport').getAttribute('transform')
    )[1])).toBe(beforeResizeScale);
    await page.screenshot({ path: '.build/visual-qa/webview-resized.png', fullPage: true });
});

test('disclosure controls retain stable controlled member regions', async ({ page }) => {
    await page.goto('/?level=module');
    const disclosure = page.locator('.kind-member-group[aria-expanded="false"]').first();
    await expect(disclosure).toBeVisible();
    const controlledId = await disclosure.getAttribute('aria-controls');
    expect(controlledId).toBeTruthy();
    const region = page.locator(`[id="${controlledId}"]`);
    await expect(region).toHaveAttribute('aria-hidden', 'true');

    await disclosure.click();
    await expect(region).toHaveAttribute('aria-hidden', 'false');
    expect(await region.locator('.arch-node').count()).toBeGreaterThan(0);
});

test('CJK graph labels stay inside SVG cards without broken graphemes', async ({ page }) => {
    await page.goto('/?cjk=true');
    await page.locator('#show-packages').check();
    const moduleNode = page.locator('.kind-module').filter({ hasText: '행렬 가속기 제어' });
    await expect(moduleNode).toBeVisible();
    const title = moduleNode.locator('.node-title');
    await expect(title).toContainText('가속기');

    expect(await moduleNode.evaluate((element) => {
        const body = element.querySelector('.node-body').getBoundingClientRect();
        const label = element.querySelector('.node-title').getBoundingClientRect();
        return {
            startsInside: label.left >= body.left,
            endsInside: label.right <= body.right - 8,
            replacementCharacter: element.textContent.includes('\uFFFD')
        };
    })).toEqual({
        startsInside: true,
        endsInside: true,
        replacementCharacter: false
    });
    await page.screenshot({ path: '.build/visual-qa/webview-cjk.png', fullPage: true });
});

test('scheduling cycles render bounded overlays without changing relation kinds', async ({ page }) => {
    await page.goto('/?cycle=true');
    await page.locator('#show-packages').check();
    await page.locator('.kind-module').filter({ hasText: 'mkAcceleratorController' }).click();
    await page.getByRole('button', { name: 'Set as focus' }).click();
    await page.locator('[data-level="behavior"]').click();
    await page.locator('[data-analysis-mode="scheduling"]').click();
    const overlay = page.locator('.cycle-overlay');
    await expect(overlay).toHaveCount(1);
    await expect(overlay.locator('.cycle-label')).toContainText('Scheduling cycle');
    expect(await page.evaluate(() => {
        const sample = (kind) => getComputedStyle(
            document.querySelector(`#schedule-legend [data-kind="${kind}"]`),
            '::before'
        );
        const conflictFree = sample('conflict-free');
        const cycle = sample('cycle');
        return {
            conflictFree: conflictFree.borderTopStyle,
            cycle: {
                style: cycle.borderTopStyle,
                height: cycle.height,
                color: cycle.borderTopColor
            }
        };
    })).toEqual({
        conflictFree: 'dashed',
        cycle: {
            style: 'dashed',
            height: '8px',
            color: 'rgb(204, 167, 0)'
        }
    });
    expect(await page.evaluate(() => {
        const svg = document.getElementById('architecture-canvas');
        return ['preempts', 'execution-order', 'potential-state-dependency'].map((kind) => {
            const edge = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            edge.setAttribute('class', `edge ${kind}`);
            svg.append(edge);
            const live = getComputedStyle(edge);
            const legend = getComputedStyle(
                document.querySelector(`#schedule-legend [data-kind="${kind}"]`),
                '::before'
            );
            const liveStyle = live.strokeDasharray === 'none' ? 'solid' : 'dashed';
            const result = {
                kind,
                colorMatches: legend.borderTopColor === live.stroke,
                styleMatches: legend.borderTopStyle === liveStyle
            };
            edge.remove();
            return result;
        });
    })).toEqual([
        { kind: 'preempts', colorMatches: true, styleMatches: true },
        { kind: 'execution-order', colorMatches: true, styleMatches: true },
        { kind: 'potential-state-dependency', colorMatches: true, styleMatches: true }
    ]);
    expect(await overlay.evaluate((element) => ({
        regionStroke: getComputedStyle(element.querySelector('.cycle-region')).stroke,
        labelFill: getComputedStyle(element.querySelector('.cycle-label')).fill
    }))).toEqual({
        regionStroke: 'rgb(204, 167, 0)',
        labelFill: 'rgb(204, 167, 0)'
    });
    const previewEdges = page.locator('.edge-group.cycle-edge[data-edge-id^="preview-cycle-"]');
    await expect(previewEdges).toHaveCount(3);
    expect(await previewEdges.evaluateAll((groups) =>
        groups.map((group) => group.querySelector('.edge').classList.value)
    )).toEqual([
        expect.stringContaining('execution-order'),
        expect.stringContaining('execution-order'),
        expect.stringContaining('execution-order')
    ]);
    expect(await previewEdges.evaluateAll((groups) => {
        const lanes = groups.map((group) => {
            const edge = group.querySelector('.edge');
            const source = document.querySelector(`[data-node-id="${CSS.escape(edge.dataset.source)}"]`);
            const target = document.querySelector(`[data-node-id="${CSS.escape(edge.dataset.target)}"]`);
            const sourceTransform = Number(/translate\(([^ ]+)/.exec(source.getAttribute('transform'))[1]);
            const targetTransform = Number(/translate\(([^ ]+)/.exec(target.getAttribute('transform'))[1]);
            const sourceRight = sourceTransform + Number(source.querySelector('.node-body').getAttribute('width'));
            const targetRight = targetTransform + Number(target.querySelector('.node-body').getAttribute('width'));
            const route = /^M [^ ]+ [^ ]+ H ([^ ]+) V [^ ]+ H [^ ]+$/.exec(edge.getAttribute('d'));
            return { lane: Number(route?.[1]), minimum: Math.max(sourceRight, targetRight) + 16 };
        });
        return {
            outside: lanes.every(({ lane, minimum }) => lane >= minimum),
            distinct: new Set(lanes.map(({ lane }) => lane)).size === lanes.length
        };
    })).toEqual({ outside: true, distinct: true });
    expect(await page.locator('.edge-group.cycle-edge').evaluateAll((groups) => {
        const labels = groups
            .map((group) => group.querySelector('.edge-label-bg'))
            .filter(Boolean)
            .map((label) => label.getBoundingClientRect());
        const nodes = [...document.querySelectorAll('.arch-node .node-body')]
            .map((node) => node.getBoundingClientRect());
        const intersects = (left, right) =>
            left.left < right.right
            && left.right > right.left
            && left.top < right.bottom
            && left.bottom > right.top;
        return {
            nodesClear: labels.every((label) => nodes.every((node) => !intersects(label, node))),
            labelsClear: labels.every((label, index) =>
                labels.slice(index + 1).every((other) => !intersects(label, other))
            )
        };
    })).toEqual({ nodesClear: true, labelsClear: true });
    const exported = page.waitForFunction(() => typeof window.__lastSvg === 'string');
    await page.locator('#export-svg').click();
    await exported;
    expect(await page.evaluate(() => [
        '.cycle-region{fill:',
        '.cycle-label{fill:',
        '.edge-group.cycle-edge .edge'
    ].every((value) => window.__lastSvg.includes(value)))).toBe(true);
    expect(await page.evaluate(() => {
        const document = new DOMParser().parseFromString(window.__lastSvg, 'image/svg+xml');
        const svg = document.documentElement;
        const viewport = document.getElementById('viewport');
        const translate = /translate\(([^ ]+) ([^)]+)\)/.exec(viewport.getAttribute('transform'));
        const offsetX = Number(translate[1]);
        const width = Number(svg.getAttribute('width'));
        return [...document.querySelectorAll('.edge-label-bg')].every((label) =>
            Number(label.getAttribute('x')) + Number(label.getAttribute('width')) + offsetX <= width
        );
    })).toBe(true);
    await page.screenshot({ path: '.build/visual-qa/webview-scheduling-cycle.png', fullPage: true });
});
