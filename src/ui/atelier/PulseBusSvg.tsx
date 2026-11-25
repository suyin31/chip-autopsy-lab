'use client';

import { motion } from 'motion/react';
import * as React from 'react';
import { useReducedMotionPreference } from '@/ui/motion/hooks';
import { SPRING_TACTILE } from '@/ui/motion/tokens';
import { cn } from '@/ui/primitives/cn';

/**
 * Frameless SVG Signal Bus & Byte-Stream Conduit (`src/ui/atelier/PulseBusSvg.tsx`).
 *
 * Replaces nested rounded status boxes with crisp schematic path-draw and travelling
 * packet pulses:
 * - `mesh`: 4-station horizontal specialist bus for `/agents` (`Orchestrator -> Evidence`).
 * - `bridge`: S-curve byte-stream conduit connecting the landing STDF drop slot to the
 *   forensic instrument deck (`FAR -> MIR -> PTR -> PRR`).
 * - Compositor-safe (`pathLength` draw once on mount + `transform`/`opacity` packet motion);
 *   collapses to a quiet static schematic line under `prefers-reduced-motion: reduce`.
 */

export interface PulseBusSvgProps {
  readonly variant: 'mesh' | 'bridge';
  /** Active specialist index `0..3` for `variant="mesh"`. */
  readonly activeIndex?: number;
  /** Accelerates/lights the signal pulse during live work or hover. */
  readonly active?: boolean;
  readonly className?: string;
  readonly 'data-testid'?: string;
}

const MESH_STATIONS_X = [80, 240, 400, 560] as const;

export function PulseBusSvg({
  variant,
  activeIndex = 0,
  active = false,
  className,
  'data-testid': testId,
}: PulseBusSvgProps): React.JSX.Element {
  const reduced = useReducedMotionPreference();

  if (variant === 'bridge') {
    return (
      <svg
        aria-hidden="true"
        data-testid={testId ?? 'pulse-bus-bridge'}
        viewBox="0 0 88 36"
        fill="none"
        className={cn('pointer-events-none select-none overflow-visible', className)}
      >
        <path
          d="M2 26 C 30 26, 48 10, 86 10"
          stroke="var(--hairline-strong)"
          strokeWidth="1.2"
        />
        <motion.path
          d="M2 26 C 30 26, 48 10, 86 10"
          strokeWidth="1.5"
          strokeLinecap="round"
          className={cn(
            active ? 'at-stroke-signal' : 'at-stroke-iris',
            !reduced && 'at-pulse-trace',
          )}
          initial={reduced ? false : { pathLength: 0, opacity: 0.3 }}
          animate={{ pathLength: 1, opacity: active ? 1 : 0.78 }}
          transition={
            reduced
              ? { duration: 0 }
              : { duration: 0.65, delay: 0.18, ease: [0.22, 1, 0.36, 1] }
          }
        />
        <circle cx="2" cy="26" r="2.2" className="at-leader-dot" />
        <circle cx="86" cy="10" r="2.5" className="at-leader-dot" />
      </svg>
    );
  }

  const clampedIdx = Math.max(0, Math.min(3, activeIndex));
  const targetX = MESH_STATIONS_X[clampedIdx]!;
  const activeRatio = (targetX - MESH_STATIONS_X[0]) / (MESH_STATIONS_X[3] - MESH_STATIONS_X[0]);

  return (
    <svg
      aria-hidden="true"
      data-testid={testId ?? 'pulse-bus-mesh'}
      viewBox="0 0 640 20"
      preserveAspectRatio="none"
      fill="none"
      className={cn('pointer-events-none h-5 w-full select-none overflow-visible', className)}
    >
      {/* Full-span datum track */}
      <line
        x1={MESH_STATIONS_X[0]}
        y1="10"
        x2={MESH_STATIONS_X[3]}
        y2="10"
        stroke="var(--hairline-strong)"
        strokeWidth="1.25"
      />

      {/* Illuminated segment from Orchestrator to focused specialist */}
      <motion.line
        x1={MESH_STATIONS_X[0]}
        y1="10"
        x2={MESH_STATIONS_X[3]}
        y2="10"
        strokeWidth="2"
        strokeLinecap="round"
        className={active ? 'at-stroke-signal' : 'at-stroke-iris'}
        initial={reduced ? false : { pathLength: 0 }}
        animate={{ pathLength: Math.max(0.04, activeRatio) }}
        transition={reduced ? { duration: 0 } : SPRING_TACTILE}
      />

      {/* Flowing pulse dashes across the mesh while an agent turn is running */}
      {active && !reduced ? (
        <line
          x1={MESH_STATIONS_X[0]}
          y1="10"
          x2={MESH_STATIONS_X[3]}
          y2="10"
          strokeWidth="1.75"
          className="at-stroke-signal at-pulse-trace"
        />
      ) : null}

      {/* Four schematic station ticks */}
      {MESH_STATIONS_X.map((x, idx) => (
        <circle
          key={x}
          cx={x}
          cy="10"
          r={idx === clampedIdx ? 3.5 : 2.2}
          fill={idx <= clampedIdx ? 'var(--chroma)' : 'var(--bg)'}
          stroke={idx <= clampedIdx ? 'var(--chroma)' : 'var(--hairline-strong)'}
          strokeWidth="1.5"
        />
      ))}
    </svg>
  );
}
