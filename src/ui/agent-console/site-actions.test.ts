/**
 * Site-action tests: every tool the published network may call runs against a
 * real demo lot, parsed by the same core the Web Worker uses.
 *
 * These tests are the console's contract with the engine: an agent can only ever
 * see what these actions return, and none of them touches the raw STDF bytes.
 */

import { describe, expect, it } from 'vitest';
import {
  generateDemoStdfBytes,
  listDemoPresets,
  type DemoPresetId,
} from '@/core/demo';
import { buildLotModel } from '@/core/model';
import { computeYieldSummary, detectSiteAnomalies } from '@/core/analytics';
import { generateOfflineAutopsyReport } from '@/core/report';
import { parseStdfBytes } from '@/core/stdf';
import type { AutopsyWorkerLoadedPayload } from '@/workers';
import { createLabSiteActions, type LabBridge } from './site-actions';

function buildPayload(presetId: DemoPresetId): AutopsyWorkerLoadedPayload {
  const preset = listDemoPresets().find((entry) => entry.id === presetId);
  if (!preset) throw new Error(`unknown preset ${presetId}`);
  const bytes = generateDemoStdfBytes(presetId, preset.defaultSeed);
  const parsed = parseStdfBytes(bytes, { mode: 'full' });
  if (!parsed.ok) throw new Error(`demo lot did not parse: ${parsed.error.message}`);
  const lot = buildLotModel(parsed.value);
  const analysis = generateOfflineAutopsyReport(lot);
  return {
    source: { kind: 'demo', presetId },
    byteLength: bytes.byteLength,
    uncompressedByteLength: bytes.byteLength,
    recordsDecoded: 0,
    validPrrCount: 0,
    skippedRecordCount: 0,
    elapsedMs: 0,
    lot,
    probeOrderByWafer: [],
    yieldSummary: computeYieldSummary(lot),
    siteAnomalies: detectSiteAnomalies(lot),
    facts: analysis.facts,
    verdict: analysis.verdict,
    report: analysis.report,
  } as unknown as AutopsyWorkerLoadedPayload;
}

function createBridge(initial: AutopsyWorkerLoadedPayload | null): {
  bridge: LabBridge;
  highlighted: { ids: readonly string[]; label?: string; factId?: string } | null;
} {
  let payload = initial;
  let highlighted: { ids: readonly string[]; label?: string; factId?: string } | null = null;
  return {
    get highlighted() {
      return highlighted;
    },
    bridge: {
      getPayload: () => payload,
      loadDemoLot: async (presetId) => {
        payload = buildPayload(presetId);
      },
      highlight: (ids, label, factId) => {
        highlighted = { ids, label, factId };
      },
      clearHighlight: () => {
        highlighted = null;
      },
    },
  };
}

