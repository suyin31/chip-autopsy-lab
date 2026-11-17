import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  arbChronologicalPrrStream,
  arbStdfWriteLotSpec,
} from '../__test-utils__/arbitraries';
import { parseStdfBytes } from '../stdf/stdf-parser';
import { writeStdfBytes } from '../stdf/stdf-writer';
import {
  type BinPassFailFlag,
  type ParsedPartExecution,
  PRR_PART_FLG,
  STDF_MISSING_COORD,
} from '../stdf/types';
import { buildLotModel, computeWaferEdgeRingIndices } from './lot-builder';
import { packWaferCoord } from './types';

const NUM_RUNS = Number(process.env.FC_NUM_RUNS ?? 200);

function oraclePartPass(
  partFlg: number,
  hardBin: number,
  hbinPfMap: ReadonlyMap<number, BinPassFailFlag>,
): { readonly passed: boolean; readonly warnsMissingHbinPf: boolean } {
  if ((partFlg & PRR_PART_FLG.PF_INVALID) === 0) {
    return {
      passed: (partFlg & PRR_PART_FLG.FAILED) === 0,
      warnsMissingHbinPf: false,
    };
  }
  const pf = hbinPfMap.get(hardBin);
  if (pf === 'P') {
    return { passed: true, warnsMissingHbinPf: false };
  }
  if (pf === 'F') {
    return { passed: false, warnsMissingHbinPf: false };
  }
  return { passed: false, warnsMissingHbinPf: true };
}

