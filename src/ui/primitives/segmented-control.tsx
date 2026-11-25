'use client';

import { motion, useReducedMotion } from 'motion/react';
import * as React from 'react';
import { SPRING_TACTILE } from '@/ui/motion/tokens';
import { cn } from './cn';

export interface SegmentedControlOption<T extends string = string> {
  readonly value: T;
  readonly label: React.ReactNode;
  readonly ariaLabel?: string;
  /** Id of the element describing the segment, such as a glossary `Term` label's definition (premium §5.6). */
  readonly ariaDescribedBy?: string;
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
 * Single-select `SegmentedControl` implementing premium §7.8 and §8.9:
 * - Track 32 px, padding 2, `r-pill`, `fill-2`, no border; 28 px segments, padding 0 14 (0 10 in CJK)
 * - Thumb `#FFFFFF` + `shadow-thumb` (light) / white 0.16, no shadow (dark); slides on `spring-snappy`
 *   via Motion `layoutId`, `0 ms` on keyboard and reduced motion
 * - Labels `text-secondary`, hover and active `text-primary`, pressed scale 0.97 on the label only
 * - Roving `tabIndex` + WAI-ARIA `radiogroup` / `radio` semantics + `focus-ring` on `:focus-visible`
 * - Hit area 40 px (44 px on coarse pointers) via `::after`
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

  // premium §7.8: the track is 32 px at every width; `sm` (28 px) remains for the R-series Pareto header until P20
  const sizeClass = size === 'sm' ? 'h-7' : 'h-8';

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
        // Groove: the track is cut into the bench (`--elev-well`); the thumb sits proud of it
        'inline-flex items-center rounded-pill bg-fill-2 p-0.5 shadow-[var(--elev-well)] select-none',
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
            aria-describedby={option.ariaDescribedBy}
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
              'group relative inline-flex h-full cursor-pointer items-center justify-center rounded-pill type-control whitespace-nowrap',
              options.length >= 4
                ? 'px-2 sm:px-2.5 [:is(:lang(zh),:lang(ja),:lang(ko))_&]:px-2 sm:[:is(:lang(zh),:lang(ja),:lang(ko))_&]:px-2.5'
                : 'px-3.5 [:is(:lang(zh),:lang(ja),:lang(ko))_&]:px-2.5',
              "after:absolute after:inset-x-0 after:-inset-y-1.5 after:content-[''] pointer-coarse:after:-inset-y-2",
              'transition-[color] duration-[120ms] ease-[var(--ease-out)]',
              'focus-visible:shadow-focus-ring focus-visible:outline-none',
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
                    : SPRING_TACTILE
                }
                data-segmented-thumb=""
                className="pointer-events-none absolute inset-0 rounded-pill bg-white shadow-thumb dark:bg-[rgba(255,255,255,0.16)] dark:shadow-none"
              >
                {/* Glass pill: a 1 px specular lip on top and a soft bevel underneath */}
                <span className="absolute inset-0 rounded-[inherit] shadow-[inset_0_1px_0_rgba(255,255,255,0.9),inset_0_-1px_0_rgba(15,23,42,0.06)] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.22),inset_0_-1px_0_rgba(0,0,0,0.35)]" />
              </motion.span>
            ) : null}
            <span
              className={cn(
                'relative z-10 inline-block',
                // Pressed: scale 0.97 on the label only, 80 ms in, 160 ms out (premium §7.8, §8.9)
                'transition-transform duration-[160ms] ease-[var(--ease-out)]',
                'motion-safe:group-enabled:group-active:scale-[0.97] motion-safe:group-enabled:group-active:duration-[80ms]',
              )}
            >
              {option.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}
