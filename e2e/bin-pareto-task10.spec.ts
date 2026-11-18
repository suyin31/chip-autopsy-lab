import { expect, test } from '@playwright/test';

test.describe('Task 10 - HBIN/SBIN legend and Bin Pareto', () => {
  test('legend hides a bin with a canvas repaint and no stage render; Pareto sits below Findings, filters on click, and follows finding clicks', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    await page.getByTestId('demo-card-edge-ring-etch').click();

    const stage = page.getByTestId('wafer-stage');
    await expect(stage).toBeVisible({ timeout: 3_000 });
    await expect(stage).toHaveAttribute('data-sweep', 'done', { timeout: 5_000 });

    // Pareto is below the Findings list in the verdict column
    const pareto = page.getByTestId('bin-pareto');
    await expect(pareto).toBeAttached();
    const findingsBox = (await page
      .getByTestId('verdict-findings-section')
      .boundingBox())!;
    const paretoBox = (await pareto.boundingBox())!;
    expect(paretoBox.y).toBeGreaterThanOrEqual(findingsBox.y + findingsBox.height);

    // SBIN colour mode lists bins in the legend
    await page
      .getByTestId('stage-mode-segmented')
      .getByRole('radio', { name: 'Soft bins' })
      .click();
    const legend = page.getByTestId('stage-legend');
    const legendEntries = legend.getByRole('button', { pressed: true });
    await expect(legendEntries.first()).toBeVisible();
    const entryCount = await legendEntries.count();
    expect(entryCount).toBeGreaterThan(1);

    const baseCanvasHash = (): Promise<string> =>
      page.evaluate(async () => {
        const canvas = document.querySelector<HTMLCanvasElement>(
          '[data-testid="wafer-base-canvas"]',
        )!;
        const blob = await new Promise<Blob | null>((resolve) =>
          canvas.toBlob(resolve),
        );
        const bytes = new Uint8Array(await blob!.arrayBuffer());
        let hash = 5381;
        for (let i = 0; i < bytes.length; i += 1) {
          hash = ((hash << 5) + hash + bytes[i]!) | 0;
        }
        return `${bytes.length}:${hash}`;
      });

    const hashBefore = await baseCanvasHash();
    const rendersBefore = Number(await stage.getAttribute('data-render-count'));

    const firstLabel = await legendEntries.first().getAttribute('aria-label');
    const firstEntry = legend.getByRole('button', { name: firstLabel! });
    await firstEntry.click();
    await expect(firstEntry).toHaveAttribute('aria-pressed', 'false');

    await expect.poll(baseCanvasHash).not.toBe(hashBefore);
    expect(Number(await stage.getAttribute('data-render-count'))).toBe(
      rendersBefore,
    );

    // Showing the bin again restores the original pixels
    await firstEntry.click();
    await expect(firstEntry).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(baseCanvasHash).toBe(hashBefore);
    expect(Number(await stage.getAttribute('data-render-count'))).toBe(
      rendersBefore,
    );

    // The dominant bin bar is orange and the row names the bin
    const rows = page.getByTestId('bin-pareto-row');
    const topRow = rows.first();
    await expect(topRow).toContainText('SBIN 7 IDDQ_EDGE_LEAK');
    await expect(topRow).toContainText('of tested');
    await expect(topRow.getByTestId('bin-pareto-bar')).toHaveAttribute(
      'fill',
      '#FF6B2C',
    );

    // Bar click toggles the bin filter and lights the matching dies
    const overlay = page.getByTestId('wafer-overlay-wrapper');
    await expect(overlay).toHaveAttribute('data-highlight-count', '0');
    await topRow.click();
    await expect(topRow).toHaveAttribute('aria-pressed', 'true');
    await expect
      .poll(async () => Number(await overlay.getAttribute('data-highlight-count')))
      .toBeGreaterThan(0);
    // Other bars stay available while the filter is on
    expect(await rows.count()).toBeGreaterThan(0);
    await topRow.click();
    await expect(topRow).toHaveAttribute('aria-pressed', 'false');
    await expect(overlay).toHaveAttribute('data-highlight-count', '0');

    // Clicking the dominant-bin finding highlights its bar
    const binFinding = page
      .getByTestId('autopsy-body-claim-button')
      .filter({ hasText: 'leads the loss' });
    await binFinding.click();
    await expect(binFinding).toHaveAttribute('aria-pressed', 'true');
    await expect(topRow).toHaveAttribute('data-highlighted', 'true');
    await binFinding.click();
    await expect(topRow).not.toHaveAttribute('data-highlighted', 'true');
  });
});
