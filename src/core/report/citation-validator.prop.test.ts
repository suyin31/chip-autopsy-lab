/**
 * Property 11: LLM Citation Validator Soundness and Deterministic Fallback
 * (`src/core/report/citation-validator.prop.test.ts`).
 *
 * Verifies:
 * 1. Property 11 (`fast-check`, `numRuns: 200`) across arbitrary `LotModel`s and
 *    their `EngineFact` sets:
 *    - Valid candidate LLM payloads with exact or within-tolerance metric numbers
 *      pass `validateLlmNarration`, return `source: 'llm-verified'`, preserve
 *      `templateReport.causeOfDeathHeadline` unchanged, and resolve non-empty
 *      in-bounds `resolvedDieIndices` and `resolvedDieIds`.
 *    - Mutated / adversarial candidate LLM payloads (unknown `factId`, empty
 *      `citedFactIds`, out-of-range die index `>= totalLotDies`, `<script>` / HTML
 *      angle-bracket injection, forbidden horror words, and numeric literals
 *      perturbed beyond `metric.tolerance`) are rejected (`ok: false`) and
 *      `resolveNarratedReportOrFallback` returns `templateReport` unchanged.
 * 2. Unit tests for `extractNumbersFromClaimText` identifier masking (`SBIN`, `HBIN`,
 *    `Test`, `Head <h> Site <s> (<h>:<s>)`, `Site <h>:<s>`, `Site <s>`, `Wafer <id>`,
 *    `outer 3 rings` / `3-die band`) and rounding-tolerance boundary conditions.
 *
 * Validates: Requirements 10.6, 10.7
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { arbLotModel } from '../__test-utils__/arbitraries';
import { generateDemoStdfBytes } from '../demo/demo-generator';
import { buildLotModel } from '../model/lot-builder';
import { parseStdfBytes } from '../stdf/stdf-parser';
import {
  extractNumbersFromClaimText,
  MAX_CANDIDATE_CLAIMS,
  MAX_CLAIM_TEXT_LENGTH,
  type NarrateSuccessResponse,
  resolveNarratedReportOrFallback,
  validateLlmNarration,
  validateNarrateResponseSchema,
} from './citation-validator';
import { type EngineFact, formatGroupedInt } from './engine-facts';
import { renderReport } from './render-report';
import { generateOfflineAutopsyReport } from './template-report';

const PROP_NUM_RUNS = Number(process.env.FC_NUM_RUNS ?? 200);
const PROP_SEED =
  process.env.FC_SEED !== undefined ? Number(process.env.FC_SEED) : undefined;

const HORROR_WORDS = [
  'corpse',
  'morgue',
  'zombie',
  'vampire',
  'ghost',
  'skull',
  'cobweb',
  'blood',
  'gore',
  'spooky',
  'pumpkin',
  'skeleton',
  'graveyard',
] as const;

type AdversarialMutationKind =
  | 'unknown-fact-id'
  | 'empty-citations'
  | 'out-of-range-die-index'
  | 'html-injection'
  | 'horror-word'
  | 'numeric-perturbation'
  | 'text-too-long'
  | 'too-many-claims';

function buildFactsMap(
  facts: readonly EngineFact[],
): Map<string, EngineFact> {
  const map = new Map<string, EngineFact>();
  for (const fact of facts) {
    map.set(fact.factId, fact);
  }
  return map;
}

/**
 * Computes a numeric literal guaranteed to diverge from every metric and `dieCount`
 * in `citedFacts` beyond `metric.tolerance`.
 */
function findDivergentNumber(
  citedFacts: readonly EngineFact[],
  perturbationDelta: number,
): number {
  let maxVal = 100;
  let maxTol = 1;
  for (const fact of citedFacts) {
    if (fact.dieIndices.length > maxVal) {
      maxVal = fact.dieIndices.length;
    }
    for (const m of fact.metrics) {
      const absV = Math.abs(m.numericValue);
      if (absV > maxVal) {
        maxVal = absV;
      }
      if (m.tolerance > maxTol) {
        maxTol = m.tolerance;
      }
    }
  }
  return Math.round((maxVal + maxTol + Math.max(1.5, perturbationDelta)) * 100) / 100;
}

