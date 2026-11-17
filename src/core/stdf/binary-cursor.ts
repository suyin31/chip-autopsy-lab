/**
 * Bounds-checked, endian-aware binary cursor and growable record builder for STDF V4.
 *
 * Enforces `offset + byteCount <= recordEnd <= buffer.byteLength` prior to every
 * primitive, variable-length (`C*n`, `B*n`, `D*n`), and counted-array (`kxTYPE`) access.
 *
 * Validates: Requirements 1.5, 1.7, 2.1, 2.4
 */

import {
  type BitArrayData,
  type CpuEndianness,
  STDF_MAX_RECORD_BODY_BYTES,
  STDF_RECORD_HEADER_BYTES,
} from './types';

const utf8Decoder = new TextDecoder('utf-8', { fatal: false });
const utf8Encoder = new TextEncoder();

/**
 * Strips ASCII C0 control characters (`0x00..0x1F`) and DEL (`0x7F`) while keeping
 * printable plain text intact (Requirement 2.4).
 */
export function sanitizeStdfString(raw: string): string {
  let needsStrip = false;
  for (let i = 0; i < raw.length; i += 1) {
    const code = raw.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) {
      needsStrip = true;
      break;
    }
  }
  if (!needsStrip) {
    return raw;
  }
  let out = '';
  for (let i = 0; i < raw.length; i += 1) {
    const code = raw.charCodeAt(i);
    if (code >= 0x20 && code !== 0x7f) {
      out += raw[i];
    }
  }
  return out;
}

function decodeSanitizedSlice(bytes: Uint8Array, start: number, length: number): string {
  if (length === 0) {
    return '';
  }
  // Fast ASCII path for standard printable 7-bit strings (0x20..0x7E)
  let purePrintableAscii = true;
  const end = start + length;
  for (let i = start; i < end; i += 1) {
    const b = bytes[i]!;
    if (b < 0x20 || b >= 0x7f) {
      purePrintableAscii = false;
      break;
    }
  }
  if (purePrintableAscii && length <= 256) {
    let ascii = '';
    for (let i = start; i < end; i += 1) {
      ascii += String.fromCharCode(bytes[i]!);
    }
    return ascii;
  }
  const decoded = utf8Decoder.decode(bytes.subarray(start, end));
  return sanitizeStdfString(decoded);
}

/**
 * Internal structured error thrown when a record's field overflows `recordEnd`.
 * Caught by `stdf-parser.ts` per record so `parseStdfBytes` never throws uncaught errors.
 */
export class RecordBoundsError extends Error {
  readonly byteOffset: number;
  readonly requestedBytes: number;
  readonly remainingBytes: number;
  readonly fieldType: string;

  constructor(
    byteOffset: number,
    requestedBytes: number,
    remainingBytes: number,
    fieldType: string,
  ) {
    super(
      `STDF field ${fieldType} at offset ${byteOffset} requires ${requestedBytes} bytes, but only ${remainingBytes} remain in record.`,
    );
    this.name = 'RecordBoundsError';
    this.byteOffset = byteOffset;
    this.requestedBytes = requestedBytes;
    this.remainingBytes = remainingBytes;
    this.fieldType = fieldType;
  }
}

export class BinaryCursor {
  private readonly bytes: Uint8Array;
  private readonly view: DataView;
  private littleEndian: boolean;
  private currentOffset: number;
  private recordEndOffset: number;

  constructor(
    bytes: Uint8Array,
    endianness: CpuEndianness = 'little',
    startOffset = 0,
    recordEnd = bytes.byteLength,
  ) {
    this.bytes = bytes;
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    this.littleEndian = endianness === 'little';
    this.currentOffset = 0;
    this.recordEndOffset = bytes.byteLength;
    this.setWindow(startOffset, recordEnd);
  }

  get endianness(): CpuEndianness {
    return this.littleEndian ? 'little' : 'big';
  }

  setEndianness(endianness: CpuEndianness): void {
    this.littleEndian = endianness === 'little';
  }

  get offset(): number {
    return this.currentOffset;
  }

  get recordEnd(): number {
    return this.recordEndOffset;
  }

  get remaining(): number {
    return this.recordEndOffset - this.currentOffset;
  }

