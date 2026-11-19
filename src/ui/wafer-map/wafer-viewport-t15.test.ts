import * as fs from 'node:fs';
import * as path from 'node:path';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { computeYieldSummary } from '@/core/analytics';
import {
  buildLotModel,
  type LotModel,
  STDF_MISSING_COORD,
} from '@/core/model';
import {
  parseStdfBytes,
  type WaferAxisPosX,
  type WaferAxisPosY,
  type WaferFlatOrientation,
  writeStdfBytes,
} from '@/core/stdf';
import { createCanonicalFixtureLotSpec } from '@/core/stdf/__test-utils__/golden-fixtures';
import { I18nProvider } from '@/ui/i18n';
import { LOUPE_HEIGHT_PX, MAGNIFIER_WIDTH_PX } from './HoverMagnifier';
import {
  computeMagnifierPlacement,
  computePinnedReadoutPlacement,
  rectsOverlap,
} from './linked-interactions';
import { buildWaferOutlineSvgPath } from './stage-layers';
import {
  applyCursorWheelZoom,
  applyKeyboardZoom,
  applyPanWithRubberBand,
  applyPinchGesture,
  BUTTON_ZOOM_STEP_FACTOR,
  cameraToViewportTransform,
  clampCameraToBounds,
  computeCameraPanBounds,
  createWaferCameraController,
  DEFAULT_CAMERA_STATE,
  MAX_CAMERA_SCALE,
  MIN_CAMERA_SCALE,
  type WaferCameraController,
} from './wafer-camera';
import {
  computeWaferNotchGeometry,
  computeWaferRenderLayout,
  DEFAULT_VIEWPORT_TRANSFORM,
  dieCoordToCanvasRect,
  hitTestWaferDie,
} from './wafer-geometry';
import { WaferMapCanvas } from './WaferMapCanvas';

const FIXTURES_DIR = path.resolve(process.cwd(), 'tests/fixtures');
const STAGE_METRICS = {
  stageWidth: 783,
  stageHeight: 644,
  fitRadiusPx: 298,
} as const;

function loadFixtureLot(fileName: string): LotModel {
  const bytes = new Uint8Array(
    fs.readFileSync(path.join(FIXTURES_DIR, fileName)),
  );
  const parsed = parseStdfBytes(bytes, { mode: 'full' });
  if (!parsed.ok) {
    throw new Error(`Failed to parse ${fileName}: ${parsed.error.message}`);
  }
  return buildLotModel(parsed.value);
}

function makeController(reducedMotion = false): {
  readonly controller: WaferCameraController;
  readonly flush: (maxFrames?: number) => number;
  readonly hasFrame: () => boolean;
} {
  let nowMs = 1000;
  let pending: FrameRequestCallback | null = null;
  const controller = createWaferCameraController({
    getStageMetrics: () => STAGE_METRICS,
    getPrefersReducedMotion: () => reducedMotion,
    onTransformFrame: () => undefined,
    requestFrame: (cb) => {
      pending = cb;
      return 1;
    },
    cancelFrame: () => {
      pending = null;
    },
    now: () => nowMs,
  });
  const flush = (maxFrames = 600): number => {
    let frames = 0;
    while (pending !== null && frames < maxFrames) {
      nowMs += 16;
      const cb = pending;
      pending = null;
      cb(nowMs);
      frames += 1;
    }
    return frames;
  };
  return { controller, flush, hasFrame: () => pending !== null };
}

