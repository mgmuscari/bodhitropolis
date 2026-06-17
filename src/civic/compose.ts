// Composite sim orchestrator: one deterministic step that advances effort,
// ecology, and civic in a FIXED order (effort → ecology → civic), owning the
// post-tick report recomputes so the cached means stay coherent across the
// 10/50 cadence boundaries. main.ts calls this once per sim tick and only READS
// `deps` for rendering — the cadence logic and the eco/civic caches live here,
// not in the shell, so the composite is headless-testable (N-tick double-run).
//
// Headless + transcendental-Math-free (the architecture guard scans src/civic). The
// traffic/growth layers are the FIRST sim layers needing randomness, so this orchestrator
// uses the SEEDED rng (createRng/fork — integer sfc32, allowed by the guard), forked
// per-tick-stamped so each tick's stream is independent of every other and of draw count.
// Sanctioned dependency direction: civic → engine, ecology, tech, traffic (the composite
// wires them; traffic never imports back). NO worldgen edge — `world` is typed
// STRUCTURALLY as {map, parcels}.

import type { GameMap } from '../engine/map';
import type { ParcelStore } from '../engine/fabric';
import { accrue } from '../tech/effort';
import type { TechState } from '../tech/state';
import { ECO_CADENCE } from '../ecology/influence';
import { ecologyTick } from '../ecology/tick';
import { ecologyReport } from '../ecology/report';
import type { Trip } from '../traffic/trip';
import { computeNeighborhoods, type NeighborhoodMap } from './neighborhoods';
import type { CivicState } from './state';
import { civicTick, type CivicCaps } from './dynamics';
import { civicReport } from './report';

/** Traffic (decay + origin→destination generation) runs every TRAFFIC_CADENCE ticks. */
export const TRAFFIC_CADENCE = 10;
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
  /** World seed — the root for the per-tick traffic/growth rng forks (determinism). */
  seed: string;
  ecoMeans?: { soil: number; flora: number; fauna: number };
  civicMeans?: { belonging: number; voice: number; trust: number };
  /** This cadence's found O-D trips — published for the renderer (cars ARE trips).
   *  Renderer-facing output, not part of the world hash (the laid `map.traffic` is). */
  trips?: Trip[];
}

/** What fired this tick — for the shell's dirty-marking. */
export interface SimTickResult {
  trafficTicked: boolean;
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

  // 2. Traffic is AGENT-DRIVEN now (the 1989 aggregate field is retired): the live travelers
  //    (citizen cars in the ambient layer) lay a live traffic density as they actually drive, route
  //    AROUND it, and pedestrians shun it. The deterministic O-D generator no longer runs — the
  //    seeded WORLD stays reproducible (it no longer depends on traffic) while the dynamic traffic
  //    layer emerges from the agents. See docs/decisions/live-agent-layer.md.
  const trafficTicked = false;

  // 3. Ecology cadence → tick + recompute means.
  let ecoTicked = false;
  if (tick > 0 && tick % ECO_CADENCE === 0) {
    ecologyTick(deps.world.map);
    const r = ecologyReport(deps.world);
    deps.ecoMeans = { soil: r.soilMean, flora: r.floraMean, fauna: r.faunaMean };
    ecoTicked = true;
  }

  // 4. Civic cadence → partition refresh, remap, dynamics, recompute means.
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

  return { trafficTicked, ecoTicked, civicTicked, effortGained };
}
