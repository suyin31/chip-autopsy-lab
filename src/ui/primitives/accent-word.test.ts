import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { isCjkLocale, SUPPORTED_LOCALES, t } from '@/core/i18n';
import { renderAccentPhrase } from './accent-word';

function render(node: React.ReactNode): string {
  return renderToStaticMarkup(React.createElement(React.Fragment, null, node));
}

describe('editorial accent word (premium §12.2)', () => {
  it('wraps exactly the accent word in the landing headline for Latin locales', () => {
    const html = render(
      renderAccentPhrase(t('en', 'landing.headline'), t('en', 'landing.headlineAccent'), true),
    );
    expect(html).toBe('Drop the <span data-accent="" class="type-accent">body</span>.');
  });

  it('renders no accent in zh, ja, and ko', () => {
    for (const locale of SUPPORTED_LOCALES) {
      const html = render(
        renderAccentPhrase(
          t(locale, 'landing.headline'),
          t(locale, 'landing.headlineAccent'),
          !isCjkLocale(locale),
        ),
      );
      expect(html.includes('data-accent'), locale).toBe(locale === 'en');
      expect(t(locale, 'landing.headline')).toContain(t(locale, 'landing.headlineAccent'));
    }
  });

  it('falls back to plain text when the accent is empty or missing', () => {
    expect(render(renderAccentPhrase('Drop the body.', '', true))).toBe('Drop the body.');
    expect(render(renderAccentPhrase('Drop the body.', 'wafer', true))).toBe('Drop the body.');
  });
});
