import { describe, expect, it } from 'vitest';
import {
  DEMO_TEST_NUMS,
  generateDemoStdfBytes,
} from '../demo/demo-generator';
import { buildLotModel } from '../model/lot-builder';
import type { LotModel } from '../model/types';
import { parseStdfBytes } from '../stdf/stdf-parser';
import {
  applyFilterDslToSelection,
  deserializeFilterDsl,
  EMPTY_FILTER_DSL_AST,
  type FilterDslAst,
  formatFilterDslChipDescriptors,
  formatFilterDslSummary,
  isFilterDslEmpty,
  normalizeFilterDslAst,
  OFFLINE_QUERY_EXAMPLES,
  parseFilterDsl,
  parseOfflineNaturalQuery,
  removeFilterDslClause,
  serializeFilterDsl,
} from './index';

function loadEdgeRingEtchLot(): LotModel {
  const bytes = generateDemoStdfBytes('edge-ring-etch');
  const parsed = parseStdfBytes(bytes, { mode: 'full' });
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) {
    throw new Error('Failed to parse edge-ring-etch demo bytes');
  }
  return buildLotModel(parsed.value);
}

describe('Filter DSL & Offline Natural-Language Grammar (Req 12.2, 12.4, 12.5)', () => {
  it('parses all required natural-language filter queries deterministically', () => {
    expect(parseOfflineNaturalQuery('only bin 7')).toEqual({
      ok: true,
      value: {
        dieClauses: [{ kind: 'bin', mode: 'ANY_BIN', codes: [7] }],
        capabilityClauses: [],
      },
    });

    expect(parseOfflineNaturalQuery('sbin 7')).toEqual({
      ok: true,
      value: {
        dieClauses: [{ kind: 'bin', mode: 'SBIN', codes: [7] }],
        capabilityClauses: [],
      },
    });

    expect(parseOfflineNaturalQuery('hbin 4')).toEqual({
      ok: true,
      value: {
        dieClauses: [{ kind: 'bin', mode: 'HBIN', codes: [4] }],
        capabilityClauses: [],
      },
    });

    expect(parseOfflineNaturalQuery('tests with Cpk < 1.33')).toEqual({
      ok: true,
      value: {
        dieClauses: [],
        capabilityClauses: [
          {
            kind: 'capability',
            metric: 'cpk',
            op: '<',
            threshold: 1.33,
          },
        ],
      },
    });

    expect(parseOfflineNaturalQuery('edge 3 rings')).toEqual({
      ok: true,
      value: {
        dieClauses: [{ kind: 'edge-ring', maxRing: 3 }],
        capabilityClauses: [],
      },
    });

    expect(parseOfflineNaturalQuery('center')).toEqual({
      ok: true,
      value: {
        dieClauses: [{ kind: 'radial-zone', zone: 'center' }],
        capabilityClauses: [],
      },
    });

    expect(parseOfflineNaturalQuery('donut')).toEqual({
      ok: true,
      value: {
        dieClauses: [{ kind: 'radial-zone', zone: 'donut' }],
        capabilityClauses: [],
      },
    });

    expect(parseOfflineNaturalQuery('failures')).toEqual({
      ok: true,
      value: {
        dieClauses: [{ kind: 'pass-status', status: 'fail' }],
        capabilityClauses: [],
      },
    });

    expect(parseOfflineNaturalQuery('passing')).toEqual({
      ok: true,
      value: {
        dieClauses: [{ kind: 'pass-status', status: 'pass' }],
        capabilityClauses: [],
      },
    });

    expect(parseOfflineNaturalQuery('wafer 3')).toEqual({
      ok: true,
      value: {
        dieClauses: [{ kind: 'wafer', waferIndices: [2] }],
        capabilityClauses: [],
      },
    });

    expect(parseOfflineNaturalQuery('site 2')).toEqual({
      ok: true,
      value: {
        dieClauses: [{ kind: 'site', siteNum: 2 }],
        capabilityClauses: [],
      },
    });

    expect(parseOfflineNaturalQuery('site 1:2')).toEqual({
      ok: true,
      value: {
        dieClauses: [{ kind: 'site', headNum: 1, siteNum: 2 }],
        capabilityClauses: [],
      },
    });

    expect(
      parseOfflineNaturalQuery('show edge failures with Cpk < 1.33'),
    ).toEqual({
      ok: true,
      value: {
        dieClauses: [
          { kind: 'edge-ring', maxRing: 3 },
          { kind: 'pass-status', status: 'fail' },
        ],
        capabilityClauses: [
          {
            kind: 'capability',
            metric: 'cpk',
            op: '<',
            threshold: 1.33,
          },
        ],
      },
    });
  });

  it('parses additional natural variations and all OFFLINE_QUERY_EXAMPLES', () => {
    for (const example of OFFLINE_QUERY_EXAMPLES) {
      const parsed = parseOfflineNaturalQuery(example);
      expect(parsed.ok).toBe(true);
    }

    expect(parseOfflineNaturalQuery('bins 4, 7')).toEqual({
      ok: true,
      value: {
        dieClauses: [{ kind: 'bin', mode: 'ANY_BIN', codes: [4, 7] }],
        capabilityClauses: [],
      },
    });

    expect(parseOfflineNaturalQuery('soft bin 7 and hard bin 4')).toEqual({
      ok: true,
      value: {
        dieClauses: [
          { kind: 'bin', mode: 'SBIN', codes: [7] },
          { kind: 'bin', mode: 'HBIN', codes: [4] },
        ],
        capabilityClauses: [],
      },
    });

    expect(parseOfflineNaturalQuery('outer 2 rings')).toEqual({
      ok: true,
      value: {
        dieClauses: [{ kind: 'edge-ring', maxRing: 2 }],
        capabilityClauses: [],
      },
    });

    expect(parseOfflineNaturalQuery('edge ring 4')).toEqual({
      ok: true,
      value: {
        dieClauses: [{ kind: 'edge-ring', maxRing: 4 }],
        capabilityClauses: [],
      },
    });

    expect(parseOfflineNaturalQuery('w03, head 1 site 2, cp >= 1.5')).toEqual({
      ok: true,
      value: {
        dieClauses: [
          { kind: 'wafer', waferIndices: [2] },
          { kind: 'site', headNum: 1, siteNum: 2 },
        ],
        capabilityClauses: [
          { kind: 'capability', metric: 'cp', op: '>=', threshold: 1.5 },
        ],
      },
    });
  });

  it('returns ok: false on invalid, blank, or incomplete natural-language queries (Req 12.4)', () => {
    const invalidInputs = [
      '',
      '   ',
      'gibberish',
      'cpk < abc',
      'edge 0 rings',
      'outer 0 rings',
      'ring 0',
      'only bin',
      'wafer 0',
      'site 0',
      'site 1:0',
      'not a valid filter',
      'show only all dies',
      'only bin 7 unknown',
      'only bin 7 and',
    ];

    for (const input of invalidInputs) {
      const result = parseOfflineNaturalQuery(input);
      expect(result.ok, `Expected "${input}" to fail parsing`).toBe(false);
    }
  });

  it('serializes and deserializes canonical Filter DSL strings and supports parseFilterDsl', () => {
    expect(isFilterDslEmpty(null)).toBe(true);
    expect(isFilterDslEmpty(undefined)).toBe(true);
    expect(isFilterDslEmpty(EMPTY_FILTER_DSL_AST)).toBe(true);
    expect(serializeFilterDsl(EMPTY_FILTER_DSL_AST)).toBe('all');
    expect(deserializeFilterDsl('all')).toEqual({
      ok: true,
      value: EMPTY_FILTER_DSL_AST,
    });

    const ast: FilterDslAst = {
      dieClauses: [
        { kind: 'edge-ring', maxRing: 3 },
        { kind: 'pass-status', status: 'fail' },
        { kind: 'bin', mode: 'SBIN', codes: [7, 7, 11] },
        { kind: 'wafer', waferIndices: [2, 2] },
        { kind: 'site', headNum: 1, siteNum: 2 },
      ],
      capabilityClauses: [
        { kind: 'capability', metric: 'cpk', op: '<', threshold: -0 },
      ],
    };

    const normalized = normalizeFilterDslAst(ast);
    expect(normalized.dieClauses[2]).toEqual({
      kind: 'bin',
      mode: 'SBIN',
      codes: [7, 11],
    });
    expect(normalized.dieClauses[3]).toEqual({
      kind: 'wafer',
      waferIndices: [2],
    });
    expect(Object.is(normalized.capabilityClauses[0]!.threshold, 0)).toBe(true);

    const encoded = serializeFilterDsl(ast);
    expect(encoded).toBe(
      'ring:3;status:fail;bin:SBIN:7,11;wafer:2;site:1:2;cap:cpk:<:0',
    );

    const decoded = deserializeFilterDsl(encoded);
    expect(decoded).toEqual({
      ok: true,
      value: normalized,
    });

    // parseFilterDsl accepts both canonical DSL strings and natural-language strings
    expect(parseFilterDsl(encoded)).toEqual({ ok: true, value: normalized });
    expect(parseFilterDsl('only bin 7')).toEqual({
      ok: true,
      value: {
        dieClauses: [{ kind: 'bin', mode: 'ANY_BIN', codes: [7] }],
        capabilityClauses: [],
      },
    });
  });

  it('evaluates applyFilterDslToSelection on edge-ring-etch to select outer-ring failing dies and identify IDDQ_LEAK (204) as lowestCpkTestNum (Req 12.5)', () => {
    const lot = loadEdgeRingEtchLot();
    const parsed = parseOfflineNaturalQuery(
      'show edge failures with Cpk < 1.33',
      lot,
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const evaluated = applyFilterDslToSelection(lot, parsed.value);

    expect(evaluated.selectedDieCount).toBeGreaterThan(0);
    expect(evaluated.selectedDieCount).toBeLessThan(lot.dies.count);

    // Every selected die must be in the outer 3 rings and failing in finalPass
    for (let i = 0; i < lot.dies.count; i += 1) {
      const inOuter3Fail =
        lot.dies.hasValidCoords[i] === 1 &&
        lot.dies.ringIndex[i]! >= 1 &&
        lot.dies.ringIndex[i]! <= 3 &&
        lot.dies.finalPass[i] === 0;
      expect(evaluated.dieMask[i]).toBe(inOuter3Fail ? 1 : 0);
    }

    expect(evaluated.matchingTestNums).toContain(DEMO_TEST_NUMS.IDDQ_LEAK);
    expect(evaluated.lowestCpkTestNum).toBe(DEMO_TEST_NUMS.IDDQ_LEAK);
  });

  it('formats human-readable chip descriptors and removes individual clauses via removeFilterDslClause', () => {
    const ast: FilterDslAst = {
      dieClauses: [
        { kind: 'edge-ring', maxRing: 3 },
        { kind: 'pass-status', status: 'fail' },
        { kind: 'bin', mode: 'ANY_BIN', codes: [7] },
        { kind: 'bin', mode: 'SBIN', codes: [7] },
        { kind: 'bin', mode: 'HBIN', codes: [4] },
        { kind: 'radial-zone', zone: 'center' },
        { kind: 'radial-zone', zone: 'donut' },
        { kind: 'wafer', waferIndices: [2] },
        { kind: 'site', headNum: 1, siteNum: 2 },
      ],
      capabilityClauses: [
        { kind: 'capability', metric: 'cpk', op: '<', threshold: 1.33 },
      ],
    };

    const chips = formatFilterDslChipDescriptors(ast);
    expect(chips.map((c) => c.label)).toEqual([
      'Outer 3 rings',
      'Failures',
      'Bin 7',
      'SBIN 7',
      'HBIN 4',
      'Center zone',
      'Donut zone',
      'W03',
      'Site 1:2',
      'Cpk < 1.33',
    ]);
    expect(chips[2]!.id).toBe('die:2:bin:ANY_BIN:7');
    expect(chips[9]!.id).toBe('capability:0:cap:cpk:<:1.33');

    const compoundParsed = parseOfflineNaturalQuery(
      'show edge failures with Cpk < 1.33',
    );
    expect(compoundParsed.ok).toBe(true);
    if (!compoundParsed.ok) return;

    expect(formatFilterDslSummary(compoundParsed.value)).toBe(
      'Outer 3 rings, Failures, Cpk < 1.33',
    );

    const compoundChips = formatFilterDslChipDescriptors(compoundParsed.value);
    expect(compoundChips).toHaveLength(3);

    // Remove the first die clause ('Outer 3 rings')
    const afterRemoveFirst = removeFilterDslClause(
      compoundParsed.value,
      compoundChips[0]!.ref,
    );
    expect(afterRemoveFirst).toEqual({
      dieClauses: [{ kind: 'pass-status', status: 'fail' }],
      capabilityClauses: [
        { kind: 'capability', metric: 'cpk', op: '<', threshold: 1.33 },
      ],
    });

    // Remove remaining die clause ('Failures')
    const afterRemoveSecond = removeFilterDslClause(afterRemoveFirst!, {
      section: 'die',
      index: 0,
    });
    expect(afterRemoveSecond).toEqual({
      dieClauses: [],
      capabilityClauses: [
        { kind: 'capability', metric: 'cpk', op: '<', threshold: 1.33 },
      ],
    });

    // Remove the final capability clause -> returns null
    const afterRemoveLast = removeFilterDslClause(afterRemoveSecond!, {
      section: 'capability',
      index: 0,
    });
    expect(afterRemoveLast).toBeNull();
  });
});
