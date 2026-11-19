import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { arbDieMask, arbLotModel } from '../__test-utils__/arbitraries';
import { computeParametricCapability } from '../analytics/parametric-stats';
import type { LotModel } from '../model/types';
import {
  type CapabilityPredicateClause,
  type ComparisonOp,
  countMaskDies,
  type DiePredicateClause,
  evaluateSelection,
  type FilterDslAst,
  type QuickSelectionFilters,
  selectDiesByBrush,
  selectDiesByDsl,
  selectDiesByQuickFilters,
  type SpatialBrushRect,
} from './selection-predicates';

function masksEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function isSubsetMask(sub: Uint8Array, sup: Uint8Array): boolean {
  if (sub.length !== sup.length) return false;
  for (let i = 0; i < sub.length; i += 1) {
    if (sub[i] !== 0 && sup[i] === 0) return false;
  }
  return true;
}

function arbSpatialBrushForLot(lot: LotModel): fc.Arbitrary<SpatialBrushRect> {
  const maxWaferIdx = Math.max(0, lot.wafers.length - 1);
  let minX = -5;
  let maxX = 5;
  let minY = -5;
  let maxY = 5;
  for (const w of lot.wafers) {
    if (w.minX < minX) minX = w.minX;
    if (w.maxX > maxX) maxX = w.maxX;
    if (w.minY < minY) minY = w.minY;
    if (w.maxY > maxY) maxY = w.maxY;
  }
  const loX = minX - 2;
  const hiX = maxX + 2;
  const loY = minY - 2;
  const hiY = maxY + 2;

  return fc.record({
    scope: fc.constantFrom<'wafer' | 'stacked'>('wafer', 'stacked'),
    waferIndex: fc.option(fc.integer({ min: 0, max: maxWaferIdx + 1 }), {
      nil: undefined,
    }),
    minX: fc.integer({ min: loX, max: hiX }),
    maxX: fc.integer({ min: loX, max: hiX }),
    minY: fc.integer({ min: loY, max: hiY }),
    maxY: fc.integer({ min: loY, max: hiY }),
  });
}

function arbDiePredicateClauseForLot(
  lot: LotModel,
): fc.Arbitrary<DiePredicateClause> {
  const sbinCodes = Array.from(lot.sbins.keys());
  const hbinCodes = Array.from(lot.hbins.keys());
  const allBins = Array.from(new Set([...sbinCodes, ...hbinCodes, 1, 7, 99]));
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
      codes: fc.uniqueArray(fc.constantFrom(...allBins), {
        minLength: 1,
        maxLength: Math.min(3, allBins.length),
      }),
    }),
    fc.record({
      kind: fc.constant('edge-ring' as const),
      maxRing: fc.integer({ min: 0, max: 6 }),
    }),
    fc.record({
      kind: fc.constant('radial-zone' as const),
      zone: fc.constantFrom<'center' | 'donut'>('center', 'donut'),
    }),
    fc.record({
      kind: fc.constant('wafer' as const),
      waferIndices: fc.uniqueArray(fc.integer({ min: 0, max: waferUpper }), {
        minLength: 1,
        maxLength: Math.min(3, waferUpper + 1),
      }),
    }),
    fc.record({
      kind: fc.constant('site' as const),
      headNum: fc.option(fc.constantFrom(...headNums), { nil: undefined }),
      siteNum: fc.constantFrom(...siteNums),
    }),
  );
}

function arbFilterDslDieAstForLot(lot: LotModel): fc.Arbitrary<FilterDslAst> {
  return fc
    .array(arbDiePredicateClauseForLot(lot), { minLength: 0, maxLength: 4 })
    .map((dieClauses) => ({
      dieClauses,
      capabilityClauses: [],
    }));
}

