'use client';

import { animate, motion, useMotionValue } from 'motion/react';
import * as React from 'react';
import { useReducedMotionPreference } from './hooks';
import { shouldWaitForReveal } from './reveal';
import { SPRING_TOKENS } from './tokens';

export interface ScrollRevealOptions {
  readonly replayKey?: string | number;
  readonly offsetY?: number;
  readonly delayMs?: number;
  readonly disabled?: boolean;
  readonly rootMargin?: string;
  readonly threshold?: number;
}

function useReveal({
  replayKey = 0, offsetY = 10, delayMs = 0, disabled = false,
  rootMargin = '0px 0px -10% 0px', threshold = 0.01,
}: ScrollRevealOptions) {
  const [node, ref] = React.useState<HTMLElement | null>(null);
  const [revealed, setRevealed] = React.useState(true);
  const seen = React.useRef(new Set<string | number>());
  const reduced = useReducedMotionPreference();
  const opacity = useMotionValue(1);
  const y = useMotionValue(0);

  React.useLayoutEffect(() => {
    if (!node) return;
    opacity.jump(1);
    y.jump(0);
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
    const observer = new IntersectionObserver(entries => {
      if (!active || !entries.some(entry => entry.isIntersecting && entry.intersectionRatio >= threshold)) return;
      active = false;
      observer.unobserve(node);
      observer.disconnect();
      seen.current.add(replayKey);
      setRevealed(true);
      const transition = { ...SPRING_TOKENS.ui, delay: Math.max(0, delayMs) / 1000 };
      animate(opacity, 1, transition);
      animate(y, 0, transition);
    }, { rootMargin, threshold });
    setRevealed(false);
    opacity.jump(0);
    y.jump(offsetY);
    observer.observe(node);
    return () => {
      active = false;
      observer.disconnect();
      opacity.jump(1);
      y.jump(0);
    };
  }, [node, replayKey, offsetY, delayMs, disabled, rootMargin, threshold, reduced, opacity, y]);
  return { ref, revealed, opacity, y };
}

export function useScrollReveal(options: ScrollRevealOptions = {}): {
  readonly ref: React.RefCallback<HTMLElement>;
  readonly revealed: boolean;
} {
  const { ref, revealed } = useReveal(options);
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
  const { ref, opacity, y } = useReveal(options);
  const Element = motion[as];
  return <Element ref={ref} className={className} data-testid={testId} style={{ opacity, y }}>{children}</Element>;
}
