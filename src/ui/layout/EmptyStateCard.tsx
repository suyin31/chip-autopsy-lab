'use client';

import { Download } from 'lucide-react';
import { animate, useReducedMotion } from 'motion/react';
import * as React from 'react';
import {
  DEMO_DIES_PER_WAFER,
  DEMO_WAFER_COUNT,
  type DemoPresetId,
  type DemoPresetMeta,
  getDemoPresetPreview,
  getDemoStdfFileName,
} from '@/core/demo';
import type { MessageKey } from '@/core/i18n';
import type { ParseFatalError } from '@/core/stdf';
import { Untranslated, useT } from '@/ui/i18n';
import {
  Button,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/ui/primitives';
import { MOTION_TOKENS, SPRING_TOKENS, WAFER_TOKENS } from '@/ui/tokens';
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
import {
  LANDING_WAFER_SIZE_DEFAULT,
  resolveLandingWaferSize,
} from './landing-layout';
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
  },
  'handling-scratch': {
    title: 'demo.scratch.title',
    description: 'demo.scratch.description',
  },
  'site2-probe-contact': {
    title: 'demo.site2.title',
    description: 'demo.site2.description',
  },
} as const satisfies Record<
  DemoPresetId,
  { readonly title: MessageKey; readonly description: MessageKey }
>;

function subscribeViewportWidth(onChange: () => void): () => void {
  window.addEventListener('resize', onChange);
  return () => window.removeEventListener('resize', onChange);
}

/** Card wafer diameter for the current viewport (premium §6.1); 152 px on the server. */
function useLandingWaferSize(): number {
  return React.useSyncExternalStore(
    subscribeViewportWidth,
    () => resolveLandingWaferSize(window.innerWidth),
    () => LANDING_WAFER_SIZE_DEFAULT,
  );
}

function layerStyle(rect: StageLayerRect): React.CSSProperties {
  return {
    left: `${rect.left}px`,
    top: `${rect.top}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`,
  };
}

interface DemoWaferThumbnailProps {
  readonly presetId: DemoPresetId;
  readonly renderWorkerThumbnail?: (
    presetId: DemoPresetId,
    cssSize: number,
    dpr: number,
    highContrast?: boolean,
  ) => Promise<ImageBitmap | null>;
}

