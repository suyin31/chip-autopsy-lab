import * as React from 'react';
import { cn } from './cn';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  readonly variant?: ButtonVariant;
  readonly size?: ButtonSize;
}

const VARIANT_CLASSES: Readonly<Record<ButtonVariant, string>> = {
  primary:
    'border border-accent bg-accent text-accent-foreground hover:opacity-90 active:scale-[0.99]',
  secondary:
    'border border-hairline bg-raised text-text-primary hover:opacity-90 active:scale-[0.99]',
  ghost:
    'border border-transparent bg-transparent text-text-secondary hover:bg-raised hover:text-text-primary',
};

const SIZE_CLASSES: Readonly<Record<ButtonSize, string>> = {
  sm: 'h-8 px-3 text-[13px]',
  md: 'h-9 px-4 text-[14px]',
  lg: 'h-10 px-5 text-[14px]',
};

/**
 * Owned shadcn/ui-pattern `Button` bound to Chip Autopsy Lab design tokens:
 * weight `500` (never bold `>= 700`), zero shadows, and `#D6E6FF` focus rings.
 */
export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(
    { className, variant = 'secondary', size = 'md', type = 'button', ...props },
    ref,
  ) {
    return (
      <button
        ref={ref}
        type={type}
        className={cn(
          'inline-flex cursor-pointer items-center justify-center gap-2 rounded-control font-medium whitespace-nowrap shadow-none select-none',
          'transition-[transform,opacity] duration-150 ease-[var(--ease-clinical)]',
          'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
          'disabled:pointer-events-none disabled:opacity-45',
          VARIANT_CLASSES[variant],
          SIZE_CLASSES[size],
          className,
        )}
        {...props}
      />
    );
  },
);
