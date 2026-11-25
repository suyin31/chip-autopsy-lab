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
 * Glass bento card (UI v2 §4 row 1). Clean-room rewrite of the idea shared by Motion Primitives
 * `Tilt` + `Spotlight` and Magic UI `MagicCard` (both MIT); no React Bits code.
 *
 * - Spring 3D tilt toward the pointer (`maxDeg`, default 7) with a hover lift (-4 px).
 * - A 360 px surface spotlight follows the pointer inside the card (`.at-bento::before`).
 * - A 1.5 px rim lights up as the pointer approaches, shared with every other plate on the page
 *   (`.at-bento::after`, `useProximityRim`), so two neighbouring cards catch the same light.
 * - Writes only motion values and CSS variables while the pointer moves: no React render per frame.
 * - Silent on touch, coarse pointers, and reduced motion (no tilt, lift, light, or press).
 */

const MOTION_TAGS = {
  div: motion.div,
  article: motion.article,
  section: motion.section,
  li: motion.li,
  aside: motion.aside,
} as const;

export type SpotlightTiltCardTag = keyof typeof MOTION_TAGS;

export interface SpotlightTiltCardProps
  extends Omit<
    React.HTMLAttributes<HTMLElement>,
    'onDrag' | 'onDragStart' | 'onDragEnd' | 'onAnimationStart' | 'onAnimationEnd'
  > {
  readonly as?: SpotlightTiltCardTag;
  /** `bento` (default) is the L1 glass card; `float` is the higher floating card. */
  readonly material?: 'bento' | 'float';
  /** Maximum tilt in degrees; `0` keeps the light but never tilts (dense text rows). */
  readonly maxDeg?: number;
  /** Hover lift in px (negative is up). */
  readonly liftPx?: number;
  /** Surface spotlight following the pointer. */
  readonly spotlight?: boolean;
  /** Shared proximity rim. */
  readonly rim?: boolean;
  /** Distance at which the rim starts to catch the pointer (default 180). */
  readonly reachPx?: number;
  /** Press scale 0.985 while the card is held (for cards that act as a control). */
  readonly pressable?: boolean;
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
      reachPx = 180,
      pressable = false,
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

    useProximityRim(innerRef, { disabled: !rim, reachPx });

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
      if (reduced) {
        rest();
        rotateX.jump(0);
        rotateY.jump(0);
        y.jump(0);
      }
    }, [reduced, rest, rotateX, rotateY, y]);

    React.useEffect(() => rest, [rest]);

    const handleEnter = (event: React.PointerEvent<HTMLElement>): void => {
      onPointerEnter?.(event);
      if (reduced || !canFollowPointer(event)) return;
      const el = event.currentTarget;
      rectRef.current = el.getBoundingClientRect();
      pointRef.current = { x: event.clientX, y: event.clientY };
      liftTarget.set(liftPx);
      if (spotlight) el.dataset.spot = 'on';
      frameRef.current ??= requestAnimationFrame(flush);
    };

    const handleMove = (event: React.PointerEvent<HTMLElement>): void => {
      onPointerMove?.(event);
      if (!rectRef.current) return;
      pointRef.current = { x: event.clientX, y: event.clientY };
      frameRef.current ??= requestAnimationFrame(flush);
    };

    const handleLeave = (event: React.PointerEvent<HTMLElement>): void => {
      onPointerLeave?.(event);
      rest();
    };

    const handleCancel = (event: React.PointerEvent<HTMLElement>): void => {
      onPointerCancel?.(event);
      rest();
    };

    const Tag = MOTION_TAGS[as] as React.ElementType;

    return (
      <Tag
        {...props}
        ref={setRef}
        data-bento=""
        className={cn(material === 'float' ? 'at-float-card' : 'at-bento', className)}
        style={{
          ...style,
          rotateX,
          rotateY,
          y,
          transformPerspective: BENTO_PERSPECTIVE_PX,
        }}
        whileTap={pressable && !reduced ? { scale: 0.985 } : undefined}
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
