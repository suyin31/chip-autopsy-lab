/**
 * Round-trip tests for `.stdf` export of each built-in synthetic demo lot
 * (`edge-ring-etch.stdf`, `handling-scratch.stdf`, `site2-probe-contact.stdf`).
 *
 * Verifies that downloaded `.stdf` bytes generated from `demo-generator.ts` /
 * `stdf-writer.ts` parse back through `parseStdfBytes` + `buildLotModel` to the
 * exact same resolved die count (`15,825` dies across `25` wafers).
 *
 * Validates: Requirements 3.1, 3.3, 3.4, 17.7
 */

import { describe, expect, it } from 'vitest';
import { computeYieldSummary } from '../analytics/yield-summary';
import { buildLotModel } from '../model/lot-builder';
import { parseStdfBytes } from '../stdf/stdf-parser';
import {
  buildDemoStdfDownload,
  DEMO_DIES_PER_WAFER,
  DEMO_WAFER_COUNT,
  type DemoPresetId,
  generateDemoLot,
  getDemoStdfFileName,
  listDemoPresets,
} from './demo-generator';

const EXPECTED_PRESET_FILES: ReadonlyArray<{
  readonly presetId: DemoPresetId;
  readonly expectedFileName: `${DemoPresetId}.stdf`;
}> = [
  { presetId: 'edge-ring-etch', expectedFileName: 'edge-ring-etch.stdf' },
  { presetId: 'handling-scratch', expectedFileName: 'handling-scratch.stdf' },
  { presetId: 'site2-probe-contact', expectedFileName: 'site2-probe-contact.stdf' },
];

describe('demo lot .stdf download round-trip (Requirement 3.4)', () => {
  it('generates canonical <preset>.stdf filenames for all built-in demo lots', () => {
    const presets = listDemoPresets();
    expect(presets.map((p) => getDemoStdfFileName(p.id))).toEqual([
      'edge-ring-etch.stdf',
      'handling-scratch.stdf',
      'site2-probe-contact.stdf',
    ]);
  });

  it.each(EXPECTED_PRESET_FILES)(
    'round-trips downloaded $expectedFileName bytes back to the exact same die count ($presetId)',
    ({ presetId, expectedFileName }) => {
      const generated = generateDemoLot(presetId);
      const downloaded = buildDemoStdfDownload(presetId);

      expect(downloaded.fileName).toBe(expectedFileName);
      expect(downloaded.mimeType).toBe('application/octet-stream');
      expect(downloaded.bytes).toEqual(generated.stdfBytes);

      const parsed = parseStdfBytes(downloaded.bytes, { mode: 'full' });
      expect(parsed.ok).toBe(true);
      if (!parsed.ok) return;

      const lot = buildLotModel(parsed.value);
      const yieldSummary = computeYieldSummary(lot);

      const expectedDieCount = DEMO_WAFER_COUNT * DEMO_DIES_PER_WAFER;
      expect(lot.dies.count).toBe(expectedDieCount);
      expect(lot.dies.count).toBe(generated.groundTruth.totalDies);
      expect(lot.wafers).toHaveLength(DEMO_WAFER_COUNT);
      expect(yieldSummary.overall.testedDies).toBe(expectedDieCount);
    },
  );
});
