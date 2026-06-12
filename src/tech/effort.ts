// Communal-effort accrual: the first real per-tick work the sim loop does.
//
// ============================ PLACEHOLDER ============================
// This formula is a stand-in. Effort currently derives from raw parcel count
// and mean condition so the tech tree has *something* deterministic to spend.
// The real civic simulation (participation, mutual aid, the dharmapunk economy)
// will replace effortPerTick wholesale. The accrual contract (deterministic,
// integer, ≥1 per tick) is what callers depend on — keep it when you replace
// the body. accrue recomputes the formula PER CALL, which is correct only while
// nothing mutates the world mid-frame; build-tools must revisit once placement
// and condition change during a tick.
// ====================================================================
//
// Pure module: no DOM, no rng, no Date, no transcendental Math. The world is
// typed STRUCTURALLY ({ parcels }) so src/tech never imports worldgen — it
// depends on the engine's ParcelStore as a type only.

import type { ParcelStore } from '../engine/fabric';
import type { TechState } from './state';

/** The slice of the world effort accrual reads: just the parcel store. */
export interface EffortWorld {
  parcels: ParcelStore;
}

/**
 * Effort produced per tick. ALWAYS a finite integer ≥ 1.
 *
 * The zero-parcel guard is load-bearing: without it, conditionMean = 0/0 = NaN,
 * Math.floor(NaN) = NaN, and Math.max(1, NaN) = NaN (NaN comparisons are false,
 * so max returns the NaN), which would poison state.effort and every downstream
 * u32 snapshot. With the guard an empty world yields exactly 1.
 */
export function effortPerTick(world: EffortWorld): number {
  const { parcels } = world;
  const alive = parcels.aliveCount();
  let sumCondition = 0;
  for (const i of parcels.aliveIndices()) sumCondition += parcels.conditionAt(i);
  const conditionMean = alive === 0 ? 0 : Math.floor(sumCondition / alive);
  return Math.max(1, Math.floor(alive / 8 + conditionMean / 32));
}

/**
 * Accrue `ticks` ticks of effort into `state`. The per-tick rate is computed
 * once (the world is constant within a frame for now), so the gain is exactly
 * `ticks * effortPerTick(world)`. Returns the amount gained.
 */
export function accrue(state: TechState, world: EffortWorld, ticks: number): number {
  const gained = ticks * effortPerTick(world);
  state.effort += gained;
  return gained;
}
