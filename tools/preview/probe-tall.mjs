import { spawn } from 'node:child_process';

const PORT = 3155;
const server = spawn('npx', ['next', 'start', '-p', String(PORT)], {
  cwd: '/workspace/work/chip-autopsy-lab',
  env: {
    ...process.env,
    PATH: `/workspace/toolchain/node-v22.20.0-linux-x64/bin:${process.env.PATH}`,
    NODE_OPTIONS: '--require /workspace/work/localhost-shim.cjs',
    NEXT_DIST_DIR: process.env.NEXT_DIST_DIR ?? '.next-p5',
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
  await page.getByTestId('landing-open-sample-button').click();
  await page.waitForTimeout(2800);
  const drawerInfo = await page.evaluate(() => {
    const drawer = document.querySelector('.at-drawer');
    if (!drawer) return 'missing';
    const item = drawer.firstElementChild;
    const inner = item?.firstElementChild;
    const cs = (el) => (el ? { h: Math.round(el.getBoundingClientRect().height), overflow: getComputedStyle(el).overflow, sh: el.scrollHeight } : null);
    return { drawer: cs(drawer), item: cs(item), inner: cs(inner) };
  });
  console.log('DRAWER', JSON.stringify(drawerInfo));
  const atPoint = await page.evaluate(() => {
    const out = [];
    for (const y of [1400, 2000, 2800]) {
      const els = document.elementsFromPoint(700, Math.min(y, window.innerHeight - 10));
      const deep = document.elementFromPoint(700, Math.min(y, window.innerHeight - 1));
      out.push({ y, tags: els.slice(0, 4).map((e) => `${e.tagName}.${(e.className ?? '').toString().slice(0, 40)}`) });
    }
    return out;
  });
  console.log('AT', JSON.stringify(atPoint));
  const experiments = await page.evaluate(() => {
    const base = document.documentElement.scrollHeight;
    const results = { base };
    const style = document.createElement('style');
    document.head.appendChild(style);
    for (const [name, css] of [
      ['hide-drawer', '.at-drawer{display:none!important}'],
      ['hide-shelf', '[data-testid="evidence-shelf"]{display:none!important}'],
      ['hide-stage', '[data-testid="stage-column"]{display:none!important}'],
      ['hide-report', '[data-testid="autopsy-report-card"]{display:none!important}'],
    ]) {
      style.textContent = css;
      results[name] = document.documentElement.scrollHeight;
    }
    style.remove();
    return results;
  });
  console.log('EXP', JSON.stringify(experiments));
  const tall = await page.evaluate(() => {
    const out = [];
    const walk = (el, depth) => {
      if (depth > 6) return;
      for (const child of el.children) {
        const r = child.getBoundingClientRect();
        if (r.height > 1200 || child.scrollHeight > 2000) {
          out.push({
            depth,
            tag: child.tagName,
            testid: child.getAttribute('data-testid'),
            cls: (child.className ?? '').toString().slice(0, 80),
            h: Math.round(r.height),
            sh: child.scrollHeight,
            y: Math.round(r.y),
          });
        }
        walk(child, depth + 1);
      }
    };
    walk(document.body, 0);
    return out.slice(0, 15);
  });
  console.log(JSON.stringify(tall, null, 1));
  await browser.close();
} finally {
  server.kill('SIGTERM');
}
