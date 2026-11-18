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
  readonly size?: ButtonSize;
  /** Reduces padding by 2px on the icon side for optical balance (redesign.md §4.11). */
  readonly iconSide?: ButtonIconSide;
  /** Disables tactile scale-on-press when motion would be distracting. */
  readonly static?: boolean;
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
    if (size === 'lg') {
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

function resolveSizeAndHitClass(
  variant: ButtonVariant,
  size: ButtonSize,
): string {
  if (variant === 'primary') {
    return 'h-11 text-[15px] leading-[var(--leading-control)] font-[590] tracking-[var(--tracking-control)]';
  }

  if (variant === 'secondary') {
    if (size === 'lg') {
      return 'h-11 type-control';
    }
    return "relative h-8 type-control after:absolute after:inset-x-0 after:-inset-y-1.5 after:content-[''] md:after:-inset-y-1";
  }

  if (variant === 'ghost') {
    if (size === 'lg') {
      return 'h-11 type-control';
    }
    return "relative h-8 type-control after:absolute after:inset-x-0 after:-inset-y-1.5 after:content-[''] md:after:-inset-y-1";
  }

  if (variant === 'text') {
    return "relative h-auto type-control after:absolute after:-inset-2 after:content-['']";
  }

  // variant === 'icon': 44x44 mobile, 32x32 desktop with 40x40 hit area (redesign.md §4.11, §2.3)
  return "relative h-11 w-11 md:h-8 md:w-8 [&_svg]:size-4 [&_svg]:shrink-0 md:after:absolute md:after:-inset-1 md:after:content-['']";
}

function resolveVariantSurfaceClass(variant: ButtonVariant): string {
  if (variant === 'primary') {
    return 'bg-button-primary text-button-primary-text enabled:hover:bg-white enabled:active:bg-[#e8e8ed]';
  }

  if (variant === 'secondary') {
    return 'bg-white/10 text-text-primary enabled:hover:bg-white/14 enabled:active:bg-white/8';
  }

  if (variant === 'ghost') {
    return 'bg-transparent text-text-secondary enabled:hover:bg-white/6 enabled:hover:text-text-primary';
  }

  if (variant === 'text') {
    return 'bg-transparent text-text-secondary enabled:hover:text-text-primary enabled:active:opacity-70';
  }

  // variant === 'icon'
  return 'bg-transparent text-text-secondary enabled:hover:bg-white/6 enabled:hover:text-text-primary';
}

/**
 * Owned `Button` primitive implementing `redesign.md` §4 & §4.11:
 * - Pill radius (`999px`), zero DOM drop shadows, weights <= 590 (never >= 700)
 * - Interruptible `100 ms` `pointerdown` scale feedback (`0.97`, `0.94` for icon) + `spring-snappy` release
 * - Ice `#D6E6FF` 2 px focus-visible outline at 2 px offset
 * - >= 40x40 desktop / >= 44x44 mobile hit areas via pseudo-element expansion
 */
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
          shouldReduceMotion ||
          variant === 'text'
        ) {
          return;
        }
        const el = innerRef.current;
        if (el) {
          pressedRef.current = true;
          const targetScale = variant === 'icon' ? 0.94 : 0.97;
          animate(
            el,
            { scale: targetScale },
            { duration: 0.1, ease: MOTION_TOKENS.easeOutTuple },
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
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerLeave}
        onPointerCancel={handlePointerCancel}
        onClick={handleClick}
        className={cn(
          'inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-pill whitespace-nowrap shadow-none select-none',
          'transition-[background-color,color,opacity] duration-[120ms] ease-[var(--ease-out)] active:duration-[100ms]',
          'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
          'disabled:cursor-not-allowed disabled:opacity-40 aria-disabled:cursor-not-allowed aria-disabled:opacity-40',
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
