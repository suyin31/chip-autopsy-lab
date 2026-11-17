/**
 * Unit tests for `src/workers/autopsy.worker.ts` and `src/workers/worker-client.ts`
 * executing directly in Vitest (`environment: 'node'`) without a browser `Worker`.
 *
 * Validates: Requirements 1.3, 1.4, 1.10, 2.2, 2.5, 3.3, 15.2
 */

import * as Comlink from 'comlink';
import { describe, expect, it } from 'vitest';
import {
  DEMO_DIES_PER_WAFER,
  DEMO_WAFER_COUNT,
  generateDemoStdfBytes,
} from '@/core/demo';
import {
  compressGzipBytes,
  PRR_PART_FLG,
  writeStdfBytes,
} from '@/core/stdf';
import {
  collectWorkerResponseTransferables,
  createAutopsyWorkerApi,
  ingestDemoPreset,
  ingestStdfBuffer,
  type WorkerParseProgress,
} from './autopsy.worker';
import { createAutopsyWorkerClient } from './worker-client';

function buildCompactTestStdfBytes(): Uint8Array {
  return writeStdfBytes({
    endianness: 'little',
    mir: {
      setupT: 1_700_000_000,
      startT: 1_700_000_010,
      statNum: 1,
      lotId: 'UNIT-LOT-01',
      partTyp: 'CAL-TEST-IC',
      jobNam: 'UNIT_SORT_V4',
    },
    hbrs: [
      { headNum: 255, siteNum: 0, hbinNum: 1, hbinCnt: 3, hbinPf: 'P', hbinNam: 'PASS' },
      { headNum: 255, siteNum: 0, hbinNum: 4, hbinCnt: 1, hbinPf: 'F', hbinNam: 'LEAK' },
    ],
    sbrs: [
      { headNum: 255, siteNum: 0, sbinNum: 1, sbinCnt: 3, sbinPf: 'P', sbinNam: 'GOOD' },
      { headNum: 255, siteNum: 0, sbinNum: 7, sbinCnt: 1, sbinPf: 'F', sbinNam: 'IDDQ' },
    ],
    wafers: [
      {
        wir: { headNum: 1, siteGrp: 1, startT: 1_700_000_020, waferId: 'W01' },
        touchdowns: [
          [
            {
              headNum: 1,
              siteNum: 1,
              partFlg: 0,
              hardBin: 1,
              softBin: 1,
              xCoord: 0,
              yCoord: 0,
              ptrs: [
                {
                  testNum: 204,
                  testFlg: 0,
                  result: 4.2e-6,
                  testTxt: 'IDDQ_LEAK',
                  resScal: 6,
                  llmScal: 6,
                  hlmScal: 6,
                  loLimit: 0.2e-6,
                  hiLimit: 15.0e-6,
                  units: 'A',
                },
              ],
            },
            {
              headNum: 1,
              siteNum: 2,
              partFlg: PRR_PART_FLG.FAILED,
              hardBin: 4,
              softBin: 7,
              xCoord: 1,
              yCoord: 0,
              ptrs: [
                {
                  testNum: 204,
                  testFlg: 0x80,
                  result: 24.5e-6,
                  omitOptionalAfterResult: true,
                },
              ],
            },
          ],
          [
            {
              headNum: 1,
              siteNum: 1,
              partFlg: 0,
              hardBin: 1,
              softBin: 1,
              xCoord: 0,
              yCoord: 1,
              ptrs: [
                {
                  testNum: 204,
                  testFlg: 0,
                  result: 3.9e-6,
                  omitOptionalAfterResult: true,
                },
              ],
            },
            {
              headNum: 1,
              siteNum: 2,
              partFlg: 0,
              hardBin: 1,
              softBin: 1,
              xCoord: 1,
              yCoord: 1,
              ptrs: [
                {
                  testNum: 204,
                  testFlg: 0,
                  result: 4.5e-6,
                  omitOptionalAfterResult: true,
                },
              ],
            },
          ],
        ],
        wrr: {
          headNum: 1,
          siteGrp: 1,
          finishT: 1_700_000_050,
          partCnt: 4,
          goodCnt: 3,
          waferId: 'W01',
        },
      },
    ],
    mrr: { finishT: 1_700_000_060, dispCod: '0' },
  });
}

