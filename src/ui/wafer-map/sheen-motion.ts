/**
 * Silicon sheen pointer follow (`src/ui/wafer-map/sheen-motion.ts`, premium.md §8.11).
 *
 * The sheen ellipse (§5.2 step 6) slides toward
 * `clamp((pointer − disc centre) / R, −1, 1) × amplitude × D` on each axis and rotates
 * `dx × 3deg` (dx the clamped x term), on `spring-sheen` (own integrator, independent axes).
 * The target returns to rest when the pointer leaves, and holds while frozen (drag pan,
 * pinch, camera spring), taking the latest pointer target once released. Each moving frame
 * writes one `transform`; nothing redraws a canvas.
 */

import { SPRING_TOKENS, WAFER_TOKENS } from '@/ui/tokens';

/** Main stage amplitude, in disc diameters (§8.11). */
export const SHEEN_STAGE_AMPLITUDE_D = 0.05;
/** Landing card amplitude, in disc diameters (§8.11). */
export const SHEEN_CARD_AMPLITUDE_D = 0.03;
/** Rotation at the clamped edge (`dx = ±1`), in degrees. */
export const SHEEN_ROTATE_PER_DX_DEG = 3;

/** Offset in disc diameters plus extra rotation in degrees. */
export interface SheenOffset {
  readonly x: number;
  readonly y: number;
  readonly rotateDeg: number;
}

export const SHEEN_REST: SheenOffset = { x: 0, y: 0, rotateDeg: 0 };

const clampUnit = (v: number): number =>
  Number.isFinite(v) ? Math.min(1, Math.max(-1, v)) : 0;

/** Target for a pointer at `(px, py)` over a disc centred at `(cx, cy)` with radius `r` (same px space). */
export function computeSheenTarget(
  px: number,
  py: number,
  cx: number,
  cy: number,
  r: number,
  amplitudeD: number,
): SheenOffset {
  if (!(r > 0)) {
    return SHEEN_REST;
  }
  const dx = clampUnit((px - cx) / r);
  const dy = clampUnit((py - cy) / r);
  return {
    x: dx * amplitudeD,
    y: dy * amplitudeD,
    rotateDeg: dx * SHEEN_ROTATE_PER_DX_DEG,
  };
}

const round = (v: number, digits: number): number => {
  const f = 10 ** digits;
  const r = Math.round(v * f) / f;
  return Object.is(r, -0) ? 0 : r;
};

/**
 * Ellipse `transform` for an offset. Translation is in percent of the ellipse box
 * (0.92 D x 0.58 D), so it scales with the disc at any size and camera zoom. At rest it
 * equals the §5.2 rest transform exactly.
 */
export function formatSheenTransform(offset: SheenOffset): string {
  const s = WAFER_TOKENS.sheenSize;
  const rest = `rotate(${s.rotateDeg}deg)`;
  const xPct = round((offset.x / s.widthD) * 100, 3);
  const yPct = round((offset.y / s.heightD) * 100, 3);
  const rot = round(s.rotateDeg + offset.rotateDeg, 3);
  if (xPct === 0 && yPct === 0 && rot === s.rotateDeg) {
    return rest;
  }
  return `translate(${xPct}%, ${yPct}%) rotate(${rot}deg)`;
}

export interface SheenSpringState {
  readonly position: SheenOffset;
  readonly velocity: SheenOffset;
}

export interface SheenSpring {
  readonly stiffness: number;
  readonly damping: number;
  readonly mass: number;
}

const STEP_MS = 4;
const MAX_FRAME_MS = 64;
/** Settle thresholds: 1e-4 D and 0.005 deg, with matching velocities per second. */
const SETTLE_POS_D = 1e-4;
const SETTLE_ROT_DEG = 5e-3;

/** Advances the three independent axes by `dtMs` (semi-implicit Euler, 4 ms substeps). */
export function stepSheenSpring(
  state: SheenSpringState,
  target: SheenOffset,
  dtMs: number,
  spring: SheenSpring = SPRING_TOKENS.sheen,
): SheenSpringState {
  let p = { ...state.position };
  let v = { ...state.velocity };
  let remaining = Math.min(Math.max(dtMs, 0), MAX_FRAME_MS);
  const axes = ['x', 'y', 'rotateDeg'] as const;
  while (remaining > 0) {
    const h = Math.min(STEP_MS, remaining) / 1000;
    remaining -= STEP_MS;
    const nv = { ...v };
    const np = { ...p };
    for (const axis of axes) {
      const a =
        (-spring.stiffness * (p[axis] - target[axis]) -
          spring.damping * v[axis]) /
        spring.mass;
      nv[axis] = v[axis] + a * h;
      np[axis] = p[axis] + nv[axis] * h;
    }
    v = nv;
    p = np;
  }
  return { position: p, velocity: v };
}

