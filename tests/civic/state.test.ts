import { describe, it, expect } from 'vitest';
import {
  createCivicState,
  SEED_BELONGING,
  SEED_VOICE,
  SEED_TRUST,
  RING_SIZE,
} from '../../src/civic/state';
import type { NeighborhoodMap } from '../../src/civic/neighborhoods';

// Build a synthetic NeighborhoodMap from a tile→id array. remap reads only
// tileToNeighborhood (both sides) and newPartition.neighborhoods.length;
// createCivicState reads partition.neighborhoods.length — so these literals are
// sufficient to drive the carryover rule without a real map.
function mkPartition(t2n: number[], count: number): NeighborhoodMap {
  return {
    tileToNeighborhood: Uint16Array.from(t2n),
    neighborhoods: Array.from({ length: count }, (_, k) => ({
      id: k + 1,
      anchor: t2n.indexOf(k + 1),
      tileCount: t2n.filter((v) => v === k + 1).length,
      parcelTiles: 0,
    })),
  };
}

describe('createCivicState: seeding', () => {
  it('seeds every neighborhood to the named mid-low constants with an empty ring', () => {
    const p = mkPartition([1, 1, 2], 2);
    const civic = createCivicState(p);
    expect(civic.count()).toBe(2);
    for (const id of [1, 2]) {
      expect(civic.getValues(id)).toEqual({
        belonging: SEED_BELONGING,
        voice: SEED_VOICE,
        trust: SEED_TRUST,
      });
      expect(civic.getRing(id)).toEqual([]);
    }
  });

  it('a zero-neighborhood partition yields an empty, snapshot-stable state', () => {
    const civic = createCivicState(mkPartition([0, 0], 0));
    expect(civic.count()).toBe(0);
    expect(civic.snapshotBytes()).toEqual(createCivicState(mkPartition([], 0)).snapshotBytes());
  });
});

describe('CivicState snapshot determinism', () => {
  it('is byte-equal for identical state and divergent for a changed value', () => {
    const p = mkPartition([1, 2], 2);
    const a = createCivicState(p);
    const b = createCivicState(p);
    expect(a.snapshotBytes()).toEqual(b.snapshotBytes());
    b.setValues(1, { belonging: 81, voice: 40, trust: 90 });
    expect(a.snapshotBytes()).not.toEqual(b.snapshotBytes());
  });

  it('reflects ring contents in the snapshot', () => {
    const p = mkPartition([1], 1);
    const a = createCivicState(p);
    const snap0 = a.snapshotBytes();
    a.recordRepair(1, 100);
    expect(a.snapshotBytes()).not.toEqual(snap0);
  });
});

describe('CivicState.recordRepair', () => {
  it('stores ticks newest-first and caps at RING_SIZE', () => {
    const civic = createCivicState(mkPartition([1], 1));
    for (let t = 1; t <= RING_SIZE + 3; t++) civic.recordRepair(1, t * 10);
    const ring = civic.getRing(1);
    expect(ring.length).toBe(RING_SIZE);
    // newest-first, the oldest (lowest) ticks evicted
    expect(ring[0]).toBe((RING_SIZE + 3) * 10);
    expect(ring).toEqual([...ring].sort((a, b) => b - a)); // descending
    expect(Math.min(...ring)).toBeGreaterThan(30); // the first three (10,20,30) evicted
  });

  it('id 0 is a safe no-op (no throw, no state change)', () => {
    const civic = createCivicState(mkPartition([1], 1));
    const snap = civic.snapshotBytes();
    expect(() => civic.recordRepair(0, 50)).not.toThrow();
    expect(civic.snapshotBytes()).toEqual(snap);
  });

  it('an out-of-range / unknown id is a safe no-op (no throw, no state change)', () => {
    const civic = createCivicState(mkPartition([1], 1));
    const snap = civic.snapshotBytes();
    expect(() => civic.recordRepair(99, 50)).not.toThrow();
    expect(() => civic.recordRepair(-3, 50)).not.toThrow();
    expect(civic.snapshotBytes()).toEqual(snap);
  });
});

