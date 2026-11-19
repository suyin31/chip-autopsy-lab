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
  type AccentPreference,
  applyAccent,
  readStoredAccentPreference,
  writeStoredAccentPreference,
} from './accent-preference';
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
  ACCENT_FADING_ATTRIBUTE,
  ACCENT_TRANSITION_ATTRIBUTE,
  createThemeSwitcher,
  type ViewTransitionDocumentLike,
  withTransitionsSuppressed,
} from './theme-transition';

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';
const ACCENT_FADE_FALLBACK_MS = 260;

let accentFadeTimer: ReturnType<typeof setTimeout> | null = null;
let suppressAccentTransitions = true;

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia(REDUCED_MOTION_QUERY).matches
  );
}

function flushDocumentStyle(body: unknown): void {
  if (body instanceof Element) {
    void window.getComputedStyle(body).color;
  }
}

function applyThemeToDocument(theme: ResolvedTheme): void {
  withTransitionsSuppressed(
    document,
    () => applyResolvedTheme(theme, document),
    flushDocumentStyle,
  );
}

function applyAccentToDocument(accent: AccentPreference): void {
  if (!suppressAccentTransitions) {
    applyAccent(accent, document);
    return;
  }
  withTransitionsSuppressed(
    document,
    () => applyAccent(accent, document),
    flushDocumentStyle,
  );
}

const themeSwitcher = createThemeSwitcher<ThemePreference>({
  getDocument: () =>
    typeof document === 'undefined'
      ? null
      : (document as unknown as ViewTransitionDocumentLike),
  prefersReducedMotion,
  changesResolvedTheme: (preference) => {
    const { resolved, systemPrefersDark } = useThemeStore.getState();
    return resolveTheme(preference, systemPrefersDark) !== resolved;
  },
  onTransitionStart: () => {
    document.documentElement.removeAttribute(ACCENT_TRANSITION_ATTRIBUTE);
  },
  // The store subscriber below writes the DOM synchronously; `flushSync` renders React
  // (menu check, magnifier canvas theme) before the new snapshot is taken.
  apply: (preference) => {
    flushSync(() => useThemeStore.getState().setPreference(preference));
  },
});

const accentSwitcher = createThemeSwitcher<AccentPreference>({
  getDocument: () =>
    typeof document === 'undefined'
      ? null
      : (document as unknown as ViewTransitionDocumentLike),
  prefersReducedMotion,
  changesResolvedTheme: (accent) => useThemeStore.getState().accent !== accent,
  onTransitionStart: () => {
    document.documentElement.setAttribute(ACCENT_TRANSITION_ATTRIBUTE, '');
  },
  onTransitionEnd: () => {
    document.documentElement.removeAttribute(ACCENT_TRANSITION_ATTRIBUTE);
  },
  apply: (accent) => {
    flushSync(() => useThemeStore.getState().setAccent(accent));
  },
});

/** Appearance menu entry point: View Transition cross-fade, instant when unsupported or reduced (§8.8). */
export function switchThemePreference(preference: ThemePreference): void {
  themeSwitcher.switchTo(preference);
}

/** Accent swatch entry point: smooth 240 ms cross-fade (View Transition or CSS fallback), instant under reduced motion. */
export function switchAccentPreference(accent: AccentPreference): void {
  if (useThemeStore.getState().accent === accent) {
    return;
  }
  const doc =
    typeof document === 'undefined'
      ? null
      : (document as unknown as ViewTransitionDocumentLike);
  const canViewTransition =
    doc !== null && typeof doc.startViewTransition === 'function';

  if (!canViewTransition && doc !== null && !prefersReducedMotion()) {
    if (accentFadeTimer !== null) {
      clearTimeout(accentFadeTimer);
    }
    document.documentElement.setAttribute(ACCENT_FADING_ATTRIBUTE, '');
    suppressAccentTransitions = false;
    try {
      flushSync(() => useThemeStore.getState().setAccent(accent));
    } finally {
      suppressAccentTransitions = true;
    }
    accentFadeTimer = setTimeout(() => {
      document.documentElement.removeAttribute(ACCENT_FADING_ATTRIBUTE);
      accentFadeTimer = null;
    }, ACCENT_FADE_FALLBACK_MS);
    return;
  }

  accentSwitcher.switchTo(accent);
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
    initial.setAccent(readStoredAccentPreference(getStorage()));
    applyResolvedTheme(store.getState().resolved, document);
    applyAccent(store.getState().accent, document);

    const unsubscribe = store.subscribe((state, prev) => {
      if (state.preference !== prev.preference) {
        writeStoredThemePreference(getStorage(), state.preference);
      }
      if (state.resolved !== prev.resolved) {
        applyThemeToDocument(state.resolved);
      }
      if (state.accent !== prev.accent) {
        writeStoredAccentPreference(getStorage(), state.accent);
        applyAccentToDocument(state.accent);
      }
    });

    const onSchemeChange = (event: MediaQueryListEvent) => {
      store.getState().setSystemPrefersDark(event.matches);
    };
    mql?.addEventListener('change', onSchemeChange);

    return () => {
      unsubscribe();
      mql?.removeEventListener('change', onSchemeChange);
      if (accentFadeTimer !== null) {
        clearTimeout(accentFadeTimer);
        accentFadeTimer = null;
      }
    };
  }, []);

  return null;
}
