import { expect, type Page, test } from '@playwright/test';

interface CapturedOutboundFact {
  readonly factId: string;
  readonly kind: string;
  readonly summary: string;
  readonly dieCount: number;
  readonly metrics: ReadonlyArray<{
    readonly key: string;
    readonly numericValue: number;
    readonly displayValue: string;
    readonly tolerance: number;
  }>;
  readonly binRef?: {
    readonly mode: string;
    readonly code: number;
    readonly name: string;
  };
  readonly testRef?: {
    readonly testNum: number;
    readonly testName: string;
  };
}

interface CapturedNarratePayload {
  readonly mode: string;
  readonly lotId: string;
  readonly verdict: string;
  readonly confidence: number;
  readonly outboundFacts: readonly CapturedOutboundFact[];
}

const FORBIDDEN_KEYS = new Set([
  'dieIds',
  'dieIndices',
  'dies',
  'x',
  'y',
  'xCoord',
  'yCoord',
  'coords',
  'coordinates',
  'values',
  'measurements',
  'rawBytes',
  'stdfBytes',
  'buffer',
  'arrayBuffer',
  'ptrs',
  'prrs',
]);

const DIE_ID_RE = /\b[A-Za-z0-9_-]+:(?:-?\d+,-?\d+|part-\d+)\b/;

function collectForbiddenKeys(value: unknown, path = ''): string[] {
  const hits: string[] = [];
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) {
      hits.push(...collectForbiddenKeys(value[i], `${path}[${i}]`));
    }
    return hits;
  }
  if (value !== null && typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const nextPath = path ? `${path}.${k}` : k;
      if (FORBIDDEN_KEYS.has(k)) {
        hits.push(nextPath);
      }
      hits.push(...collectForbiddenKeys(v, nextPath));
    }
  }
  return hits;
}

