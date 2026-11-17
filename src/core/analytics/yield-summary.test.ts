import { describe, expect, it } from 'vitest';
import { buildLotModel } from '../model/lot-builder';
import { parseStdfBytes } from '../stdf/stdf-parser';
import { writeStdfBytes } from '../stdf/stdf-writer';
import {
  PRR_PART_FLG,
  STDF_MISSING_COORD,
  type StdfWriteLotSpec,
  type StdfWritePartSpec,
} from '../stdf/types';
import {
  computeYieldSummary,
  detectSiteAnomalies,
  SITE_ANOMALY_THRESHOLDS,
} from './yield-summary';

function buildLotFromSpec(spec: StdfWriteLotSpec) {
  const bytes = writeStdfBytes(spec);
  const parsed = parseStdfBytes(bytes, { mode: 'bins-only' });
  if (!parsed.ok) {
    throw new Error(`Unexpected fatal parse error: ${parsed.error.message}`);
  }
  return buildLotModel(parsed.value);
}

describe('computeYieldSummary (Requirement 7.3)', () => {
  it('partitions per-site first-pass yield by firstSiteIndex and per-site final yield by final siteIndex, including missing-coordinate dies', () => {
    const lot = buildLotFromSpec({
      endianness: 'little',
      sdrs: [{ headNum: 1, siteGrp: 1, siteNums: [1, 2, 3] }], // Site 3 declared in SDR with 0 dies
      hbrs: [
        { hbinNum: 1, hbinCnt: 4, hbinPf: 'P', hbinNam: 'PASS' },
        { hbinNum: 2, hbinCnt: 2, hbinPf: 'F', hbinNam: 'FAIL' },
      ],
      wafers: [
        {
          wir: { headNum: 1, waferId: 'W01' },
          parts: [
            // Die (0,0): fails first pass on Site 1, passes retest on Site 2
            {
              headNum: 1,
              siteNum: 1,
              partFlg: PRR_PART_FLG.FAILED,
              hardBin: 2,
              xCoord: 0,
              yCoord: 0,
            },
            {
              headNum: 1,
              siteNum: 2,
              partFlg: 0,
              hardBin: 1,
              xCoord: 0,
              yCoord: 0,
            },
            // Die (1,0): passes on Site 1
            {
              headNum: 1,
              siteNum: 1,
              partFlg: 0,
              hardBin: 1,
              xCoord: 1,
              yCoord: 0,
            },
            // Missing-coord part: fails on Site 2 (retained in non-spatial totals per Req 4.2)
            {
              headNum: 1,
              siteNum: 2,
              partFlg: PRR_PART_FLG.FAILED,
              hardBin: 2,
              xCoord: STDF_MISSING_COORD,
              yCoord: STDF_MISSING_COORD,
            },
          ],
          wrr: { headNum: 1, partCnt: 4, waferId: 'W01' },
        },
        {
          wir: { headNum: 1, waferId: 'W02' },
          parts: [
            // Die (0,0) on W02: passes first pass on Site 1, fails 2nd & 3rd retests on Site 1
            {
              headNum: 1,
              siteNum: 1,
              partFlg: 0,
              hardBin: 1,
              xCoord: 0,
              yCoord: 0,
            },
            {
              headNum: 1,
              siteNum: 1,
              partFlg: PRR_PART_FLG.FAILED,
              hardBin: 2,
              xCoord: 0,
              yCoord: 0,
            },
            {
              headNum: 1,
              siteNum: 1,
              partFlg: PRR_PART_FLG.FAILED,
              hardBin: 2,
              xCoord: 0,
              yCoord: 0,
            },
          ],
          wrr: { headNum: 1, partCnt: 3, waferId: 'W02' },
        },
      ],
    });

    const summary = computeYieldSummary(lot);

    // Overall: 4 resolved dies:
    // - W01:(0,0)[fp=0 on 1:1, fin=1 on 1:2, rt=1]
    // - W01:(1,0)[fp=1 on 1:1, fin=1 on 1:1, rt=0]
    // - W01:part-0[fp=0 on 1:2, fin=0 on 1:2, rt=0]
    // - W02:(0,0)[fp=1 on 1:1, fin=0 on 1:1, rt=2]
    expect(summary.overall).toEqual({
      testedDies: 4,
      firstPassTestedDies: 4,
      firstPassDies: 2,
      firstPassFailDies: 2,
      finalPassDies: 2,
      finalFailDies: 2,
      retestExecutions: 3,
      firstPassYield: 0.5,
      finalYield: 0.5,
    });

    expect(summary.byWafer).toEqual([
      {
        testedDies: 3,
        firstPassTestedDies: 3,
        firstPassDies: 1,
        firstPassFailDies: 2,
        finalPassDies: 2,
        finalFailDies: 1,
        retestExecutions: 1,
        firstPassYield: 1 / 3,
        finalYield: 2 / 3,
      },
      {
        testedDies: 1,
        firstPassTestedDies: 1,
        firstPassDies: 1,
        firstPassFailDies: 0,
        finalPassDies: 0,
        finalFailDies: 1,
        retestExecutions: 2,
        firstPassYield: 1,
        finalYield: 0,
      },
    ]);

    // Sites:
    // - 1:1 first-tested 3 dies (W01:0,0[fail], W01:1,0[pass], W02:0,0[pass] -> 2/3) and
    //   final-tested 2 dies (W01:1,0[pass], W02:0,0[fail] -> 1/2)
    // - 1:2 first-tested 1 die (W01:part-0[fail] -> 0/1) and
    //   final-tested 2 dies (W01:0,0[pass], W01:part-0[fail] -> 1/2)
    // - 1:3 tested 0 dies -> null yields
    expect(summary.bySite).toEqual([
      {
        testedDies: 2,
        firstPassTestedDies: 3,
        firstPassDies: 2,
        firstPassFailDies: 1,
        finalPassDies: 1,
        finalFailDies: 1,
        retestExecutions: 2,
        firstPassYield: 2 / 3,
        finalYield: 0.5,
      },
      {
        testedDies: 2,
        firstPassTestedDies: 1,
        firstPassDies: 0,
        firstPassFailDies: 1,
        finalPassDies: 1,
        finalFailDies: 1,
        retestExecutions: 1,
        firstPassYield: 0,
        finalYield: 0.5,
      },
      {
        testedDies: 0,
        firstPassTestedDies: 0,
        firstPassDies: 0,
        firstPassFailDies: 0,
        finalPassDies: 0,
        finalFailDies: 0,
        retestExecutions: 0,
        firstPassYield: null,
        finalYield: null,
      },
    ]);

    // Empty selection mask -> null yields, never NaN or Infinity
    const emptyMask = new Uint8Array(lot.dies.count);
    const emptySummary = computeYieldSummary(lot, emptyMask);
    expect(emptySummary.overall.testedDies).toBe(0);
    expect(emptySummary.overall.firstPassTestedDies).toBe(0);
    expect(emptySummary.overall.firstPassYield).toBeNull();
    expect(emptySummary.overall.finalYield).toBeNull();

    // Subset selection mask: select only Die 0 (W01:0,0) and Die 1 (W01:1,0)
    const partialMask = Uint8Array.from([1, 1, 0, 0]);
    const partialSummary = computeYieldSummary(lot, partialMask);
    expect(partialSummary.overall).toEqual({
      testedDies: 2,
      firstPassTestedDies: 2,
      firstPassDies: 1,
      firstPassFailDies: 1,
      finalPassDies: 2,
      finalFailDies: 0,
      retestExecutions: 1,
      firstPassYield: 0.5,
      finalYield: 1.0,
    });
  });

  it('counts a die first failing on Site 1 then passing on retest at Site 2 as a Site 1 first-pass fail while keeping Site 2 final yield', () => {
    const lot = buildLotFromSpec({
      endianness: 'little',
      sdrs: [{ headNum: 1, siteGrp: 1, siteNums: [1, 2] }],
      hbrs: [
        { hbinNum: 1, hbinCnt: 3, hbinPf: 'P', hbinNam: 'PASS' },
        { hbinNum: 2, hbinCnt: 1, hbinPf: 'F', hbinNam: 'CONT_FAIL' },
      ],
      wafers: [
        {
          wir: { headNum: 1, waferId: 'W01' },
          parts: [
            // Die (0,0): fails first pass on Site 1, then passes retest on Site 2
            {
              headNum: 1,
              siteNum: 1,
              partFlg: PRR_PART_FLG.FAILED,
              hardBin: 2,
              xCoord: 0,
              yCoord: 0,
            },
            {
              headNum: 1,
              siteNum: 2,
              partFlg: 0,
              hardBin: 1,
              xCoord: 0,
              yCoord: 0,
            },
            // Die (1,0): single pass on Site 1
            {
              headNum: 1,
              siteNum: 1,
              partFlg: 0,
              hardBin: 1,
              xCoord: 1,
              yCoord: 0,
            },
            // Die (0,1): single pass on Site 2
            {
              headNum: 1,
              siteNum: 2,
              partFlg: 0,
              hardBin: 1,
              xCoord: 0,
              yCoord: 1,
            },
          ],
          wrr: { headNum: 1, partCnt: 4, waferId: 'W01' },
        },
      ],
    });

    const summary = computeYieldSummary(lot);

    // Site 1 (index 0): first-tested (0,0)[fail] & (1,0)[pass] -> 50% first-pass yield;
    // final-tested only (1,0)[pass] -> 100% final yield.
    expect(summary.bySite[0]).toEqual({
      testedDies: 1,
      firstPassTestedDies: 2,
      firstPassDies: 1,
      firstPassFailDies: 1,
      finalPassDies: 1,
      finalFailDies: 0,
      retestExecutions: 0,
      firstPassYield: 0.5,
      finalYield: 1.0,
    });

    // Site 2 (index 1): first-tested only (0,1)[pass] -> 100% first-pass yield (not blamed for Site 1's fail);
    // final-tested (0,0)[pass] & (0,1)[pass] -> 100% final yield.
    expect(summary.bySite[1]).toEqual({
      testedDies: 2,
      firstPassTestedDies: 1,
      firstPassDies: 1,
      firstPassFailDies: 0,
      finalPassDies: 2,
      finalFailDies: 0,
      retestExecutions: 1,
      firstPassYield: 1.0,
      finalYield: 1.0,
    });

    // Scoped strictly to Die 0 ((0,0) alone): Site 1 firstPassYield = 0, finalYield = null;
    // Site 2 firstPassYield = null, finalYield = 1.0.
    const onlyRetestedDie = Uint8Array.from([1, 0, 0]);
    const singleDieSummary = computeYieldSummary(lot, onlyRetestedDie);
    expect(singleDieSummary.bySite[0]).toEqual({
      testedDies: 0,
      firstPassTestedDies: 1,
      firstPassDies: 0,
      firstPassFailDies: 1,
      finalPassDies: 0,
      finalFailDies: 0,
      retestExecutions: 0,
      firstPassYield: 0,
      finalYield: null,
    });
    expect(singleDieSummary.bySite[1]).toEqual({
      testedDies: 1,
      firstPassTestedDies: 0,
      firstPassDies: 0,
      firstPassFailDies: 0,
      finalPassDies: 1,
      finalFailDies: 0,
      retestExecutions: 1,
      firstPassYield: null,
      finalYield: 1.0,
    });
  });
});

