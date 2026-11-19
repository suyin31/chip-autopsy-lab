/**
 * Real-data (WM-811K) handcrafted feature vector for the wafer-map pattern classifier.
 *
 * Techniques (see logs/wm811k-tuning-notes.md for sources):
 *  - features computed on the raw fail map AND on a 3x3 neighbour-count denoised map
 *    (Wu, Jang & Chen 2015 WMFPR; Wang 2008 spatial filtering);
 *  - concentric radial-bin and outermost-ring densities, each also expressed relative to the
 *    wafer's own global fail fraction (adaptive per-wafer background baseline);
 *  - geometry of the most salient (largest) denoised region: area, centroid / min / max radius,
 *    PCA major / minor axis, eccentricity, fill ratio (Wu et al. 2015 Table III);
 *  - angular-sector statistics (D4-invariant max / min / spread).
 *
 * Every feature is invariant under the 8 D4 rotations / reflections of the die lattice about the
 * bounding-box center. Pure TypeScript, O(N), no allocations beyond a few typed arrays.
 */

export interface RealFeatureInput {
  readonly testedCount: number;
  readonly x: Int32Array;
  readonly y: Int32Array;
  readonly ringIndex: Uint16Array;
  readonly isActiveFail: Uint8Array;
  readonly cx: number;
  readonly cy: number;
  readonly rMax: number;
}

export interface RealFeatureResult {
  /** Feature vector, order given by `REAL_FEATURE_NAMES` (heuristic scores appended by caller). */
  readonly values: number[];
  /** Tested-cell indices of the largest denoised region (8-connected), possibly empty. */
  readonly salientCells: Uint32Array;
  /** Tested-cell indices of all denoised fails. */
  readonly denoisedCells: Uint32Array;
}

/** Radial bin upper edges on normalized radius rho = dist / rMax. */
const RHO_EDGES = [0.2, 0.35, 0.5, 0.65, 0.8, 1.000001] as const;
const SECTORS = 8;
/** Denoise: a fail survives when at least this many of its 8 neighbours also fail. */
export const DENOISE_MIN_NEIGHBOURS = 3;
const EPS = 0.01;

const N8_DX = [-1, 1, 0, 0, -1, -1, 1, 1] as const;
const N8_DY = [0, 0, -1, 1, -1, 1, -1, 1] as const;

const ZONE_NAMES = ['r0', 'r1', 'r2', 'r3', 'r4', 'r5', 'ring0', 'ring1', 'ring23'];

export const REAL_FEATURE_NAMES: readonly string[] = [
  'logN',
  'f',
  'logitF',
  ...ZONE_NAMES.map((z) => `raw_${z}`),
  ...ZONE_NAMES.map((z) => `rawRel_${z}`),
  'raw_secMax',
  'raw_secMin',
  'raw_secSpreadRel',
  'raw_outerSecMaxRel',
  'raw_angRes',
  'raw_nb2',
  'raw_nb4',
  'raw_nb6',
  'raw_excessClust',
  'dn_keep',
  'dn_frac',
  ...ZONE_NAMES.map((z) => `dn_${z}`),
  'dn_secMaxShare',
  'dn_angRes',
  'dn_edgeShare',
  'dn_innerShare',
  'dn_ncomp',
  'sal_areaN',
  'sal_shareDn',
  'sal_rhoC',
  'sal_rhoMin',
  'sal_rhoMax',
  'sal_major',
  'sal_minor',
  'sal_ecc',
  'sal_fill',
  'sal_edgeFrac',
  'sal_angRes',
  'sal_secondShare',
  'g2_ncomp',
  'g2_areaN',
  'g2_shareDn',
  'g2_rhoC',
  'g2_rhoMin',
  'g2_rhoMax',
  'g2_major',
  'g2_minor',
  'g2_ecc',
  'g2_fill',
  'g2_edgeFrac',
  'g2_angRes',
  'g2_secondShare',
];

function zoneOf(rho: number): number {
  for (let b = 0; b < RHO_EDGES.length; b += 1) {
    if (rho < RHO_EDGES[b]!) return b;
  }
  return RHO_EDGES.length - 1;
}

