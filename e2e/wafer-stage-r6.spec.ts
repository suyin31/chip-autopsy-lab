import { expect, test } from '@playwright/test';

test.describe('Redesign R6 — Wafer stage layout, rendering, and camera', () => {
  test('renders >= 560 px boxless wafer at 1440x900, cursor wheel zoom, flick coast, dblclick reset, 0 React renders during drag, and arrow-key die stepping', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');

    await page.getByTestId('demo-card-edge-ring-etch').click();
    const stage = page.getByTestId('wafer-stage');
    await expect(stage).toBeVisible({ timeout: 3_000 });

    // 1. Layout & boxless wafer diameter check at 1440x900 (>= 560 px, no page scroll, stage left of verdict)
    const desktopMetrics = await page.evaluate(() => {
      const stageEl = document.querySelector<HTMLElement>(
        '[data-testid="wafer-stage"]',
      )!;
      const topLightEl = document.querySelector<HTMLElement>(
        '[data-testid="wafer-stage-top-light"]',
      )!;
      const verdictCol = document.querySelector<HTMLElement>(
        '[data-testid="autopsy-report-card"]',
      )!;
      const stageRect = stageEl.getBoundingClientRect();
      const topLightRect = topLightEl.getBoundingClientRect();
      const verdictRect = verdictCol.getBoundingClientRect();
      const stageStyle = window.getComputedStyle(stageEl);

      return {
        stageWidth: Math.round(stageRect.width),
        stageHeight: Math.round(stageRect.height),
        waferDiameter: Math.round(topLightRect.width),
        stageLeft: Math.round(stageRect.left),
        verdictLeft: Math.round(verdictRect.left),
        verdictWidth: Math.round(verdictRect.width),
        stageBorders: [
          stageStyle.borderTopWidth,
          stageStyle.borderRightWidth,
          stageStyle.borderBottomWidth,
          stageStyle.borderLeftWidth,
        ],
        docScrollOverflow:
          document.documentElement.scrollHeight - window.innerHeight,
      };
    });

    expect(desktopMetrics.waferDiameter).toBeGreaterThanOrEqual(560);
    expect(desktopMetrics.stageLeft).toBeLessThan(desktopMetrics.verdictLeft);
    expect(desktopMetrics.verdictWidth).toBe(553);
    expect(desktopMetrics.stageBorders).toEqual(['0px', '0px', '0px', '0px']);
    expect(desktopMetrics.docScrollOverflow).toBeLessThanOrEqual(1);

    // 2. Wheel zoom anchored at cursor + HUD zoom pill updates without React re-render
    const stageBox = (await stage.boundingBox())!;
    const cursorClientX = stageBox.x + 540;
    const cursorClientY = stageBox.y + 260;

    await page.mouse.move(cursorClientX, cursorClientY);
    const rendersBeforeZoom = Number(
      await stage.getAttribute('data-render-count'),
    );

    await page.mouse.wheel(0, -240);
    const zoomPill = page.getByTestId('stage-zoom-pill');
    await expect(zoomPill).toBeVisible();
    const zoomLabel = (await zoomPill.textContent()) ?? '';
    expect(Number.parseInt(zoomLabel, 10)).toBeGreaterThan(130);

    // 3. Drag pan + flick inertia coasting with ZERO React renders during drag
    const rendersBeforeDrag = Number(
      await stage.getAttribute('data-render-count'),
    );
    expect(rendersBeforeDrag).toBe(rendersBeforeZoom);

    const dragStartX = stageBox.x + stageBox.width / 2;
    const dragStartY = stageBox.y + stageBox.height / 2;
    await page.mouse.move(dragStartX, dragStartY);
    await page.mouse.down();
    for (let i = 1; i <= 8; i += 1) {
      await page.mouse.move(dragStartX + i * 18, dragStartY + i * 6);
    }
    const rendersMidDrag = Number(
      await stage.getAttribute('data-render-count'),
    );
    expect(rendersMidDrag).toBe(rendersBeforeDrag);

    const transformAtRelease = await page
      .getByTestId('wafer-camera-wrapper')
      .evaluate((el) => (el as HTMLElement).style.transform);

    await page.mouse.up();
    await page.waitForTimeout(80);

    const transformDuringCoast = await page
      .getByTestId('wafer-camera-wrapper')
      .evaluate((el) => (el as HTMLElement).style.transform);
    expect(transformDuringCoast).not.toBe(transformAtRelease);

    const rendersAfterDrag = Number(
      await stage.getAttribute('data-render-count'),
    );
    expect(rendersAfterDrag).toBe(rendersBeforeDrag);

    // 4. Double-click resets camera back to fit (zoom pill hides again)
    await stage.dblclick({ position: { x: 390, y: 360 } });
    await expect(zoomPill).toBeHidden({ timeout: 1_500 });

    // 5. Arrow-key die stepping moves hovered die cursor
    await stage.focus();
    const overlayWrapper = page.getByTestId('wafer-overlay-wrapper');
    await page.keyboard.press('ArrowRight');
    const firstDie = await overlayWrapper.getAttribute('data-hovered-die');
    expect(firstDie).not.toBe('');

    await page.keyboard.press('ArrowUp');
    const secondDie = await overlayWrapper.getAttribute('data-hovered-die');
    expect(secondDie).not.toBe('');
    expect(secondDie).not.toBe(firstDie);
  });

  test('renders >= 350 px full-bleed wafer at 390x844 mobile viewport', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');

    await page.getByTestId('demo-card-edge-ring-etch').click();
    const stage = page.getByTestId('wafer-stage');
    await expect(stage).toBeVisible({ timeout: 3_000 });

    const mobileMetrics = await page.evaluate(() => {
      const stageEl = document.querySelector<HTMLElement>(
        '[data-testid="wafer-stage"]',
      )!;
      const topLightEl = document.querySelector<HTMLElement>(
        '[data-testid="wafer-stage-top-light"]',
      )!;
      const statItem = document.querySelector<HTMLElement>(
        '[data-testid="verdict-stat-item"]',
      )!;
      const findingRow = document.querySelector<HTMLElement>(
        '[data-testid="autopsy-body-claim-button"]',
      )!;
      const stageRect = stageEl.getBoundingClientRect();
      const topLightRect = topLightEl.getBoundingClientRect();
      return {
        stageWidth: Math.round(stageRect.width),
        waferDiameter: Math.round(topLightRect.width),
        statTop: Math.round(statItem.getBoundingClientRect().top),
        stageTop: Math.round(stageRect.top),
        findingTop: Math.round(findingRow.getBoundingClientRect().top),
      };
    });

    expect(mobileMetrics.stageWidth).toBe(390);
    expect(mobileMetrics.waferDiameter).toBeGreaterThanOrEqual(350);
    // Mobile §3.4 vertical order: Stats -> Stage -> Findings
    expect(mobileMetrics.statTop).toBeLessThan(mobileMetrics.stageTop);
    expect(mobileMetrics.stageTop).toBeLessThan(mobileMetrics.findingTop);
  });
});