describe('CivicState.remap: tile-count-weighted carryover (ONE rule)', () => {
  it('SPLIT (one parent) reduces to the parent EXACT value, copying its ring', () => {
    // old: one neighborhood over tiles 0..3; new: two neighborhoods carved from it.
    const oldP = mkPartition([1, 1, 1, 1], 1);
    const newP = mkPartition([1, 1, 2, 2], 2);
    const civic = createCivicState(oldP);
    civic.setValues(1, { belonging: 137, voice: 33, trust: 211 });
    civic.recordRepair(1, 500);
    civic.remap(oldP, newP);
    expect(civic.count()).toBe(2);
    for (const id of [1, 2]) {
      expect(civic.getValues(id)).toEqual({ belonging: 137, voice: 33, trust: 211 });
      expect(civic.getRing(id)).toEqual([500]); // ring copied to both children
    }
  });

  it('MERGE (multiple parents) is the tile-WEIGHTED floor, NOT a simple average', () => {
    // 100 tiles from old-1, 4 tiles from old-2, merged into new-1.
    const oldT: number[] = [];
    for (let i = 0; i < 100; i++) oldT.push(1);
    for (let i = 0; i < 4; i++) oldT.push(2);
    const oldP = mkPartition(oldT, 2);
    const newP = mkPartition(new Array(104).fill(1), 1);
    const civic = createCivicState(oldP);
    civic.setValues(1, { belonging: 200, voice: 100, trust: 200 });
    civic.setValues(2, { belonging: 50, voice: 10, trust: 50 });
    civic.remap(oldP, newP);
    // floor((100*200 + 4*50)/104) = floor(20200/104) = 194 (not the simple mean 125)
    expect(civic.getValues(1)).toEqual({
      belonging: Math.floor((100 * 200 + 4 * 50) / 104), // 194
      voice: Math.floor((100 * 100 + 4 * 10) / 104), // 96
      trust: Math.floor((100 * 200 + 4 * 50) / 104), // 194
    });
    expect(civic.getValues(1).belonging).toBe(194);
    expect(civic.getValues(1).belonging).not.toBe(125); // explicitly not the simple average
  });

  it('ZERO-PARENT (all-fresh genesis cluster) seeds to the named constants, empty ring', () => {
    // oldP: neighborhood 1 over tiles 0,1; tiles 2,3 are fresh (old id 0).
    const oldP = mkPartition([1, 1, 0, 0], 1);
    // newP: new-1 occupies ONLY the fresh tiles 2,3 — so it has no parent.
    const newP = mkPartition([0, 0, 1, 1], 1);
    const civic = createCivicState(oldP);
    civic.setValues(1, { belonging: 200, voice: 200, trust: 200 });
    civic.recordRepair(1, 400);
    civic.remap(oldP, newP);
    expect(civic.getValues(1)).toEqual({
      belonging: SEED_BELONGING,
      voice: SEED_VOICE,
      trust: SEED_TRUST,
    });
    expect(civic.getRing(1)).toEqual([]); // zero-parent → empty ring
  });

  it('MIXED parent+fresh excludes fresh tiles from BOTH numerator and denominator', () => {
    // new-1: 50 tiles from old-1 (belonging 100) + 50 FRESH tiles (old id 0).
    const oldT: number[] = [];
    for (let i = 0; i < 50; i++) oldT.push(1);
    for (let i = 0; i < 50; i++) oldT.push(0); // fresh
    const oldP = mkPartition(oldT, 1);
    const newP = mkPartition(new Array(100).fill(1), 1);
    const civic = createCivicState(oldP);
    civic.setValues(1, { belonging: 100, voice: 100, trust: 100 });
    civic.remap(oldP, newP);
    // fresh excluded → floor(50*100/50) = 100, NOT floor(50*100/100)=50
    expect(civic.getValues(1).belonging).toBe(100);
  });

  it('IDENTITY remap (same partition) is byte-equal', () => {
    const p = mkPartition([1, 1, 2, 2], 2);
    const civic = createCivicState(p);
    civic.setValues(1, { belonging: 111, voice: 22, trust: 222 });
    civic.setValues(2, { belonging: 64, voice: 12, trust: 88 });
    civic.recordRepair(1, 300);
    civic.recordRepair(2, 250);
    civic.recordRepair(2, 260);
    const before = civic.snapshotBytes();
    civic.remap(p, p);
    expect(civic.snapshotBytes()).toEqual(before);
  });
});

describe('CivicState.remap: ring merge order + cap + tie-break determinism', () => {
  it('keeps the 8 newest ticks across parents, descending', () => {
    const oldP = mkPartition([1, 1, 2, 2], 2);
    const newP = mkPartition([1, 1, 1, 1], 1); // merge both into new-1
    const civic = createCivicState(oldP);
    for (const t of [10, 30, 50, 70]) civic.recordRepair(1, t);
    for (const t of [20, 40, 60, 80, 90, 100]) civic.recordRepair(2, t);
    civic.remap(oldP, newP);
    const ring = civic.getRing(1);
    expect(ring.length).toBe(RING_SIZE);
    expect(ring).toEqual([100, 90, 80, 70, 60, 50, 40, 30]); // 8 newest, descending; 10,20 dropped
  });

  it('equal-tick merges are deterministic (double-run byte-equal)', () => {
    const oldP = mkPartition([1, 1, 2, 2], 2);
    const newP = mkPartition([1, 1, 1, 1], 1);
    const build = (): Uint8Array => {
      const c = createCivicState(oldP);
      for (let i = 0; i < 5; i++) c.recordRepair(1, 5);
      for (let i = 0; i < 6; i++) c.recordRepair(2, 5);
      c.remap(oldP, newP);
      return c.snapshotBytes();
    };
    expect(build()).toEqual(build());
    // 11 entries all tick 5, capped to 8 → all tick 5.
    const c = createCivicState(oldP);
    for (let i = 0; i < 5; i++) c.recordRepair(1, 5);
    for (let i = 0; i < 6; i++) c.recordRepair(2, 5);
    c.remap(oldP, newP);
    expect(c.getRing(1)).toEqual(new Array(RING_SIZE).fill(5));
  });
});
