'use client';

import { AnimatePresence, motion } from 'motion/react';
import * as React from 'react';
import { useReducedMotionPreference } from '@/ui/motion/hooks';
import { MOTION_TOKENS } from '@/ui/tokens';

/**
 * One optical probe beam travelling the edge of its parent (UI plan §4 A, replaces the old
 * rainbow `.at-beam`). Clean-room take on Magic UI `BorderBeam` (MIT): a short comet of a
 * single hue rides `offset-path: rect(...)` inside a 1 px masked ring.
 *
 * - Mounted only while `active` (drag hover, parsing, an agent run); it fades in 240 ms and out
 *   160 ms, so the page is silent at rest.
 * - `tone="signal"` uses the accent (`--ember`, resolved in `atelier.css`); `neutral` uses ink.
 * - Reduced motion: nothing renders; the parent keeps its static hairline.
 * - The parent must be `position: relative` and carry the border radius.
 */
export interface BorderBeamProps {
  readonly active: boolean;
  /** Corner radius of the parent in px; the beam path follows it. */
  readonly radius?: number;
  /** Length of the comet in px. */
  readonly size?: number;
  /** Seconds per lap. */
  readonly durationS?: number;
  readonly tone?: 'signal' | 'neutral';
  /** Ring thickness in px. */
  readonly width?: number;
  readonly className?: string;
  readonly 'data-testid'?: string;
}

export function BorderBeam({
  active,
  radius = 20,
  size = 72,
  durationS = 4.6,
  tone = 'signal',
  width = 1,
  className,
  'data-testid': testId,
}: BorderBeamProps): React.JSX.Element {
  const reduced = useReducedMotionPreference();
  const show = active && !reduced;

  return (
    <AnimatePresence initial={false}>
      {show ? (
        <motion.span
          key="beam"
          aria-hidden="true"
          data-testid={testId}
          data-tone={tone}
          className={className ? `at-beam-frame ${className}` : 'at-beam-frame'}
          style={{ '--beam-width': `${width}px` } as React.CSSProperties}
          initial={{ opacity: 0 }}
          animate={{
            opacity: 1,
            transition: { duration: MOTION_TOKENS.dur3Ms / 1000, ease: MOTION_TOKENS.easeOutTuple },
          }}
          exit={{
            opacity: 0,
            transition: { duration: MOTION_TOKENS.dur2Ms / 1000, ease: MOTION_TOKENS.easeOutTuple },
          }}
        >
          <motion.span
            className="at-beam-spark"
            style={{
              width: size,
              offsetPath: `rect(0 auto auto 0 round ${radius}px)`,
            }}
            initial={{ offsetDistance: '0%' }}
            animate={{ offsetDistance: '100%' }}
            transition={{ duration: durationS, ease: 'linear', repeat: Infinity }}
          />
        </motion.span>
      ) : null}
    </AnimatePresence>
  );
}
