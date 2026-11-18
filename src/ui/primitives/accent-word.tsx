import * as React from 'react';
import { cn } from './cn';

export interface AccentWordProps {
  readonly children: React.ReactNode;
  readonly className?: string;
}

/**
 * The one italic serif accent word or phrase per screen (premium.md §12.2): Instrument Serif
 * italic 400 in `ember-ink`, about 6 % larger than the surrounding display line. Latin locales
 * only; callers render plain text for CJK (`isCjkLocale`).
 */
export function AccentWord({ children, className }: AccentWordProps): React.JSX.Element {
  return (
    <span data-accent="" className={cn('type-accent', className)}>
      {children}
    </span>
  );
}

/**
 * Wraps the first occurrence of `accent` in `text` with `AccentWord`. Returns the plain text when
 * the accent is disabled (CJK), empty, or not found.
 */
export function renderAccentPhrase(
  text: string,
  accent: string,
  enabled: boolean,
): React.ReactNode {
  const index = enabled && accent.length > 0 ? text.indexOf(accent) : -1;
  if (index < 0) {
    return text;
  }
  return (
    <>
      {text.slice(0, index)}
      <AccentWord>{accent}</AccentWord>
      {text.slice(index + accent.length)}
    </>
  );
}
