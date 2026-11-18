'use client';

import * as React from 'react';
import type { RenderedVerdictHero, ReportClaim } from '@/core/report';
import { cn } from '@/ui/primitives/cn';
import { renderWithUntranslatedTokens } from './render-untranslated';

export interface VerdictHeroProps {
  readonly verdict: RenderedVerdictHero;
  readonly headlineClaim: ReportClaim;
  readonly causeAria: string;
  readonly isActive: boolean;
  readonly onToggleClaim: (claim: ReportClaim) => void;
}

/**
 * Verdict Hero (`src/ui/report/VerdictHero.tsx`, `redesign.md` §3.4, §3.5, §4.3, §6.6, §6.7):
 * - `<h1>` (`display-l`, <= 2 lines at 553 px desktop, <= 3 lines mobile) with two spans:
 *   1. Prefix (`"Cause of death:"`) in `text-primary`.
 *   2. Cause phrase `<button>` in `failure` orange (`#FF6B2C`), no underline at rest,
 *      `1 px` underline at `6 px` offset (`rgba(255, 107, 44, 0.5)`) on hover; toggles
 *      the primary verdict finding in `SelectionStore`.
 * - Healthy lots (`isHealthy === true`, yield >= 99% or 0 fails) render `"No cause of death. Yield is {yield}."`
 *   in `text-primary` with zero orange.
 * - Sub-line (`body` secondary, max 2 lines) 16 px below desktop / 12 px mobile.
 */
export function VerdictHero({
  verdict,
  headlineClaim,
  causeAria,
  isActive,
  onToggleClaim,
}: VerdictHeroProps): React.JSX.Element {
  const headingRef = React.useRef<HTMLHeadingElement | null>(null);
  const [steppedDown, setSteppedDown] = React.useState(false);

  // Reset step-down whenever the headline text changes so we measure at natural display-l first
  const prevHeadlineRef = React.useRef(verdict.fullHeadline);
  if (prevHeadlineRef.current !== verdict.fullHeadline) {
    prevHeadlineRef.current = verdict.fullHeadline;
    if (steppedDown) {
      setSteppedDown(false);
    }
  }

  React.useLayoutEffect(() => {
    const el = headingRef.current;
    if (!el || typeof window === 'undefined') {
      return;
    }

    const checkOverflow = (): void => {
      if (steppedDown) {
        return;
      }
      const computed = window.getComputedStyle(el);
      const fontSize = Number.parseFloat(computed.fontSize) || 48;
      const rawLineHeight = Number.parseFloat(computed.lineHeight);
      const lineHeight = Number.isFinite(rawLineHeight)
        ? rawLineHeight
        : fontSize * 1.12;
      const isMobile = window.innerWidth < 768;
      const maxLines = isMobile ? 3 : 2;
      if (el.scrollHeight > Math.ceil(maxLines * lineHeight + 6)) {
        setSteppedDown(true);
      }
    };

    checkOverflow();

    if (typeof ResizeObserver === 'undefined') {
      return;
    }
    const ro = new ResizeObserver(() => checkOverflow());
    ro.observe(el);
    return () => ro.disconnect();
  }, [verdict.fullHeadline, steppedDown]);

  const joiner =
    verdict.prefix.length > 0 && !verdict.prefix.endsWith('：') ? ' ' : '';

  const handlePointerDown = (
    event: React.PointerEvent<HTMLButtonElement>,
  ): void => {
    if (typeof performance !== 'undefined') {
      event.currentTarget.dataset.ack = String(performance.now());
    }
  };

  return (
    <div data-testid="verdict-hero">
      <h1
        ref={headingRef}
        data-testid="verdict-headline"
        data-stepped-down={steppedDown ? 'true' : undefined}
        className="type-display-l text-text-primary"
      >
        {verdict.isHealthy ? (
          <span>
            {renderWithUntranslatedTokens(
              verdict.fullHeadline,
              verdict.untranslatedTokens,
            )}
          </span>
        ) : (
          <>
            <span data-testid="verdict-prefix" className="text-text-primary">
              {verdict.prefix}
              {joiner}
            </span>
            <span>
              <button
                type="button"
                data-testid="autopsy-headline-button"
                data-claim-id={headlineClaim.claimId}
                aria-pressed={isActive}
                aria-label={`${verdict.cause} — ${causeAria}`}
                onPointerDown={handlePointerDown}
                onClick={() => onToggleClaim(headlineClaim)}
                className={cn(
                  'inline cursor-pointer appearance-none rounded-xs border-0 bg-transparent p-0 py-1.5 -my-1.5 text-left font-[inherit] text-[length:inherit] leading-[inherit] tracking-[inherit] text-failure',
                  'decoration-[rgba(255,107,44,0.5)] decoration-1 underline-offset-[6px] transition-opacity duration-120 ease-out',
                  'hover:underline active:opacity-70',
                  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
                  isActive && 'underline decoration-failure',
                )}
              >
                {renderWithUntranslatedTokens(
                  verdict.cause,
                  verdict.untranslatedTokens,
                )}
              </button>
            </span>
          </>
        )}
      </h1>

      {verdict.subline.length > 0 ? (
        <p
          data-testid="verdict-subline"
          className="mt-3 line-clamp-2 type-body text-text-secondary md:mt-4"
        >
          {renderWithUntranslatedTokens(
            verdict.subline,
            verdict.untranslatedTokens,
          )}
        </p>
      ) : null}
    </div>
  );
}
