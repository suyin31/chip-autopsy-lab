import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { listDemoPresets } from '@/core/demo';
import { formatByteSize, formatGroupedInt, formatScore2, formatYieldPct } from '@/ui/format';
import { ingestDemoPreset } from '@/workers';
import { EmptyStateCard } from './EmptyStateCard';
import {
  bindWindowFileDropListeners,
  FullWindowDropZone,
  type WindowDropEventLike,
  type WindowDropEventTarget,
} from './FullWindowDropZone';
import { IngestProgressPanel } from './IngestProgressPanel';
import { LoadedLotOverview } from './LoadedLotOverview';

describe('first-run empty state, drop zone, progress panel, and loaded overview (Sub-task 4.3)', () => {
  it('formats yields to 1 decimal, scores to 2 decimals, and integers with digit grouping', () => {
    expect(formatYieldPct(0.8244)).toBe('82.4%');
    expect(formatYieldPct(null)).toBe('N/A');
    expect(formatScore2(0.914)).toBe('0.91');
    expect(formatGroupedInt(15825)).toBe('15,825');
    expect(formatByteSize(0)).toBe('0 B');
    expect(formatByteSize(6.8 * 1024 * 1024)).toBe('6.8 MB');
  });

  it('renders first-run EmptyStateCard with accessible file-picker linkage (J-4), preset radiogroup, and restrained copy', () => {
    const presets = listDemoPresets();
    const html = renderToStaticMarkup(
      React.createElement(EmptyStateCard, {
        cause: 'first-run',
        presets,
        selectedPresetId: 'edge-ring-etch',
        onSelectPreset: () => undefined,
        onLoadDemoLot: () => undefined,
        onSelectFile: () => undefined,
      }),
    );

    expect(html).toContain('Load demo lot');
    expect(html).toContain('Drop the body.');
    expect(html).toContain('Choose STDF file');
    expect(html).toContain('Edge-Ring Plasma Etch Lot');
    expect(html).toContain('Robotic Handling Scratch Lot');
    expect(html).toContain('Site 2 Probe Contact Lot');
    expect(html).not.toContain('Site 1:2 Probe Contact Lot');

    // J-4 + M-6: ARIA radiogroup, radio selection state, and accessible file picker linkage
    expect(html).toContain('role="radiogroup"');
    expect(html).toContain('role="radio"');
    expect(html).toContain('aria-checked="true"');
    expect(html).toContain('id="cal-file-picker"');
    expect(html).toContain('for="cal-file-picker"');
    expect(html).toContain('aria-controls="cal-file-picker"');
    expect(html).toContain('aria-describedby="cal-file-picker-desc"');

    // Restraint checks: zero drop-shadow utilities (excluding shadow-none), zero bold >= 700 classes
    expect(html).not.toMatch(/\bshadow-(?!none\b)[a-z0-9]+\b/);
    expect(html).not.toMatch(/\bfont-(bold|extrabold|black)\b/);
  });

  it('renders parse-failed and no-results EmptyStateCards with recovery actions and polite status', () => {
    const presets = listDemoPresets();
    const failedHtml = renderToStaticMarkup(
      React.createElement(EmptyStateCard, {
        cause: 'parse-failed',
        presets,
        selectedPresetId: 'edge-ring-etch',
        onSelectPreset: () => undefined,
        onLoadDemoLot: () => undefined,
        onSelectFile: () => undefined,
        parseError: {
          fileName: 'corrupt.stdf',
          error: {
            code: 'MISSING_FAR_HEADER',
            message: 'Expected initial FAR (0, 10) record header.',
            byteOffset: 128,
          },
        },
      }),
    );

    expect(failedHtml).toContain('MISSING_FAR_HEADER');
    expect(failedHtml).toContain('corrupt.stdf');
    expect(failedHtml).toContain('Byte offset: 128');
    expect(failedHtml).toContain('Load demo lot');

    const noResultsHtml = renderToStaticMarkup(
      React.createElement(EmptyStateCard, {
        cause: 'no-results',
        presets,
        selectedPresetId: 'edge-ring-etch',
        onSelectPreset: () => undefined,
        onLoadDemoLot: () => undefined,
        onSelectFile: () => undefined,
        activeFilterSummary: 'sbin = 7',
        onClearFilters: () => undefined,
      }),
    );

    expect(noResultsHtml).toContain('Zero dies match the active filter predicates.');
    expect(noResultsHtml).toContain('aria-live="polite"');
    expect(noResultsHtml).toContain('Clear filters');
  });

  it('binds window file-drop listeners once without churning on drag state changes and invokes latest callback (J-1, M-4)', () => {
    const listeners = new Map<string, Set<(event: WindowDropEventLike) => void>>();
    let addCalls = 0;
    let removeCalls = 0;

    const mockTarget: WindowDropEventTarget = {
      addEventListener(type, listener) {
        addCalls += 1;
        let set = listeners.get(type);
        if (!set) {
          set = new Set();
          listeners.set(type, set);
        }
        set.add(listener);
      },
      removeEventListener(type, listener) {
        removeCalls += 1;
        listeners.get(type)?.delete(listener);
      },
    };

    const emit = (type: string, event: WindowDropEventLike): void => {
      for (const fn of listeners.get(type) ?? []) {
        fn(event);
      }
    };

    const activeTransitions: boolean[] = [];
    const droppedByFirstHandler: string[] = [];
    const droppedByUpdatedHandler: string[] = [];
    let currentHandler = (f: File): void => {
      droppedByFirstHandler.push(f.name);
    };

    const cleanup = bindWindowFileDropListeners({
      target: mockTarget,
      getOnFileDrop: () => currentHandler,
      onDragActiveChange: (active) => {
        activeTransitions.push(active);
      },
    });

    expect(addCalls).toBe(6);
    expect(removeCalls).toBe(0);

    // Non-file drags (e.g. text selection) are ignored
    emit('dragenter', {
      dataTransfer: { types: ['text/plain'] },
      preventDefault: () => undefined,
    });
    expect(activeTransitions).toEqual([]);

    // Nested dragenter -> dragover -> inner dragleave keeps active=true with zero listener churn
    const fileDragEvent = (files?: File[]): WindowDropEventLike => ({
      dataTransfer: { types: ['Files'], ...(files ? { files } : {}) },
      preventDefault: () => undefined,
    });

    emit('dragenter', fileDragEvent());
    emit('dragenter', fileDragEvent());
    emit('dragover', fileDragEvent());
    emit('dragover', fileDragEvent());
    emit('dragleave', fileDragEvent());

    // Update onFileDrop callback mid-drag without re-binding listeners (no stale closure)
    currentHandler = (f: File): void => {
      droppedByUpdatedHandler.push(f.name);
    };

    const testFile = new File([new Uint8Array([0, 2, 0, 10, 2, 4])], 'wafer.stdf');
    emit('drop', fileDragEvent([testFile]));

    expect(activeTransitions).toEqual([true, false]);
    expect(addCalls).toBe(6);
    expect(removeCalls).toBe(0);
    expect(droppedByFirstHandler).toEqual([]);
    expect(droppedByUpdatedHandler).toEqual(['wafer.stdf']);

    cleanup();
    expect(removeCalls).toBe(6);

    const dropZoneHtml = renderToStaticMarkup(
      React.createElement(FullWindowDropZone, {
        onFileDrop: () => undefined,
        children: React.createElement('div', null, 'Workbench child'),
      }),
    );
    expect(dropZoneHtml).toContain('aria-live="assertive"');
  });

  it('renders determinate and indeterminate IngestProgressPanel with aria-live phase announcements and aria-valuetext (J-5, M-13)', () => {
    const determinateHtml = renderToStaticMarkup(
      React.createElement(IngestProgressPanel, {
        label: 'Synthetic Demo · Edge-Ring Plasma Etch Lot',
        progress: {
          phase: 'parsing',
          bytesProcessed: 3_407_872,
          totalBytes: 6_815_744,
          recordsDecoded: 142_810,
          diesResolved: 7_912,
        },
      }),
    );

    expect(determinateHtml).toContain('50.0%');
    expect(determinateHtml).toContain('3.3 MB / 6.5 MB');
    expect(determinateHtml).toContain('142,810');
    expect(determinateHtml).toContain('7,912');
    expect(determinateHtml).toContain('aria-live="polite"');
    expect(determinateHtml).toContain('aria-valuenow="50"');
    expect(determinateHtml).toContain('aria-valuetext="Decoding STDF V4 binary records in Web Worker: 50.0%');

    const indeterminateHtml = renderToStaticMarkup(
      React.createElement(IngestProgressPanel, {
        label: 'Local STDF · compressed.stdf.gz',
        progress: {
          phase: 'decompressing',
          bytesProcessed: 1_048_576,
          totalBytes: null,
          recordsDecoded: 0,
          diesResolved: 0,
        },
      }),
    );

    expect(indeterminateHtml).not.toContain('aria-valuenow=');
    expect(indeterminateHtml).toContain('aria-valuetext="Decompressing gzip stream in Web Worker: 1.0 MB processed, 0 dies resolved"');
  });

  it('renders Nominal status across all sites on edge-ring-etch and flags Head 1 · Site 2 as failure anomaly on site2-probe-contact (M-5)', async () => {
    const presets = listDemoPresets();
    const edgeRes = await ingestDemoPreset('edge-ring-etch');
    expect(edgeRes.kind).toBe('ok');
    if (edgeRes.kind !== 'ok') return;

    const edgeHtml = renderToStaticMarkup(
      React.createElement(LoadedLotOverview, {
        data: edgeRes,
        presets,
        selectedPresetId: 'edge-ring-etch',
        onSelectPreset: () => undefined,
        onLoadDemoLot: () => undefined,
        onSelectFile: () => undefined,
      }),
    );
    expect(edgeHtml.match(/Nominal/g)).toHaveLength(4);
    expect(edgeHtml).not.toContain('pp yield drop');

    const site2Res = await ingestDemoPreset('site2-probe-contact');
    expect(site2Res.kind).toBe('ok');
    if (site2Res.kind !== 'ok') return;

    const site2Html = renderToStaticMarkup(
      React.createElement(LoadedLotOverview, {
        data: site2Res,
        presets,
        selectedPresetId: 'site2-probe-contact',
        onSelectPreset: () => undefined,
        onLoadDemoLot: () => undefined,
        onSelectFile: () => undefined,
      }),
    );
    expect(site2Html).toContain('Head 1 · Site 2');
    expect(site2Html).toContain('text-failure');
    expect(site2Html).toContain('pp yield drop');
    expect(site2Html.match(/Nominal/g)).toHaveLength(3);
  });
});
