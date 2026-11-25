'use client';

import { useMemo, type ReactNode } from 'react';
import { SpotlightTiltCard } from '@/ui/atelier/SpotlightTiltCard';
import { useT } from '@/ui/i18n';
import { cn, CountUp } from '@/ui/primitives';
import type { AutopsyWorkerLoadedPayload } from '@/workers';
import { worstCpk } from './brief-markdown';

function Cell({
  id,
  label,
  enabled,
  ratio,
  tone,
  children,
}: {
  id: string;
  label: string;
  enabled: boolean;
  ratio: number | null;
  tone: 'iris' | 'signal';
  children: ReactNode;
}) {
  return (
    <SpotlightTiltCard
      maxDeg={enabled ? 4 : 2}
      liftPx={enabled ? -2 : 0}
      preserve3d
      data-testid={`agent-kpi-${id}`}
      className="relative flex min-h-[76px] min-w-0 flex-col justify-between rounded-[18px] px-3.5 py-2.5"
    >
      <dt className="truncate text-[11.5px] leading-[1.3] tracking-[-0.004em] text-text-tertiary">
        {label}
      </dt>
      <dd className="at-bento-pop-sm flex items-baseline justify-between gap-2">
        <span className="at-kpi-number min-w-0 truncate text-[21px] text-text-primary">
          {children}
        </span>
        {ratio !== null ? (
          <span
            aria-hidden="true"
            className="h-1.5 w-10 shrink-0 overflow-hidden rounded-pill bg-fill-2"
          >
            <span
              className={cn(
                'block h-full rounded-pill',
                tone === 'signal' ? 'at-bar-signal' : 'at-bar-iris',
              )}
              style={{ width: `${Math.round(Math.min(1, Math.max(0.08, ratio)) * 100)}%` }}
            />
          </span>
        ) : (
          <span aria-hidden="true" className="inline-flex shrink-0 items-end gap-0.5 opacity-45">
            {[4, 7, 5, 9, 6].map((h, idx) => (
              <span
                key={idx}
                className="w-[2px] rounded-full bg-text-disabled"
                style={{ height: `${h}px` }}
              />
            ))}
          </span>
        )}
      </dd>
    </SpotlightTiltCard>
  );
}

export function LotKpiStrip({
  payload,
  loading,
}: {
  payload: AutopsyWorkerLoadedPayload | null;
  loading?: boolean;
}) {
  const { t, formatDecimal2, formatInteger, formatPercent } = useT();
  const cpk = useMemo(() => payload && worstCpk(payload), [payload]);
  const unavailable = (
    <span className="text-text-tertiary" aria-label={t('agents.kpi.unavailable')}>
      —
    </span>
  );
  const count = (value: number | undefined | null, format: (n: number) => string) =>
    payload && value != null && Number.isFinite(value) ? (
      <CountUp playKey={payload.lot.lotId} value={value} format={format} />
    ) : (
      unavailable
    );

  const bin = payload?.verdict.dominantBin;
  const yieldRatio = payload?.verdict.finalYield ?? null;
  const failShare = yieldRatio !== null ? Math.max(0, 1 - yieldRatio) : null;
  const cpkRatio = cpk != null && Number.isFinite(cpk) ? Math.min(1, cpk / 2) : null;

  return (
    <dl
      className="mt-3.5 grid grid-cols-2 gap-2.5"
      data-testid="agent-kpi-strip"
      aria-label={t('agents.kpi.aria')}
      aria-busy={loading}
    >
      <Cell id="yield" label={t('agents.kpi.finalYield')} enabled={!!payload} ratio={yieldRatio} tone="iris">
        {count(payload?.verdict.finalYield, formatPercent)}
      </Cell>
      <Cell id="failed" label={t('agents.kpi.failedDies')} enabled={!!payload} ratio={failShare} tone="signal">
        {count(payload?.verdict.totalFailDies, formatInteger)}
      </Cell>
      <Cell
        id="sbin"
        label={t('agents.kpi.dominantSbin')}
        enabled={!!payload}
        ratio={bin ? 0.72 : null}
        tone="signal"
      >
        {bin ? `${bin.code} ${bin.name}` : unavailable}
      </Cell>
      <Cell id="cpk" label={t('agents.kpi.worstCpk')} enabled={!!payload} ratio={cpkRatio} tone="iris">
        {count(cpk, formatDecimal2)}
      </Cell>
    </dl>
  );
}
