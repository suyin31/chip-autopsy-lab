import path from "node:path";
import { expect, type Page, test } from "@playwright/test";

/**
 * P14: parse error (premium §6.4, §9.6), drag overlay (§6.5), and bins-only sheet (§6.6, §7.16).
 * Accept: A20 (exactly one filled `ink` button on the parse error and bins-only screens).
 */

const SHOTS = path.join(__dirname, "..", "logs", "shots");
const INK_LIGHT = "rgb(29, 29, 31)";

async function open(page: Page, width: number, height: number) {
  await page.addInitScript(() => {
    window.localStorage.setItem("cal.theme", "light");
  });
  await page.setViewportSize({ width, height });
  await page.goto("/?nohints=1");
  await expect(page.getByTestId("full-window-drop-zone")).toHaveAttribute(
    "data-dropzone-ready",
    "true",
  );
}

async function dropPng(page: Page) {
  await page.evaluate(() => {
    const bytes = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
      0x49, 0x48, 0x44, 0x52,
    ]);
    const file = new File([bytes], "wafer-photo.png", { type: "image/png" });
    const evt = new Event("drop", { bubbles: true, cancelable: true });
    Object.defineProperty(evt, "dataTransfer", {
      value: { types: ["Files"], files: [file] },
    });
    window.dispatchEvent(evt);
  });
  await expect(page.getByTestId("parse-error-title")).toBeVisible();
}

async function box(page: Page, testId: string) {
  const b = await page.getByTestId(testId).boundingBox();
  expect(b, testId).not.toBeNull();
  return b!;
}

function countInkFilledButtons(page: Page, ink: string) {
  return page.evaluate((inkColor) => {
    return [...document.querySelectorAll<HTMLElement>("button")].filter((b) => {
      const r = b.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return false;
      return getComputedStyle(b).backgroundColor === inkColor;
    }).length;
  }, ink);
}

