/**
 * Clinical number and byte formatting helpers (`src/ui/format.ts`).
 *
 * Enforces `.kiro/steering/design-language.md` and Requirement 17.4:
 * - Yields to 1 decimal place (`82.4%`)
 * - Confidence / capability scores to 2 decimal places (`0.91`, `1.33`)
 * - Grouped integer counts (`15,825`)
 * - Tabular-friendly byte sizes (`6.8 MB`, `64.0 KB`, `512 B`)
 */

const GROUPED_INT_FORMATTER = new Intl.NumberFormat('en-US', {
  maximumFractionDigits: 0,
});

export function formatGroupedInt(value: number): string {
  if (!Number.isFinite(value)) {
    return '0';
  }
  return GROUPED_INT_FORMATTER.format(Math.trunc(value));
}

export function formatYieldPct(ratio: number | null): string {
  if (ratio === null || !Number.isFinite(ratio)) {
    return 'N/A';
  }
  return `${(ratio * 100).toFixed(1)}%`;
}

export function formatScore2(value: number | null): string {
  if (value === null || !Number.isFinite(value)) {
    return 'N/A';
  }
  return value.toFixed(2);
}

export function formatByteSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return '0 B';
  }
  if (bytes < 1024) {
    return `${Math.trunc(bytes)} B`;
  }
  const kb = bytes / 1024;
  if (kb < 1024) {
    return `${kb.toFixed(1)} KB`;
  }
  const mb = kb / 1024;
  if (mb < 1024) {
    return `${mb.toFixed(1)} MB`;
  }
  const gb = mb / 1024;
  return `${gb.toFixed(2)} GB`;
}
