'use client';

import * as React from 'react';
import { Toaster, type ToasterProps } from 'sonner';
import { cn } from './cn';

/**
 * Owned Sonner toast host styled strictly with Chip Autopsy Lab dark clinical tokens:
 * `#111113` (`bg-panel`) surface, `1 px` `hairline` border, `12 px` panel radius,
 * zero drop shadows (`shadow-none`), and font weights `<= 500` (Requirements 2.3, 17.1, 17.2).
 */
export function ClinicalToaster({
  className,
  ...props
}: ToasterProps): React.JSX.Element {
  return (
    <Toaster
      theme="dark"
      position="bottom-right"
      closeButton
      className={cn('shadow-none', className)}
      toastOptions={{
        unstyled: true,
        classNames: {
          toast:
            'flex w-[360px] max-w-[calc(100vw-2rem)] items-start gap-3 rounded-panel border border-hairline bg-panel p-3.5 text-[13px] text-text-primary shadow-none',
          content: 'flex min-w-0 flex-1 flex-col gap-1',
          title: 'text-[13px] font-medium text-text-primary leading-snug',
          description:
            'font-mono text-[12px] text-text-secondary leading-relaxed tabular-nums',
          closeButton:
            'rounded-control border border-hairline bg-raised px-1.5 py-0.5 text-[12px] text-text-secondary shadow-none hover:text-text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
          icon: 'mt-0.5 shrink-0 text-text-secondary',
        },
      }}
      {...props}
    />
  );
}
