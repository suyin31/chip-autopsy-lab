import { describe, expect, it } from 'vitest';
import { formatPercent } from '@/core/i18n';
import { buildStatFacts, generateOfflineAutopsyReport } from '@/core/report';
import { ingestDemoPreset } from '@/workers';
import {
  buildLandingReticleTicks,
  LANDING_EXAMPLE_EDGE_SHARE,
  resolveLandingHeroWaferSize,
  resolveLandingWaferSize,
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
  it('uses 320 / 280 / 240 / 220 px at 1440-1280 / 1024 / sm / xs', () => {
    expect(resolveLandingHeroWaferSize(1440)).toBe(320);
    expect(resolveLandingHeroWaferSize(1280)).toBe(320);
    expect(resolveLandingHeroWaferSize(1279)).toBe(280);
    expect(resolveLandingHeroWaferSize(1024)).toBe(280);
    expect(resolveLandingHeroWaferSize(1023)).toBe(240);
    expect(resolveLandingHeroWaferSize(640)).toBe(240);
    expect(resolveLandingHeroWaferSize(639)).toBe(220);
    expect(resolveLandingHeroWaferSize(390)).toBe(220);
  });

  it('builds 72 ticks, 8 px at 0 / 90 / 180 / 270 degrees and 4 px elsewhere', () => {
    const ticks = buildLandingReticleTicks();
    expect(ticks).toHaveLength(72);
    expect(ticks.filter((t) => t.lengthPx === 8).map((t) => t.angleDeg)).toEqual([
      0, 90, 180, 270,
    ]);
    expect(ticks.filter((t) => t.lengthPx === 4)).toHaveLength(68);
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
