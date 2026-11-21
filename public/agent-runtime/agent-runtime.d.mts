/**
 * Type surface for `agent-runtime.mjs`. The runtime itself is plain JavaScript
 * so any site can load it with a single `<script type="module">` import; this
 * declaration gives the Next.js console honest types without a build step.
 */

export type AgentRuntimeErrorCode =
  | 'manifest_invalid'
  | 'manifest_unavailable'
  | 'network_invalid'
  | 'network_not_found'
  | 'parse_failed'
  | 'schema_invalid'
  | 'tool_unknown'
  | 'tool_not_allowed'
  | 'budget_exceeded'
  | 'depth_exceeded'
  | 'cycle_detected'
  | 'consent_denied'
  | 'peer_blocked'
  | 'remote_failed'
  | 'unknown_outcome'
  | 'router_missing'
  | 'router_failed'
  | 'key_missing'
  | 'mcp_failed'
  | 'unavailable';

export declare class AgentRuntimeError extends Error {
  readonly code: AgentRuntimeErrorCode;
  readonly detail: Record<string, unknown>;
}

export declare const AGENT_RUNTIME_VERSION: string;
export declare const AGENT_RUNTIME_PROFILE: string;

export interface AgentSpec {
  readonly name: string;
  readonly description: string;
  readonly instructions: string;
  readonly parameters?: Record<string, unknown>;
  readonly tools: ReadonlyArray<string | { readonly url: string; readonly tools?: readonly string[] }>;
}

export interface Network {
  readonly name: string;
  readonly description: string;
  readonly frontMan: string;
  readonly agents: ReadonlyMap<string, AgentSpec>;
  readonly capabilities: ReadonlyMap<
    string,
    { readonly name: string; readonly description: string; readonly toolType: string; readonly url?: string }
  >;
  readonly metadata: Record<string, unknown>;
  readonly raw: Record<string, unknown>;
  readonly source: { readonly baseUrl: string; readonly origin: string; readonly isPeer: boolean };
  readonly modelName?: string;
  readonly maxExecutionSeconds?: number;
  readonly sampleQueries?: readonly string[];
}

export interface ManifestNetworkEntry {
  readonly name: string;
  readonly front_man: string;
  readonly hocon: string;
  readonly description?: string;
  readonly tags?: readonly string[];
  readonly sample_queries?: readonly string[];
}

export interface SiteManifest {
  readonly brand?: string;
  readonly networks: readonly ManifestNetworkEntry[];
  readonly llm_router?: { readonly base_url?: string; readonly byok_router?: string; readonly mock?: boolean };
  readonly allowed_peers?: readonly string[];
  readonly peer_policy?: {
    readonly mode?: 'open' | 'closed';
    readonly deny_origins?: readonly string[];
    readonly note?: string;
  };
  readonly actions?: {
    readonly version?: number;
    readonly registry?: string;
    readonly agentTools?: readonly string[];
    readonly note?: string;
  };
  readonly linking?: Record<string, unknown>;
  readonly deployment?: Record<string, unknown>;
  readonly theme?: Record<string, unknown>;
}

export interface SiteActionSpec {
  readonly name: string;
  readonly purpose: string;
  readonly inputSchema: Record<string, unknown>;
  readonly effect?: 'read' | 'write' | 'irreversible';
  handler(
    args: Record<string, unknown>,
    context: {
      readonly trace: (type: string, detail?: Record<string, unknown>) => void;
      readonly visit: (requestId: string) => ToolResultRecord | null;
    },
  ): Promise<{
    readonly summary?: string;
    readonly data?: unknown;
    readonly view?: unknown;
    readonly outcome?: 'verified' | 'unknown';
  }>;
}

export interface RouterMessage {
  readonly role: 'system' | 'user' | 'assistant';
  readonly content: string;
}

export interface RouterToolSchema {
  readonly type: 'function';
  readonly function: {
    readonly name: string;
    readonly description: string;
    readonly parameters: Record<string, unknown>;
  };
}

export interface RouterReply {
  readonly content: string;
  readonly toolCalls: ReadonlyArray<{
    readonly id: string;
    readonly name: string;
    readonly arguments: Record<string, unknown>;
  }>;
}

