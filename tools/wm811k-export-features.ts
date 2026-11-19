/**
 * Exports the classifier's handcrafted feature vector (extractWm811kFeatureVector) for every
 * labeled WM-811K wafer, for offline training of the small learned stage (tools/train-wm811k.py).
 *
 * Usage: npx tsx tools/wm811k-export-features.ts [dataDir] [outFile]
 * Output: one CSV row per wafer that passes the noise gate: id,label,split,<features...>
 * Wafers stopped by the noise gate are counted but not written (they are always 'None').
 * The dataset and the exported CSV are NOT stored in this repo.
 */
import { createReadStream, createWriteStream, readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { join } from 'node:path';
import { computeWaferEdgeRingIndices } from '../src/core/model/lot-builder';
import type { LotModel } from '../src/core/model/types';
import { extractWm811kFeatureVector, WM811K_FEATURE_NAMES } from '../src/core/patterns/wm811k-classifier';

const DATA_DIR = process.argv[2] ?? process.env.WM811K_DIR ?? '/workspace/work/wm811k';
const OUT = process.argv[3] ?? 'wm811k-features.csv';
const split = JSON.parse(readFileSync(join(DATA_DIR, 'split.json'), 'utf8')) as { train: number[]; test: number[] };
const splitOf = new Map<number, string>();
for (const id of split.train) splitOf.set(id, 'train');
for (const id of split.test) splitOf.set(id, 'test');

let pool: string[] = [];
function toLot(h: number, w: number, m: string): LotModel {
  const coords: { x: number; y: number }[] = [];
  const pass: number[] = [];
  for (let r = 0; r < h; r += 1)
    for (let c = 0; c < w; c += 1) {
      const v = m.charCodeAt(r * w + c) - 48;
      if (v === 1 || v === 2) {
        coords.push({ x: c, y: r });
        pass.push(v === 1 ? 1 : 0);
      }
    }
  const n = coords.length;
  const x = new Int16Array(n);
  const y = new Int16Array(n);
  const finalPass = new Uint8Array(n);
  for (let i = 0; i < n; i += 1) {
    x[i] = coords[i]!.x;
    y[i] = coords[i]!.y;
    finalPass[i] = pass[i]!;
  }
  const ringIndex = n > 0 ? computeWaferEdgeRingIndices(coords) : new Uint16Array(0);
  if (pool.length < n) pool = Array.from({ length: n }, (_, i) => `d${i}`);
  return {
    wafers: [{ waferIndex: 0, waferId: 'W01', dieStartIndex: 0, dieEndIndex: n }],
    dies: { count: n, x, y, hasValidCoords: new Uint8Array(n).fill(1), finalPass, firstPass: finalPass, ringIndex },
    dieIds: pool,
  } as unknown as LotModel;
}

async function main() {
  const out = createWriteStream(OUT);
  out.write(['id', 'label', 'split', ...WM811K_FEATURE_NAMES].join(',') + '\n');
  const rl = createInterface({ input: createReadStream(join(DATA_DIR, 'labeled.jsonl')), crlfDelay: Infinity });
  let n = 0;
  let gated = 0;
  const t0 = performance.now();
  for await (const line of rl) {
    if (!line) continue;
    const rec = JSON.parse(line) as { id: number; label: string; h: number; w: number; m: string };
    const v = extractWm811kFeatureVector(toLot(rec.h, rec.w, rec.m), 0);
    n += 1;
    if (v === null) {
      gated += 1;
      continue;
    }
    out.write(`${rec.id},${rec.label},${splitOf.get(rec.id) ?? 'none'},${v.map((a) => +a.toPrecision(6)).join(',')}\n`);
    if (n % 20000 === 0) console.error(`${n} wafers ${((performance.now() - t0) / 1000).toFixed(0)}s`);
  }
  out.end();
  console.log(JSON.stringify({ n, gated, seconds: (performance.now() - t0) / 1000 }));
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
