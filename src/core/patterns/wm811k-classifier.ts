/**
 * Deterministic, weightless, D4-invariant 9-class WM-811K spatial failure-pattern
 * classifier for single wafers and multi-wafer stacked failure heatmaps
 * (`src/core/patterns/wm811k-classifier.ts`).
 *
 * Pure deterministic TypeScript with zero ML weights, zero bundled datasets,
 * zero network calls, and zero React/Next.js/DOM imports.
 *
 * Validates: Requirements 9.1, 9.2, 9.3, 9.4, 17.7
 */

import { computeWaferEdgeRingIndices } from '../model/lot-builder';
import {
  type DieId,
  type LotModel,
  packWaferCoord,
  STDF_MISSING_COORD,
} from '../model/types';
import {
  formatPatternCandidateHypotheses,
  type ScoredWm811kClass,
  WM811K_CLASSES,
  type Wm811kClass,
} from './root-causes';

export { type ScoredWm811kClass, WM811K_CLASSES, type Wm811kClass };

export const CLASSIFIER_THRESHOLDS = {
  /** `< 1.5%` active failing cells classifies as `'None'`. */
  MIN_FAIL_FRACTION: 0.015,
  /** `< 5` active failing cells classifies as `'None'`. */
  MIN_FAIL_COUNT: 5,
  /** Top raw class score `< 0.45` classifies as `'None'`. */
  MIN_CLASS_CONFIDENCE: 0.45,
  /** Multi-wafer cell is active when `failRate >= 0.20 && failCount >= min(2, waferCount)`. */
  STACK_CELL_MIN_FAIL_RATE: 0.2,
  /** Center disc normalized radius ceiling (`rho <= 0.38`). */
  INNER_RHO_MAX: 0.38,
  /** Donut annulus outer normalized radius ceiling (`0.38 < rho <= 0.75`). */
  MID_RHO_MAX: 0.75,
  /** Outer 3 4-neighbour rings define the wafer periphery (`ringIndex <= 3`). */
  EDGE_RING_BAND: 3,
  /** Bridges 1-die dropouts (`0 < ||p - q||_2 <= 2.25`, i.e. `dx^2 + dy^2 <= 5`). */
  BRIDGE_RADIUS_EUCLIDEAN: 2.25,
  /** Heuristic feature scores cap at `0.98` (`1.00` reserved for zero-failure `'None'`). */
  CONFIDENCE_CAP: 0.98,
} as const;

export const MIN_FAIL_FRACTION = CLASSIFIER_THRESHOLDS.MIN_FAIL_FRACTION;
export const MIN_FAIL_COUNT = CLASSIFIER_THRESHOLDS.MIN_FAIL_COUNT;
export const MIN_CLASS_CONFIDENCE = CLASSIFIER_THRESHOLDS.MIN_CLASS_CONFIDENCE;
export const STACK_CELL_MIN_FAIL_RATE = CLASSIFIER_THRESHOLDS.STACK_CELL_MIN_FAIL_RATE;

/**
 * Deterministic tie-breaking priority order from `design.md` Section 3.4 Step 7.
 */
const CLASS_PRIORITY_ORDER: readonly ScoredWm811kClass[] = [
  'Near-full',
  'Scratch',
  'Edge-Ring',
  'Donut',
  'Center',
  'Edge-Loc',
  'Loc',
  'Random',
] as const;

const MIN_VALID_I2_COORD = -32767;
const MAX_VALID_I2_COORD = 32767;
const DENSE_FAIL_GRID_MAX_SPAN = 512;
const EXACT_INT_COV_MAX_HALF_SPAN = 2048;
const CENTER_EPSILON = 1e-6;
const SCORE_TIE_EPSILON = 1e-12;

/**
 * All 20 non-zero integer lattice offsets `(dx, dy)` satisfying
 * `0 < sqrt(dx^2 + dy^2) <= 2.25` (`1 <= dx^2 + dy^2 <= 5`).
 * The first 8 entries (`1 <= dx^2 + dy^2 <= 2`) are the exact 8-neighbours.
 */
const BRIDGE_NEIGHBOUR_DX: readonly number[] = [
  // 8-neighbours (indices 0..7): dx^2 + dy^2 in {1, 2}
  -1, 1, 0, 0, -1, -1, 1, 1,
  // Cardinal 2-step bridges (indices 8..11): dx^2 + dy^2 = 4
  -2, 2, 0, 0,
  // Knight-move bridges (indices 12..19): dx^2 + dy^2 = 5
  -2, -2, 2, 2, -1, -1, 1, 1,
];

const BRIDGE_NEIGHBOUR_DY: readonly number[] = [
  // 8-neighbours (indices 0..7)
  0, 0, -1, 1, -1, 1, -1, 1,
  // Cardinal 2-step bridges (indices 8..11)
  0, 0, -2, 2,
  // Knight-move bridges (indices 12..19)
  -1, 1, -1, 1, -2, 2, -2, 2,
];

const EIGHT_NEIGHBOUR_COUNT = 8;
const BRIDGE_NEIGHBOUR_COUNT = 20;

export interface SpatialFeatureSummary {
  readonly testedCellCount: number;
  readonly activeFailCellCount: number;
  readonly globalFailFraction: number;
  /** Fail density inside `rho <= 0.38`. */
  readonly innerZoneDensity: number;
  /** Fail density inside `0.38 < rho <= 0.75`. */
  readonly midZoneDensity: number;
  /** Fail density inside `rho > 0.75`. */
  readonly outerZoneDensity: number;
  /** Fail density inside outer 3 4-neighbour rings (`ringIndex <= 3`). */
  readonly edgeRing3Density: number;
  /** Fail density strictly inside the periphery (`ringIndex > 3`). */
  readonly interiorDensity: number;
  /** Share of active failing cells lying in `ringIndex <= 3` (`|F ∩ Z_edge3| / |F|`). */
  readonly edgeFailShare: number;
  /** Circular mean resultant length `||mean((p - c) / ||p - c||)||_2` in `[0, 1]`. */
  readonly angularResultant: number;
  /** Circular mean resultant length of edge failing cells (`ringIndex <= 3`) in `[0, 1]`. */
  readonly edgeAngularResultant: number;
  /** Share of active failing cells with at least one 8-neighbour in `F`. */
  readonly clusteredFailFraction: number;
  /** Maximum bridged-PCA elongation `1 - sqrt((lambda2 + 0.05) / (lambda1 + 0.05))` (`|C| >= 6`). */
  readonly maxScratchElongation: number;
  /** Maximum bridged-PCA major-to-minor aspect ratio `L_maj / W_min` (`|C| >= 6`). */
  readonly maxScratchAspectRatio: number;
  /** Largest bridged connected-component share `max(|C| / |F|)`. */
  readonly maxComponentShare: number;
}

