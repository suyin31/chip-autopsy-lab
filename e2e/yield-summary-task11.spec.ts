import { expect, test } from '@playwright/test';

test.describe('Task 11 - yield summary and site scoping', () => {
  test('sits below the Pareto, flags site 2, and scopes the wafer map and Pareto by site and wafer', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    await page.getByTestId('demo-card-site2-probe-contact').click();

    const stage = page.getByTestId('wafer-stage');
    await expect(stage).toBeVisible({ timeout: 3_000 });
    await expect(stage).toHaveAttribute('data-sweep', 'done', { timeout: 5_000 });

    // The site anomaly is in the report
    await expect(
      page
        .getByTestId('autopsy-body-claim-button')
        .filter({ hasText: 'more often' }),
    ).toBeVisible();

    // The panel is below "Yield loss by bin" in the verdict column
    const panel = page.getByTestId('yield-summary');
    await expect(panel).toBeAttached();
    const paretoBox = (await page.getByTestId('bin-pareto').boundingBox())!;
    const panelBox = (await panel.boundingBox())!;
    expect(panelBox.y).toBeGreaterThanOrEqual(paretoBox.y + paretoBox.height);

    // Lot numbers, one row per site, only the lowest wafers until disclosed
    await expect(page.getByTestId('yield-lot-final')).toContainText('%');
    await expect(page.getByTestId('yield-lot-first-pass')).toContainText('%');
    await expect(page.getByTestId('yield-site-row')).toHaveCount(4);
    await expect(page.getByTestId('yield-wafer-row')).toHaveCount(5);

    // Site 1:2 is flagged in words; no other site is
    const anomalyRow = page.locator('[data-testid="yield-site-row"][data-anomaly="true"]');
    await expect(anomalyRow).toHaveCount(1);
    await expect(anomalyRow).toHaveAttribute('data-site-label', '1:2');
    await expect(anomalyRow).toContainText('Lower than the other sites');

    const overlay = page.getByTestId('wafer-overlay-wrapper');
    const paretoRows = page.getByTestId('bin-pareto-rows');
    await anomalyRow.scrollIntoViewIfNeeded();
    await expect(overlay).toHaveAttribute('data-highlight-count', '0');
    const paretoBefore = await paretoRows.innerText();

    // Clicking the site scopes the wafer map and the Pareto
    await anomalyRow.click();
    await expect(anomalyRow).toHaveAttribute('aria-pressed', 'true');
    await expect
      .poll(async () => Number(await overlay.getAttribute('data-highlight-count')))
      .toBeGreaterThan(0);
    const scopedCount = Number(await overlay.getAttribute('data-highlight-count'));
    const lotDies = 15_825;
    expect(scopedCount).toBeLessThan(lotDies / 2);
    expect(Number(await overlay.getAttribute('data-wafer-highlight-count'))).toBeGreaterThan(0);
    await expect.poll(() => paretoRows.innerText()).not.toBe(paretoBefore);

    // A second click clears the scope
    await anomalyRow.click();
    await expect(anomalyRow).toHaveAttribute('aria-pressed', 'false');
    await expect(overlay).toHaveAttribute('data-highlight-count', '0');
    await expect.poll(() => paretoRows.innerText()).toBe(paretoBefore);

    // Disclosing the wafer table shows every wafer; a wafer click scopes and shows that wafer
    const toggle = page.getByTestId('yield-wafers-toggle');
    await toggle.scrollIntoViewIfNeeded();
    await expect(toggle).toHaveText('Show all 25 wafers');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByTestId('yield-wafer-row')).toHaveCount(25);

    const waferRow = page.locator('[data-testid="yield-wafer-row"][data-wafer-index="12"]');
    await waferRow.scrollIntoViewIfNeeded();
    await waferRow.click();
    await expect(waferRow).toHaveAttribute('aria-pressed', 'true');
    await expect(
      page.locator('[role="option"][data-wafer-index="12"]'),
    ).toHaveAttribute('aria-selected', 'true');
    await expect.poll(() => paretoRows.innerText()).not.toBe(paretoBefore);

    // Site and wafer scopes combine, and Escape on the stage clears both
    await anomalyRow.click();
    await expect(anomalyRow).toHaveAttribute('aria-pressed', 'true');
    await stage.focus();
    await page.keyboard.press('Escape');
    await expect(anomalyRow).toHaveAttribute('aria-pressed', 'false');
    await expect(waferRow).toHaveAttribute('aria-pressed', 'false');
    await expect.poll(() => paretoRows.innerText()).toBe(paretoBefore);

    await toggle.click();
    await expect(page.getByTestId('yield-wafer-row')).toHaveCount(5);
  });
});
