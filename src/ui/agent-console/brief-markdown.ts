import { computeLotParametricSummaries } from '@/core/analytics';
import { getDemoStdfFileName } from '@/core/demo';
import { createBoundFormatters, type Locale } from '@/core/i18n';
import type { AutopsyWorkerLoadedPayload } from '@/workers';

export function worstCpk(payload: AutopsyWorkerLoadedPayload): number | null {
  let minimum: number | null = null;
  for (const { cpk } of computeLotParametricSummaries(payload.lot)) {
    if (cpk !== null && Number.isFinite(cpk) && (minimum === null || cpk < minimum)) minimum = cpk;
  }
  return minimum;
}

function cell(value: string) {
  return value.replaceAll('\\', '\\\\').replaceAll('|', '\\|').replace(/\s*\r?\n\s*/g, ' ');
}

export function buildBriefMarkdown(payload: AutopsyWorkerLoadedPayload, {
  assistantText, highlightedFactId, locale = 'en',
}: { assistantText?: string | null; highlightedFactId?: string | null; locale?: Locale }): string {
  const { source, lot, verdict, facts } = payload;
  const format = createBoundFormatters(locale);
  const cpk = worstCpk(payload);
  const bin = verdict.dominantBin;
  const lines = [
    `# Autopsy brief — ${lot.lotId}`, '', '## Metadata', '',
    `- Part: ${lot.partTyp || '—'}`, `- Job: ${lot.jobNam || '—'}`,
    `- Wafers: ${format.integer(lot.wafers.length)}`, `- Dies: ${format.integer(lot.dies.count)}`,
    `- Source file: ${source.kind === 'file' ? source.fileName : getDemoStdfFileName(source.preset.id)}`,
    `- Byte length: ${format.integer(payload.byteLength)}`,
    '', '## Metrics', '', '| Metric | Value |', '| --- | --- |',
    `| Final yield | ${format.percent(verdict.finalYield)} |`,
    `| Failed dies | ${format.integer(verdict.totalFailDies)} |`,
    `| Dominant SBIN | ${bin ? cell(`${bin.code} ${bin.name}`) : '—'} |`,
    `| Worst Cpk | ${cpk === null ? '—' : format.decimal2(cpk)} |`,
    '', '## Verdict', '', `${verdict.headlineText} (confidence ${format.decimal2(verdict.confidence)})`,
  ];
  if (assistantText?.trim()) lines.push('', '## Latest assistant diagnosis', '', assistantText.trim());
  lines.push('', '## Evidence', '', '| Fact ID | Summary | Die count | Citation |', '| --- | --- | ---: | --- |');
  for (const fact of facts.filter((fact, i) => i < 8 || fact.factId === highlightedFactId)) {
    lines.push(`| ${cell(fact.factId)} | ${cell(fact.summary)} | ${format.integer(fact.dieIndices.length)} | ${fact.factId === highlightedFactId ? 'Cited' : ''} |`);
  }
  return lines.join('\n') + '\n';
}