export interface PatternClassification {
  readonly pattern: Wm811kClass;
  /** Heuristic feature score rounded to 2 decimals in `[0, 1]`. */
  readonly confidence: number;
  /** Raw unrounded `[0, 1]` feature scores for the 8 non-`'None'` classes (`design.md` 3.4). */
  readonly rawClassScores: Readonly<Record<ScoredWm811kClass, number>>;
  /** Per-class scores across all 9 `Wm811kClass` labels including `'None'`. */
  readonly classScores: Readonly<Record<Wm811kClass, number>>;
  readonly features: SpatialFeatureSummary;
  /** Sorted ascending `LotModel.dies` indices supporting the winning class (`empty` for `'None'`). */
  readonly signatureDieIndices: Uint32Array;
  /** Canonical `DieId`s matching `signatureDieIndices` for direct highlight binding. */
  readonly signatureDieIds: readonly DieId[];
  /** Hedged candidate fab/test root-cause hypotheses (`[]` when `pattern === 'None'`). */
  readonly candidateHypotheses: readonly string[];
}

/**
 * Structural cell input accepted by `classifyStackedPattern` (matches `StackedCellStat`
 * in `design.md` Section 3.3).
 */
export interface StackedPatternCellInput {
  readonly x: number;
  readonly y: number;
  readonly testedWaferCount: number;
  readonly failCount: number;
  readonly failRate: number;
  readonly failingDieIndices: Uint32Array;
}

interface SpatialGridInput {
  readonly testedCount: number;
  readonly x: Int32Array;
  readonly y: Int32Array;
  readonly ringIndex: Uint16Array;
  readonly isActiveFail: Uint8Array;
  /** Maps each cell `0 .. testedCount - 1` to its failing `LotModel.dies` index(es). */
  readonly cellFailDieIndices: ReadonlyArray<number | Uint32Array>;
}

interface PcaShapeMetrics {
  readonly meanX: number;
  readonly meanY: number;
  readonly sxx: number;
  readonly syy: number;
  readonly sxy: number;
  readonly eigDelta: number;
  readonly majorLength: number;
  readonly minorWidth: number;
  readonly elongation: number;
  readonly aspectRatio: number;
}

function computeMemberPcaMetrics(
  members: Uint32Array,
  failX: Int32Array,
  failY: Int32Array,
): PcaShapeMetrics {
  const size = members.length;
  let compMinX = failX[members[0]!]!;
  let compMaxX = compMinX;
  let compMinY = failY[members[0]!]!;
  let compMaxY = compMinY;

  for (let i = 1; i < size; i += 1) {
    const idx = members[i]!;
    const x = failX[idx]!;
    const y = failY[idx]!;
    if (x < compMinX) compMinX = x;
    if (x > compMaxX) compMaxX = x;
    if (y < compMinY) compMinY = y;
    if (y > compMaxY) compMaxY = y;
  }

  const midTwiceX = compMinX + compMaxX;
  const midTwiceY = compMinY + compMaxY;
  const canUseExactMidpointCov =
    compMaxX - compMinX <= EXACT_INT_COV_MAX_HALF_SPAN &&
    compMaxY - compMinY <= EXACT_INT_COV_MAX_HALF_SPAN;

  let meanX = 0;
  let meanY = 0;
  let sxx = 0;
  let syy = 0;
  let sxy = 0;

  if (canUseExactMidpointCov) {
    let sumU = 0;
    let sumV = 0;
    let sumU2 = 0;
    let sumV2 = 0;
    let sumUV = 0;
    for (let i = 0; i < size; i += 1) {
      const idx = members[i]!;
      const u = 2 * failX[idx]! - midTwiceX;
      const v = 2 * failY[idx]! - midTwiceY;
      sumU += u;
      sumV += v;
      sumU2 += u * u;
      sumV2 += v * v;
      sumUV += u * v;
    }
    const meanU = sumU / size;
    const meanV = sumV / size;
    meanX = 0.5 * (midTwiceX + meanU);
    meanY = 0.5 * (midTwiceY + meanV);
    sxx = 0.25 * Math.max(0, sumU2 / size - meanU * meanU);
    syy = 0.25 * Math.max(0, sumV2 / size - meanV * meanV);
    sxy = 0.25 * (sumUV / size - meanU * meanV);
  } else {
    let sumX = 0;
    let sumY = 0;
    for (let i = 0; i < size; i += 1) {
      const idx = members[i]!;
      sumX += failX[idx]!;
      sumY += failY[idx]!;
    }
    meanX = sumX / size;
    meanY = sumY / size;
    for (let i = 0; i < size; i += 1) {
      const idx = members[i]!;
      const dx = failX[idx]! - meanX;
      const dy = failY[idx]! - meanY;
      sxx += dx * dx;
      syy += dy * dy;
      sxy += dx * dy;
    }
    sxx /= size;
    syy /= size;
    sxy /= size;
  }

  if (size < 4) {
    return {
      meanX,
      meanY,
      sxx,
      syy,
      sxy,
      eigDelta: 0,
      majorLength: 1,
      minorWidth: 1,
      elongation: 0,
      aspectRatio: 1,
    };
  }

  const halfTrace = 0.5 * (sxx + syy);
  const halfDiff = 0.5 * (sxx - syy);
  const eigDelta = Math.hypot(halfDiff, sxy);
  const lambda1 = Math.max(0, halfTrace + eigDelta);
  const lambda2 = Math.max(0, halfTrace - eigDelta);

  const majorLength = Math.max(1, Math.sqrt(12 * lambda1));
  const minorWidth = Math.max(1, Math.sqrt(12 * lambda2));
  const elongation = clamp01(1 - Math.sqrt((lambda2 + 0.05) / (lambda1 + 0.05)));
  const aspectRatio = majorLength / minorWidth;

  return {
    meanX,
    meanY,
    sxx,
    syy,
    sxy,
    eigDelta,
    majorLength,
    minorWidth,
    elongation,
    aspectRatio,
  };
}

