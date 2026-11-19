/**
 * Property 14: Outbound LLM Payload Privacy Invariant
 * (`src/core/report/llm-payload-privacy.prop.test.ts`).
 *
 * Verifies (`fast-check`, `numRuns: 200` over `arbLotModel`):
 * 1. `sanitizeOutboundNarratePayload(lot, verdict, facts)` strips all per-die
 *    `dieIndices`, `dieIds`, coordinate arrays (`x`, `y`), parametric `values`
 *    arrays, and STDF binary buffers; its serialized JSON contains zero STDF
 *    magic/FAR bytes, zero canonical `DieId` strings, and zero coordinate or
 *    measurement arrays, and always passes `validateNarrateRequestSchema`.
 * 2. Adversarial mutations injecting `dieIds`, `dieIndices`, `x`/`y` coordinates,
 *    `values` arrays, `Uint8Array`/`ArrayBuffer` binary views, canonical `DieId`
 *    tokens, base64/hex STDF `FAR` bytes, or `> 64` facts fail
 *    `validateNarrateRequestSchema` (`ok: false`) and receive `HTTP 400` from
 *    `POST /api/autopsy/narrate`.
 *
 * Validates: Requirements 16.1, 16.3
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
// eslint-disable-next-line no-restricted-imports
import { POST } from '../../app/api/autopsy/narrate/route';
import { arbLotModel } from '../__test-utils__/arbitraries';
import {
  MAX_OUTBOUND_FACTS,
  type NarrateErrorResponse,
  sanitizeOutboundNarratePayload,
  validateNarrateRequestSchema,
} from './citation-validator';
import { generateOfflineAutopsyReport } from './template-report';

const PROP_NUM_RUNS = Number(process.env.FC_NUM_RUNS ?? 200);
const PROP_SEED =
  process.env.FC_SEED !== undefined ? Number(process.env.FC_SEED) : undefined;

const CANONICAL_DIE_ID_PATTERN =
  /(?:\b|(?<=^|[\s([{"']))[A-Za-z0-9_./:#-]+:(?:-?\d+,-?\d+|part-\d+)\b/;
const STDF_FAR_BASE64_PATTERN =
  /(?:AgAACgI[EA-Za-z0-9+/=]|AAIACgE[EA-Za-z0-9+/=])/;
const STDF_FAR_HEX_PATTERN =
  /(?:02[\s,:-]*00|00[\s,:-]*02)[\s,:-]*00[\s,:-]*0a[\s,:-]*0[12][\s,:-]*04/i;

type PrivacyAdversarialMutation =
  | 'inject-die-ids'
  | 'inject-die-indices'
  | 'inject-x-y-coords'
  | 'inject-parametric-values'
  | 'inject-uint8array'
  | 'inject-die-id-in-summary'
  | 'inject-stdf-far-base64'
  | 'inject-too-many-facts';

describe('Property 14: Outbound LLM Payload Privacy Invariant (fast-check)', () => {
  it('guarantees sanitizeOutboundNarratePayload produces a privacy-safe payload with zero DieIds, zero coordinates/measurements, and zero STDF bytes across arbitrary LotModels', () => {
    fc.assert(
      fc.property(arbLotModel, (lot) => {
        const { facts, verdict } = generateOfflineAutopsyReport(lot);
        const payload = sanitizeOutboundNarratePayload(lot, verdict, facts);

        // 1. Structural checks
        expect(payload.mode).toBe('narrate');
        expect(payload.outboundFacts.length).toBeGreaterThanOrEqual(1);
        expect(payload.outboundFacts.length).toBeLessThanOrEqual(
          MAX_OUTBOUND_FACTS,
        );

        for (const fact of payload.outboundFacts) {
          expect('dieIds' in fact).toBe(false);
          expect('dieIndices' in fact).toBe(false);
          expect('x' in fact).toBe(false);
          expect('y' in fact).toBe(false);
          expect('values' in fact).toBe(false);
          expect(fact.dieCount).toBeGreaterThanOrEqual(1);
        }

        // 2. Wire-serialized JSON checks
        const serialized = JSON.stringify(payload);
        expect(serialized).not.toMatch(CANONICAL_DIE_ID_PATTERN);
        expect(serialized).not.toMatch(STDF_FAR_BASE64_PATTERN);
        expect(serialized).not.toMatch(STDF_FAR_HEX_PATTERN);
        expect(serialized).not.toContain('"dieIds"');
        expect(serialized).not.toContain('"dieIndices"');
        expect(serialized).not.toContain('"xCoord"');
        expect(serialized).not.toContain('"yCoord"');
        expect(serialized).not.toContain('"values"');
        expect(serialized).not.toContain('"rawBytes"');

        // None of the lot's canonical DieIds appear anywhere in the serialized JSON
        for (const dieId of lot.dieIds) {
          if (CANONICAL_DIE_ID_PATTERN.test(dieId)) {
            expect(serialized.includes(`"${dieId}"`)).toBe(false);
          }
        }

        // 3. Schema validator acceptance on both raw and parsed wire payload
        const directCheck = validateNarrateRequestSchema(payload);
        expect(directCheck.ok).toBe(true);

        const wireCheck = validateNarrateRequestSchema(JSON.parse(serialized));
        expect(wireCheck.ok).toBe(true);
      }),
      {
        numRuns: PROP_NUM_RUNS,
        ...(PROP_SEED !== undefined ? { seed: PROP_SEED } : {}),
      },
    );
  });

  it('rejects all adversarial mutations (dieIds, x/y, values, Uint8Array, FAR bytes, > 64 facts) in validateNarrateRequestSchema and returns HTTP 400 from POST', async () => {
    const arbMutation = fc.constantFrom<PrivacyAdversarialMutation>(
      'inject-die-ids',
      'inject-die-indices',
      'inject-x-y-coords',
      'inject-parametric-values',
      'inject-uint8array',
      'inject-die-id-in-summary',
      'inject-stdf-far-base64',
      'inject-too-many-facts',
    );

    await fc.assert(
      fc.asyncProperty(arbLotModel, arbMutation, async (lot, mutationKind) => {
        const { facts, verdict } = generateOfflineAutopsyReport(lot);
        const cleanPayload = sanitizeOutboundNarratePayload(
          lot,
          verdict,
          facts,
        );
        const firstFact = cleanPayload.outboundFacts[0]!;

        let mutatedForSchema: unknown;
        let mutatedForWire: unknown;

        switch (mutationKind) {
          case 'inject-die-ids': {
            const payload = {
              ...cleanPayload,
              outboundFacts: [
                {
                  ...firstFact,
                  dieIds: [lot.dieIds[0] ?? 'W01:0,0'],
                },
              ],
            };
            mutatedForSchema = payload;
            mutatedForWire = payload;
            break;
          }

          case 'inject-die-indices': {
            const payload = {
              ...cleanPayload,
              outboundFacts: [
                {
                  ...firstFact,
                  dieIndices: [0, 1],
                },
              ],
            };
            mutatedForSchema = payload;
            mutatedForWire = payload;
            break;
          }

          case 'inject-x-y-coords': {
            const payload = {
              ...cleanPayload,
              x: Array.from(lot.dies.x),
              y: Array.from(lot.dies.y),
            };
            mutatedForSchema = payload;
            mutatedForWire = payload;
            break;
          }

          case 'inject-parametric-values': {
            const payload = {
              ...cleanPayload,
              outboundFacts: [
                {
                  ...firstFact,
                  values: [0.0012, 0.0034, 0.0056],
                },
              ],
            };
            mutatedForSchema = payload;
            mutatedForWire = payload;
            break;
          }

          case 'inject-uint8array': {
            const farBytes = new Uint8Array([2, 0, 0, 10, 2, 4]);
            mutatedForSchema = {
              ...cleanPayload,
              rawBytes: farBytes,
            };
            mutatedForWire = {
              ...cleanPayload,
              rawBytes: [2, 0, 0, 10, 2, 4],
            };
            break;
          }

          case 'inject-die-id-in-summary': {
            const sampleDieId = lot.dieIds[0] ?? 'W01:0,0';
            const payload = {
              ...cleanPayload,
              outboundFacts: [
                {
                  ...firstFact,
                  summary: `Leakage spike observed at die ${sampleDieId}.`,
                },
              ],
            };
            mutatedForSchema = payload;
            mutatedForWire = payload;
            break;
          }

          case 'inject-stdf-far-base64': {
            const payload = {
              ...cleanPayload,
              lotId: 'AgAACgIE',
            };
            mutatedForSchema = payload;
            mutatedForWire = payload;
            break;
          }

          case 'inject-too-many-facts': {
            const overflowFacts = Array.from(
              { length: MAX_OUTBOUND_FACTS + 1 },
              (_, idx) => ({
                ...firstFact,
                factId: `fact:overflow-${idx}`,
              }),
            );
            const payload = {
              ...cleanPayload,
              outboundFacts: overflowFacts,
            };
            mutatedForSchema = payload;
            mutatedForWire = payload;
            break;
          }
        }

        const schemaValidation = validateNarrateRequestSchema(mutatedForSchema);
        expect(schemaValidation.ok).toBe(false);

        const request = new Request(
          'http://localhost:3000/api/autopsy/narrate',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(mutatedForWire),
          },
        );
        const response = await POST(request);
        expect(response.status).toBe(400);

        const body = (await response.json()) as NarrateErrorResponse;
        expect(['privacy_violation', 'invalid_payload']).toContain(body.reason);
      }),
      {
        numRuns: PROP_NUM_RUNS,
        ...(PROP_SEED !== undefined ? { seed: PROP_SEED } : {}),
      },
    );
  });
});
