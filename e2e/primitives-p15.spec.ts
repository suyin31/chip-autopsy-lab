import path from "node:path";
import { expect, type Page, test } from "@playwright/test";

/**
 * Premium P15 acceptance A30 (§7.8) plus the §7.11 button surfaces: the segmented control has a
 * grey track and a white thumb with a soft shadow in light, a translucent white thumb with no
 * shadow in dark, and the active label is `text-primary`. Buttons use the `focus-ring` token.
 */

const SHOTS = path.join(__dirname, "..", "logs", "shots");

async function openDemo(page: Page, theme: "light" | "dark") {
  await page.addInitScript((t) => {
    window.sessionStorage.setItem("cal.sweep.v1", "1");
    window.localStorage.setItem("cal.theme", t);
  }, theme);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/?nohints=1");
  await page.getByTestId("demo-card-edge-ring-etch").click();
  await expect(page.getByTestId("wafer-stage")).toHaveAttribute(
    "data-sweep",
    "done",
    { timeout: 5_000 },
  );
}

async function readSegmented(page: Page) {
  return page.evaluate(() => {
    const track = document.querySelector<HTMLElement>(
      '[data-testid="stage-mode-segmented"]',
    )!;
    const active = track.querySelector<HTMLElement>('[aria-checked="true"]')!;
    const inactive = track.querySelector<HTMLElement>('[aria-checked="false"]')!;
    const thumb = active.querySelector<HTMLElement>("[data-segmented-thumb]")!;
    const t = getComputedStyle(track);
    const th = getComputedStyle(thumb);
    return {
      trackBg: t.backgroundColor,
      trackHeight: track.getBoundingClientRect().height,
      trackBorder: t.borderTopWidth,
      thumbBg: th.backgroundColor,
      thumbShadow: th.boxShadow,
      thumbRadius: th.borderTopLeftRadius,
      activeColor: getComputedStyle(active).color,
      inactiveColor: getComputedStyle(inactive).color,
      segmentHeight: active.getBoundingClientRect().height,
    };
  });
}

test.describe("Premium P15 - primitives", () => {
  test("A30 light: grey track, white thumb with a soft shadow, active label text-primary", async ({
    page,
  }) => {
    await openDemo(page, "light");
    const s = await readSegmented(page);
    expect(s.trackBg).toBe("rgba(0, 0, 0, 0.055)");
    expect(Math.round(s.trackHeight)).toBe(32);
    expect(s.trackBorder).toBe("0px");
    expect(Math.round(s.segmentHeight)).toBe(28);
    expect(s.thumbBg).toBe("rgb(255, 255, 255)");
    expect(s.thumbShadow).toContain("rgba(0, 0, 0, 0.1) 0px 1px 3px");
    expect(s.thumbRadius).toBe("999px");
    expect(s.activeColor).toBe("rgb(29, 29, 31)");
    expect(s.inactiveColor).toBe("rgb(81, 81, 84)");
    await page
      .getByTestId("stage-control-row")
      .screenshot({ path: path.join(SHOTS, "p15-segmented-light.png") });
  });

  test("A30 dark: translucent white thumb, no shadow", async ({ page }) => {
    await openDemo(page, "dark");
    const s = await readSegmented(page);
    expect(s.trackBg).toBe("rgba(255, 255, 255, 0.08)");
    expect(s.thumbBg).toBe("rgba(255, 255, 255, 0.16)");
    // Tailwind composes empty shadow layers; every layer must be fully transparent
    expect(s.thumbShadow.replaceAll("rgba(0, 0, 0, 0) 0px 0px 0px 0px", "")).toMatch(
      /^[\s,]*$|^none$/,
    );
    expect(s.activeColor).toBe("rgba(255, 255, 255, 0.92)");
    await page
      .getByTestId("stage-control-row")
      .screenshot({ path: path.join(SHOTS, "p15-segmented-dark.png") });
  });

  test("§7.11: landing primary and secondary fills, keyboard-only focus-ring", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem("cal.theme", "light");
    });
    await page.goto("/?nohints=1");
    const primary = page.getByTestId("landing-open-sample-button");
    const secondary = page.getByTestId("landing-open-stdf-button");
    await expect(primary).toHaveAttribute("data-variant", "primary");
    await expect(primary).toHaveCSS("background-color", "rgb(29, 29, 31)");
    await expect(primary).toHaveCSS("color", "rgb(255, 255, 255)");
    await expect(secondary).toHaveCSS("background-color", "rgba(0, 0, 0, 0.055)");
    expect(await page.locator('button[data-variant="primary"]:visible').count()).toBe(1);

    // Mouse focus shows no ring; keyboard focus shows the 2 + 2 px focus-ring token
    await secondary.hover();
    await expect(secondary).toHaveCSS("background-color", "rgba(0, 0, 0, 0.08)");
    await primary.focus();
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Tab");
    await expect(primary).toBeFocused();
    await expect(primary).toHaveCSS("outline-style", "none");
    const shadow = await primary.evaluate((el) => getComputedStyle(el).boxShadow);
    expect(shadow).toContain("rgb(29, 29, 31) 0px 0px 0px 4px");
  });
});
