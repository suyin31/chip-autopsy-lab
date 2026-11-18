import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { GlossaryText, I18nProvider } from '@/ui/i18n';
import {
  computeTermPopoverPosition,
  Term,
  TERM_CONTROL_HOVER_DELAY_MS,
  TERM_HOVER_DELAY_MS,
} from './term';

const viewport = { width: 1440, height: 900 };

describe('Term (premium §7.17)', () => {
  it('renders an inline button with the term class and a description reference', () => {
    const html = renderToStaticMarkup(
      React.createElement(Term, {
        term: 'Cpk',
        definition: 'Fit inside limits.',
        termId: 'cpk',
        children: 'Cpk',
      }),
    );
    expect(html).toMatch(/^<button type="button" data-testid="term" data-term-id="cpk" data-state="closed" aria-describedby="[^"]+-definition" class="term">Cpk<\/button>$/);
  });

  it('renders a non-interactive label inside controls', () => {
    const html = renderToStaticMarkup(
      React.createElement(Term, {
        term: 'Hard bins',
        definition: 'Coarse.',
        variant: 'label',
        descriptionId: 'hb',
        children: 'Hard bins',
      }),
    );
    expect(html).toMatch(/^<span data-testid="term" data-state="closed" class="term">Hard bins<\/span>$/);
    expect(TERM_HOVER_DELAY_MS).toBe(300);
    expect(TERM_CONTROL_HOVER_DELAY_MS).toBe(600);
  });

  it('places the popover 6 px above, flips below near the top, and stays 8 px inside', () => {
    const popover = { width: 280, height: 80 };
    expect(
      computeTermPopoverPosition({ top: 400, bottom: 420, left: 600, width: 40 }, popover, viewport),
    ).toEqual({ top: 314, left: 480, placement: 'top' });
    expect(
      computeTermPopoverPosition({ top: 40, bottom: 60, left: 0, width: 40 }, popover, viewport),
    ).toEqual({ top: 66, left: 8, placement: 'bottom' });
    expect(
      computeTermPopoverPosition({ top: 400, bottom: 420, left: 1420, width: 20 }, popover, viewport).left,
    ).toBe(1440 - 8 - 280);
  });

  it('wraps the first match of each listed term and keeps untranslated tokens out', () => {
    const html = renderToStaticMarkup(
      React.createElement(
        I18nProvider,
        { initialLocale: 'en' },
        React.createElement(GlossaryText, {
          text: 'Dominant bin SBIN 7 (IDDQ_LEAK) has Cpk 0.14 and bin drift',
          terms: ['cpk', 'limits', 'testSite', 'bin'],
          untranslatedTokens: { bin: 'SBIN 7', test: 'IDDQ_LEAK' },
        }),
      ),
    );
    const terms = html.match(/data-term-id="(\w+)"/g);
    expect(terms).toEqual(['data-term-id="bin"', 'data-term-id="cpk"']);
    expect(html).toContain('<bdi translate="no">SBIN 7</bdi>');
    expect(html).toContain('<bdi translate="no">IDDQ_LEAK</bdi>');
    expect(html).toContain('and bin drift');
  });
});
