'use client';

import * as React from 'react';
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
 * The shelf that keeps the working set on the glass.
 *
 * The stage keeps only the diagnosis, the specimen, and the four readouts. Everything an
 * engineer reaches for second — bin distributions, capability panels, per-wafer stacks, raw
 * parametric tables — lives behind this one shelf, so the first screen stays a composition
 * instead of a ledger. It is a real disclosure: the trigger is a button with `aria-expanded`,
 * the panel is `hidden` while closed, and the open state is CSS-only so no chart remounts.
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
          'group/shelf flex w-full cursor-pointer items-center justify-between gap-4 border-t border-hairline bg-transparent py-4 text-left',
          'transition-opacity duration-[120ms] ease-[var(--ease-out)] hover:opacity-85',
          'focus-visible:shadow-focus-ring focus-visible:outline-none',
        )}
      >
        <span className="flex items-baseline gap-3">
          <span className="text-[15px] leading-[1.3] font-[500] tracking-[-0.01em] text-text-primary [font-family:var(--font-display)]">
            {label}
          </span>
          {count !== undefined ? (
            <span className="at-kpi-number text-[13px] text-text-tertiary">{count}</span>
          ) : null}
        </span>
        <span
          aria-hidden="true"
          className="relative flex size-6 shrink-0 items-center justify-center rounded-full shadow-[inset_0_0_0_1px_var(--hairline)]"
        >
          <span className="absolute h-px w-2.5 bg-text-secondary" />
          <span
            className={cn(
              'absolute h-px w-2.5 bg-text-secondary transition-[rotate] duration-[200ms] ease-[var(--ease-out)]',
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
          <div className="pb-6">{children}</div>
        </div>
      </div>
    </section>
  );
}
