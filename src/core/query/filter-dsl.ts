/**
 * Deterministic Filter DSL AST codec, selection evaluator, and removable chip
 * descriptors (`src/core/query/filter-dsl.ts`).
 *
 * Pure deterministic TypeScript with zero React, Next.js, or DOM imports.
 * Guarantees Property 13 (canonical round-trip serialization equivalence and
 * identical selection evaluation over any `LotModel`).
 *
 * Validates: Requirements 12.2, 12.4, 12.5, 13.1, 13.4, 17.7
 */

import type { BinMode, LotModel } from '../model/types';
import type { Result } from '../stdf/types';
import { parseOfflineNaturalQuery } from './nl-grammar';
import {
  type CapabilityPredicateClause,
  type ComparisonOp,
  type DiePredicateClause,
  evaluateSelection,
  type FilterDslAst,
  type FilterEvaluationResult,
  type QuickSelectionFilters,
  type SpatialBrushRect,
} from './selection-predicates';

export type {
  CapabilityPredicateClause,
  ComparisonOp,
  DiePredicateClause,
  FilterDslAst,
  FilterEvaluationResult,
  QuickSelectionFilters,
  SpatialBrushRect,
};

export type FilterDslClauseRef =
  | {
      readonly section: 'die';
      readonly index: number;
      readonly clause: DiePredicateClause;
    }
  | {
      readonly section: 'capability';
      readonly index: number;
      readonly clause: CapabilityPredicateClause;
    };

export interface FilterDslChipDescriptor {
  /** Stable key, e.g. `'die:0:bin:ANY_BIN:7'` or `'capability:0:cap:cpk:<:1.33'`. */
  readonly id: string;
  /**
   * Human-readable chip text: `'Bin 7'`, `'SBIN 7'`, `'HBIN 4'`, `'Outer 3 rings'`,
   * `'Center zone'`, `'Donut zone'`, `'Failures'`, `'Passing'`, `'W03'`,
   * `'Site 1:2'`, `'Cpk < 1.33'`.
   */
  readonly label: string;
  readonly ref: FilterDslClauseRef;
}

export const EMPTY_FILTER_DSL_AST: FilterDslAst = {
  dieClauses: [],
  capabilityClauses: [],
};

const VALID_BIN_MODES = new Set<string>(['SBIN', 'HBIN', 'ANY_BIN']);
const VALID_COMPARISON_OPS = new Set<string>(['<', '<=', '>', '>=', '=', '==']);
const FINITE_NUMBER_PATTERN = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i;
const UNSIGNED_INT_PATTERN = /^\d+$/;

function normalizeNonNegativeInt(n: number): number {
  if (!Number.isFinite(n)) {
    return 0;
  }
  const truncated = Math.max(0, Math.trunc(n));
  return Object.is(truncated, -0) ? 0 : truncated;
}

function normalizeThreshold(n: number): number {
  const num = Number(n);
  if (!Number.isFinite(num) || Object.is(num, -0) || num === 0) {
    return 0;
  }
  return num;
}

function normalizeDieClause(clause: DiePredicateClause): DiePredicateClause {
  switch (clause.kind) {
    case 'pass-status':
      return {
        kind: 'pass-status',
        status: clause.status === 'pass' ? 'pass' : 'fail',
      };
    case 'bin': {
      const codes = Array.from(
        new Set(clause.codes.map(normalizeNonNegativeInt)),
      );
      return {
        kind: 'bin',
        mode: clause.mode,
        codes: codes.length > 0 ? codes : [0],
      };
    }
    case 'edge-ring':
      return {
        kind: 'edge-ring',
        maxRing: normalizeNonNegativeInt(clause.maxRing),
      };
    case 'radial-zone':
      return {
        kind: 'radial-zone',
        zone: clause.zone === 'donut' ? 'donut' : 'center',
      };
    case 'wafer': {
      const waferIndices = Array.from(
        new Set(clause.waferIndices.map(normalizeNonNegativeInt)),
      );
      return {
        kind: 'wafer',
        waferIndices: waferIndices.length > 0 ? waferIndices : [0],
      };
    }
    case 'site': {
      const siteNum = normalizeNonNegativeInt(clause.siteNum);
      if (clause.headNum !== undefined) {
        return {
          kind: 'site',
          headNum: normalizeNonNegativeInt(clause.headNum),
          siteNum,
        };
      }
      return {
        kind: 'site',
        siteNum,
      };
    }
  }
}

