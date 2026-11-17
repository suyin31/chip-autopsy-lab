/**
 * Dedicated STDF V4 analysis Web Worker (`src/workers/autopsy.worker.ts`).
 *
 * Exposes a Comlink module worker API while keeping all ingest, gzip decompression,
 * STDF V4 decoding, columnar `LotModel` construction, and `YieldSummary` calculation
 * in plain deterministic functions (`ingestStdfBuffer`, `ingestDemoPreset`,
 * `createAutopsyWorkerApi`) that execute directly in Node/Vitest without a real `Worker`.
 *
 * Built-in synthetic demo lots (`generateDemoStdfBytes`) pass through the exact same
 * `ingestStdfBuffer` pipeline (`bytes -> parser -> lot-builder -> yield-summary`)
 * as user-dropped `.stdf` / `.stdf.gz` files.
 *
 * Validates: Requirements 1.3, 1.4, 1.10, 2.2, 2.3, 2.5, 3.3, 15.2, 16.1
 */

import * as Comlink from 'comlink';
import {
  computeYieldSummary,
  detectSiteAnomalies,
  type SiteAnomalyFactInput,
  type YieldSummary,
} from '@/core/analytics';
import {
  type DemoPresetId,
  type DemoPresetMeta,
  generateDemoStdfBytes,
  getDemoPresetMeta,
  listDemoPresets,
} from '@/core/demo';
import { buildLotModel, type LotModel } from '@/core/model';
import {
  DEFAULT_MAX_UNCOMPRESSED_BYTES,
  decompressGzipStreamWithCeiling,
  hasGzipMagicBytes,
  type ParseFatalError,
  type ParseMode,
  type ParseProgress,
  parseStdfBytes,
} from '@/core/stdf';

export type WorkerParsePhase =
  | 'generating-demo'
  | 'decompressing'
  | 'parsing'
  | 'modeling';

export interface WorkerParseProgress extends ParseProgress {
  readonly phase: WorkerParsePhase;
}

export type WorkerProgressCallback = (
  progress: WorkerParseProgress,
) => void | Promise<void>;

export type AutopsyInputSource =
  | {
      readonly kind: 'file';
      readonly fileName: string;
      readonly compressed: boolean;
    }
  | {
      readonly kind: 'demo';
      readonly preset: DemoPresetMeta;
      readonly seed: number;
    };

export interface AutopsyWorkerLoadedPayload {
  readonly source: AutopsyInputSource;
  readonly byteLength: number;
  readonly uncompressedByteLength: number;
  readonly recordsDecoded: number;
  readonly validPrrCount: number;
  readonly skippedRecordCount: number;
  readonly elapsedMs: number;
  readonly lot: LotModel;
  readonly yieldSummary: YieldSummary;
  readonly siteAnomalies: readonly SiteAnomalyFactInput[];
}

export type AutopsyWorkerResponse =
  | ({ readonly kind: 'ok' } & AutopsyWorkerLoadedPayload)
  | {
      readonly kind: 'large-file-prompt';
      readonly bytesObserved: number;
      readonly maxUncompressedBytes: number;
      readonly fileName?: string;
    }
  | {
      readonly kind: 'error';
      readonly error: ParseFatalError;
      readonly fileName?: string;
    };

export interface IngestBufferOptions {
  /**
   * Explicit parse mode (`'full'` or `'bins-only'`).
   * When omitted (`undefined`), streams exceeding `maxUncompressedBytes` pause and
   * return `{ kind: 'large-file-prompt' }` per Requirement 2.5.
   * When explicitly provided, parsing proceeds in that mode without prompting.
   */
  readonly mode?: ParseMode;
  readonly maxUncompressedBytes?: number;
  readonly fileName?: string;
  readonly source?: AutopsyInputSource;
  readonly onProgress?: WorkerProgressCallback;
}

export interface IngestDemoOptions {
  readonly seed?: number;
  readonly mode?: ParseMode;
  readonly maxUncompressedBytes?: number;
  readonly onProgress?: WorkerProgressCallback;
}

export interface WorkerLoadBufferRequest {
  readonly mode?: ParseMode;
  readonly maxUncompressedBytes?: number;
  readonly fileName?: string;
}

export interface WorkerLoadDemoRequest {
  readonly seed?: number;
  readonly mode?: ParseMode;
  readonly maxUncompressedBytes?: number;
}

export interface AutopsyWorkerApi {
  loadBuffer(
    buffer: ArrayBuffer,
    request?: WorkerLoadBufferRequest,
    onProgress?: WorkerProgressCallback,
  ): Promise<AutopsyWorkerResponse>;
  loadDemoLot(
    presetId: DemoPresetId,
    request?: WorkerLoadDemoRequest,
    onProgress?: WorkerProgressCallback,
  ): Promise<AutopsyWorkerResponse>;
  resumeLargeFileParse(
    mode: ParseMode,
    onProgress?: WorkerProgressCallback,
  ): Promise<AutopsyWorkerResponse>;
  getDemoPresets(): readonly DemoPresetMeta[];
}

