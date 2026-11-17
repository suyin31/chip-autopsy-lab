'use client';

import * as React from 'react';
import type { YieldMetrics } from '@/core/analytics';
import type { WaferSummaryMeta } from '@/core/model';
import { formatYieldPct } from '@/ui/format';
import { Button } from '@/ui/primitives';

export interface WaferSelectorProps {
  readonly wafers: readonly WaferSummaryMeta[];
  readonly byWaferYield: readonly YieldMetrics[];
  readonly activeWaferIndex: number;
  readonly onSelectWafer: (waferIndex: number) => void;
}

/**
 * Keyboard-operable wafer selector (`role="radiogroup"`) supporting 25+ wafers
 * with roving `tabIndex`, `ArrowLeft`/`ArrowRight`/`ArrowUp`/`ArrowDown`/`Home`/`End`
 * navigation, `#7CF2C1` focus rings, and non-color active state cues.
 *
 * Validates: Requirements 4.1, 14.2, 14.3, 17.5
 */
export const WaferSelector = React.memo(function WaferSelector({
  wafers,
  byWaferYield,
  activeWaferIndex,
  onSelectWafer,
}: WaferSelectorProps): React.JSX.Element | null {
  const pillRefs = React.useRef<Array<HTMLButtonElement | null>>([]);
  const count = wafers.length;

  if (count === 0) {
    return null;
  }

  const safeActive = Math.min(Math.max(0, activeWaferIndex), count - 1);

  const focusAndSelect = (nextIndex: number): void => {
    const wrapped = ((nextIndex % count) + count) % count;
    onSelectWafer(wrapped);
    pillRefs.current[wrapped]?.focus();
  };

  const handleRadioKeyDown = (
    event: React.KeyboardEvent<HTMLButtonElement>,
    index: number,
  ): void => {
    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowDown': {
        event.preventDefault();
        focusAndSelect(index + 1);
        break;
      }
      case 'ArrowLeft':
      case 'ArrowUp': {
        event.preventDefault();
        focusAndSelect(index - 1);
        break;
      }
      case 'Home': {
        event.preventDefault();
        focusAndSelect(0);
        break;
      }
      case 'End': {
        event.preventDefault();
        focusAndSelect(count - 1);
        break;
      }
      default:
        break;
    }
  };

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col items-center gap-2.5">
      <div className="flex w-full items-center justify-between gap-3">
        <span className="font-mono text-[12px] text-text-tertiary tabular-nums">
          Wafer {wafers[safeActive]?.waferId ?? 'W01'} ({safeActive + 1} of{' '}
          {count})
        </span>

        {count > 1 ? (
          <div className="flex items-center gap-1.5">
            <Button
              variant="ghost"
              size="sm"
              aria-label="Previous wafer"
              disabled={safeActive === 0}
              onClick={() => onSelectWafer(Math.max(0, safeActive - 1))}
              className="h-7 px-2.5 font-mono text-[12px]"
            >
              ← Prev
            </Button>
            <Button
              variant="ghost"
              size="sm"
              aria-label="Next wafer"
              disabled={safeActive >= count - 1}
              onClick={() =>
                onSelectWafer(Math.min(count - 1, safeActive + 1))
              }
              className="h-7 px-2.5 font-mono text-[12px]"
            >
              Next →
            </Button>
          </div>
        ) : null}
      </div>

      <div
        role="radiogroup"
        aria-label="Select wafer"
        className="flex flex-wrap justify-center gap-1.5"
      >
        {wafers.map((wafer, idx) => {
          const isSelected = idx === safeActive;
          const metrics = byWaferYield[idx];
          const yieldLabel = formatYieldPct(metrics?.finalYield ?? null);

          return (
            <button
              key={`${wafer.waferId}-${wafer.waferIndex}`}
              ref={(el) => {
                pillRefs.current[idx] = el;
              }}
              type="button"
              role="radio"
              aria-checked={isSelected}
              aria-label={`Wafer ${wafer.waferId}, ${idx + 1} of ${count}, final yield ${yieldLabel}`}
              tabIndex={isSelected ? 0 : -1}
              onClick={() => onSelectWafer(idx)}
              onKeyDown={(e) => handleRadioKeyDown(e, idx)}
              className={`inline-flex h-7 min-w-[46px] cursor-pointer items-center justify-center gap-1 rounded-control border px-2 font-mono text-[12px] tabular-nums focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
                isSelected
                  ? 'border-accent bg-accent/12 font-medium text-text-primary'
                  : 'border-hairline bg-raised text-text-secondary hover:border-white/20 hover:text-text-primary'
              }`}
            >
              {isSelected ? (
                <span
                  aria-hidden="true"
                  className="h-1.5 w-1.5 rounded-full bg-accent"
                />
              ) : null}
              <span>{wafer.waferId}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
});
