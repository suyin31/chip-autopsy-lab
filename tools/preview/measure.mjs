import { chromium } from '@playwright/test';

const BASE = 'http://127.0.0.1:3137';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForTimeout(800);

const ids = [
  'nav-bar',
  'landing-headline',
  'landing-subline',
  'landing-hero',
  'landing-hero-frame',
  'landing-example-card',
  'landing-sample-heading',
  'landing-demo-cards',
];

const out = {};
for (const id of ids) {
  const el = page.getByTestId(id).first();
  if ((await el.count()) === 0) {
    out[id] = 'missing';
    continue;
  }
  out[id] = await el.evaluate((node) => {
    const r = node.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
  });
}
out.viewport = await page.evaluate(() => ({
  vw: window.innerWidth,
  vh: window.innerHeight,
  sw: document.documentElement.scrollWidth,
  sh: document.documentElement.scrollHeight,
}));
console.log(JSON.stringify(out, null, 2));
await browser.close();
