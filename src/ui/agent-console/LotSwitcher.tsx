'use client';

import { useRef } from 'react';
import { ChevronDown, Loader2, RotateCcw } from 'lucide-react';
import { listDemoPresets, type DemoPresetId, type DemoPresetMeta } from '@/core/demo';
import { useT } from '@/ui/i18n';
import { useTactileTilt } from '@/ui/motion/use-tactile-tilt';
import { Button, DropdownMenu, DropdownMenuContent, DropdownMenuRadioItem, DropdownMenuTrigger } from '@/ui/primitives';

const labels = {
  'edge-ring-etch': 'agents.lot.edgeRing',
  'handling-scratch': 'agents.lot.scratch',
  'site2-probe-contact': 'agents.lot.site2',
} as const;

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
  return <Loader2 aria-label={t('agents.lot.loading')} className="size-4 shrink-0 animate-spin motion-reduce:animate-none" />;
}

function PresetCard({ preset, busy, disabled, onSelectPreset }: Pick<Props, 'disabled' | 'onSelectPreset'> & { preset: DemoPresetMeta; busy: boolean }) {
  const { t } = useT();
  const ref = useRef<HTMLButtonElement>(null);
  useTactileTilt(ref, { maxDeg: 2, liftPx: 3, disabled });
  return <button type="button" ref={ref} data-tactile="" data-spotlight="true"
    className="cal-tactile relative rounded-control border border-hairline bg-fill-1 px-3 py-2 text-left focus-visible:shadow-focus-ring"
    data-testid={`agent-lot-option-${preset.id}`} title={preset.title} disabled={disabled} aria-busy={busy}
    onClick={() => onSelectPreset(preset.id)}>
    <span className="flex items-center gap-1 type-control">{busy && <Spinner />}{t(labels[preset.id])}</span>
    <span className="type-caption text-text-tertiary">{preset.subtitle}</span>
  </button>;
}

export function LotSwitcher({ activePresetId, activeLotLabel, loadingPresetId, error, disabled, variant, onSelectPreset }: Props) {
  const { t } = useT();
  const presets = listDemoPresets();
  const locked = disabled || loadingPresetId !== null;
  return <div role="group" aria-label={t('agents.lot.pickerLabel')} aria-busy={loadingPresetId !== null} data-testid="agent-lot-switcher">
    {variant === 'empty' ? <div className="grid gap-2 sm:grid-cols-3">
      {presets.map(preset => <PresetCard key={preset.id} preset={preset} busy={loadingPresetId === preset.id} disabled={locked} onSelectPreset={onSelectPreset} />)}
    </div> : <DropdownMenu>
      <DropdownMenuTrigger disabled={locked} data-testid="agent-lot-trigger" aria-label={t('agents.lot.switchAria', { id: activeLotLabel ?? t('agents.noLot') })}
        className="inline-flex max-w-full items-center gap-1 rounded-pill bg-fill-1 px-3 py-1 type-control">
        {loadingPresetId && <Spinner />}<span className="truncate">{activeLotLabel ?? t('agents.noLot')}</span><ChevronDown className="size-3 shrink-0" />
      </DropdownMenuTrigger>
      <DropdownMenuContent aria-label={t('agents.lot.pickerLabel')} className="w-64">
        {presets.map(preset => <DropdownMenuRadioItem key={preset.id} value={preset.id} checked={activePresetId === preset.id}
          disabled={locked} data-testid={`agent-lot-option-${preset.id}`} onSelect={() => onSelectPreset(preset.id)}>
          {loadingPresetId === preset.id && <Spinner />}{t(labels[preset.id])}
        </DropdownMenuRadioItem>)}
      </DropdownMenuContent>
    </DropdownMenu>}
    {error && <div role="alert" data-testid="agent-lot-error" className="type-caption">
      {error.message} <Button variant="text" size="sm" disabled={locked} onClick={() => onSelectPreset(error.presetId)}>
        <RotateCcw className="size-3" />{t(labels[error.presetId])}
      </Button>
    </div>}
  </div>;
}
