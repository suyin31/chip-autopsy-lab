import * as React from 'react';
import { cn } from './cn';

export type BadgeVariant = 'neutral' | 'accent' | 'failure';

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  readonly variant?: BadgeVariant;
}

const BADGE_VARIANTS: Readonly<Record<BadgeVariant, string>> = {
  neutral: 'border-hairline bg-raised text-text-secondary',
  accent: 'border-accent bg-raised text-accent',
  failure: 'border-failure bg-raised text-failure',
};

export function Badge({
  className,
  variant = 'neutral',
  ...props
}: BadgeProps): React.JSX.Element {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-control border px-2 py-0.5 font-mono text-[12px] leading-tight font-normal tabular-nums shadow-none',
        BADGE_VARIANTS[variant],
        className,
      )}
      {...props}
    />
  );
}
