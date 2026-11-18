import { expect, test } from '@playwright/test';

interface VerticalSlicePresetCase {
  readonly presetId:
    | 'edge-ring-etch'
    | 'handling-scratch'
    | 'site2-probe-contact';
  readonly expectedFullHeadline: string;
  readonly expectedCausePhrase: string;
  readonly expectedSublineBin: string;
}

const PRESET_CASES: readonly VerticalSlicePresetCase[] = [
  {
    presetId: 'edge-ring-etch',
    expectedFullHeadline: 'Cause of death: Edge-Ring failure.',
    expectedCausePhrase: 'Edge-Ring failure.',
    expectedSublineBin: 'Most loss in SBIN 7 IDDQ_EDGE_LEAK.',
  },
  {
    presetId: 'handling-scratch',
    expectedFullHeadline: 'Cause of death: Scratch failure.',
    expectedCausePhrase: 'Scratch failure.',
    expectedSublineBin: 'Most loss in SBIN 9 VDD_METAL_SHORT.',
  },
  {
    presetId: 'site2-probe-contact',
    expectedFullHeadline: 'Cause of death: test site 2 contact failure.',
    expectedCausePhrase: 'test site 2 contact failure.',
    expectedSublineBin: 'Most loss in SBIN 5 CONT_OPEN.',
  },
] as const;

test.describe('Vertical slice & R5 Verdict Column checkpoint', () => {
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

      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto('/');

      // One click on the demo preset card loads the lot and renders the verdict within 3 s (§3.1)
      const demoCard = page.getByTestId(`demo-card-${preset.presetId}`);
      await expect(demoCard).toBeVisible();
      const loadStartMs = Date.now();
      await demoCard.click();

      const verdictHeadline = page.getByTestId('verdict-headline');
      const headlineButton = page.getByTestId('autopsy-headline-button');
      const subline = page.getByTestId('verdict-subline');

      await expect(verdictHeadline).toBeVisible({ timeout: 3_000 });
      await expect(verdictHeadline).toContainText(preset.expectedFullHeadline, {
        timeout: 3_000,
      });
      await expect(headlineButton).toContainText(preset.expectedCausePhrase, {
        timeout: 3_000,
      });
      await expect(subline).toContainText(preset.expectedSublineBin, {
        timeout: 3_000,
      });
      expect(Date.now() - loadStartMs).toBeLessThanOrEqual(3_000);

      // R5 acceptance audit at 1440x900 (553 px verdict column)
      if (preset.presetId === 'edge-ring-etch') {
        const audit = await page.evaluate(() => {
          const col = document.querySelector<HTMLElement>(
            '[data-testid="autopsy-report-card"]',
          )!;
          const h1 = document.querySelector<HTMLElement>(
            '[data-testid="verdict-headline"]',
          )!;
          const causeBtn = document.querySelector<HTMLElement>(
            '[data-testid="autopsy-headline-button"]',
          )!;
          const prefixSpan = document.querySelector<HTMLElement>(
            '[data-testid="verdict-prefix"]',
          )!;
          const stats = document.querySelectorAll(
            '[data-testid="verdict-stat-item"]',
          );
          const findingBtns = Array.from(
            document.querySelectorAll<HTMLElement>(
              '[data-testid="autopsy-body-claim-button"]',
            ),
          );

          const h1Style = window.getComputedStyle(h1);
          const h1LineHeight = Number.parseFloat(h1Style.lineHeight);
          const h1Lines = h1.getBoundingClientRect().height / h1LineHeight;

          const rowChecks = findingBtns.map((btn) => {
            const st = window.getComputedStyle(btn);
            const hl = btn.querySelector<HTMLElement>(
              '[data-testid="finding-row-headline"]',
            )!;
            const hlStyle = window.getComputedStyle(hl);
            const hlLines =
              hl.getBoundingClientRect().height /
              Number.parseFloat(hlStyle.lineHeight);
            return {
              borderTop: st.borderTopWidth,
              borderBottom: st.borderBottomWidth,
              borderLeft: st.borderLeftWidth,
              borderRight: st.borderRightWidth,
              boxShadow: st.boxShadow,
              hlLines,
            };
          });

          const monoElements: string[] = [];
          const uppercaseElements: string[] = [];
          for (const el of Array.from(col.querySelectorAll<HTMLElement>('*'))) {
            const st = window.getComputedStyle(el);
            if (
              /mono|menlo|consolas|courier/i.test(st.fontFamily)
            ) {
              monoElements.push(el.tagName);
            }
            if (st.textTransform === 'uppercase') {
              uppercaseElements.push(el.tagName);
            }
          }

          return {
            colWidth: Math.round(col.getBoundingClientRect().width),
            h1Lines,
            causeColor: window.getComputedStyle(causeBtn).color,
            prefixColor: window.getComputedStyle(prefixSpan).color,
            statCount: stats.length,
            rowChecks,
            monoElements,
            uppercaseElements,
          };
        });

        expect(audit.colWidth).toBe(553);
        expect(audit.h1Lines).toBeLessThanOrEqual(2.15);
        expect(audit.causeColor).toBe('rgb(255, 107, 44)');
        expect(audit.prefixColor).not.toBe('rgb(255, 107, 44)');
        expect(audit.statCount).toBe(3);
        expect(audit.rowChecks.length).toBeGreaterThanOrEqual(2);
        for (const r of audit.rowChecks) {
          expect(r.borderTop).toBe('0px');
          expect(r.borderBottom).toBe('0px');
          expect(r.borderLeft).toBe('0px');
          expect(r.borderRight).toBe('0px');
          expect(r.boxShadow).toBe('none');
          expect(r.hlLines).toBeLessThanOrEqual(1.35);
        }
        expect(audit.monoElements).toEqual([]);
        expect(audit.uppercaseElements).toEqual([]);
      }

      // Before clicking the headline, zero dies are highlighted on the overlay wrapper
      const overlayWrapper = page.getByTestId('wafer-overlay-wrapper');
      await expect(overlayWrapper).toBeVisible();
      await expect(overlayWrapper).toHaveAttribute('data-highlight-count', '0');
      await expect(headlineButton).toHaveAttribute('aria-pressed', 'false');

      // Parse the primary finding's cited-dies count
      const primaryFindingCount = page
        .getByTestId('autopsy-body-claim-button')
        .first()
        .getByTestId('claim-cited-dies-count');
      const citedCountText = (
        (await primaryFindingCount.textContent()) ?? ''
      ).trim();
      const citedMatch = /^([\d,]+)\s+dies?$/.exec(citedCountText);
      expect(citedMatch).not.toBeNull();
      const citedDiesCount = Number(citedMatch![1]!.replace(/,/g, ''));
      expect(citedDiesCount).toBeGreaterThan(0);

      // Click the cause phrase and assert cited dies illuminate on the overlay canvas wrapper
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
