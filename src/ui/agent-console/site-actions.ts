/**
 * Site actions for the agent console.
 *
 * These are the only capabilities the published agent network can reach: they
 * run on this origin, over the lot the visitor already loaded, and they return
 * aggregate engine facts and derived results. Raw STDF bytes never enter this
 * module — the worker owns them — so an agent bound by these tools cannot see,
 * echo or exfiltrate a byte of the uploaded file.
 *
 * Two actions change the page and are marked `write`, so the runtime asks the
 * visitor before running them: `load_demo_lot` and `highlight_dies`.
 */

import {
  type DemoPresetId,
  listDemoPresets,
} from '@/core/demo';
import {
  computeLotParametricSummaries,
  type ParametricCapabilitySummary,
} from '@/core/analytics';
import type { EngineFact } from '@/core/report';
import {
  applyFilterDslToSelection,
  parseFilterDsl,
} from '@/core/query';
import type { AutopsyWorkerLoadedPayload } from '@/workers';
import type { SiteActionSpec } from '../../../public/agent-runtime/agent-runtime.mjs';

/** What the console gives the actions: the loaded lot and the page's own controls. */
export interface LabBridge {
  /** The lot the visitor has open, or `null` before one is loaded. */
  getPayload(): AutopsyWorkerLoadedPayload | null;
  /** Loads a synthetic demo lot through the same worker pipeline as a dropped file. */
  loadDemoLot(presetId: DemoPresetId): Promise<void>;
  /** Lights dies up on the evidence stage. */
  highlight(dieIds: readonly string[], label: string, factId?: string): void;
  clearHighlight(): void;
}

const NO_LOT_MESSAGE =
  'No lot is loaded in this tab. Call list_demo_lots and let the visitor pick one; loading a demo lot needs their confirmation.';

function formatPct(ratio: number | null | undefined): string {
  if (ratio === null || ratio === undefined || Number.isNaN(ratio)) return 'n/a';
  return `${(ratio * 100).toFixed(1)}%`;
}

function formatInt(value: number): string {
  return value.toLocaleString('en-US');
}

function requirePayload(bridge: LabBridge): AutopsyWorkerLoadedPayload {
  const payload = bridge.getPayload();
  if (!payload) throw new Error(NO_LOT_MESSAGE);
  return payload;
}

function factDieCount(fact: EngineFact): number {
  return fact.dieIndices.length;
}

function findFact(payload: AutopsyWorkerLoadedPayload, factId: string): EngineFact | undefined {
  return payload.facts.find((fact) => fact.factId === factId);
}

function lotLabel(payload: AutopsyWorkerLoadedPayload): string {
  const wafers = payload.lot.wafers.length;
  return `${payload.lot.lotId} (${wafers} wafer${wafers === 1 ? '' : 's'})`;
}

function topParametric(
  summaries: readonly ParametricCapabilitySummary[],
  limit = 5,
): readonly ParametricCapabilitySummary[] {
  return [...summaries]
    .filter((summary) => summary.cpk !== null && summary.n > 1)
    .sort((a, b) => (a.cpk ?? Number.POSITIVE_INFINITY) - (b.cpk ?? Number.POSITIVE_INFINITY))
    .slice(0, limit);
}

/**
 * @param bridge the console's handle on the loaded lot and its own controls
 * @returns the site actions the published network may call
 */
