import { expect, type Page, test } from "@playwright/test";

/**
 * Premium P10 acceptance A11 and A35 (stage part), premium §5.5-§5.7 and §7.7: the stage header
 * sits above the wafer, one control row under it holds the segmented control, the legend, and
 * Select an area, nothing floats over the wafer, and the stage focus ring is keyboard-only.
 */

async function openDemo(page: Page, width: number, height: number) {
  await page.addInitScript(() => {
    window.sessionStorage.setItem("cal.sweep.v1", "1");
  });
  await page.setViewportSize({ width, height });
  await page.goto("/?nohints=1");
  await page.getByTestId("demo-card-edge-ring-etch").click();
  await expect(page.getByTestId("wafer-stage")).toHaveAttribute(
    "data-sweep",
    "done",
    { timeout: 5_000 },
  );
}

test("A11: one control row under the wafer, header above, nothing over the wafer", async ({
  page,
}) => {
  await openDemo(page, 1440, 900);

  const header = page.getByTestId("stage-header");
  await expect(header.getByRole("heading")).toHaveText("Wafer W01");
  await expect(page.getByTestId("stage-caption")).toHaveText(
    /^[\d,]+ of [\d,]+ dies failed$/,
  );

  const segmented = page.getByTestId("stage-mode-segmented");
  for (const name of ["Pass/fail", "Hard bins", "Soft bins"]) {
    await expect(segmented.getByRole("radio", { name })).toBeVisible();
  }
  const legend = page.getByTestId("stage-legend");
  const failed = legend.getByRole("button", { name: /Failed/ });
  const passed = legend.getByRole("button", { name: /Passed/ });
  await expect(failed).toHaveText(/^Failed[\d,]+$/);
  await expect(passed).toHaveText(/^Passed[\d,]+$/);
  const selectArea = page.getByRole("button", { name: "Select an area" });
  await expect(selectArea).toBeVisible();

  const geometry = await page.evaluate(() => {
    const box = (sel: string) =>
      document.querySelector<HTMLElement>(sel)!.getBoundingClientRect();
    const stage = document.querySelector<HTMLElement>(
      '[data-testid="wafer-stage"]',
    )!;
    const centreY = (r: DOMRect) => r.top + r.height / 2;
    const rowBox = box('[data-testid="stage-control-row"]');
    const parts = [
      box('[data-testid="stage-mode-segmented"]'),
      box('[data-testid="stage-legend"]'),
      box('[data-testid="stage-select-area"]'),
    ];
    return {
      headerBottom: box('[data-testid="stage-header"]').bottom,
      stageTop: stage.getBoundingClientRect().top,
      stageBottom: stage.getBoundingClientRect().bottom,
      rowTop: rowBox.top,
      rowHeight: rowBox.height,
      centreSpread:
        Math.max(...parts.map(centreY)) - Math.min(...parts.map(centreY)),
      legendLeftOfSelect: parts[1]!.right < parts[2]!.left,
      controlsOnStage: stage.querySelectorAll(
        'button, [role="radiogroup"]',
      ).length,
    };
  });
  expect(geometry.headerBottom).toBeLessThanOrEqual(geometry.stageTop);
  expect(geometry.rowTop).toBeGreaterThanOrEqual(geometry.stageBottom - 0.5);
  expect(geometry.rowHeight).toBe(40);
  expect(geometry.centreSpread).toBeLessThanOrEqual(1);
  expect(geometry.legendLeftOfSelect).toBe(true);
  expect(geometry.controlsOnStage).toBe(0);

  // Legend entries toggle visibility (premium §5.7)
  await failed.click();
  await expect(failed).toHaveAttribute("aria-pressed", "false");
  await failed.click();
  await expect(failed).toHaveAttribute("aria-pressed", "true");

  // Select an area toggles the crosshair tool; S does the same (premium §7.7)
  await selectArea.click();
  await expect(selectArea).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("wafer-stage")).toHaveAttribute(
    "data-stage-tool",
    "select",
  );
  await selectArea.click();
  await expect(selectArea).toHaveAttribute("aria-pressed", "false");

  // Reset view shows the zoom value once zoomed
  await expect(page.getByTestId("stage-reset-view")).toBeHidden();
  await page.getByTestId("wafer-stage").focus();
  await page.keyboard.press("+");
  await expect(page.getByTestId("stage-reset-view-button")).toHaveText(
    "Reset view",
    { useInnerText: true },
  );
  await expect(page.getByTestId("stage-zoom-value")).toHaveText(/^\d+%$/);
  await page.keyboard.press("0");
  await expect(page.getByTestId("stage-reset-view")).toBeHidden();
});

test("A35: mouse focus shows no stage ring; keyboard focus shows a 2 px ink ring with 28 px corners inset 8 px", async ({
  page,
}) => {
  await openDemo(page, 1440, 900);
  const stage = page.getByTestId("wafer-stage");
  const ring = () =>
    stage.evaluate((el) => {
      const after = getComputedStyle(el, "::after");
      return {
        focused: document.activeElement === el,
        content: after.content,
        outlineWidth: after.outlineWidth,
        outlineStyle: after.outlineStyle,
        outlineColor: after.outlineColor,
        outlineOffset: after.outlineOffset,
        borderRadius: after.borderTopLeftRadius,
        inset: [after.top, after.right, after.bottom, after.left],
        stageOutline: getComputedStyle(el).outlineStyle,
        ink: (() => {
          const probe = document.createElement("span");
          probe.style.color = "var(--ink)";
          document.body.appendChild(probe);
          const colour = getComputedStyle(probe).color;
          probe.remove();
          return colour;
        })(),
      };
    });

  const box = (await stage.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  const mouse = await ring();
  expect(mouse.focused).toBe(true);
  expect(mouse.content).toBe("none");
  expect(mouse.stageOutline).toBe("none");

  // Keyboard: Tab back into the stage from the segmented control below it
  await page.getByTestId("stage-mode-segmented").getByRole("radio", { checked: true }).focus();
  await page.keyboard.press("Shift+Tab");
  let keyboard = await ring();
  for (let i = 0; i < 6 && !keyboard.focused; i += 1) {
    await page.keyboard.press("Shift+Tab");
    keyboard = await ring();
  }
  expect(keyboard.focused).toBe(true);
  expect(keyboard.content).not.toBe("none");
  expect(keyboard.outlineWidth).toBe("2px");
  expect(keyboard.outlineStyle).toBe("solid");
  expect(keyboard.outlineOffset).toBe("-2px");
  expect(keyboard.borderRadius).toBe("28px");
  expect(keyboard.inset).toEqual(["8px", "8px", "8px", "8px"]);
  // The ring is drawn in the theme's ink token
  expect(keyboard.outlineColor).toBe(keyboard.ink);
});
