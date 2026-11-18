import { test } from '@playwright/test';
import fs from 'node:fs';
test('tmp profile', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('demo-card-edge-ring-etch').click();
  const stage = page.getByTestId('wafer-stage');
  await stage.waitFor();
  await page.waitForSelector('[data-sweep="done"]');
  await page.waitForTimeout(800);
  const opt = page.getByTestId('wafer-strip').locator('[role="option"]').first();
  await opt.focus();
  for (let i = 0; i < 10; i++) { await page.keyboard.press('ArrowRight'); await page.waitForTimeout(80); }
  await page.evaluate(() => { const w = window as any; w.__m = []; new MutationObserver((l) => { for (const r of l) { const t = r.target as Element; const el = t.nodeType === 1 ? t : t.parentElement!; const tid = el.closest('[data-testid]')?.getAttribute('data-testid'); w.__m.push(r.type + ' ' + (r.attributeName ?? '') + ' ' + el.tagName + ' ' + tid); } }).observe(document.body, { subtree: true, attributes: true, childList: true, characterData: true }); });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Profiler.enable');
  await cdp.send('Profiler.setSamplingInterval', { interval: 100 });
  await cdp.send('Profiler.start');
  const f = page.getByTestId('autopsy-body-claim-button').first();
  await f.click();
  await page.waitForTimeout(300);
  const { profile } = await cdp.send('Profiler.stop');
  const m: string[] = await page.evaluate(() => (window as any).__m);
  const c = new Map<string, number>(); for (const k of m) c.set(k, (c.get(k) ?? 0) + 1);
  console.log([...c].sort((a, b) => b[1] - a[1]).slice(0, 30).map(([k, v]) => v + ' ' + k).join('\n'));
  fs.writeFileSync('/tmp/prof/p.json', JSON.stringify(profile));
});
