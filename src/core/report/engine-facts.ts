/**
 * Deterministic EngineFact extractor (`src/core/report/engine-facts.ts`).
 *
 * Derives typed, stable-ID analytical facts from a `LotModel`, `YieldSummary`,
 * two-proportion Test Site anomaly z-test, and 9-class WM-811K spatial pattern
 * classifier. Every emitted `EngineFact` guarantees a non-empty, sorted,
 * deduplicated set of `LotModel.dies` indices (`dieIndices.length >= 1`) and
 * canonical `DieId`s (`dieIds.length >= 1`).
 *
 * Pure deterministic TypeScript with zero React, Next.js, or DOM imports.
 * Validates: Requirements 7.4, 8.3, 8.4, 9.2, 9.3, 10.2, 10.3, 17.4, 17.7
 */

import {
  computeYieldSummary,
  detectSiteAnomalies,
  type SiteAnomalyFactInput,
  type YieldSummary,
} from '../analytics/yield-summary';
import type {
  BinMode,
  DieId,
  LotModel,
  ParametricTestColumn,
  WaferSummaryMeta,
} from '../model/types';
import {
  formatSiteConcentrationHypotheses,
  type ScoredWm811kClass,
  type Wm811kClass,
} from '../patterns/root-causes';
import {
  CLASSIFIER_THRESHOLDS,
  classifyStackedPattern,
  classifyWaferPattern,
  type PatternClassification,
} from '../patterns/wm811k-classifier';
import { STDF_MISSING_U2 } from '../stdf/types';

export type FactKind =
  | 'lot-yield'
  | 'spatial-pattern'
  | 'dominant-bin'
  | 'secondary-bin'
  | 'site-anomaly'
  | 'wafer-excursion'
  | 'parametric-capability'
  | 'retest-recovery';

export interface FormattedFactMetric {
  /** Stable metric identifier, e.g. `"finalYieldPct"`, `"confidence"`, `"cpk"`, `"dieCount"`. */
  readonly key: string;
  /** Exact engine float or integer corresponding to the display scale. */
  readonly numericValue: number;
  /** Clinical formatted string per Requirement 17.4 (`"82.4%"`, `"0.91"`, `"12,480"`, `"15.00 uA"`). */
  readonly displayValue: string;
  /** Allowed absolute display-rounding tolerance (`0.05` for 1-dp %, `0.005` for 2-dp, `0` for ints). */
  readonly tolerance: number;
}

export interface EngineFact {
  /** Stable canonical identifier, e.g. `"fact:spatial:primary"`, `"fact:bin:sbin-7"`, `"fact:site:1-2"`. */
  readonly factId: string;
  readonly kind: FactKind;
  /** Deterministic clinical plain-text summary. */
  readonly summary: string;
  readonly metrics: readonly FormattedFactMetric[];
  /** Sorted ascending unique indices into `LotModel.dies`; guaranteed `length >= 1`. */
  readonly dieIndices: Uint32Array;
  /** Canonical `DieId`s matching `dieIndices` 1-to-1; guaranteed `length >= 1`. */
  readonly dieIds: readonly DieId[];
  readonly binRef?: {
    readonly mode: BinMode;
    readonly code: number;
    readonly name: string;
  };
  readonly testRef?: {
    readonly testNum: number;
    readonly testName: string;
  };
  readonly siteRef?: {
    readonly headNum: number;
    readonly siteNum: number;
  };
  readonly waferRef?: {
    readonly waferIndex: number;
    readonly waferId: string;
  };
  readonly hypotheses?: readonly string[];
}

export interface LotAnalysisBundle {
  readonly yieldSummary: YieldSummary;
  readonly siteAnomalies: readonly SiteAnomalyFactInput[];
  readonly primarySpatial: PatternClassification;
  readonly perWaferPatterns: readonly PatternClassification[];
}

export interface FailingBinRankEntry {
  readonly mode: BinMode;
  readonly code: number;
  readonly name: string;
  readonly count: number;
  readonly factId: string;
  readonly dieIndices: Uint32Array;
}

export interface QualifyingWaferExcursion {
  readonly wafer: WaferSummaryMeta;
  readonly classification: PatternClassification;
  readonly waferFailCount: number;
  readonly waferTestedCount: number;
  readonly waferFinalYield: number;
  readonly lotFailShare: number;
  readonly signatureDieIndices: Uint32Array;
}

export interface SpatialDieBreakdown {
  readonly spatialDieIndices: Uint32Array;
  readonly sigCount: number;
  readonly sigWaferCount: number;
  readonly edgeBandTestedDies: number;
  readonly edgeBandFailDies: number;
  readonly interiorTestedDies: number;
  readonly interiorFailDies: number;
}

export const WAFER_EXCURSION_THRESHOLDS = {
  MIN_CONFIDENCE: 0.7,
  MIN_LOT_FAIL_SHARE: 0.25,
} as const;

/**
 * Heuristic feature scores are hedged in displayed UI/report labels so an
 * uncalibrated classifier never presents > 0.95 certainty.
 */
export const DISPLAYED_CONFIDENCE_CAP = 0.95;

export const STRUCTURED_SPATIAL_CLASSES: ReadonlySet<Wm811kClass> = new Set<ScoredWm811kClass>([
  'Center',
  'Donut',
  'Edge-Loc',
  'Edge-Ring',
  'Loc',
  'Near-full',
  'Scratch',
]);

const MAX_SECONDARY_BIN_FACTS = 2;
const MAX_PARAMETRIC_FACTS = 2;
const MAX_WAFER_EXCURSION_FACTS = 2;
const LOW_CPK_WATCH_THRESHOLD = 1.33;

const BASELINE_LOW_DENSITY_HYPOTHESES: readonly string[] = [
  'Candidate mechanism: low-density baseline point defects or isolated test-limit guardband excursions below spatial clustering thresholds. Check next: inspect dominant failing bin counts and parametric Cp/Cpk margin distributions before lot disposition.',
];

const SI_PREFIX_BY_SCAL_EXP: Readonly<Record<number, string>> = {
  [-12]: 'T',
  [-9]: 'G',
  [-6]: 'M',
  [-3]: 'k',
  0: '',
  3: 'm',
  6: 'u',
  9: 'n',
  12: 'p',
  15: 'f',
};

/**
 * Strips angle brackets and ASCII control characters from untrusted STDF metadata
 * before interpolating into report or fact prose (Requirement 2.4).
 */
export function sanitizeReportProseText(raw: string): string {
  let out = '';
  for (let i = 0; i < raw.length; i += 1) {
    const code = raw.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) {
      continue;
    }
    const ch = raw[i]!;
    if (ch === '<' || ch === '>') {
      continue;
    }
    out += ch;
  }
  return out.trim();
}

/**
 * Deterministic locale-independent grouped integer formatter (`12480 -> "12,480"`).
 */
