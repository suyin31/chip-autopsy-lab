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
  buildDemoStdfDownload,
  type DemoPresetId,
  type DemoPresetMeta,
  generateDemoStdfBytes,
  getDemoPresetMeta,
  getDemoPresetPreview,
  listDemoPresets,
} from '@/core/demo';
import {
  buildLotModel,
  buildWaferProbeOrder,
  type LotModel,
} from '@/core/model';
import {
  classifyStackedPattern,
  classifyWaferPattern,
  type PatternClassification,
} from '@/core/patterns';
import {
  type AutopsyReport,
  type AutopsyVerdictDecision,
  type EngineFact,
  generateOfflineAutopsyReport,
} from '@/core/report';
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
  /** Pre-sorted `PRR` sequence die indices per wafer for the §5.1 probe-sweep reveal. */
  readonly probeOrderByWafer: readonly Uint32Array[];
  readonly yieldSummary: YieldSummary;
  readonly siteAnomalies: readonly SiteAnomalyFactInput[];
  readonly facts: readonly EngineFact[];
  readonly verdict: AutopsyVerdictDecision;
  readonly report: AutopsyReport;
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
  /**
   * When `false` (used by `worker-client.ts` `loadFile`, which holds an OS-backed `File`
   * handle), the worker immediately releases its buffer on `large-file-prompt` so raw
   * bytes are never simultaneously retained in both client and worker memory.
   * Defaults to `true` for standalone `loadBuffer` callers whose `ArrayBuffer` was detached.
   */
  readonly retainOnLargePrompt?: boolean;
}

export interface WorkerLoadDemoRequest {
  readonly seed?: number;
  readonly mode?: ParseMode;
  readonly maxUncompressedBytes?: number;
}

export interface WorkerExportDemoResult {
  readonly presetId: DemoPresetId;
  readonly fileName: `${DemoPresetId}.stdf`;
  readonly buffer: ArrayBuffer;
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
  exportDemoStdf(
    presetId: DemoPresetId,
    seed?: number,
  ): Promise<WorkerExportDemoResult>;
  renderDemoThumbnail(
    presetId: DemoPresetId,
    cssSize: number,
    dpr: number,
    highContrast?: boolean,
  ): Promise<ImageBitmap | null>;
  resumeLargeFileParse(
    mode: ParseMode,
    onProgress?: WorkerProgressCallback,
  ): Promise<AutopsyWorkerResponse>;
  discardPendingLargeFile(): void;
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

