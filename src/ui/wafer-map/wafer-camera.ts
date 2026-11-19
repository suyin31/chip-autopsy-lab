/**
 * Pure Wafer Stage Camera Physics & Imperative Gesture Controller
 * (`src/ui/wafer-map/wafer-camera.ts`).
 *
 * Implements `premium.md` §8.4, §8.5 (and `redesign.md` §4.7, §5.10) without React imports:
 * - Discrete mouse wheel: target scale x `exp(-deltaY x 0.0015)` anchored at the cursor, reached
 *   on `spring-camera`; `ctrlKey` trackpad pinch `exp(-deltaY x 0.01)` applied 1:1 (no spring)
 * - Two-pointer pinch centroid zoom + pan with log-space rubber-banding outside `[1, 8]`,
 *   returned on release by `spring-throw`
 * - One-pointer drag pan at zoom > 1 (4 px threshold, 1:1 grab offset, 5-sample <= 100 ms
 *   velocity); past the bounds the offset follows `b x (1 - 1 / (x x 0.55 / b + 1))`, b = stage half-size
 * - Release inertia: velocity x `0.998` per ms until < `0.02 px/ms`; an out-of-bounds end point
 *   is returned by `spring-throw` (`260 / 22`) keeping the release velocity
 * - Double-click / double-tap: `2.5x` about the point at scale 1, otherwise fit (`spring-camera`)
 * - Reduced motion: wheel and double-click jump, no inertia, bounds clamp without rubber-band
 * - CSS `transform: translate3d(tx, ty, 0) scale(s)` relative to active base raster, plus
 *   `120 ms` settle re-raster at `scale > 2` and instant fit-raster restore when panning outside
 */

import { MOTION_TOKENS, SPRING_TOKENS } from '@/ui/tokens';
import type { ViewportTransform } from './wafer-geometry';

export interface CameraState {
  readonly scale: number;
  readonly tx: number;
  readonly ty: number;
}

export const DEFAULT_CAMERA_STATE: CameraState = {
  scale: 1,
  tx: 0,
  ty: 0,
};

export const MIN_CAMERA_SCALE = 1 as const;
export const MAX_CAMERA_SCALE = 8 as const;
export const DOUBLE_CLICK_ZOOM_SCALE = 2.5 as const;
export const BUTTON_ZOOM_STEP_FACTOR = 1.5 as const;
export const DRAG_THRESHOLD_PX = 4 as const;
export const RUBBER_BAND_CONSTANT = 0.55 as const;
export const SETTLE_RERASTER_DELAY_MS = 120 as const;
export const SETTLE_RERASTER_SCALE_MIN = 2 as const;
/** Wheel zoom factor per `deltaY` px for a discrete mouse wheel (premium §8.5). */
export const WHEEL_ZOOM_K = 0.0015 as const;
/** Wheel zoom factor per `deltaY` px for a `ctrlKey` trackpad pinch (premium §8.5). */
export const PINCH_WHEEL_ZOOM_K = 0.01 as const;
/** Inertia stops once the speed falls below this (premium §8.5). */
export const INERTIA_STOP_PX_PER_MS = 0.02 as const;

export interface StageCameraMetrics {
  readonly stageWidth: number;
  readonly stageHeight: number;
  readonly fitRadiusPx: number;
}

