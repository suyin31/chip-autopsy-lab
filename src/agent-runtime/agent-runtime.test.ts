/**
 * Runtime conformance tests for `public/agent-runtime/agent-runtime.mjs`
 * against MVP Profile 0.3 (parse/validate, budgets, consent, actions, peers,
 * private context, routers).
 *
 * The runtime is plain JavaScript so any site can load it; these tests give it
 * the same scrutiny as the TypeScript core.
 */

import { describe, expect, it, vi } from 'vitest';
import fc from 'fast-check';
import {
  AGENT_RUNTIME_PROFILE,
  AgentRuntimeError,
  parseHocon,
  resolveNetwork,
  validateJsonSchema,
  validateManifest,
  createAgentRuntime,
  createDemoRouter,
  createOpenAICompatibleRouter,
  type Router,
  type RouterChatRequest,
  type SiteActionSpec,
  type SiteManifest,
} from '../../public/agent-runtime/agent-runtime.mjs';

const ORIGIN = 'https://lab.example';
const PEER_ORIGIN = 'https://peer.example';

const networkDocument = {
  metadata: {
    name: 'test_lab',
    description: 'Test network',
    demo_routes: {
      conductor: {
        fallback: { delegate: 'analyst' },
        routes: [
          { match: ['pattern', 'shape'], delegate: 'pathologist' },
          { match: ['evidence'], delegate: 'auditor' },
        ],
      },
      analyst: {
        default: { actions: ['read_summary', 'read_verdict'] },
        routes: [{ match: ['parametric'], actions: ['read_summary', 'read_parametric'] }],
      },
      pathologist: { default: { actions: ['read_pattern'] } },
      auditor: { default: { actions: ['read_facts'] } },
    },
  },
  llm_config: { model_name: 'test-model' },
  max_execution_seconds: 30,
  tools: [
    {
      name: 'conductor',
      function: { description: 'Front agent' },
      instructions: 'Route the request.',
      tools: ['analyst', 'pathologist', 'auditor', 'peer_site', 'write_highlight'],
    },
    {
      name: 'analyst',
      function: { description: 'Reads the lot summary' },
      instructions: 'Summarise.',
      tools: ['read_summary', 'read_verdict', 'read_parametric'],
    },
    {
      name: 'pathologist',
      function: { description: 'Reads the spatial pattern' },
      instructions: 'Describe the shape.',
      tools: ['read_pattern'],
    },
    {
      name: 'auditor',
      function: { description: 'Lists evidence' },
      instructions: 'Audit.',
      tools: ['read_facts'],
    },
  ],
  links: { peer_site: `${PEER_ORIGIN}/peer_network` },
};

const manifest: SiteManifest = {
  brand: 'Lab',
  networks: [
    {
      name: 'test_lab',
      front_man: 'conductor',
      hocon: './test_lab.network.json',
      description: 'Test network',
      sample_queries: ['Why did yield drop?'],
    },
  ],
  llm_router: { base_url: 'https://api.example/v1', mock: false },
  allowed_peers: [],
  peer_policy: { mode: 'closed', deny_origins: [] },
  actions: { version: 1, registry: 'page', agentTools: ['read_summary'] },
};

const peerManifest: SiteManifest = {
  brand: 'Peer',
  networks: [
    { name: 'peer_network', front_man: 'peer_front', hocon: './peer.network.json' },
  ],
  peer_policy: { mode: 'closed', deny_origins: [] },
};

const peerNetworkDocument = {
  metadata: { name: 'peer_network', demo_routes: { peer_front: { default: { actions: ['read_summary'] } } } },
  tools: [
    {
      name: 'peer_front',
      function: { description: 'Peer front agent' },
      instructions: 'Answer from the peer site.',
      tools: ['read_summary'],
    },
  ],
};

