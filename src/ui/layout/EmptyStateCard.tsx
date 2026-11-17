'use client';

import { Upload } from 'lucide-react';
import * as React from 'react';
import {
  DEMO_DIES_PER_WAFER,
  type DemoPresetId,
  type DemoPresetMeta,
} from '@/core/demo';
import type { ParseFatalError } from '@/core/stdf';
import { formatGroupedInt } from '@/ui/format';
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

export type EmptyStateCause = 'first-run' | 'parse-failed' | 'no-results';

export interface EmptyStateCardProps {
  readonly cause?: EmptyStateCause;
  readonly presets: readonly DemoPresetMeta[];
  readonly selectedPresetId: DemoPresetId;
  readonly onSelectPreset: (presetId: DemoPresetId) => void;
  readonly onLoadDemoLot: (presetId: DemoPresetId) => void;
  readonly onSelectFile: (file: File) => void;
  readonly parseError?: {
    readonly error: ParseFatalError;
    readonly fileName?: string;
  } | null;
  readonly activeFilterSummary?: string;
  readonly onClearFilters?: () => void;
  readonly disabled?: boolean;
}

/**
 * Distinct empty state card by cause (`first-run`, `parse-failed`, `no-results`)
 * with prominent `"Load demo lot"` control and STDF file drop / picker zone.
 *
 * Validates: Requirements 1.1, 1.2, 2.2, 3.2, 14.2, 14.3, 17.6
 */