  get atEnd(): boolean {
    return this.currentOffset >= this.recordEndOffset;
  }

  get byteLength(): number {
    return this.bytes.byteLength;
  }

  setWindow(startOffset: number, recordEnd: number): void {
    if (
      !Number.isInteger(startOffset) ||
      !Number.isInteger(recordEnd) ||
      startOffset < 0 ||
      recordEnd < startOffset ||
      recordEnd > this.bytes.byteLength
    ) {
      throw new RecordBoundsError(
        Math.max(0, startOffset),
        Math.max(0, recordEnd - startOffset),
        Math.max(0, this.bytes.byteLength - Math.max(0, startOffset)),
        'RECORD_WINDOW',
      );
    }
    this.currentOffset = startOffset;
    this.recordEndOffset = recordEnd;
  }

  subCursor(startOffset: number, recordEnd: number): BinaryCursor {
    return new BinaryCursor(this.bytes, this.endianness, startOffset, recordEnd);
  }

  private ensureAvailable(byteCount: number, fieldType: string): void {
    if (
      !Number.isInteger(byteCount) ||
      byteCount < 0 ||
      this.currentOffset + byteCount > this.recordEndOffset
    ) {
      throw new RecordBoundsError(
        this.currentOffset,
        Number.isFinite(byteCount) ? Math.max(0, Math.trunc(byteCount)) : 0,
        this.recordEndOffset - this.currentOffset,
        fieldType,
      );
    }
  }

  skip(byteCount: number): void {
    this.ensureAvailable(byteCount, 'SKIP');
    this.currentOffset += byteCount;
  }

  // ---- Fixed-width Unsigned Integers (U*n) ----

  readU1(): number {
    this.ensureAvailable(1, 'U*1');
    const v = this.view.getUint8(this.currentOffset);
    this.currentOffset += 1;
    return v;
  }

  readU2(): number {
    this.ensureAvailable(2, 'U*2');
    const v = this.view.getUint16(this.currentOffset, this.littleEndian);
    this.currentOffset += 2;
    return v;
  }

  readU4(): number {
    this.ensureAvailable(4, 'U*4');
    const v = this.view.getUint32(this.currentOffset, this.littleEndian);
    this.currentOffset += 4;
    return v;
  }

  readU8(): bigint {
    this.ensureAvailable(8, 'U*8');
    const v = this.view.getBigUint64(this.currentOffset, this.littleEndian);
    this.currentOffset += 8;
    return v;
  }

  // ---- Fixed-width Signed Integers (I*n) ----

  readI1(): number {
    this.ensureAvailable(1, 'I*1');
    const v = this.view.getInt8(this.currentOffset);
    this.currentOffset += 1;
    return v;
  }

  readI2(): number {
    this.ensureAvailable(2, 'I*2');
    const v = this.view.getInt16(this.currentOffset, this.littleEndian);
    this.currentOffset += 2;
    return v;
  }

  readI4(): number {
    this.ensureAvailable(4, 'I*4');
    const v = this.view.getInt32(this.currentOffset, this.littleEndian);
    this.currentOffset += 4;
    return v;
  }

  readI8(): bigint {
    this.ensureAvailable(8, 'I*8');
    const v = this.view.getBigInt64(this.currentOffset, this.littleEndian);
    this.currentOffset += 8;
    return v;
  }

  // ---- IEEE-754 Floating-Point Numbers (R*n) ----

  readR4(): number {
    this.ensureAvailable(4, 'R*4');
    const v = this.view.getFloat32(this.currentOffset, this.littleEndian);
    this.currentOffset += 4;
    return v;
  }

  readR8(): number {
    this.ensureAvailable(8, 'R*8');
    const v = this.view.getFloat64(this.currentOffset, this.littleEndian);
    this.currentOffset += 8;
    return v;
  }

  // ---- Character & Binary Fields (C*1, C*f, C*n, B*1, B*n, D*n) ----

  readC1(): string {
    this.ensureAvailable(1, 'C*1');
    const byte = this.bytes[this.currentOffset]!;
    this.currentOffset += 1;
    if (byte >= 0x20 && byte <= 0x7e) {
      return String.fromCharCode(byte);
    }
    return ' ';
  }

