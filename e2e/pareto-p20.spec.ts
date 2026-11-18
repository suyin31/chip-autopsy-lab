import { expect, type Page, test } from '@playwright/test';

/**
 * Premium P20 (premium.md §7.9, §11.3): "Where the yield went" section card with one solid
 * ember bar, ghosted neutral bars, store-linked selected rows, and share-of-fails pills (A32, A43).
 */

const EMBER_FAMILY = new Set([
  'rgb(255, 107, 44)',
  'rgb(232, 89, 30)',
  'rgb(217, 78, 20)',
  'rgb(255, 138, 87)',
]);

async function loadDemo(page: Page, presetId: string) {
  await page.addInitScript(() => {
    window.sessionStorage.setItem('cal.sweep.v1', '1');
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/?nohints=1');
  await page.getByTestId(`demo-card-${presetId}`).click();
  await expect(page.getByTestId('wafer-stage')).toHaveAttribute('data-sweep', 'done', {
    timeout: 5_000,
  });
  await expect(page.getByTestId('bin-pareto-rows')).toBeAttached();
}

function readBars(page: Page) {
  return page.evaluate(() =>
    Array.from(
      document.querySelectorAll<HTMLElement>('[data-testid="bin-pareto-bar"]'),
    ).map((bar) => {
      const cs = getComputedStyle(bar);
      return {
        tone: bar.dataset.barTone,
        bg: cs.backgroundColor,
        border: cs.borderTopWidth,
        height: bar.getBoundingClientRect().height,
        radius: cs.borderTopLeftRadius,
      };
    }),
  );
}

for (const scheme of ['light', 'dark'] as const) {
  test.describe(`Premium P20 - where the yield went (${scheme})`, () => {
    test.use({ colorScheme: scheme });

    test('A32 + A43: one solid ember bar, neutral rest, no axis, linked selected row', async ({
      page,
    }) => {
      await loadDemo(page, 'edge-ring-etch');
      const section = page.getByTestId('bin-pareto');
      await section.scrollIntoViewIfNeeded();

      // Section card and copy
      await expect(section.getByRole('heading', { level: 2 })).toHaveText(
        'Where the yield went',
      );
      await expect(page.getByTestId('bin-pareto-takeaway')).toHaveText(
        /^One bin holds \d+(\.\d)?% of the lost dies\.$/,
      );
      await expect(section).toContainText('Yield loss by bin');
      await expect(section).toContainText('Share of all dies');
      const card = await section.evaluate((el) => {
        const cs = getComputedStyle(el);
        return { radius: cs.borderTopLeftRadius, padding: cs.paddingTop, shadow: cs.boxShadow };
      });
      expect(card.radius).toBe('24px');
      expect(card.padding).toBe('24px');
      if (scheme === 'light') expect(card.shadow).not.toBe('none');

      // No gridlines, axis lines, or SVG chart chrome
      expect(await section.locator('svg line, svg path, svg rect').count()).toBe(0);

      // A43: exactly one solid ember bar at rest; the rest are neutral grey with an outline
      const rows = page.getByTestId('bin-pareto-row');
      const rowCount = await rows.count();
      expect(rowCount).toBeGreaterThan(1);
      expect(rowCount).toBeLessThanOrEqual(6);
      const bars = await readBars(page);
      const ember = bars.filter((b) => EMBER_FAMILY.has(b.bg));
      expect(ember).toHaveLength(1);
      expect(bars[0]!.tone).toBe('dominant');
      for (const bar of bars.slice(1)) {
        expect(bar.tone).toBe('neutral');
        expect(bar.border).toBe('1px');
      }
      for (const bar of bars) {
        expect(bar.height).toBe(8);
        expect(bar.radius).toBe('4px');
      }

      // Each row: 40 px high, ends with a share-of-fails pill
      const rowBox = (await rows.first().boundingBox())!;
      expect(Math.round(rowBox.height)).toBe(40);
      await expect(page.getByTestId('bin-pareto-pill')).toHaveCount(rowCount);
      await expect(rows.first()).toContainText('SBIN 7');

      const fill2 = await page.evaluate(() =>
        getComputedStyle(document.documentElement).getPropertyValue('--fill-2').trim(),
      );
      const fill2Rgb = await page.evaluate((value) => {
        const probe = document.createElement('div');
        probe.style.backgroundColor = value;
        document.body.appendChild(probe);
        const rgb = getComputedStyle(probe).backgroundColor;
        probe.remove();
        return rgb;
      }, fill2);

      // A32: the Edge-Ring finding selects the matching row with fill-2
      const edgeFinding = page
        .getByTestId('autopsy-body-claim-button')
        .filter({ hasText: 'Failures concentrate in the outer 3 rings' });
      await edgeFinding.click();
      await expect(edgeFinding).toHaveAttribute('aria-pressed', 'true');
      await expect(rows.first()).toHaveAttribute('aria-pressed', 'true');
      await expect
        .poll(() => rows.first().evaluate((el) => getComputedStyle(el).backgroundColor))
        .toBe(fill2Rgb);
      // The dominant bar stays ember when selected
      expect((await readBars(page))[0]!.tone).toBe('dominant');
      await edgeFinding.click();
      await expect(rows.first()).toHaveAttribute('aria-pressed', 'false');

      // Selecting a non-dominant row turns its bar solid ink
      const second = rows.nth(1);
      await second.click();
      await expect(second).toHaveAttribute('aria-pressed', 'true');
      expect((await readBars(page))[1]!.tone).toBe('selected');
      // The bar colour cross-fades over dur-1
      await expect
        .poll(async () => (await readBars(page))[1]!.bg)
        .toBe(scheme === 'light' ? 'rgb(32, 30, 31)' : 'rgba(255, 255, 255, 0.92)');
      expect((await readBars(page)).filter((b) => EMBER_FAMILY.has(b.bg))).toHaveLength(1);
      await second.click();
      await expect(second).toHaveAttribute('aria-pressed', 'false');
    });
  });
}
