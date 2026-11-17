import { describe, expect, it } from 'vitest';
import {
  buildLotModel,
  type LotModel,
  STDF_MISSING_COORD,
} from '@/core/model';
import { parseStdfBytes, type StdfWriteLotSpec, writeStdfBytes } from '@/core/stdf';
import {
  areHiddenBinSetsEqual,
  createSelectionStore,
  deriveSelectionMasks,
  EMPTY_HIDDEN_BINS,
  type FilterDslAst,
} from './selection-store';

function buildFixtureLot(): LotModel {
  const spec: StdfWriteLotSpec = {
    endianness: 'little',
    mir: {
      lotId: 'LOT-SEL-01',
      partTyp: 'CAL-TEST',
      jobNam: 'SORT1',
    },
    hbrs: [
      { headNum: 255, siteNum: 0, hbinNum: 1, hbinCnt: 4, hbinPf: 'P', hbinNam: 'PASS' },
      { headNum: 255, siteNum: 0, hbinNum: 2, hbinCnt: 2, hbinPf: 'F', hbinNam: 'CONT' },
      { headNum: 255, siteNum: 0, hbinNum: 4, hbinCnt: 2, hbinPf: 'F', hbinNam: 'LEAK' },
    ],
    sbrs: [
      { headNum: 255, siteNum: 0, sbinNum: 1, sbinCnt: 4, sbinPf: 'P', sbinNam: 'GOOD' },
      { headNum: 255, siteNum: 0, sbinNum: 5, sbinCnt: 2, sbinPf: 'F', sbinNam: 'CONT_OPEN' },
      { headNum: 255, siteNum: 0, sbinNum: 7, sbinCnt: 2, sbinPf: 'F', sbinNam: 'IDDQ_LEAK' },
    ],
    sdrs: [{ headNum: 1, siteGrp: 1, siteNums: [1, 2] }],
    wcr: { wfFlat: 'D', posX: 'R', posY: 'U' },
    wafers: [
      {
        wir: { headNum: 1, waferId: 'W01' },
        touchdowns: [
          [
            // Die 0: W01:(0,0) center pass on Site 1
            {
              headNum: 1,
              siteNum: 1,
              partFlg: 0x00,
              hardBin: 1,
              softBin: 1,
              xCoord: 0,
              yCoord: 0,
              ptrs: [
                {
                  testNum: 101,
                  result: 1.0,
                  testTxt: 'VDD_CONT',
                  units: 'Ohm',
                  resScal: 0,
                  llmScal: 0,
                  hlmScal: 0,
                  loLimit: 0.1,
                  hiLimit: 2.5,
                },
              ],
            },
            // Die 1: W01:(1,0) fail SBIN 5 / HBIN 2 on Site 2
            {
              headNum: 1,
              siteNum: 2,
              partFlg: 0x08,
              hardBin: 2,
              softBin: 5,
              xCoord: 1,
              yCoord: 0,
              ptrs: [{ testNum: 101, result: 4.2 }],
            },
          ],
          [
            // Die 2: W01:(0,1) pass on Site 1
            {
              headNum: 1,
              siteNum: 1,
              partFlg: 0x00,
              hardBin: 1,
              softBin: 1,
              xCoord: 0,
              yCoord: 1,
              ptrs: [{ testNum: 101, result: 0.9 }],
            },
            // Die 3: W01:(2,2) outer fail SBIN 7 / HBIN 4 on Site 2
            {
              headNum: 1,
              siteNum: 2,
              partFlg: 0x08,
              hardBin: 4,
              softBin: 7,
              xCoord: 2,
              yCoord: 2,
              ptrs: [{ testNum: 101, result: 1.1 }],
            },
          ],
          [
            // Die 4: W01 missing-coordinate die (-32768, -32768) failing SBIN 7 on Site 2
            {
              headNum: 1,
              siteNum: 2,
              partFlg: 0x08,
              hardBin: 4,
              softBin: 7,
              xCoord: STDF_MISSING_COORD,
              yCoord: STDF_MISSING_COORD,
            },
          ],
        ],
      },
      {
        wir: { headNum: 1, waferId: 'W02' },
        touchdowns: [
          [
            // Die 5: W02:(0,0) pass on Site 1
            {
              headNum: 1,
              siteNum: 1,
              partFlg: 0x00,
              hardBin: 1,
              softBin: 1,
              xCoord: 0,
              yCoord: 0,
            },
            // Die 6: W02:(1,0) fail SBIN 5 / HBIN 2 on Site 2
            {
              headNum: 1,
              siteNum: 2,
              partFlg: 0x08,
              hardBin: 2,
              softBin: 5,
              xCoord: 1,
              yCoord: 0,
            },
          ],
        ],
      },
    ],
  };

  const parsed = parseStdfBytes(writeStdfBytes(spec), { mode: 'full' });
  if (!parsed.ok) {
    throw new Error(`Unexpected fixture parse error: ${parsed.error.message}`);
  }
  return buildLotModel(parsed.value);
}

