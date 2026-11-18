import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { listDemoPresets } from '@/core/demo';
import { buildLotModel, type LotModel } from '@/core/model';
import { generateOfflineAutopsyReport } from '@/core/report';
import { parseStdfBytes, PRR_PART_FLG, writeStdfBytes } from '@/core/stdf';
import { LoadedLotOverview } from '@/ui/layout';
import { createSelectionStore, type SelectionStoreState } from '@/ui/state';
import type { StoreApi } from 'zustand';
import { COLOR_TOKENS } from '@/ui/tokens';
import {
  type Canvas2DContextLike,
  computeWaferRenderLayout,
  DEFAULT_VIEWPORT_TRANSFORM,
  OVERLAY_HALO_STROKE,
  OverlayCanvas,
  paintWaferOverlayLayer,
} from '@/ui/wafer-map';
import { ingestDemoPreset } from '@/workers';
import {
  AutopsyReportCard,
  toggleReportClaimInStore,
} from './AutopsyReportCard';
import { ClaimInlineButton } from './ClaimInlineButton';

/**
 * Creates an isolated Zustand store whose `getInitialState` mirrors `getState()` so
 * `react-dom/server` `renderToStaticMarkup` in Node (`environment: 'node'`) reads live
 * client state transitions identically to `react-dom/client` in the browser.
 */
function createClientTestStore(): StoreApi<SelectionStoreState> {
  const store = createSelectionStore();
  return {
    ...store,
    getInitialState: () => store.getState(),
  };
}

interface RecordedCanvasOp {
  readonly op: string;
  readonly strokeStyle?: string;
}

function createMockOverlayCanvasContext(): {
  readonly ctx: Canvas2DContextLike;
  readonly ops: RecordedCanvasOp[];
  readonly getRectCount: () => number;
} {
  const ops: RecordedCanvasOp[] = [];
  let currentStroke = '';
  let rectCount = 0;
  const ctx: Canvas2DContextLike = {
    fillStyle: '',
    get strokeStyle(): string {
      return currentStroke;
    },
    set strokeStyle(v: string) {
      currentStroke = v;
    },
    lineWidth: 1,
    lineJoin: 'miter',
    setTransform: () => undefined,
    clearRect: () => {
      ops.push({ op: 'clearRect' });
    },
    fillRect: () => undefined,
    strokeRect: () => {
      ops.push({ op: 'strokeRect', strokeStyle: currentStroke });
    },
    beginPath: () => undefined,
    arc: () => undefined,
    moveTo: () => undefined,
    lineTo: () => undefined,
    closePath: () => undefined,
    stroke: () => {
      ops.push({ op: 'stroke', strokeStyle: currentStroke });
    },
    fill: () => undefined,
    rect: () => {
      rectCount += 1;
    },
    setLineDash: () => undefined,
  };
  return { ctx, ops, getRectCount: () => rectCount };
}

