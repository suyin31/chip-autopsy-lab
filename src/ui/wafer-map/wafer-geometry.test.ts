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
import { I18nProvider } from '@/ui/i18n';
import { deriveSelectionMasks } from '@/ui/state';
import {
  COLOR_TOKENS,
  SECONDARY_FAIL_BIN_PALETTE,
  WAFER_TOKENS,
} from '@/ui/tokens';
import { ingestDemoPreset } from '@/workers';
import { WaferMapCanvas } from './WaferMapCanvas';
import {
  buildFailBinRankMap,
  type Canvas2DContextLike,
  computeParametricRange,
  computeWaferExclusionRadiusPx,
  computeWaferNotchGeometry,
  computeWaferRenderLayout,
  dieCoordToCanvasRect,
  FAIL_DIE_RADIUS_PX,
  hitTestWaferDie,
  MAX_SUPERSAMPLED_CANVAS_PX,
  OVERLAY_HALO_STROKE,
  paintWaferBaseLayer,
  paintWaferDiscMaterial,
  paintWaferFailLayer,
  paintWaferOverlayLayer,
  paintWaferThumbnail,
  PASS_DIE_CELL_FRACTION,
  PASS_DIE_RADIUS_PX,
  resolveCanvasPixelSize,
  resolveDieFillColor,
  resolvePassFailDieColor,
  resolveSupersampledCanvasSize,
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

interface RecordedDieShape {
  readonly fillStyle: string;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly radius: number;
}

interface RecordedStroke {
  readonly strokeStyle: string;
  readonly lineWidth: number;
}

function createMockCanvas2DContext(): {
  readonly ctx: Canvas2DContextLike;
  readonly dieShapes: RecordedDieShape[];
  readonly pathFills: string[];
  readonly strokes: RecordedStroke[];
  readonly strokeRects: RecordedStroke[];
  readonly rectCalls: number[];
  clearCounts: () => void;
  getDrawPassCount: () => number;
} {
  const dieShapes: RecordedDieShape[] = [];
  const pathFills: string[] = [];
  const strokes: RecordedStroke[] = [];
  const strokeRects: RecordedStroke[] = [];
  const rectCalls: number[] = [];
  let clearCount = 0;
  let pendingRoundRects: Array<{ x: number; y: number; w: number; h: number; r: number }> = [];

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
      dieShapes.push({
        fillStyle: String(this.fillStyle),
        x,
        y,
        w,
        h,
        radius: 0,
      });
    },
    roundRect(x, y, w, h, radii) {
      const r = typeof radii === 'number' ? radii : 0;
      pendingRoundRects.push({ x, y, w, h, r });
    },
    strokeRect() {
      strokeRects.push({
        strokeStyle: String(this.strokeStyle),
        lineWidth: this.lineWidth,
      });
    },
    beginPath: () => {
      pendingRoundRects = [];
    },
    arc: () => undefined,
    moveTo: () => undefined,
    lineTo: () => undefined,
    closePath: () => undefined,
    fill() {
      const style = String(this.fillStyle);
      if (pendingRoundRects.length > 0) {
        for (const rr of pendingRoundRects) {
          dieShapes.push({
            fillStyle: style,
            x: rr.x,
            y: rr.y,
            w: rr.w,
            h: rr.h,
            radius: rr.r,
          });
        }
        pendingRoundRects = [];
      } else {
        pathFills.push(style);
      }
    },
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
    dieShapes,
    pathFills,
    strokes,
    strokeRects,
    rectCalls,
    clearCounts: () => {
      dieShapes.length = 0;
      pathFills.length = 0;
      strokes.length = 0;
      strokeRects.length = 0;
      rectCalls.length = 0;
      pendingRoundRects = [];
      clearCount = 0;
    },
    getDrawPassCount: () => clearCount,
  };
}