  readFixedChar(length: number): string {
    this.ensureAvailable(length, `C*${length}`);
    const out = decodeSanitizedSlice(this.bytes, this.currentOffset, length);
    this.currentOffset += length;
    return out;
  }

  readCn(): string {
    this.ensureAvailable(1, 'C*n(len)');
    const length = this.bytes[this.currentOffset]!;
    if (this.currentOffset + 1 + length > this.recordEndOffset) {
      throw new RecordBoundsError(
        this.currentOffset,
        1 + length,
        this.recordEndOffset - this.currentOffset,
        'C*n',
      );
    }
    this.currentOffset += 1;
    const out = decodeSanitizedSlice(this.bytes, this.currentOffset, length);
    this.currentOffset += length;
    return out;
  }

  readB1(): number {
    this.ensureAvailable(1, 'B*1');
    const v = this.bytes[this.currentOffset]!;
    this.currentOffset += 1;
    return v;
  }

  readBn(): Uint8Array {
    this.ensureAvailable(1, 'B*n(len)');
    const length = this.bytes[this.currentOffset]!;
    if (this.currentOffset + 1 + length > this.recordEndOffset) {
      throw new RecordBoundsError(
        this.currentOffset,
        1 + length,
        this.recordEndOffset - this.currentOffset,
        'B*n',
      );
    }
    this.currentOffset += 1;
    const out = this.bytes.slice(this.currentOffset, this.currentOffset + length);
    this.currentOffset += length;
    return out;
  }

  readDn(): BitArrayData {
    this.ensureAvailable(2, 'D*n(bits)');
    const bitCount = this.view.getUint16(this.currentOffset, this.littleEndian);
    const byteCount = (bitCount + 7) >>> 3;
    if (this.currentOffset + 2 + byteCount > this.recordEndOffset) {
      throw new RecordBoundsError(
        this.currentOffset,
        2 + byteCount,
        this.recordEndOffset - this.currentOffset,
        'D*n',
      );
    }
    this.currentOffset += 2;
    const out = this.bytes.slice(this.currentOffset, this.currentOffset + byteCount);
    if (byteCount > 0) {
      const remBits = bitCount & 7;
      if (remBits !== 0) {
        out[byteCount - 1] = out[byteCount - 1]! & ((1 << remBits) - 1);
      }
    }
    this.currentOffset += byteCount;
    return { bitCount, bytes: out };
  }

  // ---- Counted Arrays (kxTYPE) ----

  readKxU1(count: number): Uint8Array {
    this.ensureAvailable(count, 'kxU*1');
    const out = this.bytes.slice(this.currentOffset, this.currentOffset + count);
    this.currentOffset += count;
    return out;
  }

  readKxU2(count: number): Uint16Array {
    const byteCount = count * 2;
    this.ensureAvailable(byteCount, 'kxU*2');
    const out = new Uint16Array(count);
    for (let i = 0; i < count; i += 1) {
      out[i] = this.view.getUint16(this.currentOffset, this.littleEndian);
      this.currentOffset += 2;
    }
    return out;
  }

  readKxU4(count: number): Uint32Array {
    const byteCount = count * 4;
    this.ensureAvailable(byteCount, 'kxU*4');
    const out = new Uint32Array(count);
    for (let i = 0; i < count; i += 1) {
      out[i] = this.view.getUint32(this.currentOffset, this.littleEndian);
      this.currentOffset += 4;
    }
    return out;
  }

  readKxI1(count: number): Int8Array {
    this.ensureAvailable(count, 'kxI*1');
    const out = new Int8Array(count);
    for (let i = 0; i < count; i += 1) {
      out[i] = this.view.getInt8(this.currentOffset);
      this.currentOffset += 1;
    }
    return out;
  }

  readKxI2(count: number): Int16Array {
    const byteCount = count * 2;
    this.ensureAvailable(byteCount, 'kxI*2');
    const out = new Int16Array(count);
    for (let i = 0; i < count; i += 1) {
      out[i] = this.view.getInt16(this.currentOffset, this.littleEndian);
      this.currentOffset += 2;
    }
    return out;
  }