describe('Property 11: LLM Citation Validator Soundness and Deterministic Fallback (fast-check)', () => {
  it('accepts grounded clinical narration with exact or within-tolerance metrics while keeping causeOfDeathHeadline locked', () => {
    fc.assert(
      fc.property(
        arbLotModel,
        fc.double({ min: -0.85, max: 0.85, noNaN: true, noDefaultInfinity: true }),
        (lot, jitterFactor) => {
          const { facts, report } = generateOfflineAutopsyReport(lot);
          const factsById = buildFactsMap(facts);

          const candidateClaims = facts.slice(0, 3).map((fact, idx) => {
            const firstMetric = fact.metrics[0];
            let prose: string;
            if (firstMetric && firstMetric.tolerance > 0) {
              const withinTolValue =
                firstMetric.numericValue + firstMetric.tolerance * jitterFactor;
              const decimals = firstMetric.tolerance >= 0.04 ? 1 : 2;
              prose = `Clinical finding ${formatGroupedInt(fact.dieIndices.length)} dies observed with metric ${withinTolValue.toFixed(decimals)}.`;
            } else {
              prose = `Clinical finding covers ${formatGroupedInt(fact.dieIndices.length)} dies in current lot scope.`;
            }

            return {
              id: report.bodyClaims[idx]?.claimId ?? `claim:custom-${idx + 1}`,
              text: prose,
              citedFactIds: [fact.factId],
            };
          });

          const candidate: NarrateSuccessResponse = { claims: candidateClaims };
          const result = validateLlmNarration(
            candidate,
            report,
            factsById,
            lot.dies.count,
          );

          expect(result.ok).toBe(true);
          if (!result.ok) {
            return;
          }

          expect(result.value.source).toBe('llm-verified');
          expect(result.value.causeOfDeathHeadline).toBe(
            report.causeOfDeathHeadline,
          );
          expect(result.value.bodyClaims).toHaveLength(candidateClaims.length);

          for (let i = 0; i < result.value.bodyClaims.length; i += 1) {
            const validatedClaim = result.value.bodyClaims[i]!;
            expect(validatedClaim.text).toBe(candidateClaims[i]!.text);
            expect(validatedClaim.resolvedDieIndices.length).toBeGreaterThanOrEqual(1);
            expect(validatedClaim.resolvedDieIds).toHaveLength(
              validatedClaim.resolvedDieIndices.length,
            );
            for (const dieIdx of validatedClaim.resolvedDieIndices) {
              expect(dieIdx).toBeGreaterThanOrEqual(0);
              expect(dieIdx).toBeLessThan(lot.dies.count);
            }
          }

          const resolved = resolveNarratedReportOrFallback(
            candidate,
            report,
            factsById,
            lot.dies.count,
          );
          expect(resolved.source).toBe('llm-verified');
          expect(resolved.causeOfDeathHeadline).toBe(report.causeOfDeathHeadline);

          const renderedEn = renderReport(resolved, 'en');
          expect(renderedEn.findings.length).toBeGreaterThanOrEqual(1);
          expect(renderedEn.findings[0]!.headline).toBe(candidateClaims[0]!.text);
        },
      ),
      {
        numRuns: PROP_NUM_RUNS,
        ...(PROP_SEED !== undefined ? { seed: PROP_SEED } : {}),
      },
    );
  });

  it('rejects all mutated/adversarial LLM payloads and returns templateReport unchanged via resolveNarratedReportOrFallback', () => {
    const arbMutation = fc.record({
      kind: fc.constantFrom<AdversarialMutationKind>(
        'unknown-fact-id',
        'empty-citations',
        'out-of-range-die-index',
        'html-injection',
        'horror-word',
        'numeric-perturbation',
        'text-too-long',
        'too-many-claims',
      ),
      horrorIdx: fc.integer({ min: 0, max: HORROR_WORDS.length - 1 }),
      perturbationDelta: fc.double({
        min: 1.25,
        max: 500,
        noNaN: true,
        noDefaultInfinity: true,
      }),
    });

    fc.assert(
      fc.property(arbLotModel, arbMutation, (lot, mutation) => {
        const { facts, report } = generateOfflineAutopsyReport(lot);
        const primaryFact = facts[0]!;
        const factsById = buildFactsMap(facts);

        let candidate: unknown;

        switch (mutation.kind) {
          case 'unknown-fact-id': {
            candidate = {
              claims: [
                {
                  id: 'claim:primary-evidence',
                  text: `Observed ${primaryFact.dieIndices.length} dies in lot summary.`,
                  citedFactIds: ['fact:hallucinated:non-existent-999'],
                },
              ],
            };
            break;
          }

          case 'empty-citations': {
            candidate = {
              claims: [
                {
                  id: 'claim:primary-evidence',
                  text: `Observed ${primaryFact.dieIndices.length} dies in lot summary.`,
                  citedFactIds: [],
                },
              ],
            };
            break;
          }

          case 'out-of-range-die-index': {
            const corruptedFact: EngineFact = {
              ...primaryFact,
              dieIndices: Uint32Array.from([lot.dies.count]),
              dieIds: ['W01:999,999'],
            };
            factsById.set(primaryFact.factId, corruptedFact);
            candidate = {
              claims: [
                {
                  id: 'claim:primary-evidence',
                  text: 'Observed 1 die in lot summary.',
                  citedFactIds: [primaryFact.factId],
                },
              ],
            };
            break;
          }

          case 'html-injection': {
            candidate = {
              claims: [
                {
                  id: 'claim:primary-evidence',
                  text: `<script>alert(${primaryFact.dieIndices.length})</script> dies observed.`,
                  citedFactIds: [primaryFact.factId],
                },
              ],
            };
            break;
          }

          case 'horror-word': {
            const word = HORROR_WORDS[mutation.horrorIdx]!;
            candidate = {
              claims: [
                {
                  id: 'claim:primary-evidence',
                  text: `Wafer ${word} signature observed across ${primaryFact.dieIndices.length} dies.`,
                  citedFactIds: [primaryFact.factId],
                },
              ],
            };
            break;
          }

          case 'numeric-perturbation': {
            const bogusNumber = findDivergentNumber(
              [primaryFact],
              mutation.perturbationDelta,
            );
            candidate = {
              claims: [
                {
                  id: 'claim:primary-evidence',
                  text: `Yield excursion affected ${bogusNumber} dies across tested wafers.`,
                  citedFactIds: [primaryFact.factId],
                },
              ],
            };
            break;
          }

          case 'text-too-long': {
            candidate = {
              claims: [
                {
                  id: 'claim:primary-evidence',
                  text: 'A'.repeat(MAX_CLAIM_TEXT_LENGTH + 5),
                  citedFactIds: [primaryFact.factId],
                },
              ],
            };
            break;
          }

          case 'too-many-claims': {
            candidate = {
              claims: Array.from(
                { length: MAX_CANDIDATE_CLAIMS + 1 },
                (_, idx) => ({
                  id: `claim:item-${idx}`,
                  text: `Observed ${primaryFact.dieIndices.length} dies.`,
                  citedFactIds: [primaryFact.factId],
                }),
              ),
            };
            break;
          }
        }

        const validation = validateLlmNarration(
          candidate,
          report,
          factsById,
          lot.dies.count,
        );
        expect(validation.ok).toBe(false);

        const resolved = resolveNarratedReportOrFallback(
          candidate,
          report,
          factsById,
          lot.dies.count,
        );
        expect(resolved).toBe(report);
        expect(resolved.source).toBe('deterministic-template');
      }),
      {
        numRuns: PROP_NUM_RUNS,
        ...(PROP_SEED !== undefined ? { seed: PROP_SEED } : {}),
      },
    );
  });
});