function nowMs(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

function toUint8View(input: ArrayBuffer | Uint8Array): Uint8Array {
  return input instanceof Uint8Array ? input : new Uint8Array(input);
}

function emitProgressSafely(
  onProgress: WorkerProgressCallback | undefined,
  progress: WorkerParseProgress,
  transferSweepBatch: boolean,
  pendingCalls?: Promise<unknown>[],
): void {
  if (!onProgress) {
    return;
  }
  const payload =
    transferSweepBatch &&
    progress.sweepBatch !== undefined &&
    progress.sweepBatch.buffer instanceof ArrayBuffer &&
    progress.sweepBatch.byteLength > 0
      ? Comlink.transfer(progress, [progress.sweepBatch.buffer])
      : progress;

  const maybePromise = onProgress(payload);
  if (
    pendingCalls !== undefined &&
    maybePromise !== undefined &&
    typeof (maybePromise as PromiseLike<unknown>).then === 'function'
  ) {
    pendingCalls.push(Promise.resolve(maybePromise));
  }
}

/**
 * Collects unique, non-empty transferable `ArrayBuffer` instances backing a
 * worker response (`ColumnarDies`, `ParametricTestColumn.values`, and
 * `SiteAnomalyFactInput.failingDieIndices`) for zero-copy `postMessage` hand-off.
 */
export function collectWorkerResponseTransferables(
  response: AutopsyWorkerResponse,
): Transferable[] {
  if (response.kind !== 'ok') {
    return [];
  }

  const uniqueBuffers = new Set<ArrayBuffer>();
  const addView = (view: ArrayBufferView): void => {
    if (view.buffer instanceof ArrayBuffer && view.byteLength > 0) {
      uniqueBuffers.add(view.buffer);
    }
  };

  const { dies, tests } = response.lot;
  addView(dies.waferIndex);
  addView(dies.x);
  addView(dies.y);
  addView(dies.hasValidCoords);
  addView(dies.firstSiteIndex);
  addView(dies.siteIndex);
  addView(dies.firstPass);
  addView(dies.finalPass);
  addView(dies.hbin);
  addView(dies.sbin);
  addView(dies.retestCount);
  addView(dies.ringIndex);
  addView(dies.firstPrrOrder);

  for (const col of tests.values()) {
    addView(col.values);
  }

  for (const anomaly of response.siteAnomalies) {
    addView(anomaly.failingDieIndices);
  }

  return Array.from(uniqueBuffers);
}

interface InternalIngestOutcome {
  readonly response: AutopsyWorkerResponse;
  /** Retained when a gzip stream or raw buffer triggers `large-file-prompt`. */
  readonly retainedRawBytes?: Uint8Array;
}

async function runIngestPipeline(
  input: ArrayBuffer | Uint8Array,
  options: IngestBufferOptions = {},
  transferSweepBatch = false,
): Promise<InternalIngestOutcome> {
  const startTime = nowMs();
  const pendingProgressCalls: Promise<unknown>[] = [];
  const rawBytes = toUint8View(input);
  const rawByteLength = rawBytes.byteLength;
  const maxUncompressedBytes =
    options.maxUncompressedBytes ?? DEFAULT_MAX_UNCOMPRESSED_BYTES;
  const fileName = options.fileName;
  const compressed = hasGzipMagicBytes(rawBytes);

  const resolvedSource: AutopsyInputSource =
    options.source ?? {
      kind: 'file',
      fileName: fileName ?? 'unnamed.stdf',
      compressed,
    };

  let stdfBytes: Uint8Array;

  if (compressed) {
    emitProgressSafely(
      options.onProgress,
      {
        phase: 'decompressing',
        bytesProcessed: 0,
        totalBytes: null,
        recordsDecoded: 0,
        diesResolved: 0,
      },
      false,
      pendingProgressCalls,
    );

    const ceiling =
      options.mode !== undefined ? Number.POSITIVE_INFINITY : maxUncompressedBytes;
    const decompressed = await decompressGzipStreamWithCeiling(rawBytes, ceiling);

    if (decompressed.kind === 'ceiling_exceeded') {
      return {
        response: {
          kind: 'large-file-prompt',
          bytesObserved: decompressed.bytesObserved,
          maxUncompressedBytes,
          ...(fileName !== undefined ? { fileName } : {}),
        },
        retainedRawBytes: rawBytes,
      };
    }

    if (decompressed.kind === 'error') {
      return {
        response: {
          kind: 'error',
          error: decompressed.error,
          ...(fileName !== undefined ? { fileName } : {}),
        },
      };
    }

    stdfBytes = decompressed.bytes;
  } else {
    if (options.mode === undefined && rawByteLength > maxUncompressedBytes) {
      return {
        response: {
          kind: 'large-file-prompt',
          bytesObserved: rawByteLength,
          maxUncompressedBytes,
          ...(fileName !== undefined ? { fileName } : {}),
        },
        retainedRawBytes: rawBytes,
      };
    }
    stdfBytes = rawBytes;
  }

  const effectiveMode: ParseMode = options.mode ?? 'full';
  let lastResolvedDies = 0;

  const parsed = parseStdfBytes(stdfBytes, {
    mode: effectiveMode,
    maxUncompressedBytes,
    onProgress: options.onProgress
      ? (progress) => {
          lastResolvedDies = progress.diesResolved;
          emitProgressSafely(
            options.onProgress,
            {
              ...progress,
              phase: 'parsing',
            },
            transferSweepBatch,
            pendingProgressCalls,
          );
        }
      : undefined,
  });

  if (!parsed.ok) {
    return {
      response: {
        kind: 'error',
        error: parsed.error,
        ...(fileName !== undefined ? { fileName } : {}),
      },
    };
  }

  emitProgressSafely(
    options.onProgress,
    {
      phase: 'modeling',
      bytesProcessed: stdfBytes.byteLength,
      totalBytes: stdfBytes.byteLength,
      recordsDecoded: parsed.value.recordsDecoded,
      diesResolved: lastResolvedDies,
    },
    false,
    pendingProgressCalls,
  );

  const lot = buildLotModel(parsed.value);
  const yieldSummary = computeYieldSummary(lot);
  const siteAnomalies = detectSiteAnomalies(lot);
  const elapsedMs = Math.max(0, nowMs() - startTime);

  if (pendingProgressCalls.length > 0) {
    await Promise.allSettled(pendingProgressCalls);
  }

  return {
    response: {
      kind: 'ok',
      source: resolvedSource,
      byteLength: rawByteLength,
      uncompressedByteLength: stdfBytes.byteLength,
      recordsDecoded: parsed.value.recordsDecoded,
      validPrrCount: parsed.value.validPrrCount,
      skippedRecordCount: parsed.value.skippedRecordCount,
      elapsedMs,
      lot,
      yieldSummary,
      siteAnomalies,
    },
  };
}

/**
 * Plain, framework-free STDF V4 buffer ingest pipeline (`bytes -> gzip? -> parser -> lot-builder -> yield-summary`).
 * Directly unit-testable in Node/Vitest without instantiating a Web Worker.
 */
export async function ingestStdfBuffer(
  buffer: ArrayBuffer | Uint8Array,
  options: IngestBufferOptions = {},
): Promise<AutopsyWorkerResponse> {
  const { response } = await runIngestPipeline(buffer, options, false);
  return response;
}

/**
 * Generates synthetic STDF V4 bytes for `presetId` via `generateDemoStdfBytes` and feeds
 * them through the exact same `ingestStdfBuffer` parse/model/analytics path as uploaded files
 * (Requirement 3.3).
 */
export async function ingestDemoPreset(
  presetId: DemoPresetId,
  options: IngestDemoOptions = {},
): Promise<AutopsyWorkerResponse> {
  const preset = getDemoPresetMeta(presetId);
  const resolvedSeed = options.seed ?? preset.defaultSeed;

  emitProgressSafely(
    options.onProgress,
    {
      phase: 'generating-demo',
      bytesProcessed: 0,
      totalBytes: null,
      recordsDecoded: 0,
      diesResolved: 0,
    },
    false,
  );

  const stdfBytes = generateDemoStdfBytes(presetId, resolvedSeed);

  return ingestStdfBuffer(stdfBytes, {
    ...(options.mode !== undefined ? { mode: options.mode } : {}),
    ...(options.maxUncompressedBytes !== undefined
      ? { maxUncompressedBytes: options.maxUncompressedBytes }
      : {}),
    source: {
      kind: 'demo',
      preset,
      seed: resolvedSeed,
    },
    ...(options.onProgress !== undefined ? { onProgress: options.onProgress } : {}),
  });
}

function wrapWithTransferables(
  response: AutopsyWorkerResponse,
  enableTransfer: boolean,
): AutopsyWorkerResponse {
  if (!enableTransfer) {
    return response;
  }
  const transferables = collectWorkerResponseTransferables(response);
  if (transferables.length === 0) {
    return response;
  }
  return Comlink.transfer(response, transferables);
}

/**
 * Creates a stateful worker API instance supporting Comlink zero-copy `ArrayBuffer`
 * transfers and resumable `> 200 MB` large-file mode selection.
 */
export function createAutopsyWorkerApi(options?: {
  readonly enableComlinkTransfer?: boolean;
}): AutopsyWorkerApi {
  const enableTransfer = options?.enableComlinkTransfer ?? true;
  let pendingLargeBytes: Uint8Array | null = null;
  let pendingFileName: string | undefined;
  let pendingMaxBytes: number | undefined;

  return {
    async loadBuffer(
      buffer: ArrayBuffer,
      request: WorkerLoadBufferRequest = {},
      onProgress?: WorkerProgressCallback,
    ): Promise<AutopsyWorkerResponse> {
      pendingLargeBytes = null;
      pendingFileName = undefined;
      pendingMaxBytes = undefined;

      const outcome = await runIngestPipeline(
        buffer,
        {
          ...(request.mode !== undefined ? { mode: request.mode } : {}),
          ...(request.maxUncompressedBytes !== undefined
            ? { maxUncompressedBytes: request.maxUncompressedBytes }
            : {}),
          ...(request.fileName !== undefined ? { fileName: request.fileName } : {}),
          ...(onProgress !== undefined ? { onProgress } : {}),
        },
        enableTransfer,
      );

      if (
        outcome.response.kind === 'large-file-prompt' &&
        outcome.retainedRawBytes !== undefined
      ) {
        pendingLargeBytes = outcome.retainedRawBytes;
        pendingFileName = request.fileName;
        pendingMaxBytes = request.maxUncompressedBytes;
      }

      return wrapWithTransferables(outcome.response, enableTransfer);
    },

    async loadDemoLot(
      presetId: DemoPresetId,
      request: WorkerLoadDemoRequest = {},
      onProgress?: WorkerProgressCallback,
    ): Promise<AutopsyWorkerResponse> {
      pendingLargeBytes = null;
      pendingFileName = undefined;
      pendingMaxBytes = undefined;

      const preset = getDemoPresetMeta(presetId);
      const resolvedSeed = request.seed ?? preset.defaultSeed;

      const demoProgressCalls: Promise<unknown>[] = [];
      emitProgressSafely(
        onProgress,
        {
          phase: 'generating-demo',
          bytesProcessed: 0,
          totalBytes: null,
          recordsDecoded: 0,
          diesResolved: 0,
        },
        false,
        demoProgressCalls,
      );

      const stdfBytes = generateDemoStdfBytes(presetId, resolvedSeed);
      const outcome = await runIngestPipeline(
        stdfBytes,
        {
          ...(request.mode !== undefined ? { mode: request.mode } : {}),
          ...(request.maxUncompressedBytes !== undefined
            ? { maxUncompressedBytes: request.maxUncompressedBytes }
            : {}),
          source: {
            kind: 'demo',
            preset,
            seed: resolvedSeed,
          },
          ...(onProgress !== undefined ? { onProgress } : {}),
        },
        enableTransfer,
      );

      if (demoProgressCalls.length > 0) {
        await Promise.allSettled(demoProgressCalls);
      }

      return wrapWithTransferables(outcome.response, enableTransfer);
    },

    async resumeLargeFileParse(
      mode: ParseMode,
      onProgress?: WorkerProgressCallback,
    ): Promise<AutopsyWorkerResponse> {
      if (pendingLargeBytes === null) {
        return {
          kind: 'error',
          error: {
            code: 'EMPTY_INPUT',
            message: 'No paused large STDF stream is awaiting parse mode selection.',
          },
        };
      }

      const retained = pendingLargeBytes;
      const fileName = pendingFileName;
      const maxUncompressedBytes = pendingMaxBytes;
      pendingLargeBytes = null;
      pendingFileName = undefined;
      pendingMaxBytes = undefined;

      const outcome = await runIngestPipeline(
        retained,
        {
          mode,
          ...(maxUncompressedBytes !== undefined ? { maxUncompressedBytes } : {}),
          ...(fileName !== undefined ? { fileName } : {}),
          ...(onProgress !== undefined ? { onProgress } : {}),
        },
        enableTransfer,
      );

      return wrapWithTransferables(outcome.response, enableTransfer);
    },

    getDemoPresets(): readonly DemoPresetMeta[] {
      return listDemoPresets();
    },
  };
}

const isDedicatedWorkerScope =
  typeof globalThis !== 'undefined' &&
  typeof globalThis.addEventListener === 'function' &&
  typeof globalThis.postMessage === 'function' &&
  typeof (globalThis as { document?: unknown }).document === 'undefined';

if (isDedicatedWorkerScope) {
  Comlink.expose(createAutopsyWorkerApi());
}
