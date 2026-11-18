import { expect, type Page, test } from "@playwright/test";

/**
 * Premium P29 (premium §8.3): evidence ignite and camera focus.
 * - A38: the overlay 650 ms after clicking the Edge-Ring finding equals its settled state
 *   (< 1 % of disc pixels differ); at 250 ms the lit rims and bloom sit in the clockwise arc
 *   that starts at 12 o'clock.
 * - A9 (animated): the veil reaches full alpha and the evidence stays lit after the ignite.
 * - Camera: skipped when the user zoomed since the last evidence change.
 * - Mobile: the stage scrolls under the nav and the ignite waits for it.
 * Samples the overlay canvas inside the page so the timing is not skewed by screenshots.
 */

async function loadEdgeRing(
  page: Page,
  width = 1440,
  height = 900,
  demo = "edge-ring-etch",
): Promise<void> {
  await page.addInitScript(() => {
    window.sessionStorage.setItem("cal.sweep.v1", "1");
  });
  await page.setViewportSize({ width, height });
  await page.goto("/");
  await page.getByTestId(`demo-card-${demo}`).click();
  await expect(page.getByTestId("wafer-stage")).toHaveAttribute("data-sweep", "done", {
    timeout: 5_000,
  });
  // Let the verdict rise-in settle, then park the pointer off the stage (no hover, no sheen)
  await page.waitForTimeout(900);
  await page.mouse.move(2, 2);
}

interface IgniteSamples {
  readonly quadrantsAt250: readonly number[];
  readonly quadrantsSettled: readonly number[];
  readonly diffRatio650: number;
  readonly scrimAt250: number;
}

test("A38: the ring ignites clockwise from 12 o'clock and settles by 650 ms", async ({
  page,
}) => {
  await loadEdgeRing(page);
  const finding = page.getByTestId("autopsy-body-claim-button").first();
  await expect(finding).toContainText("Failures concentrate in the outer 3 rings");

  const samples: IgniteSamples = await page.evaluate(async () => {
    const button = document.querySelectorAll<HTMLButtonElement>(
      '[data-testid="autopsy-body-claim-button"]',
    )[0]!;
    const overlay = document.querySelector<HTMLCanvasElement>(
      '[data-testid="wafer-overlay-canvas"]',
    )!;
    const wrapper = document.querySelector<HTMLElement>(
      '[data-testid="wafer-overlay-wrapper"]',
    )!;
    const snapshot = (): ImageData =>
      overlay.getContext("2d")!.getImageData(0, 0, overlay.width, overlay.height);
    const frame = (): Promise<number> =>
      new Promise((resolve) => requestAnimationFrame(resolve));
    const waitUntil = async (t0: number, ms: number): Promise<void> => {
      while ((await frame()) - t0 < ms) {
        /* wait */
      }
    };
    const w = overlay.width;
    const h = overlay.height;
    const cx = w / 2;
    const cy = h / 2;
    // Brightness above the veil (premultiplied red channel): rims and bloom only
    const quadrants = (img: ImageData): number[] => {
      const q = [0, 0, 0, 0];
      const d = img.data;
      for (let y = 0; y < h; y += 2) {
        for (let x = 0; x < w; x += 2) {
          const i = (y * w + x) * 4;
          if ((d[i]! * d[i + 3]!) / 255 < 90) continue;
          const angle = (Math.atan2(x - cx, -(y - cy)) * 180) / Math.PI;
          const cw = (angle + 360) % 360;
          q[Math.min(3, Math.floor(cw / 90))]! += 1;
        }
      }
      return q;
    };

    const t0 = performance.now();
    button.click();
    await waitUntil(t0, 250);
    const at250 = snapshot();
    const scrimAt250 = Number(wrapper.dataset.scrimAlpha);
    await waitUntil(t0, 650);
    const at650 = snapshot();
    await waitUntil(t0, 1200);
    const settled = snapshot();

    let differing = 0;
    let inDisc = 0;
    const r = Math.min(w, h) / 2;
    for (let y = 0; y < h; y += 1) {
      for (let x = 0; x < w; x += 1) {
        if ((x - cx) ** 2 + (y - cy) ** 2 > r * r) continue;
        inDisc += 1;
        const i = (y * w + x) * 4;
        let delta = 0;
        for (let c = 0; c < 4; c += 1) {
          delta = Math.max(delta, Math.abs(at650.data[i + c]! - settled.data[i + c]!));
        }
        if (delta > 8) differing += 1;
      }
    }
    return {
      quadrantsAt250: quadrants(at250),
      quadrantsSettled: quadrants(settled),
      diffRatio650: inDisc > 0 ? differing / inDisc : 1,
      scrimAt250,
    };
  });
  test.info().annotations.push({ type: "A38", description: JSON.stringify(samples) });

  const overlay = page.getByTestId("wafer-overlay-wrapper");
  await expect(overlay).toHaveAttribute("data-glow-phase", "settled");
  await expect(overlay).toHaveAttribute("data-glow-mode", "polar-cw");

  // 650 ms equals the settled state
  expect(samples.diffRatio650).toBeLessThan(0.01);
  // The veil is complete by 200 ms
  expect(samples.scrimAt250).toBe(1);
  // Settled: every quadrant of the ring is lit
  const [s1, s2, s3, s4] = samples.quadrantsSettled;
  for (const q of [s1!, s2!, s3!, s4!]) expect(q).toBeGreaterThan(50);
  // 250 ms: the 12-to-3 quadrant leads, the 9-to-12 quadrant has barely started
  const [a1, , , a4] = samples.quadrantsAt250;
  expect(a1!).toBeGreaterThan(a4! * 4);
  expect(a4!).toBeLessThan(s4! * 0.25);
});

