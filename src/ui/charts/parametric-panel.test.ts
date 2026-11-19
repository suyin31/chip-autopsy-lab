import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { generateDemoLot } from '@/core/demo/demo-generator';
import { SUPPORTED_LOCALES } from '@/core/i18n';
import { buildLotModel } from '@/core/model/lot-builder';
import { parseStdfBytes } from '@/core/stdf/stdf-parser';
import { I18nProvider } from '@/ui/i18n';
import { createSelectionStore } from '@/ui/state';
import { ParametricPanel } from './ParametricPanel';

describe('ParametricPanel SSR render across locales (Task 13.2)', () => {
  const demo = generateDemoLot('edge-ring-etch');
  const parsed = parseStdfBytes(demo.stdfBytes, { mode: 'full' });
  if (!parsed.ok) {
    throw new Error('Failed to parse edge-ring-etch demo lot');
  }
  const lot = buildLotModel(parsed.value);

  it('renders test catalog, histogram with LO/HI limit markers, and scrub readout across all 5 locales', () => {
    for (const locale of SUPPORTED_LOCALES) {
      const store = createSelectionStore();
      store.getState().setLot(lot);

      const html = renderToStaticMarkup(
        React.createElement(
          I18nProvider,
          { initialLocale: locale },
          React.createElement(ParametricPanel, { lot, store }),
        ),
      );

      expect(html).toContain('data-testid="parametric-panel"');
      expect(html).toContain('data-testid="parametric-histogram"');
      expect(html).toContain('data-testid="parametric-scrub-readout"');
      expect(html).toContain('data-testid="parametric-limit-lo"');
      expect(html).toContain('data-testid="parametric-limit-hi"');
      expect(html).toContain('data-testid="parametric-catalog"');
      // All 4 demo tests appear untranslated in <bdi translate="no">
      expect(html).toContain('VDD_CONT_R');
      expect(html).toContain('IDDQ_LEAK');
      expect(html).toContain('VCCA_SHORT');
      expect(html).toContain('VTH_CORE');
      expect(html).toContain('translate="no"');
      // Never uses a primary button (A20 one-primary rule)
      expect(html).not.toContain('data-variant="primary"');
    }
  });

  it('returns empty markup in bins-only mode when no PTR test columns exist', () => {
    const binsOnlyParsed = parseStdfBytes(demo.stdfBytes, { mode: 'bins-only' });
    expect(binsOnlyParsed.ok).toBe(true);
    if (!binsOnlyParsed.ok) return;
    const binsOnlyLot = buildLotModel(binsOnlyParsed.value);
    const store = createSelectionStore();
    store.getState().setLot(binsOnlyLot);

    const html = renderToStaticMarkup(
      React.createElement(
        I18nProvider,
        { initialLocale: 'en' },
        React.createElement(ParametricPanel, { lot: binsOnlyLot, store }),
      ),
    );
    expect(html).not.toContain('data-testid="parametric-panel"');
    expect(html).not.toContain('data-testid="parametric-catalog"');
  });
});
