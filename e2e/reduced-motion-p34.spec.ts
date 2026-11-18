import { expect, type Page, test } from '@playwright/test';

/**
 * Premium P34 (premium §8.16): every row of the reduced-motion table under
 * `prefers-reduced-motion: reduce`, plus A36 (the first screenshot after the lot loads already
 * shows every die, the final stats, and the verdict at full opacity; no sweep frame exists).
 * Each surface is sampled every animation frame inside the page, so the screenshot and
 * Playwright round trips do not skew the timings.
 */

test.use({ reducedMotion: 'reduce' });

/** 120 ms fade plus two frames of slack at 60 Hz. */
const FADE_BOUND_MS = 160;
const BLOCKS = ['headline', 'subline', 'confidence', 'stats', 'findings', 'causes'];
const FINAL_STATS = ['93.8%', '82.8%', '2,721'];
const SHEEN_REST = 'rotate(-24deg)';

interface SurfaceFrame {
  readonly t: number;
  readonly id: number;
  readonly opacity: number;
  readonly scaled: boolean;
  readonly x: number;
  readonly y: number;
}

type SamplerWindow = Window & {
  __p34Frames?: SurfaceFrame[];
  /** Bumped on every start and stop, so an older sampler loop ends on its next frame. */
  __p34Generation?: number;
};

/**
 * Samples every element matching `selector` on each animation frame: effective opacity
 * (own times ancestors), whether it or an ancestor is scaled, and its viewport position.
 */
