// Tech-panel content: pure presentation that turns (tree, state) into the view
// models the DOM shell will render. No DOM, no transcendental Math — the
// architecture guard's pure-ui allowlist scans this file (tests/architecture.test.ts).
// Keeping the derivation here, not in the shell, lets the panel's status logic and
// the overlay-suppression gate be unit-tested rather than left to manual QA.

import { Branch, type TechNode } from '../tech/tree';
import type { TechState } from '../tech/state';

export type NodeStatus = 'locked' | 'affordable' | 'unlocked';

/** One node's display state. `missing` names the unmet prereqs (by name, not id). */
export interface NodeView {
  id: string;
  name: string;
  flavor: string;
  cost: number;
  status: NodeStatus;
  missing: string[];
}

/** One branch column: a philosophy and its nodes in display order. */
export interface BranchColumn {
  branch: Branch;
  title: string;
  nodes: NodeView[];
}

// Columns render in the order the design presents the philosophies.
const BRANCH_ORDER: readonly Branch[] = [
  Branch.NewUrbanism,
  Branch.GreenDevelopment,
  Branch.RestorativeJustice,
  Branch.IntentionalCommunities,
  Branch.GiftEconomy,
  Branch.Solarpunk,
  Branch.AnarchoCommunism,
];

const BRANCH_TITLES: Record<Branch, string> = {
  [Branch.NewUrbanism]: 'New Urbanism',
  [Branch.GreenDevelopment]: 'Green Development',
  [Branch.RestorativeJustice]: 'Restorative Justice',
  [Branch.IntentionalCommunities]: 'Intentional Communities',
  [Branch.GiftEconomy]: 'Gift Economy',
  [Branch.Solarpunk]: 'Solarpunk',
  [Branch.AnarchoCommunism]: 'Anarcho-Communism',
};

function statusOf(node: TechNode, state: TechState): NodeStatus {
  if (state.unlocked.has(node.id)) return 'unlocked';
  if (state.canUnlock(node.id).ok) return 'affordable';
  return 'locked';
}

/**
 * Build the 7 branch columns from (tree, state). Columns follow BRANCH_ORDER;
 * within a column, no-prereq roots come first, then nodes by ascending cost
 * (id-tie-broken for determinism). Each node carries its status and the display
 * names of any prereqs not yet unlocked.
 */
export function branchColumns(tree: readonly TechNode[], state: TechState): BranchColumn[] {
  const byId = new Map(tree.map((n) => [n.id, n]));
  return BRANCH_ORDER.map((branch) => {
    const nodes = tree
      .filter((n) => n.branch === branch)
      .slice()
      .sort((a, b) => {
        const ra = a.prereqs.length === 0 ? 0 : 1;
        const rb = b.prereqs.length === 0 ? 0 : 1;
        if (ra !== rb) return ra - rb; // roots first
        if (a.cost !== b.cost) return a.cost - b.cost; // then ascending cost
        return a.id < b.id ? -1 : a.id > b.id ? 1 : 0; // stable tiebreak
      })
      .map((n): NodeView => ({
        id: n.id,
        name: n.name,
        flavor: n.flavor,
        cost: n.cost,
        status: statusOf(n, state),
        missing: n.prereqs
          .filter((p) => !state.unlocked.has(p))
          .map((p) => byId.get(p)?.name ?? p),
      }));
    return { branch, title: BRANCH_TITLES[branch], nodes };
  });
}

/** One-line effort readout for the panel header. */
export function effortLine(state: TechState): string {
  return `Communal effort: ${state.effort}`;
}

/**
 * A compact signature of the panel's STRUCTURAL/visible state — each node's
 * `id:status`, in column-then-node order. Deliberately excludes the effort header
 * (it ticks every 100ms but does not change a node's class) so the host only
 * triggers a FULL panel re-derive when a node actually flips status; the cheap
 * header text is refreshed separately. Order-stable: equal trees in equal states
 * yield equal signatures.
 */
export function panelSignature(columns: readonly BranchColumn[]): string {
  return columns
    .flatMap((c) => c.nodes.map((n) => `${n.id}:${n.status}`))
    .join('|');
}

/**
 * The FULL className for a tech node — the shell sets it wholesale
 * (`el.className = techNodeClass(node)`) so a stale `tech-node-locked`/`-affordable`
 * + `tech-node-clickable` drops by construction when status flips: base
 * `tech-node tech-node-${status}`, plus `tech-node-clickable` iff affordable.
 */
export function techNodeClass(node: NodeView): string {
  let cls = `tech-node tech-node-${node.status}`;
  if (node.status === 'affordable') cls += ' tech-node-clickable';
  return cls;
}

/**
 * Pure input gate for the panel's `T` toggle. True iff `key` is `t`/`T` AND no
 * overlay is active — so the opening overlay (which owns its own keydown) is
 * never toggled underneath. Lives here, not in the DOM shell, so the
 * overlay-suppression rule is unit-tested rather than left to manual QA.
 */
export function shouldTogglePanel(key: string, overlayActive: boolean): boolean {
  return (key === 't' || key === 'T') && !overlayActive;
}