function evaluateScratchFormula(
  size: number,
  shareOfFails: number,
  edgeFrac2: number,
  majorLength: number,
  minorWidth: number,
  elongation: number,
  aspectRatio: number,
  rMax: number,
): number {
  if (size < 6) {
    return 0;
  }
  return (
    ramp(elongation, 0.72, 0.92) *
    ramp(aspectRatio, 3.2, 6.0) *
    ramp(majorLength / (2 * rMax), 0.25, 0.55) *
    ramp(3.6 - minorWidth, 0.0, 1.8) *
    ramp(shareOfFails, 0.25, 0.6) *
    (1 - 0.75 * ramp(edgeFrac2, 0.75, 0.95))
  );
}

/**
 * D4-invariant Hough/line-band extractor along an elongated component's principal axis:
 * reunites collinear scratch segments separated by 2-die diagonal dropouts while
 * trimming off-axis background point defects that bridged onto the scratch flank.
 */
function extractPrincipalLineBandRun(
  pca: PcaShapeMetrics,
  failX: Int32Array,
  failY: Int32Array,
): Uint32Array | null {
  if (pca.eigDelta <= 1e-9) {
    return null;
  }

  let vx: number;
  let vy: number;
  if (pca.sxx >= pca.syy) {
    vx = pca.sxx - pca.syy + 2 * pca.eigDelta;
    vy = 2 * pca.sxy;
  } else {
    vx = 2 * pca.sxy;
    vy = pca.syy - pca.sxx + 2 * pca.eigDelta;
  }
  const vNorm = Math.hypot(vx, vy);
  if (vNorm <= 1e-12) {
    return null;
  }

  const tx = vx / vNorm;
  const ty = vy / vNorm;
  const nx = -ty;
  const ny = tx;

  const inliers: Array<{ readonly idx: number; readonly proj: number }> = [];
  const failCount = failX.length;
  for (let i = 0; i < failCount; i += 1) {
    const dx = failX[i]! - pca.meanX;
    const dy = failY[i]! - pca.meanY;
    if (Math.abs(dx * nx + dy * ny) <= 1.45) {
      inliers.push({ idx: i, proj: dx * tx + dy * ty });
    }
  }

  if (inliers.length < 6) {
    return null;
  }

  inliers.sort((a, b) => a.proj - b.proj || a.idx - b.idx);

  let bestStart = 0;
  let bestLen = 1;
  let runStart = 0;

  for (let i = 1; i < inliers.length; i += 1) {
    if (inliers[i]!.proj - inliers[i - 1]!.proj > 3.5) {
      const runLen = i - runStart;
      if (runLen > bestLen) {
        bestLen = runLen;
        bestStart = runStart;
      }
      runStart = i;
    }
  }
  const tailLen = inliers.length - runStart;
  if (tailLen > bestLen) {
    bestLen = tailLen;
    bestStart = runStart;
  }

  if (bestLen < 6) {
    return null;
  }

  const out = new Uint32Array(bestLen);
  for (let i = 0; i < bestLen; i += 1) {
    out[i] = inliers[bestStart + i]!.idx;
  }
  return out;
}

interface BridgedComponentStats {
  /** Indices into the active-fail array `0 .. F - 1`. */
  readonly failLocalIndices: Uint32Array;
  /** Indices into `0 .. F - 1` supporting the linear scratch spine (if refined). */
  readonly scratchFailLocalIndices: Uint32Array;
  readonly size: number;
  readonly shareOfFails: number;
  readonly centroidRho: number;
  readonly edgeFrac2: number;
  readonly edgeFrac3: number;
  readonly majorLength: number;
  readonly minorWidth: number;
  readonly elongation: number;
  readonly aspectRatio: number;
  readonly scratchTerm: number;
  readonly locTerm: number;
}

const ZERO_RAW_SCORES: Readonly<Record<ScoredWm811kClass, number>> = {
  Center: 0,
  Donut: 0,
  'Edge-Loc': 0,
  'Edge-Ring': 0,
  Loc: 0,
  'Near-full': 0,
  Random: 0,
  Scratch: 0,
};

const EMPTY_DIE_INDICES = new Uint32Array(0);
const EMPTY_STRING_LIST: readonly string[] = [];

function clamp01(value: number): number {
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}

function ramp(value: number, lo: number, hi: number): number {
  if (value <= lo) return 0;
  if (value >= hi) return 1;
  return (value - lo) / (hi - lo);
}

function round2(value: number): number {
  return Math.round(clamp01(value) * 100) / 100;
}

function isValidGridCoord(x: number, y: number): boolean {
  return (
    x !== STDF_MISSING_COORD &&
    y !== STDF_MISSING_COORD &&
    x >= MIN_VALID_I2_COORD &&
    x <= MAX_VALID_I2_COORD &&
    y >= MIN_VALID_I2_COORD &&
    y <= MAX_VALID_I2_COORD
  );
}

function createZeroFeatures(testedCellCount = 0): SpatialFeatureSummary {
  return {
    testedCellCount,
    activeFailCellCount: 0,
    globalFailFraction: 0,
    innerZoneDensity: 0,
    midZoneDensity: 0,
    outerZoneDensity: 0,
    edgeRing3Density: 0,
    interiorDensity: 0,
    edgeFailShare: 0,
    angularResultant: 0,
    edgeAngularResultant: 0,
    clusteredFailFraction: 0,
    maxScratchElongation: 0,
    maxScratchAspectRatio: 0,
    maxComponentShare: 0,
  };
}

function buildNoneClassification(
  confidence: number,
  features: SpatialFeatureSummary,
  rawClassScores: Readonly<Record<ScoredWm811kClass, number>> = ZERO_RAW_SCORES,
): PatternClassification {
  const roundedConfidence = round2(confidence);
  return {
    pattern: 'None',
    confidence: roundedConfidence,
    rawClassScores,
    classScores: {
      ...rawClassScores,
      None: roundedConfidence,
    },
    features,
    signatureDieIndices: EMPTY_DIE_INDICES,
    signatureDieIds: EMPTY_STRING_LIST,
    candidateHypotheses: EMPTY_STRING_LIST,
  };
}

