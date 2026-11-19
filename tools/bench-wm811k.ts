/**
 * WM-811K benchmark for the heuristic classifier in src/core/patterns/wm811k-classifier.ts.
 *
 * Usage:
 *   npx tsx tools/bench-wm811k.ts [dataDir] [--limit N]
 *
 * dataDir (default /workspace/work/wm811k, or $WM811K_DIR) must contain:
 *   labeled.jsonl  one labeled wafer per line: {id,label,tt,lot,h,w,m} where m is the
 *                  row-major waferMap as a digit string (0 = no die, 1 = pass, 2 = fail)
 *   split.json     {train:number[], test:number[]} fixed stratified 70/30 split (by id)
 * Both are produced by export.py from LSWMD.pkl. The dataset is NOT stored in this repo.
 *
 * Each wafer map becomes a single-wafer LotModel-shaped object holding exactly the fields
 * classifyWaferPattern reads: dies with value 1/2 become tested dies at (x = column,
 * y = row), finalPass = (value === 1), ringIndex from the same computeWaferEdgeRingIndices
 * the real STDF lot builder uses.
 *
 * --only train   evaluates only train ids (writes logs/wm811k-benchmark.train-only.json); this is
 *                the only mode used while tuning, so test metrics are never seen before freezing.
 *
 * Writes logs/wm811k-benchmark.json (the .md report is written by hand from it).
 */
