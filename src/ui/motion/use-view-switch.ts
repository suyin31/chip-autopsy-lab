'use client';

/**
 * Browser binding for `createViewSwitcher`: one switcher per page, React `flushSync` for the
 * update, the last pressed element as the morph source, and skip-on-input.
 */

import { flushSync } from 'react-dom';
import {
  createViewSwitcher,
  VIEW_SWITCH_ACTIVATION_TTL_MS,
  type ViewSwitchDocument,
  type ViewSwitchElement,
  type ViewSwitcher,
  type ViewSwitchKind,
} from './view-switch';

let switcher: ViewSwitcher | null = null;
let lastActivation: { readonly el: Element; readonly at: number } | null = null;

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

function trackActivation(event: Event): void {
  if (event.target instanceof Element) {
    lastActivation = { el: event.target, at: now() };
  }
}

function getSwitcher(): ViewSwitcher {
  if (switcher !== null) return switcher;
  window.addEventListener('pointerdown', trackActivation, { capture: true, passive: true });
  window.addEventListener('keydown', trackActivation, { capture: true, passive: true });
  switcher = createViewSwitcher({
    getDocument: () => document as unknown as ViewSwitchDocument,
    prefersReducedMotion: () =>
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    flush: (run) => flushSync(run),
    viewport: () => ({ width: window.innerWidth, height: window.innerHeight }),
    getActivationTarget: () =>
      lastActivation !== null && now() - lastActivation.at < VIEW_SWITCH_ACTIVATION_TTL_MS
        ? (lastActivation.el as unknown as ViewSwitchElement)
        : null,
    afterUpdate: (kind) => {
      // The new view starts at its top; the old snapshot hides the jump.
      if (kind !== 'agents-lot' && window.scrollY > 0) {
        window.scrollTo({ top: 0, behavior: 'instant' });
      }
    },
    onInputDuringSwitch: (skip) => {
      const options = { capture: true, passive: true, once: true } as const;
      window.addEventListener('pointerdown', skip, options);
      window.addEventListener('wheel', skip, options);
      return () => {
        window.removeEventListener('pointerdown', skip, options);
        window.removeEventListener('wheel', skip, options);
      };
    },
  });
  return switcher;
}

/**
 * Runs a state update as a view switch. Outside the browser (SSR, unit tests) the update runs
 * at once, so callers behave exactly as a plain `setState`.
 */
export function runViewSwitch(kind: ViewSwitchKind, update: () => void): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    update();
    return;
  }
  getSwitcher().run(kind, update);
}