describe('Wafer Stage geometry, §2.1 pass/fail non-color geometry cue, and three-canvas isolation (Task R6)', () => {
  it('scales backing pixel dimensions by DPR and supersamples base canvas by 2x capped at 4096 px (§4.7)', () => {
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

    // Supersampled 2x DPR at 783 x 720 with DPR 2 -> 3132 x 2880 (<= 4096)
    const super2x = resolveSupersampledCanvasSize(783, 720, 2);
    expect(super2x.pixelWidth).toBe(783 * 4);
    expect(super2x.pixelHeight).toBe(720 * 4);
    expect(super2x.dpr).toBeCloseTo(4, 6);

    // Supersampled 2x DPR at 783 x 720 with DPR 3 -> capped at 4096 on longest side
    const superCapped = resolveSupersampledCanvasSize(783, 720, 3);
    expect(superCapped.pixelWidth).toBe(MAX_SUPERSAMPLED_CANVAS_PX);
    expect(superCapped.pixelHeight).toBeLessThanOrEqual(MAX_SUPERSAMPLED_CANVAS_PX);
  });

  it('hits §3.4 wafer diameters (624 px at 783x720 desktop, 350 px at 390x390 mobile) and keeps 1 px streets', () => {
    const lot = buildWaferTestLot();
    const wafer = lot.wafers[0]!;

    const desktopLayout = computeWaferRenderLayout(wafer, 783, 720, lot.dies);
    expect(desktopLayout.waferRadiusPx * 2).toBe(624);
    expect(desktopLayout.waferRadiusPx * 2).toBeGreaterThanOrEqual(560);

    const mobileLayout = computeWaferRenderLayout(wafer, 390, 390, lot.dies);
    expect(mobileLayout.waferRadiusPx * 2).toBe(350);

    expect(desktopLayout.streetPx).toBe(WAFER_STREET_WIDTH_PX);
    const rLeft = dieCoordToCanvasRect(0, 0, desktopLayout);
    const rRight = dieCoordToCanvasRect(1, 0, desktopLayout);
    const horizontalStreet = rRight.x - (rLeft.x + rLeft.width);
    expect(horizontalStreet).toBeCloseTo(1, 6);

    // Every valid die's 4 corners lie strictly inside waferRadiusPx
    for (let i = wafer.dieStartIndex; i < wafer.dieEndIndex; i += 1) {
      if (lot.dies.hasValidCoords[i] === 0) continue;
      const rect = dieCoordToCanvasRect(lot.dies.x[i]!, lot.dies.y[i]!, desktopLayout);
      const corners = [
        [rect.x, rect.y],
        [rect.x + rect.width, rect.y],
        [rect.x, rect.y + rect.height],
        [rect.x + rect.width, rect.y + rect.height],
      ] as const;
      for (const [cx, cy] of corners) {
        const dist = Math.hypot(
          cx - desktopLayout.centerXCss,
          cy - desktopLayout.centerYCss,
        );
        expect(dist).toBeLessThan(desktopLayout.waferRadiusPx);
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
      const wafer = lot.wafers[0]!;
      const layout = computeWaferRenderLayout(wafer, 480, 480, lot.dies);
      const coordMap = lot.waferCoordIndex[0];

      for (let i = wafer.dieStartIndex; i < wafer.dieEndIndex; i += 1) {
        if (lot.dies.hasValidCoords[i] === 0) {
          continue;
        }
        const rect = dieCoordToCanvasRect(lot.dies.x[i]!, lot.dies.y[i]!, layout);
        const hit = hitTestWaferDie(rect.centerX, rect.centerY, layout, coordMap);
        expect(hit).toBe(i);
      }

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

  it('paints the premium §5.2 disc material, 72% 1px-radius pass squares vs full-cell 1.5px-radius fail dies (§2.1), FailCanvas layer, and isolated OverlayCanvas', () => {
    const lot = buildWaferTestLot();
    const wafer = lot.wafers[0]!;
    const layout = computeWaferRenderLayout(wafer, 783, 720, lot.dies);

    const baseMock = createMockCanvas2DContext();
    const failMock = createMockCanvas2DContext();
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
    // Without gradient support the body falls back to `disc-mid` and the bevel to `bevel-bottom`
    expect(baseMock.pathFills).toContain(WAFER_TOKENS.discMid);
    expect(baseMock.strokes.map((s) => s.strokeStyle)).toEqual([
      WAFER_TOKENS.exclusionLine,
      WAFER_TOKENS.bevelBottom,
      WAFER_TOKENS.bevelInner,
    ]);

    const passFills = baseMock.dieShapes.filter(
      (r) => r.fillStyle === COLOR_TOKENS.passDie,
    );
    const failFills = baseMock.dieShapes.filter(
      (r) => r.fillStyle === COLOR_TOKENS.failure,
    );
    expect(passFills).toHaveLength(2);
    expect(failFills).toHaveLength(3);

    // §2.1 non-color geometry cue: pass dies are 72% squares with 1 px radius; fail dies fill cell minus 1 px street with 1.5 px radius
    expect(passFills[0]!.w).toBeCloseTo(
      layout.diePitchPx * PASS_DIE_CELL_FRACTION,
      4,
    );
    expect(passFills[0]!.radius).toBeCloseTo(PASS_DIE_RADIUS_PX, 4);
    expect(failFills[0]!.w).toBeCloseTo(layout.dieSizePx, 4);
    expect(failFills[0]!.radius).toBeCloseTo(FAIL_DIE_RADIUS_PX, 4);
    expect(failFills[0]!.w).toBeGreaterThan(passFills[0]!.w);

    // Fail layer draws only failing dies
    paintWaferFailLayer(failMock.ctx, {
      lot,
      waferIndex: 0,
      layout,
      dpr: 2,
      colorMode: 'pass-fail',
      hiddenBins: new Set(),
    });
    expect(failMock.dieShapes).toHaveLength(3);
    expect(
      failMock.dieShapes.every((r) => r.fillStyle === COLOR_TOKENS.failure),
    ).toBe(true);

    // Overlay layer highlights Site 2 dies without repainting BaseCanvas
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

    expect(baseMock.getDrawPassCount()).toBe(1);
    expect(overlayMock.getDrawPassCount()).toBe(1);
    expect(overlayMock.dieShapes).toHaveLength(0);
    expect(overlayMock.rectCalls).toHaveLength(2);
    expect(overlayMock.strokes.map((s) => s.strokeStyle)).toContain(
      OVERLAY_HALO_STROKE,
    );
    expect(overlayMock.strokes.map((s) => s.strokeStyle)).toContain(
      COLOR_TOKENS.accent,
    );
    expect(overlayMock.strokeRects).toHaveLength(1);
  });

  it('paints compact Pass/Fail wafer thumbnails using locked tokens and skipping missing-coord dies', () => {
    const lot = buildWaferTestLot();
    const wafer = lot.wafers[0]!;
    const thumbMock = createMockCanvas2DContext();

    paintWaferThumbnail(thumbMock.ctx, {
      wafer,
      dies: lot.dies,
      cssSize: 36,
      dpr: 2,
    });

    expect(thumbMock.getDrawPassCount()).toBe(1);
    const passFills = thumbMock.dieShapes.filter(
      (r) => r.fillStyle === COLOR_TOKENS.passDie,
    );
    const failFills = thumbMock.dieShapes.filter(
      (r) => r.fillStyle === COLOR_TOKENS.failure,
    );
    expect(passFills).toHaveLength(2);
    expect(failFills).toHaveLength(3);
  });

  it('renders boxless stage with vignette, top light, three canvases, HUD segmented control, legend, and strip (§3.4, §4.7)', async () => {
    const res = await ingestDemoPreset('edge-ring-etch');
    expect(res.kind).toBe('ok');
    if (res.kind !== 'ok') return;

    const html = renderToStaticMarkup(
      React.createElement(
        I18nProvider,
        { initialLocale: 'en' },
        React.createElement(WaferMapCanvas, {
          lot: res.lot,
          byWaferYield: res.yieldSummary.byWafer,
        }),
      ),
    );

    expect(html).toContain('role="application"');
    expect(html).toContain('aria-roledescription="wafer map"');
    expect(html).toContain('data-testid="wafer-stage-vignette"');
    expect(html).toContain('data-testid="wafer-stage-top-light"');
    expect(html).toContain('data-testid="wafer-camera-wrapper"');
    expect(html).toContain('data-testid="wafer-base-canvas"');
    expect(html).toContain('data-testid="wafer-fail-canvas"');
    expect(html).toContain('data-testid="wafer-overlay-canvas"');
    expect(html).toContain('data-testid="stage-mode-segmented"');
    expect(html).toContain('Pass/Fail');
    expect(html).toContain('HBIN');
    expect(html).toContain('SBIN');
    expect(html).toContain('Pass 523');
    expect(html).toContain('Fail 110');
    expect(html.match(/data-testid="wafer-lot-strip-thumb"/g)).toHaveLength(25);
    expect(html).toContain('Failing dies on wafer W01');
    // visual-acceptance (d), (e), (f) + §5.10 data-sweep attribute
    expect(html).toContain('data-sweep=');
    expect(html).toContain('h-[456px]');
    expect(html).toContain('wafer-strip-mask');
    expect(html).not.toContain('hidden text-text-tertiary md:inline');
  });
});

describe('Premium P5 — disc material (premium §5.2 steps 1-5)', () => {
  it('sizes the WF_FLAT notch at 0.030 D opening, 0.016 D depth, and 0.002 D apex radius', () => {
    const r = 300;
    const d = r * 2;
    for (const flat of ['D', 'U', 'L', 'R', ' '] as const) {
      const notch = computeWaferNotchGeometry(400, 400, r, flat);
      expect(Math.hypot(notch.apexX - 400, notch.apexY - 400)).toBeCloseTo(
        r - 0.016 * d,
        6,
      );
      expect(
        Math.hypot(
          notch.shoulderStartX - notch.shoulderEndX,
          notch.shoulderStartY - notch.shoulderEndY,
        ),
      ).toBeCloseTo(0.03 * d, 6);
      expect(notch.apexRoundRadiusPx).toBeCloseTo(0.002 * d, 6);
    }
    expect(computeWaferNotchGeometry(400, 400, r, ' ').apexY).toBeGreaterThan(
      400,
    );
  });

  it('paints body gradient, screen thin film, exclusion line, and bevel strokes clipped to the outline', () => {
    const ops: string[] = [];
    const gradients: Array<{
      kind: string;
      args: number[];
      stops: Array<[number, string]>;
    }> = [];
    const makeGradient = (kind: string, args: number[]): CanvasGradient => {
      const entry = { kind, args, stops: [] as Array<[number, string]> };
      gradients.push(entry);
      return {
        addColorStop(offset: number, color: string) {
          entry.stops.push([offset, color]);
        },
      } as CanvasGradient;
    };
    const strokes: Array<{ style: unknown; width: number; op: string }> = [];
    const fills: Array<{ style: unknown; op: string }> = [];
    const ctx: Canvas2DContextLike = {
      fillStyle: '#000000',
      strokeStyle: '#000000',
      lineWidth: 1,
      lineJoin: 'miter',
      globalCompositeOperation: 'source-over',
      setTransform: () => undefined,
      clearRect: () => undefined,
      fillRect: () => undefined,
      strokeRect: () => undefined,
      beginPath: () => ops.push('beginPath'),
      arc: () => ops.push('arc'),
      arcTo: () => ops.push('arcTo'),
      moveTo: () => undefined,
      lineTo: () => ops.push('lineTo'),
      closePath: () => ops.push('closePath'),
      fill() {
        ops.push('fill');
        fills.push({
          style: this.fillStyle,
          op: String(this.globalCompositeOperation),
        });
      },
      stroke() {
        ops.push('stroke');
        strokes.push({
          style: this.strokeStyle,
          width: this.lineWidth,
          op: String(this.globalCompositeOperation),
        });
      },
      rect: () => undefined,
      setLineDash: () => undefined,
      save: () => ops.push('save'),
      restore: () => ops.push('restore'),
      clip: () => ops.push('clip'),
      createRadialGradient: (...args: number[]) => makeGradient('radial', args),
      createLinearGradient: (...args: number[]) => makeGradient('linear', args),
      createConicGradient: (...args: number[]) => makeGradient('conic', args),
    };

    paintWaferDiscMaterial(ctx, {
      centerXCss: 360,
      centerYCss: 360,
      waferRadiusPx: 300,
      wfFlat: 'D',
      devicePixelCss: 0.5,
    });

    const [radial, conic, linear] = gradients;
    expect(radial?.kind).toBe('radial');
    expect(radial?.args).toEqual([288, 240, 0, 288, 240, 468]);
    expect(radial?.stops).toEqual([
      [0, WAFER_TOKENS.discHi],
      [0.55, WAFER_TOKENS.discMid],
      [1, WAFER_TOKENS.discLo],
    ]);
    expect(conic?.kind).toBe('conic');
    expect(conic?.args[0]).toBeCloseTo((200 * Math.PI) / 180, 9);
    expect(conic?.stops.map((s) => s[0])).toEqual([0, 0.25, 0.5, 0.75, 1]);
    expect(conic?.stops[4]?.[1]).toBe(WAFER_TOKENS.film[0]);
    expect(linear?.args).toEqual([360, 60, 360, 660]);
    expect(linear?.stops).toEqual([
      [0, WAFER_TOKENS.bevelTop],
      [1, WAFER_TOKENS.bevelBottom],
    ]);

    expect(fills.map((f) => f.op)).toEqual(['source-over', 'screen']);
    expect(ctx.globalCompositeOperation).toBe('source-over');
    expect(strokes.map((s) => s.width)).toEqual([0.5, 1.5, 0.5]);
    expect(strokes[0]?.style).toBe(WAFER_TOKENS.exclusionLine);
    expect(typeof strokes[1]?.style).toBe('object');
    expect(strokes[2]?.style).toBe(WAFER_TOKENS.bevelInner);
    expect(ops.indexOf('arcTo')).toBeGreaterThan(-1);
    expect(ops[0]).toBe('save');
    expect(ops.indexOf('clip')).toBe(ops.indexOf('fill') + 1);
    expect(ops.at(-1)).toBe('restore');

    // Without createConicGradient the thin film is skipped
    gradients.length = 0;
    fills.length = 0;
    paintWaferDiscMaterial(
      { ...ctx, createConicGradient: undefined },
      {
        centerXCss: 360,
        centerYCss: 360,
        waferRadiusPx: 300,
        wfFlat: 'D',
        devicePixelCss: 1,
      },
    );
    expect(gradients.map((g) => g.kind)).toEqual(['radial', 'linear']);
    expect(fills).toHaveLength(1);
  });

  it.each(['edge-ring-etch', 'handling-scratch', 'site2-probe-contact'] as const)(
    'keeps every %s die inside the R - 0.026 D edge-exclusion line',
    async (preset) => {
      const res = await ingestDemoPreset(preset);
      expect(res.kind).toBe('ok');
      if (res.kind !== 'ok') return;
      const { lot } = res;
      for (const wafer of lot.wafers) {
        for (const [w, h] of [
          [783, 720],
          [390, 390],
          [152, 152],
        ] as const) {
          const layout = computeWaferRenderLayout(wafer, w, h, lot.dies);
          const exclusionR = computeWaferExclusionRadiusPx(layout.waferRadiusPx);
          for (let i = wafer.dieStartIndex; i < wafer.dieEndIndex; i += 1) {
            if (lot.dies.hasValidCoords[i] === 0) continue;
            const rect = dieCoordToCanvasRect(
              lot.dies.x[i]!,
              lot.dies.y[i]!,
              layout,
            );
            // Farthest corner of the full cell (fail dies are the larger tile)
            const half = layout.diePitchPx / 2;
            const dx = Math.abs(rect.centerX - layout.centerXCss) + half;
            const dy = Math.abs(rect.centerY - layout.centerYCss) + half;
            expect(Math.hypot(dx, dy)).toBeLessThanOrEqual(exclusionR + 1e-9);
          }
        }
      }
    },
  );
});
