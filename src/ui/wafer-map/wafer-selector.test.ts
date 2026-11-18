import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { I18nProvider } from '@/ui/i18n';
import { ingestDemoPreset } from '@/workers';
import { WaferSelector } from './WaferSelector';

async function renderStrip(
  evidencePresence: readonly boolean[] | null,
): Promise<string> {
  const res = await ingestDemoPreset('edge-ring-etch');
  if (res.kind !== 'ok') {
    throw new Error('demo preset failed');
  }
  return renderToStaticMarkup(
    React.createElement(
      I18nProvider,
      { initialLocale: 'en' },
      React.createElement(WaferSelector, {
        lotId: res.lot.lotId,
        wafers: res.lot.wafers,
        dies: res.lot.dies,
        byWaferYield: res.yieldSummary.byWafer,
        activeWaferIndex: 0,
        evidencePresence,
        onSelectWafer: () => {},
      }),
    ),
  );
}

describe('Premium P9 — wafer strip (premium §5.8)', () => {
  it('renders the 76 px scroller with 6 px 8 px padding, 48 x 64 items, and 40 px thumbnails', async () => {
    const html = await renderStrip(null);
    expect(html).toContain('sm:h-[76px]');
    expect(html).toContain('py-1.5');
    expect(html).toContain('sm:px-2');
    expect(html).toContain('[scroll-padding-inline:32px]');
    expect(html).toContain('sm:h-16 sm:w-12');
    expect(html).toContain('sm:size-10');
    expect(html.match(/role="option"/g)).toHaveLength(25);
  });

  it('draws the active ring as 2 px bg + 3.5 px ink and the focus ring with a 4 px outer width', async () => {
    const html = await renderStrip(null);
    expect(html).toContain(
      'group-aria-selected:shadow-[0_0_0_2px_var(--bg),0_0_0_3.5px_var(--ink)]',
    );
    expect(html).toContain(
      'group-focus-visible:shadow-[0_0_0_2px_var(--bg),0_0_0_4px_var(--ink)]',
    );
    expect(html).toContain('motion-safe:group-hover:scale-[1.06]');
    expect(html).not.toContain('ring-accent');
  });

  it('dims zero-evidence wafers to 0.32 opacity and renders no evidence dot', async () => {
    const presence = Array.from({ length: 25 }, (_, i) => i % 2 === 0);
    const html = await renderStrip(presence);
    expect(html.match(/opacity-\[0\.32\]/g)).toHaveLength(12);
    expect(html).not.toContain('wafer-strip-evidence-dot');
    const rest = await renderStrip(null);
    expect(rest).not.toContain('opacity-[0.32]');
  });

  it('renders labelled chevrons hidden until a side can scroll', async () => {
    const html = await renderStrip(null);
    expect(html).toMatch(
      /data-testid="wafer-strip-chevron-earlier" data-visible="false" aria-label="Earlier wafers"/,
    );
    expect(html).toMatch(
      /data-testid="wafer-strip-chevron-later" data-visible="false" aria-label="Later wafers"/,
    );
    expect(html).toContain('sm:data-[visible=true]:inline-flex');
  });
});
