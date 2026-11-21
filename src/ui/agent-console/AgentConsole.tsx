'use client';

/**
 * Agent console — the human interface to the published agent network.
 *
 * It mounts the site's runtime on `/agent-manifest.json`, registers the engine's
 * site actions, and shows what an agent is doing while it does it: which agent
 * spoke, which tool ran and with what arguments, which consent card was
 * answered, and which dies a claim actually points at. The same runtime file can
 * be loaded by any other agentic site.
 */

import * as React from 'react';
import Link from 'next/link';
import {
  AgentRuntimeError,
  createAgentRuntime,
  createDemoRouter,
  type AgentRuntime,
  type ConsentRequest,
  type Router,
  type TraceEvent,
} from '../../../public/agent-runtime/agent-runtime.mjs';
import type { DemoPresetId } from '@/core/demo';
import type { AutopsyWorkerLoadedPayload } from '@/workers';
import { createAutopsyWorkerClient, type AutopsyWorkerClient } from '@/workers';
import { Button, cn } from '@/ui/primitives';
import {
  createLabSiteActions,
  type LabBridge,
} from './site-actions';
import {
  ModelSettingsPanel,
  routerForSettings,
  useModelSettings,
} from './model-settings';
import { WaferStage } from './WaferStage';

type TranscriptItem =
  | { readonly id: string; readonly kind: 'user'; readonly text: string }
  | {
      readonly id: string;
      readonly kind: 'assistant';
      readonly text: string;
      readonly routerLabel: string;
      readonly peerOrigin?: string;
    }
  | {
      readonly id: string;
      readonly kind: 'tool';
      readonly callId: string;
      readonly name: string;
      readonly toolKind?: string;
      readonly status: 'running' | 'ok' | 'error';
      readonly summary?: string;
    }
  | { readonly id: string; readonly kind: 'notice'; readonly text: string }
  | { readonly id: string; readonly kind: 'error'; readonly code: string; readonly message: string };

let counter = 0;
const nextId = (prefix: string) => `${prefix}-${(counter += 1)}`;

const SUGGESTIONS = [
  'Load the edge-ring demo lot and diagnose it.',
  'Why did this lot lose yield? Give me the cause of death and the evidence.',
  'What spatial signature does this lot show, and which dies carry it?',
  'Which parametric test has the worst Cpk?',
  'Compare yield across test sites.',
];

function formatTime(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? iso
    : date.toLocaleTimeString([], { hour12: false, minute: '2-digit', second: '2-digit' });
}

function eventSummary(event: TraceEvent): string {
  const parts: string[] = [];
  for (const key of ['agent', 'to', 'tool', 'kind', 'step', 'depth', 'network', 'origin', 'code', 'approved', 'router', 'model', 'ms']) {
    const value = event[key];
    if (value !== undefined && value !== null && value !== '') parts.push(`${key}=${String(value)}`);
  }
  return parts.join(' · ');
}

