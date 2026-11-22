import { SPRING_TOKENS } from '@/ui/tokens';
import type { SheenFollowEnvironment } from '@/ui/wafer-map/sheen-motion';

export const TILT_TOKENS = {
  /** Page-level cards and cells. */
  maxDegCard: 4,
  /** Keep wafer hit-testing close to the resting disc. */
  maxDegWafer: 1.6,
  perspectivePx: 900,
  liftPx: 6,
  spotlightRadiusPx: 240,
  resetMs: 420,
} as const;

interface Point { x: number; y: number }
interface Box { left: number; top: number; width: number; height: number }
interface Tilt { rotateX: number; rotateY: number }
interface Spotlight { x: string; y: string }

export const TILT_REST: Readonly<Tilt> = { rotateX: 0, rotateY: 0 };
const round = (n: number, factor: number) => Math.round(n * factor) / factor || 0;
const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

export function computeTiltTarget(pointer: Point, box: Box, maxDeg: number): Tilt {
  if (![box.left, box.top, box.width, box.height, pointer.x, pointer.y, maxDeg].every(Number.isFinite)
      || box.width <= 0 || box.height <= 0) return TILT_REST;
  return {
    rotateX: round(-maxDeg * clamp(2 * ((pointer.y - box.top) / box.height) - 1, -1, 1), 1000),
    rotateY: round(maxDeg * clamp(2 * ((pointer.x - box.left) / box.width) - 1, -1, 1), 1000),
  };
}

export function formatTiltTransform(tilt: Tilt, {
  perspectivePx = TILT_TOKENS.perspectivePx, liftPx = TILT_TOKENS.liftPx,
}: { perspectivePx?: number; liftPx?: number } = {}): string {
  const x = round(tilt.rotateX, 1000);
  const y = round(tilt.rotateY, 1000);
  return x || y ? `perspective(${perspectivePx}px) rotateX(${x}deg) rotateY(${y}deg) translateZ(${liftPx}px)` : '';
}

export function computeSpotlight(pointer: Point, box: Box): Spotlight {
  return {
    x: `${round(clamp(pointer.x - box.left, 0, box.width), 10)}px`,
    y: `${round(clamp(pointer.y - box.top, 0, box.height), 10)}px`,
  };
}

export function canTilt(pointerType: string, env: SheenFollowEnvironment): boolean {
  return pointerType !== 'touch' && env.hoverCapable && !env.reducedMotion && !env.reducedTransparency;
}

export function createTiltFollower(options: {
  write: (transform: string) => void;
  writeSpotlight: (point: Spotlight) => void;
  requestFrame: (tick: (time: number) => void) => number;
  cancelFrame: (id: number) => void;
  liftPx?: number;
}) {
  const { stiffness, damping, mass } = SPRING_TOKENS.sheen;
  const axes = ['rotateX', 'rotateY'] as const;
  let position = { ...TILT_REST };
  let velocity = { ...TILT_REST };
  let target = TILT_REST;
  let pending = target;
  let frozen = false;
  let frame: number | null = null;
  let last: number | null = null;
  let written = '';

  function write() {
    const transform = formatTiltTransform(position, options);
    if (transform !== written) options.write(transform);
    written = transform;
  }

  function tick(time: number) {
    frame = null;
    let remaining = clamp(last === null ? 1000 / 60 : time - last, 0, 64);
    last = time;
    while (remaining > 0) {
      const h = Math.min(4, remaining) / 1000;
      remaining -= 4;
      for (const axis of axes) {
        velocity[axis] += h * (stiffness * (target[axis] - position[axis]) - damping * velocity[axis]) / mass;
        position[axis] += h * velocity[axis];
      }
    }
    if (axes.every(a => Math.abs(position[a] - target[a]) < 0.01 && Math.abs(velocity[a]) < 0.1)) {
      position = { ...target };
      velocity = { ...TILT_REST };
      last = null;
    } else {
      frame = options.requestFrame(tick);
    }
    write();
  }

  function follow() {
    target = pending;
    if (frame === null && axes.some(a => position[a] !== target[a])) frame = options.requestFrame(tick);
  }

  function stop() {
    if (frame !== null) options.cancelFrame(frame);
    frame = last = null;
  }

  return {
    setTarget(next: Tilt, spotlight?: Spotlight) {
      pending = next;
      if (spotlight) options.writeSpotlight(spotlight);
      if (!frozen) follow();
    },
    setFrozen(next: boolean) {
      frozen = next;
      if (!next) follow();
    },
    snapToRest() {
      stop();
      target = pending = TILT_REST;
      position = { ...TILT_REST };
      velocity = { ...TILT_REST };
      write();
    },
    isMoving: () => frame !== null,
    dispose: stop,
  };
}
