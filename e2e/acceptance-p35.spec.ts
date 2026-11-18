import fs from 'node:fs';
import path from 'node:path';
import { expect, type Page, test } from '@playwright/test';

/**
 * Premium P35 (premium.md §10): full acceptance run.
 * Captures one screenshot per item A1-A40 (Chromium, deviceScaleFactor 2, `?nohints=1` unless the
 * item is about hints, demo lot `edge-ring-etch` unless stated) at 1440 x 900, 1280 x 800,
 * 1024 x 768, and 390 x 844 in both themes (OS colour scheme, preference on Match system), and
 * runs the cross-screen checks that hold on every screenshot: no horizontal scroll, one primary
 * button, no hint under `?nohints=1`, no exclamation mark (A18, A20, A24, A26). The per-item
 * pixel and DOM assertions live in the P2-P34 specs named in `logs/premium-acceptance.md`.
 */

const SHOTS = path.join(__dirname, '..', 'logs', 'shots', 'p35');
fs.mkdirSync(SHOTS, { recursive: true });

test.use({ deviceScaleFactor: 2 });

const VIEWPORTS = [
  [1440, 900],
  [1280, 800],
  [1024, 768],
  [390, 844],
] as const;
const THEMES = ['light', 'dark'] as const;
type Theme = (typeof THEMES)[number];

interface BootOptions {
  readonly width?: number;
  readonly height?: number;
  readonly theme?: Theme;
  readonly query?: string;
  readonly skipSweep?: boolean;
  readonly reducedMotion?: 'reduce' | 'no-preference';
  readonly locale?: string;
}

async function boot(page: Page, o: BootOptions = {}): Promise<void> {
  const { width = 1440, height = 900, theme = 'light', query = '?nohints=1' } = o;
  await page.addInitScript(
    ({ skip, locale }) => {
      if (skip) window.sessionStorage.setItem('cal.sweep.v1', '1');
      if (locale) window.localStorage.setItem('cal.locale', locale);
    },
    { skip: o.skipSweep ?? true, locale: o.locale ?? null },
  );
  await page.emulateMedia({ colorScheme: theme, reducedMotion: o.reducedMotion ?? 'no-preference' });
  await page.setViewportSize({ width, height });
  await page.goto(`/${query}`);
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
}

/** Opens a demo lot and waits until the sweep and the §8.2 verdict rise-in have settled. */
async function openLot(page: Page, preset = 'edge-ring-etch'): Promise<void> {
  await page.getByTestId(`demo-card-${preset}`).click();
  await expect(page.getByTestId('wafer-stage')).toHaveAttribute('data-sweep', 'done', {
    timeout: 8_000,
  });
  await expect(page.getByTestId('verdict-headline')).toBeVisible();
  await page.waitForFunction(() => {
    const blocks = document.querySelectorAll<HTMLElement>('[data-verdict-rise-block]');
    return (
      blocks.length === 6 &&
      Array.from(blocks).every((el) => {
        const cs = getComputedStyle(el);
        return cs.opacity === '1' && (cs.transform === 'none' || /, 0\)$/.test(cs.transform));
      })
    );
  });
}

async function shot(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: path.join(SHOTS, `${name}.jpg`), type: 'jpeg', quality: 80 });
}

interface ScreenAudit {
  readonly scrollWidth: number;
  readonly primaries: number;
  readonly hints: number;
  readonly bang: boolean;
  readonly wide: readonly string[];
}

/** Cross-screen checks for every screenshot (A18, A20, A24, A26). */
function auditScreen(page: Page): Promise<ScreenAudit> {
  return page.evaluate(() => {
    const visible = (el: Element) => {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return false;
      if (r.bottom <= 0 || r.top >= window.innerHeight) return false;
      const cs = getComputedStyle(el);
      return cs.visibility === 'visible' && Number(cs.opacity) > 0;
    };
    return {
      scrollWidth: document.documentElement.scrollWidth,
      // A primary under a modal scrim is not on the visible screen: hit-test its centre
      primaries: [...document.querySelectorAll('[data-variant="primary"]')].filter((el) => {
        if (!visible(el)) return false;
        const r = el.getBoundingClientRect();
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return hit !== null && el.contains(hit);
      }).length,
      hints: [...document.querySelectorAll('[data-testid="coach-mark"], [data-testid="coach-mark-ring"]')]
        .length,
      bang: /[!！]/.test(document.body.innerText),
      wide: [...document.querySelectorAll<HTMLElement>('body *')]
        .filter((el) => el.getBoundingClientRect().right > window.innerWidth + 0.5)
        .slice(0, 6)
        .map((el) => `${el.tagName} ${el.getAttribute('data-testid') ?? ''} ${String(el.className).slice(0, 60)}`),
    };
  });
}

