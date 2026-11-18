import * as path from "node:path";
import { expect, type Page, test } from "@playwright/test";

/**
 * Premium P11 landing (premium §6.1): hero, buttons, hint, sample cards with 152 / 140 / 120 /
 * 112 px discs, and the footer line at 1440, 1280, 1024, sm (800), and 390.
 * Accept: A14 (nothing touches an edge; since premium §11.1 the sample cards and footer may sit
 * below the 900 px fold) and A20
 * (exactly one filled `ink` button: "Open the sample lot").
 */

const SHOTS = path.join(__dirname, "..", "logs", "shots");
const CARD_IDS = [
  "edge-ring-etch",
  "handling-scratch",
  "site2-probe-contact",
] as const;

async function openLanding(
  page: Page,
  width: number,
  height: number,
  theme: "light" | "dark" = "light",
) {
  await page.addInitScript((t) => {
    window.localStorage.setItem("cal.theme", t);
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

/** Visible buttons whose computed background is the `ink` fill. */
function countInkFilledButtons(page: Page, ink: string) {
  return page.evaluate((inkColor) => {
    return [...document.querySelectorAll<HTMLElement>("button")].filter((b) => {
      const r = b.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return false;
      return getComputedStyle(b).backgroundColor === inkColor;
    }).length;
  }, ink);
}

test.describe("P11 landing (premium §6.1)", () => {
  test("A14 + A20 at 1440 x 900 (light)", async ({ page }) => {
    await openLanding(page, 1440, 900);

    const headline = await box(page, "landing-headline");
    expect(headline.y).toBeGreaterThanOrEqual(136);
    expect(headline.y).toBeLessThanOrEqual(144);

    const ids = [
      "landing-headline",
      "landing-subline",
      "landing-open-sample-button",
      "landing-open-stdf-button",
      "landing-hint",
      "landing-sample-heading",
      ...CARD_IDS.map((id) => `demo-card-${id}`),
      "landing-privacy",
      "landing-download-demos-trigger",
    ];
    // premium §11.1 (overrides A14): the hero wafer row sits between the hint and "Sample lots",
    // so the sample cards and the footer line may move below the 900 px fold
    const belowFoldIds = new Set([
      "landing-sample-heading",
      ...CARD_IDS.map((id) => `demo-card-${id}`),
      "landing-privacy",
      "landing-download-demos-trigger",
    ]);
    for (const id of ids) {
      const b = await box(page, id);
      // A14: above the 900 px fold and at least 16 px from every viewport edge
      if (!belowFoldIds.has(id)) expect(b.y + b.height, id).toBeLessThanOrEqual(900 - 4);
      expect(b.x, id).toBeGreaterThanOrEqual(16);
      expect(b.x + b.width, id).toBeLessThanOrEqual(1440 - 16);
    }

    const primary = await box(page, "landing-open-sample-button");
    const secondary = await box(page, "landing-open-stdf-button");
    expect(Math.round(primary.height)).toBe(48);
    expect(Math.round(secondary.height)).toBe(48);
    expect(Math.round(secondary.x - (primary.x + primary.width))).toBe(12);
    expect(Math.abs(primary.y - secondary.y)).toBeLessThan(1);

    // Cards: 3-up row on the 12-column grid; §11.2 tiles hold the 152 px disc centred, 40 px inset
    const cards = await Promise.all(CARD_IDS.map((id) => box(page, `demo-card-${id}`)));
    for (const [i, id] of CARD_IDS.entries()) {
      const card = cards[i]!;
      expect(Math.abs(card.y - cards[0]!.y)).toBeLessThan(1);
      const tile = await box(page, `demo-tile-${id}`);
      expect(Math.round(tile.height)).toBe(152 + 80);
      const wafer = await box(page, `landing-demo-wafer-${id}`);
      expect(Math.round(wafer.width)).toBe(152);
      expect(Math.round(wafer.y - tile.y)).toBe(40);
      expect(Math.abs(wafer.x + 76 - (tile.x + tile.width / 2))).toBeLessThan(1);
    }
    expect(Math.round(cards[1]!.x - (cards[0]!.x + cards[0]!.width))).toBe(24);
    expect(Math.round(cards[0]!.x)).toBe(40);

    // A1 (landing part): page bg, card surface, and body text in light
    const colours = await page.evaluate(() => ({
      body: getComputedStyle(document.body).backgroundColor,
      card: getComputedStyle(
        document.querySelector('[data-testid="landing-example-card"]')!,
      ).backgroundColor,
      headline: getComputedStyle(
        document.querySelector('[data-testid="landing-headline"]')!,
      ).color,
    }));
    expect(colours).toEqual({
      body: "rgb(246, 243, 238)",
      card: "rgb(255, 255, 255)",
      headline: "rgb(32, 30, 31)",
    });

    // A20: exactly one filled ink button, and it is "Open the sample lot"
    expect(await countInkFilledButtons(page, "rgb(32, 30, 31)")).toBe(1);
    await expect(page.getByTestId("landing-open-sample-button")).toHaveText(
      "Open the sample lot",
    );
    expect(await page.getByTestId("landing-hint").innerText()).toBe(
      "Or drop a .stdf, .std, or gzip file anywhere. Files stay on this device.",
    );

    await page.screenshot({ path: path.join(SHOTS, "p11-landing-1440-light.png") });

  });

  test("A20 in dark at 1440 x 900", async ({ page }) => {
    await openLanding(page, 1440, 900, "dark");
    expect(await countInkFilledButtons(page, "rgb(245, 245, 247)")).toBe(1);
    await page.screenshot({ path: path.join(SHOTS, "p11-landing-1440-dark.png") });
  });

  test("the sample-lot button opens edge-ring-etch", async ({ page }) => {
    await page.addInitScript(() => {
      window.sessionStorage.setItem("cal.sweep.v1", "1");
    });
    await openLanding(page, 1440, 900);
    await page.getByTestId("landing-open-sample-button").click();
    await expect(page.getByTestId("wafer-stage")).toBeVisible({ timeout: 5_000 });
  });

  test("1280 x 800 and 1024 x 768: centred hero, 3-up cards", async ({
    page,
  }) => {
    for (const vp of [
      // premium §12.3: clamp(56px, 6.4vw, 104px)
      { width: 1280, height: 800, top: 116, wafer: 140, font: "81.92px" },
      { width: 1024, height: 768, top: 104, wafer: 120, font: "65.536px" },
    ]) {
      await openLanding(page, vp.width, vp.height);
      const headline = await box(page, "landing-headline");
      expect(Math.abs(headline.y - vp.top)).toBeLessThanOrEqual(4);
      expect(
        await page
          .getByTestId("landing-headline")
          .evaluate((el) => getComputedStyle(el).fontSize),
      ).toBe(vp.font);

      const cards = await Promise.all(CARD_IDS.map((id) => box(page, `demo-card-${id}`)));
      for (const [i, id] of CARD_IDS.entries()) {
        expect(Math.abs(cards[i]!.y - cards[0]!.y)).toBeLessThan(1);
        expect(Math.round((await box(page, `demo-tile-${id}`)).height)).toBe(vp.wafer + 80);
        expect(Math.round((await box(page, `landing-demo-wafer-${id}`)).width)).toBe(vp.wafer);
      }
      // premium §11.1: the hero row pushes the cards below the fold
      await page.screenshot({
        path: path.join(SHOTS, `p11-landing-${vp.width}-light.png`),
      });
    }
  });

  test("sm 800: single column, left-aligned hero, stacked full-width tiles with a centred 112 px disc", async ({
    page,
  }) => {
    await openLanding(page, 800, 1100);
    const headline = await box(page, "landing-headline");
    const cards = await Promise.all(CARD_IDS.map((id) => box(page, `demo-card-${id}`)));
    // 640 max column, centred
    expect(Math.round(cards[0]!.width)).toBe(640);
    expect(Math.round(cards[0]!.x)).toBe(80);
    expect(Math.round(headline.x)).toBe(80);
    expect(
      await page.getByTestId("landing-headline").evaluate((el) => getComputedStyle(el).textAlign),
    ).toBe("left");
    for (const [i, id] of CARD_IDS.entries()) {
      const card = cards[i]!;
      if (i > 0) expect(card.y).toBeGreaterThan(cards[i - 1]!.y + cards[i - 1]!.height);
      // premium §11.2: text below the tile at every breakpoint; the tile holds only the disc
      const tile = await box(page, `demo-tile-${id}`);
      expect(Math.round(tile.width)).toBe(640);
      expect(Math.round(tile.height)).toBe(192);
      const wafer = await box(page, `landing-demo-wafer-${id}`);
      expect(Math.round(wafer.width)).toBe(112);
      expect(Math.abs(wafer.x + 56 - (tile.x + 320))).toBeLessThan(1);
      expect(Math.round(wafer.y - tile.y)).toBe(40);
    }
    await page.screenshot({ path: path.join(SHOTS, "p11-landing-800-light.png"), fullPage: true });
  });

  test("390 x 844: full-width buttons, short hint, 300 px carousel cards with a 46 px peek", async ({
    page,
  }) => {
    await openLanding(page, 390, 844);
    const headline = await box(page, "landing-headline");
    expect(Math.abs(headline.y - 88)).toBeLessThanOrEqual(4);
    expect(Math.round(headline.x)).toBe(16);

    const primary = await box(page, "landing-open-sample-button");
    const secondary = await box(page, "landing-open-stdf-button");
    expect(Math.round(primary.width)).toBe(358);
    expect(Math.round(primary.height)).toBe(48);
    expect(Math.round(secondary.width)).toBe(358);
    expect(Math.round(secondary.height)).toBe(44);
    expect(Math.round(secondary.y - (primary.y + primary.height))).toBe(12);
    expect(await page.getByTestId("landing-hint").innerText()).toBe("Files stay on this device.");

    const card1 = await box(page, "demo-card-edge-ring-etch");
    const card2 = await box(page, "demo-card-handling-scratch");
    expect(Math.round(card1.width)).toBe(300);
    expect(Math.round(card2.x - (card1.x + card1.width))).toBe(12);
    expect(Math.round(390 - 16 - card2.x)).toBe(46);
    // premium §11.1: the hero wafer and result card push the cards below the fold
    for (const id of ["landing-hint", "landing-open-stdf-button"]) {
      const b = await box(page, id);
      expect(b.y + b.height, id).toBeLessThanOrEqual(844);
    }
    await page.screenshot({ path: path.join(SHOTS, "p11-landing-390-light.png") });
  });
});