export function formatGroupedInt(value: number): string {
  if (!Number.isFinite(value)) {
    return '0';
  }
  const truncated = Math.trunc(value);
  const sign = truncated < 0 ? '-' : '';
  const digits = Math.abs(truncated).toString();
  return sign + digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/**
 * Formats a `[0, 1]` ratio as a 1-decimal percentage string (`0.8241 -> "82.4%"`).
 */
export function formatRatioPct1(ratio: number): string {
  if (!Number.isFinite(ratio)) {
    return '0.0%';
  }
  return `${(ratio * 100).toFixed(1)}%`;
}

/**
 * Formats a count share (`numerator / denominator`) as a 1-decimal percentage while
 * clamping strictly partial shares (`0 < numerator < denominator`) to `[0.1%, 99.9%]`
 * so non-zero minority counts never display as `"0.0%"` and incomplete shares never
 * display as `"100.0%"`.
 */
export function formatBoundedSharePct1(
  numerator: number,
  denominator: number,
): {
  readonly numericPct: number;
  readonly displayValue: string;
  readonly tolerance: number;
} {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0 || numerator <= 0) {
    return { numericPct: 0, displayValue: '0.0%', tolerance: 0.05 };
  }
  if (numerator >= denominator) {
    return { numericPct: 100, displayValue: '100.0%', tolerance: 0.05 };
  }
  const rawPct = (numerator / denominator) * 100;
  const rounded = Number(rawPct.toFixed(1));
  const clamped = Math.min(99.9, Math.max(0.1, rounded));
  return {
    numericPct: rawPct,
    displayValue: `${clamped.toFixed(1)}%`,
    tolerance: Math.max(0.05, Math.abs(clamped - rawPct) + 1e-6),
  };
}

export function boundedPctMetric(
  key: string,
  numerator: number,
  denominator: number,
): FormattedFactMetric {
  const fmt = formatBoundedSharePct1(numerator, denominator);
  return {
    key,
    numericValue: fmt.numericPct,
    displayValue: fmt.displayValue,
    tolerance: fmt.tolerance,
  };
}

/**
 * Formats a percentage-point delta to 1 decimal place (`37.42 -> "37.4 pp"`).
 */
export function formatPp1(pp: number): string {
  if (!Number.isFinite(pp)) {
    return '0.0 pp';
  }
  return `${pp.toFixed(1)} pp`;
}

/**
 * Switches extreme capability or scaled-limit magnitudes (`|value| >= 1e6`) to
 * 2-decimal exponential notation so display strings stay compact and avoid IEEE-754
 * binary64 ULP drift on `toFixed(2)` strings above `2^45`.
 */
const EXPONENTIAL_FORMAT_THRESHOLD = 1e6;

function compute2DpTolerance(numericValue: number): number {
  const abs = Math.abs(numericValue);
  if (!Number.isFinite(abs) || abs < EXPONENTIAL_FORMAT_THRESHOLD) {
    return 0.005 + (Number.isFinite(abs) ? abs * Number.EPSILON : 0);
  }
  return abs * 0.01;
}

/**
 * Formats a capability, confidence, or z-statistic score to 2 decimal places (`0.91 -> "0.91"`),
 * switching to 2-decimal exponential notation for extreme magnitudes (`|value| >= 1e6`).
 */
export function formatFixed2(value: number): string {
  if (!Number.isFinite(value)) {
    return '0.00';
  }
  return Math.abs(value) >= EXPONENTIAL_FORMAT_THRESHOLD
    ? value.toExponential(2)
    : value.toFixed(2);
}

/**
 * Caps a heuristic confidence score in `[0, 0.95]` rounded to 2 decimal places so
 * displayed report confidence never overclaims certainty (`> 0.95`).
 */
export function capDisplayedConfidence(confidence: number): number {
  if (!Number.isFinite(confidence)) {
    return 0;
  }
  const clamped = Math.min(DISPLAYED_CONFIDENCE_CAP, Math.max(0, confidence));
  return Math.round(clamped * 100) / 100;
}

/**
 * Formats a hedged qualitative + numeric confidence badge label (`"High · 0.95"`,
 * `"Moderate · 0.72"`, `"Low · 0.50"`), strictly capped at `0.95`.
 */
export function formatConfidenceBadgeLabel(confidence: number): string {
  const capped = capDisplayedConfidence(confidence);
  const tierWord =
    capped >= 0.8 ? 'High' : capped >= 0.65 ? 'Moderate' : 'Low';
  return `${tierWord} · ${formatFixed2(capped)}`;
}

/**
 * Formats a bin code and optional sanitized bin name (`"SBIN 7 (IDDQ_EDGE_LEAK)"` or `"SBIN 7"`).
 */
export function formatBinRefLabel(bin: {
  readonly mode: BinMode;
  readonly code: number;
  readonly name: string;
}): string {
  return bin.name.length > 0
    ? `${bin.mode} ${bin.code} (${bin.name})`
    : `${bin.mode} ${bin.code}`;
}

export function formatFinalFailNoun(count: number): string {
  return count === 1 ? 'final fail' : 'final fails';
}

/**
 * Formats a base-unit STDF parametric measurement or limit using SI prefixes
 * (`nA`, `uA`, `mV`, `GHz`, `Ohm`, etc.) derived from the STDF power-of-10 display
 * exponent (`RES_SCAL`, `LLM_SCAL`, `HLM_SCAL`) per Requirements 1.8, 8.2, and 17.4.
 */
export function formatScaledParametricValue(
  baseValue: number,
  units: string,
  scalExp: number,
): {
  readonly scaledNumericValue: number;
  readonly displayValue: string;
  readonly unitLabel: string;
} {
  const cleanUnits = sanitizeReportProseText(units);
  if (!Number.isFinite(baseValue)) {
    return {
      scaledNumericValue: 0,
      displayValue: cleanUnits.length > 0 ? `0.00 ${cleanUnits}` : '0.00',
      unitLabel: cleanUnits,
    };
  }

  const effectiveExp =
    cleanUnits.length === 0 || !Number.isFinite(scalExp)
      ? 0
      : Math.max(-12, Math.min(15, Math.round(scalExp / 3) * 3));

  const prefix = SI_PREFIX_BY_SCAL_EXP[effectiveExp] ?? '';
  const unitLabel = `${prefix}${cleanUnits}`;
  const scaled = baseValue * Math.pow(10, effectiveExp);
  const formattedNum =
    Math.abs(scaled) >= EXPONENTIAL_FORMAT_THRESHOLD
      ? scaled.toExponential(2)
      : scaled.toFixed(2);

  return {
    scaledNumericValue: scaled,
    displayValue: unitLabel.length > 0 ? `${formattedNum} ${unitLabel}` : formattedNum,
    unitLabel,
  };
}

export function intMetric(key: string, value: number): FormattedFactMetric {
  const exactInt = Math.trunc(value);
  return {
    key,
    numericValue: exactInt,
    displayValue: formatGroupedInt(exactInt),
    tolerance: 0,
  };
}

export function pctMetricFromRatio(key: string, ratio: number): FormattedFactMetric {
  const pct = ratio * 100;
  return {
    key,
    numericValue: pct,
    displayValue: `${pct.toFixed(1)}%`,
    tolerance: 0.05,
  };
}

