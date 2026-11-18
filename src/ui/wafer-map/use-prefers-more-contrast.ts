'use client';

import * as React from 'react';

/** `premium.md` §5.3: pass tiles switch to `pass-tile-hc` under this media query. */
export const PREFERS_MORE_CONTRAST_QUERY = '(prefers-contrast: more)' as const;

function subscribe(onChange: () => void): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return () => undefined;
  }
  const mql = window.matchMedia(PREFERS_MORE_CONTRAST_QUERY);
  mql.addEventListener('change', onChange);
  return () => mql.removeEventListener('change', onChange);
}

function getSnapshot(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }
  return window.matchMedia(PREFERS_MORE_CONTRAST_QUERY).matches;
}

function getServerSnapshot(): boolean {
  return false;
}

/** Live `prefers-contrast: more` flag for the canvas die painters (premium §5.3). */
export function usePrefersMoreContrast(): boolean {
  return React.useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