export interface CameraPanBounds {
  readonly minTx: number;
  readonly maxTx: number;
  readonly minTy: number;
  readonly maxTy: number;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/**
 * Progressive boundary resistance (premium §8.5): `b x (1 - 1 / (x x 0.55 / b + 1))`, the same
 * curve as `(x * b * 0.55) / (b + 0.55 * |x|)`, mirrored for negative overshoot.
 */
export function projectRubberBand(
  overshoot: number,
  dimension: number,
  constant: number = RUBBER_BAND_CONSTANT,
): number {
  if (!Number.isFinite(overshoot) || overshoot === 0) {
    return 0;
  }
  const safeDim = Math.max(1, Math.abs(dimension));
  return (
    (overshoot * safeDim * constant) /
    (safeDim + constant * Math.abs(overshoot))
  );
}

/**
 * Rubber-bands pinch scale in log space outside `[1, 8]` (`redesign.md` §5.5).
 */
export function computePinchRubberBandScale(rawScale: number): number {
  const safeScale = Math.max(0.05, Math.min(64, rawScale));
  const logS = Math.log(safeScale);
  const logMin = Math.log(MIN_CAMERA_SCALE);
  const logMax = Math.log(MAX_CAMERA_SCALE);
  if (logS < logMin) {
    const over = logS - logMin;
    return Math.exp(logMin + projectRubberBand(over, 1, RUBBER_BAND_CONSTANT));
  }
  if (logS > logMax) {
    const over = logS - logMax;
    return Math.exp(logMax + projectRubberBand(over, 1, RUBBER_BAND_CONSTANT));
  }
  return safeScale;
}

/**
 * Computes legal pan bounds `[minTx, maxTx] x [minTy, maxTy]` so the wafer never leaves
 * the stage by more than 50% of its diameter at `scale = 1`, while allowing every perimeter
 * die to be panned to the stage centre at `scale > 1` (`redesign.md` §5.5).
 */
export function computeCameraPanBounds(
  scale: number,
  stageWidth: number,
  stageHeight: number,
  fitRadiusPx: number,
): CameraPanBounds {
  const safeW = Math.max(1, stageWidth);
  const safeH = Math.max(1, stageHeight);
  const scaledR = Math.max(1, fitRadiusPx * scale);
  const halfRangeX = Math.max(safeW / 2, scaledR);
  const halfRangeY = Math.max(safeH / 2, scaledR);
  const baseShiftX = (safeW / 2) * scale;
  const baseShiftY = (safeH / 2) * scale;

  return {
    minTx: safeW / 2 - halfRangeX - baseShiftX,
    maxTx: safeW / 2 + halfRangeX - baseShiftX,
    minTy: safeH / 2 - halfRangeY - baseShiftY,
    maxTy: safeH / 2 + halfRangeY - baseShiftY,
  };
}

export function clampCameraToBounds(
  camera: CameraState,
  stageWidth: number,
  stageHeight: number,
  fitRadiusPx: number,
): CameraState {
  const scale = clamp(camera.scale, MIN_CAMERA_SCALE, MAX_CAMERA_SCALE);
  const bounds = computeCameraPanBounds(
    scale,
    stageWidth,
    stageHeight,
    fitRadiusPx,
  );
  return {
    scale,
    tx: clamp(camera.tx, bounds.minTx, bounds.maxTx),
    ty: clamp(camera.ty, bounds.minTy, bounds.maxTy),
  };
}

export function applyPanWithRubberBand(
  rawCamera: CameraState,
  stageWidth: number,
  stageHeight: number,
  fitRadiusPx: number,
): CameraState {
  const bounds = computeCameraPanBounds(
    rawCamera.scale,
    stageWidth,
    stageHeight,
    fitRadiusPx,
  );
  // b = stage half-size per axis (premium §8.5)
  const bX = stageWidth / 2;
  const bY = stageHeight / 2;
  let tx = rawCamera.tx;
  if (tx < bounds.minTx) {
    tx = bounds.minTx + projectRubberBand(tx - bounds.minTx, bX);
  } else if (tx > bounds.maxTx) {
    tx = bounds.maxTx + projectRubberBand(tx - bounds.maxTx, bX);
  }

  let ty = rawCamera.ty;
  if (ty < bounds.minTy) {
    ty = bounds.minTy + projectRubberBand(ty - bounds.minTy, bY);
  } else if (ty > bounds.maxTy) {
    ty = bounds.maxTy + projectRubberBand(ty - bounds.maxTy, bY);
  }

  return { scale: rawCamera.scale, tx, ty };
}

export interface WheelZoomInput extends StageCameraMetrics {
  readonly deltaY: number;
  readonly deltaMode: number;
  readonly ctrlKey: boolean;
  readonly pointerX: number;
  readonly pointerY: number;
}

/** Wheel zoom factor `exp(-deltaY x k)`; `deltaMode` lines x 16, pages x stage height. */
export function computeWheelZoomFactor(
  input: Pick<WheelZoomInput, 'deltaY' | 'deltaMode' | 'ctrlKey' | 'stageHeight'>,
): number {
  const modeMultiplier =
    input.deltaMode === 1
      ? 16
      : input.deltaMode === 2
        ? Math.max(240, input.stageHeight)
        : 1;
  const normalizedDeltaY = input.deltaY * modeMultiplier;
  const k = input.ctrlKey ? PINCH_WHEEL_ZOOM_K : WHEEL_ZOOM_K;
  return Math.exp(-normalizedDeltaY * k);
}

/**
 * Applies cursor-anchored wheel zoom (premium §8.5):
 * `scale *= exp(-deltaY * k)` with `k = 0.0015` (`0.01` when `ctrlKey`), `deltaMode === 1` x `16`.
 * `fromScale` overrides the scale the factor multiplies (the running wheel target), while the
 * anchor stays the fit point under the cursor in the presented `current` camera.
 */
export function applyCursorWheelZoom(
  current: CameraState,
  input: WheelZoomInput,
  fromScale: number = current.scale,
): CameraState {
  const nextScale = clamp(
    fromScale * computeWheelZoomFactor(input),
    MIN_CAMERA_SCALE,
    MAX_CAMERA_SCALE,
  );

  const fitX = (input.pointerX - current.tx) / current.scale;
  const fitY = (input.pointerY - current.ty) / current.scale;
  const nextTx = input.pointerX - fitX * nextScale;
  const nextTy = input.pointerY - fitY * nextScale;

  return clampCameraToBounds(
    { scale: nextScale, tx: nextTx, ty: nextTy },
    input.stageWidth,
    input.stageHeight,
    input.fitRadiusPx,
  );
}

export interface PinchGestureInput extends StageCameraMetrics {
  readonly startCamera: CameraState;
  readonly startCentroidX: number;
  readonly startCentroidY: number;
  readonly startDistance: number;
  readonly currentCentroidX: number;
  readonly currentCentroidY: number;
  readonly currentDistance: number;
}

/**
 * Two-pointer pinch, 1:1 about the centroid. `rubberBand = false` (reduced motion) clamps
 * scale and pan to the bounds instead of rubber-banding (premium §8.5).
 */
export function applyPinchGesture(
  input: PinchGestureInput,
  rubberBand = true,
): CameraState {
  const safeStartDist = Math.max(1, input.startDistance);
  const ratio = Math.max(0.05, input.currentDistance) / safeStartDist;
  const rawScale = input.startCamera.scale * ratio;
  const effectiveScale = rubberBand
    ? computePinchRubberBandScale(rawScale)
    : clamp(rawScale, MIN_CAMERA_SCALE, MAX_CAMERA_SCALE);

  const fitX =
    (input.startCentroidX - input.startCamera.tx) / input.startCamera.scale;
  const fitY =
    (input.startCentroidY - input.startCamera.ty) / input.startCamera.scale;
  const rawTx = input.currentCentroidX - fitX * effectiveScale;
  const rawTy = input.currentCentroidY - fitY * effectiveScale;

  if (!rubberBand) {
    return clampCameraToBounds(
      { scale: effectiveScale, tx: rawTx, ty: rawTy },
      input.stageWidth,
      input.stageHeight,
      input.fitRadiusPx,
    );
  }
  return applyPanWithRubberBand(
    { scale: effectiveScale, tx: rawTx, ty: rawTy },
    input.stageWidth,
    input.stageHeight,
    input.fitRadiusPx,
  );
}

export interface PointerVelocitySample {
  readonly x: number;
  readonly y: number;
  readonly timeMs: number;
}

/**
 * Computes release velocity `(vx, vy)` in `px/s` from the recent `<= 100 ms` pointer window.
 */
export function computeReleaseVelocity(
  samples: readonly PointerVelocitySample[],
  releaseTimeMs: number,
): { readonly vx: number; readonly vy: number } {
  if (samples.length < 2) {
    return { vx: 0, vy: 0 };
  }
  const latest = samples[samples.length - 1]!;
  if (releaseTimeMs - latest.timeMs > 100) {
    return { vx: 0, vy: 0 };
  }
  let earliest: PointerVelocitySample | null = null;
  for (let i = 0; i < samples.length - 1; i += 1) {
    const candidate = samples[i]!;
    if (
      releaseTimeMs - candidate.timeMs <= 100 &&
      latest.timeMs - candidate.timeMs <= 100
    ) {
      earliest = candidate;
      break;
    }
  }
  if (earliest === null) {
    return { vx: 0, vy: 0 };
  }
  const rawDtMs = latest.timeMs - earliest.timeMs;
  if (rawDtMs < 0) {
    return { vx: 0, vy: 0 };
  }
  const dx = latest.x - earliest.x;
  const dy = latest.y - earliest.y;
  if (dx === 0 && dy === 0) {
    return { vx: 0, vy: 0 };
  }
  const effectiveDtMs = Math.max(4, rawDtMs);
  const maxVel = 6000;
  return {
    vx: clamp((dx / effectiveDtMs) * 1000, -maxVel, maxVel),
    vy: clamp((dy / effectiveDtMs) * 1000, -maxVel, maxVel),
  };
}

/**
 * Apple scroll momentum projection (`redesign.md` §2.6, §5.5):
 * `pos + (v / 1000) * decel / (1 - decel)` with `decel = 0.998`.
 */
export function computeProjectedInertiaEnd(
  position: number,
  velocityPxPerSec: number,
  decelPerMs: number = MOTION_TOKENS.decelPerMs,
): number {
  return position + (velocityPxPerSec / 1000) * (decelPerMs / (1 - decelPerMs));
}

/**
 * One inertia step (premium §8.5): velocity x `0.998` per ms, integrated exactly over `dtMs`.
 * Returns `stopped` once the speed is below `0.02 px/ms`.
 */
export function stepInertia1D(
  position: number,
  velocityPxPerSec: number,
  dtMs: number,
  decelPerMs: number = MOTION_TOKENS.decelPerMs,
): { readonly position: number; readonly velocity: number; readonly stopped: boolean } {
  const safeDt = clamp(dtMs, 0, 64);
  const decay = Math.pow(decelPerMs, safeDt);
  const vPerMs = velocityPxPerSec / 1000;
  const nextPosition = position + (vPerMs * (decay - 1)) / Math.log(decelPerMs);
  const nextVelocity = velocityPxPerSec * decay;
  if (Math.abs(nextVelocity) / 1000 < INERTIA_STOP_PX_PER_MS) {
    return { position: nextPosition, velocity: 0, stopped: true };
  }
  return { position: nextPosition, velocity: nextVelocity, stopped: false };
}

export interface SpringParams1D {
  readonly stiffness: number;
  readonly damping: number;
  readonly mass?: number;
}

export interface SpringStepResult1D {
  readonly position: number;
  readonly velocity: number;
  readonly settled: boolean;
}

/**
 * Exact analytical ODE integrator for a 1D damped harmonic oscillator (`m = 1`),
 * unconditionally stable across arbitrary `dtSec` frame intervals.
 */
export function stepSpring1D(
  position: number,
  velocity: number,
  target: number,
  params: SpringParams1D,
  dtSec: number,
  positionEpsilon = 0.05,
  velocityEpsilon = 0.5,
): SpringStepResult1D {
  const safeDt = clamp(dtSec, 0, 0.064);
  if (safeDt === 0) {
    return { position, velocity, settled: false };
  }
  const mass = params.mass ?? 1;
  const x0 = position - target;
  const v0 = velocity;

  const omega0 = Math.sqrt(params.stiffness / mass);
  const zeta = params.damping / (2 * Math.sqrt(params.stiffness * mass));

  let xNext: number;
  let vNext: number;

  if (zeta < 1 - 1e-5) {
    const omegaD = omega0 * Math.sqrt(1 - zeta * zeta);
    const envelope = Math.exp(-zeta * omega0 * safeDt);
    const cos = Math.cos(omegaD * safeDt);
    const sin = Math.sin(omegaD * safeDt);
    const bCoeff = (v0 + zeta * omega0 * x0) / omegaD;
    xNext = envelope * (x0 * cos + bCoeff * sin);
    vNext =
      envelope *
      ((bCoeff * omegaD - zeta * omega0 * x0) * cos -
        (x0 * omegaD + zeta * omega0 * bCoeff) * sin);
  } else if (zeta > 1 + 1e-5) {
    const root = Math.sqrt(zeta * zeta - 1);
    const r1 = -omega0 * (zeta - root);
    const r2 = -omega0 * (zeta + root);
    const c2 = (v0 - r1 * x0) / (r2 - r1);
    const c1 = x0 - c2;
    const e1 = Math.exp(r1 * safeDt);
    const e2 = Math.exp(r2 * safeDt);
    xNext = c1 * e1 + c2 * e2;
    vNext = c1 * r1 * e1 + c2 * r2 * e2;
  } else {
    const envelope = Math.exp(-omega0 * safeDt);
    const bCoeff = v0 + omega0 * x0;
    xNext = envelope * (x0 + bCoeff * safeDt);
    vNext = envelope * (v0 - bCoeff * omega0 * safeDt);
  }

  if (Math.abs(xNext) <= positionEpsilon && Math.abs(vNext) <= velocityEpsilon) {
    return { position: target, velocity: 0, settled: true };
  }
  return {
    position: target + xNext,
    velocity: vNext,
    settled: false,
  };
}

export function isCameraAtFit(camera: CameraState): boolean {
  return (
    Math.abs(camera.scale - 1) < 0.01 && Math.hypot(camera.tx, camera.ty) < 1.5
  );
}

/** Double-click / double-tap (premium §8.5): at scale 1, 2.5x about the point; otherwise fit. */
export function applyDoubleClickCamera(
  current: CameraState,
  input: StageCameraMetrics & { readonly pointerX: number; readonly pointerY: number },
): CameraState {
  if (Math.abs(current.scale - 1) >= 0.01) {
    return DEFAULT_CAMERA_STATE;
  }
  const targetScale = DOUBLE_CLICK_ZOOM_SCALE;
  const fitX = (input.pointerX - current.tx) / current.scale;
  const fitY = (input.pointerY - current.ty) / current.scale;
  return clampCameraToBounds(
    {
      scale: targetScale,
      tx: input.pointerX - fitX * targetScale,
      ty: input.pointerY - fitY * targetScale,
    },
    input.stageWidth,
    input.stageHeight,
    input.fitRadiusPx,
  );
}

export function applyKeyboardZoom(
  current: CameraState,
  factor: number,
  input: StageCameraMetrics & { readonly anchorX: number; readonly anchorY: number },
  fromScale: number = current.scale,
): CameraState {
  const nextScale = clamp(
    fromScale * factor,
    MIN_CAMERA_SCALE,
    MAX_CAMERA_SCALE,
  );
  if (Math.abs(nextScale - 1) < 0.005) {
    return DEFAULT_CAMERA_STATE;
  }
  const fitX = (input.anchorX - current.tx) / current.scale;
  const fitY = (input.anchorY - current.ty) / current.scale;
  return clampCameraToBounds(
    {
      scale: nextScale,
      tx: input.anchorX - fitX * nextScale,
      ty: input.anchorY - fitY * nextScale,
    },
    input.stageWidth,
    input.stageHeight,
    input.fitRadiusPx,
  );
}

export function ensurePointWithinMargin(
  current: CameraState,
  input: StageCameraMetrics & {
    readonly fitX: number;
    readonly fitY: number;
    readonly marginPx: number;
  },
): CameraState {
  const screenX = input.fitX * current.scale + current.tx;
  const screenY = input.fitY * current.scale + current.ty;
  let nextTx = current.tx;
  let nextTy = current.ty;

  if (screenX < input.marginPx) {
    nextTx += input.marginPx - screenX;
  } else if (screenX > input.stageWidth - input.marginPx) {
    nextTx -= screenX - (input.stageWidth - input.marginPx);
  }

  if (screenY < input.marginPx) {
    nextTy += input.marginPx - screenY;
  } else if (screenY > input.stageHeight - input.marginPx) {
    nextTy -= screenY - (input.stageHeight - input.marginPx);
  }

  if (nextTx === current.tx && nextTy === current.ty) {
    return current;
  }
  return clampCameraToBounds(
    { scale: current.scale, tx: nextTx, ty: nextTy },
    input.stageWidth,
    input.stageHeight,
    input.fitRadiusPx,
  );
}

/**
 * Converts `CameraState` (`transform-origin: 0 0`) to `ViewportTransform` (`center + pan`).
 */
export function cameraToViewportTransform(
  camera: CameraState,
  stageWidth: number,
  stageHeight: number,
): ViewportTransform {
  return {
    scale: camera.scale,
    panX: (stageWidth / 2) * (camera.scale - 1) + camera.tx,
    panY: (stageHeight / 2) * (camera.scale - 1) + camera.ty,
  };
}

/**
 * Computes the relative CSS transform on `cameraWrapper` (`transform-origin: 0 0`) that maps
 * a `BaseCanvas` rasterized at `rasterCamera` onto the live `camera`.
 */
export function computeRelativeWrapperTransform(
  camera: CameraState,
  rasterCamera: CameraState,
): CameraState {
  const safeRasterScale = rasterCamera.scale > 0 ? rasterCamera.scale : 1;
  const relScale = camera.scale / safeRasterScale;
  const relTx = camera.tx - rasterCamera.tx * relScale;
  const relTy = camera.ty - rasterCamera.ty * relScale;
  return {
    scale: relScale,
    tx: Math.abs(relTx) < 1e-6 ? 0 : relTx,
    ty: Math.abs(relTy) < 1e-6 ? 0 : relTy,
  };
}

export function formatWrapperCssTransform(rel: CameraState): string {
  const tx = Math.abs(rel.tx) < 1e-4 ? 0 : Number(rel.tx.toFixed(3));
  const ty = Math.abs(rel.ty) < 1e-4 ? 0 : Number(rel.ty.toFixed(3));
  const scale =
    Math.abs(rel.scale - 1) < 1e-5 ? 1 : Number(rel.scale.toFixed(5));
  return `translate3d(${tx}px, ${ty}px, 0) scale(${scale})`;
}

export interface CameraTransformFramePayload {
  readonly camera: CameraState;
  readonly rasterCamera: CameraState;
  readonly wrapperCssTransform: string;
  readonly motionActive: boolean;
}

export interface WaferCameraControllerOptions {
  readonly getStageMetrics: () => StageCameraMetrics;
  readonly getPrefersReducedMotion: () => boolean;
  readonly onTransformFrame: (payload: CameraTransformFramePayload) => void;
  readonly onSettleReRaster?: (camera: CameraState) => void;
  readonly onRestoreFitRaster?: () => void;
  readonly requestFrame?: (cb: FrameRequestCallback) => number;
  readonly cancelFrame?: (id: number) => void;
  readonly now?: () => number;
}

export interface WaferCameraController {
  getCamera(): CameraState;
  getRasterCamera(): CameraState;
  isDragging(): boolean;
  resetRasterToFit(): void;
  setCameraImmediate(next: CameraState): void;
  animateToCamera(target: CameraState): void;
  zoomByFactor(
    factor: number,
    anchor?: { readonly x: number; readonly y: number },
    animate?: boolean,
  ): void;
  resetToFit(animate?: boolean): void;
  handleWheel(input: {
    readonly deltaY: number;
    readonly deltaMode: number;
    readonly ctrlKey: boolean;
    readonly pointerX: number;
    readonly pointerY: number;
  }): void;
  handleDoubleClick(pointerX: number, pointerY: number): void;
  handlePointerDown(input: {
    readonly pointerId: number;
    readonly pointerType: string;
    readonly button: number;
    readonly shiftKey: boolean;
    readonly x: number;
    readonly y: number;
    readonly timeMs: number;
  }): boolean;
  handlePointerMove(input: {
    readonly pointerId: number;
    readonly x: number;
    readonly y: number;
    readonly timeMs: number;
  }): boolean;
  handlePointerUp(input: {
    readonly pointerId: number;
    readonly x: number;
    readonly y: number;
    readonly timeMs: number;
  }): boolean;
  dispose(): void;
}

interface AxisAnimation {
  /** `decay` runs the release inertia; `spring` runs toward `target`. */
  mode: 'spring' | 'decay';
  target: number;
  velocity: number;
  spring: SpringParams1D;
  posEps: number;
  velEps: number;
  active: boolean;
}

export function createWaferCameraController(
  options: WaferCameraControllerOptions,
): WaferCameraController {
  const reqFrame =
    options.requestFrame ??
    ((cb: FrameRequestCallback) =>
      typeof requestAnimationFrame === 'function'
        ? requestAnimationFrame(cb)
        : (setTimeout(() => cb(Date.now()), 16) as unknown as number));
  const cxlFrame =
    options.cancelFrame ??
    ((id: number) => {
      if (typeof cancelAnimationFrame === 'function') {
        cancelAnimationFrame(id);
      } else {
        clearTimeout(id);
      }
    });
  const readNow =
    options.now ??
    (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()));

