'use client';

import * as React from 'react';
import type { RenderedStatFactTuple } from '@/core/report';
import { cn } from '@/ui/primitives/cn';

export interface StatRowProps {
  readonly stats: RenderedStatFactTuple;
  readonly className?: string;
}

/**
 * Three-column big-number Stat Row (`src/ui/report/StatRow.tsx`, `redesign.md` §3.4, §3.6, §4.5):
 * - `<dl>` with exactly 3 `<div>` items (`168 px` cols + `24 px` gap at 553 px desktop; `111 px` cols + `12 px` gap mobile).
 * - Caption `<dt>` (`footnote` secondary, max 2 lines) precedes `<dd>` in DOM and sits visually
 *   below `<dd>` (`stat` 40 px / 300 weight, 6 px gap) via `flex-direction: column-reverse`.
 * - At most one key failure number is emphasized in `failure` orange (`#FF6B2C`); zero borders, cards, or icons.
 */
export function StatRow({
  stats,
  className,
}: StatRowProps): React.JSX.Element {
  return (
    <dl
      data-testid="verdict-stat-row"
      className={cn('grid grid-cols-3 gap-3 md:gap-6', className)}
    >
      {stats.map((stat, idx) => (
        <div
          key={idx}
          data-testid="verdict-stat-item"
          className="flex min-w-0 flex-col-reverse justify-end gap-1.5"
        >
          <dt className="line-clamp-2 type-footnote text-text-secondary">
            {stat.captionText}
          </dt>
          <dd
            data-testid="verdict-stat-value"
            data-emphasis={stat.emphasis ? 'true' : 'false'}
            className={cn(
              'type-stat',
              stat.emphasis ? 'text-failure' : 'text-text-primary',
            )}
          >
            {stat.valueText}
          </dd>
        </div>
      ))}
    </dl>
  );
}
