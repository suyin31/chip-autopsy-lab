import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { generateDemoStdfBytes } from '@/core/demo/demo-generator';
import { buildLotModel } from '@/core/model';
import { generateOfflineAutopsyReport, renderReport } from '@/core/report';
import { parseStdfBytes } from '@/core/stdf';
import { FindingsList } from './FindingsList';

function renderEdgeRing() {
  const parsed = parseStdfBytes(generateDemoStdfBytes('edge-ring-etch'), {
    mode: 'full',
  });
  if (!parsed.ok) throw new Error(parsed.error.message);
  const lot = buildLotModel(parsed.value);
  return { lot, rendered: renderReport(generateOfflineAutopsyReport(lot).report, 'en') };
}

describe('FindingsList (premium §7.6)', () => {
  const { lot, rendered } = renderEdgeRing();
  const baseProps = {
    heading: rendered.findingsHeading,
    clearLabel: rendered.clearLabel,
    possibleCausesHeading: rendered.possibleCausesHeading,
    checkNextLabel: rendered.checkNextLabel,
    causesNote: rendered.causesNote,
    hypotheses: rendered.hypotheses,
    activeClaimId: null,
    lotKey: lot.lotId,
    dieWaferIndex: lot.dies.waferIndex,
    waferCount: lot.wafers.length,
    onToggleClaim: () => undefined,
  };

  it('renders the label count, card, kind icons, and one-line rows', () => {
    const html = renderToStaticMarkup(
      React.createElement(FindingsList, { ...baseProps, findings: rendered.findings }),
    );
    expect(html).toMatch(/data-testid="findings-count"[^>]*>3</);
    expect(html.match(/data-testid="finding-kind-icon"/g)).toHaveLength(3);
    expect(html).toContain('data-kind="pattern"');
    expect(html).toContain('data-kind="bin"');
    expect(html).toContain('data-kind="test"');
    expect(html).toMatch(/grid-cols-\[16px_minmax\(0,1fr\)_auto\]/);
    expect(html).toContain('title="Failures concentrate in the outer 3 rings"');
    expect(html.match(/data-testid="finding-chevron"/g)).toHaveLength(3);
    expect(html).not.toContain('data-testid="findings-show-more"');
    expect(html).toMatch(/data-testid="possible-causes-count"[^>]*>3</);
  });

  it('puts rows past 3 behind "Show N more findings"', () => {
    const extra = rendered.findings.map((f, i) => ({
      ...f,
      claimId: `${f.claimId}:copy${i}`,
    }));
    const html = renderToStaticMarkup(
      React.createElement(FindingsList, {
        ...baseProps,
        findings: [...rendered.findings, ...extra.slice(0, 2)],
      }),
    );
    expect(html.match(/data-testid="autopsy-body-claim-button"/g)).toHaveLength(3);
    expect(html).toContain('Show 2 more findings');
    expect(html).toMatch(/data-testid="findings-count"[^>]*>5</);
  });

  it('opens Possible causes with the note and links each cause to finding 1', () => {
    const html = renderToStaticMarkup(
      React.createElement(FindingsList, {
        ...baseProps,
        findings: rendered.findings,
        defaultHypothesesOpen: true,
      }),
    );
    expect(html).toContain(
      'These are likely explanations, not proof. Confirm them in the tool logs.',
    );
    expect(html.match(/data-testid="hypothesis-item"/g)).toHaveLength(3);
    expect(html.match(/Based on finding 1/g)).toHaveLength(3);
    expect(html).toContain(`data-claim-id="${rendered.findings[0]!.claimId}"`);
  });

  it('selected row swaps the count for Clear and rotates the chevron', () => {
    const html = renderToStaticMarkup(
      React.createElement(FindingsList, {
        ...baseProps,
        findings: rendered.findings,
        activeClaimId: rendered.findings[1]!.claimId,
      }),
    );
    expect(html).toContain('data-testid="finding-clear-label"');
    expect(html.match(/rotate-180/g)).toHaveLength(1);
    expect(html.match(/claim-cited-dies-count/g)).toHaveLength(2);
    // Only the finding carrying hypotheses lists "Check next" steps
    expect(html).not.toContain('data-testid="finding-check-next"');
    expect(html).toContain('data-testid="finding-meta"');
  });
});