  let camera: CameraState = DEFAULT_CAMERA_STATE;
  let rasterCamera: CameraState = DEFAULT_CAMERA_STATE;

  const animX: AxisAnimation = {
    mode: 'spring',
    target: 0,
    velocity: 0,
    spring: SPRING_TOKENS.camera,
    posEps: 0.05,
    velEps: 0.5,
    active: false,
  };
  const animY: AxisAnimation = {
    mode: 'spring',
    target: 0,
    velocity: 0,
    spring: SPRING_TOKENS.camera,
    posEps: 0.05,
    velEps: 0.5,
    active: false,
  };
  const animScale: AxisAnimation = {
    mode: 'spring',
    target: 1,
    velocity: 0,
    spring: SPRING_TOKENS.camera,
    posEps: 0.0005,
    velEps: 0.005,
    active: false,
  };

  let rafId: number | null = null;
  let lastFrameMs = 0;
  let settleTimer: ReturnType<typeof setTimeout> | null = null;

  const activePointers = new Map<
    number,
    { x: number; y: number; pointerType: string }
  >();
  let dragState: {
    pointerId: number;
    startX: number;
    startY: number;
    grabTxOffset: number;
    grabTyOffset: number;
    committed: boolean;
    samples: PointerVelocitySample[];
  } | null = null;

