'use strict';

const { test, expect } = require('@playwright/test');
const fs = require('node:fs');

const EVENT_TIMEOUT_MS = 5000;
fs.mkdirSync('.build/visual-qa', { recursive: true });

function browserErrors(page) {
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
        if (message.type() === 'error') errors.push(message.text());
    });
    return errors;
}

function nextSelectedState(page, expectedNodeId) {
    return page.evaluate(({ nodeId, timeout }) => new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            window.removeEventListener('bsv-host-message', listener);
            reject(new Error(`Timed out waiting for selected node ${nodeId}`));
        }, timeout);
        function listener(event) {
            const message = event.detail;
            if (message?.type !== 'state' || message.state?.selectedId !== nodeId) return;
            clearTimeout(timer);
            window.removeEventListener('bsv-host-message', listener);
            resolve(message);
        }
        window.addEventListener('bsv-host-message', listener);
    }), { nodeId: expectedNodeId, timeout: EVENT_TIMEOUT_MS });
}

function nextFocusState(page, expectedFocusId) {
    return page.evaluate(({ focusId, timeout }) => new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            window.removeEventListener('bsv-host-message', listener);
            reject(new Error(`Timed out waiting for focus ${focusId || 'All Roots'}`));
        }, timeout);
        function listener(event) {
            const message = event.detail;
            if (message?.type !== 'state') return;
            const actual = message.state?.focusStack?.at(-1) || null;
            if (actual !== focusId) return;
            clearTimeout(timer);
            window.removeEventListener('bsv-host-message', listener);
            resolve(message);
        }
        window.addEventListener('bsv-host-message', listener);
    }), { focusId: expectedFocusId, timeout: EVENT_TIMEOUT_MS });
}

