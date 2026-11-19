import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { StoreApi } from 'zustand';
import { computeYieldSummary } from '@/core/analytics';
import { SUPPORTED_LOCALES } from '@/core/i18n';
import { buildLotModel } from '@/core/model';
import { parseStdfBytes, writeStdfBytes } from '@/core/stdf';
import { I18nProvider } from '@/ui/i18n';
import { createSelectionStore, type SelectionStoreState } from '@/ui/state';
import { ingestDemoPreset } from '@/workers';
import {
  type StackedPanelViewMode,
  StackedWaferPanel,
} from './StackedWaferPanel';

function createClientTestStore(): StoreApi<SelectionStoreState> {
  const store = createSelectionStore();
  return { ...store, getInitialState: () => store.getState() };
}

function count(html: string, needle: string): number {
  return html.split(needle).length - 1;
}

describe('StackedWaferPanel', () => {
  it('omits the panel for single-wafer lots (Req 5.1)', () => {
    const bytes = writeStdfBytes({
      endianness: 'little',
      mir: { lotId: 'ONE-WAFER', partTyp: 'CAL-1', jobNam: 'SORT' },
      sdrs: [{ headNum: 1, siteGrp: 1, siteNums: [1], cardId: 'C1' }],
      hbrs: [{ hbinNum: 1, hbinCnt: 1, hbinPf: 'P', hbinNam: 'PASS' }],
      sbrs: [{ sbinNum: 1, sbinCnt: 1, sbinPf: 'P', sbinNam: 'GOOD' }],
      wafers: [
        {
          wir: { headNum: 1, siteGrp: 1, startT: 1_700_000_000, waferId: 'W01' },
          touchdowns: [
            [{ headNum: 1, siteNum: 1, partFlg: 0, hardBin: 1, softBin: 1, xCoord: 0, yCoord: 0 }],
          ],
          wrr: { headNum: 1, siteGrp: 1, finishT: 1_700_000_010, partCnt: 1, waferId: 'W01' },
        },
      ],
      mrr: { finishT: 1_700_000_020, dispCod: '0' },
    });
    const parsed = parseStdfBytes(bytes, { mode: 'full' });
    if (!parsed.ok) throw new Error(parsed.error.message);
    const lot = buildLotModel(parsed.value);
    const yieldSummary = computeYieldSummary(lot);
    const store = createClientTestStore();
    store.getState().setLot(lot);

    const html = renderToStaticMarkup(
      React.createElement(
        I18nProvider,
        { initialLocale: 'en' },
        React.createElement(StackedWaferPanel, {
          lot,
          byWaferYield: yieldSummary.byWafer,
          store,
        }),
      ),
    );
    expect(html).not.toContain('stacked-wafer-panel');
    expect(html).not.toContain('<section');
  });

  it('renders all 25 wafers in gallery mode and magma heatmap with numeric legend in stacked mode', async () => {
    const res = await ingestDemoPreset('edge-ring-etch');
    if (res.kind !== 'ok') throw new Error('demo load failed');
    const store = createClientTestStore();
    store.getState().setLot(res.lot);

    const renderMode = (
      mode: StackedPanelViewMode,
      locale: (typeof SUPPORTED_LOCALES)[number] = 'en',
    ) =>
      renderToStaticMarkup(
        React.createElement(
          I18nProvider,
          { initialLocale: locale },
          React.createElement(StackedWaferPanel, {
            lot: res.lot,
            byWaferYield: res.yieldSummary.byWafer,
            store,
            initialViewMode: mode,
          }),
        ),
      );

    const galleryHtml = renderMode('gallery');
    expect(galleryHtml).toContain('Across all wafers');
    expect(count(galleryHtml, 'data-testid="wafer-gallery-item"')).toBe(25);
    expect(galleryHtml).toContain('W01');
    expect(galleryHtml).toContain('W25');
    expect(galleryHtml).not.toMatch(/ember|danger|red-/);

    const stackedHtml = renderMode('stacked');
    expect(stackedHtml).toContain('data-testid="stacked-heatmap-stage"');
    expect(stackedHtml).toContain('data-testid="stacked-magma-legend"');
    expect(stackedHtml).toContain('data-testid="stacked-magma-legend-bar"');
    expect(stackedHtml).toContain('0.0%');
    expect(stackedHtml).toContain('fail rate');
    expect(stackedHtml).not.toMatch(/ember|danger|red-/);

    // Localizes across all 5 locales without leaking English labels
    for (const locale of SUPPORTED_LOCALES) {
      const html = renderMode('gallery', locale);
      expect(count(html, 'data-testid="wafer-gallery-item"')).toBe(25);
      if (locale !== 'en') {
        expect(html).not.toContain('Across all wafers');
      }
    }
  });
});
