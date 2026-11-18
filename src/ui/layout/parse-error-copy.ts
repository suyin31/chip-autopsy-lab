import { formatInteger, type Locale, t } from '@/core/i18n';
import type { ParseFatalError, ParseWarning } from '@/core/stdf';

export type ParseErrorUiCode =
  | 'not-stdf'
  | 'unsupported-version'
  | 'vax-cpu'
  | 'truncated'
  | 'gzip-failed'
  | 'empty'
  | 'no-parts';

export interface ParseErrorViewModel {
  readonly uiCode: ParseErrorUiCode;
  readonly title: string;
  readonly body: string;
  readonly byteOffset: number;
  readonly first16BytesHex: string;
}

export interface TruncatedWarningToastModel {
  readonly id: string;
  readonly title: string;
  readonly body: string;
  readonly byteOffset: number;
  readonly first16BytesHex: string;
}

const BYTES_PER_MB = 1024 * 1024;
const TARGET_PARSE_MB_PER_SEC = 15;

/**
 * Estimates full-mode parse duration in seconds from observed uncompressed bytes
 * (`tech.md` 15 MB/s baseline -> 312 MB ≈ 21 s, `redesign.md` §3.8).
 */
export function estimateFullParseSeconds(bytesObserved: number): number {
  if (!Number.isFinite(bytesObserved) || bytesObserved <= 0) {
    return 1;
  }
  return Math.max(
    1,
    Math.round(bytesObserved / BYTES_PER_MB / TARGET_PARSE_MB_PER_SEC),
  );
}

function extractShortHexPrefix(first16BytesHex: string | undefined): string {
  if (!first16BytesHex || first16BytesHex.trim().length === 0) {
    return '00 00 00 00';
  }
  const tokens = first16BytesHex.trim().split(/\s+/).slice(0, 4);
  return tokens.join(' ');
}

/**
 * Maps `ParseFatalError` to the 7-code `redesign.md` §3.7 localized copy table.
 */
export function resolveParseErrorViewModel(
  error: ParseFatalError,
  locale: Locale,
): ParseErrorViewModel {
  const byteOffset = error.byteOffset ?? 0;
  const first16BytesHex = error.firstBytesHex ?? '';

  if (error.code === 'EMPTY_INPUT') {
    return {
      uiCode: 'empty',
      title: t(locale, 'error.empty.title'),
      body: t(locale, 'error.empty.body'),
      byteOffset,
      first16BytesHex,
    };
  }

  if (error.code === 'GZIP_DECOMPRESS_FAILED') {
    return {
      uiCode: 'gzip-failed',
      title: t(locale, 'error.gzip.title'),
      body: t(locale, 'error.gzip.body', {
        offset: formatInteger(locale, byteOffset),
      }),
      byteOffset,
      first16BytesHex: first16BytesHex || '1F 8B',
    };
  }

  if (error.code === 'UNSUPPORTED_STDF_VERSION') {
    const version =
      error.stdfVersion !== undefined ? String(error.stdfVersion) : '?';
    return {
      uiCode: 'unsupported-version',
      title: t(locale, 'error.version.title'),
      body: t(locale, 'error.version.body', { version }),
      byteOffset,
      first16BytesHex,
    };
  }

  if (error.code === 'UNSUPPORTED_CPU_TYPE_VAX') {
    return {
      uiCode: 'vax-cpu',
      title: t(locale, 'error.vax.title'),
      body: t(locale, 'error.vax.body'),
      byteOffset,
      first16BytesHex,
    };
  }

  if (error.code === 'ZERO_VALID_PRR') {
    if (error.truncatedRecord !== undefined) {
      const tr = error.truncatedRecord;
      return {
        uiCode: 'truncated',
        title: t(locale, 'error.truncated.title'),
        body: t(locale, 'error.truncated.body', {
          recType: tr.recName,
          offset: formatInteger(locale, tr.byteOffset),
          need: formatInteger(locale, tr.needBytes),
          have: formatInteger(locale, tr.haveBytes),
        }),
        byteOffset: tr.byteOffset,
        first16BytesHex,
      };
    }

    return {
      uiCode: 'no-parts',
      title: t(locale, 'error.noParts.title'),
      body: t(locale, 'error.noParts.body'),
      byteOffset,
      first16BytesHex,
    };
  }

  // MISSING_FAR_HEADER -> not-stdf
  return {
    uiCode: 'not-stdf',
    title: t(locale, 'error.notStdf.title'),
    body: t(locale, 'error.notStdf.body', {
      hex: extractShortHexPrefix(first16BytesHex),
    }),
    byteOffset,
    first16BytesHex,
  };
}

/**
 * Builds the persistent toast model for a `TRUNCATED_TAIL_RECORD` warning when
 * at least one wafer was recovered (`redesign.md` §3.7).
 */
export function resolveTruncatedWarningToastModel(
  warnings: readonly ParseWarning[],
  locale: Locale,
): TruncatedWarningToastModel | null {
  const truncWarning = warnings.find((w) => w.code === 'TRUNCATED_TAIL_RECORD');
  if (!truncWarning) {
    return null;
  }

  const tr = truncWarning.truncatedRecord;
  const recType = tr
    ? tr.recName
    : `(${truncWarning.recTyp}, ${truncWarning.recSub})`;
  const offset = tr ? tr.byteOffset : truncWarning.byteOffset;
  const need = tr ? tr.needBytes : 4;
  const have = tr ? tr.haveBytes : 0;

  return {
    id: `truncated-tail-${offset}`,
    title: t(locale, 'error.truncated.title'),
    body: t(locale, 'error.truncated.body', {
      recType,
      offset: formatInteger(locale, offset),
      need: formatInteger(locale, need),
      have: formatInteger(locale, have),
    }),
    byteOffset: offset,
    first16BytesHex: truncWarning.firstBytesHex ?? '',
  };
}
