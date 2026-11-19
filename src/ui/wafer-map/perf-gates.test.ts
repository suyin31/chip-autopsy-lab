/**
 * Task 20 Vitest Performance Gates — Base-Layer Draw Time Budget
 * (`src/ui/wafer-map/perf-gates.test.ts`).
 *
 * Benchmarks `paintWaferBaseLayer` and `paintWaferOverlayLayer` against a
 * lightweight Canvas2D command sink on:
 * - A synthetic `10,000`-die circular wafer (Requirement 15.4: `< 5 ms` target;
 *   generous CI ceiling `<= 25 ms` for 2-core CI boxes).
 * - Bundled `edge-ring-etch` demo wafer (`633` dies).
 * - Verifies overlay redraws independently without invoking base-layer painting.
 *
 * Validates: Requirement 15.4
 */

import { describe, expect, it } from 'vitest';
import {
  type BinDefinition,
  type LotModel,
  type TestSiteMeta,
} from '@/core/model';
import { ingestDemoPreset } from '@/workers';
import {
  type Canvas2DContextLike,
  computeWaferRenderLayout,
  DEFAULT_VIEWPORT_TRANSFORM,
  paintWaferBaseLayer,
  paintWaferOverlayLayer,
} from './wafer-geometry';

function createNoopCanvas2DContext(): {
  readonly ctx: Canvas2DContextLike;
  getDrawCallCount: () => number;
  resetCounts: () => void;
} {
  let drawCalls = 0;
  const fakeGradient = {
    addColorStop: () => undefined,
  } as unknown as CanvasGradient;

  const ctx: Canvas2DContextLike = {
    fillStyle: '#000000',
    strokeStyle: '#000000',
    lineWidth: 1,
    lineJoin: 'miter',
    globalAlpha: 1,
    globalCompositeOperation: 'source-over',
    setTransform: () => undefined,
    clearRect: () => undefined,
    fillRect: () => {
      drawCalls += 1;
    },
    roundRect: () => {
      drawCalls += 1;
    },
    strokeRect: () => {
      drawCalls += 1;
    },
    beginPath: () => undefined,
    arc: () => undefined,
    moveTo: () => undefined,
    lineTo: () => undefined,
    closePath: () => undefined,
    fill: () => {
      drawCalls += 1;
    },
    stroke: () => {
      drawCalls += 1;
    },
    rect: () => {
      drawCalls += 1;
    },
    save: () => undefined,
    restore: () => undefined,
    clip: () => undefined,
    setLineDash: () => undefined,
    createRadialGradient: () => fakeGradient,
    createLinearGradient: () => fakeGradient,
    createConicGradient: () => fakeGradient,
    drawImage: () => {
      drawCalls += 1;
    },
  };

  return {
    ctx,
    getDrawCallCount: () => drawCalls,
    resetCounts: () => {
      drawCalls = 0;
    },
  };
}

