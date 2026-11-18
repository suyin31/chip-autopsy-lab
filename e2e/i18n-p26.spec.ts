import { expect, type Page, test } from "@playwright/test";

/**
 * Premium P26 copy and i18n pass (premium.md §2.2, §9, §10):
 * - A40: CJK at 1440 and 390 keeps the verdict to 3 lines, letter-spacing 0, nothing clipped,
 *   the nav on one line, segmented labels whole, and codes untranslated inside `<bdi translate="no">`.
 * - A26: the takeaway is at most 2 lines at 1440 with no bin codes or test names, and no
 *   exclamation mark appears anywhere in the UI.
 */

async function loadDemo(page: Page, width: number, height: number, locale: string) {
  await page.addInitScript((loc) => {
    window.sessionStorage.setItem("cal.sweep.v1", "1");
    window.localStorage.setItem("cal.locale", loc);
  }, locale);
  await page.setViewportSize({ width, height });
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("lang", locale);
  await page.getByTestId("demo-card-edge-ring-etch").click();
  await expect(page.getByTestId("wafer-stage")).toHaveAttribute("data-sweep", "done", {
    timeout: 5_000,
  });
  await expect(page.getByTestId("verdict-headline")).toBeVisible();
  await expect(page.getByTestId("bin-pareto")).toBeAttached();
}

function lineCount(page: Page, selector: string) {
  return page.evaluate((sel) => {
    const el = document.querySelector<HTMLElement>(sel);
    if (!el) throw new Error(`missing ${sel}`);
    const lh = Number.parseFloat(getComputedStyle(el).lineHeight);
    return Math.round(el.getBoundingClientRect().height / lh);
  }, selector);
}