async function startSampler(page: Page, selector: string): Promise<void> {
  await page.evaluate((sel) => {
    const win = window as SamplerWindow;
    const ids = new WeakMap<Element, number>();
    let nextId = 0;
    const frames: SurfaceFrame[] = [];
    win.__p34Frames = frames;
    const generation = (win.__p34Generation ?? 0) + 1;
    win.__p34Generation = generation;
    const effectiveOpacity = (el: Element): number => {
      let alpha = 1;
      for (let node: Element | null = el; node; node = node.parentElement) {
        const cs = getComputedStyle(node);
        if (cs.visibility === 'hidden' || cs.display === 'none') return 0;
        alpha *= Number(cs.opacity);
      }
      return alpha;
    };
    const isScaled = (el: Element): boolean => {
      for (let node: Element | null = el; node; node = node.parentElement) {
        const cs = getComputedStyle(node);
        if (cs.scale !== 'none' && cs.scale !== '' && cs.scale !== '1') return true;
        if (cs.transform !== 'none') {
          const m = new DOMMatrixReadOnly(cs.transform);
          if (
            Math.abs(Math.hypot(m.a, m.b) - 1) > 0.001 ||
            Math.abs(Math.hypot(m.c, m.d) - 1) > 0.001
          ) {
            return true;
          }
        }
      }
      return false;
    };
    const tick = (t: number): void => {
      if (win.__p34Generation !== generation) return;
      for (const el of Array.from(document.querySelectorAll(sel))) {
        if (!ids.has(el)) ids.set(el, nextId++);
        const r = el.getBoundingClientRect();
        frames.push({
          t,
          id: ids.get(el)!,
          opacity: effectiveOpacity(el),
          scaled: isScaled(el),
          x: r.left,
          y: r.top,
        });
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, selector);
}

async function stopSampler(page: Page): Promise<SurfaceFrame[]> {
  return page.evaluate(() => {
    const win = window as SamplerWindow;
    win.__p34Generation = (win.__p34Generation ?? 0) + 1;
    return win.__p34Frames ?? [];
  });
}

interface SurfaceReport {
  readonly elements: number;
  /** Longest run of frames with a partial opacity (a fade in or out). */
  readonly maxFadeMs: number;
  readonly scaledFrames: number;
  /** Largest move of a visible element away from its first visible position. */
  readonly maxTravelPx: number;
}

function analyse(frames: readonly SurfaceFrame[]): SurfaceReport {
  const byId = new Map<number, SurfaceFrame[]>();
  for (const f of frames) byId.set(f.id, [...(byId.get(f.id) ?? []), f]);
  let maxFadeMs = 0;
  let scaledFrames = 0;
  let maxTravelPx = 0;
  for (const list of byId.values()) {
    let runStart: number | null = null;
    let anchor: SurfaceFrame | null = null;
    for (const f of list) {
      const partial = f.opacity > 0.02 && f.opacity < 0.99;
      if (partial && runStart === null) runStart = f.t;
      if (!partial) {
        if (runStart !== null) maxFadeMs = Math.max(maxFadeMs, f.t - runStart);
        runStart = null;
      }
      if (f.opacity > 0.02) {
        if (f.scaled) scaledFrames += 1;
        anchor ??= f;
        maxTravelPx = Math.max(maxTravelPx, Math.hypot(f.x - anchor.x, f.y - anchor.y));
      }
    }
    if (runStart !== null) maxFadeMs = Math.max(maxFadeMs, list.at(-1)!.t - runStart);
  }
  return { elements: byId.size, maxFadeMs, scaledFrames, maxTravelPx };
}

function expectOpacityOnly(report: SurfaceReport, label: string): void {
  expect(report.elements, `${label}: sampled`).toBeGreaterThan(0);
  expect(report.maxFadeMs, `${label}: fade`).toBeLessThanOrEqual(FADE_BOUND_MS);
  expect(report.scaledFrames, `${label}: scaled frames`).toBe(0);
  expect(report.maxTravelPx, `${label}: travel`).toBeLessThan(0.5);
}

async function loadDemo(page: Page, presetId = 'edge-ring-etch'): Promise<void> {
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
  await page.waitForTimeout(300);
  await page.mouse.move(2, 2);
}

const CAMERA_RE = /translate3d\(([-\d.]+)px,\s*([-\d.]+)px,\s*0(?:px)?\)\s*scale\(([-\d.]+)\)/;

async function readCamera(page: Page): Promise<{ key: string; raw: string }> {
  const raw = await page
    .getByTestId('wafer-camera-wrapper')
    .evaluate((el) => (el as HTMLElement).style.transform);
  const m = CAMERA_RE.exec(raw);
  const key = m
    ? `${Number(m[1]).toFixed(2)},${Number(m[2]).toFixed(2)},${Number(m[3]).toFixed(4)}`
    : 'rest';
  return { key, raw };
}

/** Records the camera transform on every frame until stopped. */
async function startCameraSampler(page: Page): Promise<void> {
  await page.evaluate(() => {
    const win = window as Window & { __p34Camera?: string[]; __p34CameraStop?: boolean };
    win.__p34Camera = [];
    win.__p34CameraStop = false;
    const wrapper = document.querySelector<HTMLElement>('[data-testid="wafer-camera-wrapper"]')!;
    const tick = (): void => {
      if (win.__p34CameraStop) return;
      win.__p34Camera!.push(wrapper.style.transform);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

async function stopCameraSampler(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const win = window as Window & { __p34Camera?: string[]; __p34CameraStop?: boolean };
    win.__p34CameraStop = true;
    // The wrapper holds a transform relative to the last committed raster; when the camera
    // settles the base canvas re-renders at the new camera and the wrapper returns to identity,
    // so identity frames carry no motion and are dropped
    const list = (win.__p34Camera ?? []).filter(
      (v) => v !== '' && v !== 'translate3d(0px, 0px, 0px) scale(1)',
    );
    return list.filter((v, i) => i === 0 || v !== list[i - 1]);
  });
}

/** Decodes two PNG screenshots in the page and compares them pixel by pixel. */
async function compareShots(
  page: Page,
  a: Buffer,
  b: Buffer,
): Promise<{ maxDiff: number; over16: number; emberFirst: number; emberSettled: number }> {
  return page.evaluate(
    async ({ a64, b64 }) => {
      const decode = async (b64png: string): Promise<Uint8ClampedArray> => {
        const img = new Image();
        img.src = `data:image/png;base64,${b64png}`;
        await img.decode();
        const c = document.createElement('canvas');
        c.width = img.width;
        c.height = img.height;
        const ctx = c.getContext('2d')!;
        ctx.drawImage(img, 0, 0);
        return ctx.getImageData(0, 0, c.width, c.height).data;
      };
      const [pa, pb] = await Promise.all([decode(a64), decode(b64)]);
      const isEmber = (d: Uint8ClampedArray, i: number) =>
        d[i]! > 200 && d[i + 1]! > 70 && d[i + 1]! < 150 && d[i + 2]! < 90;
      let maxDiff = 0;
      let over16 = 0;
      let emberFirst = 0;
      let emberSettled = 0;
      for (let i = 0; i < pa.length; i += 4) {
        const d = Math.max(
          Math.abs(pa[i]! - pb[i]!),
          Math.abs(pa[i + 1]! - pb[i + 1]!),
          Math.abs(pa[i + 2]! - pb[i + 2]!),
        );
        maxDiff = Math.max(maxDiff, d);
        if (d > 16) over16 += 1;
        if (isEmber(pa, i)) emberFirst += 1;
        if (isEmber(pb, i)) emberSettled += 1;
      }
      return { maxDiff, over16, emberFirst, emberSettled };
    },
    { a64: a.toString('base64'), b64: b.toString('base64') },
  );
}

test.describe('Premium P34 - reduced motion (§8.16)', () => {
  test('A36 + probe sweep + verdict reveal: no sweep frame; the first screenshot shows the settled report', async ({
    page,
  }) => {
    // First load of the session: the sweep would run without reduced motion
    await page.addInitScript((blockIds: string[]) => {
      const win = window as Window & {
        __p34Load?: {
          sweepStates: string[];
          frames: Array<{ t: number; opacity: number[]; base: number; stats: string[] }>;
        };
      };
      const audit = { sweepStates: [] as string[], frames: [] as Array<{ t: number; opacity: number[]; base: number; stats: string[] }> };
      win.__p34Load = audit;
      const tick = (t: number): void => {
        const stage = document.querySelector<HTMLElement>('[data-testid="wafer-stage"]');
        const state = stage?.dataset.sweep;
        if (state && audit.sweepStates.at(-1) !== state) audit.sweepStates.push(state);
        const blocks = blockIds.map((id) =>
          document.querySelector<HTMLElement>(`[data-verdict-rise-block="${id}"]`),
        );
        const base = document.querySelector<HTMLElement>('[data-testid="wafer-base-canvas"]');
        if (base && blocks.every((b) => b !== null)) {
          audit.frames.push({
            t,
            opacity: blocks.map((b) => Number(getComputedStyle(b!).opacity)),
            base: Number(getComputedStyle(base).opacity),
            stats: Array.from(
              document.querySelectorAll<HTMLElement>('[data-testid="verdict-stat-value"]'),
            ).map((el) => (el.textContent ?? '').trim()),
          });
        }
        if (audit.frames.length < 240) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }, BLOCKS);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/?nohints=1');
    await page.mouse.move(2, 2);
    await page.getByTestId('demo-card-edge-ring-etch').click({ position: { x: 20, y: 20 } });
    await page.mouse.move(2, 2);
    const stage = page.getByTestId('wafer-stage');
    await expect(stage).toHaveAttribute('data-sweep', 'done', { timeout: 5_000 });

    // A36: the first screenshot once the lot has loaded (its one 120 ms fade has ended) already
    // equals the settled view
    await expect
      .poll(
        () =>
          page.getByTestId('wafer-base-canvas').evaluate((el) => getComputedStyle(el).opacity),
        { timeout: 500, intervals: [16] },
      )
      .toBe('1');
    const first = await page.screenshot();
    await page.waitForTimeout(1_200);
    const settled = await page.screenshot();
    await test.info().attach('first', { body: first, contentType: 'image/png' });
    await test.info().attach('settled', { body: settled, contentType: 'image/png' });
    const diff = await compareShots(page, first, settled);
    // Every die, the final stats, and the verdict are already there; the threshold only absorbs
    // compositor rounding on the translucent disc layers
    expect(diff.emberFirst).toBeGreaterThan(1_000);
    expect(diff.emberFirst).toBe(diff.emberSettled);
    expect(diff.over16, `max channel diff ${diff.maxDiff}`).toBe(0);

    const audit = await page.evaluate(
      () =>
        (window as Window & {
          __p34Load?: {
            sweepStates: string[];
            frames: Array<{ t: number; opacity: number[]; base: number; stats: string[] }>;
          };
        }).__p34Load!,
    );
    // Probe sweep: never running or igniting
    expect(audit.sweepStates).not.toContain('running');
    expect(audit.sweepStates).not.toContain('ignite');
    expect(audit.sweepStates.at(-1)).toBe('done');

    // Verdict: all blocks at one opacity, final numbers from the first frame, one fade <= 120 ms
    expect(audit.frames.length).toBeGreaterThan(5);
    for (const f of audit.frames) {
      expect(Math.max(...f.opacity) - Math.min(...f.opacity)).toBeLessThan(0.01);
      if (f.stats.length === 3) expect(f.stats).toEqual(FINAL_STATS);
    }
    const stagger = await page.evaluate(() =>
      Array.from(document.querySelectorAll<HTMLElement>('[data-verdict-rise-block]')).map((el) =>
        Number(el.dataset.riseStaggerMs),
      ),
    );
    expect(stagger).toEqual([0, 0, 0, 0, 0, 0]);
    const fadeSpan = (pick: (f: (typeof audit.frames)[number]) => number): number => {
      const start = audit.frames.find((f) => pick(f) > 0.02);
      const end = audit.frames.find((f) => pick(f) >= 0.99);
      expect(start).toBeDefined();
      expect(end).toBeDefined();
      return end!.t - start!.t;
    };
    expect(fadeSpan((f) => f.opacity[0]!)).toBeLessThanOrEqual(FADE_BOUND_MS);
    expect(fadeSpan((f) => f.base)).toBeLessThanOrEqual(FADE_BOUND_MS);
    await expect(page.getByTestId('probe-sweep-skip-hint')).toBeHidden();
  });

  test('evidence ignite and camera: final alpha at once and a single camera jump', async ({
    page,
  }) => {
    await loadDemo(page, 'handling-scratch');
    const rows = page.getByTestId('autopsy-body-claim-button');
    const zoomValue = page.getByTestId('stage-zoom-value');
    const count = await rows.count();
    let framed = false;
    for (let i = 0; i < count && !framed; i += 1) {
      await startCameraSampler(page);
      const r = await page.evaluate(async (idx) => {
        const button = document.querySelectorAll<HTMLButtonElement>(
          '[data-testid="autopsy-body-claim-button"]',
        )[idx]!;
        const wrapper = document.querySelector<HTMLElement>(
          '[data-testid="wafer-overlay-wrapper"]',
        )!;
        button.click();
        await new Promise((resolve) => requestAnimationFrame(resolve));
        await new Promise((resolve) => requestAnimationFrame(resolve));
        return {
          phase: wrapper.dataset.glowPhase,
          scrim: wrapper.dataset.scrimAlpha,
          lit: wrapper.dataset.litDieCount,
          wafer: wrapper.dataset.waferHighlightCount,
        };
      }, i);
      expect(r.phase).toBe('settled');
      expect(r.scrim).toBe('1.000');
      expect(r.lit).toBe(r.wafer);
      await page.waitForTimeout(400);
      const camera = await stopCameraSampler(page);
      // One jump: at most one camera value between rest and the commit
      expect(camera.length, camera.join(' | ')).toBeLessThanOrEqual(1);
      framed = ((await zoomValue.textContent()) ?? '').trim() !== '100%';
      await rows.nth(i).click();
      await page.waitForTimeout(200);
    }
    expect(framed).toBe(true);
  });

  test('inertia and rubber-band: a drag clamps at the bounds and stops at release', async ({
    page,
  }) => {
    await loadDemo(page);
    const stage = page.getByTestId('wafer-stage');
    await stage.focus();
    await page.keyboard.press('+');
    await page.keyboard.press('+');
    const box = (await stage.boundingBox())!;
    const px = box.x + box.width / 2;
    const py = box.y + box.height / 2;
    await page.mouse.move(px, py);
    await page.mouse.down();
    const during: Array<{ key: string; raw: string }> = [];
    // Rightwards to 20 px short of the viewport edge, well past the pan bound
    const step = (1440 - 20 - px) / 24;
    for (let i = 1; i <= 24; i += 1) {
      await page.mouse.move(px + i * step, py);
      during.push(await readCamera(page));
    }
    // Far past the bounds the camera holds still (clamped, no rubber-band stretch)
    expect(
      new Set(during.slice(-4).map((c) => c.key)).size,
      during.map((c) => c.key).join(' | '),
    ).toBe(1);
    const zoomBefore = await page.getByTestId('stage-zoom-value').textContent();
    await startCameraSampler(page);
    await page.mouse.up();
    await page.waitForTimeout(400);
    const after = await stopCameraSampler(page);
    // No inertia and no spring back: the release value holds until the commit
    expect(after.length, after.join(' | ')).toBeLessThanOrEqual(1);
    if (after.length === 1) expect(after[0]).toBe(during.at(-1)!.raw);
    expect(await page.getByTestId('stage-zoom-value').textContent()).toBe(zoomBefore);
  });

  test('disclosure: siblings snap and the body fades over 120 ms with no travel', async ({
    page,
  }) => {
    await loadDemo(page);
    await startSampler(page, '[data-testid="finding-expanded-detail"]');
    const rowYs = await page.evaluate(async () => {
      const rows = () =>
        Array.from(
          document.querySelectorAll<HTMLElement>('[data-testid="autopsy-body-claim-button"]'),
        );
      const samples: number[][] = [];
      rows()[0]!.click();
      await new Promise<void>((resolve) => {
        const t0 = performance.now();
        const tick = (): void => {
          samples.push(rows().map((r) => Math.round(r.getBoundingClientRect().top)));
          if (performance.now() - t0 < 400) requestAnimationFrame(tick);
          else resolve();
        };
        requestAnimationFrame(tick);
      });
      return samples;
    });
    const report = analyse(await stopSampler(page));
    expectOpacityOnly(report, 'finding detail');
    // Each sibling row takes at most one position change (a snap, no glide)
    for (let i = 1; i < rowYs[0]!.length; i += 1) {
      const ys = new Set(rowYs.map((s) => s[i]));
      expect(ys.size, `row ${i}: ${[...ys].join(',')}`).toBeLessThanOrEqual(2);
    }
  });

  test('wafer switch: a thumbnail click swaps at 0 ms with no crossfade', async ({ page }) => {
    await loadDemo(page);
    await page.evaluate(() => {
      const win = window as Window & { __p34Crossfade?: boolean };
      win.__p34Crossfade = false;
      const cf = document.querySelector<HTMLElement>('[data-testid="wafer-crossfade-canvas"]')!;
      new MutationObserver(() => {
        if (cf.dataset.crossfading === 'true') win.__p34Crossfade = true;
      }).observe(cf, { attributes: true });
    });
    await page.getByTestId('wafer-strip').locator('[role="option"]').nth(2).click();
    await expect(page.getByTestId('wafer-stage')).toHaveAttribute('aria-label', /W03/);
    await page.waitForTimeout(300);
    expect(
      await page.evaluate(
        () => (window as Window & { __p34Crossfade?: boolean }).__p34Crossfade,
      ),
    ).toBe(false);
  });

  test('theme switch: instant, with no view transition', async ({ page }) => {
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
    await loadDemo(page);
    await page.getByTestId('theme-toggle-trigger').click();
    await page.getByTestId('theme-option-light').click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    const state = await page.evaluate(() => ({
      calls: (window as unknown as { __vtCalls: number }).__vtCalls,
      // Everything still animating except the Appearance menu's own 120 ms close fade
      animations: document
        .getAnimations()
        .filter((a) => {
          const effect = a.effect as KeyframeEffect | null;
          const target = effect?.target as Element | null;
          const menuFade =
            target?.closest('[role="menu"]') !== null &&
            Number(effect?.getComputedTiming().duration ?? 0) <= 120 &&
            effect?.getKeyframes().every((k) => Object.keys(k).every((p) =>
              ['opacity', 'offset', 'easing', 'composite', 'computedOffset'].includes(p),
            ));
          return !menuFade;
        })
        .map((a) => (a.effect as KeyframeEffect | null)?.pseudoElement ?? a.constructor.name),
    }));
    expect(state.calls).toBe(0);
    expect(state.animations).toEqual([]);
  });

  test('sheen, card lift, and press scale stay off', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.addInitScript(() => {
      window.sessionStorage.setItem('cal.sweep.v1', '1');
    });
    await page.goto('/?nohints=1');

    // Landing card: no lift on hover, no sheen follow, no press scale
    const card = page.getByTestId('demo-card-handling-scratch');
    await card.scrollIntoViewIfNeeded();
    const restBox = (await card.boundingBox())!;
    await page.mouse.move(restBox.x + 30, restBox.y + 30);
    await page.mouse.move(restBox.x + restBox.width - 30, restBox.y + 60, { steps: 6 });
    await page.waitForTimeout(300);
    expect((await card.boundingBox())!.y).toBeCloseTo(restBox.y, 1);
    expect(
      await page
        .getByTestId('landing-demo-wafer-sheen-ellipse-handling-scratch')
        .evaluate((el) => (el as HTMLElement).style.transform),
    ).toBe(SHEEN_REST);
    await page.mouse.down();
    await page.waitForTimeout(150);
    await startSampler(page, '[data-testid="demo-card-handling-scratch"]');
    await page.waitForTimeout(50);
    expect(analyse(await stopSampler(page)).scaledFrames).toBe(0);
    await page.mouse.move(2, 2);
    await page.mouse.up();

    // Loaded view: the stage sheen rests under the pointer
    await page.getByTestId('demo-card-edge-ring-etch').click();
    await expect(page.getByTestId('wafer-stage')).toHaveAttribute('data-sweep', 'done', {
      timeout: 5_000,
    });
    await page.waitForTimeout(300);
    const disc = (await page.getByTestId('wafer-stage-sheen').boundingBox())!;
    for (let i = 0; i <= 10; i += 1) {
      await page.mouse.move(disc.x + (disc.width * i) / 10, disc.y + disc.height / 2);
    }
    await page.waitForTimeout(300);
    expect(
      await page
        .getByTestId('wafer-stage-sheen-ellipse')
        .evaluate((el) => (el as HTMLElement).style.transform),
    ).toBe(SHEEN_REST);
    await page.mouse.move(2, 2);

    // Press and hold every kind of pressable control: none scales
    const pressables = [
      '[data-testid="verdict-show-on-wafer"]',
      '[data-testid="autopsy-body-claim-button"]',
      '[data-testid="autopsy-hypotheses-toggle"]',
      '[data-testid="verdict-stat-button"]',
      '[data-testid="bin-pareto-row"]',
      '[data-testid="wafer-strip"] [role="option"]',
      '[data-testid="stage-mode-segmented"] [role="radio"]',
      '[data-testid="confidence-pill"]',
      '[data-testid="lot-picker-trigger"]',
      '[data-testid="theme-toggle-trigger"]',
    ];
    for (const selector of pressables) {
      const target = page.locator(selector).last();
      await target.scrollIntoViewIfNeeded();
      const box = (await target.boundingBox())!;
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.waitForTimeout(120);
      await startSampler(page, selector);
      await page.waitForTimeout(50);
      const report = analyse(await stopSampler(page));
      expect(report.scaledFrames, selector).toBe(0);
      // Leave before release so the press does not activate the control
      await page.mouse.move(2, 2);
      await page.mouse.up();
      await page.keyboard.press('Escape');
    }
  });

  test('popovers, menus, tooltips, toasts, and sheets fade opacity only within 120 ms', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.addInitScript(() => {
      window.sessionStorage.setItem('cal.sweep.v1', '1');
    });
    await page.goto('/?nohints=1');
    await expect(page.getByTestId('full-window-drop-zone')).toHaveAttribute(
      'data-dropzone-ready',
      'true',
    );

    // Menu (pointer open and close) and the download toast it triggers
    await startSampler(page, '[role="menu"], [data-sonner-toast]');
    await page.getByTestId('landing-download-demos-trigger').click();
    await page.waitForTimeout(300);
    await Promise.all([
      page.waitForEvent('download'),
      page.getByTestId('download-demo-stdf-edge-ring-etch').click(),
    ]);
    await page.mouse.move(2, 120);
    await page.waitForTimeout(600);
    const menuAndToast = await stopSampler(page);
    expectOpacityOnly(analyse(menuAndToast), 'menu + toast');

    // Error details dialog sheet and its scrim, open and close
    await page.evaluate(() => {
      const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      const file = new File([bytes], 'wafer-photo.png', { type: 'image/png' });
      const evt = new Event('drop', { bubbles: true, cancelable: true });
      Object.defineProperty(evt, 'dataTransfer', {
        value: { types: ['Files'], files: [file] },
      });
      window.dispatchEvent(evt);
    });
    await startSampler(page, '[data-testid="error-details-sheet"], [data-testid="sheet-scrim"]');
    await page.getByTestId('parse-error-show-details').click();
    const sheet = page.getByTestId('error-details-sheet');
    await expect(sheet).toBeVisible();
    await page.waitForTimeout(300);
    await sheet.getByRole('button', { name: 'Close' }).click();
    await expect(sheet).toBeHidden();
    expectOpacityOnly(analyse(await stopSampler(page)), 'sheet');

    // Loaded view: confidence popover and a tooltip
    await page.goto('/?nohints=1');
    await page.getByTestId('demo-card-edge-ring-etch').click();
    await expect(page.getByTestId('wafer-stage')).toHaveAttribute('data-sweep', 'done', {
      timeout: 5_000,
    });
    await page.waitForTimeout(300);
    await startSampler(page, '[data-testid="confidence-popover"]');
    await page.getByTestId('confidence-pill').click();
    await expect(page.getByTestId('confidence-popover')).toBeVisible();
    await page.waitForTimeout(300);
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('confidence-popover')).toBeHidden();
    expectOpacityOnly(analyse(await stopSampler(page)), 'confidence popover');

    await page.mouse.move(2, 400);
    await startSampler(page, '[data-testid="tooltip"]');
    await page.getByTestId('theme-toggle-trigger').hover();
    await expect(page.getByTestId('tooltip')).toBeVisible({ timeout: 3_000 });
    await page.waitForTimeout(300);
    await page.mouse.move(2, 400);
    await expect(page.getByTestId('tooltip')).toBeHidden();
    expectOpacityOnly(analyse(await stopSampler(page)), 'tooltip');
  });

  test.describe('hints', () => {
    // The shared config pre-dismisses every hint; this test starts from cleared storage
    test.use({ storageState: { cookies: [], origins: [] } });

    test('a coach mark fades in over 120 ms with no travel', async ({ page }) => {
      await page.addInitScript(() => {
        window.sessionStorage.setItem('cal.sweep.v1', '1');
      });
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto('/');
      await page.getByTestId('demo-card-edge-ring-etch').click();
      await expect(page.getByTestId('verdict-show-on-wafer')).toBeVisible({ timeout: 10_000 });
      await startSampler(page, '[data-testid="coach-mark"]');
      await expect(page.getByTestId('coach-mark')).toBeVisible({ timeout: 6_000 });
      await page.waitForTimeout(300);
      await page.keyboard.press('Escape');
      await expect(page.getByTestId('coach-mark')).toBeHidden();
      expectOpacityOnly(analyse(await stopSampler(page)), 'coach mark');
    });
  });
});
