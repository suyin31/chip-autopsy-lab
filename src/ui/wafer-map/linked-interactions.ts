/**
 * Pure Linked-Interaction Geometry, Glow Ordering, Camera Framing, and Live Box-Select
 * Analytics (`src/ui/wafer-map/linked-interactions.ts`).
 *
 * Implements `redesign.md` §3.5, §3.6, §4.8, §4.9, §4.14, §5.4, §5.6, §5.7 without React
 * or DOM globals so every placement invariant, clockwise/PCA/centroid glow delay schedule,
 * evidence bbox framing camera, and O(rect area) live selection readout is unit-testable.
 */

import {
  type BinMode,
  type LotModel,
  packWaferCoord,
  type WaferSummaryMeta,
} from '@/core/model';
import {
  type CameraState,
  clampCameraToBounds,
  DEFAULT_CAMERA_STATE,
} from './wafer-camera';
import {
  dieCoordToCanvasRect,
  type WaferRenderLayout,
} from './wafer-geometry';

export interface ScreenBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export function rectsOverlap(a: ScreenBox, b: ScreenBox): boolean {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}

function clamp(v: number, lo: number, hi: number): number {
  if (hi < lo) {
    return lo;
  }
  return Math.min(hi, Math.max(lo, v));
}

export interface MagnifierPlacementInput {
  readonly pointerX: number;
  readonly pointerY: number;
  readonly dieRect: ScreenBox;
  readonly magnifierWidth: number;
  readonly magnifierHeight: number;
  readonly stageWidth: number;
  readonly stageHeight: number;
  readonly pointerOffsetPx?: number;
  readonly stageMarginPx?: number;
}

export interface MagnifierPlacementResult {
  readonly x: number;
  readonly y: number;
  readonly transformOrigin:
    | 'bottom left'
    | 'bottom right'
    | 'top left'
    | 'top right'
    | 'bottom center';
  readonly placedAboveStage: boolean;
}

/**
 * Places the hover magnifier (`redesign.md` §4.8):
 * - Default: `16 px` right and `16 px` above the pointer (`transform-origin: bottom left`)
 * - Flips horizontally/vertically to stay inside the stage with `8 px` margin
 * - NEVER covers `dieRect`; if no in-stage quadrant fits without overlapping `dieRect`,
 *   places above the stage edge (and strictly above `dieRect`).
 */
