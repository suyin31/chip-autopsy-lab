# Task 16 Parallel Implementation Contract: LLM Narrator & Citation Validator

References: `.kiro/steering/*.md`, `.kiro/specs/chip-autopsy-lab/requirements.md` (Req 10.5–10.7, 16.1, 16.3, 16.4), `design.md` (§3.5, Properties 11 & 14), `premium.md` (§7.4, §9), and `tasks.md` (Task 16).
**Strict Parallelism Rule**: Never edit files owned by the other coder. Do not install packages (`zod` is not in `package.json`; use deterministic TypeScript schema validators returning `Result<T, string>` from `src/core/stdf/types.ts`).

---

## 1. Exact TypeScript Signatures, Schemas & Route Contract

### 1.1 `src/core/report/citation-validator.ts` (re-exported from `src/core/report/index.ts`)

```typescript
import type { BinMode, LotModel } from '../model/types';
import type { Result } from '../stdf/types';
import type { EngineFact, FactKind, FormattedFactMetric } from './engine-facts';
import type { AutopsyReport } from './template-report';
import type { AutopsyVerdictDecision } from './verdict-precedence';

export const NARRATE_CLIENT_TIMEOUT_MS = 4_000 as const;
export const MAX_OUTBOUND_FACTS = 64 as const;
export const MIN_CANDIDATE_CLAIMS = 1 as const;
export const MAX_CANDIDATE_CLAIMS = 6 as const;
export const MAX_CLAIM_TEXT_LENGTH = 320 as const;

/** Privacy-safe wire projection sent to POST /api/autopsy/narrate: NEVER includes dieIds, dieIndices, or coordinates. */
export interface OutboundEngineFact {
  readonly factId: string;
  readonly kind: FactKind;
  readonly summary: string;
  readonly dieCount: number;
  readonly metrics: readonly FormattedFactMetric[];
  readonly binRef?: { readonly mode: BinMode; readonly code: number; readonly name: string };
  readonly testRef?: { readonly testNum: number; readonly testName: string };
  readonly siteRef?: { readonly headNum: number; readonly siteNum: number };
  readonly waferRef?: { readonly waferIndex: number; readonly waferId: string };
  readonly hypotheses?: readonly string[];
}

export interface NarrateRequestPayload {
  readonly mode: 'narrate';
  readonly lotId: string;
  readonly verdict: string;
  readonly confidence: number;
  readonly outboundFacts: readonly OutboundEngineFact[];
}

export interface LlmCandidateClaim {
  readonly id: string;
  readonly text: string;
  readonly citedFactIds: readonly string[];
}

export interface NarrateSuccessResponse {
  readonly claims: readonly LlmCandidateClaim[];
}

export type NarrateErrorReason =
  | 'llm_unconfigured'
  | 'invalid_payload'
  | 'privacy_violation'
  | 'upstream_error'
  | 'invalid_llm_output';

export interface NarrateErrorResponse {
  readonly reason: NarrateErrorReason;
  readonly detail?: string;
}

export function sanitizeOutboundNarratePayload(
  lot: Pick<LotModel, 'lotId'>,
  verdict: Pick<AutopsyVerdictDecision, 'verdict' | 'confidence'>,
  facts: readonly EngineFact[],
): NarrateRequestPayload;

/** Zero-dependency inbound request schema validator (replaces zod). Used by client tests and route.ts. */
export function validateNarrateRequestSchema(
  body: unknown,
): Result<NarrateRequestPayload, string>;

/** Zero-dependency response schema validator for { claims: [{ id, text, citedFactIds }] }. */
export function validateNarrateResponseSchema(
  body: unknown,
): Result<NarrateSuccessResponse, string>;

/** Masks SBIN/HBIN/Test/Site/Wafer identifiers and extracts all numeric literals from claim prose. */
export function extractNumbersFromClaimText(
  text: string,
  citedFacts?: readonly EngineFact[],
): readonly number[];

export function validateLlmNarration(
  candidate: unknown,
  templateReport: AutopsyReport,
  factsById: ReadonlyMap<string, EngineFact>,
  totalLotDies: number,
): Result<AutopsyReport, string>;

/** Returns validated llm-verified AutopsyReport on ok, or templateReport unchanged on any validation failure. */
export function resolveNarratedReportOrFallback(
  candidate: unknown,
  templateReport: AutopsyReport,
  factsById: ReadonlyMap<string, EngineFact>,
  totalLotDies: number,
): AutopsyReport;
```

