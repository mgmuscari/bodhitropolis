import { describe, it, expect } from 'vitest';
import {
  Branch,
  TECH_TREE,
  validateTree,
  prereqClosure,
  type TechNode,
} from '../../src/tech/tree';
import { createTechState } from '../../src/tech/state';
import { BuiltKind } from '../../src/engine/fabric';

// Every node id that the design brief names. Doubles as a completeness check:
// the tree must contain exactly these, no more, no fewer.
const DESIGN_BRIEF_IDS = [
  // NewUrbanism
  'walkable-streets', 'road-diets', 'parklets', 'quiet-streets',
  'urban-promenades', 'streetcar-revival', 'pocket-parks',
  // GreenDevelopment
  'soil-and-soul', 'urban-composting', 'community-gardens', 'vertical-farming',
  'wastewater-recycling', 'rewilding',
  // RestorativeJustice
  'circles', 'community-land-trust', 'healing-commons', 'participatory-budgeting',
  // IntentionalCommunities
  'shared-table', 'adus', 'coop-housing', 'maker-spaces',
  // GiftEconomy
  'gift-circles', 'urban-bazaars', 'craft-fairs', 'bike-shares',
  // Solarpunk
  'sun-and-wire', 'renewable-energy', 'local-grids', 'community-energy-nodes',
  'bike-paths', 'elevated-rail', 'drone-deliveries',
  'wind-power', 'solar-arrays', 'fusion-power',
  // AnarchoCommunism
  'mutual-aid', 'collective-ownership', 'communes', 'community-ai-nodes',
];

const KEBAB = /^[a-z0-9]+(-[a-z0-9]+)*$/;

// --- synthetic-tree helpers (for validateTree self-checks) -----------------
function cap(id: string, prereqs: string[] = []): TechNode {
  return { id, branch: Branch.NewUrbanism, name: id, flavor: 'x', prereqs, cost: 10, grants: { capabilities: [id] } };
}

describe('TECH_TREE shape', () => {
  it('has 39 nodes', () => {
    expect(TECH_TREE.length).toBe(39);
  });

  it('contains exactly the design-brief node ids', () => {
    const ids = TECH_TREE.map((n) => n.id).sort();
    expect(ids).toEqual([...DESIGN_BRIEF_IDS].sort());
  });

  it('uses kebab-case ids, ≤90-char flavor, positive integer costs', () => {
    for (const n of TECH_TREE) {
      expect(KEBAB.test(n.id), `${n.id} is not kebab-case`).toBe(true);
      expect(n.flavor.length, `${n.id} flavor too long`).toBeLessThanOrEqual(90);
      expect(n.flavor.length).toBeGreaterThan(0);
      expect(Number.isInteger(n.cost) && n.cost > 0, `${n.id} bad cost`).toBe(true);
    }
  });

  it('covers every branch with at least 2 nodes', () => {
    const counts = new Map<string, number>();
    for (const n of TECH_TREE) counts.set(n.branch, (counts.get(n.branch) ?? 0) + 1);
    expect(counts.size).toBe(Object.keys(Branch).length); // all 7 branches present
    for (const [branch, c] of counts) {
      expect(c, `branch ${branch} has < 2 nodes`).toBeGreaterThanOrEqual(2);
    }
  });

  it('has at least 3 cross-branch prereq edges (actual count is higher)', () => {
    const byId = new Map(TECH_TREE.map((n) => [n.id, n]));
    let cross = 0;
    for (const n of TECH_TREE) {
      for (const p of n.prereqs) {
        const pre = byId.get(p);
        if (pre && pre.branch !== n.branch) cross++;
      }
    }
    expect(cross).toBeGreaterThanOrEqual(3);
  });
});

describe('validateTree on the real tree', () => {
  it('reports no violations for TECH_TREE', () => {
    expect(validateTree(TECH_TREE)).toEqual([]);
  });
});