export function computeMagnifierPlacement(
  input: MagnifierPlacementInput,
): MagnifierPlacementResult {
  const offset = input.pointerOffsetPx ?? 16;
  const margin = Math.max(0, input.stageMarginPx ?? 8);
  const magW = Math.max(1, input.magnifierWidth);
  const magH = Math.max(1, input.magnifierHeight);
  const stageW = Math.max(1, input.stageWidth);
  const stageH = Math.max(1, input.stageHeight);
  const { pointerX, pointerY, dieRect } = input;

  const fitsInsideStage = (x: number, y: number): boolean =>
    x >= margin &&
    x + magW <= stageW - margin &&
    y >= margin &&
    y + magH <= stageH - margin;

  const isValidInStage = (x: number, y: number): boolean =>
    fitsInsideStage(x, y) &&
    !rectsOverlap({ x, y, width: magW, height: magH }, dieRect);

  const quadrants: ReadonlyArray<{
    readonly rawX: number;
    readonly rawY: number;
    readonly altX: number;
    readonly altY: number;
    readonly origin:
      | 'bottom left'
      | 'bottom right'
      | 'top left'
      | 'top right';
  }> = [
    // 1. Top-Right (default: 16 px right, 16 px above pointer)
    {
      rawX: pointerX + offset,
      rawY: pointerY - offset - magH,
      altX: Math.max(pointerX + offset, dieRect.x + dieRect.width + margin),
      altY: Math.min(pointerY - offset - magH, dieRect.y - margin - magH),
      origin: 'bottom left',
    },
    // 2. Top-Left (horizontal flip)
    {
      rawX: pointerX - offset - magW,
      rawY: pointerY - offset - magH,
      altX: Math.min(pointerX - offset - magW, dieRect.x - margin - magW),
      altY: Math.min(pointerY - offset - magH, dieRect.y - margin - magH),
      origin: 'bottom right',
    },
    // 3. Bottom-Right (vertical flip)
    {
      rawX: pointerX + offset,
      rawY: pointerY + offset,
      altX: Math.max(pointerX + offset, dieRect.x + dieRect.width + margin),
      altY: Math.max(pointerY + offset, dieRect.y + dieRect.height + margin),
      origin: 'top left',
    },
    // 4. Bottom-Left (horizontal + vertical flip)
    {
      rawX: pointerX - offset - magW,
      rawY: pointerY + offset,
      altX: Math.min(pointerX - offset - magW, dieRect.x - margin - magW),
      altY: Math.max(pointerY + offset, dieRect.y + dieRect.height + margin),
      origin: 'top right',
    },
  ];

  for (const q of quadrants) {
    const candidates: ReadonlyArray<readonly [number, number]> = [
      [q.rawX, q.rawY],
      [q.altX, q.rawY],
      [q.rawX, q.altY],
      [q.altX, q.altY],
    ];
    for (const [cx, cy] of candidates) {
      const rx = Math.round(cx);
      const ry = Math.round(cy);
      if (isValidInStage(rx, ry)) {
        return {
          x: rx,
          y: ry,
          transformOrigin: q.origin,
          placedAboveStage: false,
        };
      }
    }
  }

  // Try clamped side placements around `dieRect` within `[margin, stage - margin]`
  const clampedY = clamp(pointerY - magH / 2, margin, stageH - margin - magH);
  const clampedX = clamp(pointerX - magW / 2, margin, stageW - margin - magW);
  const sideCandidates: ReadonlyArray<{
    readonly x: number;
    readonly y: number;
    readonly origin:
      | 'bottom left'
      | 'bottom right'
      | 'top left'
      | 'top right';
  }> = [
    {
      x: dieRect.x + dieRect.width + margin,
      y: clampedY,
      origin: 'bottom left',
    },
    {
      x: dieRect.x - margin - magW,
      y: clampedY,
      origin: 'bottom right',
    },
    {
      x: clampedX,
      y: dieRect.y - margin - magH,
      origin: 'bottom left',
    },
    {
      x: clampedX,
      y: dieRect.y + dieRect.height + margin,
      origin: 'top left',
    },
  ];

  for (const side of sideCandidates) {
    const rx = Math.round(side.x);
    const ry = Math.round(side.y);
    if (isValidInStage(rx, ry)) {
      return {
        x: rx,
        y: ry,
        transformOrigin: side.origin,
        placedAboveStage: false,
      };
    }
  }

  // Fallback (§4.8): place strictly above the stage edge (and strictly above dieRect)
  const fallbackX = Math.round(
    clamp(pointerX - magW / 2, margin, Math.max(margin, stageW - margin - magW)),
  );
  const fallbackY = Math.floor(
    Math.min(-margin - magH, dieRect.y - margin - magH),
  );
  return {
    x: fallbackX,
    y: fallbackY,
    transformOrigin: 'bottom center',
    placedAboveStage: true,
  };
}

export interface PinnedReadoutPlacementInput {
  readonly dieRect: ScreenBox;
  readonly readoutWidth: number;
  readonly readoutHeight: number;
  readonly stageWidth: number;
  readonly gapPx?: number;
  readonly stageMarginPx?: number;
}

export interface PinnedReadoutPlacementResult {
  readonly x: number;
  readonly y: number;
  readonly transformOrigin: 'bottom center' | 'top center';
  readonly placedBelow: boolean;
}

/**
 * Places the touch-pinned magnifier readout (premium §7.15): centred on the tapped die,
 * `12 px` above it, flipping below when it would cross the stage's top edge. Horizontal
 * position is clamped inside the stage with an `8 px` margin.
 */
export function computePinnedReadoutPlacement(
  input: PinnedReadoutPlacementInput,
): PinnedReadoutPlacementResult {
  const gap = input.gapPx ?? 12;
  const margin = Math.max(0, input.stageMarginPx ?? 8);
  const w = Math.max(1, input.readoutWidth);
  const h = Math.max(1, input.readoutHeight);
  const stageW = Math.max(1, input.stageWidth);
  const { dieRect } = input;
  const x = Math.round(
    clamp(
      dieRect.x + dieRect.width / 2 - w / 2,
      margin,
      Math.max(margin, stageW - margin - w),
    ),
  );
  const aboveY = Math.floor(dieRect.y - gap - h);
  if (aboveY >= margin) {
    return { x, y: aboveY, transformOrigin: 'bottom center', placedBelow: false };
  }
  return {
    x,
    y: Math.ceil(dieRect.y + dieRect.height + gap),
    transformOrigin: 'top center',
    placedBelow: true,
  };
}

