'use client';

import { cn } from './cn';

export function AnimatedCheckmark({ animate = false, className }: {
  readonly animate?: boolean;
  readonly className?: string;
}): React.JSX.Element {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true"
      className={cn(animate && 'cal-check-draw', className)}>
      <path d="m2 7 3.25 3.25L12 3.5" stroke="currentColor" strokeWidth="1.6"
        strokeLinecap="round" strokeLinejoin="round" pathLength="1" strokeDasharray="1" />
    </svg>
  );
}
