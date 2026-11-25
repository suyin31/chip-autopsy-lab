import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { listDemoPresets } from '@/core/demo';
import type { ParseFatalError } from '@/core/stdf';
import {
  formatByteSize,
  formatGroupedInt,
  formatScore2,
  formatYieldPct,
} from '@/ui/format';
import { I18nProvider } from '@/ui/i18n';
import { ingestDemoPreset } from '@/workers';
import { BinsOnlyNotice } from './BinsOnlyNotice';
import { BinsOnlySheet } from './BinsOnlySheet';
import { EmptyStateCard } from './EmptyStateCard';
import { ErrorDetailsSheet } from './ErrorDetailsSheet';
import {
  bindWindowFileDropListeners,
  type DragItemKind,
  FullWindowDropZone,
  type WindowDropEventLike,
  type WindowDropEventTarget,
} from './FullWindowDropZone';
import { IngestProgressPanel } from './IngestProgressPanel';
import {
  formatParseWarningToast,
  notifyParseWarnings,
  triggerBrowserBlobDownload,
} from './ingest-helpers';
import { LoadedLotOverview } from './LoadedLotOverview';
import {
  estimateFullParseSeconds,
  resolveParseErrorViewModel,
  resolveTruncatedWarningToastModel,
} from './parse-error-copy';

function renderWithLocale(
  node: React.ReactElement,
  locale: 'en' | 'ja' = 'en',
): string {
  return renderToStaticMarkup(
    React.createElement(I18nProvider, { initialLocale: locale }, node),
  );
}