function build10kDieLot(): LotModel {
  const coords: Array<{ x: number; y: number; ring: number }> = [];
  const radius = 56.5;
  for (let gy = -57; gy <= 57; gy += 1) {
    for (let gx = -57; gx <= 57; gx += 1) {
      const dist = Math.hypot(gx, gy);
      if (dist <= radius) {
        const ring = Math.max(1, Math.ceil(radius - dist + 0.5));
        coords.push({ x: gx, y: gy, ring });
      }
    }
  }
  const count = Math.min(10_000, coords.length);

  const waferIndex = new Uint16Array(count);
  const x = new Int16Array(count);
  const y = new Int16Array(count);
  const hasValidCoords = new Uint8Array(count);
  const firstSiteIndex = new Uint8Array(count);
  const siteIndex = new Uint8Array(count);
  const firstPass = new Uint8Array(count);
  const finalPass = new Uint8Array(count);
  const hbin = new Uint16Array(count);
  const sbin = new Uint16Array(count);
  const retestCount = new Uint16Array(count);
  const ringIndex = new Uint16Array(count);
  const firstPrrOrder = new Uint32Array(count);

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;

  for (let i = 0; i < count; i += 1) {
    const c = coords[i]!;
    x[i] = c.x;
    y[i] = c.y;
    if (c.x < minX) minX = c.x;
    if (c.x > maxX) maxX = c.x;
    if (c.y < minY) minY = c.y;
    if (c.y > maxY) maxY = c.y;
    hasValidCoords[i] = 1;
    const fail = c.ring <= 3 || (i % 19 === 0);
    firstPass[i] = fail ? 0 : 1;
    finalPass[i] = fail ? 0 : 1;
    hbin[i] = fail ? (c.ring <= 3 ? 4 : 2) : 1;
    sbin[i] = fail ? (c.ring <= 3 ? 7 : 5) : 1;
    ringIndex[i] = c.ring;
    firstPrrOrder[i] = i;
  }

  const sites: TestSiteMeta[] = [
    { siteIndex: 0, headNum: 1, siteNum: 1, label: '1:1' },
  ];
  const hbins = new Map<number, BinDefinition>([
    [1, { code: 1, name: 'PASS', passFail: 'P' }],
    [2, { code: 2, name: 'CONT', passFail: 'F' }],
    [4, { code: 4, name: 'LEAK', passFail: 'F' }],
  ]);
  const sbins = new Map<number, BinDefinition>([
    [1, { code: 1, name: 'GOOD', passFail: 'P' }],
    [5, { code: 5, name: 'CONT_OPEN', passFail: 'F' }],
    [7, { code: 7, name: 'IDDQ_EDGE_LEAK', passFail: 'F' }],
  ]);

  return {
    lotId: 'CAL-10K-BASE',
    partTyp: 'CAL-10K',
    jobNam: 'SORT',
    parseMode: 'bins-only',
    endianness: 'little',
    wafers: [
      {
        waferIndex: 0,
        waferId: 'W01',
        dieStartIndex: 0,
        dieEndIndex: count,
        minX,
        maxX,
        minY,
        maxY,
        maxRingIndex: 57,
        geometry: {
          wfSize: 300,
          wfUnits: 2,
          wfFlat: 'D',
          posX: 'R',
          posY: 'U',
        },
      },
    ],
    sites,
    hbins,
    sbins,
    dies: {
      count,
      waferIndex,
      x,
      y,
      hasValidCoords,
      firstSiteIndex,
      siteIndex,
      firstPass,
      finalPass,
      hbin,
      sbin,
      retestCount,
      ringIndex,
      firstPrrOrder,
    },
    dieIds: [],
    dieIndexById: new Map(),
    waferCoordIndex: [new Map()],
    tests: new Map(),
    warnings: [],
  };
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]!
    : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

