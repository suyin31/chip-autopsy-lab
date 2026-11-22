'use client';

import { useEffect, useRef, useState } from 'react';
import { useT } from '@/ui/i18n';
import { AnimatedCheckmark, Button } from '@/ui/primitives';
import type { AutopsyWorkerLoadedPayload } from '@/workers';
import { buildBriefMarkdown } from './brief-markdown';

interface Props {
  payload: AutopsyWorkerLoadedPayload | null;
  latestAssistantText: string | null;
  highlightedFactId?: string | undefined;
  disabled?: boolean;
}

export function ExportBriefButton({ payload, latestAssistantText, highlightedFactId, disabled }: Props) {
  const { t, locale } = useT();
  const [status, setStatus] = useState<'idle' | 'downloaded' | 'error'>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  function download() {
    if (!payload) return;
    clearTimeout(timer.current);
    try {
      const markdown = buildBriefMarkdown(payload, { assistantText: latestAssistantText, highlightedFactId: highlightedFactId ?? null, locale });
      const url = URL.createObjectURL(new Blob([markdown], { type: 'text/markdown;charset=utf-8' }));
      try {
        const link = document.createElement('a');
        link.href = url;
        link.download = `${payload.lot.lotId}-autopsy-brief.md`;
        link.click();
      } finally {
        setTimeout(() => URL.revokeObjectURL(url), 0);
      }
      setStatus('downloaded');
      timer.current = setTimeout(() => setStatus('idle'), 1800);
    } catch {
      setStatus('error');
    }
  }
  return <div>
    <Button variant="ghost" size="sm" disabled={!payload || disabled} aria-label={t('agents.export.aria')}
      title={payload ? undefined : t('agents.export.emptyHint')} data-testid="agent-export-brief" onClick={download}>{t('agents.export.button')}</Button>
    <div aria-live="polite" data-testid="agent-export-status" className="type-caption">
      {status === 'downloaded' && <span className="inline-flex items-center gap-1"><AnimatedCheckmark animate className="size-3" />{t('agents.export.downloaded')}</span>}
      {status === 'error' && <span role="alert">{t('agents.export.error')}</span>}
    </div>
  </div>;
}
