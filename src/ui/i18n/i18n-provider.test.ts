import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  LOCALE_NATIVE_NAMES,
  LOCALE_STORAGE_KEY,
  type Locale,
  resolveInitialLocale,
  SUPPORTED_LOCALES,
} from '@/core/i18n';
import {
  I18nProvider,
  LOCALE_INIT_SCRIPT,
  persistAndApplyLocale,
  readClientInitialLocale,
  Untranslated,
  useT,
} from './index';

interface MockEnv {
  readonly storageMap: Map<string, string>;
  readonly docEl: {
    lang: string;
    attributes: Map<string, string>;
    getAttribute: (name: string) => string | null;
    setAttribute: (name: string, value: string) => void;
  };
  readonly runInlineScript: (options?: {
    navigatorLanguages?: readonly string[];
    navigatorLanguage?: string;
    throwOnStorage?: boolean;
  }) => void;
}

function createMockBrowserEnv(initialLang = 'en'): MockEnv {
  const storageMap = new Map<string, string>();
  const attributes = new Map<string, string>();
  const docEl = {
    lang: initialLang,
    attributes,
    getAttribute(name: string): string | null {
      if (name === 'lang') return docEl.lang;
      return attributes.get(name) ?? null;
    },
    setAttribute(name: string, value: string): void {
      if (name === 'lang') {
        docEl.lang = value;
      }
      attributes.set(name, value);
    },
  };

  const runInlineScript: MockEnv['runInlineScript'] = (options = {}) => {
    const mockLocalStorage = {
      getItem(key: string): string | null {
        if (options.throwOnStorage) {
          throw new Error('SecurityError: storage disabled');
        }
        return storageMap.get(key) ?? null;
      },
    };
    const mockNavigator = {
      languages: options.navigatorLanguages,
      language: options.navigatorLanguage ?? 'en-US',
    };
    const mockDocument = {
      documentElement: docEl,
    };

    const runner = new Function(
      'localStorage',
      'navigator',
      'document',
      LOCALE_INIT_SCRIPT,
    );
    runner(mockLocalStorage, mockNavigator, mockDocument);
  };

  return { storageMap, docEl, runInlineScript };
}

function SampleConsumer(): React.ReactElement {
  const {
    locale,
    t,
    tPlural,
    formatInteger,
    formatPercent,
    formatDecimal2,
    formatDuration,
    formatMegabytes,
    formatParametricValue,
  } = useT();

  return React.createElement(
    'div',
    { 'data-locale-probe': locale },
    React.createElement('h1', null, t('landing.headline')),
    React.createElement(
      'p',
      null,
      t('takeaway.scratch', {
        count: formatInteger(3),
        total: formatInteger(25),
        yield: formatPercent(0.828),
      }),
    ),
    React.createElement('span', { 'data-dies': 'true' }, tPlural('findings.dieCount', 1)),
    React.createElement('span', { 'data-score': 'true' }, formatDecimal2(0.95)),
    React.createElement('span', { 'data-dur': 'true' }, formatDuration(0.8)),
    React.createElement('span', { 'data-mb': 'true' }, formatMegabytes(4.2)),
    React.createElement(
      'span',
      { 'data-param': 'true' },
      formatParametricValue(10.22e-6, 'A', 6),
    ),
  );
}

