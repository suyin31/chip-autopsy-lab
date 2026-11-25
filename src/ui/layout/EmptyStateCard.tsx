'use client';

import {
  ArrowDown,
  ArrowUpRight,
  Bot,
  Download,
} from 'lucide-react';
import { animate, motion } from 'motion/react';
import Link from 'next/link';
import * as React from 'react';
import {
  DEMO_DIES_PER_WAFER,
  DEMO_WAFER_COUNT,
  type DemoPresetId,
  type DemoPresetMeta,
  getDemoPresetPreview,
  getDemoStdfFileName,
} from '@/core/demo';
import { type MessageKey } from '@/core/i18n';
import type { ParseFatalError } from '@/core/stdf';
import { ExplodedAutopsyStage } from '@/ui/atelier/ExplodedAutopsyStage';
import { LiveTelemetryStrip } from '@/ui/atelier/LiveTelemetryStrip';
import { PulseBusSvg } from '@/ui/atelier/PulseBusSvg';
import {
  FormatKeycaps,
  SpecimenDropTray,
  SpecimenSeat,
} from '@/ui/atelier/SpecimenDropTray';
import { SpotlightTiltCard } from '@/ui/atelier/SpotlightTiltCard';
import { Untranslated, useT } from '@/ui/i18n';
import {
  hasSeenSessionReveal,
  markSessionRevealSeen,
  resolveViewMorphTransition,
  SAMPLE_CARD_TILT_MAX_DEG,
  useReducedMotionPreference,
  useTouchReveal,
  WAFER_MORPH_LAYOUT_ID,
} from '@/ui/motion';
import {
  Button,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  renderAccentPhrase,
} from '@/ui/primitives';
import { renderWithUntranslatedTokens } from '@/ui/report/render-untranslated';
import { useAccent } from '@/ui/state';
import { getFailDieColor, WAFER_TOKENS } from '@/ui/tokens';
import {
  bindScrollLightSheen,
  canSheenFollow,
  computeSheenTarget,
  createSheenFollower,
  readSheenFollowEnvironment,
  SHEEN_CARD_AMPLITUDE_D,
  SHEEN_REST,
} from '@/ui/wafer-map/sheen-motion';
import {
  buildWaferDiscMaskImage,
  computeSheenEllipseRestStyle,
  computeStageDiscLayerRects,
  type StageLayerRect,
} from '@/ui/wafer-map/stage-layers';
import { usePrefersMoreContrast } from '@/ui/wafer-map/use-prefers-more-contrast';
import {
  computeLandingCardWaferRadiusPx,
  paintLandingCardWafer,
  resolveCanvasPixelSize,
} from '@/ui/wafer-map/wafer-geometry';
import { ErrorDetailsSheet } from './ErrorDetailsSheet';
import { resolveParseErrorViewModel } from './parse-error-copy';

export type EmptyStateCause = 'first-run' | 'parse-failed' | 'no-results';

export interface EmptyStateCardProps {
  readonly cause?: EmptyStateCause;
  readonly presets: readonly DemoPresetMeta[];
  readonly selectedPresetId: DemoPresetId;
  readonly onSelectPreset: (presetId: DemoPresetId) => void;
  readonly onLoadDemoLot: (presetId: DemoPresetId) => void;
  readonly onDownloadDemoLot?: (presetId: DemoPresetId) => void;
  readonly downloadingPresetId?: DemoPresetId | null;
  readonly onSelectFile: (file: File) => void;
  readonly renderWorkerThumbnail?: (
    presetId: DemoPresetId,
    cssSize: number,
    dpr: number,
    highContrast?: boolean,
    failColor?: string,
  ) => Promise<ImageBitmap | null>;
  readonly parseError?: {
    readonly error: ParseFatalError;
    readonly fileName?: string;
  } | null;
  readonly activeFilterSummary?: string;
  readonly onClearFilters?: () => void;
  readonly disabled?: boolean;
}

const DEMO_CARD_COPY_KEYS = {
  'edge-ring-etch': {
    title: 'demo.edgeRing.title',
    description: 'demo.edgeRing.description',
    chip: 'demo.edgeRing.chip',
  },
  'handling-scratch': {
    title: 'demo.scratch.title',
    description: 'demo.scratch.description',
    chip: 'demo.scratch.chip',
  },
  'site2-probe-contact': {
    title: 'demo.site2.title',
    description: 'demo.site2.description',
    chip: 'demo.site2.chip',
  },
} as const satisfies Record<
  DemoPresetId,
  {
    readonly title: MessageKey;
    readonly description: MessageKey;
    readonly chip: MessageKey;
  }