function buildSingleWaferExcursionLot(): LotModel {
  const coords: Array<{ readonly x: number; readonly y: number }> = [];
  for (let y = -8; y <= 8; y += 1) {
    for (let x = -8; x <= 8; x += 1) {
      if (x * x + y * y <= 67) {
        coords.push({ x, y });
      }
    }
  }

  const wafers = [0, 1, 2, 3].map((w) => {
    const parts = coords.map((c, idx) => {
      const fail =
        w === 1
          ? Math.hypot(c.x, c.y) <= 2.9
          : c.x === w - 1 && c.y === 5;
      return {
        headNum: 1,
        siteNum: (idx & 1) === 0 ? 1 : 2,
        partFlg: fail ? PRR_PART_FLG.FAILED : 0,
        hardBin: fail ? 3 : 1,
        softBin: fail ? 9 : 1,
        xCoord: c.x,
        yCoord: c.y,
      };
    });
    return {
      wir: { headNum: 1, siteGrp: 1, startT: 1_700_000_000 + w * 60, waferId: `W0${w + 1}` },
      touchdowns: [parts],
      wrr: {
        headNum: 1,
        siteGrp: 1,
        finishT: 1_700_000_030 + w * 60,
        partCnt: parts.length,
        waferId: `W0${w + 1}`,
      },
    };
  });

  const bytes = writeStdfBytes({
    endianness: 'little',
    mir: { lotId: 'EXC-LOT-01', partTyp: 'CAL-EXC', jobNam: 'SORT' },
    sdrs: [{ headNum: 1, siteGrp: 1, siteNums: [1, 2], cardId: 'CARD-1' }],
    hbrs: [
      { hbinNum: 1, hbinCnt: 1, hbinPf: 'P', hbinNam: 'PASS' },
      { hbinNum: 3, hbinCnt: 1, hbinPf: 'F', hbinNam: 'SHORT' },
    ],
    sbrs: [
      { sbinNum: 1, sbinCnt: 1, sbinPf: 'P', sbinNam: 'GOOD' },
      { sbinNum: 9, sbinCnt: 1, sbinPf: 'F', sbinNam: 'CENTER_SHORT' },
    ],
    wafers,
    mrr: { finishT: 1_700_009_000, dispCod: '0' },
  });

  const parsed = parseStdfBytes(bytes, { mode: 'full' });
  if (!parsed.ok) {
    throw new Error(parsed.error.message);
  }
  return buildLotModel(parsed.value);
}

