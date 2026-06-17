// Revival / decay: the deterministic-growth seam. The live occupancy layer (how
// many people actually inhabit each home, emergent from the agent sim) is sampled
// into the HASHED building stock — a thriving home heals and densifies, a struggling
// one crumbles toward ruin (reversibly). This is what makes "revive a dead city" a
// real mechanic rather than a paint job: heal a pocket → occupancy returns →
// condition recovers and the block grows; let it rot → occupancy drains → the block
// darkens to a derelict ruin.
//
// It runs on the SIM side (the host calls it on the civic cadence), NOT in
// stepAmbient — the ambient layer must leave the world hash untouched. It is kept
// OUT of simTick too, so the N=120 determinism gate (which pins simTick's stock
// byte-stable) is unaffected. Deterministic in (world, occAt, rng): the same
// occupancy snapshot + rng yields the same stock mutation. Engine-layer discipline:
// no DOM, no transcendental Math; occupancy arrives via an injected accessor so this
// never imports ui.

import { ParcelStore } from '../engine/fabric';
import type { GameMap } from '../engine/map';
import { ZoneType, zoneTypeOf } from '../engine/zone';
import { citizensOf } from '../citizens/census';
import type { Rng } from '../engine/rng';

export interface RevivalParams {
  /** signal at/above which a home heals (and may densify). */
  growThreshold: number;
  /** signal at/below -this which a home decays toward ruin. */
  decayThreshold: number;
  /** condition delta applied per pass (heal or decay). */
  conditionStep: number;
  /** condition at/above which a thriving home may densify. */
  densifyCondition: number;
  /** per-pass densify probability once eligible. */
  densifyChance: number;
  /** density ceiling (R1..R3). */
  maxDensity: number;
}

export const DEFAULT_REVIVAL_PARAMS: RevivalParams = {
  growThreshold: 0.15,
  decayThreshold: 0.15,
  conditionStep: 14,
  densifyCondition: 210,
  densifyChance: 0.12,
  maxDensity: 3,
};

export interface RevivalWorld {
  map: GameMap;
  parcels: ParcelStore;
}

/**
 * Normalized occupancy signal in [-1, 1] for a home: positive when its live
 * occupancy is above its seeded baseline (citizensOf(density) — thriving), negative
 * when below (struggling). Zero for an empty/derelict density. Pure.
 */
export function occupancySignalFor(occupancy: number, density: number): number {
  const base = citizensOf(density);
  if (base <= 0) return 0;
  const s = (occupancy - base) / base;
  return s < -1 ? -1 : s > 1 ? 1 : s;
}

/**
 * The pure per-home decision: next (condition, density) from the current state and
 * the occupancy signal. Thriving (signal ≥ growThreshold) heals condition and, when
 * already in good repair, may densify (one rng draw). Struggling (signal ≤
 * -decayThreshold) decays condition toward 0 (the ruin floor). In between, hold.
 * Reversible by construction — a ruined home heals back when occupancy returns.
 */
export function revivalStep(
  condition: number,
  density: number,
  signal: number,
  rng: Rng,
  p: RevivalParams = DEFAULT_REVIVAL_PARAMS,
): { condition: number; density: number } {
  if (signal >= p.growThreshold) {
    const healed = condition + p.conditionStep;
    const nextCond = healed > 255 ? 255 : healed;
    let nextDensity = density;
    if (nextCond >= p.densifyCondition && density < p.maxDensity && rng.next() < p.densifyChance) {
      nextDensity = density + 1;
    }
    return { condition: nextCond, density: nextDensity };
  }
  if (signal <= -p.decayThreshold) {
    const decayed = condition - p.conditionStep;
    return { condition: decayed < 0 ? 0 : decayed, density };
  }
  return { condition, density };
}

/**
 * Run one revival pass over every alive residential parcel, sampling its live
 * occupancy (occAt(anchorTile) → the live value, or undefined when unknown → hold)
 * into the hashed stock via setCondition/setDensity. Returns how many parcels
 * changed (so the host can skip a base-cache rebuild on a no-op pass). Deterministic
 * in (world, occAt, rng): aliveIndices is a stable ascending order.
 */
export function stepRevival(
  world: RevivalWorld,
  occAt: (tile: number) => number | undefined,
  rng: Rng,
  p: RevivalParams = DEFAULT_REVIVAL_PARAMS,
): number {
  const { map, parcels } = world;
  let changed = 0;
  for (const i of parcels.aliveIndices()) {
    if (zoneTypeOf(parcels.kindAt(i)) !== ZoneType.Residential) continue;
    const parcel = parcels.get(i);
    const occ = occAt(map.idx(parcel.x, parcel.y));
    if (occ === undefined) continue; // no live signal yet → hold
    const signal = occupancySignalFor(occ, parcel.density);
    const next = revivalStep(parcel.condition, parcel.density, signal, rng, p);
    if (next.condition !== parcel.condition) {
      parcels.setCondition(i, next.condition);
      changed++;
    }
    if (next.density !== parcel.density) {
      parcels.setDensity(i, next.density);
      changed++;
    }
  }
  return changed;
}
