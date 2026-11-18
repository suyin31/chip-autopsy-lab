'use client';

import * as React from 'react';
import { toast } from 'sonner';
import {
  type DemoPresetId,
  getDemoPresetMeta,
  listDemoPresets,
} from '@/core/demo';
import type { ParseFatalError, ParseMode } from '@/core/stdf';
import { formatByteSize, formatGroupedInt, formatYieldPct } from '@/ui/format';
import { useT } from '@/ui/i18n';
import { ClinicalToaster, cn } from '@/ui/primitives';
import {
  type AutopsyWorkerClient,
  type AutopsyWorkerLoadedPayload,
  type AutopsyWorkerResponse,
  createAutopsyWorkerClient,
  type WorkerParseProgress,
} from '@/workers';
import { BinsOnlySheet } from './BinsOnlySheet';
import { EmptyStateCard } from './EmptyStateCard';
import { ErrorDetailsSheet } from './ErrorDetailsSheet';
import { FullWindowDropZone } from './FullWindowDropZone';
import { IngestProgressPanel } from './IngestProgressPanel';
import {
  notifyParseWarnings,
  triggerBrowserBlobDownload,
} from './ingest-helpers';
import { LoadedLotOverview } from './LoadedLotOverview';
import type { RecentLotEntry } from './LotPicker';
import { type ActiveNavLotInfo, NavBar } from './NavBar';
import { resolveTruncatedWarningToastModel } from './parse-error-copy';

type BaseViewState =
  | { readonly status: 'empty' }
  | {
      readonly status: 'loading';
      readonly label: string;
      readonly progress: WorkerParseProgress;
    }
  | {
      readonly status: 'parse-failed';
      readonly error: ParseFatalError;
      readonly fileName?: string;
    }
  | {
      readonly status: 'ready';
      readonly payload: AutopsyWorkerLoadedPayload;
    };

interface PendingLargeFileState {
  readonly bytesObserved: number;
  readonly maxUncompressedBytes: number;
  readonly fileName?: string;
}

interface TruncatedDetailsModalState {
  readonly byteOffset: number;
  readonly first16BytesHex: string;
  readonly fileName?: string;
}

type ActiveLotOrigin =
  | { readonly kind: 'preset'; readonly presetId: DemoPresetId }
  | {
      readonly kind: 'file';
      readonly recentId: string;
      readonly fileName: string;
      readonly byteSize: number;
      readonly file?: File;
    };

interface CachedRecentLot {
  readonly entry: RecentLotEntry;
  readonly payload: AutopsyWorkerLoadedPayload;
  readonly file?: File;
}

export interface AppShellProps {
  /** Optional injected worker client factory for deterministic testing. */
  readonly createClient?: () => AutopsyWorkerClient;
}

const MAX_RECENT_LOTS = 3 as const;

const INITIAL_PROGRESS: WorkerParseProgress = {
  phase: 'parsing',
  bytesProcessed: 0,
  totalBytes: null,
  recordsDecoded: 0,
  diesResolved: 0,
};

/**
 * Primary client workbench shell wiring `NavBar`, `FullWindowDropZone`, `EmptyStateCard`,
 * `BinsOnlySheet`, `ErrorDetailsSheet`, `IngestProgressPanel`, and `LoadedLotOverview`
 * to `createAutopsyWorkerClient`.
 *
 * Validates: Requirements 1.1, 1.2, 1.4, 1.10, 2.2, 2.5, 3.2, 3.3, 14.4, 17.1–17.6 & redesign §3.1, §3.2, §3.7, §3.8
 */