export function AgentConsole() {
  const [payload, setPayload] = React.useState<AutopsyWorkerLoadedPayload | null>(null);
  const payloadRef = React.useRef<AutopsyWorkerLoadedPayload | null>(null);
  const workerRef = React.useRef<AutopsyWorkerClient | null>(null);

  const [transcript, setTranscript] = React.useState<TranscriptItem[]>([]);
  const [draft, setDraft] = React.useState('');
  const [running, setRunning] = React.useState(false);
  const [streamText, setStreamText] = React.useState('');
  const [trace, setTrace] = React.useState<TraceEvent[]>([]);
  const [consentRequest, setConsentRequest] = React.useState<ConsentRequest | null>(null);
  const [highlight, setHighlight] = React.useState<{
    readonly ids: ReadonlySet<string>;
    readonly label?: string;
    readonly factId?: string;
  }>({ ids: new Set<string>() });
  const [waferIndex, setWaferIndex] = React.useState(0);
  const [showSettings, setShowSettings] = React.useState(false);
  const [showManifest, setShowManifest] = React.useState(false);
  const [peerUrl, setPeerUrl] = React.useState('https://agent-atlas-phi.vercel.app/agent_atlas');
  const [peers, setPeers] = React.useState<{ url: string; network: string; origin: string }[]>([]);
  const [activePeer, setActivePeer] = React.useState<string | null>(null);
  const [manifestJson, setManifestJson] = React.useState<string>('');
  const [networkSummary, setNetworkSummary] = React.useState<{
    readonly name: string;
    readonly frontMan: string;
    readonly agents: { name: string; description: string; tools: number }[];
  } | null>(null);

  const { settings, stored, update, clear } = useModelSettings();
  const settingsRef = React.useRef(settings);
  settingsRef.current = settings;

  const runtimeRef = React.useRef<AgentRuntime | null>(null);
  const demoRouterRef = React.useRef<Router>(createDemoRouter());
  const consentResolver = React.useRef<((approved: boolean) => void) | null>(null);
  const rememberedWrites = React.useRef<Set<string>>(new Set());
  const transcriptEndRef = React.useRef<HTMLDivElement | null>(null);

  const bridge = React.useMemo<LabBridge>(
    () => ({
      getPayload: () => payloadRef.current,
      loadDemoLot: async (presetId: DemoPresetId) => {
        const client = workerRef.current ?? createAutopsyWorkerClient();
        workerRef.current = client;
        const response = await client.loadDemoLot(presetId);
        if (response.kind !== 'ok') {
          throw new Error(
            response.kind === 'error'
              ? `The parser rejected the demo lot: ${response.error.message} (${response.error.code})`
              : 'The demo lot could not be loaded in this tab.',
          );
        }
        payloadRef.current = response;
        setPayload(response);
        setHighlight({ ids: new Set<string>() });
        setWaferIndex(0);
      },
      highlight: (dieIds, label, factId) => {
        setHighlight({ ids: new Set(dieIds), label, factId });
        setWaferIndex(0);
      },
      clearHighlight: () => setHighlight({ ids: new Set<string>() }),
    }),
    [],
  );

  const append = React.useCallback((item: TranscriptItem) => {
    setTranscript((current) => [...current, item]);
  }, []);

  const pushEvent = React.useCallback((event: TraceEvent) => {
    setTrace((current) => [...current.slice(-199), event]);
    if (event.type === 'tool.call') {
      append({
        id: nextId('tool'),
        kind: 'tool',
        callId: String(event.callId ?? event.tool ?? nextId('call')),
        name: String(event.tool ?? event.to ?? event.url ?? 'tool'),
        toolKind: String(event.kind ?? ''),
        status: 'running',
      });
    }
    if (event.type === 'tool.result') {
      const callId = String(event.requestId ?? event.tool ?? '');
      setTranscript((current) =>
        current.map((item) =>
          item.kind === 'tool' && item.status === 'running' && (item.callId === callId || item.name === event.tool)
            ? {
                ...item,
                status: event.ok === false ? 'error' : 'ok',
                summary: String(event.summary ?? ''),
              }
            : item,
        ),
      );
    }
    if (event.type === 'model.delta') {
      setStreamText((current) => current + String(event.text ?? ''));
    }
  }, [append]);

  React.useEffect(() => {
    const runtime = createAgentRuntime({
      manifestUrl: '/agent-manifest.json',
      actions: createLabSiteActions(bridge),
      router: demoRouterRef.current,
      onEvent: pushEvent,
      consent: (request) => {
        if (request.kind === 'action' && request.effect === 'read') return true;
        if (request.kind === 'action' && request.name && rememberedWrites.current.has(request.name)) {
          return true;
        }
        return new Promise<boolean>((resolve) => {
          consentResolver.current = resolve;
          setConsentRequest(request);
        });
      },
      limits: { maxExecutionSeconds: 120 },
    });
    runtimeRef.current = runtime;
    runtime
      .ready()
      .then((site) => {
        const network = runtime.getNetwork(site.networks[0] ?? '');
        setManifestJson(JSON.stringify(site.manifest, null, 2));
        if (network) {
          setNetworkSummary({
            name: network.name,
            frontMan: network.frontMan,
            agents: [...network.agents.values()].map((agent) => ({
              name: agent.name,
              description: agent.description,
              tools: agent.tools.length,
            })),
          });
        }
      })
      .catch((error: unknown) => {
        append({
          id: nextId('err'),
          kind: 'error',
          code: error instanceof AgentRuntimeError ? error.code : 'manifest_unavailable',
          message: error instanceof Error ? error.message : String(error),
        });
      });
    return () => {
      runtime.dispose();
      runtimeRef.current = null;
      workerRef.current?.dispose();
      workerRef.current = null;
    };
  }, [append, bridge, pushEvent]);

  React.useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [transcript, streamText]);

  const answerConsent = (approved: boolean, remember: boolean) => {
    if (approved && remember && consentRequest?.kind === 'action' && consentRequest.name) {
      rememberedWrites.current.add(consentRequest.name);
    }
    const resolve = consentResolver.current;
    consentResolver.current = null;
    setConsentRequest(null);
    resolve?.(approved);
  };

  const send = async (text: string) => {
    const trimmed = text.trim();
    const runtime = runtimeRef.current;
    if (!trimmed || running || !runtime) return;
    setDraft('');
    append({ id: nextId('user'), kind: 'user', text: trimmed });
    setRunning(true);
    setStreamText('');
    const router = routerForSettings(settingsRef.current, demoRouterRef.current);
    runtime.setRouter(router);
    try {
      if (activePeer) {
        const result = await runtime.runPeer(activePeer, trimmed);
        append({
          id: nextId('a'),
          kind: 'assistant',
          text: result.text,
          routerLabel: router.label,
          peerOrigin: result.peerOrigin,
        });
      } else {
        const result = await runtime.run({ input: trimmed });
        append({
          id: nextId('a'),
          kind: 'assistant',
          text: result.text,
          routerLabel: router.label,
        });
      }
    } catch (error) {
      if (error instanceof AgentRuntimeError) {
        append({ id: nextId('err'), kind: 'error', code: error.code, message: error.message });
      } else {
        append({
          id: nextId('err'),
          kind: 'error',
          code: 'router_failed',
          message: error instanceof Error ? error.message : String(error),
        });
      }
    } finally {
      setRunning(false);
      setStreamText('');
    }
  };

  const connectPeer = async () => {
    const runtime = runtimeRef.current;
    if (!runtime || !peerUrl.trim()) return;
    try {
      const peer = await runtime.connectPeer(peerUrl.trim());
      setPeers((current) =>
        current.some((entry) => entry.url === peerUrl.trim())
          ? current
          : [...current, { url: peerUrl.trim(), network: peer.network.name, origin: peer.origin }],
      );
      append({
        id: nextId('n'),
        kind: 'notice',
        text: `Loaded "${peer.network.name}" from ${peer.origin}. It runs in this tab, on the router above, with this site's limits.`,
      });
    } catch (error) {
      append({
        id: nextId('err'),
        kind: 'error',
        code: error instanceof AgentRuntimeError ? error.code : 'peer_blocked',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const facts = payload?.facts ?? [];
  const factsPreview = facts.slice(0, 8);

  return (
    <div className="min-h-dvh bg-bg text-text-primary">
      <header className="sticky top-0 z-20 border-b border-hairline bg-[var(--material)] backdrop-blur-[var(--material-filter)]">
        <div className="mx-auto flex max-w-[1360px] flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3">
          <Link href="/" className="text-[13px] text-text-secondary transition-[color] duration-[120ms] hover:text-text-primary">
            ← Chip Autopsy Lab
          </Link>
          <span className="h-4 w-px bg-hairline" aria-hidden="true" />
          <h1 className="text-[15px] leading-none">Agent console</h1>
          <span className="rounded-pill border border-hairline px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide text-text-tertiary">
            MVP Profile 0.3
          </span>
          {networkSummary ? (
            <span className="font-mono text-[11px] text-text-tertiary">
              {networkSummary.name} · front {networkSummary.frontMan}
            </span>
          ) : null}
          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowManifest(true)}
              className="rounded-control border border-hairline px-3 py-1.5 text-[12px] text-text-secondary transition-[background-color,color] duration-[120ms] hover:bg-fill-1 hover:text-text-primary"
            >
              Network &amp; manifest
            </button>
            <button
              type="button"
              onClick={() => setShowSettings(true)}
              className="rounded-control border border-hairline px-3 py-1.5 text-[12px] text-text-secondary transition-[background-color,color] duration-[120ms] hover:bg-fill-1 hover:text-text-primary"
            >
              {settings.mode === 'demo' ? 'Model: demo router' : `Model: ${settings.model || 'set up'}`}
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto grid max-w-[1360px] gap-6 px-5 py-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        <section className="flex min-h-[70vh] flex-col rounded-panel border border-hairline bg-panel">
          <div className="flex-1 space-y-4 overflow-y-auto p-5">
            {transcript.length === 0 && !running ? (
              <div className="flex flex-col gap-4">
                <p className="max-w-[56ch] text-[14px] leading-relaxed text-text-secondary">
                  This network reads the lot you have open and answers from the deterministic
                  engine: yield, failing bins, parametric capability, the WM-811K spatial
                  signature, and the evidence behind each claim. Raw STDF bytes stay in the
                  Web Worker; the agents only ever see aggregate facts.
                </p>
                <div className="flex flex-wrap gap-2">
                  {SUGGESTIONS.map((suggestion) => (
                    <button
                      key={suggestion}
                      type="button"
                      onClick={() => void send(suggestion)}
                      className="rounded-pill border border-hairline px-3 py-1.5 text-left text-[12px] text-text-secondary transition-[background-color,color] duration-[120ms] hover:bg-fill-1 hover:text-text-primary"
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
                {settings.mode === 'demo' ? (
                  <p className="rounded-control border border-hairline bg-fill-1 p-3 text-[12px] leading-relaxed text-text-tertiary">
                    Running on the <strong className="text-text-secondary">deterministic demo router</strong>:
                    no model, no key. Every answer is assembled from the site tools’ own
                    summaries. Add a model and key in model settings to run the same network on
                    your own inference.
                  </p>
                ) : null}
              </div>
            ) : null}

            {transcript.map((item) => {
              if (item.kind === 'user') {
                return (
                  <div key={item.id} className="ml-auto max-w-[80%] rounded-panel border border-hairline bg-fill-2 px-4 py-2.5">
                    <p className="text-[14px] leading-relaxed text-text-primary">{item.text}</p>
                  </div>
                );
              }
              if (item.kind === 'assistant') {
                return (
                  <div key={item.id} className="max-w-[92%]">
                    <p className="mb-1 font-mono text-[10px] uppercase tracking-wide text-text-tertiary">
                      {item.peerOrigin ? `peer · ${item.peerOrigin}` : 'agent'} · {item.routerLabel}
                    </p>
                    <div className="whitespace-pre-wrap rounded-panel border border-hairline bg-surface px-4 py-3 text-[14px] leading-relaxed text-text-primary">
                      {item.text}
                    </div>
                  </div>
                );
              }
              if (item.kind === 'tool') {
                return (
                  <div key={item.id} className="flex flex-col gap-1 rounded-control border border-hairline bg-fill-1 px-3 py-2">
                    <div className="flex items-center gap-2 font-mono text-[11px]">
                      <span
                        className={cn(
                          'size-1.5 rounded-full',
                          item.status === 'running'
                            ? 'bg-text-secondary'
                            : item.status === 'ok'
                              ? 'bg-[var(--bin-ink-5)]'
                              : 'bg-[var(--bin-ink-3)]',
                        )}
                        aria-hidden="true"
                      />
                      <span className="text-text-secondary">{item.name}</span>
                      <span className="text-text-tertiary">{item.toolKind}</span>
                      <span className="ml-auto text-text-tertiary">
                        {item.status === 'running' ? 'running' : item.status}
                      </span>
                    </div>
                    {item.summary ? (
                      <p className="line-clamp-3 text-[12px] leading-relaxed text-text-tertiary">{item.summary}</p>
                    ) : null}
                  </div>
                );
              }
              if (item.kind === 'notice') {
                return (
                  <p key={item.id} className="rounded-control border border-dashed border-hairline px-3 py-2 text-[12px] text-text-tertiary">
                    {item.text}
                  </p>
                );
              }
              return (
                <div key={item.id} className="rounded-control border border-[var(--bin-ink-3)] bg-[rgba(253,117,132,0.08)] px-3 py-2">
                  <p className="font-mono text-[11px] text-[var(--bin-ink-3)]">{item.code}</p>
                  <p className="mt-1 text-[13px] leading-relaxed text-text-secondary">{item.message}</p>
                </div>
              );
            })}

            {running && streamText ? (
              <div className="max-w-[92%]">
                <p className="mb-1 font-mono text-[10px] uppercase tracking-wide text-text-tertiary">streaming</p>
                <div className="whitespace-pre-wrap rounded-panel border border-hairline bg-surface px-4 py-3 text-[14px] leading-relaxed text-text-primary">
                  {streamText}
                </div>
              </div>
            ) : null}

            {running && !streamText ? (
              <p className="font-mono text-[11px] text-text-tertiary">working…</p>
            ) : null}

            {consentRequest ? (
              <div className="rounded-panel border border-hairline-strong bg-fill-2 p-4">
                <p className="font-mono text-[10px] uppercase tracking-wide text-text-secondary">
                  {consentRequest.kind === 'action' ? `confirm ${consentRequest.effect ?? 'write'}` : 'third-party contact'}
                </p>
                <p className="mt-1 text-[14px] leading-relaxed text-text-primary">
                  {consentRequest.kind === 'action'
                    ? `Run "${consentRequest.name}" on this page?`
                    : consentRequest.kind === 'mcp'
                      ? `Contact ${consentRequest.origin} to ${consentRequest.purpose ?? 'call an MCP tool'}?`
                      : `Contact ${consentRequest.origin} to ${consentRequest.purpose ?? 'load another agent site'}?`}
                </p>
                {consentRequest.args && Object.keys(consentRequest.args).length > 0 ? (
                  <pre className="mt-2 overflow-x-auto rounded-control bg-surface p-2 font-mono text-[11px] text-text-secondary">
                    {JSON.stringify(consentRequest.args, null, 2)}
                  </pre>
                ) : null}
                <p className="mt-2 text-[12px] leading-relaxed text-text-tertiary">
                  The runtime, not the model, owns this decision. Nothing is sent before you answer.
                </p>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <Button variant="primary" size="sm" onClick={() => answerConsent(true, false)}>
                    Allow once
                  </Button>
                  {consentRequest.kind === 'action' ? (
                    <Button variant="secondary" size="sm" onClick={() => answerConsent(true, true)}>
                      Allow for this session
                    </Button>
                  ) : null}
                  <Button variant="text" size="sm" onClick={() => answerConsent(false, false)}>
                    Decline
                  </Button>
                </div>
              </div>
            ) : null}

            <div ref={transcriptEndRef} />
          </div>

          <form
            className="flex items-end gap-2 border-t border-hairline p-3"
            onSubmit={(event) => {
              event.preventDefault();
              void send(draft);
            }}
          >
            {activePeer ? (
              <span className="mb-2 inline-flex items-center gap-1 rounded-pill border border-hairline px-2 py-1 font-mono text-[10px] text-text-tertiary">
                to peer
                <button
                  type="button"
                  className="text-text-secondary hover:text-text-primary"
                  onClick={() => setActivePeer(null)}
                  aria-label="Stop sending to the peer network"
                >
                  ×
                </button>
              </span>
            ) : null}
            <label className="sr-only" htmlFor="agent-input">
              Ask the agent network
            </label>
            <textarea
              id="agent-input"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  void send(draft);
                }
              }}
              rows={2}
              placeholder={
                activePeer
                  ? `Ask ${activePeer.split('/').filter(Boolean).pop() ?? 'the peer network'}…`
                  : 'Ask about this lot — yield, bins, Cpk, the spatial signature, the evidence…'
              }
              className="min-h-[44px] flex-1 resize-none rounded-control border border-hairline bg-surface px-3 py-2 text-[14px] leading-relaxed text-text-primary placeholder:text-text-tertiary focus:outline-none focus-visible:shadow-focus-ring"
            />
            <Button type="submit" variant="primary" size="md" disabled={running || draft.trim() === ''}>
              Send
            </Button>
          </form>
        </section>

        <aside className="flex flex-col gap-4">
          <section className="rounded-panel border border-hairline bg-panel p-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-[13px] text-text-primary">Evidence stage</h2>
              {highlight.ids.size > 0 ? (
                <button
                  type="button"
                  onClick={() => setHighlight({ ids: new Set<string>() })}
                  className="text-[11px] text-text-tertiary hover:text-text-primary"
                >
                  clear
                </button>
              ) : null}
            </div>
            <WaferStage
              payload={payload}
              highlighted={highlight.ids}
              highlightLabel={highlight.label}
              waferIndex={waferIndex}
              onWaferChange={setWaferIndex}
            />
          </section>

          <section className="rounded-panel border border-hairline bg-panel p-4">
            <h2 className="mb-2 text-[13px] text-text-primary">Engine facts</h2>
            {payload ? (
              <ul className="flex flex-col gap-1.5">
                {factsPreview.map((fact) => (
                  <li key={fact.factId}>
                    <button
                      type="button"
                      onClick={() => setHighlight({ ids: new Set(fact.dieIds), label: fact.summary, factId: fact.factId })}
                      className={cn(
                        'flex w-full items-start gap-2 rounded-control px-2 py-1.5 text-left transition-[background-color] duration-[120ms] hover:bg-fill-1',
                        highlight.factId === fact.factId && 'bg-fill-2',
                      )}
                    >
                      <span className="mt-0.5 font-mono text-[10px] text-text-tertiary">{fact.factId.replace('fact:', '')}</span>
                      <span className="line-clamp-2 flex-1 text-[12px] leading-snug text-text-secondary">{fact.summary}</span>
                      <span className="font-mono text-[10px] tabular-nums text-text-tertiary">{fact.dieIndices.length}</span>
                    </button>
                  </li>
                ))}
                {facts.length > factsPreview.length ? (
                  <li className="px-2 text-[11px] text-text-tertiary">+{facts.length - factsPreview.length} more in the trace</li>
                ) : null}
              </ul>
            ) : (
              <p className="text-[12px] text-text-tertiary">Load a lot to see its facts.</p>
            )}
          </section>

          <section className="rounded-panel border border-hairline bg-panel p-4">
            <h2 className="text-[13px] text-text-primary">Other agent sites</h2>
            <p className="mt-1 text-[11px] leading-relaxed text-text-tertiary">
              Loading a peer runs its published network in this tab, on your router and this
              site’s limits. You approve each origin before anything is fetched.
            </p>
            <div className="mt-2 flex gap-2">
              <input
                value={peerUrl}
                onChange={(event) => setPeerUrl(event.target.value)}
                spellCheck={false}
                aria-label="Peer agent network URL"
                className="h-9 min-w-0 flex-1 rounded-control border border-hairline bg-surface px-2 font-mono text-[11px] text-text-primary"
              />
              <Button variant="secondary" size="sm" onClick={() => void connectPeer()}>
                Connect
              </Button>
            </div>
            {peers.length > 0 ? (
              <ul className="mt-3 flex flex-col gap-1.5">
                {peers.map((peer) => (
                  <li key={peer.url} className="flex items-center gap-2 rounded-control border border-hairline px-2 py-1.5">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-mono text-[11px] text-text-secondary">{peer.network}</span>
                      <span className="block truncate text-[10px] text-text-tertiary">{peer.origin}</span>
                    </span>
                    <button
                      type="button"
                      onClick={() => setActivePeer(activePeer === peer.url ? null : peer.url)}
                      className={cn(
                        'rounded-pill border px-2 py-1 text-[10px]',
                        activePeer === peer.url
                          ? 'border-ink text-text-primary'
                          : 'border-hairline text-text-secondary hover:text-text-primary',
                      )}
                    >
                      {activePeer === peer.url ? 'asking' : 'ask'}
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </section>

          <details className="rounded-panel border border-hairline bg-panel p-4">
            <summary className="cursor-pointer text-[13px] text-text-primary">
              Execution trace <span className="font-mono text-[10px] text-text-tertiary">{trace.length}</span>
            </summary>
            <ul className="mt-2 flex max-h-[320px] flex-col gap-1 overflow-y-auto font-mono text-[10px] text-text-tertiary">
              {trace.length === 0 ? <li>no events yet</li> : null}
              {[...trace].reverse().map((event, index) => (
                <li key={`${event.at}-${index}`} className="flex gap-2">
                  <span className="shrink-0 tabular-nums">{formatTime(event.at)}</span>
                  <span className={cn('shrink-0', event.type.includes('error') ? 'text-[var(--bin-ink-3)]' : 'text-text-secondary')}>
                    {event.type}
                  </span>
                  <span className="truncate">{eventSummary(event)}</span>
                </li>
              ))}
            </ul>
          </details>
        </aside>
      </div>

      {showSettings ? (
        <div className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-[var(--scrim)] p-4 pt-16">
          <div className="w-full max-w-[560px] rounded-panel border border-hairline bg-surface p-5">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-[16px] text-text-primary">Model &amp; key</h2>
              <button type="button" onClick={() => setShowSettings(false)} className="text-text-tertiary hover:text-text-primary" aria-label="Close">
                ×
              </button>
            </div>
            <ModelSettingsPanel
              settings={settings}
              stored={stored}
              onUpdate={update}
              onClear={clear}
              onClose={() => setShowSettings(false)}
            />
          </div>
        </div>
      ) : null}

      {showManifest ? (
        <div className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-[var(--scrim)] p-4 pt-16">
          <div className="flex w-full max-w-[720px] flex-col gap-4 rounded-panel border border-hairline bg-surface p-5">
            <div className="flex items-center justify-between">
              <h2 className="text-[16px] text-text-primary">Published network</h2>
              <button type="button" onClick={() => setShowManifest(false)} className="text-text-tertiary hover:text-text-primary" aria-label="Close">
                ×
              </button>
            </div>
            {networkSummary ? (
              <ul className="flex flex-col gap-2">
                {networkSummary.agents.map((agent) => (
                  <li key={agent.name} className="rounded-control border border-hairline p-2.5">
                    <p className="font-mono text-[12px] text-text-primary">
                      {agent.name}
                      {agent.name === networkSummary.frontMan ? ' · front agent' : ''}
                      <span className="ml-2 text-[10px] text-text-tertiary">{agent.tools} tools</span>
                    </p>
                    <p className="mt-1 text-[12px] leading-relaxed text-text-tertiary">{agent.description}</p>
                  </li>
                ))}
              </ul>
            ) : null}
            <div className="flex flex-wrap gap-3 text-[12px]">
              <a href="/agent-manifest.json" target="_blank" rel="noreferrer" className="text-text-secondary underline">
                /agent-manifest.json
              </a>
              <a href="/agents/chip_autopsy_lab.network.json" target="_blank" rel="noreferrer" className="text-text-secondary underline">
                /agents/chip_autopsy_lab.network.json
              </a>
              <a href="/agents/chip_autopsy_lab.network.hocon" target="_blank" rel="noreferrer" className="text-text-secondary underline">
                authored HOCON
              </a>
              <a href="/links.json" target="_blank" rel="noreferrer" className="text-text-secondary underline">
                /links.json
              </a>
            </div>
            <pre className="max-h-[320px] overflow-auto rounded-control border border-hairline bg-bg p-3 font-mono text-[11px] leading-relaxed text-text-secondary">
              {manifestJson || 'loading…'}
            </pre>
          </div>
        </div>
      ) : null}
    </div>
  );
}
