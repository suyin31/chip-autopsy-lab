'use client';

import { ChevronRight } from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';
import * as React from 'react';
import type {
  RenderedFindingRow,
  RenderedHypothesisItem,
  ReportClaim,
} from '@/core/report';
import { useT } from '@/ui/i18n';
import { cn } from '@/ui/primitives/cn';
import { MOTION_TOKENS, SPRING_TOKENS } from '@/ui/tokens';
import { renderWithUntranslatedTokens } from './render-untranslated';

export interface FindingsListProps {
  readonly heading: string;
  readonly clearLabel: string;
  readonly possibleCausesHeading: string;
  readonly findings: readonly RenderedFindingRow[];
  readonly hypotheses: readonly RenderedHypothesisItem[];
  readonly activeClaimId: string | null;
  /** Active filter mask when a spatial brush or attribute filter is active (§3.6). */
  readonly selectionMask?: Uint8Array | null;
  readonly defaultHypothesesOpen?: boolean;
  readonly onToggleClaim: (claim: ReportClaim) => void;
  readonly className?: string;
}

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

/**
 * Borderless Findings List + `"Possible causes"` disclosure (`src/ui/report/FindingsList.tsx`,
 * `redesign.md` §3.4, §3.5, §3.6, §4.6, §5.4, §5.9, §6.6):
 * - `<ul>` of borderless rows separated by `1 px` `separator` lines inset `16 px` left/right,
 *   hidden adjacent to hovered, pressed, or active rows (zero double edges).
 * - Each row renders a one-line `headline` (desktop ellipsis, mobile wrap) + `callout` sub-line
 *   + trailing tabular die count (replaced by `"Clear"` when selected).
 * - Selected row (`surface-2`, `aria-pressed="true"`, `aria-expanded="true"`) expands via
 *   Motion `layout` (`spring-ui`) to show the full sentence and optional `"Check next: …"` lines.
 * - `"Possible causes"` disclosure row rotates its chevron `90°` on open to reveal the 3 hedged
 *   hypotheses (`headline` + check-next sub-line).
 */
