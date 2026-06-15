// Reconcile plan: the PURE decision behind the dock/panel apply step — the
// automated lock on the "defining regression". The click-eating bug was a shell
// that rebuilt every button ~10×/s (replaceChildren + fresh listeners), so an
// in-flight click landed on a detached node. The fix is to recreate a node ONLY
// when its id appears/disappears; a node whose id is unchanged is reused (its
// identity, and any in-flight click, preserved). This module computes that
// decision as a deterministic function of (prevIds, rows) so it is node-testable
// like the engine — no DOM, no jsdom. The thin shells only APPLY this plan; the
// architecture guard scans this file (PURE_UI_ALLOWLIST). Keyed on id ALONE, so a
// visual-only change (selection/affordability flip) causes NO structural churn —
// the wholesale className handles the visual update without recreating anything.

/** The structural diff the shell applies. Keyed on id; visual fields are ignored. */
export interface ReconcilePlan {
  /** The ids in the new `rows` order — the shell re-appends children to match. */
  order: string[];
  /** Ids in `rows` not in `prevIds` — the shell must CREATE these nodes. */
  insert: string[];
  /** Ids in `prevIds` not in `rows` — the shell must DELETE these nodes. */
  remove: string[];
}

/**
 * Compute the structural reconcile plan between the previously-rendered ids and
 * the new rows. `order` is the new id order; `insert` is the new ids (row order);
 * `remove` is the gone ids (prev order). A no-delta plan (empty insert+remove)
 * means the shell recreates nothing — only re-appends existing nodes to match
 * order — which is what keeps clicks alive. Pure and deterministic.
 */
export function reconcilePlan(
  prevIds: readonly string[],
  rows: readonly { id: string }[],
): ReconcilePlan {
  const prevSet = new Set(prevIds);
  const nextSet = new Set(rows.map((r) => r.id));
  const order = rows.map((r) => r.id);
  const insert = order.filter((id) => !prevSet.has(id));
  const remove = prevIds.filter((id) => !nextSet.has(id));
  return { order, insert, remove };
}