/** A fetch double that serves the site bundle plus a peer bundle. */
function createSiteFetch(options: {
  readonly networkText?: string;
  readonly calls?: { url: string; init?: RequestInit }[];
  readonly onPeerDefinition?: () => void;
} = {}) {
  const calls = options.calls ?? [];
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    calls.push({ url, init });
    const json = (body: unknown) =>
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    if (url === `${ORIGIN}/agent-manifest.json`) return json(manifest);
    if (url === `${ORIGIN}/links.json`) return json({ version: 1, networks: { test_lab: {} } });
    if (url === `${ORIGIN}/test_lab.network.json`) {
      return new Response(options.networkText ?? JSON.stringify(networkDocument), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (url === `${PEER_ORIGIN}/agent-manifest.json`) return json(peerManifest);
    if (url === `${PEER_ORIGIN}/peer.network.json`) {
      options.onPeerDefinition?.();
      return json(peerNetworkDocument);
    }
    return new Response('not found', { status: 404 });
  }) as unknown as typeof fetch;
}

function readAction(overrides: Partial<SiteActionSpec> = {}): SiteActionSpec {
  return {
    name: 'read_summary',
    purpose: 'Reads the lot summary',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    effect: 'read',
    handler: async () => ({ summary: 'Final yield 71.2% on 15,825 dies.', data: { finalYield: 71.2 } }),
    ...overrides,
  };
}

function createActions(extra: SiteActionSpec[] = []): SiteActionSpec[] {
  return [
    readAction(),
    readAction({ name: 'read_verdict', purpose: 'Reads the verdict', handler: async () => ({ summary: 'Cause of death: Edge-Ring failure.' }) }),
    readAction({ name: 'read_parametric', purpose: 'Reads Cpk', handler: async () => ({ summary: 'Worst Cpk: VCCA_SHORT at 0.62.' }) }),
    readAction({ name: 'read_pattern', purpose: 'Reads the pattern', handler: async () => ({ summary: 'Edge-Ring at confidence 0.91.' }) }),
    readAction({ name: 'read_facts', purpose: 'Lists facts', handler: async () => ({ summary: 'fact:spatial:primary (2,988 dies).' }) }),
    readAction({
      name: 'write_highlight',
      purpose: 'Lights dies up on the page',
      effect: 'write',
      inputSchema: { type: 'object', properties: { factId: { type: 'string' } }, required: ['factId'] },
      handler: async () => ({ summary: 'Highlighted 2,988 dies.', outcome: 'verified' }),
    }),
    ...extra,
  ];
}

async function createRuntime(
  options: {
    readonly consent?: (request: { kind: string; origin?: string; name?: string }) => boolean | Promise<boolean>;
    readonly actions?: SiteActionSpec[];
    readonly router?: Router;
    readonly networkText?: string;
    readonly calls?: { url: string; init?: RequestInit }[];
    readonly limits?: Record<string, number>;
  } = {},
) {
  const runtime = createAgentRuntime({
    manifestUrl: `${ORIGIN}/agent-manifest.json`,
    siteBaseUrl: ORIGIN,
    fetchImpl: createSiteFetch({ networkText: options.networkText, calls: options.calls }),
    actions: options.actions ?? createActions(),
    consent: options.consent ?? (() => true),
    router: options.router ?? createDemoRouter(),
    ...(options.limits ? { limits: options.limits } : {}),
  });
  await runtime.ready();
  return runtime;
}

describe('HOCON reader', () => {
  it('reads the authored form the site publishes: comments, braces, dotted keys, triple quotes', () => {
    const value = parseHocon(`
      # leading comment
      {
        metadata { name = demo }   // trailing comment
        nested.key = 1
        list = [ a, "b", 3 ]
        text = """
        two lines
        """
        url = https://example.test/network
      }
    `) as Record<string, unknown>;
    expect(value.metadata).toEqual({ name: 'demo' });
    expect(value.nested).toEqual({ key: 1 });
    expect(value.list).toEqual(['a', 'b', 3]);
    expect(value.text).toBe('two lines');
    expect(value.url).toBe('https://example.test/network');
  });

  it('accepts plain JSON, which is a valid HOCON serialization', () => {
    expect(parseHocon('{"a": {"b": [1, 2]}}')).toEqual({ a: { b: [1, 2] } });
  });

  it('refuses an unresolved include, because a published network must be resolved', () => {
    expect(() => parseHocon('include "registries/aaosa.hocon"\n{ a = b }')).toThrow(AgentRuntimeError);
  });

  it('refuses an unresolved substitution', () => {
    expect(() => parseHocon('{ a = ${b} }')).toThrow(/Unresolved substitution/);
  });

  it('never throws anything but an AgentRuntimeError for arbitrary text', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 120 }), (text) => {
        try {
          parseHocon(text);
        } catch (error) {
          expect(error).toBeInstanceOf(AgentRuntimeError);
        }
      }),
      { numRuns: 120 },
    );
  });
});

