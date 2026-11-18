'use client';

import { ChevronDown } from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';
import * as React from 'react';
import {
  type DemoPresetId,
  getDemoPresetPreview,
  listDemoPresets,
} from '@/core/demo';
import type { MessageKey } from '@/core/i18n';
import { sanitizeReportProseText } from '@/core/report';
import { Untranslated, useT } from '@/ui/i18n';
import {
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from '@/ui/primitives';
import { SPRING_TOKENS } from '@/ui/tokens';
import { usePrefersMoreContrast } from '@/ui/wafer-map/use-prefers-more-contrast';
import {
  paintWaferThumbnail,
  resolveCanvasPixelSize,
} from '@/ui/wafer-map/wafer-geometry';

const DEMO_THUMB_SIZE_PX = 40 as const;

const DEMO_TITLE_KEYS = {
  'edge-ring-etch': 'demo.edgeRing.title',
  'handling-scratch': 'demo.scratch.title',
  'site2-probe-contact': 'demo.site2.title',
} as const satisfies Record<DemoPresetId, MessageKey>;

export interface RecentLotEntry {
  readonly id: string;
  readonly fileName: string;
  readonly byteSize: number;
  readonly lotId: string;
}

export interface LotPickerProps {
  readonly currentLotId: string;
  readonly currentPresetId: DemoPresetId | null;
  readonly currentRecentId: string | null;
  readonly currentCustomTitle?: string;
  readonly recentLots: readonly RecentLotEntry[];
  readonly onSelectDemoPreset: (presetId: DemoPresetId) => void;
  readonly onSelectRecentLot: (recentId: string) => void;
  readonly onOpenFilePicker: () => void;
  readonly disabled?: boolean;
  readonly defaultOpen?: boolean;
  readonly className?: string;
}

interface DemoThumbCanvasProps {
  readonly presetId: DemoPresetId;
}

function DemoThumbCanvas({ presetId }: DemoThumbCanvasProps): React.JSX.Element {
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);
  const preview = React.useMemo(() => getDemoPresetPreview(presetId), [presetId]);
  const highContrast = usePrefersMoreContrast();

  React.useEffect(() => {
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
      DEMO_THUMB_SIZE_PX,
      DEMO_THUMB_SIZE_PX,
      dpr,
    );
    if (canvas.width !== dims.pixelWidth) {
      canvas.width = dims.pixelWidth;
    }
    if (canvas.height !== dims.pixelHeight) {
      canvas.height = dims.pixelHeight;
    }
    paintWaferThumbnail(ctx, {
      wafer: preview.wafer,
      dies: preview.dies,
      cssSize: DEMO_THUMB_SIZE_PX,
      dpr: dims.dpr,
      highContrast,
    });
  }, [preview, highContrast]);

  return (
    <canvas
      ref={canvasRef}
      data-testid="lot-picker-demo-thumb"
      aria-hidden="true"
      style={{
        width: `${DEMO_THUMB_SIZE_PX}px`,
        height: `${DEMO_THUMB_SIZE_PX}px`,
      }}
      className="pointer-events-none block size-10 shrink-0 rounded-full bg-bg ring-surface select-none"
    />
  );
}

/**
 * Centre navigation `LotPicker` menu implementing `redesign.md` §4.2:
 * - Pill trigger (`32 px` height, `0 12px 0 14px` padding, `surface-2` at 60%, `surface-3` on hover)
 * - Lot ID (`control` primary) + `8 px` + lot title (`control` secondary, hidden `< 1024 px`) + `6 px` + `12 px` chevron (`180°` `spring-snappy`)
 * - Menu (`360 px` width, material, radius `24 px`, padding `8 px`, anchored `top center`):
 *   1. `"Demo lots"`: 3 rows (`56 px` height, radius `16 px`, `40 px` wafer thumbnail, `headline` title, `footnote` yield meta, check icon)
 *   2. `"Recent"`: up to 3 session files (file name, formatted size)
 *   3. `"Open STDF file…"` with `"⌘O"` / `"Ctrl O"` shortcut cap
 */
