import { describe, expect, it } from 'vitest';
import { resolveLandingWaferSize } from './landing-layout';

describe('landing card wafer sizes (premium §6.1)', () => {
  it('uses 152 / 140 / 120 px at 1440 / 1280 / 1024 and 112 px below 1024', () => {
    expect(resolveLandingWaferSize(1920)).toBe(152);
    expect(resolveLandingWaferSize(1440)).toBe(152);
    expect(resolveLandingWaferSize(1439)).toBe(140);
    expect(resolveLandingWaferSize(1280)).toBe(140);
    expect(resolveLandingWaferSize(1279)).toBe(120);
    expect(resolveLandingWaferSize(1024)).toBe(120);
    expect(resolveLandingWaferSize(1023)).toBe(112);
    expect(resolveLandingWaferSize(800)).toBe(112);
    expect(resolveLandingWaferSize(390)).toBe(112);
  });
});
