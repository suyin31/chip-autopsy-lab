'use client';

import * as React from 'react';
import { cn } from '@/ui/primitives/cn';
import { BorderBeam } from './BorderBeam';
import { useProximityRim } from './ProximityPlate';

/**
 * Specimen drop tray (UI plan §4 A, surprise #1): the place a wafer log goes. A machined plate
 * (`r-3xl` 28, padding 8) holds a well cut into it (`r-xl` 20 = 28 - 8, concentric), marked at
 * the four corners with 1 px datum crosshairs instead of a dashed box. The beam runs the well's
 * edge only while a file is actually over the window.
 *
 * Purely visual: file input and window-level drop handling stay with their owners
 * (`EmptyStateCard`, `FullWindowDropZone`), so their contracts and tests are unchanged.
 */
export interface SpecimenDropTrayProps {
  /** `inline`: the compact slot on the landing. `overlay`: the large tray shown while dragging. */
  readonly variant?: 'inline' | 'overlay';
  /** A file is hovering: lights the probe beam along the well edge. */
  readonly armed?: boolean;
  readonly className?: string;
  readonly wellClassName?: string;
  readonly children?: React.ReactNode;
  readonly 'data-testid'?: string;
}

const CORNERS = [
  'top-2.5 left-2.5',
  'top-2.5 right-2.5',
  'bottom-2.5 left-2.5',
  'bottom-2.5 right-2.5',
] as const;

/** Four 8 px, 1 px crosshairs just inside the well's corners. */
export function DatumTicks(): React.JSX.Element {
  return (
    <>
      {CORNERS.map((position) => (
        <svg
          key={position}
          aria-hidden="true"
          width="9"
          height="9"
          viewBox="0 0 9 9"
          className={cn('pointer-events-none absolute', position)}
        >
          <path d="M4.5 0.5v8M0.5 4.5h8" className="at-datum" strokeWidth={1} fill="none" />
        </svg>
      ))}
    </>
  );
}

/**
 * Circular specimen seat: a second, round well with notch marks at 12, 3, 6, and 9 o'clock,
 * the same orthogonal datums an inspection chuck carries.
 */
export function SpecimenSeat({
  size,
  className,
  children,
}: {
  readonly size: number;
  readonly className?: string;
  readonly children?: React.ReactNode;
}): React.JSX.Element {
  const r = size / 2;
  const notch = Math.max(4, Math.round(size * 0.05));
  return (
    <span
      aria-hidden="true"
      className={cn('at-well relative inline-flex shrink-0 items-center justify-center rounded-full', className)}
      style={{ width: size, height: size }}
    >
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        className="pointer-events-none absolute inset-0 overflow-visible"
      >
        <path
          d={`M${r} 1v${notch}M${r} ${size - 1}v-${notch}M1 ${r}h${notch}M${size - 1} ${r}h-${notch}`}
          className="at-datum"
          strokeWidth={1}
          fill="none"
        />
      </svg>
      {children}
    </span>
  );
}

export function SpecimenDropTray({
  variant = 'inline',
  armed = false,
  className,
  wellClassName,
  children,
  'data-testid': testId,
}: SpecimenDropTrayProps): React.JSX.Element {
  const plateRef = React.useRef<HTMLDivElement | null>(null);
  useProximityRim(plateRef, { disabled: variant !== 'inline' });
  return (
    <div
      ref={plateRef}
      data-testid={testId}
      data-variant={variant}
      data-armed={armed ? 'true' : undefined}
      className={cn('at-optic rounded-[28px] p-2', className)}
    >
      <div className={cn('at-well relative rounded-[20px]', wellClassName)}>
        <DatumTicks />
        <BorderBeam active={armed} radius={20} size={96} durationS={3.8} />
        {children}
      </div>
    </div>
  );
}