>;

function layerStyle(rect: StageLayerRect): React.CSSProperties {
  return {
    left: `${rect.left}px`,
    top: `${rect.top}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`,
  };
}

function useLandingSheenFollow(
  frameRef: React.RefObject<HTMLDivElement | null>,
  sheenRef: React.RefObject<HTMLDivElement | null>,
  ellipseRef: React.RefObject<HTMLDivElement | null>,
): void {
  React.useEffect(() => {
    const frame = frameRef.current;
    const host: HTMLElement | null = frame?.closest('button') ?? frame;
    if (!host) {
      return;
    }
    const follower = createSheenFollower({
      write: (transform) => {
        if (ellipseRef.current) {
          ellipseRef.current.style.transform = transform;
        }
      },
      requestFrame: (cb) => window.requestAnimationFrame(cb),
      cancelFrame: (id) => window.cancelAnimationFrame(id),
    });
    const onMove = (event: PointerEvent): void => {
      const sheen = sheenRef.current;
      const env = readSheenFollowEnvironment();
      const disabled = host instanceof HTMLButtonElement && host.disabled;
      if (!sheen || disabled || !canSheenFollow(event.pointerType, env)) {
        if (env.reducedMotion || env.reducedTransparency) {
          follower.snapToRest();
        }
        return;
      }
      const r = sheen.getBoundingClientRect();
      follower.setTarget(
        computeSheenTarget(
          event.clientX,
          event.clientY,
          r.left + r.width / 2,
          r.top + r.height / 2,
          r.width / 2,
          SHEEN_CARD_AMPLITUDE_D,
        ),
      );
    };
    const onLeave = (event: PointerEvent): void => {
      if (event.pointerType !== 'touch') follower.setTarget(SHEEN_REST);
    };
    host.addEventListener('pointermove', onMove);
    host.addEventListener('pointerleave', onLeave);
    // Touch screens: an overhead scroll light moves the sheen as the card scrolls by
    const unbindScrollLight = bindScrollLightSheen({
      getDisc: () => sheenRef.current,
      follower,
      amplitudeD: SHEEN_CARD_AMPLITUDE_D,
    });
    return () => {
      host.removeEventListener('pointermove', onMove);
      host.removeEventListener('pointerleave', onLeave);
      unbindScrollLight();
      follower.dispose();
    };
  }, [frameRef, sheenRef, ellipseRef]);
}

interface LandingWaferDiscProps {
  readonly presetId: DemoPresetId;
  readonly size: number;
  readonly testId: (
    part?: 'frame' | 'contact' | 'ambient' | 'halo' | 'sheen' | 'sheen-ellipse',
  ) => string;
  readonly enableSharedMorph?: boolean;
  readonly renderWorkerThumbnail?: (
    presetId: DemoPresetId,
    cssSize: number,
    dpr: number,
    highContrast?: boolean,
    failColor?: string,
  ) => Promise<ImageBitmap | null>;
}

/**
 * Compact data-scale wafer plot (`84px–116px`) used strictly inside telemetry pods and sample
 * case cards as a real data visualization (never as a giant decorative centerpiece).
 */
