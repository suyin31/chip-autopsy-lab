import * as path from "node:path";
import { expect, type Page, test } from "@playwright/test";

/**
 * Premium P26b editorial accent (premium §12): warm paper bg (A45), one Instrument Serif accent
 * per viewport in Latin locales and none in CJK (A46), landing headline >= 88 px at 1440 (A47),
 * and the mono eyebrow (A48).
 */

const SHOTS = path.join(__dirname, "..", "logs", "shots");

async function open(page: Page, locale: string, loaded: boolean) {
  await page.addInitScript((l) => {
    window.localStorage.setItem("cal.theme", "light");
    window.localStorage.setItem("cal.locale", l);
    window.sessionStorage.setItem("cal.sweep.v1", "1");
  }, locale);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/?nohints=1");
  await expect(page.getByTestId("landing-headline")).toBeVisible();
  if (loaded) {
    await page.getByTestId("landing-open-sample-button").click();
    await expect(page.getByTestId("verdict-headline")).toBeVisible({ timeout: 5_000 });
  }
  await page.evaluate(() => document.fonts.ready);
}

/** Visible elements set in the accent face whose parent is not (one per accent run). */
function countAccentElements(page: Page) {
  return page.evaluate(() => {
    const isAccent = (el: Element | null) =>
      !!el && /instrument/i.test(getComputedStyle(el).fontFamily);
    return [...document.querySelectorAll<HTMLElement>("body *")].filter((el) => {
      if (!isAccent(el) || isAccent(el.parentElement)) return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < window.innerHeight;
    }).length;
  });
}

test.describe("P26b editorial accent (premium §12)", () => {
  test("A45 + A46 + A47 + A48 on the landing (en)", async ({ page }) => {
    await open(page, "en", false);
    const m = await page.evaluate(() => {
      const lum = (rgb: string) => {
        const [r, g, b] = rgb.match(/\d+(\.\d+)?/g)!.slice(0, 3).map(Number).map((v) => {
          const s = v / 255;
          return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
        });
        return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
      };
      const bg = getComputedStyle(document.body).backgroundColor;
      const subline = document.querySelector('[data-testid="landing-subline"]')!;
      const secondary = getComputedStyle(subline).color;
      const [hi, lo] = [lum(bg), lum(secondary)].sort((a, b) => b - a);
      const heading = document.querySelector('[data-testid="landing-sample-heading"]')!;
      const dot = document.querySelector('[data-testid="landing-eyebrow-dot"]')!;
      const accent = document.querySelector('[data-testid="landing-headline"] [data-accent]')!;
      return {
        bg,
        card: getComputedStyle(document.querySelector('[data-testid="demo-card-edge-ring-etch"]')!)
          .backgroundColor,
        secondaryRatio: (hi! + 0.05) / (lo! + 0.05),
        headlineSize: Number.parseFloat(
          getComputedStyle(document.querySelector('[data-testid="landing-headline"]')!).fontSize,
        ),
        accentText: accent.textContent,
        accentColor: getComputedStyle(accent).color,
        accentStyle: getComputedStyle(accent).fontStyle,
        eyebrowFont: getComputedStyle(heading).fontFamily,
        eyebrowSize: getComputedStyle(heading).fontSize,
        eyebrowTransform: getComputedStyle(heading).textTransform,
        dotSize: dot.getBoundingClientRect().width,
        dotColor: getComputedStyle(dot).backgroundColor,
      };
    });
    expect(m.bg).toBe("rgb(246, 243, 238)");
    expect(m.card).toBe("rgb(255, 255, 255)");
    expect(m.secondaryRatio).toBeGreaterThanOrEqual(4.5);
    expect(m.headlineSize).toBeGreaterThanOrEqual(88);
    expect(m.accentText).toBe("body");
    expect(m.accentColor).toBe("rgb(217, 78, 20)");
    expect(m.accentStyle).toBe("italic");
    expect(m.eyebrowFont).toMatch(/jetbrains/i);
    expect(m.eyebrowSize).toBe("12px");
    expect(m.eyebrowTransform).toBe("uppercase");
    expect(Math.round(m.dotSize)).toBe(6);
    expect(m.dotColor).toBe("rgb(255, 107, 44)");
    expect(await countAccentElements(page)).toBe(1);
    await page.screenshot({ path: path.join(SHOTS, "p26b-landing-1440-light.png") });
  });

  test("A46 loaded (en): the cause phrase is the one accent, and the verdict stays display-l", async ({
    page,
  }) => {
    await open(page, "en", true);
    expect(await countAccentElements(page)).toBe(1);
    const accent = page.locator('[data-testid="autopsy-headline-button"] [data-accent]');
    await expect(accent).toHaveText("Edge-Ring failure.");
    await expect(page.getByTestId("verdict-headline")).toHaveCSS("font-size", "48px");
    await page.screenshot({ path: path.join(SHOTS, "p26b-loaded-1440-light.png") });
  });

  for (const locale of ["ja", "zh-CN", "zh-TW", "ko"] as const) {
    test(`A46: no accent face in ${locale}, landing and loaded`, async ({ page }) => {
      await open(page, locale, false);
      expect(await countAccentElements(page)).toBe(0);
      await page.getByTestId("landing-open-sample-button").click();
      await expect(page.getByTestId("verdict-headline")).toBeVisible({ timeout: 5_000 });
      expect(await countAccentElements(page)).toBe(0);
      await expect(page.getByTestId("autopsy-headline-button")).toHaveCSS(
        "color",
        "rgb(217, 78, 20)",
      );
    });
  }
});