function arbQuickFiltersForLot(
  lot: LotModel,
): fc.Arbitrary<QuickSelectionFilters> {
  const sbinCodes = Array.from(lot.sbins.keys());
  const hbinCodes = Array.from(lot.hbins.keys());
  const allBins = Array.from(new Set([...sbinCodes, ...hbinCodes, 1, 7]));

  return fc.record({
    bin: fc.option(
      fc.record({
        mode: fc.constantFrom<'SBIN' | 'HBIN'>('SBIN', 'HBIN'),
        code: fc.constantFrom(...allBins),
      }),
      { nil: null },
    ),
    waferIndex: fc.option(
      fc.integer({ min: -1, max: Math.max(0, lot.wafers.length) }),
      { nil: null },
    ),
    siteIndex: fc.option(
      fc.integer({ min: -1, max: Math.max(0, lot.sites.length) }),
      { nil: null },
    ),
  });
}

const arbCapabilityClause: fc.Arbitrary<CapabilityPredicateClause> = fc.record({
  kind: fc.constant('capability' as const),
  metric: fc.constantFrom<'cpk' | 'cp'>('cpk', 'cp'),
  op: fc.constantFrom<ComparisonOp>('<', '<=', '>', '>=', '='),
  threshold: fc.double({ min: -2, max: 5, noNaN: true, noDefaultInfinity: true }),
});

/**
 * Property 12: Brush and Selection Filter Idempotence, Containment, and Commutativity
 * Validates: Requirements 11.1, 11.2, 11.4, 12.2, 12.5
 */
