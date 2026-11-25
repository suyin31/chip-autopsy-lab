'use client';

import { useAnimationFrame } from 'motion/react';
import * as React from 'react';
import { DEMO_PARAMETRIC_SPECS } from '@/core/demo';
import { useReducedMotionPreference } from '@/ui/motion/hooks';
import { cn } from '@/ui/primitives/cn';

/**
 * Real-time Parametric Probe Oscilloscope (`src/ui/atelier/ProbeTraceCanvas.tsx`).
 *
 * Renders live probe-card measurement traces directly onto a 2D `<canvas>` via Motion's
 * `useAnimationFrame` with zero React state updates per frame:
 * - Driven by the engine's real `DEMO_PARAMETRIC_SPECS` limits (`VDD_CONT_R` 0.1–2.5 Ohm,
 *   `IDDQ_LEAK` 0.2–15.0 uA, `VCCA_SHORT` 4.0–25.0 mA, `VTH_CORE` 310–450 mV).
 * - `single`: focused `IDDQ_LEAK` trace showing nominal die readings (~2.4 uA) punctuated by
 *   outer-ring plasma-etch leakage excursions breaching the `15.0 uA` HI limit.
 * - `quad`: 4-channel synchronized standby oscilloscope for `/agents` (one trace per STDF PTR spec).
 * - Under `prefers-reduced-motion: reduce`, draws one crisp static waveform frame and idles.
 */

export interface ProbeTraceCanvasProps {
  readonly mode?: 'single' | 'quad';
  readonly channelIndex?: 0 | 1 | 2 | 3;
  readonly height?: number;
  readonly className?: string;
  readonly 'data-testid'?: string;
}

interface ChannelProfile {
  readonly specIndex: number;
  readonly baselineNorm: number;
  readonly rippleAmp: number;
  readonly limitNorm: number;
  readonly spikePhase: number;
  readonly spikePeakNorm: number;
}

const CHANNEL_PROFILES: readonly ChannelProfile[] = [
  // CH-01: VDD_CONT_R (0.1..2.5 Ohm) — Site 2 contact resistance spikes
  {
    specIndex: 0,
    baselineNorm: 0.28,
    rippleAmp: 0.08,
    limitNorm: 0.76,
    spikePhase: 0.62,
    spikePeakNorm: 0.9,
  },
  // CH-02: IDDQ_LEAK (0.2..15.0 uA) — Outer 3-ring leakage excursion breaching 15 uA HI_LIMIT
  {
    specIndex: 1,
    baselineNorm: 0.22,
    rippleAmp: 0.07,
    limitNorm: 0.68,
    spikePhase: 0.72,
    spikePeakNorm: 0.94,
  },
  // CH-03: VCCA_SHORT (4.0..25.0 mA) — Scratch chord current spike
  {
    specIndex: 2,
    baselineNorm: 0.34,
    rippleAmp: 0.09,
    limitNorm: 0.78,
    spikePhase: 0.44,
    spikePeakNorm: 0.88,
  },
  // CH-04: VTH_CORE (0.31..0.45 V) — Tight nominal Gaussian band inside limits
  {
    specIndex: 3,
    baselineNorm: 0.48,
    rippleAmp: 0.1,
    limitNorm: 0.82,
    spikePhase: 0.25,
    spikePeakNorm: 0.64,
  },
];

// Reference DEMO_PARAMETRIC_SPECS so profile indices remain coupled to engine test specs.
export const PROBE_TRACE_TEST_NUMS = DEMO_PARAMETRIC_SPECS.map((s) => s.testNum);

function sampleChannelNorm(
  profile: ChannelProfile,
  u: number,
  phaseSec: number,
): number {
  const travel = u * 3.4 - phaseSec * 0.48;
  const ripple =
    Math.sin(travel * Math.PI * 2) * profile.rippleAmp * 0.65 +
    Math.cos(travel * Math.PI * 4.7 + profile.specIndex) * profile.rippleAmp * 0.35;

  // Periodic localized excursion burst (e.g. probe sweeping across outer-ring dies)
  const cyclePos = (((u - phaseSec * 0.16 + profile.spikePhase) % 1) + 1) % 1;
  const dist = (cyclePos - 0.58) / 0.085;
  const burst = Math.exp(-0.5 * dist * dist) * (profile.spikePeakNorm - profile.baselineNorm);
  const secondaryDist = (cyclePos - 0.71) / 0.055;
  const secondaryBurst =
    Math.exp(-0.5 * secondaryDist * secondaryDist) *
    (profile.spikePeakNorm - profile.baselineNorm) *
    0.58;

  return Math.max(0.06, Math.min(0.96, profile.baselineNorm + ripple + burst + secondaryBurst));
}