describe('autopsy.worker plain testable pipeline (without a real Worker)', () => {
  it('parses raw and gzipped STDF V4 buffers into LotModel and YieldSummary with progress callbacks', async () => {
    const rawStdf = buildCompactTestStdfBytes();
    const rawProgress: WorkerParseProgress[] = [];

    const rawRes = await ingestStdfBuffer(rawStdf, {
      fileName: 'unit-lot.stdf',
      onProgress: (p) => {
        rawProgress.push(p);
      },
    });

    expect(rawRes.kind).toBe('ok');
    if (rawRes.kind !== 'ok') return;

    expect(rawRes.source).toEqual({
      kind: 'file',
      fileName: 'unit-lot.stdf',
      compressed: false,
    });
    expect(rawRes.lot.lotId).toBe('UNIT-LOT-01');
    expect(rawRes.lot.dies.count).toBe(4);
    expect(rawRes.yieldSummary.overall.testedDies).toBe(4);
    expect(rawRes.yieldSummary.overall.finalPassDies).toBe(3);
    expect(rawRes.yieldSummary.overall.finalFailDies).toBe(1);
    expect(rawRes.yieldSummary.overall.finalYield).toBeCloseTo(0.75, 8);
    expect(rawProgress.some((p) => p.phase === 'parsing')).toBe(true);
    expect(rawProgress.at(-1)?.diesResolved).toBe(4);
    expect(rawProgress.at(-1)?.bytesProcessed).toBe(rawStdf.byteLength);

    // Gzipped input detected by 0x1F 0x8B magic bytes despite .bin extension
    const gzipped = await compressGzipBytes(rawStdf);
    const gzProgress: WorkerParseProgress[] = [];
    const gzRes = await ingestStdfBuffer(gzipped, {
      fileName: 'unit-lot.bin',
      onProgress: (p) => {
        gzProgress.push(p);
      },
    });

    expect(gzRes.kind).toBe('ok');
    if (gzRes.kind !== 'ok') return;
    expect(gzRes.source).toEqual({
      kind: 'file',
      fileName: 'unit-lot.bin',
      compressed: true,
    });
    expect(gzRes.byteLength).toBe(gzipped.byteLength);
    expect(gzRes.uncompressedByteLength).toBe(rawStdf.byteLength);
    expect(gzProgress[0]?.phase).toBe('decompressing');
    expect(gzRes.yieldSummary.overall).toEqual(rawRes.yieldSummary.overall);
  });

  it('routes demo presets through the identical binary parse -> lot-builder -> yield-summary pipeline as uploaded files', async () => {
    const progressEvents: WorkerParseProgress[] = [];
    const demoRes = await ingestDemoPreset('edge-ring-etch', {
      onProgress: (p) => {
        progressEvents.push(p);
      },
    });

    expect(demoRes.kind).toBe('ok');
    if (demoRes.kind !== 'ok') return;

    const rawDemoBytes = generateDemoStdfBytes('edge-ring-etch');
    const uploadedEquivalent = await ingestStdfBuffer(rawDemoBytes, {
      fileName: 'edge-ring-etch.stdf',
    });

    expect(uploadedEquivalent.kind).toBe('ok');
    if (uploadedEquivalent.kind !== 'ok') return;

    const expectedTotalDies = DEMO_WAFER_COUNT * DEMO_DIES_PER_WAFER;
    expect(demoRes.source.kind).toBe('demo');
    expect(demoRes.uncompressedByteLength).toBe(rawDemoBytes.byteLength);
    expect(demoRes.recordsDecoded).toBe(uploadedEquivalent.recordsDecoded);
    expect(demoRes.validPrrCount).toBe(uploadedEquivalent.validPrrCount);
    expect(demoRes.lot.lotId).toBe('CAL-ER-2401');
    expect(demoRes.lot.wafers).toHaveLength(DEMO_WAFER_COUNT);
    expect(demoRes.lot.dies.count).toBe(expectedTotalDies);
    expect(demoRes.lot.dies.finalPass).toEqual(uploadedEquivalent.lot.dies.finalPass);
    expect(demoRes.lot.dies.sbin).toEqual(uploadedEquivalent.lot.dies.sbin);
    expect(demoRes.yieldSummary).toEqual(uploadedEquivalent.yieldSummary);

    // Incremental progress invariants (bytes, records, dies monotonic during parsing)
    expect(progressEvents[0]?.phase).toBe('generating-demo');
    const parseProgress = progressEvents.filter((p) => p.phase === 'parsing');
    expect(parseProgress.length).toBeGreaterThan(5);
    for (let i = 1; i < parseProgress.length; i += 1) {
      expect(parseProgress[i]!.bytesProcessed).toBeGreaterThanOrEqual(
        parseProgress[i - 1]!.bytesProcessed,
      );
      expect(parseProgress[i]!.recordsDecoded).toBeGreaterThanOrEqual(
        parseProgress[i - 1]!.recordsDecoded,
      );
      expect(parseProgress[i]!.diesResolved).toBeGreaterThanOrEqual(
        parseProgress[i - 1]!.diesResolved,
      );
    }
    expect(parseProgress.at(-1)?.diesResolved).toBe(expectedTotalDies);
    expect(parseProgress.at(-1)?.bytesProcessed).toBe(rawDemoBytes.byteLength);
  });

  it('surfaces Test Site 1:2 concentration anomaly when parsing site2-probe-contact through the worker pipeline', async () => {
    const res = await ingestDemoPreset('site2-probe-contact');
    expect(res.kind).toBe('ok');
    if (res.kind !== 'ok') return;

    expect(res.lot.lotId).toBe('CAL-S2-2403');
    expect(res.siteAnomalies.length).toBeGreaterThanOrEqual(1);
    expect(res.siteAnomalies[0]?.site.headNum).toBe(1);
    expect(res.siteAnomalies[0]?.site.siteNum).toBe(2);
    expect(res.siteAnomalies[0]?.twoProportionZ).toBeGreaterThanOrEqual(3.0);

    const transfers = collectWorkerResponseTransferables(res);
    // 13 ColumnarDies typed arrays + 4 PTR Float32Arrays + 1 site anomaly Uint32Array = 18 unique ArrayBuffers
    expect(transfers.length).toBe(18);
    expect(new Set(transfers).size).toBe(transfers.length);
  });

  it('returns structured fatal errors on invalid input and supports > ceiling Bins-Only resume', async () => {
    const emptyRes = await ingestStdfBuffer(new Uint8Array(0), {
      fileName: 'empty.stdf',
    });
    expect(emptyRes.kind).toBe('error');
    if (emptyRes.kind === 'error') {
      expect(emptyRes.error.code).toBe('EMPTY_INPUT');
      expect(emptyRes.fileName).toBe('empty.stdf');
    }

    const badFarRes = await ingestStdfBuffer(new Uint8Array([0, 2, 99, 99, 2, 4]));
    expect(badFarRes.kind).toBe('error');
    if (badFarRes.kind === 'error') {
      expect(badFarRes.error.code).toBe('MISSING_FAR_HEADER');
    }

    const api = createAutopsyWorkerApi({ enableComlinkTransfer: false });
    const rawBytes = buildCompactTestStdfBytes();
    const copyBuf = rawBytes.slice().buffer;

    const paused = await api.loadBuffer(copyBuf, {
      fileName: 'oversized.stdf',
      maxUncompressedBytes: 32,
    });
    expect(paused.kind).toBe('large-file-prompt');

    const resumed = await api.resumeLargeFileParse('bins-only');
    expect(resumed.kind).toBe('ok');
    if (resumed.kind === 'ok') {
      expect(resumed.lot.parseMode).toBe('bins-only');
      expect(resumed.lot.dies.count).toBe(4);
      expect(resumed.lot.tests.size).toBe(0);
    }
  });

  it('transfers ArrayBuffers zero-copy via Comlink.transfer and streams Comlink.proxy progress over MessageChannel', async () => {
    const { port1, port2 } = new MessageChannel();
    Comlink.expose(createAutopsyWorkerApi(), port1);
    const client = createAutopsyWorkerClient({
      endpoint: port2,
      terminate: () => {
        port1.close();
        port2.close();
      },
    });

    try {
      const rawBytes = buildCompactTestStdfBytes();
      const transferableBuffer = rawBytes.slice().buffer;
      expect(transferableBuffer.byteLength).toBeGreaterThan(0);

      const proxiedEvents: WorkerParseProgress[] = [];
      const res = await client.loadBuffer(transferableBuffer, {
        fileName: 'transferred.stdf',
        onProgress: (p) => {
          proxiedEvents.push({
            phase: p.phase,
            bytesProcessed: p.bytesProcessed,
            totalBytes: p.totalBytes,
            recordsDecoded: p.recordsDecoded,
            diesResolved: p.diesResolved,
          });
        },
      });

      // Comlink.transfer detaches the caller's ArrayBuffer upon postMessage
      expect(transferableBuffer.byteLength).toBe(0);

      expect(res.kind).toBe('ok');
      if (res.kind === 'ok') {
        expect(res.lot.lotId).toBe('UNIT-LOT-01');
        expect(res.lot.dies.count).toBe(4);
        expect(res.lot.hbins.get(1)?.name).toBe('PASS');
        expect(res.yieldSummary.overall.finalYield).toBeCloseTo(0.75, 8);
      }
      expect(proxiedEvents.length).toBeGreaterThanOrEqual(2);
      expect(proxiedEvents.at(-1)?.diesResolved).toBe(4);

      // File API path
      const file = new File([rawBytes.slice()], 'upload.stdf', {
        type: 'application/octet-stream',
      });
      const fileRes = await client.loadFile(file);
      expect(fileRes.kind).toBe('ok');
      if (fileRes.kind === 'ok') {
        expect(fileRes.source).toEqual({
          kind: 'file',
          fileName: 'upload.stdf',
          compressed: false,
        });
      }
    } finally {
      client.dispose();
    }
  });
});