  readKxI4(count: number): Int32Array {
    const byteCount = count * 4;
    this.ensureAvailable(byteCount, 'kxI*4');
    const out = new Int32Array(count);
    for (let i = 0; i < count; i += 1) {
      out[i] = this.view.getInt32(this.currentOffset, this.littleEndian);
      this.currentOffset += 4;
    }
    return out;
  }

  readKxR4(count: number): Float32Array {
    const byteCount = count * 4;
    this.ensureAvailable(byteCount, 'kxR*4');
    const out = new Float32Array(count);
    for (let i = 0; i < count; i += 1) {
      out[i] = this.view.getFloat32(this.currentOffset, this.littleEndian);
      this.currentOffset += 4;
    }
    return out;
  }

  readKxR8(count: number): Float64Array {
    const byteCount = count * 8;
    this.ensureAvailable(byteCount, 'kxR*8');
    const out = new Float64Array(count);
    for (let i = 0; i < count; i += 1) {
      out[i] = this.view.getFloat64(this.currentOffset, this.littleEndian);
      this.currentOffset += 8;
    }
    return out;
  }

  readKxCn(count: number): string[] {
    if (
      !Number.isInteger(count) ||
      count < 0 ||
      this.currentOffset + count > this.recordEndOffset
    ) {
      throw new RecordBoundsError(
        this.currentOffset,
        Number.isFinite(count) ? Math.max(0, Math.trunc(count)) : 0,
        this.recordEndOffset - this.currentOffset,
        'kxC*n',
      );
    }
    const out: string[] = [];
    for (let i = 0; i < count; i += 1) {
      out.push(this.readCn());
    }
    return out;
  }

  readKxN1(count: number): Uint8Array {
    const byteCount = (count + 1) >>> 1;
    this.ensureAvailable(byteCount, 'kxN*1');
    const out = new Uint8Array(count);
    for (let i = 0; i < byteCount; i += 1) {
      const packed = this.bytes[this.currentOffset + i]!;
      const evenIdx = i * 2;
      out[evenIdx] = packed & 0x0f;
      if (evenIdx + 1 < count) {
        out[evenIdx + 1] = (packed >>> 4) & 0x0f;
      }
    }
    this.currentOffset += byteCount;
    return out;
  }

  // ---- Optional Trailing Field Helpers (Requirement 1.7) ----

  readOptU1(): number | undefined {
    return this.atEnd ? undefined : this.readU1();
  }

  readOptU2(): number | undefined {
    return this.atEnd ? undefined : this.readU2();
  }

  readOptU4(): number | undefined {
    return this.atEnd ? undefined : this.readU4();
  }

  readOptI1(): number | undefined {
    return this.atEnd ? undefined : this.readI1();
  }

  readOptI2(): number | undefined {
    return this.atEnd ? undefined : this.readI2();
  }

  readOptI4(): number | undefined {
    return this.atEnd ? undefined : this.readI4();
  }

  readOptR4(): number | undefined {
    return this.atEnd ? undefined : this.readR4();
  }

  readOptC1(): string | undefined {
    return this.atEnd ? undefined : this.readC1();
  }

  readOptCn(): string | undefined {
    return this.atEnd ? undefined : this.readCn();
  }

  readOptB1(): number | undefined {
    return this.atEnd ? undefined : this.readB1();
  }

  readOptBn(): Uint8Array | undefined {
    return this.atEnd ? undefined : this.readBn();
  }

  readOptDn(): BitArrayData | undefined {
    return this.atEnd ? undefined : this.readDn();
  }

  readOptKxU2(count: number): Uint16Array | undefined {
    if (this.atEnd) {
      return undefined;
    }
    return this.readKxU2(count);
  }

  readOptKxN1(count: number): Uint8Array | undefined {
    if (this.atEnd) {
      return undefined;
    }
    return this.readKxN1(count);
  }

  readOptKxR4(count: number): Float32Array | undefined {
    if (this.atEnd) {
      return undefined;
    }
    return this.readKxR4(count);
  }
}

/**
 * Symmetric endian-aware binary record serializer used by `stdf-writer.ts`.
 */
export class BinaryRecordBuilder {
  private buf: Uint8Array;
  private view: DataView;
  private readonly littleEndian: boolean;
  private pos: number;

