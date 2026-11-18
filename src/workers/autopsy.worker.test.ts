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
  DEFAULT_MAX_UNCOMPRESSED_BYTES,
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
    const expectedColumnarDieArrays = 13;
    expect(transfers.length).toBe(
      expectedColumnarDieArrays + res.lot.tests.size + res.siteAnomalies.length,
    );
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

  it('avoids double byte retention across worker and client during large-file prompts and supports cancel (J-2)', async () => {
    const { port1, port2 } = new MessageChannel();
    const workerApi = createAutopsyWorkerApi();
    Comlink.expose(workerApi, port1);
    const client = createAutopsyWorkerClient({
      endpoint: port2,
      terminate: () => {
        port1.close();
        port2.close();
      },
    });

    try {
      const rawBytes = buildCompactTestStdfBytes();
      const gzippedBytes = await compressGzipBytes(rawBytes);

      // 1. Oversized gzipped File: client transfers compressed bytes with retainOnLargePrompt=false;
      //    worker drops its buffer immediately on ceiling_exceeded while client keeps only the File handle.
      const gzFile = new File([gzippedBytes.slice()], 'oversized.stdf.gz', {
        type: 'application/gzip',
      });
      const gzPrompt = await client.loadFile(gzFile, {
        maxUncompressedBytes: 32,
      });
      expect(gzPrompt.kind).toBe('large-file-prompt');

      // Worker itself holds zero pending bytes (proving no duplicate worker retention)
      const directWorkerResume = await workerApi.resumeLargeFileParse('bins-only');
      expect(directWorkerResume.kind).toBe('error');
      if (directWorkerResume.kind === 'error') {
        expect(directWorkerResume.error.code).toBe('EMPTY_INPUT');
      }

      // Client resumes cleanly from the OS-backed File reference
      const gzResumed = await client.resumeLargeFile('bins-only');
      expect(gzResumed.kind).toBe('ok');
      if (gzResumed.kind === 'ok') {
        expect(gzResumed.lot.parseMode).toBe('bins-only');
        expect(gzResumed.lot.dies.count).toBe(4);
        expect(gzResumed.source).toEqual({
          kind: 'file',
          fileName: 'oversized.stdf.gz',
          compressed: true,
        });
      }

      // 2. Direct loadBuffer detaches caller's ArrayBuffer (0 bytes on client) and cancelLargeFile() frees worker buffer
      const rawBuffer = rawBytes.slice().buffer;
      const bufPrompt = await client.loadBuffer(rawBuffer, {
        fileName: 'raw-large.stdf',
        maxUncompressedBytes: 32,
      });
      expect(bufPrompt.kind).toBe('large-file-prompt');
      expect(rawBuffer.byteLength).toBe(0);

      await client.cancelLargeFile();
      const afterCancel = await client.resumeLargeFile('bins-only');
      expect(afterCancel.kind).toBe('error');
      if (afterCancel.kind === 'error') {
        expect(afterCancel.error.code).toBe('EMPTY_INPUT');
      }
    } finally {
      client.dispose();
    }
  });

  it('enforces the exact 200 MB Bins-Only threshold using a fake File.size and preserves wafer map, Pareto inputs, and yield while skipping PTRs (Requirements 2.5, 15.3)', async () => {
    expect(DEFAULT_MAX_UNCOMPRESSED_BYTES).toBe(200 * 1024 * 1024);

    const { port1, port2 } = new MessageChannel();
    Comlink.expose(createAutopsyWorkerApi(), port1);
    const client = createAutopsyWorkerClient({
      endpoint: port2,
      terminate: () => {
        port1.close();
        port2.close();
      },
    });

    const createFakeSizedFile = (
      bytes: Uint8Array,
      name: string,
      fakeSize: number,
    ): File => {
      const file = new File([bytes.slice()], name, {
        type: 'application/octet-stream',
      });
      Object.defineProperty(file, 'size', {
        value: fakeSize,
        configurable: true,
      });
      return file;
    };

    try {
      const rawBytes = buildCompactTestStdfBytes();

      // 1. Exact 200 MB boundary (not > 200 MB): parses directly in 'full' mode with PTRs
      const atCeilingFile = createFakeSizedFile(
        rawBytes,
        'at-200mb.stdf',
        DEFAULT_MAX_UNCOMPRESSED_BYTES,
      );
      const fullRes = await client.loadFile(atCeilingFile);
      expect(fullRes.kind).toBe('ok');
      if (fullRes.kind === 'ok') {
        expect(fullRes.lot.parseMode).toBe('full');
        expect(fullRes.lot.tests.size).toBe(1);
      }

      // 2. 200 MB + 1 byte: pauses and prompts for Bins-Only Mode without reading full file first
      const fakeAbove200Mb = DEFAULT_MAX_UNCOMPRESSED_BYTES + 1;
      const aboveCeilingFile = createFakeSizedFile(
        rawBytes,
        'above-200mb.stdf',
        fakeAbove200Mb,
      );
      const promptRes = await client.loadFile(aboveCeilingFile);
      expect(promptRes).toEqual({
        kind: 'large-file-prompt',
        bytesObserved: fakeAbove200Mb,
        maxUncompressedBytes: DEFAULT_MAX_UNCOMPRESSED_BYTES,
        fileName: 'above-200mb.stdf',
      });

      // 3. Resuming in 'bins-only' skips PTR records yet produces complete wafer map, Pareto inputs, and yield
      const binsOnlyRes = await client.resumeLargeFile('bins-only');
      expect(binsOnlyRes.kind).toBe('ok');
      if (binsOnlyRes.kind === 'ok') {
        expect(binsOnlyRes.lot.parseMode).toBe('bins-only');
        expect(binsOnlyRes.lot.tests.size).toBe(0);
        expect(binsOnlyRes.skippedRecordCount).toBe(4); // 4 PTR records skipped

        // Wafer map spatial coordinates & pass/fail intact
        expect(binsOnlyRes.lot.wafers).toHaveLength(1);
        expect(binsOnlyRes.lot.dies.count).toBe(4);
        expect(Array.from(binsOnlyRes.lot.dies.x)).toEqual([0, 1, 0, 1]);
        expect(Array.from(binsOnlyRes.lot.dies.y)).toEqual([0, 0, 1, 1]);
        expect(Array.from(binsOnlyRes.lot.dies.finalPass)).toEqual([1, 0, 1, 1]);
        expect(binsOnlyRes.lot.waferCoordIndex[0]?.size).toBe(4);

        // Bin Pareto inputs (SBIN/HBIN columns, definitions, and dominant-bin EngineFact) intact
        expect(Array.from(binsOnlyRes.lot.dies.sbin)).toEqual([1, 7, 1, 1]);
        expect(Array.from(binsOnlyRes.lot.dies.hbin)).toEqual([1, 4, 1, 1]);
        expect(binsOnlyRes.lot.sbins.get(7)?.name).toBe('IDDQ');
        expect(binsOnlyRes.lot.hbins.get(4)?.name).toBe('LEAK');
        expect(
          binsOnlyRes.facts.some(
            (f) => f.kind === 'dominant-bin' && f.binRef?.code === 7,
          ),
        ).toBe(true);

        // Yield summary intact
        expect(binsOnlyRes.yieldSummary.overall.testedDies).toBe(4);
        expect(binsOnlyRes.yieldSummary.overall.finalPassDies).toBe(3);
        expect(binsOnlyRes.yieldSummary.overall.finalFailDies).toBe(1);
        expect(binsOnlyRes.yieldSummary.overall.finalYield).toBeCloseTo(0.75, 8);
      }

      // 4. Plain STDF named ".stdf.gz" (without 0x1F 0x8B magic bytes) parses as plain STDF
      const plainNamedGz = new File([rawBytes.slice()], 'plain-not-gzipped.stdf.gz', {
        type: 'application/gzip',
      });
      const plainNamedGzRes = await client.loadFile(plainNamedGz);
      expect(plainNamedGzRes.kind).toBe('ok');
      if (plainNamedGzRes.kind === 'ok') {
        expect(plainNamedGzRes.source).toEqual({
          kind: 'file',
          fileName: 'plain-not-gzipped.stdf.gz',
          compressed: false,
        });
        expect(plainNamedGzRes.lot.dies.count).toBe(4);
      }

      // 5. Worker .stdf demo export transfers bytes zero-copy and parses back to 15,825 dies
      const exported = await client.exportDemoStdf('edge-ring-etch');
      expect(exported.fileName).toBe('edge-ring-etch.stdf');
      const droppedDemo = new File([exported.bytes.slice()], exported.fileName, {
        type: 'application/octet-stream',
      });
      const reparsedDemo = await client.loadFile(droppedDemo);
      expect(reparsedDemo.kind).toBe('ok');
      if (reparsedDemo.kind === 'ok') {
        expect(reparsedDemo.lot.dies.count).toBe(DEMO_WAFER_COUNT * DEMO_DIES_PER_WAFER);
      }
    } finally {
      client.dispose();
    }
  });
});
