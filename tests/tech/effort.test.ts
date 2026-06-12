import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { effortPerTick, accrue } from '../../src/tech/effort';
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

describe('effort.ts source', () => {
  it('carries a PLACEHOLDER banner (the formula is provisional)', () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const src = fs.readFileSync(path.resolve(here, '../../src/tech/effort.ts'), 'utf8');
    expect(src).toMatch(/PLACEHOLDER/);
  });
});