function normalizeCapabilityClause(
  clause: CapabilityPredicateClause,
): CapabilityPredicateClause {
  return {
    kind: 'capability',
    metric: clause.metric === 'cp' ? 'cp' : 'cpk',
    op: clause.op,
    threshold: normalizeThreshold(clause.threshold),
  };
}

export function isFilterDslEmpty(
  ast: FilterDslAst | null | undefined,
): boolean {
  if (!ast) {
    return true;
  }
  return ast.dieClauses.length === 0 && ast.capabilityClauses.length === 0;
}

/**
 * Normalizes integers (`Math.max(0, Math.trunc(n))`), deduplicates
 * `codes`/`waferIndices`, omits `undefined` optional fields, and normalizes
 * `-0 -> 0` on thresholds.
 */
export function normalizeFilterDslAst(ast: FilterDslAst): FilterDslAst {
  return {
    dieClauses: ast.dieClauses.map(normalizeDieClause),
    capabilityClauses: ast.capabilityClauses.map(normalizeCapabilityClause),
  };
}

function serializeDieClauseToken(clause: DiePredicateClause): string {
  switch (clause.kind) {
    case 'pass-status':
      return `status:${clause.status}`;
    case 'bin':
      return `bin:${clause.mode}:${clause.codes.join(',')}`;
    case 'edge-ring':
      return `ring:${clause.maxRing}`;
    case 'radial-zone':
      return `zone:${clause.zone}`;
    case 'wafer':
      return `wafer:${clause.waferIndices.join(',')}`;
    case 'site':
      return clause.headNum !== undefined
        ? `site:${clause.headNum}:${clause.siteNum}`
        : `site:${clause.siteNum}`;
  }
}

function serializeCapabilityClauseToken(
  clause: CapabilityPredicateClause,
): string {
  return `cap:${clause.metric}:${clause.op}:${Number(clause.threshold)}`;
}

/**
 * Canonical deterministic codec (Property 13):
 * Serializes clauses as `';'`-joined tokens in order (`dieClauses` then `capabilityClauses`),
 * or `'all'` when empty:
 * - pass-status:  `status:fail` | `status:pass`
 * - bin:          `bin:${mode}:${codes.join(',')}` (e.g. `bin:ANY_BIN:7`, `bin:SBIN:7`, `bin:HBIN:4`)
 * - edge-ring:    `ring:${maxRing}` (e.g. `ring:3`)
 * - radial-zone:  `zone:center` | `zone:donut`
 * - wafer:        `wafer:${waferIndices.join(',')}` (0-based indices, e.g. `wafer:2`)
 * - site:         `site:${headNum}:${siteNum}` (when headNum defined) | `site:${siteNum}`
 * - capability:   `cap:${metric}:${op}:${Number(threshold)}` (e.g. `cap:cpk:<:1.33`)
 */
export function serializeFilterDsl(ast: FilterDslAst): string {
  const normalized = normalizeFilterDslAst(ast);
  if (isFilterDslEmpty(normalized)) {
    return 'all';
  }
  const tokens: string[] = [];
  for (const clause of normalized.dieClauses) {
    tokens.push(serializeDieClauseToken(clause));
  }
  for (const clause of normalized.capabilityClauses) {
    tokens.push(serializeCapabilityClauseToken(clause));
  }
  return tokens.join(';');
}

function parseUnsignedIntToken(raw: string): number | null {
  if (!UNSIGNED_INT_PATTERN.test(raw)) {
    return null;
  }
  const n = Number(raw);
  if (!Number.isSafeInteger(n) || n < 0) {
    return null;
  }
  return n;
}

