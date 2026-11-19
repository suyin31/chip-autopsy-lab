'use client';

import { scaleLinear } from '@visx/scale';
import { Bar, Line } from '@visx/shape';
import { useReducedMotion } from 'motion/react';
import * as React from 'react';
import type {
  ParametricCapabilitySummary,
  ParametricHistogram as ParametricHistogramData,
  ParametricHistogramBin,
} from '@/core/analytics';
import { Untranslated, useT } from '@/ui/i18n';
import { cn } from '@/ui/primitives/cn';
import { readPrefersReducedMotionSync } from '@/ui/wafer-map/probe-sweep';
import {
  resolveLimitLabelAnchor,
  resolveScrubBinAtX,
} from './parametric-view';

export interface ParametricHistogramProps {
  readonly summary: ParametricCapabilitySummary;
  readonly histogram: ParametricHistogramData;
  readonly className?: string;
}

const DEFAULT_SVG_WIDTH = 320;
const PLOT_HEIGHT_PX = 148;
const TOP_MARKER_BAND_PX = 20;
const BOTTOM_AXIS_BAND_PX = 22;
const HORIZONTAL_INSET_PX = 8;
const TOTAL_SVG_HEIGHT_PX =
  TOP_MARKER_BAND_PX + PLOT_HEIGHT_PX + BOTTOM_AXIS_BAND_PX;

/**
 * Interactive parametric distribution histogram built on visx (`@visx/scale` + `@visx/shape`):
 * - Floating scrub readout lives strictly in the dedicated margin band ABOVE the SVG plot area
 *   so it never covers any plotted histogram bar (Requirement 8.5).
 * - Overlaid vertical dashed markers mark valid `LO_LIMIT` and `HI_LIMIT` positions paired with
 *   SI-formatted text labels using existing ink/neutral tokens (no stray ember, Req 8.2, 14.2).
 * - Supports pointer hover, pointer drag (`setPointerCapture`), and keyboard (`ArrowLeft` /
 *   `ArrowRight` / `Escape`) scrubbing with a vertical scrub rule.
 * - Bar height transitions animate compositor-only `transform: scaleY` and snap instantaneously
 *   (`0ms`) when `prefers-reduced-motion: reduce` is active (Req 14.5).
 */