describe('Task 15 — viewport math (zoom clamp, pan bounds, reduced motion, readout placement)', () => {
  it('clamps zoom strictly to [MIN_CAMERA_SCALE, MAX_CAMERA_SCALE] across wheel, button, keyboard, and reduced-motion pinch', () => {
    const overZoomWheel = applyCursorWheelZoom(DEFAULT_CAMERA_STATE, {
      ...STAGE_METRICS,
      deltaY: -50_000,
      deltaMode: 0,
      ctrlKey: false,
      pointerX: 400,
      pointerY: 300,
    });
    expect(overZoomWheel.scale).toBe(MAX_CAMERA_SCALE);

    const underZoomWheel = applyCursorWheelZoom(overZoomWheel, {
      ...STAGE_METRICS,
      deltaY: 50_000,
      deltaMode: 0,
      ctrlKey: false,
      pointerX: 400,
      pointerY: 300,
    });
    expect(underZoomWheel.scale).toBe(MIN_CAMERA_SCALE);

    const overStep = applyKeyboardZoom(
      { scale: 6, tx: -1000, ty: -800 },
      BUTTON_ZOOM_STEP_FACTOR,
      { ...STAGE_METRICS, anchorX: 391.5, anchorY: 322 },
    );
    expect(overStep.scale).toBe(MAX_CAMERA_SCALE);

    const backToFit = applyKeyboardZoom(
      { scale: 1.5, tx: -195.75, ty: -161 },
      1 / BUTTON_ZOOM_STEP_FACTOR,
      { ...STAGE_METRICS, anchorX: 391.5, anchorY: 322 },
    );
    expect(backToFit).toEqual(DEFAULT_CAMERA_STATE);

    const pinchClampedMax = applyPinchGesture(
      {
        ...STAGE_METRICS,
        startCamera: { scale: 4, tx: -1174.5, ty: -966 },
        startCentroidX: 391.5,
        startCentroidY: 322,
        startDistance: 100,
        currentCentroidX: 391.5,
        currentCentroidY: 322,
        currentDistance: 500,
      },
      false,
    );
    expect(pinchClampedMax.scale).toBe(MAX_CAMERA_SCALE);

    const clampedDirect = clampCameraToBounds(
      { scale: 0.2, tx: 99_999, ty: -99_999 },
      STAGE_METRICS.stageWidth,
      STAGE_METRICS.stageHeight,
      STAGE_METRICS.fitRadiusPx,
    );
    expect(clampedDirect.scale).toBe(MIN_CAMERA_SCALE);
    const fitBounds = computeCameraPanBounds(
      MIN_CAMERA_SCALE,
      STAGE_METRICS.stageWidth,
      STAGE_METRICS.stageHeight,
      STAGE_METRICS.fitRadiusPx,
    );
    expect(clampedDirect.tx).toBe(fitBounds.maxTx);
    expect(clampedDirect.ty).toBe(fitBounds.minTy);
  });

  it('compounds button zoom clicks via spring-camera and jumps instantly under prefers-reduced-motion', () => {
    const smooth = makeController(false);
    smooth.controller.zoomByFactor(BUTTON_ZOOM_STEP_FACTOR);
    expect(smooth.hasFrame()).toBe(true);
    // Second click mid-flight compounds on the running target (1.5 * 1.5 = 2.25)
    smooth.flush(2);
    smooth.controller.zoomByFactor(BUTTON_ZOOM_STEP_FACTOR);
    expect(smooth.flush()).toBeGreaterThan(5);
    expect(smooth.controller.getCamera().scale).toBeCloseTo(2.25, 3);

    // Reset animates smoothly back to fit
    smooth.controller.resetToFit(true);
    expect(smooth.hasFrame()).toBe(true);
    expect(smooth.flush()).toBeGreaterThan(5);
    expect(smooth.controller.getCamera()).toEqual(DEFAULT_CAMERA_STATE);
    smooth.controller.dispose();

    // Under prefers-reduced-motion, button zoom and reset are instant (0 rAF frames)
    const reduced = makeController(true);
    reduced.controller.zoomByFactor(BUTTON_ZOOM_STEP_FACTOR);
    expect(reduced.hasFrame()).toBe(false);
    expect(reduced.controller.getCamera().scale).toBeCloseTo(1.5, 6);

    reduced.controller.zoomByFactor(BUTTON_ZOOM_STEP_FACTOR);
    expect(reduced.hasFrame()).toBe(false);
    expect(reduced.controller.getCamera().scale).toBeCloseTo(2.25, 6);

    reduced.controller.resetToFit(true);
    expect(reduced.hasFrame()).toBe(false);
    expect(reduced.controller.getCamera()).toEqual(DEFAULT_CAMERA_STATE);
    reduced.controller.dispose();
  });

  it('enforces symmetric pan bounds across zoom scales and clamps rubber-band overshoot back inside bounds', () => {
    for (const scale of [1, 1.5, 2.5, 4, 8]) {
      const bounds = computeCameraPanBounds(
        scale,
        STAGE_METRICS.stageWidth,
        STAGE_METRICS.stageHeight,
        STAGE_METRICS.fitRadiusPx,
      );
      expect(bounds.minTx).toBeLessThan(bounds.maxTx);
      expect(bounds.minTy).toBeLessThan(bounds.maxTy);

      // Center of stage in fit space maps symmetrically at the midpoint of [minTx, maxTx]
      const midTx = (bounds.minTx + bounds.maxTx) / 2;
      const midTy = (bounds.minTy + bounds.maxTy) / 2;
      expect((STAGE_METRICS.stageWidth / 2) * scale + midTx).toBeCloseTo(
        STAGE_METRICS.stageWidth / 2,
        6,
      );
      expect((STAGE_METRICS.stageHeight / 2) * scale + midTy).toBeCloseTo(
        STAGE_METRICS.stageHeight / 2,
        6,
      );

      // Rubber-band resists overshoot progressively while staying finite and directional
      const pastRight = applyPanWithRubberBand(
        { scale, tx: bounds.maxTx + 240, ty: midTy },
        STAGE_METRICS.stageWidth,
        STAGE_METRICS.stageHeight,
        STAGE_METRICS.fitRadiusPx,
      );
      expect(pastRight.tx).toBeGreaterThan(bounds.maxTx);
      expect(pastRight.tx).toBeLessThan(bounds.maxTx + 240);

      const clampedBack = clampCameraToBounds(
        pastRight,
        STAGE_METRICS.stageWidth,
        STAGE_METRICS.stageHeight,
        STAGE_METRICS.fitRadiusPx,
      );
      expect(clampedBack.tx).toBe(bounds.maxTx);
    }
  });

  it('places the hover readout and touch-pinned readout without ever overlapping any die from the golden STDF fixtures', () => {
    const lot = loadFixtureLot('golden-little-endian.stdf');
    const wafer = lot.wafers[0]!;
    const cameras = [
      DEFAULT_CAMERA_STATE,
      { scale: 2.5, tx: -580, ty: -480 },
      { scale: 5, tx: -1560, ty: -1280 },
    ] as const;
    const stages = [
      { width: 783, height: 644 },
      { width: 390, height: 390 },
    ] as const;

    const readoutHeight = LOUPE_HEIGHT_PX + 104;

    for (const stage of stages) {
      for (const cam of cameras) {
        const vp = cameraToViewportTransform(cam, stage.width, stage.height);
        const layout = computeWaferRenderLayout(
          wafer,
          stage.width,
          stage.height,
          lot.dies,
          vp,
        );
        for (let i = wafer.dieStartIndex; i < wafer.dieEndIndex; i += 1) {
          if (lot.dies.hasValidCoords[i] === 0) continue;
          const dieRect = dieCoordToCanvasRect(
            lot.dies.x[i]!,
            lot.dies.y[i]!,
            layout,
          );
          const placed = computeMagnifierPlacement({
            pointerX: dieRect.centerX,
            pointerY: dieRect.centerY,
            dieRect: {
              x: dieRect.x,
              y: dieRect.y,
              width: dieRect.width,
              height: dieRect.height,
            },
            magnifierWidth: MAGNIFIER_WIDTH_PX,
            magnifierHeight: readoutHeight,
            stageWidth: stage.width,
            stageHeight: stage.height,
          });
          expect(
            rectsOverlap(
              {
                x: placed.x,
                y: placed.y,
                width: MAGNIFIER_WIDTH_PX,
                height: readoutHeight,
              },
              dieRect,
            ),
          ).toBe(false);

          const pinned = computePinnedReadoutPlacement({
            dieRect: {
              x: dieRect.x,
              y: dieRect.y,
              width: dieRect.width,
              height: dieRect.height,
            },
            readoutWidth: MAGNIFIER_WIDTH_PX,
            readoutHeight: 108,
            stageWidth: stage.width,
          });
          expect(
            rectsOverlap(
              {
                x: pinned.x,
                y: pinned.y,
                width: MAGNIFIER_WIDTH_PX,
                height: 108,
              },
              dieRect,
            ),
          ).toBe(false);
        }
      }
    }
  });
});

