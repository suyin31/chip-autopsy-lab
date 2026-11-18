import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { StoreApi } from 'zustand';
import { listDemoPresets } from '@/core/demo';
import { SUPPORTED_LOCALES } from '@/core/i18n';
import { buildLotModel, type LotModel } from '@/core/model';
import { buildStatFacts, generateOfflineAutopsyReport } from '@/core/report';
import { parseStdfBytes, PRR_PART_FLG, writeStdfBytes } from '@/core/stdf';
import { I18nProvider } from '@/ui/i18n';
import { BinsOnlyNotice, LoadedLotOverview } from '@/ui/layout';
import { createSelectionStore, type SelectionStoreState } from '@/ui/state';
import { countPrimaryButtons } from '@/ui/primitives/button';
import { COLOR_TOKENS, WAFER_TOKENS } from '@/ui/tokens';
import {
  type Canvas2DContextLike,
  computeWaferRenderLayout,
  DEFAULT_VIEWPORT_TRANSFORM,
  OverlayCanvas,
  paintWaferOverlayLayer,
} from '@/ui/wafer-map';
import { ingestDemoPreset } from '@/workers';
import {
  AutopsyReportCard,
  toggleReportClaimInStore,
} from './AutopsyReportCard';

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
        w === 1 ? Math.hypot(c.x, c.y) <= 2.9 : c.x === w - 1 && c.y === 5;
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
      wir: {
        headNum: 1,
        siteGrp: 1,
        startT: 1_700_000_000 + w * 60,
        waferId: `W0${w + 1}`,
      },
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

