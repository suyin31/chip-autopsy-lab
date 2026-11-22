import { spawn } from 'node:child_process';

const PORT = 3139;
const server = spawn('npx', ['next', 'start', '-p', String(PORT)], {
  cwd: '/workspace/work/chip-autopsy-lab',
  env: {
    ...process.env,
    PATH: `/workspace/toolchain/node-v22.20.0-linux-x64/bin:${process.env.PATH}`,
    NODE_OPTIONS: '--require /workspace/work/localhost-shim.cjs',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});

async function wait(url) {
  for (let i = 0; i < 120; i += 1) {
    try {
      const r = await fetch(url);
      if (r.status < 500) return;
    } catch {}
    await new Promise((res) => setTimeout(res, 400));
  }
  throw new Error('no server');
}

try {
  await wait(`http://127.0.0.1:${PORT}`);
  const { chromium } = await import('@playwright/test');
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(`http://127.0.0.1:${PORT}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(700);
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
      return {
        x: Math.round(r.x),
        y: Math.round(r.y),
        w: Math.round(r.width),
        h: Math.round(r.height),
      };
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
} finally {
  server.kill('SIGTERM');
}
