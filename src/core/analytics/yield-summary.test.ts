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
  it('computes exact first-pass, final, and retest counts by lot, wafer, and final test site, including missing-coordinate dies', () => {
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

    // Overall: 4 resolved dies: W01:(0,0)[fp=0,fin=1,rt=1,s=2], W01:(1,0)[fp=1,fin=1,rt=0,s=1],
    // W01:part-0[fp=0,fin=0,rt=0,s=2], W02:(0,0)[fp=1,fin=0,rt=2,s=1]
    expect(summary.overall).toEqual({
      testedDies: 4,
      firstPassDies: 2,
      finalPassDies: 2,
      finalFailDies: 2,
      retestExecutions: 3,
      firstPassYield: 0.5,
      finalYield: 0.5,
    });

    expect(summary.byWafer).toEqual([
      {
        testedDies: 3,
        firstPassDies: 1,
        finalPassDies: 2,
        finalFailDies: 1,
        retestExecutions: 1,
        firstPassYield: 1 / 3,
        finalYield: 2 / 3,
      },
      {
        testedDies: 1,
        firstPassDies: 1,
        finalPassDies: 0,
        finalFailDies: 1,
        retestExecutions: 2,
        firstPassYield: 1,
        finalYield: 0,
      },
    ]);

    // Sites: 1:1 (2 dies), 1:2 (2 dies), 1:3 (0 dies -> null yields)
    expect(summary.bySite).toEqual([
      {
        testedDies: 2,
        firstPassDies: 2,
        finalPassDies: 1,
        finalFailDies: 1,
        retestExecutions: 2,
        firstPassYield: 1,
        finalYield: 0.5,
      },
      {
        testedDies: 2,
        firstPassDies: 0,
        finalPassDies: 1,
        finalFailDies: 1,
        retestExecutions: 1,
        firstPassYield: 0,
        finalYield: 0.5,
      },
      {
        testedDies: 0,
        firstPassDies: 0,
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
    expect(emptySummary.overall.firstPassYield).toBeNull();
    expect(emptySummary.overall.finalYield).toBeNull();

    // Subset selection mask: select only Die 0 (W01:0,0) and Die 1 (W01:1,0)
    const partialMask = Uint8Array.from([1, 1, 0, 0]);
    const partialSummary = computeYieldSummary(lot, partialMask);
    expect(partialSummary.overall).toEqual({
      testedDies: 2,
      firstPassDies: 1,
      finalPassDies: 2,
      finalFailDies: 0,
      retestExecutions: 1,
      firstPassYield: 0.5,
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
    expect(top.siteMetrics.testedDies).toBe(100);
    expect(top.siteMetrics.finalFailDies).toBe(33);
    expect(top.otherSitesFinalYield).toBeCloseTo(0.97, 6);
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
      expect(lot.dies.siteIndex[idx]).toBe(top.site.siteIndex);
      expect(lot.dies.finalPass[idx]).toBe(0);
    }
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
