import { describe, expect, it } from 'vitest';

import {
  buildWaferDiscMaskImage,
  buildWaferOutlineSvgPath,
  computeSheenEllipseRestStyle,
  computeStageDiscLayerRects,
} from './stage-layers';

describe('stage disc layers (premium §5.1, §5.2 step 6, §3.3)', () => {
  it('sizes and places ambient, contact, halo, and sheen boxes from the disc diameter', () => {
    // Disc centre (400, 300), R = 250, D = 500
    const rects = computeStageDiscLayerRects(400, 300, 250);
    // Ambient: circle 1.16 D, offset +0.04 D down
    expect(rects.ambient.width).toBeCloseTo(580);
    expect(rects.ambient.height).toBeCloseTo(580);
    expect(rects.ambient.left + rects.ambient.width / 2).toBeCloseTo(400);
    expect(rects.ambient.top + rects.ambient.height / 2).toBeCloseTo(320);
    // Contact: ellipse 0.86 D x 0.10 D, centred 0.035 D below the lowest point (y = 550)
    expect(rects.contact.width).toBeCloseTo(430);
    expect(rects.contact.height).toBeCloseTo(50);
    expect(rects.contact.left + rects.contact.width / 2).toBeCloseTo(400);
    expect(rects.contact.top + rects.contact.height / 2).toBeCloseTo(567.5);
    // Halo: circle 1.5 D on the disc centre
    expect(rects.halo.width).toBeCloseTo(750);
    expect(rects.halo.left).toBeCloseTo(25);
    expect(rects.halo.top).toBeCloseTo(-75);
    // Sheen: the disc's bounding square
    expect(rects.sheen).toEqual({ left: 150, top: 50, width: 500, height: 500 });
  });

  it('places the sheen ellipse 0.92 D x 0.58 D at (0.34 D, 0.26 D), rotated -24deg', () => {
    expect(computeSheenEllipseRestStyle()).toEqual({
      left: '-12%',
      top: '-3%',
      width: '92%',
      height: '58%',
      transform: 'rotate(-24deg)',
    });
  });

  it('cuts the mask notch at the WF_FLAT orientation with the §5.2 depth', () => {
    // Bottom notch (default): apex 0.016 D (16 units) above the bottom edge; the rounded
    // apex's tangent points sit just below it on the two notch edges
    const bottom = buildWaferOutlineSvgPath('D');
    expect(bottom.startsWith('M')).toBe(true);
    expect(bottom).toContain('A500 500 0 1 1');
    const lineTo = /L([\d.]+) ([\d.]+)/.exec(bottom);
    expect(lineTo).not.toBeNull();
    const [, lx, ly] = lineTo!;
    expect(Math.abs(Number(lx) - 500)).toBeLessThan(3);
    expect(Number(ly)).toBeGreaterThan(984);
    expect(Number(ly)).toBeLessThan(988);
    // The notch turns inward (counter-clockwise), so the apex arc has sweep 0
    expect(bottom).toMatch(/A2 2 0 0 0 /);
    // Top notch mirrors it with the apex at y = 16
    const top = /L([\d.]+) ([\d.]+)/.exec(buildWaferOutlineSvgPath('U'))!;
    expect(Number(top[2])).toBeGreaterThan(12);
    expect(Number(top[2])).toBeLessThan(16);
  });

  it('encodes the outline as an SVG data URI for mask-image', () => {
    const mask = buildWaferDiscMaskImage('D');
    expect(mask.startsWith('url("data:image/svg+xml,')).toBe(true);
    expect(decodeURIComponent(mask)).toContain(buildWaferOutlineSvgPath('D'));
  });
});
