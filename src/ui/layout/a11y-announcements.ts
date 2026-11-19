import type { YieldMetrics } from '@/core/analytics';
import {
  formatInteger,
  type Locale,
  t,
  tPlural,
} from '@/core/i18n';
import type { LotModel } from '@/core/model';
import { formatDieCoordinate } from '@/ui/wafer-map/linked-interactions';

export interface AutopsyLiveAnnouncementInput {
  readonly fullHeadline: string;
  readonly activeClaimText: string | null;
  readonly narrationStatusText: string | null;
}

/**
 * Composes the polite live-region announcement for the Autopsy Report
 * (`AutopsyReportCard.tsx`, Requirement 14.4).
 *
 * Includes the active claim highlight when selected and appends narration status
 * transitions (`loading`, `verified`, `fallback`) when present so screen readers
 * announce both verdict/claim selection and narrator updates.
 */
export function buildAutopsyLiveAnnouncement(
  input: AutopsyLiveAnnouncementInput,
): string {
  const base = input.activeClaimText ?? input.fullHeadline;
  if (input.narrationStatusText && input.narrationStatusText.trim().length > 0) {
    return `${base} ${input.narrationStatusText}`;
  }
  return base;
}

export interface WorkspaceSelectionSnapshot {
  readonly hasActiveFilter: boolean;
  readonly selectedDieCount: number;
  readonly activeWaferIndex: number;
  readonly pinnedDieIndex: number | null;
}

export interface WorkspaceSelectionAnnouncementInput {
  readonly lot: LotModel;
  readonly byWaferYield: readonly YieldMetrics[];
  readonly locale: Locale;
  readonly prev: WorkspaceSelectionSnapshot | null;
  readonly next: WorkspaceSelectionSnapshot;
}

/**
 * Formats a pinned die announcement for `aria-live="polite"` without requiring a React re-render.
 */
export function formatPinnedDieAnnouncement(
  lot: LotModel,
  locale: Locale,
  dieIndex: number,
): string | null {
  if (dieIndex < 0 || dieIndex >= lot.dies.count) {
    return null;
  }
  const isPass = lot.dies.finalPass[dieIndex] !== 0;
  const status = t(locale, isPass ? 'legend.passed' : 'legend.failed');
  const sbin = lot.dies.sbin[dieIndex] ?? 0;
  const sbinDef = lot.sbins.get(sbin);
  const bin = sbinDef?.name ? `SBIN ${sbin} ${sbinDef.name}` : `SBIN ${sbin}`;
  return t(locale, 'a11y.diePinned', {
    x: formatDieCoordinate(lot.dies.x[dieIndex] ?? 0),
    y: formatDieCoordinate(lot.dies.y[dieIndex] ?? 0),
    status,
    bin,
  });
}

/**
 * Resolves the polite live-region text for workspace filter, wafer, and die-pin
 * transitions (`LoadedLotOverview.tsx`, Requirement 14.4). Returns `null` when
 * no user-triggered change occurred (such as initial mount).
 */
export function buildWorkspaceSelectionAnnouncement(
  input: WorkspaceSelectionAnnouncementInput,
): string | null {
  const { lot, byWaferYield, locale, prev, next } = input;
  if (prev === null) {
    return null;
  }

  // 1. Filter applied, updated, or cleared
  if (
    prev.hasActiveFilter !== next.hasActiveFilter ||
    (next.hasActiveFilter && prev.selectedDieCount !== next.selectedDieCount)
  ) {
    if (next.hasActiveFilter) {
      return t(locale, 'filter.announcement', {
        dies: tPlural(locale, 'findings.dieCount', next.selectedDieCount),
      });
    }
    return t(locale, 'a11y.filtersCleared', {
      dies: tPlural(locale, 'findings.dieCount', lot.dies.count),
    });
  }

  // 2. Pinned die selection (keyboard Enter or tap)
  if (
    prev.pinnedDieIndex !== next.pinnedDieIndex &&
    next.pinnedDieIndex !== null
  ) {
    return formatPinnedDieAnnouncement(lot, locale, next.pinnedDieIndex);
  }

  // 3. Active wafer changed
  if (prev.activeWaferIndex !== next.activeWaferIndex) {
    const wafer = lot.wafers[next.activeWaferIndex];
    if (wafer) {
      const metrics = byWaferYield[next.activeWaferIndex];
      const tested = metrics?.testedDies ?? wafer.dieEndIndex - wafer.dieStartIndex;
      const fails = metrics?.finalFailDies ?? 0;
      return t(locale, 'a11y.waferSelected', {
        wafer: wafer.waferId,
        dies: formatInteger(locale, tested),
        fails: formatInteger(locale, fails),
      });
    }
  }

  return null;
}
