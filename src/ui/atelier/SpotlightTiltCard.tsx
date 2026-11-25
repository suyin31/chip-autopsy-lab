'use client';

import { motion, useMotionValue, useSpring } from 'motion/react';
import * as React from 'react';
import { useReducedMotionPreference } from '@/ui/motion/hooks';
import {
  BENTO_HOVER_LIFT_PX,
  BENTO_PERSPECTIVE_PX,
  BENTO_TILT_MAX_DEG,
  SPRING_BENTO_TILT,
} from '@/ui/motion/tokens';
import { cn } from '@/ui/primitives/cn';
import { useProximityRim } from './ProximityPlate';

/**
 * 3D Glass Bento Card with `preserve-3d` inner depth, spring tilt, cursor spotlight wash,
 * and shared multi-card proximity rim. Clean-room implementation inspired by Motion Primitives
 * `Tilt` + `Spotlight` and Magic UI `MagicCard` (MIT); zero React Bits source code.
 *
 * - Spring 3D tilt (`maxDeg`, default 7.5°) + hover lift (`-4px`) + `preserve-3d` so child
 *   `.at-bento-pop-sm` badges/icons float physically above the glass surface when tilted.
 * - 380px cursor spotlight wash inside `.at-bento::before` + shared 1.5px specular rim
 *   across neighbouring cards via `useProximityRim` (`.at-bento::after`).
 * - Zero React re-renders per pointer frame (updates motion values and CSS variables only).
 * - Gracefully silent on touch, coarse pointers, and `prefers-reduced-motion: reduce`.
 */

const MOTION_TAGS = {
  div: motion.div,
  article: motion.article,
  section: motion.section,
  li: motion.li,
  aside: motion.aside,
  button: motion.button,
} as const;

export type SpotlightTiltCardTag = keyof typeof MOTION_TAGS;

export interface SpotlightTiltCardProps
  extends Omit<
    React.ButtonHTMLAttributes<HTMLElement>,
    'onDrag' | 'onDragStart' | 'onDragEnd' | 'onAnimationStart' | 'onAnimationEnd'
  > {
  readonly as?: SpotlightTiltCardTag;
  /** `bento` (default) is the L1 glass card; `float` is the Z+2 floating glass card. */
  readonly material?: 'bento' | 'float';
  /** Maximum tilt in degrees; `0` keeps the light but never tilts (dense text rows). */
  readonly maxDeg?: number;
  /** Hover lift in px (negative is up). */
  readonly liftPx?: number;
  /** Surface spotlight following the pointer. */
  readonly spotlight?: boolean;
  /** Shared proximity rim. */
  readonly rim?: boolean;
  /** Distance at which the rim starts to catch the pointer (default 190). */
  readonly reachPx?: number;
  /** Press scale 0.985 while the card is held (for cards that act as a control). */
  readonly pressable?: boolean;
  /** Enables `transform-style: preserve-3d` so `.at-bento-pop-sm` children float in Z-space. */
  readonly preserve3d?: boolean;
}

function isInsideRect(rect: DOMRect, x: number, y: number): boolean {
  return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
}

function canFollowPointer(event: React.PointerEvent): boolean {
  if (event.pointerType === 'touch') return false;
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(hover: hover) and (pointer: fine)').matches;
}

