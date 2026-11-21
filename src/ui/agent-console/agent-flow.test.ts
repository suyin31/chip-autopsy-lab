/**
 * End-to-end console flow, without a browser: the published manifest, the
 * resolved network, the demo router and the site actions, running against a real
 * demo lot. This is the path the `/agents` page takes at runtime, so a regression
 * here is a regression a visitor would hit.
 */

import { describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  AgentRuntimeError,
  createAgentRuntime,
  createDemoRouter,
  type SiteActionSpec,
} from '../../../public/agent-runtime/agent-runtime.mjs';
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

const PUBLIC = path.resolve(__dirname, '../../../public');

function buildPayload(presetId: DemoPresetId): AutopsyWorkerLoadedPayload {
  const preset = listDemoPresets().find((entry) => entry.id === presetId);
  if (!preset) throw new Error(`unknown preset ${presetId}`);
  const bytes = generateDemoStdfBytes(presetId, preset.defaultSeed);
  const parsed = parseStdfBytes(bytes, { mode: 'full' });
  if (!parsed.ok) throw new Error(parsed.error.message);
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

/** Serves the real published artifacts from `public/`, exactly as the site does. */
function publicFetch(): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const relative = url.replace(/^https?:\/\/[^/]+/, '').replace(/^\//, '');
    try {
      const body = await fs.readFile(path.join(PUBLIC, relative));
      return new Response(body, {
        status: 200,
        headers: {
          'content-type': relative.endsWith('.json') ? 'application/json' : 'text/plain',
          'access-control-allow-origin': '*',
        },
      });
    } catch {
      return new Response('not found', { status: 404 });
    }
  }) as unknown as typeof fetch;
}

async function createConsoleRuntime(options: {
  payload?: AutopsyWorkerLoadedPayload | null;
  onHighlight?: (ids: readonly string[]) => void;
} = {}) {
  let payload = options.payload ?? null;
  const bridge: LabBridge = {
    getPayload: () => payload,
    loadDemoLot: async (presetId) => {
      payload = buildPayload(presetId);
    },
    highlight: (ids) => options.onHighlight?.(ids),
    clearHighlight: () => undefined,
  };
  const actions: SiteActionSpec[] = createLabSiteActions(bridge);
  const runtime = createAgentRuntime({
    manifestUrl: 'https://lab.example/agent-manifest.json',
    siteBaseUrl: 'https://lab.example',
    fetchImpl: publicFetch(),
    actions,
    router: createDemoRouter(),
    consent: () => true,
  });
  await runtime.ready();
  return { runtime, actions };
}

