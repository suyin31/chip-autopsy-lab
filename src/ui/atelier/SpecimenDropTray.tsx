'use client';

import * as React from 'react';
import { Untranslated } from '@/ui/i18n';
import { cn } from '@/ui/primitives/cn';
import { BorderBeam } from './BorderBeam';
import { useProximityRim } from './ProximityPlate';

/**
 * Specimen drop tray: frosted glass outer plate (`r-[28px]`, `p-2`) framing a deep
 * recessed `.at-obsidian-well` (`r-[20px]`, concentric) with corner datum crosshairs,
 * dual optical probe beams when armed, and optional 3D format micro-keycaps.
 */
export interface SpecimenDropTrayProps {
  readonly variant?: 'inline' | 'overlay';
  readonly armed?: boolean;
  readonly showFormatCaps?: boolean;
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
          className={cn('pointer-events-none absolute z-[2]', position)}
        >
          <path d="M4.5 0.5v8M0.5 4.5h8" className="at-datum" strokeWidth={1} fill="none" />
        </svg>
      ))}
    </>
  );
}

/**
 * Circular specimen seat: a round instrument well with orthogonal datum marks at 12, 3, 6, and 9 o'clock.
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
      className={cn(
        'at-well relative inline-flex shrink-0 items-center justify-center rounded-full',
        className,
      )}
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

export function FormatKeycaps({ className }: { readonly className?: string }): React.JSX.Element {
  return (
    <span aria-hidden="true" className={cn('inline-flex items-center gap-1.5', className)}>
      {(['.STDF', '.STD', '.GZ'] as const).map((ext) => (
        <Untranslated key={ext} className="at-keycap-badge">
          {ext}
        </Untranslated>
      ))}
    </span>
  );
}

export function SpecimenDropTray({
  variant = 'inline',
  armed = false,
  showFormatCaps = false,
  className,
  wellClassName,
  children,
  'data-testid': testId,
}: SpecimenDropTrayProps): React.JSX.Element {
  const plateRef = React.useRef<HTMLDivElement | null>(null);
  useProximityRim(plateRef, { disabled: true, reachPx: 200 });

  if (variant === 'inline') {
    return (
      <div
        ref={plateRef}
        data-testid={testId}
        data-variant={variant}
        data-armed={armed ? 'true' : undefined}
        data-texture="dots"
        className={cn(
          'at-obsidian-well relative overflow-hidden rounded-[20px]',
          className,
          wellClassName,
        )}
      >
        <DatumTicks />
        <BorderBeam
          active={armed}
          dual
          radius={20}
          size={104}
          width={1.5}
          durationS={3.8}
        />
        {children}
        {showFormatCaps ? (
          <FormatKeycaps className="pointer-events-none absolute bottom-3.5 left-1/2 z-[2] -translate-x-1/2" />
        ) : null}
      </div>
    );
  }

  return (
    <div
      ref={plateRef}
      data-testid={testId}
      data-variant={variant}
      data-armed={armed ? 'true' : undefined}
      className={cn('at-float-card rounded-[28px] p-2', className)}
    >
      <div
        data-texture="dots"
        className={cn('at-obsidian-well relative overflow-hidden rounded-[20px]', wellClassName)}
      >
        <DatumTicks />
        <BorderBeam
          active={armed}
          dual
          radius={20}
          size={140}
          width={1.5}
          durationS={3.2}
        />
        {children}
        {showFormatCaps ? (
          <FormatKeycaps className="pointer-events-none absolute bottom-3.5 left-1/2 z-[2] -translate-x-1/2" />
        ) : null}
      </div>
    </div>
  );
}
