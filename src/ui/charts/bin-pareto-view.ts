import type { BinParetoEntry } from '@/core/analytics';
import type { BinMode, ColumnarDies, LotModel } from '@/core/model';
import {
  type BinSelectionFilter,
  deriveSelectionMasks,
  type FilterDslAst,
  type SpatialBrushRect,
} from '@/ui/state';

/** Rows shown before "Show all N bins" (premium §7.9: the top 6 loss bins). */
export const PARETO_COLLAPSED_ROW_COUNT = 6;

/** Narrowest bar, so a single failing die stays visible. */
export const PARETO_MIN_BAR_PERCENT = 0.6;

/**
 * Bar tone (premium §7.9, §11.3): the top-loss bin (fail-bin rank 0, the disc's ember bin) is
 * solid `ember-mark`, selected or linked; any other selected bin is solid `ink`; the rest are
 * ghosted `bar-neutral` with a hairline outline.
 */
export type ParetoBarTone = 'dominant' | 'selected' | 'neutral';

export function resolveParetoBarTone(
  failBinRank: number | undefined,
  selected: boolean,
): ParetoBarTone {
  if (failBinRank === 0) return 'dominant';
  return selected ? 'selected' : 'neutral';
}

/** Bar width in percent: loss share over the largest loss share, so the top bar fills the column. */
export function resolveParetoBarPercent(count: number, maxCount: number): number {
  if (maxCount <= 0 || count <= 0) return 0;
  return Math.max(PARETO_MIN_BAR_PERCENT, Math.min(100, (count / maxCount) * 100));
}

export interface ParetoMaskInputs {
  readonly brush: SpatialBrushRect | null;
  readonly binFilter: BinSelectionFilter | null;
  readonly siteFilter: number | null;
  readonly waferFilter?: number | null;
  readonly dslFilter: FilterDslAst | null;
  readonly hasActiveFilter: boolean;
  readonly selectedDieMask: Uint8Array;
}

/**
 * Selection mask the Pareto counts over (Requirement 6.5): the active brush, site, wafer, and
 * filter-DSL selection. The Pareto's own bin filter is left out, so clicking a bar keeps the
 * other bars visible and a second click can switch or clear the filter.
 *
 * Returns `undefined` when no other filter is active (the whole lot).
 */
export function resolveParetoMask(
  lot: LotModel,
  inputs: ParetoMaskInputs,
): Uint8Array | undefined {
  if (!inputs.hasActiveFilter) {
    return undefined;
  }
  if (inputs.binFilter === null) {
    return inputs.selectedDieMask;
  }
  const withoutBin = deriveSelectionMasks(lot, {
    brush: inputs.brush,
    binFilter: null,
    siteFilter: inputs.siteFilter,
    waferFilter: inputs.waferFilter ?? null,
    dslFilter: inputs.dslFilter,
    claimHighlight: null,
  });
  return withoutBin.hasActiveFilter ? withoutBin.selectedDieMask : undefined;
}

/**
 * Entries to draw: the first `PARETO_COLLAPSED_ROW_COUNT` unless expanded. Rows that are
 * highlighted by a claim or selected as the bin filter always stay visible, in rank order.
 */
export function selectParetoRows(
  entries: readonly BinParetoEntry[],
  expanded: boolean,
  isPinned: (entry: BinParetoEntry) => boolean,
): readonly BinParetoEntry[] {
  if (expanded || entries.length <= PARETO_COLLAPSED_ROW_COUNT) {
    return entries;
  }
  return entries.filter(
    (entry, index) => index < PARETO_COLLAPSED_ROW_COUNT || isPinned(entry),
  );
}

/** Mode a claim's cited bins imply, or `null` when the current mode already has one. */
export function resolveClaimParetoMode(
  currentMode: BinMode,
  citedBins: ReadonlyArray<{ readonly mode: BinMode; readonly code: number }> | undefined,
): BinMode | null {
  if (!citedBins || citedBins.length === 0) {
    return null;
  }
  if (citedBins.some((bin) => bin.mode === currentMode)) {
    return null;
  }
  return citedBins[0]!.mode;
}

/**
 * Pareto row a claim without a cited bin of `mode` matches (premium §7.9, §8.3): the bin holding
 * most of the claim's failing dies, lowest code on a tie. `null` when the claim cites no failing die.
 */
export function resolveClaimMatchedBinCode(
  dies: ColumnarDies,
  mode: BinMode,
  dieIndices: Uint32Array,
): number | null {
  const binArr = mode === 'SBIN' ? dies.sbin : dies.hbin;
  const counts = new Map<number, number>();
  for (let i = 0; i < dieIndices.length; i += 1) {
    const index = dieIndices[i]!;
    if (index >= dies.count || dies.finalPass[index] !== 0) continue;
    const code = binArr[index]!;
    counts.set(code, (counts.get(code) ?? 0) + 1);
  }
  let best: number | null = null;
  let bestCount = 0;
  for (const [code, count] of counts) {
    if (count > bestCount || (count === bestCount && best !== null && code < best)) {
      best = code;
      bestCount = count;
    }
  }
  return best;
}
