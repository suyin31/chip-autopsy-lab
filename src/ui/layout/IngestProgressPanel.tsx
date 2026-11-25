'use client';

import { motion } from 'motion/react';
import * as React from 'react';
import { BorderBeam } from '@/ui/atelier/BorderBeam';
import { Untranslated, useT } from '@/ui/i18n';
import {
  resolveViewMorphTransition,
  useReducedMotionPreference,
  WAFER_MORPH_LAYOUT_ID,
} from '@/ui/motion';
import { WAFER_TOKENS } from '@/ui/tokens';
import { computeStageDiscLayerRects } from '@/ui/wafer-map/stage-layers';
import {
  paintWaferDiscMaterial,
  resolveCanvasPixelSize,
  resolveFitWaferDiameterPx,
} from '@/ui/wafer-map/wafer-geometry';
import type { WorkerParseProgress } from '@/workers';

export interface IngestProgressPanelProps {
  readonly label: string;
  readonly progress: WorkerParseProgress;
}

const useIsomorphicLayoutEffect =
  typeof window !== 'undefined' ? React.useLayoutEffect : React.useEffect;

interface AreaSize {
  readonly width: number;
  readonly height: number;
}

/**
 * Bare silicon disc for the loading stage (premium §6.3, §8.1 "Disc"): the §5.2 material at
 * the loaded view's fit diameter, plus the light ambient and contact shadows and the dark
 * halo (§5.1), drawn at frame 0 with no fade. The notch uses the 6 o'clock default because
 * `WCR` geometry is not known yet.
 */
function LoadingDisc(): React.JSX.Element {
  const reduced = useReducedMotionPreference();
  const areaRef = React.useRef<HTMLDivElement | null>(null);
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);
  const [size, setSize] = React.useState<AreaSize | null>(null);

  useIsomorphicLayoutEffect(() => {
    const el = areaRef.current;
    if (!el) {
      return;
    }
    const measure = (): void => {
      const rect = el.getBoundingClientRect();
      setSize((prev) =>
        prev && prev.width === rect.width && prev.height === rect.height
          ? prev
          : { width: rect.width, height: rect.height },
      );
    };
    measure();
    if (typeof ResizeObserver === 'undefined') {
      return;
    }
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const diameter =
    size && size.width > 0 && size.height > 0
      ? Math.max(0, resolveFitWaferDiameterPx(size.width, size.height))
      : 0;

  useIsomorphicLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !size || diameter <= 0) {
      return;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return;
    }
    const dpr = window.devicePixelRatio || 1;
    const dims = resolveCanvasPixelSize(size.width, size.height, dpr);
    canvas.width = dims.pixelWidth;
    canvas.height = dims.pixelHeight;
    ctx.setTransform(dims.dpr, 0, 0, dims.dpr, 0, 0);
    ctx.clearRect(0, 0, size.width, size.height);
    paintWaferDiscMaterial(ctx, {
      centerXCss: size.width / 2,
      centerYCss: size.height / 2,
      waferRadiusPx: diameter / 2,
      wfFlat: 'D',
      devicePixelCss: 1 / dims.dpr,
    });
  }, [size, diameter]);

  const rects =
    size && diameter > 0
      ? computeStageDiscLayerRects(size.width / 2, size.height / 2, diameter / 2)
      : null;

  return (
    <div
      ref={areaRef}
      aria-hidden="true"
      data-testid="ingest-loading-disc"
      data-wafer-diameter-px={Math.round(diameter)}
      className="relative aspect-square w-full lg:aspect-auto lg:min-h-0 lg:flex-1"
    >
      <motion.div
        aria-hidden="true"
        data-testid="wafer-shared-morph"
        data-morph-state={reduced ? 'settled' : 'morphing'}
        layoutId={reduced ? undefined : WAFER_MORPH_LAYOUT_ID}
        transition={resolveViewMorphTransition(reduced)}
        className="pointer-events-none absolute inset-0 rounded-full"
      />
      {rects ? (
        <>
          <div
            style={{ ...rects.ambient, backgroundImage: WAFER_TOKENS.ambientShadow }}
            className="pointer-events-none absolute dark:hidden"
          />
          <div
            style={{ ...rects.contact, backgroundImage: WAFER_TOKENS.contactShadow }}
            className="pointer-events-none absolute dark:hidden"
          />
          <div
            style={{ ...rects.halo, backgroundImage: WAFER_TOKENS.halo }}
            className="pointer-events-none absolute hidden dark:block"
          />
        </>
      ) : null}
      <canvas
        ref={canvasRef}
        style={size ? { width: size.width, height: size.height } : undefined}
        className="pointer-events-none absolute inset-0 block"
      />
    </div>
  );
}

/**
 * Loading state (premium §6.3), laid out exactly like the loaded verdict view (§6.2) so
 * nothing jumps when parsing ends:
 * - Stage column: header caption "Reading…" (`subhead` tertiary), the bare disc at the fit
 *   diameter, and space reserved for the control row and strip from 1024.
 * - Verdict column at the verdict position: `headline` file name (1 line, ellipsis); 8 px;
 *   `body` secondary status; 20 px; a readout well holding the 2 px `fill-3` track, 320 wide
 *   (full width below 640), `ink` fill scaled by `transform: scaleX(p)` from the left, the
 *   `subhead` tertiary bytes and the percent; one signal beam travels the well's edge.
 * - No skeletons, no spinners.
 */
