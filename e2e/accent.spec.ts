import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { expect, type Page, test } from '@playwright/test';

/**
 * User-selectable accent colour (`data-accent`, `localStorage["cal.accent"]`):
 * - Popover menu with Appearance (System / Light / Dark) and Colour (Ember / Cobalt / Jade / Violet)
 * - 20 px circular swatches with 2 px ink focus/selected ring, radio semantics, keyboard operable
 * - DOM tokens (verdict cause phrase, Pareto rank-0 bar, legend) and wafer Canvas failing dies
 *   follow the selected accent; pass/neutral greys stay unchanged
 * - Pre-hydration script prevents flash on reload; smooth 240 ms cross-fade respects reduced motion
 * - Screenshots for all 4 accents on the loaded sample report (1440x900, light)
 */

const SHOTS_DIR = path.resolve(process.cwd(), 'logs/shots');

const EXPECTED_LIGHT_INK = {
  ember: 'rgb(217, 78, 20)',
  cobalt: 'rgb(29, 78, 216)',
  jade: 'rgb(12, 118, 81)',
  violet: 'rgb(109, 40, 217)',
} as const;

const EXPECTED_LIGHT_MARK = {
  ember: 'rgb(232, 89, 30)',
  cobalt: 'rgb(37, 99, 235)',
  jade: 'rgb(15, 138, 95)',
  violet: 'rgb(124, 58, 237)',
} as const;

const EXPECTED_DARK_INK = {
  ember: 'rgb(255, 138, 87)',
  cobalt: 'rgb(130, 180, 255)',
  jade: 'rgb(74, 222, 168)',
  violet: 'rgb(201, 168, 255)',
} as const;

const EXPECTED_DISC_RGB = {
  ember: [255, 107, 44],
  cobalt: [92, 156, 255],
  jade: [34, 197, 139],
  violet: [179, 136, 255],
} as const;

async function recordAccentAtBodyInsert(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as { __accentAtBody?: string | null };
    const observer = new MutationObserver(() => {
      if (document.body && w.__accentAtBody === undefined) {
        w.__accentAtBody = document.documentElement.getAttribute('data-accent');
        observer.disconnect();
      }
    });
    observer.observe(document, { childList: true, subtree: true });
  });
}

async function loadSampleReport(
  page: Page,
  scheme: 'light' | 'dark' = 'light',
): Promise<void> {
  await page.emulateMedia({ colorScheme: scheme });
  await page.addInitScript(() => {
    window.sessionStorage.setItem('cal.sweep.v1', '1');
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/?nohints=1');
  await expect(page.getByTestId('demo-card-edge-ring-etch')).toBeVisible();
  await page.getByTestId('demo-card-edge-ring-etch').click();
  await expect(page.getByTestId('wafer-stage')).toHaveAttribute(
    'data-sweep',
    'done',
    { timeout: 8_000 },
  );
  await expect(page.getByTestId('verdict-headline')).toBeVisible();
  // Wait for verdict rise-in blocks to reach opacity 1
  await page.waitForFunction(() => {
    const blocks = document.querySelectorAll<HTMLElement>(
      '[data-verdict-rise-block]',
    );
    return (
      blocks.length === 6 &&
      Array.from(blocks).every((el) => getComputedStyle(el).opacity === '1')
    );
  });
  await page.waitForTimeout(250);
}

/** Counts pixels in the wafer base canvas close to `targetRgb`. */
async function countWaferCanvasPixels(
  page: Page,
  targetRgb: readonly [number, number, number],
): Promise<number> {
  return page.evaluate(([tr, tg, tb]) => {
    const canvas = document.querySelector<HTMLCanvasElement>(
      '[data-testid="wafer-base-canvas"]',
    );
    if (!canvas) return 0;
    const ctx = canvas.getContext('2d');
    if (!ctx) return 0;
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let hits = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3]! < 200) continue;
      if (
        Math.abs(data[i]! - tr) <= 12 &&
        Math.abs(data[i + 1]! - tg) <= 12 &&
        Math.abs(data[i + 2]! - tb) <= 12
      ) {
        hits += 1;
      }
    }
    return hits;
  }, targetRgb);
}

