import { expect, test } from '@playwright/test';
for (const rm of ['reduce'] as const) test('probe cam ' + rm, async ({ page }) => {
  await page.emulateMedia({ reducedMotion: rm });
  await page.addInitScript(() => window.sessionStorage.setItem('cal.sweep.v1', '1'));
  await page.goto('/?nohints=1');
  await page.getByTestId('demo-card-edge-ring-etch').click();
  await expect(page.getByTestId('wafer-stage')).toHaveAttribute('data-sweep', 'done');
  await page.waitForTimeout(500);
  const stage = page.getByTestId('wafer-stage');
  await stage.focus(); await page.keyboard.press('+'); await page.keyboard.press('+');
  const box = (await stage.boundingBox())!; const px = box.x + box.width / 2, py = box.y + box.height / 2;
  const cam = () => page.getByTestId('wafer-camera-wrapper').evaluate((el) => (el as HTMLElement).style.transform);
  console.log('START', px, py, await cam());
  await page.mouse.move(px, py); await page.mouse.down();
  for (let i = 1; i <= 12; i += 1) { await page.mouse.move(px + i * 20, py); }
  console.log('PRE', await cam());
  await page.evaluate(() => { const w = window as any; w.__c = []; const el = document.querySelector<HTMLElement>('[data-testid="wafer-camera-wrapper"]')!; const tick = () => { w.__c.push(el.style.transform); if (w.__c.length < 60) requestAnimationFrame(tick); }; requestAnimationFrame(tick); for (const ev of ['pointerup','click','lostpointercapture','pointercancel']) window.addEventListener(ev, (e) => w.__c.push(ev + ':' + (e.target as HTMLElement)?.dataset?.testid), true); });
  await page.evaluate(() => { const w = window as any; w.__st = []; const el = document.querySelector<HTMLElement>('[data-testid="wafer-camera-wrapper"]')!; w.__oldEl = el; }); 
  await page.mouse.up();
  await page.waitForTimeout(1000);
  console.log('STACK', JSON.stringify(await page.evaluate(() => { const w = window as any; return [w.__st.length, w.__oldEl.isConnected, w.__oldEl.style.transform, document.querySelector<HTMLElement>('[data-testid="wafer-camera-wrapper"]')!.style.transform, location.href, document.querySelector('[data-testid="stage-zoom-value"]')?.textContent]; })));
  console.log('SEQ', rm, JSON.stringify((await page.evaluate(() => (window as any).__c)).filter((v: string, i: number, a: string[]) => i === 0 || v !== a[i - 1])));
  
});
