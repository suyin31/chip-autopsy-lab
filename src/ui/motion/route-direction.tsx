'use client';

import * as React from 'react';

/** Routes that sit "deeper" than the landing; navigating to one pushes in, leaving pulls back. */
const DEEP_ROUTE_PREFIXES = ['/agents', '/chip_autopsy_lab'] as const;

export function resolveRouteDirection(pathname: string): 'forward' | 'back' {
  return DEEP_ROUTE_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))
    ? 'forward'
    : 'back';
}

/**
 * Writes `data-route-dir` on `<html>` before a route view transition captures the old page:
 * on a same-origin link click (capture phase) and on Back / Forward (`popstate`, where
 * `location` already holds the destination). The route CSS reverses the depth push on `back`.
 */
export function RouteDirection(): null {
  React.useEffect(() => {
    const root = document.documentElement;
    const onClick = (event: MouseEvent): void => {
      if (event.defaultPrevented || event.button !== 0) return;
      const anchor = event.target instanceof Element ? event.target.closest('a[href]') : null;
      if (!(anchor instanceof HTMLAnchorElement)) return;
      const url = new URL(anchor.href, window.location.href);
      if (url.origin !== window.location.origin || url.pathname === window.location.pathname) return;
      root.dataset.routeDir = resolveRouteDirection(url.pathname);
    };
    const onPopState = (): void => {
      root.dataset.routeDir = resolveRouteDirection(window.location.pathname);
    };
    window.addEventListener('click', onClick, true);
    window.addEventListener('popstate', onPopState, true);
    return () => {
      window.removeEventListener('click', onClick, true);
      window.removeEventListener('popstate', onPopState, true);
    };
  }, []);
  return null;
}
