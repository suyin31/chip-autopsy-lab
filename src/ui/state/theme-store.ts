/**
 * Zustand `theme` slice (`src/ui/state/theme-store.ts`, premium.md §3.1).
 *
 * Holds the stored preference, the live OS scheme, and the resolved theme.
 * `ThemeController` (src/ui/theme) persists preference changes and writes the DOM;
 * canvas code subscribes with `useResolvedTheme()` and re-rasters once per change.
 * Kept separate from the selection store so `reset()` never touches the theme.
 */

import { create, type StateCreator } from 'zustand';
import { createStore, type StoreApi } from 'zustand/vanilla';
import {
  type AccentPreference,
  DEFAULT_ACCENT_PREFERENCE,
  parseAccentPreference,
  readStoredAccentPreference,
} from '@/ui/theme/accent-preference';
import {
  DARK_SCHEME_QUERY,
  DEFAULT_THEME_PREFERENCE,
  parseThemePreference,
  readStoredThemePreference,
  type ResolvedTheme,
  resolveTheme,
  type ThemePreference,
} from '@/ui/theme/theme-preference';

export interface ThemeStoreState {
  readonly preference: ThemePreference;
  readonly systemPrefersDark: boolean;
  readonly resolved: ResolvedTheme;
  readonly accent: AccentPreference;
  readonly setPreference: (preference: ThemePreference) => void;
  readonly setSystemPrefersDark: (prefersDark: boolean) => void;
  readonly setAccent: (accent: AccentPreference) => void;
}

export interface ThemeStoreInit {
  readonly preference?: ThemePreference;
  readonly systemPrefersDark?: boolean;
  readonly accent?: AccentPreference;
}

function buildThemeStoreSlice(
  init: ThemeStoreInit = {},
): StateCreator<ThemeStoreState> {
  const preference = parseThemePreference(
    init.preference ?? DEFAULT_THEME_PREFERENCE,
  );
  const systemPrefersDark = init.systemPrefersDark ?? false;
  const accent = parseAccentPreference(
    init.accent ?? DEFAULT_ACCENT_PREFERENCE,
  );
  return (set, get) => ({
    preference,
    systemPrefersDark,
    resolved: resolveTheme(preference, systemPrefersDark),
    accent,
    setPreference: (next) => {
      const safe = parseThemePreference(next);
      const { preference: current, systemPrefersDark: dark } = get();
      if (safe === current) return;
      set({ preference: safe, resolved: resolveTheme(safe, dark) });
    },
    setSystemPrefersDark: (prefersDark) => {
      const { preference: current, systemPrefersDark: dark } = get();
      if (prefersDark === dark) return;
      set({
        systemPrefersDark: prefersDark,
        resolved: resolveTheme(current, prefersDark),
      });
    },
    setAccent: (next) => {
      const safe = parseAccentPreference(next);
      if (safe === get().accent) return;
      set({ accent: safe });
    },
  });
}

export function createThemeStore(
  init?: ThemeStoreInit,
): StoreApi<ThemeStoreState> {
  return createStore<ThemeStoreState>(buildThemeStoreSlice(init));
}

/** Same inputs as the pre-hydration scripts, so the first client read matches the painted page. */
function readClientThemeInit(): ThemeStoreInit {
  if (typeof window === 'undefined') return {};
  let storage: Storage | null = null;
  try {
    storage = window.localStorage;
  } catch {
    storage = null;
  }
  let systemPrefersDark = false;
  try {
    systemPrefersDark =
      typeof window.matchMedia === 'function' &&
      window.matchMedia(DARK_SCHEME_QUERY).matches;
  } catch {
    systemPrefersDark = false;
  }
  return {
    preference: readStoredThemePreference(storage),
    systemPrefersDark,
    accent: readStoredAccentPreference(storage),
  };
}

export const useThemeStore = create<ThemeStoreState>(
  buildThemeStoreSlice(readClientThemeInit()),
);

/** Resolved `"light" | "dark"` theme; re-renders only when it changes. */
export function useResolvedTheme(): ResolvedTheme {
  return useThemeStore((state) => state.resolved);
}

/** Selected accent colour (`"ember" | "cobalt" | "jade" | "violet"`); re-renders only when it changes. */
export function useAccent(): AccentPreference {
  return useThemeStore((state) => state.accent);
}
