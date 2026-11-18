'use client';

import { animate, useReducedMotion } from 'motion/react';
import * as React from 'react';
import { MOTION_TOKENS, SPRING_TOKENS } from '@/ui/tokens';
import { cn } from './cn';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'text' | 'icon';
export type ButtonSize = 'sm' | 'md' | 'lg';
export type ButtonIconSide = 'start' | 'end';

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  readonly variant?: ButtonVariant;
  /**
   * Height step (premium §7.11). Primary: `lg` 48 (landing, error, sheets), `md`/`sm` 40
   * (verdict action row). Secondary: `lg` 48, `md` 44, `sm` 32 (nav). Ghost, text, and icon
   * have one size each.
   */
  readonly size?: ButtonSize;
  /** Reduces padding by 2px on the icon side for optical balance (premium §7). */
  readonly iconSide?: ButtonIconSide;
  /** Disables tactile scale-on-press when motion would be distracting. */
  readonly static?: boolean;
}

/**
 * Every `Button` writes `data-variant`. Counts primary (`ink`) buttons in rendered markup. Every screen holds exactly one
 * (premium §1.1 rule 4, §7.11, A20).
 */
export function countPrimaryButtons(markup: string): number {
  return markup.match(/<button\b[^>]*\bdata-variant="primary"/g)?.length ?? 0;
}

/** Press scale per variant (premium §3.12): 0.97 buttons, 0.94 icon buttons; text buttons dim instead. */
export function resolveButtonPressScale(variant: ButtonVariant): number | null {
  if (variant === 'text') return null;
  return variant === 'icon' ? 0.94 : 0.97;
}

function resolvePaddingClass(
  variant: ButtonVariant,
  size: ButtonSize,
  iconSide?: ButtonIconSide,
): string {
  if (variant === 'primary') {
    if (iconSide === 'start') return 'pl-5 pr-[22px]';
    if (iconSide === 'end') return 'pl-[22px] pr-5';
    return 'px-[22px]';
  }

  if (variant === 'secondary') {
    if (size !== 'sm') {
      if (iconSide === 'start') return 'pl-[18px] pr-5';
      if (iconSide === 'end') return 'pl-5 pr-[18px]';
      return 'px-5';
    }
    if (iconSide === 'start') return 'pl-3 pr-[14px]';
    if (iconSide === 'end') return 'pl-[14px] pr-3';
    return 'px-[14px]';
  }

  if (variant === 'ghost') {
    if (iconSide === 'start') return 'pl-2 pr-2.5';
    if (iconSide === 'end') return 'pl-2.5 pr-2';
    return 'px-2.5';
  }

  return 'p-0';
}

// 32 px visuals reach 40 px on fine pointers and 44 px on coarse pointers via ::after (premium §3.10)
const HIT_AREA_32_CLASS =
  "relative after:absolute after:inset-x-0 after:-inset-y-1 after:content-[''] pointer-coarse:after:-inset-y-1.5";

function resolveSizeAndHitClass(
  variant: ButtonVariant,
  size: ButtonSize,
): string {
  if (variant === 'primary') {
    return cn(
      size === 'lg' ? 'h-12' : 'h-10',
      'text-[15px] leading-[var(--leading-control)] font-[590] tracking-[-0.01em]',
    );
  }

  if (variant === 'secondary') {
    if (size === 'lg') return 'h-12 type-control';
    if (size === 'md') return 'h-11 type-control';
    return cn('h-8 type-control', HIT_AREA_32_CLASS);
  }

  if (variant === 'ghost') {
    return cn('h-8 type-control', HIT_AREA_32_CLASS);
  }

  if (variant === 'text') {
    return "relative h-auto type-control after:absolute after:-inset-2 after:content-['']";
  }

  // variant === 'icon': 32 x 32 with a 40 px hit area, 44 x 44 on coarse pointers; icon 16 (premium §7.11)
  return "relative size-8 pointer-coarse:size-11 [&_svg]:size-4 [&_svg]:shrink-0 after:absolute after:-inset-1 after:content-[''] pointer-coarse:after:inset-0";
}

function resolveVariantSurfaceClass(variant: ButtonVariant): string {
  if (variant === 'primary') {
    // `ink` fill, hover #333336 / #FFFFFF, pressed #000000 / #E8E8ED, disabled 0.32 (premium §7.11)
    return cn(
      'bg-ink text-on-ink',
      'enabled:hover:bg-[#333336] dark:enabled:hover:bg-white',
      'enabled:active:bg-black dark:enabled:active:bg-[#e8e8ed]',
      'disabled:opacity-32 aria-disabled:opacity-32',
    );
  }

  if (variant === 'secondary') {
    return 'bg-fill-2 text-text-primary enabled:hover:bg-fill-3 disabled:opacity-32 aria-disabled:opacity-32';
  }

  if (variant === 'ghost') {
    return 'bg-transparent text-text-secondary enabled:hover:bg-fill-1 enabled:hover:text-text-primary enabled:active:bg-fill-2 disabled:text-text-disabled aria-disabled:text-text-disabled';
  }

  if (variant === 'text') {
    return 'bg-transparent text-text-secondary enabled:hover:text-text-primary enabled:active:opacity-64 disabled:text-text-disabled aria-disabled:text-text-disabled';
  }

  // variant === 'icon'; toggled (`aria-pressed="true"`): fill-2, icon primary, hover fill-3
  return cn(
    'bg-transparent text-text-secondary enabled:hover:bg-fill-1 enabled:hover:text-text-primary',
    'aria-pressed:bg-fill-2 aria-pressed:text-text-primary aria-pressed:enabled:hover:bg-fill-3',
    'disabled:text-text-disabled aria-disabled:text-text-disabled',
  );
}

