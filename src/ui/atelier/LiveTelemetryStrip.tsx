'use client';

import { ArrowUpRight } from 'lucide-react';
import { motion } from 'motion/react';
import Link from 'next/link';
import * as React from 'react';
import { Untranslated, useT } from '@/ui/i18n';
import {
  LANDING_IDDQ_HI_LIMIT_UA,
  LANDING_IDDQ_MAX_BIN_COUNT,
  LANDING_IDDQ_MEAN_UA,
  LANDING_IDDQ_SPECTRUM_BINS,
  LANDING_TELEMETRY_LENSES,
} from '@/ui/layout/landing-layout';
import {
  computeTouchGrowDelayMs,
  SPRING_TACTILE,
  TOUCH_BUS_PULSE_MS,
  TOUCH_GROW_DURATION_MS,
  useReducedMotionPreference,
  useTapPulse,
  useTouchGrowOnEnter,
  useTouchReveal,
} from '@/ui/motion';
import { Button, cn, SlidingNumber } from '@/ui/primitives';
import { PulseBusSvg } from './PulseBusSvg';

/**
 * 12-Column Full-Width Frameless Interactive Telemetry Strip (`src/ui/atelier/LiveTelemetryStrip.tsx`, UI v3).
 *
 * Replaces the two mid-page wobbling capability Bento boxes with an open-bench horizontal
 * instrument strip bounded only by crisp 1px hairlines and micrometer ticks (`.at-ruler`):
 * - Left (cols 1-4): Fluid `layoutId` query-lens slider + oversized `SlidingNumber` spring odometer.
 * - Center (cols 5-9): Wide 28-bin `IDDQ_LEAK` parametric spectrum (`#204`, `HI 15.0 uA`) with
 *   diagonal out-of-spec hatching and live pointer-scrubbing crosshair readout.
 * - Right (cols 10-12): Frameless 4-specialist SVG signal bus + `⌘K` direct jump to `/agents`.
 *
 * Strictly zero `ember` substrings in markup, zero `bg-ink` buttons, zero nested card frames.
 */

const SPECIALIST_ROLES = [
  'agents.role.autopsy_conductor',
  'agents.role.lot_analyst',
  'agents.role.pattern_pathologist',
  'agents.role.evidence_auditor',
] as const;

const SVG_W = 360;
const SVG_H = 88;
const PLOT_LEFT = 4;
const PLOT_RIGHT = SVG_W - 4;
const PLOT_W = PLOT_RIGHT - PLOT_LEFT;
const PLOT_TOP = 8;
const PLOT_BOTTOM = 78;
const PLOT_H = PLOT_BOTTOM - PLOT_TOP;

const DOMAIN_MIN_UA = LANDING_IDDQ_SPECTRUM_BINS[0]!.loUa;
const DOMAIN_MAX_UA =
  LANDING_IDDQ_SPECTRUM_BINS[LANDING_IDDQ_SPECTRUM_BINS.length - 1]!.hiUa;

function toSvgX(ua: number): number {
  const ratio = (ua - DOMAIN_MIN_UA) / (DOMAIN_MAX_UA - DOMAIN_MIN_UA);
  return Number((PLOT_LEFT + Math.min(1, Math.max(0, ratio)) * PLOT_W).toFixed(2));
}

function visualBarHeight(count: number): number {
  if (count <= 0) return 0;
  // Square-root amplitude keeps both the 7,706 nominal die mode and the 293-die outer-ring
  // excursion mode legible on one forensic instrument scale while scrub displays exact integer counts.
  const norm = Math.sqrt(count / LANDING_IDDQ_MAX_BIN_COUNT);
  return Number(Math.max(3, norm * PLOT_H).toFixed(2));
}

export interface LiveTelemetryStripProps {
  readonly disabled?: boolean;
  readonly onOpenSample: () => void;
}

