import { describe, expect, it } from 'vitest';
import { formatPercent } from '@/core/i18n';
import { buildStatFacts, generateOfflineAutopsyReport } from '@/core/report';
import { ingestDemoPreset } from '@/workers';
import {
  buildLandingReticleTicks,
  computeLandingReticleTickLines,
  LANDING_EXAMPLE_EDGE_SHARE,
  LANDING_RETICLE_GAP_PX,
  resolveLandingHeroWaferSize,
  resolveLandingWaferSize,
  roundSvgCoord,
} from './landing-layout';

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

describe('landing hero wafer and reticle (premium §11.1)', () => {
  it('uses 440 / 360 / 280 / 240 px at 1440-1280 / 1024 / sm / xs', () => {
    expect(resolveLandingHeroWaferSize(1440)).toBe(440);
    expect(resolveLandingHeroWaferSize(1280)).toBe(440);
    expect(resolveLandingHeroWaferSize(1279)).toBe(360);
    expect(resolveLandingHeroWaferSize(1024)).toBe(360);
    expect(resolveLandingHeroWaferSize(1023)).toBe(280);
    expect(resolveLandingHeroWaferSize(640)).toBe(280);
    expect(resolveLandingHeroWaferSize(639)).toBe(240);
    expect(resolveLandingHeroWaferSize(390)).toBe(240);
  });

  it('builds 72 ticks, 8 px at 0 / 90 / 180 / 270 degrees and 4 px elsewhere', () => {
    const ticks = buildLandingReticleTicks();
    expect(ticks).toHaveLength(72);
    expect(ticks.filter((t) => t.lengthPx === 8).map((t) => t.angleDeg)).toEqual([
      0, 90, 180, 270,
    ]);
    expect(ticks.filter((t) => t.lengthPx === 4)).toHaveLength(68);
  });

  it('rounds reticle SVG line coordinates to 3 decimals for cross-engine SSR hydration parity', () => {
    expect(Object.is(roundSvgCoord(-0.0001), 0)).toBe(true);
    expect(roundSvgCoord(99.33733542039141)).toBe(99.337);

    for (const waferSize of [320, 280, 240, 220]) {
      const reticleD = waferSize + LANDING_RETICLE_GAP_PX * 2;
      const reticleR = reticleD / 2;
      const cx = (reticleD + 48 * 2) / 2;
      const cy = (reticleD + 32 * 2) / 2;
      const lines = computeLandingReticleTickLines(cx, cy, reticleR);
      expect(lines).toHaveLength(72);

      for (const line of lines) {
        for (const coord of [line.x1, line.y1, line.x2, line.y2]) {
          expect(Number.isFinite(coord)).toBe(true);
          expect(String(coord)).toMatch(/^\d+(?:\.\d{1,3})?$/);
        }
        const length = Math.hypot(line.x2 - line.x1, line.y2 - line.y1);
        expect(length).toBeCloseTo(line.lengthPx, 2);
      }
    }
  });
});

describe('landing example result card (premium §11.1)', () => {
  it('quotes the engine edge-share stat of edge-ring-etch', async () => {
    const res = await ingestDemoPreset('edge-ring-etch');
    expect(res.kind).toBe('ok');
    if (res.kind !== 'ok') return;
    const { lot } = res;
    const { analysis, verdict } = generateOfflineAutopsyReport(lot);
    const stats = buildStatFacts({ lot, verdict, analysis });
    expect(stats[0]?.captionKey).toBe('stats.edgeShare');
    const percent = (ratio: number) => formatPercent('en', ratio);
    expect(percent(stats[0]!.value)).toBe(percent(LANDING_EXAMPLE_EDGE_SHARE));
    expect(percent(LANDING_EXAMPLE_EDGE_SHARE)).toBe('93.8%');
  });
});
