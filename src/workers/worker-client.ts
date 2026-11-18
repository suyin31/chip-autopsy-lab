/**
 * Typed main-thread Comlink client for `autopsy.worker.ts` (`src/workers/worker-client.ts`).
 *
 * Responsibilities:
 * - Instantiates the module Web Worker lazily on the client (or binds an injected
 *   Comlink `Endpoint` in Node/Vitest tests).
 * - Transfers uploaded `ArrayBuffer` payloads zero-copy via `Comlink.transfer(buffer, [buffer])`
 *   (Requirement 1.4).
 * - Proxies incremental progress callbacks (`bytesProcessed`, `recordsDecoded`, `diesResolved`,
 *   `sweepBatch`) via `Comlink.proxy` (Requirement 1.10).
 * - Pre-screens uncompressed `File` objects exceeding `200 MB` before allocating full
 *   main-thread buffers so UI tasks stay `<= 50 ms` (Requirements 2.5, 15.2).
 *
 * Validates: Requirements 1.4, 1.10, 2.5, 3.3, 15.2
 */

import * as Comlink from 'comlink';
import {
  type DemoPresetId,
  type DemoPresetMeta,
  listDemoPresets,
} from '@/core/demo';
import {
  DEFAULT_MAX_UNCOMPRESSED_BYTES,
  hasGzipMagicBytes,
  type ParseMode,
} from '@/core/stdf';
import type {
  AutopsyWorkerApi,
  AutopsyWorkerLoadedPayload,
  AutopsyWorkerResponse,
  WorkerParsePhase,
  WorkerParseProgress,
  WorkerProgressCallback,
} from './autopsy.worker';

export type {
  AutopsyWorkerApi,
  AutopsyWorkerLoadedPayload,
  AutopsyWorkerResponse,
  WorkerParsePhase,
  WorkerParseProgress,
  WorkerProgressCallback,
};

export interface ClientLoadBufferOptions {
  readonly mode?: ParseMode;
  readonly maxUncompressedBytes?: number;
  readonly fileName?: string;
  readonly onProgress?: WorkerProgressCallback;
}

export interface ClientLoadFileOptions {
  readonly mode?: ParseMode;
  readonly maxUncompressedBytes?: number;
  readonly onProgress?: WorkerProgressCallback;
}

export interface ClientLoadDemoOptions {
  readonly seed?: number;
  readonly mode?: ParseMode;
  readonly maxUncompressedBytes?: number;
  readonly onProgress?: WorkerProgressCallback;
}

export interface AutopsyWorkerClientOptions {
  /**
   * Optional custom Comlink endpoint (e.g., `MessageChannel.port2` in Vitest)
   * allowing deterministic tests without a browser `Worker` global.
   */
  readonly endpoint?: Comlink.Endpoint;
  readonly terminate?: () => void;
  readonly workerFactory?: () => Worker;
}

export interface ClientExportedDemoStdf {
  readonly presetId: DemoPresetId;
  readonly fileName: `${DemoPresetId}.stdf`;
  readonly bytes: Uint8Array;
}

export interface AutopsyWorkerClient {
  loadBuffer(
    buffer: ArrayBuffer,
    options?: ClientLoadBufferOptions,
  ): Promise<AutopsyWorkerResponse>;
  loadFile(
    file: File,
    options?: ClientLoadFileOptions,
  ): Promise<AutopsyWorkerResponse>;
  loadDemoLot(
    presetId: DemoPresetId,
    options?: ClientLoadDemoOptions,
  ): Promise<AutopsyWorkerResponse>;
  exportDemoStdf(
    presetId: DemoPresetId,
    seed?: number,
  ): Promise<ClientExportedDemoStdf>;
  renderDemoThumbnail?(
    presetId: DemoPresetId,
    cssSize: number,
    dpr: number,
    highContrast?: boolean,
  ): Promise<ImageBitmap | null>;
  resumeLargeFile(
    mode: ParseMode,
    onProgress?: WorkerProgressCallback,
  ): Promise<AutopsyWorkerResponse>;
  cancelLargeFile(): Promise<void>;
  listDemoPresets(): readonly DemoPresetMeta[];
  dispose(): void;
}

