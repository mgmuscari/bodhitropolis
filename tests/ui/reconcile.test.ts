import { describe, it, expect } from 'vitest';
import { reconcilePlan } from '../../src/ui/reconcile';

// The automated lock on the "defining regression" decision: the shell rebuilds
// nodes ONLY per this plan, so an empty insert/remove proves no recreation (no
// click-eating churn). Keyed on id alone, so a visual-only change is no churn.

describe('reconcilePlan', () => {
  it('IDENTITY: unchanged ids → empty insert/remove, order == ids', () => {
    const plan = reconcilePlan(['a', 'b', 'c'], [{ id: 'a' }, { id: 'b' }, { id: 'c' }]);
    expect(plan.insert).toEqual([]);
    expect(plan.remove).toEqual([]);
    expect(plan.order).toEqual(['a', 'b', 'c']);
  });

  it('keys ONLY on id: a visual-only change (same ids) → empty insert/remove', () => {
    // rows carry selection/affordability fields that flipped; ids are unchanged.
    const prev = ['a', 'b'];
    const rows = [
      { id: 'a', selected: true, affordable: false },
      { id: 'b', selected: false, affordable: true },
    ];
    const plan = reconcilePlan(prev, rows);
    expect(plan.insert).toEqual([]);
    expect(plan.remove).toEqual([]);
    expect(plan.order).toEqual(['a', 'b']);
  });

  it('GROWTH: insert == exactly the new ids; order includes them in row order', () => {
    const plan = reconcilePlan(['a'], [{ id: 'a' }, { id: 'b' }, { id: 'c' }]);
    expect(plan.insert).toEqual(['b', 'c']);
    expect(plan.remove).toEqual([]);
    expect(plan.order).toEqual(['a', 'b', 'c']);
  });

  it('inserts a mid-list id in row order (monotonic-growth real case)', () => {
    const plan = reconcilePlan(['a', 'c'], [{ id: 'a' }, { id: 'b' }, { id: 'c' }]);
    expect(plan.insert).toEqual(['b']);
    expect(plan.remove).toEqual([]);
    expect(plan.order).toEqual(['a', 'b', 'c']);
  });

  it('REMOVAL: remove == exactly the gone ids', () => {
    const plan = reconcilePlan(['a', 'b', 'c'], [{ id: 'a' }, { id: 'c' }]);
    expect(plan.insert).toEqual([]);
    expect(plan.remove).toEqual(['b']);
    expect(plan.order).toEqual(['a', 'c']);
  });

  it('REORDER: same id set, new order → empty insert/remove, order reflects new order', () => {
    const plan = reconcilePlan(['a', 'b', 'c'], [{ id: 'c' }, { id: 'a' }, { id: 'b' }]);
    expect(plan.insert).toEqual([]);
    expect(plan.remove).toEqual([]);
    expect(plan.order).toEqual(['c', 'a', 'b']);
  });

  it('simultaneous insert and remove report disjointly', () => {
    const plan = reconcilePlan(['a', 'b'], [{ id: 'a' }, { id: 'c' }]);
    expect(plan.insert).toEqual(['c']);
    expect(plan.remove).toEqual(['b']);
    expect(plan.order).toEqual(['a', 'c']);
  });

  it('is a deterministic pure function of its inputs', () => {
    const a = reconcilePlan(['a'], [{ id: 'a' }, { id: 'b' }]);
    const b = reconcilePlan(['a'], [{ id: 'a' }, { id: 'b' }]);
    expect(a).toEqual(b);
  });
});
