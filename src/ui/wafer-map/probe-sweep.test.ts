import { describe, expect, it } from 'vitest';
import { buildLotModel, buildWaferProbeOrder } from '@/core/model';
import { parseStdfBytes, PRR_PART_FLG, writeStdfBytes } from '@/core/stdf';
import { COLOR_TOKENS, WAFER_TOKENS } from '@/ui/tokens';
import {
  computeProbeSweepFraction,
  computeVerdictRiseSchedule,
  easeInOutSine,
  PROBE_SWEEP_FAIL_FADE_MS,
  PROBE_SWEEP_REVEAL_MS,
  PROBE_SWEEP_TOTAL_MAX_MS,
  resolveInitialRevealMode,
  sampleStatCountUp,
} from './probe-sweep';
import {
  type Canvas2DContextLike,
  computeWaferRenderLayout,
  DEFAULT_VIEWPORT_TRANSFORM,
  paintWaferOverlayLayer,
  paintWaferSubstrateOnly,
  paintWaferSweepBatch,
} from './wafer-geometry';

function buildTinyWaferLot() {
  const bytes = writeStdfBytes({
    endianness: 'little',
    mir: { lotId: 'TINY-SWEEP', partTyp: 'CAL', jobNam: 'SORT' },
    wafers: [
      {
        wir: { headNum: 1, siteGrp: 1, startT: 100, waferId: 'W01' },
        wcr: { wfFlat: 'D', posX: 'R', posY: 'U' },
        touchdowns: [
          [
            {
              headNum: 1,
              siteNum: 1,
              partFlg: 0,
              hardBin: 1,
              softBin: 1,
              xCoord: -1,
              yCoord: 0,
            },
            {
              headNum: 1,
              siteNum: 2,
              partFlg: PRR_PART_FLG.FAILED,
              hardBin: 3,
              softBin: 7,
              xCoord: 0,
              yCoord: 0,
            },
            {
              headNum: 1,
              siteNum: 1,
              partFlg: 0,
              hardBin: 1,
              softBin: 1,
              xCoord: 1,
              yCoord: 0,
            },
          ],
        ],
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

function createRecordingCanvas() {
  const calls: Array<{ op: string; fillStyle?: string; strokeStyle?: string }> =
    [];
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
    lineJoin: 'round',
    globalAlpha: 1,
    globalCompositeOperation: 'source-over',
    setTransform: () => undefined,
    clearRect: () => {
      calls.push({ op: 'clearRect' });
    },
    fillRect: () => {
      calls.push({ op: 'fillRect', fillStyle });
    },
    roundRect: () => {
      calls.push({ op: 'roundRect', fillStyle });
    },
    strokeRect: () => {
      calls.push({ op: 'strokeRect', strokeStyle });
    },
    beginPath: () => undefined,
    arc: () => {
      calls.push({ op: 'arc' });
    },
    moveTo: () => undefined,
    lineTo: () => undefined,
    closePath: () => undefined,
    fill: () => {
      calls.push({ op: 'fill', fillStyle });
    },
    stroke: () => {
      calls.push({ op: 'stroke', strokeStyle });
    },
    rect: () => undefined,
    setLineDash: () => undefined,
    drawImage: () => {
      calls.push({ op: 'drawImage' });
    },
  };
  return { ctx, calls };
}

describe('R8 reveal motion math & canvas probe-sweep painters (§5.1–§5.3)', () => {
  it('keeps total probe-sweep + fail-fade ceiling <= 1,200 ms and gates progress by min(parseProgress, easeInOutSine)', () => {
    expect(PROBE_SWEEP_REVEAL_MS + PROBE_SWEEP_FAIL_FADE_MS).toBeLessThanOrEqual(
      PROBE_SWEEP_TOTAL_MAX_MS,
    );
    expect(PROBE_SWEEP_TOTAL_MAX_MS).toBe(1200);
    expect(PROBE_SWEEP_FAIL_FADE_MS).toBe(280);

    expect(easeInOutSine(0)).toBeCloseTo(0, 6);
    expect(easeInOutSine(0.5)).toBeCloseTo(0.5, 6);
    expect(easeInOutSine(1)).toBeCloseTo(1, 6);

    // Slow parse holds the sweep instead of finishing early (§5.1)
    expect(computeProbeSweepFraction(PROBE_SWEEP_REVEAL_MS, PROBE_SWEEP_REVEAL_MS, 0.42)).toBeCloseTo(
      0.42,
      6,
    );
    expect(computeProbeSweepFraction(0, PROBE_SWEEP_REVEAL_MS, 1)).toBe(0);
    expect(
      computeProbeSweepFraction(PROBE_SWEEP_REVEAL_MS, PROBE_SWEEP_REVEAL_MS, 1),
    ).toBe(1);
  });

  it('selects sweep on first session load, 240 ms base fade on subsequent loads, and 120 ms opacity fade under reduced motion', () => {
    expect(
      resolveInitialRevealMode({ seenInSession: false, prefersReducedMotion: false }),
    ).toEqual({ mode: 'sweep', fadeDurationMs: 0 });
    expect(
      resolveInitialRevealMode({ seenInSession: true, prefersReducedMotion: false }),
    ).toEqual({ mode: 'subsequent-fade', fadeDurationMs: 240 });
    expect(
      resolveInitialRevealMode({ seenInSession: false, prefersReducedMotion: true }),
    ).toEqual({ mode: 'reduced', fadeDurationMs: 120 });
    expect(
      resolveInitialRevealMode({ seenInSession: true, prefersReducedMotion: true }),
    ).toEqual({ mode: 'reduced', fadeDurationMs: 120 });
  });

  it('builds 5-block 60 ms stagger schedule for Verdict rise-in (§5.2) and collapses stagger/blur/y under reduced motion', () => {
    const normal = computeVerdictRiseSchedule(false);
    expect(normal).toHaveLength(5);
    expect(normal.map((s) => s.delayMs)).toEqual([0, 60, 120, 180, 240]);
    for (const item of normal) {
      expect(item.initialY).toBe(12);
      expect(item.initialBlurPx).toBe(4);
    }

    const reduced = computeVerdictRiseSchedule(true);
    expect(reduced).toHaveLength(5);
    expect(reduced.map((s) => s.delayMs)).toEqual([0, 0, 0, 0, 0]);
    for (const item of reduced) {
      expect(item.initialY).toBe(0);
      expect(item.initialBlurPx).toBe(0);
      expect(item.durationMs).toBe(120);
    }
  });

  it('samples stat count-up (§5.3) over 700 ms / 300 ms ease-out-expo and returns target immediately under reduced motion', () => {
    expect(
      sampleStatCountUp({
        from: 0,
        to: 2721,
        elapsedMs: 10,
        durationMs: 700,
        prefersReducedMotion: true,
      }),
    ).toBe(2721);

    expect(
      sampleStatCountUp({
        from: 0,
        to: 2721,
        elapsedMs: 0,
        durationMs: 700,
        prefersReducedMotion: false,
      }),
    ).toBe(0);

    const mid = sampleStatCountUp({
      from: 0,
      to: 2721,
      elapsedMs: 350,
      durationMs: 700,
      prefersReducedMotion: false,
    });
    expect(mid).toBeGreaterThan(2000);
    expect(mid).toBeLessThan(2721);

    expect(
      sampleStatCountUp({
        from: 0,
        to: 2721,
        elapsedMs: 700,
        durationMs: 700,
        prefersReducedMotion: false,
      }),
    ).toBe(2721);
  });

  it('paints substrate-only, incremental O(n) pass-colour sweep batches, and overlay probe-head light (§5.1)', () => {
    const lot = buildTinyWaferLot();
    const wafer = lot.wafers[0]!;
    const layout = computeWaferRenderLayout(
      wafer,
      624,
      624,
      lot.dies,
      DEFAULT_VIEWPORT_TRANSFORM,
    );
    const probeOrder = buildWaferProbeOrder(lot, 0);
    expect(probeOrder).toHaveLength(3);

    const { ctx, calls } = createRecordingCanvas();
    paintWaferSubstrateOnly(ctx, wafer, layout, 2);
    expect(calls.some((c) => c.op === 'clearRect')).toBe(true);
    expect(
      calls.some(
        (c) =>
          c.op === 'fill' &&
          c.fillStyle?.toLowerCase() === WAFER_TOKENS.discMid.toLowerCase(),
      ),
    ).toBe(true);
    expect(calls.filter((c) => c.op === 'roundRect')).toHaveLength(0);

    // Incremental batch [0..2) draws exactly 2 dies in pass colour (#63666C) even though die #2 fails in finalPass
    calls.length = 0;
    paintWaferSweepBatch(ctx, {
      lot,
      layout,
      dpr: 2,
      probeOrder,
      startOrderIndex: 0,
      endOrderIndex: 2,
    });
    const roundRects = calls.filter((c) => c.op === 'roundRect');
    expect(roundRects).toHaveLength(2);
    expect(
      calls.some(
        (c) =>
          c.op === 'fill' &&
          c.fillStyle?.toLowerCase() === COLOR_TOKENS.passDie.toLowerCase(),
      ),
    ).toBe(true);

    // Overlay draws probe-head light at probeHeadDieIndex
    const overlayRec = createRecordingCanvas();
    paintWaferOverlayLayer(overlayRec.ctx, {
      lot,
      waferIndex: 0,
      layout,
      dpr: 1,
      overlayHighlightMask: new Uint8Array(lot.dies.count),
      overlayHighlightCount: 0,
      hoveredDieIndex: null,
      brush: null,
      probeHeadDieIndex: probeOrder[1]!,
    });
    expect(
      overlayRec.calls.some(
        (c) => c.op === 'drawImage' || c.op === 'arc' || c.op === 'fill',
      ),
    ).toBe(true);
  });
});
