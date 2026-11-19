import { describe, expect, it } from 'vitest';
import { computeYieldSummary, type YieldMetrics } from '@/core/analytics';
import { generateDemoStdfBytes } from '@/core/demo';
import type { DemoPresetId } from '@/core/demo';
import { buildLotModel } from '@/core/model/lot-builder';
import type { LotModel } from '@/core/model';
import { buildEngineFacts } from '@/core/report';
import { parseStdfBytes } from '@/core/stdf/stdf-parser';
import { deriveSelectionMasks } from '@/ui/state';
import {
  isWaferTableCollapsible,
  resolveAnomalousSiteIndices,
  resolveYieldSummaryForSelection,
  resolveYieldTakeaway,
  selectWaferRowIndices,
  YIELD_COLLAPSED_WAFER_COUNT,
} from './yield-summary-view';

function loadLot(preset: DemoPresetId): LotModel {
  const parsed = parseStdfBytes(generateDemoStdfBytes(preset), { mode: 'full' });
  if (!parsed.ok) {
    throw new Error(parsed.error.message);
  }
  return buildLotModel(parsed.value);
}

function metrics(finalYield: number | null): YieldMetrics {
  return {
    testedDies: 100,
    firstPassTestedDies: 100,
    firstPassDies: 90,
    firstPassFailDies: 10,
    finalPassDies: finalYield === null ? 0 : Math.round(finalYield * 100),
    finalFailDies: 0,
    retestExecutions: 0,
    firstPassYield: 0.9,
    finalYield,
  };
}

describe('selectWaferRowIndices', () => {
  const yields = [0.9, 0.5, 0.95, 0.7, 0.99, 0.6, 0.8, 0.97, 0.85, 0.4];
  const byWafer = yields.map(metrics);

  it('keeps the lowest final-yield wafers in wafer order while collapsed', () => {
    const rows = selectWaferRowIndices(byWafer, false, () => false);
    expect(rows).toEqual([1, 3, 5, 6, 9]);
    expect(rows).toHaveLength(YIELD_COLLAPSED_WAFER_COUNT);
  });

  it('always includes the pinned wafer', () => {
    expect(selectWaferRowIndices(byWafer, false, (i) => i === 4)).toEqual([
      1, 3, 4, 5, 6, 9,
    ]);
  });

  it('shows every wafer when expanded', () => {
    expect(selectWaferRowIndices(byWafer, true, () => false)).toEqual(
      yields.map((_, i) => i),
    );
  });

  it('ranks a null yield lowest and breaks ties by wafer index', () => {
    const tied = [0.9, 0.9, null, 0.9, 0.9, 0.9, 0.9, 0.9].map(metrics);
    expect(selectWaferRowIndices(tied, false, () => false)).toEqual([
      0, 1, 2, 3, 4,
    ]);
  });

  it('skips the disclosure for short lots', () => {
    const short = [0.9, 0.5, 0.95].map(metrics);
    expect(isWaferTableCollapsible(short.length)).toBe(false);
    expect(selectWaferRowIndices(short, false, () => false)).toEqual([0, 1, 2]);
  });
});

describe('resolveAnomalousSiteIndices', () => {
  it('flags the contact-failure site of site2-probe-contact only', () => {
    const lot = loadLot('site2-probe-contact');
    const facts = buildEngineFacts(lot);
    const flagged = resolveAnomalousSiteIndices(lot, facts);
    expect(flagged.size).toBe(1);
    const [index] = [...flagged];
    expect(lot.sites[index!]!.siteNum).toBe(2);
    // The flagged site has the lowest first-pass yield of all sites
    const bySite = computeYieldSummary(lot).bySite;
    const lowest = Math.min(...bySite.map((m) => m.firstPassYield ?? 1));
    expect(bySite[index!]!.firstPassYield).toBe(lowest);
  });

  it('flags nothing for lots without a site anomaly or without facts', () => {
    const lot = loadLot('edge-ring-etch');
    expect(resolveAnomalousSiteIndices(lot, buildEngineFacts(lot)).size).toBe(0);
    expect(resolveAnomalousSiteIndices(lot, undefined).size).toBe(0);
  });
});