export function deserializeFilterDsl(
  encoded: string,
): Result<FilterDslAst, string> {
  if (typeof encoded !== 'string') {
    return { ok: false, error: 'Filter DSL input must be a string.' };
  }
  const trimmed = encoded.trim();
  if (trimmed.length === 0) {
    return { ok: false, error: 'Filter DSL input cannot be empty.' };
  }
  if (trimmed.toLowerCase() === 'all') {
    return {
      ok: true,
      value: { dieClauses: [], capabilityClauses: [] },
    };
  }

  const rawTokens = trimmed.split(';').map((t) => t.trim());
  if (rawTokens.some((t) => t.length === 0)) {
    return {
      ok: false,
      error: 'Filter DSL contains an empty clause token.',
    };
  }

  const dieClauses: DiePredicateClause[] = [];
  const capabilityClauses: CapabilityPredicateClause[] = [];

  for (const token of rawTokens) {
    const parts = token.split(':');
    const prefix = parts[0]?.toLowerCase() ?? '';

    switch (prefix) {
      case 'status': {
        if (parts.length !== 2) {
          return {
            ok: false,
            error: `Malformed status clause "${token}".`,
          };
        }
        const status = parts[1]!.toLowerCase();
        if (status !== 'fail' && status !== 'pass') {
          return {
            ok: false,
            error: `Invalid pass-status value "${parts[1]}" in "${token}".`,
          };
        }
        dieClauses.push({ kind: 'pass-status', status });
        break;
      }

      case 'bin': {
        if (parts.length !== 3) {
          return {
            ok: false,
            error: `Malformed bin clause "${token}".`,
          };
        }
        const rawMode = parts[1]!.toUpperCase();
        if (!VALID_BIN_MODES.has(rawMode)) {
          return {
            ok: false,
            error: `Invalid bin mode "${parts[1]}" in "${token}".`,
          };
        }
        const mode = rawMode as BinMode | 'ANY_BIN';
        const rawCodes = parts[2]!.split(',');
        if (rawCodes.length === 0) {
          return {
            ok: false,
            error: `Missing bin codes in "${token}".`,
          };
        }
        const parsedCodes: number[] = [];
        for (const c of rawCodes) {
          const code = parseUnsignedIntToken(c);
          if (code === null || code > 65535) {
            return {
              ok: false,
              error: `Invalid bin code "${c}" in "${token}".`,
            };
          }
          parsedCodes.push(code);
        }
        const codes = Array.from(new Set(parsedCodes));
        dieClauses.push({ kind: 'bin', mode, codes });
        break;
      }

      case 'ring': {
        if (parts.length !== 2) {
          return {
            ok: false,
            error: `Malformed ring clause "${token}".`,
          };
        }
        const maxRing = parseUnsignedIntToken(parts[1]!);
        if (maxRing === null) {
          return {
            ok: false,
            error: `Invalid ring value "${parts[1]}" in "${token}".`,
          };
        }
        dieClauses.push({ kind: 'edge-ring', maxRing });
        break;
      }

      case 'zone': {
        if (parts.length !== 2) {
          return {
            ok: false,
            error: `Malformed zone clause "${token}".`,
          };
        }
        const zone = parts[1]!.toLowerCase();
        if (zone !== 'center' && zone !== 'donut') {
          return {
            ok: false,
            error: `Invalid radial zone "${parts[1]}" in "${token}".`,
          };
        }
        dieClauses.push({ kind: 'radial-zone', zone });
        break;
      }

      case 'wafer': {
        if (parts.length !== 2) {
          return {
            ok: false,
            error: `Malformed wafer clause "${token}".`,
          };
        }
        const rawIndices = parts[1]!.split(',');
        if (rawIndices.length === 0) {
          return {
            ok: false,
            error: `Missing wafer indices in "${token}".`,
          };
        }
        const parsedIndices: number[] = [];
        for (const w of rawIndices) {
          const idx = parseUnsignedIntToken(w);
          if (idx === null) {
            return {
              ok: false,
              error: `Invalid wafer index "${w}" in "${token}".`,
            };
          }
          parsedIndices.push(idx);
        }
        const waferIndices = Array.from(new Set(parsedIndices));
        dieClauses.push({ kind: 'wafer', waferIndices });
        break;
      }

      case 'site': {
        if (parts.length === 2) {
          const siteNum = parseUnsignedIntToken(parts[1]!);
          if (siteNum === null) {
            return {
              ok: false,
              error: `Invalid site number "${parts[1]}" in "${token}".`,
            };
          }
          dieClauses.push({ kind: 'site', siteNum });
        } else if (parts.length === 3) {
          const headNum = parseUnsignedIntToken(parts[1]!);
          const siteNum = parseUnsignedIntToken(parts[2]!);
          if (headNum === null || siteNum === null) {
            return {
              ok: false,
              error: `Invalid head:site numbers in "${token}".`,
            };
          }
          dieClauses.push({ kind: 'site', headNum, siteNum });
        } else {
          return {
            ok: false,
            error: `Malformed site clause "${token}".`,
          };
        }
        break;
      }

      case 'cap': {
        if (parts.length !== 4) {
          return {
            ok: false,
            error: `Malformed capability clause "${token}".`,
          };
        }
        const metric = parts[1]!.toLowerCase();
        if (metric !== 'cpk' && metric !== 'cp') {
          return {
            ok: false,
            error: `Invalid capability metric "${parts[1]}" in "${token}".`,
          };
        }
        const rawOp = parts[2]!;
        if (!VALID_COMPARISON_OPS.has(rawOp)) {
          return {
            ok: false,
            error: `Invalid comparison operator "${rawOp}" in "${token}".`,
          };
        }
        const op: ComparisonOp =
          rawOp === '==' ? '=' : (rawOp as ComparisonOp);
        const rawThresh = parts[3]!;
        if (!FINITE_NUMBER_PATTERN.test(rawThresh)) {
          return {
            ok: false,
            error: `Invalid capability threshold "${rawThresh}" in "${token}".`,
          };
        }
        const parsedThresh = Number(rawThresh);
        if (!Number.isFinite(parsedThresh)) {
          return {
            ok: false,
            error: `Non-finite capability threshold "${rawThresh}" in "${token}".`,
          };
        }
        capabilityClauses.push({
          kind: 'capability',
          metric,
          op,
          threshold: normalizeThreshold(parsedThresh),
        });
        break;
      }

      default:
        return {
          ok: false,
          error: `Unrecognized Filter DSL clause "${token}".`,
        };
    }
  }

  return {
    ok: true,
    value: { dieClauses, capabilityClauses },
  };
}

