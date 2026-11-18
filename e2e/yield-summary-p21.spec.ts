import { expect, type Page, test } from '@playwright/test';

/**
 * Premium P21 (premium.md §7.10): "Yield by test site and wafer" section card with a takeaway,
 * 3 lot numbers, a test-site table, the 5 lowest-yield wafers, and a grey "Lowest yield" note on
 * the flagged site (A33). Below 400 px the Retests column hides.
 */

async function loadDemo(page: Page, presetId: string, width = 1440, height = 900) {
  await page.addInitScript(() => {
    window.sessionStorage.setItem('cal.sweep.v1', '1');
  });
  await page.setViewportSize({ width, height });
  await page.goto('/?nohints=1');
  await page.getByTestId(`demo-card-${presetId}`).click();
  await expect(page.getByTestId('wafer-stage')).toHaveAttribute('data-sweep', 'done', {
    timeout: 5_000,
  });
  await expect(page.getByTestId('yield-summary')).toBeAttached();
}

/** Every text colour in the subtree is neutral grey (channels within 12 of each other). */
function readColours(page: Page, selector: string) {
  return page.evaluate((sel) => {
    const root = document.querySelector<HTMLElement>(sel)!;
    const out: string[] = [];
    for (const el of [root, ...root.querySelectorAll<HTMLElement>('*')]) {
      out.push(getComputedStyle(el).color);
    }
    return out;
  }, selector);
}

function isNeutral(colour: string): boolean {
  const m = colour.match(/[\d.]+/g);
  if (!m) return false;
  const [r, g, b] = m.slice(0, 3).map(Number) as [number, number, number];
  return Math.max(r, g, b) - Math.min(r, g, b) <= 12;
}

for (const scheme of ['light', 'dark'] as const) {
  test.describe(`Premium P21 - yield by test site and wafer (${scheme})`, () => {
    test.use({ colorScheme: scheme });

    test('A33: section card, lot numbers, site table, lowest wafers, grey anomaly', async ({
      page,
    }) => {
      await loadDemo(page, 'site2-probe-contact');
      const section = page.getByTestId('yield-summary');
      await section.scrollIntoViewIfNeeded();

      await expect(section.getByRole('heading', { level: 2 })).toHaveText(
        'Yield by test site and wafer',
      );
      await expect(page.getByTestId('yield-takeaway')).toHaveText(
        /^Site 1:2 yields \d+\.\d%, \d+\.\d points below the other sites\.$/,
      );
      const card = await section.evaluate((el) => {
        const cs = getComputedStyle(el);
        return { radius: cs.borderTopLeftRadius, padding: cs.paddingTop, shadow: cs.boxShadow };
      });
      expect(card.radius).toBe('24px');
      expect(card.padding).toBe('24px');
      if (scheme === 'light') expect(card.shadow).not.toBe('none');

      // 3 lot numbers with captions, not buttons
      const stats = page.getByTestId('yield-lot-stats');
      await expect(stats.locator('dd')).toHaveCount(3);
      await expect(stats.locator('button')).toHaveCount(0);
      await expect(stats).toContainText('final yield');
      await expect(stats).toContainText('on the first test');
      await expect(stats).toContainText('retests');
      expect(
        await page.getByTestId('yield-lot-final').evaluate((el) => getComputedStyle(el).fontWeight),
      ).toBe('300');

      // Test-site table and the 5 lowest-yield wafers
      const sites = page.getByTestId('yield-sites');
      await expect(sites.getByRole('heading', { level: 3 })).toHaveText('Test sites');
      await expect(page.getByTestId('yield-site-row')).toHaveCount(4);
      await expect(page.getByTestId('yield-wafers').getByRole('heading', { level: 3 })).toHaveText(
        'Wafers',
      );
      await expect(page.getByTestId('yield-wafer-row')).toHaveCount(5);
      await expect(page.getByTestId('yield-wafers-toggle')).toHaveText('Show all 25 wafers');

      // Rows: 44 px, r-md, grid with 4 columns
      const row = page.getByTestId('yield-site-row').first();
      const rowStyle = await row.evaluate((el) => {
        const cs = getComputedStyle(el);
        return {
          height: el.getBoundingClientRect().height,
          radius: cs.borderTopLeftRadius,
          columns: cs.gridTemplateColumns.split(' ').length,
        };
      });
      expect(rowStyle.height).toBe(44);
      expect(rowStyle.radius).toBe('12px');
      expect(rowStyle.columns).toBe(4);

      // Site 1:2 reads "Lowest yield" in words, with no orange or red
      const anomalyRow = page.locator('[data-testid="yield-site-row"][data-anomaly="true"]');
      await expect(anomalyRow).toHaveCount(1);
      await expect(anomalyRow).toHaveAttribute('data-site-label', '1:2');
      await expect(page.getByTestId('yield-site-anomaly')).toHaveText('Lowest yield');
      await expect(page.getByTestId('yield-site-anomaly').locator('svg')).toHaveCount(1);
      for (const colour of await readColours(page, '[data-testid="yield-summary"]')) {
        expect(isNeutral(colour), colour).toBe(true);
      }

      // Selecting a site: fill-2 and a 590 final value
      await anomalyRow.click();
      await expect(anomalyRow).toHaveAttribute('aria-pressed', 'true');
      const finalWeight = await anomalyRow
        .locator('span.tabular-nums')
        .nth(1)
        .evaluate((el) => getComputedStyle(el).fontWeight);
      expect(finalWeight).toBe('590');
      await anomalyRow.click();
      await expect(anomalyRow).toHaveAttribute('aria-pressed', 'false');
    });
  });
}

test('narrow viewport hides the Retests column', async ({ page }) => {
  await loadDemo(page, 'site2-probe-contact', 390, 844);
  const section = page.getByTestId('yield-summary');
  await section.scrollIntoViewIfNeeded();
  const padding = await section.evaluate((el) => getComputedStyle(el).paddingTop);
  expect(padding).toBe('16px');
  const row = page.getByTestId('yield-site-row').first();
  expect(
    await row.evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(' ').length),
  ).toBe(3);
  const retestHeaders = section.getByText('Retests', { exact: true });
  await expect(retestHeaders).toHaveCount(2);
  for (let i = 0; i < 2; i += 1) await expect(retestHeaders.nth(i)).toBeHidden();
  await expect(section.getByText('First test', { exact: true }).first()).toBeVisible();

  // No horizontal overflow inside the card
  const overflow = await section.evaluate((el) => el.scrollWidth - el.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
