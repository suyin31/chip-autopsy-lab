import { expect, type Page, test } from '@playwright/test';

/**
 * Premium P24 (premium.md §2.2, §2.3, §7.17): glossary Terms on level-0 labels (A21) and the
 * Cpk definition popover in an expanded finding (A22).
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
  await page.waitForTimeout(700); // verdict rise-in settles
}

const decoration = (page: Page, selector: string) =>
  page.locator(selector).first().evaluate((el) => {
    const cs = getComputedStyle(el);
    return { line: cs.textDecorationLine, style: cs.textDecorationStyle };
  });

for (const scheme of ['light', 'dark'] as const) {
  test.describe(`Premium P24 - glossary terms (${scheme})`, () => {
    test.use({ colorScheme: scheme });

    test('A21: Hard bins, Soft bins, yield, and Confidence carry the dotted Term underline', async ({
      page,
    }) => {
      await loadDemo(page, 'edge-ring-etch');

      const dotted = { line: 'underline', style: 'dotted' };
      await expect(page.locator('[data-term-id="hardBin"]')).toHaveText('Hard bins');
      await expect(page.locator('[data-term-id="softBin"]')).toHaveText('Soft bins');
      expect(await decoration(page, '[data-term-id="hardBin"]')).toEqual(dotted);
      expect(await decoration(page, '[data-term-id="softBin"]')).toEqual(dotted);
      const takeawayTerm = page.locator('[data-testid="verdict-subline"] [data-term-id="yield"]');
      await expect(takeawayTerm).toHaveText('yield');
      expect(await decoration(page, '[data-testid="verdict-subline"] [data-term-id="yield"]')).toEqual(dotted);
      await expect(page.getByTestId('confidence-term')).toHaveText('confidence');
      expect(await decoration(page, '[data-testid="confidence-term"]')).toEqual(dotted);
      await expect(page.getByTestId('verdict-subline')).toHaveText(/Final yield is 8\d\.\d%\.$/);

      // A control Term waits 600 ms (premium §5.6) and is described to screen readers
      const hard = page.getByRole('radio', { name: 'Hard bins' });
      await expect(hard).toHaveAccessibleDescription(
        'Coarse sort categories (HBIN) that decide where a die physically goes.',
      );
      await page.locator('[data-term-id="hardBin"]').hover();
      await page.waitForTimeout(400);
      await expect(page.getByTestId('term-popover')).toHaveCount(0);
      await expect(page.getByTestId('term-popover')).toBeVisible({ timeout: 600 });
      await expect(page.getByTestId('term-popover')).toContainText('Hard bins');

      // Keyboard focus opens a text Term at once; Esc closes it
      await page.mouse.move(4, 4);
      await expect(page.getByTestId('term-popover')).toHaveCount(0);
      await takeawayTerm.focus();
      await page.keyboard.press('Shift+Tab');
      await page.keyboard.press('Tab');
      await expect(takeawayTerm).toBeFocused();
      await expect(page.getByTestId('term-popover')).toContainText(
        'The share of dies that passed every test.',
        { timeout: 100 },
      );
      await page.keyboard.press('Escape');
      await expect(page.getByTestId('term-popover')).toHaveCount(0);
    });

    test('A22: hovering Cpk in an expanded finding opens a 3-line definition inside the viewport', async ({
      page,
    }) => {
      await loadDemo(page, 'edge-ring-etch');
      await page.getByTestId('autopsy-body-claim-button').nth(2).click();
      const cpk = page.locator('[data-testid="finding-engine-sentence"] [data-term-id="cpk"]');
      await expect(cpk).toHaveText('Cpk');
      await expect(cpk).toHaveAccessibleDescription(/^How well a measurement fits inside its limits\./);

      await cpk.hover();
      await page.waitForTimeout(250);
      await expect(page.getByTestId('term-popover')).toHaveCount(0);
      await expect(page.getByTestId('term-popover')).toBeVisible({ timeout: 150 });
      await page.waitForTimeout(150); // opacity fade (dur-1)

      const audit = await page.getByTestId('term-popover').evaluate((el) => {
        const rect = el.getBoundingClientRect();
        const [title, body] = Array.from(el.querySelectorAll('p'));
        const cs = getComputedStyle(el);
        return {
          rect: { top: rect.top, left: rect.left, right: rect.right, bottom: rect.bottom, width: rect.width },
          title: title!.textContent,
          titleWeight: getComputedStyle(title!).fontWeight,
          lines: body!.getBoundingClientRect().height / parseFloat(getComputedStyle(body!).lineHeight),
          radius: cs.borderTopLeftRadius,
          padding: `${cs.paddingTop} ${cs.paddingLeft}`,
          zIndex: cs.zIndex,
          opacity: cs.opacity,
          vw: window.innerWidth,
          vh: window.innerHeight,
        };
      });
      expect(audit.title).toBe('Cpk');
      expect(audit.titleWeight).toBe('590');
      expect(audit.lines).toBeLessThanOrEqual(3.05);
      expect(audit.rect.width).toBeLessThanOrEqual(280);
      expect(audit.rect.top).toBeGreaterThanOrEqual(8);
      expect(audit.rect.left).toBeGreaterThanOrEqual(8);
      expect(audit.rect.right).toBeLessThanOrEqual(audit.vw - 8);
      expect(audit.rect.bottom).toBeLessThanOrEqual(audit.vh - 8);
      expect(audit.radius).toBe('12px');
      expect(audit.padding).toBe('12px 14px');
      expect(audit.zIndex).toBe('55');
      expect(Number(audit.opacity)).toBe(1);

      // Leaving the term and the popover closes it after 100 ms
      await page.mouse.move(4, 4);
      await expect(page.getByTestId('term-popover')).toHaveCount(0, { timeout: 400 });
    });
  });
}
