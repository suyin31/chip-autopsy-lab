/**
 * Unit tests for gzip magic-byte detection (`0x1F 0x8B`) and `DecompressionStream('gzip')`
 * decompression vs plain STDF routing.
 *
 * Validates: Requirements 1.3, 2.2, 2.5
 */

import { describe, expect, it } from 'vitest';
import {
  compressGzipBytes,
  decompressGzipStreamWithCeiling,
  GZIP_MAGIC_BYTE_0,
  GZIP_MAGIC_BYTE_1,
  hasGzipMagicBytes,
} from './gzip';
import { parseStdfBytes } from './stdf-parser';
import { writeStdfBytes } from './stdf-writer';

function buildMinimalPlainStdf(endianness: 'big' | 'little' = 'little'): Uint8Array {
  return writeStdfBytes({
    endianness,
    mir: { lotId: 'GZIP-DET-01', partTyp: 'ASIC', jobNam: 'SORT' },
    wafers: [
      {
        wir: { waferId: 'W01' },
        parts: [
          { headNum: 1, siteNum: 1, partFlg: 0, hardBin: 1, softBin: 1, xCoord: 0, yCoord: 0 },
          { headNum: 1, siteNum: 2, partFlg: 0, hardBin: 1, softBin: 1, xCoord: 1, yCoord: 0 },
        ],
      },
    ],
    mrr: { dispCod: ' ' },
  });
}

describe('gzip magic-byte detection (0x1F 0x8B) and DecompressionStream', () => {
  it('detects 0x1F 0x8B magic bytes strictly at bytes 0..1 including subarray views', () => {
    expect(GZIP_MAGIC_BYTE_0).toBe(0x1f);
    expect(GZIP_MAGIC_BYTE_1).toBe(0x8b);

    expect(hasGzipMagicBytes(new Uint8Array([]))).toBe(false);
    expect(hasGzipMagicBytes(new Uint8Array([0x1f]))).toBe(false);
    expect(hasGzipMagicBytes(new Uint8Array([0x1f, 0x8b]))).toBe(true);
    expect(hasGzipMagicBytes(new Uint8Array([0x1f, 0x8b, 0x08, 0x00]))).toBe(true);

    // Near-misses and reversed magic bytes
    expect(hasGzipMagicBytes(new Uint8Array([0x1f, 0x8a]))).toBe(false);
    expect(hasGzipMagicBytes(new Uint8Array([0x1e, 0x8b]))).toBe(false);
    expect(hasGzipMagicBytes(new Uint8Array([0x8b, 0x1f]))).toBe(false);

    // Plain little-endian and big-endian STDF FAR headers are not misdetected
    expect(hasGzipMagicBytes(buildMinimalPlainStdf('little'))).toBe(false);
    expect(hasGzipMagicBytes(buildMinimalPlainStdf('big'))).toBe(false);

    // Non-zero byteOffset subarray slice
    const backing = new Uint8Array([0x00, 0xff, 0x1f, 0x8b, 0x08]);
    expect(hasGzipMagicBytes(backing)).toBe(false);
    expect(hasGzipMagicBytes(backing.subarray(2))).toBe(true);
  });

  it('decompresses 0x1F 0x8B streams via DecompressionStream into valid STDF bytes and surfaces structured error on truncated gzip', async () => {
    const plainStdf = buildMinimalPlainStdf('little');
    const gzippedStdf = await compressGzipBytes(plainStdf);
    expect(hasGzipMagicBytes(gzippedStdf)).toBe(true);

    const decompressed = await decompressGzipStreamWithCeiling(gzippedStdf);
    expect(decompressed.kind).toBe('ok');
    if (decompressed.kind === 'ok') {
      expect(decompressed.bytes).toEqual(plainStdf);
      const parsed = parseStdfBytes(decompressed.bytes, { mode: 'full' });
      expect(parsed.ok).toBe(true);
      if (parsed.ok) {
        expect(parsed.value.validPrrCount).toBe(2);
      }
    }

    // Corrupted stream starting with 0x1F 0x8B surfaces GZIP_DECOMPRESS_FAILED error
    const truncatedGzip = gzippedStdf.subarray(0, 6);
    const failedDecomp = await decompressGzipStreamWithCeiling(truncatedGzip);
    expect(failedDecomp.kind).toBe('error');
    if (failedDecomp.kind === 'error') {
      expect(failedDecomp.error.code).toBe('GZIP_DECOMPRESS_FAILED');
    }
  });
});
