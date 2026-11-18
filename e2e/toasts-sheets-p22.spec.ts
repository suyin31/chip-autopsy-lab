import * as fs from "node:fs";
import * as path from "node:path";
import { expect, type Page, test } from "@playwright/test";

/**
 * Premium P22: toasts (premium §7.13) and dialog surfaces (§7.16). The selection popover
 * content (§7.14) is covered by `linked-interactions-r7` and `selection-popover.test.ts`.
 * Accept: A34 (a download toast sits bottom-centre on `material-thick` with `shadow-popover`,
 * has no coloured icon, and leaves after about 4 s; an error toast stays until dismissed).
 */

const SHOTS = path.join(__dirname, "..", "logs", "shots");

async function open(page: Page) {
  await page.addInitScript(() => {
    window.localStorage.setItem("cal.theme", "light");
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/?nohints=1");
  await expect(page.getByTestId("full-window-drop-zone")).toHaveAttribute(
    "data-dropzone-ready",
    "true",
  );
}

async function downloadSample(page: Page): Promise<Buffer> {
  await page.getByTestId("landing-download-demos-trigger").click();
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByTestId("download-demo-stdf-edge-ring-etch").click(),
  ]);
  return fs.readFileSync(await download.path());
}

test.describe("P22 toasts and sheets (premium §7.13, §7.16)", () => {
  test("A34: download toast bottom-centre on material-thick, no icon, gone after about 4 s; error toast stays", async ({
    page,
  }) => {
    test.setTimeout(60_000);
    await open(page);
    const bytes = await downloadSample(page);
    // Keep the pointer away from the toast so hover does not pause it
    await page.mouse.move(40, 120);

    const toast = page.locator("[data-sonner-toast]").filter({
      hasText: "Downloaded edge-ring-etch.stdf.",
    });
    await expect(toast).toBeVisible();
    await expect(toast.locator("[data-icon]")).toHaveCount(0);
    await toast.screenshot({ path: path.join(SHOTS, "p22-download-toast-light.png") });

    const style = await toast.evaluate((el) => {
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      const list = el.closest<HTMLElement>("[data-sonner-toaster]")!;
      return {
        bg: cs.backgroundColor,
        shadow: cs.boxShadow,
        radius: cs.borderTopLeftRadius,
        display: cs.display,
        minHeight: cs.minHeight,
        padding: `${cs.paddingTop} ${cs.paddingLeft}`,
        centre: r.left + r.width / 2,
        bottom: r.bottom,
        width: r.width,
        z: getComputedStyle(list).zIndex,
      };
    });
    expect(style.bg).toBe("rgba(255, 255, 255, 0.92)");
    expect(style.shadow).not.toBe("none");
    expect(style.radius).toBe("16px");
    expect(style.display).toBe("grid");
    expect(style.minHeight).toBe("48px");
    expect(style.padding).toBe("12px 16px");
    expect(Math.abs(style.centre - 720)).toBeLessThan(1.5);
    expect(Math.round(900 - style.bottom)).toBe(24);
    expect(Math.round(style.width)).toBe(380);
    expect(style.z).toBe("70");

    // Still there at 3 s, gone by about 4 s (+ exit fade)
    await page.waitForTimeout(3_000);
    await expect(toast).toBeVisible();
    await expect(toast).toHaveCount(0, { timeout: 2_500 });

    // Error toast: a sample file cut mid-record loads its complete wafers and keeps a persistent toast
    const truncated = bytes.subarray(0, bytes.length - 3).toString("base64");
    await page.evaluate((b64) => {
      const raw = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const file = new File([raw], "edge-ring-cut.stdf", {
        type: "application/octet-stream",
      });
      const evt = new Event("drop", { bubbles: true, cancelable: true });
      Object.defineProperty(evt, "dataTransfer", {
        value: { types: ["Files"], files: [file] },
      });
      window.dispatchEvent(evt);
    }, truncated);

    const errorToast = page.locator('[data-sonner-toast][data-type="error"]');
    await expect(errorToast).toBeVisible({ timeout: 15_000 });
    await page.mouse.move(40, 120);

    // The icon is grey (`text-secondary`, the description colour), never red, orange, or green
    const tones = await errorToast.evaluate((el) => ({
      icon: getComputedStyle(el.querySelector("[data-icon]")!).color,
      description: getComputedStyle(el.querySelector("[data-description]")!).color,
    }));
    expect(tones.icon).toBe(tones.description);

    const dismiss = errorToast.getByRole("button", { name: "Dismiss" });
    const dismissBox = await dismiss.boundingBox();
    expect(Math.round(dismissBox!.width)).toBe(24);
    expect(Math.round(dismissBox!.height)).toBe(24);

    await errorToast.screenshot({ path: path.join(SHOTS, "p22-error-toast-light.png") });
    await page.waitForTimeout(5_000);
    await expect(errorToast).toBeVisible();
    await dismiss.click();
    await expect(errorToast).toHaveCount(0, { timeout: 2_000 });
  });

  test("error details dialog: 560 wide, title-2, Close icon button 16 / 16 from the top-right", async ({
    page,
  }) => {
    await open(page);
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
    const opener = page.getByTestId("parse-error-show-details");
    await opener.click();

    const sheet = page.getByTestId("error-details-sheet");
    await expect(sheet).toBeVisible();
    await expect
      .poll(async () => Math.round((await sheet.boundingBox())?.width ?? 0))
      .toBe(560);
    await expect(sheet.getByRole("heading")).toHaveCSS("font-size", "24px");
    await expect(sheet).toHaveCSS("border-top-left-radius", "24px");

    const close = sheet.getByRole("button", { name: "Close" });
    await expect
      .poll(async () => {
        const s = (await sheet.boundingBox())!;
        const c = (await close.boundingBox())!;
        return [Math.round(c.y - s.y), Math.round(s.x + s.width - (c.x + c.width))];
      })
      .toEqual([16, 16]);

    await page.screenshot({ path: path.join(SHOTS, "p22-error-details-1440-light.png") });
    await close.click();
    await expect(sheet).toBeHidden();
    await expect(opener).toBeFocused();
  });
});