async function expectCleanScreen(page: Page, width: number): Promise<void> {
  const a = await auditScreen(page);
  expect(a.scrollWidth, `no horizontal scroll: ${a.wide.join(' | ')}`).toBe(width);
  expect(a.primaries, 'one primary button').toBe(1);
  expect(a.hints, 'no hints under ?nohints=1').toBe(0);
  expect(a.bang, 'no exclamation mark').toBe(false);
}

/** Moves the pointer along the stage midline until the magnifier shows a failing die. */
async function hoverFailDie(page: Page): Promise<void> {
  const box = (await page.getByTestId('wafer-stage').boundingBox())!;
  const y = box.y + box.height / 2;
  for (let x = box.x + 8; x < box.x + box.width / 2; x += 3) {
    await page.mouse.move(x, y);
    const kind = await page
      .locator('[data-magnifier-swatch]')
      .first()
      .getAttribute('data-magnifier-swatch', { timeout: 200 })
      .catch(() => null);
    const shown = await page.getByTestId('wafer-hover-magnifier').getAttribute('data-visible');
    if (kind === 'fail' && shown === 'true') return;
  }
  throw new Error('No failing die found along the stage midline');
}

test.describe('P35 acceptance matrix: landing and loaded at 4 viewports x 2 themes', () => {
  for (const [width, height] of VIEWPORTS) {
    for (const theme of THEMES) {
      test(`A1 A3 A11 A12 A14-A18 A20 A24-A26 A30 at ${width} ${theme}`, async ({ page }) => {
        await boot(page, { width, height, theme });
        await expect(page.getByTestId('landing-headline')).toBeVisible();
        await expectCleanScreen(page, width);
        await shot(page, `landing-${width}-${theme}`);

        await openLot(page);
        await expectCleanScreen(page, width);
        await shot(page, `loaded-${width}-${theme}`);
      });
    }
  }
});