/**
 * Computes bridged connected components (`0 < ||p - q||_2 <= 2.25`) and the exact
 * 8-neighbour clustered fail fraction (`f_clust8`) in `O(|F|)` time.
 */
function analyzeFailGraphAndComponents(
  failX: Int32Array,
  failY: Int32Array,
  failRing: Uint16Array,
  cx: number,
  cy: number,
  rMax: number,
): {
  readonly clusteredFailFraction: number;
  readonly components: readonly BridgedComponentStats[];
} {
  const failCount = failX.length;
  if (failCount === 0) {
    return { clusteredFailFraction: 0, components: [] };
  }

  let minX = failX[0]!;
  let maxX = minX;
  let minY = failY[0]!;
  let maxY = minY;

  for (let i = 1; i < failCount; i += 1) {
    const x = failX[i]!;
    const y = failY[i]!;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }

  const spanX = maxX - minX + 1;
  const spanY = maxY - minY + 1;
  const useDenseGrid =
    spanX <= DENSE_FAIL_GRID_MAX_SPAN && spanY <= DENSE_FAIL_GRID_MAX_SPAN;

  let denseGrid: Int32Array | null = null;
  let sparseMap: Map<number, number> | null = null;

  if (useDenseGrid) {
    denseGrid = new Int32Array(spanX * spanY).fill(-1);
    for (let i = 0; i < failCount; i += 1) {
      denseGrid[(failX[i]! - minX) * spanY + (failY[i]! - minY)] = i;
    }
  } else {
    sparseMap = new Map<number, number>();
    for (let i = 0; i < failCount; i += 1) {
      sparseMap.set(packWaferCoord(failX[i]!, failY[i]!), i);
    }
  }

  const lookupFailNode = (nx: number, ny: number): number => {
    if (denseGrid !== null) {
      if (nx < minX || nx > maxX || ny < minY || ny > maxY) {
        return -1;
      }
      return denseGrid[(nx - minX) * spanY + (ny - minY)]!;
    }
    if (
      nx < MIN_VALID_I2_COORD ||
      nx > MAX_VALID_I2_COORD ||
      ny < MIN_VALID_I2_COORD ||
      ny > MAX_VALID_I2_COORD
    ) {
      return -1;
    }
    return sparseMap!.get(packWaferCoord(nx, ny)) ?? -1;
  };

  let clusteredCount = 0;
  for (let i = 0; i < failCount; i += 1) {
    const x = failX[i]!;
    const y = failY[i]!;
    for (let k = 0; k < EIGHT_NEIGHBOUR_COUNT; k += 1) {
      if (lookupFailNode(x + BRIDGE_NEIGHBOUR_DX[k]!, y + BRIDGE_NEIGHBOUR_DY[k]!) >= 0) {
        clusteredCount += 1;
        break;
      }
    }
  }
  const clusteredFailFraction = clusteredCount / failCount;

  const visited = new Uint8Array(failCount);
  const bfsQueue = new Uint32Array(failCount);
  const components: BridgedComponentStats[] = [];

  for (let start = 0; start < failCount; start += 1) {
    if (visited[start] !== 0) {
      continue;
    }

    visited[start] = 1;
    let head = 0;
    let tail = 0;
    bfsQueue[tail] = start;
    tail += 1;

    let compMinX = failX[start]!;
    let compMaxX = compMinX;
    let compMinY = failY[start]!;
    let compMaxY = compMinY;
    let edge2Count = 0;
    let edge3Count = 0;

    while (head < tail) {
      const u = bfsQueue[head]!;
      head += 1;

      const ux = failX[u]!;
      const uy = failY[u]!;
      const ur = failRing[u]!;

      if (ux < compMinX) compMinX = ux;
      if (ux > compMaxX) compMaxX = ux;
      if (uy < compMinY) compMinY = uy;
      if (uy > compMaxY) compMaxY = uy;
      if (ur <= 2) edge2Count += 1;
      if (ur <= CLASSIFIER_THRESHOLDS.EDGE_RING_BAND) edge3Count += 1;

      for (let k = 0; k < BRIDGE_NEIGHBOUR_COUNT; k += 1) {
        const v = lookupFailNode(
          ux + BRIDGE_NEIGHBOUR_DX[k]!,
          uy + BRIDGE_NEIGHBOUR_DY[k]!,
        );
        if (v >= 0 && visited[v] === 0) {
          visited[v] = 1;
          bfsQueue[tail] = v;
          tail += 1;
        }
      }
    }

    const size = tail;
    const members = bfsQueue.slice(0, size);
    const shareOfFails = size / failCount;
    const edgeFrac2 = edge2Count / size;
    const edgeFrac3 = edge3Count / size;

    const basePca = computeMemberPcaMetrics(members, failX, failY);
    const centroidRho = Math.hypot(basePca.meanX - cx, basePca.meanY - cy) / rMax;

    let scratchMembers: Uint32Array = members;
    let majorLength = basePca.majorLength;
    let minorWidth = basePca.minorWidth;
    let elongation = basePca.elongation;
    let aspectRatio = basePca.aspectRatio;

    let scratchTerm = evaluateScratchFormula(
      size,
      shareOfFails,
      edgeFrac2,
      majorLength,
      minorWidth,
      elongation,
      aspectRatio,
      rMax,
    );

    if (size >= 4 && basePca.elongation >= 0.45) {
      const bandRun = extractPrincipalLineBandRun(basePca, failX, failY);
      if (bandRun !== null && bandRun.length >= 6) {
        const bandPca = computeMemberPcaMetrics(bandRun, failX, failY);
        let bandEdge2 = 0;
        for (let i = 0; i < bandRun.length; i += 1) {
          if (failRing[bandRun[i]!]! <= 2) {
            bandEdge2 += 1;
          }
        }
        const bandEdgeFrac2 = bandEdge2 / bandRun.length;
        const bandShare = bandRun.length / failCount;
        const bandScratchTerm = evaluateScratchFormula(
          bandRun.length,
          bandShare,
          bandEdgeFrac2,
          bandPca.majorLength,
          bandPca.minorWidth,
          bandPca.elongation,
          bandPca.aspectRatio,
          rMax,
        );

        if (bandScratchTerm > scratchTerm) {
          scratchTerm = bandScratchTerm;
          scratchMembers = bandRun;
          majorLength = bandPca.majorLength;
          minorWidth = bandPca.minorWidth;
          elongation = bandPca.elongation;
          aspectRatio = bandPca.aspectRatio;
        }
      }
    }

    const locTerm =
      size >= 4
        ? ramp(shareOfFails, 0.4, 0.72) *
          ramp(clusteredFailFraction, 0.55, 0.82) *
          ramp(centroidRho, 0.22, 0.45) *
          ramp(0.55 - edgeFrac2, 0.0, 0.3)
        : 0;

    components.push({
      failLocalIndices: members,
      scratchFailLocalIndices: scratchMembers,
      size,
      shareOfFails,
      centroidRho,
      edgeFrac2,
      edgeFrac3,
      majorLength,
      minorWidth,
      elongation,
      aspectRatio,
      scratchTerm,
      locTerm,
    });
  }

  return { clusteredFailFraction, components };
}