describe('Task 20 Vitest performance gates — BaseCanvas draw budget (Requirement 15.4)', () => {
  it('draws a 10,000-die wafer base layer within budget across pass-fail and SBIN modes', () => {
    const lot = build10kDieLot();
    expect(lot.dies.count).toBe(10_000);

    const wafer = lot.wafers[0]!;
    const layout = computeWaferRenderLayout(
      wafer,
      640,
      640,
      lot.dies,
      DEFAULT_VIEWPORT_TRANSFORM,
      2,
    );
    const sink = createNoopCanvas2DContext();
    const emptyHidden = new Set<number>();

    const results: Record<
      string,
      { readonly medianMs: number; readonly maxMs: number; readonly calls: number }
    > = {};

    for (const colorMode of ['pass-fail', 'sbin'] as const) {
      // Warm-up passes
      for (let w = 0; w < 3; w += 1) {
        paintWaferBaseLayer(sink.ctx, {
          lot,
          waferIndex: 0,
          layout,
          dpr: 2,
          deviceDpr: 2,
          colorMode,
          activeTestNum: null,
          hiddenBins: emptyHidden,
        });
      }

      const durations: number[] = [];
      let callsPerPass = 0;
      for (let i = 0; i < 10; i += 1) {
        sink.resetCounts();
        const t0 = performance.now();
        paintWaferBaseLayer(sink.ctx, {
          lot,
          waferIndex: 0,
          layout,
          dpr: 2,
          deviceDpr: 2,
          colorMode,
          activeTestNum: null,
          hiddenBins: emptyHidden,
        });
        durations.push(performance.now() - t0);
        callsPerPass = sink.getDrawCallCount();
      }

      const medianMs = Number(median(durations).toFixed(3));
      const maxMs = Number(Math.max(...durations).toFixed(3));
      results[colorMode] = { medianMs, maxMs, calls: callsPerPass };

      expect(callsPerPass).toBeGreaterThan(1_000);
      // Generous 2-core CI cap (target < 5 ms on desktop reference hardware)
      expect(medianMs).toBeLessThan(25);
    }

    console.info(
      '[PERF_T20_BASE_DRAW_10K]',
      JSON.stringify({ dieCount: lot.dies.count, ...results }),
    );
  });

  it('draws bundled demo wafer base layer and redraws overlay highlights independently', async () => {
    const res = await ingestDemoPreset('edge-ring-etch');
    expect(res.kind).toBe('ok');
    if (res.kind !== 'ok') return;

    const wafer = res.lot.wafers[0]!;
    const layout = computeWaferRenderLayout(
      wafer,
      640,
      640,
      res.lot.dies,
      DEFAULT_VIEWPORT_TRANSFORM,
      2,
    );

    const baseSink = createNoopCanvas2DContext();
    const overlaySink = createNoopCanvas2DContext();
    const emptyHidden = new Set<number>();

    // Warm-up + measure demo base layer
    paintWaferBaseLayer(baseSink.ctx, {
      lot: res.lot,
      waferIndex: 0,
      layout,
      dpr: 2,
      deviceDpr: 2,
      colorMode: 'pass-fail',
      activeTestNum: null,
      hiddenBins: emptyHidden,
    });

    const baseRuns: number[] = [];
    for (let i = 0; i < 10; i += 1) {
      baseSink.resetCounts();
      const t0 = performance.now();
      paintWaferBaseLayer(baseSink.ctx, {
        lot: res.lot,
        waferIndex: 0,
        layout,
        dpr: 2,
        deviceDpr: 2,
        colorMode: 'pass-fail',
        activeTestNum: null,
        hiddenBins: emptyHidden,
      });
      baseRuns.push(performance.now() - t0);
    }

    const baseCallsBeforeOverlay = baseSink.getDrawCallCount();
    const highlightMask = new Uint8Array(res.lot.dies.count);
    let highlightCount = 0;
    for (const idx of res.report.causeOfDeathHeadline.resolvedDieIndices) {
      if (highlightMask[idx] === 0) {
        highlightMask[idx] = 1;
        highlightCount += 1;
      }
    }

    const tOverlay0 = performance.now();
    paintWaferOverlayLayer(overlaySink.ctx, {
      lot: res.lot,
      waferIndex: 0,
      layout,
      dpr: 2,
      overlayHighlightMask: highlightMask,
      overlayHighlightCount: highlightCount,
      hoveredDieIndex: wafer.dieStartIndex,
      pinnedDieIndex: null,
      brush: null,
    });
    const overlayMs = Number((performance.now() - tOverlay0).toFixed(3));

    // Base layer untouched while overlay repainted
    expect(baseSink.getDrawCallCount()).toBe(baseCallsBeforeOverlay);
    expect(overlaySink.getDrawCallCount()).toBeGreaterThan(0);

    const demoBaseMedianMs = Number(median(baseRuns).toFixed(3));
    console.info(
      '[PERF_T20_BASE_DRAW_DEMO]',
      JSON.stringify({
        dieCount: wafer.dieEndIndex - wafer.dieStartIndex,
        baseMedianMs: demoBaseMedianMs,
        overlayMs,
      }),
    );

    expect(demoBaseMedianMs).toBeLessThan(10);
    expect(overlayMs).toBeLessThan(10);
  });
});
