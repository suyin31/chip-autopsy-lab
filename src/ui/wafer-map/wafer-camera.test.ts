import { describe, expect, it, vi } from 'vitest';
import {
  applyCursorWheelZoom,
  applyDoubleClickCamera,
  applyKeyboardZoom,
  applyPanWithRubberBand,
  applyPinchGesture,
  cameraToViewportTransform,
  computeCameraPanBounds,
  computePinchRubberBandScale,
  computeProjectedInertiaEnd,
  computeReleaseVelocity,
  computeRelativeWrapperTransform,
  createWaferCameraController,
  DEFAULT_CAMERA_STATE,
  ensurePointWithinMargin,
  isCameraAtFit,
  MAX_CAMERA_SCALE,
  MIN_CAMERA_SCALE,
  projectRubberBand,
  stepSpring1D,
} from './wafer-camera';

describe('Wafer Camera Physics & Gesture Controller (Task R6, redesign.md §4.7, §5.5, §5.10)', () => {
  it('computes progressive rubber-band resistance matching (o * d * 0.55) / (d + 0.55 * |o|)', () => {
    expect(projectRubberBand(0, 783)).toBe(0);
    const pos = projectRubberBand(100, 783);
    const neg = projectRubberBand(-100, 783);
    const expected = (100 * 783 * 0.55) / (783 + 0.55 * 100);
    expect(pos).toBeCloseTo(expected, 6);
    expect(neg).toBeCloseTo(-expected, 6);
    expect(Math.abs(pos)).toBeLessThan(100);
  });

  it('rubber-bands pinch scale in log space outside [1, 8]', () => {
    expect(computePinchRubberBandScale(2.5)).toBeCloseTo(2.5, 6);
    const belowMin = computePinchRubberBandScale(0.5);
    expect(belowMin).toBeGreaterThan(0.5);
    expect(belowMin).toBeLessThan(MIN_CAMERA_SCALE);

    const aboveMax = computePinchRubberBandScale(12);
    expect(aboveMax).toBeGreaterThan(MAX_CAMERA_SCALE);
    expect(aboveMax).toBeLessThan(12);
  });

  it('anchors wheel zoom strictly under the cursor for both mouse wheel and ctrlKey trackpad pinch', () => {
    const stageW = 783;
    const stageH = 720;
    const fitRadiusPx = 312;
    const cursorX = 540;
    const cursorY = 250;

    // Fit-space point under cursor before zoom
    const fitX = (cursorX - DEFAULT_CAMERA_STATE.tx) / DEFAULT_CAMERA_STATE.scale;
    const fitY = (cursorY - DEFAULT_CAMERA_STATE.ty) / DEFAULT_CAMERA_STATE.scale;

    const afterWheel = applyCursorWheelZoom(DEFAULT_CAMERA_STATE, {
      deltaY: -120,
      deltaMode: 0,
      ctrlKey: false,
      pointerX: cursorX,
      pointerY: cursorY,
      stageWidth: stageW,
      stageHeight: stageH,
      fitRadiusPx,
    });

    expect(afterWheel.scale).toBeCloseTo(Math.exp(120 * 0.0015), 6);
    // Point under cursor stays fixed in screen space
    expect(fitX * afterWheel.scale + afterWheel.tx).toBeCloseTo(cursorX, 5);
    expect(fitY * afterWheel.scale + afterWheel.ty).toBeCloseTo(cursorY, 5);

    // Line-mode wheel multiplies deltaY by 16; ctrlKey uses k = 0.01
    const afterLinePinch = applyCursorWheelZoom(afterWheel, {
      deltaY: -3,
      deltaMode: 1,
      ctrlKey: true,
      pointerX: cursorX,
      pointerY: cursorY,
      stageWidth: stageW,
      stageHeight: stageH,
      fitRadiusPx,
    });
    expect(afterLinePinch.scale).toBeCloseTo(
      afterWheel.scale * Math.exp(3 * 16 * 0.01),
      5,
    );
    expect(fitX * afterLinePinch.scale + afterLinePinch.tx).toBeCloseTo(
      cursorX,
      5,
    );
    expect(fitY * afterLinePinch.scale + afterLinePinch.ty).toBeCloseTo(
      cursorY,
      5,
    );
  });

  it('anchors two-pointer pinch centroid while panning and rubber-banding scale', () => {
    const startCam = { scale: 1.5, tx: -100, ty: -80 };
    const nextCam = applyPinchGesture({
      startCamera: startCam,
      startCentroidX: 350,
      startCentroidY: 320,
      startDistance: 120,
      currentCentroidX: 380,
      currentCentroidY: 340,
      currentDistance: 240,
      stageWidth: 783,
      stageHeight: 720,
      fitRadiusPx: 312,
    });

    expect(nextCam.scale).toBeCloseTo(3.0, 5);
    const fitPtX = (350 - startCam.tx) / startCam.scale;
    const fitPtY = (320 - startCam.ty) / startCam.scale;
    expect(fitPtX * nextCam.scale + nextCam.tx).toBeCloseTo(380, 4);
    expect(fitPtY * nextCam.scale + nextCam.ty).toBeCloseTo(340, 4);
  });

  it('projects Apple 0.998 inertia and chooses spring-camera within bounds and spring-throw past bounds', () => {
    const samples = [
      { x: 100, y: 200, timeMs: 10 },
      { x: 130, y: 200, timeMs: 30 },
      { x: 160, y: 200, timeMs: 50 },
      { x: 190, y: 200, timeMs: 70 },
    ];
    const vel = computeReleaseVelocity(samples, 75);
    expect(vel.vx).toBeCloseTo(1500, 1);
    expect(vel.vy).toBeCloseTo(0, 1);

    // Projected endpoint = pos + (v / 1000) * 0.998 / (1 - 0.998)
    const projected = computeProjectedInertiaEnd(0, 1000);
    expect(projected).toBeCloseTo((1000 / 1000) * (0.998 / 0.002), 4); // 499 px

    // Stale samples (> 100 ms old) yield zero velocity
    expect(computeReleaseVelocity(samples, 250)).toEqual({ vx: 0, vy: 0 });

    const bounds = computeCameraPanBounds(1, 783, 720, 312);
    expect(bounds.minTx).toBeCloseTo(-391.5, 5);
    expect(bounds.maxTx).toBeCloseTo(391.5, 5);

    const rubberPanned = applyPanWithRubberBand(
      { scale: 1, tx: 500, ty: 0 },
      783,
      720,
      312,
    );
    expect(rubberPanned.tx).toBeGreaterThan(391.5);
    expect(rubberPanned.tx).toBeLessThan(500);
  });

  it('steps analytical 1D spring smoothly to target and handles double-click reset vs 2.5x zoom', () => {
    let pos = 0;
    let vel = 800;
    for (let i = 0; i < 60; i += 1) {
      const next = stepSpring1D(pos, vel, 200, { stiffness: 170, damping: 26 }, 1 / 60);
      pos = next.position;
      vel = next.velocity;
    }
    expect(pos).toBeCloseTo(200, 1);
    expect(Math.abs(vel)).toBeLessThan(1);

    // At fit -> double-click zooms 2.5x about point
    expect(isCameraAtFit(DEFAULT_CAMERA_STATE)).toBe(true);
    const zoomTarget = applyDoubleClickCamera(DEFAULT_CAMERA_STATE, {
      pointerX: 400,
      pointerY: 360,
      stageWidth: 783,
      stageHeight: 720,
      fitRadiusPx: 312,
    });
    expect(zoomTarget.scale).toBeCloseTo(2.5, 5);
    expect(400 * zoomTarget.scale + zoomTarget.tx).toBeCloseTo(400 * 2.5 + zoomTarget.tx, 5);
    expect(((400 - 0) / 1) * zoomTarget.scale + zoomTarget.tx).toBeCloseTo(400, 5);

    // Zoomed -> double-click resets to fit
    expect(isCameraAtFit(zoomTarget)).toBe(false);
    const resetTarget = applyDoubleClickCamera(zoomTarget, {
      pointerX: 400,
      pointerY: 360,
      stageWidth: 783,
      stageHeight: 720,
      fitRadiusPx: 312,
    });
    expect(resetTarget).toEqual(DEFAULT_CAMERA_STATE);
  });

  it('maps camera + raster state cleanly and triggers re-raster 120 ms after settling at scale > 2 without React renders', () => {
    vi.useFakeTimers();
    try {
      const wrapperTransforms: string[] = [];
      const reRasters: Array<{ scale: number; tx: number; ty: number }> = [];
      const overlayFrames: number[] = [];

      let nowMs = 1000;
      const rafQueue: { cb: FrameRequestCallback | null } = { cb: null };

      const controller = createWaferCameraController({
        getStageMetrics: () => ({
          stageWidth: 783,
          stageHeight: 720,
          fitRadiusPx: 312,
        }),
        getPrefersReducedMotion: () => false,
        onTransformFrame: ({ wrapperCssTransform, camera }) => {
          wrapperTransforms.push(wrapperCssTransform);
          overlayFrames.push(camera.scale);
        },
        onSettleReRaster: (camera) => {
          reRasters.push({ ...camera });
        },
        requestFrame: (cb) => {
          rafQueue.cb = cb;
          return 1;
        },
        cancelFrame: () => {
          rafQueue.cb = null;
        },
        now: () => nowMs,
      });

      // Zoom past 2x via wheel
      controller.handleWheel({
        deltaY: -600,
        deltaMode: 0,
        ctrlKey: false,
        pointerX: 391.5,
        pointerY: 360,
      });

      const zoomedCam = controller.getCamera();
      expect(zoomedCam.scale).toBeGreaterThan(2.4);
      expect(reRasters).toHaveLength(0);

      // Before settle: wrapper transform scales relative to fit (raster = 1, 0, 0)
      expect(wrapperTransforms.at(-1)).toContain(
        `scale(${Number(zoomedCam.scale.toFixed(5))})`,
      );

      // Advance < 120 ms -> still not re-rastered
      vi.advanceTimersByTime(100);
      expect(reRasters).toHaveLength(0);

      // Advance past 120 ms -> triggers settle re-raster AND resets wrapper CSS transform to identity!
      vi.advanceTimersByTime(25);
      expect(reRasters).toHaveLength(1);
      expect(reRasters[0]!.scale).toBeCloseTo(zoomedCam.scale, 5);
      expect(wrapperTransforms.at(-1)).toBe('translate3d(0px, 0px, 0) scale(1)');

      // Relative wrapper math check
      const rel = computeRelativeWrapperTransform(zoomedCam, zoomedCam);
      expect(rel.scale).toBeCloseTo(1, 6);
      expect(rel.tx).toBeCloseTo(0, 6);
      expect(rel.ty).toBeCloseTo(0, 6);

      // Flick coasting via pointer drag + release
      controller.handlePointerDown({
        pointerId: 1,
        pointerType: 'mouse',
        button: 0,
        shiftKey: false,
        x: 300,
        y: 300,
        timeMs: nowMs,
      });
      nowMs += 16;
      controller.handlePointerMove({
        pointerId: 1,
        x: 340,
        y: 300,
        timeMs: nowMs,
      });
      nowMs += 16;
      controller.handlePointerMove({
        pointerId: 1,
        x: 390,
        y: 300,
        timeMs: nowMs,
      });
      const txAtRelease = controller.getCamera().tx;
      controller.handlePointerUp({
        pointerId: 1,
        x: 390,
        y: 300,
        timeMs: nowMs,
      });

      expect(rafQueue.cb).not.toBeNull();
      // Step rAF -> camera coasts forward in +X!
      for (let step = 0; step < 5 && rafQueue.cb !== null; step += 1) {
        nowMs += 16;
        const cb = rafQueue.cb;
        rafQueue.cb = null;
        cb(nowMs);
      }
      expect(controller.getCamera().tx).toBeGreaterThan(txAtRelease);

      controller.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it('supports keyboard zoom (+/-) and 48 px inner-margin auto-pan on arrow die step', () => {
    const zoomed = applyKeyboardZoom(DEFAULT_CAMERA_STATE, 1.5, {
      anchorX: 500,
      anchorY: 300,
      stageWidth: 783,
      stageHeight: 720,
      fitRadiusPx: 312,
    });
    expect(zoomed.scale).toBeCloseTo(1.5, 5);
    expect(500 * zoomed.scale + zoomed.tx).toBeGreaterThan(0);

    // Ensure a die at fit (760, 360) when zoomed to scale 2 is panned inside the 48 px inner margin
    const cam2x = { scale: 2, tx: -391.5, ty: -360 };
    const panned = ensurePointWithinMargin(cam2x, {
      fitX: 760,
      fitY: 360,
      marginPx: 48,
      stageWidth: 783,
      stageHeight: 720,
      fitRadiusPx: 312,
    });
    const screenX = 760 * panned.scale + panned.tx;
    expect(screenX).toBeLessThanOrEqual(783 - 48 + 1e-4);

    const vp = cameraToViewportTransform(DEFAULT_CAMERA_STATE, 783, 720);
    expect(vp).toEqual({ scale: 1, panX: 0, panY: 0 });
  });
});