function LandingWaferDisc({
  presetId,
  size,
  testId,
  enableSharedMorph = false,
  renderWorkerThumbnail,
}: LandingWaferDiscProps): React.JSX.Element {
  const reduced = useReducedMotionPreference();
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);
  const frameRef = React.useRef<HTMLDivElement | null>(null);
  const sheenRef = React.useRef<HTMLDivElement | null>(null);
  const sheenEllipseRef = React.useRef<HTMLDivElement | null>(null);
  useLandingSheenFollow(frameRef, sheenRef, sheenEllipseRef);

  const preview = React.useMemo(
    () => getDemoPresetPreview(presetId),
    [presetId],
  );
  const highContrast = usePrefersMoreContrast();
  const accent = useAccent();

  React.useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return;
    }
    const dpr =
      typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
    const dims = resolveCanvasPixelSize(size, size, dpr);
    if (canvas.width !== dims.pixelWidth) {
      canvas.width = dims.pixelWidth;
    }
    if (canvas.height !== dims.pixelHeight) {
      canvas.height = dims.pixelHeight;
    }
    paintLandingCardWafer(ctx, {
      wafer: preview.wafer,
      dies: preview.dies,
      cssSize: size,
      dpr: dims.dpr,
      highContrast,
      thinFilm: false,
      accent,
    });

    if (!renderWorkerThumbnail) {
      return;
    }
    let cancelled = false;
    void renderWorkerThumbnail(
      presetId,
      size,
      dims.dpr,
      highContrast,
      getFailDieColor(accent),
    )
      .then((bitmap) => {
        if (!bitmap) {
          return;
        }
        if (cancelled || !canvasRef.current) {
          bitmap.close();
          return;
        }
        const liveCtx = canvasRef.current.getContext('2d');
        if (liveCtx) {
          liveCtx.setTransform(1, 0, 0, 1, 0, 0);
          liveCtx.clearRect(
            0,
            0,
            canvasRef.current.width,
            canvasRef.current.height,
          );
          liveCtx.drawImage(
            bitmap,
            0,
            0,
            canvasRef.current.width,
            canvasRef.current.height,
          );
        }
        bitmap.close();
      })
      .catch(() => {
        // Synchronous preview already rendered on canvas.
      });

    return () => {
      cancelled = true;
    };
  }, [presetId, preview, renderWorkerThumbnail, highContrast, size, accent]);

  const center = size / 2;
  const layers = computeStageDiscLayerRects(
    center,
    center,
    computeLandingCardWaferRadiusPx(size),
  );
  const discMaskImage = buildWaferDiscMaskImage(preview.wafer.geometry.wfFlat);

  return (
    <div
      ref={frameRef}
      data-testid={testId('frame')}
      data-vt="wafer"
      style={{ width: `${size}px`, height: `${size}px` }}
      className="relative shrink-0"
    >
      {enableSharedMorph ? (
        <motion.div
          aria-hidden="true"
          data-testid="wafer-shared-morph"
          data-morph-state="ready"
          layoutId={reduced ? undefined : WAFER_MORPH_LAYOUT_ID}
          transition={resolveViewMorphTransition(reduced)}
          className="pointer-events-none absolute inset-0 rounded-full"
        />
      ) : null}
      <div
        aria-hidden="true"
        data-testid={testId('contact')}
        style={{
          ...layerStyle(layers.contact),
          backgroundImage: WAFER_TOKENS.contactShadow,
        }}
        className="pointer-events-none absolute dark:hidden"
      />
      <canvas
        ref={canvasRef}
        data-testid={testId()}
        aria-hidden="true"
        style={{ width: `${size}px`, height: `${size}px` }}
        className="pointer-events-none relative block select-none"
      />
      <div
        ref={sheenRef}
        aria-hidden="true"
        data-testid={testId('sheen')}
        style={{
          ...layerStyle(layers.sheen),
          maskImage: discMaskImage,
          WebkitMaskImage: discMaskImage,
          maskSize: '100% 100%',
          WebkitMaskSize: '100% 100%',
          maskRepeat: 'no-repeat',
          WebkitMaskRepeat: 'no-repeat',
        }}
        className="wafer-sheen pointer-events-none absolute overflow-hidden rounded-full mix-blend-screen"
      >
        <div
          ref={sheenEllipseRef}
          data-testid={testId('sheen-ellipse')}
          style={{
            ...computeSheenEllipseRestStyle(),
            backgroundImage: WAFER_TOKENS.sheen,
          }}
          className="absolute mix-blend-screen"
        />
      </div>
    </div>
  );
}