async function openEdgeRingDemo(page: Page): Promise<void> {
  await page.addInitScript(() => {
    window.sessionStorage.setItem('cal.sweep.v1', '1');
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/?nohints=1');
  await page.getByTestId('demo-card-edge-ring-etch').click();
  await expect(page.getByTestId('wafer-stage')).toHaveAttribute(
    'data-sweep',
    'done',
    { timeout: 5_000 },
  );
  await expect(page.getByTestId('verdict-headline')).toBeVisible();
}

test.describe('Task 16 - Optional LLM narrator, citation validation, timeout fallback, and privacy', () => {
  test.use({ colorScheme: 'light' });

  test('(1) + (4): mocked 200 valid narration swaps findings, shows methodLlm, preserves die linking, and sends privacy-safe outbound payload', async ({
    page,
  }) => {
    const captured: {
      raw: string;
      body: CapturedNarratePayload | null;
      verifiedSpatialText: string;
      verifiedBinText: string;
      requestCount: number;
    } = {
      raw: '',
      body: null,
      verifiedSpatialText: '',
      verifiedBinText: '',
      requestCount: 0,
    };

    await page.route('**/api/autopsy/narrate', async (route) => {
      captured.requestCount += 1;
      captured.raw = route.request().postData() ?? '';
      const payload = route.request().postDataJSON() as CapturedNarratePayload;
      captured.body = payload;

      const spatialFact = payload.outboundFacts.find(
        (f) => f.kind === 'spatial-pattern',
      );
      const binFact = payload.outboundFacts.find(
        (f) => f.kind === 'dominant-bin',
      );
      const paramFact = payload.outboundFacts.find(
        (f) => f.kind === 'parametric-capability',
      );

      const claims: Array<{
        readonly id: string;
        readonly text: string;
        readonly citedFactIds: readonly string[];
      }> = [];

      if (spatialFact) {
        captured.verifiedSpatialText = `AI verified: outer 3 rings hold ${spatialFact.dieCount} failing dies across the lot.`;
        claims.push({
          id: 'claim:primary-evidence',
          text: captured.verifiedSpatialText,
          citedFactIds: [spatialFact.factId],
        });
      }
      if (binFact) {
        const binLabel = binFact.binRef
          ? `${binFact.binRef.mode} ${binFact.binRef.code}`
          : 'SBIN 7';
        captured.verifiedBinText = `AI verified: ${binLabel} accounts for ${binFact.dieCount} failing dies.`;
        claims.push({
          id: 'claim:dominant-bin',
          text: captured.verifiedBinText,
          citedFactIds: [binFact.factId],
        });
      }
      if (paramFact) {
        const cpkMetric = paramFact.metrics.find((m) => m.key === 'cpk');
        if (cpkMetric) {
          claims.push({
            id: 'claim:supporting-evidence',
            text: `AI verified: Test ${paramFact.testRef?.testNum ?? 204} shows Cpk ${cpkMetric.displayValue}.`,
            citedFactIds: [paramFact.factId],
          });
        }
      }

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ claims }),
      });
    });

    await openEdgeRingDemo(page);

    const card = page.getByTestId('autopsy-report-card');
    await expect(card).toHaveAttribute('data-narration-source', 'llm-verified', {
      timeout: 5_000,
    });
    await expect(card).toHaveAttribute('data-narration-status', 'verified');

    // (4) Outbound payload privacy assertions
    expect(captured.requestCount).toBe(1);
    expect(captured.body).not.toBeNull();
    expect(Object.keys(captured.body!).sort()).toEqual([
      'confidence',
      'lotId',
      'mode',
      'outboundFacts',
      'verdict',
    ]);
    expect(captured.body!.mode).toBe('narrate');
    expect(captured.body!.outboundFacts.length).toBeGreaterThan(0);
    expect(captured.body!.outboundFacts.length).toBeLessThanOrEqual(64);
    expect(collectForbiddenKeys(captured.body)).toEqual([]);
    expect(captured.raw).not.toMatch(DIE_ID_RE);

    // Cause-of-death headline stays locked to deterministic Req 10.1 wording
    await expect(page.getByTestId('verdict-headline')).toContainText(
      'Cause of death: Edge-Ring failure.',
    );

    // Finding rows swapped to validated AI text
    const findingHeadlines = page.getByTestId('finding-row-headline');
    await expect(findingHeadlines.first()).toHaveText(
      captured.verifiedSpatialText,
    );
    await expect(findingHeadlines.nth(1)).toHaveText(captured.verifiedBinText);

    // Confidence popover displays verdict.methodLlm and verified narration status
    await page.getByTestId('confidence-pill').click();
    await expect(page.getByTestId('confidence-popover')).toBeVisible();
    await expect(page.getByTestId('confidence-method-body')).toHaveText(
      'Every number comes from the on-device analysis engine. An AI model rephrased the text and every sentence cites an engine fact.',
    );
    await expect(page.getByTestId('confidence-narration-status')).toHaveText(
      'AI summary verified against cited engine facts.',
    );
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('confidence-popover')).toBeHidden();

    // Clicking a swapped finding still illuminates its cited dies on the wafer overlay
    const overlay = page.getByTestId('wafer-overlay-wrapper');
    await expect(overlay).toHaveAttribute('data-highlight-count', '0');
    await page.getByTestId('autopsy-body-claim-button').first().click();
    await expect(overlay).not.toHaveAttribute('data-highlight-count', '0');

    // Switching to Japanese reverts to deterministic template without issuing another narration call
    await page.getByTestId('language-switcher-trigger').click();
    await page.getByRole('menuitemradio', { name: '日本語' }).click();
    await expect(card).toHaveAttribute(
      'data-narration-source',
      'deterministic-template',
    );
    await expect(card).toHaveAttribute('data-narration-status', 'idle');
    await expect(findingHeadlines.first()).not.toHaveText(
      captured.verifiedSpatialText,
    );
    expect(captured.requestCount).toBe(1);
  });

  test('(2): mocked 200 with hallucinated number or unknown factId is rejected client-side and keeps template text', async ({
    page,
  }) => {
    // Case A: hallucinated numeric literal
    await page.route('**/api/autopsy/narrate', async (route) => {
      const body = route.request().postDataJSON() as CapturedNarratePayload;
      const spatialFact = body.outboundFacts.find(
        (f) => f.kind === 'spatial-pattern',
      );
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          claims: [
            {
              id: 'claim:primary-evidence',
              text: 'Hallucinated finding claiming 99.9% and 88888 dies failed.',
              citedFactIds: [spatialFact?.factId ?? 'fact:spatial:primary'],
            },
          ],
        }),
      });
    });

    await openEdgeRingDemo(page);

    const card = page.getByTestId('autopsy-report-card');
    await expect(card).toHaveAttribute('data-narration-status', 'fallback', {
      timeout: 5_000,
    });
    await expect(card).toHaveAttribute(
      'data-narration-source',
      'deterministic-template',
    );
    await expect(page.getByTestId('finding-row-headline').first()).toHaveText(
      'Failures concentrate in the outer 3 rings',
    );
    await expect(page.locator('[data-sonner-toast]')).toHaveCount(0);

    await page.getByTestId('confidence-pill').click();
    await expect(page.getByTestId('confidence-method-body')).toHaveText(
      'Every number comes from the on-device analysis engine. The text is the built-in template.',
    );
    await expect(page.getByTestId('confidence-narration-status')).toHaveText(
      'Showing built-in template summary.',
    );
    await page.keyboard.press('Escape');

    // Case B: unknown factId on a newly loaded lot
    await page.unroute('**/api/autopsy/narrate');
    await page.route('**/api/autopsy/narrate', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          claims: [
            {
              id: 'claim:primary-evidence',
              text: 'Unverified claim citing a fabricated engine fact.',
              citedFactIds: ['fact:nonexistent:999'],
            },
          ],
        }),
      });
    });

    await page.getByTestId('lot-picker-trigger').click();
    await page.getByRole('menuitemradio', { name: /Robotic Handling Scratch/i }).click();
    await expect(page.getByTestId('verdict-headline')).toContainText('Scratch failure.');
    await expect(card).toHaveAttribute('data-narration-status', 'fallback', {
      timeout: 5_000,
    });
    await expect(card).toHaveAttribute(
      'data-narration-source',
      'deterministic-template',
    );
    await expect(page.getByTestId('finding-row-headline').first()).not.toContainText(
      'Unverified claim',
    );
    await expect(page.locator('[data-sonner-toast]')).toHaveCount(0);
  });

  test('(3): mocked 503 and delayed > 4 s route fall back silently and keep deterministic template report', async ({
    page,
  }) => {
    // Subcase 3a: HTTP 503 llm_unconfigured
    await page.route('**/api/autopsy/narrate', async (route) => {
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ reason: 'llm_unconfigured' }),
      });
    });

    await openEdgeRingDemo(page);

    const card = page.getByTestId('autopsy-report-card');
    await expect(card).toHaveAttribute('data-narration-status', 'fallback', {
      timeout: 5_000,
    });
    await expect(card).toHaveAttribute(
      'data-narration-source',
      'deterministic-template',
    );
    await expect(page.getByTestId('finding-row-headline').first()).toHaveText(
      'Failures concentrate in the outer 3 rings',
    );
    await expect(page.locator('[data-sonner-toast]')).toHaveCount(0);

    // Subcase 3b: > 4 s slow route times out cleanly via client AbortController
    await page.unroute('**/api/autopsy/narrate');
    await page.route('**/api/autopsy/narrate', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 5_500));
      try {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ claims: [] }),
        });
      } catch {
        // Request already aborted by client 4 s timeout
      }
    });

    await page.getByTestId('lot-picker-trigger').click();
    await page.getByRole('menuitemradio', { name: /Site 2 Probe Contact/i }).click();
    await expect(page.getByTestId('verdict-headline')).toContainText(
      'test site 2 contact failure.',
      { timeout: 3_000 },
    );
    // Deterministic template is already rendered immediately while narration is loading
    await expect(card).toHaveAttribute(
      'data-narration-source',
      'deterministic-template',
    );
    await expect(card).toHaveAttribute('data-narration-status', 'loading');

    // After 4 s timeout, status resolves to fallback with template preserved and zero toasts
    await expect(card).toHaveAttribute('data-narration-status', 'fallback', {
      timeout: 6_000,
    });
    await expect(card).toHaveAttribute(
      'data-narration-source',
      'deterministic-template',
    );
    await expect(page.locator('[data-sonner-toast]')).toHaveCount(0);
  });
});