/** Die coordinate text with a true minus sign (U+2212) for negatives (premium §7.15, §9). */
export function formatDieCoordinate(value: number): string {
  const n = Math.trunc(value);
  return n < 0 ? `\u2212${String(-n)}` : String(n);
}

export interface PopoverPlacementInput {
  readonly rect: ScreenBox;
  readonly popoverWidth: number;
  readonly popoverHeight: number;
  readonly stageWidth: number;
  readonly stageHeight: number;
  readonly gapPx?: number;
  readonly stageMarginPx?: number;
}

export interface PopoverPlacementResult {
  readonly x: number;
  readonly y: number;
  readonly transformOrigin:
    | 'top left'
    | 'top right'
    | 'bottom left'
    | 'bottom right';
}

/**
 * Places the box-selection stats popover anchored to the selection rect's top-right corner
 * with `8 px` gap, flipping to top-left / bottom-right / bottom-left so it never covers
 * the selection rect or leaves the stage (`redesign.md` §4.14).
 */
export function computePopoverPlacement(
  input: PopoverPlacementInput,
): PopoverPlacementResult {
  const gap = input.gapPx ?? 8;
  const margin = input.stageMarginPx ?? 8;
  const popW = Math.max(1, input.popoverWidth);
  const popH = Math.max(1, input.popoverHeight);
  const stageW = Math.max(1, input.stageWidth);
  const stageH = Math.max(1, input.stageHeight);
  const { rect } = input;

  const fitsStage = (x: number, y: number): boolean =>
    x >= margin &&
    x + popW <= stageW - margin &&
    y >= margin &&
    y + popH <= stageH - margin;

  const clampedTopAlignedY = clamp(rect.y, margin, stageH - margin - popH);
  const clampedBottomAlignedY = clamp(
    rect.y + rect.height - popH,
    margin,
    stageH - margin - popH,
  );
  const clampedRightAlignedX = clamp(
    rect.x + rect.width - popW,
    margin,
    stageW - margin - popW,
  );
  const clampedLeftAlignedX = clamp(rect.x, margin, stageW - margin - popW);

  const candidates: ReadonlyArray<{
    readonly x: number;
    readonly y: number;
    readonly origin:
      | 'top left'
      | 'top right'
      | 'bottom left'
      | 'bottom right';
  }> = [
    // 1. Top-Right outside right edge
    {
      x: rect.x + rect.width + gap,
      y: clampedTopAlignedY,
      origin: 'top left',
    },
    // 2. Top-Left outside left edge
    {
      x: rect.x - gap - popW,
      y: clampedTopAlignedY,
      origin: 'top right',
    },
    // 3. Bottom-Right below rect
    {
      x: clampedRightAlignedX,
      y: rect.y + rect.height + gap,
      origin: 'top right',
    },
    // 4. Bottom-Left below rect
    {
      x: clampedLeftAlignedX,
      y: rect.y + rect.height + gap,
      origin: 'top left',
    },
    // 5. Above rect right-aligned
    {
      x: clampedRightAlignedX,
      y: rect.y - gap - popH,
      origin: 'bottom right',
    },
    // 6. Bottom-Right outside right edge
    {
      x: rect.x + rect.width + gap,
      y: clampedBottomAlignedY,
      origin: 'bottom left',
    },
    // 7. Bottom-Left outside left edge
    {
      x: rect.x - gap - popW,
      y: clampedBottomAlignedY,
      origin: 'bottom right',
    },
  ];

  for (const c of candidates) {
    const rx = Math.round(c.x);
    const ry = Math.round(c.y);
    if (
      fitsStage(rx, ry) &&
      !rectsOverlap({ x: rx, y: ry, width: popW, height: popH }, rect)
    ) {
      return { x: rx, y: ry, transformOrigin: c.origin };
    }
  }

  // Fallback when rect covers nearly the full stage: place above rect/stage or pinned top-right
  if (rect.y - gap - popH >= -popH) {
    const aboveY = Math.round(Math.min(margin, rect.y - gap - popH));
    if (!rectsOverlap({ x: clampedRightAlignedX, y: aboveY, width: popW, height: popH }, rect)) {
      return {
        x: Math.round(clampedRightAlignedX),
        y: aboveY,
        transformOrigin: 'bottom right',
      };
    }
  }

  return {
    x: Math.round(clamp(rect.x + rect.width - popW - margin, margin, stageW - margin - popW)),
    y: Math.round(clamp(rect.y + margin, margin, stageH - margin - popH)),
    transformOrigin: 'top right',
  };
}