/**
 * Parses either a canonical Filter DSL string (`bin:ANY_BIN:7;cap:cpk:<:1.33` or `all`)
 * or an offline natural-language filter query (`"only bin 7"`, `"show edge failures with Cpk < 1.33"`).
 */
export function parseFilterDsl(input: string): Result<FilterDslAst, string> {
  const canonical = deserializeFilterDsl(input);
  if (canonical.ok) {
    return canonical;
  }
  return parseOfflineNaturalQuery(input);
}

/** Applies `ast` (combined with optional `brush` and `quickFilters`) to `lot` via `evaluateSelection`. */
export function applyFilterDslToSelection(
  lot: LotModel,
  ast: FilterDslAst,
  options?: {
    readonly brush?: SpatialBrushRect | null;
    readonly quickFilters?: QuickSelectionFilters;
  },
): FilterEvaluationResult {
  return evaluateSelection(
    lot,
    options?.brush ?? null,
    ast,
    options?.quickFilters,
  );
}

/** Removes one clause by `{ section, index }`; returns `null` when no clauses remain. */
export function removeFilterDslClause(
  ast: FilterDslAst,
  ref: Pick<FilterDslClauseRef, 'section' | 'index'>,
): FilterDslAst | null {
  const dieClauses =
    ref.section === 'die'
      ? ast.dieClauses.filter((_, idx) => idx !== ref.index)
      : ast.dieClauses;
  const capabilityClauses =
    ref.section === 'capability'
      ? ast.capabilityClauses.filter((_, idx) => idx !== ref.index)
      : ast.capabilityClauses;

  if (dieClauses.length === 0 && capabilityClauses.length === 0) {
    return null;
  }
  return {
    dieClauses,
    capabilityClauses,
  };
}

