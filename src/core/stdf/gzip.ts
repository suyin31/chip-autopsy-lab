/**
 * Magic-byte gzip detection (`0x1F 0x8B`) and native Web `DecompressionStream('gzip')`
 * / `CompressionStream('gzip')` helpers with uncompressed byte-ceiling enforcement.
 *
 * Pure standard Web Streams implementation with zero DOM or Node-specific imports,
 * running identically in Browser Web Workers and Node 22+ Vitest suites.
 *
 * Validates: Requirements 1.3, 2.2, 2.5
 */

import {
  DEFAULT_MAX_UNCOMPRESSED_BYTES,
  formatHexBytes,
  type ParseFatalError,
} from './types';

export const GZIP_MAGIC_BYTE_0 = 0x1f as const;
export const GZIP_MAGIC_BYTE_1 = 0x8b as const;
const STREAM_CHUNK_BYTES = 64 * 1024;

export type GzipDecompressResult =
  | { readonly kind: 'ok'; readonly bytes: Uint8Array }
  | { readonly kind: 'ceiling_exceeded'; readonly bytesObserved: number }
  | { readonly kind: 'error'; readonly error: ParseFatalError };

/**
 * Checks whether the first two bytes match gzip magic bytes `0x1F 0x8B`,
 * independent of filename extension (Requirement 1.3).
 */
export function hasGzipMagicBytes(header: Uint8Array): boolean {
  return (
    header.byteLength >= 2 &&
    header[0] === GZIP_MAGIC_BYTE_0 &&
    header[1] === GZIP_MAGIC_BYTE_1
  );
}

/**
 * Decompresses a gzip byte stream via native `DecompressionStream('gzip')`,
 * halting immediately if decompressed output exceeds `ceilingBytes` (Requirement 2.5).
 */
export async function decompressGzipStreamWithCeiling(
  input: Uint8Array,
  ceilingBytes: number = DEFAULT_MAX_UNCOMPRESSED_BYTES,
): Promise<GzipDecompressResult> {
  if (!hasGzipMagicBytes(input)) {
    const firstBytesHex = formatHexBytes(input, 16);
    return {
      kind: 'error',
      error: {
        code: 'GZIP_DECOMPRESS_FAILED',
        message: 'Input stream does not begin with gzip magic bytes (0x1F 0x8B).',
        byteOffset: 0,
        ...(firstBytesHex.length > 0 ? { firstBytesHex } : {}),
      },
    };
  }

  let sourceOffset = 0;
  const source = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (sourceOffset >= input.byteLength) {
        controller.close();
        return;
      }
      const nextEnd = Math.min(sourceOffset + STREAM_CHUNK_BYTES, input.byteLength);
      controller.enqueue(input.subarray(sourceOffset, nextEnd));
      sourceOffset = nextEnd;
    },
  });

  const transform = new DecompressionStream(
    'gzip',
  ) as unknown as ReadableWritablePair<Uint8Array, Uint8Array>;
  const decompressed = source.pipeThrough(transform);
  const reader = decompressed.getReader();

  const chunks: Uint8Array[] = [];
  let bytesObserved = 0;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      if (value && value.byteLength > 0) {
        bytesObserved += value.byteLength;
        if (bytesObserved > ceilingBytes) {
          await reader.cancel('ceiling_exceeded').catch(() => undefined);
          return { kind: 'ceiling_exceeded', bytesObserved };
        }
        chunks.push(value);
      }
    }
  } catch (err) {
    await reader.cancel().catch(() => undefined);
    const detail = err instanceof Error ? err.message : String(err);
    const firstBytesHex = formatHexBytes(input, 16);
    return {
      kind: 'error',
      error: {
        code: 'GZIP_DECOMPRESS_FAILED',
        message: `Gzip decompression failed: ${detail}`,
        byteOffset: Math.min(sourceOffset, input.byteLength),
        ...(firstBytesHex.length > 0 ? { firstBytesHex } : {}),
      },
    };
  }

  const output = new Uint8Array(bytesObserved);
  let writePos = 0;
  for (let i = 0; i < chunks.length; i += 1) {
    const chunk = chunks[i]!;
    output.set(chunk, writePos);
    writePos += chunk.byteLength;
  }
  return { kind: 'ok', bytes: output };
}

/**
 * Compresses raw STDF bytes using native `CompressionStream('gzip')`.
 */
export async function compressGzipBytes(input: Uint8Array): Promise<Uint8Array> {
  let sourceOffset = 0;
  const source = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (sourceOffset >= input.byteLength) {
        controller.close();
        return;
      }
      const nextEnd = Math.min(sourceOffset + STREAM_CHUNK_BYTES, input.byteLength);
      controller.enqueue(input.subarray(sourceOffset, nextEnd));
      sourceOffset = nextEnd;
    },
  });

  const transform = new CompressionStream(
    'gzip',
  ) as unknown as ReadableWritablePair<Uint8Array, Uint8Array>;
  const compressed = source.pipeThrough(transform);
  const reader = compressed.getReader();

  const chunks: Uint8Array[] = [];
  let totalLength = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    if (value && value.byteLength > 0) {
      chunks.push(value);
      totalLength += value.byteLength;
    }
  }

  const output = new Uint8Array(totalLength);
  let writePos = 0;
  for (let i = 0; i < chunks.length; i += 1) {
    const chunk = chunks[i]!;
    output.set(chunk, writePos);
    writePos += chunk.byteLength;
  }
  return output;
}
