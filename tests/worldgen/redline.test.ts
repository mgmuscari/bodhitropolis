import { describe, it, expect } from 'vitest';
import { GameMap } from '../../src/engine/map';
import { createRng } from '../../src/engine/rng';
import { runPipeline } from '../../src/worldgen/pipeline';
import { terrainStage } from '../../src/worldgen/terrain';
import { mosesCenturyStage } from '../../src/worldgen/moses';
import { gradeRedline, gradeBucket, RedlineGrade } from '../../src/worldgen/redline';

// gradeRedline draws the redline grade — a discriminatory social geography drawn
// FIRST (independent of terrain), with a low-elevation/near-water "cover" nudge
// layered on as the pretext. 0 = greenlined (best) .. 255 = redlined (worst).
// This models the apparatus's grade critically; the live condition is "decay".

function range(arr: Uint8Array): { lo: number; hi: number } {
  let lo = 255;
  let hi = 0;
  for (const v of arr) {
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  return { lo, hi };
}

describe('gradeRedline — determinism', () => {
  it('produces an identical grade array for the same seed', () => {
    const a = new GameMap(64, 64);
    const b = new GameMap(64, 64);
    gradeRedline(a, createRng('redline-1').fork('redline'));
    gradeRedline(b, createRng('redline-1').fork('redline'));
    expect(Array.from(a.redline)).toEqual(Array.from(b.redline));
  });

  it('produces different grades for different seeds', () => {
    const a = new GameMap(64, 64);
    const b = new GameMap(64, 64);
    gradeRedline(a, createRng('redline-1').fork('redline'));
    gradeRedline(b, createRng('redline-2').fork('redline'));
    expect(Array.from(a.redline)).not.toEqual(Array.from(b.redline));
  });
});

describe('gradeRedline — discrimination-first (real redlined + greenlined regions)', () => {
  for (const seed of ['redline-1', 'redline-2', 'redline-3']) {
    it(`seed "${seed}": the grade spans strongly graded regions`, () => {
      const m = new GameMap(128, 128);
      gradeRedline(m, createRng(seed).fork('redline'));
      const { lo, hi } = range(m.redline);
      // There is at least one strongly redlined area and one greenlined area,
      // with a wide gradient between them — not a flat field.
      expect(hi).toBeGreaterThan(180);
      expect(lo).toBeLessThan(72);
      expect(hi - lo).toBeGreaterThan(120);
    });
  }
});

describe('gradeRedline — terrain as cover (low elevation skews worse)', () => {
  it('grades low-elevation land worse than high-elevation land in aggregate', () => {
    // Elevation gradient by row, no water: nudge = f(1 - elevation), so the
    // low-elevation band (small y) should average a worse grade than the high
    // band. Aggregate over seeds so the terrain-independent base noise washes out.
    const W = 64;
    const H = 64;
    let lowSum = 0;
    let lowN = 0;
    let highSum = 0;
    let highN = 0;
    for (const seed of ['cover-1', 'cover-2', 'cover-3', 'cover-4', 'cover-5', 'cover-6']) {
      const m = new GameMap(W, H);
      for (let y = 0; y < H; y++) {
        const e = y / (H - 1);
        for (let x = 0; x < W; x++) m.setElevation(x, y, e);
      }
      gradeRedline(m, createRng(seed).fork('redline'));
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const g = m.redline[m.idx(x, y)]!;
          if (y < H / 4) {
            lowSum += g;
            lowN++;
          } else if (y >= (3 * H) / 4) {
            highSum += g;
            highN++;
          }
        }
      }
    }
    expect(lowSum / lowN).toBeGreaterThan(highSum / highN);
  });
});

describe('gradeBucket — HOLC A/B/C/D over the continuous grade', () => {
  it('maps the continuous grade into four ordered buckets', () => {
    expect(gradeBucket(0)).toBe(RedlineGrade.A);
    expect(gradeBucket(32)).toBe(RedlineGrade.A);
    expect(gradeBucket(96)).toBe(RedlineGrade.B);
    expect(gradeBucket(160)).toBe(RedlineGrade.C);
    expect(gradeBucket(255)).toBe(RedlineGrade.D);
    // Monotonic: a worse grade never buckets better.
    expect(gradeBucket(200)).toBeGreaterThanOrEqual(gradeBucket(100));
  });
});

describe('mosesCenturyStage — draws the redline grade first', () => {
  it('populates a graded redline layer on a real generated world', () => {
    const world = runPipeline({ seed: 'moses-1', width: 96, height: 96 }, [
      terrainStage(),
      mosesCenturyStage(),
    ]);
    const { lo, hi } = range(world.map.redline);
    expect(hi).toBeGreaterThan(160);
    expect(lo).toBeLessThan(96);
  });
});