  let pinchState: {
    startCamera: CameraState;
    startCentroidX: number;
    startCentroidY: number;
    startDistance: number;
  } | null = null;

  const clearSettleTimer = (): void => {
    if (settleTimer !== null) {
      clearTimeout(settleTimer);
      settleTimer = null;
    }
  };

  const stopRaf = (): void => {
    if (rafId !== null) {
      cxlFrame(rafId);
      rafId = null;
    }
    animX.active = false;
    animY.active = false;
    animScale.active = false;
  };

  const isAnyGestureOrSpringActive = (): boolean =>
    (dragState !== null && dragState.committed) ||
    pinchState !== null ||
    animX.active ||
    animY.active ||
    animScale.active;

  const ensureRasterCoversViewport = (nextCam: CameraState): void => {
    if (rasterCamera.scale <= 1.0001) {
      return;
    }
    const { stageWidth, stageHeight } = options.getStageMetrics();
    const rel = computeRelativeWrapperTransform(nextCam, rasterCamera);
    const coversLeft = rel.tx <= 0.5;
    const coversTop = rel.ty <= 0.5;
    const coversRight = rel.tx + stageWidth * rel.scale >= stageWidth - 0.5;
    const coversBottom = rel.ty + stageHeight * rel.scale >= stageHeight - 0.5;
    if (!coversLeft || !coversTop || !coversRight || !coversBottom) {
      rasterCamera = DEFAULT_CAMERA_STATE;
      options.onRestoreFitRaster?.();
    }
  };

