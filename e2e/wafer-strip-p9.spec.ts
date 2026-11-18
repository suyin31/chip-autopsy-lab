import { expect, type Page, test } from "@playwright/test";

/**
 * Premium P9 acceptance A12 (premium §5.8): at all 4 reference viewports the active ring, the
 * first and last thumbnails, and a hovered thumbnail are fully visible; the edge fade shows
 * only on a side that can scroll; chevrons show on desktop only when that side can scroll.
 */

const VIEWPORTS = [
  { width: 1440, height: 900, desktop: true },
  { width: 1280, height: 800, desktop: true },
  { width: 1024, height: 768, desktop: true },
  { width: 390, height: 844, desktop: false },
] as const;

async function openDemo(page: Page, width: number, height: number) {
  await page.addInitScript(() => {
    window.sessionStorage.setItem("cal.sweep.v1", "1");
  });
  await page.setViewportSize({ width, height });
  await page.goto("/?nohints=1");
  await page.getByTestId("demo-card-edge-ring-etch").click();
  await expect(page.getByTestId("wafer-stage")).toHaveAttribute(
    "data-sweep",
    "done",
    { timeout: 5_000 },
  );
}

/** Returns how many px of the item's thumbnail plus `ringPx` fall outside every clipping box. */
function clippedPx(page: Page, index: number, ringPx: number) {
  return page.evaluate(
    ({ index, ringPx }) => {
      const strip = document.querySelector<HTMLElement>(
        '[data-testid="wafer-strip"]',
      )!;
      const ring = strip.querySelectorAll<HTMLElement>(
        '[data-testid="wafer-strip-thumb-ring"]',
      )[index]!;
      const r = ring.getBoundingClientRect();
      const box = {
        left: r.left - ringPx,
        right: r.right + ringPx,
        top: r.top - ringPx,
        bottom: r.bottom + ringPx,
      };
      let worst = Math.max(0, -box.left, box.right - window.innerWidth);
      for (let el = ring.parentElement; el; el = el.parentElement) {
        const cs = getComputedStyle(el);
        if (cs.overflowX === "visible" && cs.overflowY === "visible") {
          continue;
        }
        const c = el.getBoundingClientRect();
        worst = Math.max(
          worst,
          c.left - box.left,
          box.right - c.right,
          c.top - box.top,
          box.bottom - c.bottom,
        );
      }
      return worst;
    },
    { index, ringPx },
  );
}

function readEdges(page: Page) {
  return page.evaluate(() => {
    const strip = document.querySelector<HTMLElement>(
      '[data-testid="wafer-strip"]',
    )!;
    const cs = getComputedStyle(strip);
    const display = (id: string) =>
      getComputedStyle(
        document.querySelector<HTMLElement>(`[data-testid="${id}"]`)!,
      ).display;
    return {
      fadeStart: strip.dataset.fadeStart,
      fadeEnd: strip.dataset.fadeEnd,
      mask: cs.maskImage || cs.getPropertyValue("-webkit-mask-image"),
      earlier: display("wafer-strip-chevron-earlier"),
      later: display("wafer-strip-chevron-later"),
      scrollLeft: strip.scrollLeft,
    };
  });
}

async function scrollStripTo(page: Page, where: "start" | "end") {
  await page.evaluate((where) => {
    const strip = document.querySelector<HTMLElement>(
      '[data-testid="wafer-strip"]',
    )!;
    strip.scrollTo({
      left: where === "start" ? 0 : strip.scrollWidth,
      behavior: "instant",
    });
  }, where);
  await page.waitForTimeout(100);
}