export function ppMetric(key: string, ppValue: number): FormattedFactMetric {
  return {
    key,
    numericValue: ppValue,
    displayValue: formatPp1(ppValue),
    tolerance: 0.05,
  };
}

export function score2Metric(key: string, value: number): FormattedFactMetric {
  return {
    key,
    numericValue: value,
    displayValue: formatFixed2(value),
    tolerance: compute2DpTolerance(value),
  };
}

/**
 * Normalizes an arbitrary die-index collection into a sorted, strictly ascending,
 * deduplicated `Uint32Array` bounded to `[0, totalDies - 1]`.
 */
export function normalizeDieIndices(
  indices: ArrayLike<number>,
  totalDies: number,
): Uint32Array {
  if (totalDies <= 0 || indices.length === 0) {
    return new Uint32Array(0);
  }

  const valid: number[] = [];
  for (let i = 0; i < indices.length; i += 1) {
    const raw = indices[i]!;
    if (Number.isInteger(raw) && raw >= 0 && raw < totalDies) {
      valid.push(raw);
    }
  }

  if (valid.length === 0) {
    return new Uint32Array(0);
  }

  const sorted = Uint32Array.from(valid);
  sorted.sort();

  let uniqueCount = 1;
  for (let i = 1; i < sorted.length; i += 1) {
    if (sorted[i]! !== sorted[i - 1]!) {
      sorted[uniqueCount] = sorted[i]!;
      uniqueCount += 1;
    }
  }

  return uniqueCount === sorted.length ? sorted : sorted.slice(0, uniqueCount);
}

/**
 * Maps sorted `LotModel.dies` indices to canonical `DieId` strings.
 */
export function resolveDieIdsFromIndices(
  dieIndices: Uint32Array,
  lotDieIds: readonly DieId[],
): readonly DieId[] {
  const out: DieId[] = new Array<DieId>(dieIndices.length);
  for (let i = 0; i < dieIndices.length; i += 1) {
    out[i] = lotDieIds[dieIndices[i]!]!;
  }
  return out;
}

export function collectAllTestedDieIndices(totalDies: number): Uint32Array {
  const out = new Uint32Array(totalDies);
  for (let i = 0; i < totalDies; i += 1) {
    out[i] = i;
  }
  return out;
}

export function collectAllFinalFailDieIndices(
  lot: LotModel,
  waferIndex?: number,
): Uint32Array {
  const { dies, wafers } = lot;
  const start =
    waferIndex !== undefined && waferIndex >= 0 && waferIndex < wafers.length
      ? wafers[waferIndex]!.dieStartIndex
      : 0;
  const end =
    waferIndex !== undefined && waferIndex >= 0 && waferIndex < wafers.length
      ? wafers[waferIndex]!.dieEndIndex
      : dies.count;

  let failCount = 0;
  for (let i = start; i < end; i += 1) {
    if (dies.finalPass[i] === 0) {
      failCount += 1;
    }
  }

  if (failCount === 0) {
    return new Uint32Array(0);
  }

  const out = new Uint32Array(failCount);
  let pos = 0;
  for (let i = start; i < end; i += 1) {
    if (dies.finalPass[i] === 0) {
      out[pos] = i;
      pos += 1;
    }
  }
  return out;
}

/**
 * Computes exact per-die spatial zone counts (`outer 3-die band` vs. `wafer interior`)
 * and signature wafer span so both `buildEngineFacts` and `selectPrimaryVerdict` emit
 * identical, reconciled per-die numbers that never contradict single-wafer maps.
 */
export function computeSpatialDieBreakdown(
  lot: LotModel,
  primarySpatial: PatternClassification,
): SpatialDieBreakdown {
  const totalDies = lot.dies.count;
  const normalizedSig = normalizeDieIndices(
    primarySpatial.signatureDieIndices,
    totalDies,
  );

  let edgeBandTestedDies = 0;
  let edgeBandFailDies = 0;
  let interiorTestedDies = 0;
  let interiorFailDies = 0;
  const edgeBandMaxRing = CLASSIFIER_THRESHOLDS.EDGE_RING_BAND;
  const edgeBandFailIndicesList: number[] = [];
  const validCoordFailIndicesList: number[] = [];

  for (let i = 0; i < totalDies; i += 1) {
    if (lot.dies.hasValidCoords[i] === 0) {
      continue;
    }
    const failed = lot.dies.finalPass[i] === 0;
    if (failed) {
      validCoordFailIndicesList.push(i);
    }
    const ring = lot.dies.ringIndex[i]!;
    if (ring >= 1 && ring <= edgeBandMaxRing) {
      edgeBandTestedDies += 1;
      if (failed) {
        edgeBandFailDies += 1;
        edgeBandFailIndicesList.push(i);
      }
    } else if (ring > edgeBandMaxRing) {
      interiorTestedDies += 1;
      if (failed) {
        interiorFailDies += 1;
      }
    }
  }

  let spatialDieIndices: Uint32Array;
  if (
    primarySpatial.pattern === 'Edge-Ring' &&
    edgeBandFailIndicesList.length > 0
  ) {
    spatialDieIndices = Uint32Array.from(edgeBandFailIndicesList);
  } else if (normalizedSig.length > 0) {
    spatialDieIndices = normalizedSig;
  } else if (validCoordFailIndicesList.length > 0) {
    spatialDieIndices = Uint32Array.from(validCoordFailIndicesList);
  } else {
    spatialDieIndices = collectAllFinalFailDieIndices(lot);
  }

  const waferSeen = new Uint8Array(Math.max(1, lot.wafers.length));
  let sigWaferCount = 0;
  for (let i = 0; i < spatialDieIndices.length; i += 1) {
    const w = lot.dies.waferIndex[spatialDieIndices[i]!]!;
    if (w < waferSeen.length && waferSeen[w] === 0) {
      waferSeen[w] = 1;
      sigWaferCount += 1;
    }
  }

  return {
    spatialDieIndices,
    sigCount: spatialDieIndices.length,
    sigWaferCount,
    edgeBandTestedDies,
    edgeBandFailDies,
    interiorTestedDies,
    interiorFailDies,
  };
}

/**
 * Ranks final-state failing bins following `design.md` Section 3.5:
 * - Uses `'SBIN'` whenever any final-failing die carries a defined `SBIN` (`!== 65535`),
 *   otherwise falls back to `'HBIN'`.
 * - Orders failing bins by descending final-state fail count, breaking ties by lowest
 *   numeric bin code.
 */
