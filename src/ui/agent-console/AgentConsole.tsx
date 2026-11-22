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

import { useT, type BoundTranslateFn } from '@/ui/i18n';
import * as React from 'react';
import Link from 'next/link';
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ChevronDown,
  Gauge,
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
  computeStaggerDelayMs,
  MOTION_TOKENS,
  PANEL_ENTER_OFFSET_Y_PX,
  SPRING_TOKENS,
  useReducedMotionPreference,
} from '@/ui/motion';
import {
  AnimatedCheckmark,
  Button,
  cn,
  CopyButton,
  ModalSheet,
  renderAccentPhrase,
  SegmentedControl,
} from '@/ui/primitives';
import { isCjkLocale, type MessageKey } from '@/core/i18n';
import { LanguageSwitcher } from '@/ui/layout/LanguageSwitcher';
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
    prompt: 'Load the edge-ring demo lot and diagnose it.',
    labelKey: 'agents.starter1.label',
    hintKey: 'agents.starter1.hint',
    icon: Layers,
  },
  {
    prompt: 'Why did this lot lose yield? Give me the cause of death and the evidence.',
    labelKey: 'agents.starter2.label',
    hintKey: 'agents.starter2.hint',
    icon: Activity,
  },
  {
    prompt: 'Which parametric test has the worst Cpk?',
    labelKey: 'agents.starter3.label',
    hintKey: 'agents.starter3.hint',
    icon: Gauge,
  },
] as const;

const AGENT_NAMES: Record<string, Extract<MessageKey, `agents.agent.${string}`>> = {
  autopsy_conductor: 'agents.agent.autopsy_conductor',
  lot_analyst: 'agents.agent.lot_analyst',
  pattern_pathologist: 'agents.agent.pattern_pathologist',
  evidence_auditor: 'agents.agent.evidence_auditor',
};

const TOOL_LABELS: Record<string, Extract<MessageKey, `agents.tool.${string}`>> = {
  list_demo_lots: 'agents.tool.list_demo_lots',
  load_demo_lot: 'agents.tool.load_demo_lot',
  get_lot_summary: 'agents.tool.get_lot_summary',
  diagnose_lot: 'agents.tool.diagnose_lot',
  highlight_dies: 'agents.tool.highlight_dies',
  set_bin_filter: 'agents.tool.set_bin_filter',
};

const AGENT_ROLES: Record<string, Extract<MessageKey, `agents.role.${string}`>> = {
  autopsy_conductor: 'agents.role.autopsy_conductor',
  lot_analyst: 'agents.role.lot_analyst',
  pattern_pathologist: 'agents.role.pattern_pathologist',
  evidence_auditor: 'agents.role.evidence_auditor',
};

const ARG_LABELS: Record<string, Extract<MessageKey, `agents.args.${string}`>> = {
  presetId: 'agents.args.presetId',
  lotId: 'agents.args.lotId',
  waferIndex: 'agents.args.waferIndex',
  bin: 'agents.args.bin',
  preset: 'agents.args.preset',
};

function formatTime(iso: string, locale: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? iso
    : date.toLocaleTimeString(locale, { hour12: false, minute: '2-digit', second: '2-digit' });
}

function eventSummary(event: TraceEvent): string {
  const parts: string[] = [];
  for (const key of ['agent', 'to', 'tool', 'kind', 'step', 'depth', 'network', 'origin', 'code', 'approved', 'router', 'model', 'ms']) {
    const value = event[key];
    if (value !== undefined && value !== null && value !== '') parts.push(`${key}=${String(value)}`);
  }
  return parts.join(' · ');
}

function titleForTool(t: BoundTranslateFn, name: string, status: 'running' | 'ok' | 'error'): string {
  const agent = AGENT_NAMES[name];
  if (agent) {
    return status === 'running' ? t('agents.trail.asking', { agent: t(agent) }) : t('agents.trail.asked', { agent: t(agent) });
  }
  const base = TOOL_LABELS[name] ? t(TOOL_LABELS[name]) : name.replace(/_/g, ' ');
  if (status === 'running') return t('agents.trail.inProgress', { tool: base });
  if (status === 'error') return t('agents.trail.failed', { tool: base });
  return base;
}

