'use client';

import { motion, useSpring, useTransform, type MotionValue } from 'motion/react';
import * as React from 'react';
import { useReducedMotionPreference } from '@/ui/motion/hooks';
import { SPRING_ODOMETER } from '@/ui/motion/tokens';
import { cn } from './cn';

/**
 * Odometer number (UI v2 §4 row 5). Ported in spirit from Motion Primitives `SlidingNumber`
 * (MIT): every digit is a wheel of 0-9 that rolls to its new value on a spring, taking the
 * short way round (9 -> 0 rolls one step, not nine).
 *
 * - `text` is the already formatted string (locale grouping, decimals, `%`), so the formatting
 *   rules stay with `Intl`; only ASCII digits roll, every other character is static.
 * - Digits are keyed from the right, so `999 -> 1,000` keeps the units wheel in place.
 * - The full value is in an `sr-only` span; the wheels are `aria-hidden`.
 * - Reduced motion: wheels jump to the value (same markup, no animation).
 * - Uses tabular numerals; a wheel is exactly one `0` wide and one line high.
 */

function DigitNumeral({
  position,
  numeral,
}: {
  readonly position: MotionValue<number>;
  readonly numeral: number;
}): React.JSX.Element {
  const y = useTransform(position, (latest) => {
    const current = ((latest % 10) + 10) % 10;
    let offset = (numeral - current + 10) % 10;
    if (offset > 5) offset -= 10;
    return `${offset}em`;
  });
  return (
    <motion.span className="absolute inset-x-0 top-0 text-center" style={{ y }}>
      {numeral}
    </motion.span>
  );
}

function DigitWheel({ digit }: { readonly digit: number }): React.JSX.Element {
  const reduced = useReducedMotionPreference();
  const position = useSpring(digit, SPRING_ODOMETER);
  const lastRef = React.useRef(digit);

  React.useEffect(() => {
    const previous = lastRef.current;
    lastRef.current = digit;
    // Unwrap so the wheel takes the shortest way round.
    const base = position.get();
    let delta = digit - previous;
    if (delta > 5) delta -= 10;
    if (delta < -5) delta += 10;
    const target = base + delta;
    if (reduced) position.jump(target);
    else position.set(target);
  }, [digit, position, reduced]);

  return (
    <span className="relative inline-block h-[1em] overflow-hidden align-baseline leading-none">
      <span className="invisible">0</span>
      {Array.from({ length: 10 }, (_, numeral) => (
        <DigitNumeral key={numeral} position={position} numeral={numeral} />
      ))}
    </span>
  );
}

export interface SlidingNumberProps {
  /** The formatted value, e.g. `82.8%` or `2,721`. */
  readonly text: string;
  readonly className?: string;
}

export function SlidingNumber({ text, className }: SlidingNumberProps): React.JSX.Element {
  const chars = Array.from(text);
  const count = chars.length;
  return (
    <span className={cn('inline-flex items-baseline tabular-nums', className)}>
      <span className="sr-only">{text}</span>
      <span aria-hidden="true" className="inline-flex items-baseline leading-none">
        {chars.map((char, index) => {
          const key = `p${count - index}`;
          return /[0-9]/.test(char) ? (
            <DigitWheel key={key} digit={Number(char)} />
          ) : (
            <span key={`${key}-${char}`}>{char}</span>
          );
        })}
      </span>
    </span>
  );
}
