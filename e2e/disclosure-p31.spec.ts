import { expect, type Page, test } from '@playwright/test';

/**
 * Premium P31 (premium.md §8.6, §8.7): disclosure bodies mount in flow and fade while the
 * siblings glide with `layout="position"`, so no two visible text boxes overlap and no text is
 * scaled at any frame (A31); thumbnail clicks cross-fade the wafer, wafer keys swap at 0 ms.
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
  await page.waitForTimeout(800); // verdict rise-in settles
}

interface FrameReport {
  readonly t: number;
  readonly overlaps: number;
  readonly scaled: number;
  readonly sample: string;
  readonly boxes: number;
}

/**
 * Clicks `selector[index]` (a programmatic click, so no press scale) and samples every animation
 * frame for 400 ms, which covers the A31 frames at 0, 40, 80, 120, 200, and 320 ms. Each frame
 * counts intersecting visible text boxes and scaled text inside the report column.
 */
async function sampleDisclosure(page: Page, selector: string, index: number): Promise<FrameReport[]> {
  return page.evaluate(
    async ({ selector: sel, index: idx }) => {
      const findings = document.querySelector('[data-testid="verdict-findings-section"]')!;
      const causes = document.querySelector('[data-testid="possible-causes-block"]');
      let scope: Element = findings;
      while (causes && scope.parentElement && !scope.contains(causes)) scope = scope.parentElement;

      const effectiveOpacity = (el: Element | null): number => {
        let alpha = 1;
        for (let node = el; node; node = node.parentElement) {
          const cs = getComputedStyle(node);
          if (cs.visibility === 'hidden' || cs.display === 'none') return 0;
          alpha *= Number(cs.opacity);
        }
        return alpha;
      };
      const isScaled = (el: Element | null): boolean => {
        for (let node = el; node; node = node.parentElement) {
          const cs = getComputedStyle(node);
          if (cs.scale !== 'none' && cs.scale !== '' && cs.scale !== '1') return true;
          if (cs.transform !== 'none') {
            const m = new DOMMatrixReadOnly(cs.transform);
            if (Math.abs(Math.hypot(m.a, m.b) - 1) > 0.001 || Math.abs(Math.hypot(m.c, m.d) - 1) > 0.001) {
              return true;
            }
          }
        }
        return false;
      };
      const clipRect = (el: Element, rect: DOMRect) => {
        let { left, top, right, bottom } = rect;
        for (let node = el.parentElement; node; node = node.parentElement) {
          const cs = getComputedStyle(node);
          if (cs.overflowX !== 'visible' || cs.overflowY !== 'visible') {
            const r = node.getBoundingClientRect();
            left = Math.max(left, r.left);
            top = Math.max(top, r.top);
            right = Math.min(right, r.right);
            bottom = Math.min(bottom, r.bottom);
          }
        }
        return { left, top, right, bottom };
      };

      const collect = (t: number) => {
        const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
        const range = document.createRange();
        const boxes: { node: number; text: string; r: { left: number; top: number; right: number; bottom: number } }[] = [];
        let scaled = 0;
        let nodeIndex = 0;
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          nodeIndex += 1;
          const parent = node.parentElement;
          if (!parent || !node.nodeValue || node.nodeValue.trim() === '') continue;
          if (effectiveOpacity(parent) < 0.01) continue;
          range.selectNodeContents(node);
          let visible = false;
          for (const rect of Array.from(range.getClientRects())) {
            const r = clipRect(parent, rect);
            if (r.right - r.left <= 1 || r.bottom - r.top <= 1) continue;
            visible = true;
            boxes.push({ node: nodeIndex, text: node.nodeValue.trim().slice(0, 24), r });
          }
          if (visible && isScaled(parent)) scaled += 1;
        }
        let overlaps = 0;
        let sample = '';
        for (let i = 0; i < boxes.length; i += 1) {
          for (let j = i + 1; j < boxes.length; j += 1) {
            const a = boxes[i]!;
            const b = boxes[j]!;
            if (a.node === b.node) continue;
            const w = Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left);
            const h = Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top);
            if (w > 0.5 && h > 0.5) {
              overlaps += 1;
              if (!sample) sample = `"${a.text}" x "${b.text}"`;
            }
          }
        }
        return { t, overlaps, scaled, sample, boxes: boxes.length };
      };

      const trigger = document.querySelectorAll<HTMLElement>(sel)[idx]!;
      const frames = [];
      const t0 = performance.now();
      trigger.click();
      frames.push(collect(0));
      await new Promise<void>((resolve) => {
        const tick = () => {
          const t = performance.now() - t0;
          frames.push(collect(Math.round(t)));
          if (t < 400) requestAnimationFrame(tick);
          else resolve();
        };
        requestAnimationFrame(tick);
      });
      return frames;
    },
    { selector, index },
  );
}