export const SpotlightTiltCard = React.forwardRef<HTMLElement, SpotlightTiltCardProps>(
  function SpotlightTiltCard(
    {
      as = 'div',
      material = 'bento',
      maxDeg = BENTO_TILT_MAX_DEG,
      liftPx = BENTO_HOVER_LIFT_PX,
      spotlight = true,
      rim = true,
      reachPx = 190,
      pressable = false,
      preserve3d = true,
      disabled,
      className,
      style,
      children,
      onPointerEnter,
      onPointerMove,
      onPointerLeave,
      onPointerCancel,
      ...props
    },
    forwardedRef,
  ) {
    const reduced = useReducedMotionPreference();
    const innerRef = React.useRef<HTMLElement | null>(null);
    const rectRef = React.useRef<DOMRect | null>(null);
    const frameRef = React.useRef<number | null>(null);
    const pointRef = React.useRef<{ x: number; y: number } | null>(null);
    // Removes the document listeners that keep tracking the pointer after a tilt-induced leave.
    const releaseTrackRef = React.useRef<(() => void) | null>(null);

    useProximityRim(innerRef, { disabled: !rim || Boolean(disabled), reachPx });

    const rotateXTarget = useMotionValue(0);
    const rotateYTarget = useMotionValue(0);
    const liftTarget = useMotionValue(0);
    const rotateX = useSpring(rotateXTarget, SPRING_BENTO_TILT);
    const rotateY = useSpring(rotateYTarget, SPRING_BENTO_TILT);
    const y = useSpring(liftTarget, SPRING_BENTO_TILT);

    const setRef = React.useCallback(
      (node: HTMLElement | null) => {
        innerRef.current = node;
        if (typeof forwardedRef === 'function') forwardedRef(node);
        else if (forwardedRef) forwardedRef.current = node;
      },
      [forwardedRef],
    );

    const flush = React.useCallback(() => {
      frameRef.current = null;
      const el = innerRef.current;
      const rect = rectRef.current;
      const point = pointRef.current;
      if (!el || !rect || !point || rect.width === 0 || rect.height === 0) return;
      const px = Math.min(Math.max((point.x - rect.left) / rect.width, 0), 1);
      const py = Math.min(Math.max((point.y - rect.top) / rect.height, 0), 1);
      if (maxDeg > 0) {
        rotateXTarget.set(Number((-(py * 2 - 1) * maxDeg).toFixed(3)));
        rotateYTarget.set(Number(((px * 2 - 1) * maxDeg).toFixed(3)));
      }
      if (spotlight) {
        el.style.setProperty('--spot-x', `${Math.round(px * rect.width)}px`);
        el.style.setProperty('--spot-y', `${Math.round(py * rect.height)}px`);
      }
    }, [maxDeg, rotateXTarget, rotateYTarget, spotlight]);

    const rest = React.useCallback(() => {
      releaseTrackRef.current?.();
      releaseTrackRef.current = null;
      rectRef.current = null;
      pointRef.current = null;
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
      rotateXTarget.set(0);
      rotateYTarget.set(0);
      liftTarget.set(0);
      const el = innerRef.current;
      if (el) delete el.dataset.spot;
    }, [liftTarget, rotateXTarget, rotateYTarget]);

    React.useEffect(() => {
      if (reduced || disabled) {
        rest();
        rotateX.jump(0);
        rotateY.jump(0);
        y.jump(0);
      }
    }, [disabled, reduced, rest, rotateX, rotateY, y]);

    React.useEffect(() => rest, [rest]);

    const handleEnter = (event: React.PointerEvent<HTMLElement>): void => {
      onPointerEnter?.(event);
      if (reduced || disabled || !canFollowPointer(event)) return;
      const el = event.currentTarget;
      // Re-entering while still inside the resting rect: keep that rect. Measuring now would
      // read the tilted, lifted box and shift the hover edge again.
      if (releaseTrackRef.current && rectRef.current) {
        releaseTrackRef.current();
        releaseTrackRef.current = null;
        pointRef.current = { x: event.clientX, y: event.clientY };
        frameRef.current ??= requestAnimationFrame(flush);
        return;
      }
      rectRef.current = el.getBoundingClientRect();
      pointRef.current = { x: event.clientX, y: event.clientY };
      liftTarget.set(liftPx);
      if (spotlight) el.dataset.spot = 'on';
      frameRef.current ??= requestAnimationFrame(flush);
    };

    const handleMove = (event: React.PointerEvent<HTMLElement>): void => {
      onPointerMove?.(event);
      if (!rectRef.current || disabled) return;
      pointRef.current = { x: event.clientX, y: event.clientY };
      frameRef.current ??= requestAnimationFrame(flush);
    };

    const handleLeave = (event: React.PointerEvent<HTMLElement>): void => {
      onPointerLeave?.(event);
      const rect = rectRef.current;
      // Tilting moves the card's projected edge away from a pointer that rests near it, which
      // fires `pointerleave` while the pointer is still over the card's resting footprint.
      // Resting there would flip the tilt back and forth, so keep tracking on the document
      // until the pointer really leaves the footprint measured on enter.
      if (
        rect &&
        !disabled &&
        isInsideRect(rect, event.clientX, event.clientY) &&
        typeof document !== 'undefined'
      ) {
        if (releaseTrackRef.current) return;
        const onDocMove = (e: PointerEvent): void => {
          if (!isInsideRect(rect, e.clientX, e.clientY)) {
            rest();
            return;
          }
          pointRef.current = { x: e.clientX, y: e.clientY };
          frameRef.current ??= requestAnimationFrame(flush);
        };
        const onDocLeave = (): void => rest();
        document.addEventListener('pointermove', onDocMove, { passive: true });
        document.documentElement.addEventListener('pointerleave', onDocLeave);
        window.addEventListener('blur', onDocLeave);
        releaseTrackRef.current = () => {
          document.removeEventListener('pointermove', onDocMove);
          document.documentElement.removeEventListener('pointerleave', onDocLeave);
          window.removeEventListener('blur', onDocLeave);
        };
        return;
      }
      rest();
    };

    const handleCancel = (event: React.PointerEvent<HTMLElement>): void => {
      onPointerCancel?.(event);
      rest();
    };

    const Tag = MOTION_TAGS[as] as React.ElementType;
    const enable3dChildren = preserve3d && !reduced && maxDeg > 0;

    return (
      <Tag
        {...props}
        {...(as === 'button' ? { disabled } : {})}
        ref={setRef}
        data-bento=""
        className={cn(
          material === 'float' ? 'at-float-card' : 'at-bento',
          enable3dChildren && 'at-bento-3d',
          className,
        )}
        style={{
          ...style,
          rotateX,
          rotateY,
          y,
          transformPerspective: BENTO_PERSPECTIVE_PX,
        }}
        whileTap={pressable && !reduced && !disabled ? { scale: 0.985 } : undefined}
        onPointerEnter={handleEnter}
        onPointerMove={handleMove}
        onPointerLeave={handleLeave}
        onPointerCancel={handleCancel}
      >
        {children}
      </Tag>
    );
  },
);
