import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { StoreApi } from 'zustand';
import { SUPPORTED_LOCALES } from '@/core/i18n';
import { I18nProvider } from '@/ui/i18n';
import { createSelectionStore, type SelectionStoreState } from '@/ui/state';
import { ingestDemoPreset } from '@/workers';
import {
  ActiveFilterChips,
  formatBrushCoordinateRange,
} from './ActiveFilterChips';

function createClientTestStore(): StoreApi<SelectionStoreState> {
  const store = createSelectionStore();
  return { ...store, getInitialState: () => store.getState() };
}

describe('ActiveFilterChips (Task 14, Req 11.3 & 11.4)', () => {
  it('formats normalized coordinate ranges with true minus signs', () => {
    const fmtRange = (p: {
      minX: string;
      maxX: string;
      minY: string;
      maxY: string;
    }) => `X ${p.minX}..${p.maxX}, Y ${p.minY}..${p.maxY}`;
    const fmtSingle = (p: { x: string; y: string }) => `X ${p.x}, Y ${p.y}`;

    expect(
      formatBrushCoordinateRange(
        { scope: 'wafer', minX: 12, maxX: -4, minY: 8, maxY: -2 },
        fmtRange,
        fmtSingle,
      ),
    ).toBe('X \u22124..12, Y \u22122..8');

    expect(
      formatBrushCoordinateRange(
        { scope: 'stacked', minX: -3, maxX: -3, minY: 5, maxY: 5 },
        fmtRange,
        fmtSingle,
      ),
    ).toBe('X \u22123, Y 5');
  });

  it('renders nothing when unfiltered, and shows removable brush + attribute chips when combined', async () => {
    const res = await ingestDemoPreset('edge-ring-etch');
    expect(res.kind).toBe('ok');
    if (res.kind !== 'ok') return;

    const store = createClientTestStore();
    store.getState().setLot(res.lot);

    const renderChips = (locale: (typeof SUPPORTED_LOCALES)[number] = 'en') =>
      renderToStaticMarkup(
        React.createElement(
          I18nProvider,
          { initialLocale: locale },
          React.createElement(ActiveFilterChips, { lot: res.lot, store }),
        ),
      );

    // Unfiltered -> ActiveFilterChips renders nothing (only I18nProvider's live region)
    expect(renderChips()).not.toContain('data-testid="active-filter-chips"');

    // Single-wafer brush -> brush chip shows coordinates + selected die count, no ember
    const w0 = res.lot.wafers[0]!;
    store.getState().setBrush({
      scope: 'wafer',
      waferIndex: 0,
      minX: w0.minX,
      maxX: w0.minX + 5,
      minY: w0.minY,
      maxY: w0.maxY,
    });
    const brushOnlyHtml = renderChips();
    expect(brushOnlyHtml).toContain('data-testid="brush-filter-chip"');
    expect(brushOnlyHtml).toContain('data-brush-scope="wafer"');
    expect(brushOnlyHtml).toContain('data-testid="brush-filter-chip-clear"');
    expect(brushOnlyHtml).toContain(`${store.getState().selectedDieCount}`);
    expect(brushOnlyHtml).not.toMatch(/ember|orange/);
    expect(brushOnlyHtml).not.toContain('data-testid="filter-chips-clear-all"');

    // Combined brush + bin filter + site filter -> shows all chips and Clear all button
    store.getState().setBinFilter({ mode: 'SBIN', code: 7 });
    store.getState().setSiteFilter(0);
    const combinedHtml = renderChips();
    expect(combinedHtml).toContain('data-testid="brush-filter-chip"');
    expect(combinedHtml).toContain('data-testid="bin-filter-chip"');
    expect(combinedHtml).toContain('SBIN 7');
    expect(combinedHtml).toContain('data-testid="site-filter-chip"');
    expect(combinedHtml).toContain('data-testid="filter-chips-clear-all"');

    // Stacked brush renders stacked scope label across all 5 locales without errors
    store.getState().setBrush({
      scope: 'stacked',
      minX: w0.minX,
      maxX: w0.minX + 3,
      minY: w0.minY,
      maxY: w0.minY + 3,
    });
    for (const locale of SUPPORTED_LOCALES) {
      const locHtml = renderChips(locale);
      expect(locHtml).toContain('data-brush-scope="stacked"');
    }
  });
});
