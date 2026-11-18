import { expect, type Page, test } from "@playwright/test";

/**
 * Premium P8 acceptance A9 (premium §5.4), static state: once the evidence has settled,
 * evidence fail dies sample `#FF6B2C` with a white rim, non-evidence fail dies are a dark
 * ember-brown (hue within 15 deg of `#FF6B2C`, L* < 35), and pass tiles under the veil vanish.
 * Samples a page screenshot, so the base, overlay, and stage layers are composited as shown.
 */

async function loadEdgeRing(page: Page): Promise<void> {
  await page.addInitScript(() => {
    window.sessionStorage.setItem("cal.sweep.v1", "1");
  });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.getByTestId("demo-card-edge-ring-etch").click();
  await expect(page.getByTestId("wafer-stage")).toHaveAttribute(
    "data-sweep",
    "done",
    { timeout: 5_000 },
  );
}

interface EvidenceMetrics {
  readonly litEmberPixels: number;
  readonly exactEmberPixels: number;
  readonly rimPixelsNearLit: number;
  readonly dimmedPixels: number;
  readonly dimmedMaxLStar: number;
  readonly dimmedMaxHueDelta: number;
  readonly passUnderVeilContrast: number;
}

async function measureEvidence(page: Page): Promise<EvidenceMetrics> {
  const stage = page.getByTestId("wafer-stage");
  const box = (await stage.boundingBox())!;
  const png = await page.screenshot({ clip: box });
  return page.evaluate(async (b64) => {
    const blob = await (await fetch(`data:image/png;base64,${b64}`)).blob();
    const bitmap = await createImageBitmap(blob);
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(bitmap, 0, 0);
    const { width: w, height: h } = canvas;
    const data = ctx.getImageData(0, 0, w, h).data;
    const at = (x: number, y: number) => (y * w + x) * 4;
    const lin = (c: number) => {
      const s = c / 255;
      return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    };
    const lum = (i: number) =>
      0.2126 * lin(data[i]!) + 0.7152 * lin(data[i + 1]!) + 0.0722 * lin(data[i + 2]!);
    const lStar = (i: number) => {
      const y = lum(i);
      return y > 216 / 24389 ? 116 * Math.cbrt(y) - 16 : (24389 / 27) * y;
    };
    const hue = (i: number) => {
      const r = data[i]!;
      const g = data[i + 1]!;
      const bl = data[i + 2]!;
      const max = Math.max(r, g, bl);
      const min = Math.min(r, g, bl);
      if (max === min) return Number.NaN;
      if (max === r) return (((g - bl) / (max - min)) * 60 + 360) % 360;
      if (max === g) return ((bl - r) / (max - min)) * 60 + 120;
      return ((r - g) / (max - min)) * 60 + 240;
    };
    const emberHue = (((107 - 44) / (255 - 44)) * 60 + 360) % 360;

    const lit = new Uint8Array(w * h);
    let litEmberPixels = 0;
    let exactEmberPixels = 0;
    for (let y = 0; y < h; y += 1) {
      for (let x = 0; x < w; x += 1) {
        const i = at(x, y);
        const dr = Math.abs(data[i]! - 0xff);
        const dg = Math.abs(data[i + 1]! - 0x6b);
        const db = Math.abs(data[i + 2]! - 0x2c);
        // Rim pixels (near white) also mark an evidence die, so they join the "lit" set
        if (Math.min(data[i]!, data[i + 1]!, data[i + 2]!) >= 200) lit[y * w + x] = 2;
        // The P7 specular sheen (`screen`, white <= 0.10) lifts lit dies under it a little
        if (dr <= 4 && dg <= 24 && db <= 28) {
          lit[y * w + x] = 1;
          litEmberPixels += 1;
          if (dr <= 4 && dg <= 4 && db <= 4) exactEmberPixels += 1;
        }
      }
    }
    // A pixel is "near lit" when a lit ember or rim pixel sits within 4 px (antialiased edges)
    const nearLit = (x: number, y: number) => {
      for (let dy = -4; dy <= 4; dy += 1) {
        for (let dx = -4; dx <= 4; dx += 1) {
          const xx = x + dx;
          const yy = y + dy;
          if (xx >= 0 && yy >= 0 && xx < w && yy < h && lit[yy * w + xx]) return true;
        }
      }
      return false;
    };

    const nearLitEmber = (x: number, y: number) => {
      for (let dy = -3; dy <= 3; dy += 1) {
        for (let dx = -3; dx <= 3; dx += 1) {
          const xx = x + dx;
          const yy = y + dy;
          if (xx >= 0 && yy >= 0 && xx < w && yy < h && lit[yy * w + xx] === 1) return true;
        }
      }
      return false;
    };
    let rimPixelsNearLit = 0;
    let dimmedPixels = 0;
    let dimmedMaxLStar = 0;
    let dimmedMaxHueDelta = 0;
    for (let y = 0; y < h; y += 1) {
      for (let x = 0; x < w; x += 1) {
        const i = at(x, y);
        const r = data[i]!;
        const g = data[i + 1]!;
        const bl = data[i + 2]!;
        if (Math.min(r, g, bl) >= 200) {
          if (nearLitEmber(x, y)) rimPixelsNearLit += 1;
          continue;
        }
        // Clearly ember-coloured but not lit: the dimmed fail-die body
        if (lit[y * w + x] || r - bl < 30 || r <= g || nearLit(x, y)) continue;
        dimmedPixels += 1;
        dimmedMaxLStar = Math.max(dimmedMaxLStar, lStar(i));
        const d = Math.abs(hue(i) - emberHue);
        dimmedMaxHueDelta = Math.max(dimmedMaxHueDelta, Math.min(d, 360 - d));
      }
    }

    // Pass tiles under the veil: the healthy centre window holds only veiled tiles and streets
    const cx = Math.round(w / 2);
    const cy = Math.round(h / 2);
    const win = Math.round(Math.min(w, h) * 0.04);
    let lo = Infinity;
    let hi = -Infinity;
    for (let y = cy - win; y <= cy + win; y += 1) {
      for (let x = cx - win; x <= cx + win; x += 1) {
        const i = at(x, y);
        if (data[i]! - data[i + 2]! > 12) continue;
        const l = lum(i);
        lo = Math.min(lo, l);
        hi = Math.max(hi, l);
      }
    }

    return {
      litEmberPixels,
      exactEmberPixels,
      rimPixelsNearLit,
      dimmedPixels,
      dimmedMaxLStar,
      dimmedMaxHueDelta,
      passUnderVeilContrast: (hi + 0.05) / (lo + 0.05),
    };
  }, png.toString("base64"));
}