export function isSheenSettled(
  state: SheenSpringState,
  target: SheenOffset,
): boolean {
  const { position: p, velocity: v } = state;
  return (
    Math.abs(p.x - target.x) < SETTLE_POS_D &&
    Math.abs(p.y - target.y) < SETTLE_POS_D &&
    Math.abs(p.rotateDeg - target.rotateDeg) < SETTLE_ROT_DEG &&
    Math.abs(v.x) < SETTLE_POS_D * 10 &&
    Math.abs(v.y) < SETTLE_POS_D * 10 &&
    Math.abs(v.rotateDeg) < SETTLE_ROT_DEG * 10
  );
}

export interface SheenFollowerOptions {
  /** Writes the ellipse transform (one write per moving frame). */
  readonly write: (transform: string) => void;
  readonly requestFrame: (cb: (timeMs: number) => void) => number;
  readonly cancelFrame: (id: number) => void;
  readonly spring?: SheenSpring;
}

export interface SheenFollower {
  /** New target; held (not applied) while frozen. */
  readonly setTarget: (target: SheenOffset) => void;
  /** Freeze holds the current target; release applies the latest one. */
  readonly setFrozen: (frozen: boolean) => void;
  /** Jumps to rest with no motion (reduced motion, touch, unmount). */
  readonly snapToRest: () => void;
  readonly isMoving: () => boolean;
  readonly dispose: () => void;
}

export function createSheenFollower(
  options: SheenFollowerOptions,
): SheenFollower {
  const spring = options.spring ?? SPRING_TOKENS.sheen;
  let state: SheenSpringState = { position: SHEEN_REST, velocity: SHEEN_REST };
  let target: SheenOffset = SHEEN_REST;
  let pending: SheenOffset = SHEEN_REST;
  let frozen = false;
  let frameId: number | null = null;
  let lastTimeMs: number | null = null;
  let lastWritten = formatSheenTransform(SHEEN_REST);

  const write = (offset: SheenOffset): void => {
    const next = formatSheenTransform(offset);
    if (next !== lastWritten) {
      lastWritten = next;
      options.write(next);
    }
  };

  const stop = (): void => {
    if (frameId !== null) {
      options.cancelFrame(frameId);
      frameId = null;
    }
    lastTimeMs = null;
  };

  const tick = (timeMs: number): void => {
    frameId = null;
    const dt = lastTimeMs === null ? 1000 / 60 : timeMs - lastTimeMs;
    lastTimeMs = timeMs;
    state = stepSheenSpring(state, target, dt, spring);
    if (isSheenSettled(state, target)) {
      state = { position: target, velocity: SHEEN_REST };
      write(target);
      lastTimeMs = null;
      return;
    }
    write(state.position);
    frameId = options.requestFrame(tick);
  };

  const start = (): void => {
    if (frameId === null && !isSheenSettled(state, target)) {
      frameId = options.requestFrame(tick);
    }
  };

  return {
    setTarget: (next) => {
      pending = next;
      if (frozen) {
        return;
      }
      target = next;
      start();
    },
    setFrozen: (next) => {
      if (frozen === next) {
        return;
      }
      frozen = next;
      if (!frozen && pending !== target) {
        target = pending;
        start();
      }
    },
    snapToRest: () => {
      stop();
      state = { position: SHEEN_REST, velocity: SHEEN_REST };
      target = SHEEN_REST;
      pending = SHEEN_REST;
      write(SHEEN_REST);
    },
    isMoving: () => frameId !== null,
    dispose: stop,
  };
}

export interface SheenFollowEnvironment {
  readonly hoverCapable: boolean;
  readonly reducedMotion: boolean;
  readonly reducedTransparency: boolean;
}

/** Follow only for a hovering mouse or pen, never under reduced motion or transparency (§8.11). */
export function canSheenFollow(
  pointerType: string,
  env: SheenFollowEnvironment,
): boolean {
  return (
    pointerType !== 'touch' &&
    env.hoverCapable &&
    !env.reducedMotion &&
    !env.reducedTransparency
  );
}

const mediaQueryCache = new Map<string, MediaQueryList>();

/** Reads the hover and reduced-motion/transparency media queries (browser only; lists are cached, `matches` is live). */
export function readSheenFollowEnvironment(): SheenFollowEnvironment {
  const mq = (q: string): boolean => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return false;
    }
    let list = mediaQueryCache.get(q);
    if (!list) {
      list = window.matchMedia(q);
      mediaQueryCache.set(q, list);
    }
    return list.matches;
  };
  return {
    hoverCapable: mq('(hover: hover)'),
    reducedMotion: mq('(prefers-reduced-motion: reduce)'),
    reducedTransparency: mq('(prefers-reduced-transparency: reduce)'),
  };
}
