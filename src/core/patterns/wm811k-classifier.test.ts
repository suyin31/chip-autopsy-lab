import { describe, expect, it } from 'vitest';
import { buildLotModel } from '../model/lot-builder';
import type { LotModel } from '../model/types';
import {
  type ParsedLotBuildInput,
  type ParsedPartExecution,
  PRR_PART_FLG,
  STDF_MISSING_COORD,
  STDF_MISSING_U1,
  STDF_MISSING_U2,
  STDF_V4_VERSION,
} from '../stdf/types';
import {
  formatPatternCandidateHypotheses,
  formatSiteConcentrationHypotheses,
  getPatternRootCauseHypotheses,
  getSiteConcentrationHypotheses,
} from './root-causes';
import {
  CLASSIFIER_THRESHOLDS,
  classifyStackedPattern,
  classifyWaferPattern,
  MIN_CLASS_CONFIDENCE,
  MIN_FAIL_COUNT,
  MIN_FAIL_FRACTION,
  STACK_CELL_MIN_FAIL_RATE,
  WM811K_CLASSES,
} from './wm811k-classifier';

function buildCircularTestLot(
  wafers: ReadonlyArray<
    ReadonlyArray<{ readonly x: number; readonly y: number; readonly failed: boolean }>
  >,
): LotModel {
  let prrIndex = 0;
  const parsedWafers = wafers.map((cells, wIdx) => {
    const waferId = `W${String(wIdx + 1).padStart(2, '0')}`;
    const parts: ParsedPartExecution[] = cells.map((c) => {
      const idx = prrIndex;
      prrIndex += 1;
      return {
        prrIndex: idx,
        byteOffset: 64 + idx * 16,
        headNum: 1,
        siteNum: 1,
        partFlg: c.failed ? PRR_PART_FLG.FAILED : 0,
        numTest: 0,
        hardBin: c.failed ? 4 : 1,
        softBin: c.failed ? 7 : 1,
        xCoord: c.x,
        yCoord: c.y,
        testT: 1,
        partId: `${idx}`,
        partTxt: '',
        ptrs: [],
        mprs: [],
        ftrs: [],
      };
    });

    return {
      waferIndex: wIdx,
      implicit: false,
      wir: { headNum: 1, siteGrp: STDF_MISSING_U1, startT: 1, waferId },
      wrr: {
        headNum: 1,
        siteGrp: STDF_MISSING_U1,
        finishT: 2,
        partCnt: parts.length,
        rtstCnt: STDF_MISSING_U2,
        abrtCnt: STDF_MISSING_U2,
        goodCnt: STDF_MISSING_U2,
        funcCnt: STDF_MISSING_U2,
        waferId,
        fabwfId: '',
        frameId: '',
        maskId: '',
        usrDesc: '',
        excDesc: '',
      },
      wcr: null,
      parts,
    };
  });

  const input: ParsedLotBuildInput = {
    parseMode: 'bins-only',
    endianness: 'little',
    stdfVersion: STDF_V4_VERSION,
    mir: null,
    mrr: null,
    pcrs: [],
    hbrs: [
      { headNum: 255, siteNum: 0, hbinNum: 1, hbinCnt: 0, hbinPf: 'P', hbinNam: 'PASS' },
      { headNum: 255, siteNum: 0, hbinNum: 4, hbinCnt: 0, hbinPf: 'F', hbinNam: 'FAIL' },
    ],
    sbrs: [],
    sdrs: [],
    tsrs: [],
    defaultWaferConfig: null,
    ptrDefaults: new Map(),
    wafers: parsedWafers,
    recordsDecoded: prrIndex + 4,
    validPrrCount: prrIndex,
    skippedRecordCount: 0,
    warnings: [],
  };

  return buildLotModel(input);
}

function makeDiscCoords(radius = 12.2): Array<{ readonly x: number; readonly y: number }> {
  const out: Array<{ readonly x: number; readonly y: number }> = [];
  const ceilR = Math.ceil(radius);
  for (let x = -ceilR; x <= ceilR; x += 1) {
    for (let y = -ceilR; y <= ceilR; y += 1) {
      if (Math.hypot(x, y) <= radius) {
        out.push({ x, y });
      }
    }
  }
  return out;
}