describe('Property 12: Brush and selection filter idempotence, containment, and commutativity', () => {
  it('holds idempotence, subset containment, and commutativity under conjunction for all lots, brushes, DSL predicates, and quick filters', () => {
    fc.assert(
      fc.property(
        arbLotModel.chain((lot) =>
          fc.record({
            lot: fc.constant(lot),
            baseMask: arbDieMask(lot.dies.count),
            brush: arbSpatialBrushForLot(lot),
            dsl: arbFilterDslDieAstForLot(lot),
            quick: arbQuickFiltersForLot(lot),
          }),
        ),
        ({ lot, baseMask, brush, dsl, quick }) => {
          // Individual selections starting from arbitrary subset D (`baseMask`)
          const selB = selectDiesByBrush(lot, brush, baseMask);
          const selP = selectDiesByDsl(lot, dsl, baseMask);
          const selQ = selectDiesByQuickFilters(lot, quick, baseMask);

          // 1. Containment: select(X, D) ⊆ D
          expect(isSubsetMask(selB, baseMask)).toBe(true);
          expect(isSubsetMask(selP, baseMask)).toBe(true);
          expect(isSubsetMask(selQ, baseMask)).toBe(true);

          // Spatial brush always excludes missing-coordinate dies (-32768)
          for (let i = 0; i < lot.dies.count; i += 1) {
            if (lot.dies.hasValidCoords[i] === 0) {
              expect(selB[i]).toBe(0);
            }
          }

          // 2. Idempotence: select(X, select(X, D)) === select(X, D)
          expect(masksEqual(selectDiesByBrush(lot, brush, selB), selB)).toBe(true);
          expect(masksEqual(selectDiesByDsl(lot, dsl, selP), selP)).toBe(true);
          expect(
            masksEqual(selectDiesByQuickFilters(lot, quick, selQ), selQ),
          ).toBe(true);

          // 3. Commutativity under conjunction:
          //    select(B, select(P, D)) === select(P, select(B, D)) === select(B ∧ P, D)
          const bThenP = selectDiesByDsl(lot, dsl, selB);
          const pThenB = selectDiesByBrush(lot, brush, selP);
          const bAndP = evaluateSelection(lot, brush, dsl, undefined, baseMask);

          expect(masksEqual(bThenP, pThenB)).toBe(true);
          expect(masksEqual(bThenP, bAndP.dieMask)).toBe(true);
          expect(bAndP.selectedDieCount).toBe(countMaskDies(bAndP.dieMask));
          expect(isSubsetMask(bAndP.dieMask, baseMask)).toBe(true);

          // 3-way commutativity including quickFilters (Bin, Site, Wafer)
          const bThenQ = selectDiesByQuickFilters(lot, quick, selB);
          const qThenB = selectDiesByBrush(lot, brush, selQ);
          const bAndQ = evaluateSelection(lot, brush, null, quick, baseMask);
          expect(masksEqual(bThenQ, qThenB)).toBe(true);
          expect(masksEqual(bThenQ, bAndQ.dieMask)).toBe(true);

          const allAtOnce = evaluateSelection(lot, brush, dsl, quick, baseMask);
          const chainedBPQ = selectDiesByQuickFilters(lot, quick, bThenP);
          const chainedQPB = selectDiesByBrush(
            lot,
            brush,
            selectDiesByDsl(lot, dsl, selQ),
          );
          expect(masksEqual(allAtOnce.dieMask, chainedBPQ)).toBe(true);
          expect(masksEqual(allAtOnce.dieMask, chainedQPB)).toBe(true);
          expect(allAtOnce.selectedDieCount).toBe(
            countMaskDies(allAtOnce.dieMask),
          );

          // Compound idempotence: select(B ∧ P ∧ Q, select(B ∧ P ∧ Q, D)) === select(B ∧ P ∧ Q, D)
          const allTwice = evaluateSelection(
            lot,
            brush,
            dsl,
            quick,
            allAtOnce.dieMask,
          );
          expect(masksEqual(allTwice.dieMask, allAtOnce.dieMask)).toBe(true);
          expect(allTwice.selectedDieCount).toBe(allAtOnce.selectedDieCount);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('evaluates capability clauses over the selected die mask and selects the lowest-Cpk matching test (Req 12.2, 12.5)', () => {
    fc.assert(
      fc.property(
        arbLotModel.chain((lot) =>
          fc.record({
            lot: fc.constant(lot),
            brush: fc.option(arbSpatialBrushForLot(lot), { nil: null }),
            dieClauses: fc.array(arbDiePredicateClauseForLot(lot), {
              minLength: 0,
              maxLength: 2,
            }),
            capabilityClauses: fc.array(arbCapabilityClause, {
              minLength: 1,
              maxLength: 2,
            }),
          }),
        ),
        ({ lot, brush, dieClauses, capabilityClauses }) => {
          const dsl: FilterDslAst = { dieClauses, capabilityClauses };
          const result = evaluateSelection(lot, brush, dsl);

          // Verify matchingTestNums against direct computeParametricStats over result.dieMask
          const expectedNums: number[] = [];
          let bestCpk = Number.POSITIVE_INFINITY;
          let expectedLowest: number | null = null;

          for (const [testNum, col] of lot.tests.entries()) {
            const stats = computeParametricCapability(col, result.dieMask);
            const ok = capabilityClauses.every((clause) => {
              const v = clause.metric === 'cpk' ? stats.cpk : stats.cp;
              if (v === null || !Number.isFinite(v)) return false;
              switch (clause.op) {
                case '<':
                  return v < clause.threshold;
                case '<=':
                  return v <= clause.threshold;
                case '>':
                  return v > clause.threshold;
                case '>=':
                  return v >= clause.threshold;
                case '=':
                  return Math.abs(v - clause.threshold) <= 1e-9;
              }
            });
            if (ok) {
              expectedNums.push(testNum);
              if (stats.cpk !== null && Number.isFinite(stats.cpk)) {
                if (
                  stats.cpk < bestCpk ||
                  (stats.cpk === bestCpk &&
                    (expectedLowest === null || testNum < expectedLowest))
                ) {
                  bestCpk = stats.cpk;
                  expectedLowest = testNum;
                }
              }
            }
          }

          expect(result.matchingTestNums).toEqual(expectedNums);
          expect(result.lowestCpkTestNum).toBe(expectedLowest);
        },
      ),
      { numRuns: 60 },
    );
  });
});
