import { chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';

const files = ['_field-dark.png', 'home-loaded-dark.png', 'home-light.png'];
const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent('<canvas id="c"></canvas>');
for (const f of files) {
  const b64 = readFileSync(`/workspace/work/atelier-preview/${f}`).toString('base64');
  const out = await page.evaluate(async (data) => {
    const img = new Image();
    img.src = `data:image/png;base64,${data}`;
    await img.decode();
    const c = document.getElementById('c');
    c.width = img.width;
    c.height = img.height;
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const sample = (x, y) => [...ctx.getImageData(x, y, 1, 1).data].slice(0, 3);
    return {
      size: [img.width, img.height],
      topLeft: sample(40, 200),
      center: sample(Math.floor(img.width * 0.5), Math.floor(img.height * 0.42)),
      right: sample(Math.floor(img.width * 0.85), Math.floor(img.height * 0.5)),
      bottom: sample(Math.floor(img.width * 0.5), Math.floor(img.height * 0.95)),
    };
  }, b64);
  console.log(f, JSON.stringify(out));
}
await browser.close();
