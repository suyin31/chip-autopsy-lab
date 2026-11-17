import * as React from 'react';
import type { ReportClaim } from '@/core/report';
import { formatGroupedInt } from '@/ui/format';
import { Badge, cn } from '@/ui/primitives';

export interface ClaimInlineButtonProps {
  readonly claim: ReportClaim;
  /** Optional display text override (e.g. quantitative prefix when hypothesis tail is disclosed separately). */
  readonly displayText?: string;
  readonly variant?: 'headline' | 'body';
  /** Whether the lot has >= 1 failing die (controls `#FF7A1A` cause-of-death styling on headline). */
  readonly hasFailures?: boolean;
  /** Optional wafer badge label (`"Wafer W02"`) when the claim scopes to a specific wafer. */
  readonly targetWaferLabel?: string | null;
  readonly isActive: boolean;
  readonly onToggle: (claim: ReportClaim) => void;
}

function renderHeadlineText(
  text: string,
  hasFailures: boolean,
): React.ReactNode {
  if (!hasFailures) {
    return <span className="text-text-primary">{text}</span>;
  }
  const confMarker = ' (confidence ';
  const splitIdx = text.indexOf(confMarker);
  if (splitIdx <= 0) {
    return <span className="text-failure">{text}</span>;
  }
  return (
    <>
      <span className="text-failure">{text.slice(0, splitIdx)}</span>
      <span className="text-text-primary">{text.slice(splitIdx)}</span>
    </>
  );
}

/**
 * Keyboard-operable (`<button type="button">`) claim control with `aria-pressed`
 * toggle state, `#7CF2C1` focus ring, non-color active border/marker + `"Highlighted"`
 * badge, and linked die/bin/site/test citation chips (Requirements 10.1, 10.4, 14.2, 14.3).
 *
 * All claim text is rendered strictly via React plain-text nodes (Requirement 2.4).
 */
export function ClaimInlineButton({
  claim,
  displayText,
  variant = 'body',
  hasFailures = true,
  targetWaferLabel = null,
  isActive,
  onToggle,
}: ClaimInlineButtonProps): React.JSX.Element {
  const effectiveText = displayText ?? claim.text;
  const dieCount = claim.resolvedDieIndices.length;
  const dieNoun = dieCount === 1 ? 'die' : 'dies';

  if (variant === 'headline') {
    return (
      <button
        type="button"
        data-claim-id={claim.claimId}
        data-testid="autopsy-headline-button"
        aria-pressed={isActive}
        onClick={() => onToggle(claim)}
        className={cn(
          'group flex w-full cursor-pointer flex-col items-start gap-3 rounded-control border p-4 text-left shadow-none',
          'transition-[transform,opacity] duration-150 ease-[var(--ease-clinical)] active:scale-[0.998]',
          'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
          isActive
            ? 'border-accent bg-accent/8'
            : 'border-hairline bg-raised hover:border-white/16',
        )}
      >
        <span className="heading-display block text-[24px] leading-snug sm:text-[28px]">
          {renderHeadlineText(effectiveText, hasFailures)}
        </span>

        <span className="flex w-full flex-wrap items-center justify-between gap-2">
          <span className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 font-mono text-[12px] text-text-secondary tabular-nums">
              <span
                aria-hidden="true"
                className={cn(
                  'h-2 w-2 rounded-xs border',
                  isActive
                    ? 'border-accent bg-accent'
                    : 'border-hairline bg-transparent group-hover:border-accent/60',
                )}
              />
              <span>
                {formatGroupedInt(dieCount)} cited {dieNoun}
              </span>
            </span>

            {targetWaferLabel ? (
              <Badge variant="neutral">{targetWaferLabel}</Badge>
            ) : null}

            {claim.citedSites.map((site) => (
              <Badge
                key={`site-${site.headNum}:${site.siteNum}`}
                variant="neutral"
              >
                Site {site.headNum}:{site.siteNum}
              </Badge>
            ))}

            {claim.citedBins.map((bin) => (
              <Badge key={`bin-${bin.mode}:${bin.code}`} variant="neutral">
                {bin.mode} {bin.code}
              </Badge>
            ))}

            {claim.citedTestNums.map((testNum) => (
              <Badge key={`test-${testNum}`} variant="neutral">
                Test {testNum}
              </Badge>
            ))}
          </span>

          <span className="inline-flex items-center gap-2">
            {isActive ? (
              <Badge variant="accent">Highlighted · Click to clear</Badge>
            ) : (
              <span className="font-mono text-[12px] text-text-tertiary group-hover:text-text-secondary">
                Inspect cited dies
              </span>
            )}
          </span>
        </span>
      </button>
    );
  }

  return (
    <button
      type="button"
      data-claim-id={claim.claimId}
      aria-pressed={isActive}
      onClick={() => onToggle(claim)}
      className={cn(
        'group flex w-full cursor-pointer flex-col items-start justify-between gap-2.5 rounded-control border px-3.5 py-3 text-left shadow-none sm:flex-row sm:items-baseline sm:gap-4',
        'transition-[transform,opacity] duration-150 ease-[var(--ease-clinical)] active:scale-[0.999]',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
        isActive
          ? 'border-accent bg-accent/8'
          : 'border-hairline bg-raised/60 hover:bg-raised',
      )}
    >
      <span className="flex items-baseline gap-2.5 text-[15px] leading-relaxed text-text-primary sm:text-[16px]">
        <span
          aria-hidden="true"
          className={cn(
            'mt-1.5 h-2 w-2 shrink-0 rounded-xs border',
            isActive
              ? 'border-accent bg-accent'
              : 'border-hairline bg-transparent group-hover:border-accent/60',
          )}
        />
        <span>{effectiveText}</span>
      </span>

      <span className="flex shrink-0 flex-wrap items-center gap-1.5 pl-4 sm:pl-0">
        {targetWaferLabel ? (
          <Badge variant="neutral">{targetWaferLabel}</Badge>
        ) : null}

        {claim.citedSites.map((site) => (
          <Badge key={`site-${site.headNum}:${site.siteNum}`} variant="neutral">
            Site {site.headNum}:{site.siteNum}
          </Badge>
        ))}

        {claim.citedBins.map((bin) => (
          <Badge key={`bin-${bin.mode}:${bin.code}`} variant="neutral">
            {bin.mode} {bin.code}
          </Badge>
        ))}

        {claim.citedTestNums.map((testNum) => (
          <Badge key={`test-${testNum}`} variant="neutral">
            Test {testNum}
          </Badge>
        ))}

        <Badge variant={isActive ? 'accent' : 'neutral'}>
          {formatGroupedInt(dieCount)} {dieNoun}
        </Badge>

        {isActive ? <Badge variant="accent">Highlighted</Badge> : null}
      </span>
    </button>
  );
}
