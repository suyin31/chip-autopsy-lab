'use client';

/**
 * Client i18n context provider (`src/ui/i18n/I18nProvider.tsx`).
 *
 * Reads `data-locale` written by the pre-hydration script on mount (§6.4),
 * synchronizes `<html lang>` + `data-locale` + `localStorage["cal.locale"]`
 * on language changes, and announces `"Language changed to {language}."`
 * in the active language via a polite live region (§4.10).
 */

import * as React from 'react';
import {
  DEFAULT_LOCALE,
  isSupportedLocale,
  LOCALE_NATIVE_NAMES,
  LOCALE_STORAGE_KEY,
  type Locale,
  resolveInitialLocale,
  t,
} from '@/core/i18n';

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface DocumentElementLike {
  lang: string;
  getAttribute(name: string): string | null;
  setAttribute(name: string, value: string): void;
}

export interface ClientLocaleEnv {
  readonly documentElement?: DocumentElementLike | null;
  readonly storage?: StorageLike | null;
  readonly navigatorLanguages?: readonly string[] | null;
}

export interface I18nContextValue {
  readonly locale: Locale;
  readonly setLocale: (nextLocale: Locale) => void;
}

const DEFAULT_CONTEXT_VALUE: I18nContextValue = {
  locale: DEFAULT_LOCALE,
  setLocale: () => undefined,
};

export const I18nContext =
  React.createContext<I18nContextValue>(DEFAULT_CONTEXT_VALUE);

function getDefaultBrowserEnv(): ClientLocaleEnv {
  const documentElement =
    typeof document !== 'undefined' ? document.documentElement : null;

  let storage: StorageLike | null = null;
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      storage = window.localStorage;
    }
  } catch {
    storage = null;
  }

  const navigatorLanguages =
    typeof navigator !== 'undefined'
      ? navigator.languages && navigator.languages.length > 0
        ? navigator.languages
        : navigator.language
          ? [navigator.language]
          : null
      : null;

  return { documentElement, storage, navigatorLanguages };
}

export function syncDocumentLocale(
  locale: Locale,
  docEl?: DocumentElementLike | null,
): void {
  const target =
    docEl === undefined
      ? typeof document !== 'undefined'
        ? document.documentElement
        : null
      : docEl;
  if (!target) {
    return;
  }
  target.lang = locale;
  target.setAttribute('data-locale', locale);
}

/**
 * Reads the initial client locale on mount (§6.4):
 * prefers `document.documentElement.getAttribute("data-locale")` set by the
 * pre-hydration script, falling back to `localStorage["cal.locale"]` and
 * `navigator.languages` when mounted outside `RootLayout`.
 */
export function readClientInitialLocale(env?: ClientLocaleEnv): Locale {
  const resolvedEnv = env ?? getDefaultBrowserEnv();
  const attrLocale = resolvedEnv.documentElement?.getAttribute('data-locale');
  if (isSupportedLocale(attrLocale)) {
    return attrLocale;
  }

  let storedLocale: string | null = null;
  try {
    storedLocale = resolvedEnv.storage?.getItem(LOCALE_STORAGE_KEY) ?? null;
  } catch {
    storedLocale = null;
  }

  return resolveInitialLocale({
    storedLocale,
    navigatorLanguages: resolvedEnv.navigatorLanguages,
  });
}

/**
 * Persists `nextLocale` to `localStorage["cal.locale"]`, updates `<html lang>`
 * and `data-locale`, and returns the localized announcement string (§4.10, §6.4).
 */
export function persistAndApplyLocale(
  nextLocale: Locale,
  env?: ClientLocaleEnv,
): string {
  const safeLocale = isSupportedLocale(nextLocale)
    ? nextLocale
    : DEFAULT_LOCALE;
  const resolvedEnv = env ?? getDefaultBrowserEnv();

  try {
    resolvedEnv.storage?.setItem(LOCALE_STORAGE_KEY, safeLocale);
  } catch {
    // Ignore storage quota or sandbox restrictions; DOM & state still update.
  }

  syncDocumentLocale(safeLocale, resolvedEnv.documentElement);

  return t(safeLocale, 'language.changed', {
    language: LOCALE_NATIVE_NAMES[safeLocale],
  });
}

export interface I18nProviderProps {
  readonly children?: React.ReactNode;
  readonly initialLocale?: Locale;
}

export interface UntranslatedProps {
  readonly children?: React.ReactNode;
  readonly className?: string;
}

/**
 * Wraps technical tokens (bin names/codes, test names, STDF identifiers, lot/wafer IDs,
 * WM-811K classes) in `<bdi translate="no">` when embedded in localized copy (§6.6).
 */
export function Untranslated({
  children,
  className,
}: UntranslatedProps): React.ReactElement {
  return (
    <bdi translate="no" className={className}>
      {children}
    </bdi>
  );
}

export function I18nProvider({
  children,
  initialLocale,
}: I18nProviderProps): React.ReactElement {
  const [locale, setLocaleState] = React.useState<Locale>(
    initialLocale ?? DEFAULT_LOCALE,
  );
  const [announcement, setAnnouncement] = React.useState<string>('');

  React.useEffect(() => {
    if (initialLocale) {
      syncDocumentLocale(initialLocale);
      return;
    }
    const detected = readClientInitialLocale();
    syncDocumentLocale(detected);
    setLocaleState((prev) => (prev === detected ? prev : detected));
  }, [initialLocale]);

  const setLocale = React.useCallback((nextLocale: Locale) => {
    if (!isSupportedLocale(nextLocale)) {
      return;
    }
    const message = persistAndApplyLocale(nextLocale);
    setLocaleState(nextLocale);
    setAnnouncement(message);
  }, []);

  const contextValue = React.useMemo<I18nContextValue>(
    () => ({ locale, setLocale }),
    [locale, setLocale],
  );

  return (
    <I18nContext.Provider value={contextValue}>
      {children}
      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
        data-testid="i18n-live-region"
      >
        {announcement}
      </div>
    </I18nContext.Provider>
  );
}