type ToolItem = Extract<TranscriptItem, { kind: 'tool' }>;
type TraceEntry = { readonly id: string; readonly event: TraceEvent };

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
  reducedMotion,
}: {
  readonly items: readonly ToolItem[];
  readonly expanded: boolean;
  readonly onToggle: () => void;
  readonly expandedTools: ReadonlySet<string>;
  readonly onToggleTool: (id: string) => void;
  readonly reducedMotion: boolean;
}): React.JSX.Element {
  const { t, formatInteger } = useT();
  const running = items.some((item) => item.status === 'running');
  const errored = items.some((item) => item.status === 'error');
  const trailStatus: ToolItem['status'] = running ? 'running' : errored ? 'error' : 'ok';
  const [prevTrailStatus, setPrevTrailStatus] = React.useState<ToolItem['status']>(trailStatus);
  const [animateTrailCheck, setAnimateTrailCheck] = React.useState(false);
  if (prevTrailStatus !== trailStatus) {
    setPrevTrailStatus(trailStatus);
    if (prevTrailStatus === 'running' && trailStatus === 'ok') {
      setAnimateTrailCheck(true);
    }
  }

  const last = items[items.length - 1]!;
  const label =
    items.length === 1
      ? titleForTool(t, last.name, last.status)
      : t('agents.trail.steps', { count: formatInteger(items.length), tool: titleForTool(t, last.name, last.status) });

  if (items.length === 1) {
    return (
      <ToolPill
        item={last}
        expanded={expandedTools.has(last.id)}
        onToggle={() => onToggleTool(last.id)}
      />
    );
  }

  const staggerWindowMs = Math.min(210, Math.max(0, (items.length - 1) * 35));

  return (
    <div className="flex flex-col items-start">
      <button
        type="button"
        onClick={onToggle}
        aria-label={t(expanded ? 'agents.trail.collapse' : 'agents.trail.expand', { label })}
        aria-expanded={expanded}
        className={cn(
          'group inline-flex max-w-full cursor-pointer touch-manipulation items-center gap-2 rounded-pill bg-fill-1 py-1 pr-2.5 pl-2.5 type-subhead text-text-secondary',
          'transition-[background-color,color,scale,transform] duration-[120ms] ease-[var(--ease-out)]',
          '[@media(hover:hover)]:hover:bg-fill-2 [@media(hover:hover)]:hover:text-text-primary',
          'active:scale-[0.97] motion-reduce:active:scale-100',
          'focus-visible:shadow-focus-ring focus-visible:outline-none',
        )}
      >
        <span className="inline-flex size-3.5 shrink-0 items-center justify-center" aria-hidden="true">
          {running ? (
            <Loader2 className="size-3 animate-spin text-text-tertiary motion-reduce:animate-none" />
          ) : errored ? (
            <AlertTriangle className="size-3" />
          ) : (
            <AnimatedCheckmark animate={animateTrailCheck} className="size-3.5 text-text-secondary" />
          )}
        </span>
        <span className="min-w-0 truncate">{label}</span>
        <ChevronDown
          className={cn(
            'size-3 shrink-0 text-text-tertiary transition-[transform,rotate] duration-[160ms] ease-[var(--ease-out)]',
            expanded && 'rotate-180',
          )}
          aria-hidden="true"
        />
      </button>
      <AnimatePresence initial={false}>
        {expanded ? (
          <motion.div
            key="trail"
            initial={reducedMotion ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{
              duration: reducedMotion ? 0 : MOTION_TOKENS.dur1Ms / 1000,
              ease: MOTION_TOKENS.easeOutTuple,
            }}
            className="mt-1.5 flex flex-col items-start gap-1.5 border-l border-hairline pl-2.5"
          >
            {items.map((item, idx) => (
              <motion.div
                key={item.id}
                initial={reducedMotion ? false : { opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={
                  reducedMotion
                    ? { duration: 0 }
                    : {
                        duration: 0.2,
                        ease: MOTION_TOKENS.easeOutTuple,
                        delay:
                          computeStaggerDelayMs(idx, items.length, staggerWindowMs, reducedMotion) /
                          1000,
                      }
                }
              >
                <ToolPill
                  item={item}
                  expanded={expandedTools.has(item.id)}
                  onToggle={() => onToggleTool(item.id)}
                />
              </motion.div>
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
  const { t } = useT();
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
            title={t('agents.rail.showDies')}
            className={cn(
              'mx-0.5 inline-flex translate-y-[-1px] cursor-pointer touch-manipulation items-center gap-1 rounded-pill px-1.5 py-0.5 align-baseline font-mono text-[11px]',
              'transition-[background-color,color,scale,transform] duration-[120ms] ease-[var(--ease-out)]',
              'active:scale-[0.97] motion-reduce:active:scale-100',
              'focus-visible:shadow-focus-ring focus-visible:outline-none',
              isActive
                ? 'agent-accent-chip'
                : 'bg-fill-1 text-text-tertiary [@media(hover:hover)]:hover:bg-fill-2 [@media(hover:hover)]:hover:text-text-secondary',
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
  const { t } = useT();
  const hasDetail = Boolean(item.summary) || Boolean(item.toolKind);
  const [prevStatus, setPrevStatus] = React.useState<ToolItem['status']>(item.status);
  const [animateCheck, setAnimateCheck] = React.useState(false);
  if (prevStatus !== item.status) {
    setPrevStatus(item.status);
    if (prevStatus === 'running' && item.status === 'ok') {
      setAnimateCheck(true);
    }
  }

  return (
    <div className="flex flex-col items-start">
      <button
        type="button"
        onClick={hasDetail ? onToggle : undefined}
        aria-expanded={hasDetail ? expanded : undefined}
        className={cn(
          'group inline-flex max-w-full touch-manipulation items-center gap-2 rounded-pill bg-fill-1 py-1 pr-2.5 pl-2.5 type-subhead text-text-secondary',
          'transition-[background-color,color,scale,transform] duration-[120ms] ease-[var(--ease-out)]',
          'focus-visible:shadow-focus-ring focus-visible:outline-none',
          hasDetail &&
            'cursor-pointer [@media(hover:hover)]:hover:bg-fill-2 [@media(hover:hover)]:hover:text-text-primary active:scale-[0.97] motion-reduce:active:scale-100',
          !hasDetail && 'cursor-default',
          item.status === 'error' && 'text-text-primary',
        )}
      >
        <span className="inline-flex size-3.5 shrink-0 items-center justify-center" aria-hidden="true">
          {item.status === 'running' ? (
            <span className="agent-accent-dot size-1.5 animate-pulse rounded-full motion-reduce:animate-none" />
          ) : item.status === 'ok' ? (
            <AnimatedCheckmark animate={animateCheck} className="size-3.5 text-text-secondary" />
          ) : (
            <AlertTriangle className="size-3" />
          )}
        </span>
        <span className="min-w-0 truncate">{titleForTool(t, item.name, item.status)}</span>
        {item.summary ? (
          <span className="hidden min-w-0 max-w-[34ch] truncate type-caption text-text-tertiary sm:inline">
            {item.summary}
          </span>
        ) : null}
        {hasDetail ? (
          <ChevronDown
            className={cn(
              'size-3 shrink-0 text-text-tertiary transition-[transform,rotate] duration-[160ms] ease-[var(--ease-out)]',
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
              {item.toolKind === 'read' ? t('agents.trail.readOnly') : t('agents.trail.kind', { kind: item.toolKind })} · {t(`agents.trail.${item.status}`)}
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

type NetworkTopologyIconProps = React.SVGProps<SVGSVGElement> & {
  strokeWidth?: number | string;
};

/**
 * Network topology glyph for the header "Network" trigger: one front node over two
 * member nodes, at the same 16 px size and 1.5 px stroke as the neighbouring
 * controls. It replaces a second globe that sat directly beside the language one.
 */
function NetworkTopologyIcon({ strokeWidth = 1.5, ...props }: NetworkTopologyIconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <circle cx={12} cy={5.5} r={2.4} />
      <circle cx={5.5} cy={18.5} r={2.2} />
      <circle cx={18.5} cy={18.5} r={2.2} />
      <path d="M12 7.9v4.1" />
      <path d="M12 12H5.5v4.3" />
      <path d="M12 12h6.5v4.3" />
    </svg>
  );
}

export function AgentConsole() {
  const { locale, t, formatInteger } = useT();
  const reducedMotion = useReducedMotionPreference();
  const [payload, setPayload] = React.useState<AutopsyWorkerLoadedPayload | null>(null);
  const payloadRef = React.useRef<AutopsyWorkerLoadedPayload | null>(null);
  const workerRef = React.useRef<AutopsyWorkerClient | null>(null);

  const [transcript, setTranscript] = React.useState<TranscriptItem[]>([]);
  const [draft, setDraft] = React.useState('');
  const [running, setRunning] = React.useState(false);
  const [streamText, setStreamText] = React.useState('');
  const [trace, setTrace] = React.useState<TraceEntry[]>([]);
  const [seenFactsLots, setSeenFactsLots] = React.useState<ReadonlySet<string>>(() => new Set());
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

  const translator = React.useRef(t);
  React.useEffect(() => { translator.current = t; }, [t]);

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
              ? translator.current('agents.wafer.parserError', { message: response.error.message, code: response.error.code })
              : translator.current('agents.wafer.loadError'),
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
    setTrace((current) => [...current.slice(-199), { id: nextId('trace'), event }]);
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

  const send = async (text: string, displayedText?: string) => {
    const trimmed = text.trim();
    const runtime = runtimeRef.current;
    if (!trimmed || running || !runtime) return;
    setDraft('');
    append({ id: nextId('user'), kind: 'user', text: displayedText ?? trimmed });
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
        label: t('agents.wafer.citedBy', { id: fact.factId, summary: fact.summary }),
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
        text: t('agents.rail.loaded', { name: peer.network.name, origin: peer.origin }),
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
  const activeLotId = payload?.lot.lotId ?? null;
  const shouldAnimateFacts =
    !reducedMotion && activeLotId !== null && !seenFactsLots.has(activeLotId);

  React.useEffect(() => {
    if (railTab !== 'facts' || !activeLotId) return;
    setSeenFactsLots((current) => {
      if (current.has(activeLotId)) return current;
      const next = new Set(current);
      next.add(activeLotId);
      return next;
    });
  }, [railTab, activeLotId]);

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
      return Object.values(AGENT_ROLES).map((key) => t(key));
    }
    return agents.map((agent) => AGENT_ROLES[agent.name] ? t(AGENT_ROLES[agent.name]) : agent.name.replace(/_/g, ' '));
  }
  const modelLabel = settings.mode === 'demo' ? t('agents.model.demo') : settings.model || t('agents.model.yourModel');

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
          {t('agents.composerLabel')}
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
                ? t('agents.composerPeer', { peer: activePeer.split('/').filter(Boolean).pop() ?? t('agents.rail.peerNetwork') })
                : payload
                  ? t('agents.composerLot')
                  : t('agents.composerPlaceholder')
            }
            className={cn(
              'max-h-[168px] min-h-[40px] flex-1 resize-none bg-transparent px-2 py-2 text-[16px] leading-[1.45] text-text-primary sm:text-[15px]',
              'placeholder:text-text-tertiary focus:outline-none focus-visible:shadow-none',
            )}
          />
          <button
            type="submit"
            disabled={running || draft.trim() === ''}
            aria-label={t('agents.composerSend')}
            data-ready={!running && draft.trim() !== '' ? 'true' : undefined}
            className={cn(
              'mb-0.5 inline-flex size-9 shrink-0 touch-manipulation items-center justify-center rounded-full pointer-coarse:size-11',
              'transition-[background-color,color,opacity,scale,transform] duration-[160ms] ease-[var(--ease-out)]',
              'enabled:active:scale-[0.92] motion-reduce:enabled:active:scale-100',
              draft.trim() !== '' && !running
                ? 'agent-accent-fill [@media(hover:hover)]:enabled:hover:opacity-90'
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
          {t('agents.composerHint')}
        </p>
        <button
          type="button"
          onClick={() => setShowSettings(true)}
          className="ml-auto cursor-pointer touch-manipulation rounded-sm type-caption text-text-tertiary transition-[color,scale,transform] duration-[120ms] ease-[var(--ease-out)] [@media(hover:hover)]:hover:text-text-primary active:scale-[0.97] motion-reduce:active:scale-100 focus-visible:shadow-focus-ring focus-visible:outline-none"
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
        className="sticky top-0 z-[var(--z-nav)] w-full bg-material max-lg:bg-bg [backdrop-filter:var(--material-filter)] [-webkit-backdrop-filter:var(--material-filter)]"
      >
        <div className="mx-auto grid h-12 w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-2 px-4 lg:h-[52px] lg:grid-cols-[1fr_auto_1fr] lg:px-8 xl:px-10">
          <div className="flex min-w-0 items-center">
            <Link
              href="/"
              aria-label={t('agents.back')}
              className="relative inline-flex h-11 items-center gap-1.5 rounded-pill px-1 text-text-secondary no-underline transition-[color,opacity] duration-[120ms] ease-[var(--ease-out)] hover:text-text-primary focus-visible:shadow-focus-ring focus-visible:outline-none lg:h-10"
            >
              <ArrowLeft className="size-4 shrink-0" strokeWidth={1.6} aria-hidden="true" />
              <span className="max-sm:hidden type-control">{t('nav.wordmark')}</span>
              <span className="sr-only sm:hidden">{t('nav.wordmark')}</span>
            </Link>
            <span aria-hidden="true" className="mx-3 h-4 w-px bg-hairline" />
            <h1 className="truncate type-control text-text-primary">{t('agents.title')}</h1>
          </div>

          <div className="hidden min-w-0 items-center justify-self-center lg:flex">
            {payload ? (
              <span className="inline-flex h-8 max-w-[min(420px,40vw)] items-center gap-2 rounded-pill bg-fill-2 px-3.5 type-control text-text-primary">
                <span className="font-mono-id truncate">{payload.lot.lotId}</span>
                <span className="truncate type-caption text-text-secondary">
                  {t('agents.wafers', { count: formatInteger(payload.lot.wafers.length) })}
                </span>
              </span>
            ) : (
              <span className="type-subhead text-text-tertiary">{t('agents.noLot')}</span>
            )}
          </div>

          <div className="flex shrink-0 flex-nowrap items-center justify-self-end">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowNetwork(true)}
              aria-label={t('agents.networkAria')}
              className="max-sm:w-8 max-sm:px-0"
            >
              <NetworkTopologyIcon className="size-4" strokeWidth={1.5} aria-hidden="true" />
              <span className="max-sm:sr-only">{t('agents.network.label')}</span>
            </Button>
            <LanguageSwitcher includeAppearance />
            <ThemeToggle className="ml-1" />
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setShowSettings(true)}
              className="ml-3 max-sm:w-8 max-sm:px-0"
              aria-label={t('agents.modelAria', { model: modelLabel })}
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
          aria-label={t('agents.conversation')}
          data-testid="agent-conversation"
          className="flex min-h-[calc(100dvh-48px)] flex-col lg:min-h-0"
        >
          <div
            ref={scrollRef}
            onScroll={handleScroll}
            className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 sm:px-6"
            aria-busy={running}
          >
            <AnimatePresence mode="wait" initial={false}>
              {!hasConversation ? (
                <motion.div
                  key="empty"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{
                    duration: MOTION_TOKENS.dur1Ms / 1000,
                    ease: MOTION_TOKENS.easeOutTuple,
                  }}
                  className="mx-auto flex min-h-full w-full max-w-[680px] flex-col justify-center py-10 sm:py-14"
                >
                  <h2 className="agent-rise type-display-l text-text-primary">
                    {renderAccentPhrase(t('agents.empty.headline'), t('agents.empty.headlineAccent'), !isCjkLocale(locale))}
                  </h2>
                  <p
                    className="agent-rise mt-3 max-w-[52ch] type-body text-text-secondary"
                    style={{ animationDelay: '60ms' }}
                  >
                    {t('agents.empty.subline')}
                  </p>

                  <div className="mt-7 grid grid-cols-1 gap-2.5 sm:gap-3">
                    {STARTERS.map((starter, index) => {
                      const Icon = starter.icon;
                      return (
                        <button
                          key={starter.prompt}
                          type="button"
                          onClick={() => void send(starter.prompt, t(starter.labelKey))}
                          style={{ animationDelay: `${120 + index * 60}ms` }}
                          className={cn(
                            'agent-rise group relative flex w-full cursor-pointer touch-manipulation items-center gap-3 rounded-2xl border border-hairline bg-surface p-3.5 text-left shadow-card sm:p-4',
                            'transition-[transform,translate,scale,background-color] duration-[200ms] ease-[var(--ease-out)]',
                            '[@media(hover:hover)]:motion-safe:hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.985] motion-reduce:hover:translate-y-0 motion-reduce:active:scale-100',
                            'focus-visible:shadow-focus-ring focus-visible:outline-none',
                          )}
                        >
                          <span
                            aria-hidden="true"
                            className="pointer-events-none absolute inset-0 rounded-2xl ring-1 ring-hairline-strong opacity-0 transition-opacity duration-[160ms] ease-[var(--ease-out)] [@media(hover:hover)]:group-hover:opacity-100 group-focus-visible:opacity-100"
                          />
                          <span className="agent-accent-soft flex size-9 shrink-0 items-center justify-center rounded-xl">
                            <Icon className="size-4" strokeWidth={1.7} aria-hidden="true" />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block type-callout text-text-primary">{t(starter.labelKey)}</span>
                            <span className="mt-0.5 block type-caption text-text-tertiary">{t(starter.hintKey)}</span>
                          </span>
                          <ArrowRight
                            aria-hidden="true"
                            className="size-4 shrink-0 text-text-tertiary opacity-45 transition-[transform,translate,opacity] duration-[200ms] ease-[var(--ease-out)] [@media(hover:hover)]:motion-safe:group-hover:translate-x-0.5 [@media(hover:hover)]:group-hover:opacity-100"
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
                      ? t('agents.router.demo')
                      : t('agents.router.model', { model: modelLabel })}
                    <button
                      type="button"
                      onClick={() => setShowSettings(true)}
                      className="cursor-pointer touch-manipulation rounded-sm type-subhead text-text-secondary underline decoration-hairline-strong underline-offset-4 transition-[color,scale,transform] duration-[120ms] ease-[var(--ease-out)] [@media(hover:hover)]:hover:text-text-primary active:scale-[0.97] motion-reduce:active:scale-100 focus-visible:shadow-focus-ring focus-visible:outline-none"
                    >
                      {settings.mode === 'demo' ? t('agents.addModel') : t('agents.modelSettings')}
                    </button>
                  </p>

                  <div className="agent-rise mt-7" style={{ animationDelay: '300ms' }}>
                    {renderComposer(false)}
                  </div>
                </motion.div>
              ) : (
                <motion.div
                  key="active"
                  initial={reducedMotion ? { opacity: 0, y: 0 } : { opacity: 0, y: PANEL_ENTER_OFFSET_Y_PX }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{
                    opacity: 0,
                    transition: {
                      duration: MOTION_TOKENS.dur1Ms / 1000,
                      ease: MOTION_TOKENS.easeOutTuple,
                    },
                  }}
                  transition={
                    reducedMotion
                      ? { duration: MOTION_TOKENS.dur1Ms / 1000, ease: MOTION_TOKENS.easeOutTuple }
                      : SPRING_TOKENS.ui
                  }
                  className="mx-auto flex min-h-full w-full max-w-[720px] flex-col gap-5 py-6"
                >
                  <div
                    data-testid="agent-live-region"
                    className="sr-only"
                    role="status"
                    aria-live="polite"
                    aria-atomic="true"
                  >
                    {running ? t('agents.agentWorking') : ''}
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
                          reducedMotion={reducedMotion}
                        />
                      );
                    }

                    if (item.kind === 'user') {
                      return (
                        <motion.div
                          key={item.id}
                          initial={reducedMotion ? { opacity: 0, y: 0 } : { opacity: 0, y: PANEL_ENTER_OFFSET_Y_PX }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={
                            reducedMotion
                              ? { duration: MOTION_TOKENS.dur1Ms / 1000, ease: MOTION_TOKENS.easeOutTuple }
                              : { duration: 0.28, ease: MOTION_TOKENS.easeOutTuple }
                          }
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
                          initial={reducedMotion ? { opacity: 0, y: 0 } : { opacity: 0, y: PANEL_ENTER_OFFSET_Y_PX }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={
                            reducedMotion
                              ? { duration: MOTION_TOKENS.dur1Ms / 1000, ease: MOTION_TOKENS.easeOutTuple }
                              : { duration: 0.32, ease: MOTION_TOKENS.easeOutTuple }
                          }
                          className="group/answer max-w-[72ch]"
                        >
                          <div className="type-body leading-[1.62] text-text-primary">
                            <AnswerBody text={item.text} onCite={highlightFact} cited={citedIds} />
                          </div>
                          <div className="mt-2.5 flex flex-wrap items-center gap-x-1.5 gap-y-1 type-caption text-text-tertiary">
                            <span aria-hidden="true" className="agent-accent-dot size-1 rounded-full" />
                            {item.peerOrigin ? (
                              <span className="truncate">{t('agents.peer')} · {item.peerOrigin}</span>
                            ) : (
                              <span>{t('agents.answer.agent')}</span>
                            )}
                            <span aria-hidden="true">·</span>
                            <span className="truncate">{item.routerLabel}</span>
                            <CopyButton
                              value={item.text}
                              label={t('error.copyDetails')}
                              copiedLabel={t('error.copied')}
                              data-testid="agent-answer-copy"
                              className={cn(
                                'ml-auto type-caption text-text-tertiary',
                                '[@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover/answer:opacity-100',
                                '[@media(hover:hover)]:group-focus-within/answer:opacity-100 [@media(hover:hover)]:focus-visible:opacity-100',
                              )}
                            />
                          </div>
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
                      initial={reducedMotion ? { opacity: 0, y: 0, scale: 1 } : { opacity: 0, y: 10, scale: 0.995 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      transition={
                        reducedMotion
                          ? { duration: MOTION_TOKENS.dur1Ms / 1000, ease: MOTION_TOKENS.easeOutTuple }
                          : { duration: 0.3, ease: MOTION_TOKENS.easeOutTuple }
                      }
                      className="rounded-2xl bg-surface p-5 shadow-card"
                    >
                      <h2
                        id="agent-consent-title"
                        className="flex items-center gap-2 type-headline text-text-primary"
                      >
                        <span aria-hidden="true" className="agent-accent-dot size-1.5 shrink-0 rounded-full" />
                        {consentRequest.kind === 'action'
                          ? consentRequest.name === 'load_demo_lot' ? t('agents.consent.loadTitle') :
                            t('agents.consent.actionTitle', { action: consentRequest.name ?? t('agents.consent.action') })
                          : t('agents.consent.peerTitle', { origin: consentRequest.origin ?? t('agents.consent.peerSite') })}
                      </h2>
                      <p className="mt-1.5 max-w-[58ch] type-callout text-text-secondary">
                        {consentRequest.kind === 'action'
                          ? consentRequest.name === 'load_demo_lot' ? t('agents.consent.loadBody') :
                            t('agents.consent.actionBody')
                          : t('agents.consent.peerBody')}
                      </p>

                      {consentRequest.args && Object.keys(consentRequest.args).length > 0 ? (
                        <dl className="mt-4 flex flex-col gap-1.5 border-t border-hairline pt-3">
                          {Object.entries(consentRequest.args).map(([key, value]) => (
                            <div key={key} className="flex items-baseline justify-between gap-4">
                              <dt className="type-subhead text-text-tertiary">{ARG_LABELS[key] ? t(ARG_LABELS[key]) : key}</dt>
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
                          {t('agents.consent.once')}
                        </Button>
                        {consentRequest.kind === 'action' ? (
                          <Button variant="secondary" size="md" onClick={() => answerConsent(true, true)}>
                            {t('agents.consent.session')}
                          </Button>
                        ) : null}
                        <Button variant="text" size="md" onClick={() => answerConsent(false, false)}>
                          {t('agents.consent.deny')}
                        </Button>
                        <span className="ml-auto type-caption text-text-tertiary">
                          {t('agents.consent.runtime')}
                        </span>
                      </div>

                      {consentRequest.args && Object.keys(consentRequest.args).length > 0 ? (
                        <details className="mt-3">
                          <summary className="cursor-pointer type-caption text-text-tertiary">
                            {t('agents.consent.inspect')}
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
                      <span className="flex items-center gap-1">
                        <span className="agent-typing-dot size-1.5 rounded-full bg-text-tertiary" />
                        <span className="agent-typing-dot size-1.5 rounded-full bg-text-tertiary" />
                        <span className="agent-typing-dot size-1.5 rounded-full bg-text-tertiary" />
                      </span>
                      {streamText ? t('agents.writing') : t('agents.working')}
                    </div>
                  ) : null}

                  {running && streamText ? (
                    <div className="max-w-[72ch] type-body leading-[1.62] text-text-primary">
                      <AnswerBody text={streamText} />
                    </div>
                  ) : null}

                  <div ref={transcriptEndRef} />
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <div className="sticky bottom-0 z-10 bg-bg lg:static">
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-x-0 -top-6 h-6 bg-linear-to-t from-bg to-transparent"
            />
            {activePeer ? (
              <div className="mx-auto flex w-full max-w-[720px] items-center gap-2 px-6 pb-1">
                <span className="inline-flex items-center gap-1.5 rounded-pill bg-fill-1 px-2.5 py-1 type-caption text-text-secondary">
                  {t('agents.rail.askingNetwork')}
                  <button
                    type="button"
                    onClick={() => setActivePeer(null)}
                    aria-label={t('agents.rail.stop')}
                    className="cursor-pointer touch-manipulation rounded-sm text-text-tertiary transition-[color,scale,transform] duration-[120ms] ease-[var(--ease-out)] [@media(hover:hover)]:hover:text-text-primary active:scale-[0.97] motion-reduce:active:scale-100 focus-visible:shadow-focus-ring focus-visible:outline-none"
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
          aria-label={t('agents.rail.aria')}
          data-testid="agent-rail"
          className="flex flex-col border-t border-hairline lg:min-h-0 lg:overflow-hidden lg:border-t-0 lg:border-l"
        >
          <div className="px-5 pt-5 pb-4">
            <div className="flex items-baseline justify-between gap-3">
              <h2 className="type-headline text-text-primary">{t('agents.rail.evidence')}</h2>
              {citedCount > 0 ? (
                <button
                  type="button"
                  onClick={() => setHighlight({ ids: new Set<string>() })}
                  className={cn(
                    'cursor-pointer touch-manipulation rounded-sm type-caption text-text-tertiary',
                    'transition-[color,scale,transform] duration-[120ms] ease-[var(--ease-out)]',
                    '[@media(hover:hover)]:hover:text-text-primary',
                    'active:scale-[0.97] motion-reduce:active:scale-100',
                    'focus-visible:shadow-focus-ring focus-visible:outline-none',
                  )}
                >
                  {t('agents.rail.clear')}
                </button>
              ) : null}
            </div>
            <p className="mt-1 flex min-w-0 items-center gap-1.5 type-caption text-text-tertiary">
              <span
                aria-hidden="true"
                className={cn('size-1.5 shrink-0 rounded-full', running ? 'agent-accent-dot agent-live-dot' : 'bg-text-disabled')}
              />
              <span className="truncate">
                {running ? t('agents.agentWorking') : t('agents.rail.specialists', { count: formatInteger(roster.length), roles: roster.join(', ') })}
              </span>
            </p>
            <div className="mt-3">
              <WaferStage
                payload={payload}
                highlighted={highlight.ids}
                highlightLabel={highlight.label}
                waferIndex={waferIndex}
                onWaferChange={setWaferIndex}
                onLoadSample={() => void send(STARTERS[0].prompt, t(STARTERS[0].labelKey))}
              />
            </div>
          </div>

          <div className="flex min-h-0 flex-1 flex-col border-t border-hairline px-5 pt-4 pb-5">
            <SegmentedControl
              ariaLabel={t('agents.rail.panels')}
              size="sm"
              value={railTab}
              onValueChange={setRailTab}
              options={[
                { value: 'facts', label: facts.length ? t('agents.rail.factsCount', { count: formatInteger(facts.length) }) : t('agents.rail.facts') },
                { value: 'peers', label: peers.length ? t('agents.rail.peersCount', { count: formatInteger(peers.length) }) : t('agents.rail.peers') },
                { value: 'trace', label: trace.length ? t('agents.rail.traceCount', { count: formatInteger(trace.length) }) : t('agents.rail.trace') },
              ]}
            />

            <div className="mt-3 min-h-0 flex-1 overflow-y-auto overscroll-contain pr-1">
              {railTab === 'facts' ? (
                payload ? (
                  <ul className="flex flex-col">
                    {factsPreview.map((fact, idx) => {
                      const factsWindowMs = Math.min(240, Math.max(0, (factsPreview.length - 1) * 35));
                      const delaySec =
                        computeStaggerDelayMs(idx, factsPreview.length, factsWindowMs, reducedMotion) /
                        1000;
                      return (
                        <motion.li
                          key={`${payload.lot.lotId}:${fact.factId}`}
                          initial={shouldAnimateFacts ? { opacity: 0, y: 6 } : false}
                          animate={{ opacity: 1, y: 0 }}
                          transition={
                            shouldAnimateFacts
                              ? {
                                  duration: 0.2,
                                  ease: MOTION_TOKENS.easeOutTuple,
                                  delay: delaySec,
                                }
                              : { duration: 0 }
                          }
                        >
                          <button
                            type="button"
                            onClick={() => highlightFact(fact.factId)}
                            aria-pressed={highlight.factId === fact.factId}
                            className={cn(
                              'flex w-full cursor-pointer touch-manipulation items-start gap-2 rounded-control px-2.5 py-2 text-left',
                              'transition-[background-color,scale,transform] duration-[120ms] ease-[var(--ease-out)]',
                              '[@media(hover:hover)]:hover:bg-fill-1',
                              'active:scale-[0.985] motion-reduce:active:scale-100',
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
                              {formatInteger(fact.dieIndices.length)}
                            </span>
                          </button>
                        </motion.li>
                      );
                    })}
                    {facts.length > factsPreview.length ? (
                      <li className="px-2.5 pt-2 type-caption text-text-tertiary">
                        {t('agents.rail.more', { count: formatInteger(facts.length - factsPreview.length) })}
                      </li>
                    ) : null}
                  </ul>
                ) : (
                  <p className="px-1 type-subhead text-text-tertiary">
                    {t('agents.rail.emptyFacts')}
                  </p>
                )
              ) : null}

              {railTab === 'peers' ? (
                <div className="flex flex-col gap-3">
                  <p className="type-subhead text-text-tertiary">
                    {t('agents.rail.peerNote')}
                  </p>
                  <div className="flex items-center gap-2">
                    <input
                      value={peerUrl}
                      onChange={(event) => setPeerUrl(event.target.value)}
                      spellCheck={false}
                      aria-label={t('agents.rail.peerUrl')}
                      className="h-9 min-w-0 flex-1 rounded-control bg-fill-1 px-2.5 font-mono text-[12px] text-text-primary focus-visible:shadow-focus-ring focus-visible:outline-none"
                    />
                    <Button variant="secondary" size="sm" onClick={() => void connectPeer()}>
                      {t('agents.rail.connect')}
                    </Button>
                  </div>
                  {peers.length > 0 ? (
                    <ul className="flex flex-col gap-1">
                      {peers.map((peer) => (
                        <li
                          key={peer.url}
                          className={cn(
                            'flex items-center gap-2 rounded-control px-2 py-1.5',
                            'transition-[background-color,scale,transform] duration-[120ms] ease-[var(--ease-out)]',
                            '[@media(hover:hover)]:hover:bg-fill-1',
                            'active:scale-[0.985] motion-reduce:active:scale-100',
                          )}
                        >
                          <span className="min-w-0 flex-1">
                            <span className="block truncate type-subhead text-text-primary">{peer.network}</span>
                            <span className="block truncate type-caption text-text-tertiary">{peer.origin}</span>
                          </span>
                          <button
                            type="button"
                            onClick={() => setActivePeer(activePeer === peer.url ? null : peer.url)}
                            aria-pressed={activePeer === peer.url}
                            className={cn(
                              'cursor-pointer touch-manipulation rounded-pill bg-fill-2 px-2.5 py-1 type-caption text-text-secondary',
                              'transition-[background-color,color,scale,transform] duration-[120ms] ease-[var(--ease-out)]',
                              '[@media(hover:hover)]:hover:bg-fill-3 [@media(hover:hover)]:hover:text-text-primary',
                              'active:scale-[0.97] motion-reduce:active:scale-100',
                              'aria-pressed:bg-ink aria-pressed:text-on-ink',
                              'focus-visible:shadow-focus-ring focus-visible:outline-none',
                            )}
                          >
                            {activePeer === peer.url ? t('agents.rail.asking') : t('agents.rail.ask')}
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="type-caption text-text-tertiary">{t('agents.rail.noPeer')}</p>
                  )}
                </div>
              ) : null}

              {railTab === 'trace' ? (
                trace.length === 0 ? (
                  <p className="px-1 type-subhead text-text-tertiary">{t('agents.rail.noEvents')}</p>
                ) : (
                  <ul className="flex flex-col gap-1 font-mono text-[11px] leading-relaxed text-text-tertiary">
                    <AnimatePresence initial={false}>
                      {[...trace].reverse().map(({ id, event }) => (
                        <motion.li
                          key={id}
                          initial={reducedMotion ? false : { opacity: 0 }}
                          animate={{ opacity: 1 }}
                          transition={
                            reducedMotion
                              ? { duration: 0 }
                              : { duration: 0.16, ease: MOTION_TOKENS.easeOutTuple }
                          }
                          className="flex gap-2"
                        >
                          <span className="shrink-0 tabular-nums">{formatTime(event.at, locale)}</span>
                          <span
                            className={cn(
                              'shrink-0',
                              event.type.includes('error') ? 'text-[var(--bin-ink-3)]' : 'text-text-secondary',
                            )}
                          >
                            {event.type}
                          </span>
                          <span className="truncate">{eventSummary(event)}</span>
                        </motion.li>
                      ))}
                    </AnimatePresence>
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
        closeLabel={t('sheet.close')}
        size="wide"
        data-testid="agent-model-sheet"
      >
        <div className="flex flex-col gap-5">
          <div>
            <h2 id="agent-model-title" className="type-title-2 text-text-primary">
              {t('agents.model.title')}
            </h2>
            <p className="mt-1 type-subhead text-text-tertiary">
              {t('agents.model.intro')}
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
        closeLabel={t('sheet.close')}
        size="wide"
        data-testid="agent-network-sheet"
      >
        <div className="flex flex-col gap-5">
          <div>
            <h2 id="agent-network-title" className="type-title-2 text-text-primary">
              {t('agents.network.title')}
            </h2>
            <p className="mt-1 type-subhead text-text-tertiary">
              {networkSummary
                ? t('agents.network.summary', { name: networkSummary.name, agent: networkSummary.frontMan })
                : t('agents.network.reading')}
            </p>
            <p className="mt-1 type-caption text-text-tertiary">{t('agents.network.profile')}</p>
          </div>

          {networkSummary ? (
            <ul className="flex flex-col">
              {networkSummary.agents.map((agent) => (
                <li key={agent.name} className="border-t border-hairline py-3 first:border-t-0 first:pt-0">
                  <p className="flex items-baseline gap-2">
                    <span className="font-mono text-[13px] text-text-primary">{agent.name}</span>
                    {agent.name === networkSummary.frontMan ? (
                      <span className="rounded-pill bg-fill-2 px-2 py-0.5 type-caption text-text-secondary">
                        {t('agents.network.front')}
                      </span>
                    ) : null}
                    <span className="ml-auto type-caption tabular-nums text-text-tertiary">
                      {t('agents.network.tools', { count: formatInteger(agent.tools) })}
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
              { href: '/agents/chip_autopsy_lab.network.hocon', label: t('agents.network.hocon') },
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

          <details className="group/raw">
            <summary className="cursor-pointer type-caption text-text-tertiary">{t('agents.network.raw')}</summary>
            <div className="mt-2 flex flex-col gap-1.5">
              {manifestJson ? (
                <div className="flex justify-end">
                  <CopyButton
                    value={manifestJson}
                    label={t('error.copyDetails')}
                    copiedLabel={t('error.copied')}
                    data-testid="agent-manifest-copy"
                    className={cn(
                      'type-caption text-text-tertiary',
                      '[@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover/raw:opacity-100',
                      '[@media(hover:hover)]:group-focus-within/raw:opacity-100 [@media(hover:hover)]:focus-visible:opacity-100',
                    )}
                  />
                </div>
              ) : null}
              <pre className="max-h-[320px] overflow-auto rounded-control bg-fill-1 p-3 font-mono text-[11px] leading-relaxed text-text-secondary">
                {manifestJson || t('agents.network.loading')}
              </pre>
            </div>
          </details>
        </div>
      </ModalSheet>
    </div>
  );
}
