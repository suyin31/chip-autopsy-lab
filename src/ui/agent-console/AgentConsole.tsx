'use client';

/**
 * Agent console — the human interface to the published agent network.
 *
 * It mounts the site's runtime on `/agent-manifest.json`, registers the engine's
 * site actions, and shows what an agent is doing while it does it: which agent
 * spoke, which tool ran and with what arguments, which consent card was
 * answered, and which dies a claim actually points at. The same runtime file can
 * be loaded by any other agentic site.
 *
 * Reading order on purpose: the conversation is the page. Tool calls collapse to
 * one-line pills, the answer is unboxed prose with clickable evidence, and the
 * wafer sits in one quiet rail that never competes with the reply.
 */

import * as React from 'react';
import Link from 'next/link';
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Check,
  ChevronDown,
  Gauge,
  Globe,
  Layers,
  Loader2,
  SlidersHorizontal,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
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
import {
  AccentWord,
  Button,
  cn,
  ModalSheet,
  SegmentedControl,
} from '@/ui/primitives';
import { ThemeToggle } from '@/ui/layout/ThemeToggle';
import { createLabSiteActions, type LabBridge } from './site-actions';
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

const STARTERS = [
  {
    label: 'Load the edge-ring demo lot and diagnose it.',
    hint: 'Runs the sample lot end to end',
    icon: Layers,
  },
  {
    label: 'Why did this lot lose yield? Give me the cause of death and the evidence.',
    hint: 'Verdict, failing bins, and the dies behind them',
    icon: Activity,
  },
  {
    label: 'Which parametric test has the worst Cpk?',
    hint: 'Capability by test, from the engine',
    icon: Gauge,
  },
] as const;

const AGENT_NAMES: Record<string, string> = {
  autopsy_conductor: 'the autopsy conductor',
  lot_analyst: 'the lot analyst',
  pattern_pathologist: 'the pattern pathologist',
  evidence_auditor: 'the evidence auditor',
};

const TOOL_LABELS: Record<string, string> = {
  list_demo_lots: 'Listed demo lots',
  load_demo_lot: 'Loaded demo lot',
  get_lot_summary: 'Read lot summary',
  diagnose_lot: 'Diagnosed the lot',
  highlight_dies: 'Highlighted dies',
  set_bin_filter: 'Filtered by bin',
};

const AGENT_ROLES: Record<string, string> = {
  autopsy_conductor: 'Orchestrator',
  lot_analyst: 'Lot analyst',
  pattern_pathologist: 'Spatial',
  evidence_auditor: 'Evidence',
};

const ARG_LABELS: Record<string, string> = {
  presetId: 'Preset',
  lotId: 'Lot',
  waferIndex: 'Wafer',
  bin: 'Bin',
  preset: 'Preset',
};

const WRITE_COPY: Record<string, { title: string; body: string }> = {
  load_demo_lot: {
    title: 'Load a demo lot?',
    body:
      'The Edge-Ring Plasma Etch sample lot will replace the lot that is open in this console. It is generated and parsed in this browser — nothing leaves this device.',
  },
};

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

function titleForTool(name: string, status: 'running' | 'ok' | 'error'): string {
  const agent = AGENT_NAMES[name];
  if (agent) {
    return status === 'running' ? `Asking ${agent}…` : `Asked ${agent}`;
  }
  const base = TOOL_LABELS[name] ?? name.replace(/_/g, ' ');
  if (status === 'running') return `${base}…`;
  if (status === 'error') return `${base} — failed`;
  return base;
}

type ToolItem = Extract<TranscriptItem, { kind: 'tool' }>;

/**
 * Consecutive tool calls collapse into one trail: five bordered rows would
 * out-shout the answer they produced.
 */