test.describe('P35 acceptance: item screenshots', () => {
  test('A2: OS dark paints black first; choosing Light persists with a check', async ({ page }) => {
    await boot(page, { theme: 'dark' });
    await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(0, 0, 0)');
    await shot(page, 'a02-dark-first-paint');
    await page.getByTestId('theme-toggle-trigger').click();
    await page.getByTestId('theme-option-light').click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await page.getByTestId('theme-toggle-trigger').click();
    await expect(page.getByTestId('theme-option-light')).toHaveAttribute('aria-checked', 'true');
    await page.waitForTimeout(400);
    await shot(page, 'a02-a28-appearance-light');
  });

  for (const theme of THEMES) {
    test(`A5 A6 A8 A9 A10 A32 A35 (${theme})`, async ({ page }) => {
      await boot(page, { theme });
      await openLot(page);
      await page.getByTestId('stage-column').screenshot({
        path: path.join(SHOTS, `a05-a06-a08-stage-${theme}.jpg`),
        type: 'jpeg',
        quality: 80,
      });

      await hoverFailDie(page);
      await page.waitForTimeout(200);
      await shot(page, `a10-magnifier-${theme}`);
      await page.mouse.move(1430, 890);

      await page.getByTestId('verdict-show-on-wafer').click();
      await page.waitForTimeout(1_200);
      await shot(page, `a09-evidence-${theme}`);

      await page.getByTestId('bin-pareto').scrollIntoViewIfNeeded();
      await page.waitForTimeout(400);
      await shot(page, `a32-pareto-${theme}`);

      await page.evaluate(() => window.scrollTo(0, 0));
      await page.getByTestId('stage-mode-segmented').getByRole('radio', { checked: true }).focus();
      let focused = false;
      for (let i = 0; i < 8 && !focused; i += 1) {
        await page.keyboard.press('Shift+Tab');
        focused = await page.evaluate(
          () => document.activeElement?.getAttribute('data-testid') === 'wafer-stage',
        );
      }
      expect(focused).toBe(true);
      await shot(page, `a35-stage-focus-${theme}`);
    });
  }

  test('A7: fail and pass die geometry at about 400 % zoom', async ({ page }) => {
    await boot(page);
    await openLot(page);
    await page.getByTestId('wafer-stage').focus();
    for (let i = 0; i < 4; i += 1) await page.keyboard.press('+');
    await page.waitForTimeout(700);
    await shot(page, 'a07-zoom');
  });

  test('A13: pass tiles under prefers-contrast: more', async ({ page }) => {
    await page.emulateMedia({ contrast: 'more' });
    await boot(page);
    await page.emulateMedia({ contrast: 'more' });
    await openLot(page);
    await shot(page, 'a13-contrast-more');
  });

  test('A19 A33: sticky stage beside the yield summary on site2-probe-contact', async ({ page }) => {
    await boot(page);
    await openLot(page, 'site2-probe-contact');
    await page.getByTestId('yield-summary').scrollIntoViewIfNeeded();
    await page.getByTestId('yield-site-row').nth(1).click();
    await page.waitForTimeout(800);
    await expect(page.getByTestId('wafer-stage')).toBeInViewport();
    await expect(page.getByTestId('yield-site-anomaly')).toBeVisible();
    await shot(page, 'a19-a33-yield-summary');
  });

  for (const theme of THEMES) {
    test(`A20: parse error and bins-only sheet (${theme})`, async ({ page }) => {
      await boot(page, { theme });
      await expect(page.getByTestId('full-window-drop-zone')).toHaveAttribute(
        'data-dropzone-ready',
        'true',
      );
      await page.evaluate(() => {
        const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
        const file = new File([bytes], 'wafer-photo.png', { type: 'image/png' });
        const evt = new Event('drop', { bubbles: true, cancelable: true });
        Object.defineProperty(evt, 'dataTransfer', { value: { types: ['Files'], files: [file] } });
        window.dispatchEvent(evt);
      });
      await expect(page.getByTestId('parse-error-title')).toBeVisible();
      await expectCleanScreen(page, 1440);
      await shot(page, `a20-parse-error-${theme}`);

      await page.goto('/?nohints=1');
      await expect(page.getByTestId('full-window-drop-zone')).toHaveAttribute(
        'data-dropzone-ready',
        'true',
      );
      await page.evaluate(() => {
        const file = new File([new Uint8Array([0x02, 0x00, 0x00, 0x0a, 0x02, 0x04])], 'lot-312mb.stdf');
        Object.defineProperty(file, 'size', { value: 312 * 1024 * 1024, configurable: true });
        const evt = new Event('drop', { bubbles: true, cancelable: true });
        Object.defineProperty(evt, 'dataTransfer', { value: { types: ['Files'], files: [file] } });
        window.dispatchEvent(evt);
      });
      const sheet = page.getByTestId('bins-only-sheet');
      await expect(sheet).toBeVisible();
      await expect.poll(async () => Math.round((await sheet.boundingBox())?.width ?? 0)).toBe(480);
      expect((await auditScreen(page)).primaries).toBe(1);
      await shot(page, `a20-bins-only-${theme}`);
    });
  }

  test('A21 A22 A27 A31: expanded finding with the Cpk definition', async ({ page }) => {
    await boot(page);
    await openLot(page);
    await page.getByTestId('autopsy-body-claim-button').nth(2).click();
    await page.waitForTimeout(400);
    await shot(page, 'a27-a31-finding-expanded');
    await page.locator('[data-testid="finding-engine-sentence"] [data-term-id="cpk"]').hover();
    await expect(page.getByTestId('term-popover')).toBeVisible({ timeout: 1_000 });
    await page.waitForTimeout(200);
    await shot(page, 'a21-a22-cpk-term');
  });

  test('A23 A24: Start here hint beside Show on wafer, gone after use', async ({ page }) => {
    await page.addInitScript(() => {
      if (!window.sessionStorage.getItem('p35.hints')) {
        window.sessionStorage.setItem('p35.hints', '1');
        window.localStorage.removeItem('cal.hints.v1');
      }
    });
    await boot(page, { query: '' });
    await openLot(page);
    await expect(page.getByTestId('coach-mark')).toBeVisible({ timeout: 8_000 });
    await expect(page.getByTestId('coach-mark')).toHaveCount(1);
    await page.waitForTimeout(300);
    await shot(page, 'a23-start-here');
    await page.getByTestId('verdict-show-on-wafer').click();
    await expect(page.getByTestId('coach-mark')).toHaveCount(0);
    await page.reload();
    await openLot(page);
    await page.waitForTimeout(2_500);
    await expect(page.locator('[data-hint-id="h-show"]')).toHaveCount(0);
    await shot(page, 'a23-after-reload');
  });

  test('A28 A29: nav, Appearance menu, and lot picker at 1440 and 390', async ({ page }) => {
    await boot(page);
    await openLot(page);
    await page.getByTestId('lot-picker-trigger').click();
    await expect(page.getByTestId('lot-picker-menu')).toBeVisible();
    await page.waitForTimeout(400);
    await shot(page, 'a29-lot-picker');
    await page.keyboard.press('Escape');
    await page.getByTestId('theme-toggle-trigger').click();
    await expect(page.getByTestId('theme-menu')).toBeVisible();
    await page.waitForTimeout(400);
    await shot(page, 'a28-appearance-menu-1440');
    await page.keyboard.press('Escape');

    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByTestId('language-switcher-trigger').click();
    await expect(page.getByTestId('theme-option-system')).toBeVisible();
    await page.waitForTimeout(400);
    await shot(page, 'a28-globe-menu-390');
  });

  test('A34: download toast bottom-centre', async ({ page }) => {
    await boot(page);
    await page.getByTestId('landing-download-demos-trigger').click();
    await Promise.all([
      page.waitForEvent('download'),
      page.getByTestId('download-demo-stdf-edge-ring-etch').click(),
    ]);
    await page.mouse.move(40, 120);
    await expect(page.locator('[data-sonner-toast]').first()).toBeVisible();
    await page.waitForTimeout(500);
    await shot(page, 'a34-toast');
  });

  test('A36: reduced motion shows the final wafer and verdict on the first screenshot', async ({
    page,
  }) => {
    await boot(page, { skipSweep: false, reducedMotion: 'reduce' });
    await page.getByTestId('demo-card-edge-ring-etch').click();
    await expect(page.getByTestId('wafer-stage')).toHaveAttribute('data-sweep', 'done', {
      timeout: 8_000,
    });
    await expect(page.getByTestId('verdict-headline')).toBeVisible();
    await shot(page, 'a36-reduced-motion');
  });

  test('A37: probe sweep about 500 ms in', async ({ page }) => {
    await boot(page, { skipSweep: false });
    await page.getByTestId('demo-card-edge-ring-etch').click();
    const stage = page.getByTestId('wafer-stage');
    await expect(stage).toHaveAttribute('data-sweep', 'running', { timeout: 8_000 });
    await page.waitForTimeout(450);
    await shot(page, 'a37-sweep-500ms');
    await expect(stage).toHaveAttribute('data-sweep', 'done', { timeout: 3_000 });
  });

  test('A38: evidence ignite at 250 ms and 650 ms', async ({ page }) => {
    await boot(page);
    await openLot(page);
    await page.getByTestId('autopsy-body-claim-button').first().click();
    await page.waitForTimeout(250);
    await shot(page, 'a38-ignite-250ms');
    await page.waitForTimeout(400);
    await shot(page, 'a38-ignite-650ms');
  });

  for (const locale of ['ja', 'zh-CN', 'zh-TW', 'ko'] as const) {
    for (const [width, height] of [
      [1440, 900],
      [390, 844],
    ] as const) {
      test(`A40: ${locale} at ${width}`, async ({ page }) => {
        await boot(page, { width, height, locale });
        await expect(page.locator('html')).toHaveAttribute('lang', locale);
        await openLot(page);
        await expectCleanScreen(page, width);
        await shot(page, `a40-${locale}-${width}`);
      });
    }
  }
});

test.describe('P35 acceptance: first paint before hydration', () => {
  test.use({ javaScriptEnabled: false });

  test('A18 (landing): the server-rendered landing never scrolls sideways at 390', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/?nohints=1');
    await expect(page.getByTestId('landing-hero-frame')).toBeAttached();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  });
});
