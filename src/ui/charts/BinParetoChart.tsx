'use client';

import { motion, useReducedMotion } from 'motion/react';
import * as React from 'react';
import type { StoreApi } from 'zustand';
import { useStore } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import { computeBinPareto } from '@/core/analytics';
import type { BinMode, LotModel } from '@/core/model';
import type { GlossaryTermId } from '@/core/i18n';
import { GlossaryText, Untranslated, useT } from '@/ui/i18n';
import { cn } from '@/ui/primitives/cn';
import { Button } from '@/ui/primitives/button';
import { CountUp } from '@/ui/primitives/count-up';
import {
  DISCLOSURE_SCOPE_ATTR,
  DisclosureGlide,
  DisclosureListItem,
  useDisclosureList,
} from '@/ui/primitives/disclosure';
import { SegmentedControl } from '@/ui/primitives/segmented-control';
import { Tooltip } from '@/ui/primitives/tooltip';
import { type SelectionStoreState, useSelectionStore } from '@/ui/state';
import { buildFailBinRankMap } from '@/ui/wafer-map/wafer-geometry';
import {
  PARETO_COLLAPSED_ROW_COUNT,
  type ParetoBarTone,
  resolveClaimMatchedBinCode,
  resolveClaimParetoMode,
  resolveParetoBarPercent,
  resolveParetoBarTone,
  resolveParetoMask,
  selectParetoRows,
} from './bin-pareto-view';

/** "Yield loss by bin" defines "Bin" (premium §2.2). */
const CHART_LABEL_TERMS: readonly GlossaryTermId[] = ['bin'];

export interface BinParetoChartProps {
  readonly lot: LotModel;
  /** Optional isolated Zustand store instance for deterministic component tests. */
  readonly store?: StoreApi<SelectionStoreState>;
  readonly className?: string;
}

/**
 * "Where the yield went" (premium §7.9 with the §11.3 inspiration delta), placed below Findings
 * in the verdict column.
 *
 * - `surface` section card (`r-2xl`, `shadow-card`, padding 24, 16 on mobile): `title-2` title with
 *   the bin-type segmented control right, a one-line takeaway, the lot yield loss as the one big
 *   number, then "Yield loss by bin" / "Share of all dies" labels over the rows.
 * - Rows are 40 px `88px 1fr 56px 88px 56px` grids: bin code (name in a 600 ms tooltip), an 8 px
 *   bar scaled to the largest loss share, share of all dies, die count, and a share-of-fails pill.
 *   The count column drops out when the card is narrower than 448 px.
 * - Only the top-loss bin (fail-bin rank 0, the disc's ember bin) is solid `ember-mark`; the rest
 *   are ghosted `bar-neutral` with a `hairline-strong` outline. No track, gridlines, or axis.
 * - A row click toggles the store's bin filter. A finding that cites a bin selects its row too.
 *   Selected rows get `fill-2` and `aria-pressed`; a selected non-dominant bar turns solid `ink`.
 * - The chart counts over the brush, site, and filter-DSL selection without its own bin filter,
 *   so the other rows stay available.
 */
