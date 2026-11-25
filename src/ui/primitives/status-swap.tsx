'use client';

import { AnimatePresence, motion } from 'motion/react';
import * as React from 'react';
import { useReducedMotionPreference } from '@/ui/motion/hooks';
import { MOTION_TOKENS, SPRING_TOKENS } from '@/ui/tokens';
import { cn } from './cn';

/**
 * Vertical status flip for button labels (UI plan §4 C; idea from Animata `Status Button`, MIT,
 * written fresh). The outgoing label rises 10 px and fades while the incoming one arrives from
 * 10 px below, both inside a clipped cell, so the change reads as one mechanical flip.
 *
 * - Width is reserved by every state at once (invisible copies stacked in the same grid cell),
 *   so neighbours never shift when the label changes.
 * - `initial={false}`: the first state renders settled; only changes animate.
 * - Reduced motion: opacity only, 120 ms.
 */
export interface StatusSwapProps<K extends string> {
  readonly value: K;
  readonly states: Readonly<Record<K, React.ReactNode>>;
  readonly className?: string;
}

const SHIFT_PX = 10;

export function StatusSwap<K extends string>({
  value,
  states,
  className,
}: StatusSwapProps<K>): React.JSX.Element {
  const reduced = useReducedMotionPreference();
  const keys = Object.keys(states) as K[];
  const fade = { duration: MOTION_TOKENS.dur1Ms / 1000, ease: 'linear' } as const;

  return (
    <span className={cn('relative inline-grid overflow-hidden', className)}>
      {keys.map((key) => (
        <span
          key={`reserve-${key}`}
          aria-hidden="true"
          className="invisible col-start-1 row-start-1 inline-flex items-center justify-center gap-1"
        >
          {states[key]}
        </span>
      ))}
      <AnimatePresence initial={false}>
        <motion.span
          key={value}
          data-status={value}
          className="col-start-1 row-start-1 inline-flex items-center justify-center gap-1"
          initial={reduced ? { opacity: 0 } : { opacity: 0, y: SHIFT_PX }}
          animate={{
            opacity: 1,
            y: 0,
            transition: reduced ? fade : SPRING_TOKENS.snappy,
          }}
          exit={
            reduced
              ? { opacity: 0, transition: fade }
              : {
                  opacity: 0,
                  y: -SHIFT_PX,
                  transition: { duration: MOTION_TOKENS.dur2Ms / 1000, ease: MOTION_TOKENS.easeOutTuple },
                }
          }
        >
          {states[value]}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}
