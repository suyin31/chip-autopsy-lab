import { describe, expect, it, vi } from 'vitest';
import { canTilt, computeSpotlight, computeTiltTarget, createTiltFollower, formatTiltTransform, TILT_REST } from './tilt';

const box = { left: 10, top: 20, width: 100, height: 50 };

describe('tactile tilt', () => {
  it('normalises from the centre and clamps at both edges', () => {
    for (const point of [{ x: 10, y: 20 }, { x: -500, y: -500 }])
      expect(computeTiltTarget(point, box, 4)).toEqual({ rotateX: 4, rotateY: -4 });
    expect(computeTiltTarget({ x: 150, y: 70 }, box, 4)).toEqual({ rotateX: -4, rotateY: 4 });
    expect(computeTiltTarget({ x: 60, y: 45 }, box, 4)).toEqual(TILT_REST);
    expect(computeTiltTarget({ x: 60.123, y: 45.001 }, box, 4)).toEqual({ rotateX: 0, rotateY: 0.01 });
    for (const width of [0, -1, NaN, Infinity])
      expect(computeTiltTarget({ x: 20, y: 20 }, { ...box, width }, 4)).toEqual(TILT_REST);
    expect(computeSpotlight({ x: 11.26, y: 100 }, box)).toEqual({ x: '1.3px', y: '50px' });
  });

  it('leaves rest empty and formats a tilted frame', () => {
    expect(formatTiltTransform(TILT_REST)).toBe('');
    expect(formatTiltTransform({ rotateX: -2.13, rotateY: 1.4 })).toBe(
      'perspective(900px) rotateX(-2.13deg) rotateY(1.4deg) translateZ(6px)');
  });

  it('tracks light immediately and stops scheduling once settled', () => {
    const frames: FrameRequestCallback[] = [];
    const write = vi.fn();
    const writeSpotlight = vi.fn();
    const follower = createTiltFollower({ write, writeSpotlight,
      requestFrame: cb => frames.push(cb), cancelFrame: vi.fn() });
    const target = { rotateX: 1, rotateY: 3 };
    const spot = { x: '20px', y: '8px' };
    follower.setTarget(target, spot);
    expect(writeSpotlight).toHaveBeenCalledWith(spot);
    for (let i = 0; frames.length && i < 300; i++) frames.shift()?.(i * 16);
    expect(write).toHaveBeenLastCalledWith(formatTiltTransform(target));
    expect(frames).toHaveLength(0);
    expect(follower.isMoving()).toBe(false);
    follower.snapToRest();
    expect(write).toHaveBeenLastCalledWith('');
  });

  it('permits only hovering pointers with both effects enabled', () => {
    for (const pointer of ['mouse', 'pen', 'touch'])
      for (const hoverCapable of [true, false])
        for (const reducedMotion of [true, false])
          for (const reducedTransparency of [true, false]) {
            const allowed = canTilt(pointer, { hoverCapable, reducedMotion, reducedTransparency });
            expect(allowed).toBe(pointer !== 'touch' && hoverCapable && !reducedMotion && !reducedTransparency);
            if (reducedMotion) expect(formatTiltTransform(allowed ? { rotateX: 2, rotateY: 2 } : TILT_REST)).toBe('');
          }
  });
});
