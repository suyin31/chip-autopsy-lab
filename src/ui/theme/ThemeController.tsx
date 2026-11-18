'use client';

/**
 * Theme controller (`src/ui/theme/ThemeController.tsx`, premium.md §3.1, §8.8).
 *
 * Renders nothing. On mount it re-reads `localStorage["cal.theme"]` and the OS scheme
 * into the `theme` store, listens to `(prefers-color-scheme: dark)` live, persists
 * preference changes, and writes `data-theme`, `color-scheme`, and `theme-color`
 * whenever the resolved theme changes, with CSS transitions off for that write. OS-driven
 * changes apply instantly; Appearance menu choices go through `switchThemePreference`,
 * which cross-fades the root with a View Transition (§8.8).
 */

import * as React from 'react';
import { flushSync } from 'react-dom';
import { useThemeStore } from '@/ui/state/theme-store';
import {
  applyResolvedTheme,
  DARK_SCHEME_QUERY,
  readStoredThemePreference,
  resolveTheme,
  type ResolvedTheme,
  type ThemePreference,
  writeStoredThemePreference,
} from './theme-preference';
import {
  createThemeSwitcher,
  type ViewTransitionDocumentLike,
  withTransitionsSuppressed,
} from './theme-transition';

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

function applyThemeToDocument(theme: ResolvedTheme): void {
  withTransitionsSuppressed(
    document,
    () => applyResolvedTheme(theme, document),
    (body) => {
      if (body instanceof Element) {
        void window.getComputedStyle(body).color;
      }
    },
  );
}

const themeSwitcher = createThemeSwitcher<ThemePreference>({
  getDocument: () =>
    typeof document === 'undefined'
      ? null
      : (document as unknown as ViewTransitionDocumentLike),
  prefersReducedMotion: () =>
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia(REDUCED_MOTION_QUERY).matches,
  changesResolvedTheme: (preference) => {
    const { resolved, systemPrefersDark } = useThemeStore.getState();
    return resolveTheme(preference, systemPrefersDark) !== resolved;
  },
  // The store subscriber below writes the DOM synchronously; `flushSync` renders React
  // (menu check, magnifier canvas theme) before the new snapshot is taken.
  apply: (preference) => {
    flushSync(() => useThemeStore.getState().setPreference(preference));
  },
});

/** Appearance menu entry point: View Transition cross-fade, instant when unsupported or reduced (§8.8). */
export function switchThemePreference(preference: ThemePreference): void {
  themeSwitcher.switchTo(preference);
}

function getStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function ThemeController(): null {
  React.useEffect(() => {
    const store = useThemeStore;
    const mql =
      typeof window.matchMedia === 'function'
        ? window.matchMedia(DARK_SCHEME_QUERY)
        : null;

    const initial = store.getState();
    initial.setSystemPrefersDark(mql?.matches ?? false);
    initial.setPreference(readStoredThemePreference(getStorage()));
    applyResolvedTheme(store.getState().resolved, document);

    const unsubscribe = store.subscribe((state, prev) => {
      if (state.preference !== prev.preference) {
        writeStoredThemePreference(getStorage(), state.preference);
      }
      if (state.resolved !== prev.resolved) {
        applyThemeToDocument(state.resolved);
      }
    });

    const onSchemeChange = (event: MediaQueryListEvent) => {
      store.getState().setSystemPrefersDark(event.matches);
    };
    mql?.addEventListener('change', onSchemeChange);

    return () => {
      unsubscribe();
      mql?.removeEventListener('change', onSchemeChange);
    };
  }, []);

  return null;
}
