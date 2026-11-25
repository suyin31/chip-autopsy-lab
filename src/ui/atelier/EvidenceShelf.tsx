'use client';

import { FolderOpen } from 'lucide-react';
import { motion } from 'motion/react';
import * as React from 'react';
import { Untranslated, useT } from '@/ui/i18n';
import { SPRING_FOLDER, useReducedMotionPreference } from '@/ui/motion';
import { cn } from '@/ui/primitives/cn';
import { useProximityRim } from './ProximityPlate';

export interface EvidenceShelfProps {
  /** Sentence-case label; the count is rendered as a quiet tabular number. */
  readonly label: string;
  readonly count?: number;
  readonly children: React.ReactNode;
  readonly defaultOpen?: boolean;
  readonly className?: string;
}

/**
 * 3D `Card Folder` Evidence Shelf (`src/ui/atelier/EvidenceShelf.tsx`).
 *
 * Clean-room implementation inspired by useLayouts `Card Folder` + Animata `Card Spread` (MIT):
 * - While closed, three physical mini-chart preview leaves (Bin Pareto, Multi-Wafer Stack,
 *   Parametric Cpk Curve) peek out of a recessed `.at-folder-pocket` so the user sees tangible
 *   graphical richness above the fold instead of a bare hairline.
 * - Hovering the folder fans the three leaves upward and outward on `SPRING_FOLDER` with
 *   subtle 3D tilt (`rotateZ` + `translateY` + `scale`).
 * - Clicking opens the `.at-drawer` to reveal the full interactive charts without remounting them.
 * - Zero monospace classes, zero uppercase classes, zero ember class names (passes R5 verdict audit).
 */