test.describe("P14 loading, error, drag overlay, bins-only (premium §6.3–§6.6)", () => {
  test("parse error at 1440: centred title-1 at y = 164, one ink primary, sample lot secondary", async ({
    page,
  }) => {
    await open(page, 1440, 900);
    await dropPng(page);

    const title = page.getByTestId("parse-error-title");
    const t = await box(page, "parse-error-title");
    expect(Math.abs(t.y - 164)).toBeLessThanOrEqual(2);
    expect(Math.abs(t.x + t.width / 2 - 720)).toBeLessThanOrEqual(2);
    await expect(title).toHaveCSS("font-size", "34px");
    await expect(title).toHaveCSS("font-weight", "600");

    const body = await box(page, "parse-error-body");
    expect(body.width).toBeLessThanOrEqual(560);
    expect(Math.round(body.y - (t.y + t.height))).toBe(12);

    const primary = await box(page, "parse-error-open-another");
    const secondary = await box(page, "parse-error-load-demo");
    expect(Math.round(primary.y - (body.y + body.height))).toBe(32);
    expect(Math.round(primary.height)).toBe(48);
    await expect(page.getByTestId("parse-error-load-demo")).toHaveText(
      "Open the sample lot",
    );
    expect(secondary.x).toBeGreaterThan(primary.x);
    const details = await box(page, "parse-error-show-details");
    expect(Math.round(details.y - (primary.y + primary.height))).toBe(16);

    // A20 and §6.4: one ink primary, no ember or red anywhere in the error block
    expect(await countInkFilledButtons(page, INK_LIGHT)).toBe(1);
    await expect(page.getByTestId("parse-error-open-another")).toHaveCSS(
      "background-color",
      INK_LIGHT,
    );
    await expect(page.getByTestId("demo-card-edge-ring-etch")).toBeVisible();

    await page.screenshot({ path: path.join(SHOTS, "p14-error-1440-light.png") });
  });

  test("parse error at 390: left-aligned at y = 96, stacked full-width buttons with 12 gap", async ({
    page,
  }) => {
    await open(page, 390, 844);
    await dropPng(page);

    const t = await box(page, "parse-error-title");
    expect(Math.abs(t.y - 96)).toBeLessThanOrEqual(2);
    expect(Math.round(t.x)).toBe(16);
    await expect(page.getByTestId("parse-error-title")).toHaveCSS(
      "font-size",
      "28px",
    );

    const primary = await box(page, "parse-error-open-another");
    const secondary = await box(page, "parse-error-load-demo");
    expect(Math.round(primary.width)).toBe(358);
    expect(Math.round(secondary.width)).toBe(358);
    expect(Math.round(secondary.y - (primary.y + primary.height))).toBe(12);
    expect(await countInkFilledButtons(page, INK_LIGHT)).toBe(1);

    await page.screenshot({ path: path.join(SHOTS, "p14-error-390-light.png") });
  });

  test("drag overlay: scrim, 16 px inset frame with r-3xl and 1.5 px hairline-strong, no dot grid", async ({
    page,
  }) => {
    await open(page, 1440, 900);
    const fire = (type: string, types: string[]) =>
      page.evaluate(
        ([t, ty]) => {
          const evt = new Event(t as string, { bubbles: true, cancelable: true });
          Object.defineProperty(evt, "dataTransfer", { value: { types: ty } });
          window.dispatchEvent(evt);
        },
        [type, types] as const,
      );

    await fire("dragenter", ["Files"]);
    const overlay = page.getByTestId("full-window-drop-overlay");
    await expect(overlay).toBeVisible();
    await expect(overlay).toHaveCSS("background-color", "rgba(245, 245, 247, 0.6)");
    await expect(overlay).toHaveCSS("z-index", "80");

    const frame = page.getByTestId("full-window-drop-frame");
    const f = await box(page, "full-window-drop-frame");
    expect(Math.round(f.x)).toBe(16);
    expect(Math.round(f.y)).toBe(16);
    expect(Math.round(f.width)).toBe(1440 - 32);
    await expect(frame).toHaveCSS("border-top-left-radius", "28px");
    await expect(frame).toHaveCSS(
      "box-shadow",
      "rgba(0, 0, 0, 0.14) 0px 0px 0px 1.5px inset",
    );
    expect(
      await frame.evaluate(
        (el) =>
          [...el.querySelectorAll<HTMLElement>("*")].filter((n) =>
            getComputedStyle(n).backgroundImage.includes("radial-gradient"),
          ).length,
      ),
    ).toBe(0);

    const headline = overlay.getByText("Drop the body.");
    await expect(headline).toHaveCSS("font-size", "80px");
    await page.screenshot({ path: path.join(SHOTS, "p14-drag-1440-light.png") });

    // Non-file drag: same frame colour, "Only files can be opened here."
    await fire("dragover", ["text/plain"]);
    await expect(overlay).toContainText("Only files can be opened here.");
    await expect(frame).toHaveCSS(
      "box-shadow",
      "rgba(0, 0, 0, 0.14) 0px 0px 0px 1.5px inset",
    );
    await page.evaluate(() => window.dispatchEvent(new Event("dragend")));
    await expect(overlay).toBeHidden();
  });

  test("bins-only sheet: 480 surface, title-1, Use bins-only focused and last, one ink primary", async ({
    page,
  }) => {
    await open(page, 1440, 900);
    await page.evaluate(() => {
      const header = new Uint8Array([0x02, 0x00, 0x00, 0x0a, 0x02, 0x04]);
      const file = new File([header], "lot-312mb.stdf", {
        type: "application/octet-stream",
      });
      Object.defineProperty(file, "size", {
        value: 312 * 1024 * 1024,
        configurable: true,
      });
      const evt = new Event("drop", { bubbles: true, cancelable: true });
      Object.defineProperty(evt, "dataTransfer", {
        value: { types: ["Files"], files: [file] },
      });
      window.dispatchEvent(evt);
    });

    const sheet = page.getByTestId("bins-only-sheet");
    await expect(sheet).toBeVisible();
    // Wait for the spring-ui entrance to settle before measuring
    await expect
      .poll(async () => Math.round((await sheet.boundingBox())?.width ?? 0))
      .toBe(480);
    await expect(sheet).toHaveCSS("background-color", "rgb(255, 255, 255)");
    await expect(sheet).toHaveCSS("border-top-left-radius", "24px");
    await expect(sheet).toHaveCSS("padding-top", "32px");
    await expect(sheet.getByRole("heading")).toHaveCSS("font-size", "34px");
    await expect(page.getByTestId("sheet-scrim")).toHaveCSS(
      "background-color",
      "rgba(245, 245, 247, 0.6)",
    );

    const confirm = page.getByTestId("bins-only-confirm-button");
    await expect(confirm).toBeFocused();
    await expect(confirm).toHaveCSS("background-color", INK_LIGHT);
    const c = await box(page, "bins-only-confirm-button");
    const p = await box(page, "bins-only-parse-all-button");
    expect(c.x).toBeGreaterThan(p.x);
    // A20: the sheet holds exactly one ink primary
    expect(
      await sheet.evaluate(
        (el, ink) =>
          [...el.querySelectorAll<HTMLElement>("button")].filter(
            (b) => getComputedStyle(b).backgroundColor === ink,
          ).length,
        INK_LIGHT,
      ),
    ).toBe(1);

    await page.screenshot({ path: path.join(SHOTS, "p14-bins-only-1440-light.png") });
    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();
  });
});