export type GlowOrderMode = 'polar-cw' | 'principal-axis' | 'centroid-distance';

/** Veil progress at rest (premium §8.3: `dim-veil` alpha 0 -> 1; the token carries its own 0.78). */
export const DIM_SCRIM_MAX_ALPHA = 1 as const;
export const SCRIM_ENTER_DURATION_MS = 200 as const;
export const GLOW_STAGGER_WINDOW_MS = 420 as const;
export const GLOW_DIE_FADE_DURATION_MS = 180 as const;
export const GLOW_TOTAL_DURATION_MS = 600 as const;
export const GLOW_EXIT_DURATION_MS = 160 as const;

/**
 * Infers the §5.4 ordered glow sequence mode from a report claim's `messageKey` or spatial class.
 */
export function inferGlowOrderMode(
  messageKey?: string,
  spatialPattern?: string,
): GlowOrderMode {
  if (messageKey === 'findings.scratch.headline' || spatialPattern === 'Scratch') {
    return 'principal-axis';
  }
  if (
    messageKey === 'findings.edgeBand.headline' ||
    spatialPattern === 'Edge-Ring' ||
    spatialPattern === 'Donut' ||
    spatialPattern === 'Center'
  ) {
    return 'polar-cw';
  }
  if (
    messageKey === 'verdict.pattern' &&
    (spatialPattern === 'Edge-Ring' ||
      spatialPattern === 'Donut' ||
      spatialPattern === 'Center')
  ) {
    return 'polar-cw';
  }
  return 'centroid-distance';
}

/**
 * Evaluates `cubic-bezier(0.22, 1, 0.36, 1)` (`ease-out`, `redesign.md` §2.6) for `t in [0, 1]`.
 */
export function sampleCubicEaseOut(t: number): number {
  if (t <= 0) return 0;
  if (t >= 1) return 1;

  // Newton-Raphson solve x(u) = t for P1=(0.22, 1.0), P2=(0.36, 1.0)
  const x1 = 0.22;
  const x2 = 0.36;
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;

  let u = t;
  for (let iter = 0; iter < 6; iter += 1) {
    const xEst = ((ax * u + bx) * u + cx) * u - t;
    if (Math.abs(xEst) < 1e-6) break;
    const dx = (3 * ax * u + 2 * bx) * u + cx;
    if (Math.abs(dx) < 1e-6) break;
    u = clamp(u - xEst / dx, 0, 1);
  }

  // With y1 = 1, y2 = 1: y(u) = 1 - (1 - u)^3
  const inv = 1 - u;
  return 1 - inv * inv * inv;
}

export interface OrderedGlowSchedule {
  readonly waferIndex: number;
  readonly mode: GlowOrderMode;
  /** Ordered global die indices on `waferIndex` (`0 .. n - 1`). */
  readonly dieIndices: Uint32Array;
  /** Start delay in ms (`0 .. 420 ms`) matching `dieIndices` 1-to-1. */
  readonly delaysMs: Float32Array;
}

export interface ComputeOrderedGlowScheduleParams {
  readonly lot: LotModel;
  readonly waferIndex: number;
  readonly evidenceMask: Uint8Array;
  readonly mode: GlowOrderMode;
}

/**
 * Orders evidence dies on `waferIndex` and assigns start delays `rank / (n - 1) * 420 ms`
 * (`redesign.md` §5.4):
 * - `'polar-cw'`: polar angle from 12 o'clock clockwise around wafer centre
 * - `'principal-axis'`: projection onto the covariance principal axis (PCA)
 * - `'centroid-distance'`: Euclidean distance from the evidence cluster centroid
 */
