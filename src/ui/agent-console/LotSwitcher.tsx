'use client';

import { ChevronDown, Loader2, RotateCcw } from 'lucide-react';
import { motion } from 'motion/react';
import { listDemoPresets, type DemoPresetId, type DemoPresetMeta } from '@/core/demo';
import { Untranslated, useT } from '@/ui/i18n';
import { SPRING_TACTILE, useReducedMotionPreference } from '@/ui/motion';
import {
  Button,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/ui/primitives';

const labels = {
  'edge-ring-etch': 'agents.lot.edgeRing',
  'handling-scratch': 'agents.lot.scratch',
  'site2-probe-contact': 'agents.lot.site2',
} as const;

const PRESET_BADGES: Record<
  DemoPresetId,
  { readonly code: string; readonly dotClass: string }
> = {
  'edge-ring-etch': { code: 'SBIN 7', dotClass: 'at-dot-signal' },
  'handling-scratch': { code: 'SBIN 9', dotClass: 'at-dot-iris' },
  'site2-probe-contact': { code: 'SITE 1:2', dotClass: 'at-dot-emerald' },
};

interface Props {
  activePresetId: DemoPresetId | null;
  activeLotLabel: string | null;
  loadingPresetId: DemoPresetId | null;
  error: { presetId: DemoPresetId; message: string } | null;
  disabled: boolean;
  variant: 'empty' | 'header';
  onSelectPreset: (id: DemoPresetId) => void;
}

function Spinner() {
  const { t } = useT();
  return (
    <Loader2
      aria-label={t('agents.lot.loading')}
      className="size-3.5 shrink-0 animate-spin motion-reduce:animate-none"
    />
  );
}

function PresetChannel({
  preset,
  active,
  busy,
  disabled,
  reducedMotion,
  onSelectPreset,
}: Pick<Props, 'disabled' | 'onSelectPreset'> & {
  preset: DemoPresetMeta;
  active: boolean;
  busy: boolean;
  reducedMotion: boolean;
}) {
  const { t } = useT();
  const badge = PRESET_BADGES[preset.id];
  return (
    <button
      type="button"
      disabled={disabled}
      aria-busy={busy}
      aria-pressed={active}
      data-testid={`agent-lot-option-${preset.id}`}
      title={preset.title}
      onClick={() => onSelectPreset(preset.id)}
      className={cn(
        'group relative flex w-full cursor-pointer touch-manipulation flex-col items-start gap-1 rounded-[12px] px-3 py-2.5 text-left',
        'transition-[background-color,scale,transform] duration-[140ms] ease-[var(--ease-out)]',
        !active && '[@media(hover:hover)]:hover:bg-fill-1',
        'active:scale-[0.985] motion-reduce:active:scale-100',
        'focus-visible:shadow-focus-ring focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-60',
      )}
    >
      {active ? (
        <motion.span
          layoutId="agent-lot-pill"
          aria-hidden="true"
          transition={reducedMotion ? { duration: 0 } : SPRING_TACTILE}
          className="pointer-events-none absolute inset-0 rounded-[12px] bg-fill-2 shadow-[inset_0_0_0_1px_var(--chroma-line)]"
        />
      ) : null}
      <span className="relative z-[1] flex w-full items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden="true" className={cn('size-1.5 rounded-full', badge.dotClass)} />
          <Untranslated className="font-mono text-[10.5px] text-text-tertiary">
            {badge.code}
          </Untranslated>
        </span>
        {busy ? <Spinner /> : null}
      </span>
      <span className="relative z-[1] line-clamp-1 type-control text-text-primary">
        {t(labels[preset.id])}
      </span>
      <span className="relative z-[1] line-clamp-1 type-caption text-text-tertiary">
        {preset.subtitle}
      </span>
    </button>
  );
}

export function LotSwitcher({
  activePresetId,
  activeLotLabel,
  loadingPresetId,
  error,
  disabled,
  variant,
  onSelectPreset,
}: Props) {
  const { t } = useT();
  const reducedMotion = useReducedMotionPreference();
  const presets = listDemoPresets();
  const locked = disabled || loadingPresetId !== null;
  return (
    <div
      role="group"
      aria-label={t('agents.lot.pickerLabel')}
      aria-busy={loadingPresetId !== null}
      data-testid="agent-lot-switcher"
    >
      {variant === 'empty' ? (
        <div className="grid gap-1.5 sm:grid-cols-3">
          {presets.map((preset) => (
            <PresetChannel
              key={preset.id}
              preset={preset}
              active={activePresetId === preset.id}
              busy={loadingPresetId === preset.id}
              disabled={locked}
              reducedMotion={reducedMotion}
              onSelectPreset={onSelectPreset}
            />
          ))}
        </div>
      ) : (
        <DropdownMenu>
          <DropdownMenuTrigger
            disabled={locked}
            data-testid="agent-lot-trigger"
            aria-label={t('agents.lot.switchAria', {
              id: activeLotLabel ?? t('agents.noLot'),
            })}
            className={cn(
              'at-well-crisp inline-flex h-8 max-w-full cursor-pointer items-center gap-1.5 rounded-pill px-3 type-control text-text-primary',
              'transition-[background-color,scale,transform] duration-[120ms] ease-[var(--ease-out)]',
              '[@media(hover:hover)]:hover:bg-fill-2 active:scale-[0.98] motion-reduce:active:scale-100',
              'focus-visible:shadow-focus-ring focus-visible:outline-none disabled:opacity-60',
            )}
          >
            {loadingPresetId ? (
              <Spinner />
            ) : (
              <span
                aria-hidden="true"
                className={cn(
                  'size-1.5 shrink-0 rounded-full',
                  activeLotLabel ? 'at-dot-emerald' : 'bg-text-disabled',
                )}
              />
            )}
            <span className="truncate">{activeLotLabel ?? t('agents.noLot')}</span>
            <ChevronDown className="size-3 shrink-0 text-text-tertiary" />
          </DropdownMenuTrigger>
          <DropdownMenuContent aria-label={t('agents.lot.pickerLabel')} className="w-64">
            {presets.map((preset) => (
              <DropdownMenuRadioItem
                key={preset.id}
                value={preset.id}
                checked={activePresetId === preset.id}
                disabled={locked}
                data-testid={`agent-lot-option-${preset.id}`}
                onSelect={() => onSelectPreset(preset.id)}
              >
                {loadingPresetId === preset.id && <Spinner />}
                {t(labels[preset.id])}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      {error ? (
        <div
          role="alert"
          data-testid="agent-lot-error"
          className="at-well-crisp mt-2 flex flex-wrap items-center justify-between gap-2 rounded-control px-3 py-1.5 type-caption text-text-primary"
        >
          <span>{error.message}</span>
          <Button
            variant="text"
            size="sm"
            disabled={locked}
            onClick={() => onSelectPreset(error.presetId)}
          >
            <RotateCcw className="size-3" />
            {t(labels[error.presetId])}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
