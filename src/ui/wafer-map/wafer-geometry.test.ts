import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  buildLotModel,
  type LotModel,
  STDF_MISSING_COORD,
  type WaferGeometry,
} from '@/core/model';
import { parseStdfBytes, type StdfWriteLotSpec, writeStdfBytes } from '@/core/stdf';
import { deriveSelectionMasks } from '@/ui/state';
import { COLOR_TOKENS, SECONDARY_FAIL_BIN_PALETTE } from '@/ui/tokens';
import { ingestDemoPreset } from '@/workers';
import { WaferMapCanvas } from './WaferMapCanvas';
import {
  buildFailBinRankMap,
  type Canvas2DContextLike,
  computeParametricRange,
  computeWaferNotchGeometry,
  computeWaferRenderLayout,
  dieCoordToCanvasRect,
  FAIL_MICRO_DOT_MIN_PITCH_PX,
  hitTestWaferDie,
  OVERLAY_HALO_STROKE,
  paintWaferBaseLayer,
  paintWaferOverlayLayer,
  paintWaferThumbnail,
  resolveCanvasPixelSize,
  resolveDieFillColor,
  resolvePassFailDieColor,
  shouldDrawFailMicroDot,
  WAFER_STREET_WIDTH_PX,
} from './wafer-geometry';

function buildWaferTestLot(wcr?: Partial<WaferGeometry>): LotModel {
  const spec: StdfWriteLotSpec = {
    endianness: 'little',
    mir: { lotId: 'LOT-WM-01', partTyp: 'CAL-WM', jobNam: 'SORT' },
    hbrs: [
      { headNum: 255, siteNum: 0, hbinNum: 1, hbinCnt: 2, hbinPf: 'P', hbinNam: 'PASS' },
      { headNum: 255, siteNum: 0, hbinNum: 2, hbinCnt: 2, hbinPf: 'F', hbinNam: 'CONT' },
      { headNum: 255, siteNum: 0, hbinNum: 4, hbinCnt: 1, hbinPf: 'F', hbinNam: 'LEAK' },
    ],
    sbrs: [
      { headNum: 255, siteNum: 0, sbinNum: 1, sbinCnt: 2, sbinPf: 'P', sbinNam: 'GOOD' },
      { headNum: 255, siteNum: 0, sbinNum: 5, sbinCnt: 2, sbinPf: 'F', sbinNam: 'CONT_OPEN' },
      { headNum: 255, siteNum: 0, sbinNum: 7, sbinCnt: 1, sbinPf: 'F', sbinNam: 'IDDQ_LEAK' },
    ],
    sdrs: [{ headNum: 1, siteGrp: 1, siteNums: [1, 2] }],
    wcr: {
      wfFlat: wcr?.wfFlat ?? 'D',
      posX: wcr?.posX ?? 'R',
      posY: wcr?.posY ?? 'U',
    },
    wafers: [
      {
        wir: { headNum: 1, waferId: 'W01' },
        touchdowns: [
          [
            // Die 0: (-1, -1) pass Site 1
            {
              headNum: 1,
              siteNum: 1,
              partFlg: 0x00,
              hardBin: 1,
              softBin: 1,
              xCoord: -1,
              yCoord: -1,
              ptrs: [
                {
                  testNum: 101,
                  result: 1.0,
                  testTxt: 'VDD',
                  units: 'V',
                  resScal: 0,
                  llmScal: 0,
                  hlmScal: 0,
                  loLimit: 0.5,
                  hiLimit: 1.5,
                },
              ],
            },
            // Die 1: (0, -1) fail SBIN 5 / HBIN 2 Site 2
            {
              headNum: 1,
              siteNum: 2,
              partFlg: 0x08,
              hardBin: 2,
              softBin: 5,
              xCoord: 0,
              yCoord: -1,
              ptrs: [{ testNum: 101, result: 2.0 }],
            },
          ],
          [
            // Die 2: (1, 1) pass Site 1
            {
              headNum: 1,
              siteNum: 1,
              partFlg: 0x00,
              hardBin: 1,
              softBin: 1,
              xCoord: 1,
              yCoord: 1,
              ptrs: [{ testNum: 101, result: 1.2 }],
            },
            // Die 3: (0, 1) fail SBIN 5 / HBIN 2 Site 2
            {
              headNum: 1,
              siteNum: 2,
              partFlg: 0x08,
              hardBin: 2,
              softBin: 5,
              xCoord: 0,
              yCoord: 1,
              ptrs: [{ testNum: 101, result: 2.5 }],
            },
          ],
          [
            // Die 4: (0, 0) fail SBIN 7 / HBIN 4 Site 1
            {
              headNum: 1,
              siteNum: 1,
              partFlg: 0x08,
              hardBin: 4,
              softBin: 7,
              xCoord: 0,
              yCoord: 0,
              ptrs: [{ testNum: 101, result: 3.0 }],
            },
            // Die 5: missing coordinate (-32768, -32768) fail SBIN 5 Site 2
            {
              headNum: 1,
              siteNum: 2,
              partFlg: 0x08,
              hardBin: 2,
              softBin: 5,
              xCoord: STDF_MISSING_COORD,
              yCoord: STDF_MISSING_COORD,
            },
          ],
        ],
      },
    ],
  };

  const parsed = parseStdfBytes(writeStdfBytes(spec), { mode: 'full' });
  if (!parsed.ok) {
    throw new Error(`Unexpected parse failure: ${parsed.error.message}`);
  }
  return buildLotModel(parsed.value);
}