export function selectFailingBinRanking(lot: LotModel): readonly FailingBinRankEntry[] {
  const { dies, sbins, hbins } = lot;
  const dieCount = dies.count;

  let hasDefinedFailingSbin = false;
  let totalFails = 0;
  for (let i = 0; i < dieCount; i += 1) {
    if (dies.finalPass[i] === 0) {
      totalFails += 1;
      if (dies.sbin[i]! !== STDF_MISSING_U2) {
        hasDefinedFailingSbin = true;
      }
    }
  }

  if (totalFails === 0) {
    return [];
  }

  const mode: BinMode = hasDefinedFailingSbin ? 'SBIN' : 'HBIN';
  const codeArr = mode === 'SBIN' ? dies.sbin : dies.hbin;
  const binDefs = mode === 'SBIN' ? sbins : hbins;

  const buckets = new Map<number, number[]>();
  for (let i = 0; i < dieCount; i += 1) {
    if (dies.finalPass[i] !== 0) {
      continue;
    }
    const code = codeArr[i]!;
    if (mode === 'SBIN' && code === STDF_MISSING_U2) {
      continue;
    }
    let list = buckets.get(code);
    if (!list) {
      list = [];
      buckets.set(code, list);
    }
    list.push(i);
  }

  const entries: FailingBinRankEntry[] = [];
  const modePrefix = mode === 'SBIN' ? 'sbin' : 'hbin';
  for (const [code, indices] of buckets.entries()) {
    const rawName = binDefs.get(code)?.name ?? '';
    entries.push({
      mode,
      code,
      name: sanitizeReportProseText(rawName),
      count: indices.length,
      factId: `fact:bin:${modePrefix}-${code}`,
      dieIndices: Uint32Array.from(indices),
    });
  }

  entries.sort((a, b) => b.count - a.count || a.code - b.code);
  return entries;
}

/**
 * Identifies structured single-wafer excursions (`confidence >= 0.70` and
 * `waferFailCount / totalLotFailCount >= 0.25`) on multi-wafer lots (`wafers.length >= 2`),
 * sorted deterministically by `waferFailCount` desc, `confidence` desc, `waferIndex` asc.
 */
export function findQualifyingWaferExcursions(
  lot: LotModel,
  perWaferPatterns: readonly PatternClassification[],
  yieldSummary?: YieldSummary,
): readonly QualifyingWaferExcursion[] {
  if (lot.wafers.length < 2) {
    return [];
  }

  const resolvedYield = yieldSummary ?? computeYieldSummary(lot);
  const totalLotFails = resolvedYield.overall.finalFailDies;
  if (totalLotFails <= 0) {
    return [];
  }

  const candidates: QualifyingWaferExcursion[] = [];
  const count = Math.min(lot.wafers.length, perWaferPatterns.length);

  for (let w = 0; w < count; w += 1) {
    const classification = perWaferPatterns[w]!;
    if (!STRUCTURED_SPATIAL_CLASSES.has(classification.pattern)) {
      continue;
    }
    if (classification.confidence < WAFER_EXCURSION_THRESHOLDS.MIN_CONFIDENCE) {
      continue;
    }

    const waferMetrics = resolvedYield.byWafer[w];
    if (!waferMetrics || waferMetrics.finalFailDies <= 0) {
      continue;
    }

    const waferFailCount = waferMetrics.finalFailDies;
    const lotFailShare = waferFailCount / totalLotFails;
    if (lotFailShare < WAFER_EXCURSION_THRESHOLDS.MIN_LOT_FAIL_SHARE) {
      continue;
    }

    const normalizedSig = normalizeDieIndices(
      classification.signatureDieIndices,
      lot.dies.count,
    );
    const signatureDieIndices =
      normalizedSig.length > 0
        ? normalizedSig
        : collectAllFinalFailDieIndices(lot, w);

    if (signatureDieIndices.length === 0) {
      continue;
    }

    candidates.push({
      wafer: lot.wafers[w]!,
      classification,
      waferFailCount,
      waferTestedCount: waferMetrics.testedDies,
      waferFinalYield: waferMetrics.finalYield ?? 0,
      lotFailShare,
      signatureDieIndices,
    });
  }

  candidates.sort((a, b) => {
    if (b.waferFailCount !== a.waferFailCount) {
      return b.waferFailCount - a.waferFailCount;
    }
    if (b.classification.confidence !== a.classification.confidence) {
      return b.classification.confidence - a.classification.confidence;
    }
    return a.wafer.waferIndex - b.wafer.waferIndex;
  });

  return candidates;
}

interface InternalParametricFactCandidate {
  readonly col: ParametricTestColumn;
  readonly sampleSize: number;
  readonly outOfSpecDieIndices: Uint32Array;
  readonly executedDieIndices: Uint32Array;
  readonly mean: number;
  readonly sigma: number | null;
  readonly cp: number | null;
  readonly cpk: number | null;
  readonly hasValidLimits: boolean;
}

function evaluateParametricColumn(
  col: ParametricTestColumn,
  totalDies: number,
): InternalParametricFactCandidate | null {
  const { values, loLimit, hiLimit } = col;
  const len = Math.min(values.length, totalDies);

  const validTwoSided =
    loLimit !== null &&
    hiLimit !== null &&
    Number.isFinite(loLimit) &&
    Number.isFinite(hiLimit) &&
    loLimit < hiLimit;
  const validLoOnly =
    loLimit !== null && hiLimit === null && Number.isFinite(loLimit);
  const validHiOnly =
    hiLimit !== null && loLimit === null && Number.isFinite(hiLimit);
  const hasValidLimits = validTwoSided || validLoOnly || validHiOnly;

  let n = 0;
  let mean = 0;
  let m2 = 0;
  const outOfSpec: number[] = [];
  const executed: number[] = [];

  for (let i = 0; i < len; i += 1) {
    const v = values[i]!;
    if (!Number.isFinite(v)) {
      continue;
    }
    executed.push(i);
    n += 1;
    const delta = v - mean;
    mean += delta / n;
    const delta2 = v - mean;
    m2 += delta * delta2;

    if (hasValidLimits) {
      const belowLo =
        (validTwoSided || validLoOnly) && loLimit !== null && v < loLimit;
      const aboveHi =
        (validTwoSided || validHiOnly) && hiLimit !== null && v > hiLimit;
      if (belowLo || aboveHi) {
        outOfSpec.push(i);
      }
    }
  }

  if (n === 0) {
    return null;
  }

  const sigma = n >= 2 ? Math.sqrt(m2 / (n - 1)) : null;
  let cp: number | null = null;
  let cpk: number | null = null;

  if (sigma !== null && sigma > 0) {
    if (validTwoSided && loLimit !== null && hiLimit !== null) {
      const rawCp = (hiLimit - loLimit) / (6 * sigma);
      const cpu = (hiLimit - mean) / (3 * sigma);
      const cpl = (mean - loLimit) / (3 * sigma);
      const rawCpk = Math.min(cpu, cpl);
      cp = Number.isFinite(rawCp) ? rawCp : null;
      cpk = Number.isFinite(rawCpk) ? rawCpk : null;
    } else if (validHiOnly && hiLimit !== null) {
      const rawCpk = (hiLimit - mean) / (3 * sigma);
      cpk = Number.isFinite(rawCpk) ? rawCpk : null;
    } else if (validLoOnly && loLimit !== null) {
      const rawCpk = (mean - loLimit) / (3 * sigma);
      cpk = Number.isFinite(rawCpk) ? rawCpk : null;
    }
  }

  return {
    col,
    sampleSize: n,
    outOfSpecDieIndices: Uint32Array.from(outOfSpec),
    executedDieIndices: Uint32Array.from(executed),
    mean,
    sigma,
    cp,
    cpk,
    hasValidLimits,
  };
}

