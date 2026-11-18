'use client';

import { animate, useReducedMotion } from 'motion/react';
import * as React from 'react';
import { useT } from '@/ui/i18n';
import { Button } from '@/ui/primitives/button';
import { cn } from '@/ui/primitives/cn';
import { MATERIAL_THICK_CLASS } from '@/ui/primitives/surfaces';
import { MOTION_TOKENS, SPRING_TOKENS } from '@/ui/tokens';
import type { LiveBoxSelectStats } from './linked-interactions';

export const SELECTION_POPOVER_WIDTH_PX = 240 as const;

/** Placeholder used to split the "Most loss: {bin}" template around the untranslated bin code. */
const BIN_SLOT = '\u0000';

/** Splits a translated template around its `{bin}` slot (`[prefix, suffix]`). */
export function splitMostLossTemplate(text: string): readonly [string, string] {
  const at = text.indexOf(BIN_SLOT);
  return at < 0 ? [text, ''] : [text.slice(0, at), text.slice(at + BIN_SLOT.length)];
}

export interface SelectionPopoverHandle {
  updateLiveFrame(payload: {
    readonly x: number;
    readonly y: number;
    readonly transformOrigin: string;
    readonly stats: LiveBoxSelectStats;
    readonly visible: boolean;
  }): void;
  getMeasuredHeight(): number;
}

export interface SelectionPopoverProps {
  readonly committedStats: LiveBoxSelectStats | null;
  readonly isCommitted: boolean;
  readonly onClear: () => void;
}

/** Fallback heights before the first layout (live drag / committed with the Clear row). */
const FALLBACK_HEIGHT_PX = { live: 92, committed: 124 } as const;

/**
 * Box-selection popover (premium §7.14; anchoring and live updates per `redesign.md` §4.14, §5.7):
 * - `material-thick` + `shadow-popover`, `r-lg`, padding 12 16, width 240, z 30
 * - `headline` primary tabular "148 dies selected"; 2 px; `subhead` secondary "31 failed, 79.1% yield";
 *   8 px; `subhead` secondary "Most loss: SBIN 7" (bin code untranslated, hidden with no failing bin);
 *   12 px; committed only: text button "Clear" left and an "Esc" keycap right
 * - Text tiers primary and secondary only (it sits over the wafer)
 * - During `Shift+drag` / Select drag, position (`transform`) and values update every frame via
 *   DOM refs with zero React re-renders; enters once the drag passes 8 px (opacity + scale 0.96 -> 1)
 */
export const SelectionPopover = React.forwardRef<
  SelectionPopoverHandle,
  SelectionPopoverProps