describe('manifest validation', () => {
  it('accepts the shape the site publishes', () => {
    expect(validateManifest(manifest)).toEqual([]);
  });

  it('requires at least one network with a name, a front agent and a definition path', () => {
    const errors = validateManifest({ networks: [{ name: '', hocon: '' }] });
    expect(errors.join(' ')).toMatch(/front_man/);
    expect(errors.join(' ')).toMatch(/name/);
  });

  it('rejects duplicate network names', () => {
    const errors = validateManifest({
      networks: [
        { name: 'a', front_man: 'f', hocon: './a.json' },
        { name: 'a', front_man: 'f', hocon: './a.json' },
      ],
    });
    expect(errors.join(' ')).toMatch(/duplicate/);
  });
});

describe('network resolution', () => {
  it('builds agents, the front agent and its references', () => {
    const network = resolveNetwork(networkDocument, { name: 'test_lab' });
    expect(network.frontMan).toBe('conductor');
    expect([...network.agents.keys()]).toEqual(['conductor', 'analyst', 'pathologist', 'auditor']);
    expect(network.maxExecutionSeconds).toBe(30);
  });

  it('rejects a duplicate agent name', () => {
    expect(() =>
      resolveNetwork({
        tools: [
          { name: 'a', function: { description: 'x' } },
          { name: 'a', function: { description: 'y' } },
        ],
      }),
    ).toThrow(/duplicate agent/);
  });

  it('rejects a front agent that is not defined', () => {
    expect(() =>
      resolveNetwork({ front_man: 'nobody', tools: [{ name: 'a', function: { description: 'x' } }] }),
    ).toThrow(/front agent/);
  });

  it('rejects an executable definition: published networks are declarative data', () => {
    expect(() =>
      resolveNetwork({ tools: [{ name: 'a', function: { description: 'x' }, code: 'doEvil()' }] }),
    ).toThrow(/executable definition/);
  });
});

describe('JSON Schema subset', () => {
  it('checks type, required, enum and closed objects', () => {
    const schema = {
      type: 'object',
      properties: { factId: { type: 'string' }, limit: { type: 'number', maximum: 10 } },
      required: ['factId'],
      additionalProperties: false,
    };
    expect(validateJsonSchema(schema, { factId: 'fact:spatial:primary' })).toEqual([]);
    expect(validateJsonSchema(schema, {})[0]).toMatch(/required/);
    expect(validateJsonSchema(schema, { factId: 3 })[0]).toMatch(/expected string/);
    expect(validateJsonSchema(schema, { factId: 'a', limit: 11 })[0]).toMatch(/at most 10/);
    expect(validateJsonSchema(schema, { factId: 'a', extra: true })[0]).toMatch(/not allowed/);
  });

  it('never throws on arbitrary values', () => {
    fc.assert(
      fc.property(fc.anything(), (value) => {
        const errors = validateJsonSchema(
          { type: 'object', properties: { a: { type: 'string' } }, required: ['a'] },
          value,
        );
        expect(Array.isArray(errors)).toBe(true);
      }),
      { numRuns: 100 },
    );
  });
});

