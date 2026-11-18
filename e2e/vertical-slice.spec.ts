import { expect, test } from '@playwright/test';

interface VerticalSlicePresetCase {
  readonly presetId:
    | 'edge-ring-etch'
    | 'handling-scratch'
    | 'site2-probe-contact';
  readonly expectedHeadlinePrefix: string;
  readonly expectedHeadlineDetail: string;
}

const PRESET_CASES: readonly VerticalSlicePresetCase[] = [
  {
    presetId: 'edge-ring-etch',
    expectedHeadlinePrefix: 'Cause of death: Edge-Ring failure.',
    expectedHeadlineDetail:
      'sit in the outer 3-die band, most loss in SBIN 7 (IDDQ_EDGE_LEAK).',
  },
  {
    presetId: 'handling-scratch',
    expectedHeadlinePrefix: 'Cause of death: Scratch failure.',
    expectedHeadlineDetail:
      'align along a scratch track across 22 of 25 wafers, most loss in SBIN 9 (VDD_METAL_SHORT).',
  },
  {
    presetId: 'site2-probe-contact',
    expectedHeadlinePrefix:
      'Cause of death: Test Site 1:2 concentration anomaly.',
    expectedHeadlineDetail:
      'occurred on Site 1:2, most loss in SBIN 5 (CONT_OPEN).',
  },
] as const;

test.describe('Vertical slice checkpoint (Task 8)', () => {
  for (const preset of PRESET_CASES) {
    test(`loads ${preset.presetId} offline in <= 3 s and highlights cited dies on headline click`, async ({
      context,
      page,
    }) => {
      const blockedExternalRequests: string[] = [];

      // Block all non-localhost network requests across page and Web Worker contexts
      await context.route('**/*', async (route) => {
        const rawUrl = route.request().url();
        const parsed = new URL(rawUrl);
        const isLocal =
          parsed.protocol === 'data:' ||
          parsed.protocol === 'blob:' ||
          parsed.hostname === 'localhost' ||
          parsed.hostname === '127.0.0.1' ||
          parsed.hostname === '[::1]';
        if (!isLocal) {
          blockedExternalRequests.push(rawUrl);
          await route.abort();
          return;
        }
        await route.continue();
      });

      await page.goto('/');

      // Select the requested demo preset in the first-run empty state
      const presetRadio = page.getByRole('radio', {
        name: new RegExp(preset.presetId),
      });
      await expect(presetRadio).toBeVisible();
      await presetRadio.click();
      await expect(presetRadio).toHaveAttribute('aria-checked', 'true');

      // Click "Load demo lot" and assert verdict headline renders within 3 s
      const loadButton = page.getByRole('button', { name: 'Load demo lot' });
      const loadStartMs = Date.now();
      await loadButton.click();

      const headlineButton = page.getByTestId('autopsy-headline-button');
      await expect(headlineButton).toBeVisible({ timeout: 3_000 });
      await expect(headlineButton).toContainText(
        preset.expectedHeadlinePrefix,
        { timeout: 3_000 },
      );
      await expect(headlineButton).toContainText(
        preset.expectedHeadlineDetail,
        { timeout: 3_000 },
      );
      expect(Date.now() - loadStartMs).toBeLessThanOrEqual(3_000);

      // Before clicking the headline, zero dies are highlighted on the overlay wrapper
      const overlayWrapper = page.getByTestId('wafer-overlay-wrapper');
      await expect(overlayWrapper).toBeVisible();
      await expect(overlayWrapper).toHaveAttribute('data-highlight-count', '0');
      await expect(headlineButton).toHaveAttribute('aria-pressed', 'false');

      // Parse the cited-dies count displayed on the headline button
      const citedCountSpan = headlineButton.getByTestId(
        'claim-cited-dies-count',
      );
      const citedCountText = ((await citedCountSpan.textContent()) ?? '').trim();
      const citedMatch = /^([\d,]+)\s+cited\s+dies?$/.exec(citedCountText);
      expect(citedMatch).not.toBeNull();
      const citedDiesCount = Number(citedMatch![1]!.replace(/,/g, ''));
      expect(citedDiesCount).toBeGreaterThan(0);

      // Click the headline and assert cited dies illuminate on the overlay canvas wrapper
      await headlineButton.click();
      await expect(headlineButton).toHaveAttribute('aria-pressed', 'true');
      await expect(overlayWrapper).toHaveAttribute(
        'data-highlight-count',
        String(citedDiesCount),
      );

      const waferHighlightCount = Number(
        await overlayWrapper.getAttribute('data-wafer-highlight-count'),
      );
      expect(waferHighlightCount).toBeGreaterThan(0);

      // For Edge-Ring, assert highlighted dies reside in the outer 3-die band
      if (preset.presetId === 'edge-ring-etch') {
        await expect(overlayWrapper).toHaveAttribute(
          'data-outer-band-highlight-count',
          String(citedDiesCount),
        );
        await expect(overlayWrapper).toHaveAttribute(
          'data-interior-highlight-count',
          '0',
        );
        await expect(overlayWrapper).toHaveAttribute(
          'data-wafer-outer-band-highlight-count',
          String(waferHighlightCount),
        );
      }

      expect(blockedExternalRequests).toEqual([]);
    });
  }
});
