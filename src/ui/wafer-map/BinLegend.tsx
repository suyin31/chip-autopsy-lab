'use client';

import * as React from 'react';
import { useStore } from 'zustand';
import type { StoreApi } from 'zustand';
import type { LotModel } from '@/core/model';
import { Untranslated, useT } from '@/ui/i18n';
import { cn } from '@/ui/primitives/cn';
import {
  EMPTY_HIDDEN_BINS,
  type SelectionStoreState,
  type WaferColorMode,
} from '@/ui/state';
import { COLOR_TOKENS, getFailBinColor } from '@/ui/tokens';
import { buildFailBinRankMap } from './wafer-geometry';

interface BinLegendItem {
  readonly code: number;
  readonly label: string;
  readonly count: number;
  readonly isPass: boolean;
  readonly color: string;
}

export interface BinLegendProps {
  readonly lot: LotModel;
  readonly waferIndex: number;
  readonly colorMode: WaferColorMode;
  /** Final-state pass and fail die counts of the active wafer (Pass/Fail legend). */
  readonly passCount: number;
  readonly failCount: number;
  readonly store: StoreApi<SelectionStoreState>;
}

/** Number of bin entries shown inline before the "+N more" popover (redesign.md 3.4). */
const INLINE_BIN_ENTRIES = 6;

/**
 * Stage legend (`redesign.md` 2.1, 3.4). Pass/Fail mode draws the pass and fail die shapes.
 * HBIN/SBIN modes list the active wafer's bins as toggles. Clicking one updates the store's
 * `hiddenBins`; the canvas layers repaint imperatively, and only this component re-renders,
 * never the stage.
 */
