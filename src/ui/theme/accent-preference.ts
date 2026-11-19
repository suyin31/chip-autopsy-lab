/**
 * Accent colour preference and persistence (`src/ui/theme/accent-preference.ts`).
 *
 * `localStorage["cal.accent"]` holds `"ember"` (default), `"cobalt"`, `"jade"`, or `"violet"`.
 * Applied independently of light/dark via `<html data-accent="...">`.
 */

import {
  ACCENT_NAMES,
  DEFAULT_ACCENT,
  type AccentName,
} from '@/ui/tokens/palette';

export type AccentPreference = AccentName;

export const ACCENT_STORAGE_KEY = 'cal.accent' as const;

export const DEFAULT_ACCENT_PREFERENCE: AccentPreference = DEFAULT_ACCENT;

export const ACCENT_PREFERENCES: readonly AccentPreference[] = ACCENT_NAMES;

export function isAccentPreference(value: unknown): value is AccentPreference {
  return (
    value === 'ember' ||
    value === 'cobalt' ||
    value === 'jade' ||
    value === 'violet'
  );
}

/** Stored value, or `DEFAULT_ACCENT_PREFERENCE` (`"ember"`) when missing or invalid. */
export function parseAccentPreference(value: unknown): AccentPreference {
  return isAccentPreference(value) ? value : DEFAULT_ACCENT_PREFERENCE;
}

export interface AccentStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface AccentDocumentLike {
  readonly documentElement: {
    setAttribute(name: string, value: string): void;
  };
}

export function readStoredAccentPreference(
  storage: Pick<AccentStorageLike, 'getItem'> | null | undefined,
): AccentPreference {
  try {
    return parseAccentPreference(storage?.getItem(ACCENT_STORAGE_KEY) ?? null);
  } catch {
    return DEFAULT_ACCENT_PREFERENCE;
  }
}

export function writeStoredAccentPreference(
  storage: Pick<AccentStorageLike, 'setItem'> | null | undefined,
  accent: AccentPreference,
): void {
  try {
    storage?.setItem(ACCENT_STORAGE_KEY, accent);
  } catch {
    // Storage may be disabled; the page still switches for this session.
  }
}

/** Writes `data-accent` on `<html>`. */
export function applyAccent(
  accent: AccentPreference,
  doc: AccentDocumentLike | null | undefined,
): void {
  if (!doc) {
    return;
  }
  doc.documentElement.setAttribute('data-accent', accent);
}