describe('published site bundle', () => {
  it('publishes a manifest whose every network resolves', async () => {
    const manifest = JSON.parse(await fs.readFile(path.join(PUBLIC, 'agent-manifest.json'), 'utf8')) as {
      networks: { name: string; front_man: string; hocon: string }[];
    };
    expect(manifest.networks.length).toBeGreaterThan(0);
    const { runtime } = await createConsoleRuntime();
    for (const entry of manifest.networks) {
      const network = runtime.getNetwork(entry.name);
      expect(network, entry.name).not.toBeNull();
      expect(network?.frontMan).toBe(entry.front_man);
    }
  });

  it('declares every agent tool as a registered action, an agent or a peer', async () => {
    const { runtime, actions } = await createConsoleRuntime();
    const network = runtime.getNetwork('chip_autopsy_lab');
    expect(network).not.toBeNull();
    const registered = new Set(actions.map((action) => action.name));
    const links = JSON.parse(await fs.readFile(path.join(PUBLIC, 'links.json'), 'utf8')) as {
      networks: Record<string, Record<string, string>>;
    };
    for (const agent of network!.agents.values()) {
      for (const tool of agent.tools) {
        if (typeof tool !== 'string') continue;
        const known =
          registered.has(tool) ||
          network!.agents.has(tool) ||
          /^https?:\/\//.test(tool) ||
          Boolean(links.networks?.[network!.name]?.[tool]);
        expect(known, `${agent.name} -> ${tool}`).toBe(true);
      }
    }
  });

  it('declares every site action and peer as a capability the network can name', async () => {
    const { runtime, actions } = await createConsoleRuntime();
    const network = runtime.getNetwork('chip_autopsy_lab');
    expect(network).not.toBeNull();
    expect(network!.capabilities.size).toBe(12);
    const manifest = JSON.parse(await fs.readFile(path.join(PUBLIC, 'agent-manifest.json'), 'utf8')) as {
      actions: { agentTools: string[] };
    };
    for (const [name, capability] of network!.capabilities) {
      if (capability.toolType === 'site_action') {
        expect(manifest.actions.agentTools, name).toContain(name);
        expect(actions.some((action) => action.name === name), name).toBe(true);
        expect(capability.description.length, name).toBeGreaterThan(20);
        const action = actions.find((entry) => entry.name === name);
        expect(capability.parameters, `${name} published schema`).toEqual(action?.inputSchema);
      } else {
        expect(capability.url, name).toMatch(/^https:\/\//);
      }
    }
  });

  it('gives every agent a declared input schema and instructions', async () => {
    const { runtime } = await createConsoleRuntime();
    const network = runtime.getNetwork('chip_autopsy_lab');
    for (const agent of network!.agents.values()) {
      expect(agent.instructions.length, agent.name).toBeGreaterThan(100);
      expect(agent.parameters, agent.name).toMatchObject({ type: 'object' });
    }
  });

  it('answers every sample query in the manifest with real engine numbers', async () => {
    const { runtime } = await createConsoleRuntime({ payload: buildPayload('edge-ring-etch') });
    const manifest = JSON.parse(await fs.readFile(path.join(PUBLIC, 'agent-manifest.json'), 'utf8')) as {
      networks: { sample_queries?: string[] }[];
    };
    const queries = manifest.networks[0]?.sample_queries ?? [];
    expect(queries.length).toBeGreaterThan(3);
    for (const query of queries) {
      if (/load the .* demo lot/i.test(query)) continue; // loading is covered below
      const result = await runtime.run({ input: query });
      expect(result.ok, query).toBe(true);
      expect(result.text.length, query).toBeGreaterThan(60);
      expect(result.text, query).not.toContain('[object Object]');
    }
  });

  it('loads a demo lot through an agent, then answers from it', async () => {
    const highlighted: string[][] = [];
    const { runtime } = await createConsoleRuntime({
      payload: null,
      onHighlight: (ids) => highlighted.push([...ids]),
    });
    const load = await runtime.run({ input: 'Load the edge-ring demo lot and diagnose it.' });
    expect(load.text).toMatch(/Cause of death: .*Edge-Ring/);
    const pattern = await runtime.run({ input: 'Show me the spatial signature and light up the dies.' });
    expect(pattern.text).toMatch(/Edge-Ring/);
    expect(highlighted.length).toBeGreaterThan(0);
    expect(highlighted[0]?.length).toBeGreaterThan(100);
  });

  it('reports the parametric question and the site comparison from the same lot', async () => {
    const { runtime } = await createConsoleRuntime({ payload: buildPayload('site2-probe-contact') });
    const parametric = await runtime.run({ input: 'Which parametric test has the worst Cpk?' });
    expect(parametric.text).toMatch(/Cpk \d/);
    const sites = await runtime.run({ input: 'Compare yield across test sites.' });
    expect(sites.text).toMatch(/Anomaly at site 1:2/);
  });

  it('refuses to run a peer network without the visitor’s approval', async () => {
    const runtime = createAgentRuntime({
      manifestUrl: 'https://lab.example/agent-manifest.json',
      siteBaseUrl: 'https://lab.example',
      fetchImpl: publicFetch(),
      router: createDemoRouter(),
      consent: () => false,
    });
    await runtime.ready();
    await expect(runtime.connectPeer('https://agent-atlas-phi.vercel.app/agent_atlas')).rejects.toBeInstanceOf(
      AgentRuntimeError,
    );
  });
});