describe('agent loop', () => {
  it('runs the network on the demo router: front agent, delegation, real tool calls, real answers', async () => {
    const runtime = await createRuntime();
    const result = await runtime.run({ input: 'Why did yield drop?' });

    expect(result.ok).toBe(true);
    expect(result.text).toContain('Final yield 71.2%');
    expect(result.text).toContain('Cause of death: Edge-Ring failure');
    expect(result.invocations).toBe(2);
    const types = result.events.map((event) => event.type);
    expect(types).toContain('agent.invoke');
    expect(types).toContain('action.call');
    expect(types).toContain('action.result');
    expect(result.router.info.kind).toBe('demo');
  });

  it('routes a pattern question to the pattern specialist', async () => {
    const runtime = await createRuntime();
    const result = await runtime.run({ input: 'What spatial shape does this lot show?' });
    expect(result.text).toContain('Edge-Ring');
  });

  it('fails closed when the network declares a tool this site does not register', async () => {
    const withMissingTool = {
      metadata: {
        name: 'test_lab',
        demo_routes: { conductor: { fallback: { delegate: 'ghost' } }, ghost: { default: { actions: [] } } },
      },
      tools: [
        {
          name: 'conductor',
          function: { description: 'Front' },
          instructions: 'Route.',
          tools: ['ghost'],
        },
        { name: 'ghost', function: { description: 'Specialist' }, instructions: 'Work.', tools: ['not_registered'] },
      ],
    };
    const runtime = await createRuntime({ networkText: JSON.stringify(withMissingTool) });
    await expect(runtime.run({ input: 'anything' })).rejects.toMatchObject({ code: 'tool_unknown' });
  });

  it('reports an action failure instead of a result', async () => {
    const actions = createActions().map((action) =>
      action.name === 'read_verdict'
        ? {
            ...action,
            handler: async () => {
              throw new Error('engine exploded');
            },
          }
        : action,
    );
    const runtime = await createRuntime({ actions });
    const result = await runtime.run({ input: 'why did yield drop' });
    expect(result.ok).toBe(true);
    expect(result.text).toContain('engine exploded');
    expect(result.text).toMatch(/failed: engine exploded/);
    expect(result.text).not.toContain('Cause of death');
  });
});

describe('execution bounds', () => {
  it('stops at the agent invocation budget', async () => {
    const runtime = await createRuntime({ limits: { maxAgentInvocations: 1 } });
    await expect(runtime.run({ input: 'why did yield drop' })).rejects.toMatchObject({
      code: 'budget_exceeded',
    });
  });

  it('stops a composition cycle', async () => {
    const cyclic = {
      metadata: {
        name: 'cyclic',
        demo_routes: { a: { default: { actions: [] } }, b: { default: { actions: [] } } },
      },
      tools: [
        { name: 'a', function: { description: 'A' }, instructions: 'A', tools: ['b'] },
        { name: 'b', function: { description: 'B' }, instructions: 'B', tools: ['a'] },
      ],
    };
    const runtime = await createRuntime({ networkText: JSON.stringify(cyclic) });
    const loopingRouter: Router = {
      id: 'loop',
      label: 'Loop',
      info: { kind: 'site' },
      async chat(request: RouterChatRequest) {
        const target = request.context.agent.name === 'a' ? 'b' : 'a';
        if (request.context.step > 0) return { content: 'done', toolCalls: [] };
        return { content: '', toolCalls: [{ id: 'x', name: target, arguments: { request: 'go' } }] };
      },
    };
    runtime.setRouter(loopingRouter);
    await expect(runtime.run({ input: 'go' })).rejects.toMatchObject({ code: 'cycle_detected' });
  });

  it('stops at the step budget', async () => {
    const runtime = await createRuntime({ limits: { maxStepsPerAgent: 2, maxAgentInvocations: 12 } });
    const chatty: Router = {
      id: 'chatty',
      label: 'Chatty',
      info: { kind: 'site' },
      async chat(request) {
        const call =
          request.context.agent.name === 'conductor'
            ? { id: 'r', name: 'analyst', arguments: { request: 'again' } }
            : { id: 'r2', name: 'read_summary', arguments: {} };
        return { content: '', toolCalls: [call] };
      },
    };
    runtime.setRouter(chatty);
    await expect(runtime.run({ input: 'why did yield drop' })).rejects.toMatchObject({
      code: 'budget_exceeded',
    });
  });
});