export function IngestProgressPanel({
  label,
  progress,
}: IngestProgressPanelProps): React.JSX.Element {
  const { t, formatPercent, formatFileSize, formatInteger } = useT();

  const ratio =
    progress.totalBytes !== null && progress.totalBytes > 0
      ? Math.min(1, Math.max(0, progress.bytesProcessed / progress.totalBytes))
      : null;
  const pct = ratio !== null ? ratio * 100 : null;
  const pctLabel = ratio !== null ? formatPercent(ratio) : null;

  const statusCopy = t('loading.readingRecords');
  const bytesCopy =
    progress.totalBytes !== null && progress.totalBytes > 0
      ? t('loading.bytes', {
          done: formatFileSize(progress.bytesProcessed),
          total: formatFileSize(progress.totalBytes),
        })
      : formatFileSize(progress.bytesProcessed);

  const valueText =
    pctLabel !== null
      ? `${statusCopy}, ${pctLabel} (${bytesCopy}, ${formatInteger(progress.diesResolved)} dies)`
      : `${statusCopy}, ${bytesCopy} (${formatInteger(progress.diesResolved)} dies)`;

  return (
    <div
      data-testid="ingest-loading-view"
      aria-busy="true"
      className="flex w-full flex-col sm:max-lg:mx-auto sm:max-lg:max-w-[640px] lg:grid lg:grid-cols-[540px_minmax(0,1fr)] lg:items-start lg:gap-x-5 xl:grid-cols-12 xl:gap-x-6"
    >
      {/* Verdict column position (§6.2 padding-top 72, 84 at 1440) */}
      <div
        data-testid="ingest-progress-column"
        className="order-1 flex w-full min-w-0 flex-col lg:order-none lg:col-start-2 lg:row-start-1 lg:pt-[72px] xl:col-span-5 xl:col-start-8 min-[90rem]:pt-[84px]"
      >
        <p
          data-testid="ingest-file-name"
          className="truncate type-headline text-text-primary"
        >
          <Untranslated>{label}</Untranslated>
        </p>

        <p
          aria-live="polite"
          aria-atomic="true"
          className="mt-2 type-body text-text-secondary"
        >
          {statusCopy}
          {pctLabel !== null ? (
            <span className="sr-only"> ({pctLabel})</span>
          ) : null}
        </p>

        {/* Readout well: the track sits in a groove, and one probe beam runs its edge while the
            worker reads. The beam goes dark the moment parsing ends (the panel unmounts). */}
        <div
          data-testid="ingest-readout"
          className="at-well relative mt-5 w-full rounded-[16px] px-4 pt-4 pb-3 sm:w-[352px]"
        >
          <BorderBeam active radius={16} size={64} durationS={3.2} data-testid="ingest-beam" />
          <div
            role="progressbar"
            data-testid="ingest-progress-track"
            aria-label={t('loading.progressAria', {
              percent: pctLabel ?? '0%',
            })}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={pct !== null ? Math.round(pct) : undefined}
            aria-valuetext={valueText}
            className="h-0.5 w-full overflow-hidden rounded-pill bg-fill-3 sm:w-80"
          >
            <div
              style={{
                transform: `scaleX(${ratio !== null ? Number(ratio.toFixed(4)) : 0.15})`,
                transformOrigin: 'left',
              }}
              className="h-full w-full rounded-pill bg-ink transition-transform duration-[120ms] ease-[var(--ease-out)]"
            />
          </div>

          <p className="mt-2.5 flex items-baseline justify-between gap-3 type-subhead text-text-tertiary tabular-nums">
            <span>{bytesCopy}</span>
            {pctLabel !== null ? (
              <span aria-hidden="true" className="text-text-secondary">
                {pctLabel}
              </span>
            ) : null}
          </p>
        </div>
      </div>

      {/* Stage column position (§6.2): same sticky box, header, and wafer area as the loaded stage */}
      <div
        data-testid="ingest-stage-column"
        className="order-2 -mx-4 mt-5 w-[calc(100%+2rem)] sm:mx-0 sm:w-full lg:sticky lg:top-[52px] lg:order-none lg:col-start-1 lg:row-start-1 lg:mt-0 lg:h-[calc(100dvh-52px)] lg:min-h-[640px] lg:pt-5 lg:pb-4 xl:col-span-7"
      >
        <div className="flex w-full flex-col lg:h-full">
          <div className="flex items-baseline px-4 pb-2 sm:h-10 sm:items-end sm:px-0">
            <p
              data-testid="ingest-stage-caption"
              className="type-subhead text-text-tertiary"
            >
              {t('stage.reading')}
            </p>
          </div>
          <LoadingDisc />
          {/* Reserved control row (72 at 1024–1279, 40 from 1280) + 12 gap + 76 strip */}
          <div aria-hidden="true" className="hidden lg:block lg:h-40 xl:h-32" />
        </div>
      </div>
    </div>
  );
}
