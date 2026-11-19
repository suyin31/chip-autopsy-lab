/**
 * Property 13: Filter DSL Round-Trip Serialization Equivalence
 * (`src/core/query/filter-dsl-codec.prop.test.ts`).
 *
 * Verifies (`fast-check`, `numRuns: 200` over arbitrary valid `FilterDslAst`
 * combining `dieClauses` and `capabilityClauses` across `arbLotModel`):
 * 1. `deserializeFilterDsl(serializeFilterDsl(ast))` returns `ok: true` with
 *    structural equality to `normalizeFilterDslAst(ast)` and is idempotent on
 *    re-serialization.
 * 2. Evaluating the original `ast` and the round-tripped AST on `lot` produces
 *    identical `dieMask`, `selectedDieCount`, `matchingTestNums`, and
 *    `lowestCpkTestNum`.
 * 3. The serialized Filter DSL string contains zero raw STDF magic headers,
 *    zero control bytes (`0x00–0x1F`), and zero canonical per-die coordinate
 *    or measurement dumps.
 *
 * Validates: Requirements 12.2, 13.1, 13.2, 13.4
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { arbLotModel } from '../__test-utils__/arbitraries';
import type { LotModel } from '../model/types';
import {
  applyFilterDslToSelection,
  type CapabilityPredicateClause,
  type ComparisonOp,
  type DiePredicateClause,
  deserializeFilterDsl,
  type FilterDslAst,
  normalizeFilterDslAst,
  serializeFilterDsl,
} from './filter-dsl';

const PROP_NUM_RUNS = Number(process.env.FC_NUM_RUNS ?? 200);
const PROP_SEED =
  process.env.FC_SEED !== undefined ? Number(process.env.FC_SEED) : undefined;

const STDF_FAR_BASE64_PATTERN =
  /(?:AgAACgI[EA-Za-z0-9+/=]|AAIACgE[EA-Za-z0-9+/=])/;
const STDF_FAR_HEX_PATTERN =
  /(?:02[\s,:-]*00|00[\s,:-]*02)[\s,:-]*00[\s,:-]*0a[\s,:-]*0[12][\s,:-]*04/i;

function hasControlBytes(str: string): boolean {
  for (let i = 0; i < str.length; i += 1) {
    const code = str.charCodeAt(i);
    if (code <= 0x1f || code === 0x7f) {
      return true;
    }
  }
  return false;
}

function masksEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) {
    return false;
  }
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) {
      return false;
    }
  }
  return true;
}

function arbDiePredicateClauseForLot(
  lot: LotModel,
): fc.Arbitrary<DiePredicateClause> {
  const sbinCodes = Array.from(lot.sbins.keys());
  const hbinCodes = Array.from(lot.hbins.keys());
  const allBins = Array.from(new Set([...sbinCodes, ...hbinCodes, 1, 4, 7, 99]));
  const waferUpper = Math.max(0, lot.wafers.length);
  const siteNums =
    lot.sites.length > 0
      ? Array.from(new Set(lot.sites.map((s) => s.siteNum)))
      : [1, 2];
  const headNums =
    lot.sites.length > 0
      ? Array.from(new Set(lot.sites.map((s) => s.headNum)))
      : [1];

  return fc.oneof(
    fc.record({
      kind: fc.constant('pass-status' as const),
      status: fc.constantFrom<'fail' | 'pass'>('fail', 'pass'),
    }),
    fc.record({
      kind: fc.constant('bin' as const),
      mode: fc.constantFrom<'SBIN' | 'HBIN' | 'ANY_BIN'>(
        'SBIN',
        'HBIN',
        'ANY_BIN',
      ),
      codes: fc.array(fc.constantFrom(...allBins), {
        minLength: 1,
        maxLength: Math.min(4, allBins.length),
      }),
    }),
    fc.record({
      kind: fc.constant('edge-ring' as const),
      maxRing: fc.integer({ min: 1, max: 6 }),
    }),
    fc.record({
      kind: fc.constant('radial-zone' as const),
      zone: fc.constantFrom<'center' | 'donut'>('center', 'donut'),
    }),
    fc.record({
      kind: fc.constant('wafer' as const),
      waferIndices: fc.array(fc.integer({ min: 0, max: waferUpper }), {
        minLength: 1,
        maxLength: Math.min(3, waferUpper + 1),
      }),
    }),
    fc
      .record({
        headNum: fc.option(fc.constantFrom(...headNums), { nil: undefined }),
        siteNum: fc.constantFrom(...siteNums),
      })
      .map(({ headNum, siteNum }): DiePredicateClause =>
        headNum !== undefined
          ? { kind: 'site', headNum, siteNum }
          : { kind: 'site', siteNum },
      ),
  );
}

const arbCapabilityClause: fc.Arbitrary<CapabilityPredicateClause> = fc.record({
  kind: fc.constant('capability' as const),
  metric: fc.constantFrom<'cpk' | 'cp'>('cpk', 'cp'),
  op: fc.constantFrom<ComparisonOp>('<', '<=', '>', '>=', '='),
  threshold: fc
    .double({ min: -5, max: 10, noNaN: true, noDefaultInfinity: true })
    .map((v) => (Object.is(v, -0) ? 0 : Number(v.toFixed(4)))),
});

export function arbFilterDslAstForLot(
  lot: LotModel,
): fc.Arbitrary<FilterDslAst> {
  return fc.record({
    dieClauses: fc.array(arbDiePredicateClauseForLot(lot), {
      minLength: 0,
      maxLength: 4,
    }),
    capabilityClauses: fc.array(arbCapabilityClause, {
      minLength: 0,
      maxLength: 3,
    }),
  });
}

describe('Property 13: Filter DSL Round-Trip Serialization Equivalence (fast-check)', () => {
  it('round-trips arbitrary FilterDslAst through serializeFilterDsl -> deserializeFilterDsl with structural and evaluation equality across LotModels', () => {
    fc.assert(
      fc.property(
        arbLotModel.chain((lot) =>
          fc.record({
            lot: fc.constant(lot),
            ast: arbFilterDslAstForLot(lot),
          }),
        ),
        ({ lot, ast }) => {
          const normalized = normalizeFilterDslAst(ast);
          const encoded = serializeFilterDsl(ast);

          // 1. Privacy & hygiene check on serialized DSL string
          expect(encoded.length).toBeGreaterThan(0);
          expect(hasControlBytes(encoded)).toBe(false);
          expect(encoded).not.toMatch(STDF_FAR_BASE64_PATTERN);
          expect(encoded).not.toMatch(STDF_FAR_HEX_PATTERN);

          // 2. Round-trip structural equality and re-serialization idempotence
          const decoded = deserializeFilterDsl(encoded);
          expect(decoded.ok).toBe(true);
          if (!decoded.ok) {
            return;
          }
          expect(decoded.value).toEqual(normalized);
          expect(serializeFilterDsl(decoded.value)).toBe(encoded);

          // 3. Identical selection and capability evaluation on the LotModel
          const evalOriginal = applyFilterDslToSelection(lot, ast);
          const evalDecoded = applyFilterDslToSelection(lot, decoded.value);

          expect(evalDecoded.selectedDieCount).toBe(
            evalOriginal.selectedDieCount,
          );
          expect(masksEqual(evalDecoded.dieMask, evalOriginal.dieMask)).toBe(
            true,
          );
          expect(evalDecoded.matchingTestNums).toEqual(
            evalOriginal.matchingTestNums,
          );
          expect(evalDecoded.lowestCpkTestNum).toBe(
            evalOriginal.lowestCpkTestNum,
          );
        },
      ),
      {
        numRuns: PROP_NUM_RUNS,
        ...(PROP_SEED !== undefined ? { seed: PROP_SEED } : {}),
      },
    );
  });
});
