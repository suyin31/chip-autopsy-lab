'use client';

import * as React from 'react';
import {
  type DemoPresetId,
  getDemoPresetMeta,
  listDemoPresets,
} from '@/core/demo';
import type { ParseFatalError, ParseMode } from '@/core/stdf';
import { formatByteSize, formatGroupedInt, formatYieldPct } from '@/ui/format';
import { useT } from '@/ui/i18n';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  ClinicalToaster,
  cn,
} from '@/ui/primitives';
import {
  type AutopsyWorkerClient,
  type AutopsyWorkerLoadedPayload,
  type AutopsyWorkerResponse,
  createAutopsyWorkerClient,
  type WorkerParseProgress,
} from '@/workers';
import { EmptyStateCard } from './EmptyStateCard';
import { FullWindowDropZone } from './FullWindowDropZone';
import { IngestProgressPanel } from './IngestProgressPanel';
import {
  notifyDemoStdfDownload,
  notifyParseWarnings,
  triggerBrowserBlobDownload,
} from './ingest-helpers';
import { LoadedLotOverview } from './LoadedLotOverview';
import type { RecentLotEntry } from './LotPicker';
import { type ActiveNavLotInfo, NavBar } from './NavBar';

type WorkspaceState =
  | { readonly status: 'empty' }
  | {
      readonly status: 'loading';
      readonly label: string;
      readonly progress: WorkerParseProgress;
    }
  | {
      readonly status: 'large-file-prompt';
      readonly bytesObserved: number;
      readonly maxUncompressedBytes: number;
      readonly fileName?: string;
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

type ActiveLotOrigin =
  | { readonly kind: 'preset'; readonly presetId: DemoPresetId }
  | {
      readonly kind: 'file';
      readonly recentId: string;
      readonly fileName: string;
      readonly byteSize: number;
    };

interface CachedRecentLot {
  readonly entry: RecentLotEntry;
  readonly payload: AutopsyWorkerLoadedPayload;
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
 * `IngestProgressPanel`, and `LoadedLotOverview` to `createAutopsyWorkerClient`.
 *
 * Validates: Requirements 1.1, 1.2, 1.4, 1.10, 2.2, 2.5, 3.2, 3.3, 14.4, 17.1–17.6 & redesign §4.1, §4.2
 */
export function AppShell({ createClient }: AppShellProps): React.JSX.Element {
  const { t } = useT();
  const presets = React.useMemo(() => listDemoPresets(), []);
  const [selectedPresetId, setSelectedPresetId] =
    React.useState<DemoPresetId>('edge-ring-etch');
  const [workspace, setWorkspace] = React.useState<WorkspaceState>({
    status: 'empty',
  });
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
        const origin = pendingOriginRef.current;
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
            { entry, payload: response },
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

        setWorkspace({ status: 'ready', payload: response });
        if (response.lot.warnings.length > 0) {
          notifyParseWarnings(response.lot.warnings);
        }
        setLiveAnnouncement(
          `${response.report.causeOfDeathHeadline.text} Loaded lot ${response.lot.lotId}: ${formatGroupedInt(response.lot.dies.count)} dies across ${formatGroupedInt(response.lot.wafers.length)} wafers, final yield ${formatYieldPct(response.yieldSummary.overall.finalYield)}.`,
        );
        return;
      }

      if (response.kind === 'large-file-prompt') {
        setWorkspace({
          status: 'large-file-prompt',
          bytesObserved: response.bytesObserved,
          maxUncompressedBytes: response.maxUncompressedBytes,
          ...(response.fileName !== undefined
            ? { fileName: response.fileName }
            : {}),
        });
        setLiveAnnouncement(
          `Input exceeds ${formatByteSize(response.maxUncompressedBytes)}. Choose Bins-Only Mode or Full Mode.`,
        );
        return;
      }

      setWorkspace({
        status: 'parse-failed',
        error: response.error,
        ...(response.fileName !== undefined
          ? { fileName: response.fileName }
          : {}),
      });
      setLiveAnnouncement(`STDF parse failed: ${response.error.message}`);
    },
    [],
  );

  const handleUnexpectedWorkerError = React.useCallback(
    (requestId: number, err: unknown, fileName?: string): void => {
      if (requestId !== activeRequestIdRef.current) {
        return;
      }
      const detail = err instanceof Error ? err.message : String(err);
      const fallbackError: ParseFatalError = {
        code: 'MISSING_FAR_HEADER',
        message: `Worker execution error: ${detail}`,
      };
      setWorkspace({
        status: 'parse-failed',
        error: fallbackError,
        ...(fileName !== undefined ? { fileName } : {}),
      });
      setLiveAnnouncement(`Worker error: ${detail}`);
    },
    [],
  );

  const handleLoadDemoLot = React.useCallback(
    (presetId: DemoPresetId): void => {
      const preset = getDemoPresetMeta(presetId);
      setSelectedPresetId(presetId);
      pendingOriginRef.current = { kind: 'preset', presetId };

      const requestId = activeRequestIdRef.current + 1;
      activeRequestIdRef.current = requestId;
      const label = `Synthetic Demo · ${preset.title}`;

      setWorkspace({
        status: 'loading',
        label,
        progress: { ...INITIAL_PROGRESS, phase: 'generating-demo' },
      });
      setLiveAnnouncement(`Loading demo lot ${preset.title}.`);

      const client = getWorkerClient();
      void client
        .loadDemoLot(presetId, {
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
    [applyWorkerResponse, getWorkerClient, handleUnexpectedWorkerError],
  );

  const handleLoadFile = React.useCallback(
    (file: File): void => {
      const recentId = `file:${file.name}:${file.size}:${file.lastModified}`;
      pendingOriginRef.current = {
        kind: 'file',
        recentId,
        fileName: file.name,
        byteSize: file.size,
      };

      const requestId = activeRequestIdRef.current + 1;
      activeRequestIdRef.current = requestId;
      const label = `Local STDF · ${file.name}`;

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
    [applyWorkerResponse, getWorkerClient, handleUnexpectedWorkerError],
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

  const handleNavigateHome = React.useCallback((): void => {
    activeRequestIdRef.current += 1;
    if (workspace.status === 'large-file-prompt' && clientRef.current !== null) {
      void clientRef.current.cancelLargeFile();
    }
    setWorkspace({ status: 'empty' });
  }, [workspace.status]);

  const handleSelectRecentLot = React.useCallback(
    (recentId: string): void => {
      const matched = cachedRecents.find((item) => item.entry.id === recentId);
      if (!matched) {
        return;
      }
      activeRequestIdRef.current += 1;
      setActiveNavLot({
        lotId: matched.entry.lotId,
        presetId: null,
        recentId: matched.entry.id,
        customTitle: matched.entry.fileName,
      });
      setWorkspace({ status: 'ready', payload: matched.payload });
    },
    [cachedRecents],
  );

  const handleResumeLargeFile = React.useCallback(
    (mode: ParseMode, fileName?: string): void => {
      const requestId = activeRequestIdRef.current + 1;
      activeRequestIdRef.current = requestId;
      const label = fileName
        ? `Local STDF · ${fileName} (${mode === 'bins-only' ? 'Bins-Only' : 'Full'})`
        : `Large STDF Stream (${mode === 'bins-only' ? 'Bins-Only' : 'Full'})`;

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

  const handleDownloadDemoLot = React.useCallback(
    (presetId: DemoPresetId): void => {
      setDownloadingPresetId(presetId);
      const client = getWorkerClient();
      void client
        .exportDemoStdf(presetId)
        .then((exported) => {
          triggerBrowserBlobDownload(exported.bytes, exported.fileName);
          notifyDemoStdfDownload(exported.fileName, exported.bytes.byteLength);
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
    [getWorkerClient],
  );

  const recentLotEntries = React.useMemo(
    () => cachedRecents.map((item) => item.entry),
    [cachedRecents],
  );

  return (
    <FullWindowDropZone disabled={isLoading} onFileDrop={handleLoadFile}>
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
        onSelectDemoPreset={handleLoadDemoLot}
        onSelectRecentLot={handleSelectRecentLot}
        onOpenFilePicker={handleOpenFilePicker}
        disabled={isLoading}
      />

      <main
        className={cn(
          'mx-auto flex w-full flex-col px-4 py-4 md:px-10 md:py-6',
          workspace.status === 'ready' ? 'max-w-[1440px]' : 'max-w-6xl',
        )}
      >
        <section aria-label="Autopsy Report Workspace" className="flex-1">
          {workspace.status === 'empty' ? (
            <EmptyStateCard
              cause="first-run"
              presets={presets}
              selectedPresetId={selectedPresetId}
              onSelectPreset={setSelectedPresetId}
              onLoadDemoLot={handleLoadDemoLot}
              onDownloadDemoLot={handleDownloadDemoLot}
              downloadingPresetId={downloadingPresetId}
              onSelectFile={handleLoadFile}
            />
          ) : null}

          {workspace.status === 'parse-failed' ? (
            <EmptyStateCard
              cause="parse-failed"
              presets={presets}
              selectedPresetId={selectedPresetId}
              onSelectPreset={setSelectedPresetId}
              onLoadDemoLot={handleLoadDemoLot}
              onDownloadDemoLot={handleDownloadDemoLot}
              downloadingPresetId={downloadingPresetId}
              onSelectFile={handleLoadFile}
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

          {workspace.status === 'large-file-prompt' ? (
            <Card aria-label="Large STDF File Mode Prompt">
              <CardHeader className="border-b border-hairline pb-5">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-[12px] tracking-wider text-text-tertiary uppercase">
                    Autopsy Report · Large Stream Guard
                  </span>
                  <Badge variant="accent">
                    &gt; {formatByteSize(workspace.maxUncompressedBytes)}
                  </Badge>
                </div>
                <CardTitle className="mt-1 text-[20px]">
                  Uncompressed STDF stream exceeds 200 MB.
                </CardTitle>
                <CardDescription>
                  {workspace.fileName
                    ? `${workspace.fileName} (${formatByteSize(workspace.bytesObserved)} observed). `
                    : `Observed ${formatByteSize(workspace.bytesObserved)}. `}
                  Bins-Only Mode skips PTR, MPR, and FTR records to cap memory
                  while preserving wafer, bin, yield, and pattern analysis.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-wrap items-center gap-3 pt-6">
                <Button
                  variant="primary"
                  size="lg"
                  onClick={() =>
                    handleResumeLargeFile('bins-only', workspace.fileName)
                  }
                >
                  Continue in Bins-Only Mode
                </Button>
                <Button
                  variant="secondary"
                  size="lg"
                  onClick={() =>
                    handleResumeLargeFile('full', workspace.fileName)
                  }
                >
                  Parse Full Mode
                </Button>
                <Button
                  variant="ghost"
                  size="lg"
                  onClick={() => {
                    activeRequestIdRef.current += 1;
                    if (clientRef.current !== null) {
                      void clientRef.current.cancelLargeFile();
                    }
                    setWorkspace({ status: 'empty' });
                  }}
                >
                  Cancel
                </Button>
              </CardContent>
            </Card>
          ) : null}

          {workspace.status === 'ready' ? (
            <LoadedLotOverview
              data={workspace.payload}
              presets={presets}
              selectedPresetId={selectedPresetId}
              onSelectPreset={setSelectedPresetId}
              onLoadDemoLot={handleLoadDemoLot}
              onDownloadDemoLot={handleDownloadDemoLot}
              downloadingPresetId={downloadingPresetId}
              onSelectFile={handleLoadFile}
            />
          ) : null}
        </section>
      </main>
    </FullWindowDropZone>
  );
}