export function computeOrderedGlowSchedule(
  params: ComputeOrderedGlowScheduleParams,
): OrderedGlowSchedule {
  const { lot, waferIndex, evidenceMask, mode } = params;
  const wafer = lot.wafers[waferIndex];
  if (!wafer || evidenceMask.length < wafer.dieEndIndex) {
    return {
      waferIndex,
      mode,
      dieIndices: new Uint32Array(0),
      delaysMs: new Float32Array(0),
    };
  }

  const { dies } = lot;
  const gridCenterX = (wafer.minX + wafer.maxX) / 2;
  const gridCenterY = (wafer.minY + wafer.maxY) / 2;
  const dirX = wafer.geometry.posX === 'L' ? -1 : 1;
  const dirY = wafer.geometry.posY === 'D' ? 1 : -1;

  const matched: number[] = [];
  for (let i = wafer.dieStartIndex; i < wafer.dieEndIndex; i += 1) {
    if (evidenceMask[i] !== 0 && dies.hasValidCoords[i] !== 0) {
      matched.push(i);
    }
  }

  const n = matched.length;
  if (n === 0) {
    return {
      waferIndex,
      mode,
      dieIndices: new Uint32Array(0),
      delaysMs: new Float32Array(0),
    };
  }

  const screenDx = new Float64Array(n);
  const screenDy = new Float64Array(n);
  let meanX = 0;
  let meanY = 0;
  for (let k = 0; k < n; k += 1) {
    const idx = matched[k]!;
    const sx = (dies.x[idx]! - gridCenterX) * dirX;
    const sy = (dies.y[idx]! - gridCenterY) * dirY;
    screenDx[k] = sx;
    screenDy[k] = sy;
    meanX += sx;
    meanY += sy;
  }
  meanX /= n;
  meanY /= n;

  const keys = new Float64Array(n);
  if (mode === 'polar-cw') {
    for (let k = 0; k < n; k += 1) {
      // 12 o'clock is (sx = 0, sy = -1) -> atan2(sx, -sy) === 0, increasing clockwise
      let angle = Math.atan2(screenDx[k]!, -screenDy[k]!);
      if (angle < 0) {
        angle += Math.PI * 2;
      }
      // Tie-break radially outer-to-inner on identical angle
      const r = Math.hypot(screenDx[k]!, screenDy[k]!);
      keys[k] = angle * 1000 - r * 1e-3;
    }
  } else if (mode === 'principal-axis') {
    let sxx = 0;
    let sxy = 0;
    let syy = 0;
    for (let k = 0; k < n; k += 1) {
      const ux = screenDx[k]! - meanX;
      const uy = screenDy[k]! - meanY;
      sxx += ux * ux;
      sxy += ux * uy;
      syy += uy * uy;
    }
    const theta = 0.5 * Math.atan2(2 * sxy, sxx - syy);
    let vx = Math.cos(theta);
    let vy = Math.sin(theta);
    if (vx < -1e-9 || (Math.abs(vx) <= 1e-9 && vy < 0)) {
      vx = -vx;
      vy = -vy;
    }
    for (let k = 0; k < n; k += 1) {
      keys[k] = (screenDx[k]! - meanX) * vx + (screenDy[k]! - meanY) * vy;
    }
  } else {
    for (let k = 0; k < n; k += 1) {
      keys[k] = Math.hypot(screenDx[k]! - meanX, screenDy[k]! - meanY);
    }
  }

  const order = Array.from({ length: n }, (_, k) => k);
  order.sort((a, b) => {
    const diff = keys[a]! - keys[b]!;
    if (Math.abs(diff) > 1e-9) {
      return diff;
    }
    return matched[a]! - matched[b]!;
  });

  const dieIndices = new Uint32Array(n);
  const delaysMs = new Float32Array(n);
  const denom = n > 1 ? n - 1 : 1;

  for (let rank = 0; rank < n; rank += 1) {
    const k = order[rank]!;
    dieIndices[rank] = matched[k]!;
    delaysMs[rank] = n > 1 ? (rank / denom) * GLOW_STAGGER_WINDOW_MS : 0;
  }

  return { waferIndex, mode, dieIndices, delaysMs };
}

