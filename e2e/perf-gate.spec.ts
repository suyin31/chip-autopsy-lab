import { expect, test } from '@playwright/test';

interface PerfGateReport {
  readonly timeToVerdictMs: number;
  readonly sweepDurationMs: number;
  readonly observerEntryType: string;
  readonly longFramesOver50Ms: number;
  readonly maxLongFrameMs: number;
  readonly rafSampleCount: number;
  readonly medianRafMs: number;
  readonly p95RafMs: number;
  readonly maxRafMs: number;
  readonly maxAckMs: number;
  readonly ackSamplesMs: readonly number[];
}

test.describe('Redesign R8 — Reveal motion, reduced motion, visual fixes, and §5.10 perf gate', () => {
  test('passes §5.10 perf gate (0 frames > 50 ms, median rAF < 20 ms, p95 < 34 ms, ack < 100 ms) and sweeps in <= 1.2 s with verdict < 3 s', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');

    // Track exact client mount-to-sweep-done window via MutationObserver inside page
    await page.evaluate(() => {
      const win = window as Window & {
        __calSweepStartMs?: number;
        __calSweepDoneMs?: number;
      };
      const obs = new MutationObserver(() => {
        const stage = document.querySelector<HTMLElement>(
          '[data-testid="wafer-stage"]',
        );
        if (!stage) return;
        if (win.__calSweepStartMs === undefined) {
          win.__calSweepStartMs = performance.now();
        }
        if (
          stage.dataset.sweep === 'done' &&
          win.__calSweepDoneMs === undefined
        ) {
          win.__calSweepDoneMs = performance.now();
          obs.disconnect();
        }
      });
      obs.observe(document.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['data-sweep'],
      });
    });

    // 1. Load /, click edge-ring-etch card, wait for verdict-headline visible and data-sweep="done"
    const clickStartMs = await page.evaluate(() => performance.now());
    await page.getByTestId('demo-card-edge-ring-etch').click();

    const verdictHeadline = page.getByTestId('verdict-headline');
    const stage = page.getByTestId('wafer-stage');
    await expect(verdictHeadline).toBeVisible({ timeout: 3_000 });
    const verdictVisibleMs = await page.evaluate(() => performance.now());
    const timeToVerdictMs = Math.round(verdictVisibleMs - clickStartMs);
    expect(timeToVerdictMs).toBeLessThan(3_000);

    await expect(stage).toHaveAttribute('data-sweep', 'done', {
      timeout: 3_000,
    });
    const sweepDurationMs = await page.evaluate(() => {
      const win = window as Window & {
        __calSweepStartMs?: number;
        __calSweepDoneMs?: number;
      };
      if (
        win.__calSweepStartMs !== undefined &&
        win.__calSweepDoneMs !== undefined
      ) {
        return Math.round(win.__calSweepDoneMs - win.__calSweepStartMs);
      }
      return 0;
    });
    expect(sweepDurationMs).toBeGreaterThan(200);
    expect(sweepDurationMs).toBeLessThanOrEqual(1_250);

    // Wait briefly for initial verdict rise-in + count-up to settle before starting interaction recorder
    await page.waitForTimeout(450);

    // 2. Inject §5.10 recorder: PerformanceObserver on long-animation-frame (fallback longtask), buffered; + rAF delta loop + ack tracker
    await page.evaluate(() => {
      interface PerfHarness {
        startMs: number;
        observerType: string;
        longDurations: Array<{ startTime: number; duration: number }>;
        rafDeltas: number[];
        ackLatencies: number[];
        stop: () => {
          observerType: string;
          longOver50: number[];
          rafDeltas: number[];
          ackLatencies: number[];
        };
      }

      const startMs = performance.now();
      const longDurations: Array<{ startTime: number; duration: number }> = [];
      const rafDeltas: number[] = [];
      const ackLatencies: number[] = [];
      let observerType = 'none';
      let observer: PerformanceObserver | null = null;

      const supported =
        typeof PerformanceObserver !== 'undefined' &&
        Array.isArray(PerformanceObserver.supportedEntryTypes)
          ? PerformanceObserver.supportedEntryTypes
          : [];

      const targetType = supported.includes('long-animation-frame')
        ? 'long-animation-frame'
        : supported.includes('longtask')
          ? 'longtask'
          : null;

      if (targetType) {
        observerType = targetType;
        observer = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            longDurations.push({
              startTime: entry.startTime,
              duration: entry.duration,
            });
          }
        });
        observer.observe({ type: targetType, buffered: true });
      }

      // Measure first visual handler acknowledgement (data-ack timestamp vs event.timeStamp, §5.10 step 5)
      const captureAck = (evt: Event): void => {
        const tEvent = evt.timeStamp > 0 ? evt.timeStamp : performance.now();
        queueMicrotask(() => {
          const target = evt.target instanceof Element ? evt.target : null;
          const ackHost = target?.closest<HTMLElement>('[data-ack]');
          if (ackHost?.dataset.ack) {
            const ackTs = Number(ackHost.dataset.ack);
            if (Number.isFinite(ackTs) && ackTs >= tEvent - 2) {
              ackLatencies.push(Math.max(0, ackTs - tEvent));
            }
          }
        });
      };
      window.addEventListener('pointerdown', captureAck, false);
      window.addEventListener('keydown', captureAck, false);

      let running = true;
      let prevFrame = performance.now();
      let rafId = 0;
      const loop = (now: number): void => {
        if (!running) return;
        rafDeltas.push(now - prevFrame);
        prevFrame = now;
        rafId = requestAnimationFrame(loop);
      };
      rafId = requestAnimationFrame((firstNow) => {
        prevFrame = firstNow;
        rafId = requestAnimationFrame(loop);
      });

      (window as Window & { __calPerfHarness?: PerfHarness }).__calPerfHarness =
        {
          startMs,
          observerType,
          longDurations,
          rafDeltas,
          ackLatencies,
          stop: () => {
            running = false;
            cancelAnimationFrame(rafId);
            window.removeEventListener('pointerdown', captureAck, false);
            window.removeEventListener('keydown', captureAck, false);
            if (observer) {
              for (const entry of observer.takeRecords()) {
                longDurations.push({
                  startTime: entry.startTime,
                  duration: entry.duration,
                });
              }
              observer.disconnect();
            }
            const endMs = performance.now();
            const windowEntries = longDurations.filter(
              (e) => e.startTime >= startMs && e.startTime <= endMs,
            );
            return {
              observerType,
              longOver50: windowEntries
                .filter((e) => e.duration > 50)
                .map((e) => Number(e.duration.toFixed(2))),
              rafDeltas,
              ackLatencies,
            };
          },
        };
    });

    // 3. Script interactions (§5.10 step 3)
    const stageBox = (await stage.boundingBox())!;
    const cx = stageBox.x + stageBox.width / 2;
    const cy = stageBox.y + stageBox.height / 2;

    // 3a. 12 wheel events (deltaY: -120, 50 ms apart) over wafer centre
    await page.mouse.move(cx, cy);
    for (let i = 0; i < 12; i += 1) {
      await page.mouse.wheel(0, -120);
      await page.waitForTimeout(50);
    }

    // 3b. 2 mouse drags of 200 px in 300 ms with 20 move steps
    for (let dragIdx = 0; dragIdx < 2; dragIdx += 1) {
      const dir = dragIdx === 0 ? 1 : -1;
      await page.mouse.move(cx, cy);
      await page.mouse.down();
      for (let s = 1; s <= 20; s += 1) {
        const frac = s / 20;
        await page.mouse.move(cx + dir * 200 * frac, cy + dir * 60 * frac);
        await page.waitForTimeout(15);
      }
      await page.mouse.up();
    }

    // 3c. Double-click
    await stage.dblclick({
      position: { x: stageBox.width / 2, y: stageBox.height / 2 },
    });

    // 3d. Focus the strip and press ArrowRight 10 times 80 ms apart
    const firstStripOption = page
      .getByTestId('wafer-strip')
      .locator('[role="option"]')
      .first();
    await firstStripOption.focus();
    for (let i = 0; i < 10; i += 1) {
      await page.keyboard.press('ArrowRight');
      await page.waitForTimeout(80);
    }

    // 3e. Click finding 1, wait 700 ms, click it again
    const finding1 = page.getByTestId('autopsy-body-claim-button').first();
    await finding1.click();
    await page.waitForTimeout(700);
    await finding1.click();

    // 3f. Shift+drag a 200 x 160 rect
    const rectStartX = cx - 100;
    const rectStartY = cy - 80;
    await page.mouse.move(rectStartX, rectStartY);
    await page.keyboard.down('Shift');
    await page.mouse.down();
    await page.mouse.move(rectStartX + 200, rectStartY + 160, { steps: 12 });
    await page.mouse.up();
    await page.keyboard.up('Shift');

    // 4. Stop after last action + 500 ms
    await page.waitForTimeout(500);

    const rawMetrics = await page.evaluate(() => {
      const win = window as Window & {
        __calPerfHarness?: {
          stop: () => {
            observerType: string;
            longOver50: number[];
            rafDeltas: number[];
            ackLatencies: number[];
          };
        };
      };
      return win.__calPerfHarness!.stop();
    });

    const sortedRaf = [...rawMetrics.rafDeltas].sort((a, b) => a - b);
    const percentile = (arr: readonly number[], p: number): number => {
      if (arr.length === 0) return 0;
      const idx = Math.min(
        arr.length - 1,
        Math.max(0, Math.floor(p * (arr.length - 1))),
      );
      return Number(arr[idx]!.toFixed(2));
    };

    const report: PerfGateReport = {
      timeToVerdictMs,
      sweepDurationMs,
      observerEntryType: rawMetrics.observerType,
      longFramesOver50Ms: rawMetrics.longOver50.length,
      maxLongFrameMs:
        rawMetrics.longOver50.length > 0
          ? Math.max(...rawMetrics.longOver50)
          : 0,
      rafSampleCount: sortedRaf.length,
      medianRafMs: percentile(sortedRaf, 0.5),
      p95RafMs: percentile(sortedRaf, 0.95),
      maxRafMs: percentile(sortedRaf, 1),
      maxAckMs:
        rawMetrics.ackLatencies.length > 0
          ? Number(Math.max(...rawMetrics.ackLatencies).toFixed(2))
          : 0,
      ackSamplesMs: rawMetrics.ackLatencies.map((n) => Number(n.toFixed(2))),
    };

    // 6. Log numbers for logs/
    console.log('[PERF_GATE_METRICS]', JSON.stringify(report));

    // 5. Assert §5.10 perf gate thresholds
    expect(report.rafSampleCount).toBeGreaterThan(30);
    expect(report.longFramesOver50Ms).toBe(0);
    expect(report.medianRafMs).toBeLessThan(20);
    expect(report.p95RafMs).toBeLessThan(34);
    expect(report.ackSamplesMs.length).toBeGreaterThan(0);
    expect(report.maxAckMs).toBeLessThan(100);
  });

  test('skips probe sweep on any key, fades on second load, and verifies visual-acceptance (a)–(h)', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');

    // (b) Nav Open STDF hidden on landing; (c) premium §6.1 152px landing wafer at 1440 without boxed bg-bg
    await expect(page.getByTestId('nav-open-stdf')).toHaveCount(0);
    const thumbBox = await page
      .getByTestId('landing-demo-wafer-edge-ring-etch')
      .boundingBox();
    expect(Math.round(thumbBox!.width)).toBe(152);
    expect(Math.round(thumbBox!.height)).toBe(152);

    // Click demo card -> catch running sweep -> skip immediately with Space key
    await page.getByTestId('demo-card-edge-ring-etch').click();
    const stage = page.getByTestId('wafer-stage');
    await expect(stage).toBeVisible({ timeout: 3_000 });

    await page.keyboard.press('Space');
    await expect(stage).toHaveAttribute('data-sweep', 'done', {
      timeout: 200,
    });
    await expect(page.getByTestId('verdict-headline')).toBeVisible();

    // (a)/(h) Nav Open STDF font-size 14px <= 15px wordmark; (f) strip mask-image; (g) tightened stat tracking + tabular-nums
    const desktopChecks = await page.evaluate(() => {
      const navOpen = document.querySelector<HTMLElement>(
        '[data-testid="nav-open-stdf"]',
      )!;
      const wordmark = document.querySelector<HTMLElement>(
        '[data-testid="nav-wordmark"]',
      )!;
      const strip = document.querySelector<HTMLElement>(
        '[data-testid="wafer-strip"]',
      )!;
      const statDd = document.querySelector<HTMLElement>(
        '[data-testid="verdict-stat-item"] dd',
      )!;
      const stripStyle = getComputedStyle(strip);
      const statStyle = getComputedStyle(statDd);
      return {
        navOpenFontPx: Number.parseFloat(getComputedStyle(navOpen).fontSize),
        wordmarkFontPx: Number.parseFloat(getComputedStyle(wordmark).fontSize),
        stripMask:
          stripStyle.maskImage ||
          stripStyle.getPropertyValue('-webkit-mask-image'),
        statLetterSpacingPx: Number.parseFloat(statStyle.letterSpacing),
        statFontVariantNumeric: statStyle.fontVariantNumeric,
      };
    });
    expect(desktopChecks.navOpenFontPx).toBe(14);
    expect(desktopChecks.navOpenFontPx).toBeLessThanOrEqual(
      desktopChecks.wordmarkFontPx,
    );
    expect(desktopChecks.stripMask).toContain('linear-gradient');
    expect(desktopChecks.statLetterSpacingPx).toBeLessThan(0);
    expect(desktopChecks.statFontVariantNumeric).toContain('tabular-nums');

    // Second lot load in same session uses 240 ms fade (never re-enters data-sweep="running")
    await page.getByTestId('lot-picker-trigger').click();
    await page
      .getByRole('menuitemradio', { name: /Robotic Handling Scratch/i })
      .click();
    await expect(page.getByTestId('verdict-headline')).toContainText(
      'Scratch failure.',
      { timeout: 3_000 },
    );
    await expect(stage).toHaveAttribute('data-sweep', 'done');

    // Mobile 390x844 checks: (d) the segmented control sits in the control row >= 12px below the wafer disc (premium §5.6); (e) only the active strip label is visible (premium §5.8)
    await page.setViewportSize({ width: 390, height: 844 });
    // Wait for the resize observer to refit the disc to the 390 x 390 stage (premium §6.2)
    await expect
      .poll(async () =>
        Math.round(
          await page
            .getByTestId('wafer-stage-sheen')
            .evaluate((el) => el.getBoundingClientRect().width),
        ),
      )
      .toBe(350);
    const mobileChecks = await page.evaluate(() => {
      const seg = document.querySelector<HTMLElement>(
        '[data-testid="stage-mode-segmented"]',
      )!;
      const disc = document.querySelector<HTMLElement>(
        '[data-testid="wafer-stage-sheen"]',
      )!;
      const stripLabels = Array.from(
        document.querySelectorAll<HTMLElement>(
          '[data-testid="wafer-strip"] [role="option"] bdi',
        ),
      );
      const visibleLabelCount = stripLabels.filter(
        (el) => el.getBoundingClientRect().width > 0,
      ).length;
      return {
        gapBelowDiscPx:
          seg.getBoundingClientRect().top - disc.getBoundingClientRect().bottom,
        visibleLabelCount,
      };
    });
    expect(mobileChecks.gapBelowDiscPx).toBeGreaterThanOrEqual(12);
    expect(mobileChecks.visibleLabelCount).toBe(1);
  });

  test('disables sweep, stagger, and count-up under prefers-reduced-motion: reduce', async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');

    // Watch every mutation from click onward to prove data-sweep NEVER enters "running" and stats NEVER show 0
    await page.evaluate(() => {
      const win = window as Window & {
        __calReducedAudit?: {
          sawSweepRunning: boolean;
          firstStatSnapshot: string[];
        };
      };
      win.__calReducedAudit = {
        sawSweepRunning: false,
        firstStatSnapshot: [],
      };
      const obs = new MutationObserver(() => {
        const stage = document.querySelector<HTMLElement>(
          '[data-testid="wafer-stage"]',
        );
        if (stage?.dataset.sweep === 'running') {
          win.__calReducedAudit!.sawSweepRunning = true;
        }
        if (win.__calReducedAudit!.firstStatSnapshot.length === 0) {
          const vals = Array.from(
            document.querySelectorAll<HTMLElement>(
              '[data-testid="verdict-stat-value"]',
            ),
          ).map((el) => (el.textContent ?? '').trim());
          if (vals.length === 3) {
            win.__calReducedAudit!.firstStatSnapshot = vals;
          }
        }
      });
      obs.observe(document.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
        characterData: true,
      });
    });

    await page.getByTestId('demo-card-edge-ring-etch').click();
    const stage = page.getByTestId('wafer-stage');
    await expect(stage).toHaveAttribute('data-sweep', 'done', {
      timeout: 3_000,
    });
    await expect(page.getByTestId('verdict-headline')).toBeVisible();

    const reducedAudit = await page.evaluate(() => {
      const win = window as Window & {
        __calReducedAudit?: {
          sawSweepRunning: boolean;
          firstStatSnapshot: string[];
        };
      };
      const staggerDelays = Array.from(
        document.querySelectorAll<HTMLElement>('[data-verdict-rise-block]'),
      ).map((el) => Number(el.dataset.riseStaggerMs ?? -1));
      const currentStats = Array.from(
        document.querySelectorAll<HTMLElement>(
          '[data-testid="verdict-stat-value"]',
        ),
      ).map((el) => (el.textContent ?? '').trim());
      return {
        sawSweepRunning: win.__calReducedAudit?.sawSweepRunning ?? false,
        firstStatSnapshot: win.__calReducedAudit?.firstStatSnapshot ?? [],
        staggerDelays,
        currentStats,
      };
    });

    expect(reducedAudit.sawSweepRunning).toBe(false);
    expect(reducedAudit.staggerDelays).toEqual([0, 0, 0, 0, 0, 0]);
    expect(reducedAudit.firstStatSnapshot).toEqual([
      '93.8%',
      '82.8%',
      '2,721',
    ]);
    expect(reducedAudit.currentStats).toEqual(['93.8%', '82.8%', '2,721']);
  });
});