export function ParametricHistogram({
  summary,
  histogram,
  className,
}: ParametricHistogramProps): React.JSX.Element {
  const { t, tPlural, formatInteger, formatParametricValue } = useT();
  const shouldReduceMotion = useReducedMotion();
  const reduced = readPrefersReducedMotionSync(shouldReduceMotion);

  const containerRef = React.useRef<HTMLDivElement>(null);
  const svgRef = React.useRef<SVGSVGElement>(null);
  const [measuredWidth, setMeasuredWidth] =
    React.useState<number>(DEFAULT_SVG_WIDTH);
  const [scrubBinIndex, setScrubBinIndex] = React.useState<number | null>(null);
  const draggingRef = React.useRef(false);

  // Reset scrub when switching tests or when bin array shrinks
  const prevTestNumRef = React.useRef(summary.testNum);
  if (prevTestNumRef.current !== summary.testNum) {
    prevTestNumRef.current = summary.testNum;
    if (scrubBinIndex !== null) {
      setScrubBinIndex(null);
    }
  }

  React.useEffect(() => {
    const el = containerRef.current;
    if (!el) return undefined;
    const update = (): void => {
      const next = Math.round(el.getBoundingClientRect().width);
      if (next >= 180) {
        setMeasuredWidth(next);
      }
    };
    update();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const svgWidth = Math.max(220, measuredWidth);
  const plotWidth = Math.max(120, svgWidth - HORIZONTAL_INSET_PX * 2);

  const hasData =
    histogram.n > 0 &&
    histogram.bins.length > 0 &&
    histogram.domainMin !== null &&
    histogram.domainMax !== null;

  const domainMin = histogram.domainMin ?? 0;
  const domainMax =
    histogram.domainMax !== null && histogram.domainMax > domainMin
      ? histogram.domainMax
      : domainMin + 1;

  const xScale = React.useMemo(
    () =>
      scaleLinear<number>({
        domain: [domainMin, domainMax],
        range: [0, plotWidth],
      }),
    [domainMin, domainMax, plotWidth],
  );

  const yScale = React.useMemo(
    () =>
      scaleLinear<number>({
        domain: [0, Math.max(1, histogram.maxBinCount)],
        range: [PLOT_HEIGHT_PX, 0],
      }),
    [histogram.maxBinCount],
  );

  const activeBin: ParametricHistogramBin | null =
    hasData && scrubBinIndex !== null
      ? (histogram.bins[
          Math.min(Math.max(0, scrubBinIndex), histogram.bins.length - 1)
        ] ?? null)
      : null;

  const updateScrubFromClientX = React.useCallback(
    (clientX: number): void => {
      const svg = svgRef.current;
      if (!svg || !hasData) return;
      const rect = svg.getBoundingClientRect();
      const localX = clientX - rect.left - HORIZONTAL_INSET_PX;
      const bin = resolveScrubBinAtX(histogram, localX, plotWidth);
      setScrubBinIndex(bin ? bin.index : null);
    },
    [hasData, histogram, plotWidth],
  );

  const handlePointerMove = React.useCallback(
    (event: React.PointerEvent<SVGRectElement>): void => {
      updateScrubFromClientX(event.clientX);
    },
    [updateScrubFromClientX],
  );

  const handlePointerDown = React.useCallback(
    (event: React.PointerEvent<SVGRectElement>): void => {
      if (event.button !== 0) return;
      draggingRef.current = true;
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        // Synthetic events in tests may not support pointer capture
      }
      updateScrubFromClientX(event.clientX);
    },
    [updateScrubFromClientX],
  );

  const handlePointerUp = React.useCallback(
    (event: React.PointerEvent<SVGRectElement>): void => {
      if (draggingRef.current) {
        draggingRef.current = false;
        try {
          event.currentTarget.releasePointerCapture(event.pointerId);
        } catch {
          // Ignore if already released
        }
      }
    },
    [],
  );

  const handlePointerLeave = React.useCallback((): void => {
    if (!draggingRef.current) {
      setScrubBinIndex(null);
    }
  }, []);

  const handleKeyDown = React.useCallback(
    (event: React.KeyboardEvent<SVGSVGElement>): void => {
      if (!hasData) return;
      const maxIdx = histogram.bins.length - 1;
      if (event.key === 'ArrowRight') {
        event.preventDefault();
        setScrubBinIndex((prev) =>
          prev === null ? 0 : Math.min(maxIdx, prev + 1),
        );
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault();
        setScrubBinIndex((prev) =>
          prev === null ? maxIdx : Math.max(0, prev - 1),
        );
      } else if (event.key === 'Home') {
        event.preventDefault();
        setScrubBinIndex(0);
      } else if (event.key === 'End') {
        event.preventDefault();
        setScrubBinIndex(maxIdx);
      } else if (event.key === 'Escape') {
        if (scrubBinIndex !== null) {
          event.preventDefault();
          setScrubBinIndex(null);
        }
      }
    },
    [hasData, histogram.bins.length, scrubBinIndex],
  );

  const formatVal = React.useCallback(
    (baseValue: number, scalExp = summary.displayScaleExp): string =>
      formatParametricValue(baseValue, summary.units, scalExp),
    [formatParametricValue, summary.units, summary.displayScaleExp],
  );

  const testLabel =
    summary.testName.length > 0
      ? summary.testName
      : `Test ${summary.testNum}`;

  const loX =
    hasData && histogram.loLimit !== null
      ? Math.max(0, Math.min(plotWidth, xScale(histogram.loLimit)))
      : null;
  const hiX =
    hasData && histogram.hiLimit !== null
      ? Math.max(0, Math.min(plotWidth, xScale(histogram.hiLimit)))
      : null;

  const scrubRuleX =
    activeBin !== null
      ? Math.max(
          0,
          Math.min(plotWidth, xScale((activeBin.x0 + activeBin.x1) / 2)),
        )
      : null;

  const barTransitionDuration = reduced ? '0ms' : '160ms';

  return (
    <div
      ref={containerRef}
      data-testid="parametric-histogram"
      data-test-num={summary.testNum}
      data-reduced-motion={reduced ? 'true' : 'false'}
      className={cn('mt-5 min-w-0 w-full', className)}
    >
      {/* Margin readout placed strictly above the SVG plot area so it never covers bars (Req 8.5) */}
      <div
        data-testid="parametric-scrub-readout"
        data-scrubbing={activeBin !== null ? 'true' : 'false'}
        aria-live="polite"
        className="mb-2 flex min-h-7 flex-wrap items-baseline justify-between gap-x-3 gap-y-1"
      >
        <span className="flex min-w-0 items-baseline gap-2">
          <Untranslated className="truncate type-row-title text-text-primary">
            {testLabel}
          </Untranslated>
          <Untranslated className="shrink-0 font-mono-id type-caption text-text-tertiary">
            #{summary.testNum}
          </Untranslated>
        </span>

        <span
          data-testid="parametric-scrub-value"
          className={cn(
            'type-subhead tabular-nums',
            activeBin !== null ? 'text-text-primary' : 'text-text-secondary',
          )}
        >
          {activeBin !== null
            ? t('parametric.scrubRange', {
                lo: formatVal(activeBin.x0),
                hi: formatVal(activeBin.x1),
                dies: tPlural('findings.dieCount', activeBin.count),
              })
            : summary.mean !== null
              ? t('parametric.scrubIdle', {
                  mean: formatVal(summary.mean),
                  sigma:
                    summary.sigma !== null
                      ? formatVal(summary.sigma)
                      : t('parametric.na'),
                  n: formatInteger(summary.n),
                })
              : t('parametric.empty')}
        </span>
      </div>

      {!hasData ? (
        <p
          data-testid="parametric-histogram-empty"
          className="py-8 text-center type-callout text-text-secondary"
        >
          {t('parametric.empty')}
        </p>
      ) : (
        <div
          data-testid="parametric-plot-area"
          className="relative w-full select-none"
        >
          <svg
            ref={svgRef}
            role="img"
            tabIndex={0}
            aria-label={t('parametric.histogramAria', {
              test: testLabel,
              n: formatInteger(histogram.n),
            })}
            height={TOTAL_SVG_HEIGHT_PX}
            viewBox={`0 0 ${svgWidth} ${TOTAL_SVG_HEIGHT_PX}`}
            onKeyDown={handleKeyDown}
            onBlur={() => setScrubBinIndex(null)}
            className="block w-full max-w-full overflow-visible rounded-md focus-visible:shadow-focus-ring focus-visible:outline-none"
          >
            <g
              transform={`translate(${HORIZONTAL_INSET_PX}, ${TOP_MARKER_BAND_PX})`}
            >
              {/* Baseline hairline */}
              <Line
                from={{ x: 0, y: PLOT_HEIGHT_PX }}
                to={{ x: plotWidth, y: PLOT_HEIGHT_PX }}
                stroke="var(--hairline-strong)"
                strokeWidth={1}
              />

              {/* Histogram bars */}
              {histogram.bins.map((bin) => {
                const xStart = xScale(bin.x0);
                const xEnd = xScale(bin.x1);
                const rawW = Math.max(2, xEnd - xStart);
                const gap = rawW > 4 ? 1.5 : 0.5;
                const barW = Math.max(1.5, rawW - gap);
                const barH = Math.max(
                  bin.count > 0 ? 2 : 0,
                  PLOT_HEIGHT_PX - yScale(bin.count),
                );
                const scaleY = barH / PLOT_HEIGHT_PX;
                const isScrubbed = activeBin?.index === bin.index;
                const fill = isScrubbed
                  ? 'var(--ink)'
                  : bin.outOfSpec
                    ? 'var(--text-secondary)'
                    : 'var(--bar-neutral)';

                return (
                  <g
                    key={bin.index}
                    data-testid="parametric-histogram-bar"
                    data-bin-index={bin.index}
                    data-out-of-spec={bin.outOfSpec ? 'true' : undefined}
                    data-active={isScrubbed ? 'true' : undefined}
                    style={{
                      transformBox: 'fill-box',
                      transformOrigin: 'center bottom',
                      transform: `scaleY(${scaleY})`,
                      transitionProperty: reduced ? 'none' : 'transform, opacity',
                      transitionDuration: barTransitionDuration,
                      transitionTimingFunction: 'var(--ease-out)',
                    }}
                  >
                    <Bar
                      x={xStart + gap / 2}
                      y={0}
                      width={barW}
                      height={PLOT_HEIGHT_PX}
                      rx={2}
                      fill={fill}
                      fillOpacity={
                        isScrubbed ? 1 : bin.outOfSpec ? 0.65 : 0.9
                      }
                    />
                  </g>
                );
              })}

              {/* LO_LIMIT vertical dashed marker with non-color text label (Req 8.2, 14.2) */}
              {loX !== null && histogram.loLimit !== null ? (
                <g data-testid="parametric-limit-lo">
                  <Line
                    from={{ x: loX, y: 0 }}
                    to={{ x: loX, y: PLOT_HEIGHT_PX }}
                    stroke="var(--ink)"
                    strokeWidth={1.5}
                    strokeDasharray="4 3"
                  />
                  <text
                    x={loX}
                    y={-6}
                    textAnchor={resolveLimitLabelAnchor(loX, plotWidth)}
                    fill="var(--text-primary)"
                    className="type-caption tabular-nums"
                  >
                    {t('parametric.limitLo', {
                      value: formatVal(histogram.loLimit, summary.llmScal),
                    })}
                  </text>
                </g>
              ) : null}

              {/* HI_LIMIT vertical dashed marker with non-color text label (Req 8.2, 14.2) */}
              {hiX !== null && histogram.hiLimit !== null ? (
                <g data-testid="parametric-limit-hi">
                  <Line
                    from={{ x: hiX, y: 0 }}
                    to={{ x: hiX, y: PLOT_HEIGHT_PX }}
                    stroke="var(--ink)"
                    strokeWidth={1.5}
                    strokeDasharray="4 3"
                  />
                  <text
                    x={hiX}
                    y={-6}
                    textAnchor={resolveLimitLabelAnchor(hiX, plotWidth)}
                    fill="var(--text-primary)"
                    className="type-caption tabular-nums"
                  >
                    {t('parametric.limitHi', {
                      value: formatVal(histogram.hiLimit, summary.hlmScal),
                    })}
                  </text>
                </g>
              ) : null}

              {/* Vertical scrub rule (Req 8.5) */}
              {scrubRuleX !== null ? (
                <rect
                  data-testid="parametric-scrub-rule"
                  x={scrubRuleX - 0.75}
                  y={0}
                  width={1.5}
                  height={PLOT_HEIGHT_PX}
                  fill="var(--text-primary)"
                  pointerEvents="none"
                />
              ) : null}

              {/* X-axis domain endpoints */}
              <text
                x={0}
                y={PLOT_HEIGHT_PX + 16}
                textAnchor="start"
                fill="var(--text-tertiary)"
                className="type-caption tabular-nums"
              >
                {formatVal(domainMin)}
              </text>
              <text
                x={plotWidth}
                y={PLOT_HEIGHT_PX + 16}
                textAnchor="end"
                fill="var(--text-tertiary)"
                className="type-caption tabular-nums"
              >
                {formatVal(domainMax)}
              </text>

              {/* Transparent pointer hit-layer for hover and drag scrubbing */}
              <rect
                data-testid="parametric-scrub-overlay"
                x={0}
                y={0}
                width={plotWidth}
                height={PLOT_HEIGHT_PX}
                fill="transparent"
                className="cursor-crosshair"
                onPointerMove={handlePointerMove}
                onPointerDown={handlePointerDown}
                onPointerUp={handlePointerUp}
                onPointerCancel={handlePointerUp}
                onPointerLeave={handlePointerLeave}
              />
            </g>
          </svg>

          {/* Accessible tabular summary for screen readers (Req 14.4) */}
          <table className="sr-only">
            <caption>
              {t('parametric.histogramAria', {
                test: testLabel,
                n: formatInteger(histogram.n),
              })}
            </caption>
            <tbody>
              {histogram.bins.map((bin) => (
                <tr key={bin.index}>
                  <th>
                    {formatVal(bin.x0)} – {formatVal(bin.x1)}
                  </th>
                  <td>{tPlural('findings.dieCount', bin.count)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