test('AQuA system graph supports analysis modes focus navigation and exports', async ({ page }) => {
    const errors = browserErrors(page);
    await page.goto('/');
    await page.locator('#show-packages').check();
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
    await expect(page.locator('.kind-instance, .kind-module').filter({
        hasText: 'mkAquaLoopMatmul'
    })).toBeVisible();
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
    expect(await page.evaluate(() => window.__savedState.projectionFocusId)).toContain('beginArrayWork');
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

test('AQuA two-root forest preserves hierarchy and root focus navigation', async ({ page }) => {
    const errors = browserErrors(page);
    await page.goto('/');

    const forest = await page.evaluate(() => {
        const view = window.BsvArchitectureGraph.createViewModel(window.__model, window.__savedState);
        const visible = view.visible();
        return {
            roots: view.architectureRoots().map((node) => ({ id: node.id, name: node.name })),
            topologyRoots: visible.topology.roots.map((root) => root.id),
            crossRootHierarchy: visible.edges.filter((edge) =>
                edge.kind === 'instance-child'
                && visible.topology.rootById.get(edge.source) !== visible.topology.rootById.get(edge.target)
            ).map((edge) => edge.id)
        };
    });
    expect(forest.roots.map((root) => root.name)).toEqual([
        'mkAquaLoopMatmul',
        'mkAquaMemorySubsystem'
    ]);
    expect(forest.topologyRoots).toEqual(forest.roots.map((root) => root.id));
    expect(forest.crossRootHierarchy).toEqual([]);
    await expect(page.locator('#root-field')).toBeVisible();
    await expect(page.locator('#root-select option')).toHaveText([
        'All Roots',
        'mkAquaLoopMatmul',
        'mkAquaMemorySubsystem'
    ]);
    const rootBoundaries = page.locator('.architecture-group.kind-root-boundary');
    await expect(rootBoundaries).toHaveCount(2);
    expect(await rootBoundaries.evaluateAll((groups) => {
        const boxes = groups.map((group) => group.querySelector('.group-box').getBoundingClientRect());
        const titles = groups.map((group) => group.querySelector('.group-title').getBoundingClientRect());
        const overlaps = boxes[0].left < boxes[1].right && boxes[0].right > boxes[1].left
            && boxes[0].top < boxes[1].bottom && boxes[0].bottom > boxes[1].top;
        return {
            overlaps,
            titlesContained: titles.every((title, index) =>
                title.left >= boxes[index].left && title.right <= boxes[index].right
            )
        };
    })).toEqual({ overlaps: false, titlesContained: true });
    await page.locator('.kind-instance').filter({ hasText: 'mkAquaLoopMatmul' }).hover();
    await page.screenshot({ path: '.build/visual-qa/aqua-all-roots-dark.png', fullPage: true });

    const loopRoot = forest.roots.find((root) => root.name === 'mkAquaLoopMatmul');
    const memoryRoot = forest.roots.find((root) => root.name === 'mkAquaMemorySubsystem');
    const loopFocused = nextFocusState(page, loopRoot.id);
    await page.locator('#root-select').selectOption(loopRoot.id);
    await loopFocused;
    await expect(page.locator('.architecture-group.kind-root-boundary')).toHaveCount(1);
    await expect(page.locator('[data-hop="all"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#focus-summary')).toContainText('mkAquaLoopMatmul');
    await page.screenshot({ path: '.build/visual-qa/aqua-loop-root-focus-dark.png', fullPage: true });

    const matmul = page.locator('.kind-instance').filter({ hasText: 'matmul' }).first();
    await matmul.click();
    await expect(page.locator('#inspector')).toContainText('mkMatmulScheduler');
    const matmulId = await matmul.getAttribute('data-node-id');
    const childFocused = nextFocusState(page, matmulId);
    await page.getByRole('button', { name: 'Set as focus' }).click();
    await childFocused;
    await expect(page.locator('#breadcrumbs')).toContainText('mkAquaLoopMatmul');
    await expect(page.locator('#breadcrumbs')).toContainText('matmul');

    const backed = nextFocusState(page, loopRoot.id);
    await page.getByRole('button', { name: 'Back', exact: true }).click();
    await backed;
    await expect(page.locator('#root-select')).toHaveValue(loopRoot.id);

    const allRoots = nextFocusState(page, null);
    await page.locator('#root-select').selectOption('');
    await allRoots;
    await expect(page.locator('.architecture-group.kind-root-boundary')).toHaveCount(2);
    await expect(page.locator('.kind-instance').filter({ hasText: 'mkAquaMemorySubsystem' })).toBeVisible();
    expect(memoryRoot.id).not.toEqual(loopRoot.id);

    await page.evaluate(() => {
        const style = document.documentElement.style;
        style.setProperty('--vscode-editor-background', '#ffffff');
        style.setProperty('--vscode-sideBar-background', '#f3f3f3');
        style.setProperty('--vscode-editorWidget-background', '#f8f8f8');
        style.setProperty('--vscode-foreground', '#1f1f1f');
        style.setProperty('--vscode-descriptionForeground', '#616161');
        style.setProperty('--vscode-panel-border', '#d4d4d4');
    });
    await page.screenshot({ path: '.build/visual-qa/aqua-all-roots-light.png', fullPage: true });

    await page.setViewportSize({ width: 680, height: 900 });
    await expect(page.locator('#root-select')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(680);
    await page.screenshot({ path: '.build/visual-qa/aqua-all-roots-compact-light.png', fullPage: true });
    expect(errors).toEqual([]);
});

test('AQuA System Data Flow keeps external channels within their root boundaries', async ({ page }) => {
    const errors = browserErrors(page);
    await page.goto('/');
    await page.locator('[data-analysis-mode="data-flow"]').click();

    const boundaries = await page.evaluate(() => {
        const model = window.__model;
        const roots = new Set(model.architectureRoots);
        const rootByNode = new Map();
        for (const node of model.nodes) {
            if (node.boundaryRootId) {
                rootByNode.set(node.id, node.boundaryRootId);
                continue;
            }
            let current = node;
            const seen = new Set();
            while (current?.parentId && !seen.has(current.id)) {
                seen.add(current.id);
                current = model.nodes.find((candidate) => candidate.id === current.parentId);
            }
            if (current && roots.has(current.id)) rootByNode.set(node.id, current.id);
        }
        const boundaryEdges = model.edges.filter((edge) => edge.boundary === true);
        const rootBoxes = new Map([...document.querySelectorAll('.architecture-group.kind-root-boundary')]
            .map((element) => [element.dataset.ownerId, element.querySelector('.group-box').getBBox()]));
        const escapedGeometry = [];
        for (const element of document.querySelectorAll('.edge-group[data-edge-id]')) {
            const edge = model.edges.find((item) => item.id === element.dataset.edgeId);
            const box = rootBoxes.get(rootByNode.get(edge.source));
            if (!box) continue;
            for (const shape of element.querySelectorAll('path.edge, .edge-label-bg')) {
                const rect = shape.getBBox();
                if (rect.x < box.x - 0.5 || rect.y < box.y - 0.5
                    || rect.x + rect.width > box.x + box.width + 0.5
                    || rect.y + rect.height > box.y + box.height + 0.5) {
                    escapedGeometry.push({ edgeId: edge.id, shape: shape.getAttribute('class') });
                }
            }
        }
        return {
            escapedGeometry,
            semanticBoundaryCount: model.semanticBoundaries.length,
            externalChannelCount: model.nodes.filter((node) => node.externalChannel).length,
            boundaryEdgeCount: boundaryEdges.length,
            renderedBoundaryEdges: [...document.querySelectorAll('.edge-group[data-edge-id]')]
                .map((element) => element.dataset.edgeId)
                .filter((id) => boundaryEdges.some((edge) => edge.id === id)),
            kinds: [...new Set(boundaryEdges.map((edge) => edge.kind))].sort(),
            crossRoot: model.edges.filter((edge) => {
                const sourceRoot = rootByNode.get(edge.source);
                const targetRoot = rootByNode.get(edge.target);
                return sourceRoot && targetRoot && sourceRoot !== targetRoot;
            }).map((edge) => edge.id)
        };
    });
    expect(boundaries.semanticBoundaryCount).toBe(2);
    expect(boundaries.externalChannelCount).toBe(13);
    expect(boundaries.boundaryEdgeCount).toBeGreaterThan(boundaries.externalChannelCount);
    expect(boundaries.kinds).toEqual(['boundary-input', 'boundary-output']);
    expect(boundaries.renderedBoundaryEdges).toHaveLength(boundaries.boundaryEdgeCount);
    expect(boundaries.crossRoot).toEqual([]);
    expect(boundaries.escapedGeometry).toEqual([]);
    await expect(page.locator('.architecture-group.kind-root-boundary')).toHaveCount(2);
    await expect(page.locator('.arch-node.kind-root-boundary')).toHaveCount(4);
    await page.screenshot({ path: '.build/visual-qa/aqua-system-data-flow-dark.png', fullPage: true });
    expect(errors).toEqual([]);
});

test('AQuA canonical source reveals resolve visible multiple and hidden presentations', async ({ page }) => {
    const errors = browserErrors(page);
    await page.goto('/');

    const source = await page.evaluate(() => {
        function exact(kind, name) {
            const reference = window.__model.sourceReferences.find((item) =>
                item.kind === kind && item.name === name
            );
            if (!reference) throw new Error(`Missing ${kind} source reference ${name}`);
            return { status: 'exact', references: [reference] };
        }
        const roots = window.BsvArchitectureGraph
            .createViewModel(window.__model, window.__savedState)
            .architectureRoots();
        return {
            loopRootId: roots.find((node) => node.name === 'mkAquaLoopMatmul').id,
            memoryRootId: roots.find((node) => node.name === 'mkAquaMemorySubsystem').id,
            loop: exact('definition', 'mkAquaLoopMatmul'),
            repeatedScratchpad: exact('definition', 'mkBankedScratchpad'),
            completeWork: exact('implementation-method', 'completeWork')
        };
    });

    const selected = nextSelectedState(page, source.loopRootId);
    await page.evaluate((sourceReference) => window.dispatchEvent(new MessageEvent('message', {
        data: { type: 'revealSource', sourceReference, revision: 0 }
    })), source.loop);
    await selected;
    await expect(page.locator('#inspector')).toContainText('mkAquaLoopMatmul');
    await expect(page.locator('#reveal-notice')).toBeHidden();

    const beforeMultiple = await page.evaluate(() => window.__savedState.selectedId);
    await page.evaluate((sourceReference) => window.dispatchEvent(new MessageEvent('message', {
        data: { type: 'revealSource', sourceReference, revision: 0 }
    })), source.repeatedScratchpad);
    await expect(page.locator('#reveal-notice')).toBeVisible();
    expect(await page.evaluate(() => window.__savedState.selectedId)).toBe(beforeMultiple);
    expect(await page.locator('#reveal-notice button').count()).toBeGreaterThan(1);

    const memoryFocused = nextFocusState(page, source.memoryRootId);
    await page.locator('#root-select').selectOption(source.memoryRootId);
    await memoryFocused;
    await page.evaluate((sourceReference) => window.dispatchEvent(new MessageEvent('message', {
        data: { type: 'revealSource', sourceReference, revision: 0 }
    })), source.loop);
    await expect(page.locator('#reveal-notice')).toBeVisible();
    await expect(page.locator('#reveal-current-view')).toBeEnabled();

    await page.locator('#root-select').selectOption('');
    await page.locator('[data-level="system"]').click();
    await page.evaluate((sourceReference) => window.dispatchEvent(new MessageEvent('message', {
        data: { type: 'revealSource', sourceReference, revision: 0 }
    })), source.completeWork);
    await expect(page.locator('#reveal-notice')).toBeVisible();
    await expect(page.locator('#reveal-current-view')).toBeEnabled();
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
    await page.goto('/?cjk=true');
    const rootId = await page.evaluate(() => window.__model.instances
        .find((instance) => instance.name === 'mkAquaLoopMatmul' && !instance.parentInstanceId).id);
    await page.locator('#root-select').selectOption(rootId);
    await page.locator('[data-level="module"]').click();
    const moduleNode = page.locator(`.arch-node[data-node-id="${rootId}"]`);
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