  constructor(endianness: CpuEndianness = 'little', initialCapacity = 4096) {
    const cap = Math.max(64, initialCapacity);
    this.buf = new Uint8Array(cap);
    this.view = new DataView(this.buf.buffer);
    this.littleEndian = endianness === 'little';
    this.pos = 0;
  }

  get byteLength(): number {
    return this.pos;
  }

  private ensureCapacity(extraBytes: number): void {
    const required = this.pos + extraBytes;
    if (required <= this.buf.byteLength) {
      return;
    }
    let nextCap = this.buf.byteLength * 2;
    while (nextCap < required) {
      nextCap *= 2;
    }
    const nextBuf = new Uint8Array(nextCap);
    nextBuf.set(this.buf.subarray(0, this.pos));
    this.buf = nextBuf;
    this.view = new DataView(this.buf.buffer);
  }

  beginRecord(recTyp: number, recSub: number): number {
    this.ensureCapacity(STDF_RECORD_HEADER_BYTES);
    const headerOffset = this.pos;
    this.buf[headerOffset] = 0;
    this.buf[headerOffset + 1] = 0;
    this.buf[headerOffset + 2] = recTyp & 0xff;
    this.buf[headerOffset + 3] = recSub & 0xff;
    this.pos += STDF_RECORD_HEADER_BYTES;
    return headerOffset;
  }

  endRecord(headerOffset: number): void {
    const payloadBytes = this.pos - (headerOffset + STDF_RECORD_HEADER_BYTES);
    if (payloadBytes < 0 || payloadBytes > STDF_MAX_RECORD_BODY_BYTES) {
      throw new RangeError(
        `STDF record body length ${payloadBytes} exceeds U*2 ceiling (${STDF_MAX_RECORD_BODY_BYTES}).`,
      );
    }
    this.view.setUint16(headerOffset, payloadBytes, this.littleEndian);
  }

  writeRawBytes(bytes: Uint8Array): void {
    this.ensureCapacity(bytes.byteLength);
    this.buf.set(bytes, this.pos);
    this.pos += bytes.byteLength;
  }

  writeU1(value: number): void {
    this.ensureCapacity(1);
    this.view.setUint8(this.pos, value & 0xff);
    this.pos += 1;
  }

  writeU2(value: number): void {
    this.ensureCapacity(2);
    this.view.setUint16(this.pos, value & 0xffff, this.littleEndian);
    this.pos += 2;
  }

  writeU4(value: number): void {
    this.ensureCapacity(4);
    this.view.setUint32(this.pos, value >>> 0, this.littleEndian);
    this.pos += 4;
  }

  writeU8(value: bigint): void {
    this.ensureCapacity(8);
    this.view.setBigUint64(this.pos, value, this.littleEndian);
    this.pos += 8;
  }

  writeI1(value: number): void {
    this.ensureCapacity(1);
    this.view.setInt8(this.pos, value);
    this.pos += 1;
  }

  writeI2(value: number): void {
    this.ensureCapacity(2);
    this.view.setInt16(this.pos, value, this.littleEndian);
    this.pos += 2;
  }

  writeI4(value: number): void {
    this.ensureCapacity(4);
    this.view.setInt32(this.pos, value, this.littleEndian);
    this.pos += 4;
  }

  writeI8(value: bigint): void {
    this.ensureCapacity(8);
    this.view.setBigInt64(this.pos, value, this.littleEndian);
    this.pos += 8;
  }

  writeR4(value: number): void {
    this.ensureCapacity(4);
    this.view.setFloat32(this.pos, value, this.littleEndian);
    this.pos += 4;
  }

  writeR8(value: number): void {
    this.ensureCapacity(8);
    this.view.setFloat64(this.pos, value, this.littleEndian);
    this.pos += 8;
  }

  writeC1(value: string): void {
    this.ensureCapacity(1);
    const code = value.length > 0 ? value.charCodeAt(0) : 0x20;
    this.buf[this.pos] = code >= 0x20 && code <= 0x7e ? code : 0x20;
    this.pos += 1;
  }

  writeFixedChar(value: string, length: number): void {
    this.ensureCapacity(length);
    const clean = sanitizeStdfString(value);
    for (let i = 0; i < length; i += 1) {
      const code = i < clean.length ? clean.charCodeAt(i) : 0x20;
      this.buf[this.pos + i] = code >= 0x20 && code <= 0x7e ? code : 0x20;
    }
    this.pos += length;
  }