describe('site actions', () => {
  it('validates arguments before running a handler', async () => {
    const handler = vi.fn(async () => ({ summary: 'ok' }));
    const runtime = await createRuntime({
      actions: createActions([
        readAction({
          name: 'write_highlight',
          purpose: 'Lights dies up',
          effect: 'write',
          inputSchema: { type: 'object', properties: { factId: { type: 'string' } }, required: ['factId'] },
          handler,
        }),
      ]),
    });
    const badArgs: Router = {
      id: 'bad',
      label: 'Bad',
      info: { kind: 'site' },
      async chat(request) {
        if (request.context.step > 0) return { content: 'done', toolCalls: [] };
        return { content: '', toolCalls: [{ id: 'c', name: 'write_highlight', arguments: { wrong: 1 } }] };
      },
    };
    runtime.setRouter(badArgs);
    await expect(runtime.run({ input: 'highlight' })).rejects.toMatchObject({ code: 'schema_invalid' });
    expect(handler).not.toHaveBeenCalled();
  });

  it('asks before a write and does not run it when the visitor declines', async () => {
    const handler = vi.fn(async () => ({ summary: 'highlighted' }));
    const consent = vi.fn(() => false);
    const runtime = await createRuntime({
      consent,
      actions: createActions([
        readAction({
          name: 'write_highlight',
          purpose: 'Lights dies up',
          effect: 'write',
          inputSchema: { type: 'object', properties: { factId: { type: 'string' } } },
          handler,
        }),
      ]),
    });
    const writer: Router = {
      id: 'writer',
      label: 'Writer',
      info: { kind: 'site' },
      async chat(request) {
        if (request.context.step > 0) return { content: 'done', toolCalls: [] };
        return { content: '', toolCalls: [{ id: 'c', name: 'write_highlight', arguments: { factId: 'f' } }] };
      },
    };
    runtime.setRouter(writer);
    await expect(runtime.run({ input: 'highlight' })).rejects.toMatchObject({ code: 'consent_denied' });
    expect(consent).toHaveBeenCalledWith(expect.objectContaining({ kind: 'action', effect: 'write' }));
    expect(handler).not.toHaveBeenCalled();
  });

  it('reports an unknown outcome for a write that failed after dispatch, and never retries it', async () => {
    const handler = vi.fn(async () => {
      throw new Error('connection reset');
    });
    const runtime = await createRuntime({
      actions: createActions([
        readAction({
          name: 'write_highlight',
          purpose: 'Lights dies up',
          effect: 'write',
          inputSchema: { type: 'object', properties: { factId: { type: 'string' } } },
          handler,
        }),
      ]),
    });
    const writer: Router = {
      id: 'writer',
      label: 'Writer',
      info: { kind: 'site' },
      async chat(request) {
        if (request.context.step > 0) {
          const toolMessage = request.messages.find((message) => message.role === 'tool');
          return { content: String(toolMessage?.content ?? ''), toolCalls: [] };
        }
        return { content: '', toolCalls: [{ id: 'c', name: 'write_highlight', arguments: { factId: 'f' } }] };
      },
    };
    runtime.setRouter(writer);
    const result = await runtime.run({ input: 'highlight' });
    expect(result.text).toMatch(/outcome of this effect is unknown/);
    expect(handler).toHaveBeenCalledTimes(1);
  });
});

