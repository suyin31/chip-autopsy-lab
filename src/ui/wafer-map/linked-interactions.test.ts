import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { buildLotModel, type LotModel } from '@/core/model';
import { parseStdfBytes, type StdfWriteLotSpec, writeStdfBytes } from '@/core/stdf';
import {
  computeEvidenceFramingCamera,
  computeLiveBoxSelectStats,
  computeMagnifierPlacement,
  computeOrderedGlowSchedule,
  computePopoverPlacement,
  computeWaferEvidencePresence,
  evaluateGlowSequenceFrame,
  inferGlowOrderMode,
  rectsOverlap,
  screenRectToWaferGridBounds,
} from './linked-interactions';
import { computeWaferRenderLayout, dieCoordToCanvasRect } from './wafer-geometry';

function createTestRingLot(): LotModel {
  const w1Touchdowns: Array<
    Array<{
      headNum: number;
      siteNum: number;
      partFlg: number;
      hardBin: number;
      softBin: number;
      xCoord: number;
      yCoord: number;
    }>
  > = [];
  const w2Touchdowns: typeof w1Touchdowns = [];

  for (let y = -5; y <= 5; y += 1) {
    for (let x = -5; x <= 5; x += 1) {
      if (Math.hypot(x, y) > 5.3) continue;
      const isOuter = Math.hypot(x, y) >= 3.8;
      const siteNum = (Math.abs(x + y) % 2) + 1;
      w1Touchdowns.push([
        {
          headNum: 1,
          siteNum,
          partFlg: isOuter ? 0x08 : 0x00,
          hardBin: isOuter ? 3 : 1,
          softBin: isOuter ? 7 : 1,
          xCoord: x,
          yCoord: y,
        },
      ]);
      w2Touchdowns.push([
        {
          headNum: 1,
          siteNum,
          partFlg: 0x00,
          hardBin: 1,
          softBin: 1,
          xCoord: x,
          yCoord: y,
        },
      ]);
    }
  }

  const spec: StdfWriteLotSpec = {
    endianness: 'little',
    mir: { lotId: 'LOT-R7', partTyp: 'CHIP', jobNam: 'SORT1' },
    sbrs: [
      { headNum: 255, siteNum: 0, sbinNum: 1, sbinCnt: 50, sbinPf: 'P', sbinNam: 'PASS' },
      { headNum: 255, siteNum: 0, sbinNum: 7, sbinCnt: 40, sbinPf: 'F', sbinNam: 'IDDQ_EDGE_LEAK' },
    ],
    wcr: { wfFlat: 'D', posX: 'R', posY: 'U' },
    wafers: [
      {
        wir: { headNum: 1, waferId: 'W01' },
        touchdowns: w1Touchdowns,
      },
      {
        wir: { headNum: 1, waferId: 'W02' },
        touchdowns: w2Touchdowns,
      },
    ],
  };

  const bytes = writeStdfBytes(spec);
  const parsed = parseStdfBytes(bytes, { mode: 'full' });
  if (!parsed.ok) {
    throw new Error('Failed to parse synthetic R7 test lot');
  }
  return buildLotModel(parsed.value);
}