describe('AutopsyReportCard & LoadedLotOverview integration (Task 7.2)', () => {
  it('renders AutopsyReportCard verdict-first above WaferMapCanvas across all three demo presets with hypotheses collapsed by default', async () => {
    const presets = listDemoPresets();
    const expectedHeadlines = [
      {
        presetId: 'edge-ring-etch' as const,
        expectedPrefix: 'Cause of death: Edge-Ring failure.',
        expectedBin: 'most loss in SBIN 7 (IDDQ_EDGE_LEAK).',
      },
      {
        presetId: 'handling-scratch' as const,
        expectedPrefix: 'Cause of death: Scratch failure.',
        expectedBin: 'most loss in SBIN 9 (VDD_METAL_SHORT).',
      },
      {
        presetId: 'site2-probe-contact' as const,
        expectedPrefix: 'Cause of death: Test Site 1:2 concentration anomaly.',
        expectedBin: 'most loss in SBIN 5 (CONT_OPEN).',
      },
    ];

    for (const { presetId, expectedPrefix, expectedBin } of expectedHeadlines) {
      const res = await ingestDemoPreset(presetId);
      expect(res.kind).toBe('ok');
      if (res.kind !== 'ok') continue;

      const html = renderToStaticMarkup(
        React.createElement(LoadedLotOverview, {
          data: res,
          presets,
          selectedPresetId: presetId,
          onSelectPreset: () => undefined,
          onLoadDemoLot: () => undefined,
          onSelectFile: () => undefined,
        }),
      );

      // Second toolbar row was removed in R3 (moved to NavBar + LotPicker); verdict precedes wafer map; KPI tiles & site table stay below
      const heroGridIdx = html.indexOf('data-testid="verdict-wafer-hero-grid"');
      const reportIdx = html.indexOf('data-testid="autopsy-report-card"');
      const waferIdx = html.indexOf('data-testid="wafer-base-canvas"');
      const tilesIdx = html.indexOf('aria-label="Lot Yield Summary"');
      const siteTableIdx = html.indexOf('data-testid="site-breakdown-row"');
      expect(html).not.toContain('data-testid="lot-header-bar"');
      expect(html).not.toContain('id="cal-preset-switcher"');
      expect(heroGridIdx).toBeGreaterThanOrEqual(0);
      expect(reportIdx).toBeGreaterThan(heroGridIdx);
      expect(waferIdx).toBeGreaterThan(reportIdx);
      expect(tilesIdx).toBeGreaterThan(waferIdx);
      expect(siteTableIdx).toBeGreaterThan(tilesIdx);

      // >=1280px side-by-side (~44% / ~56%) + <1280px stacked responsive classes
      expect(html).toContain('xl:grid-cols-[minmax(0,44fr)_minmax(0,56fr)]');

      // Cause-of-death headline, hedged <=0.95 confidence chip, offline provenance badge, button semantics, focus ring, aria-pressed
      expect(html).toContain(expectedPrefix);
      expect(html).toContain(expectedBin);
      expect(html).not.toContain('(confidence');
      expect(html).toContain('High · 0.9');
      expect(html).not.toMatch(/High · 0\.9[6-9]|High · 1\.00/);
      expect(html).toContain('Click a finding to light its dies');
      expect(html).toContain('data-testid="autopsy-live-region"');
      expect(html).toContain('aria-live="polite"');
      expect(html).toContain('Template · Offline');
      expect(html).toContain('data-testid="autopsy-headline-button"');
      expect(html).toContain('data-testid="autopsy-body-claim-button"');
      expect(html).toContain('data-testid="site-row-toggle-button"');
      expect(html).toContain('w-[3px] bg-accent');
      expect(html).not.toContain('border-hairline bg-transparent');
      expect(html).toContain('type="button"');
      expect(html).toContain('aria-pressed="false"');
      expect(html).toContain('focus-visible:outline-accent');

      // Hypotheses disclosure is collapsed by default (aria-expanded="false", aria-controls target exists & hidden)
      expect(html).toContain('data-testid="autopsy-hypotheses-toggle"');
      expect(html).toContain('aria-expanded="false"');
      const controlsMatch = /data-testid="autopsy-hypotheses-toggle"[^>]*aria-controls="([^"]+)"/.exec(
        html,
      );
      expect(controlsMatch?.[1]).toBeTruthy();
      expect(html).toContain(`id="${controlsMatch?.[1]}"`);
      expect(html).not.toContain('Candidate mechanism:');
      expect(html).not.toContain('Check next:');

      // Apple-grade restraint: zero drop-shadow utilities (other than shadow-none), zero bold >= 700
      expect(html).not.toMatch(/\bshadow-(?!none\b)[a-z0-9]+\b/);
      expect(html).not.toMatch(/\bfont-(bold|extrabold|black)\b/);

      // Expanded hypotheses reveal hedged candidate mechanisms and Check next steps
      const expandedHtml = renderToStaticMarkup(
        React.createElement(AutopsyReportCard, {
          lot: res.lot,
          report: res.report,
          verdict: res.verdict,
          facts: res.facts,
          defaultHypothesesOpen: true,
        }),
      );
      expect(expandedHtml).toContain('aria-expanded="true"');
      expect(expandedHtml).toContain('Candidate mechanism:');
      expect(expandedHtml).toContain('Check next:');
    }
  });

  it('writes cited die mask on headline/claim click, lights #D6E6FF overlay strokes, and clears on second click', async () => {
    const res = await ingestDemoPreset('edge-ring-etch');
    expect(res.kind).toBe('ok');
    if (res.kind !== 'ok') return;

    const { lot, report, verdict, facts } = res;
    const factsById = new Map(facts.map((f) => [f.factId, f]));
    const store = createClientTestStore();
    store.getState().setLot(lot);

    // Initial state: mask empty, aria-pressed="false"
    expect(store.getState().claimHighlight).toBeNull();
    expect(store.getState().highlightedDieIndices).toHaveLength(0);
    expect(store.getState().overlayHighlightCount).toBe(0);

    const initialHtml = renderToStaticMarkup(
      React.createElement(AutopsyReportCard, {
        lot,
        report,
        verdict,
        facts,
        store,
      }),
    );
    expect(initialHtml).toContain('data-claim-id="claim:cause-of-death"');
    expect(initialHtml).toContain('aria-pressed="false"');
    expect(initialHtml).not.toContain('Highlighted · Click to clear');

    // Render headline ClaimInlineButton and invoke its button onClick handler (1st click)
    const headlineClaim = report.causeOfDeathHeadline;
    const onToggle = (c: typeof headlineClaim): void => {
      toggleReportClaimInStore(store, lot, c, factsById);
    };

    const buttonBeforeClick = ClaimInlineButton({
      claim: headlineClaim,
      variant: 'headline',
      isActive: false,
      onToggle,
    });
    expect(buttonBeforeClick.type).toBe('button');
    expect(buttonBeforeClick.props.type).toBe('button');
    expect(buttonBeforeClick.props['aria-pressed']).toBe(false);

    (buttonBeforeClick.props.onClick as () => void)();

    // Selection store mask is non-empty and matches the headline's cited die set
    const afterFirstClick = store.getState();
    expect(afterFirstClick.claimHighlight?.claimId).toBe('claim:cause-of-death');
    expect(afterFirstClick.highlightedDieIndices.length).toBe(
      headlineClaim.resolvedDieIndices.length,
    );
    expect(afterFirstClick.overlayHighlightCount).toBe(
      headlineClaim.resolvedDieIndices.length,
    );

    let maskOnes = 0;
    for (let i = 0; i < afterFirstClick.claimHighlightMask.length; i += 1) {
      if (afterFirstClick.claimHighlightMask[i] !== 0) {
        maskOnes += 1;
      }
    }
    expect(maskOnes).toBe(headlineClaim.resolvedDieIndices.length);
    for (const dieIdx of headlineClaim.resolvedDieIndices) {
      expect(afterFirstClick.claimHighlightMask[dieIdx]).toBe(1);
      expect(afterFirstClick.overlayHighlightMask[dieIdx]).toBe(1);
    }

    // Re-rendered AutopsyReportCard reflects aria-pressed="true" and non-color "Highlighted" badge
    const activeHtml = renderToStaticMarkup(
      React.createElement(AutopsyReportCard, {
        lot,
        report,
        verdict,
        facts,
        store,
      }),
    );
    expect(activeHtml).toContain('aria-pressed="true"');
    expect(activeHtml).toContain('Highlighted · Click to clear');
    expect(activeHtml).toContain(
      'Selected finding (claim:cause-of-death):',
    );

    // OverlayCanvas paint helper lights up the cited dies on Wafer 0 in #D6E6FF + outer halo
    const wafer0 = lot.wafers[afterFirstClick.activeWaferIndex]!;
    const layout = computeWaferRenderLayout(
      wafer0,
      520,
      520,
      lot.dies,
      DEFAULT_VIEWPORT_TRANSFORM,
    );
    const { ctx, ops, getRectCount } = createMockOverlayCanvasContext();
    paintWaferOverlayLayer(ctx, {
      lot,
      waferIndex: afterFirstClick.activeWaferIndex,
      layout,
      dpr: 1,
      overlayHighlightMask: afterFirstClick.overlayHighlightMask,
      overlayHighlightCount: afterFirstClick.overlayHighlightCount,
      hoveredDieIndex: null,
      brush: null,
    });
    const accentStrokes = ops.filter(
      (o) =>
        (o.op === 'stroke' || o.op === 'strokeRect') &&
        o.strokeStyle?.toLowerCase() === COLOR_TOKENS.accent.toLowerCase(),
    );
    const haloStrokes = ops.filter(
      (o) =>
        (o.op === 'stroke' || o.op === 'strokeRect') &&
        o.strokeStyle === OVERLAY_HALO_STROKE,
    );
    expect(accentStrokes.length).toBeGreaterThanOrEqual(1);
    expect(haloStrokes.length).toBeGreaterThanOrEqual(1);
    expect(getRectCount()).toBeGreaterThan(40);

    // OverlayCanvas wrapper exposes deterministic highlight and outer-band counts
    const overlayHtml = renderToStaticMarkup(
      React.createElement(OverlayCanvas, {
        lot,
        waferIndex: afterFirstClick.activeWaferIndex,
        cssWidth: 520,
        cssHeight: 520,
        transform: DEFAULT_VIEWPORT_TRANSFORM,
        store,
      }),
    );
    expect(overlayHtml).toContain('data-testid="wafer-overlay-wrapper"');
    expect(overlayHtml).toContain(
      `data-highlight-count="${headlineClaim.resolvedDieIndices.length}"`,
    );
    expect(overlayHtml).toContain(
      `data-outer-band-highlight-count="${headlineClaim.resolvedDieIndices.length}"`,
    );
    expect(overlayHtml).toContain('data-interior-highlight-count="0"');

    // Second click on the active headline button clears the selection store mask
    const buttonWhileActive = ClaimInlineButton({
      claim: headlineClaim,
      variant: 'headline',
      isActive: true,
      onToggle,
    });
    expect(buttonWhileActive.props['aria-pressed']).toBe(true);
    (buttonWhileActive.props.onClick as () => void)();

    const afterSecondClick = store.getState();
    expect(afterSecondClick.claimHighlight).toBeNull();
    expect(afterSecondClick.highlightedDieIndices).toHaveLength(0);
    expect(afterSecondClick.overlayHighlightCount).toBe(0);
    expect(afterSecondClick.claimHighlightMask.every((b) => b === 0)).toBe(true);
    expect(afterSecondClick.overlayHighlightMask.every((b) => b === 0)).toBe(true);

    const clearedHtml = renderToStaticMarkup(
      React.createElement(AutopsyReportCard, {
        lot,
        report,
        verdict,
        facts,
        store,
      }),
    );
    expect(clearedHtml).not.toContain('aria-pressed="true"');

    // Clicking a parametric body claim selects activeTestNum = 204 and populates mask, second click clears
    const paramClaim = report.bodyClaims.find(
      (c) => c.claimId === 'claim:supporting-evidence',
    );
    expect(paramClaim).toBeDefined();
    if (paramClaim) {
      const bodyBtn = ClaimInlineButton({
        claim: paramClaim,
        variant: 'body',
        isActive: false,
        onToggle,
      });
      (bodyBtn.props.onClick as () => void)();
      expect(store.getState().activeTestNum).toBe(204);
      expect(store.getState().overlayHighlightCount).toBe(
        paramClaim.resolvedDieIndices.length,
      );

      (bodyBtn.props.onClick as () => void)();
      expect(store.getState().claimHighlight).toBeNull();
      expect(store.getState().overlayHighlightCount).toBe(0);
    }
  });

  it('selects the relevant wafer when clicking wafer-specific or wafer-subset claims (Tier 3 excursion & handling-scratch)', async () => {
    // 1. Tier 3 single-wafer excursion on Wafer W02 (waferIndex = 1)
    const excLot = buildSingleWaferExcursionLot();
    const excAutopsy = generateOfflineAutopsyReport(excLot);
    const excFactsById = new Map(excAutopsy.facts.map((f) => [f.factId, f]));
    const excStore = createSelectionStore();
    excStore.getState().setLot(excLot);
    expect(excStore.getState().activeWaferIndex).toBe(0);

    const excCardHtml = renderToStaticMarkup(
      React.createElement(AutopsyReportCard, {
        lot: excLot,
        report: excAutopsy.report,
        verdict: excAutopsy.verdict,
        facts: excAutopsy.facts,
        store: excStore,
      }),
    );
    expect(excCardHtml).toContain('Center excursion on Wafer W02');
    expect(excCardHtml).toContain('Wafer W02');

    const excPrimaryClaim = excAutopsy.report.bodyClaims.find(
      (c) => c.claimId === 'claim:primary-evidence',
    )!;
    toggleReportClaimInStore(excStore, excLot, excPrimaryClaim, excFactsById);
    expect(excStore.getState().activeWaferIndex).toBe(1);
    expect(excStore.getState().overlayHighlightCount).toBeGreaterThan(0);

    toggleReportClaimInStore(excStore, excLot, excPrimaryClaim, excFactsById);
    expect(excStore.getState().claimHighlight).toBeNull();
    expect(excStore.getState().overlayHighlightCount).toBe(0);

    // 2. handling-scratch clicked while viewing clean W01 (waferIndex = 0) jumps to scratched wafer W05..W22
    const scratchRes = await ingestDemoPreset('handling-scratch');
    expect(scratchRes.kind).toBe('ok');
    if (scratchRes.kind !== 'ok') return;

    const scratchStore = createSelectionStore();
    scratchStore.getState().setLot(scratchRes.lot);
    expect(scratchStore.getState().activeWaferIndex).toBe(0);

    const scratchFactsById = new Map(scratchRes.facts.map((f) => [f.factId, f]));
    toggleReportClaimInStore(
      scratchStore,
      scratchRes.lot,
      scratchRes.report.causeOfDeathHeadline,
      scratchFactsById,
    );
    expect(scratchStore.getState().activeWaferIndex).toBeGreaterThanOrEqual(4);
    expect(scratchStore.getState().activeWaferIndex).toBeLessThanOrEqual(21);
    expect(scratchStore.getState().overlayHighlightCount).toBeGreaterThan(0);

    toggleReportClaimInStore(
      scratchStore,
      scratchRes.lot,
      scratchRes.report.causeOfDeathHeadline,
      scratchFactsById,
    );
    expect(scratchStore.getState().claimHighlight).toBeNull();
    expect(scratchStore.getState().overlayHighlightCount).toBe(0);
  });

  it('escapes untrusted HTML-like characters via React plain-text nodes (Requirement 2.4)', () => {
    const excLot = buildSingleWaferExcursionLot();
    const { report, verdict, facts } = generateOfflineAutopsyReport(excLot);
    const adversarialReport = {
      ...report,
      bodyClaims: [
        {
          ...report.bodyClaims[0]!,
          text: 'Injected <img src=x onerror=alert(1)> & <script>evil()</script> payload.',
        },
        ...report.bodyClaims.slice(1),
      ],
    };

    const html = renderToStaticMarkup(
      React.createElement(AutopsyReportCard, {
        lot: excLot,
        report: adversarialReport,
        verdict,
        facts,
      }),
    );

    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img ');
    expect(html).toContain('&lt;script&gt;evil()&lt;/script&gt;');
  });

  it('supports injected SelectionStore on LoadedLotOverview (m-3) and sanitizes stream warning details (m-5)', async () => {
    const presets = listDemoPresets();
    const res = await ingestDemoPreset('site2-probe-contact');
    expect(res.kind).toBe('ok');
    if (res.kind !== 'ok') return;

    const store = createClientTestStore();
    store.getState().setLot(res.lot);
    store.getState().toggleSiteFilter(1);

    const payloadWithWarning = {
      ...res,
      lot: {
        ...res.lot,
        warnings: [
          {
            code: 'TRUNCATED_TAIL_RECORD' as const,
            byteOffset: 4096,
            recTyp: 5,
            recSub: 20,
            detail: 'Unexpected <img src=x onerror=evil()>frame\u0007tail',
          },
        ],
      },
    };
    store.getState().setLot(payloadWithWarning.lot);
    store.getState().toggleSiteFilter(1);

    const html = renderToStaticMarkup(
      React.createElement(LoadedLotOverview, {
        data: payloadWithWarning,
        presets,
        selectedPresetId: 'site2-probe-contact',
        onSelectPreset: () => undefined,
        onLoadDemoLot: () => undefined,
        onSelectFile: () => undefined,
        store,
      }),
    );

    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('Highlighted');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('\u0007');
    expect(html).toContain('Unexpected img src=x onerror=evil()frametail');
  });
});