describe('R4 landing hero, drag overlay, §3.7 parse error codes, and §3.8 bins-only sheet & notice', () => {
  it('formats yields to 1 decimal, scores to 2 decimals, and integers with digit grouping', () => {
    expect(formatYieldPct(0.8244)).toBe('82.4%');
    expect(formatYieldPct(null)).toBe('N/A');
    expect(formatScore2(0.914)).toBe('0.91');
    expect(formatGroupedInt(15825)).toBe('15,825');
    expect(formatByteSize(0)).toBe('0 B');
    expect(formatByteSize(6.8 * 1024 * 1024)).toBe('6.8 MB');
  });

  it('renders the premium §6.1 landing: hero, one primary "Open the sample lot", secondary "Open file", hint, Sample lots cards, and footer', () => {
    const presets = listDemoPresets();
    const loaded: string[] = [];
    const html = renderWithLocale(
      React.createElement(EmptyStateCard, {
        cause: 'first-run',
        presets,
        selectedPresetId: 'edge-ring-etch',
        onSelectPreset: () => undefined,
        onLoadDemoLot: (id) => loaded.push(id),
        onDownloadDemoLot: () => undefined,
        onSelectFile: () => undefined,
      }),
    );

    // premium §12.2: "body" is the one Instrument Serif accent word
    expect(html).toContain('Drop the <span data-accent="" class="type-accent">body</span>.');
    expect(html).toContain(
      'Find out why a wafer lot lost yield. Drop an STDF test log and get the cause, linked to the dies.',
    );
    expect(html).toContain('>Open the sample lot<');
    expect(html).toContain('>Open file<');
    expect(html).toContain(
      'Or drop a .stdf, .std, or gzip file anywhere. Files stay on this device.',
    );
    expect(html).toContain('>Files stay on this device.<');

    // A20: exactly one filled ink primary on the landing
    expect(html.match(/data-testid="landing-open-sample-button"/g)).toHaveLength(1);
    expect(html.match(/\bbg-ink\b/g)).toHaveLength(1);
    expect(html).toContain('bg-fill-1');

    // Sample cards with the premium §6.1 copy, meta, and aria labels
    expect(html).toContain('>Sample lots<');
    expect(html).toContain('Edge-Ring Plasma Etch');
    expect(html).toContain('Etch damage kills dies around the wafer edge.');
    expect(html).toContain('Robotic Handling Scratch');
    expect(html).toContain('A robot arm scratched a line across 18 wafers.');
    expect(html).toContain('Site 2 Probe Contact');
    expect(html).toContain('One worn tester needle fails good dies.');
    expect(html).toContain('25 wafers, 15,825 dies');
    expect(html).toContain('aria-label="Open sample lot Edge-Ring Plasma Etch"');
    // Bento sample cards: obsidian data pods with compact data plots + 2 live capability Bento cards
    expect(html).toContain('data-testid="demo-tile-edge-ring-etch"');
    expect(html).toContain('at-obsidian-well');
    expect(html).toMatch(/data-testid="demo-chip-edge-ring-etch"[^>]*>Edge ring</);
    expect(html).toMatch(/data-testid="demo-chip-handling-scratch"[^>]*>Scratch</);
    expect(html).toMatch(/data-testid="demo-chip-site2-probe-contact"[^>]*>Probe site</);
    // UI v3: mid-page 12-col frameless interactive telemetry strip replaces the 2 capability Bento boxes
    expect(html).toContain('data-testid="landing-telemetry-strip"');
    expect(html).toContain('data-testid="telemetry-spectrum-svg"');
    expect(html).toContain('2,721');
    expect(html).not.toContain('data-testid="bento-capability-pipeline"');
    expect(html).not.toContain('data-testid="bento-capability-agents"');

    // Hero right: 3D Exploded Forensic Stage (no 440 px decorative hero wafer; compact 84 px data plot only)
    expect(html).toContain('data-testid="landing-hero-stage-3d"');
    expect(html).toContain('data-testid="landing-hero-deck"');
    expect(html).not.toContain('width:440px;height:440px');
    expect(html).toContain('width:84px;height:84px');
    expect(html).toContain('data-testid="landing-example-card"');
    expect(html).toContain('Example result');
    expect(html).toContain('<bdi translate="no">Edge-Ring</bdi> failure.');
    // Premium §11.5: the percent is its own count-up from 0, sized by its final string
    expect(html.replace(/<[^>]+>/g, '')).toContain('0.0% of fails sit in the outer 3 rings.');
    expect(html).toMatch(/data-testid="landing-example-percent" data-final="93.8%" class="count-up"/);
    expect(html).toContain('>See how it was found<');

    // Compact server-rendered data plots in Bento cards with contact shadow and masked sheen
    expect(html).toContain('width:132px;height:132px');
    expect(html).toContain('width:88px;height:88px');
    expect(html).toContain('data-testid="landing-demo-wafer-contact-edge-ring-etch"');
    expect(html).toContain('data-testid="landing-demo-wafer-sheen-edge-ring-etch"');
    expect(html).not.toContain('var(--vignette)');
    expect(html).not.toContain('var(--top-light)');

    // No legacy radio state or "Load demo lot" button on the landing
    expect(html).not.toContain('role="radiogroup"');
    expect(html).not.toContain('>Load demo lot<');

    // Accessible file input linkage and focus-ring token
    expect(html).toContain('id="cal-file-picker"');
    expect(html).toContain('for="cal-file-picker"');
    expect(html).toContain('focus-visible:shadow-focus-ring');
    expect(html).toContain(
      'accept=".stdf,.std,.stdf.gz,.gz,application/gzip,application/octet-stream"',
    );

    // Footer line
    expect(html).toContain('>Runs entirely in your browser.<');
    expect(html).toContain('Download sample files');

    // Restraint: no weights >= 700; the only ember chrome is the §12.4 eyebrow dots and the §11.1
    // example title (the §12.2 accent word takes ember-ink from `.type-accent`)
    expect(html).not.toMatch(/\bfont-(bold|extrabold|black)\b/);
    expect(html.match(/[\w-]*ember[\w-]*/g)).toEqual(['bg-ember']);
    expect(html).toContain('data-testid="landing-eyebrow-dot" class="size-1.5 shrink-0 rounded-full bg-ember"');
    expect(html).toMatch(/data-testid="landing-sample-heading" class="[^"]*text-\[13px\]/);
  });

  it('maps all 7 §3.7 error codes cleanly and renders icon-free parse-failed hero above demo cards', () => {
    const cases: ReadonlyArray<{
      readonly error: ParseFatalError;
      readonly expectedCode: string;
      readonly expectedTitle: string;
      readonly expectedBodySubstring: string;
    }> = [
      {
        error: {
          code: 'MISSING_FAR_HEADER',
          message: 'bad far',
          byteOffset: 0,
          firstBytesHex: '89 50 4E 47 0D 0A 1A 0A 00 00 00 0D 49 48 44 52',
        },
        expectedCode: 'not-stdf',
        expectedTitle: "This file isn't an STDF log.",
        expectedBodySubstring:
          'The first record must be FAR (0, 10). This file starts with bytes 89 50 4E 47.',
      },
      {
        error: {
          code: 'UNSUPPORTED_STDF_VERSION',
          message: 'v3',
          byteOffset: 5,
          stdfVersion: 3,
          firstBytesHex: '02 00 00 0A 02 03',
        },
        expectedCode: 'unsupported-version',
        expectedTitle: "This STDF version isn't supported.",
        expectedBodySubstring:
          'FAR reports STDF_VER 3. Chip Autopsy Lab reads STDF V4.',
      },
      {
        error: {
          code: 'UNSUPPORTED_CPU_TYPE_VAX',
          message: 'vax',
          byteOffset: 4,
        },
        expectedCode: 'vax-cpu',
        expectedTitle: "DEC VAX byte order isn't supported.",
        expectedBodySubstring:
          'FAR.CPU_TYPE is 0. Re-export the log with CPU_TYPE 1 or 2.',
      },
      {
        error: {
          code: 'ZERO_VALID_PRR',
          message: 'truncated before PRR',
          byteOffset: 1024,
          firstBytesHex: '02 00 00 0A 02 04',
          truncatedRecord: {
            recName: 'PRR (5, 20)',
            recTyp: 5,
            recSub: 20,
            byteOffset: 1024,
            needBytes: 24,
            haveBytes: 10,
          },
        },
        expectedCode: 'truncated',
        expectedTitle: 'The file ends in the middle of a record.',
        expectedBodySubstring:
          'Record PRR (5, 20) at byte 1,024 needs 24 bytes, but only 10 remain.',
      },
      {
        error: {
          code: 'GZIP_DECOMPRESS_FAILED',
          message: 'corrupt gz',
          byteOffset: 512,
          firstBytesHex: '1F 8B 08 00 FF FF',
        },
        expectedCode: 'gzip-failed',
        expectedTitle: "The gzip stream couldn't be decompressed.",
        expectedBodySubstring:
          'The file starts with gzip bytes 1F 8B but the stream is corrupt at byte 512.',
      },
      {
        error: {
          code: 'EMPTY_INPUT',
          message: 'empty',
          byteOffset: 0,
        },
        expectedCode: 'empty',
        expectedTitle: 'The file is empty.',
        expectedBodySubstring: 'Choose a file that contains STDF records.',
      },
      {
        error: {
          code: 'ZERO_VALID_PRR',
          message: 'no prrs',
          byteOffset: 64,
        },
        expectedCode: 'no-parts',
        expectedTitle: 'No tested dies found.',
        expectedBodySubstring:
          'The log has no PRR records, so there is nothing to map.',
      },
    ];

    for (const c of cases) {
      const vm = resolveParseErrorViewModel(c.error, 'en');
      expect(vm.uiCode).toBe(c.expectedCode);
      expect(vm.title).toBe(c.expectedTitle);
      expect(vm.body).toContain(c.expectedBodySubstring);
    }

    const presets = listDemoPresets();
    const failedHtml = renderWithLocale(
      React.createElement(EmptyStateCard, {
        cause: 'parse-failed',
        presets,
        selectedPresetId: 'edge-ring-etch',
        onSelectPreset: () => undefined,
        onLoadDemoLot: () => undefined,
        onSelectFile: () => undefined,
        parseError: {
          fileName: 'diagram.png',
          error: cases[0]!.error,
        },
      }),
    );

    expect(failedHtml).toContain("This file isn&#x27;t an STDF log.");
    expect(failedHtml).toContain('89 50 4E 47');
    // premium §9.2: STDF record names and raw bytes inside the localized body stay untranslated
    expect(failedHtml).toContain('<bdi translate="no">FAR (0, 10)</bdi>');
    expect(failedHtml).toContain('<bdi translate="no">89 50 4E 47</bdi>');
    expect(failedHtml).toContain('Open another file');
    // premium §6.4 / §9.6: `title-1`, secondary reads "Open the sample lot", one `ink` primary (A20)
    expect(failedHtml).toContain('type-title-1');
    expect(failedHtml).toMatch(
      /data-testid="parse-error-load-demo"[^>]*>Open the sample lot</,
    );
    expect(failedHtml).not.toContain('Load demo lot');
    expect(failedHtml.match(/bg-ink text-on-ink/g)?.length).toBe(1);
    expect(failedHtml).toContain('Show details');
    // Demo cards remain below so the next step is one click
    expect(failedHtml).toContain('Edge-Ring Plasma Etch');

    const detailsHtml = renderWithLocale(
      React.createElement(ErrorDetailsSheet, {
        open: true,
        onClose: () => undefined,
        byteOffset: 0,
        first16BytesHex: '89 50 4E 47 0D 0A 1A 0A 00 00 00 0D 49 48 44 52',
        fileName: 'diagram.png',
        disablePortal: true,
      }),
    );
    expect(detailsHtml).toContain('Details');
    expect(detailsHtml).toContain(
      '89 50 4E 47 0D 0A 1A 0A 00 00 00 0D 49 48 44 52',
    );

    const noResultsHtml = renderWithLocale(
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
    expect(noResultsHtml).toContain('aria-live="polite"');
    expect(noResultsHtml).toContain('Clear the filter');
    expect(noResultsHtml).toContain('Active filter: sbin = 7.');
  });

  it('renders §3.8 BinsOnlySheet for 312 MB (~21s) and BinsOnlyNotice under confidence pill while hiding parametric claims', async () => {
    const bytes312Mb = 312 * 1024 * 1024;
    expect(estimateFullParseSeconds(bytes312Mb)).toBe(21);

    const sheetHtml = renderWithLocale(
      React.createElement(BinsOnlySheet, {
        open: true,
        bytesObserved: bytes312Mb,
        onUseBinsOnly: () => undefined,
        onParseEverything: () => undefined,
        onCancel: () => undefined,
        disablePortal: true,
      }),
    );

    expect(sheetHtml).toContain('This file is 312 MB.');
    expect(sheetHtml).toContain('21s');
    expect(sheetHtml).toContain('Use bins-only');
    expect(sheetHtml).toContain('Parse everything');
    // premium §6.6 / §7.16: `title-1`, one `ink` primary, primary last on desktop
    expect(sheetHtml).toContain('type-title-1');
    expect(sheetHtml.match(/bg-ink text-on-ink/g)?.length).toBe(1);
    expect(sheetHtml).toContain('md:flex-row-reverse');
    expect(sheetHtml).toContain('bg-surface');

    const noticeHtml = renderWithLocale(
      React.createElement(BinsOnlyNotice, {
        onParseEverything: () => undefined,
      }),
    );
    expect(noticeHtml).toContain('Bins-only mode. Parametric findings are hidden.');
    expect(noticeHtml).toContain('Parse everything');

    const truncToast = resolveTruncatedWarningToastModel(
      [
        {
          code: 'TRUNCATED_TAIL_RECORD',
          byteOffset: 4096,
          recTyp: 1,
          recSub: 20,
          detail: 'Truncated MRR',
          firstBytesHex: '02 00 00 0A 02 04',
          truncatedRecord: {
            recName: 'MRR (1, 20)',
            recTyp: 1,
            recSub: 20,
            byteOffset: 4096,
            needBytes: 12,
            haveBytes: 6,
          },
        },
      ],
      'en',
    );
    expect(truncToast?.title).toBe('The file ends in the middle of a record.');
    expect(truncToast?.body).toContain(
      'Record MRR (1, 20) at byte 4,096 needs 12 bytes, but only 6 remain.',
    );

    const binsOnlyEdgeRes = await ingestDemoPreset('edge-ring-etch', {
      mode: 'bins-only',
    });
    expect(binsOnlyEdgeRes.kind).toBe('ok');
    if (binsOnlyEdgeRes.kind !== 'ok') return;

    const presets = listDemoPresets();
    const binsOnlyHtml = renderWithLocale(
      React.createElement(LoadedLotOverview, {
        data: binsOnlyEdgeRes,
        presets,
        selectedPresetId: 'edge-ring-etch',
        onSelectPreset: () => undefined,
        onLoadDemoLot: () => undefined,
        onSelectFile: () => undefined,
        onParseEverything: () => undefined,
      }),
    );
    expect(binsOnlyHtml).toContain('data-testid="bins-only-notice"');
    expect(binsOnlyHtml).toContain(
      'Bins-only mode. Parametric findings are hidden.',
    );
    expect(binsOnlyHtml).toContain('Parse everything');
  });

  it('tracks both file and non-file drags in bindWindowFileDropListeners without listener churn (§3.2)', () => {
    const listeners = new Map<
      string,
      Set<(event: WindowDropEventLike) => void>
    >();
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
    const kindTransitions: Array<DragItemKind | null> = [];
    const droppedByUpdatedHandler: string[] = [];
    let currentHandler = (_f: File): void => undefined;

    const cleanup = bindWindowFileDropListeners({
      target: mockTarget,
      getOnFileDrop: () => currentHandler,
      onDragActiveChange: (active) => {
        activeTransitions.push(active);
      },
      onDragKindChange: (kind) => {
        kindTransitions.push(kind);
      },
    });

    expect(addCalls).toBe(6);
    expect(removeCalls).toBe(0);

    // Non-file drag (text/plain) activates non-file state (§3.2: "Only files can be opened here.")
    emit('dragenter', {
      dataTransfer: { types: ['text/plain'] },
      preventDefault: () => undefined,
    });
    expect(kindTransitions).toEqual(['non-file']);
    emit('dragleave', {
      dataTransfer: { types: ['text/plain'] },
      preventDefault: () => undefined,
    });
    expect(kindTransitions).toEqual(['non-file', null]);

    // File drag activates file state and invokes latest callback on drop
    const fileDragEvent = (files?: File[]): WindowDropEventLike => ({
      dataTransfer: { types: ['Files'], ...(files ? { files } : {}) },
      preventDefault: () => undefined,
    });

    emit('dragenter', fileDragEvent());
    emit('dragenter', fileDragEvent());
    emit('dragover', fileDragEvent());
    emit('dragleave', fileDragEvent());

    currentHandler = (f: File): void => {
      droppedByUpdatedHandler.push(f.name);
    };

    const testFile = new File(
      [new Uint8Array([0, 2, 0, 10, 2, 4])],
      'wafer.stdf',
    );
    emit('drop', fileDragEvent([testFile]));

    expect(activeTransitions).toEqual([true, false, true, false]);
    expect(kindTransitions).toEqual(['non-file', null, 'file', null]);
    expect(addCalls).toBe(6);
    expect(droppedByUpdatedHandler).toEqual(['wafer.stdf']);

    cleanup();
    expect(removeCalls).toBe(6);

    const dropZoneHtml = renderWithLocale(
      React.createElement(FullWindowDropZone, {
        onFileDrop: () => undefined,
        children: React.createElement('div', null, 'Workbench child'),
      }),
    );
    expect(dropZoneHtml).toContain('aria-live="assertive"');
  });

  it('preserves IngestProgressPanel, LoadedLotOverview site breakdown, and Sonner helpers', async () => {
    const determinateHtml = renderWithLocale(
      React.createElement(IngestProgressPanel, {
        label: 'Synthetic Demo · Edge-Ring Plasma Etch',
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
    expect(determinateHtml).toContain('aria-live="polite"');
    expect(determinateHtml).toContain('aria-valuenow="50"');
    expect(determinateHtml).toContain('scaleX(0.5)');
    expect(determinateHtml).not.toContain('uppercase');
    expect(determinateHtml).not.toContain('font-mono');
    // premium §6.3: §6.2 grid, stage caption "Reading…", 2 px `fill-3` track 320 wide, `ink` fill
    expect(determinateHtml).toContain('data-testid="ingest-stage-column"');
    expect(determinateHtml).toContain('Reading…');
    expect(determinateHtml).toContain('bg-fill-3');
    expect(determinateHtml).toContain('sm:w-80');
    expect(determinateHtml).toContain('bg-ink');
    expect(determinateHtml).toContain('data-testid="ingest-loading-disc"');

    const site2Res = await ingestDemoPreset('site2-probe-contact');
    expect(site2Res.kind).toBe('ok');
    if (site2Res.kind !== 'ok') return;

    const site2Html = renderWithLocale(
      React.createElement(LoadedLotOverview, {
        data: site2Res,
        presets: listDemoPresets(),
        selectedPresetId: 'site2-probe-contact',
        onSelectPreset: () => undefined,
        onLoadDemoLot: () => undefined,
        onSelectFile: () => undefined,
      }),
    );
    expect(site2Html).toContain('Head 1, site 2');
    expect(site2Html).toContain('data-testid="wafer-base-canvas"');
    expect(site2Html).toContain('data-testid="wafer-overlay-canvas"');
    expect(site2Html).not.toContain('data-testid="bins-only-notice"');

    expect(formatParseWarningToast([])).toBeNull();
    const emitted: Array<{ title: string; id: string; description: string }> =
      [];
    notifyParseWarnings(
      [
        {
          code: 'MALFORMED_RECORD_FIELD',
          byteOffset: 65_536,
          recTyp: 1,
          recSub: 20,
          detail: 'Malformed <script>alert(1)</script> field.',
        },
      ],
      (title, opts) => {
        emitted.push({ title, id: opts.id, description: opts.description });
      },
    );
    expect(emitted).toHaveLength(1);
    expect(emitted[0]?.description).not.toContain('<script>');

    let triggeredName = '';
    triggerBrowserBlobDownload(
      new Uint8Array([0x02, 0x00, 0x00, 0x0a, 0x02, 0x04]),
      'edge-ring-etch.stdf',
      {
        createObjectURL: () => 'blob:local/edge-ring-etch',
        revokeObjectURL: () => undefined,
        triggerAnchorDownload(_href, downloadName) {
          triggeredName = downloadName;
        },
      },
    );
    expect(triggeredName).toBe('edge-ring-etch.stdf');
  });
});