/** Signature secondary micro-visuals inside Cards 2 & 3 so every Bento card shows distinct data geometry. */
function PresetSignatureGraphic({
  presetId,
}: {
  readonly presetId: DemoPresetId;
}): React.JSX.Element | null {
  if (presetId === 'handling-scratch') {
    const heights = [18, 20, 19, 62, 74, 82, 78, 86, 70, 66, 20, 18];
    return (
      <div
        aria-hidden="true"
        className="flex min-w-0 flex-1 flex-col justify-between rounded-xl bg-fill-1 p-2.5"
      >
        <div className="flex items-center justify-between text-[10.5px] text-text-tertiary tabular-nums">
          <Untranslated className="font-mono text-text-secondary">W05–W22</Untranslated>
          <Untranslated className="font-mono">18W</Untranslated>
        </div>
        <div className="mt-2 flex h-9 items-end gap-1">
          {heights.map((h, i) => (
            <span
              key={i}
              style={{ height: `${h}%` }}
              className={cn(
                'flex-1 rounded-xs',
                h > 40 ? 'at-bar-signal' : 'bg-fill-3',
              )}
            />
          ))}
        </div>
      </div>
    );
  }

  if (presetId === 'site2-probe-contact') {
    return (
      <div
        aria-hidden="true"
        className="flex min-w-0 flex-1 flex-col justify-between gap-2 rounded-xl bg-fill-1 p-2.5"
      >
        <div className="flex flex-col gap-1">
          <div className="flex justify-between text-[10.5px] tabular-nums">
            <Untranslated className="font-mono text-text-tertiary">S1</Untranslated>
            <Untranslated className="font-mono text-text-secondary">3.1%</Untranslated>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-pill bg-fill-2">
            <div className="at-bar-iris h-full w-[8%] rounded-pill" />
          </div>
        </div>
        <div className="flex flex-col gap-1">
          <div className="flex justify-between text-[10.5px] tabular-nums">
            <Untranslated className="font-mono text-text-primary">S2</Untranslated>
            <Untranslated className="font-mono text-text-primary">40.6%</Untranslated>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-pill bg-fill-2">
            <div className="at-bar-signal h-full w-[81%] rounded-pill" />
          </div>
        </div>
      </div>
    );
  }

  return null;
}

interface DemoLotCardButtonProps {
  readonly presetId: DemoPresetId;
  readonly isSelected: boolean;
  readonly disabled: boolean;
  readonly onSelectPreset: (presetId: DemoPresetId) => void;
  readonly onLoadDemoLot: (presetId: DemoPresetId) => void;
  readonly renderWorkerThumbnail?: (
    presetId: DemoPresetId,
    cssSize: number,
    dpr: number,
    highContrast?: boolean,
    failColor?: string,
  ) => Promise<ImageBitmap | null>;
}

