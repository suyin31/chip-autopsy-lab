import { expect, type Page, test } from '@playwright/test';

/**
 * Premium P13 (premium.md §6.2): loaded view at md, sm, and xs.
 * A17: 1024 x 768 has no horizontal scroll, the legend sits on its own line under the segmented
 * control, and the verdict is at most 3 lines. A18: at 390 x 844 the verdict, takeaway, action row,
 * full disc, control row, and strip sit above the fold, and scrollWidth is 390.
 */

async function loadDemo(page: Page, width: number, height: number) {
  await page.addInitScript(() => {
    window.sessionStorage.setItem('cal.sweep.v1', '1');
  });
  await page.setViewportSize({ width, height });
  await page.goto('/');
  await page.getByTestId('demo-card-edge-ring-etch').click();
  await expect(page.getByTestId('wafer-stage')).toHaveAttribute('data-sweep', 'done', {
    timeout: 5_000,
  });
  await expect(page.getByTestId('verdict-headline')).toBeVisible();
}

async function measure(page: Page) {
  return page.evaluate(() => {
    const rect = (selector: string) => {
      const el = document.querySelector<HTMLElement>(selector);
      if (!el) throw new Error(`missing ${selector}`);
      const r = el.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, width: r.width };
    };
    const tid = (id: string) => rect(`[data-testid="${id}"]`);
    const headline = document.querySelector<HTMLElement>('[data-testid="verdict-headline"]')!;
    const style = getComputedStyle(headline);
    return {
      headline: tid('verdict-headline'),
      headlineLines: Math.round(headline.getBoundingClientRect().height / Number.parseFloat(style.lineHeight)),
      subline: tid('verdict-subline'),
      action: tid('confidence-pill'),
      stageHeader: tid('stage-header'),
      stage: tid('wafer-stage'),
      sheen: tid('wafer-stage-sheen'),
      segmented: tid('stage-mode-segmented'),
      selectArea: tid('stage-select-area'),
      legend: tid('stage-legend'),
      strip: tid('wafer-strip'),
      stats: tid('verdict-stat-row'),
      findings: tid('verdict-findings-list'),
      stageColumn: tid('stage-column'),
      verdictColumn: tid('autopsy-report-card'),
      diameter: Number(document.querySelector<HTMLElement>('[data-testid="wafer-stage"]')!.dataset.waferDiameterPx),
      scrollWidth: document.documentElement.scrollWidth,
    };
  });
}

test.describe('Premium P13 - loaded view, tablet and mobile', () => {
  test('A17: 1024 x 768 two columns, legend on its own line, verdict <= 3 lines', async ({ page }) => {
    await loadDemo(page, 1024, 768);
    const m = await measure(page);

    expect(m.scrollWidth).toBe(1024);
    // Margins 32, stage 540, gutter 20, verdict column 400
    expect(Math.round(m.stageColumn.left)).toBe(32);
    expect(Math.round(m.stageColumn.width)).toBe(540);
    expect(Math.round(m.verdictColumn.left)).toBe(592);
    expect(Math.round(m.verdictColumn.width)).toBe(400);

    expect(m.legend.top).toBeGreaterThanOrEqual(m.segmented.bottom);
    expect(m.headlineLines).toBeLessThanOrEqual(3);
    // Fold shows blocks 1-4 and the first finding row
    expect(m.stats.bottom).toBeLessThanOrEqual(768);
    expect(m.findings.top + 64).toBeLessThanOrEqual(768);
    expect(Math.abs(m.sheen.width - m.diameter)).toBeLessThanOrEqual(2);
  });

  test('sm 800 x 1000: one centred 640 column, stage between action row and stats, D = 560', async ({
    page,
  }) => {
    await loadDemo(page, 800, 1000);
    const m = await measure(page);

    expect(m.scrollWidth).toBe(800);
    expect(Math.round(m.headline.left)).toBe(80);
    expect(Math.round(m.stage.width)).toBe(640);
    expect(m.diameter).toBe(560);
    expect(m.action.bottom).toBeLessThan(m.stageHeader.top);
    expect(m.strip.bottom).toBeLessThan(m.stats.top);
    expect(m.stats.bottom).toBeLessThan(m.findings.top);
    const position = await page
      .getByTestId('stage-column')
      .evaluate((el) => getComputedStyle(el).position);
    expect(position).not.toBe('sticky');
  });

  test('A18: 390 x 844 keeps verdict, action, full disc, controls, and strip above the fold', async ({
    page,
  }) => {
    await loadDemo(page, 390, 844);
    const m = await measure(page);

    expect(m.scrollWidth).toBe(390);
    // Full-bleed 390 x 390 stage, D = 350
    expect(Math.round(m.stage.left)).toBe(0);
    expect(Math.round(m.stage.width)).toBe(390);
    expect(Math.abs(m.sheen.width - 350)).toBeLessThanOrEqual(2);

    expect(m.subline.bottom).toBeLessThan(m.action.top);
    expect(m.action.bottom).toBeLessThan(m.stageHeader.top);
    expect(m.stage.bottom).toBeLessThanOrEqual(844);
    expect(m.segmented.bottom).toBeLessThanOrEqual(844);
    expect(m.selectArea.bottom).toBeLessThanOrEqual(844);
    expect(m.strip.top).toBeGreaterThanOrEqual(m.segmented.bottom);
    expect(m.strip.bottom).toBeLessThanOrEqual(844);
    // The legend line sits under the strip, then the stats
    expect(m.legend.top).toBeGreaterThanOrEqual(m.strip.bottom);
    expect(m.stats.top).toBeGreaterThan(m.legend.bottom);
  });

  test('390 x 844: a finding click scrolls the stage top to 8 px under the nav', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await loadDemo(page, 390, 844);
    const finding = page.getByTestId('autopsy-body-claim-button').first();
    await finding.scrollIntoViewIfNeeded();
    await finding.click();
    await expect
      .poll(async () =>
        Math.round(
          await page.getByTestId('wafer-stage').evaluate((el) => el.getBoundingClientRect().top),
        ),
      )
      .toBe(48 + 8);
  });

  test('1024 x 768: a finding click does not scroll the page', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await loadDemo(page, 1024, 768);
    const before = await page.evaluate(() => window.scrollY);
    await page.getByTestId('autopsy-body-claim-button').first().click();
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => window.scrollY)).toBe(before);
  });
});