### 1.2 Behavioral Rules for Sanitizer, Schemas & Citation Validator
- **`sanitizeOutboundNarratePayload`**: Projects `facts.slice(0, 64)` into `OutboundEngineFact[]` (`dieCount = fact.dieIndices.length`), sanitizes strings via `sanitizeReportProseText`, strips any canonical `DieId` (`<waferId>:<x>,<y>` or `<waferId>:part-<seq>`), and omits `dieIndices`, `dieIds`, coordinates, and STDF buffers by construction.
- **`validateNarrateRequestSchema`**: Strict allow-list validation. Rejects (`ok: false`) if:
  - Top-level keys differ from `['mode', 'lotId', 'verdict', 'confidence', 'outboundFacts']` or `mode !== 'narrate'`.
  - Any object at any depth contains forbidden keys (`dieIds`, `dieIndices`, `dies`, `x`, `y`, `xCoord`, `yCoord`, `coords`, `coordinates`, `values`, `measurements`, `rawBytes`, `stdfBytes`, `buffer`, `arrayBuffer`, `ptrs`, `prrs`), `ArrayBuffer`/TypedArray views, base64/hex STDF `FAR` signatures, or strings matching canonical `DieId` regex `/\b[A-Za-z0-9_-]+:(?:-?\d+,-?\d+|part-\d+)\b/`.
  - `outboundFacts` is empty or `> 64`, `dieCount < 1`, `confidence` outside `[0, 1]`, or metrics contain non-finite numbers.
- **`validateLlmNarration`**:
  1. Validates `candidate` with `validateNarrateResponseSchema` (`1..6` claims, `1..320` chars trimmed `text`, zero `<` or `>` HTML chars, zero forbidden horror words `/\b(corpse|morgue|zombie|vampire|ghost|skull|cobweb|blood|gore|spooky|pumpkin|skeleton|graveyard)\b/i`, `citedFactIds.length >= 1`).
  2. Verifies every `factId` exists in `factsById`, each cited fact has `dieIndices.length >= 1`, `dieIds.length === dieIndices.length`, and every die index is an integer in `[0, totalLotDies - 1]`. Computes union `resolvedDieIndices` (`length >= 1`) and `resolvedDieIds`.
  3. Extracts numbers via `extractNumbersFromClaimText(claim.text, citedFacts)` (after masking `SBIN <n>`, `HBIN <n>`, `Test <n>`, `Head <h> Site <s> (<h>:<s>)`, `Site <h>:<s>`, `Site <s>`, `Wafer <id>`, and `outer 3 rings` / `3-die band` when a spatial fact is cited). Every extracted number `n` must match at least one cited `FormattedFactMetric` (`|n - metric.numericValue| <= metric.tolerance + 1e-9`) or cited `dieCount` (`tolerance = 0`).
  4. Keeps `templateReport.causeOfDeathHeadline` locked (Req 10.1), maps validated claims to `ReportClaim[]` (inheriting `messageKey`, `subMessageKey`, `params` from matching `templateReport.bodyClaims` by `claimId` or primary `citedFactIds[0]`, or from the primary cited fact), and returns `{ ...templateReport, bodyClaims, source: 'llm-verified' }`.

### 1.3 Route Contract: `src/app/api/autopsy/narrate/route.ts`
- Exports `POST(request: Request): Promise<Response>`.
- **Step 1 (Inbound Privacy Gate — runs first)**: Parse JSON and run `validateNarrateRequestSchema(body)`. On parse failure or `!valid.ok`, immediately return **`HTTP 400`** JSON `{ reason: 'privacy_violation' | 'invalid_payload', detail }`.
- **Step 2 (Server-Only Key Check)**: Read `process.env.LLM_API_KEY` (never `NEXT_PUBLIC_`; optional `LLM_PROVIDER_URL`, `LLM_MODEL`). If unset/blank, return **`HTTP 503`** JSON `{ reason: 'llm_unconfigured' }` in `< 5 ms`.
- **Step 3 (Upstream Call & Output Validation)**: POST sanitized facts to `LLM_PROVIDER_URL` (`Authorization: Bearer ${LLM_API_KEY}`, server timeout `<= 3500 ms`), parse JSON content, validate with `validateNarrateResponseSchema`. Return **`HTTP 200`** `{ claims }` on success, or **`HTTP 502`** `{ reason: 'upstream_error' | 'invalid_llm_output', detail }` on upstream failure/invalid schema.

---

## 2. File Ownership & i18n Keys

| Owner | File Path | Responsibility |
|---|---|---|
| **CORE** | `src/core/report/citation-validator.ts` | Types, `sanitizeOutboundNarratePayload`, schema validators, `validateLlmNarration`, `resolveNarratedReportOrFallback` |
| **CORE** | `src/core/report/index.ts` | Re-export `export * from './citation-validator';` |
| **CORE** | `src/app/api/autopsy/narrate/route.ts` | `POST` handler enforcing HTTP 400/503/200/502 contract & server-only `LLM_API_KEY` |
| **CORE** | `src/core/report/narrate-route.test.ts` | Unit tests for `POST /api/autopsy/narrate` (400, 503, 200, 502 with mocked `fetch`/env) |
| **CORE** | `src/core/report/citation-validator.prop.test.ts` | **Property 11** `fast-check` test: citation validator soundness & deterministic fallback |
| **CORE** | `src/core/report/llm-payload-privacy.prop.test.ts` | **Property 14** `fast-check` test: outbound payload privacy & route HTTP 400 rejection |
| **UI** | `src/ui/report/use-autopsy-narration.ts` | Client hook: 4 s `AbortController` timeout, `en`-only trigger, validation & template fallback |
| **UI** | `src/ui/report/AutopsyReportCard.tsx` | Wire `useAutopsyNarration`, expose `data-narration-source` & `data-narration-status` |
| **UI** | `src/ui/report/ConfidencePill.tsx` | Add `data-testid="confidence-method-body"` and optional `data-testid="confidence-narration-status"` (no new colours/pills) |
| **UI** | `src/ui/report/index.ts` & `autopsy-report-card.test.ts` | Export hook/types; unit tests for 4 s timeout, 503/400/invalid fallback, and verified swap |
| **UI** | `src/core/i18n/messages/{en,ja,ko,zh-cn,zh-tw}.ts` | Append the 3 new narration keys at the **END** of each locale dictionary |
| **UI** | `src/core/i18n/i18n.test.ts` | Update `expect(enKeys.length).toBe(342)` (line 142) to reflect the 3 appended keys |
| **UI** | `e2e/narrator-t16.spec.ts` | Playwright e2e spec with `page.route('**/api/autopsy/narrate', ...)` mocks |

