import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdirSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const PORT = Number(process.env.PORT ?? 3145);
const BASE = `http://127.0.0.1:${PORT}`;
const VIDEO_DIR = '/workspace/work/atelier-preview/video-raw';
mkdirSync(VIDEO_DIR, { recursive: true });

const server = spawn('npx', ['next', 'start', '-p', String(PORT)], {
  cwd: '/workspace/work/chip-autopsy-lab',
  env: {
    ...process.env,
    PATH: `/workspace/toolchain/node-v22.20.0-linux-x64/bin:${process.env.PATH}`,
    NODE_OPTIONS: '--require /workspace/work/localhost-shim.cjs',
    NEXT_DIST_DIR: process.env.NEXT_DIST_DIR ?? '.next-p7',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});

async function waitForServer(url, ms = 90000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    try {
      const res = await fetch(url, { redirect: 'manual' });
      if (res.status < 500) return;
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error('server did not start');
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

try {
  await waitForServer(BASE);
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    colorScheme: 'light',
    recordVideo: { dir: VIDEO_DIR, size: { width: 1440, height: 900 } },
  });
  await context.addInitScript(() => {
    localStorage.setItem('cal.theme', 'light');
    localStorage.setItem('cal.hints.v1', '["h-show","h-hover","h-strip"]');
    localStorage.setItem('cal.landing.cards.v1', 'seen');
  });
  const page = await context.newPage();
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  await sleep(1200);

  // 1. Landing: pointer drifts across the specimen so the 13-degree tilt and sheen read.
  await page.mouse.move(1020, 420);
  await sleep(300);
  await page.mouse.move(1210, 470, { steps: 24 });
  await sleep(650);
  await page.mouse.move(1120, 555, { steps: 14 });
  await sleep(450);

  // 2. Open the sample lot: the specimen becomes the working stage.
  await page.getByTestId('landing-open-sample-button').click();
  await sleep(1800);

  // 3. Hover a readout plate: the plate tilts and takes the specular highlight.
  const stat = page.getByTestId('verdict-stat-item').nth(1);
  const box = await stat.boundingBox();
  if (box) {
    await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.35, { steps: 12 });
    await sleep(700);
    await page.mouse.move(box.x + box.width * 0.72, box.y + box.height * 0.7, { steps: 10 });
    await sleep(550);
  }

  // 4. Light the failing dies from the verdict.
  await page.getByTestId('verdict-show-on-wafer').click();
  await sleep(1500);

  // 5. Switch to the observatory and open the agent console.
  await page.mouse.move(900, 600, { steps: 10 });
  await page.getByTestId('theme-toggle-trigger').click();
  await sleep(400);
  await page.getByTestId('theme-option-dark').click();
  await sleep(800);
  await page.getByTestId('nav-agent-console').click();
  await sleep(1200);

  // 6. Start the run from the first starter card.
  await page.getByRole('button', { name: /Load the edge-ring demo lot and diagnose it/i }).click();

  // 6b. The network stops and asks permission before it touches the page. Approve it.
  const allow = page.getByRole('button', { name: /Allow for this session/i });
  try {
    await allow.first().waitFor({ state: 'visible', timeout: 9000 });
    await sleep(700);
    await allow.first().click();
  } catch {
    /* the runner may not need consent for this preset */
  }

  // 7. The run continues: numbers roll, the wafer lights the cited dies, the answer streams.
  await page.waitForFunction(
    () => (document.body.innerText ?? '').includes('Diagnosed the lot'),
    { timeout: 25000 },
  );
  await sleep(1200);
  await page.mouse.move(640, 500, { steps: 8 });
  await page.mouse.wheel(0, 260);
  await sleep(1400);
  await page.mouse.wheel(0, -120);
  await sleep(1500);

  // 8. The evidence plate carries the pointer: the readout tilts under the light.
  const kpi = page.getByTestId('agent-kpi-yield');
  if ((await kpi.count()) > 0) {
    const kb = await kpi.boundingBox();
    if (kb) {
      await page.mouse.move(kb.x + kb.width * 0.35, kb.y + kb.height * 0.4, { steps: 12 });
      await sleep(800);
      await page.mouse.move(kb.x + kb.width * 0.7, kb.y + kb.height * 0.65, { steps: 10 });
      await sleep(600);
    }
  }
  await sleep(1300);

  await context.close();
  await browser.close();

  const files = readdirSync(VIDEO_DIR)
    .filter((f) => f.endsWith('.webm'))
    .map((f) => path.join(VIDEO_DIR, f))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  console.log(files[0] ?? 'no video');
} finally {
  server.kill('SIGTERM');
}
