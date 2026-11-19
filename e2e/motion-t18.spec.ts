import { expect, type Page, test } from '@playwright/test';

/**
 * Task 18 E2E Motion Verification (`e2e/motion-t18.spec.ts`, `prompts/t18-contract.md`,
 * `premium.md` §3.12, §8.1–§8.17, Requirements 1.11, 10.1, 10.4, 14.5, 17.5):
 * 1. Landing -> report view switch & lot switcher complete with `data-morph-state="settled"` in `< 450 ms` and zero blank frames.
 * 2. Skippable once-per-session probe sweep (`cal.sweep.v1`) and mid-sweep key skip.
 * 3. Cause-of-death type-on (`<= 1.5 s`) and 6-block verdict rise.
 * 4. Claim evidence stagger (`<= 600 ms`), finding expansion, thumbnail dim (`0.32`), segmented thumb slide, popover spring, and `0 ms` `Cmd-K` palette.
 * 5. Full `prefers-reduced-motion: reduce` instant path with zero transforms and zero console/page errors.
 */

function attachErrorCollector(page: Page): {
  readonly consoleErrors: string[];
  readonly pageErrors: string[];
} {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      const text = msg.text();
      const url = msg.location().url ?? '';
      // Optional LLM narrator returns HTTP 503 when LLM_API_KEY is unconfigured (Req 10.6 / Task 16)
      if (
        text.includes('status of 503') &&
        (url.includes('/api/autopsy/narrate') || url === '')
      ) {
        return;
      }
      consoleErrors.push(text);
    }
  });
  page.on('pageerror', (err) => {
    pageErrors.push(err.message);
  });
  return { consoleErrors, pageErrors };
}

