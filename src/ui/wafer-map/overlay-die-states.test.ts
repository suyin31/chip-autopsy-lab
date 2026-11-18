import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildLotModel, type LotModel } from '@/core/model';
import { parseStdfBytes, PRR_PART_FLG, writeStdfBytes } from '@/core/stdf';
import { WAFER_TOKENS } from '@/ui/tokens';
import {
  type Canvas2DContextLike,
  computeWaferRenderLayout,
  DEFAULT_VIEWPORT_TRANSFORM,
  paintWaferOverlayLayer,
  type PaintWaferOverlayParams,
} from './wafer-geometry';

/** Premium P8 (§5.4): overlay die states drawn in their static, settled form. */

function buildRowLot(): LotModel {
  const part = (siteNum: number, xCoord: number, failed: boolean) => ({
    headNum: 1,
    siteNum,
    partFlg: failed ? PRR_PART_FLG.FAILED : 0,
    hardBin: failed ? 3 : 1,
    softBin: failed ? 7 : 1,
    xCoord,
    yCoord: 0,
  });
  const bytes = writeStdfBytes({
    endianness: 'little',
    mir: { lotId: 'P8-STATES', partTyp: 'CAL', jobNam: 'SORT' },
    wafers: [
      {
        wir: { headNum: 1, siteGrp: 1, startT: 100, waferId: 'W01' },
        wcr: { wfFlat: 'D', posX: 'R', posY: 'U' },
        touchdowns: [[part(1, -1, false), part(2, 0, true), part(1, 1, true)]],
        wrr: { headNum: 1, siteGrp: 1, finishT: 110, partCnt: 3, waferId: 'W01' },
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

interface Op {
  readonly op: string;
  readonly style: string;
  readonly lineWidth: number;
  readonly alpha: number;
  readonly composite: string;
  readonly args: readonly number[];
}

function createRecorder() {
  const ops: Op[] = [];
  let fillStyle = '';
  let strokeStyle = '';
  const ctx: Canvas2DContextLike = {
    get fillStyle() {
      return fillStyle;
    },
    set fillStyle(v: string | CanvasGradient | CanvasPattern) {
      fillStyle = String(v);
    },
    get strokeStyle() {
      return strokeStyle;
    },
    set strokeStyle(v: string | CanvasGradient | CanvasPattern) {
      strokeStyle = String(v);
    },
    lineWidth: 1,
    lineJoin: 'miter',
    globalAlpha: 1,
    globalCompositeOperation: 'source-over',
    setTransform: () => undefined,
    clearRect: () => undefined,
    fillRect: () => undefined,
    strokeRect: () => {
      record('strokeRect', strokeStyle, []);
    },
    roundRect: (x, y, w, h, r) => {
      record('roundRect', '', [x, y, w, h, typeof r === 'number' ? r : 0]);
    },
    beginPath: () => undefined,
    arc: () => undefined,
    moveTo: () => undefined,
    lineTo: () => undefined,
    arcTo: () => undefined,
    closePath: () => undefined,
    fill: () => {
      record('fill', fillStyle, []);
    },
    stroke: () => {
      record('stroke', strokeStyle, []);
    },
    rect: (x, y, w, h) => {
      record('rect', '', [x, y, w, h]);
    },
    setLineDash: () => undefined,
    drawImage: (_img, x, y, w, h) => {
      record('drawImage', '', [x, y, w, h]);
    },
  };
  function record(op: string, style: string, args: readonly number[]): void {
    ops.push({
      op,
      style,
      lineWidth: ctx.lineWidth,
      alpha: ctx.globalAlpha ?? 1,
      composite: ctx.globalCompositeOperation ?? 'source-over',
      args,
    });
  }
  return { ctx, ops };
}

class FakeOffscreenCanvas {
  constructor(
    readonly width: number,
    readonly height: number,
  ) {}
  getContext(): Record<string, unknown> {
    return { fillRect: () => undefined };
  }
}

describe('overlay die states (premium §5.4, P8)', () => {
  const lot = buildRowLot();
  const wafer = lot.wafers[0]!;
  const layout = computeWaferRenderLayout(
    wafer,
    400,
    400,
    lot.dies,
    DEFAULT_VIEWPORT_TRANSFORM,
  );
  // Die order follows the touchdown: 0 pass (x -1), 1 fail (x 0), 2 fail (x 1)
  const passDie = wafer.dieStartIndex;
  const failDie = wafer.dieStartIndex + 1;
  const otherFailDie = wafer.dieStartIndex + 2;
  const emptyMask = new Uint8Array(lot.dies.count);

  const baseParams = (
    overrides: Partial<PaintWaferOverlayParams>,
  ): PaintWaferOverlayParams => ({
    lot,
    waferIndex: 0,
    layout,
    dpr: 2,
    overlayHighlightMask: emptyMask,
    overlayHighlightCount: 0,
    hoveredDieIndex: null,
    brush: null,
    ...overrides,
  });

  beforeEach(() => {
    vi.stubGlobal('OffscreenCanvas', FakeOffscreenCanvas);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('draws nothing at rest', () => {
    const { ctx, ops } = createRecorder();
    paintWaferOverlayLayer(ctx, baseParams({}));
    expect(ops).toHaveLength(0);
  });

  it('veils the disc, blooms and punches evidence fail dies, then rims every evidence die', () => {
    expect(lot.dies.finalPass[passDie]).not.toBe(0);
    expect(lot.dies.finalPass[failDie]).toBe(0);
    const { ctx, ops } = createRecorder();
    paintWaferOverlayLayer(
      ctx,
      baseParams({
        glowOverride: {
          scrimAlpha: 1,
          dieIndices: Uint32Array.from([failDie, passDie]),
          dieAlphas: Float32Array.from([1, 1]),
        },
      }),
    );

    const veil = ops.findIndex((o) => o.op === 'fill' && o.style === WAFER_TOKENS.dimVeil);
    const blooms = ops.filter((o) => o.op === 'drawImage');
    const punch = ops.findIndex(
      (o) => o.op === 'fill' && o.composite === 'destination-out',
    );
    const failRim = ops.findIndex(
      (o) => o.op === 'stroke' && o.style === WAFER_TOKENS.evidenceRim,
    );
    const passRim = ops.findIndex(
      (o) => o.op === 'stroke' && o.style === WAFER_TOKENS.evidencePassRim,
    );

    expect(veil).toBeGreaterThanOrEqual(0);
    expect(ops[veil]!.alpha).toBe(1);
    expect(ops[veil]!.composite).toBe('source-over');
    // Bloom only under the fail die, `lighter` at 0.6, sprite = die + 3 sigma (8 px) a side
    expect(blooms).toHaveLength(1);
    expect(blooms[0]!.composite).toBe('lighter');
    expect(blooms[0]!.alpha).toBeCloseTo(WAFER_TOKENS.evidenceBloom.compositeAlpha, 6);
    expect(blooms[0]!.args[2]).toBeCloseTo(layout.dieSizePx + 48, 0);
    expect(ops.indexOf(blooms[0]!)).toBeGreaterThan(veil);
    expect(punch).toBeGreaterThan(ops.indexOf(blooms[0]!));
    expect(failRim).toBeGreaterThan(punch);
    expect(passRim).toBeGreaterThan(punch);
    expect(ops[failRim]!.lineWidth).toBe(1);
    expect(ops[passRim]!.lineWidth).toBe(1);
    expect(ops[failRim]!.composite).toBe('source-over');

    // The punch covers both evidence dies at the full fail-die cell
    const punchShapes = ops
      .slice(veil + 1, punch)
      .filter((o) => o.op === 'roundRect');
    expect(punchShapes).toHaveLength(2);
    expect(punchShapes.every((o) => Math.abs(o.args[2]! - layout.dieSizePx) < 1e-6)).toBe(true);

    // Rims sit 1 px inside: the path is inset by half the line width
    const rimShapes = ops.slice(punch + 1, failRim).filter((o) => o.op === 'roundRect');
    expect(rimShapes).toHaveLength(1);
    expect(rimShapes[0]!.args[2]).toBeCloseTo(layout.dieSizePx - 1, 6);
  });

  it('scales the veil by its progress and fades partially lit rims with their alpha', () => {
    const { ctx, ops } = createRecorder();
    paintWaferOverlayLayer(
      ctx,
      baseParams({
        glowOverride: {
          scrimAlpha: 0.5,
          dieIndices: Uint32Array.from([failDie]),
          dieAlphas: Float32Array.from([0.4]),
        },
      }),
    );
    const veil = ops.find((o) => o.op === 'fill' && o.style === WAFER_TOKENS.dimVeil);
    expect(veil?.alpha).toBeCloseTo(0.5, 6);
    const rim = ops.find((o) => o.op === 'stroke' && o.style === WAFER_TOKENS.evidenceRim);
    expect(rim?.alpha).toBeCloseTo(0.4, 6);
  });

  it('shows a filter highlight as settled evidence, but a box selection alone gets only the selection rect', () => {
    const mask = new Uint8Array(lot.dies.count);
    mask[failDie] = 1;
    mask[otherFailDie] = 1;
    const filtered = createRecorder();
    paintWaferOverlayLayer(
      filtered.ctx,
      baseParams({ overlayHighlightMask: mask, overlayHighlightCount: 2 }),
    );
    expect(
      filtered.ops.some((o) => o.op === 'fill' && o.style === WAFER_TOKENS.dimVeil),
    ).toBe(true);
    expect(
      filtered.ops.filter((o) => o.op === 'stroke' && o.style === WAFER_TOKENS.evidenceRim),
    ).toHaveLength(1);

    const selected = createRecorder();
    paintWaferOverlayLayer(
      selected.ctx,
      baseParams({
        overlayHighlightMask: mask,
        overlayHighlightCount: 2,
        highlightIsSelectionOnly: true,
        liveBrushScreenRect: { x: 100, y: 120, width: 80, height: 40 },
      }),
    );
    const sel = WAFER_TOKENS.selectionRect;
    expect(
      selected.ops.filter((o) => o.op === 'fill').map((o) => o.style),
    ).toEqual([sel.fill]);
    expect(
      selected.ops.filter((o) => o.op === 'stroke').map((o) => [o.style, o.lineWidth]),
    ).toEqual([[sel.stroke, sel.strokeWidthPx]]);
    const shapes = selected.ops.filter((o) => o.op === 'roundRect');
    expect(shapes[0]!.args).toEqual([100, 120, 80, 40, 4]);
    expect(shapes[1]!.args).toEqual([100.5, 120.5, 79, 39, 3.5]);
  });

  it('draws hover-stroke and pinned-stroke as an inside light ring with an outside dark keyline', () => {
    const { ctx, ops } = createRecorder();
    paintWaferOverlayLayer(
      ctx,
      baseParams({ hoveredDieIndex: passDie, pinnedDieIndex: failDie }),
    );
    const strokes = ops
      .filter((o) => o.op === 'stroke')
      .map((o) => [o.style, o.lineWidth]);
    const { hoverStroke, pinnedStroke } = WAFER_TOKENS;
    expect(strokes).toEqual([
      [hoverStroke.outer, hoverStroke.outerWidthPx],
      [hoverStroke.inner, hoverStroke.innerWidthPx],
      [pinnedStroke.outer, pinnedStroke.outerWidthPx],
      [pinnedStroke.inner, pinnedStroke.innerWidthPx],
    ]);
    const shapes = ops.filter((o) => o.op === 'roundRect');
    // Hover on the pass tile: keyline 0.5 px outside, light ring 0.75 px inside
    expect(shapes[0]!.args[2]).toBeCloseTo(layout.passDieSizePx + 1, 6);
    expect(shapes[1]!.args[2]).toBeCloseTo(layout.passDieSizePx - 1.5, 6);
    // Pinned on the fail die: keyline 0.5 px outside, light ring 1 px inside
    expect(shapes[2]!.args[2]).toBeCloseTo(layout.dieSizePx + 1, 6);
    expect(shapes[3]!.args[2]).toBeCloseTo(layout.dieSizePx - 2, 6);

    // A pinned die that is also hovered shows the pinned stroke only
    const same = createRecorder();
    paintWaferOverlayLayer(
      same.ctx,
      baseParams({ hoveredDieIndex: failDie, pinnedDieIndex: failDie }),
    );
    expect(
      same.ops.filter((o) => o.op === 'stroke').map((o) => o.style),
    ).toEqual([pinnedStroke.outer, pinnedStroke.inner]);
  });
});