describe('Citation Validator & Number Extraction Unit Suite', () => {
  it('masks SBIN, HBIN, Test, Site, Wafer, and outer 3-ring identifiers before extracting numeric literals', () => {
    const bytes = generateDemoStdfBytes('edge-ring-etch');
    const parsed = parseStdfBytes(bytes, { mode: 'full' });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      throw new Error(parsed.error.message);
    }
    const lot = buildLotModel(parsed.value);
    const { facts } = generateOfflineAutopsyReport(lot);
    const spatialFact = facts.find((f) => f.kind === 'spatial-pattern')!;
    const binFact = facts.find((f) => f.kind === 'dominant-bin')!;
    const testFact = facts.find((f) => f.kind === 'parametric-capability')!;

    const sampleText =
      'Outer 3 rings (3-die band) on Wafer W05 and Head 1 Site 2 (1:2) / Site 1:2 / Site 2 failed SBIN 7 (IDDQ_EDGE_LEAK) and HBIN 4 on Test 204 (IDDQ_LEAK) at 91.2% across 25 wafers (1,240 dies, Cpk 0.54).';

    const numbers = extractNumbersFromClaimText(sampleText, [
      spatialFact,
      binFact,
      testFact,
    ]);

    expect(numbers).toEqual([91.2, 25, 1240, 0.54]);
  });

  it('enforces exact metric tolerance boundaries on demo lot narration', () => {
    const bytes = generateDemoStdfBytes('site2-probe-contact');
    const parsed = parseStdfBytes(bytes, { mode: 'full' });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      throw new Error(parsed.error.message);
    }
    const lot = buildLotModel(parsed.value);
    const { facts, report } = generateOfflineAutopsyReport(lot);
    const factsById = buildFactsMap(facts);

    const siteFact = facts.find((f) => f.kind === 'site-anomaly')!;
    const fpYieldMetric = siteFact.metrics.find(
      (m) => m.key === 'firstPassYieldPct',
    )!;

    // 1. Within 0.05% tolerance -> accepted
    const withinTolVal = (
      fpYieldMetric.numericValue +
      fpYieldMetric.tolerance * 0.8
    ).toFixed(2);
    const validCandidate = {
      claims: [
        {
          id: 'claim:primary-evidence',
          text: `Head 1 Site 2 (1:2) recorded ${withinTolVal}% first-pass yield.`,
          citedFactIds: [siteFact.factId],
        },
      ],
    };
    expect(validateNarrateResponseSchema(validCandidate).ok).toBe(true);
    const validRes = validateLlmNarration(
      validCandidate,
      report,
      factsById,
      lot.dies.count,
    );
    expect(validRes.ok).toBe(true);

    // 2. Perturbed by +0.5% beyond tolerance -> rejected
    const outOfTolVal = (fpYieldMetric.numericValue + 0.5).toFixed(1);
    const invalidCandidate = {
      claims: [
        {
          id: 'claim:primary-evidence',
          text: `Head 1 Site 2 (1:2) recorded ${outOfTolVal}% first-pass yield.`,
          citedFactIds: [siteFact.factId],
        },
      ],
    };
    const invalidRes = validateLlmNarration(
      invalidCandidate,
      report,
      factsById,
      lot.dies.count,
    );
    expect(invalidRes.ok).toBe(false);
  });
});
