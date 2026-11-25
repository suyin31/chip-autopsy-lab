'use client';

import { animate, stagger } from 'motion/react';
import * as React from 'react';
import { useReducedMotionPreference } from '@/ui/motion/hooks';
import { hasSeenSessionReveal, markSessionRevealSeen } from '@/ui/motion/reveal';
import { cn } from './cn';

/**
 * Word-by-word text reveal (UI v2 §4 row 7). Ported in spirit from Motion Primitives
 * `TextEffect` (MIT) and reduced to the one preset this product uses.
 *
 * - The server renders the complete text with no hidden inline styles (SEO, SSR tests, no-JS).
 * - On mount the client plays one pass: each word rises 14 px and sharpens from a 6 px blur,
 *   45 ms apart. Words keep their spaces, so wrapping matches the static text exactly.
 * - `sessionKey` makes it once per session (stored in `sessionStorage`); after that, and under
 *   reduced motion, the text simply stays as rendered.
 * - Children that are not plain strings (an accent word element) count as one word.
 */

const WORD_STAGGER_S = 0.045;
const WORD_DURATION_S = 0.62;
const WORD_EASE = [0.22, 1, 0.36, 1] as const;

export interface TextRevealProps {
  readonly children: React.ReactNode;
  readonly as?: 'span' | 'h1' | 'h2' | 'p' | 'div';
  readonly className?: string;
  /** Delay before the first word, in seconds. */
  readonly delay?: number;
  /** `sessionStorage` key that limits the reveal to once per session. */
  readonly sessionKey?: string;
}

function splitWords(node: React.ReactNode, out: React.ReactNode[]): void {
  React.Children.forEach(node, (child) => {
    if (typeof child === 'string' || typeof child === 'number') {
      const parts = String(child).split(/(\s+)/);
      for (const part of parts) {
        if (part.length === 0) continue;
        out.push(/^\s+$/.test(part) ? part : <WordSpan key={out.length}>{part}</WordSpan>);
      }
      return;
    }
    if (child === null || child === undefined || typeof child === 'boolean') return;
    out.push(<WordSpan key={out.length}>{child}</WordSpan>);
  });
}

function WordSpan({ children }: { readonly children: React.ReactNode }): React.JSX.Element {
  return (
    <span data-reveal-word="" className="inline-block">
      {children}
    </span>
  );
}

export function TextReveal({
  children,
  as = 'span',
  className,
  delay = 0.08,
  sessionKey,
}: TextRevealProps): React.JSX.Element {
  const reduced = useReducedMotionPreference();
  const rootRef = React.useRef<HTMLElement | null>(null);
  const playedRef = React.useRef(false);

  React.useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root || playedRef.current || reduced) return;
    if (sessionKey !== undefined && hasSeenSessionReveal(sessionKey)) return;
    playedRef.current = true;
    if (sessionKey !== undefined) markSessionRevealSeen(sessionKey);
    const words = Array.from(root.querySelectorAll<HTMLElement>('[data-reveal-word]'));
    if (words.length === 0) return;
    const controls = animate(
      words,
      { opacity: [0, 1], y: [14, 0], filter: ['blur(6px)', 'blur(0px)'] },
      { duration: WORD_DURATION_S, ease: WORD_EASE, delay: stagger(WORD_STAGGER_S, { startDelay: delay }) },
    );
    return () => {
      controls.complete();
    };
  }, [delay, reduced, sessionKey]);

  const words: React.ReactNode[] = [];
  splitWords(children, words);
  const Tag = as as React.ElementType;
  return (
    <Tag ref={rootRef} className={cn(className)}>
      {words}
    </Tag>
  );
}
