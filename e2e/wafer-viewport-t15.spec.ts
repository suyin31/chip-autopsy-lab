import { expect, type Page, test } from '@playwright/test';
import { writeStdfBytes } from '../src/core/stdf/stdf-writer';

const EMBER_RGB = [
  'rgb(255, 107, 44)',
  'rgb(232, 89, 30)',
  'rgb(217, 78, 20)',
  'rgb(255, 138, 87)',
];

async function loadDemoLot(
  page: Page,
  options: {
    readonly reducedMotion?: 'reduce' | 'no-preference';
    readonly colorScheme?: 'light' | 'dark';
  } = {},
): Promise<void> {
  await page.emulateMedia({
    colorScheme: options.colorScheme ?? 'light',
    reducedMotion: options.reducedMotion ?? 'no-preference',
  });
  await page.addInitScript(() => {
    window.sessionStorage.setItem('cal.sweep.v1', '1');
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/?nohints=1');
  await page.getByTestId('demo-card-edge-ring-etch').click();
  await expect(page.getByTestId('wafer-stage')).toHaveAttribute(
    'data-sweep',
    'done',
    { timeout: 10_000 },
  );
}

async function readStageCamera(page: Page): Promise<{
  readonly scale: number;
  readonly tx: number;
  readonly ty: number;
}> {
  return page.getByTestId('wafer-stage').evaluate((el) => ({
    scale: Number(el.getAttribute('data-camera-scale') ?? '1'),
    tx: Number(el.getAttribute('data-camera-tx') ?? '0'),
    ty: Number(el.getAttribute('data-camera-ty') ?? '0'),
  }));
}

/** Samples the 4 cardinal perimeter points (0.008 D inside the disc rim) on `wafer-base-canvas`. */
async function sampleCardinalNotchAlphas(page: Page): Promise<{
  readonly top: number;
  readonly bottom: number;
  readonly left: number;
  readonly right: number;
}> {
  return page.evaluate(() => {
    const stage = document.querySelector<HTMLElement>(
      '[data-testid="wafer-stage"]',
    )!;
    const canvas = document.querySelector<HTMLCanvasElement>(
      '[data-testid="wafer-base-canvas"]',
    )!;
    const ctx = canvas.getContext('2d')!;
    const { width: w, height: h } = canvas;
    const data = ctx.getImageData(0, 0, w, h).data;
    const alpha = (x: number, y: number) =>
      data[(Math.round(y) * w + Math.round(x)) * 4 + 3]!;

    const rect = canvas.getBoundingClientRect();
    const k = w / rect.width;
    const diameterCss = Number(stage.dataset.waferDiameterPx);
    const d = diameterCss * k;
    const r = d / 2;
    const cx = w / 2;
    const cy = h / 2;
    // The V-notch is 0.016 D deep, so sampling 0.008 D inside the rim hits the open notch cut
    const inset = 0.008 * d;
    return {
      top: alpha(cx, cy - r + inset),
      bottom: alpha(cx, cy + r - inset),
      left: alpha(cx - r + inset, cy),
      right: alpha(cx + r - inset, cy),
    };
  });
}

function buildRotatedWcrStdfBytes(
  wfFlat: 'U' | 'D' | 'L' | 'R',
  posX: 'L' | 'R',
  posY: 'U' | 'D',
): number[] {
  const parts: Array<{
    headNum: number;
    siteNum: number;
    partFlg: number;
    hardBin: number;
    softBin: number;
    xCoord: number;
    yCoord: number;
    ptrs: Array<{
      testNum: number;
      result: number;
      testTxt?: string;
      units?: string;
      resScal?: number;
      llmScal?: number;
      hlmScal?: number;
      loLimit?: number | null;
      hiLimit?: number | null;
    }>;
  }> = [];

  for (let y = -6; y <= 6; y += 1) {
    for (let x = -6; x <= 6; x += 1) {
      if (Math.hypot(x, y) > 6.2) continue;
      const isFail = Math.hypot(x, y) >= 5.2;
      const first = parts.length === 0;
      parts.push({
        headNum: 1,
        siteNum: 1,
        partFlg: isFail ? 0x08 : 0x00,
        hardBin: isFail ? 4 : 1,
        softBin: isFail ? 7 : 1,
        xCoord: x,
        yCoord: y,
        ptrs: [
          {
            testNum: 204,
            result: isFail ? 0.000024 : 0.0000035,
            ...(first
              ? {
                  testTxt: 'IDDQ_LEAK',
                  units: 'A',
                  resScal: 6,
                  llmScal: 6,
                  hlmScal: 6,
                  loLimit: null,
                  hiLimit: 0.000015,
                }
              : {}),
          },
        ],
      });
    }
  }

  const bytes = writeStdfBytes({
    endianness: 'little',
    mir: { lotId: `WCR-${wfFlat}-${posX}${posY}`, partTyp: 'CAL-WCR', jobNam: 'SORT' },
    sdrs: [{ headNum: 1, siteGrp: 1, siteNums: [1], cardId: 'PC1' }],
    hbrs: [
      { hbinNum: 1, hbinCnt: parts.length, hbinPf: 'P', hbinNam: 'PASS' },
      { hbinNum: 4, hbinCnt: 20, hbinPf: 'F', hbinNam: 'LEAK' },
    ],
    sbrs: [
      { sbinNum: 1, sbinCnt: parts.length, sbinPf: 'P', sbinNam: 'GOOD' },
      { sbinNum: 7, sbinCnt: 20, sbinPf: 'F', sbinNam: 'IDDQ_EDGE_LEAK' },
    ],
    wcr: {
      wafrSiz: 200,
      dieHt: 2,
      dieWid: 2,
      wfUnits: 3,
      wfFlat,
      centerX: 0,
      centerY: 0,
      posX,
      posY,
    },
    wafers: [
      {
        wir: { headNum: 1, siteGrp: 1, startT: 1_730_000_100, waferId: 'W01' },
        touchdowns: [parts],
        wrr: {
          headNum: 1,
          siteGrp: 1,
          finishT: 1_730_000_200,
          partCnt: parts.length,
          waferId: 'W01',
        },
      },
    ],
    mrr: { finishT: 1_730_000_250, dispCod: '0' },
  });
  return Array.from(bytes);
}

test.describe('Task 15 — wafer map hover readout, pan/zoom, and WCR orientation', () => {
  test('hover readout displays X/Y, bin, and test values, never covers the hovered die, and uses no stray ember', async ({
    page,
  }) => {
    await loadDemoLot(page, { colorScheme: 'light', reducedMotion: 'reduce' });

    const stage = page.getByTestId('wafer-stage');
    const magnifier = page.getByTestId('wafer-hover-magnifier');
    const readout = page.getByTestId('magnifier-readout');
    const stageBox = (await stage.boundingBox())!;

    // Probe dies across 4 regions (center, upper-right, lower-left, upper-left)
    const probeOffsets = [
      { fx: 0.5, fy: 0.5 },
      { fx: 0.68, fy: 0.28 },
      { fx: 0.32, fy: 0.72 },
      { fx: 0.32, fy: 0.28 },
    ] as const;

    let observedPoints = 0;
    for (const pt of probeOffsets) {
      const clientX = stageBox.x + stageBox.width * pt.fx;
      const clientY = stageBox.y + stageBox.height * pt.fy;
      await page.mouse.move(clientX - 2, clientY);
      await page.mouse.move(clientX, clientY);

      await expect(magnifier).toHaveAttribute('data-visible', 'true');
      observedPoints += 1;

      const text = (await readout.textContent()) ?? '';
      // Shows X/Y coordinates (true minus sign supported), bin code, and formatted parametric test value
      expect(text).toMatch(/X [\u2212-]?\d+,\s*Y [\u2212-]?\d+/);
      expect(text).toMatch(/(?:SBIN|HBIN) \d+/);
      expect(text).toMatch(/\d+(?:\.\d+)?\s*(?:[numkMG]?[AVHzs]|Ohm|%)/);

      // Magnifier bounding box NEVER covers the hovered pointer/die coordinate
      const magBox = (await magnifier.boundingBox())!;
      const coversHoveredPoint =
        clientX >= magBox.x &&
        clientX <= magBox.x + magBox.width &&
        clientY >= magBox.y &&
        clientY <= magBox.y + magBox.height;
      expect(coversHoveredPoint).toBe(false);
    }
    expect(observedPoints).toBe(4);

    // Switch to Parametric mode and confirm readout shows the formatted measurement without covering the die
    await page
      .getByTestId('stage-mode-segmented')
      .getByRole('radio', { name: 'Parametric' })
      .click();
    await expect(page.getByTestId('parametric-magma-legend')).toBeVisible();
    const paramStageBox = (await stage.boundingBox())!;
    const cx = paramStageBox.x + paramStageBox.width * 0.5;
    const cy = paramStageBox.y + paramStageBox.height * 0.5;
    await page.mouse.move(cx - 2, cy);
    await page.mouse.move(cx + 2, cy + 2);
    await expect(magnifier).toHaveAttribute('data-visible', 'true');
    const paramReadout = (await readout.textContent()) ?? '';
    expect(paramReadout).toMatch(/X [\u2212-]?\d+,\s*Y [\u2212-]?\d+/);
    expect(paramReadout).toMatch(/\d+(?:\.\d+)?\s*(?:[numkMG]?[AVHzs]|Ohm|%)/);
    const paramMagBox = (await magnifier.boundingBox())!;
    expect(
      cx + 2 >= paramMagBox.x &&
        cx + 2 <= paramMagBox.x + paramMagBox.width &&
        cy + 2 >= paramMagBox.y &&
        cy + 2 <= paramMagBox.y + paramMagBox.height,
    ).toBe(false);

    // No stray ember/orange on zoom controls or readout text
    const controlColors = await page.evaluate(() => {
      const ids = ['stage-zoom-in', 'stage-zoom-out', 'stage-select-area'];
      return ids.map((id) => {
        const el = document.querySelector<HTMLElement>(`[data-testid="${id}"]`)!;
        const cs = getComputedStyle(el);
        return { bg: cs.backgroundColor, color: cs.color };
      });
    });
    for (const c of controlColors) {
      expect(EMBER_RGB).not.toContain(c.bg);
      expect(EMBER_RGB).not.toContain(c.color);
    }
  });

  test('supports button zoom in/out, wheel zoom, drag pan, reset view, and instant reduced-motion transitions', async ({
    page,
  }) => {
    await loadDemoLot(page, { colorScheme: 'light', reducedMotion: 'no-preference' });

    const stage = page.getByTestId('wafer-stage');
    const zoomIn = page.getByTestId('stage-zoom-in');
    const zoomOut = page.getByTestId('stage-zoom-out');
    const resetWrap = page.getByTestId('stage-reset-view');
    const resetBtn = page.getByTestId('stage-reset-view-button');
    const zoomLabel = page.getByTestId('stage-zoom-value');

    // Initial fit state: zoom-out disabled, zoom-in enabled, reset hidden
    await expect(zoomIn).toBeEnabled();
    await expect(zoomOut).toBeDisabled();
    await expect(resetWrap).toBeHidden();
    expect((await readStageCamera(page)).scale).toBeCloseTo(1, 3);

    // 1. Button zoom in (two clicks -> ~2.25x)
    await zoomIn.click();
    await zoomIn.click();
    await expect(resetBtn).toBeVisible();
    await expect(zoomOut).toBeEnabled();
    await expect
      .poll(async () => (await readStageCamera(page)).scale, { timeout: 2_000 })
      .toBeCloseTo(2.25, 2);
    await expect(zoomLabel).toHaveText('225%');

    // 2. Button zoom out (one click -> ~1.5x)
    await zoomOut.click();
    await expect
      .poll(async () => (await readStageCamera(page)).scale, { timeout: 2_000 })
      .toBeCloseTo(1.5, 2);
    await expect(zoomLabel).toHaveText('150%');

    // 3. Wheel zoom anchored at pointer
    const stageBox = (await stage.boundingBox())!;
    const wheelX = stageBox.x + stageBox.width * 0.6;
    const wheelY = stageBox.y + stageBox.height * 0.45;
    await page.mouse.move(wheelX, wheelY);
    const scaleBeforeWheel = (await readStageCamera(page)).scale;
    await page.mouse.wheel(0, -240);
    await expect
      .poll(async () => (await readStageCamera(page)).scale, { timeout: 2_000 })
      .toBeGreaterThan(scaleBeforeWheel + 0.3);

    // 4. Drag pan moves tx/ty with zero React renders of wafer-stage
    const rendersBeforeDrag = Number(await stage.getAttribute('data-render-count'));
    const camBeforeDrag = await readStageCamera(page);
    const dragStartX = stageBox.x + stageBox.width * 0.5;
    const dragStartY = stageBox.y + stageBox.height * 0.5;
    await page.mouse.move(dragStartX, dragStartY);
    await page.mouse.down();
    for (let i = 1; i <= 6; i += 1) {
      await page.mouse.move(dragStartX + i * 16, dragStartY + i * 10);
    }
    await page.mouse.up();
    const camAfterDrag = await readStageCamera(page);
    expect(camAfterDrag.tx).toBeGreaterThan(camBeforeDrag.tx + 20);
    expect(camAfterDrag.ty).toBeGreaterThan(camBeforeDrag.ty + 10);
    expect(Number(await stage.getAttribute('data-render-count'))).toBe(
      rendersBeforeDrag,
    );

    // 5. One-click Reset view returns to fit and disables zoom-out
    await resetBtn.click();
    await expect(resetWrap).toBeHidden({ timeout: 2_000 });
    await expect(zoomOut).toBeDisabled();
    await expect(page.getByTestId('wafer-camera-wrapper')).toHaveCSS(
      'will-change',
      'auto',
    );
    const camAfterReset = await readStageCamera(page);
    expect(camAfterReset.scale).toBeCloseTo(1, 3);
    expect(camAfterReset.tx).toBeCloseTo(0, 1);
    expect(camAfterReset.ty).toBeCloseTo(0, 1);

    // 6. Reduced motion: button zoom, drag release, and reset jump instantly (no inertia/spring)
    await loadDemoLot(page, { colorScheme: 'dark', reducedMotion: 'reduce' });
    await page.getByTestId('stage-zoom-in').click();
    const reducedZoomed = await readStageCamera(page);
    expect(reducedZoomed.scale).toBeCloseTo(1.5, 4);

    const box2 = (await page.getByTestId('wafer-stage').boundingBox())!;
    const pX = box2.x + box2.width * 0.5;
    const pY = box2.y + box2.height * 0.5;
    await page.mouse.move(pX, pY);
    await page.mouse.down();
    for (let i = 1; i <= 5; i += 1) {
      await page.mouse.move(pX + i * 20, pY);
    }
    await page.mouse.up();
    const atRelease = await readStageCamera(page);
    await page.waitForTimeout(100);
    // No inertia coast after release under prefers-reduced-motion: reduce
    expect(await readStageCamera(page)).toEqual(atRelease);

    await page.getByTestId('stage-reset-view-button').click();
    const reducedReset = await readStageCamera(page);
    expect(reducedReset.scale).toBeCloseTo(1, 4);
    await expect(page.getByTestId('stage-reset-view')).toBeHidden();
  });

  test('draws the wafer flat/notch and orients X/Y axes according to WCR (WF_FLAT, POS_X, POS_Y)', async ({
    page,
  }) => {
    // 1. Built-in demo lot carries WCR.WF_FLAT = 'D', POS_X = 'R', POS_Y = 'U' -> notch at 6 o'clock (bottom)
    await loadDemoLot(page, { colorScheme: 'light', reducedMotion: 'reduce' });
    const stage = page.getByTestId('wafer-stage');
    await expect(stage).toHaveAttribute('data-wcr-flat', 'D');
    await expect(stage).toHaveAttribute('data-wcr-pos-x', 'R');
    await expect(stage).toHaveAttribute('data-wcr-pos-y', 'U');

    const defaultNotch = await sampleCardinalNotchAlphas(page);
    expect(defaultNotch.bottom).toBe(0);
    expect(defaultNotch.top).toBe(255);
    expect(defaultNotch.left).toBe(255);
    expect(defaultNotch.right).toBe(255);

    // 2. Drop a custom STDF V4 file with WCR.WF_FLAT = 'U', POS_X = 'L', POS_Y = 'D' -> notch moves to 12 o'clock (top)
    await expect(page.getByTestId('full-window-drop-zone')).toHaveAttribute(
      'data-dropzone-ready',
      'true',
    );
    const bytesU = buildRotatedWcrStdfBytes('U', 'L', 'D');
    await page.evaluate((raw) => {
      const file = new File([new Uint8Array(raw)], 'wcr-up-ld.stdf', {
        type: 'application/octet-stream',
      });
      const evt = new Event('drop', { bubbles: true, cancelable: true });
      Object.defineProperty(evt, 'dataTransfer', {
        value: { types: ['Files'], files: [file] },
      });
      window.dispatchEvent(evt);
    }, bytesU);

    await expect(stage).toHaveAttribute('data-wcr-flat', 'U', { timeout: 10_000 });
    await expect(stage).toHaveAttribute('data-wcr-pos-x', 'L');
    await expect(stage).toHaveAttribute('data-wcr-pos-y', 'D');
    await expect(stage).toHaveAttribute('data-sweep', 'done', { timeout: 5_000 });

    // Confirm on the rendered base canvas that the V-notch cut is at 12 o'clock (top) and bottom/left/right rims are solid
    await expect
      .poll(async () => (await sampleCardinalNotchAlphas(page)).top, {
        timeout: 3_000,
      })
      .toBe(0);
    const upNotch = await sampleCardinalNotchAlphas(page);
    expect(upNotch.top).toBe(0);
    expect(upNotch.bottom).toBe(255);
    expect(upNotch.left).toBe(255);
    expect(upNotch.right).toBe(255);

    // Confirm POS_X = 'L' (positive X points left) and POS_Y = 'D' (positive Y points down) via live hover readout
    const stageBox = (await stage.boundingBox())!;
    const magnifier = page.getByTestId('wafer-hover-magnifier');
    const hoverCoord = async (fx: number, fy: number) => {
      await page.mouse.move(
        stageBox.x + stageBox.width * fx,
        stageBox.y + stageBox.height * fy,
      );
      await expect(magnifier).toHaveAttribute('data-visible', 'true');
      return {
        x: Number(await magnifier.getAttribute('data-die-x')),
        y: Number(await magnifier.getAttribute('data-die-y')),
      };
    };

    const leftDie = await hoverCoord(0.35, 0.5);
    const rightDie = await hoverCoord(0.65, 0.5);
    expect(leftDie.x).toBeGreaterThan(rightDie.x);

    const topDie = await hoverCoord(0.5, 0.35);
    const bottomDie = await hoverCoord(0.5, 0.65);
    expect(bottomDie.y).toBeGreaterThan(topDie.y);
  });
});
