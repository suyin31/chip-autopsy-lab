import { expect, type Page, test } from '@playwright/test';

/**
 * Premium P28 (§8.2, §8.16, §11.5): verdict reveal and count-up. Six blocks rise in order on
 * `spring-ui` with a 60 ms stagger and no blur, starting at ignite start; stats count up in their
 * final format without width jitter; input in the verdict column completes everything at once; the
 * verdict part of A36 (reduced motion); the landing percent and the Pareto pills also count.
 */

const BLOCKS = ['headline', 'subline', 'confidence', 'stats', 'findings', 'causes'];

interface RevealFrame {
  t: number;
  sweep: string;
  caption: string;
  opacity: number[];
  translateY: number[];
  filters: string[];
  stats: string[];
  statWidths: number[];
  pills: string[];
}

type RevealWindow = Window & { __calReveal?: RevealFrame[]; __calRevealStop?: boolean };

async function installSampler(page: Page): Promise<void> {
  await page.addInitScript((blockIds: string[]) => {
    const win = window as RevealWindow;
    win.__calReveal = [];
    const sample = (): void => {
      if (win.__calRevealStop) return;
      const blocks = blockIds.map((id) =>
        document.querySelector<HTMLElement>(`[data-verdict-rise-block="${id}"]`),
      );
      if (blocks.every((b) => b !== null)) {
        const statEls = Array.from(
          document.querySelectorAll<HTMLElement>('[data-testid="verdict-stat-value"]'),
        );
        win.__calReveal!.push({
          t: performance.now(),
          sweep:
            document.querySelector<HTMLElement>('[data-testid="wafer-stage"]')?.dataset.sweep ??
            '',
          caption:
            document.querySelector('[data-testid="stage-caption"]')?.textContent?.trim() ?? '',
          opacity: blocks.map((b) => Number(getComputedStyle(b!).opacity)),
          translateY: blocks.map((b) => new DOMMatrix(getComputedStyle(b!).transform).m42),
          filters: blocks.map((b) => getComputedStyle(b!).filter),
          stats: statEls.map((el) => (el.textContent ?? '').trim()),
          statWidths: statEls.map((el) => el.getBoundingClientRect().width),
          pills: Array.from(
            document.querySelectorAll<HTMLElement>('[data-testid="bin-pareto-pill"]'),
          ).map((el) => (el.textContent ?? '').trim()),
        });
      }
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  }, BLOCKS);
}

const readFrames = (page: Page): Promise<RevealFrame[]> =>
  page.evaluate(() => {
    const win = window as RevealWindow;
    win.__calRevealStop = true;
    return win.__calReveal ?? [];
  });

/** Time each block first becomes visible (opacity > 0.02). */
function startTimes(frames: RevealFrame[]): number[] {
  return BLOCKS.map((_, i) => frames.find((f) => f.opacity[i]! > 0.02)?.t ?? Number.NaN);
}

async function openSample(page: Page, sweepSeen: boolean): Promise<void> {
  if (sweepSeen) {
    await page.addInitScript(() => window.sessionStorage.setItem('cal.sweep.v1', '1'));
  }
  await installSampler(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/?nohints=1');
  await page.getByTestId('demo-card-edge-ring-etch').click();
  await expect(page.getByTestId('wafer-stage')).toHaveAttribute('data-sweep', 'done', {
    timeout: 8_000,
  });
}

test.describe('Premium P28 - verdict reveal and count-up', () => {
  test.use({ colorScheme: 'light' });

  test('six blocks rise in order, 60 ms apart, no blur, settled by about 650 ms; stats count in final format', async ({
    page,
  }) => {
    await openSample(page, true);
    await page.waitForTimeout(1_200);
    const frames = await readFrames(page);
    expect(frames.length).toBeGreaterThan(10);

    // The later blocks are still waiting, hidden and 12 px low, on the first sampled frame
    expect(frames[0]!.opacity[5]!).toBeLessThan(0.02);
    expect(frames[0]!.translateY[5]!).toBeCloseTo(12, 1);

    const starts = startTimes(frames);
    for (let i = 1; i < starts.length; i += 1) {
      expect(starts[i]!).toBeGreaterThanOrEqual(starts[i - 1]!);
    }
    // 60 ms apart: the causes trigger starts about 120 ms after the stat row (frame-quantised)
    expect(starts[5]! - starts[3]!).toBeGreaterThan(70);
    expect(starts[5]! - starts[3]!).toBeLessThan(220);

    // No blur at any point
    for (const f of frames) {
      expect(f.filters.every((v) => v === 'none')).toBe(true);
    }

    // All settled by about 650 ms after the first block starts (slack for frame timing)
    const settled = frames.find(
      (f) =>
        f.opacity.every((o) => o > 0.995) && f.translateY.every((y) => Math.abs(y) < 0.1),
    );
    expect(settled).toBeDefined();
    expect(settled!.t - starts[0]!).toBeLessThan(900);
    // Nothing moves backwards: opacity only rises
    for (let i = 0; i < BLOCKS.length; i += 1) {
      for (let k = 1; k < frames.length; k += 1) {
        expect(frames[k]!.opacity[i]!).toBeGreaterThanOrEqual(frames[k - 1]!.opacity[i]! - 1e-3);
      }
    }

    // Count-up: from 0 to the value, in the final format at every step, never past it
    const statFrames = frames.filter((f) => f.stats.length === 3);
    expect(statFrames[0]!.stats).toEqual(['0.0%', '0.0%', '0']);
    expect(statFrames.at(-1)!.stats).toEqual(['93.8%', '82.8%', '2,721']);
    const intermediate = statFrames.filter(
      (f) => f.stats[2] !== '0' && f.stats[2] !== '2,721',
    );
    expect(intermediate.length).toBeGreaterThan(3);
    for (const f of statFrames) {
      expect(f.stats[0]).toMatch(/^\d{1,2}\.\d%$/);
      expect(f.stats[1]).toMatch(/^\d{1,2}\.\d%$/);
      expect(f.stats[2]).toMatch(/^\d{1,3}(,\d{3})*$/);
      expect(Number(f.stats[2]!.replace(/,/g, ''))).toBeLessThanOrEqual(2721);
    }
    // The count starts with the stat block, and the width never jitters
    const firstCount = statFrames.find((f) => f.stats[2] !== '0')!;
    expect(firstCount.t).toBeGreaterThanOrEqual(starts[3]! - 20);
    const widths = statFrames[0]!.statWidths;
    for (const f of statFrames) {
      f.statWidths.forEach((w, i) => expect(Math.abs(w - widths[i]!)).toBeLessThan(0.5));
    }

    // Switching wafers does not replay the reveal
    await page.locator('[data-testid="wafer-strip"] [role="option"]').nth(1).click();
    await page.waitForTimeout(100);
    const after = await page.evaluate(() =>
      Array.from(document.querySelectorAll<HTMLElement>('[data-verdict-rise-block]')).map(
        (el) => getComputedStyle(el).opacity,
      ),
    );
    expect(after).toEqual(['1', '1', '1', '1', '1', '1']);
  });

  test('the first load starts the reveal at ignite start, not during the sweep', async ({
    page,
  }) => {
    await openSample(page, false);
    await page.waitForTimeout(900);
    const frames = await readFrames(page);
    const reading = frames.filter((f) => f.caption === 'Reading…');
    expect(reading.length).toBeGreaterThan(5);
    for (const f of reading) {
      expect(Math.max(...f.opacity)).toBeLessThan(0.02);
    }
    const igniteAt = frames.find((f) => f.sweep === 'running' && f.caption !== 'Reading…')?.t;
    const firstBlock = startTimes(frames)[0]!;
    expect(igniteAt).toBeDefined();
    expect(firstBlock - igniteAt!).toBeLessThan(120);
  });

  test('input in the verdict column completes every block and count at once', async ({ page }) => {
    await page.addInitScript(() => window.sessionStorage.setItem('cal.sweep.v1', '1'));
    await installSampler(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/?nohints=1');
    await page.getByTestId('demo-card-edge-ring-etch').click();
    const takeaway = page.getByTestId('verdict-subline');
    await takeaway.waitFor({ state: 'attached' });
    const box = (await takeaway.boundingBox())!;
    await page.mouse.move(box.x + 8, box.y + box.height / 2);
    await page.mouse.down();
    const pressedAt = await page.evaluate(() => performance.now());
    await page.mouse.up();
    await page.waitForTimeout(300);
    const frames = await readFrames(page);

    // The press landed while the reveal was still running
    const before = frames.filter((f) => f.t < pressedAt);
    expect(before.some((f) => f.opacity.some((o) => o < 0.99))).toBe(true);
    // Within two frames of the press: every block final and every number final
    const done = frames.find(
      (f) =>
        f.t > pressedAt &&
        f.opacity.every((o) => o === 1) &&
        f.translateY.every((y) => y === 0) &&
        f.stats.join() === '93.8%,82.8%,2,721',
    );
    expect(done).toBeDefined();
    expect(done!.t - pressedAt).toBeLessThan(50);
    for (const f of frames.filter((fr) => fr.t >= done!.t)) {
      expect(f.opacity.every((o) => o === 1)).toBe(true);
      expect(f.stats).toEqual(['93.8%', '82.8%', '2,721']);
    }
  });

  test('A36 (verdict): reduced motion fades every block together in 120 ms with final numbers', async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await openSample(page, false);
    await page.waitForTimeout(300);
    const frames = await readFrames(page);
    const stagger = await page.evaluate(() =>
      Array.from(document.querySelectorAll<HTMLElement>('[data-verdict-rise-block]')).map((el) =>
        Number(el.dataset.riseStaggerMs),
      ),
    );
    expect(stagger).toEqual([0, 0, 0, 0, 0, 0]);
    for (const f of frames) {
      // No movement, all blocks at one opacity, numbers final from the first frame
      expect(f.translateY.every((y) => y === 0)).toBe(true);
      expect(Math.max(...f.opacity) - Math.min(...f.opacity)).toBeLessThan(0.01);
      if (f.stats.length === 3) expect(f.stats).toEqual(['93.8%', '82.8%', '2,721']);
    }
    const first = frames.find((f) => f.opacity[0]! > 0.02)!;
    const full = frames.find((f) => f.opacity.every((o) => o === 1))!;
    expect(full.t - first.t).toBeLessThan(200);
    await page.screenshot({ path: 'test-results/p28-reduced-1440.png' });
  });

  test('§11.5: the landing percent and the yield-loss pills count up; the percent sign stays', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      window.sessionStorage.setItem('cal.sweep.v1', '1');
      const win = window as Window & { __calLanding?: string[] };
      win.__calLanding = [];
      const sample = (): void => {
        const el = document.querySelector('[data-testid="landing-example-percent"]');
        if (el) win.__calLanding!.push((el.textContent ?? '').trim());
        if (win.__calLanding!.length < 120) requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    });
    await installSampler(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/?nohints=1');
    await expect(page.getByTestId('landing-example-fact')).toHaveText(
      '93.8% of fails sit in the outer 3 rings.',
    );
    const landing = await page.evaluate(
      () => (window as Window & { __calLanding?: string[] }).__calLanding ?? [],
    );
    expect(landing.every((v) => /^\d{1,2}\.\d%$/.test(v))).toBe(true);
    expect(new Set(landing).size).toBeGreaterThan(3);
    expect(landing.at(-1)).toBe('93.8%');

    await page.getByTestId('demo-card-edge-ring-etch').click();
    await expect(page.getByTestId('wafer-stage')).toHaveAttribute('data-sweep', 'done');
    await page.waitForTimeout(900);
    const frames = await readFrames(page);
    const pillFrames = frames.filter((f) => f.pills.length > 0);
    const finalPills = pillFrames.at(-1)!.pills;
    expect(pillFrames.some((f) => f.pills[0] !== finalPills[0])).toBe(true);
    for (const f of pillFrames) {
      for (const p of f.pills) expect(p).toMatch(/^\d{1,3}\.\d%$/);
    }
    // A mode switch shows the other kind's pills at once (§8.14)
    await page.getByTestId('bin-pareto-mode').getByRole('radio').nth(1).click();
    const pillsNow = await page
      .getByTestId('bin-pareto-pill')
      .evaluateAll((els) => els.map((el) => el.textContent ?? ''));
    expect(pillsNow.every((p) => p !== '0.0%')).toBe(true);
  });
});
