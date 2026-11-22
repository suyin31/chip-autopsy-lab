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
  compositeRgbaOverRgb,
  parseHexColor,
  parseRgbaString,
  SECONDARY_FAIL_BIN_PALETTE,
  WAFER_TOKENS,
  wcagContrastRatio,
} from '@/ui/tokens';
import { ingestDemoPreset } from '@/workers';
import { WaferMapCanvas } from './WaferMapCanvas';
import {
  buildFailBinRankMap,
  type Canvas2DContextLike,
  computeDieStreetPx,
  computeFailDieRadiusPx,
  computeParametricRange,
  computePassDieRadiusPx,
  computeWaferExclusionRadiusPx,
  computeWaferNotchGeometry,
  computeWaferRadiusUnits,
  computeWaferRenderLayout,
  dieCoordToCanvasRect,
  hitTestWaferDie,
  MAX_SUPERSAMPLED_CANVAS_PX,
  paintLandingCardWafer,
  paintWaferBaseLayer,
  paintWaferDiscMaterial,
  paintWaferFailLayer,
  paintWaferOverlayLayer,
  paintWaferSweepBatch,
  paintWaferThumbnail,
  PASS_DIE_CELL_FRACTION,
  resolveCanvasPixelSize,
  resolveDieFillColor,
  resolveFitWaferDiameterPx,
  resolvePassFailDieColor,
  resolvePassTileColor,
  resolveSupersampledCanvasSize,
  shouldDrawFailFacet,
  THUMBNAIL_DENSE_PITCH_PX,
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

  it('hits premium §6.2 wafer diameters (596 at 783x644, 496 at 690x544, 350 at 390x390) and keeps premium §5.3 streets', () => {
    const lot = buildWaferTestLot();
    const wafer = lot.wafers[0]!;

    const desktopLayout = computeWaferRenderLayout(wafer, 783, 644, lot.dies);
    expect(desktopLayout.waferRadiusPx * 2).toBe(596);
    expect(
      computeWaferRenderLayout(wafer, 690, 544, lot.dies).waferRadiusPx * 2,
    ).toBe(496);
    // D = clamp(320, min(areaW - 96, areaH - 48), 680)
    expect(resolveFitWaferDiameterPx(1200, 1000)).toBe(680);
    expect(resolveFitWaferDiameterPx(540, 512)).toBe(444);
    // sm single column (premium §6.2): square 576–640 stage -> D = min(560, vw - 64) = 560
    expect(resolveFitWaferDiameterPx(576, 576)).toBe(560);
    expect(resolveFitWaferDiameterPx(640, 640)).toBe(560);
    expect(resolveFitWaferDiameterPx(656, 656)).toBe(560);

    const mobileLayout = computeWaferRenderLayout(wafer, 390, 390, lot.dies);
    expect(mobileLayout.waferRadiusPx * 2).toBe(350);

    expect(desktopLayout.streetPx).toBe(
      computeDieStreetPx(desktopLayout.diePitchPx),
    );
    const rLeft = dieCoordToCanvasRect(0, 0, desktopLayout);
    const rRight = dieCoordToCanvasRect(1, 0, desktopLayout);
    const horizontalStreet = rRight.x - (rLeft.x + rLeft.width);
    expect(horizontalStreet).toBeCloseTo(desktopLayout.streetPx, 6);

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
    expect(resolvePassFailDieColor(1)).toBe(WAFER_TOKENS.passTile);
    expect(resolvePassFailDieColor(1, true)).toBe(WAFER_TOKENS.passTileHc);
    expect(resolvePassFailDieColor(0)).toBe('#FF5C7C');

    const sbinRanks = buildFailBinRankMap(lot.dies, 'SBIN');
    expect(sbinRanks.get(5)).toBe(0);
    expect(sbinRanks.get(7)).toBe(1);

    expect(resolveDieFillColor(0, lot.dies, 'sbin', sbinRanks)).toBe(
      WAFER_TOKENS.passTile,
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

  it('paints the premium §5.2 disc material, §5.3 80% pass tiles vs full-cell-minus-street fail dies with facets, FailCanvas layer, and isolated OverlayCanvas', () => {
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
      (r) => r.fillStyle === WAFER_TOKENS.passTile,
    );
    const failFills = baseMock.dieShapes.filter(
      (r) => r.fillStyle === COLOR_TOKENS.failure,
    );
    expect(passFills).toHaveLength(2);
    expect(failFills).toHaveLength(3);

    // §5.3 geometry cue: pass tiles are 80% of the fail-die side; fail dies fill the cell minus the street
    expect(passFills[0]!.w).toBeCloseTo(
      layout.dieSizePx * PASS_DIE_CELL_FRACTION,
      4,
    );
    expect(passFills[0]!.radius).toBeCloseTo(
      computePassDieRadiusPx(layout.diePitchPx),
      4,
    );
    expect(failFills[0]!.w).toBeCloseTo(
      layout.diePitchPx - layout.streetPx,
      4,
    );
    expect(failFills[0]!.radius).toBeCloseTo(
      computeFailDieRadiusPx(layout.diePitchPx),
      4,
    );
    expect(failFills[0]!.w).toBeGreaterThan(passFills[0]!.w);
    // Fail facets: one batched path, one 1 px rect per fail die (pitch >= 10 px)
    expect(layout.diePitchPx).toBeGreaterThanOrEqual(10);
    expect(baseMock.rectCalls).toHaveLength(3);
    expect(baseMock.pathFills).toContain(WAFER_TOKENS.failFacet);

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
    // Premium §5.4: a filter highlight is evidence: dim-veil, punched dies, rims, no ice accent
    const wafer0 = lot.wafers[0]!;
    let site2OnWafer = 0;
    for (let i = wafer0.dieStartIndex; i < wafer0.dieEndIndex; i += 1) {
      if (
        site2Masks.overlayHighlightMask[i] !== 0 &&
        lot.dies.hasValidCoords[i] !== 0
      ) {
        site2OnWafer += 1;
      }
    }
    expect(site2OnWafer).toBeGreaterThan(0);
    expect(overlayMock.pathFills).toContain(WAFER_TOKENS.dimVeil);
    const punched = overlayMock.dieShapes.filter((d) => d.fillStyle === '#000000');
    expect(punched).toHaveLength(site2OnWafer);
    expect(punched[0]!.w).toBeCloseTo(layout.dieSizePx, 4);
    const strokeStyles = overlayMock.strokes.map((s) => s.strokeStyle);
    expect(
      strokeStyles.some(
        (c) => c === WAFER_TOKENS.evidenceRim || c === WAFER_TOKENS.evidencePassRim,
      ),
    ).toBe(true);
    expect(strokeStyles).not.toContain(COLOR_TOKENS.accent);
    // Hover: 1 px dark keyline outside, 1.5 px white inside
    expect(overlayMock.strokes).toContainEqual({
      strokeStyle: WAFER_TOKENS.hoverStroke.outer,
      lineWidth: 1,
    });
    expect(overlayMock.strokes).toContainEqual({
      strokeStyle: WAFER_TOKENS.hoverStroke.inner,
      lineWidth: 1.5,
    });
    expect(overlayMock.strokeRects).toHaveLength(0);
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
      (r) => r.fillStyle === WAFER_TOKENS.passTile,
    );
    const failFills = thumbMock.dieShapes.filter(
      (r) => r.fillStyle === COLOR_TOKENS.failure,
    );
    expect(passFills).toHaveLength(2);
    expect(failFills).toHaveLength(3);
  });

  it('renders boxless stage with disc shadows, halo, sheen, three canvases, HUD segmented control, legend, and strip (§3.4, §4.7)', async () => {
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
    expect(html).not.toContain('data-testid="wafer-stage-vignette"');
    expect(html).toContain('data-testid="wafer-stage-ambient-shadow"');
    expect(html).toContain('data-testid="wafer-stage-contact-shadow"');
    expect(html).toContain('data-testid="wafer-stage-halo"');
    expect(html).toContain('data-testid="wafer-stage-sheen"');
    expect(html).toContain('data-testid="wafer-camera-wrapper"');
    expect(html).toContain('data-testid="wafer-base-canvas"');
    expect(html).toContain('data-testid="wafer-fail-canvas"');
    expect(html).toContain('data-testid="wafer-overlay-canvas"');
    expect(html).toContain('data-testid="stage-mode-segmented"');
    // Premium §5.5-§5.7: header above the wafer, one control row below it, nothing on the wafer
    expect(html).toContain('Pass/fail');
    expect(html).toContain('Hard bins');
    expect(html).toContain('Soft bins');
    expect(html).toContain('110 of 633 dies failed');
    expect(html).toMatch(/data-legend-label=""[^>]*>Failed<\/span><span data-legend-count=""[^>]*>110</);
    expect(html).toMatch(/data-legend-label=""[^>]*>Passed<\/span><span data-legend-count=""[^>]*>523</);
    expect(html).toContain('data-testid="stage-select-area"');
    expect(html).toContain('aria-label="Select an area"');
    expect(html).not.toContain('data-testid="stage-tool-segmented"');
    expect(html).not.toContain('data-testid="stage-zoom-pill"');
    const headerAt = html.indexOf('data-testid="stage-header"');
    const stageAt = html.indexOf('data-testid="wafer-stage"');
    const controlRowAt = html.indexOf('data-testid="stage-control-row"');
    const stageEndAt = html.indexOf('Failing dies on wafer W01');
    expect(headerAt).toBeGreaterThan(-1);
    expect(headerAt).toBeLessThan(stageAt);
    expect(controlRowAt).toBeGreaterThan(stageEndAt);
    expect(html.indexOf('data-testid="stage-mode-segmented"')).toBeGreaterThan(controlRowAt);
    expect(html.indexOf('data-testid="stage-legend"')).toBeGreaterThan(controlRowAt);
    expect(html.match(/data-testid="wafer-lot-strip-thumb"/g)).toHaveLength(25);
    expect(html).toContain('Failing dies on wafer W01');
    // visual-acceptance (d), (e), (f) + §5.10 data-sweep attribute
    expect(html).toContain('data-sweep=');
    // P13: square stage below 1024 (390 x 390 full-bleed on mobile), flex-1 area from 1024
    expect(html).toContain('relative isolate aspect-square w-full');
    expect(html).toContain('lg:aspect-auto lg:min-h-0 lg:flex-1');
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

describe('Premium P6 — die tiles and thumbnails (premium §5.3)', () => {
  it('derives street and corner radii from the die pitch', () => {
    // 1440 x 900 demo wafer pitch ~19.4 -> 2 px street
    expect(computeDieStreetPx(19.4)).toBe(2);
    expect(computeDieStreetPx(4, 2)).toBe(0.5);
    expect(computeDieStreetPx(2)).toBe(1);
    expect(computeDieStreetPx(80)).toBe(8);
    expect(computeFailDieRadiusPx(2)).toBe(0.5);
    expect(computeFailDieRadiusPx(10)).toBeCloseTo(1.2, 9);
    expect(computeFailDieRadiusPx(40)).toBe(2);
    expect(computePassDieRadiusPx(2)).toBe(0.5);
    expect(computePassDieRadiusPx(10)).toBeCloseTo(1, 9);
    expect(computePassDieRadiusPx(40)).toBe(1.5);
    expect(shouldDrawFailFacet(9.99)).toBe(false);
    expect(shouldDrawFailFacet(10)).toBe(true);
  });

  it('keeps pass tiles at 1.1-1.3:1 against the disc, fail dies >= 5:1 against both, and 3:1 under more contrast (A6, A13)', () => {
    const disc = parseHexColor(WAFER_TOKENS.discMid);
    const passTile = compositeRgbaOverRgb(
      parseRgbaString(resolvePassTileColor(false)),
      disc,
    );
    const passTileHc = compositeRgbaOverRgb(
      parseRgbaString(resolvePassTileColor(true)),
      disc,
    );
    const fail = parseHexColor(WAFER_TOKENS.failDie);
    const passRatio = wcagContrastRatio(passTile, disc);
    expect(passRatio).toBeGreaterThanOrEqual(1.1);
    expect(passRatio).toBeLessThanOrEqual(1.3);
    expect(wcagContrastRatio(fail, disc)).toBeGreaterThanOrEqual(5);
    expect(wcagContrastRatio(fail, passTile)).toBeGreaterThanOrEqual(4.5);
    expect(wcagContrastRatio(passTileHc, disc)).toBeGreaterThanOrEqual(3);
  });

  it('paints pass tiles in pass-tile-hc when highContrast is set, including the probe-sweep batch', () => {
    const lot = buildWaferTestLot();
    const wafer = lot.wafers[0]!;
    const layout = computeWaferRenderLayout(wafer, 783, 720, lot.dies);
    const mock = createMockCanvas2DContext();
    paintWaferBaseLayer(mock.ctx, {
      lot,
      waferIndex: 0,
      layout,
      dpr: 2,
      colorMode: 'sbin',
      activeTestNum: null,
      hiddenBins: new Set(),
      highContrast: true,
    });
    expect(
      mock.dieShapes.filter((r) => r.fillStyle === WAFER_TOKENS.passTileHc),
    ).toHaveLength(2);
    // Bin modes still facet the fail dies in one batched path
    expect(mock.rectCalls).toHaveLength(3);

    const sweepMock = createMockCanvas2DContext();
    const order = new Uint32Array([0, 1, 2, 3, 4]);
    paintWaferSweepBatch(sweepMock.ctx, {
      lot,
      layout,
      dpr: 2,
      probeOrder: order,
      startOrderIndex: 0,
      endOrderIndex: order.length,
      highContrast: true,
    });
    expect(
      sweepMock.dieShapes.every((r) => r.fillStyle === WAFER_TOKENS.passTileHc),
    ).toBe(true);
  });

  it('skips facets below a 10 px pitch', () => {
    const lot = buildWaferTestLot();
    const wafer = lot.wafers[0]!;
    const layout = computeWaferRenderLayout(wafer, 40, 40, lot.dies);
    expect(layout.diePitchPx).toBeLessThan(10);
    const mock = createMockCanvas2DContext();
    paintWaferBaseLayer(mock.ctx, {
      lot,
      waferIndex: 0,
      layout,
      dpr: 2,
      colorMode: 'pass-fail',
      activeTestNum: null,
      hiddenBins: new Set(),
    });
    expect(mock.rectCalls).toHaveLength(0);
    expect(mock.pathFills).not.toContain(WAFER_TOKENS.failFacet);
  });

  it('thumbnails below p = 3 omit pass tiles, draw fail dies at full cell, and skip the thin film', async () => {
    const res = await ingestDemoPreset('edge-ring-etch');
    expect(res.kind).toBe('ok');
    if (res.kind !== 'ok') return;
    const { lot } = res;
    const wafer = lot.wafers[0]!;
    const mock = createMockCanvas2DContext();
    let conicCalls = 0;
    const ctx: Canvas2DContextLike = {
      ...mock.ctx,
      createConicGradient: () => {
        conicCalls += 1;
        return { addColorStop: () => undefined } as unknown as CanvasGradient;
      },
    };
    paintWaferThumbnail(ctx, { wafer, dies: lot.dies, cssSize: 40, dpr: 2 });
    expect(conicCalls).toBe(0);

    const radiusPx = 40 / 2 - 1.25;
    const pitch = radiusPx / computeWaferRadiusUnits(wafer, lot.dies);
    expect(pitch).toBeLessThan(THUMBNAIL_DENSE_PITCH_PX);

    const passShapes = mock.dieShapes.filter(
      (r) =>
        r.fillStyle === WAFER_TOKENS.passTile ||
        r.fillStyle === WAFER_TOKENS.passTileHc,
    );
    expect(passShapes).toHaveLength(0);
    const failShapes = mock.dieShapes.filter(
      (r) => r.fillStyle === COLOR_TOKENS.failure,
    );
    let failCount = 0;
    for (let i = wafer.dieStartIndex; i < wafer.dieEndIndex; i += 1) {
      if (lot.dies.hasValidCoords[i] !== 0 && lot.dies.finalPass[i] === 0) {
        failCount += 1;
      }
    }
    expect(failShapes).toHaveLength(failCount);
    expect(failShapes[0]!.w).toBeCloseTo(pitch, 9);
  });

  it('landing-size thumbnails (p >= 3) keep 80% pass tiles and streets', async () => {
    const res = await ingestDemoPreset('edge-ring-etch');
    expect(res.kind).toBe('ok');
    if (res.kind !== 'ok') return;
    const { lot } = res;
    const wafer = lot.wafers[0]!;
    const mock = createMockCanvas2DContext();
    paintLandingCardWafer(mock.ctx, {
      wafer,
      dies: lot.dies,
      cssSize: 152,
      dpr: 2,
      highContrast: true,
    });
    const pitch = (152 / 2 - 1.5) / computeWaferRadiusUnits(wafer, lot.dies);
    expect(pitch).toBeGreaterThanOrEqual(THUMBNAIL_DENSE_PITCH_PX);
    const pass = mock.dieShapes.filter(
      (r) => r.fillStyle === WAFER_TOKENS.passTileHc,
    );
    const fail = mock.dieShapes.filter(
      (r) => r.fillStyle === COLOR_TOKENS.failure,
    );
    expect(pass.length).toBeGreaterThan(0);
    expect(fail.length).toBeGreaterThan(0);
    const failSide = pitch - computeDieStreetPx(pitch, 2);
    expect(fail[0]!.w).toBeCloseTo(failSide, 9);
    expect(pass[0]!.w).toBeCloseTo(failSide * PASS_DIE_CELL_FRACTION, 9);
  });

  it('the landing hero wafer (premium §11.1) paints the thin film; card wafers skip it', async () => {
    const res = await ingestDemoPreset('edge-ring-etch');
    expect(res.kind).toBe('ok');
    if (res.kind !== 'ok') return;
    const { lot } = res;
    const wafer = lot.wafers[0]!;
    const mock = createMockCanvas2DContext();
    let conicCalls = 0;
    const ctx: Canvas2DContextLike = {
      ...mock.ctx,
      createConicGradient: () => {
        conicCalls += 1;
        return { addColorStop: () => undefined } as unknown as CanvasGradient;
      },
    };
    paintLandingCardWafer(ctx, { wafer, dies: lot.dies, cssSize: 152, dpr: 1 });
    expect(conicCalls).toBe(0);
    paintLandingCardWafer(ctx, {
      wafer,
      dies: lot.dies,
      cssSize: 320,
      dpr: 1,
      thinFilm: true,
    });
    expect(conicCalls).toBe(1);
  });
});