function defaultWorkerFactory(): Worker {
  return new Worker(new URL('./autopsy.worker.ts', import.meta.url), {
    type: 'module',
    name: 'chip-autopsy-worker',
  });
}

/**
 * Creates a typed Comlink client bound to a dedicated `autopsy.worker.ts` instance.
 */
export function createAutopsyWorkerClient(
  clientOptions: AutopsyWorkerClientOptions = {},
): AutopsyWorkerClient {
  let remote: Comlink.Remote<AutopsyWorkerApi> | null = null;
  let terminateFn: (() => void) | null = null;
  let disposed = false;
  let pendingClientLargeFile: {
    readonly file: File;
    readonly maxUncompressedBytes: number;
  } | null = null;

  const ensureRemote = (): Comlink.Remote<AutopsyWorkerApi> => {
    if (disposed) {
      throw new Error('AutopsyWorkerClient has been disposed.');
    }
    if (remote !== null) {
      return remote;
    }

    if (clientOptions.endpoint !== undefined) {
      remote = Comlink.wrap<AutopsyWorkerApi>(clientOptions.endpoint);
      terminateFn = clientOptions.terminate ?? null;
      return remote;
    }

    const createWorker = clientOptions.workerFactory ?? defaultWorkerFactory;
    const worker = createWorker();
    remote = Comlink.wrap<AutopsyWorkerApi>(worker);
    terminateFn = () => worker.terminate();
    return remote;
  };

  const proxyProgress = (
    onProgress: WorkerProgressCallback | undefined,
  ): (WorkerProgressCallback & Comlink.ProxyMarked) | undefined => {
    return onProgress !== undefined ? Comlink.proxy(onProgress) : undefined;
  };

  const sendBufferToWorker = async (
    buffer: ArrayBuffer,
    options: ClientLoadBufferOptions & {
      readonly retainOnLargePrompt?: boolean;
    } = {},
  ): Promise<AutopsyWorkerResponse> => {
    const workerRemote = ensureRemote();
    const request = {
      ...(options.mode !== undefined ? { mode: options.mode } : {}),
      ...(options.maxUncompressedBytes !== undefined
        ? { maxUncompressedBytes: options.maxUncompressedBytes }
        : {}),
      ...(options.fileName !== undefined ? { fileName: options.fileName } : {}),
      ...(options.retainOnLargePrompt !== undefined
        ? { retainOnLargePrompt: options.retainOnLargePrompt }
        : {}),
    };
    const transferredBuffer = Comlink.transfer(buffer, [buffer]);
    return workerRemote.loadBuffer(
      transferredBuffer,
      request,
      proxyProgress(options.onProgress),
    );
  };

  const loadBuffer = async (
    buffer: ArrayBuffer,
    options: ClientLoadBufferOptions = {},
  ): Promise<AutopsyWorkerResponse> => {
    pendingClientLargeFile = null;
    return sendBufferToWorker(buffer, options);
  };

  return {
    loadBuffer,

    async loadFile(
      file: File,
      options: ClientLoadFileOptions = {},
    ): Promise<AutopsyWorkerResponse> {
      pendingClientLargeFile = null;
      const maxUncompressedBytes =
        options.maxUncompressedBytes ?? DEFAULT_MAX_UNCOMPRESSED_BYTES;

      // Requirement 2.5: if uncompressed File.size > 200 MB and mode is unset,
      // peek magic bytes first so we can prompt before reading 200+ MB into memory.
      if (options.mode === undefined && file.size > maxUncompressedBytes) {
        const headerSlice = new Uint8Array(await file.slice(0, 2).arrayBuffer());
        if (!hasGzipMagicBytes(headerSlice)) {
          pendingClientLargeFile = { file, maxUncompressedBytes };
          return {
            kind: 'large-file-prompt',
            bytesObserved: file.size,
            maxUncompressedBytes,
            fileName: file.name,
          };
        }
      }

      // Note: Browser File.arrayBuffer() allocates an async ArrayBuffer that is
      // immediately detached via Comlink.transfer(buffer, [buffer]). Pass
      // retainOnLargePrompt: false so if a .gz stream exceeds maxUncompressedBytes,
      // the worker drops its buffer and only the OS-backed File Blob handle is kept here.
      const arrayBuffer = await file.arrayBuffer();
      const response = await sendBufferToWorker(arrayBuffer, {
        ...(options.mode !== undefined ? { mode: options.mode } : {}),
        maxUncompressedBytes,
        fileName: file.name,
        retainOnLargePrompt: false,
        ...(options.onProgress !== undefined
          ? { onProgress: options.onProgress }
          : {}),
      });

      if (response.kind === 'large-file-prompt') {
        pendingClientLargeFile = { file, maxUncompressedBytes };
      }

      return response;
    },

    async loadDemoLot(
      presetId: DemoPresetId,
      options: ClientLoadDemoOptions = {},
    ): Promise<AutopsyWorkerResponse> {
      pendingClientLargeFile = null;
      const workerRemote = ensureRemote();
      const request = {
        ...(options.seed !== undefined ? { seed: options.seed } : {}),
        ...(options.mode !== undefined ? { mode: options.mode } : {}),
        ...(options.maxUncompressedBytes !== undefined
          ? { maxUncompressedBytes: options.maxUncompressedBytes }
          : {}),
      };
      return workerRemote.loadDemoLot(
        presetId,
        request,
        proxyProgress(options.onProgress),
      );
    },

    async resumeLargeFile(
      mode: ParseMode,
      onProgress?: WorkerProgressCallback,
    ): Promise<AutopsyWorkerResponse> {
      if (pendingClientLargeFile !== null) {
        const { file, maxUncompressedBytes } = pendingClientLargeFile;
        pendingClientLargeFile = null;
        const arrayBuffer = await file.arrayBuffer();
        return sendBufferToWorker(arrayBuffer, {
          mode,
          maxUncompressedBytes,
          fileName: file.name,
          retainOnLargePrompt: false,
          ...(onProgress !== undefined ? { onProgress } : {}),
        });
      }

      const workerRemote = ensureRemote();
      return workerRemote.resumeLargeFileParse(mode, proxyProgress(onProgress));
    },

    async cancelLargeFile(): Promise<void> {
      pendingClientLargeFile = null;
      if (!disposed && remote !== null) {
        await remote.discardPendingLargeFile();
      }
    },

    async exportDemoStdf(
      presetId: DemoPresetId,
      seed?: number,
    ): Promise<ClientExportedDemoStdf> {
      const workerRemote = ensureRemote();
      const exported = await workerRemote.exportDemoStdf(presetId, seed);
      return {
        presetId: exported.presetId,
        fileName: exported.fileName,
        bytes: new Uint8Array(exported.buffer),
      };
    },

    async renderDemoThumbnail(
      presetId: DemoPresetId,
      cssSize: number,
      dpr: number,
      highContrast?: boolean,
    ): Promise<ImageBitmap | null> {
      const workerRemote = ensureRemote();
      return workerRemote.renderDemoThumbnail(
        presetId,
        cssSize,
        dpr,
        highContrast,
      );
    },

    listDemoPresets(): readonly DemoPresetMeta[] {
      return listDemoPresets();
    },

    dispose(): void {
      if (disposed) {
        return;
      }
      disposed = true;
      pendingClientLargeFile = null;
      if (remote !== null) {
        try {
          remote[Comlink.releaseProxy]();
        } catch {
          // Ignore release errors when worker endpoint is already closed.
        }
        remote = null;
      }
      if (terminateFn !== null) {
        terminateFn();
        terminateFn = null;
      }
    },
  };
}
