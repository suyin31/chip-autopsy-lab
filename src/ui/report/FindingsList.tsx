'use client';

import {
  Activity,
  ChevronDown,
  CircleDashed,
  Crosshair,
  Layers,
  type LucideIcon,
  Minus,
} from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';
import * as React from 'react';
import type {
  FindingKind,
  RenderedFindingRow,
  RenderedHypothesisItem,
  ReportClaim,
} from '@/core/report';
import type { GlossaryTermId } from '@/core/i18n';
import { GlossaryText, useT } from '@/ui/i18n';
import { cn } from '@/ui/primitives/cn';
import { MOTION_TOKENS, SPRING_TOKENS } from '@/ui/tokens';
import { renderWithUntranslatedTokens } from './render-untranslated';

/** Terms allowed in the expanded engine sentence, in priority order (premium §7.6.4). */
const ENGINE_SENTENCE_TERMS: readonly GlossaryTermId[] = [
  'cpk',
  'limits',
  'testSite',
  'bin',
];

/** At most 3 finding rows show at level 0; the rest sit behind "Show N more findings" (premium §7.6.1). */
export const FINDINGS_VISIBLE_LIMIT = 3;

/** Session key for the per-lot open state of "Possible causes" (premium §7.6.5). */
export const CAUSES_OPEN_STORAGE_KEY = 'cal.causes.v1';

export interface FindingsListProps {
  readonly heading: string;
  readonly clearLabel: string;
  readonly possibleCausesHeading: string;
  readonly checkNextLabel: string;
  readonly causesNote: string;
  readonly findings: readonly RenderedFindingRow[];
  readonly hypotheses: readonly RenderedHypothesisItem[];
  readonly activeClaimId: string | null;
  /** Active filter mask when a spatial brush or attribute filter is active (§3.6). */
  readonly selectionMask?: Uint8Array | null;
  /** Lot identity; the Possible causes open state persists per lot for the session. */
  readonly lotKey?: string;
  /** Per-die wafer index (`lot.dies.waferIndex`) and the wafer on screen, for the expanded meta line. */
  readonly dieWaferIndex?: Uint16Array;
  readonly activeWaferIndex?: number;
  readonly waferCount?: number;
  readonly defaultHypothesesOpen?: boolean;
  readonly onToggleClaim: (claim: ReportClaim) => void;
  readonly className?: string;
}

const KIND_ICONS: Readonly<Record<FindingKind, LucideIcon>> = {
  pattern: CircleDashed,
  scratch: Minus,
  site: Crosshair,
  test: Activity,
  bin: Layers,
};

function countDiesInSelection(
  dieIndices: Uint32Array,
  selectionMask: Uint8Array,
): number {
  let count = 0;
  for (let i = 0; i < dieIndices.length; i += 1) {
    const idx = dieIndices[i]!;
    if (idx < selectionMask.length && selectionMask[idx] !== 0) {
      count += 1;
    }
  }
  return count;
}

function countDiesOnWafer(
  dieIndices: Uint32Array,
  dieWaferIndex: Uint16Array,
  waferIndex: number,
): number {
  let count = 0;
  for (let i = 0; i < dieIndices.length; i += 1) {
    const idx = dieIndices[i]!;
    if (idx < dieWaferIndex.length && dieWaferIndex[idx] === waferIndex) {
      count += 1;
    }
  }
  return count;
}

function readCausesOpen(lotKey: string): boolean {
  try {
    const raw = window.sessionStorage.getItem(CAUSES_OPEN_STORAGE_KEY);
    if (raw === null) return false;
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.includes(lotKey);
  } catch {
    return false;
  }
}

function writeCausesOpen(lotKey: string, open: boolean): void {
  try {
    const raw = window.sessionStorage.getItem(CAUSES_OPEN_STORAGE_KEY);
    const parsed: unknown = raw === null ? [] : JSON.parse(raw);
    const keys = new Set<string>(
      Array.isArray(parsed)
        ? parsed.filter((k): k is string => typeof k === 'string')
        : [],
    );
    if (open) keys.add(lotKey);
    else keys.delete(lotKey);
    window.sessionStorage.setItem(
      CAUSES_OPEN_STORAGE_KEY,
      JSON.stringify([...keys]),
    );
  } catch {
    // Storage unavailable (private mode or quota): the open state lives for this view only
  }
}

