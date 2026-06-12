// CivicState: per-neighborhood belonging / voice / trust plus a per-neighborhood
// repair ring buffer (the recent ticks a neighborhood was repaired on, newest
// first). Pure module — no DOM, no rng, no transcendental Math (the architecture
// guard scans src/civic). Determinism comes from content: a byte-stable snapshot
// mirrors ParcelStore/TechState so civic state joins the project's determinism
// assertions via its OWN snapshot (hashWorld stays {map, parcels}).
//
// CivicState is partition-FREE: it is indexed by neighborhood id (1-based) and
// knows nothing of (x, y). The (x, y) → neighborhoodId resolution lives in
// main.ts (the composition root), which passes an already-resolved id to
// recordRepair. When a fabric change re-partitions the map, remap() carries the
// old state forward by tile-count-weighted mean (the ONE carryover rule).

import type { NeighborhoodMap } from './neighborhoods';

/** Seed values for a fresh / genesis neighborhood (mid-low; tuning data). */
export const SEED_BELONGING = 80;
export const SEED_VOICE = 40;
export const SEED_TRUST = 90;
/** Fixed repair ring capacity per neighborhood (tuning data). */
export const RING_SIZE = 8;

/** The three civic scalars of one neighborhood. */
export interface CivicValues {
  belonging: number;
  voice: number;
  trust: number;
}

interface Cell {
  belonging: number;
  voice: number;
  trust: number;
  /** Recent repair ticks, newest-first, length ≤ RING_SIZE. */
  ring: number[];
}

const seedCell = (): Cell => ({
  belonging: SEED_BELONGING,
  voice: SEED_VOICE,
  trust: SEED_TRUST,
  ring: [],
});

export class CivicState {
  /** One cell per neighborhood, index = id − 1. */
  private cells: Cell[];

  constructor(neighborhoodCount: number) {
    this.cells = Array.from({ length: neighborhoodCount }, seedCell);
  }

  /** Number of neighborhoods currently tracked. */
  count(): number {
    return this.cells.length;
  }

  /** Cell for a 1-based id, or undefined for id 0 / out-of-range. */
  private cellOf(id: number): Cell | undefined {
    if (!Number.isInteger(id) || id < 1 || id > this.cells.length) return undefined;
    return this.cells[id - 1];
  }

  /** The three scalars of neighborhood `id` (throws only on a truly invalid id). */
  getValues(id: number): CivicValues {
    const c = this.cellOf(id);
    if (!c) throw new RangeError(`CivicState.getValues: no neighborhood ${id}`);
    return { belonging: c.belonging, voice: c.voice, trust: c.trust };
  }

  /** Overwrite the three scalars of neighborhood `id` (dynamics' write path). */
  setValues(id: number, v: CivicValues): void {
    const c = this.cellOf(id);
    if (!c) throw new RangeError(`CivicState.setValues: no neighborhood ${id}`);
    c.belonging = v.belonging;
    c.voice = v.voice;
    c.trust = v.trust;
  }

  /** Read-only view of neighborhood `id`'s ring (newest-first), [] if unknown. */
  getRing(id: number): readonly number[] {
    const c = this.cellOf(id);
    return c ? [...c.ring] : [];
  }

  /**
   * Record a repair on neighborhood `id` at `tick`. id 0 (no neighborhood) and
   * any out-of-range / non-integer id are a SAFE NO-OP — never thrown — so a
   * repair off every neighborhood (e.g. a road diet far from any parcel) simply
   * records nothing: trust rises only where there is a community to hold it. The
   * tick is inserted newest-first; the ring caps at RING_SIZE, evicting the
   * oldest (lowest-tick) entry.
   */
  recordRepair(neighborhoodId: number, tick: number): void {
    const c = this.cellOf(neighborhoodId);
    if (!c) return; // id 0 / out-of-range / unknown → safe no-op
    // Insert maintaining descending order (newest-first). Sim ticks are
    // monotonic, but inserting by position keeps the invariant even if not.
    let pos = 0;
    while (pos < c.ring.length && c.ring[pos]! >= tick) pos++;
    c.ring.splice(pos, 0, tick);
    if (c.ring.length > RING_SIZE) c.ring.length = RING_SIZE; // drop the oldest tail
  }