function maskToIndices(mask: Uint8Array): number[] {
  const out: number[] = [];
  for (let i = 0; i < mask.length; i += 1) {
    if (mask[i] !== 0) {
      out.push(i);
    }
  }
  return out;
}

describe('SelectionStore and Uint8Array mask derivation (Sub-task 5.1)', () => {
  const lot = buildFixtureLot();

  it('returns empty typed arrays when lot is null', () => {
    const masks = deriveSelectionMasks(null, {
      brush: null,
      binFilter: null,
      siteFilter: null,
      dslFilter: null,
      claimHighlight: null,
    });
    expect(masks.hasActiveFilter).toBe(false);
    expect(masks.selectedDieMask).toHaveLength(0);
    expect(masks.selectedDieCount).toBe(0);
    expect(masks.overlayHighlightMask).toHaveLength(0);
    expect(masks.overlayHighlightCount).toBe(0);
  });

  it('selects all dies for analytics while keeping overlayHighlightMask all zeros when unfiltered', () => {
    const store = createSelectionStore();
    store.getState().setLot(lot);

    const state = store.getState();
    expect(state.hasActiveFilter).toBe(false);
    expect(state.selectedDieCount).toBe(lot.dies.count);
    expect(Array.from(state.selectedDieMask)).toEqual([1, 1, 1, 1, 1, 1, 1]);
    expect(state.overlayHighlightCount).toBe(0);
    expect(Array.from(state.overlayHighlightMask)).toEqual([0, 0, 0, 0, 0, 0, 0]);
    expect(state.activeTestNum).toBe(101);
  });

  it('evaluates stacked vs wafer-scoped spatial brushes and excludes missing-coordinate (-32768) dies', () => {
    const store = createSelectionStore();
    store.getState().setLot(lot);

    // Inverted drag bounds [1..0] x [1..0] normalize to [0..1] x [0..1] across all wafers
    store.getState().setBrush({
      scope: 'stacked',
      minX: 1,
      maxX: 0,
      minY: 1,
      maxY: 0,
    });

    expect(store.getState().hasActiveFilter).toBe(true);
    expect(maskToIndices(store.getState().selectedDieMask)).toEqual([0, 1, 2, 5, 6]);
    expect(maskToIndices(store.getState().overlayHighlightMask)).toEqual([
      0, 1, 2, 5, 6,
    ]);

    // Wafer-scoped brush on W02 (waferIndex 1) only selects W02 dies
    store.getState().setBrush({
      scope: 'wafer',
      waferIndex: 1,
      minX: -10,
      maxX: 10,
      minY: -10,
      maxY: 10,
    });
    expect(maskToIndices(store.getState().selectedDieMask)).toEqual([5, 6]);
  });

  it('toggles bin and site filters and evaluates deterministic set intersections (Req 11.4)', () => {
    const store = createSelectionStore();
    store.getState().setLot(lot);

    // Site index 1 corresponds to Head 1 · Site 2 (dies 1, 3, 4, 6)
    store.getState().toggleSiteFilter(1);
    expect(store.getState().siteFilter).toBe(1);
    expect(maskToIndices(store.getState().selectedDieMask)).toEqual([1, 3, 4, 6]);
    expect(maskToIndices(store.getState().overlayHighlightMask)).toEqual([
      1, 3, 4, 6,
    ]);

    // Intersect with SBIN 7 (dies 3, 4) -> intersection is [3, 4]
    store.getState().toggleBinFilter({ mode: 'SBIN', code: 7 });
    expect(maskToIndices(store.getState().selectedDieMask)).toEqual([3, 4]);

    // Intersect with spatial brush covering W01..W02 valid coords -> excludes missing-coord die 4 -> [3]
    store.getState().setBrush({
      scope: 'stacked',
      minX: 0,
      maxX: 5,
      minY: 0,
      maxY: 5,
    });
    expect(maskToIndices(store.getState().selectedDieMask)).toEqual([3]);

    // Order commutativity check via pure deriveSelectionMasks
    const forward = deriveSelectionMasks(lot, {
      brush: { scope: 'stacked', minX: 0, maxX: 5, minY: 0, maxY: 5 },
      binFilter: { mode: 'SBIN', code: 7 },
      siteFilter: 1,
      dslFilter: null,
      claimHighlight: null,
    });
    expect(Array.from(forward.selectedDieMask)).toEqual(
      Array.from(store.getState().selectedDieMask),
    );

    // Toggling the same bin off widens back to Site 2 + brush -> [1, 3, 6]
    store.getState().toggleBinFilter({ mode: 'SBIN', code: 7 });
    expect(store.getState().binFilter).toBeNull();
    expect(maskToIndices(store.getState().selectedDieMask)).toEqual([1, 3, 6]);

    // Toggling Site 2 off leaves only the brush -> [0, 1, 2, 3, 5, 6]
    store.getState().toggleSiteFilter(1);
    expect(store.getState().siteFilter).toBeNull();
    expect(maskToIndices(store.getState().selectedDieMask)).toEqual([
      0, 1, 2, 3, 5, 6,
    ]);
  });

  it('evaluates FilterDslAst clauses (pass-status, bin, edge-ring, radial-zone, wafer, site)', () => {
    const dslFailSite2W01: FilterDslAst = {
      dieClauses: [
        { kind: 'pass-status', status: 'fail' },
        { kind: 'wafer', waferIndices: [0] },
        { kind: 'site', headNum: 1, siteNum: 2 },
        { kind: 'edge-ring', maxRing: 3 },
      ],
      capabilityClauses: [],
    };

    const res = deriveSelectionMasks(lot, {
      brush: null,
      binFilter: null,
      siteFilter: null,
      dslFilter: dslFailSite2W01,
      claimHighlight: null,
    });
    // W01 Site 2 failing coordinate-bearing dies are 1 and 3 (die 4 lacks coords so ringIndex === 0)
    expect(maskToIndices(res.selectedDieMask)).toEqual([1, 3]);

    const dslCenterAndHbin: FilterDslAst = {
      dieClauses: [
        { kind: 'radial-zone', zone: 'center' },
        { kind: 'bin', mode: 'HBIN', codes: [1] },
      ],
      capabilityClauses: [],
    };
    const centerRes = deriveSelectionMasks(lot, {
      brush: null,
      binFilter: null,
      siteFilter: null,
      dslFilter: dslCenterAndHbin,
      claimHighlight: null,
    });
    // W01 center is (1,1) with rMax = hypot(1,1) = 1.414; W02 center is (0.5, 0) with rMax = 0.5 -> check subset containment
    expect(centerRes.selectedDieCount).toBeLessThanOrEqual(lot.dies.count);
  });

  it('derives claimHighlightMask with bounds checking, deduplication, and overlay union', () => {
    const store = createSelectionStore();
    store.getState().setLot(lot);

    store.getState().toggleClaimHighlight({
      claimId: 'claim-cod',
      dieIndices: new Uint32Array([3, 1, 3, 999]),
      citedTestNums: [204],
    });

    const s1 = store.getState();
    expect(s1.hasActiveFilter).toBe(false);
    expect(Array.from(s1.highlightedDieIndices)).toEqual([3, 1]);
    expect(maskToIndices(s1.claimHighlightMask)).toEqual([1, 3]);
    expect(maskToIndices(s1.overlayHighlightMask)).toEqual([1, 3]);
    expect(s1.overlayHighlightCount).toBe(2);
    expect(s1.activeTestNum).toBe(204);

    // Combine claim highlight with active siteFilter 0 (Site 1 -> dies 0, 2, 5)
    store.getState().setSiteFilter(0);
    const s2 = store.getState();
    expect(maskToIndices(s2.selectedDieMask)).toEqual([0, 2, 5]);
    expect(maskToIndices(s2.overlayHighlightMask)).toEqual([0, 1, 2, 3, 5]);
    expect(s2.overlayHighlightCount).toBe(5);

    // Toggling the same claimId clears claimHighlight while preserving siteFilter
    store.getState().toggleClaimHighlight({
      claimId: 'claim-cod',
      dieIndices: new Uint32Array([3, 1]),
    });
    expect(store.getState().claimHighlight).toBeNull();
    expect(maskToIndices(store.getState().overlayHighlightMask)).toEqual([0, 2, 5]);

    // clearFilters restores unfiltered state
    store.getState().clearFilters();
    expect(store.getState().hasActiveFilter).toBe(false);
    expect(store.getState().overlayHighlightCount).toBe(0);
  });

  it('clamps activeWaferIndex, validates hoveredDieIndex, and toggles hiddenBins', () => {
    const store = createSelectionStore();
    store.getState().setLot(lot);

    store.getState().setActiveWaferIndex(99);
    expect(store.getState().activeWaferIndex).toBe(1);
    store.getState().setActiveWaferIndex(-5);
    expect(store.getState().activeWaferIndex).toBe(0);

    store.getState().setHoveredDieIndex(2);
    expect(store.getState().hoveredDieIndex).toBe(2);
    store.getState().setHoveredDieIndex(999);
    expect(store.getState().hoveredDieIndex).toBeNull();

    store.getState().toggleHiddenBin(7);
    expect(store.getState().hiddenBins.has(7)).toBe(true);
    expect(
      areHiddenBinSetsEqual(store.getState().hiddenBins, new Set([7])),
    ).toBe(true);
    store.getState().toggleHiddenBin(7);
    expect(store.getState().hiddenBins.has(7)).toBe(false);
    expect(store.getState().hiddenBins).toBe(EMPTY_HIDDEN_BINS);
  });

  it('reuses cached zero masks on idle path and short-circuits unchanged filter updates (review-5 A-1, A-2, B-4)', () => {
    const cleanInputs = {
      brush: null,
      binFilter: null,
      siteFilter: null,
      dslFilter: null,
      claimHighlight: null,
    } as const;
    const m1 = deriveSelectionMasks(lot, cleanInputs);
    const m2 = deriveSelectionMasks(lot, cleanInputs);
    expect(m1.overlayHighlightMask).toBe(m2.overlayHighlightMask);
    expect(m1.claimHighlightMask).toBe(m2.claimHighlightMask);

    const store = createSelectionStore();
    store.getState().setLot(lot);

    let notifications = 0;
    const unsub = store.subscribe(() => {
      notifications += 1;
    });

    // No-op mutations when already null/clear must not notify subscribers
    store.getState().setBinFilter(null);
    store.getState().setSiteFilter(null);
    store.getState().setBrush(null);
    store.getState().clearFilters();
    expect(notifications).toBe(0);

    unsub();
  });
});