for (const locale of ["ja", "zh-CN", "zh-TW", "ko"] as const) {
  for (const [label, width, height] of [
    ["1440", 1440, 900],
    ["390", 390, 844],
  ] as const) {
    test(`A40: ${locale} at ${label} fits without clipping and keeps codes untranslated`, async ({
      page,
    }) => {
      await loadDemo(page, width, height, locale);

      expect(await lineCount(page, '[data-testid="verdict-headline"]')).toBeLessThanOrEqual(3);

      const report = await page.evaluate(() => {
        const q = (sel: string) => Array.from(document.querySelectorAll<HTMLElement>(sel));
        const visible = (el: HTMLElement) => {
          const r = el.getBoundingClientRect();
          return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden";
        };
        const spacing = q(
          '[data-testid="verdict-headline"], [data-testid="verdict-subline"], [data-testid="nav-bar"] nav, [role="radio"], [data-testid="finding-row-headline"]',
        )
          .filter(visible)
          .map((el) => getComputedStyle(el).letterSpacing)
          .filter((v) => v !== "0px" && v !== "normal");

        // Nothing clipped: headline, takeaway, buttons, and segmented labels fit their own boxes
        const clipped = q(
          '[data-testid="verdict-headline"], [data-testid="verdict-subline"], main button, [role="radio"], [data-testid="nav-bar"] button, [data-testid="nav-bar"] a',
        )
          .filter(visible)
          .filter(
            (el) =>
              !el.classList.contains("truncate") &&
              !el.querySelector(".truncate") &&
              (el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1) &&
              getComputedStyle(el).overflow !== "visible",
          )
          .map((el) => el.outerHTML.slice(0, 120));

        // Nav: one 48/52 px row, every child inside it, the three columns never overlap
        const nav = document.querySelector<HTMLElement>('[data-testid="nav-bar"] nav')!;
        const navRect = nav.getBoundingClientRect();
        const cols = Array.from(nav.children)
          .map((c) => c.getBoundingClientRect())
          .filter((r) => r.width > 0);
        const navInside = cols.every(
          (r) =>
            r.left >= navRect.left - 0.5 &&
            r.right <= navRect.right + 0.5 &&
            r.top >= navRect.top - 0.5 &&
            r.bottom <= navRect.bottom + 0.5,
        );
        let navOverlap = false;
        for (let i = 1; i < cols.length; i += 1) {
          if (cols[i]!.left < cols[i - 1]!.right - 0.5) navOverlap = true;
        }

        // Segmented labels never truncate, and the groups stay inside the viewport
        const segmentsWhole = q('[role="radiogroup"]')
          .filter(visible)
          .every((g) => {
            const r = g.getBoundingClientRect();
            return (
              r.left >= -0.5 &&
              r.right <= window.innerWidth + 0.5 &&
              Array.from(g.querySelectorAll<HTMLElement>('[role="radio"] span')).every(
                (s) => s.scrollWidth <= s.clientWidth + 1,
              )
            );
          });

        const bdiTexts = q('bdi[translate="no"]').map((el) => el.textContent ?? "");
        return {
          spacing,
          clipped,
          navHeight: navRect.height,
          navInside,
          navOverlap,
          navScroll: nav.scrollWidth <= nav.clientWidth + 1,
          segmentsWhole,
          bdiTexts,
        };
      });

      expect(report.spacing, "non-zero letter-spacing").toEqual([]);
      expect(report.clipped, "clipped elements").toEqual([]);
      expect(report.navHeight).toBeLessThanOrEqual(52);
      expect(report.navInside, "nav children inside one row").toBe(true);
      expect(report.navOverlap, "nav columns overlap").toBe(false);
      expect(report.navScroll, "nav overflows").toBe(true);
      expect(report.segmentsWhole, "segmented labels truncated or off screen").toBe(true);

      // Never translated (premium §9.2): class name, bin codes, and test names sit in <bdi translate="no">
      expect(report.bdiTexts).toContain("Edge-Ring");
      expect(report.bdiTexts.some((s) => /^SBIN \d+$/.test(s))).toBe(true);
      expect(report.bdiTexts.some((s) => /^[A-Z][A-Z0-9]*_[A-Z0-9_]+$/.test(s))).toBe(true);

      // Plain-language Pareto mode labels (premium §2.2), never the bare codes
      const paretoModes = page.getByTestId("bin-pareto-mode").getByRole("radio");
      await expect(paretoModes).toHaveCount(2);
      for (const text of await paretoModes.allTextContents()) {
        expect(text).not.toMatch(/^[HS]BIN$/);
      }

      const text = await page.evaluate(() => document.body.innerText);
      expect(text).not.toMatch(/[!！]/);
    });
  }
}

test("A26: the takeaway is plain and short, and no exclamation mark appears", async ({ page }) => {
  await page.addInitScript(() => window.sessionStorage.setItem("cal.sweep.v1", "1"));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  expect(await page.evaluate(() => document.body.innerText)).not.toContain("!");

  await page.getByTestId("demo-card-edge-ring-etch").click();
  await expect(page.getByTestId("wafer-stage")).toHaveAttribute("data-sweep", "done", {
    timeout: 5_000,
  });
  const takeaway = page.getByTestId("verdict-subline");
  await expect(takeaway).toBeVisible();
  expect(await lineCount(page, '[data-testid="verdict-subline"]')).toBeLessThanOrEqual(2);
  const takeawayText = (await takeaway.textContent()) ?? "";
  expect(takeawayText).not.toMatch(/\b[HS]BIN\b/);
  expect(takeawayText).not.toMatch(/\b[A-Z][A-Z0-9]*_[A-Z0-9_]+\b/);

  await expect(
    page.getByTestId("bin-pareto-mode").getByRole("radio", { name: "Soft bins" }),
  ).toBeVisible();
  await expect(
    page.getByTestId("bin-pareto-mode").getByRole("radio", { name: "Hard bins" }),
  ).toBeVisible();
  expect(await page.evaluate(() => document.body.innerText)).not.toContain("!");
});