describe('peer agent sites', () => {
  it('loads an exact named network from another origin and runs it on this runtime', async () => {
    const runtime = await createRuntime();
    const peer = await runtime.connectPeer(`${PEER_ORIGIN}/peer_network`);
    expect(peer.network.name).toBe('peer_network');
    expect(peer.network.source.isPeer).toBe(true);
    const result = await runtime.runPeer(`${PEER_ORIGIN}/peer_network`, 'hello peer');
    expect(result.ok).toBe(true);
    expect(result.text.toLowerCase()).toContain('final yield 71.2%');
  });

  it('fails closed when the peer publishes a different network name', async () => {
    const runtime = await createRuntime();
    await expect(runtime.connectPeer(`${PEER_ORIGIN}/missing_network`)).rejects.toMatchObject({
      code: 'network_not_found',
    });
  });

  it('requires consent before the first contact with a peer origin', async () => {
    const consent = vi.fn(() => false);
    const runtime = await createRuntime({ consent });
    await expect(runtime.connectPeer(`${PEER_ORIGIN}/peer_network`)).rejects.toMatchObject({
      code: 'consent_denied',
    });
    expect(consent).toHaveBeenCalledWith(expect.objectContaining({ kind: 'peer', origin: PEER_ORIGIN }));
  });

  it('never forwards private context to a peer network', async () => {
    const consent = vi.fn(() => true);
    const runtime = await createRuntime({ consent });
    const seen: string[] = [];
    const inspector: Router = {
      id: 'inspector',
      label: 'Inspector',
      info: { kind: 'site' },
      async chat(request) {
        seen.push(String(request.messages[0]?.content ?? ''));
        return { content: 'seen', toolCalls: [] };
      },
    };
    runtime.setRouter(inspector);
    await runtime.run({ input: 'test', slyData: { visitorEmail: 'a@b.c' } });
    await runtime.runPeer(`${PEER_ORIGIN}/peer_network`, 'test');
    expect(seen.some((prompt) => prompt.includes('a@b.c'))).toBe(false);
  });
});

describe('pluggable inference', () => {
  it('uses a site-declared model name as a hint only, and lets the router carry the key', async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const router = createOpenAICompatibleRouter({
      baseUrl: 'https://router.example/v1',
      model: 'qwen3.8-flash',
      apiKey: 'sk-test-123',
      provider: 'test',
      fetchImpl: vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        calls.push({ url: String(input), init });
        const body = [
          'data: {"choices":[{"delta":{"content":"Edge-Ring"}}]}',
          'data: {"choices":[{"delta":{"content":" failure."}}]}',
          'data: [DONE]',
          '',
        ].join('\n');
        return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
      }) as unknown as typeof fetch,
    });
    const runtime = await createRuntime({ router, actions: createActions() });
    const result = await runtime.run({ input: 'why did yield drop' });
    expect(result.text).toBe('Edge-Ring failure.');
    expect(calls[0]?.url).toBe('https://router.example/v1/chat/completions');
    expect((calls[0]?.init?.headers as Record<string, string>).authorization).toBe('Bearer sk-test-123');
    // The key never reaches the site's own artifacts.
    expect(JSON.stringify(runtime.manifest)).not.toContain('sk-test-123');
    expect(JSON.stringify(runtime.getEvents())).not.toContain('sk-test-123');
  });

  it('stops with a clear setup error when the router has no key', async () => {
    const router = createOpenAICompatibleRouter({
      baseUrl: 'https://router.example/v1',
      model: 'qwen3.8-flash',
      apiKey: '',
    });
    const runtime = await createRuntime({ router });
    await expect(runtime.run({ input: 'why did yield drop' })).rejects.toMatchObject({
      code: 'key_missing',
    });
  });

  it('refuses to run a network with no demo routes when no model is configured', async () => {
    const withoutRoutes = { ...networkDocument, metadata: { name: 'no_routes' } };
    const runtime = await createRuntime({ networkText: JSON.stringify(withoutRoutes) });
    await expect(runtime.run({ input: 'why' })).rejects.toMatchObject({ code: 'unavailable' });
  });

  it('reads a HOCON-served network definition, not only JSON', async () => {
    const hocon = `
      {
        metadata { name = test_lab, demo_routes { conductor { fallback { delegate = analyst } } analyst { default { actions = [ read_summary ] } } } }
        tools = [
          { name = conductor, function { description = "Front" }, instructions = "Route.", tools = [ analyst ] },
          { name = analyst, function { description = "Reads" }, instructions = "Read.", tools = [ read_summary ] }
        ]
      }
    `;
    const runtime = await createRuntime({ networkText: hocon });
    const result = await runtime.run({ input: 'yield please' });
    expect(result.text).toContain('Final yield 71.2%');
  });
});

describe('runtime metadata', () => {
  it('reports the profile it implements', () => {
    expect(AGENT_RUNTIME_PROFILE).toBe('mvp-0.3');
  });
});