export function BinParetoChart({
  lot,
  store = useSelectionStore,
  className,
}: BinParetoChartProps): React.JSX.Element | null {
  const { t, tPlural, formatInteger, formatPercent } = useT();
  const headingId = React.useId();
  const chartLabelId = React.useId();
  const sectionRef = React.useRef<HTMLElement | null>(null);

  const {
    storeLot,
    brush,
    binFilter,
    siteFilter,
    waferFilter,
    dslFilter,
    hasActiveFilter,
    selectedDieMask,
    claimHighlight,
  } = useStore(
    store,
    useShallow((s) => ({
      storeLot: s.lot,
      brush: s.brush,
      binFilter: s.binFilter,
      siteFilter: s.siteFilter,
      waferFilter: s.waferFilter,
      dslFilter: s.dslFilter,
      hasActiveFilter: s.hasActiveFilter,
      selectedDieMask: s.selectedDieMask,
      claimHighlight: s.claimHighlight,
    })),
  );
  const synced = storeLot === lot;

  const [mode, setMode] = React.useState<BinMode>('SBIN');
  // Premium §8.6: "Show all N bins" mounts the rows with a fade; the toggle glides
  const reduced = Boolean(useReducedMotion());
  const disclosure = useDisclosureList(reduced);
  const { expanded } = disclosure;

  // Premium §11.5: share pills count up with the rows that mount with the lot; rows that mount
  // later (mode switch, "Show all") show their final value at once (§8.14)
  const pillsPlayedLotRef = React.useRef<LotModel | null>(null);
  const playPills = pillsPlayedLotRef.current !== lot;
  React.useEffect(() => {
    pillsPlayedLotRef.current = lot;
  }, [lot]);

  // A finding that cites a bin of the other kind switches the chart to that kind
  const claimId = synced ? (claimHighlight?.claimId ?? null) : null;
  const [seenClaimId, setSeenClaimId] = React.useState<string | null>(null);
  if (claimId !== seenClaimId) {
    setSeenClaimId(claimId);
    const nextMode = resolveClaimParetoMode(mode, claimHighlight?.citedBins);
    if (claimId !== null && nextMode !== null) {
      setMode(nextMode);
    }
  }

  const mask = React.useMemo(
    () =>
      synced
        ? resolveParetoMask(lot, {
            brush,
            binFilter,
            siteFilter,
            waferFilter,
            dslFilter,
            hasActiveFilter,
            selectedDieMask,
          })
        : undefined,
    [
      synced,
      lot,
      brush,
      binFilter,
      siteFilter,
      waferFilter,
      dslFilter,
      hasActiveFilter,
      selectedDieMask,
    ],
  );

  const pareto = React.useMemo(
    () => computeBinPareto(lot, mode, mask),
    [lot, mode, mask],
  );

  const rankByCode = React.useMemo(
    () => buildFailBinRankMap(lot.dies, mode),
    [lot.dies, mode],
  );

  const activeFilterCode =
    synced && binFilter !== null && binFilter.mode === mode
      ? binFilter.code
      : null;
  const highlightedCodes = React.useMemo(() => {
    const codes = new Set<number>();
    if (!synced || claimHighlight === null) {
      return codes;
    }
    for (const bin of claimHighlight.citedBins ?? []) {
      if (bin.mode === mode) {
        codes.add(bin.code);
      }
    }
    if (codes.size === 0) {
      // A claim without a bin of this kind (e.g. the Edge-Ring finding) matches the bin
      // holding most of its failing dies
      const matched = resolveClaimMatchedBinCode(
        lot.dies,
        mode,
        claimHighlight.dieIndices,
      );
      if (matched !== null) codes.add(matched);
    }
    return codes;
  }, [synced, claimHighlight, mode, lot.dies]);

  const isPinnedRow = (entry: (typeof pareto.entries)[number]): boolean =>
    entry.binCode === activeFilterCode || highlightedCodes.has(entry.binCode);
  const rows = selectParetoRows(pareto.entries, expanded, isPinnedRow);
  const collapsedCodes = expanded
    ? new Set(
        selectParetoRows(pareto.entries, false, isPinnedRow).map(
          (entry) => entry.binCode,
        ),
      )
    : null;

  const maxCount = pareto.entries[0]?.count ?? 0;

  const modeOptions = React.useMemo(
    () => [
      { value: 'SBIN' as const, label: t('mode.softBins') },
      { value: 'HBIN' as const, label: t('mode.hardBins') },
    ],
    [t],
  );

  const handleToggle = React.useCallback(
    (code: number): void => {
      store.getState().toggleBinFilter({ mode, code });
    },
    [store, mode],
  );

  const hasLoss = pareto.failCount > 0 && rows.length > 0;
  const lossRatio =
    pareto.testedCount > 0 ? pareto.failCount / pareto.testedCount : 0;

  return (
    <section
      ref={sectionRef}
      aria-labelledby={headingId}
      data-testid="bin-pareto"
      data-mode={mode}
      {...{ [DISCLOSURE_SCOPE_ATTR]: '' }}
      className={cn(
        'rounded-[24px] border border-hairline bg-surface/65 p-5 shadow-card sm:p-6',
        className,
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <h2
          id={headingId}
          className="min-w-0 type-title-2 text-balance text-text-primary"
        >
          {t('pareto.title')}
        </h2>
        <SegmentedControl
          data-testid="bin-pareto-mode"
          ariaLabel={t('pareto.modeAria')}
          size="sm"
          options={modeOptions}
          value={mode}
          onValueChange={setMode}
        />
      </div>

      {!hasLoss ? (
        <p
          data-testid="bin-pareto-empty"
          className="mt-2 type-callout text-pretty text-text-secondary"
        >
          {pareto.testedCount === 0
            ? t('empty.noResults.title')
            : t('pareto.empty')}
        </p>
      ) : (
        <>
          <p
            data-testid="bin-pareto-takeaway"
            className="mt-2 line-clamp-2 max-w-[520px] type-body text-pretty text-text-secondary"
          >
            {t('pareto.takeaway', {
              share: formatPercent(pareto.entries[0]!.shareOfFailures),
            })}
          </p>

          <div className="at-well-crisp mt-5 flex flex-wrap items-center justify-between gap-3 rounded-[16px] px-4 py-3">
            <p
              data-testid="bin-pareto-loss"
              className="flex items-baseline gap-2"
            >
              <span className="type-stat-s text-text-primary tabular-nums">
                <CountUp
                  value={lossRatio}
                  format={formatPercent}
                  playKey={lot.lotId}
                />
              </span>
              <span className="type-subhead text-text-tertiary">
                {t('pareto.lossLabel')}
              </span>
            </p>
            <span aria-hidden="true" className="inline-flex items-center gap-1">
              {Array.from({ length: 12 }, (_, idx) => {
                const filled = idx < Math.max(1, Math.round(lossRatio * 12));
                return (
                  <span
                    key={idx}
                    className={cn(
                      'h-2.5 w-1.5 rounded-[2px]',
                      filled ? 'bg-ember-mark' : 'bg-fill-2',
                    )}
                  />
                );
              })}
            </span>
          </div>

          <div className="mt-6 flex items-baseline justify-between gap-4 type-subhead text-text-tertiary">
            <span id={chartLabelId}>
              <GlossaryText text={t('pareto.chartLabel')} terms={CHART_LABEL_TERMS} />
            </span>
            <span>{t('pareto.axisLabel')}</span>
          </div>

          <ul
            ref={disclosure.listRef}
            data-testid="bin-pareto-rows"
            aria-labelledby={chartLabelId}
            className="@container mt-2 -mx-3 flex flex-col"
          >
            {rows.map((entry) => {
              const isFiltered = entry.binCode === activeFilterCode;
              const isHighlighted = highlightedCodes.has(entry.binCode);
              const isSelected = isFiltered || isHighlighted;
              const code = `${mode} ${entry.binCode}`;
              const label = `${code}${entry.binName ? ` ${entry.binName}` : ''}`;
              const tone = resolveParetoBarTone(
                rankByCode.get(entry.binCode),
                isSelected,
              );
              const diesLabel = tPlural('findings.dieCount', entry.count);
              const codeText = (
                <Untranslated className="block truncate type-row-title text-text-primary">
                  {code}
                </Untranslated>
              );
              return (
                <DisclosureListItem
                  key={entry.binCode}
                  revealOnMount={disclosure.revealNewRows}
                  reduced={reduced}
                  layoutEpoch={disclosure.layoutEpoch}
                  extra={
                    collapsedCodes !== null && !collapsedCodes.has(entry.binCode)
                  }
                  className="list-none"
                >
                  <button
                    type="button"
                    data-testid="bin-pareto-row"
                    data-bin-mode={mode}
                    data-bin-code={entry.binCode}
                    data-highlighted={isHighlighted ? 'true' : undefined}
                    data-selected={isSelected ? 'true' : undefined}
                    aria-pressed={isSelected}
                    aria-label={t('pareto.rowAria', {
                      bin: label,
                      dies: diesLabel,
                      share: formatPercent(entry.shareOfTested),
                    })}
                    onClick={() => handleToggle(entry.binCode)}
                    className={cn(
                      'grid h-10 w-full origin-center cursor-pointer appearance-none items-center gap-3 rounded-md border-0 px-3 text-left pointer-coarse:h-11',
                      'grid-cols-[88px_minmax(0,1fr)_56px_88px_56px] @max-md:grid-cols-[88px_minmax(0,1fr)_56px_56px]',
                      'transition-[background-color,scale] duration-120 ease-out active:scale-[0.985] active:bg-fill-2 motion-reduce:active:scale-100',
                      'focus-visible:shadow-focus-ring focus-visible:outline-none',
                      isSelected ? 'bg-fill-2' : 'bg-transparent hover:bg-fill-1',
                    )}
                  >
                    {entry.binName ? (
                      <Tooltip content={<Untranslated>{entry.binName}</Untranslated>}>
                        {codeText}
                      </Tooltip>
                    ) : (
                      codeText
                    )}
                    <span aria-hidden="true" className="block h-2">
                      <motion.span
                        data-testid="bin-pareto-bar"
                        data-bar-tone={tone}
                        initial={reduced ? false : { scaleX: 0 }}
                        whileInView={reduced ? undefined : { scaleX: 1 }}
                        viewport={{ once: true, amount: 0.2 }}
                        transition={
                          reduced
                            ? { duration: 0 }
                            : { duration: 0.45, ease: [0.22, 1, 0.36, 1] }
                        }
                        className={cn(
                          'block h-full origin-left rounded-xs transition-[background-color] duration-120 ease-out',
                          BAR_TONE_CLASS[tone],
                        )}
                        style={{
                          width: `${resolveParetoBarPercent(entry.count, maxCount)}%`,
                        }}
                      />
                    </span>
                    <span className="text-right type-subhead text-text-primary tabular-nums">
                      {formatPercent(entry.shareOfTested)}
                    </span>
                    <span
                      className={cn(
                        'truncate text-right type-subhead tabular-nums @max-md:hidden',
                        isSelected
                          ? 'text-text-secondary'
                          : 'text-text-tertiary',
                      )}
                    >
                      {diesLabel}
                    </span>
                    <span
                      data-testid="bin-pareto-pill"
                      className="inline-flex h-6 items-center justify-self-end rounded-pill bg-fill-2 px-2 type-caption text-text-primary tabular-nums"
                    >
                      {/* §11.5: pills count up once per lot; rows shown later read final */}
                      <CountUp
                        value={entry.shareOfFailures}
                        format={formatPercent}
                        playKey={lot.lotId}
                        play={playPills}
                      />
                    </span>
                  </button>
                </DisclosureListItem>
              );
            })}
          </ul>

          {pareto.entries.length > PARETO_COLLAPSED_ROW_COUNT ? (
            <DisclosureGlide
              reduced={reduced}
              layoutEpoch={disclosure.layoutEpoch}
              className="mt-4"
            >
              <Button
                variant="text"
                data-testid="bin-pareto-expand"
                aria-expanded={expanded}
                onClick={disclosure.toggle}
              >
                {expanded
                  ? t('pareto.showFewer')
                  : t('pareto.showAll', {
                      count: formatInteger(pareto.entries.length),
                    })}
              </Button>
            </DisclosureGlide>
          ) : null}

          {/* Accessible tabular summary for screen readers (Req 14.4, premium §7.9) */}
          <div className="sr-only">
            <table data-testid="bin-pareto-sr-table">
              <caption>{t('pareto.chartLabel')}</caption>
              <thead>
                <tr>
                  <th scope="col">
                    {mode === 'SBIN'
                      ? t('mode.softBins')
                      : t('mode.hardBins')}
                  </th>
                  <th scope="col">{t('legend.failed')}</th>
                  <th scope="col">{t('pareto.lossLabel')}</th>
                  <th scope="col">{t('pareto.axisLabel')}</th>
                </tr>
              </thead>
              <tbody>
                {pareto.entries.map((entry) => {
                  const code = `${mode} ${entry.binCode}`;
                  const label = `${code}${entry.binName ? ` ${entry.binName}` : ''}`;
                  return (
                    <tr key={entry.binCode}>
                      <th scope="row">{label}</th>
                      <td>{tPlural('findings.dieCount', entry.count)}</td>
                      <td>{formatPercent(entry.shareOfTested)}</td>
                      <td>{formatPercent(entry.shareOfFailures)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}

/** Bar fills per tone (premium §7.9, §11.3). */
const BAR_TONE_CLASS: Readonly<Record<ParetoBarTone, string>> = {
  dominant: 'bg-ember-mark',
  selected: 'bg-ink dark:bg-text-primary',
  neutral: 'border border-hairline-strong bg-bar-neutral/40',
};