function buildParametricCapabilityFacts(lot: LotModel): readonly EngineFact[] {
  if (lot.tests.size === 0 || lot.dies.count === 0) {
    return [];
  }

  const candidates: InternalParametricFactCandidate[] = [];
  for (const col of lot.tests.values()) {
    const evaluated = evaluateParametricColumn(col, lot.dies.count);
    if (!evaluated) {
      continue;
    }
    const hasOutOfSpec = evaluated.outOfSpecDieIndices.length > 0;
    const isLowCpk =
      evaluated.cpk !== null && evaluated.cpk < LOW_CPK_WATCH_THRESHOLD;
    if (hasOutOfSpec || isLowCpk) {
      candidates.push(evaluated);
    }
  }

  if (candidates.length === 0) {
    return [];
  }

  candidates.sort((a, b) => {
    if (b.outOfSpecDieIndices.length !== a.outOfSpecDieIndices.length) {
      return b.outOfSpecDieIndices.length - a.outOfSpecDieIndices.length;
    }
    const aCpk = a.cpk ?? Number.POSITIVE_INFINITY;
    const bCpk = b.cpk ?? Number.POSITIVE_INFINITY;
    if (aCpk !== bCpk) {
      return aCpk - bCpk;
    }
    return a.col.testNum - b.col.testNum;
  });

  const selected = candidates.slice(0, MAX_PARAMETRIC_FACTS);
  const facts: EngineFact[] = [];

  for (const item of selected) {
    const { col, sampleSize, outOfSpecDieIndices, executedDieIndices, mean, cp, cpk } =
      item;
    const dieIndices =
      outOfSpecDieIndices.length > 0 ? outOfSpecDieIndices : executedDieIndices;
    if (dieIndices.length === 0) {
      continue;
    }

    const cleanTestName = sanitizeReportProseText(col.testName);
    const meanFormatted = formatScaledParametricValue(mean, col.units, col.resScal);

    const metrics: FormattedFactMetric[] = [
      intMetric('sampleSize', sampleSize),
      intMetric('failCount', outOfSpecDieIndices.length),
      {
        key: 'mean',
        numericValue: meanFormatted.scaledNumericValue,
        displayValue: meanFormatted.displayValue,
        tolerance: compute2DpTolerance(meanFormatted.scaledNumericValue),
      },
    ];

    let limitClause = '';
    if (item.hasValidLimits) {
      const validTwoSided =
        col.loLimit !== null &&
        col.hiLimit !== null &&
        col.loLimit < col.hiLimit;
      if ((validTwoSided || col.hiLimit === null) && col.loLimit !== null) {
        const loFmt = formatScaledParametricValue(
          col.loLimit,
          col.units,
          col.llmScal,
        );
        metrics.push({
          key: 'loLimit',
          numericValue: loFmt.scaledNumericValue,
          displayValue: loFmt.displayValue,
          tolerance: compute2DpTolerance(loFmt.scaledNumericValue),
        });
        limitClause = `LO ${loFmt.displayValue}`;
      }
      if ((validTwoSided || col.loLimit === null) && col.hiLimit !== null) {
        const hiFmt = formatScaledParametricValue(
          col.hiLimit,
          col.units,
          col.hlmScal,
        );
        metrics.push({
          key: 'hiLimit',
          numericValue: hiFmt.scaledNumericValue,
          displayValue: hiFmt.displayValue,
          tolerance: compute2DpTolerance(hiFmt.scaledNumericValue),
        });
        limitClause =
          limitClause.length > 0
            ? `${limitClause}, HI ${hiFmt.displayValue}`
            : `HI ${hiFmt.displayValue}`;
      }
    }

    if (cp !== null) {
      metrics.push(score2Metric('cp', cp));
    }
    if (cpk !== null) {
      metrics.push(score2Metric('cpk', cpk));
    }

    const nameLabel =
      cleanTestName.length > 0
        ? `Test ${col.testNum} (${cleanTestName})`
        : `Test ${col.testNum}`;
    const cpkClause = cpk !== null ? `, Cpk ${formatFixed2(cpk)}` : '';
    const limText = limitClause.length > 0 ? `, ${limitClause}` : '';
    const measuredNoun = sampleSize === 1 ? 'measured die' : 'measured dies';
    const outOfSpecNoun =
      outOfSpecDieIndices.length === 1 ? 'out-of-spec die' : 'out-of-spec dies';
    const summary =
      outOfSpecDieIndices.length > 0
        ? `${nameLabel} recorded ${formatGroupedInt(outOfSpecDieIndices.length)} ${outOfSpecNoun} across ${formatGroupedInt(sampleSize)} ${measuredNoun} (mean ${meanFormatted.displayValue}${limText}${cpkClause}).`
        : `${nameLabel} exhibits reduced parametric margin across ${formatGroupedInt(sampleSize)} ${measuredNoun} with 0 out-of-spec dies (mean ${meanFormatted.displayValue}${limText}${cpkClause}).`;

    facts.push({
      factId: `fact:test:${col.testNum}`,
      kind: 'parametric-capability',
      summary,
      metrics,
      dieIndices,
      dieIds: resolveDieIdsFromIndices(dieIndices, lot.dieIds),
      testRef: {
        testNum: col.testNum,
        testName: cleanTestName,
      },
    });
  }

  return facts;
}

/**
 * Runs yield summary, site-anomaly z-test, stacked/primary WM-811K classification,
 * and per-wafer WM-811K classification once into a reusable `LotAnalysisBundle`.
 */
export function analyzeLotForReport(lot: LotModel): LotAnalysisBundle {
  const yieldSummary = computeYieldSummary(lot);
  const siteAnomalies = detectSiteAnomalies(lot);
  const waferCount = lot.wafers.length;

  if (waferCount === 0) {
    const emptyPrimary = classifyStackedPattern(lot);
    return {
      yieldSummary,
      siteAnomalies,
      primarySpatial: emptyPrimary,
      perWaferPatterns: [],
    };
  }

  const perWaferPatterns: PatternClassification[] = new Array<PatternClassification>(
    waferCount,
  );
  for (let w = 0; w < waferCount; w += 1) {
    perWaferPatterns[w] = classifyWaferPattern(lot, w);
  }

  const primarySpatial =
    waferCount === 1 ? perWaferPatterns[0]! : classifyStackedPattern(lot);

  return {
    yieldSummary,
    siteAnomalies,
    primarySpatial,
    perWaferPatterns,
  };
}

/**
 * Extracts deterministic, referentially grounded `EngineFact`s from `lot` and `analysis`.
 *
 * Every returned `EngineFact` has a unique stable `factId` and guarantees
 * `dieIndices.length >= 1` (`dieIds.length >= 1`). Returns `[]` only when `lot.dies.count === 0`.
 */