export interface RouterChatRequest {
  readonly messages: ReadonlyArray<Record<string, unknown>>;
  readonly tools: ReadonlyArray<RouterToolSchema>;
  readonly signal?: AbortSignal;
  readonly onDelta?: (text: string) => void;
  readonly context: {
    readonly network: {
      readonly name: string;
      readonly description: string;
      readonly metadata: Record<string, unknown>;
      readonly frontMan: string;
      readonly source: { readonly baseUrl: string; readonly origin: string; readonly isPeer: boolean };
    };
    readonly agent: {
      readonly name: string;
      readonly description: string;
      readonly instructions: string;
      readonly isFront: boolean;
      readonly toolNames: readonly string[];
    };
    readonly input: string;
    readonly step: number;
    readonly results: ReadonlyArray<{
      readonly kind: string;
      readonly summary?: string;
      readonly text?: string;
      readonly data?: unknown;
      readonly requestId?: string;
    }>;
    readonly depth: number;
  };
}

export interface Router {
  readonly id: string;
  readonly label: string;
  readonly info: {
    readonly kind: 'demo' | 'byok' | 'site';
    readonly model?: string;
    readonly baseUrl?: string;
    readonly provider?: string;
  };
  chat(request: RouterChatRequest): Promise<RouterReply>;
}

export interface TraceEvent {
  readonly type: string;
  readonly at: string;
  readonly [key: string]: unknown;
}

export interface ConsentRequest {
  readonly kind: 'peer' | 'mcp' | 'action';
  readonly origin?: string;
  readonly purpose?: string;
  readonly name?: string;
  readonly effect?: string;
  readonly args?: Record<string, unknown>;
  readonly callId?: string;
}

export interface ToolResultRecord {
  readonly text: string;
  readonly data?: unknown;
  readonly view?: unknown;
}

export interface RuntimeLimits {
  readonly maxStepsPerAgent?: number;
  readonly maxAgentInvocations?: number;
  readonly maxDepth?: number;
  readonly maxRemoteCalls?: number;
  readonly maxExecutionSeconds?: number;
  readonly maxToolResultChars?: number;
  readonly maxHistoryMessages?: number;
}

export interface RuntimeOptions {
  readonly manifestUrl?: string;
  readonly siteBaseUrl?: string;
  /** Page URL used to resolve a site-relative manifest path. Defaults to location.href. */
  readonly baseHref?: string;
  readonly fetchImpl?: typeof fetch;
  readonly router?: Router;
  readonly actions?: ReadonlyArray<SiteActionSpec>;
  readonly consent?: (request: ConsentRequest) => Promise<boolean> | boolean;
  readonly limits?: RuntimeLimits;
  readonly onEvent?: (event: TraceEvent) => void;
}

export interface RunRequest {
  readonly network?: string;
  readonly input: string;
  readonly slyData?: Record<string, unknown>;
  readonly signal?: AbortSignal;
}

export interface RunResult {
  readonly ok: true;
  readonly network: string;
  readonly router: { readonly id: string; readonly label: string; readonly info: Router['info'] };
  readonly text: string;
  readonly ms: number;
  readonly invocations: number;
  readonly remoteCalls: number;
  readonly events: ReadonlyArray<TraceEvent>;
}

export interface PeerHandle {
  readonly url: string;
  readonly baseUrl: string;
  readonly origin: string;
  readonly network: Network;
  readonly manifest: SiteManifest;
}

export interface AgentRuntime {
  ready(): Promise<{ networks: string[]; brand?: string; manifest: unknown }>;
  listNetworks(): Network[];
  getNetwork(name: string): Network | null;
  readonly manifest: SiteManifest | null;
  readonly routerInfo: { readonly id: string; readonly label: string; readonly info: Router['info'] };
  setRouter(router: Router): void;
  run(request: RunRequest): Promise<RunResult>;
  connectPeer(url: string): Promise<PeerHandle>;
  runPeer(url: string, input: string): Promise<{
    readonly ok: true;
    readonly network: string;
    readonly peerOrigin: string;
    readonly text: string;
    readonly ms: number;
  }>;
  setPeerBinding(name: string, url: string): void;
  getToolResult(requestId: string): ToolResultRecord | null;
  getEvents(): TraceEvent[];
  dispose(): void;
}

export declare function createAgentRuntime(options?: RuntimeOptions): AgentRuntime;
export declare function createDemoRouter(): Router;
export declare function createOpenAICompatibleRouter(options: {
  readonly baseUrl: string;
  readonly model: string;
  readonly apiKey?: string;
  readonly provider?: string;
  readonly headers?: Record<string, string>;
  readonly fetchImpl?: typeof fetch;
  readonly temperature?: number;
  readonly maxTokens?: number;
}): Router;
export declare function parseHocon(text: string, options?: { readonly source?: string }): unknown;
export declare function validateManifest(manifest: unknown): string[];
export declare function validateJsonSchema(schema: unknown, value: unknown, path?: string): string[];
export declare function resolveNetwork(
  raw: unknown,
  options?: { readonly name?: string; readonly baseUrl?: string; readonly origin?: string; readonly isPeer?: boolean },
): Network;