interface RecordedFillRect {
  readonly fillStyle: string;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

interface RecordedStroke {
  readonly strokeStyle: string;
  readonly lineWidth: number;
}

function createMockCanvas2DContext(): {
  readonly ctx: Canvas2DContextLike;
  readonly fillRects: RecordedFillRect[];
  readonly strokes: RecordedStroke[];
  readonly strokeRects: RecordedStroke[];
  readonly rectCalls: number[];
  clearCounts: () => void;
  getDrawPassCount: () => number;
} {
  const fillRects: RecordedFillRect[] = [];
  const strokes: RecordedStroke[] = [];
  const strokeRects: RecordedStroke[] = [];
  const rectCalls: number[] = [];
  let clearCount = 0;

  const ctx: Canvas2DContextLike = {
    fillStyle: '#000000',
    strokeStyle: '#000000',
    lineWidth: 1,
    lineJoin: 'miter',
    setTransform: () => undefined,
    clearRect: () => {
      clearCount += 1;
    },
    fillRect(x, y, w, h) {
      fillRects.push({
        fillStyle: String(this.fillStyle),
        x,
        y,
        w,
        h,
      });
    },
    strokeRect() {
      strokeRects.push({
        strokeStyle: String(this.strokeStyle),
        lineWidth: this.lineWidth,
      });
    },
    beginPath: () => undefined,
    arc: () => undefined,
    moveTo: () => undefined,
    lineTo: () => undefined,
    closePath: () => undefined,
    fill: () => undefined,
    stroke() {
      strokes.push({
        strokeStyle: String(this.strokeStyle),
        lineWidth: this.lineWidth,
      });
    },
    rect(x) {
      rectCalls.push(x);
    },
    setLineDash: () => undefined,
  };

  return {
    ctx,
    fillRects,
    strokes,
    strokeRects,
    rectCalls,
    clearCounts: () => {
      fillRects.length = 0;
      strokes.length = 0;
      strokeRects.length = 0;
      rectCalls.length = 0;
      clearCount = 0;
    },
    getDrawPassCount: () => clearCount,
  };
}

describe('Wafer Map pure geometry, color mapping, and two-layer canvas isolation (Sub-task 5.2)', () => {
  it('scales backing pixel dimensions by DPR and clamps invalid values safely', () => {
    expect(resolveCanvasPixelSize(500, 500, 2)).toEqual({
      cssWidth: 500,
      cssHeight: 500,
      dpr: 2,
      pixelWidth: 1000,
      pixelHeight: 1000,
    });
    expect(resolveCanvasPixelSize(500, 500, 8).dpr).toBe(4);
    expect(resolveCanvasPixelSize(0, -10, Number.NaN)).toEqual({
      cssWidth: 1,
      cssHeight: 1,
      dpr: 1,
      pixelWidth: 1,
      pixelHeight: 1,
    });
  });

  it('maintains 1 px streets, keeps all valid die corners inside waferRadiusPx, and gates fail micro-dots at diePitchPx >= 7', () => {
    const lot = buildWaferTestLot();
    const wafer = lot.wafers[0];
    const layout = computeWaferRenderLayout(wafer, 500, 500, lot.dies);

    expect(layout.streetPx).toBe(WAFER_STREET_WIDTH_PX);
    expect(layout.diePitchPx).toBeGreaterThanOrEqual(FAIL_MICRO_DOT_MIN_PITCH_PX);
    expect(layout.drawFailMicroDot).toBe(true);
    expect(shouldDrawFailMicroDot(6.99)).toBe(false);
    expect(shouldDrawFailMicroDot(7.0)).toBe(true);

    const rLeft = dieCoordToCanvasRect(0, 0, layout);
    const rRight = dieCoordToCanvasRect(1, 0, layout);
    const horizontalStreet = rRight.x - (rLeft.x + rLeft.width);
    expect(horizontalStreet).toBeCloseTo(1, 6);

    // Every valid die's 4 corners lie strictly inside waferRadiusPx
    for (let i = wafer.dieStartIndex; i < wafer.dieEndIndex; i += 1) {
      if (lot.dies.hasValidCoords[i] === 0) continue;
      const rect = dieCoordToCanvasRect(lot.dies.x[i], lot.dies.y[i], layout);
      const corners = [
        [rect.x, rect.y],
        [rect.x + rect.width, rect.y],
        [rect.x, rect.y + rect.height],
        [rect.x + rect.width, rect.y + rect.height],
      ] as const;
      for (const [cx, cy] of corners) {
        const dist = Math.hypot(cx - layout.centerXCss, cy - layout.centerYCss);
        expect(dist).toBeLessThan(layout.waferRadiusPx);
      }
    }
  });

  it('round-trips O(1) pointer hit-testing across all four WCR (POS_X, POS_Y) orientations', () => {
    const orientations: ReadonlyArray<{
      readonly posX: 'L' | 'R';
      readonly posY: 'U' | 'D';
    }> = [
      { posX: 'R', posY: 'U' },
      { posX: 'L', posY: 'U' },
      { posX: 'R', posY: 'D' },
      { posX: 'L', posY: 'D' },
    ];

    for (const orient of orientations) {
      const lot = buildWaferTestLot(orient);
      const wafer = lot.wafers[0];
      const layout = computeWaferRenderLayout(wafer, 480, 480, lot.dies);
      const coordMap = lot.waferCoordIndex[0];

      for (let i = wafer.dieStartIndex; i < wafer.dieEndIndex; i += 1) {
        if (lot.dies.hasValidCoords[i] === 0) {
          continue;
        }
        const rect = dieCoordToCanvasRect(lot.dies.x[i], lot.dies.y[i], layout);
        const hit = hitTestWaferDie(rect.centerX, rect.centerY, layout, coordMap);
        expect(hit).toBe(i);
      }

      // Empty corner far outside wafer grid resolves to null
      expect(hitTestWaferDie(2, 2, layout, coordMap)).toBeNull();
    }
  });

  it('computes inward wafer orientation V-notch geometry for D, U, L, R, and blank WF_FLAT', () => {
    const down = computeWaferNotchGeometry(250, 250, 200, 'D');
    expect(down.apexX).toBeCloseTo(250, 6);
    expect(down.apexY).toBeGreaterThan(250);
    expect(down.apexY).toBeLessThan(450);

    const up = computeWaferNotchGeometry(250, 250, 200, 'U');
    expect(up.apexY).toBeLessThan(250);

    const left = computeWaferNotchGeometry(250, 250, 200, 'L');
    expect(left.apexX).toBeLessThan(250);

    const right = computeWaferNotchGeometry(250, 250, 200, 'R');
    expect(right.apexX).toBeGreaterThan(250);

    const fallback = computeWaferNotchGeometry(250, 250, 200, ' ');
    expect(fallback.notchAngleRad).toBeCloseTo(Math.PI / 2, 6);
  });

  it('maps Pass/Fail, dominant/secondary categorical fail bins, and parametric magma colors deterministically', () => {
    const lot = buildWaferTestLot();
    expect(resolvePassFailDieColor(1)).toBe('#63666C');
    expect(resolvePassFailDieColor(0)).toBe('#FF6B2C');

    // SBIN 5 has 3 total fails (dies 1, 3, 5) -> rank 0 (#FF6B2C); SBIN 7 has 1 fail (die 4) -> rank 1 (#00ACEA)
    const sbinRanks = buildFailBinRankMap(lot.dies, 'SBIN');
    expect(sbinRanks.get(5)).toBe(0);
    expect(sbinRanks.get(7)).toBe(1);

    expect(resolveDieFillColor(0, lot.dies, 'sbin', sbinRanks)).toBe(
      COLOR_TOKENS.passDie,
    );
    expect(resolveDieFillColor(1, lot.dies, 'sbin', sbinRanks)).toBe(
      COLOR_TOKENS.failure,
    );
    expect(resolveDieFillColor(4, lot.dies, 'sbin', sbinRanks)).toBe(
      SECONDARY_FAIL_BIN_PALETTE[0],
    );

    const testCol = lot.tests.get(101);
    const range = computeParametricRange(testCol);
    expect(range).not.toBeNull();
    const lowHex = resolveDieFillColor(
      0,
      lot.dies,
      'parametric',
      undefined,
      testCol,
      range,
    );
    const highHex = resolveDieFillColor(
      4,
      lot.dies,
      'parametric',
      undefined,
      testCol,
      range,
    );
    expect(lowHex).toMatch(/^#[0-9A-F]{6}$/);
    expect(highHex).toMatch(/^#[0-9A-F]{6}$/);
    expect(lowHex).not.toBe(highHex);
  });

  it('draws Pass/Fail fills + micro-dots on BaseCanvas and redraws #D6E6FF glow/outlines solely on OverlayCanvas without base repaints', () => {
    const lot = buildWaferTestLot();
    const wafer = lot.wafers[0];
    const layout = computeWaferRenderLayout(wafer, 500, 500, lot.dies);

    const baseMock = createMockCanvas2DContext();
    const overlayMock = createMockCanvas2DContext();

    paintWaferBaseLayer(baseMock.ctx, {
      lot,
      waferIndex: 0,
      layout,
      dpr: 2,
      colorMode: 'pass-fail',
      activeTestNum: null,
      hiddenBins: new Set(),
    });

    expect(baseMock.getDrawPassCount()).toBe(1);

    // 5 valid coordinate dies: 2 passing (#63666C), 3 failing (#FF6B2C) + 3 micro-dots (#000000); die 5 (-32768) excluded
    const passFills = baseMock.fillRects.filter(
      (r) => r.fillStyle === COLOR_TOKENS.passDie,
    );
    const failFills = baseMock.fillRects.filter(
      (r) => r.fillStyle === COLOR_TOKENS.failure,
    );
    const microDotFills = baseMock.fillRects.filter(
      (r) => r.fillStyle === COLOR_TOKENS.waferStreet,
    );
    expect(passFills).toHaveLength(2);
    expect(failFills).toHaveLength(3);
    expect(microDotFills).toHaveLength(3);

    // Clicking Site 2 row (siteFilter = 1 -> valid dies 1 and 3 on W01, plus missing-coord die 5)
    const site2Masks = deriveSelectionMasks(lot, {
      brush: null,
      binFilter: null,
      siteFilter: 1,
      dslFilter: null,
      claimHighlight: null,
    });

    paintWaferOverlayLayer(overlayMock.ctx, {
      lot,
      waferIndex: 0,
      layout,
      dpr: 2,
      overlayHighlightMask: site2Masks.overlayHighlightMask,
      overlayHighlightCount: site2Masks.overlayHighlightCount,
      hoveredDieIndex: 0,
      brush: null,
    });

    // BaseCanvas was NOT repainted (still 1 pass), while OverlayCanvas drew 2 highlighted site-2 rects via stroke (zero fills!) + 1 hover reticle
    expect(baseMock.getDrawPassCount()).toBe(1);
    expect(overlayMock.getDrawPassCount()).toBe(1);
    expect(overlayMock.fillRects).toHaveLength(0);
    expect(overlayMock.rectCalls).toHaveLength(2);
    expect(
      overlayMock.strokes.map((s) => s.strokeStyle),
    ).toEqual([OVERLAY_HALO_STROKE, COLOR_TOKENS.accent]);
    expect(overlayMock.strokeRects).toHaveLength(1);
  });

  it('paints compact Pass/Fail wafer thumbnails using locked tokens and skipping missing-coord dies (review-5 I-2)', () => {
    const lot = buildWaferTestLot();
    const wafer = lot.wafers[0];
    const thumbMock = createMockCanvas2DContext();

    paintWaferThumbnail(thumbMock.ctx, {
      wafer,
      dies: lot.dies,
      cssSize: 36,
      dpr: 2,
    });

    expect(thumbMock.getDrawPassCount()).toBe(1);
    const passFills = thumbMock.fillRects.filter(
      (r) => r.fillStyle === COLOR_TOKENS.passDie,
    );
    const failFills = thumbMock.fillRects.filter(
      (r) => r.fillStyle === COLOR_TOKENS.failure,
    );
    // 2 valid passing dies (#63666C) and 3 valid failing dies (#FF6B2C); missing-coord die 5 excluded
    expect(passFills).toHaveLength(2);
    expect(failFills).toHaveLength(3);

    // Tightened hero wafer padding fills >= 94% of the square stage diameter (review-5 I-1)
    const heroLayout = computeWaferRenderLayout(wafer, 520, 520, lot.dies);
    expect((heroLayout.waferRadiusPx * 2) / 520).toBeGreaterThanOrEqual(0.94);
  });

  it('renders 25-wafer horizontal thumbnail lot strip with radiogroup semantics and explicit canvas CSS sizes (review-5 C-1, F-1, F-2, I-2)', async () => {
    const res = await ingestDemoPreset('edge-ring-etch');
    expect(res.kind).toBe('ok');
    if (res.kind !== 'ok') return;

    const html = renderToStaticMarkup(
      React.createElement(WaferMapCanvas, {
        lot: res.lot,
        byWaferYield: res.yieldSummary.byWafer,
      }),
    );

    expect(html).toContain('data-testid="wafer-base-canvas"');
    expect(html).toContain('data-testid="wafer-overlay-canvas"');
    expect(html).toContain('style="width:520px;height:520px"');
    expect(html).toContain('aria-roledescription="interactive wafer map"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('role="radiogroup"');
    expect(html.match(/role="radio"/g)).toHaveLength(25);
    expect(html.match(/data-testid="wafer-lot-strip-thumb"/g)).toHaveLength(25);
    expect(html).toContain('style="width:36px;height:36px"');
    expect(html).toContain('style="width:40px;height:40px"');
    expect(html).toContain('border-accent');
    expect(html).toContain('W01');
    expect(html).toContain('W25');
    expect(html).toContain('tabindex="0"');
    expect(html.match(/tabindex="-1"/g)).toHaveLength(24);
  });
});