function collectSignatureDieIndices(
  selectedFailLocalIndices: readonly number[],
  failToCellIndex: Uint32Array,
  cellFailDieIndices: ReadonlyArray<number | Uint32Array>,
): Uint32Array {
  let totalLen = 0;
  for (let i = 0; i < selectedFailLocalIndices.length; i += 1) {
    const cellIdx = failToCellIndex[selectedFailLocalIndices[i]!]!;
    const entry = cellFailDieIndices[cellIdx]!;
    totalLen += typeof entry === 'number' ? 1 : entry.length;
  }

  if (totalLen === 0) {
    return EMPTY_DIE_INDICES;
  }

  const out = new Uint32Array(totalLen);
  let pos = 0;
  for (let i = 0; i < selectedFailLocalIndices.length; i += 1) {
    const cellIdx = failToCellIndex[selectedFailLocalIndices[i]!]!;
    const entry = cellFailDieIndices[cellIdx]!;
    if (typeof entry === 'number') {
      out[pos] = entry;
      pos += 1;
    } else {
      out.set(entry, pos);
      pos += entry.length;
    }
  }

  out.sort();

  // Deduplicate defensively in case caller-supplied cells shared die indices
  let uniqueLen = 1;
  for (let i = 1; i < out.length; i += 1) {
    if (out[i] !== out[uniqueLen - 1]) {
      out[uniqueLen] = out[i]!;
      uniqueLen += 1;
    }
  }

  return uniqueLen === out.length ? out : out.slice(0, uniqueLen);
}