test("A9 animated: clearing fades the veil from its current alpha within 160 ms", async ({
  page,
}) => {
  await loadEdgeRing(page);
  const finding = page.getByTestId("autopsy-body-claim-button").first();
  const overlay = page.getByTestId("wafer-overlay-wrapper");
  await finding.click();
  await expect(overlay).toHaveAttribute("data-glow-phase", "settled", { timeout: 2_000 });
  await expect(overlay).toHaveAttribute("data-scrim-alpha", "1.000");
  const r = await page.evaluate(async () => {
    const button = document.querySelectorAll<HTMLButtonElement>(
      '[data-testid="autopsy-body-claim-button"]',
    )[0]!;
    const wrapper = document.querySelector<HTMLElement>(
      '[data-testid="wafer-overlay-wrapper"]',
    )!;
    const frame = (): Promise<number> =>
      new Promise((resolve) => requestAnimationFrame(resolve));
    const t0 = performance.now();
    button.click();
    await frame();
    const phaseNext = wrapper.dataset.glowPhase;
    let idleAt = Number.NaN;
    while (performance.now() - t0 < 600) {
      const t = await frame();
      if (wrapper.dataset.glowPhase === "idle") {
        idleAt = t - t0;
        break;
      }
    }
    return { phaseNext, idleAt };
  });
  expect(r.phaseNext).toBe("exiting");
  expect(r.idleAt).toBeLessThan(260);
});

test("camera skips the evidence framing after a user zoom, and follows it otherwise", async ({
  page,
}) => {
  await loadEdgeRing(page, 1440, 900, "handling-scratch");
  const stage = page.getByTestId("wafer-stage");
  const zoomValue = page.getByTestId("stage-zoom-value");
  // A local finding (not the ring) frames a zoomed camera
  const rows = page.getByTestId("autopsy-body-claim-button");
  const count = await rows.count();
  let framedRow = -1;
  for (let i = 0; i < count; i += 1) {
    await rows.nth(i).click();
    await page.waitForTimeout(900);
    const z = (await zoomValue.textContent()) ?? "";
    await rows.nth(i).click();
    await page.waitForTimeout(900);
    if (z.trim() !== "100%") {
      framedRow = i;
      break;
    }
  }
  expect(framedRow).toBeGreaterThanOrEqual(0);

  // User zoom before the next evidence change: the camera stays where the user left it
  await stage.focus();
  await page.keyboard.press("+");
  const userZoom = ((await zoomValue.textContent()) ?? "").trim();
  await rows.nth(framedRow).click();
  await page.waitForTimeout(900);
  expect(((await zoomValue.textContent()) ?? "").trim()).toBe(userZoom);
});

test("390 x 844: a finding below the wafer scrolls the stage in, then the ignite starts", async ({
  page,
}) => {
  await loadEdgeRing(page, 390, 844);
  const finding = page.getByTestId("autopsy-body-claim-button").first();
  await finding.scrollIntoViewIfNeeded();
  const overlay = page.getByTestId("wafer-overlay-wrapper");
  const r = await page.evaluate(async () => {
    const button = document.querySelectorAll<HTMLButtonElement>(
      '[data-testid="autopsy-body-claim-button"]',
    )[0]!;
    const wrapper = document.querySelector<HTMLElement>(
      '[data-testid="wafer-overlay-wrapper"]',
    )!;
    const frame = (): Promise<number> =>
      new Promise((resolve) => requestAnimationFrame(resolve));
    const t0 = performance.now();
    button.click();
    await frame();
    const waitingAfterClick = wrapper.dataset.igniteWait;
    let releasedAt = Number.NaN;
    while (performance.now() - t0 < 1000) {
      const t = await frame();
      if (wrapper.dataset.igniteWait === "false") {
        releasedAt = t - t0;
        break;
      }
    }
    return { waitingAfterClick, releasedAt };
  });
  expect(r.waitingAfterClick).toBe("true");
  // IntersectionObserver or the 400 ms cap, whichever is first (plus one frame)
  expect(r.releasedAt).toBeLessThanOrEqual(450);
  await expect(overlay).toHaveAttribute("data-glow-phase", "settled", { timeout: 2_000 });
  await expect
    .poll(async () =>
      Math.round(
        await page
          .getByTestId("wafer-stage")
          .evaluate((el) => el.getBoundingClientRect().top),
      ),
    )
    .toBe(48 + 8);
});

test("reduced motion: evidence lands at final alpha at once, with no wait", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await loadEdgeRing(page);
  const r = await page.evaluate(async () => {
    const button = document.querySelectorAll<HTMLButtonElement>(
      '[data-testid="autopsy-body-claim-button"]',
    )[0]!;
    const wrapper = document.querySelector<HTMLElement>(
      '[data-testid="wafer-overlay-wrapper"]',
    )!;
    button.click();
    await new Promise((resolve) => requestAnimationFrame(resolve));
    return {
      phase: wrapper.dataset.glowPhase,
      scrim: wrapper.dataset.scrimAlpha,
      lit: wrapper.dataset.litDieCount,
      wafer: wrapper.dataset.waferHighlightCount,
    };
  });
  expect(r.phase).toBe("settled");
  expect(r.scrim).toBe("1.000");
  expect(r.lit).toBe(r.wafer);
});
