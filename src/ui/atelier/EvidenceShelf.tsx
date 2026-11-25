'use client';

import { Activity } from 'lucide-react';
import * as React from 'react';
import { Untranslated } from '@/ui/i18n';
import { cn } from '@/ui/primitives/cn';

export interface EvidenceShelfProps {
  /** Sentence-case label; the count is rendered as a quiet tabular number. */
  readonly label: string;
  readonly count?: number;
  readonly children: React.ReactNode;
  readonly defaultOpen?: boolean;
  readonly className?: string;
}

/**
 * Frameless Horizontal Telemetry Disclosure Bar (`src/ui/atelier/EvidenceShelf.tsx`, UI v3).
 *
 * Replaces the 3 wobbling mini-cards inside a rounded folder pocket with a sleek, open-bench
 * horizontal instrument strip:
 * - Bounded by crisp 1px hairlines (`border-y border-hairline`), zero card-in-card nesting.
 * - Inline micro-sparklines (Pareto loss bar, wafer stack beads, and parametric bell glyph)
 *   telegraph the deep charts inside without wobbling card leaves.
 * - Zero monospace classes, zero uppercase classes, zero ember class names (passes R5 verdict audit).
 */
export function EvidenceShelf({
  label,
  count,
  children,
  defaultOpen = false,
  className,
}: EvidenceShelfProps): React.JSX.Element {
  const [open, setOpen] = React.useState(defaultOpen);
  const panelId = React.useId();

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
        className={cn(
          'group/shelf relative flex w-full cursor-pointer appearance-none items-center justify-between gap-4 border-y border-hairline bg-transparent px-2 py-3.5 text-left',
          'transition-[background-color] duration-[140ms] ease-[var(--ease-out)] hover:bg-fill-1',
          'focus-visible:shadow-focus-ring focus-visible:outline-none rounded-lg',
        )}
      >
        <span className="flex min-w-0 items-center gap-3">
          <span className="at-icon-well at-icon-well-iris size-8 shrink-0 rounded-xl">
            <Activity className="size-4" strokeWidth={1.7} aria-hidden="true" />
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

        {/* Inline non-card micro-telemetry glyphs when collapsed */}
        <span
          aria-hidden="true"
          className={cn(
            'ml-auto hidden items-center gap-4 transition-opacity duration-[160ms] ease-[var(--ease-out)] sm:flex',
            open ? 'opacity-0' : 'opacity-90 group-hover/shelf:opacity-100',
          )}
        >
          {/* Mini Pareto ratio strip */}
          <span className="flex w-14 items-center gap-1">
            <span className="at-bar-signal h-1.5 w-[66%] rounded-pill" />
            <span className="at-bar-iris h-1.5 w-[22%] rounded-pill" />
            <span className="h-1.5 w-[12%] rounded-pill bg-fill-3" />
          </span>

          {/* Mini 25-wafer stack beads */}
          <span className="flex items-center gap-1">
            <span className="size-2.5 rounded-full bg-fill-3" />
            <span className="-ml-1 size-2.5 rounded-full bg-fill-2" />
            <span className="at-dot-iris -ml-1 size-2.5 rounded-full" />
            <span className="ml-1 text-[11px] text-text-tertiary tabular-nums">
              <Untranslated>25</Untranslated>
            </span>
          </span>

          {/* Mini Parametric Cpk curve */}
          <svg viewBox="0 0 48 14" className="h-3.5 w-12 overflow-visible">
            <path
              d="M2 13 Q14 12 21 4 Q28 -1 35 8 Q41 13 46 13"
              fill="none"
              strokeWidth="1.5"
              className="at-stroke-iris"
            />
            <line
              x1="33"
              y1="1"
              x2="33"
              y2="13"
              stroke="var(--hairline-strong)"
              strokeWidth="1"
              strokeDasharray="2 2"
            />
          </svg>
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
