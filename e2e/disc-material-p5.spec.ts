import { expect, test } from "@playwright/test";

/**
 * Premium P5 acceptance A5 (premium §5.2): the disc body is lighter upper-left than
 * lower-right, the WF_FLAT notch is cut at 6 o'clock, and the top bevel is lighter
 * than the bottom bevel. Reads the base canvas backing store directly.
 */
test("A5: disc gradient, 6 o'clock notch, and top-lit bevel at 1440", async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.sessionStorage.setItem("cal.sweep.v1", "1");
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.getByTestId("demo-card-edge-ring-etch").click();
  const stage = page.getByTestId("wafer-stage");
  await expect(stage).toHaveAttribute("data-sweep", "done", { timeout: 5_000 });

  const m = await page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>(
      '[data-testid="wafer-base-canvas"]',
    )!;
    const ctx = canvas.getContext("2d")!;
    const { width: w, height: h } = canvas;
    const data = ctx.getImageData(0, 0, w, h).data;
    const k = w / canvas.getBoundingClientRect().width; // backing px per css px

    const alpha = (x: number, y: number) =>
      data[(Math.round(y) * w + Math.round(x)) * 4 + 3]!;
    const lstar = (x: number, y: number) => {
      const i = (Math.round(y) * w + Math.round(x)) * 4;
      const lin = (c: number) => {
        const s = c / 255;
        return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      };
      const yl =
        0.2126 * lin(data[i]!) +
        0.7152 * lin(data[i + 1]!) +
        0.0722 * lin(data[i + 2]!);
      return yl > 216 / 24389 ? 116 * Math.cbrt(yl) - 16 : (24389 / 27) * yl;
    };

    // Disc bounds from the opaque extent of the middle row and the top of the middle column
    const midY = Math.round(h / 2);
    let left = 0;
    while (left < w && alpha(left, midY) < 128) left += 1;
    let right = w - 1;
    while (right > 0 && alpha(right, midY) < 128) right -= 1;
    const d = right - left + 1;
    const cx = (left + right) / 2;
    let top = 0;
    while (top < h && alpha(cx, top) < 128) top += 1;
    const r = d / 2;
    const cy = top + r;

    // Darkest pixel in a window is the disc body between dies
    const bodyL = (fx: number, fy: number) => {
      const half = Math.round(0.02 * d);
      let min = Infinity;
      for (let y = -half; y <= half; y += 1) {
        for (let x = -half; x <= half; x += 1) {
          const px = left + fx * d + x;
          const py = top + fy * d + y;
          if (alpha(px, py) === 255) min = Math.min(min, lstar(px, py));
        }
      }
      return min;
    };

    // Brightest opaque pixel within the outer 1 css px of the rim at a given angle
    const rimL = (deg: number) => {
      const a = (deg * Math.PI) / 180;
      let max = -Infinity;
      for (let t = 0.25 * k; t <= 1.25 * k; t += 0.25) {
        const px = cx + Math.cos(a) * (r - t);
        const py = cy + Math.sin(a) * (r - t);
        if (alpha(px, py) === 255) max = Math.max(max, lstar(px, py));
      }
      return max;
    };
    const insideL = (deg: number) => {
      const a = (deg * Math.PI) / 180;
      return lstar(cx + Math.cos(a) * (r - 6 * k), cy + Math.sin(a) * (r - 6 * k));
    };

    return {
      diameterCss: d / k,
      upperLeft: bodyL(0.25, 0.25),
      lowerRight: bodyL(0.75, 0.75),
      notchAlpha: alpha(cx, cy + r - 0.008 * d),
      topMirrorAlpha: alpha(cx, cy - r + 0.008 * d),
      notchShoulderAlpha: alpha(cx + 0.05 * d, cy + r - 0.008 * d),
      topRim: rimL(-70),
      topInside: insideL(-70),
      bottomRim: rimL(70),
    };
  });

  // Interim floor: P10's header and control row shrink the disc to 538 px; P12 sizes D to 596 (A15)
  expect(m.diameterCss).toBeGreaterThanOrEqual(530);
  expect(m.upperLeft - m.lowerRight).toBeGreaterThanOrEqual(6);
  expect(m.notchAlpha).toBe(0);
  expect(m.topMirrorAlpha).toBe(255);
  expect(m.notchShoulderAlpha).toBe(255);
  expect(m.topRim).toBeGreaterThan(m.topInside);
  expect(m.topRim).toBeGreaterThan(m.bottomRim);

  await stage.screenshot({ path: "logs/shots/p5-disc-1440.png" });
  test.info().annotations.push({ type: "A5", description: JSON.stringify(m) });
  console.log("A5", JSON.stringify(m));
});
