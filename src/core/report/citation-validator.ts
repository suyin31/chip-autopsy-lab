/**
 * Outbound LLM payload sanitizer, zero-dependency request/response schema
 * validators, citation & numeric grounding validator, and route handler core
 * (`src/core/report/citation-validator.ts`).
 *
 * Pure deterministic TypeScript with zero React, Next.js, or DOM imports.
 * Validates: Requirements 10.5, 10.6, 10.7, 16.1, 16.3, 16.4, 17.7
 */

import type { MessageKey } from '../i18n';
import type { BinMode, DieId, LotModel } from '../model/types';
import type { Result } from '../stdf/types';
import {
  type EngineFact,
  type FactKind,
  type FormattedFactMetric,
  sanitizeReportProseText,
} from './engine-facts';
import {
  type AutopsyReport,
  type ClaimParams,
  formatCleanBinToken,
  type ReportClaim,
  unionFactDieIndices,
} from './template-report';
import type { AutopsyVerdictDecision } from './verdict-precedence';

export const NARRATE_CLIENT_TIMEOUT_MS = 4_000 as const;
export const NARRATE_SERVER_TIMEOUT_MS = 3_500 as const;
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
  readonly binRef?: {
    readonly mode: BinMode;
    readonly code: number;
    readonly name: string;
  };
  readonly testRef?: {
    readonly testNum: number;
    readonly testName: string;
  };
  readonly siteRef?: {
    readonly headNum: number;
    readonly siteNum: number;
  };
  readonly waferRef?: {
    readonly waferIndex: number;
    readonly waferId: string;
  };
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

const VALID_FACT_KINDS: ReadonlySet<FactKind> = new Set<FactKind>([
  'lot-yield',
  'spatial-pattern',
  'dominant-bin',
  'secondary-bin',
  'site-anomaly',
  'wafer-excursion',
  'parametric-capability',
  'retest-recovery',
]);

const FORBIDDEN_PRIVACY_KEYS: ReadonlySet<string> = new Set<string>([
  'dieIds',
  'dieIndices',
  'dies',
  'x',
  'y',
  'xCoord',
  'yCoord',
  'coords',
  'coordinates',
  'values',
  'measurements',
  'rawBytes',
  'stdfBytes',
  'buffer',
  'arrayBuffer',
  'ptrs',
  'prrs',
]);

const TOP_LEVEL_REQUEST_KEYS: ReadonlySet<string> = new Set<string>([
  'mode',
  'lotId',
  'verdict',
  'confidence',
  'outboundFacts',
]);

const OUTBOUND_FACT_ALLOWED_KEYS: ReadonlySet<string> = new Set<string>([
  'factId',
  'kind',
  'summary',
  'dieCount',
  'metrics',
  'binRef',
  'testRef',
  'siteRef',
  'waferRef',
  'hypotheses',
]);

const METRIC_ALLOWED_KEYS: ReadonlySet<string> = new Set<string>([
  'key',
  'numericValue',
  'displayValue',
  'tolerance',
]);

const BIN_REF_ALLOWED_KEYS: ReadonlySet<string> = new Set<string>([
  'mode',
  'code',
  'name',
]);

const TEST_REF_ALLOWED_KEYS: ReadonlySet<string> = new Set<string>([
  'testNum',
  'testName',
]);

const SITE_REF_ALLOWED_KEYS: ReadonlySet<string> = new Set<string>([
  'headNum',
  'siteNum',
]);

const WAFER_REF_ALLOWED_KEYS: ReadonlySet<string> = new Set<string>([
  'waferIndex',
  'waferId',
]);