  const emitFrame = (): void => {
    ensureRasterCoversViewport(camera);
    const rel = computeRelativeWrapperTransform(camera, rasterCamera);
    options.onTransformFrame({
      camera,
      rasterCamera,
      wrapperCssTransform: formatWrapperCssTransform(rel),
      motionActive: isAnyGestureOrSpringActive(),
    });
  };

  const scheduleSettleCheck = (): void => {
    clearSettleTimer();
    if (isAnyGestureOrSpringActive()) {
      return;
    }
    if (camera.scale <= SETTLE_RERASTER_SCALE_MIN) {
      if (rasterCamera.scale > 1.0001) {
        rasterCamera = DEFAULT_CAMERA_STATE;
        options.onRestoreFitRaster?.();
        emitFrame();
      }
      return;
    }
    settleTimer = setTimeout(() => {
      settleTimer = null;
      if (isAnyGestureOrSpringActive()) {
        return;
      }
      if (camera.scale > SETTLE_RERASTER_SCALE_MIN) {
        rasterCamera = { ...camera };
        options.onSettleReRaster?.(rasterCamera);
        emitFrame();
      }
    }, SETTLE_RERASTER_DELAY_MS);
  };

  const tickSpring = (frameNowMs: number): void => {
    rafId = null;
    const dtSec =
      lastFrameMs > 0 ? Math.max(0.001, (frameNowMs - lastFrameMs) / 1000) : 1 / 60;
    lastFrameMs = frameNowMs;

    let nextScale = camera.scale;
    let nextTx = camera.tx;
    let nextTy = camera.ty;

    if (animScale.active) {
      const res = stepSpring1D(
        camera.scale,
        animScale.velocity,
        animScale.target,
        animScale.spring,
        dtSec,
        animScale.posEps,
        animScale.velEps,
      );
      nextScale = res.position;
      animScale.velocity = res.velocity;
      animScale.active = !res.settled;
    }

    if (animX.active && animX.mode === 'decay') {
      const res = stepInertia1D(camera.tx, animX.velocity, dtSec * 1000);
      nextTx = res.position;
      animX.velocity = res.velocity;
      animX.active = !res.stopped;
    } else if (animX.active) {
      const res = stepSpring1D(
        camera.tx,
        animX.velocity,
        animX.target,
        animX.spring,
        dtSec,
        animX.posEps,
        animX.velEps,
      );
      nextTx = res.position;
      animX.velocity = res.velocity;
      animX.active = !res.settled;
    }

    if (animY.active && animY.mode === 'decay') {
      const res = stepInertia1D(camera.ty, animY.velocity, dtSec * 1000);
      nextTy = res.position;
      animY.velocity = res.velocity;
      animY.active = !res.stopped;
    } else if (animY.active) {
      const res = stepSpring1D(
        camera.ty,
        animY.velocity,
        animY.target,
        animY.spring,
        dtSec,
        animY.posEps,
        animY.velEps,
      );
      nextTy = res.position;
      animY.velocity = res.velocity;
      animY.active = !res.settled;
    }

    camera = { scale: nextScale, tx: nextTx, ty: nextTy };
    emitFrame();

    if (animX.active || animY.active || animScale.active) {
      rafId = reqFrame(tickSpring);
    } else {
      scheduleSettleCheck();
    }
  };