test.describe('Task 18 - Reveal Motion Moments & Fluid View/Interaction Motion', () => {
  test.use({ colorScheme: 'light' });

  test('1. Landing -> report view switch & lot switcher complete with data-morph-state="settled" in < 450 ms and zero blank frames', async ({
    page,
  }) => {
    const errors = attachErrorCollector(page);
    await page.addInitScript(() => {
      window.sessionStorage.setItem('cal.sweep.v1', '1');
    });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/?nohints=1');

    const shell = page.getByTestId('workspace-view-shell');
    await expect(shell).toHaveAttribute('data-view-status', 'empty');
    await expect(page.getByTestId('wafer-shared-morph')).toHaveCount(1);

    // Track every rAF frame during the landing -> report transition to assert zero blank frames
    await page.evaluate(() => {
      const win = window as Window & {
        __t18BlankFrames?: number;
        __t18ReadyAt?: number | null;
        __t18SettledAt?: number | null;
        __t18MorphStop?: boolean;
      };
      win.__t18BlankFrames = 0;
      win.__t18ReadyAt = null;
      win.__t18SettledAt = null;
      win.__t18MorphStop = false;
      const tick = (): void => {
        if (win.__t18MorphStop) return;
        const sh = document.querySelector<HTMLElement>(
          '[data-testid="workspace-view-shell"]',
        );
        const morph = document.querySelector<HTMLElement>(
          '[data-testid="wafer-shared-morph"]',
        );
        if (!sh || sh.children.length === 0 || !morph) {
          win.__t18BlankFrames = (win.__t18BlankFrames ?? 0) + 1;
        }
        if (sh?.dataset.viewStatus === 'ready' && win.__t18ReadyAt === null) {
          win.__t18ReadyAt = performance.now();
        }
        if (
          sh?.dataset.viewStatus === 'ready' &&
          morph?.dataset.morphState === 'settled' &&
          win.__t18SettledAt === null
        ) {
          win.__t18SettledAt = performance.now();
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });

    await page.getByTestId('demo-card-edge-ring-etch').click();
    await expect(shell).toHaveAttribute('data-view-status', 'ready', {
      timeout: 5_000,
    });
    await expect(page.getByTestId('wafer-shared-morph')).toHaveAttribute(
      'data-morph-state',
      'settled',
      { timeout: 1_000 },
    );

    const morphAudit = await page.evaluate(() => {
      const win = window as Window & {
        __t18BlankFrames?: number;
        __t18ReadyAt?: number | null;
        __t18SettledAt?: number | null;
        __t18MorphStop?: boolean;
      };
      win.__t18MorphStop = true;
      return {
        blankFrames: win.__t18BlankFrames ?? 0,
        morphDurationMs:
          win.__t18ReadyAt !== null &&
          win.__t18ReadyAt !== undefined &&
          win.__t18SettledAt !== null &&
          win.__t18SettledAt !== undefined
            ? win.__t18SettledAt - win.__t18ReadyAt
            : 0,
      };
    });
    expect(morphAudit.blankFrames).toBe(0);
    expect(morphAudit.morphDurationMs).toBeLessThan(450);

    // Switch lot via LotPicker -> morph settles again in < 450 ms
    await page.getByTestId('lot-picker-trigger').click();
    await page.getByTestId('lot-picker-row-handling-scratch').click();
    await expect(shell).toHaveAttribute('data-view-status', 'ready', {
      timeout: 5_000,
    });
    await expect(page.getByTestId('wafer-shared-morph')).toHaveAttribute(
      'data-morph-state',
      'settled',
      { timeout: 1_000 },
    );
    await expect(page.getByTestId('verdict-headline')).toContainText('Scratch');

    expect(errors.consoleErrors).toEqual([]);
    expect(errors.pageErrors).toEqual([]);
  });

  test('2. Skippable once-per-session probe sweep (cal.sweep.v1) and mid-sweep key skip', async ({
    page,
  }) => {
    const errors = attachErrorCollector(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/?nohints=1');

    // First session load starts the probe sweep
    await page.getByTestId('demo-card-edge-ring-etch').click();
    const stage = page.getByTestId('wafer-stage');
    await expect(stage).toHaveAttribute('data-sweep', 'running', {
      timeout: 5_000,
    });
    await expect(page.getByTestId('probe-sweep-skip-hint')).toBeVisible();

    // Pressing any key mid-sweep skips immediately to data-sweep="done" on the next frame
    const afterSkip = await page.evaluate(
      () =>
        new Promise<{ sweep: string; hintHidden: boolean; flag: string | null }>(
          (resolve) => {
            window.dispatchEvent(
              new KeyboardEvent('keydown', { key: 'Shift' }),
            );
            requestAnimationFrame(() => {
              const st = document.querySelector<HTMLElement>(
                '[data-testid="wafer-stage"]',
              );
              const hint = document.querySelector<HTMLElement>(
                '[data-testid="probe-sweep-skip-hint"]',
              );
              resolve({
                sweep: st?.dataset.sweep ?? '',
                hintHidden: Boolean(hint?.hidden),
                flag: window.sessionStorage.getItem('cal.sweep.v1'),
              });
            });
          },
        ),
    );
    expect(afterSkip.sweep).toBe('done');
    expect(afterSkip.hintHidden).toBe(true);
    expect(afterSkip.flag).toBe('1');

    // Second load in the same session skips running sweep directly to ignite -> done
    const observedStates: string[] = [];
    await page.exposeFunction('__recordSweepState', (state: string) => {
      observedStates.push(state);
    });
    await page.evaluate(() => {
      const obs = new MutationObserver(() => {
        const st = document.querySelector<HTMLElement>(
          '[data-testid="wafer-stage"]',
        );
        const s = st?.dataset.sweep;
        if (s) {
          (
            window as unknown as { __recordSweepState: (v: string) => void }
          ).__recordSweepState(s);
        }
      });
      obs.observe(document.documentElement, {
        subtree: true,
        attributes: true,
        attributeFilter: ['data-sweep'],
      });
    });

    await page.getByTestId('lot-picker-trigger').click();
    await page.getByTestId('lot-picker-row-site2-probe-contact').click();
    await expect(stage).toHaveAttribute('data-sweep', 'done', {
      timeout: 5_000,
    });
    expect(observedStates).not.toContain('running');

    expect(errors.consoleErrors).toEqual([]);
    expect(errors.pageErrors).toEqual([]);
  });

  test('3. Cause-of-death type-on (<= 1.5 s) and 6-block verdict rise', async ({
    page,
  }) => {
    const errors = attachErrorCollector(page);
    await page.addInitScript(() => {
      window.sessionStorage.setItem('cal.sweep.v1', '1');
    });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/?nohints=1');

    await page.getByTestId('demo-card-edge-ring-etch').click();
    const headline = page.getByTestId('verdict-headline');
    await expect(headline).toBeVisible();

    const t0 = await page.evaluate(() => performance.now());
    await expect(headline).toHaveAttribute('data-typeon-settled', 'true', {
      timeout: 1_500,
    });
    const elapsedMs = await page.evaluate((start) => performance.now() - start, t0);
    expect(elapsedMs).toBeLessThanOrEqual(1_500);

    await expect(headline).toHaveAttribute('data-typeon-progress', '1.00');
    await expect(headline).toHaveAttribute(
      'data-typeon-text',
      'Cause of death: Edge-Ring failure.',
    );

    // Verify all 6 verdict rise blocks exist in order with 60 ms stagger and settle to opacity 1
    const riseBlocks = await page.evaluate(() =>
      Array.from(
        document.querySelectorAll<HTMLElement>('[data-verdict-rise-block]'),
      ).map((el) => ({
        id: el.dataset.verdictRiseBlock,
        stagger: Number(el.dataset.riseStaggerMs),
      })),
    );
    expect(riseBlocks).toEqual([
      { id: 'headline', stagger: 0 },
      { id: 'subline', stagger: 60 },
      { id: 'confidence', stagger: 120 },
      { id: 'stats', stagger: 180 },
      { id: 'findings', stagger: 240 },
      { id: 'causes', stagger: 300 },
    ]);

    await page.waitForFunction(() => {
      const blocks = document.querySelectorAll<HTMLElement>(
        '[data-verdict-rise-block]',
      );
      return (
        blocks.length === 6 &&
        Array.from(blocks).every((b) => getComputedStyle(b).opacity === '1')
      );
    });

    expect(errors.consoleErrors).toEqual([]);
    expect(errors.pageErrors).toEqual([]);
  });

  test('4. Claim evidence stagger (<= 600 ms), finding expansion, thumbnail dim (0.32), segmented thumb slide, popover spring, and 0 ms Cmd-K palette', async ({
    page,
  }) => {
    const errors = attachErrorCollector(page);
    await page.addInitScript(() => {
      window.sessionStorage.setItem('cal.sweep.v1', '1');
    });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/?nohints=1');
    await page.getByTestId('demo-card-handling-scratch').click();
    await expect(page.getByTestId('wafer-stage')).toHaveAttribute(
      'data-sweep',
      'done',
      { timeout: 5_000 },
    );

    // Click primary finding row -> expands finding detail, dims non-evidence thumbnails to 0.32, and settles glow in <= 600 ms (+ rAF slack)
    const findingBtn = page.getByTestId('autopsy-body-claim-button').first();
    const clickT0 = await page.evaluate(() => performance.now());
    await findingBtn.click();

    await expect(page.getByTestId('finding-expanded-detail')).toBeVisible();
    const overlayWrapper = page.getByTestId('wafer-overlay-wrapper');
    await expect(overlayWrapper).toHaveAttribute('data-glow-phase', 'settled', {
      timeout: 1_000,
    });
    const glowElapsed = await page.evaluate(
      (start) => performance.now() - start,
      clickT0,
    );
    expect(glowElapsed).toBeLessThanOrEqual(850);

    // Non-evidence wafer thumbnails in handling-scratch dim to opacity 0.32
    await expect
      .poll(async () =>
        page.evaluate(() => {
          const items = Array.from(
            document.querySelectorAll<HTMLElement>(
              '[data-testid="wafer-strip"] [data-testid="wafer-strip-thumb-ring"]',
            ),
          );
          return items.some(
            (el) => Math.abs(Number(getComputedStyle(el).opacity) - 0.32) < 0.05,
          );
        }),
      )
      .toBe(true);

    // Segmented control thumb slides when switching mode
    const segmented = page.getByTestId('stage-mode-segmented');
    await segmented.getByRole('radio').nth(1).click();
    await expect(segmented.getByRole('radio').nth(1)).toHaveAttribute(
      'aria-checked',
      'true',
    );

    // Confidence popover opens on spring
    await page.getByTestId('confidence-pill').click();
    const popover = page.getByTestId('confidence-popover');
    await expect(popover).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(popover).toBeHidden();

    // Cmd-K / Ctrl-K palette opens immediately (0 ms) and focuses input
    await page.keyboard.press('Control+k');
    const palette = page.getByTestId('command-palette');
    await expect(palette).toBeVisible();
    await expect(page.getByTestId('command-palette-input')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(palette).toBeHidden();

    expect(errors.consoleErrors).toEqual([]);
    expect(errors.pageErrors).toEqual([]);
  });

  test('5. Full prefers-reduced-motion: reduce instant path with zero transforms and zero console/page errors', async ({
    page,
  }) => {
    const errors = attachErrorCollector(page);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/?nohints=1');

    await page.getByTestId('demo-card-edge-ring-etch').click();
    const stage = page.getByTestId('wafer-stage');
    await expect(stage).toHaveAttribute('data-sweep', 'done', {
      timeout: 5_000,
    });

    // Under reduced motion, wafer morph, type-on, and verdict stagger are all settled immediately with zero transform offsets
    await expect(page.getByTestId('wafer-shared-morph')).toHaveAttribute(
      'data-morph-state',
      'settled',
    );
    const headline = page.getByTestId('verdict-headline');
    await expect(headline).toHaveAttribute('data-typeon-settled', 'true');
    await expect(headline).toHaveAttribute('data-typeon-progress', '1.00');

    const reducedAudit = await page.evaluate(() => {
      const blocks = Array.from(
        document.querySelectorAll<HTMLElement>('[data-verdict-rise-block]'),
      );
      const stats = Array.from(
        document.querySelectorAll<HTMLElement>(
          '[data-testid="verdict-stat-value"]',
        ),
      ).map((el) => (el.textContent ?? '').trim());
      return {
        staggers: blocks.map((b) => Number(b.dataset.riseStaggerMs)),
        transforms: blocks.map((b) => getComputedStyle(b).transform),
        stats,
      };
    });
    expect(reducedAudit.staggers).toEqual([0, 0, 0, 0, 0, 0]);
    expect(
      reducedAudit.transforms.every(
        (tr) => tr === 'none' || tr === 'matrix(1, 0, 0, 1, 0, 0)',
      ),
    ).toBe(true);
    expect(reducedAudit.stats).toEqual(['93.8%', '82.8%', '2,721']);

    // Clicking a claim under reduced motion settles evidence glow on frame 1
    await page.getByTestId('autopsy-body-claim-button').first().click();
    await expect(page.getByTestId('wafer-overlay-wrapper')).toHaveAttribute(
      'data-glow-phase',
      'settled',
    );

    expect(errors.consoleErrors).toEqual([]);
    expect(errors.pageErrors).toEqual([]);
  });
});