  /**
   * Carry state forward across a re-partition. The ONE rule, tile-count-WEIGHTED:
   * for each NEW neighborhood, bucket its tiles by the OLD id they came from
   * (oldPartition.tileToNeighborhood); with wᵢ = count of its tiles whose old id
   * is i (i ≠ 0), each value = floor(Σ wᵢ·vᵢ / Σ wᵢ) over old neighborhoods i.
   * FRESH tiles (old id 0) are excluded from BOTH numerator and denominator — a
   * split (one parent) reduces to the parent's EXACT value; a merge is the
   * weighted mean (explicitly NOT a simple average). ZERO-PARENT (Σ wᵢ = 0 — an
   * all-fresh cluster the player just built) seeds to the named constants. Ring
   * buffers merge all parents' entries and keep the 8 NEWEST by tick descending,
   * tie-broken on equal ticks by source old id ascending then slot ascending for
   * byte-stability; zero-parent → empty ring.
   */
  remap(oldPartition: NeighborhoodMap, newPartition: NeighborhoodMap): void {
    const oldT = oldPartition.tileToNeighborhood;
    const newT = newPartition.tileToNeighborhood;
    const newCount = newPartition.neighborhoods.length;

    // Per new neighborhood: old id → tile weight.
    const weights: Map<number, number>[] = Array.from({ length: newCount }, () => new Map());
    const n = newT.length;
    for (let t = 0; t < n; t++) {
      const nid = newT[t]!;
      if (nid === 0 || nid > newCount) continue;
      const oid = oldT[t]!;
      if (oid === 0) continue; // fresh tile excluded from both sides
      const w = weights[nid - 1]!;
      w.set(oid, (w.get(oid) ?? 0) + 1);
    }

    const next: Cell[] = [];
    for (let j = 0; j < newCount; j++) {
      const bucket = weights[j]!;
      if (bucket.size === 0) {
        next.push(seedCell()); // zero-parent genesis
        continue;
      }
      const oids = [...bucket.keys()].sort((a, b) => a - b); // deterministic order
      let wsum = 0;
      let bsum = 0;
      let vsum = 0;
      let tsum = 0;
      const merged: { tick: number; oid: number; slot: number }[] = [];
      for (const oid of oids) {
        const cell = this.cells[oid - 1];
        if (!cell) continue; // defensive: an old id with no cell contributes nothing
        const w = bucket.get(oid)!;
        wsum += w;
        bsum += w * cell.belonging;
        vsum += w * cell.voice;
        tsum += w * cell.trust;
        cell.ring.forEach((tick, slot) => merged.push({ tick, oid, slot }));
      }
      if (wsum === 0) {
        next.push(seedCell());
        continue;
      }
      // Newest-by-tick descending; equal ticks tie-broken by source old id then slot.
      merged.sort((a, b) => {
        if (a.tick !== b.tick) return b.tick - a.tick;
        if (a.oid !== b.oid) return a.oid - b.oid;
        return a.slot - b.slot;
      });
      next.push({
        belonging: Math.floor(bsum / wsum),
        voice: Math.floor(vsum / wsum),
        trust: Math.floor(tsum / wsum),
        ring: merged.slice(0, RING_SIZE).map((e) => e.tick),
      });
    }
    this.cells = next;
  }

  /**
   * Byte-stable snapshot: a u16 LE neighborhood count, then a fixed-width record
   * per neighborhood in id order — belonging(u8) voice(u8) trust(u8) ringLen(u8),
   * then RING_SIZE u32 LE tick slots (filled newest-first, unused slots 0;
   * ringLen disambiguates a real tick 0 from an empty slot). Equal state yields
   * equal bytes; any value or ring change moves them. Partition-free: id is
   * positional, anchor is not stored (it lives in the live NeighborhoodMap).
   */
  snapshotBytes(): Uint8Array {
    const RECORD = 4 + RING_SIZE * 4;
    const out = new Uint8Array(2 + this.cells.length * RECORD);
    const view = new DataView(out.buffer);
    view.setUint16(0, this.cells.length & 0xffff, true);
    let o = 2;
    for (const c of this.cells) {
      view.setUint8(o, c.belonging & 0xff);
      view.setUint8(o + 1, c.voice & 0xff);
      view.setUint8(o + 2, c.trust & 0xff);
      view.setUint8(o + 3, c.ring.length & 0xff);
      for (let s = 0; s < RING_SIZE; s++) {
        view.setUint32(o + 4 + s * 4, (c.ring[s] ?? 0) >>> 0, true);
      }
      o += RECORD;
    }
    return out;
  }
}

/** Construct a fresh CivicState seeding every neighborhood of `partition`. */
export function createCivicState(partition: NeighborhoodMap): CivicState {
  return new CivicState(partition.neighborhoods.length);
}