describe('Verdict Column (R5: VerdictHero, ConfidencePill, StatRow, FindingsList)', () => {
  it('renders VerdictHero, ConfidencePill, 3-item StatRow, and borderless FindingsList with zero monospace or uppercase labels across all 3 demo presets', async () => {
    const presets = listDemoPresets();
    const expectedCases = [
      {
        presetId: 'edge-ring-etch' as const,
        expectedCause: 'Edge-Ring',
        expectedSubBin: 'SBIN 7 IDDQ_EDGE_LEAK',
      },
      {
        presetId: 'handling-scratch' as const,
        expectedCause: 'Scratch',
        expectedSubBin: 'SBIN 9 VDD_METAL_SHORT',
      },
      {
        presetId: 'site2-probe-contact' as const,
        expectedCause: 'test site',
        expectedSubBin: 'SBIN 5 CONT_OPEN',
      },
    ];

    for (const { presetId, expectedCause, expectedSubBin } of expectedCases) {
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

      // Verdict column precedes wafer map in DOM; premium §6.2 12-column split: sticky stage cols 1-7, verdict cols 8-12
      const heroGridIdx = html.indexOf('data-testid="verdict-wafer-hero-grid"');
      const reportIdx = html.indexOf('data-testid="autopsy-report-card"');
      const waferIdx = html.indexOf('data-testid="wafer-base-canvas"');
      expect(heroGridIdx).toBeGreaterThanOrEqual(0);
      expect(reportIdx).toBeGreaterThan(heroGridIdx);
      expect(waferIdx).toBeGreaterThan(reportIdx);
      // P13: 540 px stage + 20 gutter from 1024, single 640 px column at sm
      expect(html).toContain('xl:grid-cols-12');
      expect(html).toContain('lg:grid-cols-[540px_minmax(0,1fr)] lg:items-start lg:gap-x-5');
      expect(html).toContain('sm:max-lg:max-w-[640px]');
      expect(html).toContain('lg:sticky lg:top-[52px]');
      expect(html).toContain('lg:h-[calc(100dvh-52px)] lg:min-h-[640px] lg:pt-5 lg:pb-4 xl:col-span-7');
      expect(html).toContain('lg:col-start-2 lg:row-start-1 xl:col-span-5 xl:col-start-8');
      // Below 1024 the stats follow the stage (order 3) and findings come after (order 4)
      expect(html).toContain('order-3 mt-8 lg:order-none lg:mt-10');
      expect(html).toContain('order-4 lg:order-none');
      expect(html).toContain('lg:pt-[72px] min-[90rem]:pt-[84px]');
      expect(html).not.toContain('xl:overflow-y-auto');
      // Block 9 footer line closes the verdict column
      expect(html).toContain(
        '>Runs entirely in your browser. Raw STDF bytes never leave this device.<',
      );
      expect(html.indexOf('data-testid="verdict-footer"')).toBeGreaterThan(
        html.indexOf('data-testid="yield-summary"'),
      );

      // Isolated verdict column markup check
      const cardHtml = renderToStaticMarkup(
        React.createElement(AutopsyReportCard, {
          lot: res.lot,
          report: res.report,
          verdict: res.verdict,
          facts: res.facts,
          yieldSummary: res.yieldSummary,
        }),
      );

      // VerdictHero: Cause of death prefix + ember-ink cause button + plain takeaway (premium §7.3)
      expect(cardHtml).toContain('data-testid="verdict-headline"');
      expect(cardHtml).toContain('Cause of death:');
      expect(cardHtml).toContain(expectedCause);
      expect(cardHtml).toContain(expectedSubBin);
      expect(cardHtml).toContain('translate="no"');
      expect(cardHtml).toContain('data-testid="autopsy-headline-button"');
      expect(cardHtml).toContain('text-ember-ink');
      expect(cardHtml).toMatch(/<span data-testid="verdict-prefix"[^>]*>[^<]*<\/span><wbr\/>/);
      // premium §12.2: the cause phrase is the one serif accent (en)
      expect(cardHtml.match(/data-accent=""/g)?.length).toBe(1);
      expect(cardHtml).toMatch(/data-testid="autopsy-headline-button"[^>]*><span data-accent="" class="type-accent">/);
      const takeaway =
        /<p data-testid="verdict-subline"[^>]*>(.*?)<\/p>/.exec(cardHtml)?.[1] ?? '';
      expect(takeaway).toContain('Final yield is');
      expect(takeaway).not.toMatch(/[HS]BIN|IDDQ|VDD_|CONT_OPEN|!/);

      // Action row: one primary "Show on wafer" + the confidence chip (premium §6.2, §7.4, A20)
      expect(cardHtml).toContain('data-testid="verdict-show-on-wafer"');
      expect(cardHtml).toContain('>Show on wafer<');
      expect(countPrimaryButtons(cardHtml)).toBe(1);
      expect(cardHtml).toContain('data-testid="confidence-pill"');
      expect(cardHtml).toContain('data-level="high"');
      expect(cardHtml).toMatch(/High confidence, 0\.\d{2}/);
      expect(cardHtml).not.toMatch(/confidence, 0\.9[6-9]|confidence, 1\.00/);
      expect(cardHtml).not.toContain('Template · Offline');
      expect(cardHtml).not.toContain('AUTOPSY REPORT');
      expect(cardHtml).not.toContain('Click a finding to light its dies');

      // ConfidencePill popover opens with provenance method copy (§4.4)
      const openConfHtml = renderToStaticMarkup(
        React.createElement(AutopsyReportCard, {
          lot: res.lot,
          report: res.report,
          verdict: res.verdict,
          facts: res.facts,
          defaultConfidenceOpen: true,
        }),
      );
      expect(openConfHtml).toContain('data-testid="confidence-popover"');
      expect(openConfHtml).toContain('How this verdict was made');
      expect(openConfHtml).toContain(
        'How strongly the wafer pattern matches the named class, from 0 to 1. Computed on this device.',
      );
      if (presetId === 'site2-probe-contact') {
        expect(openConfHtml).not.toContain('data-testid="confidence-match"');
      } else {
        expect(openConfHtml).toContain('data-testid="confidence-match"');
        expect(openConfHtml).toContain(
          `Match with <bdi translate="no">${expectedCause}</bdi>`,
        );
        expect(openConfHtml).toMatch(/data-testid="confidence-match-bar"[^>]*style="width:9\d%"/);
      }
      expect(openConfHtml).toContain(
        'Every number comes from the on-device analysis engine. The text is the built-in template.',
      );

      // StatRow: exactly 3 stats, at most 1 orange emphasis, §5.3 aria-hidden visible span + sr-only final-value sibling
      const statItemMatches = cardHtml.match(
        /data-testid="verdict-stat-item"/g,
      );
      expect(statItemMatches).toHaveLength(3);
      expect(cardHtml.match(/data-testid="verdict-stat-sr"/g)).toHaveLength(3);
      expect(cardHtml.match(/data-testid="verdict-stat-value"[^>]*aria-hidden="true"/g)).toHaveLength(3);
      expect(cardHtml).toContain('data-verdict-rise-block="headline"');
      expect(cardHtml).toContain('data-verdict-rise-block="findings"');
      // Premium §7.5 / A4: each stat is a button bound to its evidence; numbers are never orange
      expect(cardHtml.match(/data-testid="verdict-stat-button"/g)).toHaveLength(3);
      expect(cardHtml.match(/data-testid="verdict-stat-button"[^>]*aria-pressed="false"/g)).toHaveLength(3);
      expect(cardHtml).not.toContain('data-emphasis');
      const statRowHtml = cardHtml.slice(
        cardHtml.indexOf('data-testid="verdict-stat-row"'),
        cardHtml.indexOf('data-testid="verdict-findings-section"'),
      );
      expect(statRowHtml).not.toMatch(/text-failure|text-ember|ember/);
      expect(statRowHtml).toMatch(/<dd class="[^"]*text-text-primary/);

      // FindingsList: borderless rows (border-0), collapsed Possible causes by default
      expect(cardHtml).toContain('data-testid="verdict-findings-list"');
      expect(cardHtml).toContain('data-testid="autopsy-body-claim-button"');
      expect(cardHtml).toContain('data-testid="autopsy-hypotheses-toggle"');
      expect(cardHtml).toContain('Possible causes');
      expect(cardHtml).not.toContain('data-testid="hypothesis-item"');

      // R5 strict invariant: zero monospace, zero uppercase, zero drop-shadow, zero bold >= 700 in Verdict Column
      expect(cardHtml).not.toMatch(
        /\b(font-mono|type-mono-data|tabular-mono|uppercase)\b/,
      );
      expect(cardHtml).not.toMatch(/<(code|kbd|pre|samp)\b/);
      // The focus-ring token (premium §3.2) and the findings card's shadow-card (§7.6.1) are the only box-shadows here
      expect(cardHtml).not.toMatch(/\bshadow-(?!none\b|focus-ring\b|card\b)[a-z0-9]+\b/);
      expect(cardHtml).toMatch(
        /data-testid="verdict-findings-list" class="[^"]*rounded-xl bg-surface p-1 shadow-card/,
      );
      expect(cardHtml).not.toMatch(/\bfont-(bold|extrabold|black)\b/);

      // Expanded Possible causes reveals all 3 hedged hypotheses + check-next sublines
      const expandedHtml = renderToStaticMarkup(
        React.createElement(AutopsyReportCard, {
          lot: res.lot,
          report: res.report,
          verdict: res.verdict,
          facts: res.facts,
          defaultHypothesesOpen: true,
        }),
      );
      const hypItems = expandedHtml.match(/data-testid="hypothesis-item"/g);
      expect(hypItems).toHaveLength(3);
    }
  });

  it('renders the healthy-lot verdict with no cause button and no orange text (premium §7.3)', () => {
    const bytes = writeStdfBytes({
      endianness: 'little',
      mir: { lotId: 'CLEAN-LOT', partTyp: 'CAL-CLEAN', jobNam: 'SORT' },
      sdrs: [{ headNum: 1, siteGrp: 1, siteNums: [1], cardId: 'C1' }],
      hbrs: [{ hbinNum: 1, hbinCnt: 2, hbinPf: 'P', hbinNam: 'PASS' }],
      sbrs: [{ sbinNum: 1, sbinCnt: 2, sbinPf: 'P', sbinNam: 'GOOD' }],
      wafers: [
        {
          wir: { headNum: 1, siteGrp: 1, startT: 1_700_000_000, waferId: 'W01' },
          touchdowns: [
            [{ headNum: 1, siteNum: 1, partFlg: 0, hardBin: 1, softBin: 1, xCoord: 0, yCoord: 0 }],
            [{ headNum: 1, siteNum: 1, partFlg: 0, hardBin: 1, softBin: 1, xCoord: 1, yCoord: 0 }],
          ],
          wrr: { headNum: 1, siteGrp: 1, finishT: 1_700_000_020, partCnt: 2, waferId: 'W01' },
        },
      ],
      mrr: { finishT: 1_700_000_050, dispCod: '0' },
    });
    const parsed = parseStdfBytes(bytes, { mode: 'full' });
    if (!parsed.ok) throw new Error(parsed.error.message);
    const lot = buildLotModel(parsed.value);
    const { report, verdict, facts } = generateOfflineAutopsyReport(lot);
    const html = renderToStaticMarkup(
      React.createElement(AutopsyReportCard, { lot, report, verdict, facts }),
    );
    expect(html).toContain('>No cause of death.<');
    expect(html).not.toContain('data-testid="autopsy-headline-button"');
    expect(html).not.toContain('text-ember');
    expect(html).not.toContain('data-accent');
    expect(html).toContain('2 of 2 dies passed every test.');
    expect(countPrimaryButtons(html)).toBe(1);
  });

  it('lights the evidence dies of a stat through the store and shows it selected (premium §7.5)', async () => {
    const res = await ingestDemoPreset('edge-ring-etch');
    expect(res.kind).toBe('ok');
    if (res.kind !== 'ok') return;
    const { lot, report, verdict, facts } = res;
    const store = createClientTestStore();
    store.getState().setLot(lot);

    const render = (): string =>
      renderToStaticMarkup(
        React.createElement(AutopsyReportCard, { lot, report, verdict, facts, store }),
      );
    const before = render();
    expect(before).toContain('final yield');
    expect(before).toMatch(
      /data-testid="verdict-stat-caption-secondary"[^>]*>8\d\.\d% on the first test</,
    );
    expect(before).toContain('dies failed, of 15,825 tested');

    const [edgeStat] = buildStatFacts({ lot });
    store.getState().toggleClaimHighlight({
      claimId: edgeStat.evidence.claimId,
      dieIndices: edgeStat.evidence.dieIndices,
      glowOrderMode: edgeStat.evidence.order,
    });
    expect(store.getState().overlayHighlightCount).toBe(edgeStat.evidence.dieIndices.length);

    const after = render();
    expect(
      after.match(/data-testid="verdict-stat-button"[^>]*aria-pressed="true"/g),
    ).toHaveLength(1);
    expect(after).toMatch(
      /data-testid="verdict-stat-button" data-claim-id="stat:stats.edgeShare" aria-pressed="true"/,
    );
  });

  it('writes cited die mask on headline/finding toggle, shows expanded detail + Clear, lights #D6E6FF overlay strokes, and clears on second click', async () => {
    const res = await ingestDemoPreset('edge-ring-etch');
    expect(res.kind).toBe('ok');
    if (res.kind !== 'ok') return;

    const { lot, report, verdict, facts } = res;
    const factsById = new Map(facts.map((f) => [f.factId, f]));
    const store = createClientTestStore();
    store.getState().setLot(lot);

    expect(store.getState().claimHighlight).toBeNull();
    expect(store.getState().overlayHighlightCount).toBe(0);

    // 1. Toggle cause-of-death button on VerdictHero
    const headlineClaim = report.causeOfDeathHeadline;
    toggleReportClaimInStore(store, lot, headlineClaim, factsById);

    const afterFirstClick = store.getState();
    expect(afterFirstClick.claimHighlight?.claimId).toBe(
      'claim:cause-of-death',
    );
    expect(afterFirstClick.overlayHighlightCount).toBe(
      headlineClaim.resolvedDieIndices.length,
    );

    const activeHeadlineHtml = renderToStaticMarkup(
      React.createElement(AutopsyReportCard, {
        lot,
        report,
        verdict,
        facts,
        store,
      }),
    );
    expect(activeHeadlineHtml).toContain('aria-pressed="true"');

    // OverlayCanvas paint helper rims the cited dies on Wafer 0 with `evidence-rim` (premium §5.4)
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
    const rimStrokes = ops.filter(
      (o) =>
        (o.op === 'stroke' || o.op === 'strokeRect') &&
        o.strokeStyle === WAFER_TOKENS.evidenceRim,
    );
    const accentStrokes = ops.filter(
      (o) =>
        (o.op === 'stroke' || o.op === 'strokeRect') &&
        o.strokeStyle?.toLowerCase() === COLOR_TOKENS.accent.toLowerCase(),
    );
    expect(rimStrokes.length).toBeGreaterThanOrEqual(1);
    expect(accentStrokes).toHaveLength(0);
    expect(getRectCount()).toBeGreaterThan(40);

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
    expect(overlayHtml).toContain(
      `data-highlight-count="${headlineClaim.resolvedDieIndices.length}"`,
    );
    expect(overlayHtml).toContain(
      `data-outer-band-highlight-count="${headlineClaim.resolvedDieIndices.length}"`,
    );
    expect(overlayHtml).toContain('data-interior-highlight-count="0"');

    // Second toggle clears
    toggleReportClaimInStore(store, lot, headlineClaim, factsById);
    expect(store.getState().claimHighlight).toBeNull();
    expect(store.getState().overlayHighlightCount).toBe(0);

    // 2. Toggle primary finding row -> shows expanded detail, Check next lines, and "Clear"
    const primaryClaim = report.bodyClaims.find(
      (c) => c.claimId === 'claim:primary-evidence',
    )!;
    toggleReportClaimInStore(store, lot, primaryClaim, factsById);
    const expandedRowHtml = renderToStaticMarkup(
      React.createElement(AutopsyReportCard, {
        lot,
        report,
        verdict,
        facts,
        store,
      }),
    );
    expect(expandedRowHtml).toContain('data-testid="finding-clear-label"');
    expect(expandedRowHtml).toContain('data-testid="finding-expanded-detail"');
    // Premium §7.6.4: engine sentence, "Check next" label with its steps, and the meta line
    expect(expandedRowHtml).toContain('data-testid="finding-check-next"');
    expect(expandedRowHtml).toContain('>Check next</p>');
    expect(expandedRowHtml).toContain('data-testid="finding-engine-sentence"');
    expect(expandedRowHtml).toMatch(
      /data-testid="finding-meta"[^>]*>[\d,]+ on this wafer, [\d,]+ on all 25 wafers</,
    );
    expect(expandedRowHtml).toMatch(/class="[^"]*pb-4 pl-11 pr-4/);

    // 3. Toggle parametric finding row -> sets activeTestNum = 204, second toggle clears
    const paramClaim = report.bodyClaims.find(
      (c) => c.claimId === 'claim:supporting-evidence',
    );
    expect(paramClaim).toBeDefined();
    if (paramClaim) {
      toggleReportClaimInStore(store, lot, paramClaim, factsById);
      expect(store.getState().activeTestNum).toBe(204);
      expect(store.getState().overlayHighlightCount).toBe(
        paramClaim.resolvedDieIndices.length,
      );
      toggleReportClaimInStore(store, lot, paramClaim, factsById);
      expect(store.getState().claimHighlight).toBeNull();
    }
  });

  it('selects the relevant wafer when clicking wafer-specific or wafer-subset claims (Tier 3 excursion & handling-scratch)', async () => {
    const excLot = buildSingleWaferExcursionLot();
    const excAutopsy = generateOfflineAutopsyReport(excLot);
    const excFactsById = new Map(excAutopsy.facts.map((f) => [f.factId, f]));
    const excStore = createSelectionStore();
    excStore.getState().setLot(excLot);

    const excCardHtml = renderToStaticMarkup(
      React.createElement(AutopsyReportCard, {
        lot: excLot,
        report: excAutopsy.report,
        verdict: excAutopsy.verdict,
        facts: excAutopsy.facts,
        store: excStore,
      }),
    );
    expect(excCardHtml).toContain('W02');

    const excPrimaryClaim = excAutopsy.report.bodyClaims.find(
      (c) => c.claimId === 'claim:primary-evidence',
    )!;
    toggleReportClaimInStore(excStore, excLot, excPrimaryClaim, excFactsById);
    expect(excStore.getState().activeWaferIndex).toBe(1);
    expect(excStore.getState().overlayHighlightCount).toBeGreaterThan(0);

    toggleReportClaimInStore(excStore, excLot, excPrimaryClaim, excFactsById);
    expect(excStore.getState().claimHighlight).toBeNull();

    const scratchRes = await ingestDemoPreset('handling-scratch');
    expect(scratchRes.kind).toBe('ok');
    if (scratchRes.kind !== 'ok') return;

    const scratchStore = createSelectionStore();
    scratchStore.getState().setLot(scratchRes.lot);
    const scratchFactsById = new Map(
      scratchRes.facts.map((f) => [f.factId, f]),
    );
    toggleReportClaimInStore(
      scratchStore,
      scratchRes.lot,
      scratchRes.report.causeOfDeathHeadline,
      scratchFactsById,
    );
    expect(scratchStore.getState().activeWaferIndex).toBeGreaterThanOrEqual(4);
    expect(scratchStore.getState().activeWaferIndex).toBeLessThanOrEqual(21);
  });

  it('renders deterministically across all 5 locales, hides parametric rows in bins-only mode (§3.8), and escapes untrusted HTML (Requirement 2.4)', async () => {
    const res = await ingestDemoPreset('edge-ring-etch');
    expect(res.kind).toBe('ok');
    if (res.kind !== 'ok') return;

    for (const locale of SUPPORTED_LOCALES) {
      const renderOnce = (): string =>
        renderToStaticMarkup(
          React.createElement(
            I18nProvider,
            { initialLocale: locale },
            React.createElement(AutopsyReportCard, {
              lot: res.lot,
              report: res.report,
              verdict: res.verdict,
              facts: res.facts,
              yieldSummary: res.yieldSummary,
            }),
          ),
        );
      const htmlA = renderOnce();
      const htmlB = renderOnce();
      expect(htmlA).toBe(htmlB);
      expect(htmlA).not.toMatch(
        /\b(font-mono|type-mono-data|tabular-mono|uppercase)\b/,
      );
    }

    // §3.8 Moment 2: bins-only mode hides parametric capability rows and renders BinsOnlyNotice cleanly
    const binsOnlyLot: LotModel = { ...res.lot, parseMode: 'bins-only' };
    const binsOnlyHtml = renderToStaticMarkup(
      React.createElement(AutopsyReportCard, {
        lot: binsOnlyLot,
        report: res.report,
        verdict: res.verdict,
        facts: res.facts,
        binsOnlyNotice: React.createElement(BinsOnlyNotice, {
          onParseEverything: () => undefined,
        }),
      }),
    );
    expect(binsOnlyHtml).toContain('data-testid="bins-only-notice"');
    expect(binsOnlyHtml).not.toContain('204 IDDQ_LEAK');
    expect(binsOnlyHtml).not.toMatch(
      /\b(font-mono|type-mono-data|tabular-mono|uppercase)\b/,
    );

    // Requirement 2.4: escapes untrusted HTML characters in both params and expanded detail text
    const store = createClientTestStore();
    store.getState().setLot(res.lot);
    const primary = res.report.bodyClaims[0]!;
    const adversarialClaim = {
      ...primary,
      messageKey: 'findings.dominantBin.headline' as const,
      subMessageKey: 'findings.dominantBin.sub' as const,
      params: {
        ...primary.params,
        bin: '<script>evil()</script>',
      },
      text: 'Injected <img src=x onerror=alert(1)> payload.',
    };
    const adversarialReport = {
      ...res.report,
      bodyClaims: [adversarialClaim, ...res.report.bodyClaims.slice(1)],
    };
    toggleReportClaimInStore(store, res.lot, adversarialClaim);

    const escapedHtml = renderToStaticMarkup(
      React.createElement(AutopsyReportCard, {
        lot: res.lot,
        report: adversarialReport,
        verdict: res.verdict,
        facts: res.facts,
        store,
      }),
    );
    expect(escapedHtml).not.toContain('<script>');
    expect(escapedHtml).not.toContain('<img ');
    expect(escapedHtml).toContain('&lt;script&gt;evil()&lt;/script&gt;');
    expect(escapedHtml).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });

  it('supports selection-scoped stats and finding counts when SelectionStore filter is active and sanitizes stream warnings', async () => {
    const presets = listDemoPresets();
    const res = await ingestDemoPreset('site2-probe-contact');
    expect(res.kind).toBe('ok');
    if (res.kind !== 'ok') return;

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

    const store = createClientTestStore();
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

    expect(html).toContain('in selection');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('\u0007');
    expect(html).toContain('Unexpected img src=x onerror=evil()frametail');
  });
});