function DemoLotCardButton({
  presetId,
  isSelected,
  disabled,
  onSelectPreset,
  onLoadDemoLot,
  renderWorkerThumbnail,
}: DemoLotCardButtonProps): React.JSX.Element {
  const { t, formatInteger } = useT();
  const descId = React.useId();
  const isFlagship = presetId === 'edge-ring-etch';
  const discSize = isFlagship ? 132 : 88;

  const keys = DEMO_CARD_COPY_KEYS[presetId];
  const title = t(keys.title);
  const chip = t(keys.chip);
  const description = t(keys.description);
  const meta = t('landing.cardMeta', {
    wafers: formatInteger(DEMO_WAFER_COUNT),
    dies: formatInteger(DEMO_WAFER_COUNT * DEMO_DIES_PER_WAFER),
  });

  return (
    <SpotlightTiltCard
      as="button"
      type="button"
      disabled={disabled}
      pressable
      maxDeg={SAMPLE_CARD_TILT_MAX_DEG}
      aria-disabled={disabled ? 'true' : undefined}
      data-testid={`demo-card-${presetId}`}
      data-vt-scope="card"
      aria-label={t('demo.openAria', { title })}
      aria-describedby={descId}
      onPointerDown={(e) => {
        if (e.button === 0 && !disabled) {
          onSelectPreset(presetId);
        }
      }}
      onClick={() => onLoadDemoLot(presetId)}
      className={cn(
        'group relative flex w-full cursor-pointer p-3 text-left select-none sm:p-3.5',
        isFlagship
          ? 'flex-col gap-4 sm:col-span-2 sm:flex-row sm:items-stretch lg:col-span-12 xl:col-span-6'
          : 'flex-col justify-between gap-3.5 lg:col-span-6 xl:col-span-3',
        'rounded-[28px] focus-visible:shadow-focus-ring focus-visible:outline-none',
        'disabled:cursor-not-allowed disabled:opacity-40',
      )}
    >
      {/* Recessed Obsidian Data Pod */}
      <div
        data-testid={`demo-tile-${presetId}`}
        data-texture="dots"
        className={cn(
          'at-obsidian-well relative flex flex-col overflow-hidden rounded-[20px] p-3.5',
          isFlagship ? 'sm:w-[196px] sm:shrink-0' : 'w-full justify-between',
        )}
      >
        <div className="flex items-center justify-between gap-2">
          <span
            data-testid={`demo-chip-${presetId}`}
            className={cn(
              'at-pill h-5 px-2.5 text-[11px]',
              isFlagship ? 'at-pill-signal' : 'at-pill-iris',
            )}
          >
            {chip}
          </span>
          <Untranslated className="font-mono text-[10.5px] text-text-tertiary tabular-nums">
            {isFlagship ? 'CAL-ER' : presetId === 'handling-scratch' ? 'CAL-HS' : 'CAL-S2'}
          </Untranslated>
        </div>

        <div
          className={cn(
            'mt-3 flex items-center gap-3',
            // The flagship well stretches to the caption's height; centre the plot in it.
            isFlagship ? 'flex-1 justify-center py-2' : 'justify-between',
          )}
        >
          <LandingWaferDisc
            presetId={presetId}
            size={discSize}
            enableSharedMorph={isSelected}
            testId={(part) =>
              part ? `landing-demo-wafer-${part}-${presetId}` : `landing-demo-wafer-${presetId}`
            }
            {...(renderWorkerThumbnail !== undefined ? { renderWorkerThumbnail } : {})}
          />
          <PresetSignatureGraphic presetId={presetId} />
        </div>
      </div>

      {/* 3D Popped Case Body */}
      <div
        id={descId}
        data-testid={`demo-caption-${presetId}`}
        className="at-bento-pop-sm flex min-w-0 flex-1 flex-col justify-between px-1.5 py-1"
      >
        <div>
          <span data-vt="verdict" className="block truncate type-headline text-text-primary">
            {title}
          </span>
          <span className="mt-1 line-clamp-2 block type-callout text-text-secondary">
            {description}
          </span>

          {isFlagship ? (
            <span className="mt-3.5 grid grid-cols-3 gap-2">
              <span className="at-well-crisp flex flex-col rounded-xl px-2.5 py-2">
                <Untranslated className="at-kpi-number text-[16px] whitespace-nowrap text-text-primary">
                  82.8%
                </Untranslated>
                <span className="mt-0.5 truncate text-[11px] text-text-tertiary">
                  {t('stats.finalYield')}
                </span>
              </span>
              <span className="at-well-crisp flex flex-col rounded-xl px-2.5 py-2">
                <Untranslated className="at-kpi-number text-[16px] whitespace-nowrap text-text-primary">
                  SBIN 7
                </Untranslated>
                <Untranslated className="mt-0.5 truncate font-mono text-[11px] text-text-tertiary">
                  91.3%
                </Untranslated>
              </span>
              <span className="at-well-crisp flex flex-col rounded-xl px-2.5 py-2">
                <Untranslated className="at-kpi-number text-[16px] whitespace-nowrap text-text-primary">
                  0.14
                </Untranslated>
                <Untranslated className="mt-0.5 truncate font-mono text-[11px] text-text-tertiary">
                  Cpk
                </Untranslated>
              </span>
            </span>
          ) : null}
        </div>

        <span className="mt-3.5 flex items-center justify-between gap-2 border-t border-hairline pt-3 type-subhead text-text-tertiary tabular-nums">
          <span className="truncate">{meta}</span>
          <span
            aria-hidden="true"
            className="inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-fill-1 text-text-secondary transition-transform duration-200 ease-[var(--ease-out)] group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-text-primary"
          >
            <ArrowUpRight className="size-3.5" strokeWidth={1.75} />
          </span>
        </span>
      </div>
    </SpotlightTiltCard>
  );
}

const HERO_HEADLINE_SESSION_KEY = 'cal.hero.headline.v3';

