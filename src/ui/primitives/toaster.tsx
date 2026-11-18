'use client';

import { Check, CircleAlert, Info, X } from 'lucide-react';
import * as React from 'react';
import { Toaster, type ToasterProps } from 'sonner';
import { cn } from './cn';
import { MATERIAL_THICK_CLASS } from './surfaces';

/** Toast width: `min(380px, 100vw − 32px)` (premium §7.13). */
export const TOAST_WIDTH_CSS = 'min(380px, calc(100vw - 32px))' as const;

export const SONNER_TOAST_OPTIONS = {
  position: 'bottom-center',
  visibleToasts: 3,
  gap: 8,
  duration: 4_000,
  expand: true,
  offset: 24,
  mobileOffset: {
    bottom: 'calc(16px + env(safe-area-inset-bottom))',
    left: 16,
    right: 16,
  },
  classNames: {
    // `material-thick` + `shadow-popover`, `r-lg`, padding 12 16, min-height 48,
    // grid `auto 1fr auto` (icon, text, action; the dismiss button joins the end), gap 12
    toast: cn(
      MATERIAL_THICK_CLASS,
      'grid min-h-12 w-full grid-flow-col grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-lg px-4 py-3 text-text-primary',
      '[&:not(:has(>[data-icon]))]:grid-cols-[minmax(0,1fr)_auto]',
    ),
    content: 'flex min-w-0 flex-col gap-0.5',
    title: 'type-callout text-text-primary text-pretty',
    description: 'type-subhead text-text-secondary tabular-nums text-pretty',
    actionButton:
      "relative shrink-0 cursor-pointer rounded-xs bg-transparent type-control text-text-primary transition-opacity duration-[120ms] ease-[var(--ease-out)] after:absolute after:-inset-2 after:content-[''] active:opacity-70 focus-visible:shadow-focus-ring focus-visible:outline-none",
    cancelButton:
      "relative shrink-0 cursor-pointer rounded-xs bg-transparent type-control text-text-secondary transition-[color] duration-[120ms] ease-[var(--ease-out)] after:absolute after:-inset-2 after:content-[''] hover:text-text-primary focus-visible:shadow-focus-ring focus-visible:outline-none",
    // Error toasts: icon button "Dismiss" (`x`), 24 x 24 with a 40 px hit area
    closeButton:
      "relative order-last flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-pill bg-transparent text-text-secondary transition-[background-color,color] duration-[120ms] ease-[var(--ease-out)] after:absolute after:-inset-2 after:content-[''] hover:bg-fill-1 hover:text-text-primary active:bg-fill-2 focus-visible:shadow-focus-ring focus-visible:outline-none [&_svg]:size-4",
    icon: 'flex size-4 shrink-0 items-center justify-center text-text-secondary [&_svg]:size-4',
  },
} as const;

/** Leading icons, all `text-secondary` (premium §7.13): no red, orange, or green. */
const TOAST_ICONS: NonNullable<ToasterProps['icons']> = {
  success: <Check aria-hidden="true" strokeWidth={2} />,
  info: <Info aria-hidden="true" strokeWidth={2} />,
  warning: <CircleAlert aria-hidden="true" strokeWidth={2} />,
  error: <CircleAlert aria-hidden="true" strokeWidth={2} />,
  close: <X aria-hidden="true" strokeWidth={2} />,
};

/**
 * Sonner pauses on hover only. Focus inside a toast pauses it too (premium §7.13): focus
 * moving in sends the list a synthetic `mousemove` (its expand-and-pause handler), focus
 * leaving sends `mouseout` unless the pointer is still over it.
 */
function useFocusPausesToasts(): void {
  React.useEffect(() => {
    if (typeof document === 'undefined') return;
    const listOf = (target: EventTarget | null): HTMLElement | null =>
      target instanceof Element
        ? target.closest<HTMLElement>('[data-sonner-toaster]')
        : null;

    const onFocusIn = (event: FocusEvent): void => {
      const list = listOf(event.target);
      if (list) {
        list.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
      }
    };
    const onFocusOut = (event: FocusEvent): void => {
      const list = listOf(event.target);
      if (!list || list.contains(event.relatedTarget as Node | null)) return;
      if (list.matches(':hover')) return;
      list.dispatchEvent(
        new MouseEvent('mouseout', {
          bubbles: true,
          relatedTarget: document.body,
        }),
      );
    };

    document.addEventListener('focusin', onFocusIn);
    document.addEventListener('focusout', onFocusOut);
    return () => {
      document.removeEventListener('focusin', onFocusIn);
      document.removeEventListener('focusout', onFocusOut);
    };
  }, []);
}

export interface ClinicalToasterProps extends ToasterProps {
  /** Accessible name of the error toast's dismiss button ("Dismiss"). */
  readonly dismissLabel?: string;
}

/**
 * Owned Sonner toast host (premium §7.13):
 * - Bottom-centre, offset 24 (mobile 16 + safe-area inset), z 70, width `min(380px, 100vw − 32px)`
 * - `material-thick` + `shadow-popover`, `r-lg`, padding 12 16, min-height 48, grid `auto 1fr auto`
 * - Optional 16 px `text-secondary` icon; `callout` primary title, `subhead` secondary body 2 px below;
 *   optional text action `control` primary; error toasts persist and carry a 24 px "Dismiss" button
 * - 4 s, hover or focus pauses; at most 3 visible, `expand`, gap 8; the oldest leaves first
 * - Motion (`.cal-toaster` rules in `globals.css`): rise 16 px on `spring-ui`, exit fade in 160 ms
 * - Sonner's `light` theme is used because its `dark` theme paints the description and close
 *   button over our tokens; colours come from the app tokens in both themes.
 */
export function ClinicalToaster({
  className,
  dismissLabel = 'Dismiss',
  style,
  ...props
}: ClinicalToasterProps): React.JSX.Element {
  useFocusPausesToasts();
  return (
    <Toaster
      theme="light"
      position={SONNER_TOAST_OPTIONS.position}
      visibleToasts={SONNER_TOAST_OPTIONS.visibleToasts}
      gap={SONNER_TOAST_OPTIONS.gap}
      expand={SONNER_TOAST_OPTIONS.expand}
      offset={SONNER_TOAST_OPTIONS.offset}
      mobileOffset={SONNER_TOAST_OPTIONS.mobileOffset}
      icons={TOAST_ICONS}
      className={cn('cal-toaster z-[var(--z-toasts)]', className)}
      style={
        {
          '--width': TOAST_WIDTH_CSS,
          zIndex: 'var(--z-toasts)',
          ...style,
        } as React.CSSProperties
      }
      toastOptions={{
        unstyled: true,
        duration: SONNER_TOAST_OPTIONS.duration,
        closeButtonAriaLabel: dismissLabel,
        classNames: { ...SONNER_TOAST_OPTIONS.classNames },
      }}
      {...props}
    />
  );
}
