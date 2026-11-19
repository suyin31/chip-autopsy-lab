/**
 * Pure view-model, sorting, scrub hit-testing, and takeaway helpers for the Parametric Analysis
 * panel and histogram (`src/ui/charts/parametric-view.ts`).
 *
 * Validates: Requirements 8.1, 8.2, 8.5, 14.5
 */

import type {
  ParametricCapabilitySummary,
  ParametricHistogram,
  ParametricHistogramBin,
} from '@/core/analytics';

export type ParametricSortKey =
  | 'testNum'
  | 'testName'
  | 'units'
  | 'n'
  | 'failCount'
  | 'mean'
  | 'sigma'
  | 'cp'
  | 'cpk';

export type SortDirection = 'asc' | 'desc';

export interface ParametricSortState {
  readonly key: ParametricSortKey;
  readonly direction: SortDirection;
}

export const DEFAULT_PARAMETRIC_SORT: ParametricSortState = {
  key: 'cpk',
  direction: 'asc',
};

export const LOW_CPK_TARGET = 1.33 as const;

export type ParametricTakeaway =
  | {
      readonly kind: 'lowCpk';
      readonly testName: string;
      readonly testNum: number;
      readonly cpk: number;
    }
  | {
      readonly kind: 'healthy';
      readonly count: number;
    }
  | {
      readonly kind: 'noLimits';
      readonly count: number;
    };

function compareNullableNumbers(
  a: number | null,
  b: number | null,
  direction: SortDirection,
): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1; // Always keep N/A rows at the bottom
  if (b === null) return -1;
  return direction === 'asc' ? a - b : b - a;
}

/**
 * Deterministically sorts parametric test summaries for the catalog table.
 * Null metrics (`Cp` / `Cpk` / `mean` / `sigma` = `null`) always sort to the end;
 * ties break deterministically by ascending `testNum`.
 */
export function sortParametricSummaries(
  summaries: readonly ParametricCapabilitySummary[],
  sort: ParametricSortState,
): readonly ParametricCapabilitySummary[] {
  if (summaries.length <= 1) {
    return summaries;
  }
  const copy = [...summaries];
  const dir = sort.direction === 'asc' ? 1 : -1;

  copy.sort((a, b) => {
    let cmp = 0;
    switch (sort.key) {
      case 'testNum':
        cmp = (a.testNum - b.testNum) * dir;
        break;
      case 'testName':
        cmp = a.testName.localeCompare(b.testName) * dir;
        break;
      case 'units':
        cmp = a.units.localeCompare(b.units) * dir;
        break;
      case 'n':
        cmp = (a.n - b.n) * dir;
        break;
      case 'failCount':
        cmp = (a.failCount - b.failCount) * dir;
        break;
      case 'mean':
        cmp = compareNullableNumbers(a.mean, b.mean, sort.direction);
        break;
      case 'sigma':
        cmp = compareNullableNumbers(a.sigma, b.sigma, sort.direction);
        break;
      case 'cp':
        cmp = compareNullableNumbers(a.cp, b.cp, sort.direction);
        break;
      case 'cpk':
        cmp = compareNullableNumbers(a.cpk, b.cpk, sort.direction);
        break;
    }
    if (cmp !== 0) {
      return cmp;
    }
    return a.testNum - b.testNum;
  });

  return copy;
}

/**
 * Returns the next sort state when clicking a catalog column header.
 * Switching to a new column defaults numeric counts/fails to `'desc'` and capability/identifiers
 * to `'asc'`; clicking the active column toggles direction.
 */
export function toggleParametricSort(
  current: ParametricSortState,
  clickedKey: ParametricSortKey,
): ParametricSortState {
  if (current.key === clickedKey) {
    return {
      key: clickedKey,
      direction: current.direction === 'asc' ? 'desc' : 'asc',
    };
  }
  const defaultDesc = clickedKey === 'failCount' || clickedKey === 'n';
  return {
    key: clickedKey,
    direction: defaultDesc ? 'desc' : 'asc',
  };
}