function DemoWaferThumbnail({
  presetId,
  renderWorkerThumbnail,
}: DemoWaferThumbnailProps): React.JSX.Element {
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);
  const size = useLandingWaferSize();
  const preview = React.useMemo(
    () => getDemoPresetPreview(presetId),
    [presetId],
  );
  const highContrast = usePrefersMoreContrast();

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
  }, [presetId, preview, renderWorkerThumbnail, highContrast, size]);

  const center = size / 2;
  const layers = computeStageDiscLayerRects(
    center,
    center,
    computeLandingCardWaferRadiusPx(size),
  );
  const discMaskImage = buildWaferDiscMaskImage(preview.wafer.geometry.wfFlat);

  // premium §6.1: 152 / 140 / 120 / 112 px disc with its contact shadow (light) and the
  // §5.2 step 6 sheen at rest, masked to the notch-cut disc
  return (
    <div
      data-testid={`landing-demo-wafer-frame-${presetId}`}
      style={{ width: `${size}px`, height: `${size}px` }}
      className="relative shrink-0"
    >
      <div
        aria-hidden="true"
        data-testid={`landing-demo-wafer-contact-${presetId}`}
        style={{
          ...layerStyle(layers.contact),
          backgroundImage: WAFER_TOKENS.contactShadow,
        }}
        className="pointer-events-none absolute dark:hidden"
      />
      <canvas
        ref={canvasRef}
        data-testid={`landing-demo-wafer-${presetId}`}
        aria-hidden="true"
        style={{ width: `${size}px`, height: `${size}px` }}
        className="pointer-events-none relative block select-none"
      />
      <div
        aria-hidden="true"
        data-testid={`landing-demo-wafer-sheen-${presetId}`}
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

interface DemoLotCardButtonProps {
  readonly presetId: DemoPresetId;
  readonly disabled: boolean;
  readonly onLoadDemoLot: (presetId: DemoPresetId) => void;
  readonly renderWorkerThumbnail?: (
    presetId: DemoPresetId,
    cssSize: number,
    dpr: number,
    highContrast?: boolean,
  ) => Promise<ImageBitmap | null>;
}

function DemoLotCardButton({
  presetId,
  disabled,
  onLoadDemoLot,
  renderWorkerThumbnail,
}: DemoLotCardButtonProps): React.JSX.Element {
  const { t, formatInteger } = useT();
  const shouldReduceMotion = useReducedMotion();
  const buttonRef = React.useRef<HTMLButtonElement | null>(null);
  const pressedRef = React.useRef(false);
  const descId = React.useId();

  const keys = DEMO_CARD_COPY_KEYS[presetId];
  const title = t(keys.title);
  const description = t(keys.description);
  const meta = t('landing.cardMeta', {
    wafers: formatInteger(DEMO_WAFER_COUNT),
    dies: formatInteger(DEMO_WAFER_COUNT * DEMO_DIES_PER_WAFER),
  });

  const releasePress = React.useCallback((): void => {
    if (!pressedRef.current) {
      return;
    }
    pressedRef.current = false;
    const el = buttonRef.current;
    if (el && !shouldReduceMotion) {
      animate(el, { scale: 1 }, SPRING_TOKENS.snappy);
    }
  }, [shouldReduceMotion]);

  const handlePointerDown = (
    event: React.PointerEvent<HTMLButtonElement>,
  ): void => {
    if (
      event.button !== 0 ||
      disabled ||
      shouldReduceMotion ||
      !buttonRef.current
    ) {
      return;
    }
    pressedRef.current = true;
    animate(
      buttonRef.current,
      { scale: 0.985 },
      { duration: 0.1, ease: MOTION_TOKENS.easeOutTuple },
    );
  };

  return (
    <button
      ref={buttonRef}
      type="button"
      disabled={disabled}
      aria-disabled={disabled ? 'true' : undefined}
      data-testid={`demo-card-${presetId}`}
      aria-label={t('demo.openAria', { title })}
      aria-describedby={descId}
      onPointerDown={handlePointerDown}
      onPointerUp={releasePress}
      onPointerLeave={releasePress}
      onPointerCancel={releasePress}
      onClick={() => onLoadDemoLot(presetId)}
      className={cn(
        // premium §6.1 sample card: `surface`, `r-2xl`, `shadow-card`, no padding on the card;
        // mobile 300 x 248 carousel item, sm full-width 160 row, 3-up 256 / 272 / 288 from 1024
        'relative flex min-h-[248px] w-[300px] shrink-0 snap-start cursor-pointer flex-col items-center rounded-2xl bg-surface text-left shadow-card select-none',
        'sm:min-h-[160px] sm:w-full sm:flex-row sm:items-center',
        'lg:min-h-[256px] lg:flex-col lg:items-stretch xl:min-h-[272px] min-[90rem]:min-h-[288px]',
        // §8.9 hover: lift -2 px and cross-fade a `shadow-card-hover` pseudo-element (240 ms in, 160 ms out)
        "before:pointer-events-none before:absolute before:inset-0 before:rounded-[inherit] before:opacity-0 before:shadow-card-hover before:content-['']",
        'transition-[translate] duration-[160ms] ease-[var(--ease-out)] before:transition-opacity before:duration-[160ms] before:ease-[var(--ease-out)]',
        '[@media(hover:hover)]:enabled:hover:duration-[240ms] [@media(hover:hover)]:enabled:hover:before:opacity-100 [@media(hover:hover)]:enabled:hover:before:duration-[240ms]',
        '[@media(hover:hover)]:motion-safe:enabled:hover:-translate-y-0.5',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink',
        'disabled:cursor-not-allowed disabled:opacity-40',
      )}
    >
      <div className="flex justify-center pt-7 sm:pt-0 sm:pl-6 lg:pt-7 lg:pl-0">
        <DemoWaferThumbnail
          presetId={presetId}
          {...(renderWorkerThumbnail !== undefined
            ? { renderWorkerThumbnail }
            : {})}
        />
      </div>

      <div
        id={descId}
        className="flex w-full min-w-0 flex-col px-6 pt-6 pb-6 sm:flex-1 sm:py-6 lg:flex-none"
      >
        <span className="truncate type-headline text-text-primary">{title}</span>
        <span className="mt-1 truncate type-callout text-text-secondary lg:max-xl:line-clamp-2 lg:max-xl:whitespace-normal">
          {description}
        </span>
        <span className="mt-2 truncate type-subhead text-text-tertiary">
          {meta}
        </span>
      </div>
    </button>
  );
}

/**
 * Landing, parse error, and no-results views (`src/ui/layout/EmptyStateCard.tsx`):
 * - `first-run`: premium §6.1 hero ("Drop the body.", subline, primary "Open the sample lot",
 *   secondary "Open file", hint), "Sample lots" cards with 152 / 140 / 120 / 112 px discs, and
 *   the footer line with "Download sample files"
 * - `parse-failed`: icon-free localized error view per `redesign.md` §3.7 with
 *   `"Open another file"`, `"Load demo lot"`, and `"Show details"` sheet, keeping the cards below
 */
export function EmptyStateCard({
  cause = 'first-run',
  presets,
  selectedPresetId,
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
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const [detailsOpen, setDetailsOpen] = React.useState(false);
  const sampleHeadingId = React.useId();

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
      className="flex flex-col pb-12 sm:mx-auto sm:w-full sm:max-w-[640px] lg:max-w-none lg:pb-6"
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
            Zero dies match the active filter predicates.
          </h1>
          <p className="mt-3 type-body text-text-secondary">
            {activeFilterSummary
              ? `Active filter: ${activeFilterSummary}. Clear filters or open a demo lot.`
              : 'Clear active filters to restore the lot, or open a demo lot.'}
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
                Clear filters
              </Button>
            ) : null}
            <Button
              variant="secondary"
              size="lg"
              onClick={() => onLoadDemoLot(selectedPresetId)}
              disabled={disabled}
              className="w-full md:w-auto"
            >
              {t('error.loadDemo')}
            </Button>
          </div>
        </div>
      ) : cause === 'parse-failed' && errorVm ? (
        /* §3.7 Parse error hero (replaces landing hero; cards remain below) */
        <div
          role="alert"
          data-error-code={errorVm.uiCode}
          className="pt-12 text-left md:mx-auto md:max-w-[640px] md:pt-32 md:text-center"
        >
          <h1
            data-testid="parse-error-title"
            className="type-title-2 text-text-primary"
          >
            {errorVm.title}
          </h1>

          <p
            data-testid="parse-error-body"
            className="mt-3 type-body text-text-secondary md:mx-auto md:max-w-[560px]"
          >
            {errorVm.body}
          </p>

          <div className="mt-6 flex flex-col gap-3 md:flex-row md:items-center md:justify-center">
            <Button
              variant="primary"
              size="lg"
              data-testid="parse-error-open-another"
              aria-controls="cal-file-picker"
              onClick={() => fileInputRef.current?.click()}
              disabled={disabled}
              className="w-full max-md:h-[50px] md:w-auto"
            >
              {t('error.openAnother')}
            </Button>

            <Button
              variant="secondary"
              size="lg"
              data-testid="parse-error-load-demo"
              onClick={() => onLoadDemoLot('edge-ring-etch')}
              disabled={disabled}
              className="w-full md:w-auto"
            >
              {t('error.loadDemo')}
            </Button>
          </div>

          <div className="mt-3">
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
        /* premium §6.1 hero: headline top y = 140 (1440), 116 (1280), 104 (1024), 88 (390); centred from 1024, left-aligned below */
        <div className="pt-10 text-left lg:mx-auto lg:max-w-[880px] lg:pt-[52px] lg:text-center xl:pt-16 min-[90rem]:pt-[88px]">
          <h1
            data-testid="landing-headline"
            className="landing-headline type-display-xl text-text-primary"
          >
            {t('landing.headline')}
          </h1>

          <p
            data-testid="landing-subline"
            className="mt-4 line-clamp-3 type-title-3 text-text-secondary sm:max-w-[640px] lg:mx-auto min-[90rem]:mt-5"
          >
            {t('landing.subline')}
          </p>

          <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center lg:justify-center min-[90rem]:mt-8">
            <Button
              variant="primary"
              size="lg"
              data-testid="landing-open-sample-button"
              onClick={() => onLoadDemoLot('edge-ring-etch')}
              disabled={disabled}
              className={cn(
                'h-12 w-full sm:w-auto',
                // premium §7.11 primary: `ink` fill, `on-ink` text (A20)
                'bg-ink text-on-ink enabled:hover:bg-[#333336] enabled:active:bg-black',
                'dark:enabled:hover:bg-white dark:enabled:active:bg-[#e8e8ed]',
              )}
            >
              {t('landing.primary')}
            </Button>

            <Button
              variant="secondary"
              size="lg"
              data-testid="landing-open-stdf-button"
              aria-controls="cal-file-picker"
              onClick={() => fileInputRef.current?.click()}
              disabled={disabled}
              className={cn(
                'h-11 w-full sm:h-12 sm:w-auto',
                // premium §7.11 secondary: `fill-2`, hover `fill-3`
                'bg-fill-2 text-text-primary enabled:hover:bg-fill-3 enabled:active:bg-fill-3',
              )}
            >
              {t('landing.secondary')}
            </Button>
          </div>

          <p
            data-testid="landing-hint"
            className="mt-3 type-subhead text-text-tertiary"
          >
            <span className="sm:hidden">{t('landing.hintShort')}</span>
            <span className="max-sm:hidden">{t('landing.hint')}</span>
          </p>
        </div>
      )}

      {/* premium §6.1 sample cards: mobile scroll-snap carousel (46 px peek), sm stacked rows, 3-up grid from 1024 */}
      {cause !== 'no-results' ? (
        <>
          <section
            aria-labelledby={sampleHeadingId}
            className={cn(
              'mt-6 sm:mt-10 lg:mt-8 min-[90rem]:mt-14',
              cause === 'parse-failed' && 'md:mt-10',
            )}
          >
            <h2
              id={sampleHeadingId}
              data-testid="landing-sample-heading"
              className="type-headline text-text-primary"
            >
              {t('landing.demoHeading')}
            </h2>

            <div
              data-testid="landing-demo-cards"
              className={cn(
                '-mx-4 mt-1 flex snap-x snap-mandatory scroll-px-4 gap-3 overflow-x-auto px-4 pt-2 pb-8 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
                '-mb-6 sm:mx-0 sm:mt-4 sm:mb-0 sm:flex-col sm:gap-4 sm:overflow-visible sm:p-0 sm:snap-none',
                'lg:grid lg:grid-cols-3 lg:gap-6',
              )}
            >
              {presets.map((preset) => (
                <DemoLotCardButton
                  key={preset.id}
                  presetId={preset.id}
                  disabled={disabled}
                  onLoadDemoLot={onLoadDemoLot}
                  {...(renderWorkerThumbnail !== undefined
                    ? { renderWorkerThumbnail }
                    : {})}
                />
              ))}
            </div>
          </section>

          {/* premium §6.1 footer line: privacy left (subhead tertiary), "Download sample files" text button right */}
          <footer className="mt-8 flex flex-wrap items-center justify-between gap-4 lg:mt-6 min-[90rem]:mt-14">
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
                  // premium §7.11 text button: `text-secondary`, hover `text-primary`, pressed 0.64, ::after +8 px
                  'relative cursor-pointer rounded-pill bg-transparent p-0 type-control text-text-secondary shadow-none select-none',
                  "after:absolute after:-inset-2 after:content-['']",
                  'transition-[color,opacity] duration-[120ms] ease-[var(--ease-out)] [@media(hover:hover)]:enabled:hover:text-text-primary enabled:active:opacity-64',
                  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink',
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
