import { expect, test } from '@playwright/test';

test.describe('Redesign R7 — Linked interactions acceptance', () => {
  test('edge-band finding lights ring dies clockwise within 600 ms and clears on second click; Shift+drag updates stats live during drag; held ArrowRight swaps wafers instantly; magnifier never covers hovered die', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');

    await page.getByTestId('demo-card-edge-ring-etch').click();
    const stage = page.getByTestId('wafer-stage');
    await expect(stage).toBeVisible({ timeout: 3_000 });

    const overlayWrapper = page.getByTestId('wafer-overlay-wrapper');

    // 1. Hover magnifier shows on die hover and never covers the hovered die (§4.8)
    const stageBox = (await stage.boundingBox())!;
    const hoverClientX = stageBox.x + stageBox.width / 2;
    const hoverClientY = stageBox.y + stageBox.height / 2;
    await page.mouse.move(hoverClientX, hoverClientY);

    const magnifier = page.getByTestId('wafer-hover-magnifier');
    await expect(magnifier).toHaveAttribute('data-visible', 'true');
    await expect(page.getByTestId('magnifier-loupe-canvas')).toBeVisible();
    await expect(page.getByTestId('magnifier-coords-value')).toContainText(',');

    const magBox = (await magnifier.boundingBox())!;
    // Hovered centre die is ~20x20 px centred at (hoverClientX, hoverClientY)
    const dieProbeBox = {
      x: hoverClientX - 8,
      y: hoverClientY - 8,
      width: 16,
      height: 16,
    };
    const overlapsHoveredDie =
      magBox.x < dieProbeBox.x + dieProbeBox.width &&
      magBox.x + magBox.width > dieProbeBox.x &&
      magBox.y < dieProbeBox.y + dieProbeBox.height &&
      magBox.y + magBox.height > dieProbeBox.y;
    expect(overlapsHoveredDie).toBe(false);

    // 2. Edge-band finding lights ring dies clockwise within 600 ms, dims non-evidence dies (0.62), shows evidence dots, and clears on second click (§3.5, §5.4)
    const edgeBandRow = page.getByTestId('autopsy-body-claim-button').first();
    await expect(edgeBandRow).toContainText('of fails are in the edge band');

    const clickStartMs = await page.evaluate(() => performance.now());
    await edgeBandRow.click();

    await expect(edgeBandRow).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('stage-evidence-caption')).toBeVisible();
    expect(
      await page.getByTestId('wafer-strip-evidence-dot').count(),
    ).toBeGreaterThan(0);

    // Wait until glow sequence reaches 'settled' and assert total settle elapsed <= 750 ms (600 ms animation + frame scheduling budget)
    await expect(overlayWrapper).toHaveAttribute('data-glow-phase', 'settled', {
      timeout: 1_000,
    });
    const settleElapsedMs = await page.evaluate(
      (t0) => performance.now() - t0,
      clickStartMs,
    );
    expect(settleElapsedMs).toBeLessThanOrEqual(780);
    await expect(overlayWrapper).toHaveAttribute('data-scrim-alpha', '0.620');
    const waferHighlightCount = Number(
      await overlayWrapper.getAttribute('data-wafer-highlight-count'),
    );
    expect(waferHighlightCount).toBeGreaterThan(0);
    await expect(overlayWrapper).toHaveAttribute(
      'data-lit-die-count',
      String(waferHighlightCount),
    );

    // Second click clears finding, scrim, and highlight
    await edgeBandRow.click();
    await expect(edgeBandRow).toHaveAttribute('aria-pressed', 'false');
    await expect(overlayWrapper).toHaveAttribute('data-highlight-count', '0');
    await expect(overlayWrapper).toHaveAttribute('data-glow-phase', 'idle', {
      timeout: 500,
    });

    // 3. Shift+drag box select updates "N dies / Failing / Yield / Top bin" live DURING drag with 0 WaferMapCanvas React renders (§3.6, §5.7)
    const popover = page.getByTestId('wafer-selection-popover');
    await expect(popover).toHaveAttribute('data-visible', 'false');

    const startX = stageBox.x + stageBox.width * 0.35;
    const startY = stageBox.y + stageBox.height * 0.28;
    await page.mouse.move(startX, startY);

    const rendersBeforeBoxDrag = Number(
      await stage.getAttribute('data-render-count'),
    );

    await page.keyboard.down('Shift');
    await page.mouse.down();

    // Drag halfway: read initial live die count BEFORE mouse.up()
    await page.mouse.move(startX + 90, startY + 80, { steps: 4 });
    await expect(popover).toHaveAttribute('data-visible', 'true');
    const midDragTitle1 =
      (await page.getByTestId('selection-popover-title').textContent()) ?? '';

    // Drag wider: live stats must update dynamically during the same drag!
    await page.mouse.move(startX + 220, startY + 190, { steps: 5 });
    await expect(page.getByTestId('selection-popover-title')).not.toHaveText(
      midDragTitle1,
    );
    const midDragTitle2 =
      (await page.getByTestId('selection-popover-title').textContent()) ?? '';
    expect(midDragTitle2).toMatch(/^\d[\d,]*\s+dies$/);
    await expect(page.getByTestId('selection-popover-yield')).toContainText('%');

    const rendersDuringBoxDrag = Number(
      await stage.getAttribute('data-render-count'),
    );
    expect(rendersDuringBoxDrag).toBe(rendersBeforeBoxDrag);

    await page.mouse.up();
    await page.keyboard.up('Shift');

    // Committed popover shows Clear + Zoom to selection, and linked verdict stats reflect "in selection"
    await expect(page.getByTestId('selection-popover-actions')).toBeVisible();
    await expect(page.getByTestId('verdict-stat-row')).toContainText(
      'in selection',
    );

    await page.getByTestId('selection-popover-clear').click();
    await expect(popover).toHaveAttribute('data-visible', 'false');

    // 4. Strip: held ArrowRight (`repeat: true`) swaps wafers instantly without crossfade (§4.9, §5.8)
    const firstThumb = page
      .getByTestId('wafer-strip')
      .locator('[role="option"]')
      .first();
    await firstThumb.focus();

    const crossfadeDuringRepeat = await page.evaluate(() => {
      const strip = document.querySelector('[data-testid="wafer-strip"]')!;
      const cf = document.querySelector<HTMLElement>(
        '[data-testid="wafer-crossfade-canvas"]',
      )!;
      const sawCrossfade: boolean[] = [];

      for (let step = 0; step < 6; step += 1) {
        const activeBtn = strip.querySelector<HTMLElement>(
          '[role="option"][aria-selected="true"]',
        )!;
        activeBtn.dispatchEvent(
          new KeyboardEvent('keydown', {
            key: 'ArrowRight',
            bubbles: true,
            cancelable: true,
            repeat: true,
          }),
        );
        sawCrossfade.push(cf.dataset.crossfading === 'true');
      }
      const finalActive = strip.querySelector<HTMLElement>(
        '[role="option"][aria-selected="true"]',
      );
      return {
        sawCrossfade,
        finalWaferIndex: Number(finalActive?.dataset.waferIndex ?? -1),
      };
    });

    expect(crossfadeDuringRepeat.finalWaferIndex).toBe(6);
    expect(crossfadeDuringRepeat.sawCrossfade).toEqual([
      false,
      false,
      false,
      false,
      false,
      false,
    ]);
  });
});