function classifySpatialGrid(
  grid: SpatialGridInput,
  lotDieIds: readonly DieId[],
): PatternClassification {
  const N = grid.testedCount;
  if (N === 0) {
    return buildNoneClassification(1.0, createZeroFeatures(0));
  }

  // Step 1: Bounding-box center & maximum radial extent over tested set W
  let minWx = grid.x[0]!;
  let maxWx = minWx;
  let minWy = grid.y[0]!;
  let maxWy = minWy;
  let activeFailCount = 0;

  for (let i = 0; i < N; i += 1) {
    const x = grid.x[i]!;
    const y = grid.y[i]!;
    if (x < minWx) minWx = x;
    if (x > maxWx) maxWx = x;
    if (y < minWy) minWy = y;
    if (y > maxWy) maxWy = y;
    if (grid.isActiveFail[i] !== 0) {
      activeFailCount += 1;
    }
  }

  if (activeFailCount === 0) {
    return buildNoneClassification(1.0, createZeroFeatures(N));
  }

  const cx = 0.5 * (minWx + maxWx);
  const cy = 0.5 * (minWy + maxWy);

  let maxDist = 0;
  for (let i = 0; i < N; i += 1) {
    const dist = Math.hypot(grid.x[i]! - cx, grid.y[i]! - cy);
    if (dist > maxDist) {
      maxDist = dist;
    }
  }
  const rMax = Math.max(1, maxDist);

  // Step 3 & Step 4: Zone densities, shares, active fail arrays, and circular angular concentration
  let innerTotal = 0;
  let innerFail = 0;
  let midTotal = 0;
  let midFail = 0;
  let outerTotal = 0;
  let outerFail = 0;
  let edge3Total = 0;
  let edge3Fail = 0;
  let interTotal = 0;
  let interFail = 0;

  let angSumX = 0;
  let angSumY = 0;
  let angCount = 0;
  let edgeAngSumX = 0;
  let edgeAngSumY = 0;
  let edgeAngCount = 0;

  const failX = new Int32Array(activeFailCount);
  const failY = new Int32Array(activeFailCount);
  const failRing = new Uint16Array(activeFailCount);
  const failRho = new Float64Array(activeFailCount);
  const failToCellIndex = new Uint32Array(activeFailCount);
  let fPos = 0;

  for (let i = 0; i < N; i += 1) {
    const x = grid.x[i]!;
    const y = grid.y[i]!;
    const dx = x - cx;
    const dy = y - cy;
    const dist = Math.hypot(dx, dy);
    const rho = dist / rMax;
    const ring = grid.ringIndex[i]!;
    const failed = grid.isActiveFail[i] !== 0;

    if (rho <= CLASSIFIER_THRESHOLDS.INNER_RHO_MAX) {
      innerTotal += 1;
      if (failed) innerFail += 1;
    } else if (rho <= CLASSIFIER_THRESHOLDS.MID_RHO_MAX) {
      midTotal += 1;
      if (failed) midFail += 1;
    } else {
      outerTotal += 1;
      if (failed) outerFail += 1;
    }

    const inEdge3 = ring <= CLASSIFIER_THRESHOLDS.EDGE_RING_BAND;
    if (inEdge3) {
      edge3Total += 1;
      if (failed) edge3Fail += 1;
    } else {
      interTotal += 1;
      if (failed) interFail += 1;
    }

    if (failed) {
      failX[fPos] = x;
      failY[fPos] = y;
      failRing[fPos] = ring;
      failRho[fPos] = rho;
      failToCellIndex[fPos] = i;
      fPos += 1;

      if (dist > CENTER_EPSILON) {
        const ux = dx / dist;
        const uy = dy / dist;
        angSumX += ux;
        angSumY += uy;
        angCount += 1;
        if (inEdge3) {
          edgeAngSumX += ux;
          edgeAngSumY += uy;
          edgeAngCount += 1;
        }
      }
    }
  }

  const globalFailFraction = activeFailCount / N;
  const innerZoneDensity = innerFail / Math.max(1, innerTotal);
  const midZoneDensity = midFail / Math.max(1, midTotal);
  const outerZoneDensity = outerFail / Math.max(1, outerTotal);
  const edgeRing3Density = edge3Fail / Math.max(1, edge3Total);
  const interiorDensity = interFail / Math.max(1, interTotal);

  const innerFailShare = innerFail / activeFailCount;
  const midFailShare = midFail / activeFailCount;
  const edgeFailShare = edge3Fail / activeFailCount;

  const angularResultant =
    angCount > 0 ? clamp01(Math.hypot(angSumX, angSumY) / angCount) : 0;
  const edgeAngularResultant =
    edgeAngCount > 0
      ? clamp01(Math.hypot(edgeAngSumX, edgeAngSumY) / edgeAngCount)
      : 0;

  // Step 5: Bridged connected components & PCA linearity
  const { clusteredFailFraction, components } = analyzeFailGraphAndComponents(
    failX,
    failY,
    failRing,
    cx,
    cy,
    rMax,
  );

  let maxComponentShare = 0;
  let maxScratchElongation = 0;
  let maxScratchAspectRatio = 0;
  let maxEdgeComponentShare = 0;
  let rawScratchMax = 0;
  let rawLocMax = 0;

  for (let c = 0; c < components.length; c += 1) {
    const comp = components[c]!;
    if (comp.shareOfFails > maxComponentShare) {
      maxComponentShare = comp.shareOfFails;
    }
    if (comp.scratchFailLocalIndices.length >= 6) {
      if (comp.elongation > maxScratchElongation) {
        maxScratchElongation = comp.elongation;
      }
      if (comp.aspectRatio > maxScratchAspectRatio) {
        maxScratchAspectRatio = comp.aspectRatio;
      }
    }
    if (comp.size >= 4 && comp.edgeFrac3 >= 0.55) {
      if (comp.shareOfFails > maxEdgeComponentShare) {
        maxEdgeComponentShare = comp.shareOfFails;
      }
    }
    if (comp.scratchTerm > rawScratchMax) {
      rawScratchMax = comp.scratchTerm;
    }
    if (comp.locTerm > rawLocMax) {
      rawLocMax = comp.locTerm;
    }
  }

  const features: SpatialFeatureSummary = {
    testedCellCount: N,
    activeFailCellCount: activeFailCount,
    globalFailFraction,
    innerZoneDensity,
    midZoneDensity,
    outerZoneDensity,
    edgeRing3Density,
    interiorDensity,
    edgeFailShare,
    angularResultant,
    edgeAngularResultant,
    clusteredFailFraction,
    maxScratchElongation,
    maxScratchAspectRatio,
    maxComponentShare,
  };

  // Step 2: Noise Gate (`None`)
  if (activeFailCount < CLASSIFIER_THRESHOLDS.MIN_FAIL_COUNT) {
    return buildNoneClassification(0.98, features);
  }
  if (globalFailFraction < CLASSIFIER_THRESHOLDS.MIN_FAIL_FRACTION) {
    const lowDensityConf =
      0.85 +
      0.13 * (1 - globalFailFraction / CLASSIFIER_THRESHOLDS.MIN_FAIL_FRACTION);
    return buildNoneClassification(lowDensityConf, features);
  }

  // Step 6: Piecewise-linear class scoring across all 8 non-'None' classes
  const notNearFull65to80 = 1 - ramp(globalFailFraction, 0.65, 0.8);

  const minZoneDensity = Math.min(
    innerZoneDensity,
    midZoneDensity,
    outerZoneDensity,
  );
  const nearFullScore = clamp01(
    ramp(globalFailFraction, 0.62, 0.82) * ramp(minZoneDensity, 0.45, 0.7),
  );

  const edgeRingScore = clamp01(
    ramp(edgeRing3Density, 0.2, 0.5) *
      ramp(edgeRing3Density / Math.max(interiorDensity, 0.02), 2.5, 6.0) *
      ramp(edgeFailShare, 0.55, 0.8) *
      ramp(0.5 - edgeAngularResultant, 0.0, 0.3) *
      notNearFull65to80,
  );

  const scratchScore = clamp01(
    0.96 * rawScratchMax * (1 - ramp(globalFailFraction, 0.6, 0.75)),
  );

  const edgeLocScore = clamp01(
    ramp(edgeFailShare, 0.5, 0.8) *
      ramp(edgeAngularResultant, 0.48, 0.78) *
      ramp(maxEdgeComponentShare, 0.35, 0.7) *
      ramp(edgeRing3Density / Math.max(interiorDensity, 0.02), 2.0, 5.0) *
      (1 - 0.6 * rawScratchMax) *
      notNearFull65to80,
  );

  const centerScore = clamp01(
    ramp(innerZoneDensity, 0.3, 0.65) *
      ramp(
        innerZoneDensity /
          Math.max(0.5 * (midZoneDensity + outerZoneDensity), 0.02),
        2.5,
        6.0,
      ) *
      ramp(innerFailShare, 0.45, 0.75) *
      notNearFull65to80,
  );

  const donutScore = clamp01(
    ramp(midZoneDensity, 0.25, 0.55) *
      ramp(midZoneDensity / Math.max(innerZoneDensity, 0.03), 2.0, 4.5) *
      ramp(midZoneDensity / Math.max(edgeRing3Density, 0.03), 2.0, 4.5) *
      ramp(midFailShare, 0.55, 0.8) *
      ramp(0.45 - angularResultant, 0.0, 0.25) *
      notNearFull65to80,
  );

  const locScore = clamp01(
    rawLocMax *
      (1 - 0.85 * rawScratchMax) *
      (1 - ramp(globalFailFraction, 0.55, 0.7)),
  );

  // Smoothed radial zone densities guard against small-sample Binomial variance in inner zone
  const smoothInner = (innerFail + 2) / (innerTotal + 20);
  const smoothMid = (midFail + 2) / (midTotal + 20);
  const smoothEdge3 = (edge3Fail + 2) / (edge3Total + 20);
  const maxZone3 = Math.max(smoothInner, smoothMid, smoothEdge3);
  const minZone3 = Math.min(smoothInner, smoothMid, smoothEdge3);
  const radialDisparity = maxZone3 / Math.max(minZone3, 0.015);
  const expectedBernoulliClust8 = 1 - (1 - globalFailFraction) ** 8;
  const excessClust8 = Math.max(
    0,
    clusteredFailFraction - expectedBernoulliClust8,
  );
  const maxStructuredScore = Math.max(
    centerScore,
    donutScore,
    edgeRingScore,
    edgeLocScore,
    locScore,
    nearFullScore,
    scratchScore,
  );

  const randomScore = clamp01(
    ramp(globalFailFraction, 0.02, 0.06) *
      (1 - ramp(globalFailFraction, 0.55, 0.72)) *
      ramp(3.8 - radialDisparity, 0.0, 1.4) *
      ramp(0.52 - angularResultant, 0.0, 0.22) *
      ramp(0.25 - excessClust8, 0.0, 0.16) *
      (1 - 0.8 * maxStructuredScore),
  );

  const rawClassScores: Readonly<Record<ScoredWm811kClass, number>> = {
    Center: centerScore,
    Donut: donutScore,
    'Edge-Loc': edgeLocScore,
    'Edge-Ring': edgeRingScore,
    Loc: locScore,
    'Near-full': nearFullScore,
    Random: randomScore,
    Scratch: scratchScore,
  };

  // Step 7: Top-2 ranking with deterministic priority tie-breaking
  let topClass: ScoredWm811kClass = CLASS_PRIORITY_ORDER[0]!;
  let s1 = -1;
  let s2 = 0;

  for (let i = 0; i < CLASS_PRIORITY_ORDER.length; i += 1) {
    const cls = CLASS_PRIORITY_ORDER[i]!;
    const score = rawClassScores[cls];
    if (score > s1 + SCORE_TIE_EPSILON) {
      if (s1 >= 0) {
        s2 = s1;
      }
      s1 = score;
      topClass = cls;
    } else if (score > s2) {
      s2 = score;
    }
  }

  if (s1 < CLASSIFIER_THRESHOLDS.MIN_CLASS_CONFIDENCE) {
    return buildNoneClassification(1.0 - s1, features, rawClassScores);
  }

  const confidence = round2(
    Math.min(
      CLASSIFIER_THRESHOLDS.CONFIDENCE_CAP,
      0.52 + 0.34 * s1 + 0.12 * clamp01((s1 - s2) / 0.4),
    ),
  );

  // Step 8: Signature Die Extraction (D4-equivariant across symmetric ties)
  const selectedFailLocal: number[] = [];

  switch (topClass) {
    case 'Edge-Ring': {
      for (let f = 0; f < activeFailCount; f += 1) {
        if (failRing[f]! <= CLASSIFIER_THRESHOLDS.EDGE_RING_BAND) {
          selectedFailLocal.push(f);
        }
      }
      break;
    }
    case 'Center': {
      for (let f = 0; f < activeFailCount; f += 1) {
        if (failRho[f]! <= CLASSIFIER_THRESHOLDS.INNER_RHO_MAX) {
          selectedFailLocal.push(f);
        }
      }
      break;
    }
    case 'Donut': {
      for (let f = 0; f < activeFailCount; f += 1) {
        const rho = failRho[f]!;
        if (
          rho > CLASSIFIER_THRESHOLDS.INNER_RHO_MAX &&
          rho <= CLASSIFIER_THRESHOLDS.MID_RHO_MAX
        ) {
          selectedFailLocal.push(f);
        }
      }
      break;
    }
    case 'Edge-Loc': {
      for (let c = 0; c < components.length; c += 1) {
        const comp = components[c]!;
        if (
          comp.size >= 4 &&
          comp.edgeFrac3 >= 0.55 &&
          comp.shareOfFails >= maxEdgeComponentShare - SCORE_TIE_EPSILON
        ) {
          for (let k = 0; k < comp.failLocalIndices.length; k += 1) {
            selectedFailLocal.push(comp.failLocalIndices[k]!);
          }
        }
      }
      break;
    }
    case 'Scratch': {
      const secondaryThreshold = Math.max(
        CLASSIFIER_THRESHOLDS.MIN_CLASS_CONFIDENCE / 0.96,
        0.85 * rawScratchMax,
      );
      for (let c = 0; c < components.length; c += 1) {
        const comp = components[c]!;
        if (
          comp.scratchFailLocalIndices.length >= 6 &&
          (comp.scratchTerm >= rawScratchMax - SCORE_TIE_EPSILON ||
            comp.scratchTerm >= secondaryThreshold)
        ) {
          for (let k = 0; k < comp.scratchFailLocalIndices.length; k += 1) {
            selectedFailLocal.push(comp.scratchFailLocalIndices[k]!);
          }
        }
      }
      break;
    }
    case 'Loc': {
      for (let c = 0; c < components.length; c += 1) {
        const comp = components[c]!;
        if (comp.size >= 4 && comp.locTerm >= rawLocMax - SCORE_TIE_EPSILON) {
          for (let k = 0; k < comp.failLocalIndices.length; k += 1) {
            selectedFailLocal.push(comp.failLocalIndices[k]!);
          }
        }
      }
      break;
    }
    case 'Near-full':
    case 'Random': {
      for (let f = 0; f < activeFailCount; f += 1) {
        selectedFailLocal.push(f);
      }
      break;
    }
  }

  // Defensive fallback ensuring every non-'None' classification binds >= 1 failing die
  if (selectedFailLocal.length === 0) {
    for (let f = 0; f < activeFailCount; f += 1) {
      selectedFailLocal.push(f);
    }
  }

  const signatureDieIndices = collectSignatureDieIndices(
    selectedFailLocal,
    failToCellIndex,
    grid.cellFailDieIndices,
  );
  const signatureDieIds: DieId[] = new Array<DieId>(signatureDieIndices.length);
  for (let i = 0; i < signatureDieIndices.length; i += 1) {
    signatureDieIds[i] = lotDieIds[signatureDieIndices[i]!]!;
  }

  return {
    pattern: topClass,
    confidence,
    rawClassScores,
    classScores: {
      ...rawClassScores,
      None: Math.max(0, 1 - s1),
    },
    features,
    signatureDieIndices,
    signatureDieIds,
    candidateHypotheses: formatPatternCandidateHypotheses(topClass),
  };
}

