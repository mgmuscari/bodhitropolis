// Composite sim orchestrator: one deterministic step that advances effort,
// ecology, and civic in a FIXED order (effort → ecology → civic), owning the
// post-tick report recomputes so the cached means stay coherent across the
// 10/50 cadence boundaries. main.ts calls this once per sim tick and only READS
// `deps` for rendering — the cadence logic and the eco/civic caches live here,
// not in the shell, so the composite is headless-testable (N-tick double-run).
//
// Pure module: no DOM, no rng, no transcendental Math (the architecture guard
// scans src/civic). Sanctioned dependency direction: civic → engine, civic →
// ecology (ecologyTick + ecologyReport), civic → tech (accrue). NO worldgen edge
// — `world` is typed STRUCTURALLY as {map, parcels}, so civic flood-fills the
// engine GameMap and never reaches into worldgen fields (the guard asserts both
// the no-worldgen and the no-reverse-import directions).

import type { GameMap } from '../engine/map';
import type { ParcelStore } from '../engine/fabric';
import { accrue } from '../tech/effort';
import type { TechState } from '../tech/state';
import { ECO_CADENCE } from '../ecology/influence';
import { ecologyTick } from '../ecology/tick';
import { ecologyReport } from '../ecology/report';
import { computeNeighborhoods, type NeighborhoodMap } from './neighborhoods';
import type { CivicState } from './state';
import { civicTick, type CivicCaps } from './dynamics';
import { civicReport } from './report';

/** Civic dynamics run once every CIVIC_CADENCE sim ticks (the slowest cadence). */
export const CIVIC_CADENCE = 50;

/** The structural slice of the world the orchestrator touches (no worldgen edge). */
export interface SimWorld {
  map: GameMap;
  parcels: ParcelStore;
}

/**
 * The mutated-in-place sim state. `partition` is the LIVE NeighborhoodMap
 * (replaced on each civic refresh) that main.ts reads to resolve a repair's
 * (x, y) → neighborhoodId between refreshes. `ecoMeans`/`civicMeans` are the
 * caches effort.ts consumes — undefined until their first recompute (effort then
 * contributes 0 for that term, the pre-civic degrade).
 */
export interface SimDeps {
  world: SimWorld;
  tech: TechState;
  civic: CivicState;
  partition: NeighborhoodMap;
  ecoMeans?: { soil: number; flora: number; fauna: number };
  civicMeans?: { belonging: number; voice: number; trust: number };
}

/** What fired this tick — for the shell's dirty-marking. */
export interface SimTickResult {
  ecoTicked: boolean;
  civicTicked: boolean;
  /** Effort accrued this tick (always ≥ 1). */
  effortGained: number;
}

/**
 * Advance the composite sim by one tick, fixed order effort → ecology → civic:
 *
 *  1. EFFORT accrues EVERY tick, consuming the means CACHED from the PRIOR
 *     recompute (stale-by-cadence but deterministic — effort runs first, so it
 *     sees the last recompute's means, never this tick's).
 *  2. ECOLOGY at tick>0 && %ECO_CADENCE: ecologyTick, THEN recompute ecologyReport
 *     and write `deps.ecoMeans`.
 *  3. CIVIC at tick>0 && %CIVIC_CADENCE: recompute the partition, REMAP the civic
 *     state onto it, run civicTick, THEN recompute civicReport and write
 *     `deps.civicMeans`. The capabilities are resolved from tech HERE (passed to
 *     dynamics as booleans, so civic never imports tech for the consume).
 *
 * Returns the per-tick fire flags + effort gained.
 */
export function simTick(deps: SimDeps, tick: number): SimTickResult {
  // 1. Effort every tick, on the prior recompute's cached means.
  const effortGained = accrue(
    deps.tech,
    { parcels: deps.world.parcels, ecoMeans: deps.ecoMeans, civicMeans: deps.civicMeans },
    1,
  );

  // 2. Ecology cadence → tick + recompute means.
  let ecoTicked = false;
  if (tick > 0 && tick % ECO_CADENCE === 0) {
    ecologyTick(deps.world.map);
    const r = ecologyReport(deps.world);
    deps.ecoMeans = { soil: r.soilMean, flora: r.floraMean, fauna: r.faunaMean };
    ecoTicked = true;
  }

  // 3. Civic cadence → partition refresh, remap, dynamics, recompute means.
  let civicTicked = false;
  if (tick > 0 && tick % CIVIC_CADENCE === 0) {
    const newPartition = computeNeighborhoods(deps.world.map);
    deps.civic.remap(deps.partition, newPartition);
    deps.partition = newPartition;
    const caps: CivicCaps = {
      circles: deps.tech.hasCapability('circles'),
      participatoryBudgeting: deps.tech.hasCapability('participatory-budgeting'),
      giftCircles: deps.tech.hasCapability('gift-circles'),
    };
    civicTick(deps.world.map, deps.world.parcels, deps.partition, deps.civic, caps, tick);
    const cr = civicReport(deps.civic, deps.partition);
    deps.civicMeans = {
      belonging: cr.belongingMean,
      voice: cr.voiceMean,
      trust: cr.trustMean,
    };
    civicTicked = true;
  }

  return { ecoTicked, civicTicked, effortGained };
}