export function EmptyStateCard({
  cause = 'first-run',
  presets,
  selectedPresetId,
  onSelectPreset,
  onLoadDemoLot,
  onDownloadDemoLot,
  downloadingPresetId = null,
  onSelectFile,
  renderWorkerThumbnail,
  parseError = null,
  activeFilterSummary,
  onClearFilters,
  disabled = false,
}: EmptyStateCardProps): React.JSX.Element {
  const { locale, t } = useT();
  const reduced = useReducedMotionPreference();
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const heroSectionRef = React.useRef<HTMLDivElement | null>(null);
  const headlineRef = React.useRef<HTMLHeadingElement | null>(null);
  const [detailsOpen, setDetailsOpen] = React.useState(false);
  const sampleHeadingId = React.useId();
  const demoCardsRef = React.useRef<HTMLDivElement | null>(null);
  // Touch: sample cards that start below the fold rise in once, 60 ms apart
  useTouchReveal(demoCardsRef, { selector: ':scope > button' });

  // Rise-in on client mount without mutating SSR text structure (transform and opacity only)
  React.useLayoutEffect(() => {
    const el = headlineRef.current;
    if (!el || reduced || cause !== 'first-run') return;
    if (hasSeenSessionReveal(HERO_HEADLINE_SESSION_KEY)) return;
    markSessionRevealSeen(HERO_HEADLINE_SESSION_KEY);
    const controls = animate(
      el,
      { opacity: [0, 1], y: [14, 0] },
      { duration: 0.62, ease: [0.22, 1, 0.36, 1] },
    );
    return () => {
      controls.complete();
    };
  }, [cause, reduced]);

  const handleFileInputChange = (
    event: React.ChangeEvent<HTMLInputElement>,
  ): void => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file) {
      onSelectFile(file);
    }
  };

  const errorVm = React.useMemo(
    () =>
      cause === 'parse-failed' && parseError
        ? resolveParseErrorViewModel(parseError.error, locale)
        : null,
    [cause, locale, parseError],
  );

  return (
    <div
      data-testid={
        cause === 'parse-failed' ? 'parse-error-view' : 'landing-view'
      }
      className="flex flex-col pb-12 sm:mx-auto sm:w-full sm:max-w-[720px] lg:max-w-none lg:pb-8"
    >
      <label htmlFor="cal-file-picker" className="sr-only">
        {t('nav.openStdfAria')}
      </label>
      <input
        id="cal-file-picker"
        ref={fileInputRef}
        tabIndex={-1}
        type="file"
        accept=".stdf,.std,.stdf.gz,.gz,application/gzip,application/octet-stream"
        onChange={handleFileInputChange}
        disabled={disabled}
        className="sr-only"
        aria-label={t('nav.openStdfAria')}
      />

      {cause === 'no-results' ? (
        <div
          role="status"
          aria-live="polite"
          aria-atomic="true"
          className="pt-12 text-left md:mx-auto md:max-w-[640px] md:pt-32 md:text-center"
        >
          <h1 className="type-title-2 text-text-primary">
            {t('empty.noResults.title')}
          </h1>
          <p className="mt-3 type-body text-pretty text-text-secondary">
            {activeFilterSummary
              ? t('empty.noResults.bodyFilter', { filter: activeFilterSummary })
              : t('empty.noResults.body')}
          </p>
          <div className="mt-6 flex flex-col gap-3 md:flex-row md:items-center md:justify-center">
            {onClearFilters ? (
              <Button
                variant="primary"
                size="lg"
                onClick={onClearFilters}
                disabled={disabled}
                className="w-full md:w-auto"
              >
                {t('empty.noResults.clear')}
              </Button>
            ) : null}
            <Button
              variant="secondary"
              size="lg"
              onClick={() => onLoadDemoLot(selectedPresetId)}
              disabled={disabled}
              className="w-full md:w-auto"
            >
              {t('landing.primary')}
            </Button>
          </div>
        </div>
      ) : cause === 'parse-failed' && errorVm ? (
        <div
          role="alert"
          data-error-code={errorVm.uiCode}
          className="pt-12 text-left lg:mx-auto lg:max-w-[880px] lg:pt-[112px] lg:text-center"
        >
          <h1
            data-testid="parse-error-title"
            className="type-title-1 text-text-primary"
          >
            {errorVm.title}
          </h1>

          <p
            data-testid="parse-error-body"
            className="mt-3 max-w-[560px] type-body text-text-secondary lg:mx-auto"
          >
            {renderWithUntranslatedTokens(
              errorVm.body,
              errorVm.untranslatedTokens,
            )}
          </p>

          <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center lg:justify-center">
            <Button
              variant="primary"
              size="lg"
              data-testid="parse-error-open-another"
              aria-controls="cal-file-picker"
              onClick={() => fileInputRef.current?.click()}
              disabled={disabled}
              className="w-full sm:w-auto"
            >
              {t('error.openAnother')}
            </Button>

            <Button
              variant="secondary"
              size="lg"
              data-testid="parse-error-load-demo"
              onClick={() => onLoadDemoLot('edge-ring-etch')}
              disabled={disabled}
              className="h-11 w-full sm:h-12 sm:w-auto"
            >
              {t('landing.primary')}
            </Button>
          </div>

          <div className="mt-4 flex lg:justify-center">
            <Button
              variant="text"
              data-testid="parse-error-show-details"
              onClick={() => setDetailsOpen(true)}
              disabled={disabled}
            >
              {t('error.showDetails')}
            </Button>
          </div>

          <ErrorDetailsSheet
            open={detailsOpen}
            onClose={() => setDetailsOpen(false)}
            byteOffset={errorVm.byteOffset}
            first16BytesHex={errorVm.first16BytesHex}
            {...(parseError?.fileName !== undefined
              ? { fileName: parseError.fileName }
              : {})}
          />
        </div>
      ) : (
        /* Spatial Hero: Statement + Obsidian Drop Dock on Left, Exploded 3D Forensic Rig on Right */
        <div ref={heroSectionRef} className="relative isolate flex flex-col">
          <div className="relative grid grid-cols-1 items-center gap-8 pt-6 lg:grid-cols-[minmax(0,0.92fr)_minmax(0,1.08fr)] lg:gap-8 lg:pt-10 xl:gap-10 xl:pt-12">
            <div className="relative text-left">
              {cause === 'first-run' ? (
                <PulseBusSvg
                  variant="bridge"
                  data-testid="landing-hero-pulse-bridge"
                  className="pointer-events-none absolute -right-8 bottom-7 z-[2] hidden w-16 lg:block xl:-right-9 xl:w-20"
                />
              ) : null}
              {/* Eyebrow Telemetry Pill */}
              <div className="mb-4 inline-flex max-w-full items-center gap-2 rounded-pill bg-[var(--surface-well)] px-3 py-1.5 text-[12px] font-[500] text-text-secondary shadow-[var(--elev-well-crisp)]">
                <span
                  aria-hidden="true"
                  className="at-dot-signal at-live-pulse size-1.5 shrink-0 rounded-full"
                />
                <span className="truncate">{t('landing.privacy')}</span>
                <span aria-hidden="true" className="text-text-tertiary">
                  ·
                </span>
                <Untranslated className="shrink-0 font-mono text-[11px] text-text-tertiary">
                  STDF V4
                </Untranslated>
              </div>

              <h1
                ref={headlineRef}
                data-testid="landing-headline"
                className="landing-headline at-display text-[clamp(48px,5.8vw,84px)] leading-[0.98] tracking-[-0.034em] text-text-primary"
              >
                {renderAccentPhrase(
                  t('landing.headline'),
                  t('landing.headlineAccent'),
                  true,
                )}
              </h1>

              <p
                data-testid="landing-subline"
                className="landing-subline mt-5 line-clamp-3 max-w-[46ch] text-[17px] leading-[1.55] tracking-[-0.011em] text-text-secondary"
              >
                {t('landing.subline')}
              </p>

              <div className="mt-7 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
                <Button
                  variant="primary"
                  size="lg"
                  data-testid="landing-open-sample-button"
                  onClick={() => onLoadDemoLot('edge-ring-etch')}
                  disabled={disabled}
                  className="w-full sm:w-auto"
                >
                  {t('landing.primary')}
                </Button>

                <Link
                  href="/agents"
                  className={cn(
                    'inline-flex h-12 w-full items-center justify-center gap-2 rounded-pill bg-[var(--surface-well)] px-5 type-control text-text-primary no-underline shadow-[var(--elev-well-crisp)] sm:w-auto',
                    'transition-[background-color,transform,scale] duration-150 ease-[var(--ease-out)] hover:bg-fill-2 active:scale-[0.97]',
                    'focus-visible:shadow-focus-ring focus-visible:outline-none',
                  )}
                >
                  <Bot className="size-4 text-text-secondary" strokeWidth={1.7} aria-hidden="true" />
                  <span>{t('nav.agent')}</span>
                </Link>
              </div>

              <SpecimenDropTray
                variant="inline"
                data-testid="landing-drop-tray"
                className="mt-5 w-full max-w-[540px]"
                wellClassName="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:gap-4 sm:py-3.5 sm:pr-4 sm:pl-5"
              >
                <span className="flex min-w-0 flex-1 items-center gap-3">
                  <SpecimenSeat size={36} className="max-sm:hidden">
                    <ArrowDown
                      className="size-3.5 text-text-secondary"
                      strokeWidth={1.75}
                      aria-hidden="true"
                    />
                  </SpecimenSeat>
                  <span className="min-w-0 flex-1">
                    <p
                      data-testid="landing-hint"
                      className="min-w-0 type-subhead text-text-secondary"
                    >
                      <span className="sm:hidden">{t('landing.hintShort')}</span>
                      <span className="max-sm:hidden">{t('landing.hint')}</span>
                    </p>
                    <FormatKeycaps className="mt-2 max-sm:hidden" />
                  </span>
                </span>
                <Button
                  variant="secondary"
                  size="md"
                  data-testid="landing-open-stdf-button"
                  aria-controls="cal-file-picker"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={disabled}
                  className="w-full shrink-0 sm:w-auto"
                >
                  {t('landing.secondary')}
                </Button>
              </SpecimenDropTray>
            </div>

            {cause === 'first-run' ? (
              <ExplodedAutopsyStage
                disabled={disabled}
                heroSectionRef={heroSectionRef}
                onOpenSample={() => onLoadDemoLot('edge-ring-etch')}
                compactDataPlot={
                  <LandingWaferDisc
                    presetId="edge-ring-etch"
                    size={84}
                    testId={(part) =>
                      part ? `landing-hero-disc-${part}` : 'landing-hero-disc'
                    }
                  />
                }
              />
            ) : null}
          </div>
        </div>
      )}

      {/* Mid-page 12-Col Frameless Telemetry Strip + 3 Sample Case Cards */}
      {cause !== 'no-results' ? (
        <>
          <LiveTelemetryStrip
            disabled={disabled}
            onOpenSample={() => onLoadDemoLot('edge-ring-etch')}
          />

          <section
            aria-labelledby={sampleHeadingId}
            className="mt-12 lg:mt-14"
          >
            <h2
              id={sampleHeadingId}
              data-testid="landing-sample-heading"
              className="flex items-center gap-2 text-[13px] font-[500] tracking-[-0.005em] text-text-secondary"
            >
              <span
                aria-hidden="true"
                data-testid="landing-eyebrow-dot"
                className="size-1.5 shrink-0 rounded-full bg-ember"
              />
              {t('landing.demoHeading')}
            </h2>

            <div
              ref={demoCardsRef}
              data-testid="landing-demo-cards"
              className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-12 lg:gap-5"
            >
              {presets.map((preset) => (
                <DemoLotCardButton
                  key={preset.id}
                  presetId={preset.id}
                  isSelected={preset.id === selectedPresetId}
                  disabled={disabled}
                  onSelectPreset={onSelectPreset}
                  onLoadDemoLot={onLoadDemoLot}
                  {...(renderWorkerThumbnail !== undefined
                    ? { renderWorkerThumbnail }
                    : {})}
                />
              ))}
            </div>
          </section>

          <footer className="mt-14 flex flex-wrap items-center justify-between gap-4 border-t border-hairline pt-6 lg:mt-16">
            <p
              data-testid="landing-privacy"
              className="type-subhead text-text-tertiary"
            >
              {t('landing.privacy')}
            </p>

            <DropdownMenu>
              <DropdownMenuTrigger
                data-testid="landing-download-demos-trigger"
                disabled={disabled}
                className={cn(
                  'relative cursor-pointer rounded-pill bg-transparent p-0 type-control text-text-secondary shadow-none select-none',
                  "after:absolute after:-inset-2 after:content-['']",
                  'transition-[color,opacity] duration-[120ms] ease-[var(--ease-out)] [@media(hover:hover)]:enabled:hover:text-text-primary enabled:active:opacity-64',
                  'focus-visible:shadow-focus-ring focus-visible:outline-none',
                  'disabled:cursor-not-allowed disabled:text-text-disabled',
                )}
              >
                {t('landing.downloadDemos')}
              </DropdownMenuTrigger>

              <DropdownMenuContent
                align="end"
                sideOffset={8}
                expectedWidthPx={260}
                data-testid="landing-download-demos-menu"
                className="w-[260px]"
              >
                {presets.map((preset) => {
                  const fileName = getDemoStdfFileName(preset.id);
                  const isExporting = downloadingPresetId === preset.id;
                  return (
                    <DropdownMenuItem
                      key={preset.id}
                      data-testid={`download-demo-stdf-${preset.id}`}
                      aria-label={`Download ${fileName}`}
                      typeaheadLabel={fileName}
                      disabled={disabled || downloadingPresetId !== null}
                      onSelect={() => onDownloadDemoLot?.(preset.id)}
                    >
                      <Untranslated className="truncate type-mono-data text-text-primary">
                        {isExporting ? `${fileName}…` : fileName}
                      </Untranslated>
                      <Download
                        className="size-3.5 shrink-0 text-text-secondary"
                        strokeWidth={1.5}
                        aria-hidden="true"
                      />
                    </DropdownMenuItem>
                  );
                })}
              </DropdownMenuContent>
            </DropdownMenu>
          </footer>
        </>
      ) : null}
    </div>
  );
}