describe('R7 linked-interactions — pure geometry, glow ordering, camera framing & live box stats', () => {
  describe('computeMagnifierPlacement (§4.8 — never covers the hovered die)', () => {
    it('places 16 px right and 16 px above the pointer by default with bottom-left origin', () => {
      const dieRect = { x: 290, y: 350, width: 20, height: 20 };
      const res = computeMagnifierPlacement({
        pointerX: 300,
        pointerY: 360,
        dieRect,
        magnifierWidth: 184,
        magnifierHeight: 220,
        stageWidth: 783,
        stageHeight: 720,
      });

      expect(res.x).toBe(316);
      expect(res.y).toBe(360 - 16 - 220);
      expect(res.transformOrigin).toBe('bottom left');
      expect(
        rectsOverlap(
          { x: res.x, y: res.y, width: 184, height: 220 },
          dieRect,
        ),
      ).toBe(false);
    });

    it('flips horizontally near the right edge and vertically near the top edge while respecting 8 px stage margin', () => {
      const dieRect = { x: 700, y: 40, width: 20, height: 20 };
      const res = computeMagnifierPlacement({
        pointerX: 710,
        pointerY: 50,
        dieRect,
        magnifierWidth: 184,
        magnifierHeight: 220,
        stageWidth: 783,
        stageHeight: 720,
      });

      expect(res.x).toBeGreaterThanOrEqual(8);
      expect(res.x + 184).toBeLessThanOrEqual(783 - 8);
      expect(res.y).toBeGreaterThanOrEqual(8);
      expect(res.y + 220).toBeLessThanOrEqual(720 - 8);
      expect(res.transformOrigin).toBe('top right');
      expect(
        rectsOverlap(
          { x: res.x, y: res.y, width: 184, height: 220 },
          dieRect,
        ),
      ).toBe(false);
    });

    it('falls back above the stage edge when no quadrant fits (e.g. tight mobile stage) and never covers the hovered die', () => {
      const dieRect = { x: 140, y: 140, width: 110, height: 110 };
      const res = computeMagnifierPlacement({
        pointerX: 195,
        pointerY: 195,
        dieRect,
        magnifierWidth: 184,
        magnifierHeight: 240,
        stageWidth: 320,
        stageHeight: 320,
      });

      expect(res.placedAboveStage).toBe(true);
      expect(res.y + 240).toBeLessThanOrEqual(0);
      expect(
        rectsOverlap(
          { x: res.x, y: res.y, width: 184, height: 240 },
          dieRect,
        ),
      ).toBe(false);
    });

    it('property: magnifier rectangle NEVER covers the hovered die across arbitrary stage sizes, zoom scales, and pointer positions', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 240, max: 1440 }),
          fc.integer({ min: 240, max: 960 }),
          fc.double({ min: 0, max: 1, noNaN: true }),
          fc.double({ min: 0, max: 1, noNaN: true }),
          fc.integer({ min: 4, max: 180 }),
          fc.integer({ min: 140, max: 220 }),
          fc.integer({ min: 120, max: 280 }),
          (stageW, stageH, rx, ry, dieSize, magW, magH) => {
            const dieX = rx * Math.max(1, stageW - dieSize);
            const dieY = ry * Math.max(1, stageH - dieSize);
            const dieRect = {
              x: dieX,
              y: dieY,
              width: dieSize,
              height: dieSize,
            };
            const pointerX = dieX + dieSize * 0.5;
            const pointerY = dieY + dieSize * 0.5;

            const placed = computeMagnifierPlacement({
              pointerX,
              pointerY,
              dieRect,
              magnifierWidth: magW,
              magnifierHeight: magH,
              stageWidth: stageW,
              stageHeight: stageH,
            });

            const magBox = {
              x: placed.x,
              y: placed.y,
              width: magW,
              height: magH,
            };
            expect(rectsOverlap(magBox, dieRect)).toBe(false);
          },
        ),
        { numRuns: 200 },
      );
    });
  });

  describe('computeOrderedGlowSchedule & evaluateGlowSequenceFrame (§5.4)', () => {
    it('orders Edge-Ring dies clockwise starting from 12 o’clock and completes within 600 ms', () => {
      const lot = createTestRingLot();
      const wafer = lot.wafers[0]!;
      const layout = computeWaferRenderLayout(wafer, 783, 720, lot.dies);

      // Pick 4 cardinal failing dies: 12 o'clock (0, 5), 3 o'clock (5, 0), 6 o'clock (0, -5), 9 o'clock (-5, 0)
      const findDie = (x: number, y: number): number => {
        for (let i = wafer.dieStartIndex; i < wafer.dieEndIndex; i += 1) {
          if (lot.dies.x[i] === x && lot.dies.y[i] === y) {
            return i;
          }
        }
        throw new Error(`Missing die (${x}, ${y})`);
      };

      const d12 = findDie(0, 5);
      const d3 = findDie(5, 0);
      const d6 = findDie(0, -5);
      const d9 = findDie(-5, 0);

      const mask = new Uint8Array(lot.dies.count);
      mask[d9] = 1;
      mask[d6] = 1;
      mask[d12] = 1;
      mask[d3] = 1;

      const schedule = computeOrderedGlowSchedule({
        lot,
        waferIndex: 0,
        evidenceMask: mask,
        mode: 'polar-cw',
      });

      expect(Array.from(schedule.dieIndices)).toEqual([d12, d3, d6, d9]);
      expect(schedule.delaysMs[0]).toBe(0);
      expect(schedule.delaysMs[1]).toBeCloseTo(140, 2);
      expect(schedule.delaysMs[2]).toBeCloseTo(280, 2);
      expect(schedule.delaysMs[3]).toBeCloseTo(420, 2);

      // At t = 100 ms: 12 o'clock is lit, 9 o'clock hasn't started yet
      const midFrame = evaluateGlowSequenceFrame(schedule, 100, false);
      expect(midFrame.scrimAlpha).toBeGreaterThan(0);
      expect(midFrame.scrimAlpha).toBeLessThanOrEqual(0.62);
      expect(midFrame.dieAlphas[0]).toBeGreaterThan(0.5);
      expect(midFrame.dieAlphas[3]).toBe(0);
      expect(midFrame.settled).toBe(false);

      // At t = 600 ms: all dies have finished (alpha === 1) and scrim === 0.62
      const doneFrame = evaluateGlowSequenceFrame(schedule, 600, false);
      expect(doneFrame.scrimAlpha).toBeCloseTo(0.62, 4);
      expect(Array.from(doneFrame.dieAlphas)).toEqual([1, 1, 1, 1]);
      expect(doneFrame.settled).toBe(true);

      // Reduced motion jumps to settled immediately at t = 0
      const reducedFrame = evaluateGlowSequenceFrame(schedule, 0, true);
      expect(reducedFrame.scrimAlpha).toBeCloseTo(0.62, 4);
      expect(Array.from(reducedFrame.dieAlphas)).toEqual([1, 1, 1, 1]);
      expect(reducedFrame.settled).toBe(true);
      expect(layout.waferRadiusPx).toBeGreaterThan(0);
    });

    it('orders Scratch dies monotonically along the scratch principal axis', () => {
      const lot = createTestRingLot();
      const wafer = lot.wafers[0]!;
      const diagCoords = [
        [-3, -3],
        [-1, -1],
        [1, 1],
        [3, 3],
      ] as const;
      const indices = diagCoords.map(([x, y]) => {
        for (let i = wafer.dieStartIndex; i < wafer.dieEndIndex; i += 1) {
          if (lot.dies.x[i] === x && lot.dies.y[i] === y) return i;
        }
        throw new Error('Missing diagonal die');
      });

      const mask = new Uint8Array(lot.dies.count);
      for (const idx of indices) mask[idx] = 1;

      const schedule = computeOrderedGlowSchedule({
        lot,
        waferIndex: 0,
        evidenceMask: mask,
        mode: 'principal-axis',
      });

      const ordered = Array.from(schedule.dieIndices);
      const isForward = ordered.every((v, i) => v === indices[i]);
      const isReverse = ordered.every(
        (v, i) => v === indices[indices.length - 1 - i],
      );
      expect(isForward || isReverse).toBe(true);
    });

    it('infers glow order mode from claim message keys', () => {
      expect(inferGlowOrderMode('findings.edgeBand.headline')).toBe('polar-cw');
      expect(inferGlowOrderMode('findings.scratch.headline')).toBe(
        'principal-axis',
      );
      expect(inferGlowOrderMode('findings.site.headline')).toBe(
        'centroid-distance',
      );
    });
  });

  describe('computeEvidenceFramingCamera (§5.4 step 3)', () => {
    it('keeps fit view (scale 1) when evidence bbox covers >= 70% of wafer diameter (e.g. Edge-Ring)', () => {
      const lot = createTestRingLot();
      const wafer = lot.wafers[0]!;
      const fitLayout = computeWaferRenderLayout(wafer, 783, 720, lot.dies);

      const mask = new Uint8Array(lot.dies.count);
      for (let i = wafer.dieStartIndex; i < wafer.dieEndIndex; i += 1) {
        if (lot.dies.finalPass[i] === 0) mask[i] = 1;
      }

      const cam = computeEvidenceFramingCamera({
        lot,
        waferIndex: 0,
        dieMask: mask,
        fitLayout,
        stageWidth: 783,
        stageHeight: 720,
      });

      expect(cam.scale).toBe(1);
      expect(cam.tx).toBe(0);
      expect(cam.ty).toBe(0);
    });

    it('zooms into a localized cluster clamped to [1, 4] with 48 px padding', () => {
      const lot = createTestRingLot();
      const wafer = lot.wafers[0]!;
      const fitLayout = computeWaferRenderLayout(wafer, 783, 720, lot.dies);

      const mask = new Uint8Array(lot.dies.count);
      for (let i = wafer.dieStartIndex; i < wafer.dieEndIndex; i += 1) {
        if (
          lot.dies.x[i]! >= 1 &&
          lot.dies.x[i]! <= 2 &&
          lot.dies.y[i]! >= 1 &&
          lot.dies.y[i]! <= 2
        ) {
          mask[i] = 1;
        }
      }

      const cam = computeEvidenceFramingCamera({
        lot,
        waferIndex: 0,
        dieMask: mask,
        fitLayout,
        stageWidth: 783,
        stageHeight: 720,
      });

      expect(cam.scale).toBeGreaterThan(1.5);
      expect(cam.scale).toBeLessThanOrEqual(4);
    });
  });

  describe('Box select grid mapping, live stats & popover placement (§3.6, §4.14, §5.7)', () => {
    it('computes live die count, failing count, yield, and top bin for a dragged screen rect', () => {
      const lot = createTestRingLot();
      const wafer = lot.wafers[0]!;
      const fitLayout = computeWaferRenderLayout(wafer, 783, 720, lot.dies);

      const rTopLeft = dieCoordToCanvasRect(2, 5, fitLayout);
      const rBottomRight = dieCoordToCanvasRect(5, 2, fitLayout);

      const bounds = screenRectToWaferGridBounds(
        {
          x0: rTopLeft.centerX,
          y0: rTopLeft.centerY,
          x1: rBottomRight.centerX,
          y1: rBottomRight.centerY,
        },
        fitLayout,
        wafer,
      );

      expect(bounds).toEqual({ minX: 2, maxX: 5, minY: 2, maxY: 5 });

      const stats = computeLiveBoxSelectStats(lot, 0, bounds!);
      expect(stats.dieCount).toBeGreaterThan(0);
      expect(stats.failingCount).toBeGreaterThan(0);
      expect(stats.yieldRatio).toBeCloseTo(
        (stats.dieCount - stats.failingCount) / stats.dieCount,
        5,
      );
      expect(stats.topBin).toEqual({
        mode: 'SBIN',
        code: 7,
        name: 'IDDQ_EDGE_LEAK',
        count: stats.failingCount,
      });
    });

    it('anchors selection popover to top-right with 8 px gap and flips when near right edge', () => {
      const normal = computePopoverPlacement({
        rect: { x: 200, y: 180, width: 140, height: 120 },
        popoverWidth: 220,
        popoverHeight: 160,
        stageWidth: 783,
        stageHeight: 720,
      });
      expect(normal.x).toBe(200 + 140 + 8);
      expect(normal.y).toBe(180);

      const flipped = computePopoverPlacement({
        rect: { x: 520, y: 180, width: 160, height: 120 },
        popoverWidth: 220,
        popoverHeight: 160,
        stageWidth: 783,
        stageHeight: 720,
      });
      expect(flipped.x).toBe(520 - 8 - 220);
      expect(
        rectsOverlap(
          { x: flipped.x, y: flipped.y, width: 220, height: 160 },
          { x: 520, y: 180, width: 160, height: 120 },
        ),
      ).toBe(false);
    });
  });

  describe('computeWaferEvidencePresence (§3.5)', () => {
    it('identifies wafers with >= 1 evidence die vs 0 evidence dies', () => {
      const lot = createTestRingLot();
      const mask = new Uint8Array(lot.dies.count);
      for (let i = 0; i < lot.dies.count; i += 1) {
        if (lot.dies.finalPass[i] === 0) mask[i] = 1;
      }

      const presence = computeWaferEvidencePresence(lot, mask);
      expect(presence).toEqual([true, false]);
    });
  });
});