export function BinLegend({
  lot,
  waferIndex,
  colorMode,
  passCount,
  failCount,
  store,
}: BinLegendProps): React.JSX.Element {
  const { t, formatInteger } = useT();
  const [moreBinsOpen, setMoreBinsOpen] = React.useState(false);

  const storeLot = useStore(store, (s) => s.lot);
  const storeHiddenBins = useStore(store, (s) => s.hiddenBins);
  const hiddenBins = storeLot === lot ? storeHiddenBins : EMPTY_HIDDEN_BINS;

  const toggle = React.useCallback(
    (code: number): void => store.getState().toggleHiddenBin(code),
    [store],
  );

  const wafer = lot.wafers[waferIndex];
  const binLegendItems = React.useMemo<readonly BinLegendItem[]>(() => {
    if ((colorMode !== 'hbin' && colorMode !== 'sbin') || !wafer) {
      return [];
    }
    const isSbin = colorMode === 'sbin';
    const rankMap = buildFailBinRankMap(lot.dies, isSbin ? 'SBIN' : 'HBIN');
    const counts = new Map<number, { count: number; passCount: number }>();
    const binArr = isSbin ? lot.dies.sbin : lot.dies.hbin;
    for (let i = wafer.dieStartIndex; i < wafer.dieEndIndex; i += 1) {
      if (lot.dies.hasValidCoords[i] === 0) {
        continue;
      }
      const code = binArr[i]!;
      const entry = counts.get(code) ?? { count: 0, passCount: 0 };
      entry.count += 1;
      if (lot.dies.finalPass[i] !== 0) {
        entry.passCount += 1;
      }
      counts.set(code, entry);
    }
    const items: BinLegendItem[] = [];
    for (const [code, stats] of counts.entries()) {
      const meta = isSbin ? lot.sbins.get(code) : lot.hbins.get(code);
      const isPass = stats.passCount * 2 >= stats.count;
      const prefix = isSbin ? 'SBIN' : 'HBIN';
      const nameSuffix = meta?.name ? ` ${meta.name}` : '';
      const rank = rankMap.get(code) ?? 0;
      items.push({
        code,
        label: `${prefix} ${code}${nameSuffix}`,
        count: stats.count,
        isPass,
        color: isPass ? COLOR_TOKENS.passDie : getFailBinColor(rank),
      });
    }
    items.sort((a, b) => {
      if (a.isPass !== b.isPass) return a.isPass ? 1 : -1;
      if (b.count !== a.count) return b.count - a.count;
      return a.code - b.code;
    });
    return items;
  }, [colorMode, wafer, lot.dies, lot.sbins, lot.hbins]);

  // Close the full list when the colour mode changes
  const lastModeRef = React.useRef(colorMode);
  if (lastModeRef.current !== colorMode) {
    lastModeRef.current = colorMode;
    if (moreBinsOpen) {
      setMoreBinsOpen(false);
    }
  }

  const visibleBinItems = binLegendItems.slice(0, INLINE_BIN_ENTRIES);
  const overflowBinItems = binLegendItems.slice(INLINE_BIN_ENTRIES);

  return (
    <>
        {colorMode === 'pass-fail' || colorMode === 'parametric' ? (
          <div className="flex flex-wrap items-center gap-3 type-footnote text-text-tertiary tabular-nums">
            <span className="inline-flex items-center gap-1.5">
              <span
                aria-hidden="true"
                className="inline-flex h-2.5 w-2.5 items-center justify-center"
              >
                <span className="h-[7px] w-[7px] rounded-[1px] bg-pass-die" />
              </span>
              <span>
                {t('stage.legend.pass', {
                  count: formatInteger(passCount),
                })}
              </span>
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span
                aria-hidden="true"
                className="inline-block h-2.5 w-2.5 rounded-[1.5px] bg-failure"
              />
              <span>
                {t('stage.legend.fail', {
                  count: formatInteger(failCount),
                })}
              </span>
            </span>
          </div>
        ) : (
          <div className="relative flex flex-wrap items-center gap-x-3 gap-y-1 type-footnote tabular-nums">
            {visibleBinItems.map((item) => {
              const isHidden = hiddenBins.has(item.code);
              return (
                <button
                  key={item.code}
                  type="button"
                  aria-pressed={!isHidden}
                  aria-label={t('stage.legend.toggleAria', { bin: item.label })}
                  onClick={() => toggle(item.code)}
                  className={cn(
                    'inline-flex cursor-pointer items-center gap-1.5 rounded-xs py-0.5 transition-colors duration-[120ms] ease-[var(--ease-out)]',
                    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
                    isHidden
                      ? 'text-text-disabled line-through'
                      : 'text-text-tertiary hover:text-text-primary',
                  )}
                >
                  <span
                    aria-hidden="true"
                    className="inline-flex h-2.5 w-2.5 items-center justify-center"
                  >
                    <span
                      style={{ backgroundColor: item.color }}
                      className={
                        item.isPass
                          ? 'h-[7px] w-[7px] rounded-[1px]'
                          : 'h-2.5 w-2.5 rounded-[1.5px]'
                      }
                    />
                  </span>
                  <Untranslated>{item.label}</Untranslated>
                  <span>{formatInteger(item.count)}</span>
                </button>
              );
            })}
            {overflowBinItems.length > 0 ? (
              <button
                type="button"
                aria-expanded={moreBinsOpen}
                onClick={() => setMoreBinsOpen((v) => !v)}
                className="cursor-pointer rounded-xs px-1 py-0.5 text-text-tertiary hover:text-text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              >
                {t('stage.legend.more', {
                  count: formatInteger(overflowBinItems.length),
                })}
              </button>
            ) : null}

            {moreBinsOpen && overflowBinItems.length > 0 ? (
              <div
                role="dialog"
                className="surface-material absolute bottom-full left-0 mb-2 flex max-h-56 min-w-[220px] flex-col gap-1 overflow-y-auto rounded-lg p-2.5"
              >
                {binLegendItems.map((item) => {
                  const isHidden = hiddenBins.has(item.code);
                  return (
                    <button
                      key={item.code}
                      type="button"
                      aria-pressed={!isHidden}
                      aria-label={t('stage.legend.toggleAria', {
                        bin: item.label,
                      })}
                      onClick={() =>
                        toggle(item.code)
                      }
                      className={cn(
                        'flex w-full cursor-pointer items-center justify-between gap-3 rounded-xs px-2 py-1 text-left type-footnote tabular-nums',
                        isHidden
                          ? 'text-text-disabled line-through'
                          : 'text-text-secondary hover:bg-surface-2 hover:text-text-primary',
                      )}
                    >
                      <span className="inline-flex items-center gap-1.5 truncate">
                        <span
                          aria-hidden="true"
                          style={{ backgroundColor: item.color }}
                          className={
                            item.isPass
                              ? 'h-[7px] w-[7px] shrink-0 rounded-[1px]'
                              : 'h-2.5 w-2.5 shrink-0 rounded-[1.5px]'
                          }
                        />
                        <Untranslated className="truncate">
                          {item.label}
                        </Untranslated>
                      </span>
                      <span>{formatInteger(item.count)}</span>
                    </button>
                  );
                })}
              </div>
            ) : null}
          </div>
        )}
    </>
  );
}
