import { expect, type Page, test } from '@playwright/test';

async function loadDemoLot(
  page: Page,
  presetId: 'edge-ring-etch' | 'site2-probe-contact' = 'edge-ring-etch',
): Promise<void> {
  await page.emulateMedia({
    colorScheme: 'light',
    reducedMotion: 'no-preference',
  });
  await page.addInitScript(() => {
    window.sessionStorage.setItem('cal.sweep.v1', '1');
    window.localStorage.removeItem('cal.palette.recents.v1');
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/?nohints=1');
  await page.getByTestId(`demo-card-${presetId}`).click();
  await expect(page.getByTestId('wafer-stage')).toHaveAttribute('data-sweep', 'done', {
    timeout: 10_000,
  });
  await expect(page.getByTestId('bin-pareto')).toBeAttached();
  await expect(page.getByTestId('parametric-panel')).toBeAttached();
  await expect(
    page.locator('[data-testid="bin-pareto-pill"] .count-up:not([data-settled="true"])'),
  ).toHaveCount(0);
}

test.describe('Task 17 - Filter DSL & Cmd-K / Ctrl-K Command Palette', () => {
  test('opens immediately (0 ms), runs DSL query with removable chips, tracks recents first, handles invalid query safely, and shows 0-die empty state', async ({
    page,
  }) => {
    await loadDemoLot(page, 'edge-ring-etch');

    const paretoRows = page.getByTestId('bin-pareto-rows');
    const paramCatalog = page.getByTestId('parametric-catalog');
    const paretoBefore = await paretoRows.innerText();
    const paramBefore = await paramCatalog.innerText();

    // 1. Pressing Control+k opens [data-testid="command-palette"] immediately (0 ms) with input focused
    const openT0 = await page.evaluate(() => performance.now());
    await page.keyboard.press('Control+k');
    const palette = page.getByTestId('command-palette');
    await expect(palette).toBeVisible();
    const openElapsedMs = await page.evaluate((t0) => performance.now() - t0, openT0);
    expect(openElapsedMs).toBeLessThan(150);

    const input = page.getByTestId('command-palette-input');
    await expect(input).toBeFocused();

    // Right-aligned <kbd> shortcuts are rendered and zero ember/orange colours appear in the palette
    await expect(palette.locator('kbd').first()).toBeVisible();
    const hasEmberColor = await palette.evaluate((root) => {
      const emberRgb = new Set([
        'rgb(255, 107, 44)',
        'rgb(232, 89, 30)',
        'rgb(217, 78, 20)',
        'rgb(255, 138, 87)',
      ]);
      const elements = [root, ...Array.from(root.querySelectorAll('*'))];
      for (const el of elements) {
        const cs = getComputedStyle(el);
        if (
          emberRgb.has(cs.color) ||
          emberRgb.has(cs.backgroundColor) ||
          emberRgb.has(cs.borderColor)
        ) {
          return true;
        }
      }
      return false;
    });
    expect(hasEmberColor).toBe(false);

    // 2. Typing "show edge failures with Cpk < 1.33" and pressing Enter updates all linked views and renders 3 removable chips
    await input.fill('show edge failures with Cpk < 1.33');
    await page.keyboard.press('Enter');
    await expect(palette).toHaveCount(0);

    const dslChips = page.getByTestId('dsl-filter-chip');
    await expect(dslChips).toHaveCount(3);
    await expect(page.getByTestId('active-filter-chips')).toContainText('Outer 3 rings');
    await expect(page.getByTestId('active-filter-chips')).toContainText('Failures');
    await expect(page.getByTestId('active-filter-chips')).toContainText('Cpk < 1.33');

    await expect.poll(() => paretoRows.innerText()).not.toBe(paretoBefore);
    await expect.poll(() => paramCatalog.innerText()).not.toBe(paramBefore);

    // Parametric panel auto-selected IDDQ_LEAK (test 204)
    const selectedParamRow = page.locator(
      '[data-testid="parametric-catalog-row"][data-selected="true"]',
    );
    await expect(selectedParamRow).toContainText('IDDQ_LEAK');

    const chipsSnapshotBeforeInvalid = await page
      .getByTestId('active-filter-chips')
      .innerText();
    const paretoSnapshotBeforeInvalid = await paretoRows.innerText();

    // 3. Reopening palette shows "show edge failures with Cpk < 1.33" under Recent queries first
    await page.keyboard.press('Control+k');
    await expect(palette).toBeVisible();
    const recentsGroup = page.getByTestId('palette-group-recents');
    await expect(recentsGroup).toBeVisible();
    await expect(recentsGroup.getByTestId('palette-recent-item').first()).toContainText(
      'show edge failures with Cpk < 1.33',
    );
    const groupOrder = await palette
      .locator('[role="group"]')
      .evaluateAll((nodes) => nodes.map((n) => n.getAttribute('data-testid')));
    expect(groupOrder[0]).toBe('palette-group-recents');

    // 4. Typing an invalid query "not a valid filter" and pressing Enter keeps selection unchanged & shows clickable examples
    await input.fill('not a valid filter');
    await page.keyboard.press('Enter');
    await expect(palette).toBeVisible();
    const parseError = page.getByTestId('palette-parse-error');
    await expect(parseError).toBeVisible();
    await expect(parseError.getByTestId('palette-error-example').first()).toBeVisible();
    expect(await page.getByTestId('active-filter-chips').innerText()).toBe(
      chipsSnapshotBeforeInvalid,
    );
    expect(await paretoRows.innerText()).toBe(paretoSnapshotBeforeInvalid);

    // 5. Submitting "only bin 99" (0 matching dies) renders inline no-results-empty-state; clicking "Clear the filter" restores full lot
    await input.fill('only bin 99');
    await page.keyboard.press('Enter');
    await expect(palette).toHaveCount(0);

    const noResults = page.getByTestId('no-results-empty-state');
    await expect(noResults).toBeVisible();
    const clearButton = page.getByTestId('no-results-clear-filters');
    const loadDemoButton = page.getByTestId('no-results-load-demo');
    await expect(clearButton).toBeVisible();
    await expect(clearButton).toHaveText('Clear the filter');
    await expect(loadDemoButton).toBeVisible();
    await expect(loadDemoButton).toHaveText('Open the sample lot');

    await clearButton.click();
    await expect(noResults).toHaveCount(0);
    await expect(page.getByTestId('dsl-filter-chip')).toHaveCount(0);
    await expect.poll(() => paretoRows.innerText()).toBe(paretoBefore);
  });
});