export function LiveTelemetryStrip({
  disabled = false,
  onOpenSample,
}: LiveTelemetryStripProps): React.JSX.Element {
  const { t, tPlural } = useT();
  const reduced = useReducedMotionPreference();
  const hatchId = React.useId().replace(/:/g, '');

  const [lensIdx, setLensIdx] = React.useState(0);
  const [scrubIdx, setScrubIdx] = React.useState<number | null>(null);
  const [activeSpec, setActiveSpec] = React.useState(0);
  const [hoveredBus, setHoveredBus] = React.useState(false);
  const svgRef = React.useRef<SVGSVGElement | null>(null);
  const zonesRef = React.useRef<HTMLDivElement | null>(null);
  const scrubPointerRef = React.useRef<number | null>(null);

  // Touch: the three zones rise in once, the spectrum grows from its baseline left to right,
  // and a tapped specialist lights the signal bus for a moment instead of on hover.
  useTouchReveal(zonesRef, { selector: ':scope > div' });
  const growPhase = useTouchGrowOnEnter(svgRef, LANDING_IDDQ_SPECTRUM_BINS.length);
  const [busPulse, triggerBusPulse] = useTapPulse(TOUCH_BUS_PULSE_MS);

  const lens = LANDING_TELEMETRY_LENSES[lensIdx] ?? LANDING_TELEMETRY_LENSES[0]!;
  const scrubbedBin =
    scrubIdx !== null ? (LANDING_IDDQ_SPECTRUM_BINS[scrubIdx] ?? null) : null;

  const hiLimitX = toSvgX(LANDING_IDDQ_HI_LIMIT_UA);

  const scrubAt = (clientX: number): void => {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    if (rect.width <= 0) return;
    const relX = (clientX - rect.left) / rect.width;
    const idx = Math.min(
      LANDING_IDDQ_SPECTRUM_BINS.length - 1,
      Math.max(0, Math.floor(relX * LANDING_IDDQ_SPECTRUM_BINS.length)),
    );
    setScrubIdx(idx);
  };

  const handleSpectrumMove = (event: React.PointerEvent<SVGSVGElement>): void => {
    // A finger scrubs only while it is down; a mouse scrubs on hover.
    if (event.pointerType === 'touch' && scrubPointerRef.current !== event.pointerId) return;
    scrubAt(event.clientX);
  };

  // Touch: tap or drag sideways to place the crosshair; the reading stays after the finger lifts.
  const handleSpectrumDown = (event: React.PointerEvent<SVGSVGElement>): void => {
    if (event.pointerType !== 'touch') return;
    scrubPointerRef.current = event.pointerId;
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Synthetic events may not support capture
    }
    scrubAt(event.clientX);
  };

  const handleSpectrumUp = (event: React.PointerEvent<SVGSVGElement>): void => {
    if (scrubPointerRef.current === event.pointerId) scrubPointerRef.current = null;
  };

  const handleSpectrumLeave = (event: React.PointerEvent<SVGSVGElement>): void => {
    if (event.pointerType === 'touch') return;
    setScrubIdx(null);
  };

  return (
    <section
      data-testid="landing-telemetry-strip"
      aria-label={`${t('pareto.title')} · ${t('parametric.title')}`}
      className="at-ruler mt-12 py-6 lg:mt-16 lg:py-7"
    >
      <div
        ref={zonesRef}
        className="grid grid-cols-1 gap-7 lg:grid-cols-12 lg:items-center lg:gap-7"
      >
        {/* Zone 1 (cols 1-4): Fluid Lens Capsule Slider + Oversized Spring Odometer */}
        <div className="flex min-w-0 flex-col justify-between gap-3 lg:col-span-4">
          <div
            role="group"
            aria-label={t('pareto.title')}
            className="flex flex-wrap items-center gap-1"
          >
            {LANDING_TELEMETRY_LENSES.map((item, idx) => {
              const active = idx === lensIdx;
              return (
                <button
                  key={item.id}
                  type="button"
                  aria-pressed={active}
                  data-testid={`telemetry-lens-${item.id}`}
                  onPointerEnter={() => setLensIdx(idx)}
                  onClick={() => setLensIdx(idx)}
                  className={cn(
                    'relative cursor-pointer touch-manipulation rounded-pill px-2.5 py-1 font-mono text-[11px] leading-none',
                    'transition-[color,scale,transform] duration-150 ease-[var(--ease-out)] active:scale-[0.97] motion-reduce:active:scale-100',
                    'focus-visible:shadow-focus-ring focus-visible:outline-none',
                    active
                      ? 'font-[540] text-text-primary'
                      : 'text-text-tertiary [@media(hover:hover)]:hover:text-text-primary',
                  )}
                >
                  {active ? (
                    <motion.span
                      layoutId="landing-telemetry-lens-pill"
                      aria-hidden="true"
                      transition={reduced ? { duration: 0 } : SPRING_TACTILE}
                      className="pointer-events-none absolute inset-0 rounded-pill bg-fill-2 shadow-[inset_0_0_0_1px_var(--chroma-line)]"
                    />
                  ) : null}
                  <Untranslated className="relative z-[1]">{item.query}</Untranslated>
                </button>
              );
            })}
          </div>

          <div className="flex items-baseline justify-between gap-4 pt-1">
            <div className="min-w-0">
              <SlidingNumber
                text={lens.diesFormatted}
                className="at-display text-[clamp(42px,4.2vw,54px)] leading-none tracking-[-0.036em] text-text-primary"
              />
              <span className="mt-1.5 flex items-center gap-2 text-[12px] text-text-tertiary">
                <span>{t('legend.failed')}</span>
                <span aria-hidden="true">·</span>
                <Untranslated className="font-mono text-[11px] text-text-secondary">
                  {lens.lotCode}
                </Untranslated>
              </span>
            </div>

            <div className="flex shrink-0 flex-col items-end gap-1 text-right tabular-nums">
              <Untranslated className="at-kpi-number text-[20px] text-text-primary">
                {lens.primaryStat}
              </Untranslated>
              <Untranslated className="font-mono text-[11px] text-text-tertiary">
                {lens.secondaryStat}
              </Untranslated>
            </div>
          </div>

          <div className="flex items-center justify-between pt-0.5">
            <Button
              variant="text"
              onClick={onOpenSample}
              disabled={disabled}
              data-testid="telemetry-open-sample"
            >
              {t('landing.example.action')}
            </Button>
          </div>
        </div>

        {/* Zone 2 (cols 5-9): Wide Frameless Interactive 28-Bin IDDQ_LEAK Spectrum + Crosshair Scrub */}
        <div className="min-w-0 border-y border-hairline py-5 lg:col-span-5 lg:border-x lg:border-y-0 lg:px-6 lg:py-0">
          <div
            aria-live="polite"
            className="mb-2 flex flex-wrap items-baseline justify-between gap-2 text-[11.5px] tabular-nums"
          >
            <span className="inline-flex items-center gap-1.5">
              <span aria-hidden="true" className="at-dot-signal size-1.5 rounded-full" />
              <Untranslated className="font-mono font-[500] text-text-primary">
                IDDQ_LEAK
              </Untranslated>
              <Untranslated className="font-mono text-text-tertiary">#204</Untranslated>
            </span>

            <span
              data-testid="telemetry-spectrum-readout"
              className="font-mono text-[11px] text-text-secondary"
            >
              {scrubbedBin !== null ? (
                <>
                  <Untranslated>
                    {`${scrubbedBin.loUa.toFixed(1)}–${scrubbedBin.hiUa.toFixed(1)} uA · `}
                  </Untranslated>
                  <span>{tPlural('findings.dieCount', scrubbedBin.count)}</span>
                </>
              ) : (
                <Untranslated>
                  {`mean ${LANDING_IDDQ_MEAN_UA} uA · HI ${LANDING_IDDQ_HI_LIMIT_UA.toFixed(1)} uA`}
                </Untranslated>
              )}
            </span>
          </div>

          <svg
            ref={svgRef}
            role="img"
            aria-label="IDDQ_LEAK parametric distribution"
            data-testid="telemetry-spectrum-svg"
            viewBox={`0 0 ${SVG_W} ${SVG_H}`}
            onPointerMove={handleSpectrumMove}
            onPointerDown={handleSpectrumDown}
            onPointerUp={handleSpectrumUp}
            onPointerCancel={handleSpectrumUp}
            onPointerLeave={handleSpectrumLeave}
            style={{ touchAction: 'pan-y' }}
            className="block h-[88px] w-full cursor-crosshair select-none overflow-visible"
          >
            <defs>
              <pattern
                id={hatchId}
                width="5"
                height="5"
                patternTransform="rotate(45 0 0)"
                patternUnits="userSpaceOnUse"
              >
                <rect width="5" height="5" className="at-fill-signal-soft" />
                <line
                  x1="0"
                  y1="0"
                  x2="0"
                  y2="5"
                  className="at-stroke-signal"
                  strokeWidth="1.4"
                />
              </pattern>
            </defs>

            {/* Subtle out-of-spec limit curtain past HI 15.0 uA */}
            <rect
              x={hiLimitX}
              y={PLOT_TOP}
              width={Math.max(0, PLOT_RIGHT - hiLimitX)}
              height={PLOT_H}
              fill="var(--chroma-soft)"
              opacity="0.38"
              rx="2"
            />

            {/* Baseline */}
            <line
              x1={PLOT_LEFT}
              y1={PLOT_BOTTOM}
              x2={PLOT_RIGHT}
              y2={PLOT_BOTTOM}
              stroke="var(--hairline-strong)"
              strokeWidth="1"
            />

            {/* 28 real engine histogram bars */}
            {LANDING_IDDQ_SPECTRUM_BINS.map((bin, idx) => {
              const x0 = toSvgX(bin.loUa);
              const x1 = toSvgX(bin.hiUa);
              const w = Math.max(2.2, x1 - x0 - 1.6);
              const h = visualBarHeight(bin.count);
              const y = PLOT_BOTTOM - h;
              const isScrubbed = scrubIdx === idx;

              const dimForLens =
                (lens.spectrumFocus === 'excursion' && !bin.outOfSpec) ||
                (lens.spectrumFocus === 'nominal' && bin.outOfSpec);

              const targetScaleY =
                lens.spectrumFocus === 'excursion' && bin.outOfSpec && bin.count > 0
                  ? Math.min(1.38, (PLOT_H * 0.85) / Math.max(8, h))
                  : dimForLens
                    ? 0.72
                    : 1;

              const opacity = isScrubbed
                ? 1
                : dimForLens
                  ? 0.28
                  : bin.outOfSpec
                    ? 0.95
                    : 0.82;

              const growing = growPhase === 'growing';
              return (
                <g
                  key={idx}
                  style={{
                    transformBox: 'fill-box',
                    transformOrigin: 'center bottom',
                    transform:
                      growPhase === 'hidden'
                        ? 'scaleY(0)'
                        : `scaleY(${Number(targetScaleY.toFixed(3))})`,
                    opacity,
                    transitionProperty:
                      reduced || growPhase === 'hidden' ? 'none' : 'transform, opacity',
                    transitionDuration: reduced
                      ? '0ms'
                      : growing
                        ? `${TOUCH_GROW_DURATION_MS}ms`
                        : '220ms',
                    transitionDelay: growing
                      ? `${computeTouchGrowDelayMs(idx, LANDING_IDDQ_SPECTRUM_BINS.length)}ms`
                      : undefined,
                    transitionTimingFunction: 'var(--ease-out)',
                  }}
                >
                  {h > 0 ? (
                    <rect
                      x={Number((x0 + 0.8).toFixed(2))}
                      y={y}
                      width={Number(w.toFixed(2))}
                      height={h}
                      rx="1.5"
                      fill={
                        isScrubbed
                          ? 'var(--text-primary)'
                          : bin.outOfSpec
                            ? `url(#${hatchId})`
                            : 'var(--chroma)'
                      }
                    />
                  ) : null}
                </g>
              );
            })}

            {/* HI_LIMIT 15.0 uA vertical dashed datum */}
            <line
              x1={hiLimitX}
              y1={PLOT_TOP - 2}
              x2={hiLimitX}
              y2={PLOT_BOTTOM}
              stroke="var(--text-secondary)"
              strokeWidth="1.2"
              strokeDasharray="3 2.5"
            />
            <text
              x={hiLimitX + 4}
              y={PLOT_TOP + 6}
              fill="var(--text-tertiary)"
              fontSize="9.5"
              fontFamily="var(--font-mono)"
            >
              HI 15 uA
            </text>

            {/* Interactive pointer crosshair cursor */}
            {scrubbedBin !== null && scrubIdx !== null ? (() => {
              const cx = toSvgX((scrubbedBin.loUa + scrubbedBin.hiUa) / 2);
              const bh = visualBarHeight(scrubbedBin.count);
              const cy = PLOT_BOTTOM - bh;
              return (
                <g pointerEvents="none" data-testid="telemetry-spectrum-crosshair">
                  <line
                    x1={cx}
                    y1={PLOT_TOP}
                    x2={cx}
                    y2={PLOT_BOTTOM}
                    stroke="var(--text-primary)"
                    strokeWidth="1"
                  />
                  <line
                    x1={PLOT_LEFT}
                    y1={cy}
                    x2={PLOT_RIGHT}
                    y2={cy}
                    stroke="var(--hairline-strong)"
                    strokeWidth="1"
                    strokeDasharray="2 2"
                  />
                  <circle
                    cx={cx}
                    cy={cy}
                    r="2.8"
                    fill={scrubbedBin.outOfSpec ? 'var(--failure)' : 'var(--chroma)'}
                  />
                </g>
              );
            })() : null}
          </svg>
        </div>

        {/* Zone 3 (cols 10-12): Frameless 4-Specialist SVG Signal Bus + Direct `/agents` Jump */}
        <div
          onPointerEnter={() => setHoveredBus(true)}
          onPointerLeave={() => setHoveredBus(false)}
          className="flex min-w-0 flex-col justify-between gap-3 lg:col-span-3"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-[12px] font-[540] text-text-primary">
              {t('nav.agent')}
            </span>
            <Untranslated className="font-mono text-[10.5px] text-text-tertiary">
              01–04
            </Untranslated>
          </div>

          <PulseBusSvg
            variant="mesh"
            activeIndex={activeSpec}
            active={hoveredBus || busPulse}
            className="my-0.5"
          />

          <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
            {SPECIALIST_ROLES.map((roleKey, idx) => {
              const isLit = idx === activeSpec;
              return (
                <button
                  key={roleKey}
                  type="button"
                  aria-pressed={isLit}
                  onPointerEnter={() => setActiveSpec(idx)}
                  onFocus={() => setActiveSpec(idx)}
                  onPointerDown={(event) => {
                    // A tap has no hover; light the bus toward the tapped role for a moment
                    if (event.pointerType === 'touch') triggerBusPulse();
                  }}
                  onClick={() => setActiveSpec(idx)}
                  className={cn(
                    'flex min-w-0 cursor-pointer touch-manipulation items-center gap-1.5 rounded-sm py-0.5 text-left',
                    'transition-[color,opacity] duration-150 ease-[var(--ease-out)]',
                    'focus-visible:shadow-focus-ring focus-visible:outline-none',
                    isLit ? 'text-text-primary' : 'text-text-tertiary hover:text-text-secondary',
                  )}
                >
                  <span
                    aria-hidden="true"
                    className={cn(
                      'size-1.5 shrink-0 rounded-full',
                      idx === 0
                        ? 'at-dot-signal'
                        : isLit
                          ? 'at-dot-iris'
                          : 'bg-text-disabled',
                    )}
                  />
                  <span className="truncate text-[12px] font-[500]">{t(roleKey)}</span>
                </button>
              );
            })}
          </div>

          <Link
            href="/agents"
            data-testid="telemetry-agents-link"
            className={cn(
              'group/agentlink mt-1 inline-flex items-center justify-between gap-2 border-t border-hairline pt-2.5 text-text-secondary no-underline',
              'transition-[color] duration-150 ease-[var(--ease-out)] hover:text-text-primary',
              'focus-visible:shadow-focus-ring focus-visible:outline-none rounded-sm',
            )}
          >
            <span className="flex min-w-0 items-center gap-2">
              <Untranslated className="at-keycap-badge">⌘K</Untranslated>
              <span className="truncate type-subhead">{t('agents.empty.headline')}</span>
            </span>
            <ArrowUpRight
              aria-hidden="true"
              className="size-4 shrink-0 text-text-tertiary transition-transform duration-200 ease-[var(--ease-out)] group-hover/agentlink:translate-x-0.5 group-hover/agentlink:-translate-y-0.5 group-hover/agentlink:text-text-primary"
            />
          </Link>
        </div>
      </div>
    </section>
  );
}
