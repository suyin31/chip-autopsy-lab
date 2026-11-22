import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

const PORT = Number(process.env.PORT ?? 3137);
const BASE = `http://127.0.0.1:${PORT}`;
const OUT = process.env.OUT ?? '/workspace/work/atelier-preview';
mkdirSync(OUT, { recursive: true });

const only = process.env.ONLY ?? 'all';

async function waitForServer(url, ms = 90000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    try {
      const res = await fetch(url, { redirect: 'manual' });
      if (res.status < 500) return;
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`server did not start: ${url}`);
}

const server = spawn(
  'npx',
  ['next', 'start', '-p', String(PORT)],
  {
    cwd: '/workspace/work/chip-autopsy-lab',
    env: {
      ...process.env,
      PATH: `/workspace/toolchain/node-v22.20.0-linux-x64/bin:${process.env.PATH}`,
      NODE_OPTIONS: '--require /workspace/work/localhost-shim.cjs',
      NODE_ENV: 'production',
      NEXT_DIST_DIR: process.env.NEXT_DIST_DIR ?? '.next-preview',
      PORT: String(PORT),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  },
);
server.stdout.on('data', (d) => process.stdout.write(`[next] ${d}`));
server.stderr.on('data', (d) => process.stderr.write(`[next] ${d}`));

const errors = [];

try {
  await waitForServer(BASE);
  const browser = await chromium.launch({
    args: ['--force-color-profile=srgb', '--font-render-hinting=none'],
  });
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
    colorScheme: 'light',
  });
  const page = await ctx.newPage();
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(`console: ${msg.text()}`);
  });
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));

  const shoot = async (name) => {
    await page.waitForTimeout(900);
    await page.screenshot({ path: path.join(OUT, `${name}.png`) });
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    console.log(`shot ${name} (hOverflow=${overflow})`);
  };

  // Landing, light
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  await shoot('home-light');

  // Loaded demo lot
  await page.getByTestId('landing-open-sample-button').click();
  await page.waitForTimeout(2200);
  await shoot('home-loaded-light');

  // Dark
  await page.evaluate(() => {
    localStorage.setItem('cal.theme', 'dark');
    document.documentElement.dataset.theme = 'dark';
  });
  await page.reload({ waitUntil: 'networkidle' });
  await page.getByTestId('landing-open-sample-button').click();
  await page.waitForTimeout(2200);
  await shoot('home-loaded-dark');

  // Agents
  await page.goto(`${BASE}/agents`, { waitUntil: 'networkidle' });
  await shoot('agents-empty-dark');

  await page.evaluate(() => {
    localStorage.setItem('cal.theme', 'light');
    document.documentElement.dataset.theme = 'light';
  });
  await page.reload({ waitUntil: 'networkidle' });
  await shoot('agents-empty-light');

  // Mobile
  const mobile = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  const mpage = await mobile.newPage();
  mpage.on('pageerror', (err) => errors.push(`mobile pageerror: ${err.message}`));
  await mpage.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  await mpage.waitForTimeout(900);
  await mpage.screenshot({ path: path.join(OUT, 'mobile-390.png') });
  const mOverflow = await mpage.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  console.log(`shot mobile-390 (hOverflow=${mOverflow})`);
  await mobile.close();

  await browser.close();
  console.log(errors.length ? `ERRORS:\n${errors.join('\n')}` : 'no console/page errors');
} finally {
  server.kill('SIGTERM');
}
