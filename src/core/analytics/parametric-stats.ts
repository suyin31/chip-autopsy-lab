/**
 * Parametric distribution statistics, process capability indices (`Cp` / `Cpk`),
 * histogram binning, and SI-scaled measurement formatting (`src/core/analytics/parametric-stats.ts`).
 *
 * Pure deterministic TypeScript with zero React, Next.js, or DOM imports.
 * Uses Welford's online algorithm for numerically stable mean and sample standard deviation
 * (`n - 1` denominator) over columnar `Float32Array` test columns and optional `Uint8Array`
 * selection masks.
 *
 * Validates: Requirements 1.8, 8.1, 8.2, 8.3, 8.4, 17.4, 17.7
 */

import type { LotModel, ParametricTestColumn } from '../model/types';

/** STDF V4 `RES_SCAL`/`LLM_SCAL`/`HLM_SCAL` power-of-10 display exponent to SI prefix map. */
export const PARAMETRIC_SI_PREFIX_BY_EXPONENT: Readonly<Record<number, string>> =
  {
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

const EXPONENTIAL_MAGNITUDE_THRESHOLD = 1e6;
const DEFAULT_MIN_HISTOGRAM_BINS = 12;
const DEFAULT_MAX_HISTOGRAM_BINS = 28;

export interface ParametricCapabilityStats {
  readonly n: number;
  readonly failCount: number;
  readonly mean: number | null;
  /** Sample standard deviation (`n - 1` denominator); `null` when `n < 2`. */
  readonly sigma: number | null;
  readonly min: number | null;
  readonly max: number | null;
  /** Validated effective low limit (`null` if absent, non-finite, or inverted against `hiLimit`). */
  readonly loLimit: number | null;
  /** Validated effective high limit (`null` if absent, non-finite, or inverted against `loLimit`). */
  readonly hiLimit: number | null;
  /** Two-sided process potential `(HI - LO) / (6 * sigma)`, or `null` when invalid. */
  readonly cp: number | null;
  /** Two-sided `min(Cpu, Cpl)` or single-sided `Cpu` / `Cpl`, or `null` when invalid. */
  readonly cpk: number | null;
}

export interface ParametricCapabilitySummary extends ParametricCapabilityStats {
  readonly testNum: number;
  readonly testName: string;
  readonly units: string;
  /** Power-of-10 display exponent from `PTR.RES_SCAL`. */
  readonly displayScaleExp: number;
  /** Power-of-10 display exponent from `PTR.LLM_SCAL`. */
  readonly llmScal: number;
  /** Power-of-10 display exponent from `PTR.HLM_SCAL`. */
  readonly hlmScal: number;
}

export interface ParametricHistogramBin {
  readonly index: number;
  /** Inclusive lower edge in base units. */
  readonly x0: number;
  /** Upper edge in base units (exclusive except on the final bin). */
  readonly x1: number;
  /** Count of finite selected measurements falling in this bin. */
  readonly count: number;
  /** `true` when the bin midpoint lies outside valid `loLimit` / `hiLimit`. */
  readonly outOfSpec: boolean;
}

export interface ParametricHistogram {
  readonly testNum: number;
  readonly n: number;
  readonly min: number | null;
  readonly max: number | null;
  /** Plot domain minimum covering measurements and valid specification limits. */
  readonly domainMin: number | null;
  /** Plot domain maximum covering measurements and valid specification limits. */
  readonly domainMax: number | null;
  readonly loLimit: number | null;
  readonly hiLimit: number | null;
  readonly maxBinCount: number;
  readonly bins: readonly ParametricHistogramBin[];
}

export interface ParametricHistogramOptions {
  readonly binCount?: number;
}

export interface ScaledUnitInfo {
  readonly effectiveExp: number;
  readonly prefix: string;
  readonly baseUnits: string;
  readonly unitLabel: string;
}

/**
 * Strips ASCII control characters and angle brackets from untrusted STDF unit/test strings.
 */
function sanitizePlainText(raw: string): string {
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
 * Validates raw STDF `loLimit`/`hiLimit` pairs according to Requirements 8.3 and 8.4:
 * - Two-sided limits are valid iff both are finite and `loLimit < hiLimit`.
 * - Single-sided limits are valid iff exactly one limit is finite and the other is absent (`null`).
 * - Inverted limits (`loLimit >= hiLimit` when both are provided) invalidate both limits.
 */
export function resolveValidSpecLimits(
  rawLo: number | null,
  rawHi: number | null,
): {
  readonly loLimit: number | null;
  readonly hiLimit: number | null;
  readonly kind: 'two-sided' | 'lo-only' | 'hi-only' | 'none';
} {
  const hasLo = rawLo !== null && Number.isFinite(rawLo);
  const hasHi = rawHi !== null && Number.isFinite(rawHi);

  if (hasLo && hasHi) {
    if (rawLo < rawHi) {
      return { loLimit: rawLo, hiLimit: rawHi, kind: 'two-sided' };
    }
    return { loLimit: null, hiLimit: null, kind: 'none' };
  }
  if (hasLo) {
    return { loLimit: rawLo, hiLimit: null, kind: 'lo-only' };
  }
  if (hasHi) {
    return { loLimit: null, hiLimit: rawHi, kind: 'hi-only' };
  }
  return { loLimit: null, hiLimit: null, kind: 'none' };
}

/**
 * Computes Welford mean, sample standard deviation (`n - 1`), out-of-spec count, `Cp`, and `Cpk`
 * directly over any `ArrayLike<number>` (full Float64 precision for `number[]` or `Float64Array`,
 * and zero-copy for columnar `Float32Array` test columns).
 *
 * Validates: Requirements 8.3, 8.4 (Property 7).
 */
export function computeParametricCapabilityFromValues(
  values: ArrayLike<number>,
  rawLoLimit: number | null,
  rawHiLimit: number | null,
  selectionMask?: Uint8Array,
): ParametricCapabilityStats {
  const { loLimit, hiLimit, kind } = resolveValidSpecLimits(
    rawLoLimit,
    rawHiLimit,
  );
  const len =
    selectionMask !== undefined
      ? Math.min(values.length, selectionMask.length)
      : values.length;

  let n = 0;
  let mean = 0;
  let m2 = 0;
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  let failCount = 0;

  for (let i = 0; i < len; i += 1) {
    if (selectionMask !== undefined && selectionMask[i] === 0) {
      continue;
    }
    const v = values[i]!;
    if (!Number.isFinite(v)) {
      continue;
    }

    n += 1;
    const delta = v - mean;
    mean += delta / n;
    const delta2 = v - mean;
    m2 += delta * delta2;

    if (v < min) min = v;
    if (v > max) max = v;

    if (
      (loLimit !== null && v < loLimit) ||
      (hiLimit !== null && v > hiLimit)
    ) {
      failCount += 1;
    }
  }

  if (n === 0) {
    return {
      n: 0,
      failCount: 0,
      mean: null,
      sigma: null,
      min: null,
      max: null,
      loLimit,
      hiLimit,
      cp: null,
      cpk: null,
    };
  }

  // Guard against floating-point noise in Welford's M2 when every finite sample is identical.
  const sigma =
    n >= 2 ? (min === max ? 0 : Math.sqrt(Math.max(0, m2) / (n - 1))) : null;

  let cp: number | null = null;
  let cpk: number | null = null;

  if (n >= 2 && sigma !== null && sigma > 0) {
    if (kind === 'two-sided' && loLimit !== null && hiLimit !== null) {
      const rawCp = (hiLimit - loLimit) / (6 * sigma);
      const cpu = (hiLimit - mean) / (3 * sigma);
      const cpl = (mean - loLimit) / (3 * sigma);
      const rawCpk = Math.min(cpu, cpl);
      cp = Number.isFinite(rawCp) ? rawCp : null;
      cpk = Number.isFinite(rawCpk) ? rawCpk : null;
    } else if (kind === 'hi-only' && hiLimit !== null) {
      const rawCpu = (hiLimit - mean) / (3 * sigma);
      cpk = Number.isFinite(rawCpu) ? rawCpu : null;
    } else if (kind === 'lo-only' && loLimit !== null) {
      const rawCpl = (mean - loLimit) / (3 * sigma);
      cpk = Number.isFinite(rawCpl) ? rawCpl : null;
    }
  }

  return {
    n,
    failCount,
    mean,
    sigma,
    min,
    max,
    loLimit,
    hiLimit,
    cp,
    cpk,
  };
}

/**
 * Computes Welford statistics and process capability indices (`Cp` / `Cpk`) for one
 * `ParametricTestColumn`, optionally scoped to `selectionMask`.
 */
export function computeParametricCapability(
  col: ParametricTestColumn,
  selectionMask?: Uint8Array,
): ParametricCapabilitySummary {
  const stats = computeParametricCapabilityFromValues(
    col.values,
    col.loLimit,
    col.hiLimit,
    selectionMask,
  );
  return {
    testNum: col.testNum,
    testName: col.testName,
    units: col.units,
    displayScaleExp: col.resScal,
    llmScal: col.llmScal,
    hlmScal: col.hlmScal,
    ...stats,
  };
}

/**
 * Computes capability summaries for all parametric tests in `lot`, ordered deterministically
 * by ascending `testNum`.
 */
export function computeLotParametricSummaries(
  lot: LotModel,
  selectionMask?: Uint8Array,
): readonly ParametricCapabilitySummary[] {
  if (lot.tests.size === 0) {
    return [];
  }
  const out: ParametricCapabilitySummary[] = [];
  for (const col of lot.tests.values()) {
    out.push(computeParametricCapability(col, selectionMask));
  }
  out.sort((a, b) => a.testNum - b.testNum);
  return out;
}

/**
 * Computes deterministic equal-width histogram bins over finite measurements in `col`,
 * optionally scoped to `selectionMask`, preserving exact count conservation (`sum(count) === n`).
 */
export function computeParametricHistogram(
  col: ParametricTestColumn,
  selectionMask?: Uint8Array,
  options?: ParametricHistogramOptions,
): ParametricHistogram {
  const { loLimit, hiLimit } = resolveValidSpecLimits(col.loLimit, col.hiLimit);
  const vals = col.values;
  const len =
    selectionMask !== undefined
      ? Math.min(vals.length, selectionMask.length)
      : vals.length;

  let n = 0;
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;

  for (let i = 0; i < len; i += 1) {
    if (selectionMask !== undefined && selectionMask[i] === 0) {
      continue;
    }
    const v = vals[i]!;
    if (!Number.isFinite(v)) {
      continue;
    }
    n += 1;
    if (v < min) min = v;
    if (v > max) max = v;
  }

  if (n === 0) {
    return {
      testNum: col.testNum,
      n: 0,
      min: null,
      max: null,
      domainMin: null,
      domainMax: null,
      loLimit,
      hiLimit,
      maxBinCount: 0,
      bins: [],
    };
  }

  const isOutOfSpecValue = (v: number): boolean =>
    (loLimit !== null && v < loLimit) || (hiLimit !== null && v > hiLimit);

  // Degenerate constant distribution: single bin centered on `min`
  if (min === max) {
    const pad = Math.max(Math.abs(min) * 0.05, 1e-9);
    let domainMin = min - pad;
    let domainMax = max + pad;
    if (loLimit !== null && loLimit < domainMin) domainMin = loLimit;
    if (hiLimit !== null && hiLimit > domainMax) domainMax = hiLimit;
    const binHalf = Math.max((domainMax - domainMin) / 24, pad * 0.25);

    return {
      testNum: col.testNum,
      n,
      min,
      max,
      domainMin,
      domainMax,
      loLimit,
      hiLimit,
      maxBinCount: n,
      bins: [
        {
          index: 0,
          x0: min - binHalf,
          x1: min + binHalf,
          count: n,
          outOfSpec: isOutOfSpecValue(min),
        },
      ],
    };
  }

  const requestedBins = options?.binCount;
  const autoBins = Math.min(
    DEFAULT_MAX_HISTOGRAM_BINS,
    Math.max(DEFAULT_MIN_HISTOGRAM_BINS, Math.round(Math.sqrt(n))),
  );
  const binCount =
    requestedBins !== undefined && Number.isFinite(requestedBins)
      ? Math.max(1, Math.min(128, Math.trunc(requestedBins)))
      : autoBins;

  const span = max - min;
  const step = span / binCount;
  const counts = new Uint32Array(binCount);

  for (let i = 0; i < len; i += 1) {
    if (selectionMask !== undefined && selectionMask[i] === 0) {
      continue;
    }
    const v = vals[i]!;
    if (!Number.isFinite(v)) {
      continue;
    }
    const rawIdx = Math.floor((v - min) / step);
    const idx =
      rawIdx < 0 ? 0 : rawIdx >= binCount ? binCount - 1 : rawIdx;
    counts[idx] = counts[idx]! + 1;
  }

  let maxBinCount = 0;
  const bins: ParametricHistogramBin[] = new Array<ParametricHistogramBin>(
    binCount,
  );
  for (let b = 0; b < binCount; b += 1) {
    const x0 = min + b * step;
    const x1 = b === binCount - 1 ? max : min + (b + 1) * step;
    const count = counts[b]!;
    if (count > maxBinCount) {
      maxBinCount = count;
    }
    const mid = (x0 + x1) / 2;
    bins[b] = {
      index: b,
      x0,
      x1,
      count,
      outOfSpec: isOutOfSpecValue(mid),
    };
  }

  let domainMin = min;
  let domainMax = max;
  if (loLimit !== null && loLimit < domainMin) {
    domainMin = loLimit;
  }
  if (hiLimit !== null && hiLimit > domainMax) {
    domainMax = hiLimit;
  }

  return {
    testNum: col.testNum,
    n,
    min,
    max,
    domainMin,
    domainMax,
    loLimit,
    hiLimit,
    maxBinCount,
    bins,
  };
}

/**
 * Resolves the SI prefix and combined unit label from an STDF base `units` string and
 * display exponent (`RES_SCAL`/`LLM_SCAL`/`HLM_SCAL`).
 */
export function resolveScaledUnitLabel(
  units: string,
  scalExp = 0,
): ScaledUnitInfo {
  const baseUnits = sanitizePlainText(units);
  const effectiveExp =
    baseUnits.length === 0 || !Number.isFinite(scalExp)
      ? 0
      : Math.max(-12, Math.min(15, Math.round(scalExp / 3) * 3));
  const prefix = PARAMETRIC_SI_PREFIX_BY_EXPONENT[effectiveExp] ?? '';
  return {
    effectiveExp,
    prefix,
    baseUnits,
    unitLabel: `${prefix}${baseUnits}`,
  };
}

function formatGroupedDecimal2(value: number): string {
  if (!Number.isFinite(value)) {
    return '0.00';
  }
  const normalized = Math.abs(value) < 1e-12 ? 0 : value;
  if (Math.abs(normalized) >= EXPONENTIAL_MAGNITUDE_THRESHOLD) {
    return normalized.toExponential(2);
  }
  const fixed = normalized.toFixed(2);
  const negative = fixed.startsWith('-');
  const unsigned = negative ? fixed.slice(1) : fixed;
  const [intPart = '0', fracPart = '00'] = unsigned.split('.');
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${negative ? '-' : ''}${grouped}.${fracPart}`;
}

/**
 * Formats a base-unit measurement using the STDF V4 power-of-10 display exponent
 * (`displayed = baseValue * 10^scalExp`) and SI unit prefix (`nA`, `uA`, `mV`, `GHz`, etc.).
 *
 * Validates: Requirements 1.8, 8.2, 17.4.
 */
export function formatScaledMeasurement(
  baseValue: number,
  units: string,
  scalExp = 0,
): string {
  const { effectiveExp, unitLabel } = resolveScaledUnitLabel(units, scalExp);
  if (!Number.isFinite(baseValue)) {
    return unitLabel.length > 0 ? `0.00 ${unitLabel}` : '0.00';
  }
  const scaled = baseValue * Math.pow(10, effectiveExp);
  const numStr = formatGroupedDecimal2(scaled);
  return unitLabel.length > 0 ? `${numStr} ${unitLabel}` : numStr;
}

/**
 * Formats a `Cp` or `Cpk` capability index to `2 decimals` (`1.33`), or `'N/A'` when null.
 *
 * Validates: Requirements 8.1, 8.4, 17.4.
 */
export function formatCapabilityIndex(value: number | null): string {
  if (value === null || !Number.isFinite(value)) {
    return 'N/A';
  }
  const normalized = Math.abs(value) < 1e-12 ? 0 : value;
  return normalized.toFixed(2);
}
