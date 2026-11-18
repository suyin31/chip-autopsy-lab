/**
 * Supported locales, native display names, and BCP-47 locale matching (`src/core/i18n/locales.ts`).
 *
 * Pure deterministic TypeScript with zero React, Next.js, or DOM globals so both
 * `src/core/` and `src/ui/` share one locale negotiation implementation (§6.1, §6.4).
 */

export type Locale = 'en' | 'zh-CN' | 'zh-TW' | 'ja' | 'ko';

export const DEFAULT_LOCALE: Locale = 'en';

export const LOCALE_STORAGE_KEY = 'cal.locale' as const;

export const SUPPORTED_LOCALES = [
  'en',
  'zh-CN',
  'zh-TW',
  'ja',
  'ko',
] as const satisfies readonly Locale[];

const SUPPORTED_LOCALE_SET: ReadonlySet<string> = new Set<string>(SUPPORTED_LOCALES);

/**
 * Native language names shown in `LanguageSwitcher` (§4.10, §6.8).
 * Never translated across dictionaries.
 */
export const LOCALE_NATIVE_NAMES: Readonly<Record<Locale, string>> = {
  en: 'English',
  'zh-CN': '简体中文',
  'zh-TW': '繁體中文',
  ja: '日本語',
  ko: '한국어',
};

/** Alias matching redesign §6.2 (`nativeName map`). */
export const nativeName: Readonly<Record<Locale, string>> = LOCALE_NATIVE_NAMES;

/** Short desktop trigger labels for `LanguageSwitcher` (§4.10). */
export const LOCALE_SHORT_LABELS: Readonly<Record<Locale, string>> = {
  en: 'EN',
  'zh-CN': '简',
  'zh-TW': '繁',
  ja: '日',
  ko: '한',
};

/** CJK locales: no italic and no serif accent word (premium.md §4.3, §12.2). */
export function isCjkLocale(locale: Locale): boolean {
  return locale === 'zh-CN' || locale === 'zh-TW' || locale === 'ja' || locale === 'ko';
}

export function isSupportedLocale(value: unknown): value is Locale {
  return typeof value === 'string' && SUPPORTED_LOCALE_SET.has(value);
}

function matchSingleTag(rawTag: string): Locale | null {
  const trimmed = rawTag.trim();
  if (trimmed.length === 0) {
    return null;
  }

  const normalized = trimmed.replace(/_/g, '-').toLowerCase();
  const subtags = normalized.split('-').filter((part) => part.length > 0);
  const primary = subtags[0];

  if (!primary) {
    return null;
  }

  if (primary === 'zh') {
    if (subtags.includes('hans')) {
      return 'zh-CN';
    }
    if (
      subtags.includes('hant') ||
      subtags.includes('tw') ||
      subtags.includes('hk') ||
      subtags.includes('mo')
    ) {
      return 'zh-TW';
    }
    return 'zh-CN';
  }

  if (primary === 'ja') {
    return 'ja';
  }

  if (primary === 'ko') {
    return 'ko';
  }

  if (primary === 'en') {
    return 'en';
  }

  return null;
}

/**
 * Negotiates a supported `Locale` from ordered BCP-47 language candidates (§6.4):
 * - `zh-TW`, `zh-HK`, `zh-MO`, or any `zh-Hant*` -> `'zh-TW'`
 * - any other `zh*` -> `'zh-CN'`
 * - `ja*` -> `'ja'`
 * - `ko*` -> `'ko'`
 * - `en*` -> `'en'`
 * - Fallback -> `'en'`
 */
export function matchLocale(
  candidates: readonly string[] | string | null | undefined,
): Locale {
  if (!candidates) {
    return DEFAULT_LOCALE;
  }

  const list = typeof candidates === 'string' ? [candidates] : candidates;
  for (let i = 0; i < list.length; i += 1) {
    const tag = list[i];
    if (typeof tag !== 'string') {
      continue;
    }
    const matched = matchSingleTag(tag);
    if (matched !== null) {
      return matched;
    }
  }

  return DEFAULT_LOCALE;
}

export interface InitialLocaleInputs {
  readonly storedLocale?: string | null | undefined;
  readonly navigatorLanguages?: readonly string[] | null | undefined;
}

/**
 * Pure implementation of redesign §6.4 steps 1–3:
 * 1. `localStorage["cal.locale"]` if it is a supported value.
 * 2. First match in `navigator.languages`.
 * 3. `'en'`.
 */
export function resolveInitialLocale(inputs: InitialLocaleInputs): Locale {
  if (isSupportedLocale(inputs.storedLocale)) {
    return inputs.storedLocale;
  }
  return matchLocale(inputs.navigatorLanguages);
}
