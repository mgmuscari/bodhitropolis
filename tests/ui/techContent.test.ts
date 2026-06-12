import { describe, it, expect } from 'vitest';
import {
  branchColumns,
  effortLine,
  shouldTogglePanel,
  type BranchColumn,
  type NodeView,
} from '../../src/ui/techContent';
import { Branch, TECH_TREE } from '../../src/tech/tree';
import { createTechState, TechState } from '../../src/tech/state';

const BRANCH_ORDER = [
  Branch.NewUrbanism,
  Branch.GreenDevelopment,
  Branch.RestorativeJustice,
  Branch.IntentionalCommunities,
  Branch.GiftEconomy,
  Branch.Solarpunk,
  Branch.AnarchoCommunism,
];

function find(cols: BranchColumn[], id: string): NodeView {
  for (const c of cols) {
    const n = c.nodes.find((v) => v.id === id);
    if (n) return n;
  }
  throw new Error(`node ${id} not found in columns`);
}

function fresh(effort = 0): TechState {
  const s = createTechState(TECH_TREE);
  s.effort = effort;
  return s;
}

describe('branchColumns structure', () => {
  it('produces 7 columns in the philosophy order', () => {
    const cols = branchColumns(TECH_TREE, fresh());
    expect(cols.map((c) => c.branch)).toEqual(BRANCH_ORDER);
  });

  it('carries a human-readable title per column', () => {
    const cols = branchColumns(TECH_TREE, fresh());
    const titles = new Map(cols.map((c) => [c.branch, c.title]));
    expect(titles.get(Branch.NewUrbanism)).toBe('New Urbanism');
    expect(titles.get(Branch.AnarchoCommunism)).toBe('Anarcho-Communism');
  });

  it('orders nodes roots-first then by ascending cost', () => {
    const cols = branchColumns(TECH_TREE, fresh());
    const nu = cols.find((c) => c.branch === Branch.NewUrbanism)!;
    expect(nu.nodes[0]!.id).toBe('walkable-streets'); // the only root, first
    const restCosts = nu.nodes.slice(1).map((n) => n.cost);
    const sorted = [...restCosts].sort((a, b) => a - b);
    expect(restCosts).toEqual(sorted); // non-roots ascend by cost
  });

  it('includes every tree node exactly once across all columns', () => {
    const cols = branchColumns(TECH_TREE, fresh());
    const ids = cols.flatMap((c) => c.nodes.map((n) => n.id)).sort();
    expect(ids).toEqual(TECH_TREE.map((n) => n.id).sort());
  });
});

describe('node status transitions', () => {
  it('walks locked -> affordable -> unlocked as effort and prereqs change', () => {
    const s = fresh(0);
    expect(find(branchColumns(TECH_TREE, s), 'walkable-streets').status).toBe('locked');

    s.effort = 10;
    expect(find(branchColumns(TECH_TREE, s), 'walkable-streets').status).toBe('affordable');

    s.unlock('walkable-streets'); // spends 10, effort back to 0
    expect(find(branchColumns(TECH_TREE, s), 'walkable-streets').status).toBe('unlocked');

    // road-diets: prereq now met but effort short => locked (not affordable)
    expect(find(branchColumns(TECH_TREE, s), 'road-diets').status).toBe('locked');
    s.effort = 15;
    expect(find(branchColumns(TECH_TREE, s), 'road-diets').status).toBe('affordable');
  });
});

describe('missing prereqs are named (not id)', () => {
  it('lists the unmet prereq by display name and empties when met', () => {
    const s = fresh(0);
    const parklets0 = find(branchColumns(TECH_TREE, s), 'parklets');
    expect(parklets0.missing).toEqual(['Road Diets']); // name, not 'road-diets'

    s.effort = 1000;
    s.unlock('walkable-streets');
    s.unlock('road-diets');
    const parklets1 = find(branchColumns(TECH_TREE, s), 'parklets');
    expect(parklets1.missing).toEqual([]);
  });

  it('names cross-branch prereqs in prereq order', () => {
    const s = fresh(0);
    const coop = find(branchColumns(TECH_TREE, s), 'coop-housing');
    // prereqs ['adus', 'collective-ownership'] -> their display names, in order
    expect(coop.missing).toEqual(['Accessory Dwellings', 'Collective Ownership']);
  });
});

describe('effortLine', () => {
  it('reflects the current effort and stays <= 90 chars', () => {
    const s = fresh(42);
    const line = effortLine(s);
    expect(line).toMatch(/42/);
    expect(line.length).toBeLessThanOrEqual(90);
  });
});

describe('shouldTogglePanel gate', () => {
  it('is true for t/T only when no overlay is active', () => {
    expect(shouldTogglePanel('t', false)).toBe(true);
    expect(shouldTogglePanel('T', false)).toBe(true);
  });

  it('is false for t/T while an overlay is active', () => {
    expect(shouldTogglePanel('t', true)).toBe(false);
    expect(shouldTogglePanel('T', true)).toBe(false);
  });

  it('is false for any non-toggle key regardless of overlay', () => {
    expect(shouldTogglePanel('x', false)).toBe(false);
    expect(shouldTogglePanel('Enter', false)).toBe(false);
    expect(shouldTogglePanel('Escape', true)).toBe(false);
    expect(shouldTogglePanel('', false)).toBe(false);
  });
});

describe('purity / determinism', () => {
  it('returns deeply equal output for equal inputs', () => {
    const s = fresh(30);
    expect(branchColumns(TECH_TREE, s)).toEqual(branchColumns(TECH_TREE, s));
  });

  it('keeps every node name and flavor <= 90 chars', () => {
    for (const c of branchColumns(TECH_TREE, fresh())) {
      expect(c.title.length).toBeLessThanOrEqual(90);
      for (const n of c.nodes) {
        expect(n.name.length).toBeLessThanOrEqual(90);
        expect(n.flavor.length).toBeLessThanOrEqual(90);
      }
    }
  });
});
