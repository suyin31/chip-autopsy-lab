/**
 * Unit tests for `POST /api/autopsy/narrate`
 * (`src/core/report/narrate-route.test.ts`).
 *
 * Verifies:
 * - Step 1 (Inbound Privacy & Schema Gate): malformed JSON, unknown fields,
 *   empty/`> 64` facts, per-die coordinates/measurements/DieIds, or STDF FAR
 *   signatures return `HTTP 400` before touching env keys or network.
 * - Step 2 (Server-Only Key Check): missing/blank `LLM_API_KEY` returns
 *   `HTTP 503 { reason: 'llm_unconfigured' }` without reading any `NEXT_PUBLIC_` var.
 * - Step 3 (Upstream Call & Output Validation): mocked `fetch` valid JSON returns
 *   `HTTP 200 { claims }`; upstream HTTP error, network failure, or invalid LLM
 *   output schema returns `HTTP 502 { reason: 'upstream_error' | 'invalid_llm_output' }`.
 *
 * Validates: Requirements 10.5, 10.6, 16.1, 16.3, 16.4
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// eslint-disable-next-line no-restricted-imports
import { POST } from '../../app/api/autopsy/narrate/route';
import { generateDemoStdfBytes } from '../demo/demo-generator';
import { buildLotModel } from '../model/lot-builder';
import { parseStdfBytes } from '../stdf/stdf-parser';
import {
  MAX_OUTBOUND_FACTS,
  type NarrateErrorResponse,
  type NarrateRequestPayload,
  type NarrateSuccessResponse,
  sanitizeOutboundNarratePayload,
} from './citation-validator';
import { generateOfflineAutopsyReport } from './template-report';

function buildValidDemoNarratePayload(): NarrateRequestPayload {
  const bytes = generateDemoStdfBytes('edge-ring-etch');
  const parsed = parseStdfBytes(bytes, { mode: 'full' });
  if (!parsed.ok) {
    throw new Error(parsed.error.message);
  }
  const lot = buildLotModel(parsed.value);
  const { facts, verdict } = generateOfflineAutopsyReport(lot);
  return sanitizeOutboundNarratePayload(lot, verdict, facts);
}

function makeJsonRequest(body: unknown): Request {
  return new Request('http://localhost:3000/api/autopsy/narrate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

describe('POST /api/autopsy/narrate Route Handler', () => {
  const validPayload = buildValidDemoNarratePayload();
  const originalApiKey = process.env.LLM_API_KEY;
  const originalProviderUrl = process.env.LLM_PROVIDER_URL;
  const originalModel = process.env.LLM_MODEL;

  beforeEach(() => {
    delete process.env.LLM_API_KEY;
    delete process.env.LLM_PROVIDER_URL;
    delete process.env.LLM_MODEL;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    if (originalApiKey !== undefined) {
      process.env.LLM_API_KEY = originalApiKey;
    } else {
      delete process.env.LLM_API_KEY;
    }
    if (originalProviderUrl !== undefined) {
      process.env.LLM_PROVIDER_URL = originalProviderUrl;
    } else {
      delete process.env.LLM_PROVIDER_URL;
    }
    if (originalModel !== undefined) {
      process.env.LLM_MODEL = originalModel;
    } else {
      delete process.env.LLM_MODEL;
    }
  });

  it('returns HTTP 503 { reason: "llm_unconfigured" } when LLM_API_KEY is unset or blank without calling fetch', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const response = await POST(makeJsonRequest(validPayload));
    expect(response.status).toBe(503);

    const data = (await response.json()) as NarrateErrorResponse;
    expect(data).toEqual({ reason: 'llm_unconfigured' });
    expect(fetchSpy).not.toHaveBeenCalled();

    // Blank whitespace key is also treated as unconfigured
    process.env.LLM_API_KEY = '   ';
    const blankRes = await POST(makeJsonRequest(validPayload));
    expect(blankRes.status).toBe(503);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('returns HTTP 400 on malformed JSON, unknown fields, or > 64 outboundFacts before checking LLM_API_KEY', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    // 1. Malformed JSON string
    const badJsonRes = await POST(makeJsonRequest('{not-valid-json'));
    expect(badJsonRes.status).toBe(400);
    const badJsonBody = (await badJsonRes.json()) as NarrateErrorResponse;
    expect(badJsonBody.reason).toBe('invalid_payload');

    // 2. Unknown top-level property
    const unknownPropRes = await POST(
      makeJsonRequest({ ...validPayload, extraField: true }),
    );
    expect(unknownPropRes.status).toBe(400);
    const unknownPropBody =
      (await unknownPropRes.json()) as NarrateErrorResponse;
    expect(unknownPropBody.reason).toBe('invalid_payload');

    // 3. > 64 outboundFacts
    const tooManyFacts = Array.from(
      { length: MAX_OUTBOUND_FACTS + 1 },
      (_, idx) => ({
        ...validPayload.outboundFacts[0]!,
        factId: `fact:extra-${idx}`,
      }),
    );
    const overflowRes = await POST(
      makeJsonRequest({ ...validPayload, outboundFacts: tooManyFacts }),
    );
    expect(overflowRes.status).toBe(400);
    const overflowBody = (await overflowRes.json()) as NarrateErrorResponse;
    expect(overflowBody.reason).toBe('invalid_payload');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('returns HTTP 400 { reason: "privacy_violation" } when per-die fields, coordinates, DieIds, or STDF FAR bytes are present', async () => {
    process.env.LLM_API_KEY = 'test-server-only-key';
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const violations: readonly unknown[] = [
      { ...validPayload, dieIds: ['W01:0,0'] },
      {
        ...validPayload,
        outboundFacts: [
          {
            ...validPayload.outboundFacts[0]!,
            dieIndices: [0, 1, 2],
          },
        ],
      },
      {
        ...validPayload,
        outboundFacts: [
          {
            ...validPayload.outboundFacts[0]!,
            x: [1, 2],
            y: [3, 4],
          },
        ],
      },
      {
        ...validPayload,
        outboundFacts: [
          {
            ...validPayload.outboundFacts[0]!,
            values: [0.12, 0.45],
          },
        ],
      },
      {
        ...validPayload,
        outboundFacts: [
          {
            ...validPayload.outboundFacts[0]!,
            summary: 'Die W01:-3,4 failed IDDQ leakage.',
          },
        ],
      },
      {
        ...validPayload,
        lotId: 'AgAACgIE-raw-far-header',
      },
    ];

    for (const payload of violations) {
      const res = await POST(makeJsonRequest(payload));
      expect(res.status).toBe(400);
      const errBody = (await res.json()) as NarrateErrorResponse;
      expect(errBody.reason).toBe('privacy_violation');
    }

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('returns HTTP 200 { claims } when LLM_API_KEY is set and mocked upstream returns valid candidate claims', async () => {
    process.env.LLM_API_KEY = 'sk-server-only-secret';
    process.env.LLM_PROVIDER_URL = 'https://llm.internal.example/v1/narrate';
    process.env.LLM_MODEL = 'clinical-narrator-v1';

    const mockClaims = [
      {
        id: 'claim:primary-evidence',
        text: 'Outer 3 rings account for 91.2% of final fails across 25 wafers.',
        citedFactIds: ['fact:spatial:primary'],
      },
      {
        id: 'claim:dominant-bin',
        text: 'SBIN 7 captures 78.5% of lot failures.',
        citedFactIds: ['fact:bin:sbin-7'],
      },
    ];

    const fetchSpy = vi.fn().mockResolvedValue(
      Response.json({
        choices: [
          {
            message: {
              content: JSON.stringify({ claims: mockClaims }),
            },
          },
        ],
      }),
    );
    vi.stubGlobal('fetch', fetchSpy);

    const response = await POST(makeJsonRequest(validPayload));
    expect(response.status).toBe(200);

    const body = (await response.json()) as NarrateSuccessResponse;
    expect(body.claims).toEqual(mockClaims);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [calledUrl, calledInit] = fetchSpy.mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(calledUrl).toBe('https://llm.internal.example/v1/narrate');
    expect(calledInit.method).toBe('POST');
    expect(calledInit.headers).toEqual({
      'Content-Type': 'application/json',
      Authorization: 'Bearer sk-server-only-secret',
    });
  });

  it('returns HTTP 502 on upstream HTTP error, network failure, or invalid LLM output schema', async () => {
    process.env.LLM_API_KEY = 'sk-server-only-secret';

    // 1. Upstream HTTP 500
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('Internal Error', { status: 500 })),
    );
    const upstreamErrRes = await POST(makeJsonRequest(validPayload));
    expect(upstreamErrRes.status).toBe(502);
    const upstreamErrBody =
      (await upstreamErrRes.json()) as NarrateErrorResponse;
    expect(upstreamErrBody.reason).toBe('upstream_error');

    // 2. Upstream network rejection
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new Error('Connection reset')),
    );
    const netErrRes = await POST(makeJsonRequest(validPayload));
    expect(netErrRes.status).toBe(502);
    const netErrBody = (await netErrRes.json()) as NarrateErrorResponse;
    expect(netErrBody.reason).toBe('upstream_error');

    // 3. Upstream invalid schema (empty citedFactIds)
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        Response.json({
          claims: [
            {
              id: 'claim:bad',
              text: 'Uncited statement.',
              citedFactIds: [],
            },
          ],
        }),
      ),
    );
    const badSchemaRes = await POST(makeJsonRequest(validPayload));
    expect(badSchemaRes.status).toBe(502);
    const badSchemaBody = (await badSchemaRes.json()) as NarrateErrorResponse;
    expect(badSchemaBody.reason).toBe('invalid_llm_output');

    // 4. Upstream HTML injection or forbidden horror word
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        Response.json({
          claims: [
            {
              id: 'claim:xss',
              text: '<script>alert(1)</script>',
              citedFactIds: ['fact:lot-yield'],
            },
          ],
        }),
      ),
    );
    const xssRes = await POST(makeJsonRequest(validPayload));
    expect(xssRes.status).toBe(502);
    const xssBody = (await xssRes.json()) as NarrateErrorResponse;
    expect(xssBody.reason).toBe('invalid_llm_output');
  });
});
