// The tech-tree state machine: which nodes are unlocked, how much communal
// effort has accrued, and the deterministic rules for spending it. Pure module —
// no DOM, no rng, no Date. Effort is an integer (accrual floors it in Task 4);
// unlock spends exactly a node's cost. The byte-stable snapshot (sorted unlocked
// ids + effort as u32) mirrors ParcelStore.snapshotBytes so tech state can join
// the project's determinism assertions.

import type { TechNode } from './tree';
import type { BuiltKind } from '../engine/fabric';

export type UnlockReason = 'unknown' | 'unlocked' | 'prereqs' | 'effort';

/** Result of canUnlock: ok with no reason, or not-ok with the first blocker. */
export interface CanUnlockResult {
  ok: boolean;
  reason?: UnlockReason;
}

export class TechState {
  private readonly byId: Map<string, TechNode>;
  private readonly unlockedSet = new Set<string>();
  /** Accrued communal effort (integer). Public: the sim loop accrues into it. */
  effort = 0;

  constructor(tree: readonly TechNode[]) {
    this.byId = new Map(tree.map((n) => [n.id, n]));
  }

  /** The set of unlocked node ids (read-only view of internal state). */
  get unlocked(): ReadonlySet<string> {
    return this.unlockedSet;
  }

  /**
   * Whether `id` can be unlocked now, and if not, the FIRST blocking reason in
   * precedence order: unknown id, already unlocked, unmet prereqs, then short
   * effort. (Precedence matters: a node with both unmet prereqs and short effort
   * reports 'prereqs' — there is nothing to fund yet.)
   */
  canUnlock(id: string): CanUnlockResult {
    const n = this.byId.get(id);
    if (!n) return { ok: false, reason: 'unknown' };
    if (this.unlockedSet.has(id)) return { ok: false, reason: 'unlocked' };
    for (const p of n.prereqs) {
      if (!this.unlockedSet.has(p)) return { ok: false, reason: 'prereqs' };
    }
    if (this.effort < n.cost) return { ok: false, reason: 'effort' };
    return { ok: true };
  }

  /**
   * Unlock `id`: spend exactly its cost and record it. Returns false and mutates
   * NOTHING unless canUnlock is ok.
   */
  unlock(id: string): boolean {
    if (!this.canUnlock(id).ok) return false;
    const n = this.byId.get(id)!;
    this.effort -= n.cost;
    this.unlockedSet.add(id);
    return true;
  }

  /**
   * Spend `n` communal effort. The guarded SECOND debit path beside {@link unlock}:
   * build-tools' applyTool calls this instead of mutating the public field, so the
   * u32-snapshot effort invariant stays enforced in one place (single-writer
   * discipline — a drifting second writer could silently corrupt the snapshot).
   * Returns false and mutates NOTHING unless `n` is a non-negative integer no
   * greater than the current effort.
   */
  spend(n: number): boolean {
    if (!Number.isInteger(n) || n < 0 || n > this.effort) return false;
    this.effort -= n;
    return true;
  }

  /** Union of build kinds granted by every unlocked node. */
  grantedKinds(): ReadonlySet<BuiltKind> {
    const out = new Set<BuiltKind>();
    for (const id of this.unlockedSet) {
      const n = this.byId.get(id)!;
      for (const k of n.grants.kinds ?? []) out.add(k);
    }
    return out;
  }

  /** True iff any unlocked node grants `cap`. */
  hasCapability(cap: string): boolean {
    for (const id of this.unlockedSet) {
      const n = this.byId.get(id)!;
      if ((n.grants.capabilities ?? []).includes(cap)) return true;
    }
    return false;
  }

  /**
   * Byte-stable snapshot: unlocked ids sorted lexically, each as a u16 LE length
   * prefix + its ASCII bytes (ids are kebab-case, so ASCII == UTF-8), then effort
   * as u32 LE. Equal (unlocked set, effort) yields equal bytes regardless of the
   * order nodes were unlocked in; any change to either moves the bytes.
   */
  snapshotBytes(): Uint8Array {
    const ids = [...this.unlockedSet].sort();
    let len = 4; // trailing effort u32
    for (const id of ids) len += 2 + id.length;
    const out = new Uint8Array(len);
    const view = new DataView(out.buffer);
    let o = 0;
    for (const id of ids) {
      view.setUint16(o, id.length & 0xffff, true);
      o += 2;
      for (let i = 0; i < id.length; i++) out[o++] = id.charCodeAt(i) & 0xff;
    }
    view.setUint32(o, this.effort >>> 0, true);
    return out;
  }
}

/** Construct a fresh TechState over `tree` (effort 0, nothing unlocked). */
export function createTechState(tree: readonly TechNode[]): TechState {
  return new TechState(tree);
}
