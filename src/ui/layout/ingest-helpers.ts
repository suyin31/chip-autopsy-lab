import { toast } from 'sonner';
import { sanitizeReportProseText } from '@/core/report';
import type { ParseWarning, ParseWarningCode } from '@/core/stdf';
import { formatByteSize, formatGroupedInt } from '@/ui/format';

export interface FormattedWarningToast {
  readonly id: string;
  readonly title: string;
  readonly description: string;
}

export type WarningToastEmitter = (
  title: string,
  options: { readonly id: string; readonly description: string; readonly duration?: number },
) => void;

const WARNING_CODE_LABELS: Readonly<Record<ParseWarningCode, string>> = {
  TRUNCATED_TAIL_RECORD: 'truncated tail record',
  MALFORMED_RECORD_FIELD: 'malformed record field',
  ORPHAN_TEST_RECORD: 'orphan test record (missing PIR)',
  UNCLOSED_PIR_AT_WRR: 'unclosed PIR at wafer end',
  MISSING_WIR_RECORD: 'missing WIR record',
  MISSING_PIR_RECORD: 'missing PIR record',
  MISSING_HBIN_PF_FLAG: 'missing HBR pass/fail flag',
  NON_FINITE_MEASUREMENT: 'non-finite measurement',
};

/**
 * Formats non-blocking STDF V4 stream recovery warnings into concise, clinical
 * plain-text toast copy citing the byte offset and `(REC_TYP, REC_SUB)`
 * (Requirements 2.3, 2.4, 17.4).
 */
export function formatParseWarningToast(
  warnings: readonly ParseWarning[],
): FormattedWarningToast | null {
  if (warnings.length === 0) {
    return null;
  }

  const first = warnings[0]!;
  const label = WARNING_CODE_LABELS[first.code];
  const cleanDetail = sanitizeReportProseText(first.detail);
  const title =
    warnings.length === 1
      ? `Partial STDF stream: ${label}`
      : `Partial STDF stream: ${formatGroupedInt(warnings.length)} warnings`;

  const locationClause = `Byte ${formatGroupedInt(first.byteOffset)} (REC_TYP ${first.recTyp}, REC_SUB ${first.recSub})`;
  const suffix =
    warnings.length > 1
      ? ` (+${formatGroupedInt(warnings.length - 1)} more)`
      : '';
  const description = cleanDetail
    ? `${locationClause} · ${cleanDetail}${suffix}`
    : `${locationClause}${suffix}`;

  return {
    id: `stdf-warning-${first.code}-${first.byteOffset}-${warnings.length}`,
    title,
    description,
  };
}

/**
 * Emits a non-blocking Sonner notice toast (`info` icon, default 4 s, premium §7.13) when a
 * parsed lot contains partial-result stream warnings (missing WIR/PIR, malformed fields, etc.).
 */
export function notifyParseWarnings(
  warnings: readonly ParseWarning[],
  emit: WarningToastEmitter = (title, options) => {
    toast.info(title, options);
  },
): FormattedWarningToast | null {
  const formatted = formatParseWarningToast(warnings);
  if (formatted === null) {
    return null;
  }
  emit(formatted.title, {
    id: formatted.id,
    description: formatted.description,
  });
  return formatted;
}

/**
 * Emits a subtle clinical confirmation toast when exporting a demo `.stdf` file.
 */
export function notifyDemoStdfDownload(
  fileName: string,
  byteLength: number,
  emit: WarningToastEmitter = (title, options) => {
    toast.message(title, options);
  },
): void {
  emit(`Exported ${fileName}`, {
    id: `demo-download-${fileName}`,
    description: `${formatByteSize(byteLength)} (${formatGroupedInt(byteLength)} bytes) · Ready to drop back into the viewport`,
    duration: 4_000,
  });
}

export interface BrowserDownloadDriver {
  createObjectURL(blob: Blob): string;
  revokeObjectURL(url: string): void;
  triggerAnchorDownload(href: string, downloadName: string): void;
}

const defaultDownloadDriver: BrowserDownloadDriver = {
  createObjectURL: (blob) => URL.createObjectURL(blob),
  revokeObjectURL: (url) => URL.revokeObjectURL(url),
  triggerAnchorDownload: (href, downloadName) => {
    const anchor = document.createElement('a');
    anchor.href = href;
    anchor.download = downloadName;
    anchor.rel = 'noopener';
    anchor.style.display = 'none';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  },
};

/**
 * Triggers a local browser `.stdf` binary download without any network request.
 */
export function triggerBrowserBlobDownload(
  bytes: Uint8Array,
  fileName: string,
  driver: BrowserDownloadDriver = defaultDownloadDriver,
): void {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const blob = new Blob([copy], { type: 'application/octet-stream' });
  const url = driver.createObjectURL(blob);
  try {
    driver.triggerAnchorDownload(url, fileName);
  } finally {
    setTimeout(() => {
      driver.revokeObjectURL(url);
    }, 1_000);
  }
}