for (const vp of VIEWPORTS) {
  test(`A12 strip at ${vp.width} x ${vp.height}: nothing clips, side-aware fade and chevrons`, async ({
    page,
  }) => {
    await openDemo(page, vp.width, vp.height);
    const strip = page.getByTestId("wafer-strip");
    const options = strip.locator('[role="option"]');
    await expect(options).toHaveCount(25);

    const stripBox = (await strip.boundingBox())!;
    expect(Math.round(stripBox.height)).toBe(vp.desktop ? 76 : 64);
    const itemBox = (await options.first().boundingBox())!;
    expect(Math.round(itemBox.width)).toBe(vp.desktop ? 48 : 44);
    expect(Math.round(itemBox.height)).toBe(vp.desktop ? 64 : 52);

    // At rest: only the later side can scroll
    await scrollStripTo(page, "start");
    let edges = await readEdges(page);
    expect(edges.fadeStart).toBe("false");
    expect(edges.fadeEnd).toBe("true");
    expect(edges.mask).toContain("calc(100% - 32px)");
    expect(edges.mask).not.toMatch(
      /^linear-gradient\(90deg, (transparent|rgba\(0, 0, 0, 0\)) 0/,
    );
    expect(edges.earlier).toBe("none");
    expect(edges.later).toBe(vp.desktop ? "flex" : "none");

    // Active W01 ring (3.5 px) and focus ring (4 px) are fully visible
    expect(await clippedPx(page, 0, 3.5)).toBeLessThanOrEqual(0);
    await options.first().focus();
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Tab");
    expect(await clippedPx(page, 0, 4)).toBeLessThanOrEqual(0);

    // Hovered thumbnail at scale(1.06) stays inside the strip
    if (vp.desktop) {
      await options.nth(1).hover();
      await page.waitForTimeout(250);
      expect(await clippedPx(page, 1, 3.5)).toBeLessThanOrEqual(0);
    }

    // Scrolled to the end: only the earlier side fades, and the last thumbnail is whole
    await scrollStripTo(page, "end");
    edges = await readEdges(page);
    expect(edges.fadeStart).toBe("true");
    expect(edges.fadeEnd).toBe("false");
    expect(edges.mask).toMatch(
      /^linear-gradient\(90deg, (transparent|rgba\(0, 0, 0, 0\)) 0/,
    );
    expect(edges.mask).not.toContain("calc(100% - 32px)");
    expect(edges.earlier).toBe(vp.desktop ? "flex" : "none");
    expect(edges.later).toBe("none");
    expect(await clippedPx(page, 24, 4)).toBeLessThanOrEqual(0);

    if (vp.desktop) {
      // Earlier chevron scrolls back by 80 % of the visible width
      const before = edges.scrollLeft;
      const target = Math.max(0, before - stripBox.width * 0.8);
      await page.getByRole("button", { name: "Earlier wafers" }).click();
      await expect
        .poll(async () => (await readEdges(page)).scrollLeft, {
          timeout: 2_000,
        })
        .toBeLessThanOrEqual(target + 2);
      edges = await readEdges(page);
      expect(edges.fadeStart).toBe(target > 1 ? "true" : "false");
      expect(edges.fadeEnd).toBe("true");
      expect(edges.earlier).toBe(target > 1 ? "flex" : "none");
      expect(edges.later).toBe("flex");
    }

    // Mobile shows the label only on the active item
    if (!vp.desktop) {
      const visibleLabels = await strip
        .locator('[role="option"] bdi')
        .evaluateAll(
          (els) =>
            els.filter((el) => el.getBoundingClientRect().width > 0).length,
        );
      expect(visibleLabels).toBe(1);
    }
  });
}

test("A12 evidence: zero-evidence wafers drop to 0.32 opacity, others stay at 1", async ({
  page,
}) => {
  await openDemo(page, 1440, 900);
  await page.getByTestId("autopsy-body-claim-button").first().click();
  const strip = page.getByTestId("wafer-strip");
  await expect(strip.locator("[data-has-evidence]").first()).toBeVisible();
  await page.waitForTimeout(250);
  const opacities = await strip.locator('[role="option"]').evaluateAll((els) =>
    els.map((el) => ({
      evidence: el.getAttribute("data-has-evidence"),
      opacity: getComputedStyle(
        el.querySelector<HTMLElement>(
          '[data-testid="wafer-strip-thumb-ring"]',
        )!,
      ).opacity,
    })),
  );
  for (const o of opacities) {
    expect(o.opacity).toBe(o.evidence === "false" ? "0.32" : "1");
  }
  expect(await page.getByTestId("wafer-strip-evidence-dot").count()).toBe(0);
});
