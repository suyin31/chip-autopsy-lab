'use client';

import { useMemo, type ReactNode } from 'react';
import { useT } from '@/ui/i18n';
import { cn, CountUp } from '@/ui/primitives';
import type { AutopsyWorkerLoadedPayload } from '@/workers';
import { worstCpk } from './brief-markdown';

function Cell({
  id,
  label,
  ratio,
  tone,
  className,
  children,
}: {
  id: string;
  label: string;
  ratio: number | null;
  tone: 'iris' | 'signal';
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      data-testid={`agent-kpi-${id}`}
      className={cn(
        'at-ruler-cell flex min-h-[68px] min-w-0 flex-col justify-between px-3 py-2.5',
        className,
      )}
    >
      <dt className="truncate text-[11.5px] leading-[1.3] tracking-[-0.004em] text-text-tertiary">
        {label}
      </dt>
      <dd className="mt-1.5 flex items-baseline justify-between gap-2">
        <span className="at-kpi-number min-w-0 truncate text-[21px] text-text-primary">
          {children}
        </span>
        {ratio !== null ? (
          <span
            aria-hidden="true"
            className="h-1 w-9 shrink-0 overflow-hidden rounded-pill bg-fill-2"
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
    </div>
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
      className="at-ruler mt-3.5 grid grid-cols-2 sm:max-lg:grid-cols-4"
      data-testid="agent-kpi-strip"
      data-vt="agent-kpi"
      aria-label={t('agents.kpi.aria')}
      aria-busy={loading}
    >
      <Cell
        id="yield"
        label={t('agents.kpi.finalYield')}
        ratio={yieldRatio}
        tone="iris"
        className="border-r border-hairline"
      >
        {count(payload?.verdict.finalYield, formatPercent)}
      </Cell>
      <Cell
        id="failed"
        label={t('agents.kpi.failedDies')}
        ratio={failShare}
        tone="signal"
        className="sm:max-lg:border-r sm:max-lg:border-hairline"
      >
        {count(payload?.verdict.totalFailDies, formatInteger)}
      </Cell>
      <Cell
        id="sbin"
        label={t('agents.kpi.dominantSbin')}
        ratio={bin ? 0.72 : null}
        tone="signal"
        className="border-t border-r border-hairline sm:max-lg:border-t-0"
      >
        {bin ? `${bin.code} ${bin.name}` : unavailable}
      </Cell>
      <Cell
        id="cpk"
        label={t('agents.kpi.worstCpk')}
        ratio={cpkRatio}
        tone="iris"
        className="border-t border-hairline sm:max-lg:border-t-0"
      >
        {count(cpk, formatDecimal2)}
      </Cell>
    </dl>
  );
}
