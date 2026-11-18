'use client';

/**
 * Theme controller (`src/ui/theme/ThemeController.tsx`, premium.md §3.1, §8.8).
 *
 * Renders nothing. On mount it re-reads `localStorage["cal.theme"]` and the OS scheme
 * into the `theme` store, listens to `(prefers-color-scheme: dark)` live, persists
 * preference changes, and writes `data-theme`, `color-scheme`, and `theme-color`
 * whenever the resolved theme changes. OS-driven changes apply instantly (§8.8).
 */

import * as React from 'react';
import { useThemeStore } from '@/ui/state/theme-store';
import {
  applyResolvedTheme,
  DARK_SCHEME_QUERY,
  readStoredThemePreference,
  writeStoredThemePreference,
} from './theme-preference';

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
        applyResolvedTheme(state.resolved, document);
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
