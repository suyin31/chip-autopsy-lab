/**
 * Stacked multi-wafer failure heatmap aggregation (`src/core/analytics/stacked-heatmap.ts`).
 *
 * Pure deterministic TypeScript with zero React, Next.js, or DOM imports.
 * Aggregates per-`(X, Y)` tested wafer counts, resolved final-state failing die counts,
 * failure rates, and dominant failing `SBIN`/`HBIN` across all wafers in a lot (or a
 * requested wafer subset). Structurally compatible with `StackedPatternCellInput`.
 *
 * Validates: Requirements 5.2, 5.4, Property 6
 */

import { type LotModel, packWaferCoord } from '../model/types';
import { STDF_MISSING_COORD, STDF_MISSING_U2 } from '../stdf/types';

export interface StackedCellStat {
  readonly x: number;
  readonly y: number;
  readonly testedWaferCount: number;
  readonly failCount: number;
  /** `failCount / testedWaferCount` in `[0, 1]`. */
  readonly failRate: number;
  /** Most frequent failing `SBIN` at `(x, y)` (lowest code breaks ties), or `null`. */
  readonly dominantSbin: number | null;
  /** Most frequent failing `HBIN` at `(x, y)` (lowest code breaks ties), or `null`. */
  readonly dominantHbin: number | null;
  /** Ascending global die indices into `LotModel.dies` for failing dies at `(x, y)`. */
  readonly failingDieIndices: Uint32Array;
}

export interface StackedHeatmapSummary {
  readonly waferCount: number;
  readonly cellCount: number;
  readonly totalFailingDies: number;
  readonly maxFailRate: number;
  /** Highest-fail-rate cell (ties broken by highest `failCount`, then coordinate order), or `null` if no failures exist. */
  readonly peakCell: StackedCellStat | null;
  readonly minX: number;
  readonly maxX: number;
  readonly minY: number;
  readonly maxY: number;
  /** O(1) coordinate lookup keyed by `packWaferCoord(x, y)`. */
  readonly cellByCoord: ReadonlyMap<number, StackedCellStat>;
}

interface MutableCellBucket {
  readonly x: number;
  readonly y: number;
  testedWaferCount: number;
  readonly failDieIndices: number[];
  sbinCounts: Map<number, number> | null;
  hbinCounts: Map<number, number> | null;
}

function pickDominantBinCode(counts: Map<number, number> | null): number | null {
  if (counts === null || counts.size === 0) {
    return null;
  }
  let bestCode: number | null = null;
  let bestCount = 0;
  for (const [code, count] of counts.entries()) {
    if (
      count > bestCount ||
      (count === bestCount && bestCode !== null && code < bestCode)
    ) {
      bestCount = count;
      bestCode = code;
    }
  }
  return bestCode;
}

/**
 * Aggregates coordinate-bearing resolved final dies across all wafers in `lot`
 * (or the wafer indices contained in `waferSubset`) into per-`(x, y)` failure
 * density cells sorted deterministically by `packWaferCoord(x, y)`.
 */
