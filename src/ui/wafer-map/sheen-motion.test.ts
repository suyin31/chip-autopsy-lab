import { describe, expect, it } from 'vitest';
import {
  canSheenFollow,
  computeSheenTarget,
  createSheenFollower,
  formatSheenTransform,
  SHEEN_CARD_AMPLITUDE_D,
  SHEEN_REST,
  SHEEN_STAGE_AMPLITUDE_D,
  stepSheenSpring,
} from './sheen-motion';

function createFrames() {
  let id = 0;
  let time = 0;
  const queue = new Map<number, (t: number) => void>();
  return {
    requestFrame: (cb: (t: number) => void) => {
      id += 1;
      queue.set(id, cb);
      return id;
    },
    cancelFrame: (frameId: number) => {
      queue.delete(frameId);
    },
    /** Runs pending frames at 60 Hz; returns the number of frames run. */
    run(maxFrames = 600) {
      let n = 0;
      while (queue.size > 0 && n < maxFrames) {
        time += 1000 / 60;
        const pending = [...queue.values()];
        queue.clear();
        for (const cb of pending) cb(time);
        n += 1;
      }
      return n;
    },
    pending: () => queue.size,
  };
}

describe('computeSheenTarget (premium §8.11)', () => {
  it('maps the clamped pointer offset to amplitude x D and dx x 3deg', () => {
    expect(computeSheenTarget(150, 100, 100, 100, 100, SHEEN_STAGE_AMPLITUDE_D)).toEqual({
      x: 0.025,
      y: 0,
      rotateDeg: 1.5,
    });
    const far = computeSheenTarget(-900, 900, 100, 100, 100, SHEEN_CARD_AMPLITUDE_D);
    expect(far).toEqual({ x: -0.03, y: 0.03, rotateDeg: -3 });
  });

  it('rests for a degenerate disc', () => {
    expect(computeSheenTarget(10, 10, 0, 0, 0, 0.05)).toBe(SHEEN_REST);
  });
});

describe('formatSheenTransform', () => {
  it('returns the §5.2 rest transform at rest', () => {
    expect(formatSheenTransform(SHEEN_REST)).toBe('rotate(-24deg)');
  });

  it('translates in percent of the 0.92 D x 0.58 D ellipse', () => {
    expect(formatSheenTransform({ x: 0.046, y: 0.029, rotateDeg: 3 })).toBe(
      'translate(5%, 5%) rotate(-21deg)',
    );
  });
});

describe('stepSheenSpring', () => {
  it('approaches the target without overshoot (spring-sheen is about critically damped)', () => {
    let state = { position: SHEEN_REST, velocity: SHEEN_REST };
    const target = { x: 0.05, y: -0.05, rotateDeg: 3 };
    let maxX = 0;
    for (let i = 0; i < 120; i += 1) {
      state = stepSheenSpring(state, target, 1000 / 60);
      maxX = Math.max(maxX, state.position.x);
    }
    expect(state.position.x).toBeCloseTo(0.05, 4);
    expect(state.position.rotateDeg).toBeCloseTo(3, 2);
    expect(maxX).toBeLessThanOrEqual(0.05 * 1.01);
  });
});

describe('createSheenFollower', () => {
  it('writes one transform per moving frame and stops once settled', () => {
    const frames = createFrames();
    const writes: string[] = [];
    const follower = createSheenFollower({ ...frames, write: (t) => writes.push(t) });
    follower.setTarget({ x: 0.05, y: 0, rotateDeg: 3 });
    expect(follower.isMoving()).toBe(true);
    const n = frames.run();
    expect(n).toBeGreaterThan(5);
    expect(n).toBeLessThan(600);
    expect(writes.length).toBeLessThanOrEqual(n);
    expect(writes.at(-1)).toBe(formatSheenTransform({ x: 0.05, y: 0, rotateDeg: 3 }));
    expect(follower.isMoving()).toBe(false);
  });

  it('holds the target while frozen and takes the latest one on release', () => {
    const frames = createFrames();
    const writes: string[] = [];
    const follower = createSheenFollower({ ...frames, write: (t) => writes.push(t) });
    follower.setFrozen(true);
    follower.setTarget({ x: 0.05, y: 0, rotateDeg: 3 });
    expect(frames.pending()).toBe(0);
    follower.setTarget({ x: -0.05, y: 0, rotateDeg: -3 });
    follower.setFrozen(false);
    frames.run();
    expect(writes.at(-1)).toBe(formatSheenTransform({ x: -0.05, y: 0, rotateDeg: -3 }));
  });

  it('returns to rest on a rest target and snaps under reduced motion', () => {
    const frames = createFrames();
    const writes: string[] = [];
    const follower = createSheenFollower({ ...frames, write: (t) => writes.push(t) });
    follower.setTarget({ x: 0.03, y: 0.03, rotateDeg: 3 });
    frames.run(5);
    follower.snapToRest();
    expect(frames.pending()).toBe(0);
    expect(writes.at(-1)).toBe('rotate(-24deg)');
  });
});

describe('canSheenFollow', () => {
  const env = { hoverCapable: true, reducedMotion: false, reducedTransparency: false };
  it('follows a hovering mouse or pen only', () => {
    expect(canSheenFollow('mouse', env)).toBe(true);
    expect(canSheenFollow('pen', env)).toBe(true);
    expect(canSheenFollow('touch', env)).toBe(false);
    expect(canSheenFollow('mouse', { ...env, hoverCapable: false })).toBe(false);
    expect(canSheenFollow('mouse', { ...env, reducedMotion: true })).toBe(false);
    expect(canSheenFollow('mouse', { ...env, reducedTransparency: true })).toBe(false);
  });
});
