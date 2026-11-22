'use client';

import {
  animate,
  type AnimationPlaybackControls,
  motion,
  useMotionValue,
} from 'motion/react';
import * as React from 'react';
import { useReducedMotionPreference } from './hooks';
import { shouldWaitForReveal } from './reveal';
import {
  MOTION_TOKENS,
  PANEL_ENTER_MS,
  PANEL_ENTER_OFFSET_Y_PX,
  PANEL_ENTER_SCALE,
} from './tokens';

export interface ScrollRevealOptions {
  readonly replayKey?: string | number;
  readonly offsetY?: number;
  readonly scaleFrom?: number;
  readonly delayMs?: number;
  readonly disabled?: boolean;
  readonly rootMargin?: string;
  readonly threshold?: number;
}

function useReveal(
  {
    replayKey = 0,
    offsetY = PANEL_ENTER_OFFSET_Y_PX,
    scaleFrom = PANEL_ENTER_SCALE,
    delayMs = 0,
    disabled = false,
    rootMargin = '0px 0px -10% 0px',
    threshold = 0.01,
  }: ScrollRevealOptions,
  driveVisual: boolean,
) {
  const [node, ref] = React.useState<HTMLElement | null>(null);
  const [revealed, setRevealed] = React.useState(true);
  const seen = React.useRef(new Set<string | number>());
  const reduced = useReducedMotionPreference();
  const opacity = useMotionValue(1);
  const y = useMotionValue(0);
  const scale = useMotionValue(1);

  React.useLayoutEffect(() => {
    if (!node) return;
    if (driveVisual) {
      opacity.jump(1);
      y.jump(0);
      scale.jump(1);
    }
    if (!shouldWaitForReveal({
      top: node.getBoundingClientRect().top, viewportHeight: window.innerHeight,
      alreadyRevealed: seen.current.has(replayKey), disabled: disabled || reduced,
      canObserve: typeof IntersectionObserver === 'function',
    })) {
      seen.current.add(replayKey);
      setRevealed(true);
      return;
    }
    let active = true;
    let controls: AnimationPlaybackControls[] = [];
    const observer = new IntersectionObserver(entries => {
      if (!active || !entries.some(entry => entry.isIntersecting && entry.intersectionRatio >= threshold)) return;
      active = false;
      observer.unobserve(node);
      observer.disconnect();
      seen.current.add(replayKey);
      setRevealed(true);
      if (driveVisual) {
        const transition = {
          duration: PANEL_ENTER_MS / 1000,
          ease: MOTION_TOKENS.easeOutTuple,
          delay: Math.max(0, delayMs) / 1000,
        };
        controls = [
          animate(opacity, 1, transition),
          animate(y, 0, transition),
          animate(scale, 1, transition),
        ];
      }
    }, { rootMargin, threshold });
    setRevealed(false);
    if (driveVisual) {
      opacity.jump(0);
      y.jump(offsetY);
      scale.jump(scaleFrom);
    }
    observer.observe(node);
    return () => {
      active = false;
      observer.disconnect();
      for (const control of controls) {
        control.stop();
      }
      controls = [];
      if (driveVisual) {
        opacity.jump(1);
        y.jump(0);
        scale.jump(1);
      }
    };
  }, [
    node,
    replayKey,
    offsetY,
    scaleFrom,
    delayMs,
    disabled,
    rootMargin,
    threshold,
    reduced,
    driveVisual,
    opacity,
    y,
    scale,
  ]);
  return { ref, revealed, opacity, y, scale };
}

export function useScrollReveal(options: ScrollRevealOptions = {}): {
  readonly ref: React.RefCallback<HTMLElement>;
  readonly revealed: boolean;
} {
  const { ref, revealed } = useReveal(options, false);
  return { ref, revealed };
}

export interface ScrollRevealProps extends ScrollRevealOptions {
  readonly children: React.ReactNode;
  readonly className?: string;
  readonly as?: 'div' | 'section';
  readonly 'data-testid'?: string;
}

export function ScrollReveal({
  as = 'div', children, className, 'data-testid': testId, ...options
}: ScrollRevealProps): React.JSX.Element {
  const { ref, opacity, y, scale } = useReveal(options, true);
  const Element = motion[as];
  return (
    <Element
      ref={ref}
      className={className}
      data-testid={testId}
      style={{ opacity, y, scale }}
    >
      {children}
    </Element>
  );
}
