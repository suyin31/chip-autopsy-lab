import * as path from "node:path";
import { expect, type Page, test } from "@playwright/test";

/**
 * Premium P26a landing hero and sample tiles (premium §11.1, §11.2).
 * Accept: A41 (headline, CTA, and >= 50 % of the hero wafer above the 900 px fold at 1440; 72
 * reticle ticks; hero click opens the sample lot) and A42 (sample card text outside the tile, a
 * pattern chip on all three tiles).
 */

const SHOTS = path.join(__dirname, "..", "logs", "shots");
const CARD_IDS = ["edge-ring-etch", "handling-scratch", "site2-probe-contact"] as const;

async function openLanding(page: Page, width: number, height: number, theme = "light") {
  await page.addInitScript((t) => {
    window.localStorage.setItem("cal.theme", t);
    window.sessionStorage.setItem("cal.sweep.v1", "1");
  }, theme);
  await page.setViewportSize({ width, height });
  await page.goto("/?nohints=1");
  await expect(page.getByTestId("landing-headline")).toBeVisible();
}

async function box(page: Page, testId: string) {
  const b = await page.getByTestId(testId).boundingBox();
  expect(b, testId).not.toBeNull();
  return b!;
}

test.describe("P26a landing hero and sample tiles (premium §11)", () => {
  test("A41 at 1440 x 900: hero wafer, reticle, and example result card", async ({ page }) => {
    await openLanding(page, 1440, 900);

    for (const id of ["landing-headline", "landing-open-sample-button"]) {
      const b = await box(page, id);
      expect(b.y + b.height, id).toBeLessThanOrEqual(900);
    }
    const disc = await box(page, "landing-hero-disc");
    expect(Math.round(disc.width)).toBe(320);
    expect(900 - disc.y).toBeGreaterThanOrEqual(disc.height / 2);

    // hint line -> 56 px -> hero row
    const hint = await box(page, "landing-hint");
    const frame = await box(page, "landing-hero-frame");
    expect(Math.round(frame.y - (hint.y + hint.height))).toBe(56);

    // Reticle: hairline circle at D + 32, 72 ticks, four mono labels in text-tertiary
    expect(await page.locator("[data-reticle-tick]").count()).toBe(72);
    const hero = await box(page, "landing-hero-wafer");
    expect(Math.round(hero.width)).toBe(352);
    expect(Math.abs(hero.x + hero.width / 2 - (disc.x + disc.width / 2))).toBeLessThan(1);
    for (const deg of [0, 90, 180, 270]) {
      const label = page.getByTestId(`landing-reticle-label-${deg}`);
      await expect(label).toHaveText(`${deg}°`);
      const style = await label.evaluate((el) => ({
        font: getComputedStyle(el).fontFamily,
        colour: getComputedStyle(el).color,
      }));
      expect(style.font).toMatch(/jetbrains/i);
      expect(style.colour).toBe(
        await page.getByTestId("landing-hint").evaluate((el) => getComputedStyle(el).color),
      );
    }

    // Result card right of the disc: surface, r-2xl, padding 24, width 280
    const card = await box(page, "landing-example-card");
    expect(Math.round(card.width)).toBe(280);
    expect(card.x).toBeGreaterThan(hero.x + hero.width);
    const cardStyle = await page.getByTestId("landing-example-card").evaluate((el) => ({
      bg: getComputedStyle(el).backgroundColor,
      radius: getComputedStyle(el).borderTopLeftRadius,
      padding: getComputedStyle(el).paddingTop,
    }));
    expect(cardStyle).toEqual({ bg: "rgb(255, 255, 255)", radius: "24px", padding: "24px" });
    await expect(page.getByTestId("landing-example-eyebrow")).toHaveText("Example result");
    await expect(page.getByTestId("landing-example-title")).toHaveText("Edge-Ring failure.");
    await expect(page.getByTestId("landing-example-fact")).toHaveText(
      "93.8% of fails sit in the outer 3 rings.",
    );
    expect(
      await page.getByTestId("landing-example-title").evaluate((el) => getComputedStyle(el).color),
    ).toBe("rgb(217, 78, 20)");

    // "Sample lots" sits 72 px below the hero row
    const heroRow = await box(page, "landing-hero");
    const heading = await box(page, "landing-sample-heading");
    expect(Math.round(heading.y - (heroRow.y + heroRow.height))).toBe(72);

    await page.screenshot({ path: path.join(SHOTS, "p26a-landing-1440-light.png") });
  });

  test("A41: the hero wafer opens the sample lot", async ({ page }) => {
    await openLanding(page, 1440, 900);
    await expect(page.getByTestId("landing-hero-wafer")).toHaveAttribute(
      "aria-label",
      "Open the sample lot",
    );
    await page.getByTestId("landing-hero-wafer").click();
    await expect(page.getByTestId("wafer-stage")).toBeVisible({ timeout: 5_000 });
  });

  test("A42: sample card text sits outside the tile, with a pattern chip in every tile", async ({
    page,
  }) => {
    await openLanding(page, 1440, 900);
    const chips = { "edge-ring-etch": "Edge ring", "handling-scratch": "Scratch", "site2-probe-contact": "Probe site" };
    for (const id of CARD_IDS) {
      const tile = await box(page, `demo-tile-${id}`);
      const caption = await box(page, `demo-caption-${id}`);
      expect(Math.round(caption.y - (tile.y + tile.height))).toBe(16);
      expect(Math.round(caption.x)).toBe(Math.round(tile.x));
      const tileBg = await page
        .getByTestId(`demo-tile-${id}`)
        .evaluate((el) => getComputedStyle(el).backgroundColor);
      expect(tileBg).toBe("rgb(239, 235, 228)");
      const chip = page.getByTestId(`demo-chip-${id}`);
      await expect(chip).toHaveText(chips[id]);
      const c = await box(page, `demo-chip-${id}`);
      expect(Math.round(c.height)).toBe(24);
      expect(c.y + c.height).toBeLessThanOrEqual(tile.y + tile.height);
      expect(c.x).toBeGreaterThanOrEqual(tile.x);
      // The chip never overlaps the disc
      const wafer = await box(page, `landing-demo-wafer-${id}`);
      expect(c.y >= wafer.y + wafer.height || c.x + c.width <= wafer.x).toBe(true);
    }
    await page.getByTestId("demo-tile-edge-ring-etch").scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(SHOTS, "p26a-tiles-1440-light.png") });
  });

  test("below 1024 the result card sits under the disc; 240 / 220 px discs", async ({ page }) => {
    for (const vp of [
      { width: 800, height: 1100, disc: 240 },
      { width: 390, height: 844, disc: 220 },
    ]) {
      await openLanding(page, vp.width, vp.height);
      const disc = await box(page, "landing-hero-disc");
      expect(Math.round(disc.width)).toBe(vp.disc);
      const frame = await box(page, "landing-hero-frame");
      const card = await box(page, "landing-example-card");
      expect(card.y).toBeGreaterThanOrEqual(frame.y + frame.height);
      for (const id of ["landing-hero-frame", "landing-example-card", "landing-reticle-label-270", "landing-reticle-label-90"]) {
        const b = await box(page, id);
        expect(b.x, id).toBeGreaterThanOrEqual(16);
        expect(b.x + b.width, id).toBeLessThanOrEqual(vp.width - 16);
      }
      await page.screenshot({
        path: path.join(SHOTS, `p26a-landing-${vp.width}-light.png`),
        fullPage: true,
      });
    }
  });

  test("dark: hero halo instead of the light shadows", async ({ page }) => {
    await openLanding(page, 1440, 900, "dark");
    await expect(page.getByTestId("landing-hero-disc-halo")).toBeVisible();
    await expect(page.getByTestId("landing-hero-disc-ambient")).toBeHidden();
    await page.screenshot({ path: path.join(SHOTS, "p26a-landing-1440-dark.png") });
  });
});
