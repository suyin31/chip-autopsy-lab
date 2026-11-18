/**
 * Cached per-locale `Intl` formatters (`src/core/i18n/format.ts`).
 *
 * Implements redesign §6.5:
 * - Integers: `Intl.NumberFormat(locale, { maximumFractionDigits: 0 })` -> `15,825`
 * - Yield and percents: `{ style: "percent", minimumFractionDigits: 1, maximumFractionDigits: 1 }` -> `82.8%`
 * - Cp/Cpk and confidence: 2 decimals -> `0.95`
 * - Durations: `{ style: "unit", unit: "second", unitDisplay: "narrow", maximumFractionDigits: 1 }` -> `0.8s`/`0.8秒`
 * - File sizes: `{ style: "unit", unit: "megabyte", maximumFractionDigits: 1 }` -> `4.2 MB`
 * - Parametric values: localized number + untranslated SI prefix + unit (`10.22 uA`, `1,250.00 mV`)
 */

import type { Locale } from './locales';

export const SI_PREFIX_BY_EXPONENT: Readonly<Record<number, string>> = {
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
const BYTES_PER_MEGABYTE = 1024 * 1024;

export interface LocaleFormatterSet {
  readonly locale: Locale;
  readonly integer: Intl.NumberFormat;
  readonly percent: Intl.NumberFormat;
  readonly decimal2: Intl.NumberFormat;
  readonly durationSeconds: Intl.NumberFormat;
  readonly megabytes: Intl.NumberFormat;
  readonly pluralRules: Intl.PluralRules;
}

export interface BoundLocaleFormatters {
  readonly locale: Locale;
  readonly integer: (value: number) => string;
  readonly percent: (ratio: number) => string;
  readonly decimal2: (value: number) => string;
  readonly duration: (seconds: number) => string;
  readonly megabytes: (megabytes: number) => string;
  readonly fileSize: (bytes: number) => string;
  readonly parametric: (
    baseValue: number,
    units: string,
    scalExp?: number,
  ) => string;
}

const formatterCache = new Map<Locale, LocaleFormatterSet>();
const boundFormatterCache = new Map<Locale, BoundLocaleFormatters>();

export function getLocaleFormatters(locale: Locale): LocaleFormatterSet {
  const cached = formatterCache.get(locale);
  if (cached) {
    return cached;
  }

  const created: LocaleFormatterSet = {
    locale,
    integer: new Intl.NumberFormat(locale, {
      maximumFractionDigits: 0,
    }),
    percent: new Intl.NumberFormat(locale, {
      style: 'percent',
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    }),
    decimal2: new Intl.NumberFormat(locale, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }),
    durationSeconds: new Intl.NumberFormat(locale, {
      style: 'unit',
      unit: 'second',
      unitDisplay: 'narrow',
      maximumFractionDigits: 1,
    }),
    megabytes: new Intl.NumberFormat(locale, {
      style: 'unit',
      unit: 'megabyte',
      maximumFractionDigits: 1,
    }),
    pluralRules: new Intl.PluralRules(locale),
  };

  formatterCache.set(locale, created);
  return created;
}

function sanitizeUnitString(rawUnits: string): string {
  let out = '';
  for (let i = 0; i < rawUnits.length; i += 1) {
    const code = rawUnits.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) {
      continue;
    }
    const ch = rawUnits[i]!;
    if (ch === '<' || ch === '>') {
      continue;
    }
    out += ch;
  }
  return out.trim();
}

export function formatInteger(locale: Locale, value: number): string {
  const { integer } = getLocaleFormatters(locale);
  if (!Number.isFinite(value)) {
    return integer.format(0);
  }
  const truncated = Math.trunc(value);
  return integer.format(truncated === 0 ? 0 : truncated);
}

export function formatPercent(locale: Locale, ratio: number): string {
  const { percent } = getLocaleFormatters(locale);
  if (!Number.isFinite(ratio)) {
    return percent.format(0);
  }
  const normalized = Math.abs(ratio) < 1e-12 ? 0 : ratio;
  return percent.format(normalized);
}

export function formatDecimal2(locale: Locale, value: number): string {
  const { decimal2 } = getLocaleFormatters(locale);
  if (!Number.isFinite(value)) {
    return decimal2.format(0);
  }
  if (Math.abs(value) >= EXPONENTIAL_MAGNITUDE_THRESHOLD) {
    return value.toExponential(2);
  }
  const normalized = Math.abs(value) < 1e-12 ? 0 : value;
  return decimal2.format(normalized);
}

export function formatDuration(locale: Locale, seconds: number): string {
  const { durationSeconds } = getLocaleFormatters(locale);
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return durationSeconds.format(0);
  }
  return durationSeconds.format(seconds);
}

export function formatMegabytes(locale: Locale, megabytes: number): string {
  const { megabytes: mbFormatter } = getLocaleFormatters(locale);
  if (!Number.isFinite(megabytes) || megabytes <= 0) {
    return mbFormatter.format(0);
  }
  return mbFormatter.format(megabytes);
}

export function formatFileSize(locale: Locale, bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return formatMegabytes(locale, 0);
  }
  return formatMegabytes(locale, bytes / BYTES_PER_MEGABYTE);
}

export function formatLocalizedParametricValue(
  locale: Locale,
  baseValue: number,
  units: string,
  scalExp = 0,
): string {
  const cleanUnits = sanitizeUnitString(units);
  if (!Number.isFinite(baseValue)) {
    const zeroStr = formatDecimal2(locale, 0);
    return cleanUnits.length > 0 ? `${zeroStr} ${cleanUnits}` : zeroStr;
  }

  const effectiveExp =
    cleanUnits.length === 0 || !Number.isFinite(scalExp)
      ? 0
      : Math.max(-12, Math.min(15, Math.round(scalExp / 3) * 3));

  const prefix = SI_PREFIX_BY_EXPONENT[effectiveExp] ?? '';
  const unitLabel = `${prefix}${cleanUnits}`;
  const scaled = baseValue * Math.pow(10, effectiveExp);
  const formattedNumber = formatDecimal2(locale, scaled);

  return unitLabel.length > 0
    ? `${formattedNumber} ${unitLabel}`
    : formattedNumber;
}

export function createBoundFormatters(locale: Locale): BoundLocaleFormatters {
  const cached = boundFormatterCache.get(locale);
  if (cached) {
    return cached;
  }

  const bound: BoundLocaleFormatters = {
    locale,
    integer: (value) => formatInteger(locale, value),
    percent: (ratio) => formatPercent(locale, ratio),
    decimal2: (value) => formatDecimal2(locale, value),
    duration: (seconds) => formatDuration(locale, seconds),
    megabytes: (megabytes) => formatMegabytes(locale, megabytes),
    fileSize: (bytes) => formatFileSize(locale, bytes),
    parametric: (baseValue, units, scalExp = 0) =>
      formatLocalizedParametricValue(locale, baseValue, units, scalExp),
  };

  boundFormatterCache.set(locale, bound);
  return bound;
}
