import { describe, expect, it } from 'vitest';
import { computeYieldSummary } from '../analytics/yield-summary';
import { buildLotModel } from '../model/lot-builder';
import { parseStdfBytes } from '../stdf/stdf-parser';
import {
  DEMO_DIES_PER_WAFER,
  DEMO_WAFER_COUNT,
  type DemoPresetId,
  generateDemoStdfBytes,
  getDemoPresetPreview,
} from './demo-generator';

describe('getDemoPresetPreview (fast deterministic demo thumbnail & yield preview)', () => {
  const PRESET_IDS: readonly DemoPresetId[] = [
    'edge-ring-etch',
    'handling-scratch',
    'site2-probe-contact',
  ];

  it('matches full STDF parse finalYield and lot metadata across all 3 presets without serializing STDF bytes', () => {
    const expectedLotIds: Readonly<Record<DemoPresetId, string>> = {
      'edge-ring-etch': 'CAL-ER-2401',
      'handling-scratch': 'CAL-SC-2402',
      'site2-probe-contact': 'CAL-S2-2403',
    };

    for (const presetId of PRESET_IDS) {
      const preview = getDemoPresetPreview(presetId);
      expect(preview.presetId).toBe(presetId);
      expect(preview.lotId).toBe(expectedLotIds[presetId]);
      expect(preview.waferCount).toBe(DEMO_WAFER_COUNT);
      expect(preview.diesPerWafer).toBe(DEMO_DIES_PER_WAFER);
      expect(preview.totalDies).toBe(DEMO_WAFER_COUNT * DEMO_DIES_PER_WAFER);
      expect(preview.dies.count).toBe(DEMO_DIES_PER_WAFER);
      expect(preview.wafer.dieStartIndex).toBe(0);
      expect(preview.wafer.dieEndIndex).toBe(DEMO_DIES_PER_WAFER);

      const fullBytes = generateDemoStdfBytes(presetId);
      const parsed = parseStdfBytes(fullBytes, { mode: 'bins-only' });
      expect(parsed.ok).toBe(true);
      if (!parsed.ok) continue;
      const lot = buildLotModel(parsed.value);
      const summary = computeYieldSummary(lot);

      expect(preview.finalYield).toBeCloseTo(
        summary.overall.finalYield ?? 0,
        6,
      );

      // Cached / deterministic across repeated calls
      const second = getDemoPresetPreview(presetId);
      expect(second.finalYield).toBe(preview.finalYield);
      expect(Array.from(second.dies.finalPass)).toEqual(
        Array.from(preview.dies.finalPass),
      );
    }
  });
});