export interface GlowSequenceFrameState {
  readonly scrimAlpha: number;
  readonly dieIndices: Uint32Array;
  readonly dieAlphas: Float32Array;
  readonly settled: boolean;
}

export function evaluateGlowSequenceFrame(
  schedule: OrderedGlowSchedule,
  elapsedMs: number,
  reducedMotion: boolean,
): GlowSequenceFrameState {
  const n = schedule.dieIndices.length;
  const dieAlphas = new Float32Array(n);

  if (reducedMotion || elapsedMs >= GLOW_TOTAL_DURATION_MS) {
    dieAlphas.fill(1);
    return {
      scrimAlpha: DIM_SCRIM_MAX_ALPHA,
      dieIndices: schedule.dieIndices,
      dieAlphas,
      settled: true,
    };
  }

  const safeElapsed = Math.max(0, elapsedMs);
  const scrimProgress = clamp(safeElapsed / SCRIM_ENTER_DURATION_MS, 0, 1);
  const scrimAlpha = DIM_SCRIM_MAX_ALPHA * sampleCubicEaseOut(scrimProgress);

  let allOnes = scrimProgress >= 1;
  for (let r = 0; r < n; r += 1) {
    const localMs = safeElapsed - schedule.delaysMs[r]!;
    if (localMs <= 0) {
      dieAlphas[r] = 0;
      allOnes = false;
    } else if (localMs >= GLOW_DIE_FADE_DURATION_MS) {
      dieAlphas[r] = 1;
    } else {
      dieAlphas[r] = sampleCubicEaseOut(localMs / GLOW_DIE_FADE_DURATION_MS);
      allOnes = false;
    }
  }

  return {
    scrimAlpha,
    dieIndices: schedule.dieIndices,
    dieAlphas,
    settled: allOnes,
  };
}

export interface ComputeEvidenceFramingCameraParams {
  readonly lot: LotModel;
  readonly waferIndex: number;
  readonly dieMask: Uint8Array;
  readonly fitLayout: WaferRenderLayout;
  readonly stageWidth: number;
  readonly stageHeight: number;
  readonly paddingPx?: number;
  readonly maxScale?: number;
  readonly fullWaferRatioThreshold?: number;
}

/**
 * Computes the target `CameraState` framing `dieMask` on `waferIndex` (`redesign.md` §5.4 step 3):
 * - Target scale = `fit(bbox + 48 px padding)`, clamped to `[1, 4]`
 * - If bbox covers `>= 70%` of the wafer diameter (e.g. `Edge-Ring`, `Near-full`), returns fit view (`scale = 1`).
 */
export function computeEvidenceFramingCamera(
  params: ComputeEvidenceFramingCameraParams,
): CameraState {
  const {
    lot,
    waferIndex,
    dieMask,
    fitLayout,
    stageWidth,
    stageHeight,
    paddingPx = 48,
    maxScale = 4,
    fullWaferRatioThreshold = 0.7,
  } = params;

  const wafer = lot.wafers[waferIndex];
  if (!wafer || dieMask.length < wafer.dieEndIndex) {
    return DEFAULT_CAMERA_STATE;
  }

  const { dies } = lot;
  let minLeft = Number.POSITIVE_INFINITY;
  let maxRight = Number.NEGATIVE_INFINITY;
  let minTop = Number.POSITIVE_INFINITY;
  let maxBottom = Number.NEGATIVE_INFINITY;
  let count = 0;

  for (let i = wafer.dieStartIndex; i < wafer.dieEndIndex; i += 1) {
    if (dieMask[i] === 0 || dies.hasValidCoords[i] === 0) {
      continue;
    }
    const r = dieCoordToCanvasRect(dies.x[i]!, dies.y[i]!, fitLayout);
    if (r.x < minLeft) minLeft = r.x;
    if (r.x + r.width > maxRight) maxRight = r.x + r.width;
    if (r.y < minTop) minTop = r.y;
    if (r.y + r.height > maxBottom) maxBottom = r.y + r.height;
    count += 1;
  }

  if (count === 0) {
    return DEFAULT_CAMERA_STATE;
  }

  const bboxWidth = Math.max(fitLayout.diePitchPx, maxRight - minLeft);
  const bboxHeight = Math.max(fitLayout.diePitchPx, maxBottom - minTop);
  const waferDiameterPx = fitLayout.fitWaferRadiusPx * 2;

  if (
    waferDiameterPx > 0 &&
    Math.max(bboxWidth, bboxHeight) >= waferDiameterPx * fullWaferRatioThreshold
  ) {
    return DEFAULT_CAMERA_STATE;
  }

  const availW = Math.max(64, stageWidth - paddingPx * 2);
  const availH = Math.max(64, stageHeight - paddingPx * 2);
  const rawScale = Math.min(availW / bboxWidth, availH / bboxHeight);
  const targetScale = clamp(rawScale, 1, maxScale);

  if (Math.abs(targetScale - 1) < 0.01) {
    return DEFAULT_CAMERA_STATE;
  }

  const bboxCenterX = (minLeft + maxRight) / 2;
  const bboxCenterY = (minTop + maxBottom) / 2;
  const rawTx = stageWidth / 2 - bboxCenterX * targetScale;
  const rawTy = stageHeight / 2 - bboxCenterY * targetScale;

  return clampCameraToBounds(
    { scale: targetScale, tx: rawTx, ty: rawTy },
    stageWidth,
    stageHeight,
    fitLayout.fitWaferRadiusPx,
  );
}

