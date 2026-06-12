import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { effortPerTick, wellbeing, accrue, type EffortWorld } from '../../src/tech/effort';
import { createTechState } from '../../src/tech/state';
import { TECH_TREE } from '../../src/tech/tree';
import { ParcelStore, BuiltKind } from '../../src/engine/fabric';

/** A minimal effort-world: N parcels with the given conditions. */
function world(conditions: number[]): { parcels: ParcelStore } {
  const parcels = new ParcelStore();
  conditions.forEach((c, i) =>
    parcels.add({ x: i, y: 0, width: 1, height: 1, kind: BuiltKind.HouseSingle, condition: c }),
  );
  return { parcels };
}

/** The pre-civic legacy formula: max(1, floor(alive/8 + floor(meanCondition)/32)). */
function legacyEffort(conditions: number[]): number {
  const alive = conditions.length;
  const mean = alive === 0 ? 0 : Math.floor(conditions.reduce((a, b) => a + b, 0) / alive);
  return Math.max(1, Math.floor(alive / 8 + mean / 32));
}

/** N parcels all at the same condition. */
function uniform(n: number, condition: number): { parcels: ParcelStore } {
  return world(new Array(n).fill(condition));
}

describe('effortPerTick', () => {
  it('is EXACTLY 1 and an integer on a zero-parcel world (NaN-guard pin)', () => {
    const e = effortPerTick(world([]));
    expect(e).toBe(1);
    expect(Number.isInteger(e)).toBe(true);
  });

  it('returns a finite integer on populated worlds', () => {
    for (const w of [uniform(8, 200), world([255, 1, 128, 64]), uniform(40, 90)]) {
      const e = effortPerTick(w);
      expect(Number.isInteger(e)).toBe(true);
      expect(Number.isFinite(e)).toBe(true);
      expect(e).toBeGreaterThanOrEqual(1);
    }
  });

  it('is NON-DECREASING in condition mean at a fixed parcel count', () => {
    const lo = effortPerTick(uniform(8, 50));
    const hi = effortPerTick(uniform(8, 250));
    expect(hi).toBeGreaterThanOrEqual(lo);
  });

  it('can be EQUAL within a floor(/32) bucket (proves non-strict)', () => {
    // condition 0 and 31 both floor to the same /32 bucket at the same count.
    const a = effortPerTick(uniform(8, 0));
    const b = effortPerTick(uniform(8, 31));
    expect(b).toBeGreaterThanOrEqual(a);
    expect(b).toBe(a); // strictly-greater would be wrong here
  });

  it('is STRICTLY greater across a condition-mean step (boundary-crossing)', () => {
    // means separated enough to span at least one floor(/32) step.
    const lo = effortPerTick(uniform(8, 10));
    const hi = effortPerTick(uniform(8, 200));
    expect(hi).toBeGreaterThan(lo);
  });
});

describe('accrue', () => {
  it('adds ticks * effortPerTick(world) to state.effort', () => {
    const w = uniform(8, 200);
    const s = createTechState(TECH_TREE);
    const per = effortPerTick(w);
    accrue(s, w, 5);
    expect(s.effort).toBe(5 * per);
  });

  it('is deterministic: N ticks twice yields equal balances', () => {
    const w = world([200, 120, 64]);
    const s1 = createTechState(TECH_TREE);
    const s2 = createTechState(TECH_TREE);
    accrue(s1, w, 7);
    accrue(s2, w, 7);
    expect(s1.effort).toBe(s2.effort);
  });

  it('accumulates across multiple calls (per-call recompute, constant world)', () => {
    const w = uniform(8, 200);
    const s = createTechState(TECH_TREE);
    const per = effortPerTick(w);
    accrue(s, w, 3);
    accrue(s, w, 4);
    expect(s.effort).toBe(7 * per);
  });
});

describe('wellbeing composition (the real three-system effort)', () => {
  it('with the optional inputs ABSENT, degrades EXACTLY to the legacy formula', () => {
    // ONE outer floor over the summed terms ⇒ floor(a+b+0+0) == floor(a+b).
    for (const cs of [[], [200, 200, 200], [255, 1, 128, 64], new Array(40).fill(90)]) {
      expect(effortPerTick(world(cs))).toBe(legacyEffort(cs));
    }
  });

  it('is non-decreasing and strictly-increasing across an ECO mean step', () => {
    const base = world(new Array(8).fill(200));
    const lo: EffortWorld = { ...base, ecoMeans: { soil: 0, flora: 0, fauna: 0 } };
    // floored ecoMean crosses a /48 bucket: (200*3)/3 = 200 ⇒ +200/48 ≈ +4 to the sum
    const hi: EffortWorld = { ...base, ecoMeans: { soil: 200, flora: 200, fauna: 200 } };
    expect(wellbeing(hi)).toBeGreaterThanOrEqual(wellbeing(lo));
    expect(wellbeing(hi)).toBeGreaterThan(wellbeing(lo));
  });

  it('is non-decreasing and strictly-increasing across a CIVIC mean step', () => {
    const base = world(new Array(8).fill(200));
    const lo: EffortWorld = { ...base, civicMeans: { belonging: 0, voice: 0, trust: 0 } };
    // civicMean 120 ⇒ +120/24 = +5 to the sum, crosses a /24 bucket
    const hi: EffortWorld = { ...base, civicMeans: { belonging: 120, voice: 120, trust: 120 } };
    expect(wellbeing(hi)).toBeGreaterThanOrEqual(wellbeing(lo));
    expect(wellbeing(hi)).toBeGreaterThan(wellbeing(lo));
  });

  it('floors the FLOAT means inside ecoMean/civicMean and stays integer', () => {
    const base = world([200, 200, 200, 200]);
    // ecoMean = floor((50.7+60.2+70.9)/3) = floor(60.6) = 60; civicMean = floor((90.4+90.1+90.0)/3)=90
    const w: EffortWorld = {
      ...base,
      ecoMeans: { soil: 50.7, flora: 60.2, fauna: 70.9 },
      civicMeans: { belonging: 90.4, voice: 90.1, trust: 90.0 },
    };
    const alive = 4;
    const condMean = 200;
    const expected = Math.floor(alive / 8 + condMean / 32 + Math.floor(60.6) / 48 + 90 / 24);
    expect(wellbeing(w)).toBe(expected);
    expect(Number.isInteger(wellbeing(w))).toBe(true);
    expect(Number.isInteger(effortPerTick(w))).toBe(true);
  });

  it('zero-parcel world is still EXACTLY 1 when the optional inputs are absent', () => {
    expect(effortPerTick(world([]))).toBe(1);
  });

  it('effortPerTick is max(1, wellbeing) — the pulse line reads the same scalar', () => {
    const w = world(new Array(8).fill(200));
    expect(effortPerTick(w)).toBe(Math.max(1, wellbeing(w)));
  });
});

describe('effort.ts source', () => {
  it('no longer carries the PLACEHOLDER banner and documents the composition', () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const src = fs.readFileSync(path.resolve(here, '../../src/tech/effort.ts'), 'utf8');
    expect(src).not.toMatch(/PLACEHOLDER/);
    expect(src).toMatch(/wellbeing/i);
  });
});
