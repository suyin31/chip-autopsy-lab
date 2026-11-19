import { describe, expect, it } from 'vitest';
import {
  createBoundFormatters,
  DEFAULT_LOCALE,
  DICTIONARIES,
  en,
  extractPlaceholders,
  formatDecimal2,
  formatDuration,
  formatFileSize,
  formatInteger,
  formatLocalizedParametricValue,
  formatMegabytes,
  formatPercent,
  getDictionary,
  getLocaleFormatters,
  isSupportedLocale,
  ja,
  ko,
  LOCALE_NATIVE_NAMES,
  LOCALE_SHORT_LABELS,
  LOCALE_STORAGE_KEY,
  type Locale,
  type MessageKey,
  matchLocale,
  nativeName,
  pluralKey,
  resolveInitialLocale,
  SUPPORTED_LOCALES,
  t,
  tPlural,
  zhCN,
  zhTW,
} from './index';

describe('core i18n locales, matching, dictionaries, and Intl formatters (Task R2)', () => {
  it('exposes the 5 supported locales, native language names, and short trigger labels', () => {
    expect(DEFAULT_LOCALE).toBe('en');
    expect(LOCALE_STORAGE_KEY).toBe('cal.locale');
    expect(SUPPORTED_LOCALES).toEqual(['en', 'zh-CN', 'zh-TW', 'ja', 'ko']);
    expect(LOCALE_NATIVE_NAMES).toEqual({
      en: 'English',
      'zh-CN': '简体中文',
      'zh-TW': '繁體中文',
      ja: '日本語',
      ko: '한국어',
    });
    expect(nativeName).toBe(LOCALE_NATIVE_NAMES);
    expect(LOCALE_SHORT_LABELS).toEqual({
      en: 'EN',
      'zh-CN': '简',
      'zh-TW': '繁',
      ja: '日',
      ko: '한',
    });

    for (const loc of SUPPORTED_LOCALES) {
      expect(isSupportedLocale(loc)).toBe(true);
    }
    expect(isSupportedLocale('fr')).toBe(false);
    expect(isSupportedLocale('')).toBe(false);
    expect(isSupportedLocale(null)).toBe(false);
    expect(isSupportedLocale(undefined)).toBe(false);
  });

  it('maps BCP-47 candidates via matchLocale according to redesign §6.4', () => {
    // Explicit R2 acceptance gates
    expect(matchLocale(['zh-HK'])).toBe('zh-TW');
    expect(matchLocale(['zh'])).toBe('zh-CN');
    expect(matchLocale(['fr'])).toBe('en');

    // Traditional Chinese variants -> zh-TW
    expect(matchLocale(['zh-TW'])).toBe('zh-TW');
    expect(matchLocale(['zh-MO'])).toBe('zh-TW');
    expect(matchLocale(['zh-Hant'])).toBe('zh-TW');
    expect(matchLocale(['zh-Hant-HK'])).toBe('zh-TW');
    expect(matchLocale(['zh-Hant-TW'])).toBe('zh-TW');
    expect(matchLocale(['zh_HK'])).toBe('zh-TW');

    // Simplified Chinese & other zh* -> zh-CN
    expect(matchLocale(['zh-CN'])).toBe('zh-CN');
    expect(matchLocale(['zh-SG'])).toBe('zh-CN');
    expect(matchLocale(['zh-Hans'])).toBe('zh-CN');
    expect(matchLocale(['zh-Hans-CN'])).toBe('zh-CN');
    expect(matchLocale(['zh-Hans-HK'])).toBe('zh-CN');

    // Japanese, Korean, English
    expect(matchLocale(['ja'])).toBe('ja');
    expect(matchLocale(['ja-JP'])).toBe('ja');
    expect(matchLocale(['ko'])).toBe('ko');
    expect(matchLocale(['ko-KR'])).toBe('ko');
    expect(matchLocale(['en'])).toBe('en');
    expect(matchLocale(['en-GB'])).toBe('en');
    expect(matchLocale(['en-US'])).toBe('en');

    // Ordered navigator.languages negotiation (first supported match wins)
    expect(matchLocale(['fr-FR', 'de-DE', 'ja-JP', 'en-US'])).toBe('ja');
    expect(matchLocale(['en-US', 'ja-JP'])).toBe('en');
    expect(matchLocale(['es-ES', 'zh-HK', 'zh-CN'])).toBe('zh-TW');

    // Single string convenience + empty/malformed fallbacks
    expect(matchLocale('zh-HK')).toBe('zh-TW');
    expect(matchLocale([])).toBe('en');
    expect(matchLocale(['', '   ', 'zhx-XX'])).toBe('en');
    expect(matchLocale(null)).toBe('en');
    expect(matchLocale(undefined)).toBe('en');
  });

  it('resolves initial locale with localStorage precedence over navigator.languages (§6.4)', () => {
    expect(
      resolveInitialLocale({
        storedLocale: 'ko',
        navigatorLanguages: ['en-US', 'ja-JP'],
      }),
    ).toBe('ko');

    expect(
      resolveInitialLocale({
        storedLocale: 'unsupported-locale',
        navigatorLanguages: ['zh-HK', 'en-US'],
      }),
    ).toBe('zh-TW');

    expect(
      resolveInitialLocale({
        storedLocale: null,
        navigatorLanguages: ['fr-FR'],
      }),
    ).toBe('en');

    expect(resolveInitialLocale({})).toBe('en');
  });

  it('maintains exact key parity and placeholder parity across all 5 locales', () => {
    expect(DICTIONARIES.en).toBe(en);
    expect(DICTIONARIES['zh-CN']).toBe(zhCN);
    expect(DICTIONARIES['zh-TW']).toBe(zhTW);
    expect(DICTIONARIES.ja).toBe(ja);
    expect(DICTIONARIES.ko).toBe(ko);

    const enKeys = Object.keys(en).sort() as MessageKey[];
    expect(enKeys.length).toBe(342);

    for (const locale of SUPPORTED_LOCALES) {
      const dict = getDictionary(locale);
      const localeKeys = Object.keys(dict).sort();
      expect(localeKeys, `key set mismatch in ${locale}`).toEqual(enKeys);

      for (const key of enKeys) {
        const enValue = en[key];
        const localizedValue = dict[key];
        expect(
          typeof localizedValue === 'string' && localizedValue.trim().length > 0,
          `empty translation for ${locale}:${key}`,
        ).toBe(true);

        // No accidental fullwidth braces or unbalanced ASCII braces
        expect(
          localizedValue,
          `fullwidth brace in ${locale}:${key}`,
        ).not.toMatch(/[｛｝]/);
        const stripped = localizedValue.replace(/\{[a-zA-Z0-9_]+\}/g, '');
        expect(
          stripped,
          `unbalanced brace in ${locale}:${key}`,
        ).not.toMatch(/[{}]/);

        // Identical placeholder set to English source of truth
        const expectedPlaceholders = extractPlaceholders(enValue);
        const actualPlaceholders = extractPlaceholders(localizedValue);
        expect(
          actualPlaceholders,
          `placeholder mismatch in ${locale}:${key}`,
        ).toEqual(expectedPlaceholders);
      }
    }
  });

  it('preserves untranslated technical tokens (§6.6), CJK plural parity (§6.3), and deadpan Halloween copy (§7)', () => {
    const cjkLocales: readonly Locale[] = ['zh-CN', 'zh-TW', 'ja', 'ko'];

    for (const locale of SUPPORTED_LOCALES) {
      const dict = getDictionary(locale);
      expect(dict['app.title']).toBe('Chip Autopsy Lab');
      expect(dict['nav.wordmark']).toBe('Chip Autopsy Lab');
      expect(dict['nav.wordmarkShort']).toBe('Autopsy Lab');
      expect(dict['magnifier.place']).toMatch(/^X \{x\}.+Y \{y\}$/);
      expect(dict['demo.edgeRing.title']).toContain('Edge-Ring');
      expect(dict['demo.scratch.description']).toContain('18');
      expect(dict['error.notStdf.body']).toContain('FAR (0, 10)');
      expect(dict['error.version.body']).toContain('STDF_VER');
      expect(dict['error.version.body']).toContain('Chip Autopsy Lab');
      expect(dict['error.vax.body']).toContain('FAR.CPU_TYPE');
      expect(dict['error.vax.body']).toContain('CPU_TYPE');
      expect(dict['error.gzip.body']).toContain('1F 8B');
      expect(dict['error.noParts.body']).toContain('PRR');
      expect(dict['findings.capability.sub']).toContain('Cpk');

      // Interpolated bin codes/names, test numbers/names, WM-811K classes, and IDs pass through verbatim (§6.6)
      expect(
        t(locale, 'findings.dominantBin.sub', {
          bin: 'SBIN 7 IDDQ_EDGE_LEAK',
          dies: '2,483',
        }),
      ).toContain('SBIN 7 IDDQ_EDGE_LEAK');
      expect(
        t(locale, 'findings.capability.headline', {
          kind: t(locale, 'findings.testKind.leakage'),
          test: 'IDDQ_LEAK',
        }),
      ).toContain('IDDQ_LEAK');
      expect(
        t(locale, 'findings.capability.sub', {
          cpk: formatDecimal2(locale, 0.14),
          mean: '10.22 uA',
          lo: '0.20',
          hi: '15.00 uA',
        }),
      ).toContain('Cpk');
      expect(
        t(locale, 'verdict.pattern', { pattern: 'Edge-Ring' }),
      ).toContain('Edge-Ring');
      expect(
        t(locale, 'strip.aria', { lotId: 'CAL-ER-2401' }),
      ).toContain('CAL-ER-2401');

      // Stat captions stand alone as clean noun phrases and compose cleanly with stats.inSelection
      const statCaptions = [
        t(locale, 'stats.edgeShare', { rings: formatInteger(locale, 3) }),
        t(locale, 'stats.scratchShare'),
        t(locale, 'stats.siteRate', {
          site: formatInteger(locale, 2),
          other: formatPercent(locale, 0.021),
        }),
        t(locale, 'stats.finalYield'),
        t(locale, 'stats.firstPass', {
          firstPass: formatPercent(locale, 0.815),
        }),
        t(locale, 'stats.failingDies', {
          tested: formatInteger(locale, 15825),
        }),
      ];
      for (const caption of statCaptions) {
        expect(caption).not.toMatch(/^(的|颗|顆|の)/);
        const inSel = t(locale, 'stats.inSelection', { caption });
        expect(inSel).not.toContain('のの');
        expect(inSel).not.toContain('内颗');
        expect(inSel).not.toContain('內顆');
      }
    }

    for (const locale of cjkLocales) {
      const dict = getDictionary(locale);
      expect(dict['findings.dieCount.one']).toBe(dict['findings.dieCount.other']);
      expect(dict['selection.dies.one']).toBe(dict['selection.dies.other']);
    }

    // §7 exact deadpan examples
    expect(t('en', 'landing.headline')).toBe('Drop the body.');
    expect(t('zh-CN', 'landing.headline')).toBe('把遗体放这里。');
    expect(t('ja', 'landing.headline')).toBe('遺体をここに。');
  });

  it('keeps every locale on the premium §9.1 tone rules and §9.4 themed-copy limits (A26)', () => {
    // Keys allowed to carry the autopsy theme (premium §9.4) plus the product name
    const themedKeys = new Set<MessageKey>([
      'landing.headline',
      'landing.headlineAccent',
      'drop.headline',
      'verdict.prefix',
      'verdict.healthy',
    ]);
    const themedWords: Readonly<Record<Locale, RegExp>> = {
      en: /\b(autopsy|body|bodies|dead|death)\b/i,
      'zh-CN': /死|遗体|尸|解剖/,
      'zh-TW': /死|遺體|屍|解剖/,
      ja: /死|遺体|解剖|検死/,
      ko: /사인|시신|부검|죽음/,
    };
    for (const locale of SUPPORTED_LOCALES) {
      const dict = getDictionary(locale);
      for (const key of Object.keys(dict) as MessageKey[]) {
        const value = dict[key].replaceAll('Chip Autopsy Lab', '').replaceAll('Autopsy Lab', '');
        expect(dict[key], `exclamation mark in ${locale}:${key}`).not.toMatch(/[!！]/);
        if (!themedKeys.has(key)) {
          expect(value, `themed copy outside §9.4 in ${locale}:${key}`).not.toMatch(themedWords[locale]);
        }
      }
    }
    for (const key of Object.keys(en) as MessageKey[]) {
      const value = en[key];
      expect(value, `banned word in en:${key}`).not.toMatch(
        /\b(please|simply|just|oops|sorry|successfully)\b/i,
      );
      if (!key.startsWith('causes.') && !key.startsWith('hypothesis.')) {
        expect(value, `hedging adverb in en:${key}`).not.toMatch(/\b(possibly|perhaps|seems)\b/i);
      }
      // Prose lists never use middle dots (premium §9.1 rule 8)
      expect(value, `middle dot in en:${key}`).not.toContain('·');
    }
  });

  it('interpolates parameters deterministically, escapes $-replacement hazards, and resolves plural forms', () => {
    expect(
      t('en', 'takeaway.scratch', {
        count: '3',
        total: '25',
        yield: '82.8%',
      }),
    ).toBe('Failing dies line up along a scratch on 3 of 25 wafers. Final yield is 82.8%.');

    // Dollar-sign patterns in untrusted file or bin names must not trigger RegExp replacement tokens
    expect(
      t('en', 'toast.downloaded', { fileName: 'lot_$&_$1.stdf' }),
    ).toBe('Downloaded lot_$&_$1.stdf.');

    // Plural resolution
    expect(pluralKey('en', 'findings.dieCount', 1)).toBe('findings.dieCount.one');
    expect(pluralKey('en', 'findings.dieCount', 0)).toBe('findings.dieCount.other');
    expect(pluralKey('en', 'findings.dieCount', 2)).toBe('findings.dieCount.other');
    expect(pluralKey('ja', 'findings.dieCount', 1)).toBe('findings.dieCount.other');

    expect(tPlural('en', 'findings.dieCount', 1)).toBe('1 die');
    expect(tPlural('en', 'findings.dieCount', 0)).toBe('0 dies');
    expect(tPlural('en', 'findings.dieCount', 2552)).toBe('2,552 dies');
    expect(tPlural('en', 'selection.dies', 148, { count: '148' })).toBe('148 dies selected');

    for (const locale of SUPPORTED_LOCALES) {
      const detA = t(locale, 'findings.edgeBand.sub', {
        edgeRate: formatPercent(locale, 0.464),
        interiorRate: formatPercent(locale, 0.016),
        wafers: formatInteger(locale, 25),
        total: formatInteger(locale, 25),
      });
      const detB = t(locale, 'findings.edgeBand.sub', {
        edgeRate: formatPercent(locale, 0.464),
        interiorRate: formatPercent(locale, 0.016),
        wafers: formatInteger(locale, 25),
        total: formatInteger(locale, 25),
      });
      expect(detA).toBe(detB);
    }

    // Compile-time type safety assertions for t() (§6.3)
    if (Math.random() < -1) {
      // @ts-expect-error unknown message key is rejected at compile time
      t('en', 'nonexistent.key');
      // @ts-expect-error missing required params object is rejected at compile time
      t('en', 'takeaway.scratch');
      // @ts-expect-error incomplete params object is rejected at compile time
      t('en', 'takeaway.scratch', { count: '3', total: '25' });
      // @ts-expect-error unexpected params on parameterless key is rejected at compile time
      t('en', 'landing.headline', { extra: 'x' });
    }
  });

  it('caches Intl formatters per locale and formats integers, percents, scores, durations, MB, and SI values (§6.5)', () => {
    for (const locale of SUPPORTED_LOCALES) {
      expect(getLocaleFormatters(locale)).toBe(getLocaleFormatters(locale));
      expect(formatInteger(locale, 15825)).toBe('15,825');
      expect(formatPercent(locale, 0.828)).toBe('82.8%');
      expect(formatDecimal2(locale, 0.95)).toBe('0.95');
      expect(formatDecimal2(locale, 0.14)).toBe('0.14');
      expect(
        formatLocalizedParametricValue(locale, 10.22e-6, 'A', 6),
      ).toBe('10.22 uA');
      expect(
        formatLocalizedParametricValue(locale, 1.25, 'V', 3),
      ).toBe('1,250.00 mV');
    }

    expect(formatInteger('en', Number.NaN)).toBe('0');
    expect(formatInteger('en', -0)).toBe('0');
    expect(formatPercent('en', Number.NaN)).toBe('0.0%');
    expect(formatDecimal2('en', Number.NaN)).toBe('0.00');

    expect(formatDuration('en', 0.8)).toBe('0.8s');
    expect(formatDuration('zh-CN', 0.8)).toBe('0.8秒');
    expect(formatDuration('ko', 0.8)).toBe('0.8초');

    expect(formatMegabytes('en', 4.2)).toBe('4.2 MB');
    expect(formatFileSize('en', 312 * 1024 * 1024)).toBe('312 MB');

    const bound = createBoundFormatters('en');
    expect(bound.integer(2721)).toBe('2,721');
    expect(bound.percent(0.938)).toBe('93.8%');
    expect(bound.decimal2(1.33)).toBe('1.33');
    expect(bound.duration(1.2)).toBe('1.2s');
    expect(bound.megabytes(9.8)).toBe('9.8 MB');
    expect(bound.fileSize(4.2 * 1024 * 1024)).toBe('4.2 MB');
    expect(bound.parametric(14.2e-6, 'A', 6)).toBe('14.20 uA');
  });
});
