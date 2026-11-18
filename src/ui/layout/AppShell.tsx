'use client';

import * as React from 'react';
import {
  type DemoPresetId,
  getDemoPresetMeta,
  listDemoPresets,
} from '@/core/demo';
import type { ParseFatalError, ParseMode } from '@/core/stdf';
import { formatByteSize, formatGroupedInt, formatYieldPct } from '@/ui/format';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
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
import { LoadedLotOverview } from './LoadedLotOverview';

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

export interface AppShellProps {
  /** Optional injected worker client factory for deterministic testing. */
  readonly createClient?: () => AutopsyWorkerClient;
}

const INITIAL_PROGRESS: WorkerParseProgress = {
  phase: 'parsing',
  bytesProcessed: 0,
  totalBytes: null,
  recordsDecoded: 0,
  diesResolved: 0,
};

/**
 * Primary client workbench shell wiring `FullWindowDropZone`, `EmptyStateCard`,
 * `IngestProgressPanel`, and `LoadedLotOverview` to `createAutopsyWorkerClient`.
 *
 * Validates: Requirements 1.1, 1.2, 1.4, 1.10, 2.2, 2.5, 3.2, 3.3, 14.4, 17.1–17.6
 */
export function AppShell({ createClient }: AppShellProps = {}): React.JSX.Element {
  const presets = React.useMemo(() => listDemoPresets(), []);
  const [selectedPresetId, setSelectedPresetId] =
    React.useState<DemoPresetId>('edge-ring-etch');
  const [workspace, setWorkspace] = React.useState<WorkspaceState>({
    status: 'empty',
  });
  const [liveAnnouncement, setLiveAnnouncement] = React.useState('');

  const clientRef = React.useRef<AutopsyWorkerClient | null>(null);
  const activeRequestIdRef = React.useRef(0);

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

  const applyWorkerResponse = React.useCallback(
    (requestId: number, response: AutopsyWorkerResponse): void => {
      if (requestId !== activeRequestIdRef.current) {
        return;
      }

      if (response.kind === 'ok') {
        setWorkspace({ status: 'ready', payload: response });
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

  const isLoading = workspace.status === 'loading';
  const ingestedBytes =
    workspace.status === 'ready'
      ? workspace.payload.uncompressedByteLength
      : workspace.status === 'loading'
        ? workspace.progress.bytesProcessed
        : 0;

  return (
    <FullWindowDropZone disabled={isLoading} onFileDrop={handleLoadFile}>
      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {liveAnnouncement}
      </div>

      <main
        className={cn(
          'mx-auto flex min-h-screen flex-col px-6 py-4',
          workspace.status === 'ready' ? 'max-w-[1360px]' : 'max-w-6xl',
        )}
      >
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-hairline pb-3">
          <div className="flex items-baseline gap-3">
            <h1 className="text-[20px] leading-tight text-text-primary">
              Chip Autopsy Lab
            </h1>
            <span className="font-mono text-[12px] text-text-tertiary">
              STDF V4 · Local-First Workbench
            </span>
          </div>
          <span className="rounded-control border border-hairline bg-raised px-2 py-1 font-mono text-[12px] text-text-tertiary">
            Browser Sandbox
          </span>
        </header>

        <section aria-label="Autopsy Report Workspace" className="flex-1 py-4">
          {workspace.status === 'empty' ? (
            <EmptyStateCard
              cause="first-run"
              presets={presets}
              selectedPresetId={selectedPresetId}
              onSelectPreset={setSelectedPresetId}
              onLoadDemoLot={handleLoadDemoLot}
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
              onSelectFile={handleLoadFile}
            />
          ) : null}
        </section>

        <footer className="mt-auto flex items-center justify-between border-t border-hairline pt-4 text-[12px] text-text-tertiary">
          <span>Zero server STDF uploads</span>
          <span className="font-mono tabular-nums">
            {ingestedBytes === 0
              ? '0 bytes ingested'
              : `${formatByteSize(ingestedBytes)} (${formatGroupedInt(ingestedBytes)} bytes) ingested`}
          </span>
        </footer>
      </main>
    </FullWindowDropZone>
  );
}