describe('rezoning tech nodes (pocket-parks + rewilding)', () => {
  it('grants Park after unlocking the pocket-parks chain (prereq parklets)', () => {
    const tech = createTechState(TECH_TREE);
    tech.effort = 1000;
    for (const id of ['walkable-streets', 'road-diets', 'parklets', 'pocket-parks']) {
      expect(tech.unlock(id), `unlock ${id}`).toBe(true);
    }
    expect(tech.grantedKinds().has(BuiltKind.Park)).toBe(true);
  });

  it('grants RewildedLand after unlocking the rewilding chain (prereq community-gardens)', () => {
    const tech = createTechState(TECH_TREE);
    tech.effort = 1000;
    for (const id of [
      'soil-and-soul', 'urban-composting', 'walkable-streets', 'road-diets',
      'community-gardens', 'rewilding',
    ]) {
      expect(tech.unlock(id), `unlock ${id}`).toBe(true);
    }
    expect(tech.grantedKinds().has(BuiltKind.RewildedLand)).toBe(true);
  });
});

describe('validateTree self-checks (synthetic bad trees)', () => {
  it('flags a duplicate id', () => {
    const bad = [cap('a'), cap('a')];
    expect(validateTree(bad).length).toBeGreaterThan(0);
  });

  it('flags a dangling prereq', () => {
    const bad = [cap('a', ['missing'])];
    expect(validateTree(bad).some((v) => /missing/.test(v))).toBe(true);
  });

  it('flags a cycle', () => {
    const bad = [cap('a', ['b']), cap('b', ['a'])];
    expect(validateTree(bad).some((v) => /cycle/i.test(v))).toBe(true);
  });

  it('flags a kind granted by more than one node', () => {
    const bad: TechNode[] = [
      { id: 'a', branch: Branch.NewUrbanism, name: 'a', flavor: 'x', prereqs: [], cost: 10, grants: { kinds: [BuiltKind.Parklet] } },
      { id: 'b', branch: Branch.NewUrbanism, name: 'b', flavor: 'x', prereqs: [], cost: 10, grants: { kinds: [BuiltKind.Parklet] } },
    ];
    expect(validateTree(bad).some((v) => /grant/i.test(v))).toBe(true);
  });

  it('flags a grant of an invalid BuiltKind code', () => {
    const bad: TechNode[] = [
      { id: 'a', branch: Branch.NewUrbanism, name: 'a', flavor: 'x', prereqs: [], cost: 10, grants: { kinds: [999 as unknown as BuiltKind] } },
    ];
    expect(validateTree(bad).some((v) => /999|invalid|BuiltKind/i.test(v))).toBe(true);
  });

  it('flags a node whose prereq closure never reaches a root', () => {
    // x -> y -> z -> y : y,z form a cycle; x is downstream and never reaches a root.
    const bad = [cap('x', ['y']), cap('y', ['z']), cap('z', ['y'])];
    expect(validateTree(bad).some((v) => /'x'/.test(v) && /root/i.test(v))).toBe(true);
  });

  it('flags a non-kebab id (the snapshot encoding relies on ASCII ids)', () => {
    // snapshotBytes encodes ids with charCodeAt & 0xff; runtime-enforcing the
    // kebab/ASCII charset keeps that byte-identical to UTF-8.
    const bad: TechNode[] = [
      { id: 'Bad_Id', branch: Branch.NewUrbanism, name: 'b', flavor: 'x', prereqs: [], cost: 10, grants: { capabilities: ['c'] } },
    ];
    expect(validateTree(bad).some((v) => /Bad_Id|kebab|id/i.test(v))).toBe(true);
  });
});

describe('root-termination reachability (cross-branch)', () => {
  it("accepts drone-deliveries whose only direct prereq is in another branch", () => {
    const byId = new Map(TECH_TREE.map((n) => [n.id, n]));
    const drone = byId.get('drone-deliveries')!;
    expect(drone.branch).toBe(Branch.Solarpunk);
    // its only direct prereq is community-ai-nodes, in AnarchoCommunism
    expect(drone.prereqs).toEqual(['community-ai-nodes']);
    expect(byId.get('community-ai-nodes')!.branch).toBe(Branch.AnarchoCommunism);

    const closure = prereqClosure(TECH_TREE, 'drone-deliveries');
    expect(closure.has('community-ai-nodes')).toBe(true);
    // the closure terminates at no-prereq roots (possibly in several branches)
    const roots = [...closure].filter((id) => byId.get(id)!.prereqs.length === 0);
    expect(roots.length).toBeGreaterThan(0);
    for (const id of roots) expect(byId.get(id)!.prereqs).toEqual([]);
  });
});