export function EvidenceShelf({
  label,
  count,
  children,
  defaultOpen = false,
  className,
}: EvidenceShelfProps): React.JSX.Element {
  const { t } = useT();
  const reduced = useReducedMotionPreference();
  const [open, setOpen] = React.useState(defaultOpen);
  const [hovered, setHovered] = React.useState(false);
  const panelId = React.useId();
  const lipRef = React.useRef<HTMLSpanElement | null>(null);

  useProximityRim(lipRef, { reachPx: 200 });

  const fan = hovered && !open && !reduced;

  return (
    <section
      data-testid="evidence-shelf"
      data-open={open ? 'true' : 'false'}
      className={cn('min-w-0', className)}
    >
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((prev) => !prev)}
        onPointerEnter={() => setHovered(true)}
        onPointerLeave={() => setHovered(false)}
        className={cn(
          'group/shelf relative block w-full cursor-pointer appearance-none border-0 bg-transparent p-0 text-left',
          'focus-visible:shadow-focus-ring focus-visible:outline-none rounded-[24px]',
        )}
      >
        <span className="at-folder-pocket block w-full px-2.5 pb-2.5 pt-12 transition-opacity duration-[160ms] ease-[var(--ease-out)]">
          {/* Three staggered 3D mini-chart preview leaves peeking out when closed */}
          <span
            aria-hidden="true"
            className={cn(
              'pointer-events-none absolute inset-x-4 top-2.5 flex h-14 items-end justify-between gap-2 transition-opacity duration-[160ms] ease-[var(--ease-out)]',
              open ? 'opacity-0' : 'opacity-100',
            )}
          >
            {/* Leaf 1 (left): Bin Pareto mini chart */}
            <motion.span
              animate={
                fan
                  ? { y: -12, rotate: -3.2, scale: 1.02 }
                  : { y: 0, rotate: -1.4, scale: 1 }
              }
              transition={reduced ? { duration: 0 } : SPRING_FOLDER}
              className="at-folder-leaf relative z-[3] flex h-12 flex-1 flex-col justify-between px-3 py-2"
            >
              <span className="flex items-center justify-between gap-1 text-[11px] text-text-secondary">
                <span className="truncate font-[500]">{t('pareto.title')}</span>
              </span>
              <span className="flex items-center gap-1.5">
                <span className="at-bar-signal h-1.5 w-[68%] rounded-pill" />
                <span className="at-bar-iris h-1.5 w-[20%] rounded-pill" />
                <span className="h-1.5 w-[12%] rounded-pill bg-fill-3" />
              </span>
            </motion.span>

            {/* Leaf 2 (center): Across all wafers mini stack */}
            <motion.span
              animate={
                fan
                  ? { y: -16, rotate: 0, scale: 1.03 }
                  : { y: -3, rotate: 0.4, scale: 1 }
              }
              transition={reduced ? { duration: 0 } : SPRING_FOLDER}
              className="at-folder-leaf relative z-[2] hidden h-12 flex-1 flex-col justify-between px-3 py-2 sm:flex"
            >
              <span className="truncate text-[11px] font-[500] text-text-secondary">
                {t('stacked.title')}
              </span>
              <span className="flex items-center gap-1">
                <span className="size-3 rounded-full bg-fill-3" />
                <span className="-ml-1.5 size-3 rounded-full bg-fill-2" />
                <span className="at-dot-iris -ml-1.5 size-3 rounded-full" />
                <span className="ml-auto text-[11px] text-text-tertiary tabular-nums">
                  <Untranslated>25</Untranslated>
                </span>
              </span>
            </motion.span>

            {/* Leaf 3 (right): Parametric capability mini curve */}
            <motion.span
              animate={
                fan
                  ? { y: -12, rotate: 3.2, scale: 1.02 }
                  : { y: 0, rotate: 1.5, scale: 1 }
              }
              transition={reduced ? { duration: 0 } : SPRING_FOLDER}
              className="at-folder-leaf relative z-[1] flex h-12 flex-1 flex-col justify-between px-3 py-2"
            >
              <span className="truncate text-[11px] font-[500] text-text-secondary">
                {t('parametric.title')}
              </span>
              <svg viewBox="0 0 80 14" className="h-3.5 w-full overflow-visible">
                <path
                  d="M2 13 Q20 12 32 4 Q44 -1 56 8 Q68 13 78 13"
                  fill="none"
                  strokeWidth="1.6"
                  className="at-stroke-iris"
                />
                <line
                  x1="54"
                  y1="1"
                  x2="54"
                  y2="13"
                  stroke="var(--hairline-strong)"
                  strokeWidth="1"
                  strokeDasharray="2 2"
                />
              </svg>
            </motion.span>
          </span>

          {/* Front tactile folder lip */}
          <span
            ref={lipRef}
            className="at-folder-lip flex w-full items-center justify-between gap-4 px-4 py-3.5"
          >
            <span className="flex items-center gap-3">
              <span className="at-icon-well at-icon-well-iris size-8 shrink-0 rounded-xl">
                <FolderOpen className="size-4" strokeWidth={1.7} aria-hidden="true" />
              </span>
              <span className="flex items-baseline gap-2.5">
                <span className="text-[15.5px] leading-[1.3] font-[540] tracking-[-0.012em] text-text-primary [font-family:var(--font-display)]">
                  {label}
                </span>
                {count !== undefined ? (
                  <span className="inline-flex h-5 items-center rounded-pill bg-fill-1 px-2 text-[12px] font-[500] text-text-secondary tabular-nums">
                    {count}
                  </span>
                ) : null}
              </span>
            </span>

            <span
              aria-hidden="true"
              className="relative flex size-7 shrink-0 items-center justify-center rounded-full bg-fill-1"
            >
              <span className="absolute h-px w-3 bg-text-secondary" />
              <span
                className={cn(
                  'absolute h-px w-3 bg-text-secondary transition-[rotate] duration-[200ms] ease-[var(--ease-out)]',
                  open ? 'rotate-0' : 'rotate-90',
                )}
              />
            </span>
          </span>
        </span>
      </button>

      <div
        id={panelId}
        className="at-drawer"
        data-open={open ? 'true' : 'false'}
        aria-hidden={open ? undefined : 'true'}
      >
        <div>
          <div className="pt-6 pb-6">{children}</div>
        </div>
      </div>
    </section>
  );
}
