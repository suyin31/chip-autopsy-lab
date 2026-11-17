import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { listDemoPresets } from '@/core/demo';
import { formatByteSize, formatGroupedInt, formatScore2, formatYieldPct } from '@/ui/format';
import { EmptyStateCard } from './EmptyStateCard';
import { IngestProgressPanel } from './IngestProgressPanel';

describe('first-run empty state, progress panel, and clinical formatting (Sub-task 4.3)', () => {
  it('formats yields to 1 decimal, scores to 2 decimals, and integers with digit grouping', () => {
    expect(formatYieldPct(0.8244)).toBe('82.4%');
    expect(formatYieldPct(null)).toBe('N/A');
    expect(formatScore2(0.914)).toBe('0.91');
    expect(formatGroupedInt(15825)).toBe('15,825');
    expect(formatByteSize(0)).toBe('0 B');
    expect(formatByteSize(6.8 * 1024 * 1024)).toBe('6.8 MB');
  });

  it('renders first-run EmptyStateCard with "Load demo lot", preset radios, and "Drop the body." file drop zone', () => {
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
    expect(html).toContain('Site 1:2 Probe Contact Lot');
    // Restraint checks: zero drop-shadow utilities, zero bold >= 700 classes
    expect(html).not.toMatch(/\bshadow-(sm|md|lg|xl|2xl)\b/);
    expect(html).not.toMatch(/\bfont-(bold|extrabold|black)\b/);
  });

  it('renders parse-failed EmptyStateCard with error code, byte offset, and "Load demo lot" recovery', () => {
    const presets = listDemoPresets();
    const html = renderToStaticMarkup(
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

    expect(html).toContain('MISSING_FAR_HEADER');
    expect(html).toContain('corrupt.stdf');
    expect(html).toContain('Byte offset: 128');
    expect(html).toContain('Load demo lot');
  });

  it('renders IngestProgressPanel with bytes, records, and resolved dies counters', () => {
    const html = renderToStaticMarkup(
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

    expect(html).toContain('50.0%');
    expect(html).toContain('3.3 MB / 6.5 MB');
    expect(html).toContain('142,810');
    expect(html).toContain('7,912');
  });
});
