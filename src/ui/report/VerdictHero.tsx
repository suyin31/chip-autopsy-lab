'use client';

import * as React from 'react';
import { isCjkLocale } from '@/core/i18n';
import type { RenderedVerdictHero, ReportClaim } from '@/core/report';
import { AccentWord } from '@/ui/primitives/accent-word';
import { cn } from '@/ui/primitives/cn';
import type { VerdictRiseBlockId } from '@/ui/wafer-map/probe-sweep';
import { useT } from '@/ui/i18n/use-t';
import { renderWithUntranslatedTokens } from './render-untranslated';

export interface VerdictHeroProps {
  readonly verdict: RenderedVerdictHero;
  readonly headlineClaim: ReportClaim;
  readonly causeAria: string;
  readonly isActive: boolean;
  readonly onToggleClaim: (claim: ReportClaim) => void;
  readonly renderRiseBlock?: (
    id: VerdictRiseBlockId,
    children: React.ReactNode,
  ) => React.ReactNode;
}

/** Lines the verdict may take before it steps down a size (premium §7.3, §4.3): 2 in Latin, 3 in CJK. */
export function resolveVerdictMaxLines(locale: string): number {
  return locale === 'en' ? 2 : 3;
}

/**
 * Verdict headline and takeaway (`src/ui/report/VerdictHero.tsx`, premium §7.3, §9.3):
 * - `<h1>` `display-l`, max 520 px, `text-wrap: balance`, 2 lines max (3 in CJK); beyond that the
 *   size steps down `display-l` -> 40 -> 36 (`data-stepped-down="1" | "2"`).
 * - "Cause of death:" in `text-primary`, a `<wbr>`, then the cause phrase `<button>` in `ember-ink`,
 *   set as the screen's one Instrument Serif italic accent in Latin locales (premium §12.2).
 *   It is `inline-block`, so it wraps as one unit when it fits on a line. Hover underline 1.5 px at
 *   6 px offset (40 % mix), pressed opacity 0.72, selected (`aria-pressed`) underline at 70 % mix,
 *   `focus-ring` at `r-md` with 4 px padding absorbed by a negative margin.
 * - Healthy lot: "No cause of death." in `text-primary` with no button and no orange.
 * - Takeaway `<p>`: `body` secondary, max 520 px, `text-wrap: pretty`, never clipped before 3 lines
 *   (5 on mobile, §9.7).
 */
export function VerdictHero({
  verdict,
  headlineClaim,
  causeAria,
  isActive,
  onToggleClaim,
  renderRiseBlock,
}: VerdictHeroProps): React.JSX.Element {
  const { locale } = useT();
  const headingRef = React.useRef<HTMLHeadingElement | null>(null);
  const [step, setStep] = React.useState<0 | 1 | 2>(0);
  const maxLines = resolveVerdictMaxLines(locale);

  // Reset the step-down whenever the headline text or locale changes so we measure at display-l first
  const measureKey = `${locale}|${verdict.fullHeadline}`;
  const prevMeasureKeyRef = React.useRef(measureKey);
  if (prevMeasureKeyRef.current !== measureKey) {
    prevMeasureKeyRef.current = measureKey;
    if (step !== 0) {
      setStep(0);
    }
  }

  // Web fonts (the §12.2 serif accent) can swap in after the first measure; measure again from
  // display-l once they finish loading so a fallback face never leaves the verdict stepped down.
  React.useEffect(() => {
    if (typeof document === 'undefined' || !document.fonts) {
      return;
    }
    let cancelled = false;
    void document.fonts.ready.then(() => {
      if (!cancelled) {
        setStep(0);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [measureKey]);

  React.useLayoutEffect(() => {
    const el = headingRef.current;
    if (!el || typeof window === 'undefined') {
      return;
    }

    const checkOverflow = (): void => {
      if (step >= 2) {
        return;
      }
      const computed = window.getComputedStyle(el);
      const fontSize = Number.parseFloat(computed.fontSize) || 48;
      const rawLineHeight = Number.parseFloat(computed.lineHeight);
      const lineHeight = Number.isFinite(rawLineHeight)
        ? rawLineHeight
        : fontSize * 1.12;
      if (el.scrollHeight > Math.ceil(maxLines * lineHeight + 6)) {
        setStep((prev) => (prev === 0 ? 1 : 2));
      }
    };

    checkOverflow();

    if (typeof ResizeObserver === 'undefined') {
      return;
    }
    const ro = new ResizeObserver(() => checkOverflow());
    ro.observe(el);
    return () => ro.disconnect();
  }, [measureKey, step, maxLines]);

  const joiner =
    verdict.prefix.length > 0 && !verdict.prefix.endsWith('：') ? ' ' : '';

  const handlePointerDown = (
    event: React.PointerEvent<HTMLButtonElement>,
  ): void => {
    if (typeof performance !== 'undefined') {
      event.currentTarget.dataset.ack = String(performance.now());
    }
  };

  const headlineNode = (
    <h1
      ref={headingRef}
      data-testid="verdict-headline"
      data-stepped-down={step > 0 ? String(step) : undefined}
      className="type-display-l max-w-[520px] text-text-primary"
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
          <wbr />
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
                'verdict-cause -mx-1 inline-block max-w-[calc(100%+8px)] cursor-pointer appearance-none rounded-md border-0 bg-transparent px-1 py-0 text-left font-[inherit] text-[length:inherit] leading-[inherit] tracking-[inherit] text-ember-ink',
                'transition-opacity duration-[120ms] ease-[var(--ease-out)] active:opacity-72',
                'focus-visible:shadow-focus-ring focus-visible:outline-none',
              )}
            >
              {isCjkLocale(locale) ? (
                renderWithUntranslatedTokens(
                  verdict.cause,
                  verdict.untranslatedTokens,
                )
              ) : (
                <AccentWord>
                  {renderWithUntranslatedTokens(
                    verdict.cause,
                    verdict.untranslatedTokens,
                  )}
                </AccentWord>
              )}
            </button>
          </span>
        </>
      )}
    </h1>
  );

  const sublineNode =
    verdict.subline.length > 0 ? (
      <p
        data-testid="verdict-subline"
        className="verdict-takeaway mt-3 line-clamp-5 max-w-[520px] type-body text-pretty text-text-secondary sm:line-clamp-3 md:mt-4"
      >
        {renderWithUntranslatedTokens(
          verdict.subline,
          verdict.untranslatedTokens,
        )}
      </p>
    ) : null;

  return (
    <div data-testid="verdict-hero">
      {renderRiseBlock ? renderRiseBlock('headline', headlineNode) : headlineNode}
      {sublineNode
        ? renderRiseBlock
          ? renderRiseBlock('subline', sublineNode)
          : sublineNode
        : null}
    </div>
  );
}
