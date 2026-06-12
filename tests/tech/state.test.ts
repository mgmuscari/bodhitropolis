import { describe, it, expect } from 'vitest';
import { createTechState } from '../../src/tech/state';
import { TECH_TREE } from '../../src/tech/tree';
import { BuiltKind } from '../../src/engine/fabric';

// Drive a fresh state through a sequence, funding it with startEffort first.
function run(seq: string[], startEffort: number): Uint8Array {
  const s = createTechState(TECH_TREE);
  s.effort = startEffort;
  for (const id of seq) s.unlock(id);
  return s.snapshotBytes();
}

describe('TechState canUnlock reasons', () => {
  it("returns reason 'unknown' for an id not in the tree", () => {
    const s = createTechState(TECH_TREE);
    s.effort = 1000;
    const r = s.canUnlock('no-such-node');
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('unknown');
  });

  it("returns reason 'unlocked' for an already-unlocked node", () => {
    const s = createTechState(TECH_TREE);
    s.effort = 1000;
    expect(s.unlock('walkable-streets')).toBe(true);
    const r = s.canUnlock('walkable-streets');
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('unlocked');
  });

  it("returns reason 'prereqs' when prereqs are unmet (even with ample effort)", () => {
    const s = createTechState(TECH_TREE);
    s.effort = 1000;
    const r = s.canUnlock('road-diets'); // needs walkable-streets
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('prereqs');
  });

  it("returns reason 'effort' when prereqs are met but effort is short", () => {
    const s = createTechState(TECH_TREE);
    s.effort = 0; // walkable-streets is a root (no prereqs), cost 10
    const r = s.canUnlock('walkable-streets');
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('effort');
  });

  it('returns ok for a root once funded', () => {
    const s = createTechState(TECH_TREE);
    s.effort = 10;
    expect(s.canUnlock('walkable-streets')).toEqual({ ok: true });
  });
});

describe('TechState unlock', () => {
  it('spends exactly the cost and grants the capability', () => {
    const s = createTechState(TECH_TREE);
    s.effort = 50;
    expect(s.hasCapability('walkability')).toBe(false);
    expect(s.unlock('walkable-streets')).toBe(true); // cost 10
    expect(s.effort).toBe(40);
    expect(s.hasCapability('walkability')).toBe(true);
    expect(s.unlocked.has('walkable-streets')).toBe(true);
  });

  it('grants build kinds on a kind node', () => {
    const s = createTechState(TECH_TREE);
    s.effort = 50;
    expect(s.unlock('sun-and-wire')).toBe(true); // prereq for bike-paths
    expect(s.unlock('bike-paths')).toBe(true); // grants BikePath
    expect(s.grantedKinds().has(BuiltKind.BikePath)).toBe(true);
    expect(s.grantedKinds().has(BuiltKind.Streetcar)).toBe(false);
  });

  it('rejects a double-unlock without mutating state', () => {
    const s = createTechState(TECH_TREE);
    s.effort = 50;
    expect(s.unlock('walkable-streets')).toBe(true);
    const effortAfter = s.effort;
    const snap = s.snapshotBytes();
    expect(s.unlock('walkable-streets')).toBe(false);
    expect(s.effort).toBe(effortAfter);
    expect(s.snapshotBytes()).toEqual(snap);
  });

  it('rejects an unlock with unmet prereqs without mutating state', () => {
    const s = createTechState(TECH_TREE);
    s.effort = 1000;
    const snap = s.snapshotBytes();
    expect(s.unlock('road-diets')).toBe(false); // needs walkable-streets
    expect(s.snapshotBytes()).toEqual(snap);
    expect(s.unlocked.has('road-diets')).toBe(false);
  });

  it('enforces a prereq chain end-to-end (root -> mid -> leaf)', () => {
    const s = createTechState(TECH_TREE);
    s.effort = 100;
    expect(s.unlock('parklets')).toBe(false); // blocked: prereqs unmet
    expect(s.unlock('walkable-streets')).toBe(true);
    expect(s.unlock('road-diets')).toBe(true);
    expect(s.unlock('parklets')).toBe(true); // now allowed
    expect(s.grantedKinds().has(BuiltKind.Parklet)).toBe(true);
    expect(s.hasCapability('walkability')).toBe(true);
    expect(s.hasCapability('road-diets')).toBe(true);
  });

  it('enforces a cross-branch prereq (coop-housing needs AC collective-ownership)', () => {
    const s = createTechState(TECH_TREE);
    s.effort = 1000;
    expect(s.unlock('shared-table')).toBe(true);
    expect(s.unlock('adus')).toBe(true);
    // collective-ownership (AnarchoCommunism) is still locked
    expect(s.canUnlock('coop-housing').reason).toBe('prereqs');
    expect(s.unlock('coop-housing')).toBe(false);
  });
});

describe('TechState.spend (guarded single-writer beside unlock)', () => {
  it('debits exactly and returns true when affordable', () => {
    const s = createTechState(TECH_TREE);
    s.effort = 20;
    expect(s.spend(8)).toBe(true);
    expect(s.effort).toBe(12);
  });

  it('rejects an over-spend, mutating nothing (snapshotBytes unchanged)', () => {
    const s = createTechState(TECH_TREE);
    s.effort = 5;
    const snap = s.snapshotBytes();
    expect(s.spend(6)).toBe(false);
    expect(s.effort).toBe(5);
    expect(s.snapshotBytes()).toEqual(snap);
  });

  it('rejects a non-integer spend without mutation', () => {
    const s = createTechState(TECH_TREE);
    s.effort = 10;
    const snap = s.snapshotBytes();
    expect(s.spend(2.5)).toBe(false);
    expect(s.effort).toBe(10);
    expect(s.snapshotBytes()).toEqual(snap);
  });

  it('rejects a negative spend without mutation', () => {
    const s = createTechState(TECH_TREE);
    s.effort = 10;
    expect(s.spend(-3)).toBe(false);
    expect(s.effort).toBe(10);
  });

  it('allows an exact-to-zero spend', () => {
    const s = createTechState(TECH_TREE);
    s.effort = 7;
    expect(s.spend(7)).toBe(true);
    expect(s.effort).toBe(0);
  });
});

describe('TechState snapshot determinism', () => {
  it('is byte-equal for the same action sequence and start effort', () => {
    expect(run(['walkable-streets', 'road-diets'], 100)).toEqual(
      run(['walkable-streets', 'road-diets'], 100),
    );
  });

  it('differs for a divergent action sequence', () => {
    expect(run(['walkable-streets', 'road-diets'], 100)).not.toEqual(
      run(['walkable-streets'], 100),
    );
  });

  it('is order-independent: one fixed set, two valid orders -> byte-equal', () => {
    // Same final set {walkable-streets, road-diets, soil-and-soul}, same start
    // effort, two valid topo orders. Sorted-id snapshot + identical spent cost
    // (sum of the same node costs) => byte-equal.
    const orderA = ['walkable-streets', 'road-diets', 'soil-and-soul'];
    const orderB = ['soil-and-soul', 'walkable-streets', 'road-diets'];
    expect(run(orderA, 100)).toEqual(run(orderB, 100));
  });

  it('differs for a different final set (not just a reorder)', () => {
    const setA = ['walkable-streets', 'road-diets', 'soil-and-soul'];
    const setB = ['walkable-streets', 'soil-and-soul'];
    expect(run(setA, 100)).not.toEqual(run(setB, 100));
  });

  it('reflects effort in the snapshot (same set, different start effort -> different bytes)', () => {
    expect(run(['walkable-streets'], 100)).not.toEqual(run(['walkable-streets'], 200));
  });
});