/** Splits weight between sectors on exact boundaries so the multiset of sector values is D4-invariant. */
function addSector(acc: Float64Array, dx: number, dy: number, w: number): void {
  if (dx === 0 && dy === 0) {
    for (let s = 0; s < SECTORS; s += 1) acc[s] += w / SECTORS;
    return;
  }
  const t = ((Math.atan2(dy, dx) / (2 * Math.PI)) * SECTORS + SECTORS) % SECTORS;
  const s0 = Math.floor(t);
  const frac = t - s0;
  // exact-boundary points: axis / diagonal lattice points (|dx|==|dy| or one is 0)
  const onBoundary = dx === 0 || dy === 0 || Math.abs(dx) === Math.abs(dy);
  if (onBoundary && (frac < 1e-9 || frac > 1 - 1e-9)) {
    const b = Math.round(t) % SECTORS;
    acc[b] += w / 2;
    acc[(b + SECTORS - 1) % SECTORS] += w / 2;
    return;
  }
  acc[s0 % SECTORS] += w;
}

function resultant(sx: number, sy: number, n: number): number {
  return n > 0 ? Math.min(1, Math.hypot(sx, sy) / n) : 0;
}

export function computeRealFeatures(input: RealFeatureInput): RealFeatureResult {
  const { testedCount: N, x, y, ringIndex, isActiveFail, cx, cy, rMax } = input;

  // Dense lookup over the tested bounding box (falls back to a Map for huge sparse spans).
  let minX = x[0]!;
  let maxX = minX;
  let minY = y[0]!;
  let maxY = minY;
  for (let i = 1; i < N; i += 1) {
    if (x[i]! < minX) minX = x[i]!;
    if (x[i]! > maxX) maxX = x[i]!;
    if (y[i]! < minY) minY = y[i]!;
    if (y[i]! > maxY) maxY = y[i]!;
  }
  const spanX = maxX - minX + 1;
  const spanY = maxY - minY + 1;
  const dense = spanX * spanY <= 1 << 20;
  const grid = dense ? new Int32Array(spanX * spanY).fill(-1) : null;
  const map = dense ? null : new Map<number, number>();
  for (let i = 0; i < N; i += 1) {
    if (grid) grid[(x[i]! - minX) * spanY + (y[i]! - minY)] = i;
    else map!.set((x[i]! + 40000) * 100000 + (y[i]! + 40000), i);
  }
  const at = (px: number, py: number): number => {
    if (px < minX || px > maxX || py < minY || py > maxY) return -1;
    if (grid) return grid[(px - minX) * spanY + (py - minY)]!;
    return map!.get((px + 40000) * 100000 + (py + 40000)) ?? -1;
  };

  const zoneTot = new Float64Array(9);
  const zoneFail = new Float64Array(9);
  const zoneDn = new Float64Array(9);
  const secTot = new Float64Array(SECTORS);
  const secFail = new Float64Array(SECTORS);
  const outerSecTot = new Float64Array(SECTORS);
  const outerSecFail = new Float64Array(SECTORS);
  const dnSec = new Float64Array(SECTORS);
  const rho = new Float64Array(N);
  const nb = new Uint8Array(N);

  let F = 0;
  let angX = 0;
  let angY = 0;
  let angN = 0;
  for (let i = 0; i < N; i += 1) {
    const dx = x[i]! - cx;
    const dy = y[i]! - cy;
    const d = Math.hypot(dx, dy);
    rho[i] = d / rMax;
    const fail = isActiveFail[i] !== 0;
    const z = zoneOf(rho[i]!);
    const r = ringIndex[i]!;
    const rz = r === 0 ? 6 : r === 1 ? 7 : r <= 3 ? 8 : -1;
    zoneTot[z] += 1;
    if (rz >= 0) zoneTot[rz] += 1;
    addSector(secTot, dx, dy, 1);
    const outer = r <= 3;
    if (outer) addSector(outerSecTot, dx, dy, 1);
    if (!fail) continue;
    F += 1;
    zoneFail[z] += 1;
    if (rz >= 0) zoneFail[rz] += 1;
    addSector(secFail, dx, dy, 1);
    if (outer) addSector(outerSecFail, dx, dy, 1);
    if (d > 1e-6) {
      angX += dx / d;
      angY += dy / d;
      angN += 1;
    }
    let c = 0;
    for (let k = 0; k < 8; k += 1) {
      const j = at(x[i]! + N8_DX[k]!, y[i]! + N8_DY[k]!);
      if (j >= 0 && isActiveFail[j] !== 0) c += 1;
    }
    nb[i] = c;
  }

  const f = F / Math.max(1, N);
  const out: number[] = [];
  out.push(Math.log(Math.max(1, N)));
  out.push(f);
  const fc = Math.min(0.995, Math.max(0.005, f));
  out.push(Math.log(fc / (1 - fc)));
  const rawZone: number[] = [];
  for (let z = 0; z < 9; z += 1) rawZone.push(zoneTot[z]! > 0 ? zoneFail[z]! / zoneTot[z]! : f);
  out.push(...rawZone);
  for (let z = 0; z < 9; z += 1) out.push(Math.log((rawZone[z]! + EPS) / (f + EPS)));

  let secMax = 0;
  let secMin = 1;
  let secSum = 0;
  let outerSecMax = 0;
  for (let s = 0; s < SECTORS; s += 1) {
    const v = secTot[s]! > 0 ? secFail[s]! / secTot[s]! : 0;
    secMax = Math.max(secMax, v);
    secMin = Math.min(secMin, v);
    secSum += v;
    const ov = outerSecTot[s]! > 0 ? outerSecFail[s]! / outerSecTot[s]! : 0;
    outerSecMax = Math.max(outerSecMax, ov);
  }
  out.push(secMax, secMin, (secMax - secMin) / (secSum / SECTORS + EPS));
  out.push(Math.log((outerSecMax + EPS) / (f + EPS)));
  out.push(resultant(angX, angY, angN));

  let nb2 = 0;
  let nb4 = 0;
  let nb6 = 0;
  for (let i = 0; i < N; i += 1) {
    if (isActiveFail[i] === 0) continue;
    if (nb[i]! >= 2) nb2 += 1;
    if (nb[i]! >= 4) nb4 += 1;
    if (nb[i]! >= 6) nb6 += 1;
  }
  const Fd = Math.max(1, F);
  out.push(nb2 / Fd, nb4 / Fd, nb6 / Fd);
  // excess of "has >= 2 fail neighbours" over the Bernoulli(f) expectation for 8 neighbours
  const pAtLeast2 = 1 - (1 - f) ** 8 - 8 * f * (1 - f) ** 7;
  out.push(nb2 / Fd - pAtLeast2);

  // ---- Denoised map: keep fails with >= DENOISE_MIN_NEIGHBOURS failing 8-neighbours ----
  const keep = new Uint8Array(N);
  let D = 0;
  let dAngX = 0;
  let dAngY = 0;
  let dEdge = 0;
  let dInner = 0;
  for (let i = 0; i < N; i += 1) {
    if (isActiveFail[i] === 0 || nb[i]! < DENOISE_MIN_NEIGHBOURS) continue;
    keep[i] = 1;
    D += 1;
    const z = zoneOf(rho[i]!);
    zoneDn[z] += 1;
    const r = ringIndex[i]!;
    const rz = r === 0 ? 6 : r === 1 ? 7 : r <= 3 ? 8 : -1;
    if (rz >= 0) zoneDn[rz] += 1;
    if (r <= 3) dEdge += 1;
    if (rho[i]! < 0.35) dInner += 1;
    const dx = x[i]! - cx;
    const dy = y[i]! - cy;
    addSector(dnSec, dx, dy, 1);
    const d = Math.hypot(dx, dy);
    if (d > 1e-6) {
      dAngX += dx / d;
      dAngY += dy / d;
    }
  }
  out.push(D / Fd, D / Math.max(1, N));
  for (let z = 0; z < 9; z += 1) out.push(zoneTot[z]! > 0 ? zoneDn[z]! / zoneTot[z]! : 0);
  let dnSecMax = 0;
  for (let s = 0; s < SECTORS; s += 1) dnSecMax = Math.max(dnSecMax, dnSec[s]!);
  const Dd = Math.max(1, D);
  out.push(D > 0 ? dnSecMax / Dd : 0);
  out.push(resultant(dAngX, dAngY, D));
  out.push(D > 0 ? dEdge / Dd : 0, D > 0 ? dInner / Dd : 0);

  // ---- Most salient region (largest 8-connected component) of a denoised mask ----
  const salientOf = (mask: Uint8Array, total: number) => {
    const comp = new Int32Array(N).fill(-1);
    const queue = new Uint32Array(Math.max(1, total));
    let nComp = 0;
    let best = -1;
    let bestSize = 0;
    let secondSize = 0;
    let sigComps = 0;
    for (let s0 = 0; s0 < N; s0 += 1) {
      if (mask[s0] === 0 || comp[s0] !== -1) continue;
      let head = 0;
      let tail = 0;
      queue[tail++] = s0;
      comp[s0] = nComp;
      while (head < tail) {
        const u = queue[head++]!;
        for (let k = 0; k < 8; k += 1) {
          const v = at(x[u]! + N8_DX[k]!, y[u]! + N8_DY[k]!);
          if (v >= 0 && mask[v] !== 0 && comp[v] === -1) {
            comp[v] = nComp;
            queue[tail++] = v;
          }
        }
      }
      if (tail >= 3) sigComps += 1;
      if (tail > bestSize) {
        secondSize = bestSize;
        bestSize = tail;
        best = nComp;
      } else if (tail > secondSize) {
        secondSize = tail;
      }
      nComp += 1;
    }
    const cells: number[] = [];
    if (best >= 0) {
      for (let i = 0; i < N; i += 1) if (comp[i] === best) cells.push(i);
    }
    const S = cells.length;
    const tot = Math.max(1, total);
    const geo: number[] = [];
    if (S > 0) {
      let mx = 0;
      let my = 0;
      let rMin = Infinity;
      let rMx = 0;
      let edge = 0;
      let ax = 0;
      let ay = 0;
      for (const i of cells) {
        mx += x[i]!;
        my += y[i]!;
        rMin = Math.min(rMin, rho[i]!);
        rMx = Math.max(rMx, rho[i]!);
        if (ringIndex[i]! <= 2) edge += 1;
        const dx = x[i]! - cx;
        const dy = y[i]! - cy;
        const d = Math.hypot(dx, dy);
        if (d > 1e-6) {
          ax += dx / d;
          ay += dy / d;
        }
      }
      mx /= S;
      my /= S;
      let sxx = 0;
      let syy = 0;
      let sxy = 0;
      for (const i of cells) {
        const dx = x[i]! - mx;
        const dy = y[i]! - my;
        sxx += dx * dx;
        syy += dy * dy;
        sxy += dx * dy;
      }
      sxx /= S;
      syy /= S;
      sxy /= S;
      const ht = 0.5 * (sxx + syy);
      const ed = Math.hypot(0.5 * (sxx - syy), sxy);
      const l1 = Math.max(0, ht + ed) + 1 / 12;
      const l2 = Math.max(0, ht - ed) + 1 / 12;
      const major = Math.sqrt(12 * l1);
      const minor = Math.sqrt(12 * l2);
      geo.push(S / Math.max(1, N), S / tot);
      geo.push(Math.hypot(mx - cx, my - cy) / rMax, rMin, rMx);
      geo.push(major / (2 * rMax), minor / (2 * rMax));
      geo.push(Math.sqrt(Math.max(0, 1 - l2 / l1)));
      geo.push(Math.min(1, S / ((Math.PI / 4) * major * minor)));
      geo.push(edge / S, resultant(ax, ay, S));
    } else {
      geo.push(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
    }
    geo.push(secondSize / tot);
    return { sigComps, cells, geo };
  };

  const sal = salientOf(keep, D);
  out.push(Math.log(1 + sal.sigComps));
  out.push(...sal.geo);

  // Gentler denoise (>= 2 failing neighbours) keeps 1-die-wide scratch lines intact
  // (a 3-neighbour filter erodes them; see tuning notes item 2).
  const keep2 = new Uint8Array(N);
  let D2 = 0;
  for (let i = 0; i < N; i += 1) {
    if (isActiveFail[i] !== 0 && nb[i]! >= 2) {
      keep2[i] = 1;
      D2 += 1;
    }
  }
  const sal2 = salientOf(keep2, D2);
  out.push(Math.log(1 + sal2.sigComps));
  out.push(...sal2.geo);
  const salient = sal.cells;

  const denoised: number[] = [];
  for (let i = 0; i < N; i += 1) if (keep[i] !== 0) denoised.push(i);

  return {
    values: out,
    salientCells: Uint32Array.from(salient),
    denoisedCells: Uint32Array.from(denoised),
  };
}
