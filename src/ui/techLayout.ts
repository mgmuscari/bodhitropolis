// Civ-style tech-tree layout: turn the prereq DAG into a positioned graph the
// panel draws with connector lines. Each node sits in a COLUMN equal to its
// dependency DEPTH (longest prereq chain from a root), so roots are on the left and
// each tech sits to the right of everything it needs; within a column, nodes are
// ordered by branch then cost for a stable vertical layout. Edges are the
// prereq→node pairs the shell draws as lines. Pure — no DOM, no transcendental
// Math (on the architecture pure-ui allowlist) — so the layout is unit-tested.

import { Branch, type TechNode } from '../tech/tree';
import type { TechState } from '../tech/state';
import { BRANCH_ORDER, nodeViewOf, type NodeView } from './techContent';

/** One positioned node: its display view, branch, and grid cell (col = depth). */
export interface TechLayoutNode {
  view: NodeView;
  branch: Branch;
  col: number;
  row: number;
}

/** A prereq edge: an arrow from `from` (the prereq) to `to` (the dependent node). */
export interface TechEdge {
  from: string;
  to: string;
}

export interface TechLayout {
  nodes: TechLayoutNode[];
  edges: TechEdge[];
  /** Grid extent — the shell sizes the scroll canvas from these. */
  cols: number;
  rows: number;
}

const BRANCH_INDEX = new Map<Branch, number>(BRANCH_ORDER.map((b, i) => [b, i]));

/**
 * Dependency depth of every node: 0 for a root (no prereqs), else 1 + the max depth
 * of its prereqs. Memoized; cycle-safe via an in-progress guard (the tree is
 * validated acyclic, but a malformed tree must still terminate). Dangling prereqs
 * (not in `byId`) contribute depth -1 so they don't inflate the chain.
 */
function computeDepths(nodes: readonly TechNode[], byId: ReadonlyMap<string, TechNode>): Map<string, number> {
  const depth = new Map<string, number>();
  const inProgress = new Set<string>();
  const visit = (id: string): number => {
    const cached = depth.get(id);
    if (cached !== undefined) return cached;
    const n = byId.get(id);
    if (!n) return -1; // dangling
    if (inProgress.has(id)) return 0; // cycle backstop
    inProgress.add(id);
    let d = 0;
    for (const p of n.prereqs) {
      const pd = visit(p);
      if (pd + 1 > d) d = pd + 1;
    }
    inProgress.delete(id);
    depth.set(id, d);
    return d;
  };
  for (const n of nodes) visit(n.id);
  return depth;
}

/**
 * Lay the tech tree out as a left→right DAG. Returns positioned nodes (col = depth,
 * row = slot within that depth column ordered by branch then cost then id) and the
 * prereq edges, plus the grid extent. Deterministic in (tree, state).
 */
export function techLayout(tree: readonly TechNode[], state: TechState): TechLayout {
  const byId = new Map(tree.map((n) => [n.id, n]));
  const depth = computeDepths(tree, byId);

  // Bucket nodes by depth (column), then order each column for a stable layout.
  const byCol = new Map<number, TechNode[]>();
  let cols = 0;
  for (const n of tree) {
    const c = depth.get(n.id) ?? 0;
    if (c + 1 > cols) cols = c + 1;
    const bucket = byCol.get(c);
    if (bucket) bucket.push(n);
    else byCol.set(c, [n]);
  }

  const nodes: TechLayoutNode[] = [];
  let rows = 0;
  for (let c = 0; c < cols; c++) {
    const bucket = byCol.get(c) ?? [];
    bucket.sort((a, b) => {
      const ba = BRANCH_INDEX.get(a.branch) ?? 0;
      const bb = BRANCH_INDEX.get(b.branch) ?? 0;
      if (ba !== bb) return ba - bb;
      if (a.cost !== b.cost) return a.cost - b.cost;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });
    if (bucket.length > rows) rows = bucket.length;
    bucket.forEach((n, row) => {
      nodes.push({ view: nodeViewOf(n, byId, state), branch: n.branch, col: c, row });
    });
  }

  const edges: TechEdge[] = [];
  for (const n of tree) {
    for (const p of n.prereqs) {
      if (byId.has(p)) edges.push({ from: p, to: n.id });
    }
  }

  return { nodes, edges, cols, rows };
}