/**
 * Resolves the active parametric test number: keeps `requestedTestNum` if present in `summaries`,
 * otherwise picks the lowest-`Cpk` test (or the first summary if no test has a finite `Cpk`).
 */
export function resolveActiveParametricTestNum(
  summaries: readonly ParametricCapabilitySummary[],
  requestedTestNum: number | null,
): number | null {
  if (summaries.length === 0) {
    return null;
  }
  if (
    requestedTestNum !== null &&
    summaries.some((s) => s.testNum === requestedTestNum)
  ) {
    return requestedTestNum;
  }
  const byCpk = sortParametricSummaries(summaries, DEFAULT_PARAMETRIC_SORT);
  return byCpk[0]?.testNum ?? summaries[0]!.testNum;
}

/**
 * Builds the plain-language one-sentence takeaway for the Parametric section card.
 */
export function resolveParametricTakeaway(
  summaries: readonly ParametricCapabilitySummary[],
): ParametricTakeaway | null {
  if (summaries.length === 0) {
    return null;
  }
  let worst: ParametricCapabilitySummary | null = null;
  let anyValidCpk = false;
  for (const s of summaries) {
    if (s.cpk === null) continue;
    anyValidCpk = true;
    if (
      worst === null ||
      s.cpk < worst.cpk! ||
      (s.cpk === worst.cpk! && s.testNum < worst.testNum)
    ) {
      worst = s;
    }
  }
  if (!anyValidCpk || worst === null) {
    return { kind: 'noLimits', count: summaries.length };
  }
  if (worst.cpk! < LOW_CPK_TARGET) {
    return {
      kind: 'lowCpk',
      testName: worst.testName || `Test ${worst.testNum}`,
      testNum: worst.testNum,
      cpk: worst.cpk!,
    };
  }
  return { kind: 'healthy', count: summaries.length };
}

/**
 * Resolves which histogram bin corresponds to a local pointer X coordinate in `[0, plotWidth]`.
 */
export function resolveScrubBinAtX(
  histogram: ParametricHistogram,
  localX: number,
  plotWidth: number,
): ParametricHistogramBin | null {
  if (
    histogram.bins.length === 0 ||
    histogram.domainMin === null ||
    histogram.domainMax === null ||
    plotWidth <= 0
  ) {
    return null;
  }
  const clampedX = Math.max(0, Math.min(plotWidth, localX));
  const span = histogram.domainMax - histogram.domainMin;
  if (span <= 0) {
    return histogram.bins[0] ?? null;
  }
  const valueAtPointer =
    histogram.domainMin + (clampedX / plotWidth) * span;

  // Find bin containing valueAtPointer; otherwise pick nearest bin by center
  let nearest = histogram.bins[0]!;
  let nearestDist = Number.POSITIVE_INFINITY;

  for (let i = 0; i < histogram.bins.length; i += 1) {
    const bin = histogram.bins[i]!;
    const isLast = i === histogram.bins.length - 1;
    if (
      valueAtPointer >= bin.x0 &&
      (isLast ? valueAtPointer <= bin.x1 : valueAtPointer < bin.x1)
    ) {
      return bin;
    }
    const center = (bin.x0 + bin.x1) / 2;
    const dist = Math.abs(valueAtPointer - center);
    if (dist < nearestDist) {
      nearestDist = dist;
      nearest = bin;
    }
  }

  return nearest;
}

/**
 * Computes SVG textAnchor alignment for a limit marker label so it stays inside `[0, plotWidth]`.
 */
export function resolveLimitLabelAnchor(
  markerX: number,
  plotWidth: number,
  edgeThresholdPx = 56,
): 'start' | 'middle' | 'end' {
  if (markerX <= edgeThresholdPx) {
    return 'start';
  }
  if (markerX >= plotWidth - edgeThresholdPx) {
    return 'end';
  }
  return 'middle';
}
