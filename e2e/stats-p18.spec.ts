import { expect, type Page, test } from '@playwright/test';

/**
 * Premium P18 (premium.md §7.5): stat buttons light their evidence dies, captions use the plain
 * §2.2 copy with a second tertiary line, and numbers are never orange (A4).
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
  await expect(page.getByTestId('verdict-stat-row')).toBeVisible();
}

const TEXT_PRIMARY = { light: 'rgb(32, 30, 31)', dark: 'rgba(255, 255, 255, 0.92)' } as const;

for (const scheme of ['light', 'dark'] as const) {
  test.describe(`Premium P18 - stats (${scheme})`, () => {
    test.use({ colorScheme: scheme });

    test('A4: stat numbers compute to text-primary and nothing in the row is ember', async ({
      page,
    }) => {
      await loadDemo(page, 'edge-ring-etch');
      await page.waitForTimeout(900); // count-up settles

      const items = page.getByTestId('verdict-stat-item');
      await expect(items).toHaveCount(3);
      await expect(page.getByTestId('verdict-stat-value')).toHaveText(['93.8%', '82.8%', '2,721']);
      await expect(page.getByTestId('verdict-stat-caption')).toHaveText([
        'of failing dies are in the outer 3 rings',
        'final yield',
        'dies failed, of 15,825 tested',
      ]);
      await expect(page.getByTestId('verdict-stat-caption-secondary')).toHaveText([
        '81.5% on the first test',
      ]);

      const audit = await page.evaluate(() => {
        const row = document.querySelector<HTMLElement>('[data-testid="verdict-stat-row"]')!;
        const colors = new Set<string>();
        for (const el of Array.from(row.querySelectorAll<HTMLElement>('*'))) {
          const cs = getComputedStyle(el);
          colors.add(cs.color);
          colors.add(cs.backgroundColor);
        }
        const dds = Array.from(row.querySelectorAll<HTMLElement>('dd')).map((dd) => {
          const cs = getComputedStyle(dd);
          return { color: cs.color, weight: cs.fontWeight, numeric: cs.fontVariantNumeric };
        });
        const secondary = document.querySelector<HTMLElement>(
          '[data-testid="verdict-stat-caption-secondary"]',
        )!;
        const item = document.querySelector<HTMLElement>('[data-testid="verdict-stat-item"]')!;
        const button = item.querySelector<HTMLElement>('[data-testid="verdict-stat-button"]')!;
        const ir = item.getBoundingClientRect();
        const br = button.getBoundingClientRect();
        return {
          colors: Array.from(colors),
          dds,
          secondaryColor: getComputedStyle(secondary).color,
          radius: getComputedStyle(button).borderTopLeftRadius,
          inset: {
            left: Math.round(ir.left - br.left),
            top: Math.round(ir.top - br.top),
            right: Math.round(br.right - ir.right),
            bottom: Math.round(br.bottom - ir.bottom),
          },
        };
      });

      for (const dd of audit.dds) {
        expect(dd.color).toBe(TEXT_PRIMARY[scheme]);
        expect(dd.weight).toBe('300');
        expect(dd.numeric).toContain('tabular-nums');
      }
      const emberLike = /rgb\(255, 107, 44\)|rgb\(232, 89, 30\)|rgb\(217, 78, 20\)|rgb\(255, 138, 87\)/;
      for (const c of audit.colors) {
        expect(c).not.toMatch(emberLike);
      }
      expect(audit.secondaryColor).toBe(
        scheme === 'light' ? 'rgb(109, 105, 99)' : 'rgba(255, 255, 255, 0.56)',
      );
      expect(audit.radius).toBe('16px');
      expect(audit.inset).toEqual({ left: 12, top: 12, right: 12, bottom: 12 });
    });
  });
}

test.describe('Premium P18 - stat evidence', () => {
  test.use({ colorScheme: 'light' });

  test('clicking a stat lights its dies, shows it selected, and a second click clears', async ({
    page,
  }) => {
    await loadDemo(page, 'edge-ring-etch');
    const overlay = page.getByTestId('wafer-overlay-wrapper');
    await expect(overlay).toHaveAttribute('data-highlight-count', '0');

    const buttons = page.getByTestId('verdict-stat-button');
    const edge = buttons.nth(0);
    const failing = buttons.nth(2);

    // Hover: fill-1 and caption text-primary
    await edge.hover();
    await expect
      .poll(() => edge.evaluate((el) => getComputedStyle(el).backgroundColor))
      .toBe('rgb(239, 235, 228)');
    await expect
      .poll(() =>
        page
          .getByTestId('verdict-stat-caption')
          .nth(0)
          .evaluate((el) => getComputedStyle(el).color),
      )
      .toBe('rgb(32, 30, 31)');

    await edge.click();
    await expect(edge).toHaveAttribute('aria-pressed', 'true');
    await expect(edge).toHaveAttribute('data-ack', /\d/);
    const edgeCount = Number(await overlay.getAttribute('data-highlight-count'));
    expect(edgeCount).toBeGreaterThan(0);
    await expect(overlay).toHaveAttribute('data-interior-highlight-count', '0');

    // Another stat takes over the lit evidence
    await failing.click();
    await expect(failing).toHaveAttribute('aria-pressed', 'true');
    await expect(edge).toHaveAttribute('aria-pressed', 'false');
    await expect(overlay).toHaveAttribute('data-highlight-count', '2721');

    await page.mouse.move(0, 0);
    await expect
      .poll(() => failing.evaluate((el) => getComputedStyle(el).backgroundColor))
      .toBe('rgb(230, 225, 216)');

    await failing.click();
    await expect(failing).toHaveAttribute('aria-pressed', 'false');
    await expect(overlay).toHaveAttribute('data-highlight-count', '0');

    // Keyboard: the button is reachable and toggles with Enter
    await edge.focus();
    await page.keyboard.press('Enter');
    await expect(edge).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press('Escape');
    await expect(edge).toHaveAttribute('aria-pressed', 'false');
  });
});
