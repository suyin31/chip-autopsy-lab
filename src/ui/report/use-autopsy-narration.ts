'use client';

import * as React from 'react';
import type { Locale } from '@/core/i18n';
import type { LotModel } from '@/core/model';
import type {
  AutopsyReport,
  AutopsyVerdictDecision,
  EngineFact,
} from '@/core/report';
import {
  NARRATE_CLIENT_TIMEOUT_MS,
  type NarrateRequestPayload,
  sanitizeOutboundNarratePayload,
  validateLlmNarration,
} from '@/core/report/citation-validator';

export const AUTOPSY_NARRATE_ENDPOINT = '/api/autopsy/narrate' as const;

/**
 * Client-safe check for an explicit public opt-in flag (`NEXT_PUBLIC_NARRATION_ENABLED`).
 * Defaults to `false` when unset so unconfigured deployments never call `/api/autopsy/narrate`
 * (zero HTTP 503s and zero browser console errors; Requirements 10.6, 16.4).
 */
export function isPublicNarrationFlagEnabled(): boolean {
  const flag =
    typeof process !== 'undefined'
      ? process.env.NEXT_PUBLIC_NARRATION_ENABLED
      : undefined;
  return flag === 'true' || flag === '1';
}

export type NarrationStatus = 'idle' | 'loading' | 'verified' | 'fallback';

export type NarrationStatusMessageKey =
  | 'verdict.narration.loading'
  | 'verdict.narration.verified'
  | 'verdict.narration.fallback';

export interface RequestAutopsyNarrationOptions {
  readonly lot: LotModel;
  readonly templateReport: AutopsyReport;
  readonly verdict: Pick<AutopsyVerdictDecision, 'verdict' | 'confidence'>;
  readonly facts: readonly EngineFact[];
  readonly endpoint?: string;
  readonly timeoutMs?: number;
  readonly fetchImpl?: typeof fetch;
  readonly signal?: AbortSignal;
}

export interface AutopsyNarrationOutcome {
  readonly report: AutopsyReport;
  readonly status: 'verified' | 'fallback';
  readonly fallbackReason?: string;
  readonly payload?: NarrateRequestPayload;
}

export interface UseAutopsyNarrationOptions {
  readonly lot: LotModel;
  readonly templateReport: AutopsyReport;
  readonly verdict?: Pick<AutopsyVerdictDecision, 'verdict' | 'confidence'>;
  readonly facts?: readonly EngineFact[];
  readonly locale: Locale;
  /** Defaults to `isPublicNarrationFlagEnabled()` (`false` when unconfigured). */
  readonly enabled?: boolean;
  readonly endpoint?: string;
  readonly timeoutMs?: number;
  readonly fetchImpl?: typeof fetch;
}

export interface AutopsyNarrationState {
  readonly report: AutopsyReport;
  readonly status: NarrationStatus;
  readonly fallbackReason?: string;
}

/**
 * Maps a client narration status to its localized status message key (`null` when `idle`).
 */
export function resolveNarrationStatusKey(
  status: NarrationStatus,
): NarrationStatusMessageKey | null {
  switch (status) {
    case 'loading':
      return 'verdict.narration.loading';
    case 'verified':
      return 'verdict.narration.verified';
    case 'fallback':
      return 'verdict.narration.fallback';
    default:
      return null;
  }
}

/**
 * Requests optional LLM narration from `POST /api/autopsy/narrate` using exclusively
 * privacy-safe aggregate `OutboundEngineFact`s (`sanitizeOutboundNarratePayload`),
 * enforcing a 4 s `AbortController` timeout and client-side citation + numeric
 * validation (`validateLlmNarration`). Never throws and never returns unverified text.
 */