/**
 * Findings card and "Possible causes" disclosure (premium §7.6):
 * - "Findings" label with its count, then a `surface` card (`r-xl`, `shadow-card`, padding 4) of up
 *   to 3 rows; more rows sit behind "Show N more findings".
 * - Each row is a `16px 1fr auto` grid: kind icon, a one-line plain headline over a one-line
 *   sub-line with the numbers and codes, and the die count with a chevron. Hairline separators
 *   inset 16 hide next to hovered, pressed, or selected rows.
 * - The selected row (`fill-2`) expands to the engine sentence, "Check next" steps, and the meta
 *   line, aligned to the headline's left edge.
 * - "Possible causes" sits 16 px below the card with no box; each cause links back to its finding.
 */
export function FindingsList({
  heading,
  clearLabel,
  possibleCausesHeading,
  checkNextLabel,
  causesNote,
  findings,
  hypotheses,
  activeClaimId,
  selectionMask = null,
  lotKey,
  dieWaferIndex,
  activeWaferIndex = 0,
  waferCount = 1,
  defaultHypothesesOpen = false,
  onToggleClaim,
  className,
}: FindingsListProps): React.JSX.Element {
  const { t, tPlural, formatInteger } = useT();
  const shouldReduceMotion = useReducedMotion();
  const [hypothesesOpen, setHypothesesOpen] = React.useState<boolean>(
    defaultHypothesesOpen,
  );
  const [showAll, setShowAll] = React.useState(false);
  const [pressedRowKey, setPressedRowKey] = React.useState<string | null>(null);
  const hypothesesPanelId = React.useId();

  // Premium §7.6.5: the open state persists per lot for the session (read after mount, no hydration drift)
  React.useEffect(() => {
    setShowAll(false);
    if (lotKey === undefined || typeof window === 'undefined') {
      setHypothesesOpen(defaultHypothesesOpen);
      return;
    }
    setHypothesesOpen(defaultHypothesesOpen || readCausesOpen(lotKey));
  }, [lotKey, defaultHypothesesOpen]);

  const toggleHypotheses = (): void => {
    setHypothesesOpen((prev) => {
      const next = !prev;
      if (lotKey !== undefined && typeof window !== 'undefined') {
        writeCausesOpen(lotKey, next);
      }
      return next;
    });
  };

  const layoutTransition = shouldReduceMotion
    ? { duration: 0 }
    : SPRING_TOKENS.ui;

  const handleRowPointerDown = (
    rowKey: string,
    event: React.PointerEvent<HTMLButtonElement>,
  ): void => {
    if (typeof performance !== 'undefined') {
      event.currentTarget.dataset.ack = String(performance.now());
    }
    if (event.button === 0) {
      setPressedRowKey(rowKey);
    }
  };

  const clearPressedRow = React.useCallback((): void => {
    setPressedRowKey(null);
  }, []);

  const activeIndex = findings.findIndex((f) => f.claimId === activeClaimId);
  const expandedList =
    showAll || activeIndex >= FINDINGS_VISIBLE_LIMIT;
  const shownFindings = expandedList
    ? findings
    : findings.slice(0, FINDINGS_VISIBLE_LIMIT);
  const hiddenCount = findings.length - shownFindings.length;

  // "Based on finding {n}" points at the finding that carries the check-next steps
  const basedOnIndex = findings.findIndex((f) => f.checkNextSteps.length > 0);
  const basedOnFinding = basedOnIndex >= 0 ? findings[basedOnIndex] : undefined;

  return (
    <div data-testid="verdict-findings-section" className={className}>
      <h2
        data-testid="findings-label"
        className="flex items-baseline gap-2"
      >
        <span className="type-headline text-text-primary">{heading}</span>
        <span
          data-testid="findings-count"
          className="type-subhead text-text-tertiary tabular-nums"
        >
          {formatInteger(findings.length)}
        </span>
      </h2>

      <ul
        data-testid="verdict-findings-list"
        className="mt-3 flex flex-col rounded-xl bg-surface p-1 shadow-card"
      >
        {shownFindings.map((row, idx) => {
          const isSelected = activeClaimId === row.claimId;
          const isPressed = pressedRowKey === row.claimId;
          const detailId = `finding-detail-${row.claimId.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
          const KindIcon = KIND_ICONS[row.kind];

          const trailingCountLabel = selectionMask
            ? t('findings.inSelection', {
                count: formatInteger(
                  countDiesInSelection(
                    row.claim.resolvedDieIndices,
                    selectionMask,
                  ),
                ),
                total: formatInteger(row.dieCount),
              })
            : row.dieCountLabel;

          const metaLabel =
            waferCount > 1
              ? t('findings.meta', {
                  wafer: formatInteger(
                    dieWaferIndex
                      ? countDiesOnWafer(
                          row.claim.resolvedDieIndices,
                          dieWaferIndex,
                          activeWaferIndex,
                        )
                      : 0,
                  ),
                  lot: formatInteger(row.dieCount),
                  wafers: formatInteger(waferCount),
                })
              : t('findings.metaOneWafer', {
                  lot: formatInteger(row.dieCount),
                });

          return (
            <motion.li
              key={row.claimId}
              layout="position"
              transition={layoutTransition}
              data-active={isSelected ? 'true' : undefined}
              data-pressed={isPressed ? 'true' : undefined}
              data-kind={row.kind}
              className="finding-list-item list-none"
            >
              {idx > 0 ? (
                <div
                  aria-hidden="true"
                  className="finding-row-separator mx-4 h-px bg-hairline transition-opacity duration-120 ease-out"
                />
              ) : null}

              <div
                className={cn(
                  'group/finding rounded-lg transition-[background-color,scale] ease-out',
                  isPressed
                    ? 'bg-fill-2 duration-0 scale-[0.985]'
                    : isSelected
                      ? 'bg-fill-2 duration-120'
                      : 'bg-transparent duration-120 hover:bg-fill-1',
                )}
              >
                <button
                  type="button"
                  data-testid="autopsy-body-claim-button"
                  data-claim-id={row.claimId}
                  aria-expanded={isSelected}
                  aria-pressed={isSelected}
                  aria-controls={isSelected ? detailId : undefined}
                  onPointerDown={(e) => handleRowPointerDown(row.claimId, e)}
                  onPointerUp={clearPressedRow}
                  onPointerLeave={clearPressedRow}
                  onPointerCancel={clearPressedRow}
                  onClick={() => onToggleClaim(row.claim)}
                  className={cn(
                    'grid min-h-16 w-full cursor-pointer appearance-none grid-cols-[16px_minmax(0,1fr)_auto] items-start gap-x-3 rounded-lg border-0 bg-transparent px-4 py-3 text-left',
                    'focus-visible:shadow-focus-ring focus-visible:outline-none',
                  )}
                >
                  <KindIcon
                    aria-hidden="true"
                    data-testid="finding-kind-icon"
                    strokeWidth={1.5}
                    className={cn(
                      'mt-0.5 size-4 transition-colors duration-120 ease-out',
                      row.kind === 'scratch' && 'rotate-30',
                      isSelected ? 'text-text-primary' : 'text-text-tertiary',
                    )}
                  />

                  <span className="min-w-0">
                    <span
                      data-testid="finding-row-headline"
                      title={row.headline}
                      className="line-clamp-2 block type-row-title text-text-primary md:line-clamp-none md:truncate"
                    >
                      {renderWithUntranslatedTokens(
                        row.headline,
                        row.untranslatedTokens,
                      )}
                    </span>
                    {row.subline.length > 0 ? (
                      <span
                        data-testid="finding-row-subline"
                        className="mt-0.5 line-clamp-2 block type-subhead text-text-secondary tabular-nums md:line-clamp-none md:truncate"
                      >
                        {renderWithUntranslatedTokens(
                          row.subline,
                          row.untranslatedTokens,
                        )}
                      </span>
                    ) : null}
                  </span>

                  <span className="flex h-5 items-center gap-2">
                    {isSelected ? (
                      <span
                        data-testid="finding-clear-label"
                        className="type-control whitespace-nowrap text-text-primary"
                      >
                        {clearLabel}
                      </span>
                    ) : (
                      <span
                        data-testid="claim-cited-dies-count"
                        className="type-subhead whitespace-nowrap text-text-tertiary tabular-nums"
                      >
                        {trailingCountLabel}
                      </span>
                    )}
                    <ChevronDown
                      aria-hidden="true"
                      data-testid="finding-chevron"
                      strokeWidth={1.5}
                      className={cn(
                        'size-3 shrink-0 transition-[rotate,color] duration-160 ease-out',
                        isSelected
                          ? 'rotate-180 text-text-secondary'
                          : 'text-text-tertiary group-hover/finding:text-text-secondary',
                      )}
                    />
                  </span>
                </button>

                {isSelected ? (
                  <motion.div
                    id={detailId}
                    data-testid="finding-expanded-detail"
                    initial={shouldReduceMotion ? { opacity: 1 } : { opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={
                      shouldReduceMotion
                        ? { duration: 0 }
                        : {
                            delay: 0.04,
                            duration: MOTION_TOKENS.durBaseMs / 1000,
                            ease: MOTION_TOKENS.easeOutTuple,
                          }
                    }
                    // Premium §7.6.4: padding 0 16 16 44 puts the text on the headline's left edge
                    className="pb-4 pl-11 pr-4"
                  >
                    <p
                      data-testid="finding-engine-sentence"
                      className="line-clamp-3 type-callout text-text-secondary tabular-nums"
                    >
                      <GlossaryText
                        text={row.detailText}
                        terms={ENGINE_SENTENCE_TERMS}
                        untranslatedTokens={row.untranslatedTokens}
                      />
                    </p>
                    {row.checkNextSteps.length > 0 ? (
                      <div data-testid="finding-check-next" className="mt-3">
                        <p className="type-subhead text-text-tertiary">
                          {checkNextLabel}
                        </p>
                        <ul className="mt-1 flex flex-col gap-1">
                          {row.checkNextSteps.slice(0, 3).map((step, stepIdx) => (
                            <li
                              key={stepIdx}
                              className="relative list-none pl-2 type-callout text-text-primary"
                            >
                              <span
                                aria-hidden="true"
                                className="absolute left-0 top-[calc(0.5lh-2px)] size-1 rounded-full bg-text-tertiary"
                              />
                              {step}
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                    <p
                      data-testid="finding-meta"
                      className="mt-3 type-subhead text-text-tertiary tabular-nums"
                    >
                      {metaLabel}
                    </p>
                  </motion.div>
                ) : null}
              </div>
            </motion.li>
          );
        })}

        {hiddenCount > 0 ? (
          <motion.li
            layout="position"
            transition={layoutTransition}
            className="finding-list-item list-none"
          >
            <div
              aria-hidden="true"
              className="finding-row-separator mx-4 h-px bg-hairline transition-opacity duration-120 ease-out"
            />
            <button
              type="button"
              data-testid="findings-show-more"
              onClick={() => setShowAll(true)}
              className={cn(
                'flex h-11 w-full cursor-pointer appearance-none items-center justify-center rounded-lg border-0 bg-transparent px-4 type-control text-text-secondary',
                'transition-[background-color,color] duration-120 ease-out hover:bg-fill-1 hover:text-text-primary active:bg-fill-2',
                'focus-visible:shadow-focus-ring focus-visible:outline-none',
              )}
            >
              {tPlural('findings.more', hiddenCount, {
                count: formatInteger(hiddenCount),
              })}
            </button>
          </motion.li>
        ) : null}
      </ul>

      {/* Premium §7.6.5: the "Possible causes" disclosure sits 16 px below the findings card */}
      {hypotheses.length > 0 ? (
        <motion.div
          layout="position"
          transition={layoutTransition}
          data-testid="possible-causes-block"
          data-active={hypothesesOpen ? 'true' : undefined}
          data-pressed={
            pressedRowKey === 'possible-causes' ? 'true' : undefined
          }
          className="mt-4"
        >
          <button
            type="button"
            data-testid="autopsy-hypotheses-toggle"
            aria-expanded={hypothesesOpen}
            aria-controls={hypothesesPanelId}
            onPointerDown={(e) => handleRowPointerDown('possible-causes', e)}
            onPointerUp={clearPressedRow}
            onPointerLeave={clearPressedRow}
            onPointerCancel={clearPressedRow}
            onClick={toggleHypotheses}
            className={cn(
              'group/causes grid h-12 w-full cursor-pointer appearance-none grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 rounded-lg border-0 px-5 text-left',
              'transition-[background-color,scale] ease-out',
              pressedRowKey === 'possible-causes'
                ? 'bg-fill-2 duration-0 scale-[0.985]'
                : 'bg-transparent duration-120 hover:bg-fill-1',
              'focus-visible:shadow-focus-ring focus-visible:outline-none',
            )}
          >
            <span className="block truncate type-headline text-text-primary">
              {possibleCausesHeading}
            </span>
            <span className="flex items-center gap-2">
              <span
                data-testid="possible-causes-count"
                className="type-subhead text-text-tertiary tabular-nums"
              >
                {formatInteger(hypotheses.length)}
              </span>
              <ChevronDown
                aria-hidden="true"
                strokeWidth={1.5}
                className={cn(
                  'size-3 shrink-0 text-text-tertiary transition-[rotate] duration-160 ease-out',
                  hypothesesOpen && 'rotate-180',
                )}
              />
            </span>
          </button>

          <div
            id={hypothesesPanelId}
            role="region"
            aria-label={possibleCausesHeading}
            hidden={!hypothesesOpen}
            className={hypothesesOpen ? 'px-5 pb-4 pt-1' : 'hidden'}
          >
            {hypothesesOpen ? (
              <>
                <p
                  data-testid="possible-causes-note"
                  className="type-subhead text-text-tertiary"
                >
                  {causesNote}
                </p>
                <div className="mt-3 flex flex-col gap-4">
                  {hypotheses.slice(0, 3).map((item) => (
                    <div key={item.id} data-testid="hypothesis-item">
                      <p className="type-row-title text-text-primary">
                        {item.headline}
                      </p>
                      <p className="mt-0.5 type-callout text-text-secondary">
                        {item.checkText}
                      </p>
                      {basedOnFinding ? (
                        <button
                          type="button"
                          data-testid="hypothesis-based-on"
                          data-claim-id={basedOnFinding.claimId}
                          onClick={() => {
                            if (activeClaimId !== basedOnFinding.claimId) {
                              onToggleClaim(basedOnFinding.claim);
                            }
                          }}
                          className={cn(
                            "relative mt-0.5 cursor-pointer appearance-none rounded-xs border-0 bg-transparent p-0 text-left type-subhead text-text-tertiary after:absolute after:-inset-x-2 after:-inset-y-[11px] after:content-['']",
                            'transition-[color,opacity] duration-120 ease-out hover:text-text-secondary active:opacity-64',
                            'focus-visible:shadow-focus-ring focus-visible:outline-none',
                          )}
                        >
                          {t('causes.basedOn', {
                            n: formatInteger(basedOnIndex + 1),
                          })}
                        </button>
                      ) : null}
                    </div>
                  ))}
                </div>
              </>
            ) : null}
          </div>
        </motion.div>
      ) : null}
    </div>
  );
}
