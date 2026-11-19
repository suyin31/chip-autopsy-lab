/**
 * Deterministic offline natural-language filter query parser
 * (`src/core/query/nl-grammar.ts`).
 *
 * Translates natural-language palette queries (`"only bin 7"`, `"edge 3 rings"`,
 * `"tests with Cpk < 1.33"`, `"show edge failures with Cpk < 1.33"`) into
 * validated `FilterDslAst` instances with zero network calls and strict failure
 * on unrecognized tokens or missing arguments.
 *
 * Pure deterministic TypeScript with zero React, Next.js, or DOM imports.
 * Validates: Requirements 12.2, 12.4, 12.5, 16.2, 17.7
 */

import type { BinMode, LotModel } from '../model/types';
import type { Result } from '../stdf/types';
import { deserializeFilterDsl } from './filter-dsl';
import type {
  CapabilityPredicateClause,
  ComparisonOp,
  DiePredicateClause,
  FilterDslAst,
} from './selection-predicates';

export const OFFLINE_QUERY_EXAMPLES = [
  'only bin 7',
  'edge 3 rings',
  'tests with Cpk < 1.33',
  'show edge failures with Cpk < 1.33',
] as const;

const FILLER_WORDS = new Set<string>([
  'show',
  'only',
  'filter',
  'find',
  'select',
  'all',
  'dies',
  'die',
  'tests',
  'test',
  'where',
  'with',
  'in',
  'on',
  'for',
  'from',
  'by',
  'having',
  'that',
  'are',
]);

const CONJUNCTION_WORDS = new Set<string>([
  'and',
  'with',
  'where',
  ',',
  '&',
  '+',
]);

const FAIL_STATUS_WORDS = new Set<string>([
  'failures',
  'failure',
  'failing',
  'failed',
  'fail',
  'fails',
]);

const PASS_STATUS_WORDS = new Set<string>([
  'passing',
  'passed',
  'pass',
  'good',
]);

const COMPARISON_OPS = new Set<string>(['<', '<=', '>', '>=', '=', '==']);
const UNSIGNED_INT_PATTERN = /^\d+$/;
const POSITIVE_INT_PATTERN = /^0*[1-9]\d*$/;
const FINITE_NUMBER_PATTERN = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i;
const WAFER_SHORT_TOKEN_PATTERN = /^w0*([1-9]\d*)$/i;
const WAFER_ARG_TOKEN_PATTERN = /^w?0*([1-9]\d*)$/i;

type LotCatalogSlice = Pick<
  LotModel,
  'wafers' | 'sites' | 'sbins' | 'hbins' | 'tests'
>;

function parseNonNegativeInt(token: string | undefined): number | null {
  if (token === undefined || !UNSIGNED_INT_PATTERN.test(token)) {
    return null;
  }
  const n = Number(token);
  if (!Number.isSafeInteger(n) || n < 0 || n > 65535) {
    return null;
  }
  return n;
}

function parsePositiveInt(token: string | undefined): number | null {
  if (token === undefined || !POSITIVE_INT_PATTERN.test(token)) {
    return null;
  }
  const n = Number(token);
  if (!Number.isSafeInteger(n) || n < 1 || n > 65535) {
    return null;
  }
  return n;
}

function parseFiniteFloat(token: string | undefined): number | null {
  if (token === undefined || !FINITE_NUMBER_PATTERN.test(token)) {
    return null;
  }
  const n = Number(token);
  if (!Number.isFinite(n)) {
    return null;
  }
  return Object.is(n, -0) || n === 0 ? 0 : n;
}

function looksNumericOrZero(token: string | undefined): boolean {
  if (token === undefined) {
    return false;
  }
  return UNSIGNED_INT_PATTERN.test(token) || FINITE_NUMBER_PATTERN.test(token);
}

function resolveWaferIndex(
  token: string | undefined,
  lot?: LotCatalogSlice | null,
): number | null {
  if (token === undefined || token.length === 0) {
    return null;
  }
  const lower = token.toLowerCase();

  // Direct match against lot.wafers by waferId (if provided)
  if (lot?.wafers && lot.wafers.length > 0) {
    const directMatch = lot.wafers.find(
      (w) => w.waferId.toLowerCase() === lower,
    );
    if (directMatch !== undefined) {
      return directMatch.waferIndex;
    }
  }

  const match = WAFER_ARG_TOKEN_PATTERN.exec(token);
  if (!match) {
    return null;
  }
  const oneBased = Number(match[1]);
  if (!Number.isSafeInteger(oneBased) || oneBased < 1) {
    return null;
  }

  if (lot?.wafers && lot.wafers.length > 0) {
    const paddedId = `w${String(oneBased).padStart(2, '0')}`;
    const unpaddedId = `w${oneBased}`;
    const byId = lot.wafers.find((w) => {
      const id = w.waferId.toLowerCase();
      return id === paddedId || id === unpaddedId;
    });
    if (byId !== undefined) {
      return byId.waferIndex;
    }
  }

  return oneBased - 1;
}