function ToolTrail({
  items,
  expanded,
  onToggle,
  expandedTools,
  onToggleTool,
}: {
  readonly items: readonly ToolItem[];
  readonly expanded: boolean;
  readonly onToggle: () => void;
  readonly expandedTools: ReadonlySet<string>;
  readonly onToggleTool: (id: string) => void;
}): React.JSX.Element {
  const running = items.some((item) => item.status === 'running');
  const errored = items.some((item) => item.status === 'error');
  const last = items[items.length - 1]!;
  const label =
    items.length === 1
      ? titleForTool(last.name, last.status)
      : `${items.length} steps · ${titleForTool(last.name, last.status)}`;

  if (items.length === 1) {
    return (
      <ToolPill
        item={last}
        expanded={expandedTools.has(last.id)}
        onToggle={() => onToggleTool(last.id)}
      />
    );
  }

  return (
    <div className="flex flex-col items-start">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className={cn(
          'group inline-flex max-w-full items-center gap-2 rounded-pill bg-fill-1 py-1 pr-2.5 pl-2.5 type-subhead text-text-secondary',
          'transition-[background-color,color] duration-[120ms] ease-[var(--ease-out)]',
          'cursor-pointer hover:bg-fill-2 hover:text-text-primary',
          'focus-visible:shadow-focus-ring focus-visible:outline-none',
        )}
      >
        {running ? (
          <Loader2 className="size-3 shrink-0 animate-spin text-text-tertiary" aria-hidden="true" />
        ) : errored ? (
          <AlertTriangle className="size-3 shrink-0" aria-hidden="true" />
        ) : (
          <Check className="size-3 shrink-0 text-text-secondary" strokeWidth={2.2} aria-hidden="true" />
        )}
        <span className="min-w-0 truncate">{label}</span>
        <ChevronDown
          className={cn(
            'size-3 shrink-0 text-text-tertiary transition-[transform] duration-[160ms] ease-[var(--ease-out)]',
            expanded && 'rotate-180',
          )}
          aria-hidden="true"
        />
      </button>
      <AnimatePresence initial={false}>
        {expanded ? (
          <motion.div
            key="trail"
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
            className="mt-1.5 flex flex-col items-start gap-1.5 border-l border-hairline pl-2.5"
          >
            {items.map((item) => (
              <ToolPill
                key={item.id}
                item={item}
                expanded={expandedTools.has(item.id)}
                onToggle={() => onToggleTool(item.id)}
              />
            ))}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

/** Splits an answer into paragraphs, bullets, and inline evidence chips. */
function AnswerBody({
  text,
  onCite,
  cited,
}: {
  readonly text: string;
  readonly onCite?: (factId: string) => void;
  readonly cited?: ReadonlySet<string>;
}): React.JSX.Element {
  const blocks = React.useMemo(() => splitAnswer(text), [text]);
  return (
    <div className="flex flex-col gap-3">
      {blocks.map((block, index) =>
        block.kind === 'list' ? (
          <ul key={index} className="flex flex-col gap-1.5">
            {block.items.map((item, itemIndex) => (
              <li key={itemIndex} className="flex gap-2.5">
                <span aria-hidden="true" className="mt-[0.62em] size-1 shrink-0 rounded-full bg-text-tertiary" />
                <span className="min-w-0 flex-1">
                  <Inline text={item} {...(onCite ? { onCite } : {})} {...(cited ? { cited } : {})} />
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p key={index} className="max-w-[68ch]">
            <Inline text={block.text} {...(onCite ? { onCite } : {})} {...(cited ? { cited } : {})} />
          </p>
        ),
      )}
    </div>
  );
}

type AnswerBlock =
  | { readonly kind: 'p'; readonly text: string }
  | { readonly kind: 'list'; readonly items: string[] };

function splitAnswer(text: string): AnswerBlock[] {
  const blocks: AnswerBlock[] = [];
  for (const chunk of text.split(/\n{2,}/)) {
    const lines = chunk.split('\n').map((line) => line.trim()).filter(Boolean);
    if (lines.length === 0) continue;
    const bullets = lines.filter((line) => /^[-•*]\s+/.test(line));
    if (bullets.length === lines.length) {
      blocks.push({ kind: 'list', items: lines.map((line) => line.replace(/^[-•*]\s+/, '')) });
      continue;
    }
    // A lead sentence followed by bullets ("Findings:" then "- ...") is its own paragraph + list.
    const lead = lines.filter((line) => !/^[-•*]\s+/.test(line));
    const rest = lines.filter((line) => /^[-•*]\s+/.test(line));
    if (lead.length > 0) blocks.push({ kind: 'p', text: lead.join('\n') });
    if (rest.length > 0) {
      blocks.push({ kind: 'list', items: rest.map((line) => line.replace(/^[-•*]\s+/, '')) });
    }
  }
  return blocks;
}

function Inline({
  text,
  onCite,
  cited,
}: {
  readonly text: string;
  readonly onCite?: (factId: string) => void;
  readonly cited?: ReadonlySet<string>;
}): React.JSX.Element {
  const parts = text.split(/(\[fact:[a-z0-9:._-]+\])/gi);
  return (
    <>
      {parts.map((part, index) => {
        const match = /^\[(fact:[a-z0-9:._-]+)\]$/i.exec(part);
        if (!match) return <React.Fragment key={index}>{part}</React.Fragment>;
        const factId = match[1]!;
        const isActive = cited?.has(factId) ?? false;
        if (!onCite) {
          return (
            <span key={index} className="font-mono text-[12px] text-text-tertiary">
              {factId}
            </span>
          );
        }
        return (
          <button
            key={index}
            type="button"
            onClick={() => onCite(factId)}
            title="Show the dies behind this evidence"
            className={cn(
              'mx-0.5 inline-flex translate-y-[-1px] items-center gap-1 rounded-pill px-1.5 py-0.5 align-baseline font-mono text-[11px]',
              'transition-[background-color,color] duration-[120ms] ease-[var(--ease-out)]',
              'focus-visible:shadow-focus-ring focus-visible:outline-none',
              isActive
                ? 'agent-accent-chip'
                : 'bg-fill-1 text-text-tertiary hover:bg-fill-2 hover:text-text-secondary',
            )}
          >
            <span
              aria-hidden="true"
              className={cn('size-1 rounded-full', isActive ? 'agent-accent-dot' : 'bg-current')}
            />
            {factId.replace('fact:', '')}
          </button>
        );
      })}
    </>
  );
}

function ToolPill({
  item,
  expanded,
  onToggle,
}: {
  readonly item: ToolItem;
  readonly expanded: boolean;
  readonly onToggle: () => void;
}): React.JSX.Element {
  const hasDetail = Boolean(item.summary) || Boolean(item.toolKind);
  return (
    <div className="flex flex-col items-start">
      <button
        type="button"
        onClick={hasDetail ? onToggle : undefined}
        aria-expanded={hasDetail ? expanded : undefined}
        className={cn(
          'group inline-flex max-w-full items-center gap-2 rounded-pill bg-fill-1 py-1 pr-2.5 pl-2.5 type-subhead text-text-secondary',
          'transition-[background-color,color] duration-[120ms] ease-[var(--ease-out)]',
          'focus-visible:shadow-focus-ring focus-visible:outline-none',
          hasDetail && 'cursor-pointer hover:bg-fill-2 hover:text-text-primary',
          !hasDetail && 'cursor-default',
          item.status === 'error' && 'text-text-primary',
        )}
      >
        {item.status === 'running' ? (
          <span className="agent-accent-dot size-1.5 shrink-0 animate-pulse rounded-full" aria-hidden="true" />
        ) : item.status === 'ok' ? (
          <Check className="size-3 shrink-0 text-text-secondary" strokeWidth={2.2} aria-hidden="true" />
        ) : (
          <AlertTriangle className="size-3 shrink-0" aria-hidden="true" />
        )}
        <span className="min-w-0 truncate">{titleForTool(item.name, item.status)}</span>
        {item.summary ? (
          <span className="hidden min-w-0 max-w-[34ch] truncate type-caption text-text-tertiary sm:inline">
            {item.summary}
          </span>
        ) : null}
        {hasDetail ? (
          <ChevronDown
            className={cn(
              'size-3 shrink-0 text-text-tertiary transition-[transform] duration-[160ms] ease-[var(--ease-out)]',
              expanded && 'rotate-180',
            )}
            aria-hidden="true"
          />
        ) : null}
      </button>
      {expanded && hasDetail ? (
        <div className="mt-1 max-w-[62ch] rounded-control bg-fill-1 px-3 py-2">
          {item.toolKind ? (
            <p className="type-caption text-text-tertiary">
              {item.toolKind === 'read' ? 'Read-only tool' : `${item.toolKind} tool`} · {item.status}
            </p>
          ) : null}
          {item.summary ? (
            <p className="mt-1 type-subhead whitespace-pre-wrap text-text-secondary">{item.summary}</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
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
  const [showNetwork, setShowNetwork] = React.useState(false);
  const [peerUrl, setPeerUrl] = React.useState('https://agent-atlas-phi.vercel.app/agent_atlas');
  const [peers, setPeers] = React.useState<{ url: string; network: string; origin: string }[]>([]);
  const [activePeer, setActivePeer] = React.useState<string | null>(null);
  const [manifestJson, setManifestJson] = React.useState<string>('');
  const [railTab, setRailTab] = React.useState<'facts' | 'peers' | 'trace'>('facts');
  const [expandedTools, setExpandedTools] = React.useState<ReadonlySet<string>>(new Set());
  const [expandedTrails, setExpandedTrails] = React.useState<ReadonlySet<string>>(new Set());
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
  const scrollRef = React.useRef<HTMLDivElement | null>(null);
  const nearBottomRef = React.useRef(true);
  const inputRef = React.useRef<HTMLTextAreaElement | null>(null);
  const consentPrimaryRef = React.useRef<HTMLButtonElement | null>(null);

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
    if (event.type === 'action.call') {
      append({
        id: nextId('action'),
        kind: 'tool',
        callId: String(event.requestId ?? event.tool ?? nextId('action')),
        name: String(event.tool ?? 'action'),
        toolKind: String(event.effect ?? 'read'),
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

  // Follow the conversation only while the reader is already at the bottom.
  React.useEffect(() => {
    if (!nearBottomRef.current) return;
    transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [transcript, streamText, consentRequest]);

  const handleScroll = React.useCallback(() => {
    const node = scrollRef.current;
    if (!node) return;
    nearBottomRef.current = node.scrollHeight - node.scrollTop - node.clientHeight < 160;
  }, []);

  React.useEffect(() => {
    if (consentRequest) consentPrimaryRef.current?.focus();
  }, [consentRequest]);

  // Composer grows with its text up to six lines, then scrolls.
  React.useEffect(() => {
    const node = inputRef.current;
    if (!node) return;
    node.style.height = 'auto';
    node.style.height = `${Math.min(node.scrollHeight, 168)}px`;
  }, [draft]);

  const answerConsent = (approved: boolean, remember: boolean) => {
    if (approved && remember && consentRequest?.kind === 'action' && consentRequest.name) {
      rememberedWrites.current.add(consentRequest.name);
    }
    const resolve = consentResolver.current;
    consentResolver.current = null;
    setConsentRequest(null);
    resolve?.(approved);
    window.requestAnimationFrame(() => inputRef.current?.focus());
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
        revealCitedFact(result.text);
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
      window.requestAnimationFrame(() => inputRef.current?.focus());
    }
  };

  /**
   * The console's own reading of an answer: when the reply cites engine fact ids
   * and nothing is highlighted yet, put the dies behind the first cited fact on
   * the stage, so a claim can be checked against the wafer in one look. An
   * explicit `highlight_dies` call from an agent wins over this.
   */
  const revealCitedFact = (text: string) => {
    const loaded = payloadRef.current;
    if (!loaded || highlight.ids.size > 0) return;
    const cited = text.match(/fact:[a-z0-9:.:_-]+/gi);
    if (!cited || cited.length === 0) return;
    for (const id of cited) {
      const fact = loaded.facts.find((entry) => entry.factId === id);
      if (!fact) continue;
      setHighlight({
        ids: new Set(fact.dieIds),
        label: `Cited by the answer: ${fact.factId} — ${fact.summary}`,
        factId: fact.factId,
      });
      setWaferIndex(0);
      return;
    }
  };

  const highlightFact = (factId: string) => {
    const loaded = payloadRef.current;
    if (!loaded) return;
    const fact = loaded.facts.find((entry) => entry.factId === factId);
    if (!fact) return;
    setHighlight({
      ids: new Set(fact.dieIds),
      label: `${fact.factId} — ${fact.summary}`,
      factId: fact.factId,
    });
    setWaferIndex(0);
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
        text: `Loaded “${peer.network.name}” from ${peer.origin}. It runs in this tab, on the router above, with this site’s limits.`,
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
  const hasConversation = transcript.length > 0 || running || consentRequest !== null;
  const citedIds = React.useMemo(
    () => new Set<string>(highlight.factId ? [highlight.factId] : []),
    [highlight.factId],
  );
  const citedCount = highlight.ids.size;
  const roster = networks(settings.mode);
  function networks(_mode: string): string[] {
    const agents = networkSummary?.agents ?? [];
    if (agents.length === 0) {
      return ['Orchestrator', 'Lot analyst', 'Spatial', 'Evidence'];
    }
    return agents.map((agent) => AGENT_ROLES[agent.name] ?? agent.name.replace(/_/g, ' '));
  }
  const modelLabel = settings.mode === 'demo' ? 'Demo router' : settings.model || 'Your model';

  const renderComposer = (docked: boolean) => (
    <div
      className={
        docked
          ? 'mx-auto w-full max-w-[720px] px-4 pb-[max(16px,env(safe-area-inset-bottom))] sm:px-6 lg:pb-5'
          : 'w-full'
      }
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void send(draft);
        }}
        className="rounded-2xl bg-surface p-2 shadow-card has-[:focus-visible]:shadow-focus-ring"
      >
        <label className="sr-only" htmlFor="agent-input">
          Ask the agent network
        </label>
        <div className="flex items-end gap-2">
          <textarea
            id="agent-input"
            ref={inputRef}
            value={draft}
            rows={1}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                void send(draft);
              }
            }}
            placeholder={
              activePeer
                ? `Ask ${activePeer.split('/').filter(Boolean).pop() ?? 'the peer network'}…`
                : payload
                  ? 'Ask about this lot…'
                  : 'Ask what this lab can do…'
            }
            className={cn(
              'max-h-[168px] min-h-[40px] flex-1 resize-none bg-transparent px-2 py-2 text-[16px] leading-[1.45] text-text-primary sm:text-[15px]',
              'placeholder:text-text-tertiary focus:outline-none focus-visible:shadow-none',
            )}
          />
          <button
            type="submit"
            disabled={running || draft.trim() === ''}
            aria-label="Send"
            data-ready={!running && draft.trim() !== '' ? 'true' : undefined}
            className={cn(
              'mb-0.5 inline-flex size-9 shrink-0 items-center justify-center rounded-full pointer-coarse:size-11',
              'transition-[background-color,color,opacity,transform] duration-[160ms] ease-[var(--ease-out)]',
              'enabled:active:scale-[0.92]',
              draft.trim() !== '' && !running
                ? 'agent-accent-fill enabled:hover:opacity-90'
                : 'bg-fill-2 text-text-tertiary',
              'focus-visible:shadow-focus-ring focus-visible:outline-none',
            )}
          >
            <ArrowUp className="size-4" strokeWidth={2.2} aria-hidden="true" />
          </button>
        </div>
      </form>
      <div className="mt-2 flex items-center gap-2 px-1 max-lg:hidden">
        <p className="type-caption text-text-tertiary">
          Enter to send · Shift+Enter for a new line
        </p>
        <button
          type="button"
          onClick={() => setShowSettings(true)}
          className="ml-auto cursor-pointer rounded-sm type-caption text-text-tertiary transition-[color] duration-[120ms] ease-[var(--ease-out)] hover:text-text-primary focus-visible:shadow-focus-ring focus-visible:outline-none"
        >
          {modelLabel}
        </button>
      </div>
    </div>
  );

  return (
    <div className="flex min-h-dvh flex-col bg-bg text-text-primary">
      <header
        data-testid="agent-console-header"
        className="sticky top-0 z-[var(--z-nav)] w-full bg-material [backdrop-filter:var(--material-filter)] [-webkit-backdrop-filter:var(--material-filter)]"
      >
        <div className="mx-auto grid h-12 w-full grid-cols-[auto_1fr_auto] items-center gap-2 px-4 lg:h-[52px] lg:grid-cols-[1fr_auto_1fr] lg:px-8 xl:px-10">
          <div className="flex min-w-0 items-center justify-self-start">
            <Link
              href="/"
              className="relative inline-flex h-11 items-center gap-1.5 rounded-pill px-1 text-text-secondary no-underline transition-[color,opacity] duration-[120ms] ease-[var(--ease-out)] hover:text-text-primary focus-visible:shadow-focus-ring focus-visible:outline-none lg:h-10"
            >
              <ArrowLeft className="size-4 shrink-0" strokeWidth={1.6} aria-hidden="true" />
              <span className="max-sm:hidden type-control">Chip Autopsy Lab</span>
              <span className="sr-only sm:hidden">Chip Autopsy Lab</span>
            </Link>
            <span aria-hidden="true" className="mx-3 h-4 w-px bg-hairline" />
            <h1 className="truncate type-control text-text-primary">Agent console</h1>
          </div>

          <div className="hidden min-w-0 items-center justify-self-center lg:flex">
            {payload ? (
              <span className="inline-flex h-8 max-w-[min(420px,40vw)] items-center gap-2 rounded-pill bg-fill-2 px-3.5 type-control text-text-primary">
                <span className="font-mono-id truncate">{payload.lot.lotId}</span>
                <span className="truncate type-caption text-text-secondary">
                  {payload.lot.wafers.length} wafers
                </span>
              </span>
            ) : (
              <span className="type-subhead text-text-tertiary">No lot loaded</span>
            )}
          </div>

          <div className="flex items-center justify-self-end">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowNetwork(true)}
              aria-label="Network and manifest"
              className="max-sm:w-8 max-sm:px-0"
            >
              <Globe className="size-4" strokeWidth={1.6} aria-hidden="true" />
              <span className="max-sm:sr-only">Network</span>
            </Button>
            <ThemeToggle className="ml-1" />
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setShowSettings(true)}
              className="ml-3 max-sm:w-8 max-sm:px-0"
              aria-label={`Model: ${modelLabel}`}
            >
              <SlidersHorizontal className="size-4 sm:hidden" strokeWidth={1.6} aria-hidden="true" />
              <span className="max-sm:sr-only">{modelLabel}</span>
            </Button>
          </div>
        </div>
        <div aria-hidden="true" className="absolute inset-x-0 bottom-0 h-px bg-hairline" />
      </header>

      <div className="mx-auto grid w-full max-w-[1400px] flex-1 grid-cols-1 lg:h-[calc(100dvh-52px)] lg:min-h-0 lg:grid-cols-[minmax(0,1fr)_396px] lg:overflow-hidden">
        <section
          aria-label="Conversation"
          data-testid="agent-conversation"
          className="flex min-h-[calc(100dvh-48px)] flex-col lg:min-h-0"
        >
          <div
            ref={scrollRef}
            onScroll={handleScroll}
            className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 sm:px-6"
            aria-busy={running}
          >
            {!hasConversation ? (
              <div className="mx-auto flex min-h-full w-full max-w-[680px] flex-col justify-center py-10 sm:py-14">
                <h2 className="agent-rise type-display-l text-text-primary">
                  Ask the <AccentWord>wafer</AccentWord>.
                </h2>
                <p
                  className="agent-rise mt-3 max-w-[52ch] type-body text-text-secondary"
                  style={{ animationDelay: '60ms' }}
                >
                  The lot you have open, read back to you — yield, failing bins, parametric
                  capability, and the dies behind every claim. Raw bytes stay in this browser.
                </p>

                <div className="mt-7 grid grid-cols-1 gap-2.5 sm:gap-3">
                  {STARTERS.map((starter, index) => {
                    const Icon = starter.icon;
                    return (
                      <button
                        key={starter.label}
                        type="button"
                        onClick={() => void send(starter.label)}
                        style={{ animationDelay: `${120 + index * 60}ms` }}
                        className={cn(
                          'agent-rise group relative flex w-full cursor-pointer items-center gap-3 rounded-2xl border border-hairline bg-surface p-3.5 text-left shadow-card sm:p-4',
                          'transition-[transform,background-color] duration-[200ms] ease-[var(--ease-out)]',
                          'hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.995] motion-reduce:hover:translate-y-0 motion-reduce:active:scale-100',
                          'focus-visible:shadow-focus-ring focus-visible:outline-none',
                        )}
                      >
                        <span
                          aria-hidden="true"
                          className="pointer-events-none absolute inset-0 rounded-2xl ring-1 ring-hairline-strong opacity-0 transition-opacity duration-[160ms] ease-[var(--ease-out)] group-hover:opacity-100 group-focus-visible:opacity-100"
                        />
                        <span className="agent-accent-soft flex size-9 shrink-0 items-center justify-center rounded-xl">
                          <Icon className="size-4" strokeWidth={1.7} aria-hidden="true" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block type-callout text-text-primary">{starter.label}</span>
                          <span className="mt-0.5 block type-caption text-text-tertiary">{starter.hint}</span>
                        </span>
                        <ArrowRight
                          aria-hidden="true"
                          className="size-4 shrink-0 text-text-tertiary opacity-45 transition-[transform,opacity] duration-[200ms] ease-[var(--ease-out)] group-hover:translate-x-0.5 group-hover:opacity-100"
                          strokeWidth={1.7}
                        />
                      </button>
                    );
                  })}
                </div>

                <p
                  className="agent-rise mt-6 flex flex-wrap items-center gap-x-2 gap-y-1 type-subhead text-text-tertiary"
                  style={{ animationDelay: '340ms' }}
                >
                  {settings.mode === 'demo'
                    ? 'Running on the deterministic demo router — answers come from the engine, no model.'
                    : `Running on ${modelLabel}.`}
                  <button
                    type="button"
                    onClick={() => setShowSettings(true)}
                    className="cursor-pointer rounded-sm type-subhead text-text-secondary underline decoration-hairline-strong underline-offset-4 transition-[color] duration-[120ms] ease-[var(--ease-out)] hover:text-text-primary focus-visible:shadow-focus-ring focus-visible:outline-none"
                  >
                    {settings.mode === 'demo' ? 'Add a model' : 'Model settings'}
                  </button>
                </p>

                <div className="agent-rise mt-7" style={{ animationDelay: '300ms' }}>
                  {renderComposer(false)}
                </div>
              </div>
            ) : (
              <div className="mx-auto flex w-full max-w-[720px] flex-col gap-5 py-6">
                <div
                  data-testid="agent-live-region"
                  className="sr-only"
                  role="status"
                  aria-live="polite"
                  aria-atomic="true"
                >
                  {running ? 'Agent working' : ''}
                </div>

                {transcript.map((item, index) => {
                  if (item.kind === 'tool') {
                    const previous = transcript[index - 1];
                    if (previous?.kind === 'tool') return null;
                    const run: ToolItem[] = [];
                    for (let cursor = index; cursor < transcript.length; cursor += 1) {
                      const entry = transcript[cursor];
                      if (entry?.kind !== 'tool') break;
                      run.push(entry);
                    }
                    const trailId = run[0]?.id ?? item.id;
                    return (
                      <ToolTrail
                        key={trailId}
                        items={run}
                        expanded={expandedTrails.has(trailId)}
                        onToggle={() =>
                          setExpandedTrails((current) => {
                            const next = new Set(current);
                            if (next.has(trailId)) next.delete(trailId);
                            else next.add(trailId);
                            return next;
                          })
                        }
                        expandedTools={expandedTools}
                        onToggleTool={(id) =>
                          setExpandedTools((current) => {
                            const next = new Set(current);
                            if (next.has(id)) next.delete(id);
                            else next.add(id);
                            return next;
                          })
                        }
                      />
                    );
                  }

                  if (item.kind === 'user') {
                    return (
                      <motion.div
                        key={item.id}
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
                        className="flex justify-end"
                      >
                        <p className="max-w-[85%] rounded-2xl bg-fill-2 px-4 py-2.5 type-callout text-text-primary">
                          {item.text}
                        </p>
                      </motion.div>
                    );
                  }

                  if (item.kind === 'assistant') {
                    return (
                      <motion.article
                        key={item.id}
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
                        className="max-w-[72ch]"
                      >
                        <div className="type-body leading-[1.62] text-text-primary">
                          <AnswerBody text={item.text} onCite={highlightFact} cited={citedIds} />
                        </div>
                        <p className="mt-2.5 flex flex-wrap items-center gap-x-1.5 type-caption text-text-tertiary">
                          <span aria-hidden="true" className="agent-accent-dot size-1 rounded-full" />
                          {item.peerOrigin ? (
                            <span className="truncate">peer · {item.peerOrigin}</span>
                          ) : (
                            <span>Agent</span>
                          )}
                          <span aria-hidden="true">·</span>
                          <span className="truncate">{item.routerLabel}</span>
                        </p>
                      </motion.article>
                    );
                  }

                  if (item.kind === 'notice') {
                    return (
                      <p key={item.id} className="flex items-start gap-2 type-subhead text-text-secondary">
                        <span aria-hidden="true" className="mt-[0.55em] size-1 shrink-0 rounded-full bg-text-tertiary" />
                        <span className="min-w-0">{item.text}</span>
                      </p>
                    );
                  }

                  return (
                    <div
                      key={item.id}
                      role="alert"
                      className="flex items-start gap-2.5 rounded-control bg-fill-1 px-3 py-2.5"
                    >
                      <AlertTriangle
                        className="mt-0.5 size-4 shrink-0 text-[var(--bin-ink-3)]"
                        strokeWidth={1.8}
                        aria-hidden="true"
                      />
                      <div className="min-w-0">
                        <p className="type-caption text-[var(--bin-ink-3)]">{item.code.replace(/_/g, ' ')}</p>
                        <p className="mt-0.5 type-subhead text-text-secondary">{item.message}</p>
                      </div>
                    </div>
                  );
                })}

                {consentRequest ? (
                  <motion.div
                    role="group"
                    aria-labelledby="agent-consent-title"
                    data-testid="agent-consent-card"
                    initial={{ opacity: 0, y: 10, scale: 0.995 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
                    className="rounded-2xl bg-surface p-5 shadow-card"
                  >
                    <h2
                      id="agent-consent-title"
                      className="flex items-center gap-2 type-headline text-text-primary"
                    >
                      <span aria-hidden="true" className="agent-accent-dot size-1.5 shrink-0 rounded-full" />
                      {consentRequest.kind === 'action'
                        ? WRITE_COPY[consentRequest.name ?? '']?.title ??
                          `Run “${consentRequest.name ?? 'this action'}”?`
                        : `Contact ${consentRequest.origin ?? 'another agent site'}?`}
                    </h2>
                    <p className="mt-1.5 max-w-[58ch] type-callout text-text-secondary">
                      {consentRequest.kind === 'action'
                        ? WRITE_COPY[consentRequest.name ?? '']?.body ??
                          'This action runs here in your browser. Nothing leaves this device.'
                        : `Its published network would run in this tab, on your router and this site’s limits. Nothing is fetched before you allow it.`}
                    </p>

                    {consentRequest.args && Object.keys(consentRequest.args).length > 0 ? (
                      <dl className="mt-4 flex flex-col gap-1.5 border-t border-hairline pt-3">
                        {Object.entries(consentRequest.args).map(([key, value]) => (
                          <div key={key} className="flex items-baseline justify-between gap-4">
                            <dt className="type-subhead text-text-tertiary">{ARG_LABELS[key] ?? key}</dt>
                            <dd className="min-w-0 truncate font-mono text-[12px] text-text-primary">
                              {typeof value === 'string' ? value : JSON.stringify(value)}
                            </dd>
                          </div>
                        ))}
                      </dl>
                    ) : null}

                    <div className="mt-5 flex flex-wrap items-center gap-2">
                      <Button
                        ref={consentPrimaryRef}
                        variant="primary"
                        size="md"
                        onClick={() => answerConsent(true, false)}
                      >
                        Allow once
                      </Button>
                      {consentRequest.kind === 'action' ? (
                        <Button variant="secondary" size="md" onClick={() => answerConsent(true, true)}>
                          Allow for this session
                        </Button>
                      ) : null}
                      <Button variant="text" size="md" onClick={() => answerConsent(false, false)}>
                        Deny
                      </Button>
                      <span className="ml-auto type-caption text-text-tertiary">
                        The runtime, not the model, asks.
                      </span>
                    </div>

                    {consentRequest.args && Object.keys(consentRequest.args).length > 0 ? (
                      <details className="mt-3">
                        <summary className="cursor-pointer type-caption text-text-tertiary">
                          Inspect the exact request
                        </summary>
                        <pre className="mt-2 overflow-x-auto rounded-control bg-fill-1 p-3 font-mono text-[11px] leading-relaxed text-text-secondary">
                          {JSON.stringify(consentRequest.args, null, 2)}
                        </pre>
                      </details>
                    ) : null}
                  </motion.div>
                ) : null}

                {running ? (
                  <div className="flex items-center gap-2 type-subhead text-text-tertiary" aria-hidden="true">
                    <span className="flex gap-1">
                      <span className="size-1.5 animate-pulse rounded-full bg-text-tertiary" />
                      <span className="size-1.5 animate-pulse rounded-full bg-text-tertiary [animation-delay:120ms]" />
                      <span className="size-1.5 animate-pulse rounded-full bg-text-tertiary [animation-delay:240ms]" />
                    </span>
                    {streamText ? 'Writing…' : 'Working…'}
                  </div>
                ) : null}

                {running && streamText ? (
                  <div className="max-w-[72ch] type-body leading-[1.62] text-text-primary">
                    <AnswerBody text={streamText} />
                  </div>
                ) : null}

                <div ref={transcriptEndRef} />
              </div>
            )}
          </div>

          <div className="sticky bottom-0 z-10 bg-bg lg:static">
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-x-0 -top-6 h-6 bg-linear-to-t from-bg to-transparent"
            />
            {activePeer ? (
              <div className="mx-auto flex w-full max-w-[720px] items-center gap-2 px-6 pb-1">
                <span className="inline-flex items-center gap-1.5 rounded-pill bg-fill-1 px-2.5 py-1 type-caption text-text-secondary">
                  Asking the peer network
                  <button
                    type="button"
                    onClick={() => setActivePeer(null)}
                    aria-label="Stop sending to the peer network"
                    className="cursor-pointer rounded-sm text-text-tertiary transition-[color] duration-[120ms] hover:text-text-primary focus-visible:shadow-focus-ring focus-visible:outline-none"
                  >
                    ×
                  </button>
                </span>
              </div>
            ) : null}
            {hasConversation ? renderComposer(true) : null}
          </div>
        </section>

        <aside
          aria-label="Evidence and network"
          data-testid="agent-rail"
          className="flex flex-col border-t border-hairline lg:min-h-0 lg:overflow-hidden lg:border-t-0 lg:border-l"
        >
          <div className="px-5 pt-5 pb-4">
            <div className="flex items-baseline justify-between gap-3">
              <h2 className="type-headline text-text-primary">Evidence</h2>
              {citedCount > 0 ? (
                <button
                  type="button"
                  onClick={() => setHighlight({ ids: new Set<string>() })}
                  className="cursor-pointer rounded-sm type-caption text-text-tertiary transition-[color] duration-[120ms] ease-[var(--ease-out)] hover:text-text-primary focus-visible:shadow-focus-ring focus-visible:outline-none"
                >
                  Clear
                </button>
              ) : null}
            </div>
            <p className="mt-1 flex min-w-0 items-center gap-1.5 type-caption text-text-tertiary">
              <span
                aria-hidden="true"
                className={cn('size-1.5 shrink-0 rounded-full', running ? 'agent-accent-dot agent-live-dot' : 'bg-text-disabled')}
              />
              <span className="truncate">
                {running ? 'Agent working' : `${roster.length} specialists · ${roster.join(' · ')}`}
              </span>
            </p>
            <div className="mt-3">
              <WaferStage
                payload={payload}
                highlighted={highlight.ids}
                highlightLabel={highlight.label}
                waferIndex={waferIndex}
                onWaferChange={setWaferIndex}
                onLoadSample={() => void send('Load the edge-ring demo lot and diagnose it.')}
              />
            </div>
          </div>

          <div className="flex min-h-0 flex-1 flex-col border-t border-hairline px-5 pt-4 pb-5">
            <SegmentedControl
              ariaLabel="Evidence panels"
              size="sm"
              value={railTab}
              onValueChange={setRailTab}
              options={[
                { value: 'facts', label: `Facts${facts.length ? ` (${facts.length})` : ''}` },
                { value: 'peers', label: 'Peers' },
                { value: 'trace', label: `Trace${trace.length ? ` (${trace.length})` : ''}` },
              ]}
            />

            <div className="mt-3 min-h-0 flex-1 overflow-y-auto overscroll-contain pr-1">
              {railTab === 'facts' ? (
                payload ? (
                  <ul className="flex flex-col">
                    {factsPreview.map((fact) => (
                      <li key={fact.factId}>
                        <button
                          type="button"
                          onClick={() => highlightFact(fact.factId)}
                          aria-pressed={highlight.factId === fact.factId}
                          className={cn(
                            'flex w-full cursor-pointer items-start gap-2 rounded-control px-2.5 py-2 text-left',
                            'transition-[background-color] duration-[120ms] ease-[var(--ease-out)] hover:bg-fill-1',
                            'focus-visible:shadow-focus-ring focus-visible:outline-none',
                            highlight.factId === fact.factId && 'bg-fill-2',
                          )}
                        >
                          <span className="min-w-0 flex-1">
                            <span className="block font-mono text-[11px] text-text-tertiary">
                              {fact.factId.replace('fact:', '')}
                            </span>
                            <span className="mt-0.5 line-clamp-2 block type-subhead text-text-secondary">
                              {fact.summary}
                            </span>
                          </span>
                          <span className="mt-0.5 shrink-0 type-caption tabular-nums text-text-tertiary">
                            {fact.dieIndices.length}
                          </span>
                        </button>
                      </li>
                    ))}
                    {facts.length > factsPreview.length ? (
                      <li className="px-2.5 pt-2 type-caption text-text-tertiary">
                        {facts.length - factsPreview.length} more in the trace
                      </li>
                    ) : null}
                  </ul>
                ) : (
                  <p className="px-1 type-subhead text-text-tertiary">
                    Load a lot and its engine facts appear here. Click one to light its dies.
                  </p>
                )
              ) : null}

              {railTab === 'peers' ? (
                <div className="flex flex-col gap-3">
                  <p className="type-subhead text-text-tertiary">
                    A peer runs its published network in this tab, on your router and this site’s
                    limits. You approve the origin before anything is fetched.
                  </p>
                  <div className="flex items-center gap-2">
                    <input
                      value={peerUrl}
                      onChange={(event) => setPeerUrl(event.target.value)}
                      spellCheck={false}
                      aria-label="Peer agent network URL"
                      className="h-9 min-w-0 flex-1 rounded-control bg-fill-1 px-2.5 font-mono text-[12px] text-text-primary focus-visible:shadow-focus-ring focus-visible:outline-none"
                    />
                    <Button variant="secondary" size="sm" onClick={() => void connectPeer()}>
                      Connect
                    </Button>
                  </div>
                  {peers.length > 0 ? (
                    <ul className="flex flex-col gap-1">
                      {peers.map((peer) => (
                        <li key={peer.url} className="flex items-center gap-2 rounded-control px-2 py-1.5 hover:bg-fill-1">
                          <span className="min-w-0 flex-1">
                            <span className="block truncate type-subhead text-text-primary">{peer.network}</span>
                            <span className="block truncate type-caption text-text-tertiary">{peer.origin}</span>
                          </span>
                          <button
                            type="button"
                            onClick={() => setActivePeer(activePeer === peer.url ? null : peer.url)}
                            aria-pressed={activePeer === peer.url}
                            className="cursor-pointer rounded-pill bg-fill-2 px-2.5 py-1 type-caption text-text-secondary aria-pressed:bg-ink aria-pressed:text-on-ink focus-visible:shadow-focus-ring focus-visible:outline-none"
                          >
                            {activePeer === peer.url ? 'asking' : 'ask'}
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="type-caption text-text-tertiary">No peer loaded yet.</p>
                  )}
                </div>
              ) : null}

              {railTab === 'trace' ? (
                trace.length === 0 ? (
                  <p className="px-1 type-subhead text-text-tertiary">No events yet.</p>
                ) : (
                  <ul className="flex flex-col gap-1 font-mono text-[11px] leading-relaxed text-text-tertiary">
                    {[...trace].reverse().map((event, index) => (
                      <li key={`${event.at}-${index}`} className="flex gap-2">
                        <span className="shrink-0 tabular-nums">{formatTime(event.at)}</span>
                        <span
                          className={cn(
                            'shrink-0',
                            event.type.includes('error') ? 'text-[var(--bin-ink-3)]' : 'text-text-secondary',
                          )}
                        >
                          {event.type}
                        </span>
                        <span className="truncate">{eventSummary(event)}</span>
                      </li>
                    ))}
                  </ul>
                )
              ) : null}
            </div>
          </div>
        </aside>
      </div>

      <ModalSheet
        open={showSettings}
        onClose={() => setShowSettings(false)}
        titleId="agent-model-title"
        closeLabel="Close"
        size="wide"
        data-testid="agent-model-sheet"
      >
        <div className="flex flex-col gap-5">
          <div>
            <h2 id="agent-model-title" className="type-title-2 text-text-primary">
              Model &amp; key
            </h2>
            <p className="mt-1 type-subhead text-text-tertiary">
              This site pays for no inference. Pick the deterministic demo router, or bring your own
              OpenAI-compatible router.
            </p>
          </div>
          <ModelSettingsPanel
            settings={settings}
            stored={stored}
            onUpdate={update}
            onClear={clear}
            onClose={() => setShowSettings(false)}
          />
        </div>
      </ModalSheet>

      <ModalSheet
        open={showNetwork}
        onClose={() => setShowNetwork(false)}
        titleId="agent-network-title"
        closeLabel="Close"
        size="wide"
        data-testid="agent-network-sheet"
      >
        <div className="flex flex-col gap-5">
          <div>
            <h2 id="agent-network-title" className="type-title-2 text-text-primary">
              Published network
            </h2>
            <p className="mt-1 type-subhead text-text-tertiary">
              {networkSummary
                ? `${networkSummary.name} · front agent ${networkSummary.frontMan}`
                : 'Reading the manifest…'}
            </p>
            <p className="mt-1 type-caption text-text-tertiary">Cognizant Agentic Web · MVP Profile 0.3</p>
          </div>

          {networkSummary ? (
            <ul className="flex flex-col">
              {networkSummary.agents.map((agent) => (
                <li key={agent.name} className="border-t border-hairline py-3 first:border-t-0 first:pt-0">
                  <p className="flex items-baseline gap-2">
                    <span className="font-mono text-[13px] text-text-primary">{agent.name}</span>
                    {agent.name === networkSummary.frontMan ? (
                      <span className="rounded-pill bg-fill-2 px-2 py-0.5 type-caption text-text-secondary">
                        front agent
                      </span>
                    ) : null}
                    <span className="ml-auto type-caption tabular-nums text-text-tertiary">
                      {agent.tools} tools
                    </span>
                  </p>
                  <p className="mt-1 type-subhead text-text-secondary">{agent.description}</p>
                </li>
              ))}
            </ul>
          ) : null}

          <div className="flex flex-wrap gap-x-4 gap-y-1.5">
            {[
              { href: '/agent-manifest.json', label: 'agent-manifest.json' },
              { href: '/agents/chip_autopsy_lab.network.json', label: 'network.json' },
              { href: '/agents/chip_autopsy_lab.network.hocon', label: 'authored HOCON' },
              { href: '/links.json', label: 'links.json' },
            ].map((link) => (
              <a
                key={link.href}
                href={link.href}
                target="_blank"
                rel="noreferrer"
                className="rounded-sm type-subhead text-text-secondary underline decoration-hairline-strong underline-offset-4 transition-[color] duration-[120ms] ease-[var(--ease-out)] hover:text-text-primary focus-visible:shadow-focus-ring focus-visible:outline-none"
              >
                {link.label}
              </a>
            ))}
          </div>

          <details>
            <summary className="cursor-pointer type-caption text-text-tertiary">Raw manifest</summary>
            <pre className="mt-2 max-h-[320px] overflow-auto rounded-control bg-fill-1 p-3 font-mono text-[11px] leading-relaxed text-text-secondary">
              {manifestJson || 'Loading…'}
            </pre>
          </details>
        </div>
      </ModalSheet>
    </div>
  );
}