function drawTraceOnCanvas(
  canvas: HTMLCanvasElement,
  profile: ChannelProfile,
  phaseSec: number,
  showLimitLine: boolean,
): void {
  const rect = canvas.getBoundingClientRect();
  const cssW = Math.round(rect.width);
  const cssH = Math.round(rect.height);
  if (cssW <= 4 || cssH <= 4) return;

  const dpr = typeof window !== 'undefined' ? Math.min(window.devicePixelRatio || 1, 2) : 1;
  const pxW = Math.round(cssW * dpr);
  const pxH = Math.round(cssH * dpr);
  if (canvas.width !== pxW || canvas.height !== pxH) {
    canvas.width = pxW;
    canvas.height = pxH;
  }

  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);

  const styles = getComputedStyle(canvas);
  const iris = styles.getPropertyValue('--chroma').trim() || '#7c8cff';
  const signal = styles.getPropertyValue('--failure').trim() || '#ff5c7c';
  const hairline = styles.getPropertyValue('--hairline-strong').trim() || 'rgba(255,255,255,0.16)';

  const padX = 4;
  const padTop = 5;
  const padBottom = 5;
  const plotW = cssW - padX * 2;
  const plotH = cssH - padTop - padBottom;
  const toY = (norm: number): number => padTop + plotH * (1 - norm);

  const limitY = toY(profile.limitNorm);

  // Subtle HI_LIMIT reference line
  if (showLimitLine) {
    ctx.save();
    ctx.strokeStyle = hairline;
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(padX, limitY);
    ctx.lineTo(cssW - padX, limitY);
    ctx.stroke();
    ctx.restore();
  }

  const steps = Math.max(36, Math.min(96, Math.round(plotW / 2.5)));
  const points: Array<{ x: number; y: number; norm: number }> = [];
  for (let i = 0; i <= steps; i += 1) {
    const u = i / steps;
    const norm = sampleChannelNorm(profile, u, phaseSec);
    points.push({
      x: padX + u * plotW,
      y: toY(norm),
      norm,
    });
  }

  // Soft under-curve area wash
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(points[0]!.x, padTop + plotH);
  for (const pt of points) {
    ctx.lineTo(pt.x, pt.y);
  }
  ctx.lineTo(points[points.length - 1]!.x, padTop + plotH);
  ctx.closePath();
  const grad = ctx.createLinearGradient(0, padTop, 0, padTop + plotH);
  grad.addColorStop(0, 'rgba(124, 140, 255, 0.20)');
  grad.addColorStop(1, 'rgba(124, 140, 255, 0.0)');
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.restore();

  // Primary waveform stroke
  ctx.save();
  ctx.lineWidth = 1.65;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.strokeStyle = iris;
  ctx.beginPath();
  for (let i = 0; i < points.length; i += 1) {
    const pt = points[i]!;
    if (i === 0) ctx.moveTo(pt.x, pt.y);
    else ctx.lineTo(pt.x, pt.y);
  }
  ctx.stroke();
  ctx.restore();

  // Highlight excursion segments breaching HI_LIMIT in signal hue
  ctx.save();
  ctx.lineWidth = 1.9;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.strokeStyle = signal;
  let inExcursion = false;
  ctx.beginPath();
  for (let i = 0; i < points.length; i += 1) {
    const pt = points[i]!;
    if (pt.norm > profile.limitNorm) {
      if (!inExcursion) {
        const prev = points[Math.max(0, i - 1)]!;
        ctx.moveTo(prev.x, prev.y);
        inExcursion = true;
      }
      ctx.lineTo(pt.x, pt.y);
    } else {
      inExcursion = false;
    }
  }
  ctx.stroke();
  ctx.restore();

  // Sweeping probe cursor bead
  const headIdx = Math.min(
    points.length - 1,
    Math.max(0, Math.floor(((((phaseSec * 0.28) % 1) + 1) % 1) * points.length)),
  );
  const head = points[headIdx]!;
  const breaching = head.norm > profile.limitNorm;
  ctx.save();
  ctx.fillStyle = breaching ? signal : iris;
  ctx.beginPath();
  ctx.arc(head.x, head.y, 2.6, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 0.28;
  ctx.beginPath();
  ctx.arc(head.x, head.y, 6, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

export function ProbeTraceCanvas({
  mode = 'single',
  channelIndex = 1,
  height = 54,
  className,
  'data-testid': testId,
}: ProbeTraceCanvasProps): React.JSX.Element {
  const reduced = useReducedMotionPreference();
  const singleRef = React.useRef<HTMLCanvasElement | null>(null);
  const quadRefs = React.useRef<Array<HTMLCanvasElement | null>>([null, null, null, null]);

  const paintAt = React.useCallback(
    (phaseSec: number) => {
      if (mode === 'single') {
        const canvas = singleRef.current;
        if (canvas) {
          drawTraceOnCanvas(canvas, CHANNEL_PROFILES[channelIndex]!, phaseSec, true);
        }
        return;
      }
      for (let i = 0; i < 4; i += 1) {
        const canvas = quadRefs.current[i];
        if (canvas) {
          drawTraceOnCanvas(canvas, CHANNEL_PROFILES[i]!, phaseSec + i * 0.35, true);
        }
      }
    },
    [channelIndex, mode],
  );

  React.useEffect(() => {
    paintAt(0.45);
    if (typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(() => paintAt(0.45));
    if (mode === 'single' && singleRef.current) {
      ro.observe(singleRef.current);
    } else {
      for (const el of quadRefs.current) {
        if (el) ro.observe(el);
      }
    }
    return () => ro.disconnect();
  }, [mode, paintAt]);

  useAnimationFrame((timeMs) => {
    if (reduced) return;
    paintAt(timeMs / 1000);
  });

  if (mode === 'quad') {
    return (
      <div
        aria-hidden="true"
        data-testid={testId ?? 'probe-trace-quad'}
        className={cn('grid grid-cols-2 gap-2', className)}
      >
        {CHANNEL_PROFILES.map((profile, idx) => (
          <canvas
            key={profile.specIndex}
            ref={(el) => {
              quadRefs.current[idx] = el;
            }}
            style={{ height: `${height}px` }}
            className="block w-full select-none"
          />
        ))}
      </div>
    );
  }

  return (
    <canvas
      ref={singleRef}
      aria-hidden="true"
      data-testid={testId ?? 'probe-trace-single'}
      style={{ height: `${height}px` }}
      className={cn('block w-full select-none', className)}
    />
  );
}
