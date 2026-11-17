/**
 * Property 2: Parser Bounds Safety and Truncated-Stream Recovery (`fast-check`).
 *
 * Verifies across arbitrary `Uint8Array` fuzz inputs, corrupted `FAR` and record headers,
 * mid-stream malformed variable-length records, and valid STDF V4 streams truncated at
 * every and random byte offsets `k`:
 * 1. `parseStdfBytes` terminates in finite time without throwing uncaught exceptions
 *    or reading outside `Uint8Array` view bounds.
 * 2. Truncated valid streams recover every complete record contained in the prefix
 *    (including all `m >= 1` complete `PRR` records identically to the untruncated stream)
 *    and emit a `TRUNCATED_TAIL_RECORD` warning citing the exact truncation offset when
 *    cut mid-header or mid-body.
 *
 * Validates: Requirements 2.1, 2.2, 2.3
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { arbStdfWriteLotSpec } from '../__test-utils__/arbitraries';
import { createCanonicalFixtureLotSpec } from './__test-utils__/golden-fixtures';
import { parseStdfBytes } from './stdf-parser';
import { writeStdfBytes } from './stdf-writer';
import {
  type CpuEndianness,
  type ParsedLotBuildInput,
  type ParsedPartExecution,
  type ParseMode,
  STDF_RECORD_CODES,
  STDF_RECORD_HEADER_BYTES,
  type StdfRecordHeader,
} from './types';

const NUM_RUNS = Number(process.env.FC_NUM_RUNS ?? 200);

const ALL_RECORD_CODE_PAIRS: ReadonlyArray<readonly [number, number]> = [
  ...Object.values(STDF_RECORD_CODES).map(
    (c): readonly [number, number] => [c.recTyp, c.recSub],
  ),
  [0, 20], // ATR
  [1, 60], // PMR
  [1, 90], // PSR (V4-2007)
  [15, 30], // STR (V4-2007)
  [50, 10], // GDR
  [50, 30], // DTR
  [255, 255], // Unknown
];

function makeFarHeaderBytes(endianness: CpuEndianness): Uint8Array {
  return endianness === 'little'
    ? new Uint8Array([0x02, 0x00, 0x00, 0x0a, 0x02, 0x04])
    : new Uint8Array([0x00, 0x02, 0x00, 0x0a, 0x01, 0x04]);
}

function scanValidRecordBoundaries(
  bytes: Uint8Array,
  endianness: CpuEndianness,
): readonly StdfRecordHeader[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const littleEndian = endianness === 'little';
  const records: StdfRecordHeader[] = [];
  let offset = 0;

  while (offset + STDF_RECORD_HEADER_BYTES <= bytes.byteLength) {
    const recLen = view.getUint16(offset, littleEndian);
    const recTyp = bytes[offset + 2]!;
    const recSub = bytes[offset + 3]!;
    const nextOffset = offset + STDF_RECORD_HEADER_BYTES + recLen;
    if (nextOffset > bytes.byteLength) {
      break;
    }
    records.push({ recLen, recTyp, recSub, byteOffset: offset });
    offset = nextOffset;
  }

  return records;
}

function flattenParts(lot: ParsedLotBuildInput): readonly ParsedPartExecution[] {
  const out: ParsedPartExecution[] = [];
  for (const wafer of lot.wafers) {
    for (const part of wafer.parts) {
      out.push(part);
    }
  }
  return out;
}

function assertWellFormedParseOutcome(bytes: Uint8Array, mode: ParseMode): void {
  let progressCalls = 0;
  let lastBytesProcessed = 0;

  const result = parseStdfBytes(bytes, {
    mode,
    onProgress: (progress) => {
      progressCalls += 1;
      expect(progress.bytesProcessed).toBeGreaterThanOrEqual(lastBytesProcessed);
      expect(progress.bytesProcessed).toBeLessThanOrEqual(bytes.byteLength);
      expect(progress.recordsDecoded).toBeGreaterThanOrEqual(1);
      expect(progress.diesResolved).toBeGreaterThanOrEqual(0);
      lastBytesProcessed = progress.bytesProcessed;
    },
  });

  if (result.ok) {
    expect(result.value.validPrrCount).toBeGreaterThanOrEqual(1);
    expect(progressCalls).toBeGreaterThanOrEqual(1);
    for (const warning of result.value.warnings) {
      expect(warning.byteOffset).toBeGreaterThanOrEqual(0);
      expect(warning.byteOffset).toBeLessThanOrEqual(bytes.byteLength);
      expect(warning.recTyp).toBeGreaterThanOrEqual(0);
      expect(warning.recTyp).toBeLessThanOrEqual(255);
      expect(warning.recSub).toBeGreaterThanOrEqual(0);
      expect(warning.recSub).toBeLessThanOrEqual(255);
    }
  } else {
    expect(result.error.message.length).toBeGreaterThan(0);
    if (result.error.byteOffset !== undefined) {
      expect(result.error.byteOffset).toBeGreaterThanOrEqual(0);
      expect(result.error.byteOffset).toBeLessThanOrEqual(bytes.byteLength);
    }
  }
}

function assertTruncatedPrefixRecovery(
  fullBytes: Uint8Array,
  endianness: CpuEndianness,
  records: readonly StdfRecordHeader[],
  _fullLot: ParsedLotBuildInput,
  fullParts: readonly ParsedPartExecution[],
  cutOffset: number,
  mode: ParseMode = 'full',
): void {
  const prefix = fullBytes.subarray(0, cutOffset);
  const res = parseStdfBytes(prefix, { mode });

  if (cutOffset === 0) {
    expect(res).toEqual({
      ok: false,
      error: expect.objectContaining({ code: 'EMPTY_INPUT', byteOffset: 0 }),
    });
    return;
  }

  if (cutOffset < 6) {
    expect(res).toEqual({
      ok: false,
      error: expect.objectContaining({ code: 'MISSING_FAR_HEADER', byteOffset: 0 }),
    });
    return;
  }

  let completeRecordCount = 0;
  let completePrrCount = 0;
  let cleanBoundary = 0;

  for (let i = 0; i < records.length; i += 1) {
    const r = records[i]!;
    const recEnd = r.byteOffset + STDF_RECORD_HEADER_BYTES + r.recLen;
    if (recEnd <= cutOffset) {
      completeRecordCount += 1;
      cleanBoundary = recEnd;
      if (
        r.recTyp === STDF_RECORD_CODES.PRR.recTyp &&
        r.recSub === STDF_RECORD_CODES.PRR.recSub
      ) {
        completePrrCount += 1;
      }
    } else {
      break;
    }
  }

  if (completePrrCount === 0) {
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.code).toBe('ZERO_VALID_PRR');
    }
    return;
  }

  expect(res.ok).toBe(true);
  if (!res.ok) return;

  expect(res.value.endianness).toBe(endianness);
  expect(res.value.validPrrCount).toBe(completePrrCount);

  if (mode === 'full') {
    // Every complete PRR in the prefix matches the full untruncated stream identically
    const recoveredParts = flattenParts(res.value);
    expect(recoveredParts).toEqual(fullParts.slice(0, completePrrCount));
  }

  // Every other complete record in [0, cleanBoundary) matches the clean boundary prefix identically
  const cleanPrefixRes = parseStdfBytes(fullBytes.subarray(0, cleanBoundary), { mode });
  expect(cleanPrefixRes.ok).toBe(true);
  if (!cleanPrefixRes.ok) return;

  expect(cleanPrefixRes.value.warnings).toEqual([]);
  expect(
    cleanPrefixRes.value.recordsDecoded + cleanPrefixRes.value.skippedRecordCount,
  ).toBe(completeRecordCount);

  const { warnings, ...recoveredWithoutWarnings } = res.value;
  const { warnings: _cleanWarnings, ...cleanWithoutWarnings } = cleanPrefixRes.value;
  expect(recoveredWithoutWarnings).toEqual(cleanWithoutWarnings);

  if (cutOffset === cleanBoundary) {
    expect(warnings).toEqual([]);
  } else {
    expect(warnings).toHaveLength(1);
    const warn = warnings[0]!;
    expect(warn.code).toBe('TRUNCATED_TAIL_RECORD');
    expect(warn.byteOffset).toBe(cleanBoundary);

    const tailRecord = records[completeRecordCount];
    if (tailRecord !== undefined && cutOffset - cleanBoundary >= STDF_RECORD_HEADER_BYTES) {
      expect(warn.recTyp).toBe(tailRecord.recTyp);
      expect(warn.recSub).toBe(tailRecord.recSub);
    }
  }
}

describe('Property 2: Parser Bounds Safety and Truncated-Stream Recovery (fast-check)', () => {
  it('terminates without throwing on arbitrary Uint8Array fuzz and non-zero byteOffset views', () => {
    fc.assert(
      fc.property(
        fc.uint8Array({ minLength: 0, maxLength: 4096 }),
        fc.integer({ min: 0, max: 32 }),
        fc.integer({ min: 0, max: 32 }),
        fc.constantFrom<ParseMode>('full', 'bins-only'),
        (fuzzBytes, padBefore, padAfter, mode) => {
          // 1. Direct Uint8Array buffer
          assertWellFormedParseOutcome(fuzzBytes, mode);

          // 2. Non-zero byteOffset subarray view surrounded by sentinel canary bytes
          const backing = new Uint8Array(padBefore + fuzzBytes.byteLength + padAfter);
          backing.fill(0xff);
          backing.set(fuzzBytes, padBefore);
          const viewSlice = backing.subarray(padBefore, padBefore + fuzzBytes.byteLength);
          assertWellFormedParseOutcome(viewSlice, mode);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it('terminates without throwing on corrupted FAR headers and fuzzed REC_LEN / variable-length record frames', () => {
    // 1. Corrupted 0..16 byte initial FAR header combinations
    fc.assert(
      fc.property(fc.uint8Array({ minLength: 0, maxLength: 16 }), (headerBytes) => {
        assertWellFormedParseOutcome(headerBytes, 'full');
      }),
      { numRuns: NUM_RUNS },
    );

    // 2. Valid FAR header followed by fuzzed decoded/unknown record frames with corrupted REC_LEN & prefixes
    const arbCorruptedFrame = fc.record({
      pair: fc.constantFrom(...ALL_RECORD_CODE_PAIRS),
      declaredLenChoice: fc.oneof(
        fc.constantFrom(0, 1, 2, 3, 255, 1024, 0x7fff, 0xffff),
        fc.integer({ min: 0, max: 96 }),
      ),
      useExactPayloadLen: fc.boolean(),
      payload: fc.uint8Array({ minLength: 0, maxLength: 64 }),
    });

    fc.assert(
      fc.property(
        fc.constantFrom<CpuEndianness>('big', 'little'),
        fc.array(arbCorruptedFrame, { minLength: 1, maxLength: 16 }),
        fc.uint8Array({ minLength: 0, maxLength: 12 }),
        fc.constantFrom<ParseMode>('full', 'bins-only'),
        (endianness, frames, trailingJunk, mode) => {
          const far = makeFarHeaderBytes(endianness);
          const totalPayload = frames.reduce(
            (sum, f) => sum + STDF_RECORD_HEADER_BYTES + f.payload.byteLength,
            far.byteLength + trailingJunk.byteLength,
          );
          const stream = new Uint8Array(totalPayload);
          const view = new DataView(stream.buffer);
          const littleEndian = endianness === 'little';

          stream.set(far, 0);
          let pos = far.byteLength;

          for (const frame of frames) {
            const recLen = frame.useExactPayloadLen
              ? frame.payload.byteLength
              : frame.declaredLenChoice;
            view.setUint16(pos, recLen & 0xffff, littleEndian);
            stream[pos + 2] = frame.pair[0];
            stream[pos + 3] = frame.pair[1];
            stream.set(frame.payload, pos + STDF_RECORD_HEADER_BYTES);
            pos += STDF_RECORD_HEADER_BYTES + frame.payload.byteLength;
          }

          stream.set(trailingJunk, pos);
          assertWellFormedParseOutcome(stream, mode);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it('skips mid-stream malformed records whose REC_LEN fits the buffer and recovers all valid surrounding PRRs', () => {
    const MALFORMED_CANDIDATES: ReadonlyArray<readonly [number, number]> = [
      [STDF_RECORD_CODES.MIR.recTyp, STDF_RECORD_CODES.MIR.recSub],
      [STDF_RECORD_CODES.HBR.recTyp, STDF_RECORD_CODES.HBR.recSub],
      [STDF_RECORD_CODES.SBR.recTyp, STDF_RECORD_CODES.SBR.recSub],
      [STDF_RECORD_CODES.SDR.recTyp, STDF_RECORD_CODES.SDR.recSub],
      [STDF_RECORD_CODES.PTR.recTyp, STDF_RECORD_CODES.PTR.recSub],
      [STDF_RECORD_CODES.MPR.recTyp, STDF_RECORD_CODES.MPR.recSub],
      [STDF_RECORD_CODES.FTR.recTyp, STDF_RECORD_CODES.FTR.recSub],
    ];

    fc.assert(
      fc.property(
        fc.constantFrom<CpuEndianness>('big', 'little'),
        fc.constantFrom(...MALFORMED_CANDIDATES),
        // Truncate payload shorter than required fixed fields (0..1 bytes) so RecordBoundsError is guaranteed
        fc.uint8Array({ minLength: 0, maxLength: 1 }),
        fc.integer({ min: -50, max: 50 }),
        fc.integer({ min: -50, max: 50 }),
        (endianness, [badTyp, badSub], tinyBadPayload, x0, y0) => {
          const bytes = writeStdfBytes({
            endianness,
            mir: { lotId: 'SAFE-LOT', partTyp: 'ASIC', jobNam: 'FUZZ' },
            unknownRecords: [
              {
                recTyp: badTyp,
                recSub: badSub,
                payload: tinyBadPayload,
                position: 'after-mir',
              },
            ],
            wafers: [
              {
                wir: { waferId: 'W01' },
                parts: [
                  { hardBin: 1, softBin: 1, xCoord: x0, yCoord: y0 },
                  { hardBin: 4, softBin: 7, xCoord: x0 + 1, yCoord: y0 },
                ],
              },
            ],
            mrr: { dispCod: '0' },
          });

          const parsed = parseStdfBytes(bytes, { mode: 'full' });
          expect(parsed.ok).toBe(true);
          if (!parsed.ok) return;

          expect(parsed.value.validPrrCount).toBe(2);
          expect(parsed.value.wafers[0]?.parts.map((p) => [p.xCoord, p.yCoord])).toEqual([
            [x0, y0],
            [x0 + 1, y0],
          ]);
          expect(parsed.value.mrr?.dispCod).toBe('0');
          expect(
            parsed.value.warnings.some(
              (w) =>
                w.code === 'MALFORMED_RECORD_FIELD' &&
                w.recTyp === badTyp &&
                w.recSub === badSub,
            ),
          ).toBe(true);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it.each<CpuEndianness>(['big', 'little'])(
    'recovers every complete prefix record across EVERY truncation offset k = 0..N on %s-endian STDF streams',
    (endianness) => {
      const spec = createCanonicalFixtureLotSpec(endianness);
      const fullBytes = writeStdfBytes(spec);
      const records = scanValidRecordBoundaries(fullBytes, endianness);

      const fullRes = parseStdfBytes(fullBytes, { mode: 'full' });
      expect(fullRes.ok).toBe(true);
      if (!fullRes.ok) return;
      const fullParts = flattenParts(fullRes.value);
      expect(fullParts.length).toBeGreaterThanOrEqual(3);

      for (let k = 0; k <= fullBytes.byteLength; k += 1) {
        assertTruncatedPrefixRecovery(
          fullBytes,
          endianness,
          records,
          fullRes.value,
          fullParts,
          k,
          'full',
        );
      }
    },
  );

  it('recovers all complete prefix records and m >= 1 PRRs for random lot specs truncated at random offsets k', () => {
    fc.assert(
      fc.property(
        arbStdfWriteLotSpec,
        fc.double({ min: 0, max: 1, noNaN: true, noDefaultInfinity: true }),
        fc.double({ min: 0, max: 1, noNaN: true, noDefaultInfinity: true }),
        fc.constantFrom<ParseMode>('full', 'bins-only'),
        (spec, anyCutFrac, postPrrCutFrac, mode) => {
          const fullBytes = writeStdfBytes(spec);
          const records = scanValidRecordBoundaries(fullBytes, spec.endianness);
          const fullRes = parseStdfBytes(fullBytes, { mode: 'full' });
          expect(fullRes.ok).toBe(true);
          if (!fullRes.ok) return;
          const fullParts = flattenParts(fullRes.value);

          // 1. Arbitrary offset k across the entire [0, byteLength] range
          const anyCut = Math.min(
            fullBytes.byteLength,
            Math.floor(anyCutFrac * (fullBytes.byteLength + 1)),
          );
          assertTruncatedPrefixRecovery(
            fullBytes,
            spec.endianness,
            records,
            fullRes.value,
            fullParts,
            anyCut,
            mode,
          );

          // 2. Targeted mid-record offset k strictly after the first complete PRR (guarantees m >= 1)
          const firstPrrRec = records.find(
            (r) =>
              r.recTyp === STDF_RECORD_CODES.PRR.recTyp &&
              r.recSub === STDF_RECORD_CODES.PRR.recSub,
          );
          expect(firstPrrRec).toBeDefined();
          if (!firstPrrRec) return;

          const firstPrrEnd =
            firstPrrRec.byteOffset + STDF_RECORD_HEADER_BYTES + firstPrrRec.recLen;
          if (firstPrrEnd < fullBytes.byteLength) {
            // Pick a cut strictly inside [firstPrrEnd + 1, fullBytes.byteLength - 1] when possible
            const span = fullBytes.byteLength - firstPrrEnd;
            const postCut =
              span > 1
                ? firstPrrEnd + 1 + Math.floor(postPrrCutFrac * (span - 1))
                : fullBytes.byteLength;
            assertTruncatedPrefixRecovery(
              fullBytes,
              spec.endianness,
              records,
              fullRes.value,
              fullParts,
              postCut,
              mode,
            );
          }
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});