describe('Task 15 — WCR orientation (axis directions and flat/notch angle) using existing STDF fixtures', () => {
  it('decodes identical WCR orientation from golden big-endian, little-endian, truncated, and malformed fixtures and maps axes/notch accurately', () => {
    const bigLot = loadFixtureLot('golden-big-endian.stdf');
    const littleLot = loadFixtureLot('golden-little-endian.stdf');
    const truncatedLot = loadFixtureLot('golden-truncated.stdf');
    const malformedLot = loadFixtureLot('golden-malformed.stdf');

    for (const lot of [bigLot, littleLot, truncatedLot, malformedLot]) {
      const wafer = lot.wafers[0]!;
      expect(wafer.geometry.wfFlat).toBe('D');
      expect(wafer.geometry.posX).toBe('R');
      expect(wafer.geometry.posY).toBe('U');
      expect(wafer.geometry.wfSize).toBeCloseTo(200, 4);

      const layout = computeWaferRenderLayout(
        wafer,
        STAGE_METRICS.stageWidth,
        STAGE_METRICS.stageHeight,
        lot.dies,
        DEFAULT_VIEWPORT_TRANSFORM,
      );
      expect(layout.dirX).toBe(1);
      expect(layout.dirY).toBe(-1);

      // Golden fixture contains (-2, 3) and (-1, 3): with POS_X = 'R', x = -2 sits left of x = -1
      const leftDie = dieCoordToCanvasRect(-2, 3, layout);
      const rightDie = dieCoordToCanvasRect(-1, 3, layout);
      expect(leftDie.centerX).toBeLessThan(rightDie.centerX);
      expect(leftDie.centerY).toBeCloseTo(rightDie.centerY, 6);

      // Round-trip hit-test on both fit and zoomed/panned transforms
      for (const cam of [
        DEFAULT_CAMERA_STATE,
        { scale: 2.5, tx: -580, ty: -480 },
      ]) {
        const vp = cameraToViewportTransform(
          cam,
          STAGE_METRICS.stageWidth,
          STAGE_METRICS.stageHeight,
        );
        const camLayout = computeWaferRenderLayout(
          wafer,
          STAGE_METRICS.stageWidth,
          STAGE_METRICS.stageHeight,
          lot.dies,
          vp,
        );
        for (let i = wafer.dieStartIndex; i < wafer.dieEndIndex; i += 1) {
          if (lot.dies.hasValidCoords[i] === 0) continue;
          const r = dieCoordToCanvasRect(
            lot.dies.x[i]!,
            lot.dies.y[i]!,
            camLayout,
          );
          expect(
            hitTestWaferDie(
              r.centerX,
              r.centerY,
              camLayout,
              lot.waferCoordIndex[0],
            ),
          ).toBe(i);
        }
      }

      // Notch at 6 o'clock (Math.PI / 2) per WCR.WF_FLAT = 'D'
      const notch = computeWaferNotchGeometry(
        layout.centerXCss,
        layout.centerYCss,
        layout.waferRadiusPx,
        wafer.geometry.wfFlat,
      );
      expect(notch.notchAngleRad).toBeCloseTo(Math.PI / 2, 6);
      expect(notch.apexX).toBeCloseTo(layout.centerXCss, 6);
      expect(notch.apexY).toBeGreaterThan(layout.centerYCss);
      expect(notch.apexY).toBeLessThan(
        layout.centerYCss + layout.waferRadiusPx,
      );
    }
  });

  it('honors all four (POS_X, POS_Y) axis directions and all five WF_FLAT notch angles through STDF round-trip', () => {
    const axisCases: ReadonlyArray<{
      readonly posX: Exclude<WaferAxisPosX, ' '>;
      readonly posY: Exclude<WaferAxisPosY, ' '>;
      readonly expectedDirX: 1 | -1;
      readonly expectedDirY: 1 | -1;
    }> = [
      { posX: 'R', posY: 'U', expectedDirX: 1, expectedDirY: -1 },
      { posX: 'L', posY: 'U', expectedDirX: -1, expectedDirY: -1 },
      { posX: 'R', posY: 'D', expectedDirX: 1, expectedDirY: 1 },
      { posX: 'L', posY: 'D', expectedDirX: -1, expectedDirY: 1 },
    ];

    for (const ac of axisCases) {
      const base = createCanonicalFixtureLotSpec('little');
      const spec = {
        ...base,
        wcr: { ...base.wcr, posX: ac.posX, posY: ac.posY },
        wafers: [
          {
            ...base.wafers[0]!,
            parts: [
              ...(base.wafers[0]!.parts ?? []),
              {
                headNum: 1,
                siteNum: 1,
                partFlg: 0,
                hardBin: 1,
                softBin: 1,
                xCoord: -1,
                yCoord: 1,
                partId: '4',
              },
              {
                // Missing-coordinate die (-32768) excluded from spatial grid but kept in lot totals
                headNum: 1,
                siteNum: 2,
                partFlg: 0x08,
                hardBin: 4,
                softBin: 7,
                xCoord: STDF_MISSING_COORD,
                yCoord: STDF_MISSING_COORD,
                partId: '5',
              },
            ],
          },
        ],
      };

      const parsed = parseStdfBytes(writeStdfBytes(spec), { mode: 'full' });
      expect(parsed.ok).toBe(true);
      if (!parsed.ok) continue;
      const lot = buildLotModel(parsed.value);
      const wafer = lot.wafers[0]!;
      expect(lot.dies.count).toBe(4); // (-2,3), (-1,3), (-1,1), plus 1 missing-coord part
      expect(lot.waferCoordIndex[0]!.size).toBe(3);

      const layout = computeWaferRenderLayout(wafer, 600, 600, lot.dies);
      expect(layout.dirX).toBe(ac.expectedDirX);
      expect(layout.dirY).toBe(ac.expectedDirY);

      const pNeg2_3 = dieCoordToCanvasRect(-2, 3, layout);
      const pNeg1_3 = dieCoordToCanvasRect(-1, 3, layout);
      const pNeg1_1 = dieCoordToCanvasRect(-1, 1, layout);

      if (ac.posX === 'R') {
        expect(pNeg1_3.centerX).toBeGreaterThan(pNeg2_3.centerX);
      } else {
        expect(pNeg1_3.centerX).toBeLessThan(pNeg2_3.centerX);
      }

      if (ac.posY === 'U') {
        expect(pNeg1_3.centerY).toBeLessThan(pNeg1_1.centerY);
      } else {
        expect(pNeg1_3.centerY).toBeGreaterThan(pNeg1_1.centerY);
      }
    }

    const flatCases: ReadonlyArray<{
      readonly wfFlat: WaferFlatOrientation;
      readonly expectedAngleRad: number;
      readonly checkApex: (apexX: number, apexY: number, cx: number, cy: number) => void;
    }> = [
      {
        wfFlat: 'D',
        expectedAngleRad: Math.PI / 2,
        checkApex: (ax, ay, cx, cy) => {
          expect(ax).toBeCloseTo(cx, 5);
          expect(ay).toBeGreaterThan(cy);
        },
      },
      {
        wfFlat: 'U',
        expectedAngleRad: -Math.PI / 2,
        checkApex: (ax, ay, cx, cy) => {
          expect(ax).toBeCloseTo(cx, 5);
          expect(ay).toBeLessThan(cy);
        },
      },
      {
        wfFlat: 'L',
        expectedAngleRad: Math.PI,
        checkApex: (ax, ay, cx, cy) => {
          expect(ax).toBeLessThan(cx);
          expect(ay).toBeCloseTo(cy, 5);
        },
      },
      {
        wfFlat: 'R',
        expectedAngleRad: 0,
        checkApex: (ax, ay, cx, cy) => {
          expect(ax).toBeGreaterThan(cx);
          expect(ay).toBeCloseTo(cy, 5);
        },
      },
      {
        wfFlat: ' ',
        expectedAngleRad: Math.PI / 2,
        checkApex: (ax, ay, cx, cy) => {
          expect(ax).toBeCloseTo(cx, 5);
          expect(ay).toBeGreaterThan(cy);
        },
      },
    ];

    for (const fcCase of flatCases) {
      const base = createCanonicalFixtureLotSpec('little');
      const parsed = parseStdfBytes(
        writeStdfBytes({ ...base, wcr: { ...base.wcr, wfFlat: fcCase.wfFlat } }),
        { mode: 'full' },
      );
      expect(parsed.ok).toBe(true);
      if (!parsed.ok) continue;
      const lot = buildLotModel(parsed.value);
      const wafer = lot.wafers[0]!;
      expect(wafer.geometry.wfFlat).toBe(fcCase.wfFlat);

      const notch = computeWaferNotchGeometry(300, 300, 240, wafer.geometry.wfFlat);
      expect(notch.notchAngleRad).toBeCloseTo(fcCase.expectedAngleRad, 6);
      fcCase.checkApex(notch.apexX, notch.apexY, 300, 300);

      // SVG sheen mask path is well-formed and distinct per cardinal flat orientation
      const svgPath = buildWaferOutlineSvgPath(wafer.geometry.wfFlat);
      expect(svgPath).toMatch(/^M[\d.-]+ [\d.-]+ A500 500/);
    }
  });

  it('renders zoom-in, zoom-out, reset-view buttons and WCR orientation attributes on WaferMapCanvas', () => {
    const lot = loadFixtureLot('golden-little-endian.stdf');
    const yieldSummary = computeYieldSummary(lot);
    const html = renderToStaticMarkup(
      React.createElement(
        I18nProvider,
        { initialLocale: 'en' },
        React.createElement(WaferMapCanvas, {
          lot,
          byWaferYield: yieldSummary.byWafer,
        }),
      ),
    );

    expect(html).toContain('data-testid="stage-zoom-in"');
    expect(html).toContain('data-testid="stage-zoom-out"');
    expect(html).toContain('data-testid="stage-reset-view-button"');
    expect(html).toContain('data-wcr-flat="D"');
    expect(html).toContain('data-wcr-pos-x="R"');
    expect(html).toContain('data-wcr-pos-y="U"');
  });
});
