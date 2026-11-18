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

/** The panel's one-sentence takeaway (premium §7.10 step 2). */
export type YieldTakeaway =
  | {
      readonly kind: 'site';
      /** `LotModel.sites[].label`, e.g. `"1:2"`. */
      readonly siteLabel: string;
      /** Engine first-pass yield of the flagged site, as a ratio. */
      readonly yieldRatio: number;
      /** Engine first-pass yield drop against the other sites, in percentage points. */
      readonly points: number;
    }
  | {
      readonly kind: 'retests';
      /** Final minus first-pass lot yield, in percentage points. */
      readonly points: number;
    };

/**
 * A lot with a flagged site states the site's yield and its drop from the engine's first
 * `site-anomaly` fact. Otherwise the takeaway states how many points retests recovered. Lots
 * without retests or without both yields have no takeaway.
 */
export function resolveYieldTakeaway(
  lot: LotModel,
  overall: YieldMetrics,
  facts: readonly EngineFact[] | undefined,
): YieldTakeaway | null {
  const anomaly = facts?.find(
    (f) => f.kind === 'site-anomaly' && f.siteRef !== undefined,
  );
  if (anomaly?.siteRef !== undefined) {
    const { headNum, siteNum } = anomaly.siteRef;
    const site = lot.sites.find(
      (s) => s.headNum === headNum && s.siteNum === siteNum,
    );
    const yieldPct = anomaly.metrics.find(
      (m) => m.key === 'firstPassYieldPct',
    )?.numericValue;
    const drop = anomaly.metrics.find((m) => m.key === 'yieldDropPp')
      ?.numericValue;
    if (site !== undefined && yieldPct !== undefined && drop !== undefined) {
      return {
        kind: 'site',
        siteLabel: site.label,
        yieldRatio: yieldPct / 100,
        points: drop,
      };
    }
  }
  if (
    overall.retestExecutions > 0 &&
    overall.finalYield !== null &&
    overall.firstPassYield !== null
  ) {
    return {
      kind: 'retests',
      points: Math.max(0, (overall.finalYield - overall.firstPassYield) * 100),
    };
  }
  return null;
}
