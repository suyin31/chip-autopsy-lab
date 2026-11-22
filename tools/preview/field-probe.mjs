import { spawn } from 'node:child_process';

const PORT = 3143;
const server = spawn('npx', ['next', 'start', '-p', String(PORT)], {
  cwd: '/workspace/work/chip-autopsy-lab',
  env: {
    ...process.env,
    PATH: `/workspace/toolchain/node-v22.20.0-linux-x64/bin:${process.env.PATH}`,
    NODE_OPTIONS: '--require /workspace/work/localhost-shim.cjs',
    NEXT_DIST_DIR: process.env.NEXT_DIST_DIR ?? '.next-p2',
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
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle' });
  await page.evaluate(() => localStorage.setItem('cal.theme', 'dark'));
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  const info = await page.evaluate(() => {
    const canvases = [...document.querySelectorAll('canvas')].slice(0, 2);
    return canvases.map((c) => {
      const ctx = c.getContext('2d');
      const d = ctx.getImageData(Math.floor(c.width / 2), Math.floor(c.height / 3), 1, 1).data;
      return { w: c.width, h: c.height, px: [...d], cls: c.className, style: c.getAttribute('style') };
    });
  });
  console.log(JSON.stringify(info, null, 2));
  await page.addStyleTag({ content: 'main, header { visibility: hidden !important; }' });
  await page.waitForTimeout(300);
  await page.screenshot({ path: '/workspace/work/atelier-preview/_field-dark.png' });
  await browser.close();
} finally {
  server.kill('SIGTERM');
}
