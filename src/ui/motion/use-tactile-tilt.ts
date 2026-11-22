'use client';

import { useEffect, type RefObject } from 'react';
import { readSheenFollowEnvironment } from '@/ui/wafer-map/sheen-motion';
import { canTilt, computeSpotlight, computeTiltTarget, createTiltFollower, TILT_REST, TILT_TOKENS } from './tilt';

export interface TactileTiltOptions {
  readonly maxDeg?: number;
  readonly liftPx?: number;
  readonly disabled?: boolean;
  readonly enabled?: boolean;
}

export function useTactileTilt<T extends HTMLElement>(ref: RefObject<T | null>, {
  maxDeg = TILT_TOKENS.maxDegCard, liftPx, disabled, enabled = true,
}: TactileTiltOptions = {}): void {
  useEffect(() => {
    const el = ref.current;
    if (!el || disabled || !enabled) return;
    let rect: DOMRect | null = null;
    let point: { x: number; y: number } | null = null;
    let frame: number | null = null;
    let springStep: FrameRequestCallback | null = null;
    let originalTransform: string | null = null;
    let hadStyle = false;
    let spotlightWritten = false;

    function clear() {
      if (!el || originalTransform === null) return;
      el.style.transform = originalTransform;
      originalTransform = null;
      delete el.dataset.tilt;
      if (spotlightWritten) {
        el.style.removeProperty('--spotlight-x');
        el.style.removeProperty('--spotlight-y');
        spotlightWritten = false;
      }
      if (!hadStyle && !el.style.length) el.removeAttribute('style');
    }

    // Consume the latest pointer before stepping the spring on the same browser frame.
    function schedule() {
      frame ??= requestAnimationFrame(time => {
        frame = null;
        if (point && rect) {
          follower.setTarget(computeTiltTarget(point, rect, maxDeg),
            el?.dataset.spotlight === 'true' ? computeSpotlight(point, rect) : undefined);
          point = null;
        }
        const step = springStep;
        springStep = null;
        step?.(time);
        if (!rect && !follower.isMoving()) clear();
      });
      return frame;
    }

    const follower = createTiltFollower({
      liftPx,
      write: transform => { el.style.transform = transform || originalTransform || ''; },
      writeSpotlight: ({ x, y }) => {
        el.style.setProperty('--spotlight-x', x);
        el.style.setProperty('--spotlight-y', y);
        spotlightWritten = true;
      },
      requestFrame: cb => { springStep = cb; return schedule(); },
      cancelFrame: () => { springStep = null; },
    });

    const move = (event: PointerEvent) => {
      if (!rect || event.pointerType === 'touch') return;
      point = { x: event.clientX, y: event.clientY };
      schedule();
    };
    const enter = (event: PointerEvent) => {
      const env = readSheenFollowEnvironment();
      if (!canTilt(event.pointerType, env) || !window.matchMedia('(pointer: fine)').matches) {
        rect = point = null;
        follower.snapToRest();
        clear();
        return;
      }
      if (originalTransform === null) {
        originalTransform = el.style.transform;
        hadStyle = el.hasAttribute('style');
      }
      rect = el.getBoundingClientRect();
      el.dataset.tilt = 'active';
      move(event);
    };
    const leave = () => {
      if (!rect) return;
      rect = point = null;
      follower.setTarget(TILT_REST);
      if (!follower.isMoving()) clear();
    };
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => {
      if (rect) rect = el.getBoundingClientRect();
    });
    observer?.observe(el);
    el.addEventListener('pointerenter', enter);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerleave', leave);
    el.addEventListener('pointercancel', leave);
    el.addEventListener('blur', leave);
    return () => {
      observer?.disconnect();
      el.removeEventListener('pointerenter', enter);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerleave', leave);
      el.removeEventListener('pointercancel', leave);
      el.removeEventListener('blur', leave);
      follower.dispose();
      if (frame !== null) cancelAnimationFrame(frame);
      clear();
    };
  }, [ref, maxDeg, liftPx, disabled, enabled]);
}