test('menu selection switches to Cobalt across verdict, Pareto, and wafer canvas, and survives reload without flash', async ({
  page,
}) => {
  await recordAccentAtBodyInsert(page);
  await loadSampleReport(page, 'light');

  await expect(page.locator('html')).toHaveAttribute('data-accent', 'ember');
  const causeBtn = page.getByTestId('autopsy-headline-button');
  await expect(causeBtn).toHaveCSS('color', EXPECTED_LIGHT_INK.ember);

  const firstParetoBar = page.getByTestId('bin-pareto-bar').first();
  await expect(firstParetoBar).toHaveCSS(
    'background-color',
    EXPECTED_LIGHT_MARK.ember,
  );
  expect(
    await countWaferCanvasPixels(page, EXPECTED_DISC_RGB.ember),
  ).toBeGreaterThan(500);

  // Open Appearance popover and verify all 4 swatches (20 px circles, radio semantics, ink ring)
  await page.getByTestId('theme-toggle-trigger').click();
  const menu = page.getByTestId('theme-menu');
  await expect(menu).toBeVisible();

  const swatchGroup = menu.getByTestId('accent-swatch-group');
  await expect(swatchGroup).toContainText('Colour');

  for (const [id, name] of [
    ['ember', 'Ember'],
    ['cobalt', 'Cobalt'],
    ['jade', 'Jade'],
    ['violet', 'Violet'],
  ] as const) {
    const swatch = swatchGroup.getByTestId(`accent-option-${id}`);
    await expect(swatch).toHaveAttribute('role', 'menuitemradio');
    await expect(swatch).toHaveAccessibleName(name);
    const box = (await swatch.boundingBox())!;
    expect(Math.round(box.width)).toBe(20);
    expect(Math.round(box.height)).toBe(20);
  }
  const emberSwatch = swatchGroup.getByTestId('accent-option-ember');
  await expect(emberSwatch).toHaveAttribute('aria-checked', 'true');
  expect(
    await emberSwatch.evaluate((el) => getComputedStyle(el).boxShadow),
  ).toContain('rgb(32, 30, 31)');

  // Pick Cobalt
  await swatchGroup.getByTestId('accent-option-cobalt').click();
  await expect(menu).toHaveCount(0);
  await expect(page.locator('html')).toHaveAttribute('data-accent', 'cobalt');
  expect(await page.evaluate(() => localStorage.getItem('cal.accent'))).toBe(
    'cobalt',
  );

  // Verdict cause phrase, Pareto rank-0 bar, and wafer failing dies follow Cobalt
  await expect(causeBtn).toHaveCSS('color', EXPECTED_LIGHT_INK.cobalt);
  await expect(firstParetoBar).toHaveCSS(
    'background-color',
    EXPECTED_LIGHT_MARK.cobalt,
  );
  await expect
    .poll(() => countWaferCanvasPixels(page, EXPECTED_DISC_RGB.cobalt))
    .toBeGreaterThan(500);
  expect(
    await countWaferCanvasPixels(page, EXPECTED_DISC_RGB.ember),
  ).toBe(0);

  // Pass/neutral greys unchanged
  expect(
    await page.evaluate(() => getComputedStyle(document.body).backgroundColor),
  ).toBe('rgb(246, 243, 238)');
  const statColour = await page
    .getByTestId('verdict-stat-value')
    .first()
    .evaluate((el) => getComputedStyle(el).color);
  expect(statColour).toBe('rgb(32, 30, 31)');

  // Independent of light/dark: switching to Dark keeps Cobalt and uses dark ink
  await page.getByTestId('theme-toggle-trigger').click();
  await page.getByTestId('theme-option-dark').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('html')).toHaveAttribute('data-accent', 'cobalt');
  await expect(causeBtn).toHaveCSS('color', EXPECTED_DARK_INK.cobalt);

  // Switch back to Light and reload: pre-hydration script sets cobalt before <body> inserts
  await page.getByTestId('theme-toggle-trigger').click();
  await page.getByTestId('theme-option-light').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');

  await page.reload();
  await expect(page.getByTestId('nav-wordmark')).toBeVisible();
  const atBody = await page.evaluate(
    () => (window as unknown as { __accentAtBody?: string | null }).__accentAtBody,
  );
  expect(atBody).toBe('cobalt');
  await expect(page.locator('html')).toHaveAttribute('data-accent', 'cobalt');

  await page.getByTestId('theme-toggle-trigger').click();
  await expect(page.getByTestId('accent-option-cobalt')).toHaveAttribute(
    'aria-checked',
    'true',
  );
});

