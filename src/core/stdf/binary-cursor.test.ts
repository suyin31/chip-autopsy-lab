import { describe, expect, it } from 'vitest';
import {
  BinaryCursor,
  BinaryRecordBuilder,
  RecordBoundsError,
  sanitizeStdfString,
} from './binary-cursor';
import { type CpuEndianness, STDF_RECORD_HEADER_BYTES } from './types';

describe('BinaryCursor & BinaryRecordBuilder (Requirements 1.5, 1.7, 2.1, 2.4)', () => {
  it.each<CpuEndianness>(['little', 'big'])(
    'round-trips all fixed, variable-length, and counted-array STDF types in %s-endian mode',
    (endianness) => {
      const builder = new BinaryRecordBuilder(endianness, 64);
      const hdr = builder.beginRecord(50, 10);

      builder.writeU1(0xfe);
      builder.writeU2(0xabcd);
      builder.writeU4(0xdeadbeef);
      builder.writeU8(0x0123456789abcdefn);

      builder.writeI1(-42);
      builder.writeI2(-32768);
      builder.writeI4(-123456789);
      builder.writeI8(-9007199254740993n);

      builder.writeR4(0.0035);
      builder.writeR8(-123456.7890125);

      builder.writeC1('P');
      builder.writeC1('\x00');
      builder.writeFixedChar('WAF1', 6);
      builder.writeCn('');
      builder.writeCn('CAL-LOT-01');
      builder.writeB1(0x95);
      builder.writeBn(new Uint8Array([0xde, 0xad, 0xbe, 0xef]));
      builder.writeDn({
        bitCount: 11,
        bytes: new Uint8Array([0b1010_0101, 0b1111_1101]),
      });

      builder.writeKxU1([1, 2, 3, 4]);
      builder.writeKxU2([100, 65535, 42]);
      builder.writeKxU4([0, 4_000_000_000]);
      builder.writeKxI2([-32768, 0, 32767]);
      builder.writeKxR4([-1.5, 0, 2.25]);
      builder.writeKxCn(['SITE_A', 'SITE_B']);
      builder.writeKxN1([0x0a, 0x05, 0x0f]);

      builder.endRecord(hdr);
      const raw = builder.toUint8Array();

      // Test non-zero byteOffset Uint8Array view
      const padded = new Uint8Array(raw.byteLength + 24);
      padded.fill(0xcc);
      padded.set(raw, 12);
      const sliceView = padded.subarray(12, 12 + raw.byteLength);

      const headerCursor = new BinaryCursor(sliceView, endianness);
      expect(headerCursor.endianness).toBe(endianness);
      expect(headerCursor.byteLength).toBe(raw.byteLength);

      const recLen = headerCursor.readU2();
      const recTyp = headerCursor.readU1();
      const recSub = headerCursor.readU1();
      expect(recLen).toBe(raw.byteLength - STDF_RECORD_HEADER_BYTES);
      expect(recTyp).toBe(50);
      expect(recSub).toBe(10);

      const cursor = headerCursor.subCursor(
        STDF_RECORD_HEADER_BYTES,
        STDF_RECORD_HEADER_BYTES + recLen,
      );

      expect(cursor.readU1()).toBe(0xfe);
      expect(cursor.readU2()).toBe(0xabcd);
      expect(cursor.readU4()).toBe(0xdeadbeef);
      expect(cursor.readU8()).toBe(0x0123456789abcdefn);

      expect(cursor.readI1()).toBe(-42);
      expect(cursor.readI2()).toBe(-32768);
      expect(cursor.readI4()).toBe(-123456789);
      expect(cursor.readI8()).toBe(-9007199254740993n);

      expect(cursor.readR4()).toBe(Math.fround(0.0035));
      expect(cursor.readR8()).toBe(-123456.7890125);

      expect(cursor.readC1()).toBe('P');
      expect(cursor.readC1()).toBe(' ');
      expect(cursor.readFixedChar(6)).toBe('WAF1  ');
      expect(cursor.readCn()).toBe('');
      expect(cursor.readCn()).toBe('CAL-LOT-01');
      expect(cursor.readB1()).toBe(0x95);
      expect(Array.from(cursor.readBn())).toEqual([0xde, 0xad, 0xbe, 0xef]);

      const dn = cursor.readDn();
      expect(dn.bitCount).toBe(11);
      expect(Array.from(dn.bytes)).toEqual([0b1010_0101, 0b0000_0101]);

      expect(Array.from(cursor.readKxU1(4))).toEqual([1, 2, 3, 4]);
      expect(Array.from(cursor.readKxU2(3))).toEqual([100, 65535, 42]);
      expect(Array.from(cursor.readKxU4(2))).toEqual([0, 4_000_000_000]);
      expect(Array.from(cursor.readKxI2(3))).toEqual([-32768, 0, 32767]);
      expect(Array.from(cursor.readKxR4(3))).toEqual([-1.5, 0, 2.25]);
      expect(cursor.readKxCn(2)).toEqual(['SITE_A', 'SITE_B']);
      expect(Array.from(cursor.readKxN1(3))).toEqual([0x0a, 0x05, 0x0f]);

      expect(cursor.atEnd).toBe(true);
      expect(cursor.remaining).toBe(0);
    },
  );

  it('distinguishes big-endian and little-endian byte layouts on identical bytes', () => {
    const bytes = new Uint8Array([0x12, 0x34, 0x56, 0x78, 0xfe, 0xdc, 0xba, 0x98]);
    const cursor = new BinaryCursor(bytes, 'big');
    expect(cursor.readU2()).toBe(0x1234);
    expect(cursor.readU2()).toBe(0x5678);
    expect(Array.from(cursor.readKxI1(2))).toEqual([-2, -36]);
    expect(cursor.readI2()).toBe(-17768);

    cursor.setEndianness('little');
    cursor.setWindow(0, 8);
    expect(cursor.readU2()).toBe(0x3412);
    expect(Array.from(cursor.readKxI4(1))).toEqual([-587302826]);
    expect(cursor.readU2()).toBe(0x98ba);
  });

  it('enforces recordEnd bounds even when underlying buffer has trailing bytes', () => {
    const buf = new Uint8Array(16);
    const cursor = new BinaryCursor(buf, 'little', 2, 6);
    expect(cursor.offset).toBe(2);
    expect(cursor.recordEnd).toBe(6);
    expect(cursor.remaining).toBe(4);

    cursor.skip(3);
    expect(cursor.remaining).toBe(1);

    try {
      cursor.readU2();
      expect.unreachable('Expected RecordBoundsError');
    } catch (err) {
      expect(err).toBeInstanceOf(RecordBoundsError);
      const boundsErr = err as RecordBoundsError;
      expect(boundsErr.byteOffset).toBe(5);
      expect(boundsErr.requestedBytes).toBe(2);
      expect(boundsErr.remainingBytes).toBe(1);
      expect(boundsErr.fieldType).toBe('U*2');
    }

    expect(cursor.readU1()).toBe(0);
    expect(cursor.atEnd).toBe(true);
    expect(() => cursor.readU1()).toThrow(RecordBoundsError);
    expect(() => cursor.readI4()).toThrow(RecordBoundsError);
    expect(() => cursor.readR4()).toThrow(RecordBoundsError);
    expect(() => cursor.readR8()).toThrow(RecordBoundsError);
    expect(() => cursor.readKxR8(1)).toThrow(RecordBoundsError);
  });

  it('rejects invalid windows and variable-length / counted-array overflows', () => {
    const buf = new Uint8Array([0x08, 0x41, 0x42, 0x43]);
    const cursor = new BinaryCursor(buf, 'little');

    expect(() => cursor.setWindow(-1, 2)).toThrow(RecordBoundsError);
    expect(() => cursor.setWindow(3, 2)).toThrow(RecordBoundsError);
    expect(() => cursor.setWindow(0, 5)).toThrow(RecordBoundsError);
    expect(() => cursor.setWindow(1.5, 3)).toThrow(RecordBoundsError);

    expect(() => cursor.readCn()).toThrow(RecordBoundsError);
    expect(cursor.offset).toBe(0);

    expect(() => cursor.readBn()).toThrow(RecordBoundsError);
    expect(cursor.offset).toBe(0);

    const dnBuf = new Uint8Array([0x20, 0x00, 0xff, 0xff]);
    const dnCursor = new BinaryCursor(dnBuf, 'little');
    expect(() => dnCursor.readDn()).toThrow(RecordBoundsError);

    expect(() => dnCursor.readKxU2(3)).toThrow(RecordBoundsError);
    expect(() => dnCursor.readKxU1(-1)).toThrow(RecordBoundsError);
    expect(() => dnCursor.readKxU1(Number.NaN)).toThrow(RecordBoundsError);
    expect(() => dnCursor.readKxCn(5)).toThrow(RecordBoundsError);
    expect(() => dnCursor.readKxCn(Number.NaN)).toThrow(RecordBoundsError);
    expect(() => dnCursor.skip(Number.NaN)).toThrow(RecordBoundsError);
  });

  it('returns undefined for readOpt* at recordEnd and throws on partial trailing bytes', () => {
    const emptyCursor = new BinaryCursor(new Uint8Array(4), 'little', 4, 4);
    expect(emptyCursor.readOptU1()).toBeUndefined();
    expect(emptyCursor.readOptU2()).toBeUndefined();
    expect(emptyCursor.readOptU4()).toBeUndefined();
    expect(emptyCursor.readOptI1()).toBeUndefined();
    expect(emptyCursor.readOptI2()).toBeUndefined();
    expect(emptyCursor.readOptI4()).toBeUndefined();
    expect(emptyCursor.readOptR4()).toBeUndefined();
    expect(emptyCursor.readOptC1()).toBeUndefined();
    expect(emptyCursor.readOptCn()).toBeUndefined();
    expect(emptyCursor.readOptB1()).toBeUndefined();
    expect(emptyCursor.readOptBn()).toBeUndefined();
    expect(emptyCursor.readOptDn()).toBeUndefined();
    expect(emptyCursor.readOptKxU2(2)).toBeUndefined();
    expect(emptyCursor.readOptKxN1(2)).toBeUndefined();
    expect(emptyCursor.readOptKxR4(2)).toBeUndefined();

    const partial = new BinaryCursor(new Uint8Array([0x01, 0x02]), 'little');
    expect(() => partial.readOptU4()).toThrow(RecordBoundsError);
    expect(() => partial.readOptR4()).toThrow(RecordBoundsError);
  });

  it('strips ASCII control chars and truncates C*n cleanly at <= 255 UTF-8 bytes (Requirement 2.4)', () => {
    expect(sanitizeStdfString('LOT\x00-\x0701\x1f\x7f')).toBe('LOT-01');
    expect(sanitizeStdfString('<script>alert(1)</script>')).toBe(
      '<script>alert(1)</script>',
    );

    // C*1 printable boundary bytes (0x20, 0x7E) vs non-printable control/DEL/high bytes
    const c1Bytes = new Uint8Array([0x20, 0x7e, 0x00, 0x01, 0x1f, 0x7f, 0x80, 0xff]);
    const c1Cursor = new BinaryCursor(c1Bytes, 'little');
    expect(c1Cursor.readC1()).toBe(' ');
    expect(c1Cursor.readC1()).toBe('~');
    expect(c1Cursor.readC1()).toBe(' ');
    expect(c1Cursor.readC1()).toBe(' ');
    expect(c1Cursor.readC1()).toBe(' ');
    expect(c1Cursor.readC1()).toBe(' ');
    expect(c1Cursor.readC1()).toBe(' ');
    expect(c1Cursor.readC1()).toBe(' ');

    const builder = new BinaryRecordBuilder('little');
    const longText = 'µ'.repeat(100) + 'Ω'.repeat(40);
    builder.writeCn(longText);
    const bytes = builder.toUint8Array();
    expect(bytes[0]).toBeLessThanOrEqual(255);

    const cursor = new BinaryCursor(bytes, 'little');
    const decoded = cursor.readCn();
    expect(decoded.startsWith('µ'.repeat(100))).toBe(true);
    expect(decoded.includes('\ufffd')).toBe(false);

    const hugeBuilder = new BinaryRecordBuilder('little');
    const hdr = hugeBuilder.beginRecord(50, 30);
    hugeBuilder.writeRawBytes(new Uint8Array(0x10000));
    expect(() => hugeBuilder.endRecord(hdr)).toThrow(RangeError);
  });
});
