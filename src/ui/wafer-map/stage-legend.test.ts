import { describe, expect, it } from 'vitest';
import { buildLotModel, type LotModel } from '@/core/model';
import { parseStdfBytes, PRR_PART_FLG, writeStdfBytes } from '@/core/stdf';
import { COLOR_TOKENS } from '@/ui/tokens';
import {
  buildStageLegendModel,
  INLINE_FAIL_BIN_ENTRIES,
  LEGEND_FAILED_KEY,
  LEGEND_PASSED_KEY,
  resolveBinInkIndex,
  resolveGroupToggleCodes,
} from './stage-legend';
import {
  type Canvas2DContextLike,
  computeWaferRenderLayout,
  DEFAULT_VIEWPORT_TRANSFORM,
  paintWaferBaseLayer,
  paintWaferFailLayer,
} from './wafer-geometry';

/** Premium P10 (§5.7): legend model and Pass/fail legend toggles. */

// One row of dies: SBIN 1 and 2 pass; fail SBINs 7 (x3), 5 (x2), 9, 4, 3 (x1 each)
const ROW: ReadonlyArray<{ readonly sbin: number; readonly failed: boolean }> = [
  { sbin: 1, failed: false },
  { sbin: 1, failed: false },
  { sbin: 2, failed: false },
  { sbin: 7, failed: true },
  { sbin: 7, failed: true },
  { sbin: 7, failed: true },
  { sbin: 5, failed: true },
  { sbin: 5, failed: true },
  { sbin: 9, failed: true },
  { sbin: 4, failed: true },
  { sbin: 3, failed: true },
];

function buildLot(): LotModel {
  const bytes = writeStdfBytes({
    endianness: 'little',
    mir: { lotId: 'P10-LEGEND', partTyp: 'CAL', jobNam: 'SORT' },
    wafers: [
      {
        wir: { headNum: 1, siteGrp: 1, startT: 100, waferId: 'W01' },
        wcr: { wfFlat: 'D', posX: 'R', posY: 'U' },
        touchdowns: ROW.map((d, i) => [
          {
            headNum: 1,
            siteNum: 1,
            partFlg: d.failed ? PRR_PART_FLG.FAILED : 0,
            hardBin: d.failed ? 3 : 1,
            softBin: d.sbin,
            xCoord: i - 5,
            yCoord: 0,
          },
        ]),
        wrr: {
          headNum: 1,
          siteGrp: 1,
          finishT: 110,
          partCnt: ROW.length,
          waferId: 'W01',
        },
      },
    ],
    mrr: { finishT: 120 },
  });
  const parsed = parseStdfBytes(bytes, { mode: 'full' });
  if (!parsed.ok) {
    throw new Error(parsed.error.message);
  }
  return buildLotModel(parsed.value);
}

function createFillRecorder() {
  const fills: string[] = [];
  let fillStyle = '';
  const noop = (): undefined => undefined;
  const gradient = { addColorStop: noop };
  const ctx = {
    get fillStyle() {
      return fillStyle;
    },
    set fillStyle(v: string | CanvasGradient | CanvasPattern) {
      fillStyle = typeof v === 'string' ? v : 'gradient';
    },
    strokeStyle: '',
    lineWidth: 1,
    lineJoin: 'miter',
    globalAlpha: 1,
    globalCompositeOperation: 'source-over',
    setTransform: noop,
    clearRect: noop,
    fillRect: noop,
    strokeRect: noop,
    roundRect: noop,
    beginPath: noop,
    arc: noop,
    ellipse: noop,
    moveTo: noop,
    lineTo: noop,
    arcTo: noop,
    quadraticCurveTo: noop,
    bezierCurveTo: noop,
    closePath: noop,
    fill: () => {
      fills.push(fillStyle);
    },
    stroke: noop,
    rect: noop,
    clip: noop,
    save: noop,
    restore: noop,
    setLineDash: noop,
    drawImage: noop,
    createLinearGradient: () => gradient,
    createRadialGradient: () => gradient,
  } as unknown as Canvas2DContextLike;
  return { ctx, fills };
}

describe('stage legend (premium §5.7, P10)', () => {
  const lot = buildLot();
  const layout = computeWaferRenderLayout(
    lot.wafers[0]!,
    400,
    400,
    lot.dies,
    DEFAULT_VIEWPORT_TRANSFORM,
  );

  it('lists fail bins by count with ink slots and groups the good bins', () => {
    const model = buildStageLegendModel(lot, 0, 'sbin');
    expect(model.failBins.map((b) => b.codeLabel)).toEqual([
      'SBIN 7',
      'SBIN 5',
      'SBIN 3',
      'SBIN 4',
      'SBIN 9',
    ]);
    expect(model.failBins.map((b) => b.count)).toEqual([3, 2, 1, 1, 1]);
    // Rank 0 is ember (bin-ink-0), the rest cycle the 7 hues
    expect(model.failBins[0]!.inkIndex).toBe(0);
    expect(new Set(model.failBins.map((b) => b.inkIndex)).size).toBe(5);
    expect(model.goodBins.map((b) => b.code)).toEqual([1, 2]);
    expect(model.goodCount).toBe(3);
    // Up to 4 inline, so "+1 more"
    expect(model.failBins.length - INLINE_FAIL_BIN_ENTRIES).toBe(1);
    expect(buildStageLegendModel(lot, 0, 'pass-fail').failBins).toEqual([]);
  });

  it('maps ranks to bin-ink slots and toggles a group as one', () => {
    expect([0, 1, 7, 8, 15].map(resolveBinInkIndex)).toEqual([0, 1, 7, 1, 1]);
    expect(resolveGroupToggleCodes(new Set(), [1, 2])).toEqual([1, 2]);
    expect(resolveGroupToggleCodes(new Set([1]), [1, 2])).toEqual([2]);
    expect(resolveGroupToggleCodes(new Set([1, 2]), [1, 2])).toEqual([1, 2]);
  });

  it('hides failed or passed dies in Pass/fail mode through the reserved keys', () => {
    expect(LEGEND_FAILED_KEY).toBeGreaterThan(0xffff);
    expect(LEGEND_PASSED_KEY).toBeGreaterThan(0xffff);

    const paintBase = (hidden: ReadonlySet<number>): string[] => {
      const { ctx, fills } = createFillRecorder();
      paintWaferBaseLayer(ctx, {
        lot,
        waferIndex: 0,
        layout,
        dpr: 1,
        colorMode: 'pass-fail',
        activeTestNum: null,
        hiddenBins: hidden,
      });
      return fills;
    };
    const failFills = (fills: readonly string[]): number =>
      fills.filter((f) => f === COLOR_TOKENS.failure).length;

    expect(failFills(paintBase(new Set()))).toBe(1);
    expect(failFills(paintBase(new Set([LEGEND_FAILED_KEY])))).toBe(0);
    const passTileFills = (hidden: ReadonlySet<number>): number =>
      paintBase(hidden).length - failFills(paintBase(hidden));
    expect(passTileFills(new Set([LEGEND_PASSED_KEY]))).toBe(
      passTileFills(new Set()) - 1,
    );

    const paintFail = (hidden: ReadonlySet<number>): string[] => {
      const { ctx, fills } = createFillRecorder();
      paintWaferFailLayer(ctx, {
        lot,
        waferIndex: 0,
        layout,
        dpr: 1,
        colorMode: 'pass-fail',
        hiddenBins: hidden,
      });
      return fills;
    };
    expect(failFills(paintFail(new Set()))).toBe(1);
    expect(paintFail(new Set([LEGEND_FAILED_KEY]))).toEqual([]);
  });
});