function expectCleanFrames(frames: readonly FrameReport[]) {
  expect(frames.length).toBeGreaterThanOrEqual(6);
  expect(frames.at(-1)!.t).toBeGreaterThanOrEqual(320);
  for (const frame of frames) {
    expect(frame.boxes).toBeGreaterThan(10);
    expect(frame, `frame at ${frame.t} ms: ${frame.sample}`).toMatchObject({ overlaps: 0, scaled: 0 });
  }
}

test.describe('Premium P31 - disclosure and wafer switching', () => {
  test('A31: expanding, switching, and collapsing a finding never overlaps or scales text', async ({
    page,
  }) => {
    await loadDemo(page, 'edge-ring-etch');
    const rows = page.getByTestId('autopsy-body-claim-button');
    const rowSelector = '[data-testid="autopsy-body-claim-button"]';

    // Expand the first finding
    expectCleanFrames(await sampleDisclosure(page, rowSelector, 0));
    await expect(rows.nth(0)).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByTestId('finding-expanded-detail')).toHaveCount(1);
    await expect
      .poll(() =>
        page
          .getByTestId('finding-chevron')
          .nth(0)
          .evaluate((el) => new DOMMatrixReadOnly(getComputedStyle(el).transform).a),
      )
      .toBeCloseTo(-1, 2); // rotate(180deg)

    // Accordion: opening the second closes the first in the same frame
    expectCleanFrames(await sampleDisclosure(page, rowSelector, 1));
    await expect(rows.nth(1)).toHaveAttribute('aria-expanded', 'true');
    await expect(rows.nth(0)).toHaveAttribute('aria-expanded', 'false');
    await expect(page.getByTestId('finding-expanded-detail')).toHaveCount(1);

    // Collapse
    expectCleanFrames(await sampleDisclosure(page, rowSelector, 1));
    await expect(rows.nth(1)).toHaveAttribute('aria-expanded', 'false');
    await expect(page.getByTestId('finding-expanded-detail')).toHaveCount(0);
  });

  test('A31: Possible causes opens and closes without overlapping or scaled text', async ({ page }) => {
    await loadDemo(page, 'edge-ring-etch');
    const toggle = page.getByTestId('autopsy-hypotheses-toggle');
    const initial = await toggle.getAttribute('aria-expanded');
    const toggleSelector = '[data-testid="autopsy-hypotheses-toggle"]';

    expectCleanFrames(await sampleDisclosure(page, toggleSelector, 0));
    await expect(toggle).not.toHaveAttribute('aria-expanded', initial ?? 'false');
    expectCleanFrames(await sampleDisclosure(page, toggleSelector, 0));
    await expect(toggle).toHaveAttribute('aria-expanded', initial ?? 'false');
  });

  test('§8.7: a thumbnail click cross-fades the wafer; arrow keys swap at 0 ms', async ({ page }) => {
    await loadDemo(page, 'edge-ring-etch');
    const strip = page.getByTestId('wafer-strip');
    const crossfade = page.getByTestId('wafer-crossfade-canvas');
    const stage = page.getByTestId('wafer-stage');

    await strip.locator('[role="option"]').nth(2).click();
    await expect(crossfade).toHaveAttribute('data-crossfading', 'true');
    await expect(crossfade).toHaveAttribute('data-crossfading', 'false', { timeout: 1_000 });
    await expect(stage).toHaveAttribute('aria-label', /W03/);

    // A single, non-repeat ArrowRight swaps without a crossfade
    const sawCrossfade = await page.evaluate(() => {
      const cf = document.querySelector<HTMLElement>('[data-testid="wafer-crossfade-canvas"]')!;
      (document.activeElement as HTMLElement).dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }),
      );
      return cf.dataset.crossfading === 'true';
    });
    expect(sawCrossfade).toBe(false);
    await expect(strip.locator('[role="option"][aria-selected="true"]')).toHaveAttribute(
      'data-wafer-index',
      '3',
    );
    await expect(stage).toHaveAttribute('aria-label', /W04/);
  });
});