test("A9: settled evidence keeps ember dies lit with a white rim and dims the rest to ember-brown", async ({
  page,
}) => {
  await loadEdgeRing(page);
  const overlay = page.getByTestId("wafer-overlay-wrapper");
  const finding = page.getByTestId("autopsy-body-claim-button").first();
  await expect(finding).toContainText("Failures concentrate in the outer 3 rings");
  await finding.click();
  await expect(overlay).toHaveAttribute("data-glow-phase", "settled", { timeout: 2_000 });
  await expect(overlay).toHaveAttribute("data-scrim-alpha", "1.000");
  // Park the pointer off the stage so no hover stroke is drawn
  await page.mouse.move(2, 2);
  await page.waitForTimeout(300);

  const m = await measureEvidence(page);
  test.info().annotations.push({ type: "A9", description: JSON.stringify(m) });
  await page.getByTestId("wafer-stage").screenshot({ path: "logs/shots/p8-evidence.png" });

  expect(m.litEmberPixels).toBeGreaterThan(200);
  // Away from the sheen, evidence fail dies sample #FF6B2C itself
  expect(m.exactEmberPixels).toBeGreaterThan(1000);
  expect(m.rimPixelsNearLit).toBeGreaterThan(50);
  expect(m.dimmedPixels).toBeGreaterThan(20);
  expect(m.dimmedMaxLStar).toBeLessThan(35);
  expect(m.dimmedMaxHueDelta).toBeLessThanOrEqual(15);
  expect(m.passUnderVeilContrast).toBeLessThan(1.06);
});

test("Enter pins the keyboard-cursor die and Escape clears the pin (premium §5.4)", async ({
  page,
}) => {
  await loadEdgeRing(page);
  const stage = page.getByTestId("wafer-stage");
  const overlay = page.getByTestId("wafer-overlay-wrapper");
  await stage.focus();
  await page.keyboard.press("ArrowRight");
  const hovered = await overlay.getAttribute("data-hovered-die");
  expect(hovered).not.toBe("");
  await page.keyboard.press("Enter");
  await expect(overlay).toHaveAttribute("data-pinned-die", hovered!);
  await page.keyboard.press("Escape");
  await expect(overlay).toHaveAttribute("data-pinned-die", "");
});