describe('Property 3: Retest Resolution Determinism — First-Pass vs. Final State (fast-check)', () => {
  it('resolves repeated (X_COORD, Y_COORD) PRRs to unique canonical dies with exact first/last state, HBIN_PF fallback, and non-leaking PTR values', () => {
    fc.assert(
      fc.property(arbChronologicalPrrStream, (input) => {
        const lotA = buildLotModel(input);
        const lotB = buildLotModel(input);

        // Strict determinism across repeated invocations
        expect(lotB).toEqual(lotA);

        // Build independent HBR oracle map (respecting HEAD_NUM=255 summary precedence)
        const hbinPfOracle = new Map<number, BinPassFailFlag>();
        for (const h of input.hbrs) {
          const pf: BinPassFailFlag =
            h.hbinPf === 'P' || h.hbinPf === 'F' ? h.hbinPf : ' ';
          const prev = hbinPfOracle.get(h.hbinNum);
          if (prev === undefined) {
            hbinPfOracle.set(h.hbinNum, pf);
          } else if (h.headNum === 255 && pf !== ' ') {
            hbinPfOracle.set(h.hbinNum, pf);
          } else if (prev === ' ' && pf !== ' ') {
            hbinPfOracle.set(h.hbinNum, pf);
          }
        }

        // Bijection between dieIds and dieIndexById
        expect(lotA.dieIds).toHaveLength(lotA.dies.count);
        expect(lotA.dieIndexById.size).toBe(lotA.dies.count);
        for (let i = 0; i < lotA.dies.count; i += 1) {
          expect(lotA.dieIndexById.get(lotA.dieIds[i]!)).toBe(i);
        }

        let expectedTotalDies = 0;
        let expectedMissingHbinWarnings = 0;

        for (let w = 0; w < input.wafers.length; w += 1) {
          const wfInput = input.wafers[w]!;
          const wfSummary = lotA.wafers[w]!;
          const coordIndex = lotA.waferCoordIndex[w]!;

          // Group chronological executions independently per wafer
          const groupsByCoord = new Map<string, ParsedPartExecution[]>();
          const orderedGroupKeys: string[] = [];
          let missingSeq = 0;

          for (const part of wfInput.parts) {
            const { warnsMissingHbinPf } = oraclePartPass(
              part.partFlg,
              part.hardBin,
              hbinPfOracle,
            );
            if (warnsMissingHbinPf) {
              expectedMissingHbinWarnings += 1;
            }

            const validCoords =
              part.xCoord !== STDF_MISSING_COORD &&
              part.yCoord !== STDF_MISSING_COORD;
            const key = validCoords
              ? `${part.xCoord},${part.yCoord}`
              : `part-${missingSeq++}`;
            const existing = groupsByCoord.get(key);
            if (!existing) {
              groupsByCoord.set(key, [part]);
              orderedGroupKeys.push(key);
            } else {
              existing.push(part);
            }
          }

          expect(wfSummary.dieStartIndex).toBe(expectedTotalDies);
          expect(wfSummary.dieEndIndex).toBe(
            expectedTotalDies + orderedGroupKeys.length,
          );

          let validCoordCountOnWafer = 0;

          for (let localIdx = 0; localIdx < orderedGroupKeys.length; localIdx += 1) {
            const key = orderedGroupKeys[localIdx]!;
            const executions = groupsByCoord.get(key)!;
            const firstExec = executions[0]!;
            const lastExec = executions[executions.length - 1]!;
            const globalDieIdx = wfSummary.dieStartIndex + localIdx;

            const expectedFirstPass = oraclePartPass(
              firstExec.partFlg,
              firstExec.hardBin,
              hbinPfOracle,
            ).passed;
            const expectedFinalPass = oraclePartPass(
              lastExec.partFlg,
              lastExec.hardBin,
              hbinPfOracle,
            ).passed;

            expect(lotA.dieIds[globalDieIdx]).toBe(`${wfSummary.waferId}:${key}`);
            expect(lotA.dies.waferIndex[globalDieIdx]).toBe(w);
            expect(lotA.dies.firstPass[globalDieIdx]).toBe(expectedFirstPass ? 1 : 0);
            expect(lotA.dies.finalPass[globalDieIdx]).toBe(expectedFinalPass ? 1 : 0);
            expect(lotA.dies.hbin[globalDieIdx]).toBe(lastExec.hardBin);
            expect(lotA.dies.sbin[globalDieIdx]).toBe(lastExec.softBin);
            expect(lotA.dies.retestCount[globalDieIdx]).toBe(executions.length - 1);
            expect(lotA.dies.firstPrrOrder[globalDieIdx]).toBe(firstExec.prrIndex);

            const resolvedFirstSite = lotA.sites[lotA.dies.firstSiteIndex[globalDieIdx]!]!;
            expect(resolvedFirstSite.headNum).toBe(firstExec.headNum);
            expect(resolvedFirstSite.siteNum).toBe(firstExec.siteNum);

            const resolvedSite = lotA.sites[lotA.dies.siteIndex[globalDieIdx]!]!;
            expect(resolvedSite.headNum).toBe(lastExec.headNum);
            expect(resolvedSite.siteNum).toBe(lastExec.siteNum);

            const isCoordValid = !key.startsWith('part-');
            expect(lotA.dies.hasValidCoords[globalDieIdx]).toBe(isCoordValid ? 1 : 0);
            if (isCoordValid) {
              validCoordCountOnWafer += 1;
              expect(
                coordIndex.get(packWaferCoord(lastExec.xCoord, lastExec.yCoord)),
              ).toBe(globalDieIdx);
              expect(lotA.dies.ringIndex[globalDieIdx]).toBeGreaterThanOrEqual(1);
            } else {
              expect(lotA.dies.ringIndex[globalDieIdx]).toBe(0);
            }

            // Active PTR values must match `lastExec` only (never stale values from earlier PRRs)
            if (input.parseMode === 'full') {
              const lastPtrByTest = new Map<number, number>();
              for (const ptr of lastExec.ptrs) {
                lastPtrByTest.set(ptr.testNum, ptr.result);
              }
              for (const [testNum, col] of lotA.tests.entries()) {
                const actualVal = col.values[globalDieIdx]!;
                if (!lastPtrByTest.has(testNum)) {
                  expect(Number.isNaN(actualVal)).toBe(true);
                } else {
                  const expectedVal = lastPtrByTest.get(testNum)!;
                  if (Number.isNaN(expectedVal)) {
                    expect(Number.isNaN(actualVal)).toBe(true);
                  } else {
                    expect(actualVal).toBe(Math.fround(expectedVal));
                  }
                }
              }
            } else {
              expect(lotA.tests.size).toBe(0);
            }
          }

          expect(coordIndex.size).toBe(validCoordCountOnWafer);
          expectedTotalDies += orderedGroupKeys.length;
        }

        expect(lotA.dies.count).toBe(expectedTotalDies);
        const missingPfWarnings = lotA.warnings.filter(
          (w) => w.code === 'MISSING_HBIN_PF_FLAG',
        );
        expect(missingPfWarnings).toHaveLength(expectedMissingHbinWarnings);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('satisfies exact 4-neighbour Bellman shortest-distance equations for computeWaferEdgeRingIndices on arbitrary wafer shapes', () => {
    const arbCoordSet = fc.array(
      fc.record({
        x: fc.integer({ min: -25, max: 25 }),
        y: fc.integer({ min: -25, max: 25 }),
      }),
      { minLength: 1, maxLength: 80 },
    );

    fc.assert(
      fc.property(arbCoordSet, (coords) => {
        const rings = computeWaferEdgeRingIndices(coords);
        expect(rings).toHaveLength(coords.length);

        const ringByKey = new Map<number, number>();
        for (let i = 0; i < coords.length; i += 1) {
          const { x, y } = coords[i]!;
          const key = packWaferCoord(x, y);
          if (ringByKey.has(key)) {
            expect(rings[i]).toBe(ringByKey.get(key));
          } else {
            ringByKey.set(key, rings[i]!);
          }
          expect(rings[i]).toBeGreaterThanOrEqual(1);
        }

        // Bellman optimality identity: ring(p) === 1 if any 4-neighbour is outside S,
        // else ring(p) === 1 + min_{q in N4(p)} ring(q).
        for (const { x, y } of coords) {
          const r = ringByKey.get(packWaferCoord(x, y))!;
          const n1 = ringByKey.get(packWaferCoord(x - 1, y));
          const n2 = ringByKey.get(packWaferCoord(x + 1, y));
          const n3 = ringByKey.get(packWaferCoord(x, y - 1));
          const n4 = ringByKey.get(packWaferCoord(x, y + 1));

          if (
            n1 === undefined ||
            n2 === undefined ||
            n3 === undefined ||
            n4 === undefined
          ) {
            expect(r).toBe(1);
          } else {
            expect(r).toBe(1 + Math.min(n1, n2, n3, n4));
          }
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('preserves resolved LotModel invariants end-to-end across writeStdfBytes -> parseStdfBytes -> buildLotModel', () => {
    fc.assert(
      fc.property(arbStdfWriteLotSpec, (spec) => {
        const bytes = writeStdfBytes(spec);
        const parsed = parseStdfBytes(bytes, { mode: 'full' });
        expect(parsed.ok).toBe(true);
        if (!parsed.ok) return;

        const lot = buildLotModel(parsed.value);

        // Total PRR executions equals resolved dies + sum of retest counts
        let totalRetests = 0;
        for (let i = 0; i < lot.dies.count; i += 1) {
          totalRetests += lot.dies.retestCount[i]!;
        }
        expect(lot.dies.count + totalRetests).toBe(parsed.value.validPrrCount);
      }),
      { numRuns: Math.max(50, Math.floor(NUM_RUNS / 2)) },
    );
  });
});
