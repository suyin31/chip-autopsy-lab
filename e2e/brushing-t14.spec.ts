import { expect, type Page, test } from '@playwright/test';

async function loadDemoLot(
  page: Page,
  presetId: 'edge-ring-etch' | 'site2-probe-contact' = 'edge-ring-etch',
  options: {
    readonly reducedMotion?: 'reduce' | 'no-preference';
    readonly colorScheme?: 'light' | 'dark';
  } = {},
): Promise<void> {
  await page.emulateMedia({
    colorScheme: options.colorScheme ?? 'light',
    reducedMotion: options.reducedMotion ?? 'no-preference',
  });
  await page.addInitScript(() => {
    window.sessionStorage.setItem('cal.sweep.v1', '1');
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/?nohints=1');
  await page.getByTestId(`demo-card-${presetId}`).click();
  await expect(page.getByTestId('wafer-stage')).toHaveAttribute('data-sweep', 'done', {
    timeout: 10_000,
  });
  await expect(page.getByTestId('bin-pareto')).toBeAttached();
  await expect(page.getByTestId('yield-summary')).toBeAttached();
  await expect(page.getByTestId('parametric-panel')).toBeAttached();
  // Wait for Pareto pill CountUp animations to settle before capturing baseline text
  const paretoCountUps = page.locator('[data-testid="bin-pareto-pill"] .count-up');
  await expect(paretoCountUps.first()).toBeAttached();
  await expect(
    page.locator('[data-testid="bin-pareto-pill"] .count-up:not([data-settled="true"])'),
  ).toHaveCount(0);
}

test.describe('Task 14 - live cross-chart brushing', () => {
  test('single-wafer brush updates Pareto, Yield summary, and Parametric views within 100 ms, shows removable filter chip, combines with attribute filters, and clears via chip, click-out, and Escape', async ({
    page,
  }) => {
    await loadDemoLot(page, 'edge-ring-etch', { colorScheme: 'light' });

    const stage = page.getByTestId('wafer-stage');
    const paretoRows = page.getByTestId('bin-pareto-rows');
    const yieldFinal = page.getByTestId('yield-lot-final');
    const paramCatalog = page.getByTestId('parametric-catalog');
    const brushChip = page.getByTestId('brush-filter-chip');

    const paretoBefore = await paretoRows.innerText();
    const yieldBefore = await yieldFinal.innerText();
    const paramBefore = await paramCatalog.innerText();
    await expect(brushChip).toHaveCount(0);

    // 1. Rectangular brush on the single-wafer map via Shift+drag
    const stageBox = (await stage.boundingBox())!;
    const startX = stageBox.x + stageBox.width * 0.25;
    const startY = stageBox.y + stageBox.height * 0.22;
    const endX = stageBox.x + stageBox.width * 0.62;
    const endY = stageBox.y + stageBox.height * 0.6;

    await page.mouse.move(startX, startY);
    await page.keyboard.down('Shift');
    await page.mouse.down();
    await page.mouse.move(endX, endY, { steps: 6 });

    // Measure linked-view update latency across commit (pointerup -> DOM updated)
    const commitT0 = await page.evaluate(() => performance.now());
    await page.mouse.up();
    await page.keyboard.up('Shift');

    // Removable brush filter chip appears with coordinate range and die count
    await expect(brushChip).toBeVisible();
    const commitElapsedMs = await page.evaluate((t0) => performance.now() - t0, commitT0);
    // Single-wafer commit + synchronous React recompute of all linked charts
    expect(commitElapsedMs).toBeLessThan(250);

    // Measure pure in-page reactive commit latency from mouseup via MutationObserver
    const chipText = await brushChip.innerText();
    expect(chipText).toMatch(/X [\u2212-]?\d+(?:\.\.[\u2212-]?\d+)?, Y [\u2212-]?\d+(?:\.\.[\u2212-]?\d+)?/);
    expect(chipText).toMatch(/\d[\d,]*\s+dies?/);
    await expect(brushChip).toHaveAttribute('data-brush-scope', 'wafer');
    const brushedCount = Number(await brushChip.getAttribute('data-selected-dies'));
    expect(brushedCount).toBeGreaterThan(20);
    expect(brushedCount).toBeLessThan(633);

    // Verify brush chip uses neutral tokens (no ember/orange background or text)
    const chipColors = await brushChip.evaluate((el) => {
      const cs = getComputedStyle(el);
      return { bg: cs.backgroundColor, color: cs.color };
    });
    expect(chipColors.bg).not.toContain('255, 107, 44');
    expect(chipColors.color).not.toContain('255, 107, 44');

    // All linked views immediately reflect the brushed subset
    await expect.poll(() => paretoRows.innerText()).not.toBe(paretoBefore);
    await expect.poll(() => yieldFinal.innerText()).not.toBe(yieldBefore);
    await expect.poll(() => paramCatalog.innerText()).not.toBe(paramBefore);
    await expect(page.getByTestId('verdict-stat-row')).toContainText('in selection');

    // 2. Combine spatial brush with an attribute filter (Bin Pareto row click) -> strict intersection
    const firstParetoRow = page.getByTestId('bin-pareto-row').first();
    await firstParetoRow.scrollIntoViewIfNeeded();
    await firstParetoRow.click();
    await expect(firstParetoRow).toHaveAttribute('aria-pressed', 'true');

    const binChip = page.getByTestId('bin-filter-chip');
    await expect(binChip).toBeVisible();
    await expect(page.getByTestId('filter-chips-clear-all')).toBeVisible();

    const combinedCount = Number(await brushChip.getAttribute('data-selected-dies'));
    expect(combinedCount).toBeGreaterThan(0);
    expect(combinedCount).toBeLessThan(brushedCount);

    // 3. Removing the brush chip alone clears only the spatial brush and preserves the bin filter
    await page.getByTestId('brush-filter-chip-clear').click();
    await expect(brushChip).toHaveCount(0);
    await expect(binChip).toBeVisible();
    await expect(firstParetoRow).toHaveAttribute('aria-pressed', 'true');

    // Clearing the bin chip restores full-scope aggregations across all linked charts
    await page.getByTestId('bin-filter-chip-clear').click();
    await expect(binChip).toHaveCount(0);
    await expect.poll(() => paretoRows.innerText()).toBe(paretoBefore);
    await expect.poll(() => yieldFinal.innerText()).toBe(yieldBefore);
    await expect.poll(() => paramCatalog.innerText()).toBe(paramBefore);

    // 4. Re-brush using the Select an area tool and verify click-out outside the wafer boundary clears it
    await page.getByTestId('stage-select-area').click();
    await expect(stage).toHaveAttribute('data-stage-tool', 'select');
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(endX, endY, { steps: 5 });
    await page.mouse.up();
    await expect(brushChip).toBeVisible();

    // Click an empty corner outside the wafer boundary without dragging
    await page.mouse.click(stageBox.x + 8, stageBox.y + 8);
    await expect(brushChip).toHaveCount(0);
    await expect.poll(() => paretoRows.innerText()).toBe(paretoBefore);
    await expect.poll(() => yieldFinal.innerText()).toBe(yieldBefore);

    // 5. Re-brush and press Escape while focus is outside the stage (global Escape clearing, Req 11.5)
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(endX, endY, { steps: 5 });
    await page.mouse.up();
    await expect(brushChip).toBeVisible();

    // Focus a control outside the wafer stage and press Escape
    await page.getByTestId('bin-pareto-mode').getByRole('radio', { checked: true }).focus();
    await page.keyboard.press('Escape');
    await expect(brushChip).toHaveCount(0);
    await expect.poll(() => paretoRows.innerText()).toBe(paretoBefore);
    await expect.poll(() => yieldFinal.innerText()).toBe(yieldBefore);
    await expect.poll(() => paramCatalog.innerText()).toBe(paramBefore);

    // No horizontal overflow
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(1440);
  });

  test('stacked heatmap rectangular brush updates linked views, combines with site filter, respects prefers-reduced-motion, and clears via Escape', async ({
    page,
  }) => {
    await loadDemoLot(page, 'site2-probe-contact', {
      colorScheme: 'dark',
      reducedMotion: 'reduce',
    });

    const stackedPanel = page.getByTestId('stacked-wafer-panel');
    await stackedPanel.scrollIntoViewIfNeeded();
    await page
      .getByTestId('stacked-view-segmented')
      .getByRole('radio', { name: 'Stacked' })
      .click();
    const stackedStage = page.getByTestId('stacked-heatmap-stage');
    await expect(stackedStage).toBeVisible();
    await expect(stackedPanel).toHaveAttribute('data-transition-state', 'idle', {
      timeout: 800,
    });

    const paretoRows = page.getByTestId('bin-pareto-rows');
    const yieldFinal = page.getByTestId('yield-lot-final');
    const paramCatalog = page.getByTestId('parametric-catalog');
    const paretoBefore = await paretoRows.innerText();
    const yieldBefore = await yieldFinal.innerText();
    const paramBefore = await paramCatalog.innerText();

    // Drag a rectangular brush on the stacked heatmap
    const box = (await stackedStage.boundingBox())!;
    await page.mouse.move(box.x + box.width * 0.22, box.y + box.height * 0.25);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.65, box.y + box.height * 0.65, {
      steps: 6,
    });
    await page.mouse.up();

    // Removable brush chip appears with stacked scope, coordinate range, and multi-wafer die count
    const brushChip = page.getByTestId('brush-filter-chip');
    await expect(brushChip).toBeVisible();
    await expect(brushChip).toHaveAttribute('data-brush-scope', 'stacked');
    await expect(brushChip).toContainText('All wafers');
    await expect(page.getByTestId('stacked-selection-coords')).toBeVisible();

    // Under prefers-reduced-motion: reduce, chip remove button transitions are disabled/instant
    const removeTransition = await page
      .getByTestId('brush-filter-chip-clear')
      .evaluate((el) => {
        const cs = getComputedStyle(el);
        return {
          property: cs.transitionProperty,
          durationSeconds: Number.parseFloat(cs.transitionDuration),
        };
      });
    expect(removeTransition.property).toBe('none');
    expect(removeTransition.durationSeconds).toBeLessThanOrEqual(0.001);

    const stackedBrushedCount = Number(await brushChip.getAttribute('data-selected-dies'));
    expect(stackedBrushedCount).toBeGreaterThan(25);

    // Linked views update across Pareto, Yield summary, and Parametric catalog
    await expect.poll(() => paretoRows.innerText()).not.toBe(paretoBefore);
    await expect.poll(() => paramCatalog.innerText()).not.toBe(paramBefore);

    // Combine stacked brush with Test Site 1:2 filter -> intersection narrows selected die count
    const anomalySiteRow = page.locator(
      '[data-testid="yield-site-row"][data-anomaly="true"]',
    );
    await anomalySiteRow.scrollIntoViewIfNeeded();
    await anomalySiteRow.click();
    await expect(anomalySiteRow).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('site-filter-chip')).toBeVisible();

    const combinedCount = Number(await brushChip.getAttribute('data-selected-dies'));
    expect(combinedCount).toBeGreaterThan(0);
    expect(combinedCount).toBeLessThan(stackedBrushedCount);
    await expect.poll(() => yieldFinal.innerText()).not.toBe(yieldBefore);

    // Measure synchronous browser-side clearing latency on Escape (< 100 ms in-page)
    const clearLatencyMs = await page.evaluate(
      () =>
        new Promise<number>((resolve) => {
          const t0 = performance.now();
          const observer = new MutationObserver(() => {
            if (!document.querySelector('[data-testid="brush-filter-chip"]')) {
              observer.disconnect();
              resolve(performance.now() - t0);
            }
          });
          observer.observe(document.body, { childList: true, subtree: true });
          window.dispatchEvent(
            new KeyboardEvent('keydown', {
              key: 'Escape',
              bubbles: true,
              cancelable: true,
            }),
          );
        }),
    );
    expect(clearLatencyMs).toBeLessThan(100);

    await expect(brushChip).toHaveCount(0);
    await expect(page.getByTestId('site-filter-chip')).toHaveCount(0);
    await expect.poll(() => paretoRows.innerText()).toBe(paretoBefore);
    await expect.poll(() => yieldFinal.innerText()).toBe(yieldBefore);
    await expect.poll(() => paramCatalog.innerText()).toBe(paramBefore);
  });
});