const CANONICAL_DIE_ID_REGEX =
  /(?:\b|(?<=^|[\s([{"']))[A-Za-z0-9_./:#-]+:(?:-?\d+,-?\d+|part-\d+)\b/;
const CANONICAL_DIE_ID_GLOBAL_REGEX =
  /(?:\b|(?<=^|[\s([{"']))[A-Za-z0-9_./:#-]+:(?:-?\d+,-?\d+|part-\d+)\b/g;

/**
 * Matches STDF V4 FAR record signatures (REC_LEN=2, REC_TYP=0, REC_SUB=10, CPU_TYPE=1|2, STDF_VER=4)
 * encoded as hex or base64 (`AgAACgIE` / `AAIACgEE`).
 */
const STDF_FAR_HEX_REGEX =
  /(?:02[\s,:-]*00|00[\s,:-]*02)[\s,:-]*00[\s,:-]*0a[\s,:-]*0[12][\s,:-]*04/i;
const STDF_FAR_HEX_GLOBAL_REGEX =
  /(?:02[\s,:-]*00|00[\s,:-]*02)[\s,:-]*00[\s,:-]*0a[\s,:-]*0[12][\s,:-]*04/gi;
const STDF_FAR_BASE64_REGEX =
  /(?:AgAACgI[EA-Za-z0-9+/=]|AAIACgE[EA-Za-z0-9+/=])/;
const STDF_FAR_BASE64_GLOBAL_REGEX =
  /(?:AgAACgI[EA-Za-z0-9+/=]|AAIACgE[EA-Za-z0-9+/=])/g;

const FORBIDDEN_HORROR_TERMS_REGEX =
  /\b(corpse|morgue|zombie|vampire|ghost|skull|cobweb|blood|gore|spooky|pumpkin|skeleton|graveyard)\b/i;

export const PRIVACY_VIOLATION_PREFIX = 'Privacy violation:' as const;

export function isPrivacyViolationError(detail: string): boolean {
  return detail.startsWith(PRIVACY_VIOLATION_PREFIX);
}

function hasRawStdfFarBytes(str: string): boolean {
  for (let i = 0; i + 5 < str.length; i += 1) {
    const b0 = str.charCodeAt(i);
    const b1 = str.charCodeAt(i + 1);
    const isLen2 = (b0 === 2 && b1 === 0) || (b0 === 0 && b1 === 2);
    if (!isLen2) {
      continue;
    }
    const b2 = str.charCodeAt(i + 2);
    const b3 = str.charCodeAt(i + 3);
    const b4 = str.charCodeAt(i + 4);
    const b5 = str.charCodeAt(i + 5);
    if (b2 === 0 && b3 === 10 && (b4 === 1 || b4 === 2) && b5 === 4) {
      return true;
    }
  }
  return false;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) {
    return false;
  }
  if (
    typeof SharedArrayBuffer !== 'undefined' &&
    value instanceof SharedArrayBuffer
  ) {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function isBinaryBufferOrView(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) {
    return true;
  }
  if (
    typeof SharedArrayBuffer !== 'undefined' &&
    value instanceof SharedArrayBuffer
  ) {
    return true;
  }
  return false;
}

function sanitizeOutboundString(raw: string): string {
  const clean = sanitizeReportProseText(raw)
    .replace(CANONICAL_DIE_ID_GLOBAL_REGEX, '')
    .replace(STDF_FAR_HEX_GLOBAL_REGEX, '')
    .replace(STDF_FAR_BASE64_GLOBAL_REGEX, '')
    .replace(/\s+/g, ' ')
    .trim();
  return clean;
}

/**
 * Projects `facts.slice(0, 64)` into privacy-safe `OutboundEngineFact[]`
 * (`dieCount = fact.dieIndices.length`), sanitizes strings via `sanitizeReportProseText`,
 * strips any canonical `DieId`, and omits `dieIndices`, `dieIds`, coordinates, and
 * STDF buffers by construction.
 */
export function sanitizeOutboundNarratePayload(
  lot: Pick<LotModel, 'lotId'>,
  verdict: Pick<AutopsyVerdictDecision, 'verdict' | 'confidence'>,
  facts: readonly EngineFact[],
): NarrateRequestPayload {
  const cleanLotId = sanitizeOutboundString(lot.lotId) || 'LOT';
  const cleanVerdict =
    sanitizeOutboundString(verdict.verdict) || 'No failure pattern detected';
  const clampedConfidence = Number.isFinite(verdict.confidence)
    ? Math.min(1, Math.max(0, verdict.confidence))
    : 0;

  const slicedFacts = facts.slice(0, MAX_OUTBOUND_FACTS);
  const outboundFacts: OutboundEngineFact[] = slicedFacts.map(
    (fact, index): OutboundEngineFact => {
      const cleanFactId =
        sanitizeOutboundString(fact.factId) || `fact:item-${index}`;
      const cleanSummary =
        sanitizeOutboundString(fact.summary) || cleanFactId;
      const dieCount = Math.max(1, Math.trunc(fact.dieIndices.length));

      const metrics: FormattedFactMetric[] = fact.metrics.map((m, mIdx) => ({
        key: sanitizeOutboundString(m.key) || `metric_${mIdx}`,
        numericValue: Number.isFinite(m.numericValue) ? m.numericValue : 0,
        displayValue: sanitizeOutboundString(m.displayValue),
        tolerance:
          Number.isFinite(m.tolerance) && m.tolerance >= 0 ? m.tolerance : 0,
      }));

      const binRef = fact.binRef
        ? {
            mode: fact.binRef.mode,
            code: Math.max(0, Math.trunc(fact.binRef.code)),
            name: sanitizeOutboundString(fact.binRef.name),
          }
        : undefined;

      const testRef = fact.testRef
        ? {
            testNum: Math.max(0, Math.trunc(fact.testRef.testNum)),
            testName: sanitizeOutboundString(fact.testRef.testName),
          }
        : undefined;

      const siteRef = fact.siteRef
        ? {
            headNum: Math.max(0, Math.trunc(fact.siteRef.headNum)),
            siteNum: Math.max(0, Math.trunc(fact.siteRef.siteNum)),
          }
        : undefined;

      const waferRef = fact.waferRef
        ? {
            waferIndex: Math.max(0, Math.trunc(fact.waferRef.waferIndex)),
            waferId: sanitizeOutboundString(fact.waferRef.waferId),
          }
        : undefined;

      const hypotheses = fact.hypotheses
        ? fact.hypotheses
            .map((h) => sanitizeOutboundString(h))
            .filter((h) => h.length > 0)
        : undefined;

      return {
        factId: cleanFactId,
        kind: fact.kind,
        summary: cleanSummary,
        dieCount,
        metrics,
        ...(binRef !== undefined ? { binRef } : {}),
        ...(testRef !== undefined ? { testRef } : {}),
        ...(siteRef !== undefined ? { siteRef } : {}),
        ...(waferRef !== undefined ? { waferRef } : {}),
        ...(hypotheses !== undefined ? { hypotheses } : {}),
      };
    },
  );

  return {
    mode: 'narrate',
    lotId: cleanLotId,
    verdict: cleanVerdict,
    confidence: clampedConfidence,
    outboundFacts,
  };
}

function deepScanForPrivacyViolations(
  value: unknown,
  path: string,
  depth = 0,
): string | null {
  if (depth > 16) {
    return 'Payload nesting depth exceeds maximum allowed limit.';
  }

  if (isBinaryBufferOrView(value)) {
    return `${PRIVACY_VIOLATION_PREFIX} binary buffer or TypedArray view at "${path}" is forbidden.`;
  }

  if (typeof value === 'string') {
    if (CANONICAL_DIE_ID_REGEX.test(value)) {
      return `${PRIVACY_VIOLATION_PREFIX} canonical DieId token detected at "${path}".`;
    }
    if (
      hasRawStdfFarBytes(value) ||
      STDF_FAR_HEX_REGEX.test(value) ||
      STDF_FAR_BASE64_REGEX.test(value)
    ) {
      return `${PRIVACY_VIOLATION_PREFIX} STDF FAR signature detected at "${path}".`;
    }
    return null;
  }

  if (Array.isArray(value)) {
    if (value.length > 0 && value.every((item) => typeof item === 'number')) {
      return `${PRIVACY_VIOLATION_PREFIX} numeric coordinate, measurement, or byte array at "${path}" is forbidden.`;
    }
    for (let i = 0; i < value.length; i += 1) {
      const err = deepScanForPrivacyViolations(
        value[i],
        `${path}[${i}]`,
        depth + 1,
      );
      if (err !== null) {
        return err;
      }
    }
    return null;
  }

  if (typeof value === 'object' && value !== null) {
    if (!isPlainObject(value)) {
      return `${PRIVACY_VIOLATION_PREFIX} non-plain object instance at "${path}" is forbidden.`;
    }

    if (value.type === 'Buffer' && Array.isArray(value.data)) {
      return `${PRIVACY_VIOLATION_PREFIX} serialized Buffer object at "${path}" is forbidden.`;
    }

    for (const key of Object.keys(value)) {
      if (FORBIDDEN_PRIVACY_KEYS.has(key)) {
        return `${PRIVACY_VIOLATION_PREFIX} forbidden per-die or binary property "${key}" at "${path}.${key}".`;
      }
      const err = deepScanForPrivacyViolations(
        value[key],
        `${path}.${key}`,
        depth + 1,
      );
      if (err !== null) {
        return err;
      }
    }
  }

  return null;
}

function validateAllowedKeys(
  obj: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  required: readonly string[],
  context: string,
): string | null {
  const keys = Object.keys(obj);
  for (const key of keys) {
    if (!allowed.has(key)) {
      return `Unexpected property "${key}" in ${context}.`;
    }
  }
  for (const reqKey of required) {
    if (!(reqKey in obj) || obj[reqKey] === undefined) {
      return `Missing required property "${reqKey}" in ${context}.`;
    }
  }
  return null;
}

/**
 * Zero-dependency inbound request schema validator (replaces zod).
 * Used by client tests and `src/app/api/autopsy/narrate/route.ts`.
 */
export function validateNarrateRequestSchema(
  body: unknown,
): Result<NarrateRequestPayload, string> {
  if (isBinaryBufferOrView(body)) {
    return {
      ok: false,
      error: `${PRIVACY_VIOLATION_PREFIX} top-level binary buffer or TypedArray view is forbidden.`,
    };
  }

  if (!isPlainObject(body)) {
    return {
      ok: false,
      error: 'Narrate request payload must be a JSON object.',
    };
  }

  const privacyError = deepScanForPrivacyViolations(body, 'body');
  if (privacyError !== null) {
    return { ok: false, error: privacyError };
  }

  const topKeyError = validateAllowedKeys(
    body,
    TOP_LEVEL_REQUEST_KEYS,
    ['mode', 'lotId', 'verdict', 'confidence', 'outboundFacts'],
    'NarrateRequestPayload',
  );
  if (topKeyError !== null) {
    return { ok: false, error: topKeyError };
  }

  if (body.mode !== 'narrate') {
    return {
      ok: false,
      error: 'NarrateRequestPayload.mode must equal "narrate".',
    };
  }

  if (typeof body.lotId !== 'string' || body.lotId.trim().length === 0) {
    return {
      ok: false,
      error: 'NarrateRequestPayload.lotId must be a non-empty string.',
    };
  }

  if (typeof body.verdict !== 'string' || body.verdict.trim().length === 0) {
    return {
      ok: false,
      error: 'NarrateRequestPayload.verdict must be a non-empty string.',
    };
  }

  if (
    typeof body.confidence !== 'number' ||
    !Number.isFinite(body.confidence) ||
    body.confidence < 0 ||
    body.confidence > 1
  ) {
    return {
      ok: false,
      error: 'NarrateRequestPayload.confidence must be a finite number in [0, 1].',
    };
  }

  if (!Array.isArray(body.outboundFacts)) {
    return {
      ok: false,
      error: 'NarrateRequestPayload.outboundFacts must be an array.',
    };
  }

  if (
    body.outboundFacts.length < 1 ||
    body.outboundFacts.length > MAX_OUTBOUND_FACTS
  ) {
    return {
      ok: false,
      error: `NarrateRequestPayload.outboundFacts length must be in [1, ${MAX_OUTBOUND_FACTS}].`,
    };
  }

  const validatedFacts: OutboundEngineFact[] = [];

  for (let i = 0; i < body.outboundFacts.length; i += 1) {
    const rawFact = body.outboundFacts[i];
    const ctx = `outboundFacts[${i}]`;
    if (!isPlainObject(rawFact)) {
      return { ok: false, error: `${ctx} must be an object.` };
    }

    const factKeyError = validateAllowedKeys(
      rawFact,
      OUTBOUND_FACT_ALLOWED_KEYS,
      ['factId', 'kind', 'summary', 'dieCount', 'metrics'],
      ctx,
    );
    if (factKeyError !== null) {
      return { ok: false, error: factKeyError };
    }

    if (
      typeof rawFact.factId !== 'string' ||
      rawFact.factId.trim().length === 0
    ) {
      return {
        ok: false,
        error: `${ctx}.factId must be a non-empty string.`,
      };
    }

    if (
      typeof rawFact.kind !== 'string' ||
      !VALID_FACT_KINDS.has(rawFact.kind as FactKind)
    ) {
      return {
        ok: false,
        error: `${ctx}.kind is not a valid FactKind.`,
      };
    }

    if (
      typeof rawFact.summary !== 'string' ||
      rawFact.summary.trim().length === 0
    ) {
      return {
        ok: false,
        error: `${ctx}.summary must be a non-empty string.`,
      };
    }

    if (
      typeof rawFact.dieCount !== 'number' ||
      !Number.isInteger(rawFact.dieCount) ||
      rawFact.dieCount < 1
    ) {
      return {
        ok: false,
        error: `${ctx}.dieCount must be an integer >= 1.`,
      };
    }

    if (!Array.isArray(rawFact.metrics)) {
      return {
        ok: false,
        error: `${ctx}.metrics must be an array.`,
      };
    }

    const validatedMetrics: FormattedFactMetric[] = [];
    for (let m = 0; m < rawFact.metrics.length; m += 1) {
      const rawMetric = rawFact.metrics[m];
      const mCtx = `${ctx}.metrics[${m}]`;
      if (!isPlainObject(rawMetric)) {
        return { ok: false, error: `${mCtx} must be an object.` };
      }

      const metricKeyError = validateAllowedKeys(
        rawMetric,
        METRIC_ALLOWED_KEYS,
        ['key', 'numericValue', 'displayValue', 'tolerance'],
        mCtx,
      );
      if (metricKeyError !== null) {
        return { ok: false, error: metricKeyError };
      }

      if (
        typeof rawMetric.key !== 'string' ||
        rawMetric.key.trim().length === 0
      ) {
        return {
          ok: false,
          error: `${mCtx}.key must be a non-empty string.`,
        };
      }

      if (
        typeof rawMetric.numericValue !== 'number' ||
        !Number.isFinite(rawMetric.numericValue)
      ) {
        return {
          ok: false,
          error: `${mCtx}.numericValue must be a finite number.`,
        };
      }

      if (typeof rawMetric.displayValue !== 'string') {
        return {
          ok: false,
          error: `${mCtx}.displayValue must be a string.`,
        };
      }

      if (
        typeof rawMetric.tolerance !== 'number' ||
        !Number.isFinite(rawMetric.tolerance) ||
        rawMetric.tolerance < 0
      ) {
        return {
          ok: false,
          error: `${mCtx}.tolerance must be a finite number >= 0.`,
        };
      }

      validatedMetrics.push({
        key: rawMetric.key,
        numericValue: rawMetric.numericValue,
        displayValue: rawMetric.displayValue,
        tolerance: rawMetric.tolerance,
      });
    }

    let binRef: OutboundEngineFact['binRef'];
    if (rawFact.binRef !== undefined) {
      if (!isPlainObject(rawFact.binRef)) {
        return { ok: false, error: `${ctx}.binRef must be an object.` };
      }
      const binKeyErr = validateAllowedKeys(
        rawFact.binRef,
        BIN_REF_ALLOWED_KEYS,
        ['mode', 'code', 'name'],
        `${ctx}.binRef`,
      );
      if (binKeyErr !== null) {
        return { ok: false, error: binKeyErr };
      }
      if (rawFact.binRef.mode !== 'SBIN' && rawFact.binRef.mode !== 'HBIN') {
        return {
          ok: false,
          error: `${ctx}.binRef.mode must be "SBIN" or "HBIN".`,
        };
      }
      if (
        typeof rawFact.binRef.code !== 'number' ||
        !Number.isInteger(rawFact.binRef.code) ||
        rawFact.binRef.code < 0
      ) {
        return {
          ok: false,
          error: `${ctx}.binRef.code must be a non-negative integer.`,
        };
      }
      if (typeof rawFact.binRef.name !== 'string') {
        return {
          ok: false,
          error: `${ctx}.binRef.name must be a string.`,
        };
      }
      binRef = {
        mode: rawFact.binRef.mode,
        code: rawFact.binRef.code,
        name: rawFact.binRef.name,
      };
    }

    let testRef: OutboundEngineFact['testRef'];
    if (rawFact.testRef !== undefined) {
      if (!isPlainObject(rawFact.testRef)) {
        return { ok: false, error: `${ctx}.testRef must be an object.` };
      }
      const testKeyErr = validateAllowedKeys(
        rawFact.testRef,
        TEST_REF_ALLOWED_KEYS,
        ['testNum', 'testName'],
        `${ctx}.testRef`,
      );
      if (testKeyErr !== null) {
        return { ok: false, error: testKeyErr };
      }
      if (
        typeof rawFact.testRef.testNum !== 'number' ||
        !Number.isInteger(rawFact.testRef.testNum) ||
        rawFact.testRef.testNum < 0
      ) {
        return {
          ok: false,
          error: `${ctx}.testRef.testNum must be a non-negative integer.`,
        };
      }
      if (typeof rawFact.testRef.testName !== 'string') {
        return {
          ok: false,
          error: `${ctx}.testRef.testName must be a string.`,
        };
      }
      testRef = {
        testNum: rawFact.testRef.testNum,
        testName: rawFact.testRef.testName,
      };
    }

    let siteRef: OutboundEngineFact['siteRef'];
    if (rawFact.siteRef !== undefined) {
      if (!isPlainObject(rawFact.siteRef)) {
        return { ok: false, error: `${ctx}.siteRef must be an object.` };
      }
      const siteKeyErr = validateAllowedKeys(
        rawFact.siteRef,
        SITE_REF_ALLOWED_KEYS,
        ['headNum', 'siteNum'],
        `${ctx}.siteRef`,
      );
      if (siteKeyErr !== null) {
        return { ok: false, error: siteKeyErr };
      }
      if (
        typeof rawFact.siteRef.headNum !== 'number' ||
        !Number.isInteger(rawFact.siteRef.headNum) ||
        rawFact.siteRef.headNum < 0 ||
        typeof rawFact.siteRef.siteNum !== 'number' ||
        !Number.isInteger(rawFact.siteRef.siteNum) ||
        rawFact.siteRef.siteNum < 0
      ) {
        return {
          ok: false,
          error: `${ctx}.siteRef headNum and siteNum must be non-negative integers.`,
        };
      }
      siteRef = {
        headNum: rawFact.siteRef.headNum,
        siteNum: rawFact.siteRef.siteNum,
      };
    }

    let waferRef: OutboundEngineFact['waferRef'];
    if (rawFact.waferRef !== undefined) {
      if (!isPlainObject(rawFact.waferRef)) {
        return { ok: false, error: `${ctx}.waferRef must be an object.` };
      }
      const waferKeyErr = validateAllowedKeys(
        rawFact.waferRef,
        WAFER_REF_ALLOWED_KEYS,
        ['waferIndex', 'waferId'],
        `${ctx}.waferRef`,
      );
      if (waferKeyErr !== null) {
        return { ok: false, error: waferKeyErr };
      }
      if (
        typeof rawFact.waferRef.waferIndex !== 'number' ||
        !Number.isInteger(rawFact.waferRef.waferIndex) ||
        rawFact.waferRef.waferIndex < 0 ||
        typeof rawFact.waferRef.waferId !== 'string'
      ) {
        return {
          ok: false,
          error: `${ctx}.waferRef waferIndex and waferId are invalid.`,
        };
      }
      waferRef = {
        waferIndex: rawFact.waferRef.waferIndex,
        waferId: rawFact.waferRef.waferId,
      };
    }

    let hypotheses: OutboundEngineFact['hypotheses'];
    if (rawFact.hypotheses !== undefined) {
      if (
        !Array.isArray(rawFact.hypotheses) ||
        !rawFact.hypotheses.every((h) => typeof h === 'string')
      ) {
        return {
          ok: false,
          error: `${ctx}.hypotheses must be an array of strings.`,
        };
      }
      hypotheses = rawFact.hypotheses;
    }

    validatedFacts.push({
      factId: rawFact.factId,
      kind: rawFact.kind as FactKind,
      summary: rawFact.summary,
      dieCount: rawFact.dieCount,
      metrics: validatedMetrics,
      ...(binRef !== undefined ? { binRef } : {}),
      ...(testRef !== undefined ? { testRef } : {}),
      ...(siteRef !== undefined ? { siteRef } : {}),
      ...(waferRef !== undefined ? { waferRef } : {}),
      ...(hypotheses !== undefined ? { hypotheses } : {}),
    });
  }

  return {
    ok: true,
    value: {
      mode: 'narrate',
      lotId: body.lotId,
      verdict: body.verdict,
      confidence: body.confidence,
      outboundFacts: validatedFacts,
    },
  };
}

const RESPONSE_ALLOWED_KEYS: ReadonlySet<string> = new Set<string>(['claims']);
const CLAIM_ALLOWED_KEYS: ReadonlySet<string> = new Set<string>([
  'id',
  'text',
  'citedFactIds',
]);

/**
 * Zero-dependency response schema validator for `{ claims: [{ id, text, citedFactIds }] }`.
 */
export function validateNarrateResponseSchema(
  body: unknown,
): Result<NarrateSuccessResponse, string> {
  if (!isPlainObject(body)) {
    return {
      ok: false,
      error: 'Narrate response payload must be a JSON object.',
    };
  }

  const topKeyErr = validateAllowedKeys(
    body,
    RESPONSE_ALLOWED_KEYS,
    ['claims'],
    'NarrateSuccessResponse',
  );
  if (topKeyErr !== null) {
    return { ok: false, error: topKeyErr };
  }

  if (!Array.isArray(body.claims)) {
    return {
      ok: false,
      error: 'NarrateSuccessResponse.claims must be an array.',
    };
  }

  if (
    body.claims.length < MIN_CANDIDATE_CLAIMS ||
    body.claims.length > MAX_CANDIDATE_CLAIMS
  ) {
    return {
      ok: false,
      error: `NarrateSuccessResponse.claims length must be in [${MIN_CANDIDATE_CLAIMS}, ${MAX_CANDIDATE_CLAIMS}].`,
    };
  }

  const validatedClaims: LlmCandidateClaim[] = [];

  for (let i = 0; i < body.claims.length; i += 1) {
    const rawClaim = body.claims[i];
    const ctx = `claims[${i}]`;
    if (!isPlainObject(rawClaim)) {
      return { ok: false, error: `${ctx} must be an object.` };
    }

    const claimKeyErr = validateAllowedKeys(
      rawClaim,
      CLAIM_ALLOWED_KEYS,
      ['id', 'text', 'citedFactIds'],
      ctx,
    );
    if (claimKeyErr !== null) {
      return { ok: false, error: claimKeyErr };
    }

    if (typeof rawClaim.id !== 'string' || rawClaim.id.trim().length === 0) {
      return {
        ok: false,
        error: `${ctx}.id must be a non-empty string.`,
      };
    }

    if (typeof rawClaim.text !== 'string') {
      return {
        ok: false,
        error: `${ctx}.text must be a string.`,
      };
    }

    if (/[<>]/.test(rawClaim.text)) {
      return {
        ok: false,
        error: `${ctx}.text contains forbidden HTML angle brackets.`,
      };
    }

    if (FORBIDDEN_HORROR_TERMS_REGEX.test(rawClaim.text)) {
      return {
        ok: false,
        error: `${ctx}.text contains forbidden horror vocabulary.`,
      };
    }

    const trimmedText = rawClaim.text.trim();
    if (
      trimmedText.length < 1 ||
      trimmedText.length > MAX_CLAIM_TEXT_LENGTH
    ) {
      return {
        ok: false,
        error: `${ctx}.text trimmed length must be in [1, ${MAX_CLAIM_TEXT_LENGTH}].`,
      };
    }

    if (
      !Array.isArray(rawClaim.citedFactIds) ||
      rawClaim.citedFactIds.length < 1
    ) {
      return {
        ok: false,
        error: `${ctx}.citedFactIds must be a non-empty array of fact IDs.`,
      };
    }

    const citedFactIds: string[] = [];
    for (let f = 0; f < rawClaim.citedFactIds.length; f += 1) {
      const fid = rawClaim.citedFactIds[f];
      if (typeof fid !== 'string' || fid.trim().length === 0) {
        return {
          ok: false,
          error: `${ctx}.citedFactIds[${f}] must be a non-empty string.`,
        };
      }
      citedFactIds.push(fid.trim());
    }

    validatedClaims.push({
      id: rawClaim.id.trim(),
      text: trimmedText,
      citedFactIds,
    });
  }

  return {
    ok: true,
    value: { claims: validatedClaims },
  };
}

/**
 * Masks SBIN/HBIN/Test/Site/Wafer identifiers (plus `outer 3 rings` / `3-die band`
 * when a spatial fact is cited) and extracts all numeric literals from claim prose.
 */
export function extractNumbersFromClaimText(
  text: string,
  citedFacts?: readonly EngineFact[],
): readonly number[] {
  let preMasked = text;
  const facts = citedFacts ?? [];
  let citesSpatialFact = false;

  for (const fact of facts) {
    if (fact.kind === 'spatial-pattern' || fact.kind === 'wafer-excursion') {
      citesSpatialFact = true;
    }

    if (fact.testRef) {
      const cleanName = sanitizeReportProseText(fact.testRef.testName);
      if (cleanName.length > 0) {
        preMasked = preMasked
          .split(`Test ${fact.testRef.testNum} (${cleanName})`)
          .join('TEST_ID');
        preMasked = preMasked
          .split(`Test ${fact.testRef.testNum} ${cleanName}`)
          .join('TEST_ID');
        preMasked = preMasked
          .split(`${fact.testRef.testNum} ${cleanName}`)
          .join('TEST_ID');
        if (/[A-Za-z]/.test(cleanName)) {
          preMasked = preMasked.split(cleanName).join('TEST_NAME');
        }
      }
      preMasked = preMasked
        .split(`Test ${fact.testRef.testNum}`)
        .join('TEST_ID');
    }

    if (fact.binRef) {
      const cleanName = sanitizeReportProseText(fact.binRef.name);
      if (cleanName.length > 0) {
        preMasked = preMasked
          .split(`${fact.binRef.mode} ${fact.binRef.code} (${cleanName})`)
          .join('BIN_ID');
        preMasked = preMasked
          .split(`${fact.binRef.mode} ${fact.binRef.code} ${cleanName}`)
          .join('BIN_ID');
        if (/[A-Za-z]/.test(cleanName)) {
          preMasked = preMasked.split(cleanName).join('BIN_NAME');
        }
      }
      preMasked = preMasked
        .split(`${fact.binRef.mode} ${fact.binRef.code}`)
        .join('BIN_ID');
    }

    if (fact.waferRef) {
      const cleanWf =
        sanitizeReportProseText(fact.waferRef.waferId) ||
        `W${String(fact.waferRef.waferIndex + 1).padStart(2, '0')}`;
      preMasked = preMasked.split(`Wafer ${cleanWf}`).join('WAFER_ID');
      if (/[A-Za-z]/.test(cleanWf)) {
        preMasked = preMasked.split(cleanWf).join('WAFER_ID');
      }
    }
  }

  let masked = preMasked
    .replace(/\b(?:SBIN|HBIN)\s+\d+(?:\s*\([^)]*\))?/gi, 'BIN_ID')
    .replace(/\bTest\s+\d+(?:\s*\([^)]*\))?/gi, 'TEST_ID')
    .replace(/\bHead\s+\d+\s+Site\s+\d+(?:\s*\(\d+:\d+\))?/gi, 'SITE_ID')
    .replace(/\bSite\s+\d+:\d+/gi, 'SITE_ID')
    .replace(/\bSite\s+\d+/gi, 'SITE_ID')
    .replace(/\bWafer\s+[A-Za-z0-9_-]+/gi, 'WAFER_ID');

  if (citesSpatialFact) {
    masked = masked
      .replace(/\bouter\s+3(?:-|\s+)rings?\b/gi, 'OUTER_RING_BAND')
      .replace(/\b(?:outer\s+)?3-die\s+band\b/gi, 'OUTER_RING_BAND');
  }

  const matches = masked.match(
    /(?<![A-Za-z0-9])-?\d[\d,]*(?:\.\d+)?(?:[eE][+-]?\d+)?|\d[\d,]*(?:\.\d+)?(?:[eE][+-]?\d+)?/g,
  );
  if (!matches) {
    return [];
  }

  const extracted: number[] = [];
  for (const token of matches) {
    const num = Number(token.replace(/,/g, ''));
    if (Number.isFinite(num)) {
      extracted.push(num);
    }
  }
  return extracted;
}

function getFactMetricNumber(
  fact: EngineFact,
  key: string,
  fallback = 0,
): number {
  const found = fact.metrics.find((m) => m.key === key);
  return found ? found.numericValue : fallback;
}

function deriveFallbackClaimSpecFromFact(fact: EngineFact): {
  readonly messageKey: MessageKey;
  readonly subMessageKey: MessageKey;
  readonly params: ClaimParams;
} {
  switch (fact.kind) {
    case 'spatial-pattern': {
      const edgeBandFails = getFactMetricNumber(fact, 'edgeBandFailDies', 0);
      const sigWafers = getFactMetricNumber(fact, 'signatureWaferCount', 1);
      const sigCount = getFactMetricNumber(
        fact,
        'signatureDieCount',
        fact.dieIndices.length,
      );
      if (edgeBandFails > 0) {
        return {
          messageKey: 'findings.edgeBand.headline',
          subMessageKey: 'findings.edgeBand.sub',
          params: {
            share: getFactMetricNumber(fact, 'edgeBandFailSharePct', 0) / 100,
            rings: 3,
            edgeRate:
              getFactMetricNumber(fact, 'edgeBandDieFailRatePct', 0) / 100,
            interiorRate:
              getFactMetricNumber(fact, 'interiorDieFailRatePct', 0) / 100,
            wafers: sigWafers,
            total: Math.max(1, sigWafers),
          },
        };
      }
      return {
        messageKey: 'findings.scratch.headline',
        subMessageKey: 'findings.scratch.sub',
        params: {
          wafers: sigWafers,
          dies: sigCount,
          share: getFactMetricNumber(fact, 'signatureFailSharePct', 0) / 100,
        },
      };
    }

    case 'dominant-bin': {
      const bin = fact.binRef ? formatCleanBinToken(fact.binRef) : 'HBIN 0';
      const dies = getFactMetricNumber(
        fact,
        'dieCount',
        fact.dieIndices.length,
      );
      return {
        messageKey: 'findings.dominantBin.headline',
        subMessageKey: 'findings.dominantBin.sub',
        params: {
          bin,
          dies,
          share: getFactMetricNumber(fact, 'shareOfFailuresPct', 0) / 100,
        },
      };
    }

    case 'secondary-bin': {
      const bin = fact.binRef ? formatCleanBinToken(fact.binRef) : 'HBIN 0';
      const dies = getFactMetricNumber(
        fact,
        'dieCount',
        fact.dieIndices.length,
      );
      return {
        messageKey: 'findings.secondaryBin.headline',
        subMessageKey: 'findings.secondaryBin.sub',
        params: {
          bin,
          dies,
          share: getFactMetricNumber(fact, 'shareOfFailuresPct', 0) / 100,
          wafers: 1,
        },
      };
    }

    case 'parametric-capability': {
      const testNum = fact.testRef?.testNum ?? 0;
      const testName = sanitizeReportProseText(fact.testRef?.testName ?? '');
      const test = testName.length > 0 ? `${testNum} ${testName}` : `${testNum}`;
      return {
        messageKey: 'findings.capability.headline',
        subMessageKey: 'findings.capability.sub',
        params: {
          test,
          testNum,
          testName,
          cpk: getFactMetricNumber(fact, 'cpk', 0),
          mean: getFactMetricNumber(fact, 'mean', 0),
          hasLo: 0,
          lo: 0,
          hasHi: 0,
          hi: 0,
          units: '',
          resScal: 0,
          llmScal: 0,
          hlmScal: 0,
        },
      };
    }

    case 'site-anomaly': {
      const headNum = fact.siteRef?.headNum ?? 1;
      const siteNum = fact.siteRef?.siteNum ?? 1;
      const site = headNum === 1 ? siteNum : `${headNum}:${siteNum}`;
      const fpYieldPct = getFactMetricNumber(fact, 'firstPassYieldPct', 100);
      const otherFpYieldPct = getFactMetricNumber(
        fact,
        'otherSitesFirstPassYieldPct',
        100,
      );
      const siteFailRate = Math.min(0.999, Math.max(0.001, 1 - fpYieldPct / 100));
      const otherFailRate = Math.max(0, 1 - otherFpYieldPct / 100);
      const ratio =
        otherFailRate > 1e-4
          ? Math.max(1, siteFailRate / otherFailRate)
          : Math.max(1, siteFailRate * 100);
      return {
        messageKey: 'findings.site.headline',
        subMessageKey: 'findings.site.sub',
        params: {
          site,
          ratio,
          rate: siteFailRate,
          other: otherFailRate,
          retests: 0,
        },
      };
    }

    case 'wafer-excursion': {
      const wafer =
        sanitizeReportProseText(fact.waferRef?.waferId ?? '') ||
        `W${String((fact.waferRef?.waferIndex ?? 0) + 1).padStart(2, '0')}`;
      return {
        messageKey: 'findings.excursion.headline',
        subMessageKey: 'findings.excursion.sub',
        params: {
          wafer,
          yield: getFactMetricNumber(fact, 'waferFinalYieldPct', 0) / 100,
          delta: 0,
        },
      };
    }

    case 'lot-yield':
    case 'retest-recovery': {
      return {
        messageKey: 'findings.lotYield.headline',
        subMessageKey: 'findings.lotYield.sub',
        params: {
          yield: getFactMetricNumber(fact, 'finalYieldPct', 100) / 100,
          firstPass: getFactMetricNumber(fact, 'firstPassYieldPct', 100) / 100,
          retests: getFactMetricNumber(fact, 'retestedDies', 0),
        },
      };
    }
  }
}

function resolveInheritedMessageSpec(
  candidateClaimId: string,
  primaryFact: EngineFact,
  templateBodyClaims: readonly ReportClaim[],
): {
  readonly messageKey: MessageKey;
  readonly subMessageKey?: MessageKey;
  readonly params: ClaimParams;
} {
  const isNonHypothesisTemplateClaim = (bc: ReportClaim): boolean =>
    bc.claimId !== 'claim:root-cause-hypothesis' &&
    !bc.messageKey.startsWith('hypothesis.');

  // 1. Exact claimId match on non-hypothesis template body claims
  const byClaimId = templateBodyClaims.find(
    (bc) => bc.claimId === candidateClaimId && isNonHypothesisTemplateClaim(bc),
  );
  if (byClaimId) {
    return {
      messageKey: byClaimId.messageKey,
      ...(byClaimId.subMessageKey !== undefined
        ? { subMessageKey: byClaimId.subMessageKey }
        : {}),
      params: byClaimId.params,
    };
  }

  // 2. Primary citedFactIds[0] match on non-hypothesis template body claims
  const byPrimaryFact = templateBodyClaims.find(
    (bc) =>
      isNonHypothesisTemplateClaim(bc) &&
      (bc.citedFactIds[0] === primaryFact.factId ||
        bc.citedFactIds.includes(primaryFact.factId)),
  );
  if (byPrimaryFact) {
    return {
      messageKey: byPrimaryFact.messageKey,
      ...(byPrimaryFact.subMessageKey !== undefined
        ? { subMessageKey: byPrimaryFact.subMessageKey }
        : {}),
      params: byPrimaryFact.params,
    };
  }

  // 3. Direct fallback from the primary cited EngineFact
  return deriveFallbackClaimSpecFromFact(primaryFact);
}

/**
 * Validates a candidate LLM narration payload against deterministic `EngineFact`s
 * and returns a verified `AutopsyReport` (`source: 'llm-verified'`) with
 * `templateReport.causeOfDeathHeadline` locked.
 */
export function validateLlmNarration(
  candidate: unknown,
  templateReport: AutopsyReport,
  factsById: ReadonlyMap<string, EngineFact>,
  totalLotDies: number,
): Result<AutopsyReport, string> {
  if (!Number.isInteger(totalLotDies) || totalLotDies <= 0) {
    return {
      ok: false,
      error: 'totalLotDies must be a positive integer.',
    };
  }

  // Step 1: Schema validation
  const schemaResult = validateNarrateResponseSchema(candidate);
  if (!schemaResult.ok) {
    return schemaResult;
  }

  const candidateClaims = schemaResult.value.claims;
  const validatedBodyClaims: ReportClaim[] = [];
  const usedClaimIds = new Set<string>([
    templateReport.causeOfDeathHeadline.claimId,
  ]);

  for (let cIdx = 0; cIdx < candidateClaims.length; cIdx += 1) {
    const candidateClaim = candidateClaims[cIdx]!;
    const ctx = `claims[${cIdx}] ("${candidateClaim.id}")`;

    // Step 2: Verify every cited factId exists and has valid in-bounds die indices and DieIds
    const dedupedFactIds: string[] = [];
    const seenFactIds = new Set<string>();
    const citedFacts: EngineFact[] = [];
    const dieIdByIndex = new Map<number, DieId>();

    for (const factId of candidateClaim.citedFactIds) {
      const fact = factsById.get(factId);
      if (!fact) {
        return {
          ok: false,
          error: `${ctx} cites unknown EngineFact ID "${factId}".`,
        };
      }

      if (
        !(fact.dieIndices instanceof Uint32Array) ||
        fact.dieIndices.length < 1
      ) {
        return {
          ok: false,
          error: `${ctx} cites EngineFact "${factId}" with empty dieIndices.`,
        };
      }

      if (
        !Array.isArray(fact.dieIds) ||
        fact.dieIds.length !== fact.dieIndices.length
      ) {
        return {
          ok: false,
          error: `${ctx} cites EngineFact "${factId}" with mismatched dieIds/dieIndices lengths.`,
        };
      }

      for (let i = 0; i < fact.dieIndices.length; i += 1) {
        const dieIdx = fact.dieIndices[i]!;
        if (
          !Number.isInteger(dieIdx) ||
          dieIdx < 0 ||
          dieIdx >= totalLotDies
        ) {
          return {
            ok: false,
            error: `${ctx} cites EngineFact "${factId}" containing out-of-range die index ${dieIdx} (totalLotDies=${totalLotDies}).`,
          };
        }
        const dieId = fact.dieIds[i];
        if (typeof dieId !== 'string' || dieId.trim().length === 0) {
          return {
            ok: false,
            error: `${ctx} cites EngineFact "${factId}" containing an invalid DieId at index ${i}.`,
          };
        }
        dieIdByIndex.set(dieIdx, dieId);
      }

      if (!seenFactIds.has(factId)) {
        seenFactIds.add(factId);
        dedupedFactIds.push(factId);
        citedFacts.push(fact);
      }
    }

    if (citedFacts.length === 0) {
      return {
        ok: false,
        error: `${ctx} must cite at least one valid EngineFact.`,
      };
    }

    const resolvedDieIndices = unionFactDieIndices(citedFacts, totalLotDies);
    if (resolvedDieIndices.length < 1) {
      return {
        ok: false,
        error: `${ctx} resolved to an empty die set.`,
      };
    }

    const resolvedDieIds: DieId[] = new Array<DieId>(resolvedDieIndices.length);
    for (let i = 0; i < resolvedDieIndices.length; i += 1) {
      const idx = resolvedDieIndices[i]!;
      const resolvedId = dieIdByIndex.get(idx);
      if (!resolvedId) {
        return {
          ok: false,
          error: `${ctx} failed to resolve DieId for die index ${idx}.`,
        };
      }
      resolvedDieIds[i] = resolvedId;
    }

    // Step 3: Extract numeric literals and verify every number matches a cited metric or dieCount
    const extractedNumbers = extractNumbersFromClaimText(
      candidateClaim.text,
      citedFacts,
    );

    for (const num of extractedNumbers) {
      let matched = false;
      for (const fact of citedFacts) {
        if (Math.abs(num - fact.dieIndices.length) <= 1e-9) {
          matched = true;
          break;
        }
        for (const metric of fact.metrics) {
          if (Math.abs(num - metric.numericValue) <= metric.tolerance + 1e-9) {
            matched = true;
            break;
          }
        }
        if (matched) {
          break;
        }
      }

      if (!matched) {
        return {
          ok: false,
          error: `${ctx} contains ungrounded numeric literal ${num} not matching any cited EngineFact metric within tolerance.`,
        };
      }
    }

    // Step 4: Build grounded ReportClaim
    const citedBins: Array<{ readonly mode: BinMode; readonly code: number }> =
      [];
    const seenBins = new Set<string>();
    const citedTestNums: number[] = [];
    const seenTests = new Set<number>();
    const citedSites: Array<{
      readonly headNum: number;
      readonly siteNum: number;
    }> = [];
    const seenSites = new Set<string>();

    for (const fact of citedFacts) {
      if (fact.binRef) {
        const key = `${fact.binRef.mode}:${fact.binRef.code}`;
        if (!seenBins.has(key)) {
          seenBins.add(key);
          citedBins.push({
            mode: fact.binRef.mode,
            code: fact.binRef.code,
          });
        }
      }
      if (fact.testRef && !seenTests.has(fact.testRef.testNum)) {
        seenTests.add(fact.testRef.testNum);
        citedTestNums.push(fact.testRef.testNum);
      }
      if (fact.siteRef) {
        const key = `${fact.siteRef.headNum}:${fact.siteRef.siteNum}`;
        if (!seenSites.has(key)) {
          seenSites.add(key);
          citedSites.push({
            headNum: fact.siteRef.headNum,
            siteNum: fact.siteRef.siteNum,
          });
        }
      }
    }

    let finalClaimId = candidateClaim.id;
    if (
      usedClaimIds.has(finalClaimId) ||
      finalClaimId === 'claim:root-cause-hypothesis'
    ) {
      finalClaimId = `claim:llm-${cIdx + 1}`;
    }
    usedClaimIds.add(finalClaimId);

    const inheritedSpec = resolveInheritedMessageSpec(
      candidateClaim.id,
      citedFacts[0]!,
      templateReport.bodyClaims,
    );

    validatedBodyClaims.push({
      claimId: finalClaimId,
      text: candidateClaim.text,
      isHeadline: false,
      messageKey: inheritedSpec.messageKey,
      ...(inheritedSpec.subMessageKey !== undefined
        ? { subMessageKey: inheritedSpec.subMessageKey }
        : {}),
      params: inheritedSpec.params,
      citedFactIds: dedupedFactIds,
      resolvedDieIndices,
      resolvedDieIds,
      citedBins,
      citedTestNums,
      citedSites,
    });
  }

  const { fallbackReason: _omitted, ...restTemplate } = templateReport;

  return {
    ok: true,
    value: {
      ...restTemplate,
      causeOfDeathHeadline: templateReport.causeOfDeathHeadline,
      bodyClaims: validatedBodyClaims,
      source: 'llm-verified',
    },
  };
}

/**
 * Returns validated `llm-verified` `AutopsyReport` on `ok`, or `templateReport`
 * unchanged on any validation failure.
 */
export function resolveNarratedReportOrFallback(
  candidate: unknown,
  templateReport: AutopsyReport,
  factsById: ReadonlyMap<string, EngineFact>,
  totalLotDies: number,
): AutopsyReport {
  const validated = validateLlmNarration(
    candidate,
    templateReport,
    factsById,
    totalLotDies,
  );
  return validated.ok ? validated.value : templateReport;
}

const DEFAULT_LLM_PROVIDER_URL =
  'https://api.openai.com/v1/chat/completions' as const;
const DEFAULT_LLM_MODEL = 'gpt-4o-mini' as const;

const SYSTEM_PROMPT = [
  'You are a clinical semiconductor yield failure analysis narrator for Chip Autopsy Lab.',
  'Rephrase ONLY the supporting body claims (1 to 4 concise clinical claims, each <= 320 chars) from the supplied aggregate EngineFacts.',
  'Rules:',
  '1. Every claim MUST cite at least one valid factId from outboundFacts in citedFactIds.',
  '2. Every number in claim.text MUST match a metric displayValue/numericValue or dieCount in its cited facts.',
  '3. Never emit HTML tags (< or >), markdown headings, exclamation marks, or Halloween/horror words.',
  '4. Return strict JSON matching: { "claims": [{ "id": string, "text": string, "citedFactIds": [string] }] }.',
].join('\n');

function extractCandidateFromUpstreamJson(
  upstreamJson: unknown,
): Result<unknown, string> {
  if (!isPlainObject(upstreamJson)) {
    return {
      ok: false,
      error: 'Upstream LLM response must be a JSON object.',
    };
  }

  if ('claims' in upstreamJson) {
    return { ok: true, value: upstreamJson };
  }

  // OpenAI Chat Completions format: { choices: [{ message: { content: string | object } }] }
  if (
    Array.isArray(upstreamJson.choices) &&
    upstreamJson.choices.length > 0 &&
    isPlainObject(upstreamJson.choices[0])
  ) {
    const firstChoice = upstreamJson.choices[0];
    const message = isPlainObject(firstChoice.message)
      ? firstChoice.message
      : null;
    const rawContent = message ? message.content : firstChoice.text;
    if (typeof rawContent === 'string') {
      try {
        return { ok: true, value: JSON.parse(rawContent) };
      } catch {
        return {
          ok: false,
          error: 'Upstream LLM choice content was not valid JSON.',
        };
      }
    }
    if (isPlainObject(rawContent)) {
      return { ok: true, value: rawContent };
    }
  }

  // Anthropic Messages format: { content: [{ text: string | object }] }
  if (
    Array.isArray(upstreamJson.content) &&
    upstreamJson.content.length > 0 &&
    isPlainObject(upstreamJson.content[0])
  ) {
    const firstBlock = upstreamJson.content[0];
    if (typeof firstBlock.text === 'string') {
      try {
        return { ok: true, value: JSON.parse(firstBlock.text) };
      } catch {
        return {
          ok: false,
          error: 'Upstream LLM content block text was not valid JSON.',
        };
      }
    }
    if (isPlainObject(firstBlock.text)) {
      return { ok: true, value: firstBlock.text };
    }
  }

  return { ok: true, value: upstreamJson };
}

/**
 * Pure server-side `POST /api/autopsy/narrate` handler enforcing:
 * 1. Inbound privacy & schema gate (`HTTP 400`)
 * 2. Server-only `LLM_API_KEY` check (`HTTP 503`)
 * 3. Upstream call (`<= 3500 ms`) & response schema validation (`HTTP 200` / `HTTP 502`)
 */
export async function handleNarratePostRequest(
  request: Request,
): Promise<Response> {
  // Step 1: Inbound Privacy Gate (runs first before reading any env key or network)
  let parsedBody: unknown;
  try {
    const rawText = await request.text();
    if (rawText.trim().length === 0) {
      return Response.json(
        {
          reason: 'invalid_payload',
          detail: 'Request body must be a non-empty JSON object.',
        } satisfies NarrateErrorResponse,
        { status: 400 },
      );
    }
    parsedBody = JSON.parse(rawText);
  } catch {
    return Response.json(
      {
        reason: 'invalid_payload',
        detail: 'Request body must be valid JSON.',
      } satisfies NarrateErrorResponse,
      { status: 400 },
    );
  }

  const validRequest = validateNarrateRequestSchema(parsedBody);
  if (!validRequest.ok) {
    const reason: NarrateErrorReason = isPrivacyViolationError(
      validRequest.error,
    )
      ? 'privacy_violation'
      : 'invalid_payload';
    return Response.json(
      {
        reason,
        detail: validRequest.error,
      } satisfies NarrateErrorResponse,
      { status: 400 },
    );
  }

  // Step 2: Server-Only Key Check (never NEXT_PUBLIC_)
  const apiKey = process.env.LLM_API_KEY?.trim() ?? '';
  if (apiKey.length === 0) {
    return Response.json(
      {
        reason: 'llm_unconfigured',
      } satisfies NarrateErrorResponse,
      { status: 503 },
    );
  }

  // Step 3: Upstream Call & Output Validation
  const providerUrl =
    process.env.LLM_PROVIDER_URL?.trim() || DEFAULT_LLM_PROVIDER_URL;
  const model = process.env.LLM_MODEL?.trim() || DEFAULT_LLM_MODEL;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort();
  }, NARRATE_SERVER_TIMEOUT_MS);

  let upstreamResponse: Response;
  try {
    upstreamResponse = await fetch(providerUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: JSON.stringify(validRequest.value) },
        ],
      }),
      signal: controller.signal,
    });
  } catch (err) {
    const detail =
      err instanceof Error ? err.message : 'Upstream LLM request failed.';
    return Response.json(
      {
        reason: 'upstream_error',
        detail,
      } satisfies NarrateErrorResponse,
      { status: 502 },
    );
  } finally {
    clearTimeout(timeoutId);
  }

  if (!upstreamResponse.ok) {
    return Response.json(
      {
        reason: 'upstream_error',
        detail: `Upstream provider returned HTTP ${upstreamResponse.status}.`,
      } satisfies NarrateErrorResponse,
      { status: 502 },
    );
  }

  let upstreamJson: unknown;
  try {
    upstreamJson = await upstreamResponse.json();
  } catch {
    return Response.json(
      {
        reason: 'invalid_llm_output',
        detail: 'Upstream provider response was not valid JSON.',
      } satisfies NarrateErrorResponse,
      { status: 502 },
    );
  }

  const extracted = extractCandidateFromUpstreamJson(upstreamJson);
  if (!extracted.ok) {
    return Response.json(
      {
        reason: 'invalid_llm_output',
        detail: extracted.error,
      } satisfies NarrateErrorResponse,
      { status: 502 },
    );
  }

  const validatedOutput = validateNarrateResponseSchema(extracted.value);
  if (!validatedOutput.ok) {
    return Response.json(
      {
        reason: 'invalid_llm_output',
        detail: validatedOutput.error,
      } satisfies NarrateErrorResponse,
      { status: 502 },
    );
  }

  return Response.json(
    {
      claims: validatedOutput.value.claims,
    } satisfies NarrateSuccessResponse,
    { status: 200 },
  );
}
