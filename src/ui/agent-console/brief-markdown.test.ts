import { expect, it } from 'vitest';
import { ingestDemoPreset } from '@/workers';
import { buildBriefMarkdown } from './brief-markdown';

it('exports a deterministic brief with the engine verdict and cited evidence', async () => {
  const payload = await ingestDemoPreset('edge-ring-etch');
  if (payload.kind !== 'ok') throw new Error(payload.kind);
  const cited = payload.facts[0];
  if (!cited) throw new Error('Missing demo evidence');
  const options = { assistantText: 'Inspect the wafer edge.', highlightedFactId: cited.factId };
  const markdown = buildBriefMarkdown(payload, options);
  expect(markdown).toBe(buildBriefMarkdown(payload, options));
  expect(markdown.split('\n').filter(line => line.startsWith('#'))).toEqual([
    `# Autopsy brief — ${payload.lot.lotId}`, '## Metadata', '## Metrics', '## Verdict', '## Latest assistant diagnosis', '## Evidence',
  ]);
  expect(markdown.split('## Metrics\n\n')[1]?.split('\n\n')[0]).toMatchInlineSnapshot(`
    "| Metric | Value |
    | --- | --- |
    | Final yield | 82.8% |
    | Failed dies | 2,721 |
    | Dominant SBIN | 7 IDDQ_EDGE_LEAK |
    | Worst Cpk | 0.14 |"
  `);
  expect(markdown).toContain(`${payload.verdict.headlineText} (confidence ${payload.verdict.confidence.toFixed(2)})`);
  expect(markdown).toContain(options.assistantText);
  for (const fact of payload.facts.slice(0, 8)) {
    expect(markdown).toContain(`| ${fact.factId} | ${fact.summary} | ${fact.dieIndices.length.toLocaleString('en')} | ${fact === cited ? 'Cited' : ''} |`);
  }
});