  for (const probeOrder of response.probeOrderByWafer) {
    addView(probeOrder);
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
  const probeOrderByWafer: Uint32Array[] = new Array<Uint32Array>(
    lot.wafers.length,
  );
  for (let w = 0; w < lot.wafers.length; w += 1) {
    probeOrderByWafer[w] = buildWaferProbeOrder(lot, w);
  }
  const yieldSummary = computeYieldSummary(lot);
  const siteAnomalies = detectSiteAnomalies(lot);
  const waferCount = lot.wafers.length;
  const perWaferPatterns: PatternClassification[] = new Array<PatternClassification>(
    waferCount,
  );
  for (let w = 0; w < waferCount; w += 1) {
    perWaferPatterns[w] = classifyWaferPattern(lot, w);
  }
  const primarySpatial =
    waferCount === 1 ? perWaferPatterns[0]! : classifyStackedPattern(lot);
  const { facts, verdict, report } = generateOfflineAutopsyReport(lot, {
    yieldSummary,
    siteAnomalies,
    primarySpatial,
    perWaferPatterns,
  });
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
      probeOrderByWafer,
      yieldSummary,
      siteAnomalies,
      facts,
      verdict,
      report,
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
        outcome.retainedRawBytes !== undefined &&
        request.retainOnLargePrompt !== false
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

    discardPendingLargeFile(): void {
      pendingLargeBytes = null;
      pendingFileName = undefined;
      pendingMaxBytes = undefined;
    },

    async exportDemoStdf(
      presetId: DemoPresetId,
      seed?: number,
    ): Promise<WorkerExportDemoResult> {
      const payload = buildDemoStdfDownload(presetId, seed);
      const exactBuffer =
        payload.bytes.buffer instanceof ArrayBuffer &&
        payload.bytes.byteOffset === 0 &&
        payload.bytes.byteLength === payload.bytes.buffer.byteLength
          ? payload.bytes.buffer
          : payload.bytes.slice().buffer;
      const result: WorkerExportDemoResult = {
        presetId: payload.presetId,
        fileName: payload.fileName,
        buffer: exactBuffer,
      };
      if (enableTransfer && exactBuffer.byteLength > 0) {
        return Comlink.transfer(result, [exactBuffer]);
      }
      return result;
    },

    async renderDemoThumbnail(
      presetId: DemoPresetId,
      cssSize: number,
      dpr: number,
      highContrast?: boolean,
    ): Promise<ImageBitmap | null> {
      if (typeof OffscreenCanvas === 'undefined') {
        return null;
      }
      const safeCss = Number.isFinite(cssSize) && cssSize > 0 ? cssSize : 168;
      const safeDpr =
        Number.isFinite(dpr) && dpr > 0 ? Math.min(4, dpr) : 1;
      const pixelSize = Math.max(1, Math.round(safeCss * safeDpr));
      const offscreen = new OffscreenCanvas(pixelSize, pixelSize);
      const ctx = offscreen.getContext('2d');
      if (!ctx) {
        return null;
      }

      // Mirrors `paintLandingCardWafer` (src/ui/wafer-map/wafer-geometry.ts): premium §5.2 disc
      // material without thin film or sheen, then the §5.3 thumbnail die tiles. Kept inline so the
      // worker never imports from src/ui/.
      const preview = getDemoPresetPreview(presetId);
      const { wafer, dies } = preview;
      ctx.setTransform(safeDpr, 0, 0, safeDpr, 0, 0);
      ctx.clearRect(0, 0, safeCss, safeCss);

      const center = safeCss / 2;
      const r = Math.max(8, center - 1.5);
      const d = r * 2;
      const notchAngle =
        wafer.geometry.wfFlat === 'U'
          ? -Math.PI / 2
          : wafer.geometry.wfFlat === 'L'
            ? Math.PI
            : wafer.geometry.wfFlat === 'R'
              ? 0
              : Math.PI / 2;
      const halfAngle = Math.asin(Math.min(1, (0.03 * d) / 2 / r));
      const apexR = r - 0.016 * d;
      const traceOutline = (): void => {
        ctx.beginPath();
        ctx.arc(
          center,
          center,
          r,
          notchAngle + halfAngle,
          notchAngle - halfAngle + Math.PI * 2,
          false,
        );
        const apexX = center + Math.cos(notchAngle) * apexR;
        const apexY = center + Math.sin(notchAngle) * apexR;
        ctx.arcTo(
          apexX,
          apexY,
          center + Math.cos(notchAngle + halfAngle) * r,
          center + Math.sin(notchAngle + halfAngle) * r,
          0.002 * d,
        );
        ctx.lineTo(
          center + Math.cos(notchAngle + halfAngle) * r,
          center + Math.sin(notchAngle + halfAngle) * r,
        );
        ctx.closePath();
      };

      ctx.save();
      traceOutline();
      const gx = center - 0.12 * d;
      const gy = center - 0.2 * d;
      const body = ctx.createRadialGradient(gx, gy, 0, gx, gy, 0.78 * d);
      body.addColorStop(0, '#2B2D33');
      body.addColorStop(0.55, '#1C1D21');
      body.addColorStop(1, '#121316');
      ctx.fillStyle = body;
      ctx.fill();
      ctx.clip();
      ctx.beginPath();
      ctx.arc(center, center, r * (1 - 2 * 0.026), 0, Math.PI * 2, false);
      ctx.lineWidth = 1 / safeDpr;
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
      ctx.stroke();
      traceOutline();
      const bevel = ctx.createLinearGradient(center, center - r, center, center + r);
      bevel.addColorStop(0, 'rgba(255, 255, 255, 0.38)');
      bevel.addColorStop(1, 'rgba(255, 255, 255, 0.06)');
      ctx.strokeStyle = bevel;
      ctx.lineWidth = 1.5;
      ctx.lineJoin = 'round';
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(center, center, Math.max(0, r - 1.5), 0, Math.PI * 2, false);
      ctx.lineWidth = 1 / safeDpr;
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.45)';
      ctx.stroke();
      ctx.restore();

      const gridCenterX = (wafer.minX + wafer.maxX) / 2;
      const gridCenterY = (wafer.minY + wafer.maxY) / 2;
      let maxCornerDist = 0;
      for (let i = wafer.dieStartIndex; i < wafer.dieEndIndex; i += 1) {
        if (dies.hasValidCoords[i] === 0) continue;
        const dx = Math.abs(dies.x[i]! - gridCenterX) + 0.5;
        const dy = Math.abs(dies.y[i]! - gridCenterY) + 0.5;
        const dist = Math.hypot(dx, dy);
        if (dist > maxCornerDist) maxCornerDist = dist;
      }
      const waferRadiusUnits = Math.max(
        1.5,
        maxCornerDist + 0.55,
        maxCornerDist / (1 - 2 * 0.026),
      );
      const p = r / waferRadiusUnits;
      const dirX = wafer.geometry.posX === 'L' ? -1 : 1;
      const dirY = wafer.geometry.posY === 'D' ? 1 : -1;

      // premium §5.3: p < 3 omits pass tiles and draws fail dies at full cell with no street
      const dense = p < 3;
      const street = Math.max(1 / safeDpr, Math.round(0.1 * p));
      const failSize = dense ? p : Math.max(0.75, p - street);
      const failHalf = failSize / 2;
      const failRadius = Math.min(2, Math.max(0.5, 0.12 * p));
      const useRound = (size: number): boolean => size >= 3.5;

      if (!dense) {
        const passSize = failSize * 0.8;
        const passHalf = passSize / 2;
        const passRadius = Math.min(
          Math.min(1.5, Math.max(0.5, 0.1 * p)),
          passSize * 0.45,
        );
        ctx.fillStyle = highContrast
          ? 'rgba(255, 255, 255, 0.34)'
          : 'rgba(255, 255, 255, 0.06)';
        ctx.beginPath();
        for (let i = wafer.dieStartIndex; i < wafer.dieEndIndex; i += 1) {
          if (dies.hasValidCoords[i] === 0 || dies.finalPass[i] === 0) continue;
          const cx = center + (dies.x[i]! - gridCenterX) * dirX * p;
          const cy = center + (dies.y[i]! - gridCenterY) * dirY * p;
          if (useRound(passSize)) {
            ctx.roundRect(cx - passHalf, cy - passHalf, passSize, passSize, passRadius);
          } else {
            ctx.rect(cx - passHalf, cy - passHalf, passSize, passSize);
          }
        }
        ctx.fill();
      }

      const facets = !dense && p >= 10;
      const failR = Math.min(failRadius, failSize * 0.45);
      ctx.fillStyle = '#FF6B2C';
      ctx.beginPath();
      for (let i = wafer.dieStartIndex; i < wafer.dieEndIndex; i += 1) {
        if (dies.hasValidCoords[i] === 0 || dies.finalPass[i] !== 0) continue;
        const cx = center + (dies.x[i]! - gridCenterX) * dirX * p;
        const cy = center + (dies.y[i]! - gridCenterY) * dirY * p;
        if (!dense && useRound(failSize)) {
          ctx.roundRect(cx - failHalf, cy - failHalf, failSize, failSize, failR);
        } else {
          ctx.rect(cx - failHalf, cy - failHalf, failSize, failSize);
        }
      }
      ctx.fill();
      if (facets) {
        ctx.fillStyle = 'rgba(255, 255, 255, 0.18)';
        ctx.beginPath();
        for (let i = wafer.dieStartIndex; i < wafer.dieEndIndex; i += 1) {
          if (dies.hasValidCoords[i] === 0 || dies.finalPass[i] !== 0) continue;
          const cx = center + (dies.x[i]! - gridCenterX) * dirX * p;
          const cy = center + (dies.y[i]! - gridCenterY) * dirY * p;
          ctx.rect(cx - failHalf + failR, cy - failHalf, failSize - 2 * failR, 1);
        }
        ctx.fill();
      }

      const bitmap = offscreen.transferToImageBitmap();
      return enableTransfer ? Comlink.transfer(bitmap, [bitmap]) : bitmap;
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
