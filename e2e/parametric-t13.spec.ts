import { expect, type Page, test } from '@playwright/test';

async function loadDemoLot(
  page: Page,
  presetId: 'edge-ring-etch' | 'handling-scratch' = 'edge-ring-etch',
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
  await expect(page.getByTestId('wafer-stage')).toHaveAttribute(
    'data-sweep',
    'done',
    { timeout: 8_000 },
  );
  await expect(page.getByTestId('parametric-panel')).toBeAttached();
}

test.describe('Task 13 - parametric analysis', () => {
  test('lists tests in sortable catalog, renders histogram with LO/HI limit markers and non-overlapping scrub readout, and activates wafer map Parametric mode', async ({
    page,
  }) => {
    await loadDemoLot(page, 'edge-ring-etch', { colorScheme: 'light' });

    const panel = page.getByTestId('parametric-panel');
    await panel.scrollIntoViewIfNeeded();
    await expect(panel).toBeVisible();

    // 1. Test catalog lists all 4 demo tests with TEST_NUM, units, n, fail count, mean, sigma, Cp, Cpk
    const catalogRows = page.getByTestId('parametric-catalog-row');
    await expect(catalogRows).toHaveCount(4);

    // Default sort is Cpk ascending -> IDDQ_LEAK (test 204) is first on edge-ring-etch
    const firstRow = catalogRows.first();
    await expect(firstRow).toHaveAttribute('data-test-num', '204');
    await expect(firstRow).toContainText('IDDQ_LEAK');
    await expect(firstRow).toContainText('uA');
    await expect(firstRow).toContainText('15,825');
    // Cp and Cpk formatted to 2 decimals
    await expect(firstRow).toContainText(/\d+\.\d{2}/);

    // All 4 tests present in catalog
    const catalogText = await page.getByTestId('parametric-catalog').innerText();
    expect(catalogText).toContain('VDD_CONT_R');
    expect(catalogText).toContain('IDDQ_LEAK');
    expect(catalogText).toContain('VCCA_SHORT');
    expect(catalogText).toContain('VTH_CORE');

    // Sorting by Test number reorders catalog deterministically (101 first)
    await page.getByTestId('parametric-sort-testNum').click();
    await expect(catalogRows.first()).toHaveAttribute('data-test-num', '101');
    await expect(catalogRows.last()).toHaveAttribute('data-test-num', '410');

    // Clicking a test row selects it and updates the histogram
    const iddqRow = page.locator(
      '[data-testid="parametric-catalog-row"][data-test-num="204"]',
    );
    await iddqRow.click();
    await expect(iddqRow).toHaveAttribute('data-selected', 'true');
    const histogram = page.getByTestId('parametric-histogram');
    await expect(histogram).toHaveAttribute('data-test-num', '204');

    // 2. Histogram renders bars, LO & HI limit markers with SI-formatted labels, and scrub readout strictly above bars
    const bars = page.getByTestId('parametric-histogram-bar');
    expect(await bars.count()).toBeGreaterThanOrEqual(12);

    const loMarker = page.getByTestId('parametric-limit-lo');
    const hiMarker = page.getByTestId('parametric-limit-hi');
    await expect(loMarker).toBeVisible();
    await expect(hiMarker).toBeVisible();
    await expect(loMarker).toContainText(/^LO [\d.,]+ uA$/);
    await expect(hiMarker).toContainText(/^HI [\d.,]+ uA$/);

    // Hover/scrub across histogram displays vertical scrub rule and floating range/count readout above the plot area
    const scrubOverlay = page.getByTestId('parametric-scrub-overlay');
    const overlayBox = (await scrubOverlay.boundingBox())!;
    const readout = page.getByTestId('parametric-scrub-readout');
    const readoutBox = (await readout.boundingBox())!;
    const plotBox = (await page.getByTestId('parametric-plot-area').boundingBox())!;

    // Readout sits strictly above the plot area so it can never cover plotted bars (Req 8.5)
    expect(readoutBox.y + readoutBox.height).toBeLessThanOrEqual(plotBox.y + 1);

    await page.mouse.move(
      overlayBox.x + overlayBox.width * 0.35,
      overlayBox.y + overlayBox.height * 0.5,
    );
    await expect(readout).toHaveAttribute('data-scrubbing', 'true');
    await expect(page.getByTestId('parametric-scrub-rule')).toBeVisible();
    await expect(page.getByTestId('parametric-scrub-value')).toContainText(
      /uA to [\d.,]+ uA, [\d,]+ die/,
    );

    // Drag scrub moves rule smoothly across bins
    await page.mouse.down();
    await page.mouse.move(
      overlayBox.x + overlayBox.width * 0.65,
      overlayBox.y + overlayBox.height * 0.5,
      { steps: 4 },
    );
    const scrubbedTextMid = await page
      .getByTestId('parametric-scrub-value')
      .innerText();
    expect(scrubbedTextMid).toMatch(/uA to [\d.,]+ uA, [\d,]+ die/);
    await page.mouse.up();

    // 3. Wafer map Parametric mode: activate via stage segmented control or panel toggle
    const mapToggle = page.getByTestId('parametric-map-toggle');
    await mapToggle.click();
    await expect(mapToggle).toHaveAttribute('aria-pressed', 'true');

    const stageSegmented = page.getByTestId('stage-mode-segmented');
    await expect(
      stageSegmented.getByRole('radio', { name: 'Parametric' }),
    ).toHaveAttribute('aria-checked', 'true');

    // Numeric magma color-bar legend appears under the wafer (160 x 6 px, min/max SI values)
    const magmaLegend = page.getByTestId('parametric-magma-legend');
    await expect(magmaLegend).toBeVisible();
    await expect(page.getByTestId('parametric-legend-min')).toContainText('uA');
    await expect(page.getByTestId('parametric-legend-max')).toContainText('uA');
    const legendBarBox = (await page
      .getByTestId('parametric-magma-legend-bar')
      .boundingBox())!;
    expect(Math.round(legendBarBox.width)).toBe(160);
    expect(Math.round(legendBarBox.height)).toBe(6);

    // Base wafer canvas painted magma pixels (non-empty warm/violet heatmap values across dies)
    const hasMagmaDies = await page.evaluate(() => {
      const canvas = document.querySelector<HTMLCanvasElement>(
        '[data-testid="wafer-base-canvas"]',
      );
      if (!canvas) return false;
      const ctx = canvas.getContext('2d');
      if (!ctx) return false;
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      let purpleOrWarm = 0;
      for (let i = 0; i < data.length; i += 4) {
        const r = data[i]!;
        const g = data[i + 1]!;
        const b = data[i + 2]!;
        const a = data[i + 3]!;
        // Magma t in [0.18, 1.0] spans deep purple (#3b0f70) through magenta/orange to pale yellow (#fcfdbf)
        if (a > 220 && (b > 75 || (r > 180 && g > 80))) {
          purpleOrWarm += 1;
        }
      }
      return purpleOrWarm > 200;
    });
    expect(hasMagmaDies).toBe(true);

    // Switching test in the catalog updates both the histogram and the wafer Parametric legend
    const vthRow = page.locator(
      '[data-testid="parametric-catalog-row"][data-test-num="410"]',
    );
    await vthRow.click();
    await expect(histogram).toHaveAttribute('data-test-num', '410');
    await expect(page.getByTestId('parametric-legend-max')).toContainText('mV');

    // Switching back to Pass/fail via stage segmented control exits Parametric mode cleanly
    await stageSegmented.getByRole('radio', { name: 'Pass/fail' }).click();
    await expect(mapToggle).toHaveAttribute('aria-pressed', 'false');
    await expect(magmaLegend).toBeHidden();

    // No horizontal overflow
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBe(1440);
  });

  test('respects prefers-reduced-motion with instant histogram transitions', async ({
    page,
  }) => {
    await loadDemoLot(page, 'handling-scratch', {
      reducedMotion: 'reduce',
      colorScheme: 'dark',
    });

    const panel = page.getByTestId('parametric-panel');
    await panel.scrollIntoViewIfNeeded();

    const histogram = page.getByTestId('parametric-histogram');
    await expect(histogram).toHaveAttribute('data-reduced-motion', 'true');

    const barTransition = await page
      .getByTestId('parametric-histogram-bar')
      .first()
      .evaluate((el) => {
        const cs = getComputedStyle(el);
        return {
          property: cs.transitionProperty,
          durationSeconds: Number.parseFloat(cs.transitionDuration),
        };
      });
    expect(barTransition.property).toBe('none');
    expect(barTransition.durationSeconds).toBeLessThanOrEqual(0.001);

    // Keyboard scrubbing works cleanly under reduced motion
    const svg = histogram.locator('svg[role="img"]');
    await svg.focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByTestId('parametric-scrub-readout')).toHaveAttribute(
      'data-scrubbing',
      'true',
    );
    await expect(page.getByTestId('parametric-scrub-rule')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('parametric-scrub-readout')).toHaveAttribute(
      'data-scrubbing',
      'false',
    );
  });
});
