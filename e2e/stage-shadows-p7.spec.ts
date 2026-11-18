import { expect, type Page, test } from '@playwright/test';

/**
 * Premium P7 acceptance A8 (premium §5.1, §5.2 step 6, §3.3): light theme shows the ambient
 * and contact shadows under the disc with no box, border, or fill around the stage; dark
 * theme shows only the halo. All layers ride inside the camera wrapper. The sheen sits at
 * rest, masked to the notch-cut disc, and is hidden under reduced transparency.
 */

async function openDemo(page: Page, theme: 'light' | 'dark') {
  await page.addInitScript((t) => {
    window.sessionStorage.setItem('cal.sweep.v1', '1');
    window.localStorage.setItem('cal.theme', t);
  }, theme);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await page.getByTestId('demo-card-edge-ring-etch').click();
  const stage = page.getByTestId('wafer-stage');
  await expect(stage).toHaveAttribute('data-sweep', 'done', { timeout: 5_000 });
}

function readStageLayers(page: Page) {
  return page.evaluate(() => {
    const q = (id: string) =>
      document.querySelector<HTMLElement>(`[data-testid="${id}"]`);
    const stage = q('wafer-stage')!;
    const wrapper = q('wafer-camera-wrapper')!;
    const layer = (id: string) => {
      const el = q(id)!;
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return {
        display: cs.display,
        insideWrapper: wrapper.contains(el),
        backgroundImage: cs.backgroundImage,
        cx: r.left + r.width / 2,
        cy: r.top + r.height / 2,
        width: r.width,
        height: r.height,
      };
    };
    const ss = getComputedStyle(stage);
    const sheenEl = q('wafer-stage-sheen')!;
    const sheenStyle = getComputedStyle(sheenEl);
    return {
      stage: {
        background: ss.backgroundColor,
        backgroundImage: ss.backgroundImage,
        borders: [
          ss.borderTopWidth,
          ss.borderRightWidth,
          ss.borderBottomWidth,
          ss.borderLeftWidth,
        ],
        boxShadow: ss.boxShadow,
      },
      vignette: q('wafer-stage-vignette') !== null,
      ambient: layer('wafer-stage-ambient-shadow'),
      contact: layer('wafer-stage-contact-shadow'),
      halo: layer('wafer-stage-halo'),
      sheen: {
        ...layer('wafer-stage-sheen'),
        mask: sheenStyle.maskImage || sheenStyle.getPropertyValue('-webkit-mask-image'),
        ellipseBlend: getComputedStyle(q('wafer-stage-sheen-ellipse')!).mixBlendMode,
        ellipseTransform: getComputedStyle(q('wafer-stage-sheen-ellipse')!).transform,
      },
    };
  });
}

test('A8 light: contact and ambient shadows under the disc, no box around the stage', async ({
  page,
}) => {
  await openDemo(page, 'light');
  const m = await readStageLayers(page);

  expect(m.stage.background).toBe('rgba(0, 0, 0, 0)');
  expect(m.stage.backgroundImage).toBe('none');
  expect(m.stage.borders).toEqual(['0px', '0px', '0px', '0px']);
  expect(m.stage.boxShadow).toBe('none');
  expect(m.vignette).toBe(false);

  expect(m.ambient.display).toBe('block');
  expect(m.contact.display).toBe('block');
  expect(m.halo.display).toBe('none');
  expect(m.ambient.insideWrapper && m.contact.insideWrapper && m.halo.insideWrapper).toBe(true);
  expect(m.contact.backgroundImage).toContain('radial-gradient');

  // Disc box = sheen box. Contact: 0.86 D x 0.10 D, 0.035 D below the disc's lowest point.
  const d = m.sheen.width;
  expect(d).toBeGreaterThan(500);
  expect(m.contact.width / d).toBeCloseTo(0.86, 2);
  expect(m.contact.height / d).toBeCloseTo(0.1, 2);
  expect(m.contact.cx).toBeCloseTo(m.sheen.cx, 0);
  expect((m.contact.cy - (m.sheen.cy + d / 2)) / d).toBeCloseTo(0.035, 2);
  // Ambient: 1.16 D circle, 0.04 D down
  expect(m.ambient.width / d).toBeCloseTo(1.16, 2);
  expect((m.ambient.cy - m.sheen.cy) / d).toBeCloseTo(0.04, 2);

  // Sheen at rest: notch-cut SVG mask, screen-blended ellipse rotated -24deg
  expect(m.sheen.insideWrapper).toBe(true);
  expect(m.sheen.display).toBe('block');
  expect(m.sheen.mask).toContain('data:image/svg+xml');
  expect(m.sheen.ellipseBlend).toBe('screen');
  // rotate(-24deg) -> matrix(cos, sin, ...) with sin(-24deg) ~ -0.4067
  expect(m.sheen.ellipseTransform).toMatch(/^matrix\(0\.913\d*, -0\.406\d*/);
});

test('A8 dark: only the halo separates the disc from black', async ({ page }) => {
  await openDemo(page, 'dark');
  const m = await readStageLayers(page);

  expect(m.stage.background).toBe('rgba(0, 0, 0, 0)');
  expect(m.halo.display).toBe('block');
  expect(m.ambient.display).toBe('none');
  expect(m.contact.display).toBe('none');
  expect(m.halo.backgroundImage).toContain('radial-gradient');
  expect(m.halo.width / m.sheen.width).toBeCloseTo(1.5, 2);
  expect(m.halo.cx).toBeCloseTo(m.sheen.cx, 0);
  expect(m.halo.cy).toBeCloseTo(m.sheen.cy, 0);
});

test('A8 shadows pan with the disc, and the sheen hides under reduced transparency', async ({
  page,
}) => {
  await openDemo(page, 'light');
  const before = await readStageLayers(page);

  const stage = page.getByTestId('wafer-stage');
  await stage.focus();
  await page.keyboard.press('+');
  await expect
    .poll(async () => (await readStageLayers(page)).sheen.width, { timeout: 3_000 })
    .toBeGreaterThan(before.sheen.width * 1.2);
  const zoomed = await readStageLayers(page);
  expect(zoomed.contact.width / zoomed.sheen.width).toBeCloseTo(0.86, 2);
  expect(
    (zoomed.contact.cy - (zoomed.sheen.cy + zoomed.sheen.width / 2)) / zoomed.sheen.width,
  ).toBeCloseTo(0.035, 2);

  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-transparency', value: 'reduce' }],
  });
  await expect
    .poll(async () => (await readStageLayers(page)).sheen.display)
    .toBe('none');
});
