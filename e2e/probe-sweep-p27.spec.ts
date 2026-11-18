import { expect, type Page, test } from '@playwright/test';

/**
 * Premium P27 (§8.1, §8.16): probe sweep and ignite. A37 (first load, ~500 ms frame, <= 1.2 s,
 * skip on a key), later loads ignite only, and the sweep part of A36 (reduced motion).
 */

interface SweepAudit {
  states: string[];
  runningAt: number | null;
  doneAt: number | null;
  captions: string[];
  frame500: {
    sweep: string;
    caption: string;
    failOpacity: string;
    baseEmber: number;
    overlayLit: number;
  } | null;
}

type PixelCounts = { ember: number; lit: number };
type AuditWindow = Window & { __calSweep?: SweepAudit; __calCount?: () => PixelCounts };

/** Defines `window.__calCount`: ember pixels on the base canvas and lit overlay pixels. */
async function installCounter(page: Page): Promise<void> {
  await page.addInitScript(() => {
    (window as AuditWindow).__calCount = () => {
      const read = (id: string) => {
        const c = document.querySelector<HTMLCanvasElement>(`[data-testid="${id}"]`);
        if (!c || c.width === 0) return null;
        return c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
      };
      const base = read('wafer-base-canvas');
      const overlay = read('wafer-overlay-canvas');
      let ember = 0;
      let lit = 0;
      if (base) {
        for (let i = 0; i < base.length; i += 4) {
          const r = base[i]!;
          const g = base[i + 1]!;
          const b = base[i + 2]!;
          if (r > 200 && g > 70 && g < 150 && b < 90) ember += 1;
        }
      }
      if (overlay) {
        for (let i = 3; i < overlay.length; i += 4) if (overlay[i]! > 0) lit += 1;
      }
      return { ember, lit };
    };
  });
}

const countPixels = (page: Page): Promise<PixelCounts> =>
  page.evaluate(() => (window as AuditWindow).__calCount!());

async function installAudit(page: Page): Promise<void> {
  await installCounter(page);
  await page.addInitScript(() => {
    const win = window as AuditWindow;
    const audit: SweepAudit = {
      states: [],
      runningAt: null,
      doneAt: null,
      captions: [],
      frame500: null,
    };
    win.__calSweep = audit;
    const obs = new MutationObserver(() => {
      const stage = document.querySelector<HTMLElement>('[data-testid="wafer-stage"]');
      const caption = document
        .querySelector('[data-testid="stage-caption"]')
        ?.textContent?.trim();
      if (caption && audit.captions[audit.captions.length - 1] !== caption) {
        audit.captions.push(caption);
      }
      const state = stage?.dataset.sweep;
      if (!state || audit.states[audit.states.length - 1] === state) return;
      audit.states.push(state);
      if (state === 'running' && audit.runningAt === null) {
        audit.runningAt = performance.now();
        setTimeout(() => {
          const px = win.__calCount!();
          audit.frame500 = {
            sweep: stage?.dataset.sweep ?? '',
            caption:
              document.querySelector('[data-testid="stage-caption"]')?.textContent?.trim() ?? '',
            failOpacity:
              document.querySelector<HTMLElement>('[data-testid="wafer-fail-canvas"]')?.style
                .opacity ?? '',
            baseEmber: px.ember,
            overlayLit: px.lit,
          };
        }, 500);
      }
      if (state === 'done' && audit.runningAt !== null && audit.doneAt === null) {
        audit.doneAt = performance.now();
      }
    });
    document.addEventListener('DOMContentLoaded', () => {
      obs.observe(document.documentElement, {
        subtree: true,
        childList: true,
        attributes: true,
        characterData: true,
      });
    });
  });
}

const readAudit = (page: Page): Promise<SweepAudit> =>
  page.evaluate(() => (window as AuditWindow).__calSweep!);