describe('site actions over a real demo lot', () => {
  it('lists the three demo lots and says when one is loaded', async () => {
    const state = createBridge(null);
    const actions = createLabSiteActions(state.bridge);
    const list = actions.find((action) => action.name === 'list_demo_lots');
    const result = await list!.handler({}, { trace: () => {}, visit: () => null });
    expect(result.summary).toContain('No lot is loaded');
    expect(result.summary).toContain('edge-ring-etch');
    expect(result.summary).toContain('handling-scratch');
    expect(result.summary).toContain('site2-probe-contact');
  });

  it('refuses to read a lot before one is loaded', async () => {
    const state = createBridge(null);
    const actions = createLabSiteActions(state.bridge);
    const summary = actions.find((action) => action.name === 'get_lot_summary');
    await expect(summary!.handler({}, { trace: () => {}, visit: () => null })).rejects.toThrow(
      /No lot is loaded/,
    );
  });

  it('summarises yield, the dominant bin and its share of failures', async () => {
    const state = createBridge(buildPayload('edge-ring-etch'));
    const actions = createLabSiteActions(state.bridge);
    const action = actions.find((entry) => entry.name === 'get_lot_summary');
    const result = await action!.handler({}, { trace: () => {}, visit: () => null });
    expect(result.summary).toMatch(/First-pass yield \d+\.\d%/);
    expect(result.summary).toMatch(/final yield \d+\.\d%/);
    expect(result.summary).toMatch(/SBIN 7/);
  });

  it('returns the verdict with fact ids for every finding', async () => {
    const state = createBridge(buildPayload('edge-ring-etch'));
    const actions = createLabSiteActions(state.bridge);
    const action = actions.find((entry) => entry.name === 'diagnose_lot');
    const result = await action!.handler({}, { trace: () => {}, visit: () => null });
    expect(result.summary).toMatch(/Cause of death: .*Edge-Ring/);
    const data = result.data as { verdict: { citedFactIds: string[] }; findings: { factIds: string[] }[] };
    expect(data.findings.length).toBeGreaterThan(0);
    for (const finding of data.findings) expect(finding.factIds.length).toBeGreaterThan(0);
  });

  it('reports the spatial signature with the dies that carry it', async () => {
    const state = createBridge(buildPayload('edge-ring-etch'));
    const actions = createLabSiteActions(state.bridge);
    const action = actions.find((entry) => entry.name === 'get_spatial_pattern');
    const result = await action!.handler({}, { trace: () => {}, visit: () => null });
    expect(result.summary).toMatch(/Edge-Ring/);
    const data = result.data as { factId: string | null; dieCount: number };
    expect(data.factId).toMatch(/^fact:/);
    expect(data.dieCount).toBeGreaterThan(0);
  });

  it('ranks parametric capability by Cpk', async () => {
    const state = createBridge(buildPayload('edge-ring-etch'));
    const actions = createLabSiteActions(state.bridge);
    const action = actions.find((entry) => entry.name === 'get_parametric_report');
    const result = await action!.handler({ limit: 3 }, { trace: () => {}, visit: () => null });
    const data = result.data as { tests: { cpk: number | null }[] };
    expect(data.tests.length).toBeLessThanOrEqual(3);
    const cpks = data.tests.map((test) => test.cpk ?? Number.POSITIVE_INFINITY);
    expect([...cpks].sort((a, b) => a - b)).toEqual(cpks);
  });

  it('finds the probe-site anomaly on the site2 demo lot', async () => {
    const state = createBridge(buildPayload('site2-probe-contact'));
    const actions = createLabSiteActions(state.bridge);
    const action = actions.find((entry) => entry.name === 'compare_test_sites');
    const result = await action!.handler({}, { trace: () => {}, visit: () => null });
    expect(result.summary).toMatch(/Anomaly at site 1:2/);
  });

  it('answers a Filter DSL query and rejects a bad one with guidance', async () => {
    const state = createBridge(buildPayload('edge-ring-etch'));
    const actions = createLabSiteActions(state.bridge);
    const query = actions.find((entry) => entry.name === 'query_dies');
    const good = await query!.handler({ expression: 'only bin 7' }, { trace: () => {}, visit: () => null });
    expect(good.summary).toMatch(/selects [\d,]+ of [\d,]+ dies/);
    const bad = await query!.handler({ expression: '!!!' }, { trace: () => {}, visit: () => null });
    expect(bad.summary).toMatch(/did not parse/);
  });

  it('lists evidence and resolves one fact id', async () => {
    const state = createBridge(buildPayload('handling-scratch'));
    const actions = createLabSiteActions(state.bridge);
    const list = await actions
      .find((entry) => entry.name === 'list_evidence')!
      .handler({}, { trace: () => {}, visit: () => null });
    const data = list.data as { facts: { factId: string }[] };
    expect(data.facts.length).toBeGreaterThan(0);
    const first = data.facts[0].factId;
    const detail = await actions
      .find((entry) => entry.name === 'get_evidence')!
      .handler({ factId: first }, { trace: () => {}, visit: () => null });
    expect(detail.summary).toContain(first);
    const missing = await actions
      .find((entry) => entry.name === 'get_evidence')!
      .handler({ factId: 'fact:nope' }, { trace: () => {}, visit: () => null });
    expect(missing.summary).toMatch(/No fact "fact:nope"/);
  });

  it('highlights the dies behind a fact, and defaults to the primary spatial fact', async () => {
    const state = createBridge(buildPayload('edge-ring-etch'));
    const actions = createLabSiteActions(state.bridge);
    const result = await actions
      .find((entry) => entry.name === 'highlight_dies')!
      .handler({}, { trace: () => {}, visit: () => null });
    expect(state.highlighted?.ids.length).toBeGreaterThan(0);
    expect(state.highlighted?.factId).toMatch(/^fact:/);
    expect(result.summary).toMatch(/Highlighted [\d,]+ dies/);
  });

  it('exports the report as Markdown whose findings cite facts', async () => {
    const state = createBridge(buildPayload('edge-ring-etch'));
    const actions = createLabSiteActions(state.bridge);
    const result = await actions
      .find((entry) => entry.name === 'export_report')!
      .handler({}, { trace: () => {}, visit: () => null });
    expect(result.summary).toContain('# Autopsy report');
    expect(result.summary).toContain('Evidence: fact:');
  });

  it('loads a different demo lot through the same bridge', async () => {
    const state = createBridge(null);
    const actions = createLabSiteActions(state.bridge);
    const load = actions.find((entry) => entry.name === 'load_demo_lot');
    const result = await load!.handler({ presetId: 'handling-scratch' }, { trace: () => {}, visit: () => null });
    expect(result.summary).toContain('Loaded demo lot');
    expect(state.bridge.getPayload()?.lot.lotId).toContain('CAL-SC');
  });

  it('declares the two page-changing actions as writes and the rest as reads', () => {
    const state = createBridge(null);
    const actions = createLabSiteActions(state.bridge);
    const writes = actions.filter((action) => action.effect === 'write').map((action) => action.name);
    expect(writes.sort()).toEqual(['highlight_dies', 'load_demo_lot']);
    for (const action of actions) {
      expect(action.inputSchema).toMatchObject({ type: 'object' });
      expect(action.purpose.length).toBeGreaterThan(20);
    }
  });
});