### Exact New i18n Keys (UI coder appends at the END of each messages file)
No exclamation marks, no middle dots, no forbidden autopsy/death words outside §9.4:
- **`en.ts`**:
  - `'verdict.narration.loading': 'Verifying AI summary against engine facts…'`
  - `'verdict.narration.verified': 'AI summary verified against cited engine facts.'`
  - `'verdict.narration.fallback': 'Showing built-in template summary.'`
- **`zh-cn.ts`**: `'正在对照引擎事实校验 AI 摘要…'` / `'AI 摘要已通过引擎事实引用校验。'` / `'当前显示内置模板摘要。'`
- **`zh-tw.ts`**: `'正在對照引擎事實校驗 AI 摘要…'` / `'AI 摘要已通過引擎事實引用校驗。'` / `'目前顯示內建範本摘要。'`
- **`ja.ts`**: `'エンジンの事実データと AI 要約を照合しています…'` / `'AI 要約は引用されたエンジンの事実データと照合済みです。'` / `'内蔵テンプレートの要約を表示しています。'`
- **`ko.ts`**: `'엔진 사실 데이터와 AI 요약을 대조하는 중…'` / `'AI 요약이 인용된 엔진 사실 데이터와 검증되었습니다.'` / `'내장 템플릿 요약을 표시합니다.'`

---

## 3. Test Checklists & Mocking Rule

**Mandatory Mocking Rule**: **NO real LLM or external network calls in any unit, property, or e2e test.** Stub `globalThis.fetch` (or inject `fetchImpl`) in Vitest, and intercept `**/api/autopsy/narrate` via `page.route()` in Playwright.

### CORE Coder Checklist
- [ ] **Property 11 (`src/core/report/citation-validator.prop.test.ts`)**: `fast-check` (`numRuns: 200`) over arbitrary `EngineFact` sets + mutated LLM payloads (unknown `factId`, empty `citedFactIds`, out-of-range die index `>= totalLotDies`, `<script>`/HTML injection, horror words, and numeric tokens perturbed beyond `metric.tolerance`) -> `validateLlmNarration` returns `ok: false` and `resolveNarratedReportOrFallback` returns `templateReport` unchanged; valid payloads with exact/within-tolerance metrics return `source: 'llm-verified'` and preserve `causeOfDeathHeadline`.
- [ ] **Property 14 (`src/core/report/llm-payload-privacy.prop.test.ts`)**: `fast-check` (`numRuns: 200`) over `arbLotModel` -> `sanitizeOutboundNarratePayload` serialized JSON contains zero STDF magic/record bytes, zero `DieId` strings, and zero coordinate/measurement arrays, and passes `validateNarrateRequestSchema`; adversarial mutations injecting `dieIds`, `x`/`y`, `values`, `Uint8Array`, or `> 64` facts fail `validateNarrateRequestSchema` and receive `HTTP 400` from `POST`.
- [ ] **Route unit tests (`src/core/report/narrate-route.test.ts`)**: missing `LLM_API_KEY` -> `503 { reason: 'llm_unconfigured' }`; per-die/unknown fields -> `400`; mocked upstream valid JSON -> `200 { claims }`; mocked upstream error/invalid schema -> `502`.

### UI Coder Checklist
- [ ] **Client hook & report card tests (`src/ui/report/autopsy-report-card.test.ts`)**: template report renders synchronously (`0 ms`); verified response updates findings headlines (`en`) and switches `ConfidencePill` popover method copy to `verdict.methodLlm`; missing key (`503`), HTTP error (`500`), `> 4000 ms` timeout (via fake timers/abort), or hallucinated number (`validateLlmNarration` failure) keeps deterministic template with zero error toasts.
- [ ] **Playwright E2E (`e2e/narrator-t16.spec.ts`)**: (1) mocked `200` valid narration swaps finding text and shows `verdict.methodLlm` in the confidence popover while clicking a finding still lights its cited dies on the wafer overlay; (2) mocked `200` with hallucinated number or unknown `factId` is rejected client-side and keeps template text; (3) mocked `503` / delayed `> 4 s` route times out cleanly and keeps the deterministic template report; (4) outbound POST request body captured by `page.route` contains zero `dieIds` or coordinate arrays.