/**
 * Owned `Button` primitive implementing premium §7.11 and §8.9:
 * - Pill radius, `control` text, weights <= 590, `transform-origin: center`
 * - Interruptible `80 ms` `pointerdown` scale (`0.97`, `0.94` for icon) + `spring-snappy` release;
 *   none under reduced motion
 * - `focus-ring` token on `:focus-visible` only, following the pill radius
 * - >= 40x40 desktop / >= 44x44 coarse-pointer hit areas via pseudo-element expansion
 */
/** Base classes shared by `Button` and menu triggers that must look like a button (premium §7.1, §7.11). */
const BUTTON_BASE_CLASS = cn(
  'inline-flex origin-center cursor-pointer items-center justify-center gap-1.5 rounded-pill whitespace-nowrap shadow-none select-none',
  'transition-[background-color,color,opacity] duration-[120ms] ease-[var(--ease-out)]',
  'focus-visible:shadow-focus-ring focus-visible:outline-none',
  'disabled:cursor-not-allowed aria-disabled:cursor-not-allowed',
);

/** Visual classes of a `Button` variant, for elements that render their own `<button>` (menu triggers). */
export function resolveButtonClassName(options: {
  readonly variant: ButtonVariant;
  readonly size?: ButtonSize;
  readonly iconSide?: ButtonIconSide;
}): string {
  const size = options.size ?? 'md';
  return cn(
    BUTTON_BASE_CLASS,
    resolveSizeAndHitClass(options.variant, size),
    resolvePaddingClass(options.variant, size, options.iconSide),
    resolveVariantSurfaceClass(options.variant),
  );
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(
    {
      className,
      variant = 'secondary',
      size = 'md',
      iconSide,
      static: isStatic = false,
      disabled,
      type = 'button',
      onPointerDown,
      onPointerUp,
      onPointerLeave,
      onPointerCancel,
      onClick,
      ...props
    },
    forwardedRef,
  ) {
    const innerRef = React.useRef<HTMLButtonElement | null>(null);
    const pressedRef = React.useRef(false);
    const shouldReduceMotion = useReducedMotion();
    const isAriaDisabled =
      disabled === true ||
      props['aria-disabled'] === true ||
      props['aria-disabled'] === 'true';

    const setRef = React.useCallback(
      (node: HTMLButtonElement | null) => {
        innerRef.current = node;
        if (typeof forwardedRef === 'function') {
          forwardedRef(node);
        } else if (forwardedRef) {
          forwardedRef.current = node;
        }
      },
      [forwardedRef],
    );

    const releasePressScale = React.useCallback(() => {
      if (!pressedRef.current) {
        return;
      }
      pressedRef.current = false;
      const el = innerRef.current;
      if (el && !shouldReduceMotion) {
        animate(el, { scale: 1 }, SPRING_TOKENS.snappy);
      }
    }, [shouldReduceMotion]);

    const handlePointerDown = React.useCallback(
      (event: React.PointerEvent<HTMLButtonElement>) => {
        onPointerDown?.(event);
        if (
          event.defaultPrevented ||
          event.button !== 0 ||
          isAriaDisabled ||
          isStatic ||
          shouldReduceMotion
        ) {
          return;
        }
        const targetScale = resolveButtonPressScale(variant);
        const el = innerRef.current;
        if (el && targetScale !== null) {
          pressedRef.current = true;
          animate(
            el,
            { scale: targetScale },
            { duration: 0.08, ease: MOTION_TOKENS.easeOutTuple },
          );
        }
      },
      [isAriaDisabled, isStatic, onPointerDown, shouldReduceMotion, variant],
    );

    const handlePointerUp = React.useCallback(
      (event: React.PointerEvent<HTMLButtonElement>) => {
        onPointerUp?.(event);
        releasePressScale();
      },
      [onPointerUp, releasePressScale],
    );

    const handlePointerLeave = React.useCallback(
      (event: React.PointerEvent<HTMLButtonElement>) => {
        onPointerLeave?.(event);
        releasePressScale();
      },
      [onPointerLeave, releasePressScale],
    );

    const handlePointerCancel = React.useCallback(
      (event: React.PointerEvent<HTMLButtonElement>) => {
        onPointerCancel?.(event);
        releasePressScale();
      },
      [onPointerCancel, releasePressScale],
    );

    const handleClick = React.useCallback(
      (event: React.MouseEvent<HTMLButtonElement>) => {
        if (isAriaDisabled) {
          event.preventDefault();
          return;
        }
        onClick?.(event);
      },
      [isAriaDisabled, onClick],
    );

    return (
      <button
        ref={setRef}
        type={type}
        disabled={disabled}
        aria-disabled={isAriaDisabled ? 'true' : undefined}
        data-variant={variant}
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerLeave}
        onPointerCancel={handlePointerCancel}
        onClick={handleClick}
        className={cn(
          BUTTON_BASE_CLASS,
          resolveSizeAndHitClass(variant, size),
          resolvePaddingClass(variant, size, iconSide),
          resolveVariantSurfaceClass(variant),
          className,
        )}
        {...props}
      />
    );
  },
);
