import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { StoreApi } from 'zustand';
import { listDemoPresets } from '@/core/demo';
import { SUPPORTED_LOCALES } from '@/core/i18n';
import { OFFLINE_QUERY_EXAMPLES } from '@/core/query';
import { ParametricPanel } from '@/ui/charts';
import { I18nProvider } from '@/ui/i18n';
import { LoadedLotOverview } from '@/ui/layout/LoadedLotOverview';
import { countPrimaryButtons } from '@/ui/primitives/button';
import { createSelectionStore, type SelectionStoreState } from '@/ui/state';
import { ActiveFilterChips } from '@/ui/wafer-map';
import { ingestDemoPreset } from '@/workers';
import {
  CommandPalette,
  executePaletteQuery,
  PALETTE_RECENTS_STORAGE_KEY,
  type PaletteStorageLike,
  readPaletteRecents,
  recordPaletteRecent,
} from './CommandPalette';

function createClientTestStore(): StoreApi<SelectionStoreState> {
  const store = createSelectionStore();
  return { ...store, getInitialState: () => store.getState() };
}

function createMemoryStorage(): PaletteStorageLike & {
  readonly map: Map<string, string>;
} {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value);
    },
  };
}

describe('CommandPalette (Task 17, Req 12.1–12.6, 17.6)', () => {
  it('persists, deduplicates, and orders recent queries newest-first under cal.palette.recents.v1', () => {
    const storage = createMemoryStorage();
    expect(readPaletteRecents(storage)).toEqual([]);

    recordPaletteRecent('only bin 7', storage);
    recordPaletteRecent('edge 3 rings', storage);
    recordPaletteRecent('ONLY BIN 7', storage);
    recordPaletteRecent('   ', storage);

    const recents = readPaletteRecents(storage);
    expect(recents).toEqual(['ONLY BIN 7', 'edge 3 rings']);
    expect(storage.map.has(PALETTE_RECENTS_STORAGE_KEY)).toBe(true);

    // Corrupt JSON fails closed to an empty array
    storage.setItem(PALETTE_RECENTS_STORAGE_KEY, '{not-json');
    expect(readPaletteRecents(storage)).toEqual([]);
  });

  it('renders nothing when closed, and renders recents first, filter examples, right-aligned <kbd> shortcuts, and zero ember tokens when open', async () => {
    const res = await ingestDemoPreset('edge-ring-etch');
    expect(res.kind).toBe('ok');
    if (res.kind !== 'ok') return;

    const store = createClientTestStore();
    store.getState().setLot(res.lot);
    const presets = listDemoPresets();

    const closedHtml = renderToStaticMarkup(
      React.createElement(
        I18nProvider,
        { initialLocale: 'en' },
        React.createElement(CommandPalette, {
          open: false,
          onClose: () => {},
          lot: res.lot,
          presets,
          store,
          disablePortal: true,
        }),
      ),
    );
    expect(closedHtml).not.toContain('data-testid="command-palette"');

    const openHtml = renderToStaticMarkup(
      React.createElement(
        I18nProvider,
        { initialLocale: 'en' },
        React.createElement(CommandPalette, {
          open: true,
          onClose: () => {},
          lot: res.lot,
          presets,
          store,
          onOpenFilePicker: () => {},
          onDownloadDemoLot: () => {},
          onLoadDemoLot: () => {},
          initialRecents: ['show edge failures with Cpk < 1.33', 'only bin 7'],
          disablePortal: true,
        }),
      ),
    );

    expect(openHtml).toContain('data-testid="command-palette"');
    expect(openHtml).toContain('role="dialog"');
    expect(openHtml).toContain('role="combobox"');
    expect(openHtml).toContain('role="listbox"');
    expect(openHtml).toContain('bg-material-thick');
    expect(openHtml).toContain('rounded-2xl');
    expect(openHtml).toContain('shadow-popover');
    expect(openHtml).toContain('z-[var(--z-sheets)]');

    // Recents group appears before Filter queries, which appears before Actions
    const recentsPos = openHtml.indexOf('data-testid="palette-group-recents"');
    const filtersPos = openHtml.indexOf('data-testid="palette-group-filters"');
    const actionsPos = openHtml.indexOf('data-testid="palette-group-actions"');
    expect(recentsPos).toBeGreaterThan(-1);
    expect(filtersPos).toBeGreaterThan(recentsPos);
    expect(actionsPos).toBeGreaterThan(filtersPos);

    // Filter examples and right-aligned <kbd> shortcuts
    for (const example of OFFLINE_QUERY_EXAMPLES) {
      expect(openHtml).toContain(example.replace(/</g, '&lt;'));
    }
    expect(openHtml).toContain('<kbd');
    expect(openHtml).toContain('Clear active filters');
    expect(openHtml).toContain('Wafer mode: Pass/fail');
    expect(openHtml).toContain('Wafer mode: Hard bins');
    expect(openHtml).toContain('Wafer mode: Soft bins');
    expect(openHtml).toContain('Wafer mode: Parametric');
    expect(openHtml).toContain('Download sample STDF');

    // Zero ember/orange colours anywhere in the palette
    expect(openHtml).not.toMatch(/ember|orange|#ff6b2c|#e8591e|#d94e14|#ff8a57/i);

    // Renders cleanly across all 5 supported locales
    for (const locale of SUPPORTED_LOCALES) {
      const locHtml = renderToStaticMarkup(
        React.createElement(
          I18nProvider,
          { initialLocale: locale },
          React.createElement(CommandPalette, {
            open: true,
            onClose: () => {},
            lot: res.lot,
            presets,
            store,
            disablePortal: true,
          }),
        ),
      );
      expect(locHtml).toContain('data-testid="command-palette"');
    }
  });

  it('executes valid DSL queries, auto-selects lowestCpkTestNum, filters ParametricPanel, and renders removable chips', async () => {
    const res = await ingestDemoPreset('edge-ring-etch');
    expect(res.kind).toBe('ok');
    if (res.kind !== 'ok') return;

    const store = createClientTestStore();
    const storage = createMemoryStorage();
    store.getState().setLot(res.lot);

    const outcome = executePaletteQuery(
      'show edge failures with Cpk < 1.33',
      store,
      { lot: res.lot, storage },
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    const state = store.getState();
    expect(state.dslFilter).not.toBeNull();
    expect(state.hasActiveFilter).toBe(true);
    expect(state.selectedDieCount).toBeGreaterThan(0);
    expect(state.selectedDieCount).toBeLessThan(res.lot.dies.count);
    // IDDQ_LEAK (test 204) is the lowest-Cpk test on edge-ring-etch
    expect(state.activeTestNum).toBe(204);
    expect(readPaletteRecents(storage)).toEqual([
      'show edge failures with Cpk < 1.33',
    ]);

    // ActiveFilterChips renders 3 removable DSL chips
    const chipsHtml = renderToStaticMarkup(
      React.createElement(
        I18nProvider,
        { initialLocale: 'en' },
        React.createElement(ActiveFilterChips, { lot: res.lot, store }),
      ),
    );
    expect(
      chipsHtml.match(/data-testid="dsl-filter-chip"/g) ?? [],
    ).toHaveLength(3);
    expect(chipsHtml).toContain('Outer 3 rings');
    expect(chipsHtml).toContain('Failures');
    expect(chipsHtml).toContain('Cpk &lt; 1.33');

    // ParametricPanel filters catalog rows to matching tests and selects IDDQ_LEAK (204)
    const paramHtml = renderToStaticMarkup(
      React.createElement(
        I18nProvider,
        { initialLocale: 'en' },
        React.createElement(ParametricPanel, { lot: res.lot, store }),
      ),
    );
    expect(paramHtml).toContain('data-test-num="204"');
    expect(paramHtml).toContain('data-selected="true"');
    expect(paramHtml).toContain('IDDQ_LEAK');
  });

  it('leaves selection unchanged on invalid query and renders palette-parse-error with clickable examples', async () => {
    const res = await ingestDemoPreset('edge-ring-etch');
    expect(res.kind).toBe('ok');
    if (res.kind !== 'ok') return;

    const store = createClientTestStore();
    const storage = createMemoryStorage();
    store.getState().setLot(res.lot);

    // Establish an existing valid filter first
    const valid = executePaletteQuery('edge 3 rings', store, {
      lot: res.lot,
      storage,
    });
    expect(valid.ok).toBe(true);
    const beforeDsl = store.getState().dslFilter;
    const beforeCount = store.getState().selectedDieCount;
    const beforeTest = store.getState().activeTestNum;

    // Invalid query must fail and leave store + recents completely unchanged
    const invalid = executePaletteQuery('not a valid filter', store, {
      lot: res.lot,
      storage,
    });
    expect(invalid.ok).toBe(false);
    expect(store.getState().dslFilter).toBe(beforeDsl);
    expect(store.getState().selectedDieCount).toBe(beforeCount);
    expect(store.getState().activeTestNum).toBe(beforeTest);
    expect(readPaletteRecents(storage)).toEqual(['edge 3 rings']);

    // Render inline parse error guidance with clickable examples
    const errorHtml = renderToStaticMarkup(
      React.createElement(
        I18nProvider,
        { initialLocale: 'en' },
        React.createElement(CommandPalette, {
          open: true,
          onClose: () => {},
          lot: res.lot,
          store,
          initialQuery: 'not a valid filter',
          initialParseError: invalid.ok ? null : invalid.error,
          disablePortal: true,
        }),
      ),
    );
    expect(errorHtml).toContain('data-testid="palette-parse-error"');
    expect(errorHtml).toContain(
      'Query not recognized. Try one of these filter examples:',
    );
    const exampleButtons =
      errorHtml.match(/data-testid="palette-error-example"/g) ?? [];
    expect(exampleButtons).toHaveLength(OFFLINE_QUERY_EXAMPLES.length);
    expect(errorHtml).not.toMatch(/ember|orange/i);
  });

  it('renders inline no-results-empty-state in LoadedLotOverview with secondary Clear the filter and keeps 1 primary button', async () => {
    const res = await ingestDemoPreset('edge-ring-etch');
    expect(res.kind).toBe('ok');
    if (res.kind !== 'ok') return;

    const store = createClientTestStore();
    const storage = createMemoryStorage();
    store.getState().setLot(res.lot);

    const zeroMatch = executePaletteQuery('only bin 99', store, {
      lot: res.lot,
      storage,
    });
    expect(zeroMatch.ok).toBe(true);
    expect(store.getState().hasActiveFilter).toBe(true);
    expect(store.getState().selectedDieCount).toBe(0);

    const html = renderToStaticMarkup(
      React.createElement(
        I18nProvider,
        { initialLocale: 'en' },
        React.createElement(LoadedLotOverview, {
          data: res,
          selectedPresetId: 'edge-ring-etch',
          onLoadDemoLot: () => {},
          store,
        }),
      ),
    );

    expect(html).toContain('data-testid="no-results-empty-state"');
    expect(html).toContain('data-testid="no-results-clear-filters"');
    expect(html).toContain('data-testid="no-results-load-demo"');
    expect(html).toContain('Clear the filter');
    expect(html).toContain('Open the sample lot');
    expect(html).toContain('Bin 99');
    // Loaded view keeps strictly 1 primary button (Show on wafer)
    expect(countPrimaryButtons(html)).toBe(1);
  });
});
