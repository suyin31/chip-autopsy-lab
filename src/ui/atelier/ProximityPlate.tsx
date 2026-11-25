'use client';

import * as React from 'react';
import { useReducedMotionPreference } from '@/ui/motion/hooks';
import { cn } from '@/ui/primitives/cn';

/**
 * Proximity-lit plate (UI plan §4 B, surprise #2 front half). Clean-room implementation of the
 * idea behind Magic UI `MagicCard` (MIT): a 1 px rim drawn by a masked radial gradient follows
 * the pointer. Unlike a per-card hover effect, every plate on the page reads one shared pointer,
 * so when the cursor passes between two plates both facing edges catch the same light.
 *
 * - One window `pointermove` listener for all plates, coalesced to one rAF.
 * - Writes only CSS variables (`--prox-x`, `--prox-y`, `--prox-o`); no React render per frame.
 * - Off on touch, coarse pointers, and reduced motion. Silent at rest: no frame runs without
 *   pointer movement.
 */

const DEFAULT_REACH_PX = 140;

const plates = new Set<HTMLElement>();
let frame: number | null = null;
let pointerX = 0;
let pointerY = 0;
let pointerInside = false;
let listening = false;

function writeRim(el: HTMLElement, opacity: number, x: number, y: number): void {
  if (opacity <= 0) {
    if (el.dataset.proxLit === 'true') {
      el.style.setProperty('--prox-o', '0');
      el.dataset.proxLit = 'false';
    }
    return;
  }
  el.style.setProperty('--prox-x', `${Math.round(x)}px`);
  el.style.setProperty('--prox-y', `${Math.round(y)}px`);
  el.style.setProperty('--prox-o', opacity.toFixed(3));
  el.dataset.proxLit = 'true';
}

function flush(): void {
  frame = null;
  const viewportH = window.innerHeight;
  for (const el of plates) {
    if (!pointerInside) {
      writeRim(el, 0, 0, 0);
      continue;
    }
    const rect = el.getBoundingClientRect();
    if (rect.bottom < 0 || rect.top > viewportH || rect.width === 0) {
      writeRim(el, 0, 0, 0);
      continue;
    }
    const reach = Number(el.dataset.proxReach) || DEFAULT_REACH_PX;
    const dx = Math.max(rect.left - pointerX, 0, pointerX - rect.right);
    const dy = Math.max(rect.top - pointerY, 0, pointerY - rect.bottom);
    const distance = Math.hypot(dx, dy);
    const opacity = distance >= reach ? 0 : 1 - distance / reach;
    writeRim(el, opacity, pointerX - rect.left, pointerY - rect.top);
  }
}

function schedule(): void {
  frame ??= window.requestAnimationFrame(flush);
}

function handlePointerMove(event: PointerEvent): void {
  if (event.pointerType === 'touch') {
    return;
  }
  pointerX = event.clientX;
  pointerY = event.clientY;
  pointerInside = true;
  schedule();
}

function handlePointerLeave(event: PointerEvent | MouseEvent): void {
  if ('relatedTarget' in event && event.relatedTarget !== null) {
    return;
  }
  pointerInside = false;
  schedule();
}

function handleScroll(): void {
  if (pointerInside) schedule();
}

function startListening(): void {
  if (listening) return;
  listening = true;
  window.addEventListener('pointermove', handlePointerMove, { passive: true });
  document.documentElement.addEventListener('pointerleave', handlePointerLeave);
  window.addEventListener('blur', handlePointerLeave as (event: Event) => void);
  window.addEventListener('scroll', handleScroll, { passive: true, capture: true });
}

function stopListening(): void {
  if (!listening) return;
  listening = false;
  window.removeEventListener('pointermove', handlePointerMove);
  document.documentElement.removeEventListener('pointerleave', handlePointerLeave);
  window.removeEventListener('blur', handlePointerLeave as (event: Event) => void);
  window.removeEventListener('scroll', handleScroll, { capture: true });
  if (frame !== null) {
    window.cancelAnimationFrame(frame);
    frame = null;
  }
}

/** Registers an element with the shared proximity light. The element needs the `.at-optic` class. */
export function useProximityRim<T extends HTMLElement>(
  ref: React.RefObject<T | null>,
  { disabled = false, reachPx }: { readonly disabled?: boolean; readonly reachPx?: number } = {},
): void {
  const reduced = useReducedMotionPreference();
  React.useEffect(() => {
    const el = ref.current;
    if (!el || disabled || reduced || typeof window.matchMedia !== 'function') {
      return;
    }
    const fine = window.matchMedia('(hover: hover) and (pointer: fine)');
    if (!fine.matches) {
      return;
    }
    if (reachPx !== undefined) {
      el.dataset.proxReach = String(reachPx);
    }
    plates.add(el);
    startListening();
    return () => {
      plates.delete(el);
      el.style.removeProperty('--prox-x');
      el.style.removeProperty('--prox-y');
      el.style.removeProperty('--prox-o');
      delete el.dataset.proxLit;
      delete el.dataset.proxReach;
      if (plates.size === 0) {
        stopListening();
      }
    };
  }, [ref, disabled, reduced, reachPx]);
}

/** Class list of a machined plate, for elements that render their own tag (buttons, links). */
export const PROXIMITY_PLATE_CLASS = 'at-optic';

export interface ProximityPlateProps extends React.HTMLAttributes<HTMLElement> {
  readonly as?: 'div' | 'section' | 'article' | 'li' | 'aside';
  /** Hover lift (-1.5 px) and hover elevation; for plates that are themselves interactive. */
  readonly lift?: boolean;
  /** Distance in px at which the rim starts to catch the pointer (default 140). */
  readonly reachPx?: number;
  /** Turns the proximity rim off while keeping the plate material. */
  readonly unlit?: boolean;
}

export const ProximityPlate = React.forwardRef<HTMLElement, ProximityPlateProps>(
  function ProximityPlate(
    { as = 'div', lift = false, reachPx, unlit = false, className, children, ...props },
    forwardedRef,
  ) {
    const innerRef = React.useRef<HTMLElement | null>(null);
    useProximityRim(innerRef, { disabled: unlit, ...(reachPx !== undefined ? { reachPx } : {}) });

    const setRef = React.useCallback(
      (node: HTMLElement | null) => {
        innerRef.current = node;
        if (typeof forwardedRef === 'function') {
          forwardedRef(node);
        } else if (forwardedRef) {
          forwardedRef.current = node;
        }
      },
      [forwardedRef],
    );

    return React.createElement(
      as,
      {
        ...props,
        ref: setRef,
        'data-lift': lift ? '' : undefined,
        className: cn(PROXIMITY_PLATE_CLASS, 'rounded-[20px]', className),
      },
      children,
    );
  },
);