describe('WM-811K spatial classifier & root-cause hypotheses', () => {
  it('exports locked design.md thresholds', () => {
    expect(MIN_FAIL_FRACTION).toBe(0.015);
    expect(MIN_FAIL_COUNT).toBe(5);
    expect(MIN_CLASS_CONFIDENCE).toBe(0.45);
    expect(STACK_CELL_MIN_FAIL_RATE).toBe(0.2);
    expect(CLASSIFIER_THRESHOLDS.CONFIDENCE_CAP).toBe(0.98);
  });

  it('enforces noise gate for zero fails, < MIN_FAIL_COUNT, < MIN_FAIL_FRACTION, and missing -32768 coords', () => {
    const disc = makeDiscCoords(12.2); // ~465 cells

    // 0 coordinate fails + 20 failing missing-coordinate parts -> still 'None' (1.00)
    const zeroSpatialFails = [
      ...disc.map((c) => ({ ...c, failed: false })),
      ...Array.from({ length: 20 }, () => ({
        x: STDF_MISSING_COORD,
        y: STDF_MISSING_COORD,
        failed: true,
      })),
    ];
    const resZero = classifyWaferPattern(buildCircularTestLot([zeroSpatialFails]), 0);
    expect(resZero.pattern).toBe('None');
    expect(resZero.confidence).toBe(1);
    expect(resZero.features.testedCellCount).toBe(disc.length);
    expect(resZero.features.activeFailCellCount).toBe(0);

    // 4 fails (< MIN_FAIL_COUNT = 5) -> 'None' (0.98)
    const fourFails = disc.map((c, idx) => ({ ...c, failed: idx < 4 }));
    const resFour = classifyWaferPattern(buildCircularTestLot([fourFails]), 0);
    expect(resFour.pattern).toBe('None');
    expect(resFour.confidence).toBe(0.98);

    // 6 fails on 465 cells (6/465 = 1.29% < 1.5% MIN_FAIL_FRACTION) -> 'None'
    const sixFails = disc.map((c, idx) => ({ ...c, failed: idx < 6 }));
    const resLowFrac = classifyWaferPattern(buildCircularTestLot([sixFails]), 0);
    expect(resLowFrac.pattern).toBe('None');
    expect(resLowFrac.confidence).toBeGreaterThanOrEqual(0.85);
    expect(resLowFrac.signatureDieIds).toEqual([]);
  });

  it('filters non-recurring single-wafer noise on multi-wafer stacks via STACK_CELL_MIN_FAIL_RATE', () => {
    const disc = makeDiscCoords(10.2);
    // 10 wafers: inner center (rho <= 3.2) fails on 6/10 wafers (failRate 0.60 >= 0.20),
    // while each wafer also has 15 non-overlapping single-wafer fails (failRate 0.10 < 0.20)
    const wafers = Array.from({ length: 10 }, (_, wIdx) =>
      disc.map((c, cIdx) => {
        const inCenter = Math.hypot(c.x, c.y) <= 3.2;
        const recurringCenterFail = inCenter && wIdx < 6;
        const nonRecurringNoise = !inCenter && cIdx % 10 === wIdx && cIdx < 150;
        return { x: c.x, y: c.y, failed: recurringCenterFail || nonRecurringNoise };
      }),
    );

    const lot = buildCircularTestLot(wafers);
    const stacked = classifyStackedPattern(lot);
    expect(stacked.pattern).toBe('Center');
    expect(stacked.confidence).toBeGreaterThanOrEqual(0.8);
    expect(stacked.signatureDieIds.length).toBeGreaterThan(0);
  });

  it('provides hedged, clinical engineering hypotheses with "Check next:" steps and zero horror tropes', () => {
    const forbiddenPattern =
      /\b(corpse|murder|zombie|ghost|vampire|haunted|graveyard|blood|skull|cobweb|pumpkin|spooky|monster|autopsy|cause of death|drop the body)\b/i;

    expect(getPatternRootCauseHypotheses('None')).toEqual([]);
    expect(formatPatternCandidateHypotheses('None')).toEqual([]);

    for (const cls of WM811K_CLASSES) {
      if (cls === 'None') continue;
      const items = getPatternRootCauseHypotheses(cls);
      expect(items.length).toBeGreaterThanOrEqual(2);

      for (const h of items) {
        expect(h.mechanism).toMatch(/^Candidate mechanism:/);
        expect(h.summary).toContain('Check next:');
        expect(h.summary).not.toMatch(forbiddenPattern);
      }
    }

    const siteHyps = getSiteConcentrationHypotheses({ headNum: 1, siteNum: 2 });
    const siteFormatted = formatSiteConcentrationHypotheses({ headNum: 1, siteNum: 2 });
    expect(siteHyps.length).toBeGreaterThanOrEqual(2);
    expect(siteFormatted).toHaveLength(siteHyps.length);
    for (const h of siteHyps) {
      expect(h.domain).toBe('test-hardware');
      expect(h.summary).toContain('Head 1 Site 2 (1:2)');
      expect(h.summary).toContain('Check next:');
      expect(h.summary).not.toMatch(forbiddenPattern);
    }
  });
});