describe('UI I18nProvider, useT hook, pre-hydration script, and persistence (Task R2)', () => {
  it('falls back safely to English when useT() is rendered outside I18nProvider', () => {
    const html = renderToStaticMarkup(React.createElement(SampleConsumer));
    expect(html).toContain('data-locale-probe="en"');
    expect(html).toContain('Drop the body.');
    expect(html).toContain(
      'Failing dies line up along a scratch on 3 of 25 wafers. Final yield is 82.8%.',
    );
    expect(html).toContain('>1 die<');
    expect(html).toContain('>0.95<');
    expect(html).toContain('>0.8s<');
    expect(html).toContain('>4.2 MB<');
    expect(html).toContain('>10.22 uA<');
  });

  it('renders localized copy and bound Intl formatters for all 5 locales via I18nProvider', () => {
    const expectedHeadlines: Readonly<Record<Locale, string>> = {
      en: 'Drop the body.',
      'zh-CN': '把遗体放这里。',
      'zh-TW': '把遺體放這裡。',
      ja: '遺体をここに。',
      ko: '시신을 여기에.',
    };

    for (const locale of SUPPORTED_LOCALES) {
      const html = renderToStaticMarkup(
        React.createElement(
          I18nProvider,
          { initialLocale: locale },
          React.createElement(SampleConsumer),
        ),
      );
      expect(html).toContain(`data-locale-probe="${locale}"`);
      expect(html).toContain(expectedHeadlines[locale]);
      expect(html).toContain('aria-live="polite"');
    }
  });

  it('applies §6.4 steps 1–3 identically in the pre-hydration inline script and resolveInitialLocale', () => {
    const matrix: ReadonlyArray<{
      readonly stored: string | null;
      readonly languages: readonly string[];
      readonly throwStorage?: boolean;
      readonly expected: Locale;
    }> = [
      { stored: 'ja', languages: ['en-US'], expected: 'ja' },
      { stored: 'zh-TW', languages: ['ko-KR'], expected: 'zh-TW' },
      { stored: null, languages: ['zh-HK', 'en-US'], expected: 'zh-TW' },
      { stored: null, languages: ['zh-MO'], expected: 'zh-TW' },
      { stored: null, languages: ['zh-Hant-HK'], expected: 'zh-TW' },
      { stored: null, languages: ['zh-Hans-HK'], expected: 'zh-CN' },
      { stored: null, languages: ['zh'], expected: 'zh-CN' },
      { stored: null, languages: ['zh-SG'], expected: 'zh-CN' },
      { stored: 'invalid', languages: ['ko-KR'], expected: 'ko' },
      { stored: null, languages: ['fr-FR', 'ja-JP'], expected: 'ja' },
      { stored: null, languages: ['fr-FR'], expected: 'en' },
      {
        stored: 'ja',
        languages: ['zh-HK'],
        throwStorage: true,
        expected: 'zh-TW',
      },
    ];

    for (const row of matrix) {
      const env = createMockBrowserEnv();
      if (row.stored !== null) {
        env.storageMap.set(LOCALE_STORAGE_KEY, row.stored);
      }
      env.runInlineScript({
        navigatorLanguages: row.languages,
        throwOnStorage: row.throwStorage ?? false,
      });

      const coreResolved = resolveInitialLocale({
        storedLocale: row.throwStorage ? null : row.stored,
        navigatorLanguages: row.languages,
      });

      expect(env.docEl.lang).toBe(row.expected);
      expect(env.docEl.getAttribute('data-locale')).toBe(row.expected);
      expect(env.docEl.lang).toBe(coreResolved);

      // Provider mount reader picks up data-locale set by the pre-hydration script
      expect(
        readClientInitialLocale({
          documentElement: env.docEl,
          storage: null,
          navigatorLanguages: ['en-US'],
        }),
      ).toBe(row.expected);
    }
  });

  it('persists localStorage["cal.locale"], updates <html lang> and data-locale, and returns localized live-region announcement (§4.10)', () => {
    const env = createMockBrowserEnv();
    const mockStorage = {
      getItem: (k: string) => env.storageMap.get(k) ?? null,
      setItem: (k: string, v: string) => {
        env.storageMap.set(k, v);
      },
    };

    for (const locale of SUPPORTED_LOCALES) {
      const announcement = persistAndApplyLocale(locale, {
        storage: mockStorage,
        documentElement: env.docEl,
      });

      expect(env.storageMap.get(LOCALE_STORAGE_KEY)).toBe(locale);
      expect(env.docEl.lang).toBe(locale);
      expect(env.docEl.getAttribute('data-locale')).toBe(locale);
      expect(announcement).toContain(LOCALE_NATIVE_NAMES[locale]);
    }

    // Handles throwing localStorage without crashing DOM updates
    const throwingStorage = {
      getItem: (): string | null => {
        throw new Error('QuotaExceededError');
      },
      setItem: (): void => {
        throw new Error('QuotaExceededError');
      },
    };
    const fallbackAnnouncement = persistAndApplyLocale('en', {
      storage: throwingStorage,
      documentElement: env.docEl,
    });
    expect(env.docEl.lang).toBe('en');
    expect(fallbackAnnouncement).toBe('Language changed to English.');

    // §6.6 Untranslated wrapper renders <bdi translate="no"> around bin & test names
    // and forwards standard HTML/data-* attributes while preserving translate="no"
    const bdiHtml = renderToStaticMarkup(
      React.createElement(
        'p',
        null,
        React.createElement(Untranslated, null, 'SBIN 7 IDDQ_EDGE_LEAK'),
        ' · ',
        React.createElement(
          Untranslated,
          { 'data-testid': 'untranslated-probe', className: 'font-mono-id' } as React.ComponentProps<typeof Untranslated> & { 'data-testid': string },
          '204 IDDQ_LEAK',
        ),
      ),
    );
    expect(bdiHtml).toBe(
      '<p><bdi translate="no">SBIN 7 IDDQ_EDGE_LEAK</bdi> · <bdi data-testid="untranslated-probe" translate="no" class="font-mono-id">204 IDDQ_LEAK</bdi></p>',
    );
  });
});