  writeCn(value: string): void {
    if (value.length === 0) {
      this.writeU1(0);
      return;
    }
    const clean = sanitizeStdfString(value);
    let encoded = utf8Encoder.encode(clean);
    if (encoded.byteLength > 255) {
      // Truncate cleanly at a UTF-8 codepoint lead boundary <= 255 bytes
      let cut = 255;
      while (cut > 0 && (encoded[cut]! & 0xc0) === 0x80) {
        cut -= 1;
      }
      encoded = encoded.subarray(0, cut);
    }
    this.ensureCapacity(1 + encoded.byteLength);
    this.buf[this.pos] = encoded.byteLength;
    this.buf.set(encoded, this.pos + 1);
    this.pos += 1 + encoded.byteLength;
  }

  writeB1(value: number): void {
    this.writeU1(value);
  }

  writeBn(bytes: Uint8Array): void {
    const slice = bytes.byteLength > 255 ? bytes.subarray(0, 255) : bytes;
    this.ensureCapacity(1 + slice.byteLength);
    this.buf[this.pos] = slice.byteLength;
    this.buf.set(slice, this.pos + 1);
    this.pos += 1 + slice.byteLength;
  }

  writeDn(bitData: BitArrayData): void {
    const bitCount = Math.max(0, Math.min(0xffff, bitData.bitCount));
    const byteCount = (bitCount + 7) >>> 3;
    this.ensureCapacity(2 + byteCount);
    this.view.setUint16(this.pos, bitCount, this.littleEndian);
    this.pos += 2;
    for (let i = 0; i < byteCount; i += 1) {
      let b = i < bitData.bytes.byteLength ? bitData.bytes[i]! : 0;
      if (i === byteCount - 1) {
        const remBits = bitCount & 7;
        if (remBits !== 0) {
          b &= (1 << remBits) - 1;
        }
      }
      this.buf[this.pos + i] = b;
    }
    this.pos += byteCount;
  }

  writeKxU1(values: ArrayLike<number>): void {
    this.ensureCapacity(values.length);
    for (let i = 0; i < values.length; i += 1) {
      this.buf[this.pos + i] = values[i]! & 0xff;
    }
    this.pos += values.length;
  }

  writeKxU2(values: ArrayLike<number>): void {
    this.ensureCapacity(values.length * 2);
    for (let i = 0; i < values.length; i += 1) {
      this.view.setUint16(this.pos, values[i]! & 0xffff, this.littleEndian);
      this.pos += 2;
    }
  }

  writeKxU4(values: ArrayLike<number>): void {
    this.ensureCapacity(values.length * 4);
    for (let i = 0; i < values.length; i += 1) {
      this.view.setUint32(this.pos, values[i]! >>> 0, this.littleEndian);
      this.pos += 4;
    }
  }

  writeKxI2(values: ArrayLike<number>): void {
    this.ensureCapacity(values.length * 2);
    for (let i = 0; i < values.length; i += 1) {
      this.view.setInt16(this.pos, values[i]!, this.littleEndian);
      this.pos += 2;
    }
  }

  writeKxR4(values: ArrayLike<number>): void {
    this.ensureCapacity(values.length * 4);
    for (let i = 0; i < values.length; i += 1) {
      this.view.setFloat32(this.pos, values[i]!, this.littleEndian);
      this.pos += 4;
    }
  }

  writeKxCn(values: readonly string[]): void {
    for (let i = 0; i < values.length; i += 1) {
      this.writeCn(values[i]!);
    }
  }

  writeKxN1(nibbles: ArrayLike<number>): void {
    const byteCount = (nibbles.length + 1) >>> 1;
    this.ensureCapacity(byteCount);
    for (let i = 0; i < byteCount; i += 1) {
      const lo = nibbles[i * 2]! & 0x0f;
      const hi = i * 2 + 1 < nibbles.length ? (nibbles[i * 2 + 1]! & 0x0f) << 4 : 0;
      this.buf[this.pos + i] = lo | hi;
    }
    this.pos += byteCount;
  }

  toUint8Array(): Uint8Array {
    return this.buf.slice(0, this.pos);
  }
}