function formatDieClauseLabel(
  clause: DiePredicateClause,
  lot?: Pick<LotModel, 'wafers' | 'sites'> | null,
): string {
  switch (clause.kind) {
    case 'pass-status':
      return clause.status === 'pass' ? 'Passing' : 'Failures';
    case 'bin': {
      const codesText = clause.codes.join(', ');
      if (clause.mode === 'SBIN') {
        return `SBIN ${codesText}`;
      }
      if (clause.mode === 'HBIN') {
        return `HBIN ${codesText}`;
      }
      return `Bin ${codesText}`;
    }
    case 'edge-ring':
      return clause.maxRing === 1
        ? 'Outer 1 ring'
        : `Outer ${clause.maxRing} rings`;
    case 'radial-zone':
      return clause.zone === 'donut' ? 'Donut zone' : 'Center zone';
    case 'wafer': {
      const labels = clause.waferIndices.map((idx) => {
        const waferMeta = lot?.wafers[idx];
        if (waferMeta && waferMeta.waferId.trim().length > 0) {
          return waferMeta.waferId;
        }
        return `W${String(idx + 1).padStart(2, '0')}`;
      });
      return labels.join(', ');
    }
    case 'site': {
      if (clause.headNum !== undefined) {
        return `Site ${clause.headNum}:${clause.siteNum}`;
      }
      if (lot?.sites && lot.sites.length > 0) {
        const matches = lot.sites.filter((s) => s.siteNum === clause.siteNum);
        if (matches.length === 1 && matches[0]!.label.trim().length > 0) {
          return `Site ${matches[0]!.label}`;
        }
      }
      return `Site ${clause.siteNum}`;
    }
  }
}

function formatCapabilityClauseLabel(
  clause: CapabilityPredicateClause,
): string {
  const metricLabel = clause.metric === 'cp' ? 'Cp' : 'Cpk';
  return `${metricLabel} ${clause.op} ${Number(clause.threshold)}`;
}

/** Builds human-readable removable chip descriptors for each active clause in `ast`. */
export function formatFilterDslChipDescriptors(
  ast: FilterDslAst | null | undefined,
  lot?: Pick<LotModel, 'wafers' | 'sites'> | null,
): readonly FilterDslChipDescriptor[] {
  if (!ast || isFilterDslEmpty(ast)) {
    return [];
  }
  const normalized = normalizeFilterDslAst(ast);
  const descriptors: FilterDslChipDescriptor[] = [];

  for (let i = 0; i < normalized.dieClauses.length; i += 1) {
    const clause = normalized.dieClauses[i]!;
    const token = serializeDieClauseToken(clause);
    descriptors.push({
      id: `die:${i}:${token}`,
      label: formatDieClauseLabel(clause, lot),
      ref: {
        section: 'die',
        index: i,
        clause,
      },
    });
  }

  for (let i = 0; i < normalized.capabilityClauses.length; i += 1) {
    const clause = normalized.capabilityClauses[i]!;
    const token = serializeCapabilityClauseToken(clause);
    descriptors.push({
      id: `capability:${i}:${token}`,
      label: formatCapabilityClauseLabel(clause),
      ref: {
        section: 'capability',
        index: i,
        clause,
      },
    });
  }

  return descriptors;
}

/** Joins active chip labels with `', '` (e.g. `'Outer 3 rings, Failures, Cpk < 1.33'`). */
export function formatFilterDslSummary(
  ast: FilterDslAst | null | undefined,
  lot?: Pick<LotModel, 'wafers' | 'sites'> | null,
): string {
  return formatFilterDslChipDescriptors(ast, lot)
    .map((chip) => chip.label)
    .join(', ');
}
