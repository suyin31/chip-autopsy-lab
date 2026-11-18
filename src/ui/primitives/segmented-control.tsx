'use client';

import { motion, useReducedMotion } from 'motion/react';
import * as React from 'react';
import { SPRING_TOKENS } from '@/ui/tokens';
import { cn } from './cn';

export interface SegmentedControlOption<T extends string = string> {
  readonly value: T;
  readonly label: React.ReactNode;
  readonly ariaLabel?: string;
  readonly disabled?: boolean;
}

export interface SegmentedControlProps<T extends string = string> {
  readonly options: readonly SegmentedControlOption<T>[];
  readonly value: T;
  readonly onValueChange: (nextValue: T) => void;
  readonly ariaLabel: string;
  readonly size?: 'responsive' | 'sm' | 'md';
  readonly disabled?: boolean;
  readonly className?: string;
  readonly 'data-testid'?: string;
}

export interface SegmentedKeyStepResult {
  readonly nextIndex: number;
  readonly instant: true;
}

/**
 * Pure keyboard rover for `SegmentedControl` (§4.12):
 * steps through enabled segments and marks transitions as `0 ms` (`instant: true`).
 */
export function resolveSegmentedKeyStep(
  key: string,
  currentIndex: number,
  items: ReadonlyArray<{ readonly disabled?: boolean }>,
): SegmentedKeyStepResult | null {
  const count = items.length;
  if (count === 0) {
    return null;
  }

  const findNextEnabled = (start: number, delta: 1 | -1): number => {
    for (let step = 0; step < count; step += 1) {
      const idx = (((start + step * delta) % count) + count) % count;
      if (!items[idx]?.disabled) {
        return idx;
      }
    }
    return currentIndex;
  };

  if (key === 'ArrowRight' || key === 'ArrowDown') {
    return {
      nextIndex: findNextEnabled(currentIndex + 1, 1),
      instant: true,
    };
  }

  if (key === 'ArrowLeft' || key === 'ArrowUp') {
    return {
      nextIndex: findNextEnabled(currentIndex - 1, -1),
      instant: true,
    };
  }

  if (key === 'Home') {
    return {
      nextIndex: findNextEnabled(0, 1),
      instant: true,
    };
  }

  if (key === 'End') {
    return {
      nextIndex: findNextEnabled(count - 1, -1),
      instant: true,
    };
  }

  return null;
}

/**
 * Single-select `SegmentedControl` implementing `redesign.md` §4.12:
 * - Height `32 px` desktop (`28 px` mobile), `.surface-material`, radius `999`, padding `2 px`
 * - `surface-3` thumb slides with `spring-snappy` via Motion `layoutId` (`0 ms` on keyboard / reduced motion)
 * - Roving `tabIndex` + WAI-ARIA `radiogroup` / `radio` semantics + `2 px` ice `#D6E6FF` focus rings
 */
export function SegmentedControl<T extends string = string>({
  options,
  value,
  onValueChange,
  ariaLabel,
  size = 'responsive',
  disabled = false,
  className,
  'data-testid': dataTestId,
}: SegmentedControlProps<T>): React.JSX.Element {
  const layoutId = React.useId();
  const shouldReduceMotion = useReducedMotion();
  const buttonRefs = React.useRef<Array<HTMLButtonElement | null>>([]);
  const [instantTransition, setInstantTransition] = React.useState(false);

  const activeIndex = Math.max(
    0,
    options.findIndex((opt) => opt.value === value),
  );

  const sizeClass =
    size === 'sm'
      ? 'h-7'
      : size === 'md'
        ? 'h-8'
        : 'h-7 md:h-8';

  const handleKeyDown = (
    event: React.KeyboardEvent<HTMLButtonElement>,
    index: number,
  ): void => {
    if (disabled) {
      return;
    }
    const step = resolveSegmentedKeyStep(
      event.key,
      index,
      options.map((opt) => ({ disabled: disabled || opt.disabled === true })),
    );
    if (!step) {
      return;
    }
    event.preventDefault();
    const targetOption = options[step.nextIndex];
    if (!targetOption) {
      return;
    }
    setInstantTransition(true);
    onValueChange(targetOption.value);
    buttonRefs.current[step.nextIndex]?.focus();
  };

  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      data-testid={dataTestId}
      className={cn(
        'surface-material inline-flex items-center rounded-pill p-0.5 select-none',
        sizeClass,
        disabled && 'opacity-40',
        className,
      )}
    >
      {options.map((option, idx) => {
        const isActive = option.value === value;
        const isItemDisabled = disabled || option.disabled === true;
        const isTabStop = idx === activeIndex && !isItemDisabled;

        return (
          <button
            key={option.value}
            ref={(node) => {
              buttonRefs.current[idx] = node;
            }}
            type="button"
            role="radio"
            aria-checked={isActive}
            aria-label={option.ariaLabel}
            aria-disabled={isItemDisabled ? 'true' : undefined}
            disabled={isItemDisabled}
            tabIndex={isTabStop ? 0 : -1}
            onPointerDown={() => {
              if (!isItemDisabled) {
                setInstantTransition(false);
              }
            }}
            onClick={() => {
              if (!isItemDisabled && option.value !== value) {
                onValueChange(option.value);
              }
            }}
            onKeyDown={(event) => handleKeyDown(event, idx)}
            className={cn(
              'relative inline-flex h-full cursor-pointer items-center justify-center rounded-pill px-3 type-control whitespace-nowrap',
              "after:absolute after:inset-x-0 after:-inset-y-2 after:content-[''] md:after:-inset-y-1.5",
              'transition-colors duration-[120ms] ease-[var(--ease-out)]',
              'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
              'disabled:cursor-not-allowed disabled:opacity-40',
              isActive
                ? 'text-text-primary'
                : 'text-text-secondary enabled:hover:text-text-primary',
            )}
          >
            {isActive ? (
              <motion.span
                layoutId={`${layoutId}-thumb`}
                aria-hidden="true"
                transition={
                  shouldReduceMotion || instantTransition
                    ? { duration: 0 }
                    : SPRING_TOKENS.snappy
                }
                className="pointer-events-none absolute inset-0 rounded-pill bg-surface-3"
              />
            ) : null}
            <span className="relative z-10">{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}
