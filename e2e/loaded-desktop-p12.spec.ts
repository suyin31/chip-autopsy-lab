import { expect, type Page, test } from '@playwright/test';

/**
 * Premium P12 (premium.md §6.2): loaded verdict view at 1440 x 900 and 1280 x 800.
 * A15: blocks 1-6 above the fold, disc 596 +/- 2. A16: blocks 1-5 and the top of block 6
 * above the fold, disc 496 +/- 2. A19: the stage column stays sticky while the page scrolls to
 * "Yield by test site and wafer", and a site row lights dies on the visible wafer.
 */

async function loadDemo(page: Page, width: number, height: number, presetId: string) {
  await page.addInitScript(() => {
    window.sessionStorage.setItem('cal.sweep.v1', '1');
  });
  await page.setViewportSize({ width, height });
  await page.goto('/');
  await page.getByTestId(`demo-card-${presetId}`).click();
  await expect(page.getByTestId('wafer-stage')).toHaveAttribute('data-sweep', 'done', {
    timeout: 5_000,
  });
  await expect(page.getByTestId('verdict-headline')).toBeVisible();
  await expect(page.getByTestId('autopsy-hypotheses-toggle')).toBeVisible();
}

async function measure(page: Page) {
  return page.evaluate(() => {
    const rect = (testId: string) => {
      const el = document.querySelector<HTMLElement>(`[data-testid="${testId}"]`);
      if (!el) throw new Error(`missing ${testId}`);
      const r = el.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom, left: r.left, width: r.width, height: r.height };
    };
    const stage = document.querySelector<HTMLElement>('[data-testid="wafer-stage"]')!;
    return {
      headline: rect('verdict-headline'),
      subline: rect('verdict-subline'),
      stats: rect('verdict-stat-row'),
      findings: rect('verdict-findings-list'),
      causes: rect('possible-causes-block'),
      verdictColumn: rect('autopsy-report-card'),
      stageColumn: rect('stage-column'),
      sheen: rect('wafer-stage-sheen'),
      diameterAttr: Number(stage.dataset.waferDiameterPx),
      statSize: Number.parseFloat(
        getComputedStyle(document.querySelector<HTMLElement>('.type-stat')!).fontSize,
      ),
      stageColumnPosition: getComputedStyle(
        document.querySelector<HTMLElement>('[data-testid="stage-column"]')!,
      ).position,
    };
  });
}

test.describe('Premium P12 - loaded view, desktop', () => {
  test('A15: 1440 x 900 shows blocks 1-6 above the fold with a 596 px disc', async ({ page }) => {
    await loadDemo(page, 1440, 900, 'edge-ring-etch');
    const m = await measure(page);

    // Grid: stage x 40..823, verdict x 847..1400
    expect(Math.round(m.stageColumn.left)).toBe(40);
    expect(Math.round(m.stageColumn.width)).toBe(783);
    expect(Math.round(m.verdictColumn.left)).toBe(847);
    expect(Math.round(m.verdictColumn.width)).toBe(553);
    expect(m.stageColumnPosition).toBe('sticky');

    // Column padding-top 84 below the 52 px nav
    expect(Math.round(m.headline.top)).toBe(136);
    expect(Math.round(m.subline.top - m.headline.bottom)).toBe(16);
    expect(m.causes.bottom).toBeLessThanOrEqual(900);
    expect(Math.round(m.causes.top - m.findings.bottom)).toBe(16);

    expect(Math.abs(m.diameterAttr - 596)).toBeLessThanOrEqual(2);
    expect(Math.abs(m.sheen.width - 596)).toBeLessThanOrEqual(2);
    expect(m.statSize).toBe(40);
  });

  test('A16: 1280 x 800 shows blocks 1-5 and the top of block 6 with a 496 px disc', async ({
    page,
  }) => {
    await loadDemo(page, 1280, 800, 'edge-ring-etch');
    const m = await measure(page);

    expect(Math.round(m.stageColumn.width)).toBe(690);
    expect(Math.round(m.verdictColumn.width)).toBe(486);
    expect(Math.round(m.headline.top)).toBe(52 + 72);
    expect(m.findings.bottom).toBeLessThanOrEqual(800);
    expect(m.causes.top).toBeLessThan(800);

    expect(Math.abs(m.diameterAttr - 496)).toBeLessThanOrEqual(2);
    expect(Math.abs(m.sheen.width - 496)).toBeLessThanOrEqual(2);
    expect(m.statSize).toBe(36);
  });

  test('A19: the stage stays visible at "Yield by test site and wafer" and a site row lights dies', async ({
    page,
  }) => {
    await loadDemo(page, 1440, 900, 'site2-probe-contact');
    const anomalyRow = page.locator('[data-testid="yield-site-row"][data-anomaly="true"]');
    await page.getByTestId('yield-summary').scrollIntoViewIfNeeded();
    await anomalyRow.scrollIntoViewIfNeeded();
    expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(200);

    const stage = await page.evaluate(() => {
      const r = document
        .querySelector<HTMLElement>('[data-testid="wafer-stage"]')!
        .getBoundingClientRect();
      return { top: r.top, bottom: r.bottom };
    });
    expect(stage.top).toBeGreaterThanOrEqual(52);
    expect(stage.bottom).toBeLessThanOrEqual(900);

    const overlay = page.getByTestId('wafer-overlay-wrapper');
    await expect(overlay).toHaveAttribute('data-highlight-count', '0');
    await anomalyRow.click();
    await expect
      .poll(async () => Number(await overlay.getAttribute('data-wafer-highlight-count')))
      .toBeGreaterThan(0);

    // The page did not move the stage out of view
    const after = await page.evaluate(() => {
      const r = document
        .querySelector<HTMLElement>('[data-testid="wafer-stage"]')!
        .getBoundingClientRect();
      return { top: r.top, bottom: r.bottom };
    });
    expect(after.top).toBeGreaterThanOrEqual(52);
    expect(after.bottom).toBeLessThanOrEqual(900);
  });
});