export function AppShell({ createClient }: AppShellProps): React.JSX.Element {
  const { locale, t, formatInteger } = useT();
  const presets = React.useMemo(() => listDemoPresets(), []);
  const [selectedPresetId, setSelectedPresetId] =
    React.useState<DemoPresetId>('edge-ring-etch');
  const [workspace, setWorkspace] = React.useState<BaseViewState>({
    status: 'empty',
  });
  const [largeFilePrompt, setLargeFilePrompt] =
    React.useState<PendingLargeFileState | null>(null);
  const [truncatedDetails, setTruncatedDetails] =
    React.useState<TruncatedDetailsModalState | null>(null);
  const [activeNavLot, setActiveNavLot] =
    React.useState<ActiveNavLotInfo | null>(null);
  const [cachedRecents, setCachedRecents] = React.useState<
    readonly CachedRecentLot[]
  >([]);
  const [downloadingPresetId, setDownloadingPresetId] =
    React.useState<DemoPresetId | null>(null);
  const [liveAnnouncement, setLiveAnnouncement] = React.useState('');

  const navFileInputRef = React.useRef<HTMLInputElement | null>(null);
  const clientRef = React.useRef<AutopsyWorkerClient | null>(null);
  const activeRequestIdRef = React.useRef(0);
  const pendingOriginRef = React.useRef<ActiveLotOrigin | null>(null);
  const activeLoadedOriginRef = React.useRef<ActiveLotOrigin | null>(null);
  const previousStableViewRef = React.useRef<BaseViewState>({ status: 'empty' });

  const isLoading = workspace.status === 'loading';

  const getWorkerClient = React.useCallback((): AutopsyWorkerClient => {
    if (clientRef.current === null) {
      clientRef.current = createClient
        ? createClient()
        : createAutopsyWorkerClient();
    }
    return clientRef.current;
  }, [createClient]);

  React.useEffect(() => {
    return () => {
      activeRequestIdRef.current += 1;
      if (clientRef.current !== null) {
        clientRef.current.dispose();
        clientRef.current = null;
      }
    };
  }, []);

  const handleRenderWorkerThumbnail = React.useCallback(
    async (
      presetId: DemoPresetId,
      cssSize: number,
      dpr: number,
    ): Promise<ImageBitmap | null> => {
      const client = getWorkerClient();
      if (!client.renderDemoThumbnail) {
        return null;
      }
      return client.renderDemoThumbnail(presetId, cssSize, dpr);
    },
    [getWorkerClient],
  );

  const handleOpenFilePicker = React.useCallback((): void => {
    if (!isLoading) {
      navFileInputRef.current?.click();
    }
  }, [isLoading]);

  React.useEffect(() => {
    const handleGlobalKeyDown = (event: KeyboardEvent): void => {
      if (isLoading) {
        return;
      }
      if (
        (event.metaKey || event.ctrlKey) &&
        !event.shiftKey &&
        !event.altKey &&
        event.key.toLowerCase() === 'o'
      ) {
        event.preventDefault();
        navFileInputRef.current?.click();
      }
    };
    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, [isLoading]);

  const applyWorkerResponse = React.useCallback(
    (requestId: number, response: AutopsyWorkerResponse): void => {
      if (requestId !== activeRequestIdRef.current) {
        return;
      }

      if (response.kind === 'ok') {
        setLargeFilePrompt(null);
        const origin = pendingOriginRef.current;
        activeLoadedOriginRef.current = origin;

        if (origin?.kind === 'file') {
          const entry: RecentLotEntry = {
            id: origin.recentId,
            fileName: origin.fileName,
            byteSize:
              origin.byteSize > 0
                ? origin.byteSize
                : response.uncompressedByteLength,
            lotId: response.lot.lotId,
          };
          setCachedRecents((prev) => [
            {
              entry,
              payload: response,
              ...(origin.file !== undefined ? { file: origin.file } : {}),
            },
            ...prev
              .filter((item) => item.entry.id !== entry.id)
              .slice(0, MAX_RECENT_LOTS - 1),
          ]);
          setActiveNavLot({
            lotId: response.lot.lotId,
            presetId: null,
            recentId: entry.id,
            customTitle: entry.fileName,
          });
        } else {
          const presetId =
            origin?.kind === 'preset' ? origin.presetId : 'edge-ring-etch';
          setActiveNavLot({
            lotId: response.lot.lotId,
            presetId,
            recentId: null,
          });
        }

        const readyState: BaseViewState = { status: 'ready', payload: response };
        previousStableViewRef.current = readyState;
        setWorkspace(readyState);

        // §3.7: Truncated stream with >= 1 complete wafer opens loaded view + persistent toast with "Show details"
        const truncToastModel = resolveTruncatedWarningToastModel(
          response.lot.warnings,
          locale,
        );
        if (truncToastModel) {
          const fileName =
            origin?.kind === 'file' ? origin.fileName : undefined;
          toast.warning(truncToastModel.title, {
            id: truncToastModel.id,
            description: truncToastModel.body,
            duration: Number.POSITIVE_INFINITY,
            action: {
              label: t('error.showDetails'),
              onClick: () => {
                setTruncatedDetails({
                  byteOffset: truncToastModel.byteOffset,
                  first16BytesHex: truncToastModel.first16BytesHex,
                  ...(fileName !== undefined ? { fileName } : {}),
                });
              },
            },
          });
        }

        const otherWarnings = response.lot.warnings.filter(
          (w) => w.code !== 'TRUNCATED_TAIL_RECORD',
        );
        if (otherWarnings.length > 0) {
          notifyParseWarnings(otherWarnings);
        }
        if (response.skippedRecordCount > 0) {
          toast.message(
            t('toast.skippedRecords', {
              count: formatInteger(response.skippedRecordCount),
            }),
            { id: `skipped-records-${response.lot.lotId}` },
          );
        }
        if (response.lot.parseMode === 'bins-only') {
          toast.message(t('toast.binsOnly'), {
            id: `bins-only-${response.lot.lotId}`,
          });
        }

        setLiveAnnouncement(
          `${response.report.causeOfDeathHeadline.text} Loaded lot ${response.lot.lotId}: ${formatGroupedInt(response.lot.dies.count)} dies across ${formatGroupedInt(response.lot.wafers.length)} wafers, final yield ${formatYieldPct(response.yieldSummary.overall.finalYield)}.`,
        );
        return;
      }

      if (response.kind === 'large-file-prompt') {
        // Restore underlying non-loading view so BinsOnlySheet scrim blurs the page cleanly (§3.8)
        setWorkspace(previousStableViewRef.current);
        setLargeFilePrompt({
          bytesObserved: response.bytesObserved,
          maxUncompressedBytes: response.maxUncompressedBytes,
          ...(response.fileName !== undefined
            ? { fileName: response.fileName }
            : {}),
        });
        setLiveAnnouncement(
          t('binsOnly.sheetTitle', {
            size: formatByteSize(response.bytesObserved),
          }),
        );
        return;
      }

      setLargeFilePrompt(null);
      const failedState: BaseViewState = {
        status: 'parse-failed',
        error: response.error,
        ...(response.fileName !== undefined
          ? { fileName: response.fileName }
          : {}),
      };
      previousStableViewRef.current = failedState;
      setWorkspace(failedState);
      setLiveAnnouncement(`STDF parse failed: ${response.error.message}`);
    },
    [formatInteger, locale, t],
  );

  const handleUnexpectedWorkerError = React.useCallback(
    (requestId: number, err: unknown, fileName?: string): void => {
      if (requestId !== activeRequestIdRef.current) {
        return;
      }
      setLargeFilePrompt(null);
      const detail = err instanceof Error ? err.message : String(err);
      const fallbackError: ParseFatalError = {
        code: 'MISSING_FAR_HEADER',
        message: `Worker execution error: ${detail}`,
      };
      const failedState: BaseViewState = {
        status: 'parse-failed',
        error: fallbackError,
        ...(fileName !== undefined ? { fileName } : {}),
      };
      previousStableViewRef.current = failedState;
      setWorkspace(failedState);
      setLiveAnnouncement(`Worker error: ${detail}`);
    },
    [],
  );

  const handleLoadDemoLot = React.useCallback(
    (presetId: DemoPresetId, mode?: ParseMode): void => {
      const preset = getDemoPresetMeta(presetId);
      setSelectedPresetId(presetId);
      if (largeFilePrompt !== null && clientRef.current !== null) {
        void clientRef.current.cancelLargeFile();
      }
      setLargeFilePrompt(null);
      pendingOriginRef.current = { kind: 'preset', presetId };

      const requestId = activeRequestIdRef.current + 1;
      activeRequestIdRef.current = requestId;
      const label = preset.title;

      setWorkspace({
        status: 'loading',
        label,
        progress: { ...INITIAL_PROGRESS, phase: 'generating-demo' },
      });
      setLiveAnnouncement(`Loading demo lot ${preset.title}.`);

      const client = getWorkerClient();
      void client
        .loadDemoLot(presetId, {
          ...(mode !== undefined ? { mode } : {}),
          onProgress: (progress) => {
            if (requestId !== activeRequestIdRef.current) {
              return;
            }
            setWorkspace({
              status: 'loading',
              label,
              progress: {
                phase: progress.phase,
                bytesProcessed: progress.bytesProcessed,
                totalBytes: progress.totalBytes,
                recordsDecoded: progress.recordsDecoded,
                diesResolved: progress.diesResolved,
              },
            });
          },
        })
        .then((response) => applyWorkerResponse(requestId, response))
        .catch((err: unknown) => handleUnexpectedWorkerError(requestId, err));
    },
    [
      applyWorkerResponse,
      getWorkerClient,
      handleUnexpectedWorkerError,
      largeFilePrompt,
    ],
  );

  const handleLoadFile = React.useCallback(
    (file: File, explicitMode?: ParseMode): void => {
      const recentId = `file:${file.name}:${file.size}:${file.lastModified}`;
      pendingOriginRef.current = {
        kind: 'file',
        recentId,
        fileName: file.name,
        byteSize: file.size,
        file,
      };
      if (largeFilePrompt !== null && clientRef.current !== null) {
        void clientRef.current.cancelLargeFile();
      }
      setLargeFilePrompt(null);

      const requestId = activeRequestIdRef.current + 1;
      activeRequestIdRef.current = requestId;
      const label = file.name;

      setWorkspace({
        status: 'loading',
        label,
        progress: {
          ...INITIAL_PROGRESS,
          totalBytes: file.size > 0 ? file.size : null,
        },
      });
      setLiveAnnouncement(`Parsing STDF file ${file.name}.`);

      const client = getWorkerClient();
      void client
        .loadFile(file, {
          ...(explicitMode !== undefined ? { mode: explicitMode } : {}),
          onProgress: (progress) => {
            if (requestId !== activeRequestIdRef.current) {
              return;
            }
            setWorkspace({
              status: 'loading',
              label,
              progress: {
                phase: progress.phase,
                bytesProcessed: progress.bytesProcessed,
                totalBytes: progress.totalBytes,
                recordsDecoded: progress.recordsDecoded,
                diesResolved: progress.diesResolved,
              },
            });
          },
        })
        .then((response) => applyWorkerResponse(requestId, response))
        .catch((err: unknown) =>
          handleUnexpectedWorkerError(requestId, err, file.name),
        );
    },
    [
      applyWorkerResponse,
      getWorkerClient,
      handleUnexpectedWorkerError,
      largeFilePrompt,
    ],
  );

  const handleNavFileInputChange = React.useCallback(
    (event: React.ChangeEvent<HTMLInputElement>): void => {
      const file = event.target.files?.[0];
      event.target.value = '';
      if (file) {
        handleLoadFile(file);
      }
    },
    [handleLoadFile],
  );

  const handleCancelLargeFile = React.useCallback((): void => {
    activeRequestIdRef.current += 1;
    setLargeFilePrompt(null);
    if (clientRef.current !== null) {
      void clientRef.current.cancelLargeFile();
    }
  }, []);

  const handleNavigateHome = React.useCallback((): void => {
    activeRequestIdRef.current += 1;
    if (largeFilePrompt !== null && clientRef.current !== null) {
      void clientRef.current.cancelLargeFile();
    }
    setLargeFilePrompt(null);
    const emptyState: BaseViewState = { status: 'empty' };
    previousStableViewRef.current = emptyState;
    setWorkspace(emptyState);
  }, [largeFilePrompt]);

  const handleSelectRecentLot = React.useCallback(
    (recentId: string): void => {
      const matched = cachedRecents.find((item) => item.entry.id === recentId);
      if (!matched) {
        return;
      }
      activeRequestIdRef.current += 1;
      setLargeFilePrompt(null);
      activeLoadedOriginRef.current = {
        kind: 'file',
        recentId: matched.entry.id,
        fileName: matched.entry.fileName,
        byteSize: matched.entry.byteSize,
        ...(matched.file !== undefined ? { file: matched.file } : {}),
      };
      setActiveNavLot({
        lotId: matched.entry.lotId,
        presetId: null,
        recentId: matched.entry.id,
        customTitle: matched.entry.fileName,
      });
      const readyState: BaseViewState = {
        status: 'ready',
        payload: matched.payload,
      };
      previousStableViewRef.current = readyState;
      setWorkspace(readyState);
    },
    [cachedRecents],
  );

  const handleResumeLargeFile = React.useCallback(
    (mode: ParseMode, fileName?: string): void => {
      setLargeFilePrompt(null);
      const requestId = activeRequestIdRef.current + 1;
      activeRequestIdRef.current = requestId;
      const label = fileName ?? 'large.stdf';

      setWorkspace({
        status: 'loading',
        label,
        progress: INITIAL_PROGRESS,
      });

      const client = getWorkerClient();
      void client
        .resumeLargeFile(mode, (progress) => {
          if (requestId !== activeRequestIdRef.current) {
            return;
          }
          setWorkspace({
            status: 'loading',
            label,
            progress: {
              phase: progress.phase,
              bytesProcessed: progress.bytesProcessed,
              totalBytes: progress.totalBytes,
              recordsDecoded: progress.recordsDecoded,
              diesResolved: progress.diesResolved,
            },
          });
        })
        .then((response) => applyWorkerResponse(requestId, response))
        .catch((err: unknown) =>
          handleUnexpectedWorkerError(requestId, err, fileName),
        );
    },
    [applyWorkerResponse, getWorkerClient, handleUnexpectedWorkerError],
  );

  const handleParseEverythingFromNotice = React.useCallback((): void => {
    const origin = activeLoadedOriginRef.current;
    if (origin?.kind === 'file' && origin.file) {
      handleLoadFile(origin.file, 'full');
      return;
    }
    if (origin?.kind === 'preset') {
      handleLoadDemoLot(origin.presetId, 'full');
    }
  }, [handleLoadDemoLot, handleLoadFile]);

  const handleDownloadDemoLot = React.useCallback(
    (presetId: DemoPresetId): void => {
      setDownloadingPresetId(presetId);
      const client = getWorkerClient();
      void client
        .exportDemoStdf(presetId)
        .then((exported) => {
          triggerBrowserBlobDownload(exported.bytes, exported.fileName);
          toast.message(t('toast.downloaded', { fileName: exported.fileName }), {
            id: `demo-download-${exported.fileName}`,
            description: formatByteSize(exported.bytes.byteLength),
          });
          setLiveAnnouncement(
            `Downloaded ${exported.fileName} (${formatByteSize(exported.bytes.byteLength)}).`,
          );
        })
        .catch((err: unknown) => {
          const detail = err instanceof Error ? err.message : String(err);
          setLiveAnnouncement(`Demo export failed: ${detail}`);
        })
        .finally(() => {
          setDownloadingPresetId((prev) => (prev === presetId ? null : prev));
        });
    },
    [getWorkerClient, t],
  );

  const recentLotEntries = React.useMemo(
    () => cachedRecents.map((item) => item.entry),
    [cachedRecents],
  );

  const isLandingOrError =
    workspace.status === 'empty' || workspace.status === 'parse-failed';

  return (
    <FullWindowDropZone
      disabled={isLoading}
      onFileDrop={(file) => handleLoadFile(file)}
    >
      <ClinicalToaster />
      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {liveAnnouncement}
      </div>
      <input
        ref={navFileInputRef}
        id="cal-nav-file-picker"
        tabIndex={-1}
        type="file"
        accept=".stdf,.std,.stdf.gz,.gz,application/gzip,application/octet-stream"
        onChange={handleNavFileInputChange}
        disabled={isLoading}
        className="sr-only"
        aria-label={t('nav.openStdfAria')}
      />

      <NavBar
        activeLot={workspace.status === 'ready' ? activeNavLot : null}
        recentLots={recentLotEntries}
        onNavigateHome={handleNavigateHome}
        onSelectDemoPreset={(presetId) => handleLoadDemoLot(presetId)}
        onSelectRecentLot={handleSelectRecentLot}
        onOpenFilePicker={handleOpenFilePicker}
        disabled={isLoading}
      />

      <main
        className={cn(
          'mx-auto flex w-full max-w-[1440px] flex-col px-4 md:px-10',
          isLandingOrError
            ? 'pt-0'
            : workspace.status === 'ready'
              ? 'pt-5 pb-12 xl:h-[calc(100dvh-52px)] xl:min-h-[768px] xl:overflow-hidden xl:py-6'
              : 'py-4 md:py-6',
        )}
      >
        <section
          aria-label="Autopsy Report Workspace"
          className={cn(
            'flex-1',
            workspace.status === 'ready' && 'xl:min-h-0',
          )}
        >
          {workspace.status === 'empty' ? (
            <EmptyStateCard
              cause="first-run"
              presets={presets}
              selectedPresetId={selectedPresetId}
              onSelectPreset={setSelectedPresetId}
              onLoadDemoLot={(presetId) => handleLoadDemoLot(presetId)}
              onDownloadDemoLot={handleDownloadDemoLot}
              downloadingPresetId={downloadingPresetId}
              onSelectFile={(file) => handleLoadFile(file)}
              renderWorkerThumbnail={handleRenderWorkerThumbnail}
            />
          ) : null}

          {workspace.status === 'parse-failed' ? (
            <EmptyStateCard
              cause="parse-failed"
              presets={presets}
              selectedPresetId={selectedPresetId}
              onSelectPreset={setSelectedPresetId}
              onLoadDemoLot={(presetId) => handleLoadDemoLot(presetId)}
              onDownloadDemoLot={handleDownloadDemoLot}
              downloadingPresetId={downloadingPresetId}
              onSelectFile={(file) => handleLoadFile(file)}
              renderWorkerThumbnail={handleRenderWorkerThumbnail}
              parseError={{
                error: workspace.error,
                ...(workspace.fileName !== undefined
                  ? { fileName: workspace.fileName }
                  : {}),
              }}
            />
          ) : null}

          {workspace.status === 'loading' ? (
            <IngestProgressPanel
              label={workspace.label}
              progress={workspace.progress}
            />
          ) : null}

          {workspace.status === 'ready' ? (
            <LoadedLotOverview
              data={workspace.payload}
              presets={presets}
              selectedPresetId={selectedPresetId}
              onSelectPreset={setSelectedPresetId}
              onLoadDemoLot={(presetId) => handleLoadDemoLot(presetId)}
              onDownloadDemoLot={handleDownloadDemoLot}
              downloadingPresetId={downloadingPresetId}
              onSelectFile={(file) => handleLoadFile(file)}
              onParseEverything={handleParseEverythingFromNotice}
            />
          ) : null}
        </section>
      </main>

      {/* §3.8 Pre-parse Bins-Only Sheet (> 200 MB) */}
      <BinsOnlySheet
        open={largeFilePrompt !== null}
        bytesObserved={largeFilePrompt?.bytesObserved ?? 0}
        onUseBinsOnly={() =>
          handleResumeLargeFile('bins-only', largeFilePrompt?.fileName)
        }
        onParseEverything={() =>
          handleResumeLargeFile('full', largeFilePrompt?.fileName)
        }
        onCancel={handleCancelLargeFile}
      />

      {/* §3.7 Truncated partial-load toast "Show details" sheet */}
      <ErrorDetailsSheet
        open={truncatedDetails !== null}
        onClose={() => setTruncatedDetails(null)}
        byteOffset={truncatedDetails?.byteOffset ?? 0}
        first16BytesHex={truncatedDetails?.first16BytesHex ?? ''}
        {...(truncatedDetails?.fileName !== undefined
          ? { fileName: truncatedDetails.fileName }
          : {})}
      />
    </FullWindowDropZone>
  );
}