function tokenizeNaturalQuery(raw: string): string[] {
  const normalized = raw
    .trim()
    .toLowerCase()
    .replace(/\bedge-rings?\b/g, (m) => m.replace('-', ' '))
    .replace(/<=|>=|==|<|>|=|,|&|\+/g, ' $& ');

  return normalized
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
}

export function parseOfflineNaturalQuery(
  query: string,
  lot?: LotCatalogSlice | null,
): Result<FilterDslAst, string> {
  if (typeof query !== 'string') {
    return { ok: false, error: 'Filter query must be a string.' };
  }
  const trimmed = query.trim();
  if (trimmed.length === 0) {
    return { ok: false, error: 'Filter query cannot be empty.' };
  }

  // Rule 1: If query is a valid canonical DSL string with >= 1 clause (and valid ring >= 1), return it.
  const canonical = deserializeFilterDsl(trimmed);
  if (canonical.ok) {
    const totalClauses =
      canonical.value.dieClauses.length +
      canonical.value.capabilityClauses.length;
    const allRingsValid = canonical.value.dieClauses.every(
      (c) => c.kind !== 'edge-ring' || c.maxRing >= 1,
    );
    if (totalClauses >= 1 && allRingsValid) {
      return canonical;
    }
  }

  const tokens = tokenizeNaturalQuery(trimmed);
  if (tokens.length === 0) {
    return { ok: false, error: 'Filter query cannot be empty.' };
  }

  const lastToken = tokens[tokens.length - 1]!;
  if (CONJUNCTION_WORDS.has(lastToken)) {
    return {
      ok: false,
      error: `Incomplete filter query ending with "${lastToken}".`,
    };
  }

  const dieClauses: DiePredicateClause[] = [];
  const capabilityClauses: CapabilityPredicateClause[] = [];
  let pos = 0;

  while (pos < tokens.length) {
    const tok = tokens[pos]!;

    if (FILLER_WORDS.has(tok) || CONJUNCTION_WORDS.has(tok)) {
      pos += 1;
      continue;
    }

    // 1. Bin clauses: "bin 7", "bins 4, 7", "sbin 7", "soft bin 7", "hbin 4", "hard bin 4"
    if (
      tok === 'bin' ||
      tok === 'bins' ||
      tok === 'sbin' ||
      tok === 'sbins' ||
      tok === 'hbin' ||
      tok === 'hbins' ||
      tok === 'soft' ||
      tok === 'hard'
    ) {
      let mode: BinMode | 'ANY_BIN' = 'ANY_BIN';
      if (tok === 'sbin' || tok === 'sbins') {
        mode = 'SBIN';
        pos += 1;
      } else if (tok === 'hbin' || tok === 'hbins') {
        mode = 'HBIN';
        pos += 1;
      } else if (tok === 'soft') {
        const nextTok = tokens[pos + 1];
        if (nextTok !== 'bin' && nextTok !== 'bins') {
          return {
            ok: false,
            error: 'Expected "bin" after "soft".',
          };
        }
        mode = 'SBIN';
        pos += 2;
      } else if (tok === 'hard') {
        const nextTok = tokens[pos + 1];
        if (nextTok !== 'bin' && nextTok !== 'bins') {
          return {
            ok: false,
            error: 'Expected "bin" after "hard".',
          };
        }
        mode = 'HBIN';
        pos += 2;
      } else {
        mode = 'ANY_BIN';
        pos += 1;
      }

      if (tokens[pos] === '=' || tokens[pos] === '==') {
        pos += 1;
      }

      const firstCode = parseNonNegativeInt(tokens[pos]);
      if (firstCode === null) {
        return {
          ok: false,
          error: 'Expected a valid non-negative integer bin code.',
        };
      }
      const codes: number[] = [firstCode];
      pos += 1;

      while (pos < tokens.length) {
        if (
          (tokens[pos] === ',' ||
            tokens[pos] === 'and' ||
            tokens[pos] === 'or') &&
          parseNonNegativeInt(tokens[pos + 1]) !== null
        ) {
          codes.push(parseNonNegativeInt(tokens[pos + 1])!);
          pos += 2;
        } else if (parseNonNegativeInt(tokens[pos]) !== null) {
          codes.push(parseNonNegativeInt(tokens[pos])!);
          pos += 1;
        } else {
          break;
        }
      }

      dieClauses.push({
        kind: 'bin',
        mode,
        codes: Array.from(new Set(codes)),
      });
      continue;
    }

    // 2. Spatial radial-zone clauses: "center", "centre", "center zone", "donut", "donut zone"
    if (tok === 'center' || tok === 'centre') {
      pos += 1;
      if (tokens[pos] === 'zone') {
        pos += 1;
      }
      dieClauses.push({ kind: 'radial-zone', zone: 'center' });
      continue;
    }

    if (tok === 'donut') {
      pos += 1;
      if (tokens[pos] === 'zone') {
        pos += 1;
      }
      dieClauses.push({ kind: 'radial-zone', zone: 'donut' });
      continue;
    }

    // 3. Spatial edge-ring clauses:
    //    "edge <N> rings", "outer <N> rings", "edge ring <N>", "ring <N>", bare "edge", "edge-ring", "edge ring"
    if (tok === 'outer') {
      pos += 1;
      if (tokens[pos] === 'ring' || tokens[pos] === 'rings') {
        pos += 1;
        const n = parsePositiveInt(tokens[pos]);
        if (n === null) {
          return {
            ok: false,
            error: 'Outer ring count must be an integer >= 1.',
          };
        }
        pos += 1;
        dieClauses.push({ kind: 'edge-ring', maxRing: n });
        continue;
      }
      const n = parsePositiveInt(tokens[pos]);
      if (n === null) {
        return {
          ok: false,
          error: 'Outer ring count must be an integer >= 1.',
        };
      }
      pos += 1;
      if (tokens[pos] === 'ring' || tokens[pos] === 'rings') {
        pos += 1;
      }
      dieClauses.push({ kind: 'edge-ring', maxRing: n });
      continue;
    }

    if (tok === 'ring' || tok === 'rings') {
      pos += 1;
      if (tokens[pos] === '=' || tokens[pos] === '<=') {
        pos += 1;
      }
      const n = parsePositiveInt(tokens[pos]);
      if (n === null) {
        return {
          ok: false,
          error: 'Ring count must be an integer >= 1.',
        };
      }
      pos += 1;
      dieClauses.push({ kind: 'edge-ring', maxRing: n });
      continue;
    }

    if (tok === 'edge') {
      pos += 1;
      const afterEdge = tokens[pos];

      if (looksNumericOrZero(afterEdge)) {
        const n = parsePositiveInt(afterEdge);
        if (n === null) {
          return {
            ok: false,
            error: 'Edge ring count must be an integer >= 1.',
          };
        }
        pos += 1;
        if (tokens[pos] === 'ring' || tokens[pos] === 'rings') {
          pos += 1;
        }
        dieClauses.push({ kind: 'edge-ring', maxRing: n });
        continue;
      }

      if (afterEdge === 'ring' || afterEdge === 'rings') {
        pos += 1;
        if (looksNumericOrZero(tokens[pos])) {
          const n = parsePositiveInt(tokens[pos]);
          if (n === null) {
            return {
              ok: false,
              error: 'Edge ring count must be an integer >= 1.',
            };
          }
          pos += 1;
          dieClauses.push({ kind: 'edge-ring', maxRing: n });
          continue;
        }
        dieClauses.push({ kind: 'edge-ring', maxRing: 3 });
        continue;
      }

      // Bare "edge" (e.g. "edge" or "show edge failures with Cpk < 1.33")
      dieClauses.push({ kind: 'edge-ring', maxRing: 3 });
      continue;
    }

    // 4. Pass/Fail status clauses
    if (FAIL_STATUS_WORDS.has(tok)) {
      pos += 1;
      dieClauses.push({ kind: 'pass-status', status: 'fail' });
      continue;
    }

    if (PASS_STATUS_WORDS.has(tok)) {
      pos += 1;
      dieClauses.push({ kind: 'pass-status', status: 'pass' });
      continue;
    }

    // 5. Wafer clauses: "wafer <N>", "w<N>", "w0<N>"
    if (tok === 'wafer' || tok === 'wafers') {
      pos += 1;
      if (tokens[pos] === '=' || tokens[pos] === '==') {
        pos += 1;
      }
      const firstWaferIdx = resolveWaferIndex(tokens[pos], lot);
      if (firstWaferIdx === null) {
        return {
          ok: false,
          error: 'Expected a valid wafer number >= 1.',
        };
      }
      const waferIndices: number[] = [firstWaferIdx];
      pos += 1;

      while (pos < tokens.length) {
        if (
          tokens[pos] === ',' &&
          resolveWaferIndex(tokens[pos + 1], lot) !== null
        ) {
          waferIndices.push(resolveWaferIndex(tokens[pos + 1], lot)!);
          pos += 2;
        } else {
          break;
        }
      }

      dieClauses.push({
        kind: 'wafer',
        waferIndices: Array.from(new Set(waferIndices)),
      });
      continue;
    }

    if (WAFER_SHORT_TOKEN_PATTERN.test(tok)) {
      const waferIdx = resolveWaferIndex(tok, lot);
      if (waferIdx === null) {
        return {
          ok: false,
          error: `Invalid wafer identifier "${tok}".`,
        };
      }
      pos += 1;
      dieClauses.push({
        kind: 'wafer',
        waferIndices: [waferIdx],
      });
      continue;
    }

    // 6. Site clauses: "site <H>:<S>", "head <H> site <S>", "site <S>"
    if (tok === 'head') {
      pos += 1;
      const headNum = parsePositiveInt(tokens[pos]);
      if (headNum === null) {
        return {
          ok: false,
          error: 'Expected a positive integer head number.',
        };
      }
      pos += 1;
      if (tokens[pos] !== 'site') {
        return {
          ok: false,
          error: 'Expected "site" after head number.',
        };
      }
      pos += 1;
      const siteNum = parsePositiveInt(tokens[pos]);
      if (siteNum === null) {
        return {
          ok: false,
          error: 'Expected a positive integer site number.',
        };
      }
      pos += 1;
      dieClauses.push({ kind: 'site', headNum, siteNum });
      continue;
    }

    if (tok === 'site') {
      pos += 1;
      if (tokens[pos] === '=' || tokens[pos] === '==') {
        pos += 1;
      }
      const siteArg = tokens[pos];
      if (siteArg === undefined) {
        return {
          ok: false,
          error: 'Expected a site identifier after "site".',
        };
      }
      if (siteArg.includes(':')) {
        const parts = siteArg.split(':');
        if (parts.length !== 2) {
          return {
            ok: false,
            error: `Invalid site format "${siteArg}".`,
          };
        }
        const headNum = parsePositiveInt(parts[0]);
        const siteNum = parsePositiveInt(parts[1]);
        if (headNum === null || siteNum === null) {
          return {
            ok: false,
            error: `Invalid head:site numbers in "${siteArg}".`,
          };
        }
        pos += 1;
        dieClauses.push({ kind: 'site', headNum, siteNum });
        continue;
      }
      const siteNum = parsePositiveInt(siteArg);
      if (siteNum === null) {
        return {
          ok: false,
          error: `Invalid site number "${siteArg}".`,
        };
      }
      pos += 1;
      dieClauses.push({ kind: 'site', siteNum });
      continue;
    }

    // 7. Capability clauses: "cpk <op> <num>", "cp <op> <num>"
    if (tok === 'cpk' || tok === 'cp') {
      const metric: 'cpk' | 'cp' = tok;
      pos += 1;
      const opTok = tokens[pos];
      if (opTok === undefined || !COMPARISON_OPS.has(opTok)) {
        return {
          ok: false,
          error: `Expected a comparison operator (<, <=, >, >=, =) after "${metric.toUpperCase()}".`,
        };
      }
      const op: ComparisonOp = opTok === '==' ? '=' : (opTok as ComparisonOp);
      pos += 1;

      const threshold = parseFiniteFloat(tokens[pos]);
      if (threshold === null) {
        return {
          ok: false,
          error: `Expected a finite numeric threshold after "${metric.toUpperCase()} ${op}".`,
        };
      }
      pos += 1;

      capabilityClauses.push({
        kind: 'capability',
        metric,
        op,
        threshold,
      });
      continue;
    }

    return {
      ok: false,
      error: `Unrecognized token "${tok}" in filter query.`,
    };
  }

  if (dieClauses.length === 0 && capabilityClauses.length === 0) {
    return {
      ok: false,
      error: 'Filter query did not match any filter criteria.',
    };
  }

  return {
    ok: true,
    value: {
      dieClauses,
      capabilityClauses,
    },
  };
}
