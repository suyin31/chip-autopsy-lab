import { expect, type Page, test } from "@playwright/test";

/**
 * Premium P30 (premium §8.4, §8.5): the wheel springs to `exp(-deltaY x 0.0015)` about the
 * cursor, the magnifier hides while the camera moves and returns on the next pointer move,
 * drag pans only at zoom > 1, and reduced motion makes the wheel jump.
 */

const TRANSFORM_RE =
  /translate3d\(([-\d.]+)px,\s*([-\d.]+)px,\s*0(?:px)?\)\s*scale\(([-\d.]+)\)/;

async function loadEdgeRing(page: Page, reducedMotion: boolean): Promise<void> {
  await page.addInitScript(() => {
    window.sessionStorage.setItem("cal.sweep.v1", "1");
  });
  if (reducedMotion) {
    await page.emulateMedia({ reducedMotion: "reduce" });
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/?nohints=1");
  await page.getByTestId("demo-card-edge-ring-etch").click();
  await expect(page.getByTestId("wafer-stage")).toHaveAttribute("data-sweep", "done", {
    timeout: 5_000,
  });
}

async function readCamera(page: Page): Promise<{ tx: number; ty: number; scale: number }> {
  const transform = await page
    .getByTestId("wafer-camera-wrapper")
    .evaluate((el) => (el as HTMLElement).style.transform);
  const m = TRANSFORM_RE.exec(transform);
  return m
    ? { tx: Number(m[1]), ty: Number(m[2]), scale: Number(m[3]) }
    : { tx: 0, ty: 0, scale: 1 };
}

test("wheel springs about the cursor and hides the magnifier until the pointer moves", async ({
  page,
}) => {
  await loadEdgeRing(page, false);
  const stage = page.getByTestId("wafer-stage");
  const box = (await stage.boundingBox())!;
  const px = box.x + box.width / 2;
  const py = box.y + box.height / 2;
  await page.mouse.move(px - 4, py);
  await page.mouse.move(px, py);
  const magnifier = page.getByTestId("wafer-hover-magnifier");
  await expect(magnifier).toHaveAttribute("data-visible", "true");

  await page.mouse.wheel(0, -240);
  // Hidden while the camera spring runs (§8.4)
  await expect(magnifier).toHaveAttribute("data-visible", "false");

  // Settles at exp(240 x 0.0015) with the point under the cursor fixed (§8.5)
  await expect(page.getByTestId("wafer-camera-wrapper")).toHaveCSS("will-change", "auto");
  const settled = await readCamera(page);
  expect(settled.scale).toBeCloseTo(Math.exp(240 * 0.0015), 2);
  const cx = box.width / 2;
  const cy = box.height / 2;
  expect(cx * settled.scale + settled.tx).toBeCloseTo(cx, 0);
  expect(cy * settled.scale + settled.ty).toBeCloseTo(cy, 0);

  // Stays hidden after the settle until the pointer moves
  await page.waitForTimeout(200);
  await expect(magnifier).toHaveAttribute("data-visible", "false");
  await page.mouse.move(px + 2, py);
  await expect(magnifier).toHaveAttribute("data-visible", "true");
});

test("drag pans only at zoom > 1", async ({ page }) => {
  await loadEdgeRing(page, false);
  const box = (await page.getByTestId("wafer-stage").boundingBox())!;
  const px = box.x + box.width / 2;
  const py = box.y + box.height / 2;
  await page.mouse.move(px, py);
  await page.mouse.down();
  for (let i = 1; i <= 6; i += 1) {
    await page.mouse.move(px + i * 20, py);
  }
  await page.mouse.up();
  expect(await readCamera(page)).toEqual({ tx: 0, ty: 0, scale: 1 });
});

test("reduced motion: the wheel jumps and a drag release stops at once", async ({ page }) => {
  await loadEdgeRing(page, true);
  const box = (await page.getByTestId("wafer-stage").boundingBox())!;
  const px = box.x + box.width / 2;
  const py = box.y + box.height / 2;
  await page.mouse.move(px, py);
  await page.mouse.wheel(0, -240);
  await expect
    .poll(async () => (await readCamera(page)).scale, { timeout: 500 })
    .toBeCloseTo(Math.exp(240 * 0.0015), 3);

  await page.mouse.down();
  for (let i = 1; i <= 6; i += 1) {
    await page.mouse.move(px + i * 24, py);
  }
  await page.mouse.up();
  const atRelease = await readCamera(page);
  await page.waitForTimeout(100);
  expect(await readCamera(page)).toEqual(atRelease);
});
