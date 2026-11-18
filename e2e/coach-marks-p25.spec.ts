import { expect, type Page, test } from '@playwright/test';

/**
 * Premium P25 (premium.md §2.4, §7.18, §8.10, §11.4): first-use coach marks. A23 (Start here
 * next to Show on wafer, gone for good after use), A24 (one at a time, never over the anchor or
 * during the sweep, none under ?nohints=1), A44 (a pulse ring before the text; static under
 * reduced motion).
 */

// The shared config pre-dismisses every hint; these tests start from cleared storage
test.use({ storageState: { cookies: [], origins: [] } });

type Box = { x: number; y: number; width: number; height: number };

const overlaps = (a: Box, b: Box) =>
  a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;

async function openSample(page: Page, query = '', skipSweep = true) {
  if (skipSweep) {
    await page.addInitScript(() => {
      window.sessionStorage.setItem('cal.sweep.v1', '1');
    });
  }
  await page.goto(`/${query}`);
  await page.getByTestId('demo-card-edge-ring-etch').click();
  await expect(page.getByTestId('verdict-show-on-wafer')).toBeVisible({ timeout: 10_000 });
}

async function dismissedIds(page: Page): Promise<string[]> {
  return page.evaluate(() => JSON.parse(localStorage.getItem('cal.hints.v1') ?? '[]'));
}