import { createReadStream, readFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { join } from 'node:path';
import { computeWaferEdgeRingIndices } from '../src/core/model/lot-builder';
import type { LotModel } from '../src/core/model/types';
import { classifyWaferPattern, WM811K_CLASSES } from '../src/core/patterns/wm811k-classifier';

type Cls = (typeof WM811K_CLASSES)[number];
const CLASSES = WM811K_CLASSES as readonly Cls[];
const K = CLASSES.length;
const ci = new Map<string, number>(CLASSES.map((c, i) => [c, i]));

const args = process.argv.slice(2);
const limIdx = args.indexOf('--limit');
const LIMIT = limIdx >= 0 ? Number(args[limIdx + 1]) : Infinity;
const onlyIdx = args.indexOf('--only');
/** --only train : evaluate train ids only (use while tuning; test wafers are skipped unread). */
const ONLY = onlyIdx >= 0 ? (args[onlyIdx + 1] as 'train' | 'test') : null;
const OUT_NAME = ONLY ? `wm811k-benchmark.${ONLY}-only.json` : 'wm811k-benchmark.json';
const DATA_DIR =
  args.find((a, i) => !a.startsWith('--') && i !== limIdx + 1 && i !== onlyIdx + 1) ??
  process.env.WM811K_DIR ??
  '/workspace/work/wm811k';

const split = JSON.parse(readFileSync(join(DATA_DIR, 'split.json'), 'utf8')) as {
  train: number[];
  test: number[];
  seed?: number;
  method?: string;
};
const splitOf = new Map<number, 'train' | 'test'>();
for (const id of split.train) splitOf.set(id, 'train');
for (const id of split.test) splitOf.set(id, 'test');

let dieIdsPool: string[] = [];

function toLot(h: number, w: number, m: string): LotModel {
  const coords: { x: number; y: number }[] = [];
  const pass: number[] = [];
  for (let r = 0; r < h; r += 1) {
    for (let c = 0; c < w; c += 1) {
      const v = m.charCodeAt(r * w + c) - 48;
      if (v === 1 || v === 2) {
        coords.push({ x: c, y: r });
        pass.push(v === 1 ? 1 : 0);
      }
    }
  }
  const n = coords.length;
  const x = new Int16Array(n);
  const y = new Int16Array(n);
  const finalPass = new Uint8Array(n);
  const hasValidCoords = new Uint8Array(n).fill(1);
  for (let i = 0; i < n; i += 1) {
    x[i] = coords[i]!.x;
    y[i] = coords[i]!.y;
    finalPass[i] = pass[i]!;
  }
  const ringIndex = n > 0 ? computeWaferEdgeRingIndices(coords) : new Uint16Array(0);
  if (dieIdsPool.length < n) dieIdsPool = Array.from({ length: n }, (_, i) => `d${i}`);
  return {
    wafers: [{ waferIndex: 0, waferId: 'W01', dieStartIndex: 0, dieEndIndex: n }],
    dies: { count: n, x, y, hasValidCoords, finalPass, firstPass: finalPass, ringIndex },
    dieIds: dieIdsPool,
  } as unknown as LotModel;
}

type Conf = number[][];
const newConf = (): Conf => Array.from({ length: K }, () => new Array<number>(K).fill(0));
const conf: Record<'all' | 'train' | 'test', Conf> = { all: newConf(), train: newConf(), test: newConf() };

function metrics(cm: Conf) {
  const total = cm.flat().reduce((a, b) => a + b, 0);
  let correct = 0;
  const per: Record<string, { support: number; predicted: number; precision: number; recall: number; f1: number }> = {};
  let f1Sum = 0;
  let f1SumDefect = 0;
  for (let i = 0; i < K; i += 1) {
    correct += cm[i]![i]!;
    const support = cm[i]!.reduce((a, b) => a + b, 0);
    let predicted = 0;
    for (let r = 0; r < K; r += 1) predicted += cm[r]![i]!;
    const tp = cm[i]![i]!;
    const precision = predicted ? tp / predicted : 0;
    const recall = support ? tp / support : 0;
    const f1 = precision + recall ? (2 * precision * recall) / (precision + recall) : 0;
    per[CLASSES[i]!] = { support, predicted, precision, recall, f1 };
    f1Sum += f1;
    if (CLASSES[i] !== 'None') f1SumDefect += f1;
  }
  const noneI = ci.get('None')!;
  let defTotal = 0;
  let defCorrect = 0;
  let defDetected = 0; // true defect predicted as any non-None class
  let noneFalseAlarm = 0;
  for (let i = 0; i < K; i += 1) {
    const row = cm[i]!;
    if (i === noneI) {
      noneFalseAlarm = row.reduce((a, b) => a + b, 0) - row[noneI]!;
      continue;
    }
    const s = row.reduce((a, b) => a + b, 0);
    defTotal += s;
    defCorrect += row[i]!;
    defDetected += s - row[noneI]!;
  }
  const noneSupport = cm[noneI]!.reduce((a, b) => a + b, 0);
  return {
    n: total,
    accuracy: total ? correct / total : 0,
    accuracyExcludingNone: defTotal ? defCorrect / defTotal : 0,
    macroF1: f1Sum / K,
    macroF1DefectClassesOnly: f1SumDefect / (K - 1),
    defectDetectionRate: defTotal ? defDetected / defTotal : 0,
    noneFalseAlarmRate: noneSupport ? noneFalseAlarm / noneSupport : 0,
    perClass: per,
    confusion: cm,
  };
}

async function main() {
  const t0 = performance.now();
  const rl = createInterface({ input: createReadStream(join(DATA_DIR, 'labeled.jsonl')), crlfDelay: Infinity });
  let n = 0;
  let classifyMs = 0;
  let unmapped = 0;
  for await (const line of rl) {
    if (!line) continue;
    if (n >= LIMIT) break;
    const rec = JSON.parse(line) as { id: number; label: string; h: number; w: number; m: string };
    if (ONLY && splitOf.get(rec.id) !== ONLY) continue;
    const t = ci.get(rec.label);
    if (t === undefined) {
      unmapped += 1;
      continue;
    }
    const lot = toLot(rec.h, rec.w, rec.m);
    const s = performance.now();
    const pred = classifyWaferPattern(lot, 0).pattern;
    classifyMs += performance.now() - s;
    const p = ci.get(pred)!;
    conf.all[t]![p]! += 1;
    const sp = splitOf.get(rec.id);
    if (sp) conf[sp][t]![p]! += 1;
    n += 1;
    if (n % 20000 === 0) console.error(`${n} wafers, ${((performance.now() - t0) / 1000).toFixed(0)}s`);
  }
  const wallS = (performance.now() - t0) / 1000;
  const result = {
    generatedAt: new Date().toISOString(),
    dataset: {
      name: 'WM-811K (LSWMD.pkl)',
      source: 'https://huggingface.co/datasets/lslattery/wafer-defect-detection (mirror of the Kaggle/MIR-lab LSWMD.pkl)',
      sha256: '1d04fccb3dd3176b276878b926b20fead7e077c5751e4d353ea9741a5e7b5c65',
      originalSources: ['http://mirlab.org/dataSet/public/', 'https://www.kaggle.com/datasets/qingyi/wm811k-wafer-map'],
      labeledWafersEvaluated: n,
      unmappedLabels: unmapped,
      split: { seed: split.seed, method: split.method, train: split.train.length, test: split.test.length },
    },
    runtime: {
      wallSeconds: wallS,
      classifyOnlySeconds: classifyMs / 1000,
      msPerWaferClassifyOnly: classifyMs / Math.max(1, n),
      node: process.version,
    },
    classes: CLASSES,
    all: metrics(conf.all),
    train: metrics(conf.train),
    test: metrics(conf.test),
  };
  const outDir = join(process.cwd(), 'logs');
  writeFileSync(join(outDir, OUT_NAME), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ n, wallS, all: { acc: result.all.accuracy, macroF1: result.all.macroF1 } }));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