export function computeStackedHeatmap(
  lot: LotModel,
  waferSubset?: ReadonlySet<number>,
): readonly StackedCellStat[] {
  const { wafers, dies } = lot;
  if (wafers.length === 0 || dies.count === 0) {
    return [];
  }
  if (waferSubset !== undefined && waferSubset.size === 0) {
    return [];
  }

  const byCoord = new Map<number, MutableCellBucket>();
  const { hasValidCoords, x: xArr, y: yArr, finalPass, sbin, hbin } = dies;

  for (let w = 0; w < wafers.length; w += 1) {
    if (waferSubset !== undefined && !waferSubset.has(w)) {
      continue;
    }
    const wafer = wafers[w]!;
    for (let i = wafer.dieStartIndex; i < wafer.dieEndIndex; i += 1) {
      if (hasValidCoords[i] === 0) {
        continue;
      }
      const x = xArr[i]!;
      const y = yArr[i]!;
      if (x === STDF_MISSING_COORD || y === STDF_MISSING_COORD) {
        continue;
      }

      const key = packWaferCoord(x, y);
      let bucket = byCoord.get(key);
      if (bucket === undefined) {
        bucket = {
          x,
          y,
          testedWaferCount: 0,
          failDieIndices: [],
          sbinCounts: null,
          hbinCounts: null,
        };
        byCoord.set(key, bucket);
      }

      bucket.testedWaferCount += 1;
      if (finalPass[i] === 0) {
        bucket.failDieIndices.push(i);
        const h = hbin[i]!;
        if (bucket.hbinCounts === null) {
          bucket.hbinCounts = new Map<number, number>();
        }
        bucket.hbinCounts.set(h, (bucket.hbinCounts.get(h) ?? 0) + 1);

        const s = sbin[i]!;
        if (s !== STDF_MISSING_U2) {
          if (bucket.sbinCounts === null) {
            bucket.sbinCounts = new Map<number, number>();
          }
          bucket.sbinCounts.set(s, (bucket.sbinCounts.get(s) ?? 0) + 1);
        }
      }
    }
  }

  if (byCoord.size === 0) {
    return [];
  }

  const sortedKeys = Array.from(byCoord.keys()).sort((a, b) => a - b);
  const cells: StackedCellStat[] = new Array<StackedCellStat>(sortedKeys.length);

  for (let k = 0; k < sortedKeys.length; k += 1) {
    const bucket = byCoord.get(sortedKeys[k]!)!;
    const failCount = bucket.failDieIndices.length;
    cells[k] = {
      x: bucket.x,
      y: bucket.y,
      testedWaferCount: bucket.testedWaferCount,
      failCount,
      failRate:
        bucket.testedWaferCount > 0 ? failCount / bucket.testedWaferCount : 0,
      dominantSbin:
        failCount > 0 ? pickDominantBinCode(bucket.sbinCounts) : null,
      dominantHbin:
        failCount > 0 ? pickDominantBinCode(bucket.hbinCounts) : null,
      failingDieIndices: Uint32Array.from(bucket.failDieIndices),
    };
  }

  return cells;
}

/**
 * Derives grid bounds, peak hot-spot cell, total failing dies, and an O(1)
 * coordinate lookup map from the output of `computeStackedHeatmap`.
 */
export function computeStackedHeatmapSummary(
  cells: readonly StackedCellStat[],
  waferCount: number,
): StackedHeatmapSummary {
  const cellByCoord = new Map<number, StackedCellStat>();
  if (cells.length === 0) {
    return {
      waferCount,
      cellCount: 0,
      totalFailingDies: 0,
      maxFailRate: 0,
      peakCell: null,
      minX: 0,
      maxX: 0,
      minY: 0,
      maxY: 0,
      cellByCoord,
    };
  }

  let totalFailingDies = 0;
  let maxFailRate = 0;
  let peakCell: StackedCellStat | null = null;
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (let i = 0; i < cells.length; i += 1) {
    const cell = cells[i]!;
    cellByCoord.set(packWaferCoord(cell.x, cell.y), cell);
    totalFailingDies += cell.failCount;
    if (cell.x < minX) minX = cell.x;
    if (cell.x > maxX) maxX = cell.x;
    if (cell.y < minY) minY = cell.y;
    if (cell.y > maxY) maxY = cell.y;
    if (
      cell.failCount > 0 &&
      (peakCell === null ||
        cell.failRate > maxFailRate ||
        (cell.failRate === maxFailRate && cell.failCount > peakCell.failCount))
    ) {
      maxFailRate = cell.failRate;
      peakCell = cell;
    }
  }

  return {
    waferCount,
    cellCount: cells.length,
    totalFailingDies,
    maxFailRate,
    peakCell,
    minX,
    maxX,
    minY,
    maxY,
    cellByCoord,
  };
}