export function FindingsList({
  heading,
  clearLabel,
  possibleCausesHeading,
  findings,
  hypotheses,
  activeClaimId,
  selectionMask = null,
  defaultHypothesesOpen = false,
  onToggleClaim,
  className,
}: FindingsListProps): React.JSX.Element {
  const { t, formatInteger } = useT();
  const shouldReduceMotion = useReducedMotion();
  const [hypothesesOpen, setHypothesesOpen] = React.useState<boolean>(
    defaultHypothesesOpen,
  );
  const [pressedRowKey, setPressedRowKey] = React.useState<string | null>(null);
  const hypothesesPanelId = React.useId();

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
    setPressedRowKey((prev) => (prev === null ? null : null));
  }, []);

  return (
    <div data-testid="verdict-findings-section" className={className}>
      <h2 className="type-headline text-text-primary">{heading}</h2>

      <ul data-testid="verdict-findings-list" className="mt-2 flex flex-col">
        {findings.map((row, idx) => {
          const isSelected = activeClaimId === row.claimId;
          const isPressed = pressedRowKey === row.claimId;
          const detailId = `finding-detail-${row.claimId.replace(/[^a-zA-Z0-9_-]/g, '-')}`;

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

          return (
            <motion.li
              key={row.claimId}
              layout="position"
              transition={layoutTransition}
              data-active={isSelected ? 'true' : undefined}
              data-pressed={isPressed ? 'true' : undefined}
              className="finding-list-item list-none"
            >
              {idx > 0 ? (
                <div
                  aria-hidden="true"
                  className="finding-row-separator mx-4 h-px bg-separator transition-opacity duration-120 ease-out"
                />
              ) : null}

              <div
                className={cn(
                  'group/finding rounded-md transition-[background-color,transform] duration-120 ease-out',
                  isPressed
                    ? 'bg-surface-3 scale-[0.99]'
                    : isSelected
                      ? 'bg-surface-2'
                      : 'bg-transparent hover:bg-surface-1',
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
                    'grid min-h-16 w-full cursor-pointer appearance-none grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 rounded-md border-0 bg-transparent px-4 py-[14px] text-left',
                    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
                  )}
                >
                  <span className="min-w-0">
                    <span
                      data-testid="finding-row-headline"
                      className="block type-headline text-text-primary md:truncate"
                    >
                      {renderWithUntranslatedTokens(
                        row.headline,
                        row.untranslatedTokens,
                      )}
                    </span>
                    {row.subline.length > 0 ? (
                      <span
                        data-testid="finding-row-subline"
                        className="mt-0.5 line-clamp-2 block type-callout text-text-secondary md:line-clamp-none md:truncate"
                      >
                        {renderWithUntranslatedTokens(
                          row.subline,
                          row.untranslatedTokens,
                        )}
                      </span>
                    ) : null}
                  </span>

                  {isSelected ? (
                    <span
                      data-testid="finding-clear-label"
                      className="type-control whitespace-nowrap text-text-secondary transition-colors duration-120 ease-out group-hover/finding:text-text-primary"
                    >
                      {clearLabel}
                    </span>
                  ) : (
                    <span
                      data-testid="claim-cited-dies-count"
                      className="type-footnote whitespace-nowrap text-text-tertiary tabular-nums"
                    >
                      {trailingCountLabel}
                    </span>
                  )}
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
                            delay: 0.06,
                            duration: MOTION_TOKENS.durBaseMs / 1000,
                            ease: MOTION_TOKENS.easeOutTuple,
                          }
                    }
                    className="-mt-0.5 px-4 pb-[14px]"
                  >
                    <p className="type-callout text-text-secondary">
                      {row.detailText}
                    </p>
                    {row.checkNextLines.length > 0 ? (
                      <ul className="mt-2 flex flex-col gap-1">
                        {row.checkNextLines.map((line, lineIdx) => (
                          <li
                            key={lineIdx}
                            className="list-none type-callout text-text-primary"
                          >
                            {line}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </motion.div>
                ) : null}
              </div>
            </motion.li>
          );
        })}

        {hypotheses.length > 0 ? (
          <motion.li
            key="possible-causes"
            layout="position"
            transition={layoutTransition}
            data-active={hypothesesOpen ? 'true' : undefined}
            data-pressed={
              pressedRowKey === 'possible-causes' ? 'true' : undefined
            }
            className="finding-list-item list-none"
          >
            {findings.length > 0 ? (
              <div
                aria-hidden="true"
                className="finding-row-separator mx-4 h-px bg-separator transition-opacity duration-120 ease-out"
              />
            ) : null}

            <div
              className={cn(
                'rounded-md transition-[background-color,transform] duration-120 ease-out',
                pressedRowKey === 'possible-causes'
                  ? 'bg-surface-3 scale-[0.99]'
                  : hypothesesOpen
                    ? 'bg-surface-1'
                    : 'bg-transparent hover:bg-surface-1',
              )}
            >
              <button
                type="button"
                data-testid="autopsy-hypotheses-toggle"
                aria-expanded={hypothesesOpen}
                aria-controls={hypothesesPanelId}
                onPointerDown={(e) =>
                  handleRowPointerDown('possible-causes', e)
                }
                onPointerUp={clearPressedRow}
                onPointerLeave={clearPressedRow}
                onPointerCancel={clearPressedRow}
                onClick={() => setHypothesesOpen((prev) => !prev)}
                className={cn(
                  'grid min-h-16 w-full cursor-pointer appearance-none grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 rounded-md border-0 bg-transparent px-4 py-[14px] text-left',
                  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
                )}
              >
                <span className="block type-headline text-text-primary md:truncate">
                  {possibleCausesHeading}
                </span>

                <ChevronRight
                  aria-hidden="true"
                  strokeWidth={1.75}
                  className={cn(
                    'size-4 shrink-0 text-text-tertiary transition-transform duration-160 ease-out',
                    hypothesesOpen && 'rotate-90',
                  )}
                />
              </button>

              <div
                id={hypothesesPanelId}
                role="region"
                aria-label={possibleCausesHeading}
                hidden={!hypothesesOpen}
                className={
                  hypothesesOpen
                    ? '-mt-0.5 flex flex-col gap-3 px-4 pb-4'
                    : 'hidden'
                }
              >
                {hypothesesOpen
                  ? hypotheses.map((item) => (
                      <div key={item.id} data-testid="hypothesis-item">
                        <p className="type-headline text-text-primary">
                          {item.headline}
                        </p>
                        <p className="mt-0.5 type-callout text-text-secondary">
                          {item.checkText}
                        </p>
                      </div>
                    ))
                  : null}
              </div>
            </div>
          </motion.li>
        ) : null}
      </ul>
    </div>
  );
}
