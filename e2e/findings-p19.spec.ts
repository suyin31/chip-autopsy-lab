import { expect, type Page, test } from '@playwright/test';

/**
 * Premium P19 (premium.md §7.6, §9.3): the findings card with one-line plain headlines and
 * one-line sub-lines, the expanded body aligned to the headline, and Possible causes (A27).
 */

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
  await expect(page.getByTestId('verdict-findings-list')).toBeVisible();
}

for (const scheme of ['light', 'dark'] as const) {
  test.describe(`Premium P19 - findings (${scheme})`, () => {
    test.use({ colorScheme: scheme });

    test('A27: one-line headline and sub-line per row; expanded body aligns to the headline', async ({
      page,
    }) => {
      await loadDemo(page, 'edge-ring-etch');
      await page.waitForTimeout(700); // verdict rise-in settles

      await expect(page.getByTestId('findings-count')).toHaveText('3');
      await expect(page.getByTestId('finding-row-headline')).toHaveText([
        'Failures concentrate in the outer 3 rings',
        /^One failure type causes 9\d\.\d% of the loss$/,
        'Leakage test IDDQ_LEAK is far off target',
      ]);
      await expect(page.getByTestId('finding-row-subline').nth(1)).toHaveText(
        /^SBIN 7 IDDQ_EDGE_LEAK, [\d,]+ dies$/,
      );
      await expect(page.getByTestId('finding-row-subline').nth(2)).toHaveText(
        /^Cpk 0\.14, mean 10\.22 uA, limits 0\.20 to 15\.00 uA$/,
      );

      const rows = await page.evaluate(() => {
        const lineCount = (el: HTMLElement) =>
          Math.round(el.getBoundingClientRect().height / parseFloat(getComputedStyle(el).lineHeight));
        const card = document.querySelector<HTMLElement>('[data-testid="verdict-findings-list"]')!;
        const cardCs = getComputedStyle(card);
        return {
          card: {
            radius: cardCs.borderTopLeftRadius,
            padding: cardCs.paddingTop,
            shadow: cardCs.boxShadow,
          },
          rows: Array.from(
            document.querySelectorAll<HTMLElement>('[data-testid="autopsy-body-claim-button"]'),
          ).map((button) => {
            const headline = button.querySelector<HTMLElement>('[data-testid="finding-row-headline"]')!;
            const sub = button.querySelector<HTMLElement>('[data-testid="finding-row-subline"]')!;
            const icon = button.querySelector<SVGElement>('[data-testid="finding-kind-icon"]')!;
            return {
              height: button.getBoundingClientRect().height,
              radius: getComputedStyle(button).borderTopLeftRadius,
              headlineLines: lineCount(headline),
              subLines: lineCount(sub),
              iconSize: icon.getBoundingClientRect().width,
            };
          }),
        };
      });
      expect(rows.card.radius).toBe('20px');
      expect(rows.card.padding).toBe('4px');
      expect(rows.card.shadow).not.toBe('none');
      expect(rows.rows).toHaveLength(3);
      for (const row of rows.rows) {
        expect(row.headlineLines).toBe(1);
        expect(row.subLines).toBe(1);
        expect(row.height).toBeGreaterThanOrEqual(64);
        expect(row.radius).toBe('16px');
        expect(row.iconSize).toBe(16);
      }

      // Expand the primary finding
      const first = page.getByTestId('autopsy-body-claim-button').first();
      await first.click();
      await expect(first).toHaveAttribute('aria-expanded', 'true');
      await expect(page.getByTestId('finding-clear-label')).toHaveText('Clear');
      const detail = page.getByTestId('finding-expanded-detail');
      await expect(detail).toBeVisible();
      await expect(page.getByTestId('finding-engine-sentence')).toContainText('2,552 of 2,721');
      await expect(page.getByTestId('finding-check-next')).toContainText('Check next');
      await expect(page.getByTestId('finding-check-next').locator('li')).toHaveCount(3);
      await expect(page.getByTestId('finding-meta')).toHaveText(
        /^[\d,]+ on this wafer, 2,552 on all 25 wafers$/,
      );

      const align = await page.evaluate(() => {
        const headline = document.querySelector<HTMLElement>('[data-testid="finding-row-headline"]')!;
        const left = headline.getBoundingClientRect().left;
        const parts = ['finding-engine-sentence', 'finding-check-next', 'finding-meta'].map(
          (id) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`)!.getBoundingClientRect().left,
        );
        return { left, parts };
      });
      for (const partLeft of align.parts) {
        expect(Math.abs(partLeft - align.left)).toBeLessThanOrEqual(0.5);
      }

      await first.click();
      await expect(first).toHaveAttribute('aria-expanded', 'false');
      await expect(detail).toHaveCount(0);
    });

    test('§7.6.5: Possible causes opens with the note, links to finding 1, and stays open for the lot', async ({
      page,
    }) => {
      await loadDemo(page, 'edge-ring-etch');
      const toggle = page.getByTestId('autopsy-hypotheses-toggle');
      await expect(toggle).toHaveAttribute('aria-expanded', 'false');
      const box = await toggle.boundingBox();
      expect(Math.round(box!.height)).toBe(48);
      await expect(page.getByTestId('possible-causes-count')).toHaveText('3');

      await toggle.click();
      await expect(toggle).toHaveAttribute('aria-expanded', 'true');
      await expect(page.getByTestId('possible-causes-note')).toHaveText(
        'These are likely explanations, not proof. Confirm them in the tool logs.',
      );
      await expect(page.getByTestId('hypothesis-item')).toHaveCount(3);

      await page.getByTestId('hypothesis-based-on').first().click();
      await expect(page.getByTestId('autopsy-body-claim-button').first()).toHaveAttribute(
        'aria-pressed',
        'true',
      );

      // Opening the same lot again in this session keeps its causes open
      await page.goto('/?nohints=1');
      await page.getByTestId('demo-card-edge-ring-etch').click();
      await expect(page.getByTestId('verdict-findings-list')).toBeVisible({ timeout: 10_000 });
      await expect(page.getByTestId('autopsy-hypotheses-toggle')).toHaveAttribute(
        'aria-expanded',
        'true',
      );
    });
  });
}
