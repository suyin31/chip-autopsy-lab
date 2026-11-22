'use client';

import { useEffect, useRef, useState, type RefObject } from 'react';
import { motion } from 'motion/react';
import { useT } from '@/ui/i18n';
import { Button } from '@/ui/primitives';
import type { WorkerParseProgress } from '@/workers';

interface Props {
  variant: 'inline' | 'compact';
  consoleRef: RefObject<HTMLDivElement | null>;
  loading: boolean;
  progress: WorkerParseProgress | null;
  error: string | null;
  disabled: boolean;
  onSelectFile: (file: File) => void;
  onClearError: () => void;
  onDragStateChange?: (active: boolean) => void;
}

export function StdfDropZone({ variant, consoleRef, loading, progress, error, disabled, onSelectFile, onClearError, onDragStateChange }: Props) {
  const { t } = useT();
  const input = useRef<HTMLInputElement>(null);
  const [active, setActive] = useState(false);
  const locked = loading || disabled;
  useEffect(() => {
    const root = consoleRef.current;
    if (!root) return;
    let depth = 0;
    function update(value: boolean) {
      setActive(value);
      onDragStateChange?.(value);
    }
    function handle(event: DragEvent) {
      const transfer = event.dataTransfer;
      if (!transfer || (!transfer.types.includes('Files') && !depth)) return;
      event.preventDefault();
      if (event.type === 'dragenter') {
        depth++;
        update(!locked);
      } else if (event.type === 'dragleave') {
        depth = Math.max(0, depth - 1);
        if (!depth) update(false);
      } else if (event.type === 'drop') {
        depth = 0;
        update(false);
        const file = transfer.files[0];
        if (file && !locked) onSelectFile(file);
      } else {
        transfer.dropEffect = locked ? 'none' : 'copy';
      }
    }
    const events = ['dragenter', 'dragover', 'dragleave', 'drop'] as const;
    events.forEach(event => root.addEventListener(event, handle));
    return () => {
      events.forEach(event => root.removeEventListener(event, handle));
      if (depth) update(false);
    };
  }, [consoleRef, locked, onSelectFile, onDragStateChange]);

  const ratio = progress?.totalBytes ? Math.min(1, Math.max(0, progress.bytesProcessed / progress.totalBytes)) : 0;
  return <div data-testid="agent-stdf-dropzone" aria-label={t('agents.upload.label')} role="group"
    className={variant === 'inline' ? 'rounded-control border border-dashed border-hairline p-3' : undefined}>
    <input ref={input} type="file" accept=".stdf,.std,.stdf.gz,.gz" hidden disabled={locked}
      aria-label={t('agents.upload.label')} data-testid="agent-stdf-input" onChange={event => {
        const file = event.currentTarget.files?.[0];
        event.currentTarget.value = '';
        if (file) onSelectFile(file);
      }} />
    <Button variant="secondary" size="sm" disabled={locked} data-testid="agent-stdf-button" onClick={() => input.current?.click()}>{t('agents.upload.button')}</Button>
    {variant === 'inline' && <span className="ml-2 type-caption text-text-tertiary">{t('agents.upload.dropHint')}</span>}
    {active && !locked && <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.12 }}
      data-testid="agent-stdf-overlay" className="pointer-events-none fixed inset-0 z-[100] grid place-items-center bg-bg/90 type-headline">{t('agents.upload.overlayTitle')}</motion.div>}
    {loading && <div aria-live="polite" data-testid="agent-stdf-progress" className="type-caption">{t('agents.upload.parsing')}
      <div className="h-1 overflow-hidden rounded-pill bg-fill-2"><div className="h-full origin-left bg-text-secondary" style={{ transform: `scaleX(${ratio})` }} /></div>
    </div>}
    {error && <div role="alert" data-testid="agent-stdf-error" className="type-caption">{error}
      <Button variant="text" size="sm" onClick={onClearError}>{t('toast.dismiss')}</Button>
    </div>}
  </div>;
}