export function buildEngineFacts(
  lot: LotModel,
  analysis?: LotAnalysisBundle,
): readonly EngineFact[] {
  const totalDies = lot.dies.count;
  if (totalDies === 0) {
    return [];
  }

  const resolvedAnalysis = analysis ?? analyzeLotForReport(lot);
  const { yieldSummary, siteAnomalies, primarySpatial, perWaferPatterns } =
    resolvedAnalysis;
  const { overall } = yieldSummary;

  const testedDies = overall.testedDies;
  const totalFailDies = overall.finalFailDies;
  const finalYield = overall.finalYield ?? 0;
  const firstPassYield = overall.firstPassYield ?? 0;
  const failDenomNoun = formatFinalFailNoun(totalFailDies);
  const testedDenomNoun = testedDies === 1 ? 'tested die' : 'tested dies';

  const allFailDieIndices =
    totalFailDies > 0 ? collectAllFinalFailDieIndices(lot) : new Uint32Array(0);

  const facts: EngineFact[] = [];

  // 1. Lot-level yield fact (`fact:lot-yield`)
  const lotYieldDieIndices =
    totalFailDies === 0 ? collectAllTestedDieIndices(totalDies) : allFailDieIndices;

  const lotFailShare = formatBoundedSharePct1(totalFailDies, testedDies);
  const lotYieldMetrics: FormattedFactMetric[] = [
    intMetric('testedDies', testedDies),
    intMetric('finalPassDies', overall.finalPassDies),
    intMetric('finalFailDies', totalFailDies),
    boundedPctMetric('finalFailSharePct', totalFailDies, testedDies),
    pctMetricFromRatio('finalYieldPct', finalYield),
    pctMetricFromRatio('firstPassYieldPct', firstPassYield),
    intMetric('waferCount', lot.wafers.length),
    intMetric('siteCount', lot.sites.length),
  ];

  if (totalFailDies === 0) {
    lotYieldMetrics.push(score2Metric('confidence', capDisplayedConfidence(1.0)));
  } else if (primarySpatial.pattern === 'None') {
    lotYieldMetrics.push(
      score2Metric('confidence', capDisplayedConfidence(primarySpatial.confidence)),
    );
  }

  const waferNoun = lot.wafers.length === 1 ? 'wafer' : 'wafers';
  const lotYieldSummaryText =
    totalFailDies === 0
      ? `All ${formatGroupedInt(testedDies)} ${testedDenomNoun} across ${formatGroupedInt(lot.wafers.length)} ${waferNoun} passed final sort (0 final fails, ${formatRatioPct1(firstPassYield)} first-pass yield).`
      : `${formatGroupedInt(totalFailDies)} of ${formatGroupedInt(testedDies)} ${testedDenomNoun} (${lotFailShare.displayValue}) are ${failDenomNoun} across ${formatGroupedInt(lot.wafers.length)} ${waferNoun} (${formatGroupedInt(overall.finalPassDies)} passing dies, ${formatRatioPct1(finalYield)} final yield).`;

  facts.push({
    factId: 'fact:lot-yield',
    kind: 'lot-yield',
    summary: lotYieldSummaryText,
    metrics: lotYieldMetrics,
    dieIndices: lotYieldDieIndices,
    dieIds: resolveDieIdsFromIndices(lotYieldDieIndices, lot.dieIds),
    ...(totalFailDies > 0 && primarySpatial.pattern === 'None'
      ? { hypotheses: BASELINE_LOW_DENSITY_HYPOTHESES }
      : {}),
  });

  // 2. Primary WM-811K spatial pattern fact (`fact:spatial:primary`) when pattern !== 'None'
  if (primarySpatial.pattern !== 'None') {
    const spatialBreakdown = computeSpatialDieBreakdown(lot, primarySpatial);
    const {
      spatialDieIndices,
      sigCount,
      sigWaferCount,
      edgeBandTestedDies,
      edgeBandFailDies,
      interiorTestedDies,
      interiorFailDies,
    } = spatialBreakdown;

    if (spatialDieIndices.length > 0) {
      let matchingWaferCount = 0;
      for (let w = 0; w < perWaferPatterns.length; w += 1) {
        if (perWaferPatterns[w]!.pattern === primarySpatial.pattern) {
          matchingWaferCount += 1;
        }
      }

      const f = primarySpatial.features;
      const sigShare = formatBoundedSharePct1(sigCount, totalFailDies);
      const edgeBandDieRate = formatBoundedSharePct1(
        edgeBandFailDies,
        edgeBandTestedDies,
      );
      const interiorDieRate = formatBoundedSharePct1(
        interiorFailDies,
        interiorTestedDies,
      );
      const headlineEdgeNumerator =
        edgeBandFailDies > 0 ? edgeBandFailDies : sigCount;
      const lotDieFailRate = formatBoundedSharePct1(totalFailDies, testedDies);
      const edgeBandRings = CLASSIFIER_THRESHOLDS.EDGE_RING_BAND;

      const spatialMetrics: FormattedFactMetric[] = [
        score2Metric('confidence', capDisplayedConfidence(primarySpatial.confidence)),
        intMetric('signatureDieCount', sigCount),
        intMetric('totalFailDies', totalFailDies),
        intMetric('testedDies', testedDies),
        boundedPctMetric('signatureShareOfFailsPct', sigCount, totalFailDies),
        boundedPctMetric(
          'headlineEdgeBandFailSharePct',
          headlineEdgeNumerator,
          totalFailDies,
        ),
        intMetric('edgeBandWidthDies', edgeBandRings),
        intMetric('edgeBandFailDies', edgeBandFailDies),
        intMetric('interiorFailDies', interiorFailDies),
        boundedPctMetric(
          'edgeBandDieFailRatePct',
          edgeBandFailDies,
          edgeBandTestedDies,
        ),
        boundedPctMetric(
          'interiorDieFailRatePct',
          interiorFailDies,
          interiorTestedDies,
        ),
        boundedPctMetric('lotDieFailRatePct', totalFailDies, testedDies),
        intMetric('signatureWaferCount', sigWaferCount),
        intMetric('matchingWaferCount', matchingWaferCount),
        intMetric('waferCount', lot.wafers.length),
        intMetric('activeFailCellCount', f.activeFailCellCount),
        intMetric('testedCellCount', f.testedCellCount),
        score2Metric('maxScratchElongation', f.maxScratchElongation),
        score2Metric('maxScratchAspectRatio', f.maxScratchAspectRatio),
      ];

      const multiWaferSpan =
        lot.wafers.length >= 2
          ? ` across ${formatGroupedInt(sigWaferCount)} of ${formatGroupedInt(lot.wafers.length)} wafers`
          : ' on the wafer map';

      let spatialSummary: string;
      if (primarySpatial.pattern === 'Edge-Ring') {
        const interiorClause =
          interiorFailDies > 0 && interiorTestedDies > 0
            ? ` vs. ${interiorDieRate.displayValue} in the wafer interior (${formatGroupedInt(interiorFailDies)} interior ${formatFinalFailNoun(interiorFailDies)})`
            : ` with 0 interior final fails`;
        if (sigCount === edgeBandFailDies || edgeBandFailDies === 0) {
          spatialSummary = `${formatGroupedInt(sigCount)} of ${formatGroupedInt(totalFailDies)} ${failDenomNoun} (${sigShare.displayValue}) lie in the ${edgeBandRings}-die edge band${multiWaferSpan}: ${edgeBandDieRate.displayValue} edge-band die fail rate${interiorClause}.`;
        } else {
          spatialSummary = `${formatGroupedInt(sigCount)} of ${formatGroupedInt(totalFailDies)} ${failDenomNoun} (${sigShare.displayValue}) recur in stacked ${edgeBandRings}-die edge-band cells${multiWaferSpan} (${formatGroupedInt(edgeBandFailDies)} of ${formatGroupedInt(totalFailDies)} ${failDenomNoun} lie in the edge band overall; ${edgeBandDieRate.displayValue} edge-band die fail rate${interiorClause}).`;
        }
      } else if (primarySpatial.pattern === 'Scratch') {
        const trackNoun =
          lot.wafers.length >= 2
            ? 'recurring stacked scratch cells'
            : 'a linear defect track';
        spatialSummary = `${formatGroupedInt(sigCount)} of ${formatGroupedInt(totalFailDies)} ${failDenomNoun} (${sigShare.displayValue}) lie along ${trackNoun}${multiWaferSpan} (PCA elongation ${formatFixed2(f.maxScratchElongation)}, aspect ratio ${formatFixed2(f.maxScratchAspectRatio)}).`;
      } else if (primarySpatial.pattern === 'Random') {
        if (lot.wafers.length >= 2 && sigCount < totalFailDies) {
          spatialSummary = `${formatGroupedInt(sigCount)} of ${formatGroupedInt(totalFailDies)} ${failDenomNoun} (${sigShare.displayValue}) fall in recurring stack cells${multiWaferSpan} (${lotDieFailRate.displayValue} lot-wide die fail rate across ${formatGroupedInt(testedDies)} ${testedDenomNoun}) without radial or linear clustering.`;
        } else {
          const randScope =
            lot.wafers.length >= 2
              ? `across ${formatGroupedInt(lot.wafers.length)} wafers`
              : 'across the wafer';
          spatialSummary = `${formatGroupedInt(sigCount)} of ${formatGroupedInt(totalFailDies)} ${failDenomNoun} (${lotDieFailRate.displayValue} of ${formatGroupedInt(testedDies)} ${testedDenomNoun}) scatter ${randScope} without radial or linear clustering.`;
        }
      } else {
        const structScope =
          lot.wafers.length >= 2
            ? `in recurring stack cells${multiWaferSpan}`
            : 'on the wafer map';
        spatialSummary = `${primarySpatial.pattern} signature accounts for ${formatGroupedInt(sigCount)} of ${formatGroupedInt(totalFailDies)} ${failDenomNoun} (${sigShare.displayValue}) ${structScope} (${lotDieFailRate.displayValue} of ${formatGroupedInt(testedDies)} ${testedDenomNoun}).`;
      }

      facts.push({
        factId: 'fact:spatial:primary',
        kind: 'spatial-pattern',
        summary: spatialSummary,
        metrics: spatialMetrics,
        dieIndices: spatialDieIndices,
        dieIds: resolveDieIdsFromIndices(spatialDieIndices, lot.dieIds),
        hypotheses: primarySpatial.candidateHypotheses,
      });
    }
  }

  // 3. Dominant and secondary failing bin facts (`fact:bin:sbin-<code>` / `fact:bin:hbin-<code>`)
  const rankedBins = selectFailingBinRanking(lot);
  const maxBinsToEmit = Math.min(rankedBins.length, 1 + MAX_SECONDARY_BIN_FACTS);
  for (let r = 0; r < maxBinsToEmit; r += 1) {
    const entry = rankedBins[r]!;
    const shareOfTested = formatBoundedSharePct1(entry.count, testedDies);
    const shareOfFailures = formatBoundedSharePct1(entry.count, totalFailDies);
    const isDominant = r === 0;
    const binLabel = formatBinRefLabel(entry);

    const binMetrics: FormattedFactMetric[] = [
      intMetric('dieCount', entry.count),
      intMetric('totalFailDies', totalFailDies),
      intMetric('testedDies', testedDies),
      pctMetricFromRatio('lotFinalYieldPct', finalYield),
      boundedPctMetric('shareOfTestedPct', entry.count, testedDies),
      boundedPctMetric('shareOfFailuresPct', entry.count, totalFailDies),
    ];

    const rolePrefix = isDominant ? 'Dominant bin' : 'Secondary bin';
    const summary = `${rolePrefix} ${binLabel} accounts for ${formatGroupedInt(entry.count)} of ${formatGroupedInt(totalFailDies)} ${failDenomNoun} (${shareOfFailures.displayValue}; ${shareOfTested.displayValue} of ${formatGroupedInt(testedDies)} ${testedDenomNoun}).`;

    facts.push({
      factId: entry.factId,
      kind: isDominant ? 'dominant-bin' : 'secondary-bin',
      summary,
      metrics: binMetrics,
      dieIndices: entry.dieIndices,
      dieIds: resolveDieIdsFromIndices(entry.dieIndices, lot.dieIds),
      binRef: {
        mode: entry.mode,
        code: entry.code,
        name: entry.name,
      },
      ...(isDominant && primarySpatial.pattern === 'None'
        ? { hypotheses: BASELINE_LOW_DENSITY_HYPOTHESES }
        : {}),
    });
  }

  // 4. Test Site concentration anomaly facts (`fact:site:<head>-<site>`)
  for (const anomaly of siteAnomalies) {
    const siteDieIndices = normalizeDieIndices(anomaly.failingDieIndices, totalDies);
    if (siteDieIndices.length === 0) {
      continue;
    }

    const { headNum, siteNum } = anomaly.site;
    const siteFpYield = anomaly.siteMetrics.firstPassYield ?? 0;
    const otherFpYield = anomaly.otherSitesFirstPassYield;
    const dropPp = Math.abs(anomaly.yieldDeltaPp);
    const siteFpFails = siteDieIndices.length;
    const totalFpFails = Math.max(siteFpFails, overall.firstPassFailDies);
    const siteFpShare = formatBoundedSharePct1(siteFpFails, totalFpFails);
    const fpFailNoun = totalFpFails === 1 ? 'first-pass fail' : 'first-pass fails';

    const siteMetrics: FormattedFactMetric[] = [
      score2Metric('confidence', capDisplayedConfidence(anomaly.confidence)),
      pctMetricFromRatio('firstPassYieldPct', siteFpYield),
      pctMetricFromRatio('otherSitesFirstPassYieldPct', otherFpYield),
      ppMetric('yieldDropPp', dropPp),
      score2Metric('twoProportionZ', anomaly.twoProportionZ),
      intMetric('firstPassFailDies', siteFpFails),
      intMetric('lotFirstPassFailDies', totalFpFails),
      boundedPctMetric('siteFirstPassFailSharePct', siteFpFails, totalFpFails),
      intMetric('firstPassTestedDies', anomaly.siteMetrics.firstPassTestedDies),
      intMetric('excessFailCount', anomaly.excessFailCount),
      pctMetricFromRatio('excessFailSharePct', anomaly.excessFailShare),
    ];

    if (anomaly.siteMetrics.finalYield !== null) {
      siteMetrics.push(
        pctMetricFromRatio('finalYieldPct', anomaly.siteMetrics.finalYield),
      );
    }

    const summary = `Site ${headNum}:${siteNum} recorded ${formatGroupedInt(siteFpFails)} of ${formatGroupedInt(totalFpFails)} ${fpFailNoun} (${siteFpShare.displayValue}): ${formatRatioPct1(siteFpYield)} first-pass yield vs. ${formatRatioPct1(otherFpYield)} across other sites (${formatPp1(dropPp)} drop, z = ${formatFixed2(anomaly.twoProportionZ)}).`;

    facts.push({
      factId: `fact:site:${headNum}-${siteNum}`,
      kind: 'site-anomaly',
      summary,
      metrics: siteMetrics,
      dieIndices: siteDieIndices,
      dieIds: resolveDieIdsFromIndices(siteDieIndices, lot.dieIds),
      siteRef: { headNum, siteNum },
      hypotheses: formatSiteConcentrationHypotheses({ headNum, siteNum }),
    });
  }

  // 5. Diluted single-wafer excursion facts (`fact:wafer-excursion:<waferIndex>`)
  const waferExcursions = findQualifyingWaferExcursions(
    lot,
    perWaferPatterns,
    yieldSummary,
  );
  const maxExcursions = Math.min(waferExcursions.length, MAX_WAFER_EXCURSION_FACTS);
  for (let e = 0; e < maxExcursions; e += 1) {
    const exc = waferExcursions[e]!;
    const cleanWaferId =
      sanitizeReportProseText(exc.wafer.waferId) ||
      `W${String(exc.wafer.waferIndex + 1).padStart(2, '0')}`;
    const sigLen = exc.signatureDieIndices.length;
    const sigLotShare = formatBoundedSharePct1(sigLen, totalFailDies);
    const wfLotShare = formatBoundedSharePct1(exc.waferFailCount, totalFailDies);

    const excMetrics: FormattedFactMetric[] = [
      score2Metric(
        'confidence',
        capDisplayedConfidence(exc.classification.confidence),
      ),
      intMetric('signatureDieCount', sigLen),
      intMetric('waferFailDies', exc.waferFailCount),
      intMetric('waferTestedDies', exc.waferTestedCount),
      intMetric('totalFailDies', totalFailDies),
      pctMetricFromRatio('waferFinalYieldPct', exc.waferFinalYield),
      boundedPctMetric('signatureFailSharePct', sigLen, totalFailDies),
      boundedPctMetric('lotFailSharePct', exc.waferFailCount, totalFailDies),
    ];

    const wfTestedNoun =
      exc.waferTestedCount === 1 ? 'tested wafer die' : 'tested wafer dies';
    const summary =
      sigLen === exc.waferFailCount
        ? `Wafer ${cleanWaferId} ${exc.classification.pattern} excursion accounts for ${formatGroupedInt(exc.waferFailCount)} of ${formatGroupedInt(totalFailDies)} ${failDenomNoun} (${wfLotShare.displayValue}; ${formatRatioPct1(exc.waferFinalYield)} wafer yield across ${formatGroupedInt(exc.waferTestedCount)} ${wfTestedNoun}).`
        : `Wafer ${cleanWaferId} ${exc.classification.pattern} signature spans ${formatGroupedInt(sigLen)} of ${formatGroupedInt(totalFailDies)} ${failDenomNoun} (${sigLotShare.displayValue}; ${formatGroupedInt(exc.waferFailCount)} of ${formatGroupedInt(totalFailDies)} ${failDenomNoun} sit on Wafer ${cleanWaferId}, ${formatRatioPct1(exc.waferFinalYield)} wafer yield).`;

    facts.push({
      factId: `fact:wafer-excursion:${exc.wafer.waferIndex}`,
      kind: 'wafer-excursion',
      summary,
      metrics: excMetrics,
      dieIndices: exc.signatureDieIndices,
      dieIds: resolveDieIdsFromIndices(exc.signatureDieIndices, lot.dieIds),
      waferRef: {
        waferIndex: exc.wafer.waferIndex,
        waferId: cleanWaferId,
      },
      hypotheses: exc.classification.candidateHypotheses,
    });
  }

  // 6. Parametric capability facts (`fact:test:<testNum>`) when full-mode PTRs exist
  const parametricFacts = buildParametricCapabilityFacts(lot);
  for (const pf of parametricFacts) {
    facts.push(pf);
  }

  // 7. Retest recovery fact (`fact:retest-recovery`) when retest executions > 0
  if (overall.retestExecutions > 0) {
    const retestedList: number[] = [];
    let recoveredCount = 0;
    for (let i = 0; i < totalDies; i += 1) {
      if (lot.dies.retestCount[i]! > 0) {
        retestedList.push(i);
      }
      if (lot.dies.firstPass[i] === 0 && lot.dies.finalPass[i] !== 0) {
        recoveredCount += 1;
      }
    }

    if (retestedList.length > 0) {
      const retestDieIndices = Uint32Array.from(retestedList);
      const gainPp = Math.max(0, (finalYield - firstPassYield) * 100);
      const retestTouchdownNoun =
        overall.retestExecutions === 1 ? 'retest touchdown' : 'retest touchdowns';
      const recovFailNoun =
        recoveredCount === 1 ? 'first-pass fail' : 'first-pass fails';

      const retestMetrics: FormattedFactMetric[] = [
        intMetric('retestedDies', retestDieIndices.length),
        intMetric('testedDies', testedDies),
        intMetric('retestExecutions', overall.retestExecutions),
        intMetric('recoveredDies', recoveredCount),
        pctMetricFromRatio('firstPassYieldPct', firstPassYield),
        pctMetricFromRatio('finalYieldPct', finalYield),
        ppMetric('recoveryGainPp', gainPp),
      ];

      const summary =
        recoveredCount > 0
          ? `Retest re-probed ${formatGroupedInt(retestDieIndices.length)} of ${formatGroupedInt(testedDies)} ${testedDenomNoun} (${formatGroupedInt(overall.retestExecutions)} ${retestTouchdownNoun}), recovering ${formatGroupedInt(recoveredCount)} ${recovFailNoun} and lifting yield from ${formatRatioPct1(firstPassYield)} to ${formatRatioPct1(finalYield)} (+${formatPp1(gainPp)}).`
          : `Retest re-probed ${formatGroupedInt(retestDieIndices.length)} of ${formatGroupedInt(testedDies)} ${testedDenomNoun} (${formatGroupedInt(overall.retestExecutions)} ${retestTouchdownNoun}) with 0 recoveries.`;

      facts.push({
        factId: 'fact:retest-recovery',
        kind: 'retest-recovery',
        summary,
        metrics: retestMetrics,
        dieIndices: retestDieIndices,
        dieIds: resolveDieIdsFromIndices(retestDieIndices, lot.dieIds),
      });
    }
  }

  return facts;
}
