import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { StoreApi } from 'zustand';
import { SUPPORTED_LOCALES } from '@/core/i18n';
import { I18nProvider } from '@/ui/i18n';
import { createSelectionStore, type SelectionStoreState } from '@/ui/state';
import { ingestDemoPreset } from '@/workers';
import { YieldSummaryPanel } from './YieldSummaryPanel';

/** `getInitialState` mirrors `getState()` so server rendering reads live store state. */
function createClientTestStore(): StoreApi<SelectionStoreState> {
  const store = createSelectionStore();
  return { ...store, getInitialState: () => store.getState() };
}

async function load(presetId: 'edge-ring-etch' | 'site2-probe-contact') {
  const res = await ingestDemoPreset(presetId);
  if (res.kind !== 'ok') {
    throw new Error(`demo preset ${presetId} failed to load`);
  }
  return res;
}

function render(
  res: Awaited<ReturnType<typeof load>>,
  store: StoreApi<SelectionStoreState>,
  locale: (typeof SUPPORTED_LOCALES)[number] = 'en',
): string {
  return renderToStaticMarkup(
    React.createElement(
      I18nProvider,
      { initialLocale: locale },
      React.createElement(YieldSummaryPanel, {
        lot: res.lot,
        yieldSummary: res.yieldSummary,
        facts: res.facts,
        store,
      }),
    ),
  );
}

function count(html: string, needle: string): number {
  return html.split(needle).length - 1;
}

describe('YieldSummaryPanel', () => {
  it('shows lot first-pass, final, and retest numbers, every site, and the lowest five wafers', async () => {
    const res = await load('site2-probe-contact');
    const store = createClientTestStore();
    store.getState().setLot(res.lot);
    const html = render(res, store);

    const { overall } = res.yieldSummary;
    expect(html).toContain(
      `${(overall.finalYield! * 100).toFixed(1)}%`,
    );
    expect(html).toContain(
      `${(overall.firstPassYield! * 100).toFixed(1)}%`,
    );
    expect(count(html, 'data-testid="yield-site-row"')).toBe(
      res.lot.sites.length,
    );
    expect(count(html, 'data-testid="yield-wafer-row"')).toBe(5);
    expect(html).toContain('Lowest yield wafers');
    expect(html).toContain('Show all 25 wafers');
    expect(html).toContain('aria-expanded="false"');
  });

  it('marks only the anomalous site, in words, for site2-probe-contact', async () => {
    const res = await load('site2-probe-contact');
    const store = createClientTestStore();
    store.getState().setLot(res.lot);
    const html = render(res, store);
    expect(count(html, 'data-anomaly="true"')).toBe(1);
    expect(count(html, 'data-testid="yield-site-anomaly"')).toBe(1);
    expect(html).toContain('Lower than the other sites');
    expect(html).toMatch(/data-site-label="1:2"[^>]*data-anomaly="true"/);

    const clean = await load('edge-ring-etch');
    const cleanStore = createClientTestStore();
    cleanStore.getState().setLot(clean.lot);
    expect(render(clean, cleanStore)).not.toContain('data-anomaly');
  });

  it('reflects the site and wafer scope as pressed rows and keeps a scoped wafer visible', async () => {
    const res = await load('site2-probe-contact');
    const store = createClientTestStore();
    store.getState().setLot(res.lot);
    store.getState().toggleSiteFilter(1);
    store.getState().toggleWaferFilter(22);
    const html = render(res, store);
    expect(html).toMatch(/data-site-index="1"[^>]*aria-pressed="true"/);
    expect(html).toMatch(/data-site-index="0"[^>]*aria-pressed="false"/);
    expect(html).toMatch(/data-wafer-index="22"[^>]*aria-pressed="true"/);
    expect(count(html, 'data-testid="yield-wafer-row"')).toBeGreaterThanOrEqual(5);
  });

  it('localizes every label in all 5 locales and keeps wafer IDs untranslated', async () => {
    const res = await load('site2-probe-contact');
    const waferId = res.lot.wafers[0]!.waferId;
    const outputs = new Map<string, string>();
    for (const locale of SUPPORTED_LOCALES) {
      const store = createClientTestStore();
      store.getState().setLot(res.lot);
      const html = render(res, store, locale);
      expect(render(res, store, locale)).toBe(html);
      outputs.set(locale, html);
      if (locale !== 'en') {
        for (const english of [
          'Test sites',
          'Lowest yield wafers',
          'First pass',
          'Retests',
          'Lower than the other sites',
          'Show all',
        ]) {
          expect(html, `${locale} leaks "${english}"`).not.toContain(english);
        }
      }
    }
    expect(outputs.get('ja')).toContain('テストサイト');
    expect(outputs.get('ko')).toContain('테스트 사이트');
    expect(outputs.get('zh-CN')).toContain('测试工位');
    expect(outputs.get('zh-TW')).toContain('測試站點');
    expect(waferId).toMatch(/^W\d+/);
  });
});