>(function SelectionPopover(
  { committedStats, isCommitted, onClear },
  ref,
): React.JSX.Element {
  const { t, tPlural, formatInteger, formatPercent } = useT();
  const shouldReduceMotion = useReducedMotion();
  const outerRef = React.useRef<HTMLDivElement>(null);
  const cardRef = React.useRef<HTMLDivElement>(null);
  const titleRef = React.useRef<HTMLDivElement>(null);
  const summaryRef = React.useRef<HTMLParagraphElement>(null);
  const mostLossRef = React.useRef<HTMLParagraphElement>(null);
  const topBinValRef = React.useRef<HTMLElement>(null);
  const wasVisibleRef = React.useRef(false);
  const lastPlacedRef = React.useRef<{
    x: number;
    y: number;
    origin: string;
  }>({ x: 0, y: 0, origin: 'top left' });

  const [mostLossPrefix, mostLossSuffix] = splitMostLossTemplate(
    t('selection.mostLoss', { bin: BIN_SLOT }),
  );

  const formatStatsStrings = React.useCallback(
    (stats: LiveBoxSelectStats) => {
      const titleText = tPlural('selection.dies', stats.dieCount);
      const summaryText = t('selection.summary', {
        failed: formatInteger(stats.failingCount),
        yield: formatPercent(stats.dieCount > 0 ? stats.yieldRatio : 0),
      });
      const topBinText = stats.topBin
        ? `${stats.topBin.mode} ${stats.topBin.code}`
        : '';
      return { titleText, summaryText, topBinText };
    },
    [t, tPlural, formatInteger, formatPercent],
  );

  // Premium §8.13: enters with `scale(0.96 -> 1)` + opacity on `spring-snappy`, leaves with
  // opacity over `dur-1`; reduced motion fades opacity only over 120 ms. Both start from the
  // card's current values, so a re-entry during the fade reverses it.
  const fadeGenRef = React.useRef(0);
  const showCard = React.useCallback(
    (cardEl: HTMLDivElement): void => {
      fadeGenRef.current += 1;
      const outerEl = outerRef.current;
      if (outerEl) outerEl.style.visibility = 'visible';
      if (shouldReduceMotion) {
        cardEl.style.transform = 'none';
        animate(cardEl, { opacity: 1 }, { duration: 0.12, ease: 'linear' });
        return;
      }
      if (Number(getComputedStyle(cardEl).opacity) === 0) {
        animate(cardEl, { opacity: 0, scale: 0.96 }, { duration: 0 });
      }
      animate(cardEl, { opacity: 1, scale: 1 }, SPRING_TOKENS.snappy);
    },
    [shouldReduceMotion],
  );
  const hideCard = React.useCallback((): void => {
    const cardEl = cardRef.current;
    const outerEl = outerRef.current;
    if (!cardEl) return;
    const gen = (fadeGenRef.current += 1);
    const controls = animate(
      cardEl,
      { opacity: 0 },
      shouldReduceMotion
        ? { duration: 0.12, ease: 'linear' }
        : {
            duration: MOTION_TOKENS.dur1Ms / 1000,
            ease: MOTION_TOKENS.easeOutTuple,
          },
    );
    void controls.then(() => {
      if (fadeGenRef.current === gen && outerEl) {
        outerEl.style.visibility = 'hidden';
      }
    });
  }, [shouldReduceMotion]);

  React.useImperativeHandle(
    ref,
    () => ({
      updateLiveFrame({ x, y, transformOrigin, stats, visible }): void {
        lastPlacedRef.current = { x, y, origin: transformOrigin };
        const el = outerRef.current;
        const cardEl = cardRef.current;
        if (el) {
          el.style.transform = `translate3d(${x}px, ${y}px, 0)`;
          el.style.transformOrigin = transformOrigin;
          // Hiding waits for the card's fade (hideCard)
          if (visible) el.style.visibility = 'visible';
          el.dataset.visible = visible ? 'true' : 'false';
          el.setAttribute('aria-hidden', visible ? 'false' : 'true');
        }
        if (cardEl) {
          cardEl.style.transformOrigin = transformOrigin;
          if (visible && !wasVisibleRef.current) {
            showCard(cardEl);
          } else if (!visible && wasVisibleRef.current) {
            hideCard();
          }
        }
        wasVisibleRef.current = visible;

        if (visible) {
          const formatted = formatStatsStrings(stats);
          if (titleRef.current && titleRef.current.textContent !== formatted.titleText) {
            titleRef.current.textContent = formatted.titleText;
          }
          if (
            summaryRef.current &&
            summaryRef.current.textContent !== formatted.summaryText
          ) {
            summaryRef.current.textContent = formatted.summaryText;
          }
          if (
            topBinValRef.current &&
            topBinValRef.current.textContent !== formatted.topBinText
          ) {
            topBinValRef.current.textContent = formatted.topBinText;
          }
          if (mostLossRef.current) {
            mostLossRef.current.hidden = formatted.topBinText === '';
          }
        }
      },
      getMeasuredHeight(): number {
        const el = outerRef.current;
        const fallback = isCommitted
          ? FALLBACK_HEIGHT_PX.committed
          : FALLBACK_HEIGHT_PX.live;
        const h = el?.offsetHeight ?? 0;
        return h > 0 ? h : fallback;
      },
    }),
    [formatStatsStrings, hideCard, isCommitted, showCard],
  );

  const committedShown = isCommitted && committedStats !== null;
  // A cleared commit fades out like a live hide: React has just written `visibility: hidden`,
  // so keep the frame visible until the fade ends
  const prevCommittedShownRef = React.useRef(committedShown);
  React.useLayoutEffect(() => {
    const wasShown = prevCommittedShownRef.current;
    prevCommittedShownRef.current = committedShown;
    if (wasShown && !committedShown && outerRef.current) {
      outerRef.current.style.visibility = 'visible';
      if (cardRef.current) cardRef.current.style.opacity = '1';
      hideCard();
    }
  }, [committedShown, hideCard]);
  React.useEffect(() => {
    wasVisibleRef.current = committedShown;
  }, [committedShown]);

  const initialFormatted = committedStats
    ? formatStatsStrings(committedStats)
    : {
        titleText: tPlural('selection.dies', 0),
        summaryText: t('selection.summary', {
          failed: formatInteger(0),
          yield: formatPercent(0),
        }),
        topBinText: '',
      };

  return (
    <div
      ref={outerRef}
      data-stage-hud="true"
      data-testid="wafer-selection-popover"
      data-visible={committedShown ? 'true' : 'false'}
      aria-hidden={!committedShown}
      style={{
        transform: `translate3d(${lastPlacedRef.current.x}px, ${lastPlacedRef.current.y}px, 0)`,
        transformOrigin: lastPlacedRef.current.origin,
        visibility: committedShown ? 'visible' : 'hidden',
      }}
      className={
        committedShown
          ? 'pointer-events-auto absolute top-0 left-0 z-[var(--z-selection-popover)] w-[240px] select-none'
          : 'pointer-events-none absolute top-0 left-0 z-[var(--z-selection-popover)] w-[240px] select-none'
      }
    >
      <div
        ref={cardRef}
        style={{
          opacity: committedShown ? 1 : 0,
          transformOrigin: 'inherit',
        }}
        className={cn(MATERIAL_THICK_CLASS, 'flex flex-col rounded-lg px-4 py-3')}
      >
        <div
          ref={titleRef}
          data-testid="selection-popover-title"
          className="type-headline text-text-primary tabular-nums"
        >
          {initialFormatted.titleText}
        </div>

        <p
          ref={summaryRef}
          data-testid="selection-popover-summary"
          className="mt-0.5 type-subhead text-text-secondary tabular-nums"
        >
          {initialFormatted.summaryText}
        </p>

        <p
          ref={mostLossRef}
          data-testid="selection-popover-most-loss"
          hidden={initialFormatted.topBinText === ''}
          className="mt-2 truncate type-subhead text-text-secondary"
        >
          {mostLossPrefix}
          <bdi
            ref={topBinValRef}
            translate="no"
            data-testid="selection-popover-top-bin"
          >
            {initialFormatted.topBinText}
          </bdi>
          {mostLossSuffix}
        </p>

        {isCommitted ? (
          <div
            data-testid="selection-popover-actions"
            className="mt-3 flex items-center justify-between gap-3"
          >
            <Button
              variant="text"
              data-testid="selection-popover-clear"
              onPointerDown={(e) => {
                if (typeof performance !== 'undefined') {
                  e.currentTarget.dataset.ack = String(performance.now());
                }
              }}
              onKeyDown={(e) => {
                // The keycap promises Esc: it clears even while the Clear button holds focus
                if (e.key === 'Escape') {
                  e.preventDefault();
                  e.stopPropagation();
                  onClear();
                }
              }}
              onClick={onClear}
            >
              {t('selection.clear')}
            </Button>
            <kbd
              data-testid="selection-popover-esc"
              translate="no"
              className="rounded-xs bg-fill-2 px-1.5 py-0.5 font-sans type-caption text-text-secondary"
            >
              Esc
            </kbd>
          </div>
        ) : null}
      </div>
    </div>
  );
});
