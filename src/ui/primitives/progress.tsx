import * as React from 'react';
import { cn } from './cn';

export interface ProgressProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Percentage in `[0, 100]`, or `null` when stream byte length is indeterminate (e.g. gzip). */
  readonly value: number | null;
  readonly label: string;
  /** Accessible status text announced for determinate or indeterminate progress (Req 14.4). */
  readonly valueText?: string;
}

/**
 * Accessible shadcn/ui-pattern `Progress` bar animating `transform: scaleX(...)`
 * and `opacity` only (`<= 200 ms`, Requirement 17.5).
 */
export function Progress({
  value,
  label,
  valueText,
  className,
  ...props
}: ProgressProps): React.JSX.Element {
  const isDeterminate = value !== null && Number.isFinite(value);
  const clamped = isDeterminate ? Math.min(100, Math.max(0, value)) : null;
  const scaleRatio = clamped !== null ? clamped / 100 : 0.35;

  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      {...(clamped !== null ? { 'aria-valuenow': Math.round(clamped) } : {})}
      {...(valueText !== undefined ? { 'aria-valuetext': valueText } : {})}
      className={cn(
        'relative h-2 w-full overflow-hidden rounded-control border border-hairline bg-raised shadow-none',
        className,
      )}
      {...props}
    >
      <div
        className={cn(
          'h-full w-full origin-left bg-accent transition-[transform,opacity] duration-150 ease-[var(--ease-clinical)]',
          !isDeterminate && 'opacity-75',
        )}
        style={{ transform: `scaleX(${scaleRatio.toFixed(4)})` }}
      />
    </div>
  );
}