export function EmptyStateCard({
  cause = 'first-run',
  presets,
  selectedPresetId,
  onSelectPreset,
  onLoadDemoLot,
  onSelectFile,
  parseError = null,
  activeFilterSummary,
  onClearFilters,
  disabled = false,
}: EmptyStateCardProps): React.JSX.Element {
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const [isLocalDragOver, setIsLocalDragOver] = React.useState(false);

  const handleFileInputChange = (
    event: React.ChangeEvent<HTMLInputElement>,
  ): void => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file) {
      onSelectFile(file);
    }
  };

  const handleDropZoneDragOver = (
    event: React.DragEvent<HTMLDivElement>,
  ): void => {
    event.preventDefault();
    if (!disabled) {
      setIsLocalDragOver(true);
    }
  };

  const handleDropZoneDragLeave = (
    event: React.DragEvent<HTMLDivElement>,
  ): void => {
    event.preventDefault();
    setIsLocalDragOver(false);
  };

  const handleDropZoneDrop = (event: React.DragEvent<HTMLDivElement>): void => {
    event.preventDefault();
    event.stopPropagation();
    setIsLocalDragOver(false);
    if (disabled) {
      return;
    }
    const file = event.dataTransfer.files?.[0];
    if (file) {
      onSelectFile(file);
    }
  };

  const handlePresetKeyDown = (
    event: React.KeyboardEvent<HTMLButtonElement>,
    index: number,
  ): void => {
    if (presets.length === 0) {
      return;
    }
    let nextIndex: number | null = null;
    if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
      nextIndex = (index + 1) % presets.length;
    } else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
      nextIndex = (index - 1 + presets.length) % presets.length;
    }
    if (nextIndex !== null) {
      event.preventDefault();
      const targetPreset = presets[nextIndex];
      if (targetPreset) {
        onSelectPreset(targetPreset.id);
      }
    }
  };

  return (
    <Card aria-label="Autopsy Report Empty State">
      <CardHeader className="border-b border-hairline pb-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="font-mono text-[12px] tracking-wider text-text-tertiary uppercase">
            {cause === 'parse-failed'
              ? 'Autopsy Report · Ingest Halted'
              : cause === 'no-results'
                ? 'Autopsy Report · Empty Selection'
                : 'Autopsy Report · Ready'}
          </span>
          {cause === 'parse-failed' && parseError ? (
            <Badge variant="failure">{parseError.error.code}</Badge>
          ) : (
            <Badge variant="neutral">STDF V4 · Web Worker</Badge>
          )}
        </div>

        <CardTitle className="mt-1 text-[28px] leading-snug">
          {cause === 'parse-failed'
            ? 'Unable to decode STDF V4 wafer log.'
            : cause === 'no-results'
              ? 'Zero dies match the active filter predicates.'
              : 'Awaiting STDF V4 wafer sort telemetry.'}
        </CardTitle>

        {cause === 'parse-failed' && parseError ? (
          <div className="mt-2 rounded-control border border-hairline bg-raised p-4">
            <p className="text-[14px] text-text-primary">
              {parseError.error.message}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-4 font-mono text-[12px] text-text-tertiary">
              {parseError.fileName ? (
                <span>File: {parseError.fileName}</span>
              ) : null}
              {parseError.error.byteOffset !== undefined ? (
                <span>
                  Byte offset: {formatGroupedInt(parseError.error.byteOffset)}
                </span>
              ) : null}
            </div>
          </div>
        ) : cause === 'no-results' ? (
          <div role="status" aria-live="polite" aria-atomic="true">
            <CardDescription>
              {activeFilterSummary
                ? `Active filter: ${activeFilterSummary}. Clear filters or load a demo lot.`
                : 'Clear active filters to restore the lot, or load a demo lot.'}
            </CardDescription>
          </div>
        ) : (
          <CardDescription>
            Select a 25-wafer synthetic sort lot or drop a local STDF log. Parsed
            locally in browser memory.
          </CardDescription>
        )}
      </CardHeader>

      <CardContent className="pt-6">
        <label htmlFor="cal-file-picker" className="sr-only">
          Choose STDF V4 file (.stdf, .std, .stdf.gz, .gz)
        </label>
        <input
          id="cal-file-picker"
          ref={fileInputRef}
          tabIndex={-1}
          type="file"
          accept=".stdf,.std,.gz,application/gzip,application/octet-stream"
          onChange={handleFileInputChange}
          disabled={disabled}
          className="sr-only"
          aria-label="Choose STDF V4 file (.stdf, .std, .stdf.gz, .gz)"
        />
        <span id="cal-file-picker-desc" className="sr-only">
          Opens local STDF V4 file picker (.stdf, .std, .stdf.gz, .gz)
        </span>

        {cause === 'no-results' && onClearFilters ? (
          <div className="flex flex-wrap items-center gap-3">
            <Button
              variant="primary"
              size="lg"
              onClick={onClearFilters}
              disabled={disabled}
            >
              Clear filters
            </Button>
            <Button
              variant="secondary"
              size="lg"
              onClick={() => onLoadDemoLot(selectedPresetId)}
              disabled={disabled}
            >
              Load demo lot
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
            {/* Left column: Built-in synthetic STDF V4 demo lots */}
            <div className="flex flex-col justify-between gap-4 lg:col-span-7">
              <div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[13px] font-medium text-text-primary">
                    Synthetic STDF V4 Demo Lots
                  </span>
                  <span className="font-mono text-[12px] text-text-tertiary">
                    {formatGroupedInt(25 * DEMO_DIES_PER_WAFER)} dies / lot
                  </span>
                </div>

                <div
                  role="radiogroup"
                  aria-label="Synthetic STDF V4 demo lot presets"
                  className="mt-3 flex flex-col gap-2"
                >
                  {presets.map((preset, idx) => {
                    const isSelected = preset.id === selectedPresetId;
                    return (
                      <button
                        key={preset.id}
                        type="button"
                        role="radio"
                        aria-checked={isSelected}
                        disabled={disabled}
                        onClick={() => onSelectPreset(preset.id)}
                        onKeyDown={(e) => handlePresetKeyDown(e, idx)}
                        className={cn(
                          'flex w-full cursor-pointer flex-col gap-1 rounded-control border p-3.5 text-left shadow-none',
                          'transition-[transform,opacity] duration-150 ease-[var(--ease-clinical)]',
                          'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
                          isSelected
                            ? 'border-accent bg-raised'
                            : 'border-hairline bg-bg hover:bg-raised',
                        )}
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="text-[14px] font-medium text-text-primary">
                            {preset.title}
                          </span>
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-[12px] text-text-tertiary">
                              {preset.id}
                            </span>
                            {isSelected ? (
                              <Badge variant="accent">Selected</Badge>
                            ) : null}
                          </div>
                        </div>
                        <span className="text-[13px] text-text-secondary">
                          {preset.subtitle}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-3 pt-1">
                <Button
                  variant="primary"
                  size="lg"
                  onClick={() => onLoadDemoLot(selectedPresetId)}
                  disabled={disabled}
                >
                  Load demo lot
                </Button>
                {cause === 'parse-failed' ? (
                  <Button
                    variant="secondary"
                    size="lg"
                    aria-controls="cal-file-picker"
                    aria-describedby="cal-file-picker-desc"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={disabled}
                  >
                    Choose STDF file
                  </Button>
                ) : null}
              </div>
            </div>

            {/* Right column: Local STDF V4 file drop zone & keyboard picker */}
            <div className="flex flex-col lg:col-span-5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[13px] font-medium text-text-primary">
                  Local STDF V4 Log
                </span>
                <span className="font-mono text-[12px] text-text-tertiary">
                  Zero network upload
                </span>
              </div>

              <div
                onDragOver={handleDropZoneDragOver}
                onDragLeave={handleDropZoneDragLeave}
                onDrop={handleDropZoneDrop}
                className={cn(
                  'mt-3 flex flex-1 flex-col items-center justify-center rounded-panel border border-dashed p-6 text-center',
                  'transition-[transform,opacity] duration-150 ease-[var(--ease-clinical)]',
                  isLocalDragOver
                    ? 'border-accent bg-overlay'
                    : 'border-hairline bg-raised',
                )}
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-control border border-hairline bg-panel text-text-secondary">
                  <Upload className="h-4 w-4" strokeWidth={1.5} aria-hidden="true" />
                </div>

                <p className="mt-4 text-[16px] font-medium text-text-primary">
                  Drop the body.
                </p>
                <p className="mt-1 max-w-xs text-[13px] text-text-secondary">
                  Drag a raw or gzipped sort file anywhere, or browse from disk.
                </p>
                <p className="mt-2 font-mono text-[12px] text-text-tertiary">
                  .stdf · .std · .stdf.gz · .gz
                </p>

                <Button
                  variant="secondary"
                  size="md"
                  className="mt-5"
                  aria-controls="cal-file-picker"
                  aria-describedby="cal-file-picker-desc"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={disabled}
                >
                  Choose STDF file
                </Button>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