export function createLabSiteActions(bridge: LabBridge): SiteActionSpec[] {
  return [
    {
      name: 'list_demo_lots',
      purpose:
        'Lists the three synthetic demo lots this site can load, with the failure each one carries. Use it before loading a lot.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      effect: 'read',
      handler: async () => {
        const presets = listDemoPresets();
        const loaded = bridge.getPayload();
        const data = presets.map((preset) => ({
          presetId: preset.id,
          title: preset.title,
          scenario: preset.subtitle,
          wafers: preset.waferCount,
          expectedVerdict: preset.expectedVerdictKind,
        }));
        const lines = presets.map(
          (preset) =>
            `- ${preset.title} (preset ${preset.id}): ${preset.subtitle} — ${preset.waferCount} wafers, expected verdict ${preset.expectedVerdictKind}.`,
        );
        return {
          summary: [
            loaded
              ? `A lot is already loaded: ${lotLabel(loaded)}. Loading another demo lot replaces it (the visitor confirms).`
              : 'No lot is loaded yet. Pick one of these three demo lots:',
            ...lines,
          ].join('\n'),
          data: { presets: data, loadedLot: loaded ? loaded.lot.lotId : null },
        };
      },
    },
    {
      name: 'load_demo_lot',
      purpose:
        'Loads one synthetic demo lot into this page, replacing whatever is open. Changes the page, so the visitor confirms first.',
      inputSchema: {
        type: 'object',
        properties: {
          presetId: {
            type: 'string',
            enum: ['edge-ring-etch', 'handling-scratch', 'site2-probe-contact'],
            description: 'Demo preset id from list_demo_lots.',
          },
        },
        required: ['presetId'],
        additionalProperties: false,
      },
      effect: 'write',
      handler: async (args) => {
        const presetId = String(args.presetId ?? '') as DemoPresetId;
        const preset = listDemoPresets().find((entry) => entry.id === presetId);
        if (!preset) throw new Error(`Unknown demo preset "${presetId}".`);
        await bridge.loadDemoLot(presetId);
        const payload = bridge.getPayload();
        return {
          summary: payload
            ? `Loaded demo lot ${lotLabel(payload)}: ${preset.title} — ${preset.subtitle}. Final yield ${formatPct(payload.yieldSummary.overall.finalYield)} over ${formatInt(payload.lot.dies.count)} dies.`
            : `Loaded ${preset.title}.`,
          data: { presetId, lotId: payload?.lot.lotId ?? null },
          outcome: 'verified' as const,
        };
      },
    },
    {
      name: 'get_lot_summary',
      purpose:
        'Returns lot identity, wafer and die counts, first-pass and final yield, retest executions and the dominant failing bin for the loaded lot.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      effect: 'read',
      handler: async () => {
        const payload = requirePayload(bridge);
        const { overall } = payload.yieldSummary;
        const verdict = payload.verdict;
        const topFact = payload.facts.find((fact) => fact.factId === verdict.citedFactIds[0]);
        const dominantBin = verdict.dominantBin;
        const binShare =
          dominantBin && verdict.totalFailDies > 0
            ? (() => {
                const ranking = payload.facts.find(
                  (fact) =>
                    fact.binRef &&
                    fact.binRef.code === dominantBin.code &&
                    fact.binRef.mode === dominantBin.mode,
                );
                return ranking ? factDieCount(ranking) / verdict.totalFailDies : null;
              })()
            : null;
        const summary = [
          `Lot ${lotLabel(payload)} · part ${payload.lot.partTyp || 'n/a'} · ${formatInt(payload.lot.dies.count)} dies tested.`,
          `First-pass yield ${formatPct(overall.firstPassYield)}, final yield ${formatPct(overall.finalYield)}; ${formatInt(overall.finalFailDies)} dies failed at final test, ${formatInt(overall.retestExecutions)} retest executions.`,
          dominantBin
            ? `Dominant failing bin ${dominantBin.mode} ${dominantBin.code} (${dominantBin.name})${binShare !== null ? `, ${formatPct(binShare)} of all failures` : ''}.`
            : 'No failing bin: this lot has no final-test failures.',
          topFact ? `Evidence: ${topFact.factId}.` : '',
        ]
          .filter(Boolean)
          .join(' ');
        return {
          summary,
          data: {
            lotId: payload.lot.lotId,
            partType: payload.lot.partTyp,
            wafers: payload.lot.wafers.length,
            dies: payload.lot.dies.count,
            sites: payload.lot.sites.length,
            firstPassYield: overall.firstPassYield,
            finalYield: overall.finalYield,
            finalFailDies: overall.finalFailDies,
            retestExecutions: overall.retestExecutions,
            parseMode: payload.lot.parseMode,
          },
          view: { kind: 'lot-summary' },
        };
      },
    },
    {
      name: 'diagnose_lot',
      purpose:
        'Runs the deterministic verdict engine and returns the cause of death, its confidence, the findings and the engine fact ids behind them.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      effect: 'read',
      handler: async () => {
        const payload = requirePayload(bridge);
        const { verdict, report } = payload;
        const claims = [report.causeOfDeathHeadline, ...report.bodyClaims]
          .map((claim) => `- ${claim.text} [${claim.citedFactIds.join(', ')}]`)
          .join('\n');
        const summary = [
          `Cause of death: ${verdict.verdict} (confidence ${verdict.confidence.toFixed(2)}, tier ${verdict.tier}).`,
          verdict.headlineText,
          `Findings:\n${claims}`,
          `Final yield ${formatPct(verdict.finalYield)} on ${formatInt(verdict.testedDies)} dies; ${formatInt(verdict.totalFailDies)} failed.`,
        ].join('\n');
        return {
          summary,
          data: {
            verdict: {
              kind: verdict.kind,
              tier: verdict.tier,
              verdict: verdict.verdict,
              confidence: verdict.confidence,
              headline: verdict.headlineText,
              spatialPattern: verdict.spatialPattern ?? null,
              citedFactIds: verdict.citedFactIds,
            },
            findings: [report.causeOfDeathHeadline, ...report.bodyClaims].map((claim) => ({
              text: claim.text,
              factIds: claim.citedFactIds,
              dieCount: claim.resolvedDieIds.length,
            })),
          },
          view: { kind: 'verdict' },
        };
      },
    },
    {
      name: 'get_spatial_pattern',
      purpose:
        'Classifies the lot-level and per-wafer failure shape against the nine WM-811K classes, with confidence, runner-up class, the dies carrying it and the fact id to highlight.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      effect: 'read',
      handler: async () => {
        const payload = requirePayload(bridge);
        const spatialFacts = payload.facts.filter((fact) => fact.kind === 'spatial-pattern');
        const primary = spatialFacts[0];
        const verdict = payload.verdict;
        const candidates = verdict.spatialPattern ? [verdict.spatialPattern] : [];
        const wafers = payload.lot.wafers.map((wafer) => ({
          waferId: wafer.waferId,
          firstPassYield: payload.yieldSummary.byWafer[wafer.waferIndex]?.firstPassYield ?? null,
        }));
        const worst = [...wafers]
          .filter((wafer) => wafer.firstPassYield !== null)
          .sort((a, b) => (a.firstPassYield ?? 1) - (b.firstPassYield ?? 1))
          .slice(0, 3);
        const summary = [
          verdict.spatialPattern
            ? `Lot-level spatial signature: ${verdict.spatialPattern} (confidence ${verdict.confidence.toFixed(2)}).`
            : `The verdict engine did not select a spatial signature for this lot (verdict kind: ${verdict.kind}).`,
          primary
            ? `${primary.summary}`
            : 'No spatial-pattern fact carries dies for this lot.',
          worst.length > 0
            ? `Weakest wafers by first-pass yield: ${worst
                .map((wafer) => `${wafer.waferId} ${formatPct(wafer.firstPassYield)}`)
                .join(', ')}.`
            : '',
          primary
            ? `Fact id for these dies: ${primary.factId} (${formatInt(factDieCount(primary))} dies).`
            : '',
          candidates.length > 0
            ? 'Treat the shape as a hypothesis: name the physical check that would confirm it.'
            : '',
        ]
          .filter(Boolean)
          .join(' ');
        return {
          summary,
          data: {
            pattern: verdict.spatialPattern ?? null,
            confidence: verdict.confidence,
            factId: primary?.factId ?? null,
            dieCount: primary ? factDieCount(primary) : 0,
            wafers: worst,
            allSpatialFacts: spatialFacts.map((fact) => ({
              factId: fact.factId,
              summary: fact.summary,
              dies: factDieCount(fact),
            })),
          },
          view: { kind: 'pattern' },
        };
      },
    },
    {
      name: 'get_parametric_report',
      purpose:
        'Returns the parametric tests with the weakest capability (lowest Cpk), with units, limits, mean, sigma and fail counts.',
      inputSchema: {
        type: 'object',
        properties: { limit: { type: 'number', minimum: 1, maximum: 12 } },
        additionalProperties: false,
      },
      effect: 'read',
      handler: async (args) => {
        const payload = requirePayload(bridge);
        const limit = typeof args.limit === 'number' ? Math.round(args.limit) : 5;
        const summaries = computeLotParametricSummaries(payload.lot);
        const weakest = topParametric(summaries, limit);
        if (weakest.length === 0) {
          return {
            summary: 'This lot carries no parametric tests with spec limits, so no Cpk can be computed.',
            data: { tests: [] },
          };
        }
        const lines = weakest.map(
          (test) =>
            `- ${test.testName} (test ${test.testNum}): Cpk ${test.cpk?.toFixed(2) ?? 'n/a'}, Cp ${test.cp?.toFixed(2) ?? 'n/a'}, limits ${test.loLimit ?? 'none'} .. ${test.hiLimit ?? 'none'} ${test.units}, n=${formatInt(test.n)}, ${formatInt(test.failCount)} out of limit.`,
        );
        return {
          summary: [
            `Weakest parametric capability among ${formatInt(summaries.length)} tests (Cp/Cpk from Welford mean and sigma):`,
            ...lines,
          ].join('\n'),
          data: {
            tests: weakest.map((test) => ({
              testNum: test.testNum,
              testName: test.testName,
              units: test.units,
              cp: test.cp,
              cpk: test.cpk,
              loLimit: test.loLimit,
              hiLimit: test.hiLimit,
              n: test.n,
              failCount: test.failCount,
            })),
          },
          view: { kind: 'parametric' },
        };
      },
    },
    {
      name: 'compare_test_sites',
      purpose:
        'Compares first-pass and final yield across test sites and returns any site-concentration anomaly the engine detected, with its z-score and confidence.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      effect: 'read',
      handler: async () => {
        const payload = requirePayload(bridge);
        const siteRows = payload.yieldSummary.bySite.map((metrics, index) => {
          const site = payload.lot.sites[index];
          return {
            site: site?.label ?? `site ${index}`,
            firstPassYield: metrics.firstPassYield,
            finalYield: metrics.finalYield,
            tested: metrics.testedDies,
            finalFail: metrics.finalFailDies,
          };
        });
        const anomalies = payload.siteAnomalies;
        const lines = siteRows.map(
          (row) =>
            `- Site ${row.site}: first-pass ${formatPct(row.firstPassYield)}, final ${formatPct(row.finalYield)} over ${formatInt(row.tested)} dies.`,
        );
        const anomalyLines = anomalies.map(
          (anomaly) =>
            `Anomaly at site ${anomaly.site.label}: ${formatInt(anomaly.excessFailCount)} excess failing dies, z=${anomaly.twoProportionZ.toFixed(1)}, ${formatPct(anomaly.excessFailShare)} of all first-pass failures, confidence ${anomaly.confidence.toFixed(2)}.`,
        );
        return {
          summary: [
            `Test sites in ${payload.lot.lotId} (${siteRows.length} sites):`,
            ...lines,
            anomalies.length > 0
              ? anomalyLines.join(' ')
              : 'The two-proportion test found no single-site concentration: no site is worse than the pooled remainder by the engine thresholds.',
          ].join('\n'),
          data: { sites: siteRows, anomalies: anomalyLines },
          view: { kind: 'sites' },
        };
      },
    },
    {
      name: 'query_dies',
      purpose:
        'Counts and locates dies with the workbench Filter DSL, for example "only bin 7", "edge 3 rings", "tests with Cpk < 1.33", or "show edge failures with Cpk < 1.33".',
      inputSchema: {
        type: 'object',
        properties: {
          expression: { type: 'string', minLength: 2, maxLength: 160 },
        },
        required: ['expression'],
        additionalProperties: false,
      },
      effect: 'read',
      handler: async (args) => {
        const payload = requirePayload(bridge);
        const expression = String(args.expression ?? '');
        const parsed = parseFilterDsl(expression);
        if (!parsed.ok) {
          return {
            summary: `That query did not parse: ${parsed.error}. Try "only bin 7", "edge 3 rings", or "tests with Cpk < 1.33".`,
            data: { expression, error: parsed.error },
          };
        }
        const evaluation = applyFilterDslToSelection(payload.lot, parsed.value);
        const selected = evaluation.selectedDieCount;
        const total = payload.lot.dies.count;
        return {
          summary: `Query "${expression}" selects ${formatInt(selected)} of ${formatInt(total)} dies (${formatPct(selected / total)}).${
            evaluation.lowestCpkTestNum !== null
              ? ` The weakest matching test is test ${evaluation.lowestCpkTestNum}.`
              : ''
          }`,
          data: {
            expression,
            selected,
            total,
            matchingTestNums: evaluation.matchingTestNums.slice(0, 12),
            lowestCpkTestNum: evaluation.lowestCpkTestNum,
          },
          view: { kind: 'query' },
        };
      },
    },
    {
      name: 'list_evidence',
      purpose:
        'Lists every engine fact behind the autopsy with its stable id, kind, summary and die count. Use it to check that a claim is supported.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      effect: 'read',
      handler: async () => {
        const payload = requirePayload(bridge);
        const facts = payload.facts.map((fact) => ({
          factId: fact.factId,
          kind: fact.kind,
          summary: fact.summary,
          dies: factDieCount(fact),
          bin: fact.binRef ? `${fact.binRef.mode} ${fact.binRef.code}` : null,
          test: fact.testRef ? `${fact.testRef.testNum} ${fact.testRef.testName}` : null,
        }));
        return {
          summary: [
            `${facts.length} engine facts for ${lotLabel(payload)}:`,
            ...facts.map(
              (fact) =>
                `- ${fact.factId} (${fact.kind}, ${formatInt(fact.dies)} dies): ${fact.summary}`,
            ),
          ].join('\n'),
          data: { facts },
          view: { kind: 'evidence' },
        };
      },
    },
    {
      name: 'get_evidence',
      purpose:
        'Resolves one engine fact id to its summary, metrics and the canonical die ids behind it.',
      inputSchema: {
        type: 'object',
        properties: { factId: { type: 'string', minLength: 3 } },
        required: ['factId'],
        additionalProperties: false,
      },
      effect: 'read',
      handler: async (args) => {
        const payload = requirePayload(bridge);
        const factId = String(args.factId ?? '');
        const fact = findFact(payload, factId);
        if (!fact) {
          const available = payload.facts.map((entry) => entry.factId);
          return {
            summary: `No fact "${factId}" exists for this lot. The ids that do: ${available.join(', ')}.`,
            data: { factId, available },
          };
        }
        const dieIds = fact.dieIds.slice(0, 24);
        return {
          summary: `${fact.factId} (${fact.kind}, ${formatInt(factDieCount(fact))} dies): ${fact.summary}`,
          data: {
            factId: fact.factId,
            kind: fact.kind,
            summary: fact.summary,
            dieCount: factDieCount(fact),
            dieIdsSample: dieIds,
            metrics: fact.metrics.map((metric) => ({
              key: metric.key,
              display: metric.displayValue,
            })),
            bin: fact.binRef ?? null,
            test: fact.testRef ?? null,
          },
          view: { kind: 'evidence-detail' },
        };
      },
    },
    {
      name: 'highlight_dies',
      purpose:
        'Lights the dies behind an engine fact up on this page’s evidence stage. Defaults to the primary spatial fact. Changes the page, so the visitor confirms first.',
      inputSchema: {
        type: 'object',
        properties: {
          factId: {
            type: 'string',
            description: 'Engine fact id from get_spatial_pattern or list_evidence.',
          },
        },
        additionalProperties: false,
      },
      effect: 'write',
      handler: async (args) => {
        const payload = requirePayload(bridge);
        const requested = typeof args.factId === 'string' ? args.factId : '';
        const fact =
          (requested ? findFact(payload, requested) : undefined) ??
          payload.facts.find((entry) => entry.kind === 'spatial-pattern') ??
          payload.facts[0];
        if (!fact) throw new Error('This lot has no engine facts to highlight.');
        bridge.highlight(fact.dieIds, fact.summary, fact.factId);
        return {
          summary: `Highlighted ${formatInt(fact.dieIds.length)} dies on the evidence stage for ${fact.factId}.`,
          data: { factId: fact.factId, dies: fact.dieIds.length },
          outcome: 'verified' as const,
        };
      },
    },
    {
      name: 'export_report',
      purpose:
        'Returns the deterministic autopsy report as Markdown, exactly as the workbench renders it, for copying or download.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      effect: 'read',
      handler: async () => {
        const payload = requirePayload(bridge);
        const { report, verdict } = payload;
        const markdown = [
          `# Autopsy report — lot ${payload.lot.lotId}`,
          '',
          `**Cause of death:** ${report.causeOfDeathHeadline.text}`,
          '',
          `Confidence ${verdict.confidence.toFixed(2)} · final yield ${formatPct(verdict.finalYield)} · ${formatInt(verdict.totalFailDies)} failing dies of ${formatInt(verdict.testedDies)}.`,
          '',
          '## Findings',
          ...[report.causeOfDeathHeadline, ...report.bodyClaims]
            .filter((claim) => !claim.isHeadline)
            .map((claim) => `- ${claim.text}\n  - Evidence: ${claim.citedFactIds.join(', ')}`),
          '',
          '## Evidence',
          ...payload.facts.map((fact) => `- ${fact.factId}: ${fact.summary}`),
          '',
          '_Generated by Chip Autopsy Lab from the loaded lot. Every claim above cites an engine fact._',
        ].join('\n');
        return {
          summary: markdown,
          data: { markdown, source: report.source, findings: report.bodyClaims.length },
          view: { kind: 'report' },
        };
      },
    },
  ];
}
