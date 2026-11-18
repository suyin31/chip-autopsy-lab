'use client';

import { ChevronDown, File } from 'lucide-react';
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
  Tooltip,
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
 * Centre navigation lot picker (premium §7.2):
 * - Trigger: `fill-2` pill 32 h, padding 0 12 0 14, max 420; lot ID (never truncates) + 8 px +
 *   title (hidden < 1024, truncates first) + 6 px + 12 px `text-tertiary` chevron (180° when open);
 *   hover and open `fill-3`, pressed 0.97, disabled `text-disabled`; tooltip `glossary.lot` after 600 ms
 * - Menu 360 wide, padding 8: "Sample lots" rows 56 h (40 px disc, `row-title`, "Yield 82.8%, 25 wafers"),
 *   "Recent files" rows 48 h (file icon, name, size), then "Open file…" with a keycap
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
  const { t, formatPercent, formatFileSize, formatInteger } = useT();
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

  const rowClass =
    'grid grid-cols-[40px_minmax(0,1fr)_16px] items-center gap-3 rounded-lg px-3 py-2';

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <Tooltip
        content={t('glossary.lot')}
        disabled={open || disabled}
        className="min-w-0"
      >
        <DropdownMenuTrigger
          data-testid="lot-picker-trigger"
          disabled={disabled}
          aria-label={t('lotPicker.triggerAria', { lotId: cleanLotId })}
          className={cn(
            'group relative inline-flex h-8 max-w-[min(420px,calc(100vw-164px))] min-w-0 cursor-pointer items-center rounded-pill bg-fill-2 pl-[14px] pr-3 shadow-none select-none',
            "after:absolute after:inset-x-0 after:-inset-y-1 after:content-[''] pointer-coarse:after:-inset-y-1.5",
            'transition-[transform,background-color,color,opacity] duration-[120ms] ease-[var(--ease-out)]',
            'enabled:hover:bg-fill-3 aria-expanded:bg-fill-3 motion-safe:enabled:active:scale-[0.97]',
            'disabled:cursor-not-allowed',
            className,
          )}
        >
          <Untranslated className="shrink-0 whitespace-nowrap type-control text-text-primary group-disabled:text-text-disabled">
            {cleanLotId}
          </Untranslated>

          {triggerTitle ? (
            <span className="ml-2 hidden min-w-0 truncate type-control text-text-secondary group-disabled:text-text-disabled lg:inline">
              {triggerTitle}
            </span>
          ) : null}

          <motion.span
            aria-hidden="true"
            animate={{ rotate: open ? 180 : 0 }}
            transition={
              shouldReduceMotion ? { duration: 0 } : SPRING_TOKENS.snappy
            }
            className="ml-1.5 inline-flex size-3 shrink-0 items-center justify-center text-text-tertiary group-disabled:text-text-disabled"
          >
            <ChevronDown className="size-3" strokeWidth={1.5} />
          </motion.span>
        </DropdownMenuTrigger>
      </Tooltip>

      <DropdownMenuContent
        align="center"
        sideOffset={8}
        expectedWidthPx={360}
        data-testid="lot-picker-menu"
        className="w-[360px] max-w-[calc(100vw-16px)] p-2"
      >
        <DropdownMenuLabel className="px-3 pt-2 pb-1">
          {t('lotPicker.demoSection')}
        </DropdownMenuLabel>

        {presets.map((preset) => {
          const preview = getDemoPresetPreview(preset.id);
          const title = t(DEMO_TITLE_KEYS[preset.id]);
          const metaText = t('lotPicker.yield', {
            yield: formatPercent(preview.finalYield),
            wafers: formatInteger(preset.waferCount),
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
              data-testid={`lot-picker-row-${preset.id}`}
              leading={<DemoThumbCanvas presetId={preset.id} />}
              onSelect={() => onSelectDemoPreset(preset.id)}
              className={cn(rowClass, 'h-14')}
            >
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="truncate type-row-title text-text-primary">
                  {title}
                </span>
                <span className="truncate type-subhead text-text-tertiary tabular-nums">
                  {metaText}
                </span>
              </span>
            </DropdownMenuRadioItem>
          );
        })}

        {cappedRecents.length > 0 ? (
          <>
            <DropdownMenuSeparator className="mx-3 my-1" />
            <DropdownMenuLabel className="px-3 pt-2 pb-1">
              {t('lotPicker.recentSection')}
            </DropdownMenuLabel>
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
                  leading={
                    <span className="flex size-10 items-center justify-center">
                      <File
                        className="size-4 text-text-secondary"
                        strokeWidth={1.5}
                        aria-hidden="true"
                      />
                    </span>
                  }
                  onSelect={() => onSelectRecentLot(entry.id)}
                  className={cn(rowClass, 'h-12')}
                >
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <Untranslated className="truncate type-row-title text-text-primary">
                      {cleanName}
                    </Untranslated>
                    <span className="truncate type-subhead text-text-tertiary tabular-nums">
                      {formatFileSize(entry.byteSize)}
                    </span>
                  </span>
                </DropdownMenuRadioItem>
              );
            })}
          </>
        ) : null}

        <DropdownMenuSeparator className="mx-3 my-1" />

        <DropdownMenuItem
          typeaheadLabel={t('lotPicker.openFile')}
          data-testid="lot-picker-open-file"
          onSelect={onOpenFilePicker}
          className="px-3"
        >
          <span>{t('lotPicker.openFile')}</span>
          <DropdownMenuShortcut className="text-text-secondary">
            {shortcutLabel}
          </DropdownMenuShortcut>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