describe('resolveYieldTakeaway', () => {
  it('states the flagged site yield and drop from the site-anomaly fact', () => {
    const lot = loadLot('site2-probe-contact');
    const facts = buildEngineFacts(lot);
    const takeaway = resolveYieldTakeaway(lot, computeYieldSummary(lot).overall, facts);
    expect(takeaway?.kind).toBe('site');
    if (takeaway?.kind !== 'site') return;
    expect(takeaway.siteLabel).toBe('1:2');
    const fact = facts.find((f) => f.kind === 'site-anomaly')!;
    const metric = (key: string) => fact.metrics.find((m) => m.key === key)!.numericValue;
    expect(takeaway.yieldRatio * 100).toBeCloseTo(metric('firstPassYieldPct'), 9);
    expect(takeaway.points).toBe(metric('yieldDropPp'));
    expect(takeaway.points).toBeGreaterThan(0);
  });

  it('states the points retests recovered when no site is flagged', () => {
    const lot = loadLot('edge-ring-etch');
    const { overall } = computeYieldSummary(lot);
    const takeaway = resolveYieldTakeaway(lot, overall, buildEngineFacts(lot));
    if (overall.retestExecutions === 0) {
      expect(takeaway).toBeNull();
      return;
    }
    expect(takeaway).toEqual({
      kind: 'retests',
      points: Math.max(0, (overall.finalYield! - overall.firstPassYield!) * 100),
    });
  });

  it('has no takeaway for a lot without retests or a flagged site', () => {
    const lot = loadLot('edge-ring-etch');
    expect(resolveYieldTakeaway(lot, metrics(0.9), undefined)).toBeNull();
  });
});

describe('resolveYieldSummaryForSelection (Task 14, Req 11.2 & 11.4)', () => {
  it('recomputes overall, bySite, and byWafer over a spatial brush and keeps site/wafer tables comparable when scoped', () => {
    const lot = loadLot('edge-ring-etch');
    const base = computeYieldSummary(lot);
    const w0 = lot.wafers[0]!;

    // Unfiltered returns baseSummary by reference
    const unfilteredMasks = deriveSelectionMasks(lot, {
      brush: null,
      binFilter: null,
      siteFilter: null,
      waferFilter: null,
      dslFilter: null,
      claimHighlight: null,
    });
    expect(
      resolveYieldSummaryForSelection(lot, base, {
        brush: null,
        binFilter: null,
        siteFilter: null,
        waferFilter: null,
        dslFilter: null,
        hasActiveFilter: unfilteredMasks.hasActiveFilter,
        selectedDieMask: unfilteredMasks.selectedDieMask,
      }),
    ).toBe(base);

    // Single-wafer spatial brush updates overall and wafer yields to the brushed subset
    const brush = {
      scope: 'wafer' as const,
      waferIndex: 0,
      minX: w0.minX,
      maxX: Math.round((w0.minX + w0.maxX) / 2),
      minY: w0.minY,
      maxY: w0.maxY,
    };
    const brushedMasks = deriveSelectionMasks(lot, {
      brush,
      binFilter: null,
      siteFilter: null,
      waferFilter: null,
      dslFilter: null,
      claimHighlight: null,
    });
    const brushed = resolveYieldSummaryForSelection(lot, base, {
      brush,
      binFilter: null,
      siteFilter: null,
      waferFilter: null,
      dslFilter: null,
      hasActiveFilter: brushedMasks.hasActiveFilter,
      selectedDieMask: brushedMasks.selectedDieMask,
    });
    expect(brushed.overall.testedDies).toBe(brushedMasks.selectedDieCount);
    expect(brushed.overall.testedDies).toBeLessThan(base.overall.testedDies);
    expect(brushed.byWafer[0]!.testedDies).toBe(brushedMasks.selectedDieCount);
    expect(brushed.byWafer[1]!.testedDies).toBe(0);

    // Combined brush + siteFilter: overall reflects intersection, while bySite keeps other sites visible
    const combinedMasks = deriveSelectionMasks(lot, {
      brush,
      binFilter: null,
      siteFilter: 0,
      waferFilter: null,
      dslFilter: null,
      claimHighlight: null,
    });
    const combined = resolveYieldSummaryForSelection(lot, base, {
      brush,
      binFilter: null,
      siteFilter: 0,
      waferFilter: null,
      dslFilter: null,
      hasActiveFilter: combinedMasks.hasActiveFilter,
      selectedDieMask: combinedMasks.selectedDieMask,
    });
    expect(combined.overall.testedDies).toBe(combinedMasks.selectedDieCount);
    expect(combined.overall.testedDies).toBeLessThan(brushed.overall.testedDies);
    // Other sites still show their counts within the brushed region
    expect(
      combined.bySite.reduce((sum, s) => sum + s.testedDies, 0),
    ).toBe(brushed.overall.testedDies);
  });
});
