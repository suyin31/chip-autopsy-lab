import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildGoldenStdfFixtures,
  GOLDEN_FIXTURE_NAMES,
} from './__test-utils__/golden-fixtures';
import { parseStdfBytes } from './stdf-parser';
import { STDF_RECORD_CODES } from './types';

const fixturesDir = path.resolve(import.meta.dirname, '../../../tests/fixtures');

/**
 * Deterministic golden-fixture regeneration & verification suite.
 *
 * To regenerate fixtures deterministically on disk:
 *   REGENERATE_FIXTURES=1 npx vitest run src/core/stdf/stdf-fixtures.test.ts
 */
describe('STDF V4 golden binary fixtures in tests/fixtures/ (Requirements 1.5, 2.2, 2.3, 3.1)', () => {
  const expectedFixtures = buildGoldenStdfFixtures();

  if (process.env.REGENERATE_FIXTURES === '1') {
    fs.mkdirSync(fixturesDir, { recursive: true });
    for (const fileName of GOLDEN_FIXTURE_NAMES) {
      fs.writeFileSync(path.join(fixturesDir, fileName), expectedFixtures[fileName]);
    }
  }

  it('produces byte-for-byte identical output across repeated generator runs and matches tests/fixtures/*.stdf on disk', () => {
    const secondRun = buildGoldenStdfFixtures();
    for (const fileName of GOLDEN_FIXTURE_NAMES) {
      expect(secondRun[fileName]).toEqual(expectedFixtures[fileName]);

      const diskPath = path.join(fixturesDir, fileName);
      expect(fs.existsSync(diskPath)).toBe(true);
      const diskBytes = new Uint8Array(fs.readFileSync(diskPath));
      expect(diskBytes).toEqual(expectedFixtures[fileName]);
    }
  });

  it('parses golden-big-endian.stdf and golden-little-endian.stdf to identical normalized lot data', () => {
    const beBytes = new Uint8Array(
      fs.readFileSync(path.join(fixturesDir, 'golden-big-endian.stdf')),
    );
    const leBytes = new Uint8Array(
      fs.readFileSync(path.join(fixturesDir, 'golden-little-endian.stdf')),
    );

    // Same payload length, opposite endianness byte order
    expect(beBytes.byteLength).toBe(leBytes.byteLength);
    expect(beBytes[4]).toBe(1);
    expect(leBytes[4]).toBe(2);

    const beParsed = parseStdfBytes(beBytes, { mode: 'full' });
    const leParsed = parseStdfBytes(leBytes, { mode: 'full' });

    expect(beParsed.ok).toBe(true);
    expect(leParsed.ok).toBe(true);
    if (!beParsed.ok || !leParsed.ok) return;

    expect(beParsed.value.endianness).toBe('big');
    expect(leParsed.value.endianness).toBe('little');
    expect(beParsed.value.warnings).toEqual([]);
    expect(leParsed.value.warnings).toEqual([]);
    expect(beParsed.value.validPrrCount).toBe(3);
    expect(leParsed.value.validPrrCount).toBe(3);
    expect(beParsed.value.skippedRecordCount).toBe(1);

    // Strip byteOffsets/endianness and verify deep structural equivalence
    const normalizeParts = (lot: typeof beParsed.value) =>
      lot.wafers.map((w) => ({
        wir: w.wir,
        wrr: w.wrr,
        wcr: w.wcr,
        parts: w.parts.map(({ byteOffset: _b, ...rest }) => rest),
      }));

    expect(beParsed.value.mir).toEqual(leParsed.value.mir);
    expect(beParsed.value.mrr).toEqual(leParsed.value.mrr);
    expect(beParsed.value.hbrs).toEqual(leParsed.value.hbrs);
    expect(beParsed.value.sbrs).toEqual(leParsed.value.sbrs);
    expect(beParsed.value.sdrs).toEqual(leParsed.value.sdrs);
    expect(beParsed.value.tsrs).toEqual(leParsed.value.tsrs);
    expect(beParsed.value.pcrs).toEqual(leParsed.value.pcrs);
    expect(beParsed.value.ptrDefaults).toEqual(leParsed.value.ptrDefaults);
    expect(normalizeParts(beParsed.value)).toEqual(normalizeParts(leParsed.value));
  });

  it('recovers all 3 complete PRRs and emits TRUNCATED_TAIL_RECORD on golden-truncated.stdf', () => {
    const truncBytes = new Uint8Array(
      fs.readFileSync(path.join(fixturesDir, 'golden-truncated.stdf')),
    );
    const parsed = parseStdfBytes(truncBytes, { mode: 'full' });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    expect(parsed.value.validPrrCount).toBe(3);
    expect(parsed.value.wafers[0]?.parts).toHaveLength(3);
    expect(parsed.value.mrr).toBeNull();
    expect(parsed.value.warnings).toHaveLength(1);
    expect(parsed.value.warnings[0]?.code).toBe('TRUNCATED_TAIL_RECORD');
    expect(parsed.value.warnings[0]?.recTyp).toBe(STDF_RECORD_CODES.MRR.recTyp);
    expect(parsed.value.warnings[0]?.recSub).toBe(STDF_RECORD_CODES.MRR.recSub);
  });

  it('skips the mid-stream malformed SBR by REC_LEN and recovers all dies on golden-malformed.stdf', () => {
    const malBytes = new Uint8Array(
      fs.readFileSync(path.join(fixturesDir, 'golden-malformed.stdf')),
    );
    const parsed = parseStdfBytes(malBytes, { mode: 'full' });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    expect(parsed.value.validPrrCount).toBe(3);
    expect(parsed.value.sbrs).toHaveLength(2); // 2 valid SBRs still decoded after skipping bad SBR
    expect(parsed.value.mrr?.usrDesc).toBe('GOLDEN_FIXTURE_COMPLETE');
    expect(parsed.value.warnings).toHaveLength(1);
    expect(parsed.value.warnings[0]?.code).toBe('MALFORMED_RECORD_FIELD');
    expect(parsed.value.warnings[0]?.recTyp).toBe(STDF_RECORD_CODES.SBR.recTyp);
    expect(parsed.value.warnings[0]?.recSub).toBe(STDF_RECORD_CODES.SBR.recSub);
  });
});