  const ensureRaf = (): void => {
    clearSettleTimer();
    if (rafId === null) {
      lastFrameMs = readNow();
      rafId = reqFrame(tickSpring);
    }
  };

  const startPinchFromActivePointers = (): void => {
    const pts = Array.from(activePointers.values());
    if (pts.length < 2) {
      return;
    }
    const p0 = pts[0]!;
    const p1 = pts[1]!;
    pinchState = {
      startCamera: { ...camera },
      startCentroidX: (p0.x + p1.x) / 2,
      startCentroidY: (p0.y + p1.y) / 2,
      startDistance: Math.max(1, Math.hypot(p1.x - p0.x, p1.y - p0.y)),
    };
    dragState = null;
  };

  /**
   * Springs each axis to `target` from the presented value. A running axis hands over its
   * velocity (retarget); an idle axis starts at rest (premium §8.5 Interrupt).
   */
  const animateToCamera = (
    target: CameraState,
    spring: SpringParams1D = SPRING_TOKENS.camera,
  ): void => {
    clearSettleTimer();
    if (options.getPrefersReducedMotion()) {
      stopRaf();
      camera = target;
      emitFrame();
      scheduleSettleCheck();
      return;
    }
    for (const axis of [animScale, animX, animY]) {
      if (!axis.active) {
        axis.velocity = 0;
      }
    }
    if (
      Math.abs(target.scale - camera.scale) > 0.0005 ||
      Math.abs(animScale.velocity) > 0.005
    ) {
      animScale.mode = 'spring';
      animScale.target = target.scale;
      animScale.spring = spring;
      animScale.active = true;
    } else {
      animScale.active = false;
      animScale.velocity = 0;
    }

    if (Math.abs(target.tx - camera.tx) > 0.05 || Math.abs(animX.velocity) > 0.5) {
      animX.mode = 'spring';
      animX.target = target.tx;
      animX.spring = spring;
      animX.active = true;
    } else {
      animX.active = false;
      animX.velocity = 0;
    }

    if (Math.abs(target.ty - camera.ty) > 0.05 || Math.abs(animY.velocity) > 0.5) {
      animY.mode = 'spring';
      animY.target = target.ty;
      animY.spring = spring;
      animY.active = true;
    } else {
      animY.active = false;
      animY.velocity = 0;
    }

    if (animX.active || animY.active || animScale.active) {
      emitFrame();
      ensureRaf();
    } else {
      camera = target;
      emitFrame();
      scheduleSettleCheck();
    }
  };

