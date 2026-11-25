'use client';

import { useEffect, useRef, useState, type RefObject } from 'react';
import { Upload } from 'lucide-react';
import { motion } from 'motion/react';
import { FormatKeycaps, SpecimenDropTray } from '@/ui/atelier/SpecimenDropTray';
import { useT } from '@/ui/i18n';
import { useReducedMotionPreference } from '@/ui/motion';
import { Button, cn } from '@/ui/primitives';
import type { WorkerParseProgress } from '@/workers';

interface Props {
  variant: 'inline' | 'compact';
  embedded?: boolean;
  consoleRef: RefObject<HTMLDivElement | null>;
  loading: boolean;
  progress: WorkerParseProgress | null;
  error: string | null;
  disabled: boolean;
  onSelectFile: (file: File) => void;
  onClearError: () => void;
  onDragStateChange?: (active: boolean) => void;
}

export function StdfDropZone({
  variant,
  embedded = false,
  consoleRef,
  loading,
  progress,
  error,
  disabled,
  onSelectFile,
  onClearError,
  onDragStateChange,
}: Props) {
  const { t } = useT();
  const reducedMotion = useReducedMotionPreference();
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
    events.forEach((event) => root.addEventListener(event, handle));
    return () => {
      events.forEach((event) => root.removeEventListener(event, handle));
      if (depth) update(false);
    };
  }, [consoleRef, locked, onSelectFile, onDragStateChange]);

  const ratio = progress?.totalBytes
    ? Math.min(1, Math.max(0, progress.bytesProcessed / progress.totalBytes))
    : 0;

  return (
    <div
      data-testid="agent-stdf-dropzone"
      aria-label={t('agents.upload.label')}
      role="group"
      className={variant === 'inline' ? 'w-full' : 'inline-flex items-center gap-2'}
    >
      <input
        ref={input}
        type="file"
        accept=".stdf,.std,.stdf.gz,.gz"
        hidden
        disabled={locked}
        aria-label={t('agents.upload.label')}
        data-testid="agent-stdf-input"
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = '';
          if (file) onSelectFile(file);
        }}
      />

      {variant === 'inline' ? (
        embedded ? (
          <div className="flex flex-wrap items-center gap-2.5 border-t border-hairline px-1 pt-2.5">
            <Button
              variant="secondary"
              size="sm"
              disabled={locked}
              data-testid="agent-stdf-button"
              onClick={() => input.current?.click()}
            >
              <Upload className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
              {t('agents.upload.button')}
            </Button>
            <span className="min-w-0 flex-1 type-caption text-text-secondary">
              {t('agents.upload.dropHint')}
            </span>
            <FormatKeycaps className="max-sm:hidden" />
          </div>
        ) : (
          <SpecimenDropTray
            variant="inline"
            armed={active || loading}
            className="rounded-[22px] p-1.5"
            wellClassName="flex flex-wrap items-center gap-2.5 rounded-[16px] px-3.5 py-2.5"
          >
            <Button
              variant="secondary"
              size="sm"
              disabled={locked}
              data-testid="agent-stdf-button"
              onClick={() => input.current?.click()}
            >
              <Upload className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
              {t('agents.upload.button')}
            </Button>
            <span className="min-w-0 flex-1 type-caption text-text-secondary">
              {t('agents.upload.dropHint')}
            </span>
            <FormatKeycaps className="max-sm:hidden" />
          </SpecimenDropTray>
        )
      ) : (
        <Button
          variant="secondary"
          size="sm"
          disabled={locked}
          data-testid="agent-stdf-button"
          onClick={() => input.current?.click()}
        >
          {t('agents.upload.button')}
        </Button>
      )}

      {active && !locked ? (
        <motion.div
          initial={reducedMotion ? { opacity: 0 } : { opacity: 0, scale: 0.985 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: reducedMotion ? 0.08 : 0.18 }}
          data-testid="agent-stdf-overlay"
          className={cn(
            'at-scene-3d pointer-events-none fixed inset-0 z-[100] grid place-items-center p-6',
            'bg-[color-mix(in_oklab,var(--bg)_78%,transparent)] [backdrop-filter:blur(26px)_saturate(165%)] [-webkit-backdrop-filter:blur(26px)_saturate(165%)]',
          )}
        >
          <SpecimenDropTray
            variant="overlay"
            armed
            showFormatCaps
            className="w-[min(460px,90vw)]"
            wellClassName="flex min-h-[220px] flex-col items-center justify-center gap-2.5 px-6 pt-8 pb-14 text-center"
          >
            <span aria-hidden="true" className="at-sonar-ring size-28" />
            <span aria-hidden="true" data-ring="2" className="at-sonar-ring size-28" />
            <span aria-hidden="true" data-ring="3" className="at-sonar-ring size-28" />
            <span className="at-icon-well-iris relative z-[2] size-11 rounded-2xl">
              <Upload className="size-5" strokeWidth={1.75} aria-hidden="true" />
            </span>
            <p className="relative z-[2] type-title-2 text-text-primary">
              {t('agents.upload.overlayTitle')}
            </p>
            <p className="relative z-[2] type-subhead text-text-secondary">
              {t('agents.upload.dropHint')}
            </p>
          </SpecimenDropTray>
        </motion.div>
      ) : null}

      {loading ? (
        <div
          aria-live="polite"
          data-testid="agent-stdf-progress"
          className="at-well-crisp mt-2 flex flex-col gap-1.5 rounded-control px-3 py-2 type-caption text-text-secondary"
        >
          <span>{t('agents.upload.parsing')}</span>
          <div className="h-1.5 overflow-hidden rounded-pill bg-fill-2">
            <div
              className="at-bar-iris h-full origin-left transition-transform duration-150 ease-out"
              style={{ transform: `scaleX(${Math.max(0.08, ratio)})` }}
            />
          </div>
        </div>
      ) : null}

      {error ? (
        <div
          role="alert"
          data-testid="agent-stdf-error"
          className="at-well-crisp mt-2 flex flex-wrap items-center justify-between gap-2 rounded-control px-3 py-1.5 type-caption text-text-primary"
        >
          <span>{error}</span>
          <Button variant="text" size="sm" onClick={onClearError}>
            {t('toast.dismiss')}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
