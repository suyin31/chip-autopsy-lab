'use client';

import { useMemo, useRef, type ReactNode } from 'react';
import { useT } from '@/ui/i18n';
import { CountUp } from '@/ui/primitives';
import { useTactileTilt } from '@/ui/motion/use-tactile-tilt';
import type { AutopsyWorkerLoadedPayload } from '@/workers';
import { worstCpk } from './brief-markdown';

function Cell({ id, label, enabled, children }: { id: string; label: string; enabled: boolean; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useTactileTilt(ref, { enabled, maxDeg: 12, liftPx: 6 });
  return <div ref={ref} data-tactile="" data-spotlight="true" data-testid={`agent-kpi-${id}`}
    className="cal-tactile at-plate relative h-[68px] min-w-0 rounded-[16px] px-3.5 py-2">
    <dt className="truncate text-[11.5px] leading-[1.3] tracking-[-0.004em] text-text-tertiary">{label}</dt>
    <dd className="at-kpi-number truncate text-[22px]">{children}</dd>
  </div>;
}

export function LotKpiStrip({ payload, loading }: { payload: AutopsyWorkerLoadedPayload | null; loading?: boolean }) {
  const { t, formatDecimal2, formatInteger, formatPercent } = useT();
  const cpk = useMemo(() => payload && worstCpk(payload), [payload]);
  const unavailable = <span className="text-text-tertiary" aria-label={t('agents.kpi.unavailable')}>—</span>;
  const count = (value: number | undefined | null, format: (n: number) => string) =>
    payload && value != null && Number.isFinite(value)
      ? <CountUp playKey={payload.lot.lotId} value={value} format={format} /> : unavailable;
  const bin = payload?.verdict.dominantBin;
  return <dl className="mt-3 grid grid-cols-2 gap-2" data-testid="agent-kpi-strip" aria-label={t('agents.kpi.aria')} aria-busy={loading}>
    <Cell id="yield" label={t('agents.kpi.finalYield')} enabled={!!payload}>{count(payload?.verdict.finalYield, formatPercent)}</Cell>
    <Cell id="failed" label={t('agents.kpi.failedDies')} enabled={!!payload}>{count(payload?.verdict.totalFailDies, formatInteger)}</Cell>
    <Cell id="sbin" label={t('agents.kpi.dominantSbin')} enabled={!!payload}>{bin ? `${bin.code} ${bin.name}` : unavailable}</Cell>
    <Cell id="cpk" label={t('agents.kpi.worstCpk')} enabled={!!payload}>{count(cpk, formatDecimal2)}</Cell>
  </dl>;
}
