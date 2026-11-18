'use client';

import * as React from 'react';
import { Toaster, type ToasterProps } from 'sonner';
import { cn } from './cn';

export const SONNER_TOAST_OPTIONS = {
  position: 'bottom-center',
  visibleToasts: 3,
  gap: 8,
  duration: 4_000,
  offset: 24,
  mobileOffset: 16,
  classNames: {
    toast:
      'surface-material flex w-[360px] max-w-[calc(100vw-2rem)] items-start gap-3 rounded-md px-4 py-3 text-text-primary shadow-none',
    content: 'flex min-w-0 flex-1 flex-col gap-0.5',
    title: 'type-callout text-text-primary',
    description: 'type-footnote text-text-secondary tabular-nums',
    actionButton:
      'shrink-0 cursor-pointer self-center rounded-pill bg-transparent px-2 py-1 type-control text-text-secondary shadow-none transition-colors duration-[120ms] ease-[var(--ease-out)] hover:text-text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
    cancelButton:
      'shrink-0 cursor-pointer self-center rounded-pill bg-transparent px-2 py-1 type-control text-text-tertiary shadow-none transition-colors duration-[120ms] ease-[var(--ease-out)] hover:text-text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
    closeButton:
      'cursor-pointer rounded-pill bg-surface-2 px-1.5 py-0.5 type-caption text-text-secondary shadow-none transition-colors duration-[120ms] ease-[var(--ease-out)] hover:text-text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
    icon: 'mt-0.5 shrink-0 text-text-secondary',
  },
} as const;

/**
 * Owned Sonner toast host implementing `redesign.md` §4.13:
 * - Bottom-centre, `24 px` offset (`16 px` + safe-area inset on mobile), `z: 70` (`--z-toasts`)
 * - Max width `360 px`, `surface-material`, `16 px` radius (`rounded-md`), `12 x 16 px` padding
 * - `callout` primary title + optional `footnote` secondary body + right text action
 * - Max `3` visible stacked with `8 px` gap, `4 s` default duration (errors/warnings persist when specified)
 * - Motion (`.cal-toaster` rules in `globals.css`): enter `y 16 -> 0` + fade on `spring-ui`,
 *   exit fade + `y -> 8` in `160 ms`; reduced motion fades opacity only in `120 ms`
 */
export function ClinicalToaster({
  className,
  ...props
}: ToasterProps): React.JSX.Element {
  return (
    <Toaster
      theme="dark"
      position={SONNER_TOAST_OPTIONS.position}
      visibleToasts={SONNER_TOAST_OPTIONS.visibleToasts}
      gap={SONNER_TOAST_OPTIONS.gap}
      offset={SONNER_TOAST_OPTIONS.offset}
      mobileOffset={SONNER_TOAST_OPTIONS.mobileOffset}
      className={cn('cal-toaster z-[var(--z-toasts)] shadow-none', className)}
      toastOptions={{
        unstyled: true,
        duration: SONNER_TOAST_OPTIONS.duration,
        classNames: { ...SONNER_TOAST_OPTIONS.classNames },
      }}
      {...props}
    />
  );
}
