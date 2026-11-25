import { describe, expect, it } from 'vitest';
import {
  computeBinPareto,
  computeLotParametricSummaries,
  computeParametricHistogram,
} from '@/core/analytics';
import { formatPercent } from '@/core/i18n';
import { buildStatFacts, generateOfflineAutopsyReport } from '@/core/report';
import { ingestDemoPreset } from '@/workers';
import {
  buildLandingReticleTicks,
  computeLandingReticleTickLines,
  LANDING_EXAMPLE_EDGE_SHARE,
  LANDING_IDDQ_HI_LIMIT_UA,
  LANDING_IDDQ_MAX_BIN_COUNT,
  LANDING_IDDQ_MEAN_UA,
  LANDING_IDDQ_SPECTRUM_BINS,
  LANDING_RETICLE_GAP_PX,
  LANDING_TELEMETRY_LENSES,
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

  it('couples LiveTelemetryStrip lenses and 28-bin IDDQ_LEAK spectrum to real engine figures', async () => {
    const er = await ingestDemoPreset('edge-ring-etch');
    const s2 = await ingestDemoPreset('site2-probe-contact');
    expect(er.kind).toBe('ok');
    expect(s2.kind).toBe('ok');
    if (er.kind !== 'ok' || s2.kind !== 'ok') return;

    const pareto = computeBinPareto(er.lot, 'SBIN');
    const summaries = computeLotParametricSummaries(er.lot);
    const iddq = summaries.find((s) => s.testName === 'IDDQ_LEAK')!;
    const hist = computeParametricHistogram(er.lot.tests.get(iddq.testNum)!);
    const spatialFact = er.facts.find((f) => f.kind === 'spatial-pattern')!;

    // Lens 0: all fails (CAL-ER-2401)
    expect(LANDING_TELEMETRY_LENSES[0]!.dies).toBe(er.verdict.totalFailDies);
    expect(formatPercent('en', er.verdict.finalYield)).toBe(
      LANDING_TELEMETRY_LENSES[0]!.primaryStat,
    );
    expect(`Cpk ${(iddq.cpk ?? 0).toFixed(2)}`).toBe(
      LANDING_TELEMETRY_LENSES[0]!.secondaryStat,
    );

    // Lens 1: outer 3 rings
    expect(LANDING_TELEMETRY_LENSES[1]!.dies).toBe(spatialFact.dieIndices.length);
    expect(LANDING_TELEMETRY_LENSES[1]!.primaryStat).toBe('93.8%');

    // Lens 2: only bin 7
    expect(LANDING_TELEMETRY_LENSES[2]!.dies).toBe(pareto.entries[0]!.count);
    expect(formatPercent('en', pareto.entries[0]!.shareOfFailures)).toBe(
      LANDING_TELEMETRY_LENSES[2]!.primaryStat,
    );

    // Lens 3: site 1:2 (CAL-S2-2403 first-pass fail dies & rate)
    const site2Metrics = s2.yieldSummary.bySite[1]!;
    expect(LANDING_TELEMETRY_LENSES[3]!.dies).toBe(site2Metrics.firstPassFailDies);
    expect(formatPercent('en', 1 - (site2Metrics.firstPassYield ?? 0))).toBe(
      LANDING_TELEMETRY_LENSES[3]!.primaryStat,
    );

    // Exact 28-bin IDDQ_LEAK histogram match
    expect(LANDING_IDDQ_MAX_BIN_COUNT).toBe(hist.maxBinCount);
    expect(LANDING_IDDQ_HI_LIMIT_UA).toBe(Number(((hist.hiLimit ?? 0) * 1e6).toFixed(1)));
    expect(LANDING_IDDQ_MEAN_UA).toBe(Number(((iddq.mean ?? 0) * 1e6).toFixed(2)));
    expect(LANDING_IDDQ_SPECTRUM_BINS).toEqual(
      hist.bins.map((b) => ({
        loUa: Number((b.x0 * 1e6).toFixed(1)),
        hiUa: Number((b.x1 * 1e6).toFixed(1)),
        count: b.count,
        outOfSpec: b.outOfSpec,
      })),
    );
  });
});