export async function requestAutopsyNarration({
  lot,
  templateReport,
  verdict,
  facts,
  endpoint = AUTOPSY_NARRATE_ENDPOINT,
  timeoutMs = NARRATE_CLIENT_TIMEOUT_MS,
  fetchImpl,
  signal,
}: RequestAutopsyNarrationOptions): Promise<AutopsyNarrationOutcome> {
  if (templateReport.source === 'llm-verified') {
    return { report: templateReport, status: 'verified' };
  }

  if (facts.length === 0) {
    return {
      report: templateReport,
      status: 'fallback',
      fallbackReason: 'no_facts',
    };
  }

  if (signal?.aborted) {
    return {
      report: templateReport,
      status: 'fallback',
      fallbackReason: 'aborted',
    };
  }

  if (
    fetchImpl === undefined &&
    typeof navigator !== 'undefined' &&
    navigator.onLine === false
  ) {
    return {
      report: templateReport,
      status: 'fallback',
      fallbackReason: 'offline',
    };
  }

  const fetchFn =
    fetchImpl ?? (typeof globalThis.fetch === 'function' ? globalThis.fetch : null);
  if (fetchFn === null) {
    return {
      report: templateReport,
      status: 'fallback',
      fallbackReason: 'fetch_unavailable',
    };
  }

  const payload = sanitizeOutboundNarratePayload(lot, verdict, facts);
  if (payload.outboundFacts.length === 0) {
    return {
      report: templateReport,
      status: 'fallback',
      fallbackReason: 'no_outbound_facts',
      payload,
    };
  }

  const controller = new AbortController();
  let timedOut = false;
  let timerId: ReturnType<typeof setTimeout> | null = null;
  let rejectAbort: ((reason: Error) => void) | null = null;

  const handleExternalAbort = (): void => {
    controller.abort();
    rejectAbort?.(new Error('aborted'));
  };

  if (signal) {
    signal.addEventListener('abort', handleExternalAbort, { once: true });
  }

  const abortRace = new Promise<never>((_resolve, reject) => {
    rejectAbort = reject;
    timerId = setTimeout(() => {
      timedOut = true;
      controller.abort();
      reject(new Error('timeout'));
    }, timeoutMs);
  });
  abortRace.catch(() => undefined);

  try {
    const fetchPromise = fetchFn(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    fetchPromise.catch(() => undefined);

    const response = await Promise.race([fetchPromise, abortRace]);

    if (!response.ok) {
      let reason = `http_${response.status}`;
      try {
        const errPromise = response.json();
        errPromise.catch(() => undefined);
        const errorBody = (await Promise.race([errPromise, abortRace])) as {
          readonly reason?: unknown;
        } | null;
        if (
          errorBody &&
          typeof errorBody === 'object' &&
          typeof errorBody.reason === 'string' &&
          errorBody.reason.length > 0
        ) {
          reason = errorBody.reason;
        }
      } catch {
        // Non-JSON error body: retain HTTP status fallback reason silently
      }
      return {
        report: templateReport,
        status: 'fallback',
        fallbackReason: reason,
        payload,
      };
    }

    let candidate: unknown;
    try {
      const jsonPromise = response.json();
      jsonPromise.catch(() => undefined);
      candidate = await Promise.race([jsonPromise, abortRace]);
    } catch {
      return {
        report: templateReport,
        status: 'fallback',
        fallbackReason: timedOut
          ? 'timeout'
          : signal?.aborted
            ? 'aborted'
            : 'invalid_json',
        payload,
      };
    }

    const factsById = new Map<string, EngineFact>();
    for (const fact of facts) {
      factsById.set(fact.factId, fact);
    }

    const validated = validateLlmNarration(
      candidate,
      templateReport,
      factsById,
      lot.dies.count,
    );
    if (validated.ok) {
      return {
        report: validated.value,
        status: 'verified',
        payload,
      };
    }

    return {
      report: templateReport,
      status: 'fallback',
      fallbackReason: validated.error,
      payload,
    };
  } catch {
    return {
      report: templateReport,
      status: 'fallback',
      fallbackReason: timedOut
        ? 'timeout'
        : signal?.aborted
          ? 'aborted'
          : 'network_error',
      payload,
    };
  } finally {
    if (timerId !== null) {
      clearTimeout(timerId);
    }
    if (signal) {
      signal.removeEventListener('abort', handleExternalAbort);
    }
  }
}

interface InternalNarrationState {
  readonly lot: LotModel;
  readonly templateReport: AutopsyReport;
  readonly locale: Locale;
  readonly report: AutopsyReport;
  readonly status: NarrationStatus;
  readonly fallbackReason?: string;
}

/**
 * Client hook that renders `templateReport` synchronously at `0 ms` and, when
 * `locale === 'en'` and `facts` are available, asynchronously requests optional
 * LLM narration via `POST /api/autopsy/narrate` with a 4 s abort timeout,
 * citation validation, and silent deterministic template fallback.
 */
export function useAutopsyNarration({
  lot,
  templateReport,
  verdict,
  facts,
  locale,
  enabled = isPublicNarrationFlagEnabled(),
  endpoint = AUTOPSY_NARRATE_ENDPOINT,
  timeoutMs = NARRATE_CLIENT_TIMEOUT_MS,
  fetchImpl,
}: UseAutopsyNarrationOptions): AutopsyNarrationState {
  const canNarrate =
    enabled &&
    locale === 'en' &&
    templateReport.source === 'deterministic-template' &&
    facts !== undefined &&
    facts.length > 0;

  const [state, setState] = React.useState<InternalNarrationState>(() => ({
    lot,
    templateReport,
    locale,
    report: templateReport,
    status: templateReport.source === 'llm-verified' ? 'verified' : 'idle',
  }));

  React.useEffect(() => {
    if (!canNarrate || !facts) {
      return;
    }

    const controller = new AbortController();
    let cancelled = false;

    setState({
      lot,
      templateReport,
      locale,
      report: templateReport,
      status: 'loading',
    });

    const effectiveVerdict = verdict ?? {
      verdict: templateReport.causeOfDeathHeadline.text,
      confidence: templateReport.confidence ?? 0,
    };

    void requestAutopsyNarration({
      lot,
      templateReport,
      verdict: effectiveVerdict,
      facts,
      endpoint,
      timeoutMs,
      ...(fetchImpl !== undefined ? { fetchImpl } : {}),
      signal: controller.signal,
    }).then((outcome) => {
      if (cancelled || controller.signal.aborted) {
        return;
      }
      setState({
        lot,
        templateReport,
        locale,
        report: outcome.report,
        status: outcome.status,
        ...(outcome.fallbackReason !== undefined
          ? { fallbackReason: outcome.fallbackReason }
          : {}),
      });
    });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [
    canNarrate,
    lot,
    templateReport,
    verdict,
    facts,
    locale,
    endpoint,
    timeoutMs,
    fetchImpl,
  ]);

  if (templateReport.source === 'llm-verified') {
    return { report: templateReport, status: 'verified' };
  }

  if (
    !canNarrate ||
    state.lot !== lot ||
    state.templateReport !== templateReport ||
    state.locale !== locale
  ) {
    return { report: templateReport, status: 'idle' };
  }

  return {
    report: state.report,
    status: state.status,
    ...(state.fallbackReason !== undefined
      ? { fallbackReason: state.fallbackReason }
      : {}),
  };
}