export interface WaferGridBounds {
  readonly minX: number;
  readonly maxX: number;
  readonly minY: number;
  readonly maxY: number;
}

/**
 * Projects a screen-space pointer rectangle `(x0, y0) .. (x1, y1)` into integer wafer
 * die-coordinate bounds `[minX, maxX] x [minY, maxY]`, or `null` when outside the wafer grid.
 */
export function screenRectToWaferGridBounds(
  screenRect: {
    readonly x0: number;
    readonly y0: number;
    readonly x1: number;
    readonly y1: number;
  },
  liveLayout: WaferRenderLayout,
  wafer: WaferSummaryMeta,
): WaferGridBounds | null {
  if (liveLayout.diePitchPx <= 0) {
    return null;
  }
  const left = Math.min(screenRect.x0, screenRect.x1);
  const right = Math.max(screenRect.x0, screenRect.x1);
  const top = Math.min(screenRect.y0, screenRect.y1);
  const bottom = Math.max(screenRect.y0, screenRect.y1);

  const gxA =
    liveLayout.gridCenterX +
    ((left - liveLayout.centerXCss) / liveLayout.diePitchPx) * liveLayout.dirX;
  const gxB =
    liveLayout.gridCenterX +
    ((right - liveLayout.centerXCss) / liveLayout.diePitchPx) * liveLayout.dirX;
  const gyA =
    liveLayout.gridCenterY +
    ((top - liveLayout.centerYCss) / liveLayout.diePitchPx) * liveLayout.dirY;
  const gyB =
    liveLayout.gridCenterY +
    ((bottom - liveLayout.centerYCss) / liveLayout.diePitchPx) * liveLayout.dirY;

  const rawMinX = Math.ceil(Math.min(gxA, gxB) - 0.5);
  const rawMaxX = Math.floor(Math.max(gxA, gxB) + 0.5);
  const rawMinY = Math.ceil(Math.min(gyA, gyB) - 0.5);
  const rawMaxY = Math.floor(Math.max(gyA, gyB) + 0.5);

  const minX = Math.max(wafer.minX, rawMinX);
  const maxX = Math.min(wafer.maxX, rawMaxX);
  const minY = Math.max(wafer.minY, rawMinY);
  const maxY = Math.min(wafer.maxY, rawMaxY);

  if (minX > maxX || minY > maxY) {
    return null;
  }
  return { minX, maxX, minY, maxY };
}

export interface LiveBoxSelectTopBin {
  readonly mode: BinMode;
  readonly code: number;
  readonly name: string;
  readonly count: number;
}

export interface LiveBoxSelectStats {
  readonly dieCount: number;
  readonly failingCount: number;
  readonly yieldRatio: number;
  readonly topBin: LiveBoxSelectTopBin | null;
  /** Tight integer bounds around actual matched dies (`null` when `dieCount === 0`). */
  readonly snappedBounds: WaferGridBounds | null;
}

