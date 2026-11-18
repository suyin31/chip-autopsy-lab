'use client';

/**
 * `useT()` hook returning bound `t`, plural helpers, and cached `Intl` formatters
 * for the active `Locale` (`src/ui/i18n/use-t.ts`, redesign §6.2–6.5).
 */

import * as React from 'react';
import {
  type BoundLocaleFormatters,
  createBoundFormatters,
  type Locale,
  type MessageKey,
  type PluralArgs,
  type PluralBaseKey,
  pluralKey as corePluralKey,
  t as coreT,
  type TArgs,
  tPlural as coreTPlural,
} from '@/core/i18n';
import { I18nContext } from './I18nProvider';

export type BoundTranslateFn = <K extends MessageKey>(
  key: K,
  ...args: TArgs<K>
) => string;

export type BoundPluralTranslateFn = <B extends PluralBaseKey>(
  baseKey: B,
  count: number,
  ...args: PluralArgs<B>
) => string;

export type BoundPluralKeyFn = <B extends PluralBaseKey>(
  baseKey: B,
  count: number,
) => `${B}.one` | `${B}.other`;

export interface UseTReturn {
  readonly locale: Locale;
  readonly setLocale: (nextLocale: Locale) => void;
  readonly t: BoundTranslateFn;
  readonly tPlural: BoundPluralTranslateFn;
  readonly pluralKey: BoundPluralKeyFn;
  readonly formatters: BoundLocaleFormatters;
  readonly formatInteger: (value: number) => string;
  readonly formatPercent: (ratio: number) => string;
  readonly formatDecimal2: (value: number) => string;
  readonly formatDuration: (seconds: number) => string;
  readonly formatMegabytes: (megabytes: number) => string;
  readonly formatFileSize: (bytes: number) => string;
  readonly formatParametricValue: (
    baseValue: number,
    units: string,
    scalExp?: number,
  ) => string;
}

export function useT(): UseTReturn {
  const { locale, setLocale } = React.useContext(I18nContext);

  return React.useMemo<UseTReturn>(() => {
    const formatters = createBoundFormatters(locale);
    const boundT: BoundTranslateFn = (key, ...args) =>
      coreT(locale, key, ...args);
    const boundTPlural: BoundPluralTranslateFn = (baseKey, count, ...args) =>
      coreTPlural(locale, baseKey, count, ...args);
    const boundPluralKey: BoundPluralKeyFn = (baseKey, count) =>
      corePluralKey(locale, baseKey, count);

    return {
      locale,
      setLocale,
      t: boundT,
      tPlural: boundTPlural,
      pluralKey: boundPluralKey,
      formatters,
      formatInteger: formatters.integer,
      formatPercent: formatters.percent,
      formatDecimal2: formatters.decimal2,
      formatDuration: formatters.duration,
      formatMegabytes: formatters.megabytes,
      formatFileSize: formatters.fileSize,
      formatParametricValue: formatters.parametric,
    };
  }, [locale, setLocale]);
}