  return {
    getCamera: () => camera,
    getRasterCamera: () => rasterCamera,
    isDragging: () =>
      (dragState !== null && dragState.committed) || pinchState !== null,

    resetRasterToFit() {
      rasterCamera = DEFAULT_CAMERA_STATE;
      emitFrame();
    },

    setCameraImmediate(next) {
      stopRaf();
      clearSettleTimer();
      camera = next;
      emitFrame();
      scheduleSettleCheck();
    },

    animateToCamera,

    zoomByFactor(factor, anchor, animate = true) {
      const metrics = options.getStageMetrics();
      const anchorX = anchor?.x ?? metrics.stageWidth / 2;
      const anchorY = anchor?.y ?? metrics.stageHeight / 2;
      if (!animate || options.getPrefersReducedMotion()) {
        stopRaf();
        clearSettleTimer();
        camera = applyKeyboardZoom(camera, factor, {
          ...metrics,
          anchorX,
          anchorY,
        });
        emitFrame();
        scheduleSettleCheck();
        return;
      }
      const fromScale =
        animScale.active && animScale.mode === 'spring'
          ? animScale.target
          : camera.scale;
      const target = applyKeyboardZoom(
        camera,
        factor,
        { ...metrics, anchorX, anchorY },
        fromScale,
      );
      animateToCamera(target);
    },

    resetToFit(animate = true) {
      if (!animate || options.getPrefersReducedMotion()) {
        stopRaf();
        clearSettleTimer();
        camera = DEFAULT_CAMERA_STATE;
        if (rasterCamera.scale > 1.0001) {
          rasterCamera = DEFAULT_CAMERA_STATE;
          options.onRestoreFitRaster?.();
        }
        emitFrame();
        return;
      }
      animateToCamera(DEFAULT_CAMERA_STATE);
    },

    handleWheel(input) {
      const metrics = options.getStageMetrics();
      // Trackpad pinch (`ctrlKey`) is direct 1:1 manipulation; reduced motion jumps (premium §8.5)
      if (input.ctrlKey || options.getPrefersReducedMotion()) {
        stopRaf();
        clearSettleTimer();
        camera = applyCursorWheelZoom(camera, { ...metrics, ...input });
        emitFrame();
        scheduleSettleCheck();
        return;
      }
      // Discrete wheel: consecutive notches compound on the running target, then
      // `spring-camera` carries the presented camera toward it
      const fromScale =
        animScale.active && animScale.mode === 'spring'
          ? animScale.target
          : camera.scale;
      const target = applyCursorWheelZoom(
        camera,
        { ...metrics, ...input },
        fromScale,
      );
      animateToCamera(target);
    },

    handleDoubleClick(pointerX, pointerY) {
      const metrics = options.getStageMetrics();
      const target = applyDoubleClickCamera(camera, {
        ...metrics,
        pointerX,
        pointerY,
      });
      animateToCamera(target);
    },

    handlePointerDown(input) {
      if (input.button !== 0 || input.shiftKey) {
        return false;
      }
      // Mobile 1-finger at zoom = 1 lets native page scroll run (`touch-action: pan-y`), while 2nd finger enters pinch
      activePointers.set(input.pointerId, {
        x: input.x,
        y: input.y,
        pointerType: input.pointerType,
      });

      if (activePointers.size >= 2) {
        stopRaf();
        clearSettleTimer();
        startPinchFromActivePointers();
        emitFrame();
        return true;
      }

      // Drag pan only at zoom > 1 (premium §8.5); touch at 1 also leaves page scroll to the browser
      if (camera.scale <= 1.001) {
        return false;
      }

      // Interrupt running spring immediately from presentation values
      if (rafId !== null) {
        cxlFrame(rafId);
        rafId = null;
      }
      animX.active = false;
      animY.active = false;
      animScale.active = false;
      animX.velocity = 0;
      animY.velocity = 0;
      animScale.velocity = 0;
      clearSettleTimer();

      dragState = {
        pointerId: input.pointerId,
        startX: input.x,
        startY: input.y,
        grabTxOffset: camera.tx - input.x,
        grabTyOffset: camera.ty - input.y,
        committed: false,
        samples: [{ x: input.x, y: input.y, timeMs: input.timeMs }],
      };
      return false;
    },

    handlePointerMove(input) {
      const tracked = activePointers.get(input.pointerId);
      if (tracked) {
        tracked.x = input.x;
        tracked.y = input.y;
      }

      if (pinchState !== null && activePointers.size >= 2) {
        const pts = Array.from(activePointers.values());
        const p0 = pts[0]!;
        const p1 = pts[1]!;
        const metrics = options.getStageMetrics();
        camera = applyPinchGesture(
          {
          ...metrics,
          startCamera: pinchState.startCamera,
          startCentroidX: pinchState.startCentroidX,
          startCentroidY: pinchState.startCentroidY,
          startDistance: pinchState.startDistance,
          currentCentroidX: (p0.x + p1.x) / 2,
          currentCentroidY: (p0.y + p1.y) / 2,
          currentDistance: Math.hypot(p1.x - p0.x, p1.y - p0.y),
          },
          !options.getPrefersReducedMotion(),
        );
        emitFrame();
        return true;
      }

      if (!dragState || dragState.pointerId !== input.pointerId) {
        return false;
      }

      if (!dragState.committed) {
        const dist = Math.hypot(
          input.x - dragState.startX,
          input.y - dragState.startY,
        );
        if (dist < DRAG_THRESHOLD_PX) {
          return false;
        }
        dragState.committed = true;
        // Re-anchor grab offset at commit instant so there is zero 4px snap
        dragState.grabTxOffset = camera.tx - input.x;
        dragState.grabTyOffset = camera.ty - input.y;
      }

      dragState.samples.push({
        x: input.x,
        y: input.y,
        timeMs: input.timeMs,
      });
      if (dragState.samples.length > 5) {
        dragState.samples.shift();
      }

      const metrics = options.getStageMetrics();
      const rawPan = {
        scale: camera.scale,
        tx: input.x + dragState.grabTxOffset,
        ty: input.y + dragState.grabTyOffset,
      };
      // Reduced motion: bounds clamp without rubber-band (premium §8.5)
      camera = options.getPrefersReducedMotion()
        ? clampCameraToBounds(
            rawPan,
            metrics.stageWidth,
            metrics.stageHeight,
            metrics.fitRadiusPx,
          )
        : applyPanWithRubberBand(
            rawPan,
            metrics.stageWidth,
            metrics.stageHeight,
            metrics.fitRadiusPx,
          );
      emitFrame();
      return true;
    },

    handlePointerUp(input) {
      activePointers.delete(input.pointerId);

      if (pinchState !== null) {
        if (activePointers.size < 2) {
          pinchState = null;
          const metrics = options.getStageMetrics();
          const clamped = clampCameraToBounds(
            camera,
            metrics.stageWidth,
            metrics.stageHeight,
            metrics.fitRadiusPx,
          );
          if (
            Math.abs(clamped.scale - camera.scale) > 0.001 ||
            Math.abs(clamped.tx - camera.tx) > 0.5 ||
            Math.abs(clamped.ty - camera.ty) > 0.5
          ) {
            // Rubber-band return past the scale or pan bounds (premium §8.5)
            animateToCamera(clamped, SPRING_TOKENS.throw);
          } else {
            camera = clamped;
            emitFrame();
            scheduleSettleCheck();
          }
        }
        return true;
      }

      if (!dragState || dragState.pointerId !== input.pointerId) {
        return false;
      }

      const wasCommitted = dragState.committed;
      const samples = dragState.samples;
      dragState = null;

      if (!wasCommitted) {
        scheduleSettleCheck();
        return false;
      }

      const metrics = options.getStageMetrics();
      const bounds = computeCameraPanBounds(
        camera.scale,
        metrics.stageWidth,
        metrics.stageHeight,
        metrics.fitRadiusPx,
      );

      if (options.getPrefersReducedMotion()) {
        camera = clampCameraToBounds(
          camera,
          metrics.stageWidth,
          metrics.stageHeight,
          metrics.fitRadiusPx,
        );
        emitFrame();
        scheduleSettleCheck();
        return true;
      }

      const { vx, vy } = computeReleaseVelocity(samples, input.timeMs);
      const projX = computeProjectedInertiaEnd(camera.tx, vx);
      const projY = computeProjectedInertiaEnd(camera.ty, vy);

      const outX =
        projX < bounds.minTx ||
        projX > bounds.maxTx ||
        camera.tx < bounds.minTx ||
        camera.tx > bounds.maxTx;
      const outY =
        projY < bounds.minTy ||
        projY > bounds.maxTy ||
        camera.ty < bounds.minTy ||
        camera.ty > bounds.maxTy;

      const targetX = clamp(projX, bounds.minTx, bounds.maxTx);
      const targetY = clamp(projY, bounds.minTy, bounds.maxTy);

      // In bounds: inertia decays the release velocity (x 0.998 per ms). Out of bounds:
      // `spring-throw` returns to the bound, keeping the release velocity (premium §8.5)
      const minSpeedPxPerSec = INERTIA_STOP_PX_PER_MS * 1000;
      animX.mode = outX ? 'spring' : 'decay';
      animX.target = targetX;
      animX.velocity = vx;
      animX.spring = SPRING_TOKENS.throw;
      animX.active = outX
        ? Math.abs(targetX - camera.tx) > 0.05 || Math.abs(vx) > 2
        : Math.abs(vx) >= minSpeedPxPerSec;

      animY.mode = outY ? 'spring' : 'decay';
      animY.target = targetY;
      animY.velocity = vy;
      animY.spring = SPRING_TOKENS.throw;
      animY.active = outY
        ? Math.abs(targetY - camera.ty) > 0.05 || Math.abs(vy) > 2
        : Math.abs(vy) >= minSpeedPxPerSec;

      if (animX.active || animY.active) {
        emitFrame();
        ensureRaf();
      } else {
        emitFrame();
        scheduleSettleCheck();
      }
      return true;
    },

    dispose() {
      stopRaf();
      clearSettleTimer();
      activePointers.clear();
      dragState = null;
      pinchState = null;
    },
  };
}