/**
 * Computes live box-selection stats in `O(rect grid area)` (`< 1 ms` for `10,000` dies,
 * `redesign.md` §3.6, §5.7) using `lot.waferCoordIndex[waferIndex]`.
 */
export function computeLiveBoxSelectStats(
  lot: LotModel,
  waferIndex: number,
  bounds: WaferGridBounds | null,
  preferredBinMode: BinMode = 'SBIN',
): LiveBoxSelectStats {
  const coordMap = lot.waferCoordIndex[waferIndex];
  if (!bounds || !coordMap) {
    return {
      dieCount: 0,
      failingCount: 0,
      yieldRatio: 0,
      topBin: null,
      snappedBounds: null,
    };
  }

  const { dies } = lot;
  const failBinCounts = new Map<number, number>();
  const useHbin = preferredBinMode === 'HBIN';

  let dieCount = 0;
  let failingCount = 0;
  let tightMinX = Number.POSITIVE_INFINITY;
  let tightMaxX = Number.NEGATIVE_INFINITY;
  let tightMinY = Number.POSITIVE_INFINITY;
  let tightMaxY = Number.NEGATIVE_INFINITY;

  for (let y = bounds.minY; y <= bounds.maxY; y += 1) {
    for (let x = bounds.minX; x <= bounds.maxX; x += 1) {
      const dieIdx = coordMap.get(packWaferCoord(x, y));
      if (dieIdx === undefined) {
        continue;
      }
      dieCount += 1;
      if (x < tightMinX) tightMinX = x;
      if (x > tightMaxX) tightMaxX = x;
      if (y < tightMinY) tightMinY = y;
      if (y > tightMaxY) tightMaxY = y;

      if (dies.finalPass[dieIdx] === 0) {
        failingCount += 1;
        const rawSbin = dies.sbin[dieIdx]!;
        const code =
          useHbin || rawSbin === 65535 ? dies.hbin[dieIdx]! : rawSbin;
        failBinCounts.set(code, (failBinCounts.get(code) ?? 0) + 1);
      }
    }
  }

  if (dieCount === 0) {
    return {
      dieCount: 0,
      failingCount: 0,
      yieldRatio: 0,
      topBin: null,
      snappedBounds: null,
    };
  }

  let topBin: LiveBoxSelectTopBin | null = null;
  if (failBinCounts.size > 0) {
    let bestCode = 0;
    let bestCount = -1;
    for (const [code, cnt] of failBinCounts.entries()) {
      if (cnt > bestCount || (cnt === bestCount && code < bestCode)) {
        bestCode = code;
        bestCount = cnt;
      }
    }
    const resolvedMode: BinMode =
      useHbin || (!lot.sbins.has(bestCode) && lot.hbins.has(bestCode))
        ? 'HBIN'
        : 'SBIN';
    const def =
      resolvedMode === 'SBIN'
        ? lot.sbins.get(bestCode)
        : lot.hbins.get(bestCode);
    topBin = {
      mode: resolvedMode,
      code: bestCode,
      name: def?.name ?? '',
      count: bestCount,
    };
  }

  const passCount = dieCount - failingCount;
  return {
    dieCount,
    failingCount,
    yieldRatio: passCount / dieCount,
    topBin,
    snappedBounds: {
      minX: tightMinX,
      maxX: tightMaxX,
      minY: tightMinY,
      maxY: tightMaxY,
    },
  };
}

/**
 * Computes per-wafer evidence presence (`true` if wafer has `>= 1` coordinate-bearing die
 * in `evidenceMask`) for wafer-strip dimming (premium §5.8).
 */
export function computeWaferEvidencePresence(
  lot: LotModel,
  evidenceMask: Uint8Array | null,
): readonly boolean[] | null {
  if (!evidenceMask || evidenceMask.length < lot.dies.count) {
    return null;
  }
  let anyTotal = false;
  const out = new Array<boolean>(lot.wafers.length).fill(false);
  for (let w = 0; w < lot.wafers.length; w += 1) {
    const wm = lot.wafers[w]!;
    for (let i = wm.dieStartIndex; i < wm.dieEndIndex; i += 1) {
      if (evidenceMask[i] !== 0 && lot.dies.hasValidCoords[i] !== 0) {
        out[w] = true;
        anyTotal = true;
        break;
      }
    }
  }
  return anyTotal ? out : null;
}
