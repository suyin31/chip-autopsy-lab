import type { YieldMetrics } from '@/core/analytics';
import type { LotModel } from '@/core/model';
import type { EngineFact } from '@/core/report';

/** Wafer rows shown while the wafer table is collapsed. */
export const YIELD_COLLAPSED_WAFER_COUNT = 5;

/** Lots with at most this many wafers show every row, so no disclosure is needed. */
export const YIELD_ALWAYS_EXPANDED_WAFER_COUNT = 6;

/** Whether the wafer table needs a "Show all" disclosure. */
export function isWaferTableCollapsible(waferCount: number): boolean {
  return waferCount > YIELD_ALWAYS_EXPANDED_WAFER_COUNT;
}

/**
 * Wafer indices to draw, ascending. Collapsed, the table keeps the lowest final-yield wafers
 * (`null` yields rank lowest of all, ties break by wafer index) so the outliers stay visible,
 * plus every pinned wafer (the scoped one). Expanded, or when the lot is short, all wafers show.
 */
export function selectWaferRowIndices(
  byWafer: readonly YieldMetrics[],
  expanded: boolean,
  isPinned: (waferIndex: number) => boolean,
): readonly number[] {
  const all = byWafer.map((_, index) => index);
  if (expanded || !isWaferTableCollapsible(byWafer.length)) {
    return all;
  }
  const lowest = [...all]
    .sort((a, b) => {
      const ya = byWafer[a]!.finalYield ?? -1;
      const yb = byWafer[b]!.finalYield ?? -1;
      return ya - yb || a - b;
    })
    .slice(0, YIELD_COLLAPSED_WAFER_COUNT);
  const keep = new Set<number>(lowest);
  for (const index of all) {
    if (isPinned(index)) {
      keep.add(index);
    }
  }
  return all.filter((index) => keep.has(index));
}

/**
 * Dense `LotModel.sites` indices that the engine flagged as a site-concentration anomaly
 * (`site-anomaly` facts, Requirement 7.4).
 */
export function resolveAnomalousSiteIndices(
  lot: LotModel,
  facts: readonly EngineFact[] | undefined,
): ReadonlySet<number> {
  const out = new Set<number>();
  if (!facts) {
    return out;
  }
  for (const fact of facts) {
    if (fact.kind !== 'site-anomaly' || fact.siteRef === undefined) {
      continue;
    }
    const { headNum, siteNum } = fact.siteRef;
    for (const site of lot.sites) {
      if (site.headNum === headNum && site.siteNum === siteNum) {
        out.add(site.siteIndex);
      }
    }
  }
  return out;
}