function buildDefaultStackedCells(lot: LotModel): readonly StackedPatternCellInput[] {
  const { dies } = lot;
  const count = dies.count;
  const byCoord = new Map<
    number,
    {
      readonly x: number;
      readonly y: number;
      testedWaferCount: number;
      failDieIndices: number[];
    }
  >();

  for (let i = 0; i < count; i += 1) {
    if (dies.hasValidCoords[i] === 0) {
      continue;
    }
    const x = dies.x[i]!;
    const y = dies.y[i]!;
    if (!isValidGridCoord(x, y)) {
      continue;
    }
    const packed = packWaferCoord(x, y);
    let bucket = byCoord.get(packed);
    if (bucket === undefined) {
      bucket = {
        x,
        y,
        testedWaferCount: 0,
        failDieIndices: [],
      };
      byCoord.set(packed, bucket);
    }
    bucket.testedWaferCount += 1;
    if (dies.finalPass[i] === 0) {
      bucket.failDieIndices.push(i);
    }
  }

  const sortedKeys = Array.from(byCoord.keys()).sort((a, b) => a - b);
  const cells: StackedPatternCellInput[] = new Array<StackedPatternCellInput>(
    sortedKeys.length,
  );

  for (let i = 0; i < sortedKeys.length; i += 1) {
    const b = byCoord.get(sortedKeys[i]!)!;
    const failCount = b.failDieIndices.length;
    cells[i] = {
      x: b.x,
      y: b.y,
      testedWaferCount: b.testedWaferCount,
      failCount,
      failRate: b.testedWaferCount > 0 ? failCount / b.testedWaferCount : 0,
      failingDieIndices: Uint32Array.from(b.failDieIndices),
    };
  }

  return cells;
}

