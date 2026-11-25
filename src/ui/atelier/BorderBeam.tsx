'use client';

import { AnimatePresence, motion } from 'motion/react';
import * as React from 'react';
import { useReducedMotionPreference } from '@/ui/motion/hooks';
import { MOTION_TOKENS } from '@/ui/tokens';

/**
 * Optical probe beam(s) travelling the edge of a parent container.
 * Clean-room implementation inspired by Magic UI `BorderBeam` (MIT): one or two
 * counter-phased comets ride `offset-path: rect(...)` inside a masked sub-pixel ring.
 *
 * - Mounted only while `active`; fades in 240 ms and out 160 ms.
 * - `dual` adds a second opposite-phase iris comet so static frames and active drags
 *   always catch balanced optical highlights on two sides of the chamber.
 * - Reduced motion: renders nothing; parent keeps its static rim.
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
  /** Renders a second opposite-phase chroma comet on the same track. */
  readonly dual?: boolean;
  readonly className?: string;
  readonly 'data-testid'?: string;
}

export function BorderBeam({
  active,
  radius = 20,
  size = 96,
  durationS = 4.2,
  tone = 'signal',
  width = 1.5,
  dual = false,
  className,
  'data-testid': testId,
}: BorderBeamProps): React.JSX.Element {
  const reduced = useReducedMotionPreference();
  const show = active && !reduced;
  const path = `rect(0 auto auto 0 round ${radius}px)`;

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
              offsetPath: path,
            }}
            initial={{ offsetDistance: '0%' }}
            animate={{ offsetDistance: '100%' }}
            transition={{ duration: durationS, ease: 'linear', repeat: Infinity }}
          />
          {dual ? (
            <motion.span
              className="at-beam-spark at-beam-spark-iris"
              style={{
                width: Math.round(size * 0.85),
                offsetPath: path,
              }}
              initial={{ offsetDistance: '50%' }}
              animate={{ offsetDistance: '150%' }}
              transition={{ duration: durationS, ease: 'linear', repeat: Infinity }}
            />
          ) : null}
        </motion.span>
      ) : null}
    </AnimatePresence>
  );
}
