# Chip Autopsy Lab → Open Agentic Web: gap analysis

Date: 2026-11-21. Target profile: *Minimum Viable Specification for a Worldwide Agentic Web*, MVP Profile 0.3 (18 November 2026, Cognizant AI Lab). Challenge: Open Agentic Web Challenge (Devpost), submission period 2026-11-11 → 2027-01-11 08:00 PT.

## What the profile requires

| # | Requirement (MVP Profile 0.3) | Where |
|---|---|---|
| R1 | `agent-manifest.json` at the site base: one or more networks (`name`, `front_man`, `hocon`), top-site LLM router metadata, peer policy, optional brand/theme/actions/linking/deployment metadata; public GET with CORS | §3.3, §3.2 |
| R2 | A resolved, data-only network definition in the Neuro SAN agent-network data model (`metadata`, `tools[]` with `name`, `function.description`, `instructions`, `tools`), published as JSON for browser loading | §2.1, §2.2 |
| R3 | A browser runtime that parses and validates a network before any model call, runs the front agent and internal agents, streams model output, translates capabilities into model-visible function schemas, delegates agent-to-agent, propagates errors, bounds history | §3.1 |
| R4 | Registered local site actions: name, purpose, JSON Schema input, effect classification, handler; the runtime validates arguments and shows destination + arguments before a write or irreversible call | §3.1, §1.2 |
| R5 | Bounded execution: finite composition depth, agent invocations, remote calls, concurrency and elapsed time; fail closed with visible errors | §3.1, §5 |
| R6 | Peer agent sites: URL whose last path component is the network name; fetch `<base>/agent-manifest.json`, exact name match (fail closed on mismatch), fetch and validate the declared definition, run it locally in the caller's runtime with the caller's router and limits | §3.2 |
| R7 | Consent before each third-party origin contact, naming the origin and the nature of the request; remembered approvals scoped to origin per session | §3.2, §5 |
| R8 | `links.json` peer-network link map (symbolic name → peer URL), publisher-owned; runtime-supplied bindings are caller-owned | §3.3 |
| R9 | Pluggable inference: site default router and/or visitor BYOK (base URL, model, key); the key stays in the browser, is attached only to router requests, never appears in URLs, manifests, prompts, action arguments, traces or peer requests; locally stored, deletable | §4 |
| R10 | Private context (sly_data) is deny-by-default across network boundaries; only explicitly named fields may pass | §1.2, §2.1, §5 |
| R11 | Observable execution: selected router, contacted origins, agent and tool calls, consent decisions, errors, action receipts | §5 |
| R12 | Accurate outcome reporting: a tool response is not a verified business outcome; a write with unknown outcome must be reported as unknown, never repeated by the runtime | §3.1 |
| R13 | Untrusted peer instructions: peer definitions are untrusted input to the caller's model | §5 |

Submission form requirements (beyond the profile): public URL of the site, a text description, a demo video under 2 minutes on YouTube with the entrant explaining the project, one or more screenshots, and an explanation of how a pre-existing project was significantly updated after 2026-11-11.

## What the project has today

| Area | State |
|---|---|
| App | Next.js 16 / React 19, deployed statically to Netlify (`chip-autopsy-lab.netlify.app`) |
| Core | Framework-free TypeScript engine: STDF V4 parser/writer (16 record types), columnar lot model, yield/bin/parametric analytics, WM-811K classifier, deterministic verdict + report engine with stable fact IDs, filter DSL + offline NL grammar |
| Worker | Comlink Web Worker; parsing and analysis never leave the browser |
| Narration | Optional server-side `/api/autopsy/narrate` (aggregate facts only, citation validation) — a single-prompt LLM call, not an agent network |
| Tests | 474 unit/property tests, Playwright e2e suite |
| Agentic web artifacts | **None.** No `agent-manifest.json`, no published network, no runtime, no chat surface for an agent, no model/key settings UI, no peer linking, no CORS headers for public artifacts |

## The gap, and what this work adds

Everything below is new in this update; the parsing core and the existing app are untouched.

1. **`public/agent-manifest.json`** — brand, one network (`chip_autopsy_lab`), front agent, `hocon` path, `llm_router`, `allowed_peers` + `peer_policy`, `linking`, `deployment`, `theme`, and `actions` metadata; every artifact is publicly fetchable with CORS.
2. **`public/agents/chip_autopsy_lab.network.json`** (resolved JSON) and **`chip_autopsy_lab.network.hocon`** (the authored source) — a four-agent network: `autopsy_conductor` (front) → `lot_analyst`, `pattern_pathologist`, `evidence_auditor`, all grounded in the site's own deterministic engine through registered site actions.
3. **`public/agent-runtime/agent-runtime.mjs`** — a dependency-free ES-module browser runtime implementing §2–§5: HOCON/JSON network parsing and validation, agent loop with streaming, delegation, bounded history, budgets, cycle detection, fail-closed errors, site-action registry with JSON Schema validation and effect-based confirmation, per-origin consent, peer loading with exact-name resolution and `links.json`, BYOK (OpenAI-compatible, SSE) with local-only credential storage, private-context filtering, and an observable trace stream. Any agentic site can drop this file in and run a conforming network with it.
4. **Site actions over the existing engine** — `list_demo_lots`, `load_demo_lot`, `get_lot_summary`, `diagnose_lot`, `get_evidence`, `explain_spatial_pattern`, `query_dies` (the project's filter DSL), `compare_test_sites`, `highlight_dies`, `clear_highlight`. All read aggregate facts and derived results; the raw STDF bytes stay in the worker.
5. **`/agents` console** — a chat surface with tool-call cards, confirmation cards for effectful actions, an evidence stage that lights up the dies an agent cites, a trace panel, model/key settings, and a peer-site connector with a consent card.
6. **Tests** — unit and property tests for the runtime (HOCON parsing, network validation, budget and cycle enforcement, schema validation, action dispatch and receipts, peer resolution, private-context filtering), plus an e2e run of the console.
7. **A no-key path** — a deterministic router so the network can be run and judged without an API key; every answer is assembled from real tool results and is labelled as such in the UI. With a key, the same network runs on the visitor's model through an OpenAI-compatible router (Otari, OpenAI, OpenRouter, or any compatible base URL).

## Effort

- Runtime + network + actions + console + tests: 2–3 focused working days for a version worth submitting, of which a working end-to-end version lands in the first session.
- Remaining before submission: demo video (under 2 minutes, on YouTube), screenshots, Devpost field values.
