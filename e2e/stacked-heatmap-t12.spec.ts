import { expect, type Page, test } from '@playwright/test';

async function loadDemoLot(
  page: Page,
  presetId: 'edge-ring-etch' | 'handling-scratch' = 'edge-ring-etch',
  options: { readonly reducedMotion?: 'reduce' | 'no-preference'; readonly colorScheme?: 'light' | 'dark' } = {},
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
    timeout: 8_000,
  });
  await expect(page.getByTestId('stacked-wafer-panel')).toBeAttached();
}

test.describe('Task 12 - stacked multi-wafer heatmap and wafer gallery', () => {
  test('renders all 25 wafers in gallery, collapses into magma stacked heatmap within 800 ms, shows hover readout, and brushes across linked views', async ({
    page,
  }) => {
    await loadDemoLot(page, 'edge-ring-etch', { colorScheme: 'light' });

    const panel = page.getByTestId('stacked-wafer-panel');
    await panel.scrollIntoViewIfNeeded();
    await expect(panel).toHaveAttribute('data-view-mode', 'gallery');

    // 1. Gallery renders all 25 wafers of the demo lot with real painted canvases
    const galleryItems = page.getByTestId('wafer-gallery-item');
    await expect(galleryItems).toHaveCount(25);
    await expect(galleryItems.first()).toContainText('W01');
    await expect(galleryItems.last()).toContainText('W25');

    // Clicking a gallery wafer selects it on the main stage
    await galleryItems.nth(4).click();
    await expect(galleryItems.nth(4)).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('stage-header').getByRole('heading')).toContainText('W05');

    // 2. Collapse gallery into stacked heatmap (<= 800 ms)
    const stackedRadio = page
      .getByTestId('stacked-view-segmented')
      .getByRole('radio', { name: 'Stacked' });
    const startMs = await page.evaluate(() => performance.now());
    await stackedRadio.click();
    await expect(panel).toHaveAttribute('data-view-mode', 'stacked');
    const stackedStage = page.getByTestId('stacked-heatmap-stage');
    await expect(stackedStage).toBeVisible();
    await expect(panel).toHaveAttribute('data-transition-state', 'idle', { timeout: 1_200 });
    const elapsedMs = await page.evaluate((t0) => performance.now() - t0, startMs);
    expect(elapsedMs).toBeLessThanOrEqual(950); // animation <= 800 ms + Playwright IPC margin

    // Verify numeric magma legend (160 x 6 px, min 0.0%, max rate + unit)
    const legend = page.getByTestId('stacked-magma-legend');
    await expect(legend).toBeVisible();
    await expect(page.getByTestId('stacked-legend-min')).toHaveText('0.0%');
    await expect(page.getByTestId('stacked-legend-max')).toHaveText(/^\d+\.\d% fail rate$/);
    const legendBarBox = (await page.getByTestId('stacked-magma-legend-bar').boundingBox())!;
    expect(Math.round(legendBarBox.width)).toBe(160);
    expect(Math.round(legendBarBox.height)).toBe(6);

    // Verify base canvas painted non-empty magma pixels
    const hasMagmaPixels = await page.evaluate(() => {
      const canvas = document.querySelector<HTMLCanvasElement>(
        '[data-testid="stacked-heatmap-base-canvas"]',
      );
      if (!canvas) return false;
      const ctx = canvas.getContext('2d');
      if (!ctx) return false;
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      let bright = 0;
      for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3]! > 200 && (data[i]! > 160 || data[i + 2]! > 100)) {
          bright += 1;
        }
      }
      return bright > 50;
    });
    expect(hasMagmaPixels).toBe(true);

    // 3. Hover readout over a failing edge cell displays (X, Y), failed/tested wafers, 1-decimal rate, and dominant bin
    const stageBox = (await stackedStage.boundingBox())!;
    let foundFailingCell = false;
    const midY = stageBox.y + stageBox.height / 2;
    for (let x = stageBox.x + 16; x < stageBox.x + stageBox.width * 0.45; x += 6) {
      await page.mouse.move(x, midY);
      const readout = page.getByTestId('stacked-hover-readout');
      if (await readout.isVisible()) {
        const binEl = page.getByTestId('stacked-readout-bin');
        if (await binEl.isVisible()) {
          await expect(page.getByTestId('stacked-readout-coord')).toHaveText(
            /^X [\u2212-]?\d+, Y [\u2212-]?\d+$/,
          );
          await expect(page.getByTestId('stacked-readout-rate')).toContainText(
            /\d+ of 25 wafers failed/,
          );
          await expect(page.getByTestId('stacked-readout-rate')).toContainText(/\d+\.\d%/);
          await expect(binEl).toContainText(/SBIN \d+/);
          await expect(binEl).toContainText(/HBIN \d+/);
          foundFailingCell = true;
          break;
        }
      }
    }
    expect(foundFailingCell).toBe(true);

    // 4. Region selection (drag brush on stacked heatmap) updates Selection Store and linked views
    const overlay = page.getByTestId('wafer-overlay-wrapper');
    const paretoRows = page.getByTestId('bin-pareto-rows');
    await expect(overlay).toHaveAttribute('data-highlight-count', '0');
    const paretoBefore = await paretoRows.innerText();

    const dragStartX = stageBox.x + stageBox.width * 0.18;
    const dragStartY = stageBox.y + stageBox.height * 0.35;
    const dragEndX = stageBox.x + stageBox.width * 0.52;
    const dragEndY = stageBox.y + stageBox.height * 0.65;

    await page.mouse.move(dragStartX, dragStartY);
    await page.mouse.down();
    await page.mouse.move(dragEndX, dragEndY, { steps: 6 });
    await page.mouse.up();

    // Selection summary appears, sticky single-wafer overlay highlights dies, and Pareto updates
    const selSummary = page.getByTestId('stacked-selection-summary');
    await expect(selSummary).toBeVisible();
    await expect(selSummary).toContainText(/selected across 25 wafers/);
    await expect
      .poll(async () => Number(await overlay.getAttribute('data-highlight-count')))
      .toBeGreaterThan(25);
    await expect.poll(() => paretoRows.innerText()).not.toBe(paretoBefore);

    // Clicking Clear clears the stacked region filter across all views
    await page.getByTestId('stacked-selection-clear').click();
    await expect(selSummary).toBeHidden();
    await expect(overlay).toHaveAttribute('data-highlight-count', '0');
    await expect.poll(() => paretoRows.innerText()).toBe(paretoBefore);

    // No horizontal overflow
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(1440);
  });

  test('respects prefers-reduced-motion with an instant cross-fade from gallery to stacked heatmap', async ({
    page,
  }) => {
    await loadDemoLot(page, 'handling-scratch', {
      reducedMotion: 'reduce',
      colorScheme: 'dark',
    });

    const panel = page.getByTestId('stacked-wafer-panel');
    await panel.scrollIntoViewIfNeeded();
    await expect(panel).toHaveAttribute('data-reduced-motion', 'true');
    await expect(page.getByTestId('wafer-gallery-item')).toHaveCount(25);

    const stackedRadio = page
      .getByTestId('stacked-view-segmented')
      .getByRole('radio', { name: 'Stacked' });
    const startMs = await page.evaluate(() => performance.now());
    await stackedRadio.click();
    await expect(page.getByTestId('stacked-heatmap-stage')).toBeVisible();
    await expect(panel).toHaveAttribute('data-transition-state', 'idle', { timeout: 600 });
    const elapsedMs = await page.evaluate((t0) => performance.now() - t0, startMs);
    expect(elapsedMs).toBeLessThan(500);

    // Keyboard stepping + Enter selects a cell across all wafers
    const stage = page.getByTestId('stacked-heatmap-stage');
    await stage.focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByTestId('stacked-hover-readout')).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('stacked-selection-summary')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('stacked-selection-summary')).toBeHidden();
  });
});
