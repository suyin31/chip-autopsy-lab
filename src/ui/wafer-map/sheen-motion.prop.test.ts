import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { computeSheenTarget, SHEEN_ROTATE_PER_DX_DEG } from './sheen-motion';

describe('computeSheenTarget property (premium §8.11)', () => {
  it('never exceeds amplitude x D or 3deg, and keeps the pointer direction', () => {
    fc.assert(
      fc.property(
        fc.double({ min: -1e4, max: 1e4, noNaN: true }),
        fc.double({ min: -1e4, max: 1e4, noNaN: true }),
        fc.double({ min: 1, max: 2000, noNaN: true }),
        fc.constantFrom(0.03, 0.05),
        (dx, dy, r, amp) => {
          const t = computeSheenTarget(dx, dy, 0, 0, r, amp);
          expect(Math.abs(t.x)).toBeLessThanOrEqual(amp + 1e-12);
          expect(Math.abs(t.y)).toBeLessThanOrEqual(amp + 1e-12);
          expect(Math.abs(t.rotateDeg)).toBeLessThanOrEqual(SHEEN_ROTATE_PER_DX_DEG + 1e-12);
          if (Math.abs(dx) > 1e-9) expect(Math.sign(t.x)).toBe(Math.sign(dx));
          if (Math.abs(dy) > 1e-9) expect(Math.sign(t.y)).toBe(Math.sign(dy));
        },
      ),
    );
  });
});