test('keyboard navigation selects accent swatches and respects reduced motion', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const w = window as unknown as { __vtCalls: number };
    w.__vtCalls = 0;
    const original = document.startViewTransition?.bind(document);
    if (original) {
      document.startViewTransition = ((cb: () => void) => {
        w.__vtCalls += 1;
        return original(cb);
      }) as typeof document.startViewTransition;
    }
  });
  await loadSampleReport(page, 'light');

  const trigger = page.getByTestId('theme-toggle-trigger');
  await trigger.focus();
  await page.keyboard.press('Enter');
  const menu = page.getByTestId('theme-menu');
  await expect(menu).toBeVisible();

  // Wait for initial menu focus to land on checked Appearance row (Match system)
  await expect(page.getByTestId('theme-option-system')).toBeFocused();

  // ArrowDown through Light -> Dark -> Ember swatch, then ArrowRight to Cobalt -> Jade
  await page.keyboard.press('ArrowDown');
  await expect(page.getByTestId('theme-option-light')).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByTestId('theme-option-dark')).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByTestId('accent-option-ember')).toBeFocused();

  await page.keyboard.press('ArrowRight');
  await expect(page.getByTestId('accent-option-cobalt')).toBeFocused();
  // Focused swatch displays the 2 px ink focus ring
  expect(
    await page
      .getByTestId('accent-option-cobalt')
      .evaluate((el) => getComputedStyle(el).boxShadow),
  ).toContain('rgb(32, 30, 31)');

  await page.keyboard.press('ArrowRight');
  await expect(page.getByTestId('accent-option-jade')).toBeFocused();

  await page.keyboard.press('Enter');
  await expect(menu).toHaveCount(0);
  await expect(page.locator('html')).toHaveAttribute('data-accent', 'jade');
  await expect(page.getByTestId('autopsy-headline-button')).toHaveCSS(
    'color',
    EXPECTED_LIGHT_INK.jade,
  );
  await expect(trigger).toBeFocused();

  // Reduced motion: switching via keyboard skips view transition
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
  const beforeVt = await page.evaluate(
    () => (window as unknown as { __vtCalls: number }).__vtCalls,
  );
  await page.keyboard.press('ArrowDown');
  await expect(page.getByTestId('theme-menu')).toBeVisible();
  await page.keyboard.press('End');
  await expect(page.getByTestId('accent-option-violet')).toBeFocused();
  await page.keyboard.press(' ');
  await expect(page.locator('html')).toHaveAttribute('data-accent', 'violet');
  const afterVt = await page.evaluate(
    () => (window as unknown as { __vtCalls: number }).__vtCalls,
  );
  expect(afterVt).toBe(beforeVt);
});

test('captures loaded sample report screenshots (1440x900 light) for all 4 accents', async ({
  page,
}) => {
  mkdirSync(SHOTS_DIR, { recursive: true });
  await loadSampleReport(page, 'light');

  const accents = ['ember', 'cobalt', 'jade', 'violet'] as const;
  for (const accent of accents) {
    if (accent !== 'ember') {
      await page.getByTestId('theme-toggle-trigger').click();
      await page.getByTestId(`accent-option-${accent}`).click();
      await expect(page.getByTestId('theme-menu')).toHaveCount(0);
    }
    await expect(page.locator('html')).toHaveAttribute('data-accent', accent);
    await expect(page.getByTestId('autopsy-headline-button')).toHaveCSS(
      'color',
      EXPECTED_LIGHT_INK[accent],
    );
    await expect
      .poll(() => countWaferCanvasPixels(page, EXPECTED_DISC_RGB[accent]))
      .toBeGreaterThan(500);
    // Let the 240 ms cross-fade finish completely before capturing
    await page.waitForTimeout(350);

    await page.screenshot({
      path: path.join(SHOTS_DIR, `accent-${accent}-light.png`),
      fullPage: false,
    });
  }
});