/**
 * Classifies a single Wafer (`0 <= waferIndex < lot.wafers.length`) into one of the
 * 9 WM-811K spatial defect classes using D4-invariant spatial features.
 *
 * Coordinate-missing dies (`-32768`) are excluded from the spatial grid per Requirement 4.2.
 */
export function classifyWaferPattern(
  lot: LotModel,
  waferIndex: number,
): PatternClassification {
  if (waferIndex < 0 || waferIndex >= lot.wafers.length) {
    return buildNoneClassification(1.0, createZeroFeatures(0));
  }

  const wafer = lot.wafers[waferIndex]!;
  const { dies } = lot;
  const start = wafer.dieStartIndex;
  const end = wafer.dieEndIndex;

  let validCount = 0;
  for (let i = start; i < end; i += 1) {
    if (dies.hasValidCoords[i] !== 0 && isValidGridCoord(dies.x[i]!, dies.y[i]!)) {
      validCount += 1;
    }
  }

  if (validCount === 0) {
    return buildNoneClassification(1.0, createZeroFeatures(0));
  }

  const x = new Int32Array(validCount);
  const y = new Int32Array(validCount);
  const ringIndex = new Uint16Array(validCount);
  const isActiveFail = new Uint8Array(validCount);
  const cellFailDieIndices = new Array<number | Uint32Array>(validCount);

  let pos = 0;
  for (let i = start; i < end; i += 1) {
    if (dies.hasValidCoords[i] === 0) {
      continue;
    }
    const dx = dies.x[i]!;
    const dy = dies.y[i]!;
    if (!isValidGridCoord(dx, dy)) {
      continue;
    }
    x[pos] = dx;
    y[pos] = dy;
    ringIndex[pos] = dies.ringIndex[i]!;
    const failed = dies.finalPass[i] === 0;
    isActiveFail[pos] = failed ? 1 : 0;
    cellFailDieIndices[pos] = failed ? i : EMPTY_DIE_INDICES;
    pos += 1;
  }

  return classifySpatialGrid(
    {
      testedCount: validCount,
      x,
      y,
      ringIndex,
      isActiveFail,
      cellFailDieIndices,
    },
    lot.dieIds,
  );
}

/**
 * Classifies a Lot's multi-wafer Stacked Wafer Heatmap into one of the 9 WM-811K
 * spatial defect classes using `STACK_CELL_MIN_FAIL_RATE` (`0.20`) and
 * `failCount >= min(2, waferCount)`.
 *
 * When `cells` is omitted, aggregates stacked `(x, y)` failure rates directly from
 * `lot` (delegating to `classifyWaferPattern(lot, 0)` on single-wafer lots).
 */
export function classifyStackedPattern(
  lot: LotModel,
  cells?: readonly StackedPatternCellInput[],
  waferCount?: number,
): PatternClassification {
  const effectiveWaferCount = waferCount ?? lot.wafers.length;
  if (effectiveWaferCount <= 0) {
    return buildNoneClassification(1.0, createZeroFeatures(0));
  }

  if (cells === undefined && lot.wafers.length === 1 && effectiveWaferCount === 1) {
    return classifyWaferPattern(lot, 0);
  }

  const resolvedCells = cells ?? buildDefaultStackedCells(lot);
  if (resolvedCells.length === 0) {
    return buildNoneClassification(1.0, createZeroFeatures(0));
  }

  const validCells: StackedPatternCellInput[] = [];
  for (let i = 0; i < resolvedCells.length; i += 1) {
    const c = resolvedCells[i]!;
    if (c.testedWaferCount > 0 && isValidGridCoord(c.x, c.y)) {
      validCells.push(c);
    }
  }

  const cellCount = validCells.length;
  if (cellCount === 0) {
    return buildNoneClassification(1.0, createZeroFeatures(0));
  }

  const ringIndex = computeWaferEdgeRingIndices(validCells);
  const minFailCount = Math.min(2, effectiveWaferCount);

  const x = new Int32Array(cellCount);
  const y = new Int32Array(cellCount);
  const isActiveFail = new Uint8Array(cellCount);
  const cellFailDieIndices = new Array<number | Uint32Array>(cellCount);

  for (let i = 0; i < cellCount; i += 1) {
    const cell = validCells[i]!;
    x[i] = cell.x;
    y[i] = cell.y;
    const active =
      cell.failCount >= minFailCount &&
      cell.failRate >= CLASSIFIER_THRESHOLDS.STACK_CELL_MIN_FAIL_RATE;
    isActiveFail[i] = active ? 1 : 0;
    cellFailDieIndices[i] = active ? cell.failingDieIndices : EMPTY_DIE_INDICES;
  }

  return classifySpatialGrid(
    {
      testedCount: cellCount,
      x,
      y,
      ringIndex,
      isActiveFail,
      cellFailDieIndices,
    },
    lot.dieIds,
  );
}
