import * as path from 'node:path';
import { expect, test } from '@playwright/test';

const SCREENSHOT_DIR = path.join(__dirname, '__screenshots__');

test.describe('R4 Landing, drag overlay, parse error, and bins-only acceptance', () => {
  test('matches §3.1 above-the-fold layout at 1440x900 and 390x844 and captures screenshots', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');

    const headline = page.getByTestId('landing-headline');
    await expect(headline).toHaveText('Drop the body.');
    const headlineBox = await headline.boundingBox();
    expect(headlineBox).not.toBeNull();
    // §3.1: Headline top at y = 148 (52 nav + 96 padding)
    expect(headlineBox!.y).toBeGreaterThanOrEqual(144);
    expect(headlineBox!.y).toBeLessThanOrEqual(154);

    // All three 300px demo cards fit completely above the 900px fold
    for (const id of [
      'edge-ring-etch',
      'handling-scratch',
      'site2-probe-contact',
    ] as const) {
      const card = page.getByTestId(`demo-card-${id}`);
      await expect(card).toBeVisible();
      const box = await card.boundingBox();
      expect(box).not.toBeNull();
      expect(Math.round(box!.height)).toBe(300);
      expect(box!.y + box!.height).toBeLessThanOrEqual(900);
    }

    const downloadTrigger = page.getByTestId('landing-download-demos-trigger');
    await expect(downloadTrigger).toBeVisible();
    const footerBox = await downloadTrigger.boundingBox();
    expect(footerBox!.y + footerBox!.height).toBeLessThanOrEqual(900);

    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, 'landing-desktop.png'),
    });

    // Mobile 390x844: headline at y=96, 358x50 button, card 1 + peek of card 2 above 844px fold
    await page.setViewportSize({ width: 390, height: 844 });
    const mobileHeadlineBox = await headline.boundingBox();
    expect(mobileHeadlineBox).not.toBeNull();
    expect(mobileHeadlineBox!.y).toBeGreaterThanOrEqual(92);
    expect(mobileHeadlineBox!.y).toBeLessThanOrEqual(100);

    const openBtnBox = await page
      .getByTestId('landing-open-stdf-button')
      .boundingBox();
    expect(openBtnBox).not.toBeNull();
    expect(Math.round(openBtnBox!.width)).toBe(358);
    expect(Math.round(openBtnBox!.height)).toBe(50);

    const card1Box = await page
      .getByTestId('demo-card-edge-ring-etch')
      .boundingBox();
    const card2Box = await page
      .getByTestId('demo-card-handling-scratch')
      .boundingBox();
    expect(card1Box).not.toBeNull();
    expect(card2Box).not.toBeNull();
    expect(Math.round(card1Box!.width)).toBe(300);
    expect(Math.round(card1Box!.height)).toBe(280);
    expect(card1Box!.y + card1Box!.height).toBeLessThanOrEqual(844);
    // Card 2 starts inside the 390px viewport (peeking ~46px before 16px right margin)
    expect(card2Box!.x).toBeLessThan(390);
    expect(390 - 16 - card2Box!.x).toBeGreaterThanOrEqual(44);
    expect(390 - 16 - card2Box!.x).toBeLessThanOrEqual(48);

    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, 'landing-mobile.png'),
    });
  });

  test('one click on a demo card loads the lot; PNG drop shows not-stdf with hex; stubbed 312 MB opens BinsOnlySheet with Use bins-only focused', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    await expect(page.getByTestId('full-window-drop-zone')).toHaveAttribute(
      'data-dropzone-ready',
      'true',
    );

    // 1a. Drag overlay for file drag (§3.2): "Drop the body." + "Release to open. STDF, STD, or gzip."
    await page.evaluate(() => {
      const enterEvt = new Event('dragenter', { bubbles: true, cancelable: true });
      Object.defineProperty(enterEvt, 'dataTransfer', {
        value: { types: ['Files'] },
      });
      window.dispatchEvent(enterEvt);
    });
    const dropOverlay = page.getByTestId('full-window-drop-overlay');
    await expect(dropOverlay).toBeVisible();
    await expect(dropOverlay).toContainText('Drop the body.');
    await expect(dropOverlay).toContainText(
      'Release to open. STDF, STD, or gzip.',
    );

    // 1b. Drag overlay for non-file drag (§3.2): "Only files can be opened here."
    await page.evaluate(() => {
      const overEvt = new Event('dragover', { bubbles: true, cancelable: true });
      Object.defineProperty(overEvt, 'dataTransfer', {
        value: { types: ['text/plain'] },
      });
      window.dispatchEvent(overEvt);
    });
    await expect(dropOverlay).toContainText('Only files can be opened here.');

    await page.evaluate(() => {
      window.dispatchEvent(new Event('dragend'));
    });
    await expect(dropOverlay).toBeHidden();

    // 2. Dropping a PNG shows "This file isn't an STDF log." with hex prefix 89 50 4E 47 (§3.7)
    await page.evaluate(() => {
      const pngBytes = new Uint8Array([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
        0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
      ]);
      const pngFile = new File([pngBytes], 'wafer-photo.png', {
        type: 'image/png',
      });
      const dropEvt = new Event('drop', { bubbles: true, cancelable: true });
      Object.defineProperty(dropEvt, 'dataTransfer', {
        value: { types: ['Files'], files: [pngFile] },
      });
      window.dispatchEvent(dropEvt);
    });

    await expect(page.getByTestId('parse-error-title')).toHaveText(
      "This file isn't an STDF log.",
    );
    await expect(page.getByTestId('parse-error-body')).toContainText(
      '89 50 4E 47',
    );

    // Show details sheet displays full 16-byte hex
    await page.getByTestId('parse-error-show-details').click();
    await expect(page.getByTestId('error-details-hex')).toHaveText(
      '89 50 4E 47 0D 0A 1A 0A 00 00 00 0D 49 48 44 52',
    );
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('error-details-sheet')).toBeHidden();

    // 3. Stubbed 312 MB file opens BinsOnlySheet with "Use bins-only" focused (§3.8)
    await page.evaluate(() => {
      const stubHeader = new Uint8Array([0x02, 0x00, 0x00, 0x0a, 0x02, 0x04]);
      const hugeFile = new File([stubHeader], 'lot-312mb.stdf', {
        type: 'application/octet-stream',
      });
      Object.defineProperty(hugeFile, 'size', {
        value: 312 * 1024 * 1024,
        configurable: true,
      });
      const dropEvt = new Event('drop', { bubbles: true, cancelable: true });
      Object.defineProperty(dropEvt, 'dataTransfer', {
        value: { types: ['Files'], files: [hugeFile] },
      });
      window.dispatchEvent(dropEvt);
    });

    const sheet = page.getByTestId('bins-only-sheet');
    await expect(sheet).toBeVisible();
    await expect(sheet).toContainText('This file is 312 MB.');
    const useBinsOnlyBtn = page.getByRole('button', { name: 'Use bins-only' });
    await expect(useBinsOnlyBtn).toBeFocused();

    await page.keyboard.press('Escape');
    await expect(sheet).toBeHidden();

    // 4. One click on a demo card loads the lot directly from parse-error / landing
    await page.getByTestId('demo-card-edge-ring-etch').click();
    await expect(page.getByTestId('autopsy-headline-button')).toBeVisible({
      timeout: 3_000,
    });
  });
});
