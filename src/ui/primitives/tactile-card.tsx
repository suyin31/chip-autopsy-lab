'use client';

import * as React from 'react';
import { useTactileTilt } from '../motion/use-tactile-tilt';
import { cn } from './cn';

export interface TactileCardProps extends React.HTMLAttributes<HTMLDivElement> {
  readonly tilt?: boolean;
  readonly spotlight?: boolean;
  readonly maxDeg?: number;
}

export const TactileCard = React.forwardRef<HTMLDivElement, TactileCardProps>(
  function TactileCard({ tilt = true, spotlight = true, maxDeg, className, ...props }, forwardedRef) {
    const ref = React.useRef<HTMLDivElement>(null);
    React.useImperativeHandle(forwardedRef, () => ref.current as HTMLDivElement, []);
    useTactileTilt(ref, { enabled: tilt, maxDeg });
    return <div {...props} ref={ref} className={cn('cal-tactile', className)}
      data-tactile="" data-spotlight={spotlight ? 'true' : undefined} />;
  },
);
