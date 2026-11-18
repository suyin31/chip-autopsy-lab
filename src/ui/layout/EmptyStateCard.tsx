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
import { MOTION_TOKENS, SPRING_TOKENS } from '@/ui/tokens';
import {
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

const LANDING_WAFER_DIAMETER_PX = 168 as const;
const LANDING_VIGNETTE_DIAMETER_PX = 252 as const; // 168 * 1.5 (§2.1)

interface DemoWaferThumbnailProps {
  readonly presetId: DemoPresetId;
  readonly renderWorkerThumbnail?: (
    presetId: DemoPresetId,
    cssSize: number,
    dpr: number,
  ) => Promise<ImageBitmap | null>;
}

function DemoWaferThumbnail({
  presetId,
  renderWorkerThumbnail,
}: DemoWaferThumbnailProps): React.JSX.Element {
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);
  const preview = React.useMemo(
    () => getDemoPresetPreview(presetId),
    [presetId],
  );

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
    const dims = resolveCanvasPixelSize(
      LANDING_WAFER_DIAMETER_PX,
      LANDING_WAFER_DIAMETER_PX,
      dpr,
    );
    if (canvas.width !== dims.pixelWidth) {
      canvas.width = dims.pixelWidth;
    }
    if (canvas.height !== dims.pixelHeight) {
      canvas.height = dims.pixelHeight;
    }
    paintLandingCardWafer(ctx, {
      wafer: preview.wafer,
      dies: preview.dies,
      cssSize: LANDING_WAFER_DIAMETER_PX,
      dpr: dims.dpr,
    });

    if (!renderWorkerThumbnail) {
      return;
    }
    let cancelled = false;
    void renderWorkerThumbnail(
      presetId,
      LANDING_WAFER_DIAMETER_PX,
      dims.dpr,
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
  }, [presetId, preview, renderWorkerThumbnail]);

  return (
    <div className="relative flex h-[176px] w-full shrink-0 items-center justify-center overflow-hidden rounded-md bg-bg md:h-[196px]">
      {/* Radial vignette behind wafer: diameter = 168 * 1.5 = 252 px (§2.1, §3.1) */}
      <div
        aria-hidden="true"
        style={{
          width: `${LANDING_VIGNETTE_DIAMETER_PX}px`,
          height: `${LANDING_VIGNETTE_DIAMETER_PX}px`,
          backgroundImage: 'var(--vignette)',
        }}
        className="pointer-events-none absolute rounded-full"
      />

      <div className="relative transition-transform duration-[240ms] ease-[var(--ease-out)] [@media(hover:hover)]:group-hover:scale-[1.03]">
        <canvas
          ref={canvasRef}
          data-testid={`landing-demo-wafer-${presetId}`}
          aria-hidden="true"
          style={{
            width: `${LANDING_WAFER_DIAMETER_PX}px`,
            height: `${LANDING_WAFER_DIAMETER_PX}px`,
          }}
          className="pointer-events-none block select-none"
        />
        {/* Faint top-light sheen masked to the wafer disc (§2.1) */}
        <div
          aria-hidden="true"
          style={{ backgroundImage: 'var(--top-light)' }}
          className="pointer-events-none absolute inset-0 rounded-full"
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
  const meta = t('landing.demoMeta', {
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
        'group flex h-[280px] w-[300px] shrink-0 snap-start cursor-pointer flex-col rounded-lg bg-surface-1 p-2 text-left ring-surface shadow-none select-none',
        'md:h-[300px] md:w-auto',
        'transition-[background-color,box-shadow,opacity] duration-[120ms] ease-[var(--ease-out)]',
        '[@media(hover:hover)]:enabled:hover:bg-surface-2 [@media(hover:hover)]:enabled:hover:ring-surface-strong',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
        'disabled:cursor-not-allowed disabled:opacity-40',
      )}
    >
      <DemoWaferThumbnail
        presetId={presetId}
        {...(renderWorkerThumbnail !== undefined
          ? { renderWorkerThumbnail }
          : {})}
      />

      <div id={descId} className="flex min-w-0 flex-1 flex-col px-3 pt-3.5 pb-1.5">
        <span className="truncate type-headline text-text-primary">{title}</span>
        <span className="mt-1 truncate type-callout text-text-secondary">
          {description}
        </span>
        <span className="mt-2 truncate type-footnote text-text-tertiary">
          {meta}
        </span>
      </div>
    </button>
  );
}

/**
 * Landing hero, 3 demo wafer cards, and §3.7 parse-error hero (`src/ui/layout/EmptyStateCard.tsx`):
 * - `first-run`: 80px `"Drop the body."` hero at `y = 148` desktop / `y = 96` mobile, primary
 *   `"Open STDF file"` button, 3 one-click demo lot cards with `168px` W01 thumbnails + vignette,
 *   and privacy footer + `"Download demo files"` menu (`redesign.md` §3.1)
 * - `parse-failed`: icon-free localized error view per §3.7 code table at `y = 180` desktop with
 *   `"Open another file"`, `"Load demo lot"`, and `"Show details"` sheet, keeping demo cards below
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
      className="flex flex-col pb-12 md:pb-16"
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
        /* §3.1 First-run Landing Hero: top y=148 desktop (52 + 96), y=96 mobile (48 + 48) */
        <div className="pt-12 text-left md:mx-auto md:max-w-[880px] md:pt-24 md:text-center">
          <h1
            data-testid="landing-headline"
            className="type-display-xl text-text-primary"
          >
            {t('landing.headline')}
          </h1>

          <p className="mt-3 type-title-3 text-text-secondary md:mx-auto md:mt-4 md:max-w-[640px]">
            {t('landing.subline')}
          </p>

          <div className="mt-6 md:mt-8">
            <Button
              variant="primary"
              size="lg"
              data-testid="landing-open-stdf-button"
              aria-controls="cal-file-picker"
              onClick={() => fileInputRef.current?.click()}
              disabled={disabled}
              className="w-full max-md:h-[50px] md:w-auto"
            >
              {t('landing.primary')}
            </Button>
          </div>

          <p className="mt-2 type-footnote text-text-tertiary md:mt-3">
            {t('landing.formats')}
          </p>
        </div>
      )}

      {/* §3.1 Demo cards row (3x4 cols desktop, scroll-snap carousel on mobile with 46px peek) */}
      {cause !== 'no-results' ? (
        <>
          <section
            aria-label={t('landing.demoHeading')}
            className="mt-7 md:mt-8"
          >
            <h2 className="sr-only">{t('landing.demoHeading')}</h2>

            <div
              data-testid="landing-demo-cards"
              className={cn(
                '-mx-4 flex snap-x snap-mandatory scroll-px-4 gap-3 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
                'md:mx-0 md:grid md:grid-cols-3 md:gap-6 md:overflow-visible md:px-0 md:pb-0',
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

          {/* §3.1 Footer line: privacy left, Download demo files menu right */}
          <footer className="mt-8 flex flex-wrap items-center justify-between gap-4 md:mt-12">
            <p className="type-footnote text-text-tertiary">
              {t('landing.privacy')}
            </p>

            <DropdownMenu>
              <DropdownMenuTrigger
                data-testid="landing-download-demos-trigger"
                disabled={disabled}
                className={cn(
                  'relative cursor-pointer rounded-pill bg-transparent p-0 type-footnote text-text-tertiary shadow-none select-none',
                  "after:absolute after:-inset-2.5 after:content-['']",
                  'transition-colors duration-[120ms] ease-[var(--ease-out)] enabled:hover:text-text-primary enabled:active:opacity-70',
                  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
                  'disabled:cursor-not-allowed disabled:opacity-40',
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