test.describe('Premium P25 - coach marks', () => {
  test('A23 + A44: Start here pulses a ring, then shows beside Show on wafer; using it retires it', async ({
    page,
  }) => {
    await openSample(page);
    const ring = page.getByTestId('coach-mark-ring');
    const bubble = page.getByTestId('coach-mark');

    // The ember ring comes first (≈ 650 ms settle + 800 ms), with no text yet
    await expect(ring).toBeVisible({ timeout: 4_000 });
    await expect(ring).toHaveAttribute('data-hint-id', 'h-show');
    await expect(ring).toHaveAttribute('data-pulse', 'pulse');
    await expect(bubble).toHaveCount(0);
    const ringColour = await ring.evaluate((el) => getComputedStyle(el).borderTopColor);
    expect(ringColour).toBe('rgb(255, 107, 44)');

    // Then the bubble: right of the button, arrow pointing left, never covering it
    await expect(bubble).toBeVisible({ timeout: 4_000 });
    await expect(ring).toHaveCount(0);
    await expect(bubble).toHaveAttribute('data-hint-id', 'h-show');
    await expect(bubble).toHaveAttribute('data-side', 'right');
    await expect(bubble).toHaveAttribute('role', 'status');
    await expect(bubble).toContainText('Start here. This lights up the dies behind the verdict.');
    await expect(page.getByTestId('coach-mark-got-it')).toHaveText('Got it');
    const button = (await page.getByTestId('verdict-show-on-wafer').boundingBox())!;
    const box = (await bubble.boundingBox())!;
    expect(overlaps(box, button)).toBe(false);
    expect(Math.round(box.x - (button.x + button.width))).toBe(10);
    expect(box.width).toBeLessThanOrEqual(280);
    // Hints never take focus
    expect(await page.evaluate(() => document.activeElement?.closest('[data-testid="coach-mark"]'))).toBeNull();

    await page.getByTestId('verdict-show-on-wafer').click();
    await expect(bubble).toHaveCount(0);
    expect(await dismissedIds(page)).toContain('h-show');

    await page.reload();
    await page.getByTestId('demo-card-edge-ring-etch').click();
    await expect(page.getByTestId('verdict-show-on-wafer')).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(4_500);
    await expect(page.locator('[data-hint-id="h-show"]')).toHaveCount(0);
  });

  test('A24: one hint at a time, in order, never over its anchor; Got it and Esc retire them', async ({
    page,
  }) => {
    await openSample(page);
    const bubble = page.getByTestId('coach-mark');
    await expect(bubble).toHaveAttribute('data-hint-id', 'h-show', { timeout: 8_000 });
    await page.getByTestId('coach-mark-got-it').click();
    await expect(bubble).toHaveCount(0);

    // h-hover: anchored to the disc's top edge (flips below if there is no room)
    await expect(bubble).toHaveAttribute('data-hint-id', 'h-hover', { timeout: 6_000 });
    await expect(page.locator('[data-testid="coach-mark"], [data-testid="coach-mark-ring"]')).toHaveCount(1);
    await expect(bubble).toContainText('Point at any die to read its bin and test values.');
    const stage = page.getByTestId('wafer-stage');
    const disc = await stage.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const d = Number((el as HTMLElement).dataset.waferDiameterPx);
      const cx = Number((el as HTMLElement).dataset.discCenterX);
      const cy = Number((el as HTMLElement).dataset.discCenterY);
      return { x: r.left + cx - d / 2, y: r.top + cy - d / 2, width: d, height: d };
    });
    expect(overlaps((await bubble.boundingBox())!, disc)).toBe(false);
    await page.keyboard.press('Escape');
    await expect(bubble).toHaveCount(0);

    // h-strip: above the active thumbnail, with the lot's wafer count
    await expect(bubble).toHaveAttribute('data-hint-id', 'h-strip', { timeout: 6_000 });
    await expect(bubble).toContainText(/Flip through all 25 wafers here, or press ← and →\./);
    const thumb = page.locator(
      '[data-testid="wafer-strip"] [role="option"][aria-selected="true"] [data-testid="wafer-strip-thumb-ring"]',
    );
    expect(overlaps((await bubble.boundingBox())!, (await thumb.boundingBox())!)).toBe(false);
    await page.locator('[data-testid="wafer-strip"] [role="option"]').nth(3).click();
    await expect(bubble).toHaveCount(0);
    expect((await dismissedIds(page)).sort()).toEqual(['h-hover', 'h-show', 'h-strip']);
  });

  test('A24: no hint during the probe sweep', async ({ page }) => {
    await openSample(page, '', false);
    const stage = page.getByTestId('wafer-stage');
    const samples: Array<{ sweep: string | null; hints: number }> = [];
    for (let i = 0; i < 20; i += 1) {
      samples.push(
        await page.evaluate(() => ({
          sweep: document.querySelector('[data-testid="wafer-stage"]')?.getAttribute('data-sweep') ?? null,
          hints: document.querySelectorAll('[data-testid="coach-mark"], [data-testid="coach-mark-ring"]').length,
        })),
      );
      await page.waitForTimeout(100);
    }
    expect(samples.filter((s) => s.sweep === 'running' && s.hints > 0)).toEqual([]);
    expect(samples.every((s) => s.hints <= 1)).toBe(true);
    await expect(stage).toHaveAttribute('data-sweep', 'done', { timeout: 5_000 });
  });

  test('A24: ?nohints=1 shows none', async ({ page }) => {
    await openSample(page, '?nohints=1');
    await page.waitForTimeout(5_000);
    await expect(page.locator('[data-testid="coach-mark"], [data-testid="coach-mark-ring"]')).toHaveCount(0);
    expect(await dismissedIds(page)).toEqual([]);
  });

  test.describe('reduced motion', () => {
    test.use({ reducedMotion: 'reduce' });

    test('A44: a static ring for 2 s, then the text', async ({ page }) => {
      await openSample(page);
      const ring = page.getByTestId('coach-mark-ring');
      await expect(ring).toBeVisible({ timeout: 4_000 });
      await expect(ring).toHaveAttribute('data-pulse', 'static');
      const t0 = Date.now();
      const opacity = Number(await ring.evaluate((el) => getComputedStyle(el).opacity));
      expect(opacity).toBeCloseTo(0.4, 1);
      await expect(page.getByTestId('coach-mark')).toBeVisible({ timeout: 4_000 });
      expect(Date.now() - t0).toBeGreaterThan(1_500);
    });
  });
});