describe('detectSiteAnomalies (Requirement 7.4)', () => {
  function generateMultiSiteParts(
    siteCounts: ReadonlyArray<{
      readonly siteNum: number;
      readonly tested: number;
      readonly fails: number;
    }>,
  ): StdfWritePartSpec[] {
    const parts: StdfWritePartSpec[] = [];
    let coordCursor = 0;
    for (const cfg of siteCounts) {
      for (let i = 0; i < cfg.tested; i += 1) {
        const failed = i < cfg.fails;
        const x = (coordCursor % 64) - 32;
        const y = Math.floor(coordCursor / 64) - 32;
        coordCursor += 1;
        parts.push({
          headNum: 1,
          siteNum: cfg.siteNum,
          partFlg: failed ? PRR_PART_FLG.FAILED : 0,
          hardBin: failed ? 2 : 1,
          softBin: failed ? 5 : 1,
          xCoord: x,
          yCoord: y,
        });
      }
    }
    return parts;
  }

  it('flags Site 1:2 with z >= 3.0 and confidence >= 0.75 on a quad-site probe-contact anomaly profile', () => {
    // Mirrors site2-probe-contact ratios: Sites 1, 3, 4 at 97% (97/100), Site 2 at 67% (67/100)
    const parts = generateMultiSiteParts([
      { siteNum: 1, tested: 100, fails: 3 },
      { siteNum: 2, tested: 100, fails: 33 },
      { siteNum: 3, tested: 100, fails: 3 },
      { siteNum: 4, tested: 100, fails: 3 },
    ]);
    const lot = buildLotFromSpec({
      endianness: 'little',
      sdrs: [{ headNum: 1, siteGrp: 1, siteNums: [1, 2, 3, 4] }],
      wafers: [
        {
          wir: { headNum: 1, waferId: 'W01' },
          parts,
          wrr: { headNum: 1, partCnt: parts.length, waferId: 'W01' },
        },
      ],
    });

    const anomalies = detectSiteAnomalies(lot);
    expect(anomalies).toHaveLength(1);

    const top = anomalies[0]!;
    expect(top.site.label).toBe('1:2');
    expect(top.siteMetrics.firstPassTestedDies).toBe(100);
    expect(top.siteMetrics.firstPassFailDies).toBe(33);
    expect(top.otherSitesFirstPassYield).toBeCloseTo(0.97, 6);
    expect(top.yieldDeltaPp).toBeCloseTo(-30.0, 6);
    expect(top.twoProportionZ).toBeGreaterThanOrEqual(
      SITE_ANOMALY_THRESHOLDS.MIN_TWO_PROPORTION_Z,
    );
    expect(top.excessFailCount).toBe(30);
    expect(top.excessFailShare).toBeCloseTo(30 / 42, 6);
    expect(top.confidence).toBeGreaterThanOrEqual(0.75);
    expect(top.confidence).toBeLessThanOrEqual(0.99);
    expect(top.failingDieIndices).toHaveLength(33);
    for (const idx of top.failingDieIndices) {
      expect(lot.dies.firstSiteIndex[idx]).toBe(top.site.siteIndex);
      expect(lot.dies.firstPass[idx]).toBe(0);
    }
  });

  it('flags a degraded Site 1 on first-pass results even when cross-site retesting at Site 2 recovers the failing dies', () => {
    const parts: StdfWritePartSpec[] = [];
    // Site 1 first-tests 100 dies: 40 fail first pass on Site 1 and are retested on Site 2 where 38 pass!
    for (let i = 0; i < 100; i += 1) {
      const failedFirst = i < 40;
      parts.push({
        headNum: 1,
        siteNum: 1,
        partFlg: failedFirst ? PRR_PART_FLG.FAILED : 0,
        hardBin: failedFirst ? 2 : 1,
        xCoord: i,
        yCoord: 0,
      });
      if (failedFirst) {
        const stillFails = i < 2;
        parts.push({
          headNum: 1,
          siteNum: 2,
          partFlg: stillFails ? PRR_PART_FLG.FAILED : 0,
          hardBin: stillFails ? 2 : 1,
          xCoord: i,
          yCoord: 0,
        });
      }
    }
    // Site 2 first-tests 100 dies of its own with only 2 failures (98% first-pass yield)
    for (let j = 0; j < 100; j += 1) {
      const failed = j < 2;
      parts.push({
        headNum: 1,
        siteNum: 2,
        partFlg: failed ? PRR_PART_FLG.FAILED : 0,
        hardBin: failed ? 2 : 1,
        xCoord: j,
        yCoord: 1,
      });
    }

    const lot = buildLotFromSpec({
      endianness: 'little',
      sdrs: [{ headNum: 1, siteGrp: 1, siteNums: [1, 2] }],
      wafers: [{ parts }],
    });

    const summary = computeYieldSummary(lot);
    // Final yield on Site 1 is 60/60 = 100%, which would have hidden the bad Site 1 socket under final-site z-testing!
    expect(summary.bySite[0]?.finalYield).toBe(1.0);
    expect(summary.bySite[0]?.firstPassYield).toBeCloseTo(0.6, 6);
    expect(summary.bySite[1]?.firstPassYield).toBeCloseTo(0.98, 6);

    const anomalies = detectSiteAnomalies(lot);
    expect(anomalies).toHaveLength(1);
    expect(anomalies[0]?.site.label).toBe('1:1');
    expect(anomalies[0]?.yieldDeltaPp).toBeCloseTo(-38.0, 6);
    expect(anomalies[0]?.twoProportionZ).toBeGreaterThanOrEqual(3.0);
    expect(anomalies[0]?.failingDieIndices).toHaveLength(40);
  });

  it('enforces all three Requirement 7.4 gates (>= 2 sites with n >= 30, > 5.0 pp drop, and z >= 3.0)', () => {
    // Gate 1: Only 1 site has >= 30 dies (Site 2 has 29 dies with 100% failure) -> must NOT flag
    const underSampleParts = generateMultiSiteParts([
      { siteNum: 1, tested: 100, fails: 0 },
      { siteNum: 2, tested: 29, fails: 29 },
    ]);
    const underSampleLot = buildLotFromSpec({
      endianness: 'little',
      wafers: [{ parts: underSampleParts }],
    });
    expect(detectSiteAnomalies(underSampleLot)).toEqual([]);

    // Gate 2: Site 3 has < 30 dies (5 dies, all failing) even though Sites 1 & 2 have >= 30 dies -> Site 3 ignored
    const smallThirdSiteParts = generateMultiSiteParts([
      { siteNum: 1, tested: 60, fails: 1 },
      { siteNum: 2, tested: 60, fails: 1 },
      { siteNum: 3, tested: 5, fails: 5 },
    ]);
    const smallThirdLot = buildLotFromSpec({
      endianness: 'little',
      wafers: [{ parts: smallThirdSiteParts }],
    });
    expect(detectSiteAnomalies(smallThirdLot)).toEqual([]);

    // Gate 3: Large sample (z > 3.0) with exactly 5.0 pp drop (not strictly > 5.0 pp) -> must NOT flag
    const fivePpExactParts = generateMultiSiteParts([
      { siteNum: 1, tested: 1_000, fails: 0 }, // 100.0%
      { siteNum: 2, tested: 1_000, fails: 50 }, // 95.0% -> delta = -5.0 pp (not < -5.0)
    ]);
    const fivePpLot = buildLotFromSpec({
      endianness: 'little',
      wafers: [{ parts: fivePpExactParts }],
    });
    expect(detectSiteAnomalies(fivePpLot)).toEqual([]);

    // Gate 4: > 5.0 pp drop (-10.0 pp: 90% vs 100%) on n = 30 where z = 1.78 < 3.0 -> must NOT flag
    const lowZParts = generateMultiSiteParts([
      { siteNum: 1, tested: 30, fails: 0 },
      { siteNum: 2, tested: 30, fails: 3 },
    ]);
    const lowZLot = buildLotFromSpec({
      endianness: 'little',
      wafers: [{ parts: lowZParts }],
    });
    expect(detectSiteAnomalies(lowZLot)).toEqual([]);
  });
});
