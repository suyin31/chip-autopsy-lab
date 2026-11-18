import { expect, type Page, test } from "@playwright/test";

/**
 * Premium P23 acceptance A10 (premium §5.9, §7.15): hovering a fail die shows the hover stroke
 * and a magnifier with at most 4 Inter readout rows, status first, no tertiary-grey and no
 * orange text. A touch tap pins the readout 12 px above the die without the loupe.
 */

const EMBER = ["rgb(255, 107, 44)", "rgb(232, 89, 30)", "rgb(217, 78, 20)", "rgb(255, 138, 87)"];

async function loadEdgeRing(page: Page, theme: "light" | "dark"): Promise<void> {
  await page.addInitScript((t) => {
    window.sessionStorage.setItem("cal.sweep.v1", "1");
    window.localStorage.setItem("cal.theme", t);
  }, theme);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await page.getByTestId("demo-card-edge-ring-etch").click();
  await expect(page.getByTestId("wafer-stage")).toHaveAttribute("data-sweep", "done", {
    timeout: 5_000,
  });
}

/** Sweeps the pointer in from the left of the stage until the magnifier reports a failed die. */
async function hoverFailDie(page: Page): Promise<{ x: number; y: number }> {
  const box = (await page.getByTestId("wafer-stage").boundingBox())!;
  const y = box.y + box.height / 2;
  for (let x = box.x + 8; x < box.x + box.width / 2; x += 3) {
    await page.mouse.move(x, y);
    const kind = await page
      .locator("[data-magnifier-swatch]")
      .first()
      .getAttribute("data-magnifier-swatch", { timeout: 200 })
      .catch(() => null);
    const visible = await page
      .getByTestId("wafer-hover-magnifier")
      .getAttribute("data-visible");
    if (kind === "fail" && visible === "true") {
      return { x, y };
    }
  }
  throw new Error("No failing die found along the stage midline");
}

for (const theme of ["light", "dark"] as const) {
  test(`A10 (${theme}): fail-die magnifier has 4 rows max, status first, Inter, no tertiary or orange text`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await loadEdgeRing(page, theme);
    await hoverFailDie(page);

    const overlay = page.getByTestId("wafer-overlay-wrapper");
    expect(await overlay.getAttribute("data-hovered-die")).not.toBe("");

    const magnifier = page.getByTestId("wafer-hover-magnifier");
    await expect(magnifier).toHaveAttribute("data-visible", "true");
    expect((await magnifier.boundingBox())!.width).toBeCloseTo(200, 0);
    const loupe = (await page.getByTestId("magnifier-loupe-canvas").boundingBox())!;
    expect(loupe.width).toBeCloseTo(184, 0);
    expect(loupe.height).toBeCloseTo(112, 0);

    const report = await page.getByTestId("magnifier-readout").evaluate((root) => {
      const rows = Array.from(root.querySelectorAll<HTMLElement>("[data-magnifier-row]"));
      const texts = Array.from(root.querySelectorAll<HTMLElement>("*")).filter((el) =>
        Array.from(el.childNodes).some(
          (n) => n.nodeType === Node.TEXT_NODE && (n.textContent ?? "").trim() !== "",
        ),
      );
      const tertiary = getComputedStyle(document.documentElement)
        .getPropertyValue("--text-tertiary")
        .trim();
      const probe = document.createElement("span");
      probe.style.color = tertiary;
      document.body.appendChild(probe);
      const tertiaryRgb = getComputedStyle(probe).color;
      probe.remove();
      return {
        rows: rows.map((r) => r.dataset.magnifierRow),
        statusText: rows[0]?.textContent ?? "",
        fonts: texts.map((el) => getComputedStyle(el).fontFamily),
        colors: texts.map((el) => getComputedStyle(el).color),
        tertiaryRgb,
      };
    });

    expect(report.rows.length).toBeLessThanOrEqual(4);
    expect(report.rows[0]).toBe("status");
    expect(report.statusText).toContain("Failed");
    expect(report.statusText).toMatch(/SBIN \d+/);
    for (const font of report.fonts) {
      expect(font).toMatch(/inter/i);
      expect(font).not.toMatch(/mono/i);
    }
    for (const color of report.colors) {
      expect(color).not.toBe(report.tertiaryRgb);
      expect(EMBER).not.toContain(color);
    }
  });
}

test("A10 touch: a tap pins the readout 12 px above the die with no loupe", async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    hasTouch: true,
  });
  const page = await context.newPage();
  await loadEdgeRing(page, "light");
  const box = (await page.getByTestId("wafer-stage").boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.touchscreen.tap(x, y);

  const magnifier = page.getByTestId("wafer-hover-magnifier");
  await expect(magnifier).toHaveAttribute("data-visible", "true");
  await expect(magnifier).toHaveAttribute("data-pin-source", "touch");
  await expect(page.getByTestId("magnifier-loupe-canvas")).toHaveCount(0);
  const mag = (await magnifier.boundingBox())!;
  // Readout bottom sits above the tapped point (die top - 12 px) and is centred on it
  expect(mag.y + mag.height).toBeLessThan(y);
  expect(Math.abs(mag.x + mag.width / 2 - x)).toBeLessThan(16);
  await context.close();
});