export function LotPicker({
  currentLotId,
  currentPresetId,
  currentRecentId,
  currentCustomTitle,
  recentLots,
  onSelectDemoPreset,
  onSelectRecentLot,
  onOpenFilePicker,
  disabled = false,
  defaultOpen = false,
  className,
}: LotPickerProps): React.JSX.Element {
  const { t, formatPercent, formatFileSize } = useT();
  const shouldReduceMotion = useReducedMotion();
  const [open, setOpen] = React.useState(defaultOpen);
  const [shortcutLabel, setShortcutLabel] = React.useState('Ctrl O');

  React.useEffect(() => {
    if (typeof navigator === 'undefined') {
      return;
    }
    const platform = `${navigator.platform ?? ''} ${navigator.userAgent ?? ''}`;
    if (/Mac|iPhone|iPad|iPod/i.test(platform)) {
      setShortcutLabel('⌘O');
    }
  }, []);

  const presets = React.useMemo(() => listDemoPresets(), []);
  const cleanLotId = sanitizeReportProseText(currentLotId) || 'UNKNOWN';

  const triggerTitle = React.useMemo(() => {
    if (currentPresetId !== null) {
      return t(DEMO_TITLE_KEYS[currentPresetId]);
    }
    if (currentRecentId !== null) {
      const matched = recentLots.find((item) => item.id === currentRecentId);
      if (matched) {
        return sanitizeReportProseText(matched.fileName);
      }
    }
    return currentCustomTitle
      ? sanitizeReportProseText(currentCustomTitle)
      : '';
  }, [currentCustomTitle, currentPresetId, currentRecentId, recentLots, t]);

  const cappedRecents = recentLots.slice(0, 3);

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger
        data-testid="lot-picker-trigger"
        disabled={disabled}
        aria-label={t('lotPicker.triggerAria', { lotId: cleanLotId })}
        className={cn(
          'relative inline-flex h-8 max-w-[calc(100vw-164px)] cursor-pointer items-center rounded-pill bg-surface-2/60 pl-[14px] pr-3 shadow-none select-none',
          "after:absolute after:inset-x-0 after:-inset-y-1.5 after:content-[''] md:after:-inset-y-1",
          'transition-[transform,background-color,color,opacity] duration-[120ms] ease-[var(--ease-out)] active:duration-[100ms]',
          'enabled:hover:bg-surface-3 enabled:active:scale-[0.97]',
          'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
          'disabled:cursor-not-allowed disabled:opacity-40',
          className,
        )}
      >
        <Untranslated className="truncate type-control text-text-primary">
          {cleanLotId}
        </Untranslated>

        {triggerTitle ? (
          <span className="ml-2 hidden lg:inline max-w-[220px] truncate type-control text-text-secondary">
            {triggerTitle}
          </span>
        ) : null}

        <motion.span
          aria-hidden="true"
          animate={{ rotate: open ? 180 : 0 }}
          transition={
            shouldReduceMotion ? { duration: 0 } : SPRING_TOKENS.snappy
          }
          className="ml-1.5 inline-flex size-3 shrink-0 items-center justify-center text-text-secondary"
        >
          <ChevronDown className="size-3" strokeWidth={1.75} />
        </motion.span>
      </DropdownMenuTrigger>

      <DropdownMenuContent
        align="center"
        sideOffset={8}
        expectedWidthPx={360}
        data-testid="lot-picker-menu"
        className="w-[360px] max-w-[calc(100vw-16px)]"
      >
        <DropdownMenuLabel>{t('lotPicker.demoSection')}</DropdownMenuLabel>

        {presets.map((preset) => {
          const preview = getDemoPresetPreview(preset.id);
          const title = t(DEMO_TITLE_KEYS[preset.id]);
          const yieldText = t('lotPicker.yield', {
            yield: formatPercent(preview.finalYield),
          });
          const isCurrent =
            currentRecentId === null && currentPresetId === preset.id;

          return (
            <DropdownMenuRadioItem
              key={preset.id}
              value={preset.id}
              checked={isCurrent}
              checkAriaLabel={t('lotPicker.current')}
              typeaheadLabel={title}
              onSelect={() => onSelectDemoPreset(preset.id)}
              className="min-h-14 rounded-lg px-3 py-2"
            >
              <span className="flex min-w-0 items-center gap-3">
                <DemoThumbCanvas presetId={preset.id} />
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="truncate type-headline text-text-primary">
                    {title}
                  </span>
                  <span className="type-subhead text-text-tertiary tabular-nums">
                    {yieldText}
                  </span>
                </span>
              </span>
            </DropdownMenuRadioItem>
          );
        })}

        {cappedRecents.length > 0 ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>{t('lotPicker.recentSection')}</DropdownMenuLabel>
            {cappedRecents.map((entry) => {
              const cleanName =
                sanitizeReportProseText(entry.fileName) || 'wafer.stdf';
              const isCurrent = currentRecentId === entry.id;
              return (
                <DropdownMenuRadioItem
                  key={entry.id}
                  value={entry.id}
                  checked={isCurrent}
                  checkAriaLabel={t('lotPicker.current')}
                  typeaheadLabel={cleanName}
                  onSelect={() => onSelectRecentLot(entry.id)}
                  className="rounded-lg px-3 py-2"
                >
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <Untranslated className="truncate type-control text-text-primary">
                      {cleanName}
                    </Untranslated>
                    <span className="type-subhead text-text-tertiary tabular-nums">
                      {formatFileSize(entry.byteSize)}
                    </span>
                  </span>
                </DropdownMenuRadioItem>
              );
            })}
          </>
        ) : null}

        <DropdownMenuSeparator />

        <DropdownMenuItem
          typeaheadLabel={t('lotPicker.openFile')}
          onSelect={onOpenFilePicker}
          className="rounded-lg px-3 py-2"
        >
          <span>{t('lotPicker.openFile')}</span>
          <DropdownMenuShortcut>{shortcutLabel}</DropdownMenuShortcut>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
