/**
 * Theme preference and resolution (`src/ui/theme/theme-preference.ts`, premium.md §3.1).
 *
 * `localStorage["cal.theme"]` holds `"system"` (default), `"light"`, or `"dark"`.
 * `"system"` follows `(prefers-color-scheme: dark)`; no OS preference resolves to light.
 * The resolved theme is written to `<html data-theme>`, `style.colorScheme`, and
 * `<meta name="theme-color">`.
 */

import { THEME_TOKENS, type ThemeName } from '@/ui/tokens/palette';

export type ThemePreference = 'system' | 'light' | 'dark';
export type ResolvedTheme = ThemeName;

export const THEME_STORAGE_KEY = 'cal.theme' as const;

/** Change to `"light"` to keep light even on dark-mode machines (premium.md §3.1). */
export const DEFAULT_THEME_PREFERENCE: ThemePreference = 'system';

export const THEME_PREFERENCES: readonly ThemePreference[] = [
  'system',
  'light',
  'dark',
];

export const DARK_SCHEME_QUERY = '(prefers-color-scheme: dark)' as const;

/** `theme-color` meta values: the page canvas `bg` of each theme. */
export const THEME_COLOR_META: Readonly<Record<ResolvedTheme, string>> = {
  light: THEME_TOKENS.light.bg,
  dark: THEME_TOKENS.dark.bg,
};

export function isThemePreference(value: unknown): value is ThemePreference {
  return value === 'system' || value === 'light' || value === 'dark';
}

/** Stored value, or `DEFAULT_THEME_PREFERENCE` when missing or invalid. */
export function parseThemePreference(value: unknown): ThemePreference {
  return isThemePreference(value) ? value : DEFAULT_THEME_PREFERENCE;
}

export function resolveTheme(
  preference: ThemePreference,
  systemPrefersDark: boolean,
): ResolvedTheme {
  if (preference === 'system') {
    return systemPrefersDark ? 'dark' : 'light';
  }
  return preference;
}

export interface ThemeStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface ThemeDocumentLike {
  readonly documentElement: {
    setAttribute(name: string, value: string): void;
    readonly style: { colorScheme: string };
  };
  readonly head: { appendChild(node: unknown): unknown } | null;
  querySelector(selector: string): {
    setAttribute(name: string, value: string): void;
  } | null;
  createElement(tag: 'meta'): {
    setAttribute(name: string, value: string): void;
  };
}

export function readStoredThemePreference(
  storage: Pick<ThemeStorageLike, 'getItem'> | null | undefined,
): ThemePreference {
  try {
    return parseThemePreference(storage?.getItem(THEME_STORAGE_KEY) ?? null);
  } catch {
    return DEFAULT_THEME_PREFERENCE;
  }
}

export function writeStoredThemePreference(
  storage: Pick<ThemeStorageLike, 'setItem'> | null | undefined,
  preference: ThemePreference,
): void {
  try {
    storage?.setItem(THEME_STORAGE_KEY, preference);
  } catch {
    // Storage may be disabled; the page still switches for this session.
  }
}

/** Writes `data-theme`, `color-scheme`, and the `theme-color` meta (premium.md §3.1). */
export function applyResolvedTheme(
  theme: ResolvedTheme,
  doc: ThemeDocumentLike | null | undefined,
): void {
  if (!doc) {
    return;
  }
  doc.documentElement.setAttribute('data-theme', theme);
  doc.documentElement.style.colorScheme = theme;
  let meta = doc.querySelector('meta[name="theme-color"]');
  if (!meta) {
    const created = doc.createElement('meta');
    created.setAttribute('name', 'theme-color');
    doc.head?.appendChild(created);
    meta = created;
  }
  meta.setAttribute('content', THEME_COLOR_META[theme]);
}