test.describe('P27 probe sweep and ignite', () => {
  test('A37: first load sweeps with the probe light, ignites, and finishes within 1.2 s', async ({
    page,
  }) => {
    await installAudit(page);
    await page.goto('/');
    await page.getByTestId('demo-card-edge-ring-etch').click();
    const stage = page.getByTestId('wafer-stage');
    await expect(stage).toHaveAttribute('data-sweep', 'done', { timeout: 8_000 });
    await expect.poll(async () => (await readAudit(page)).frame500).not.toBeNull();

    const audit = await readAudit(page);
    expect(audit.states).toContain('running');
    const f = audit.frame500!;
    expect(f.sweep).toBe('running');
    expect(f.caption).toBe('Reading…');
    expect(f.failOpacity).toBe('0');
    expect(f.baseEmber).toBe(0);
    expect(f.overlayLit).toBeGreaterThan(0);
    // 900 ms sweep + 280 ms ignite, plus frame slack
    expect(audit.doneAt! - audit.runningAt!).toBeLessThanOrEqual(1_250);
    expect(audit.captions[audit.captions.length - 1]).toMatch(/^\d[\d,]* of \d[\d,]* dies failed$/);

    const after = await countPixels(page);
    expect(after.ember).toBeGreaterThan(0);
    await expect(page.getByTestId('probe-sweep-skip-hint')).toBeHidden();
    expect(
      await page.evaluate(() => window.sessionStorage.getItem('cal.sweep.v1')),
    ).toBe('1');
  });

  test('A37: a key mid-sweep shows the final wafer on the next frame', async ({ page }) => {
    await installCounter(page);
    await page.goto('/');
    await page.getByTestId('demo-card-edge-ring-etch').click();
    const stage = page.getByTestId('wafer-stage');
    await expect(stage).toHaveAttribute('data-sweep', 'running', { timeout: 8_000 });
    await expect(page.getByTestId('probe-sweep-skip-hint')).toBeVisible();

    const result = await page.evaluate(
      () =>
        new Promise<{ sweep: string; ember: number; caption: string; lit: number }>((resolve) => {
          window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Shift' }));
          requestAnimationFrame(() => {
            const px = (window as AuditWindow).__calCount!();
            resolve({
              sweep:
                document.querySelector<HTMLElement>('[data-testid="wafer-stage"]')?.dataset
                  .sweep ?? '',
              ember: px.ember,
              lit: px.lit,
              caption:
                document.querySelector('[data-testid="stage-caption"]')?.textContent?.trim() ??
                '',
            });
          });
        }),
    );
    expect(result.sweep).toBe('done');
    expect(result.ember).toBeGreaterThan(0);
    expect(result.lit).toBe(0);
    expect(result.caption).toMatch(/dies failed$/);
  });

  test('later loads in the session skip to the ignite step', async ({ page }) => {
    await page.addInitScript(() => window.sessionStorage.setItem('cal.sweep.v1', '1'));
    await installAudit(page);
    await page.goto('/');
    await page.getByTestId('demo-card-edge-ring-etch').click();
    const stage = page.getByTestId('wafer-stage');
    await expect(stage).toHaveAttribute('data-sweep', 'done', { timeout: 8_000 });
    const audit = await readAudit(page);
    expect(audit.states).not.toContain('running');
    expect(audit.states).toContain('ignite');
    expect(audit.captions).not.toContain('Reading…');
  });

  test('A36 (sweep): reduced motion draws every die at once with no sweep frame', async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await installAudit(page);
    await page.goto('/');
    await page.getByTestId('demo-card-edge-ring-etch').click();
    const stage = page.getByTestId('wafer-stage');
    await expect(stage).toHaveAttribute('data-sweep', 'done', { timeout: 8_000 });

    const audit = await readAudit(page);
    expect(audit.states).not.toContain('running');
    expect(audit.states).not.toContain('ignite');
    expect(audit.captions).not.toContain('Reading…');
    const px = await countPixels(page);
    expect(px.ember).toBeGreaterThan(0);
    expect(px.lit).toBe(0);
    // The only motion is the 120 ms base-canvas opacity fade
    await expect
      .poll(
        () =>
          page
            .getByTestId('wafer-base-canvas')
            .evaluate((el) => getComputedStyle(el).opacity),
        { timeout: 500 },
      )
      .toBe('1');
    await expect(page.getByTestId('probe-sweep-skip-hint')).toBeHidden();
  });
});
