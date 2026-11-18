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
  computeWheelZoomFactor,
  computeRelativeWrapperTransform,
  createWaferCameraController,
  DEFAULT_CAMERA_STATE,
  ensurePointWithinMargin,
  isCameraAtFit,
  MAX_CAMERA_SCALE,
  MIN_CAMERA_SCALE,
  projectRubberBand,
  stepInertia1D,
  stepSpring1D,
  type WaferCameraController,
} from './wafer-camera';

const METRICS = { stageWidth: 783, stageHeight: 720, fitRadiusPx: 312 } as const;

function makeController(reducedMotion = false): {
  readonly controller: WaferCameraController;
  readonly flush: (maxFrames?: number) => number;
  readonly hasFrame: () => boolean;
} {
  let nowMs = 1000;
  let pending: FrameRequestCallback | null = null;
  const controller = createWaferCameraController({
    getStageMetrics: () => METRICS,
    getPrefersReducedMotion: () => reducedMotion,
    onTransformFrame: () => {},
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

describe('Premium P30 zoom and pan motion (premium §8.4, §8.5)', () => {
  it('rubber-bands drag overshoot with b x (1 - 1 / (x x 0.55 / b + 1)), b = stage half-size', () => {
    const bounds = computeCameraPanBounds(2, 783, 720, 312);
    const overshoot = 120;
    const b = 783 / 2;
    const expected = b * (1 - 1 / ((overshoot * 0.55) / b + 1));
    const banded = applyPanWithRubberBand(
      { scale: 2, tx: bounds.maxTx + overshoot, ty: bounds.minTy },
      783,
      720,
      312,
    );
    expect(banded.tx - bounds.maxTx).toBeCloseTo(expected, 6);
    expect(projectRubberBand(overshoot, b)).toBeCloseTo(expected, 6);
  });

  it('springs a discrete wheel notch toward exp(-deltaY x 0.0015), anchored at the cursor', () => {
    const { controller, flush } = makeController();
    controller.handleWheel({ deltaY: -240, deltaMode: 0, ctrlKey: false, pointerX: 540, pointerY: 260 });
    // Not applied in the same call: the camera springs toward the target
    expect(controller.getCamera().scale).toBeCloseTo(1, 6);
    // A second notch compounds on the running target
    flush(3);
    controller.handleWheel({ deltaY: -240, deltaMode: 0, ctrlKey: false, pointerX: 540, pointerY: 260 });
    expect(flush()).toBeGreaterThan(5);
    const cam = controller.getCamera();
    expect(cam.scale).toBeCloseTo(Math.exp(480 * 0.0015), 3);
    expect(540 * cam.scale + cam.tx).toBeCloseTo(540, 0);
    expect(260 * cam.scale + cam.ty).toBeCloseTo(260, 0);
    controller.dispose();
  });

  it('applies ctrlKey trackpad pinch 1:1 with exp(-deltaY x 0.01), and wheel jumps under reduced motion', () => {
    expect(computeWheelZoomFactor({ deltaY: -10, deltaMode: 0, ctrlKey: true, stageHeight: 720 })).toBeCloseTo(
      Math.exp(0.1),
      9,
    );
    const pinch = makeController();
    pinch.controller.handleWheel({ deltaY: -10, deltaMode: 0, ctrlKey: true, pointerX: 400, pointerY: 300 });
    expect(pinch.controller.getCamera().scale).toBeCloseTo(Math.exp(0.1), 6);
    expect(pinch.hasFrame()).toBe(false);

    const reduced = makeController(true);
    reduced.controller.handleWheel({ deltaY: -240, deltaMode: 0, ctrlKey: false, pointerX: 400, pointerY: 300 });
    expect(reduced.controller.getCamera().scale).toBeCloseTo(Math.exp(240 * 0.0015), 6);
    expect(reduced.hasFrame()).toBe(false);
  });

  it('decays release inertia by 0.998 per ms and stops below 0.02 px/ms', () => {
    const step = stepInertia1D(0, 1000, 16);
    expect(step.velocity).toBeCloseTo(1000 * Math.pow(0.998, 16), 6);
    expect(step.position).toBeCloseTo((1 * (Math.pow(0.998, 16) - 1)) / Math.log(0.998), 6);
    expect(stepInertia1D(0, 20.2, 16).stopped).toBe(true);
    expect(stepInertia1D(0, 40, 16).stopped).toBe(false);

    // Integrating to rest lands on the projected end point
    let pos = 0;
    let vel = 1000;
    for (let i = 0; i < 2000; i += 1) {
      const next = stepInertia1D(pos, vel, 16);
      pos = next.position;
      vel = next.velocity;
      if (next.stopped) break;
    }
    expect(vel).toBe(0);
    expect(pos).toBeGreaterThan(computeProjectedInertiaEnd(0, 1000) - 12);
    expect(pos).toBeLessThanOrEqual(computeProjectedInertiaEnd(0, 1000));
  });

  it('pans only at zoom > 1, and reduced motion clamps a drag without rubber-band or inertia', () => {
    const { controller, hasFrame } = makeController();
    controller.handlePointerDown({ pointerId: 1, pointerType: 'mouse', button: 0, shiftKey: false, x: 300, y: 300, timeMs: 0 });
    expect(controller.handlePointerMove({ pointerId: 1, x: 360, y: 300, timeMs: 16 })).toBe(false);
    expect(controller.getCamera()).toEqual(DEFAULT_CAMERA_STATE);
    controller.handlePointerUp({ pointerId: 1, x: 360, y: 300, timeMs: 20 });

    const reduced = makeController(true);
    reduced.controller.setCameraImmediate({ scale: 2, tx: -391.5, ty: -360 });
    const bounds = computeCameraPanBounds(2, 783, 720, 312);
    reduced.controller.handlePointerDown({ pointerId: 2, pointerType: 'mouse', button: 0, shiftKey: false, x: 300, y: 300, timeMs: 0 });
    reduced.controller.handlePointerMove({ pointerId: 2, x: 310, y: 300, timeMs: 8 });
    reduced.controller.handlePointerMove({ pointerId: 2, x: 2000, y: 300, timeMs: 16 });
    expect(reduced.controller.getCamera().tx).toBeCloseTo(bounds.maxTx, 6);
    reduced.controller.handlePointerUp({ pointerId: 2, x: 2000, y: 300, timeMs: 18 });
    expect(reduced.hasFrame()).toBe(false);
    expect(hasFrame()).toBe(false);
  });

  it('returns an out-of-bounds release to the bound with spring-throw', () => {
    const { controller, flush } = makeController();
    controller.setCameraImmediate({ scale: 2, tx: -391.5, ty: -360 });
    const bounds = computeCameraPanBounds(2, 783, 720, 312);
    controller.handlePointerDown({ pointerId: 1, pointerType: 'mouse', button: 0, shiftKey: false, x: 300, y: 300, timeMs: 0 });
    controller.handlePointerMove({ pointerId: 1, x: 310, y: 300, timeMs: 8 });
    controller.handlePointerMove({ pointerId: 1, x: 1400, y: 300, timeMs: 400 });
    expect(controller.getCamera().tx).toBeGreaterThan(bounds.maxTx);
    controller.handlePointerUp({ pointerId: 1, x: 1400, y: 300, timeMs: 600 });
    expect(flush()).toBeGreaterThan(3);
    expect(controller.getCamera().tx).toBeCloseTo(bounds.maxTx, 1);
  });

  it('clamps a reduced-motion pinch to [1, 8] without rubber-band', () => {
    const pinch = applyPinchGesture(
      {
        ...METRICS,
        startCamera: DEFAULT_CAMERA_STATE,
        startCentroidX: 391.5,
        startCentroidY: 360,
        startDistance: 200,
        currentCentroidX: 391.5,
        currentCentroidY: 360,
        currentDistance: 100,
      },
      false,
    );
    expect(pinch.scale).toBe(1);
  });

  it('double-click zooms 2.5x at scale 1 even off-centre, otherwise fits', () => {
    const offCentre = applyDoubleClickCamera({ scale: 1, tx: 20, ty: 0 }, { ...METRICS, pointerX: 300, pointerY: 300 });
    expect(offCentre.scale).toBeCloseTo(2.5, 6);
    expect(applyDoubleClickCamera({ scale: 1.6, tx: -100, ty: -80 }, { ...METRICS, pointerX: 300, pointerY: 300 })).toEqual(
      DEFAULT_CAMERA_STATE,
    );
  });
});

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

    // Pause > 100 ms after an earlier drag then a single sample does NOT fling from the old sample
    const pausedSamples = [
      { x: 100, y: 200, timeMs: 10 },
      { x: 400, y: 200, timeMs: 40 },
      { x: 401, y: 200, timeMs: 900 },
    ];
    expect(computeReleaseVelocity(pausedSamples, 905)).toEqual({ vx: 0, vy: 0 });

    // Sub-4 ms burst samples clamp dt to 4 ms rather than dropping velocity to zero
    const burstSamples = [
      { x: 100, y: 200, timeMs: 500 },
      { x: 112, y: 200, timeMs: 501 },
    ];
    expect(computeReleaseVelocity(burstSamples, 502).vx).toBeGreaterThan(0);

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

      // Zoom past 2x via wheel, then let `spring-camera` settle (premium §8.5)
      controller.handleWheel({
        deltaY: -600,
        deltaMode: 0,
        ctrlKey: false,
        pointerX: 391.5,
        pointerY: 360,
      });
      for (let step = 0; step < 240 && rafQueue.cb !== null; step += 1) {
        nowMs += 16;
        const cb = rafQueue.cb;
        rafQueue.cb = null;
        cb(nowMs);
      }

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
