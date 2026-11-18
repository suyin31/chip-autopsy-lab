import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { type Locale, SUPPORTED_LOCALES } from '@/core/i18n';
import { I18nProvider } from '@/ui/i18n';
import type { LiveBoxSelectStats } from './linked-interactions';
import {
  SELECTION_POPOVER_WIDTH_PX,
  SelectionPopover,
  splitMostLossTemplate,
} from './SelectionPopover';

const STATS: LiveBoxSelectStats = {
  dieCount: 148,
  failingCount: 31,
  yieldRatio: 117 / 148,
  topBin: { mode: 'SBIN', code: 7, name: 'IDDQ_EDGE_LEAK', count: 22 },
  snappedBounds: { minX: 0, maxX: 11, minY: 0, maxY: 11 },
};

function render(
  stats: LiveBoxSelectStats | null,
  isCommitted: boolean,
  locale: Locale = 'en',
): string {
  return renderToStaticMarkup(
    React.createElement(
      I18nProvider,
      { initialLocale: locale },
      React.createElement(SelectionPopover, {
        committedStats: stats,
        isCommitted,
        onClear: () => undefined,
      }),
    ),
  );
}

describe('SelectionPopover content (premium §7.14)', () => {
  it('reads "148 dies selected", "31 failed, 79.1% yield", "Most loss: SBIN 7", then Clear and an Esc keycap', () => {
    const html = render(STATS, true);
    expect(SELECTION_POPOVER_WIDTH_PX).toBe(240);
    expect(html).toContain('w-[240px]');
    expect(html).toContain('bg-material-thick');
    expect(html).toContain('shadow-popover');
    expect(html).toContain('rounded-lg px-4 py-3');
    expect(html).toMatch(/data-testid="selection-popover-title"[^>]*>148 dies selected</);
    expect(html).toMatch(/data-testid="selection-popover-summary"[^>]*>31 failed, 79.1% yield</);
    expect(html).toContain(
      'Most loss: <bdi translate="no" data-testid="selection-popover-top-bin">SBIN 7</bdi>',
    );
    expect(html).toMatch(/data-testid="selection-popover-clear"[^>]*>Clear</);
    expect(html).toMatch(/data-testid="selection-popover-esc"[^>]*>Esc</);
    expect(html).not.toContain('Zoom to selection');
    // Primary and secondary tiers only over the wafer; nothing orange
    expect(html).not.toContain('text-text-tertiary');
    expect(html).not.toContain('ember');
  });

  it('hides the most-loss line without a failing bin and the action row while dragging', () => {
    const html = render({ ...STATS, failingCount: 0, yieldRatio: 1, topBin: null }, false);
    expect(html).toMatch(/data-testid="selection-popover-most-loss" hidden=""/);
    expect(html).not.toContain('selection-popover-actions');
  });

  it('keeps the bin code outside the translated template in every locale', () => {
    for (const locale of SUPPORTED_LOCALES) {
      const html = render(STATS, true, locale);
      expect(html, locale).toContain('<bdi translate="no" data-testid="selection-popover-top-bin">SBIN 7</bdi>');
    }
    expect(splitMostLossTemplate('Most loss: \u0000')).toEqual(['Most loss: ', '']);
    expect(splitMostLossTemplate('x')).toEqual(['x', '']);
  });
});
