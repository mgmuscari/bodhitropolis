// Pure ambient-life model: the deterministic stepper behind the cars, pedestrians,
// and bird flocks that animate over a built city. It READS the world (road class,
// pedestrian substrate, fauna presence) and writes ONLY its own AmbientState — no
// map writes, no parcel writes, no engine/sim rng. The renderer culls the resulting
// sprites to the viewport at draw time.
//
// This module is in the architecture guard's PURE_UI_ALLOWLIST, so it is DOM-free
// and transcendental-free: only Math.min/max/abs/floor/sqrt (exactly-rounded /
// integer) appear — never sin/cos/exp/pow/log/random. Determinism is load-bearing:
// every random choice draws from the caller's `fork('ambient')` Rng, so a worldgen
// or sim run is byte-identical whether or not the stepper is interleaved.
//
// Motion model (CRITIC-YP6): a car/ped carries a heading (`dir`) and a committed
// target tile (`tx`,`ty`); each substep it advances toward the target, and on
// arrival it recommits to a connected traversable neighbour EXCLUDING the immediate
// U-turn (unless a dead-end forces it). So traffic flows along a road and turns at
// junctions instead of vibrating A→B→A. Cars traverse `isRoadKind` (1..3) only — so
// they neither spawn on NOR move onto quiet streets (QuietStreet reads as a road to
// `transportCategory`, which is therefore deliberately unused here, YP4).

import type { GameMap } from '../engine/map';
import { BuiltKind, isRoadKind } from '../engine/fabric';
import { ZoneType, zoneTypeOf } from '../engine/zone';
import { visitValue } from '../citizens/plots';
import { stopCategoryOf, DAILY_ITINERARY, type StopCategory } from '../citizens/itinerary';
import { TravelMode, modeSpec, modeRidesNetwork, modeSpeedMult, MODE_CHOICE_ORDER } from '../citizens/modes';
import type { Household } from '../citizens/census';
import type { Rng } from '../engine/rng';

/** Maximum elapsed time honoured in a single stepAmbient call, mirroring
 *  FixedTickLoop.maxFrameMs (loop.ts): a GC pause / debugger break / OS sleep /
 *  missed visibility reset can never spiral into a synchronous hang. */
export const AMBIENT_MAX_FRAME_MS = 1000;

/** Fixed substep size — the simulation cadence for ambient motion. */
const SUBSTEP_MS = 50;

// Global per-kind caps (bounded total ~hundreds). Placeholder magnitudes —
// live-pass tuned; the contract is "cap-bounded step + viewport cull at draw".
const CAR_CAP = 200;
const PED_CAP = 160;
const FLOCK_CAP = 32;

// Rejection-sampling budget per substep per kind: sample K random tiles and test
// the spawn predicate, never an O(mapArea) full-map scan (CRITIC-YP1).
const SAMPLES_PER_SUBSTEP = 8;

// Float tiles travelled per 50ms substep. Cars are quicker than pedestrians.
const CAR_SPEED = 0.12;
const PED_SPEED = 0.05;

/** Chebyshev radius searched around a parked car for the building its pedestrian walks
 *  to/from. Lots/curbs sit next to the demand they serve, so this stays small. */
const LASTMILE_RADIUS = 4;

/** How close (tile radius) a parking lot's centre must be to a trip-car's destination for
 *  the car to pull in and park. Lots sit by the zones they serve, so this stays modest. */
const PARK_RADIUS = 6;

/** When no lot is free, a car parks at the nearest free curb (drivable tile) within this
 *  Chebyshev radius of its destination. Crowding (near curbs taken) pushes it farther out —
 *  a longer walk for its pedestrian. */
const CURB_RADIUS = 10;

/** Safety cap (substeps) on how long a parked car waits for its pedestrian before leaving
 *  anyway — normally the returning ped releases it sooner. ~30s at 50ms/substep. */
const PARK_MAX_WAIT = 600;

/** Bounds + decay for the live per-building HEALTH signal: each completed citizen visit
 *  deposits the destination plot's visitValue at the citizen's home, and health eases back
 *  toward neutral (0) so it reflects RECENT trips, not all-time. Live, not hashed. */
const HEALTH_MAX = 120;
// Slow decay so health ACCUMULATES across a home's repeated trips into a persistent,
// readable signal (a fast decay left most homes flickering back to neutral between visits).
const HEALTH_DECAY = 0.02;

/** Transport-MODE threshold: a citizen trip whose committed path is at most this many tiles
 *  is walked (a pedestrian routes the whole way); longer trips drive. So as destinations come
 *  closer / streets calm, citizens shift out of cars — the heart of the congestion→bloom loop. */
const WALK_RANGE = 10;

/** How far a citizen on a daily round will look for the next stop's plot (a workplace, shop, or
 *  third place). Larger than a last-mile radius — a citizen ranges across its district — but the
 *  FUEL economy is what really bounds reach: a stop too far to walk burns the citizen out. */
const CITIZEN_TRIP_RADIUS = 24;

/** Mode choice: a leg up to BIKE_RANGE tiles can be cycled (bikes need no special infra — bike
 *  paths just speed them); a transit/road mode is "available" only when its network is within
 *  MODE_INFRA_RADIUS of BOTH ends of the leg. So building a tram/rail line lets the citizens whose
 *  trips it serves ride it instead of driving — the road-diet → mode-shift → bloom loop. */
const BIKE_RANGE = 30;
const MODE_INFRA_RADIUS = 6;

/** Target number of itinerary citizens to keep out living their daily round at once. Below the
 *  ped cap, so there's still room for ambient wanderers, last-mile walkers, and respawned citizens.
 *  CITIZEN_SPAWN_PER_SUBSTEP tops the population up gently rather than all at once. */
const CITIZEN_POP_TARGET = 120;
const CITIZEN_SPAWN_PER_SUBSTEP = 2;

/** Wellbeing a walking citizen loses per substep spent trudging along a road/stroad — a long
 *  road walk brings home less (the unpleasant commute). Promenades/quiet streets/green cost
 *  nothing. Subtracted from the home deposit on arrival. */
const ROAD_WALK_PENALTY = 0.04;

/** Terrain-aware foot routing over WILD ground (empty land): lush growth is hard to push through
 *  (higher cost), a beaten desire path is easy going (lower cost) — so foot traffic self-reinforces
 *  desire paths over time. PED_GROUND_MIN floors the beaten cost just ABOVE a promenade (0.3) and a
 *  quiet street (0.5), so a promenade the player lays still wins the route and lures peds off the
 *  wild. Flora term adds with lushness; wear term subtracts with beaten-ness (both 0..1). */
const PED_GROUND_BASE = 0.9; // a bare empty tile (no flora, no wear)
const PED_LUSH = 0.8; // added to ground cost at full floraVitality
const PED_BEATEN = 0.7; // subtracted from ground cost at full wear
const PED_GROUND_MIN = 0.4; // floor: a fully-beaten path, still dearer than a promenade

/** A worn desire path is convenient underfoot but DEGRADED (brown, littered): a citizen walking it
 *  brings home less wellbeing. A wearable tile counts as wellbeing-degrading once its wear reaches
 *  WORN_DEGRADE_MIN; each such substep taxes the home deposit by WORN_WALK_PENALTY. */
const WORN_DEGRADE_MIN = 128; // half of WEAR_MAX — clearly a beaten path, not incidental trampling
const WORN_WALK_PENALTY = 0.04;

/** Wellbeing a home loses when one of its citizens can't reach its destination on foot — the
 *  pathing dead-ends (e.g. blocked by a freeway) and the citizen gives up: a lost resident. */
const FAILED_TRIP_PENALTY = 10;

/** A walking citizen's FUEL is a persistent ENERGY tank, not a per-leg budget: it is SPENT crossing
 *  terrain (a beaten path is cheap, lush wild ground dear — see `fuelBurn`) and REFILLED by visiting
 *  good plots (`refuelFor`, scaled by the plot's status/use). A citizen that chases an UNREACHABLE
 *  destination — looping without ever closing the distance — burns the tank down and gives out; this
 *  catches limit cycles LONGER than the `recent` window (RECENT_CAP), which `advanceMover`'s box-in
 *  check alone misses. On burnout mid-trip it turns back home on a small FUEL_LIMP_HOME reserve,
 *  losing GIVE_UP_PENALTY wellbeing; if even that runs out it respawns at home (FAILED_TRIP_PENALTY).
 *  Live-pass tunable. */
const FUEL_TANK = 600; // a full tank — covers a typical round trip even without refuelling
const FUEL_LIMP_HOME = 200; // the reserve granted on give-up, just enough to drag itself home
const FUEL_BURN_BASE = 1; // fuel spent per substep on a paved/built/bare tile
const FUEL_BURN_LUSH = 0.8; // extra burn at full floraVitality — lush ground is tiring
const FUEL_BURN_BEATEN = 0.7; // burn saved on a fully-beaten path — easy underfoot
const FUEL_BURN_MIN = 0.3; // floor on per-substep burn
const FUEL_REFUEL_BASE = 120; // base fuel a visit hands back
const FUEL_REFUEL_PER_VALUE = 30; // × the plot's visitValue (−4..+6): healing refuels lots, industry ~none
const GIVE_UP_PENALTY = 4;

/** Desire-path WEAR: pedestrians beat a path through WILD-GREEN ground (empty land whose flora
 *  is at least WEAR_FLORA_MIN). Each ped on such a tile adds WEAR_RATE per substep up to
 *  WEAR_MAX; unused wear decays by WEAR_DECAY so a path regrows once foot traffic reroutes
 *  (e.g. onto a promenade the player lays down). Live/cosmetic — the deterministic ecology
 *  layers are read, never written. */
const WEAR_MAX = 255;
const WEAR_RATE = 1.5;
// Slow decay so repeated crossings ACCUMULATE into a bold, persistent desire line instead of
// a single faint crossing fading at once; the path still regrows over minutes if foot traffic
// reroutes (e.g. onto a promenade the player lays down).
const WEAR_DECAY = 0.02;

/** Water-runoff pollution: water tiles are impassable and instead collect runoff from the
 *  ground around them, growing heavily polluted over time. Computed every WATER_RUNOFF_CADENCE
 *  substeps; each ground 4-neighbour sheds RUNOFF_* into the water tile (paved/built/worn ground
 *  sheds most, wild ground least), accumulating toward WATER_POLL_MAX. Live/cosmetic. */
const WATER_POLL_MAX = 255;
const WATER_RUNOFF_CADENCE = 20;
const RUNOFF_URBAN = 2; // a paved/built ground neighbour
const RUNOFF_WILD = 0.4; // a wild/empty ground neighbour
const RUNOFF_WORN = 2; // extra when that ground is a beaten desire path

/** Substeps a pedestrian spends INSIDE its destination building before walking back to the
 *  car: a base plus a seeded spread so visitors don't all return together. ~3–13s. */
const INSIDE_DWELL_MIN = 60;
const INSIDE_DWELL_SPAN = 200;

/** How strongly a car prefers to continue straight through a junction vs. turn (the
 *  weight of the straight-ahead option against each side option). High enough that
 *  cars read as through-traffic running a vertical/horizontal road block, low enough
 *  that they still occasionally turn. With 4 ways open: straight ~8/10, each turn
 *  ~1/10. Live-pass tunable. Peds keep uniform choice (weight 1). */
const CAR_STRAIGHT_WEIGHT = 8;

/** How many recently-visited tiles a car remembers for loop avoidance. Big enough to
 *  span the perimeter of a small block (a 2x2 ring is 4, a 3x3 ring is 8), so a car
 *  that has been all the way round is boxed in and despawns rather than circling. */
const RECENT_CAP = 8;

/** Minimum faunaPresence (0..255) for a bird flock to consider a tile. */
const FAUNA_THRESHOLD = 96;

const FLOCK_MIN = 3;
const FLOCK_MAX = 7;

// Boids tuning (sqrt-normalized — no trig). Gentle so a flock stays cohesive.
const BIRD_MAX_SPEED = 0.08;
const BIRD_COHESION = 0.012;
const BIRD_ALIGN = 0.04;
const BIRD_SEPARATION = 0.02;
const BIRD_SEP_RADIUS2 = 1.0; // squared tile distance under which separation kicks in

// 4-neighbour directions, indexed 0=N, 1=E, 2=S, 3=W.
const DIR_DX = [0, 1, 0, -1] as const;
const DIR_DY = [-1, 0, 1, 0] as const;
const opposite = (d: number): number => (d + 2) % 4;

/** Lane half-width in tile units: how far a car is drawn off its tile centre, to the
 *  RIGHT of its heading, so opposing flows ride opposite sides of a road. Cosmetic —
 *  read only by the renderer's sprite draw; live-pass tuned. */
const LANE = 0.22;

/** The lane seam (pure, `dir`-only): a car's draw-time offset from its tile centre,
 *  perpendicular to and on the RIGHT of its heading (right-hand traffic). Screen
 *  coords are y-down, so "right" is the heading rotated 90° clockwise: (dx,dy) →
 *  (-dy, dx). On any vertical/horizontal road the two travel directions are therefore
 *  drawn on opposite sides — bidirectional flow, visibly separated (Maddy playtest).
 *  0=N→east side, 1=E→south side, 2=S→west side, 3=W→north side. */
export function laneOffset(dir: number): { dx: number; dy: number } {
  return { dx: -DIR_DY[dir]! * LANE, dy: DIR_DX[dir]! * LANE };
}

/** How far a street-parked car is drawn toward its curb (the adjacent non-road tile). Larger
 *  than LANE so the car clears the lane centre and hugs the kerb instead of sitting in the
 *  middle of the road — but < 0.5 so it stays within its own tile. */
const CURB = 0.32;

/** A street-parked car's draw-time offset from its tile centre, straight toward its recorded
 *  curb side (curbDir, 0=N/1=E/2=S/3=W) so it parks against the building/grass edge rather
 *  than on the lane. Cosmetic — read only by the renderer. */
export function curbParkOffset(curbDir: number): { dx: number; dy: number } {
  return { dx: DIR_DX[curbDir]! * CURB, dy: DIR_DY[curbDir]! * CURB };
}

/** How far a pedestrian is drawn toward the kerb (perpendicular to its heading) when walking
 *  ALONG a street — bigger than the car LANE so it clears the traffic onto the sidewalk edge.
 *  Opposite-direction walkers ride opposite kerbs (right-hand), so both sides of the street
 *  are used. Through-the-middle is reserved for demand-path cut-throughs across open ground. */
const PED_CURB = 0.38;

/** A pedestrian's draw-time kerb offset (perpendicular-right of its heading), for when it is
 *  walking along a road. Cosmetic — read only by the renderer's sprite draw. */
export function pedCurbOffset(dir: number): { dx: number; dy: number } {
  return { dx: -DIR_DY[dir]! * PED_CURB, dy: DIR_DX[dir]! * PED_CURB };
}

/** A grid-following sprite: float world position + heading + committed target tile. */
export interface Mover {
  /** Float world position in tile units. */
  x: number;
  y: number;
  /** Current travel direction (0=N, 1=E, 2=S, 3=W). */
  dir: number;
  /** Committed target tile (integer tile coords) — the end of the current leg. */
  tx: number;
  ty: number;
  /** Recently-visited tile indices (bounded, oldest-first) for loop avoidance. A car
   *  prefers a neighbour NOT in this list; if boxed in (all options recent) it
   *  despawns instead of circling. Lazily created on first recommit. */
  recent?: number[];
  /** Committed trip path (tile indices, origin→destination) — set for cars that ARE the
   *  sim's planned O-D trips. A car with a `path` follows it leg by leg (see pathStep)
   *  and despawns on arrival, instead of wandering. */
  path?: readonly number[];
  /** Cursor into `path`: the index of the NEXT tile to commit to. */
  leg?: number;
  /** Straight-line walk target (float world coords) — set for LAST-MILE pedestrians who
   *  walk between a parked car and a nearby building. A ped with `walkTo` lerps straight
   *  toward it (ignoring the road/ped grid, so it can cross a lot or road), despawns on
   *  arrival, and is exempt from the ped-substrate despawn. */
  walkTo?: { x: number; y: number };
  /** A car that has finished its trip and is PARKED — in a lot stall (lotIdx/stallIdx set)
   *  or at a street curb (lotIdx undefined). It waits for its bound pedestrian to return,
   *  then leaves; `dwell` is a safety countdown (the ped normally releases it by zeroing it). */
  parked?: boolean;
  dwell?: number;
  lotIdx?: number;
  stallIdx?: number;
  /** Stable id assigned when a car parks, so its pedestrian can find its way back to it. */
  id?: number;
  /** The citizen's HOME building tile (a residential neighbour of the trip origin), set when
   *  a trip leaves a residential plot. The destination's visit wellbeing is deposited here on
   *  return. Undefined ⇒ a non-residential (freight) trip — no home, no health deposit. */
  homeTile?: number;
  /** For a street-parked car: the direction (0=N/1=E/2=S/3=W) toward its curb (the adjacent
   *  non-road tile), so the renderer draws it hugging the kerb instead of in the lane. */
  curbDir?: number;
  /** A colour tag bound to the car at spawn (a non-negative int the renderer maps into its
   *  palette mod its length). Stays with the car for its whole life, so it shows the same
   *  colour moving on the road and parked in a lot. */
  tint?: number;
  /** A pedestrian on a citizen trip. A DRIVE trip's last-mile ped is bound to a parked car
   *  (`carId`) and returns to it ('to-car'); a WALK trip's ped has no car and returns home
   *  ('to-home'), depositing the visit at `homeTile` on arrival. `phase` tracks the leg;
   *  `building` is the destination plot (the wellbeing source); `dwellInside` times the visit. */
  carId?: number;
  phase?: 'to-building' | 'inside' | 'to-car' | 'to-home';
  building?: { x: number; y: number };
  dwellInside?: number;
  /** Substeps a walking citizen has spent on a road/stroad this trip — taxes the home deposit. */
  roadSteps?: number;
  /** Substeps a walking citizen has spent on a heavily-WORN (degraded) desire path this trip —
   *  also taxes the home deposit: a beaten path is convenient underfoot but bleak. */
  wornSteps?: number;
  /** A citizen's daily round: the ordered stop CATEGORIES it visits (work, shop, lifestyle) before
   *  heading home. Undefined ⇒ a single-stop walk (a sim trip). `itinStep` is the index of the stop
   *  it is currently travelling to / visiting; on each `inside` it advances to the next reachable
   *  stop, banking that visit's wellbeing at home, and heads home once the round is done. */
  itinerary?: readonly StopCategory[];
  itinStep?: number;
  /** A walking citizen's remaining FUEL: a persistent energy tank (lazily FUEL_TANK), spent per
   *  substep by the terrain underfoot and refilled at plots. When it hits zero the citizen gives up
   *  — turns home on a limp reserve, or respawns at home if even that fails. Guards against
   *  oscillation toward an unreachable destination (a limit cycle the `recent` window can't catch). */
  fuel?: number;
  /** The travel MODE for the current leg (walk/bike/streetcar/rail/drive). Undefined ⇒ Walk (the
   *  default + back-compat). Chosen per leg by distance + nearby infra; sets which tiles the mover
   *  can enter, which it hugs (the mode's network), and how fast it goes. */
  mode?: TravelMode;
}

export type Car = Mover;
export type Ped = Mover;

/** One bird within a flock. */
export interface Bird {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

/** A bird flock: a cohesive cluster of 3..7 boids. */
export interface Flock {
  birds: Bird[];
}

/** A parking lot the ambient layer can store cars in: its centre (for the nearest-lot
 *  search when a trip-car arrives) and its stall centres (float world coords, capacity =
 *  stalls.length). Occupancy is dynamic — derived from the parked cars, not stored here. */
export interface ParkingLotInfo {
  cx: number;
  cy: number;
  stalls: ReadonlyArray<{ x: number; y: number }>;
}

/** The full ambient sprite state — renderer-side only, never part of the world. */
export interface AmbientState {
  cars: Car[];
  peds: Ped[];
  birds: Flock[];
  /** Leftover sub-substep time carried between stepAmbient calls. */
  accMs: number;
  /** The parking lots that STORE the moving cars: a trip-car parks in the nearest one on
   *  arrival (or at a street curb if none is free), waits for its pedestrian, then leaves.
   *  Renderer-side, set by the host via setParkingLots; never part of the world hash. */
  parkingLots?: ReadonlyArray<ParkingLotInfo>;
  /** Monotonic counter for parked-car ids (so a pedestrian can rebind to its own car). */
  nextCarId?: number;
  /** Live per-building HEALTH, keyed by home building tile index: the running sum of what
   *  its citizens bring home from their trips (decayed toward neutral). Renderer-side, never
   *  hashed — it reads the deterministic world but is a live overlay quantity. */
  buildingHealth: Map<number, number>;
  /** Live trample WEAR (0..WEAR_MAX), keyed by tile index: how hard pedestrians have beaten a
   *  desire path through a wild-green tile. Accumulates under foot traffic, decays when unused
   *  (the path regrows). Renderer-side, never hashed — the deterministic ecology is untouched;
   *  the renderer browns the ground + litters trash by this value. */
  wear: Map<number, number>;
  /** Live WATER POLLUTION (0..WATER_POLL_MAX), keyed by water tile index: runoff collected from
   *  the surrounding ground, growing heavily polluted over time. Renderer-side, never hashed. */
  waterPollution: Map<number, number>;
  /** Substep counter gating the (whole-map) water-runoff pass to WATER_RUNOFF_CADENCE. */
  waterTick: number;
  /** The residential homes citizens are spawned from (the census), published by the host via
   *  setHouseholds. Each spawn picks a home weighted by its citizen count (denser → more people
   *  out), so the daily-itinerary population reflects the built city. Renderer-side, never hashed. */
  households?: ReadonlyArray<Household>;
}

export function createAmbientState(): AmbientState {
  return {
    cars: [],
    peds: [],
    birds: [],
    accMs: 0,
    buildingHealth: new Map(),
    wear: new Map(),
    waterPollution: new Map(),
    waterTick: 0,
  };
}

/** Publish the parking lots that store moving cars. The host (main.ts) computes these from
 *  the map's ParkingLot components (centre + stall grid) so parked cars land on the stalls. */
export function setParkingLots(state: AmbientState, lots: ReadonlyArray<ParkingLotInfo>): void {
  state.parkingLots = lots;
}

/** Publish the residential homes citizens spawn from (the host computes these from the parcel
 *  store via residentialCensus). Mirrors setParkingLots — structural, never part of the world. */
export function setHouseholds(state: AmbientState, households: ReadonlyArray<Household>): void {
  state.households = households;
}

// --- Pure decision helpers (unit-test seams) -----------------------------

/**
 * Spawn WEIGHT for cars by road class: highway 3 / avenue 2 / street 1, and 0 for
 * quiet streets, rail, buildings and empty land. THE load-bearing ratio contract —
 * an exact, deterministic function with no tolerance.
 */
export function carWeightForRoad(kind: number): number {
  switch (kind) {
    case BuiltKind.RoadHighway:
      return 3;
    case BuiltKind.RoadAvenue:
      return 2;
    case BuiltKind.RoadStreet:
      return 1;
    default:
      return 0;
  }
}

/**
 * Car TRAVERSABILITY: kinds 1..3 (street/avenue/highway). Pinned to isRoadKind, NOT
 * transportCategory (which returns 1 for QuietStreet) — so a car neither spawns on
 * nor moves onto a quiet street. This is the seam that closes the spawn-vs-move gap.
 */
export function isCarRoad(kind: number): boolean {
  return isRoadKind(kind);
}

/** A lane within a divided multi-lane road (a widened avenue/freeway: parallel rows
 *  of the SAME road kind). An `outer` lane is one-way (right-hand traffic) with its
 *  `dir` heading and `outward` road edge; the `median` is the interior of a 3+-wide
 *  road and carries no traffic. */
export type FreewayLane =
  | { role: 'outer'; dir: number; outward: number }
  | { role: 'median' };

/** Per-direction cap when measuring a same-kind run: widths are 2–3, so a short cap
 *  ranks the two axes (the shorter run is the road's width) without scanning a whole
 *  freeway's length, and classifies end tiles the same as mid tiles. */
const LANE_SCAN_CAP = 3;

/** Length of the same-kind run from (x, y) in direction (dx, dy), exclusive of the
 *  origin, capped at LANE_SCAN_CAP. */
function sameRun(map: GameMap, x: number, y: number, k: number, dx: number, dy: number): number {
  let n = 0;
  for (let i = 1; i <= LANE_SCAN_CAP; i++) {
    const nx = x + dx * i;
    const ny = y + dy * i;
    if (!map.inBounds(nx, ny) || map.built[map.idx(nx, ny)] !== k) break;
    n++;
  }
  return n;
}

/**
 * Classify a road tile's place in a divided multi-lane road, or `null` if it is not a
 * clean multi-lane lane — a 1-wide road or a junction where the two same-kind bands are
 * equal (a square crossing). Those fall back to general straight-biased routing, so a
 * car CAN turn there: that is exactly "turns only at a true junction". Read purely from
 * same-kind neighbours (read-only, no rng):
 *   1. Measure the same-kind run length along each axis (capped). The shorter run is the
 *      road's WIDTH axis; the longer is its LENGTH. This ranks correctly at lane ends
 *      and mid-lane alike (an end tile still has the full width band).
 *   2. On the width axis: same-kind road on BOTH sides → `median` (interior of a 3+-wide
 *      road, no traffic). Same-kind on one side only → `outer`: the bare side is the road
 *      `outward` edge (kerb), and the one-way `dir` is the heading whose right-hand side
 *      is that edge (right-hand traffic). So a horizontal freeway's north lane runs west
 *      and its south lane runs east; `laneOffset(dir)` then nudges each carriageway to
 *      its own kerb. Neither side same → 1-wide road → `null`.
 */
export function freewayLane(map: GameMap, x: number, y: number): FreewayLane | null {
  const k = map.built[map.idx(x, y)]!;
  // Only worldgen-WIDENED roads are divided: avenues are 2-wide, highways 3-wide.
  // Streets are 1-wide by construction, so a same-kind street neighbour is a junction
  // arm, never a parallel lane — classifying a street as a lane misreads a staggered
  // street junction as two OPPOSING one-way tiles that oscillate (Maddy degenerate).
  if (k !== BuiltKind.RoadAvenue && k !== BuiltKind.RoadHighway) return null;
  const same = (d: number): boolean => {
    const nx = x + DIR_DX[d]!;
    const ny = y + DIR_DY[d]!;
    return map.inBounds(nx, ny) && map.built[map.idx(nx, ny)] === k;
  };
  const vert = 1 + sameRun(map, x, y, k, 0, -1) + sameRun(map, x, y, k, 0, 1);
  const horiz = 1 + sameRun(map, x, y, k, -1, 0) + sameRun(map, x, y, k, 1, 0);
  if (horiz > vert) {
    // Horizontal road — width is the N–S axis.
    const n = same(0); // North neighbour same-kind?
    const s = same(2); // South neighbour same-kind?
    if (n && s) return { role: 'median' };
    if (s && !n) return { role: 'outer', dir: 3, outward: 0 }; // north lane → West
    if (n && !s) return { role: 'outer', dir: 1, outward: 2 }; // south lane → East
    return null;
  }
  if (vert > horiz) {
    // Vertical road — width is the E–W axis.
    const e = same(1); // East neighbour same-kind?
    const w = same(3); // West neighbour same-kind?
    if (e && w) return { role: 'median' };
    if (e && !w) return { role: 'outer', dir: 2, outward: 3 }; // west lane → South
    if (w && !e) return { role: 'outer', dir: 0, outward: 1 }; // east lane → North
    return null;
  }
  return null; // equal bands — a square crossing → general routing (a true junction)
}

/**
 * Pedestrian SUBSTRATE at (x, y): a quiet street, promenade, or parklet tile, OR any
 * tile orthogonally adjacent to a community garden, park, or rewilded land. Peds
 * favour the calm/green city, never the road network.
 */
export function isPedSubstrate(map: GameMap, x: number, y: number): boolean {
  if (!map.inBounds(x, y)) return false;
  const k = map.built[map.idx(x, y)]!;
  if (k === BuiltKind.QuietStreet || k === BuiltKind.Promenade || k === BuiltKind.Parklet) {
    return true;
  }
  for (let d = 0; d < 4; d++) {
    const nx = x + DIR_DX[d]!;
    const ny = y + DIR_DY[d]!;
    if (!map.inBounds(nx, ny)) continue;
    const nk = map.built[map.idx(nx, ny)]!;
    if (nk === BuiltKind.CommunityGarden || nk === BuiltKind.Park || nk === BuiltKind.RewildedLand) {
      return true;
    }
  }
  return false;
}

/**
 * Bird-flock spawn predicate: faunaPresence at (x, y) is at or above the threshold
 * (a dead zone — fauna below threshold, including 0 — is excluded).
 */
export function birdSpawnAt(map: GameMap, x: number, y: number): boolean {
  if (!map.inBounds(x, y)) return false;
  return map.faunaPresence[map.idx(x, y)]! >= FAUNA_THRESHOLD;
}

/** Generic junction step: pick a connected passable neighbour direction, excluding
 *  the U-turn `fromDir` unless it is the only option (dead-end). -1 if isolated.
 *
 *  `straightWeight` (default 1 = uniform) biases the choice toward continuing in the
 *  current heading (the direction opposite the U-turn): with N ways open, the
 *  straight option weighs `straightWeight` against 1 for each turn. Cars pass a high
 *  weight so they run a road block and cross junctions instead of looping small
 *  blocks (Maddy playtest); peds keep the uniform default.
 *
 *  `recent` (tile indices recently occupied) drives loop avoidance: options leading to
 *  a recently-visited tile are dropped UNLESS that would leave nothing, in which case
 *  the mover is boxed in by its own path and the step returns -1 (the caller despawns
 *  it rather than letting it circle). A dead-end U-turn is still taken (it is the
 *  `options.length === 0` path, before avoidance). Determinism note: the dead-end and
 *  single-fresh-option paths consume the rng exactly as before, so junction-free maps
 *  are byte-identical when `recent` never prunes. */
function pickStep(
  map: GameMap,
  x: number,
  y: number,
  fromDir: number,
  rng: Rng,
  passable: (nx: number, ny: number) => boolean,
  straightWeight = 1,
  recent?: readonly number[],
): number {
  const options: number[] = [];
  let uTurn = -1;
  for (let d = 0; d < 4; d++) {
    const nx = x + DIR_DX[d]!;
    const ny = y + DIR_DY[d]!;
    if (!map.inBounds(nx, ny)) continue;
    if (!passable(nx, ny)) continue;
    if (d === fromDir) {
      uTurn = d;
      continue;
    }
    options.push(d);
  }
  if (options.length === 0) return uTurn; // dead-end (or -1 if truly isolated)
  // Loop avoidance: prefer options that do not revisit a recent tile. If every option
  // is recent, the mover is boxed in by its own path → -1 (caller despawns it).
  let pool = options;
  if (recent && recent.length > 0) {
    const fresh = options.filter((d) => !recent.includes(map.idx(x + DIR_DX[d]!, y + DIR_DY[d]!)));
    if (fresh.length === 0) return -1;
    pool = fresh;
  }
  // Uniform choice when there's nothing to bias toward: a single option, no weight,
  // or no incoming heading (fromDir < 0, i.e. spawn) — at spawn there is no "straight"
  // to prefer, and keeping the uniform draw makes spawn rng-identical to before.
  if (pool.length === 1 || straightWeight <= 1 || fromDir < 0) {
    return pool[rng.nextInt(pool.length)]!;
  }
  // Weighted junction choice: the straight-ahead direction (opposite the U-turn)
  // outweighs each turn by `straightWeight`, so traffic flows through the corridor.
  const straight = opposite(fromDir);
  let total = 0;
  for (const d of pool) total += d === straight ? straightWeight : 1;
  let r = rng.nextInt(total);
  for (const d of pool) {
    r -= d === straight ? straightWeight : 1;
    if (r < 0) return d;
  }
  return pool[pool.length - 1]!; // unreachable: r < total
}

/** Routing on a divided multi-lane road's outer lane: travel the one-way `dir`; turn
 *  off ONLY where a cross-road meets the outward edge (a true junction); never weave
 *  across to the median/opposite carriageway and never reverse. */
function freewayStep(
  map: GameMap,
  x: number,
  y: number,
  lane: { dir: number; outward: number },
  rng: Rng,
): number {
  const ax = x + DIR_DX[lane.dir]!;
  const ay = y + DIR_DY[lane.dir]!;
  const aheadRoad = map.inBounds(ax, ay) && isCarRoad(map.built[map.idx(ax, ay)]!);
  const ox = x + DIR_DX[lane.outward]!;
  const oy = y + DIR_DY[lane.outward]!;
  const exitRoad = map.inBounds(ox, oy) && isCarRoad(map.built[map.idx(ox, oy)]!);
  if (aheadRoad && exitRoad) {
    // True junction: mostly stay on the freeway, occasionally take the ramp.
    return rng.nextInt(CAR_STRAIGHT_WEIGHT + 1) === 0 ? lane.outward : lane.dir;
  }
  if (aheadRoad) return lane.dir; // open freeway — straight, no turns, no weaving
  if (exitRoad) return lane.outward; // freeway ended at a ramp — exit
  return lane.dir; // ran out of road — continue off-network, despawn next step
}

/** A car may occupy a road (1..3) or a parking lot — cars cut THROUGH parking (the
 *  accumulated concrete of the over-paved city) rather than routing around it. */
function carTraversable(kind: number): boolean {
  return isCarRoad(kind) || kind === BuiltKind.ParkingLot;
}

/** Car traversability for general (non-lane) routing: a road or parking tile that is
 *  NOT a divided road's median. Cars neither spawn on, weave onto, nor turn (at a
 *  junction) onto a median — so the median stays a true no-traffic gap. */
function carPassable(map: GameMap, x: number, y: number): boolean {
  if (!carTraversable(map.built[map.idx(x, y)]!)) return false;
  const lane = freewayLane(map, x, y);
  return lane === null || lane.role !== 'median';
}

/**
 * The car motion seam: from road tile (x, y), the chosen connected isRoadKind
 * neighbour direction (0..3). On a divided multi-lane road's outer lane the choice is
 * the one-way `freewayStep` (independent of `fromDir`, including spawn); otherwise it
 * is the general straight-biased junction pick over `carPassable` neighbours (never a
 * median), excluding the U-turn `fromDir` unless it is the only connected road
 * (dead-end), and avoiding tiles in `recent` (loop avoidance — returns -1 if boxed in
 * by its own path). -1 if (x, y) has no road neighbour at all. Deterministic given `rng`.
 */
export function nextRoadStep(
  map: GameMap,
  x: number,
  y: number,
  fromDir: number,
  rng: Rng,
  recent?: readonly number[],
): number {
  const lane = freewayLane(map, x, y);
  if (lane && lane.role === 'outer') {
    return freewayStep(map, x, y, lane, rng); // one-way: cannot loop, no avoidance needed
  }
  return pickStep(map, x, y, fromDir, rng, (nx, ny) => carPassable(map, nx, ny), CAR_STRAIGHT_WEIGHT, recent);
}

/** The pedestrian motion seam: the same junction rule over ped substrate. */
function nextPedStep(map: GameMap, x: number, y: number, fromDir: number, rng: Rng): number {
  return pickStep(map, x, y, fromDir, rng, (nx, ny) => isPedSubstrate(map, nx, ny));
}

// --- Despawn predicates --------------------------------------------------

/** A car is gone once the tile under it is no longer traversable — a road or parking
 *  lot (e.g. bulldozed/converted, or driven off the far side of the lot it cut through). */
function carOffNetwork(map: GameMap, c: Car): boolean {
  const x = Math.round(c.x);
  const y = Math.round(c.y);
  if (!map.inBounds(x, y)) return true;
  return !carTraversable(map.built[map.idx(x, y)]!);
}

/** A ped is gone once the tile under it is no longer pedestrian substrate. */
function pedOffNetwork(map: GameMap, p: Ped): boolean {
  return !isPedSubstrate(map, Math.round(p.x), Math.round(p.y));
}

/** A flock's representative tile = its (in-bounds-clamped) centre of mass. */
function flockTile(map: GameMap, f: Flock): { x: number; y: number } {
  let cx = 0;
  let cy = 0;
  for (const b of f.birds) {
    cx += b.x;
    cy += b.y;
  }
  const n = f.birds.length;
  const x = Math.min(map.width - 1, Math.max(0, Math.floor(cx / n)));
  const y = Math.min(map.height - 1, Math.max(0, Math.floor(cy / n)));
  return { x, y };
}

// --- Motion --------------------------------------------------------------

/** Advance one grid-following mover by `speed`, recommitting at the target tile.
 *  `map`/`rng` are captured by `pickNext` (the per-kind junction seam); the mover's
 *  bounded `recent` history is updated on arrival and passed to `pickNext` for loop
 *  avoidance. Returns false when the mover is boxed in / isolated (pickNext < 0) so the
 *  caller despawns it instead of leaving it frozen or circling; true otherwise. */
function advanceMover(
  m: Mover,
  speed: number,
  map: GameMap,
  pickNext: (x: number, y: number, fromDir: number, recent: readonly number[]) => number,
): boolean {
  const dist = Math.abs(m.tx - m.x) + Math.abs(m.ty - m.y);
  if (dist <= speed) {
    // Arrive at the target tile centre, record it, and recommit to the next leg.
    m.x = m.tx;
    m.y = m.ty;
    const recent = (m.recent ??= []);
    recent.push(map.idx(m.tx, m.ty));
    if (recent.length > RECENT_CAP) recent.shift();
    const fromDir = opposite(m.dir);
    const nd = pickNext(m.tx, m.ty, fromDir, recent);
    if (nd < 0) return false; // isolated, or boxed in by its own path → despawn
    m.dir = nd;
    m.tx = m.x + DIR_DX[nd]!;
    m.ty = m.y + DIR_DY[nd]!;
  } else {
    m.x += DIR_DX[m.dir]! * speed;
    m.y += DIR_DY[m.dir]! * speed;
  }
  return true;
}

/** Ped-walkable: any in-bounds, non-water tile that is NOT an occupied R/C/I/Civic plot and NOT
 *  a FREEWAY (RoadHighway) — local streets, stroads, transit, PARKING, parks, rewilded greens,
 *  empty land all walk; building footprints + freeways block. Routed pedestrians step across
 *  the walkable set (around plots), so they no longer cut diagonally through buildings. */
function isWalkable(map: GameMap, x: number, y: number): boolean {
  if (!map.inBounds(x, y)) return false;
  if (map.water[map.idx(x, y)] !== 0) return false; // Water.None === 0
  const k = map.built[map.idx(x, y)]!;
  if (k === BuiltKind.RoadHighway) return false; // a pedestrian can't cross a freeway
  return zoneTypeOf(k) === ZoneType.None;
}

/** A pedestrian's PREFERENCE cost for a walkable tile (lower = nicer): promenades best, then
 *  calm streets, then a LOCAL street by inverse traffic density, then open ground, with stroads
 *  (avenues) worst. So peds drift onto promenades and shun busy stroads where the route allows.
 *  WILD ground (empty land) is terrain-aware via `wear`: lush is dear, a beaten desire path cheap
 *  (foot traffic self-reinforces paths). */
function pedCost(map: GameMap, x: number, y: number, wear?: ReadonlyMap<number, number>): number {
  const i = map.idx(x, y);
  const k = map.built[i]!;
  if (k === BuiltKind.Promenade) return 0.3;
  if (k === BuiltKind.QuietStreet || k === BuiltKind.BikePath) return 0.5;
  const trafficLoad = (map.traffic[i]! / 255) * 2; // inverse traffic density: busier → costlier
  if (k === BuiltKind.RoadStreet) return 0.55 + trafficLoad; // a local street
  if (k === BuiltKind.RoadAvenue) return 2.0 + trafficLoad; // a stroad — unpleasant on foot
  if (k === BuiltKind.None) {
    // wild ground: lush growth (high flora) is hard going; a beaten path (high wear) is easy.
    const flora = map.floraVitality[i]! / 255;
    const worn = (wear?.get(i) ?? 0) / WEAR_MAX;
    return Math.max(PED_GROUND_MIN, PED_GROUND_BASE + flora * PED_LUSH - worn * PED_BEATEN);
  }
  return 0.9; // parking / transit / built greens
}

/** Fuel a citizen spends on one substep at (x,y) — the SPEND side of the fuel economy, twinned with
 *  `pedCost`'s routing: a beaten desire path is cheap, lush wild ground dear, pavement/built nominal.
 *  So citizens go further on worn paths (and the network of paths reinforces itself). */
function fuelBurn(map: GameMap, wear: ReadonlyMap<number, number>, x: number, y: number): number {
  const i = map.idx(x, y);
  if (map.built[i] !== BuiltKind.None || map.water[i] !== 0) return FUEL_BURN_BASE; // paved/built/edge
  const flora = map.floraVitality[i]! / 255;
  const worn = (wear.get(i) ?? 0) / WEAR_MAX;
  return Math.max(FUEL_BURN_MIN, FUEL_BURN_BASE + flora * FUEL_BURN_LUSH - worn * FUEL_BURN_BEATEN);
}

/** Fuel a successful visit to a plot of `kind` hands back — the REFILL side: scaled by the plot's
 *  status/use (`visitValue`), floored at 0 so a grim industrial visit refuels ~nothing while a
 *  healing commons tops the tank right up. */
function refuelFor(kind: number): number {
  return Math.max(0, FUEL_REFUEL_BASE + visitValue(kind) * FUEL_REFUEL_PER_VALUE);
}

/** Wild-green ground a desire path forms through: ANY empty land (no road/building) that isn't
 *  water. Empty ground IS the wild green — even bare patches wear and litter under foot traffic
 *  (water is impassable and pollutes instead). Pedestrians crossing these trample them brown. */
export function isWearable(map: GameMap, x: number, y: number): boolean {
  if (!map.inBounds(x, y)) return false;
  const i = map.idx(x, y);
  return map.built[i] === BuiltKind.None && map.water[i] === 0;
}

/** Can a citizen on `mode` occupy the tile at (x,y)? A driver is PAVEMENT-ONLY (roads + parking,
 *  no median) — it can't cross wild ground or a promenade; every other mode travels over the
 *  pedestrian-walkable set, which already includes transit tiles (a rider boards by walking onto
 *  the line, then rides it fast). */
function modeCanEnter(mode: TravelMode, map: GameMap, x: number, y: number): boolean {
  if (!map.inBounds(x, y)) return false;
  return modeSpec(mode).pavementOnly ? carPassable(map, x, y) : isWalkable(map, x, y);
}

/** A mode's routing COST for a tile (lower = preferred): cheap ON the mode's network so the mover
 *  hugs the bike path / tram line / rail / road; off-network it pays the pedestrian preference
 *  cost (a driver, being pavement-only, is always on its road network). */
function modeCost(
  mode: TravelMode,
  map: GameMap,
  x: number,
  y: number,
  wear?: ReadonlyMap<number, number>,
): number {
  const k = map.built[map.idx(x, y)]!;
  if (modeRidesNetwork(mode, k)) return modeSpec(mode).networkCost;
  return modeSpec(mode).pavementOnly ? modeSpec(mode).networkCost : pedCost(map, x, y, wear);
}

/** A routed citizen's next grid step toward (tgtx, tgty) for travel `mode` (default Walk): the
 *  mode-enterable, non-recent 4-neighbour that most reduces Manhattan distance, broken by the
 *  mode's routing cost (so a rider hugs its line, a driver its roads). Returns -1 when within one
 *  tile of the target (arrived) OR when boxed in. Axis-aligned → no diagonals. */
function nextStepToward(
  map: GameMap,
  x: number,
  y: number,
  tgtx: number,
  tgty: number,
  recent?: readonly number[],
  wear?: ReadonlyMap<number, number>,
  mode: TravelMode = TravelMode.Walk,
): number {
  if (Math.abs(x - tgtx) + Math.abs(y - tgty) <= 1) return -1; // at / adjacent to the target
  let best = -1;
  let bestScore = 1e9;
  for (let d = 0; d < 4; d++) {
    const nx = x + DIR_DX[d]!;
    const ny = y + DIR_DY[d]!;
    if (!modeCanEnter(mode, map, nx, ny)) continue;
    if (recent && recent.includes(map.idx(nx, ny))) continue;
    // Distance dominates (still reaches the target); the mode cost hugs lines / shuns stroads.
    const score = Math.abs(nx - tgtx) + Math.abs(ny - tgty) + modeCost(mode, map, nx, ny, wear);
    if (score < bestScore) {
      bestScore = score;
      best = d;
    }
  }
  return best;
}

/** The nearest demand tile (R/C/I/Civic via zoneTypeOf — a place a person walks to/from)
 *  within LASTMILE_RADIUS of (cx, cy), by Manhattan distance; null if none. */
function nearestDemandTile(map: GameMap, cx: number, cy: number): { x: number; y: number } | null {
  let bx = -1;
  let by = -1;
  let bestD = 1e9;
  for (let y = cy - LASTMILE_RADIUS; y <= cy + LASTMILE_RADIUS; y++) {
    for (let x = cx - LASTMILE_RADIUS; x <= cx + LASTMILE_RADIUS; x++) {
      if (!map.inBounds(x, y)) continue;
      if (zoneTypeOf(map.built[map.idx(x, y)]!) === ZoneType.None) continue;
      const d = Math.abs(x - cx) + Math.abs(y - cy);
      if (d < bestD) {
        bestD = d;
        bx = x;
        by = y;
      }
    }
  }
  return bx < 0 ? null : { x: bx, y: by };
}

/** The nearest plot serving stop `category` (work/shop/lifestyle via stopCategoryOf) within
 *  CITIZEN_TRIP_RADIUS of (cx, cy), by Manhattan distance; null if the district has none. */
function nearestOfCategory(
  map: GameMap,
  cx: number,
  cy: number,
  category: StopCategory,
): { x: number; y: number } | null {
  let bx = -1;
  let by = -1;
  let bestD = 1e9;
  for (let y = cy - CITIZEN_TRIP_RADIUS; y <= cy + CITIZEN_TRIP_RADIUS; y++) {
    for (let x = cx - CITIZEN_TRIP_RADIUS; x <= cx + CITIZEN_TRIP_RADIUS; x++) {
      if (!map.inBounds(x, y)) continue;
      if (stopCategoryOf(map.built[map.idx(x, y)]!) !== category) continue;
      const d = Math.abs(x - cx) + Math.abs(y - cy);
      if (d < bestD) {
        bestD = d;
        bx = x;
        by = y;
      }
    }
  }
  return bx < 0 ? null : { x: bx, y: by };
}

/** Advance a citizen to the NEXT reachable stop on its daily round: from its current position,
 *  aim it at the nearest plot of the next itinerary category (skipping categories the district
 *  lacks). Sets it walking ('to-building') toward that plot and resets the leg's walk tolls.
 *  Returns false when no stops remain — the caller then sends it home. */
function advanceItinerary(p: Ped, map: GameMap): boolean {
  const itin = p.itinerary!;
  const cx = Math.round(p.x);
  const cy = Math.round(p.y);
  for (let step = (p.itinStep ?? 0) + 1; step < itin.length; step++) {
    const plot = nearestOfCategory(map, cx, cy, itin[step]!);
    if (plot) {
      p.itinStep = step;
      p.phase = 'to-building';
      p.walkTo = { x: plot.x, y: plot.y };
      p.building = { x: plot.x, y: plot.y };
      p.mode = chooseMode(map, cx, cy, plot.x, plot.y); // pick how to get there (walk/bike/transit/drive)
      p.roadSteps = undefined; // a fresh leg — its tolls accrue anew
      p.wornSteps = undefined;
      return true;
    }
  }
  p.itinStep = itin.length; // round exhausted
  return false;
}

/** Is a tile of `mode`'s network within MODE_INFRA_RADIUS of (cx, cy)? (Is this mode served here?) */
function infraNear(map: GameMap, cx: number, cy: number, mode: TravelMode): boolean {
  for (let y = cy - MODE_INFRA_RADIUS; y <= cy + MODE_INFRA_RADIUS; y++) {
    for (let x = cx - MODE_INFRA_RADIUS; x <= cx + MODE_INFRA_RADIUS; x++) {
      if (!map.inBounds(x, y)) continue;
      if (modeRidesNetwork(mode, map.built[map.idx(x, y)]!)) return true;
    }
  }
  return false;
}

/** Choose a citizen's travel MODE for a leg origin→dest: WALK if close; else the best available
 *  premium mode — transit (rail, then streetcar) when a line serves BOTH ends, a BIKE for medium
 *  distances (bikes need no special infra — bike paths just speed them), and DRIVE only for a long
 *  leg with no transit. So a player's transit build / road-diet shifts citizens off cars (the
 *  congestion → mode-shift → bloom loop). Falls back to walking when nothing else fits. */
export function chooseMode(map: GameMap, ox: number, oy: number, dx: number, dy: number): TravelMode {
  const d = Math.abs(ox - dx) + Math.abs(oy - dy);
  if (d <= WALK_RANGE) return TravelMode.Walk;
  for (const mode of MODE_CHOICE_ORDER) {
    if (mode === TravelMode.Bike) {
      if (d <= BIKE_RANGE) return TravelMode.Bike;
      continue;
    }
    // rail / streetcar / drive: available when their network serves BOTH ends of the leg.
    if (infraNear(map, ox, oy, mode) && infraNear(map, dx, dy, mode)) return mode;
  }
  return TravelMode.Walk;
}

/** Advance one flock by one boids substep (cohesion + alignment + separation). */
function advanceFlock(f: Flock): void {
  const n = f.birds.length;
  if (n === 0) return;
  let cx = 0;
  let cy = 0;
  let avx = 0;
  let avy = 0;
  for (const b of f.birds) {
    cx += b.x;
    cy += b.y;
    avx += b.vx;
    avy += b.vy;
  }
  cx /= n;
  cy /= n;
  avx /= n;
  avy /= n;
  for (const b of f.birds) {
    let ax = (cx - b.x) * BIRD_COHESION + (avx - b.vx) * BIRD_ALIGN;
    let ay = (cy - b.y) * BIRD_COHESION + (avy - b.vy) * BIRD_ALIGN;
    for (const o of f.birds) {
      if (o === b) continue;
      const dx = b.x - o.x;
      const dy = b.y - o.y;
      const d2 = dx * dx + dy * dy;
      if (d2 > 0 && d2 < BIRD_SEP_RADIUS2) {
        const d = Math.sqrt(d2);
        ax += (dx / d) * (BIRD_SEPARATION / d);
        ay += (dy / d) * (BIRD_SEPARATION / d);
      }
    }
    b.vx += ax;
    b.vy += ay;
    const sp = Math.sqrt(b.vx * b.vx + b.vy * b.vy);
    if (sp > BIRD_MAX_SPEED) {
      b.vx = (b.vx / sp) * BIRD_MAX_SPEED;
      b.vy = (b.vy / sp) * BIRD_MAX_SPEED;
    }
    b.x += b.vx;
    b.y += b.vy;
  }
}

// --- Spawning ------------------------------------------------------------

/** A fresh random in-bounds tile (2 rng draws). */
function sampleTile(map: GameMap, rng: Rng): { x: number; y: number } {
  return { x: rng.nextInt(map.width), y: rng.nextInt(map.height) };
}

/**
 * Spawn trip-cars from the sim's published origin→destination trips: cars ARE trips. Each
 * car follows its committed `path` leg by leg and despawns on arrival. Called once per
 * traffic cadence with that cadence's found trips; capped at CAR_CAP. Renderer-side and
 * deterministic — the paths come from the (deterministic) sim; the animation draws no rng.
 * `trips` is structural ({ path }) so this module stays decoupled from the traffic layer.
 */
export function ingestTrips(
  state: AmbientState,
  trips: ReadonlyArray<{ path: readonly number[] }>,
  map: GameMap,
): void {
  let moving = 0; // parked cars are stored, not traffic — cap only the moving ones
  for (const c of state.cars) if (!c.parked) moving++;
  for (const trip of trips) {
    if (trip.path.length < 2) continue; // need at least one leg to travel
    const p0 = trip.path[0]!;
    const p1 = trip.path[1]!;
    const x0 = p0 % map.width;
    const y0 = (p0 - x0) / map.width;
    const x1 = p1 % map.width;
    const y1 = (p1 - x1) / map.width;
    const dir = x1 > x0 ? 1 : x1 < x0 ? 3 : y1 > y0 ? 2 : 0;
    // A trip that leaves a residential plot is a CITIZEN (others are freight). Tag its home so
    // the destination's wellbeing is deposited there.
    const home = residentialHome(map, p0);

    // MODE CHOICE: a citizen on a SHORT trip whose route doesn't need a FREEWAY walks the whole
    // way (a pedestrian routes it); longer trips, freeway trips, and all freight drive. (A
    // freeway is impassable on foot, so a cross-freeway trip must drive — otherwise its walker
    // would dead-end at the freeway edge and vanish.) As destinations come closer / streets
    // calm, more trips fall under WALK_RANGE → people shift out of cars.
    const usesFreeway = trip.path.some((t) => map.built[t]! === BuiltKind.RoadHighway);
    if (home >= 0 && trip.path.length <= WALK_RANGE && !usesFreeway) {
      if (state.peds.length >= PED_CAP) continue; // walkers are full this cadence
      const destPlot = zonedNeighbor(map, trip.path[trip.path.length - 1]!);
      if (destPlot >= 0) {
        const dpx = destPlot % map.width;
        const dpy = (destPlot - dpx) / map.width;
        state.peds.push({
          x: x0,
          y: y0,
          dir,
          tx: x0,
          ty: y0,
          walkTo: { x: dpx, y: dpy },
          phase: 'to-building',
          homeTile: home,
          building: { x: dpx, y: dpy },
        });
        continue; // walked — no car
      }
      // no destination plot to aim at → fall through and drive
    }

    if (moving >= CAR_CAP) continue;
    // Colour bound to the car: a spread hash of (origin, next) so neighbouring trips differ.
    // imul/xor are integer-exact (allowlist-safe); the renderer maps it mod its palette.
    const tint = (Math.imul(p0 ^ p1, 0x9e3779b1) >>> 0) % 0x10000;
    state.cars.push({
      x: x0,
      y: y0,
      dir,
      tx: x1,
      ty: y1,
      path: trip.path,
      leg: 2,
      tint,
      homeTile: home >= 0 ? home : undefined,
    });
    moving++;
  }
}

/** A trip-car's next-leg picker (the `pickNext` for advanceMover): head to the next tile
 *  on the committed path, advancing the leg cursor; -1 when the path is exhausted (the car
 *  has arrived → despawn). Path tiles are adjacent, so the heading is their delta. */
function pathStep(map: GameMap, car: Mover, x: number, y: number): number {
  const path = car.path!;
  const leg = car.leg!;
  if (leg >= path.length) return -1;
  const next = path[leg]!;
  const nx = next % map.width;
  const ny = (next - nx) / map.width;
  car.leg = leg + 1;
  if (nx > x) return 1;
  if (nx < x) return 3;
  if (ny > y) return 2;
  if (ny < y) return 0;
  return -1; // non-adjacent (shouldn't happen on a committed path) → despawn
}

function spawnPeds(state: AmbientState, map: GameMap, rng: Rng): void {
  for (let s = 0; s < SAMPLES_PER_SUBSTEP; s++) {
    if (state.peds.length >= PED_CAP) return;
    const { x, y } = sampleTile(map, rng);
    if (!isPedSubstrate(map, x, y)) continue;
    const dir = nextPedStep(map, x, y, -1, rng);
    if (dir < 0) continue;
    state.peds.push({ x, y, dir, tx: x + DIR_DX[dir]!, ty: y + DIR_DY[dir]! });
  }
}

/** Top the daily-itinerary population up from the residential census: pick a home (weighted by its
 *  citizen count, so denser buildings send out more people), stand a citizen just outside it, and
 *  send it off toward the first reachable stop of its round (work → shop → lifestyle). A citizen
 *  whose district has none of those stops makes no trip (dropped). Census citizens are PRIMARY —
 *  spawned before the ambient wanderers so they fill most of the ped pool. */
function spawnCitizens(state: AmbientState, map: GameMap, rng: Rng): void {
  const homes = state.households;
  if (!homes || homes.length === 0) return;
  let total = 0;
  for (const h of homes) total += h.count;
  if (total <= 0) return;
  for (let s = 0; s < CITIZEN_SPAWN_PER_SUBSTEP; s++) {
    if (state.peds.length >= CITIZEN_POP_TARGET) return;
    // Density-weighted pick: a home of count c is c× as likely to send someone out.
    let r = rng.nextInt(total);
    let home = homes[0]!;
    for (const cand of homes) {
      r -= cand.count;
      if (r < 0) {
        home = cand;
        break;
      }
    }
    // Stand the citizen on a walkable tile beside its home plot (the plot itself isn't walkable).
    let sx = -1;
    let sy = -1;
    for (let d = 0; d < 4; d++) {
      const nx = home.x + DIR_DX[d]!;
      const ny = home.y + DIR_DY[d]!;
      if (isWalkable(map, nx, ny)) {
        sx = nx;
        sy = ny;
        break;
      }
    }
    if (sx < 0) continue; // a hemmed-in home, nowhere to step out
    const ped: Ped = {
      x: sx,
      y: sy,
      dir: 0,
      tx: sx,
      ty: sy,
      homeTile: map.idx(home.x, home.y),
      itinerary: DAILY_ITINERARY,
      itinStep: -1, // advanceItinerary sets the first stop (step 0 = Work)
    };
    if (advanceItinerary(ped, map)) state.peds.push(ped); // dropped if the district has no stops
  }
}

/** The nearest lot stall free to park in: the closest lot whose centre is within PARK_RADIUS
 *  of the car, then its first stall not already taken by another parked car. Null if no lot
 *  is near or the nearest one is full (→ the caller falls back to a street curb). */
function findLotStall(
  state: AmbientState,
  c: Car,
): { lotIdx: number; stallIdx: number; x: number; y: number } | null {
  const lots = state.parkingLots;
  if (!lots || lots.length === 0) return null;
  let best = -1;
  let bestD = PARK_RADIUS * PARK_RADIUS;
  for (let i = 0; i < lots.length; i++) {
    const dx = lots[i]!.cx - c.x;
    const dy = lots[i]!.cy - c.y;
    const d = dx * dx + dy * dy;
    if (d <= bestD) {
      bestD = d;
      best = i;
    }
  }
  if (best < 0) return null;
  const lot = lots[best]!;
  const taken = new Set<number>(); // one pass over the cars, not a scan per stall
  for (const o of state.cars) if (o.parked && o.lotIdx === best) taken.add(o.stallIdx!);
  for (let s = 0; s < lot.stalls.length; s++) {
    if (!taken.has(s)) return { lotIdx: best, stallIdx: s, x: lot.stalls[s]!.x, y: lot.stalls[s]!.y };
  }
  return null; // nearest lot full
}

/** The nearest free curb (drivable tile NOT already holding a parked car) by ring search
 *  outward from (ax, ay), capped at CURB_RADIUS. Crowding (near curbs taken) pushes the
 *  result farther out, so the pedestrian walks farther. Returns tile coords, or null. */
function findCurbSpot(
  state: AmbientState,
  map: GameMap,
  ax: number,
  ay: number,
): { x: number; y: number } | null {
  const occupied = new Set<number>();
  for (const o of state.cars) if (o.parked) occupied.add(map.idx(Math.round(o.x), Math.round(o.y)));
  for (let r = 0; r <= CURB_RADIUS; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue; // ring at Chebyshev distance r
        const x = ax + dx;
        const y = ay + dy;
        if (!map.inBounds(x, y)) continue;
        const k = map.built[map.idx(x, y)]!;
        if (!carTraversable(k) || k === BuiltKind.RoadHighway) continue; // no parking on a freeway
        if (occupied.has(map.idx(x, y))) continue;
        return { x, y };
      }
    }
  }
  return null;
}

/** Park a trip-car that has reached the end of its path. It pulls into the nearest free lot
 *  stall, or — when none is free — to the nearest free street curb (so cars no longer vanish
 *  at their destination). Then it gets a bound pedestrian that walks to the building, dwells,
 *  and returns. Returns true if parked (always, unless truly nowhere to stop → despawn). */
function tryPark(state: AmbientState, c: Car, map: GameMap): boolean {
  const ax = Math.round(c.x);
  const ay = Math.round(c.y);
  const building = nearestDemandTile(map, ax, ay);
  const lot = findLotStall(state, c);
  if (lot) {
    c.lotIdx = lot.lotIdx;
    c.stallIdx = lot.stallIdx;
    c.x = lot.x - 0.5; // tile-corner; renderer draws the centre (+0.5) on the stall
    c.y = lot.y - 0.5;
  } else {
    const curb = findCurbSpot(state, map, ax, ay);
    if (!curb) return false; // nowhere at all (rare) → despawn
    c.lotIdx = undefined; // street-parked (drawn at the curb)
    c.stallIdx = undefined;
    c.x = curb.x;
    c.y = curb.y;
    // Record which side the kerb is on (first non-road neighbour) so the renderer draws the
    // car pulled over to it, not sitting on the lane centre of a 1-wide street.
    c.curbDir = undefined;
    for (let d = 0; d < 4; d++) {
      const nx = curb.x + DIR_DX[d]!;
      const ny = curb.y + DIR_DY[d]!;
      if (!map.inBounds(nx, ny) || !carTraversable(map.built[map.idx(nx, ny)]!)) {
        c.curbDir = d;
        break;
      }
    }
  }
  c.parked = true;
  c.path = undefined;
  c.leg = undefined;
  c.dwell = PARK_MAX_WAIT;
  c.id = state.nextCarId = (state.nextCarId ?? 0) + 1;
  if (building) {
    // The citizen reached its destination plot → carry that plot's wellbeing home now. The
    // bound ped below is the VISIBLE visit; the deposit is not gated on it spawning (the ped
    // cap must never silently starve the health signal).
    if (c.homeTile !== undefined) depositVisit(state, c.homeTile, building, map);
    spawnBoundPed(state, c, building);
  }
  return true;
}

/** Spawn the pedestrian bound to a just-parked car: it starts at the car and walks to the
 *  destination building (the car→building leg). It later returns to the SAME car (by id) and
 *  releases it. No building nearby ⇒ no ped (the car will leave on its safety timeout). */
function spawnBoundPed(state: AmbientState, c: Car, building: { x: number; y: number }): void {
  if (state.peds.length >= PED_CAP) return;
  // Start on the car's TILE (rounded): a lot-parked car sits at a fractional stall position,
  // but the Manhattan router walks integer tiles, so the ped steps off from the tile centre.
  const sx = Math.round(c.x);
  const sy = Math.round(c.y);
  state.peds.push({
    x: sx,
    y: sy,
    dir: 0,
    tx: sx,
    ty: sy,
    walkTo: { x: building.x, y: building.y },
    carId: c.id,
    phase: 'to-building',
    building: { x: building.x, y: building.y },
  });
}

/** Find a (parked) car by its id, so a returning pedestrian can rebind to it. */
function findCar(state: AmbientState, id: number): Car | undefined {
  return state.cars.find((c) => c.id === id);
}

/** The residential building tile 4-adjacent to a trip's origin road (its home), or -1 if the
 *  origin doesn't front a home — i.e. a non-residential (freight) trip. */
function residentialHome(map: GameMap, roadIdx: number): number {
  const x = roadIdx % map.width;
  const y = (roadIdx - x) / map.width;
  for (let d = 0; d < 4; d++) {
    const nx = x + DIR_DX[d]!;
    const ny = y + DIR_DY[d]!;
    if (!map.inBounds(nx, ny)) continue;
    const t = map.idx(nx, ny);
    if (zoneTypeOf(map.built[t]!) === ZoneType.Residential) return t;
  }
  return -1;
}

/** Any zoned (R/C/I/Civic) building tile 4-adjacent to a road — the destination PLOT a trip's
 *  end road fronts, or -1 if none. Used to aim a walking citizen at the plot it's visiting. */
function zonedNeighbor(map: GameMap, roadIdx: number): number {
  const x = roadIdx % map.width;
  const y = (roadIdx - x) / map.width;
  for (let d = 0; d < 4; d++) {
    const nx = x + DIR_DX[d]!;
    const ny = y + DIR_DY[d]!;
    if (!map.inBounds(nx, ny)) continue;
    const t = map.idx(nx, ny);
    if (zoneTypeOf(map.built[t]!) !== ZoneType.None) return t;
  }
  return -1;
}

/** Add `value` (signed) to a home building's health, clamped. */
function depositHealth(state: AmbientState, homeTile: number, value: number): void {
  if (value === 0) return;
  const cur = state.buildingHealth.get(homeTile) ?? 0;
  state.buildingHealth.set(homeTile, Math.max(-HEALTH_MAX, Math.min(HEALTH_MAX, cur + value)));
}

/** Deposit the wellbeing a citizen carries home from visiting `plot` into its home building's
 *  health, less any `penalty` (e.g. an unpleasant road walk). Called when a citizen completes
 *  its visit (a driver on park-arrival, a walker on getting home). */
function depositVisit(
  state: AmbientState,
  homeTile: number,
  plot: { x: number; y: number },
  map: GameMap,
  penalty = 0,
): void {
  depositHealth(state, homeTile, visitValue(map.built[map.idx(plot.x, plot.y)]!) - penalty);
}

/** A walk citizen whose trip can't complete (its destination is unreachable, OR the way home is
 *  blocked too) isn't annihilated in the field: the household persists, so the citizen RESPAWNS at
 *  home — snapped to a walkable spot beside its home plot, trip state cleared so it rejoins the
 *  neighbourhood — and the home takes the FAILED_TRIP_PENALTY for the wasted trip. A bound or
 *  homeless ped (no `homeTile`) has nowhere to respawn, so it despawns (its car releases on its own
 *  timeout). Returns true if it respawned (keep the sprite), false if it should despawn. */
function respawnAtHome(state: AmbientState, p: Ped, map: GameMap): boolean {
  if (p.homeTile === undefined) return false;
  depositHealth(state, p.homeTile, -FAILED_TRIP_PENALTY);
  const hx = p.homeTile % map.width;
  const hy = (p.homeTile - hx) / map.width;
  let sx = hx;
  let sy = hy;
  for (let d = 0; d < 4; d++) {
    const nx = hx + DIR_DX[d]!;
    const ny = hy + DIR_DY[d]!;
    if (isWalkable(map, nx, ny)) {
      sx = nx; // stand just outside the home plot (the plot tile itself isn't walkable)
      sy = ny;
      break;
    }
  }
  p.x = sx;
  p.y = sy;
  p.tx = sx;
  p.ty = sy;
  p.walkTo = undefined;
  p.phase = undefined;
  p.building = undefined;
  p.carId = undefined;
  p.fuel = undefined;
  p.recent = undefined;
  p.roadSteps = undefined;
  p.wornSteps = undefined;
  p.itinerary = undefined; // a lost citizen's round ends; it rejoins the neighbourhood at home
  p.itinStep = undefined;
  p.mode = undefined;
  return true;
}

function spawnFlocks(state: AmbientState, map: GameMap, rng: Rng): void {
  for (let s = 0; s < SAMPLES_PER_SUBSTEP; s++) {
    if (state.birds.length >= FLOCK_CAP) return;
    const { x, y } = sampleTile(map, rng);
    if (!birdSpawnAt(map, x, y)) continue;
    const size = FLOCK_MIN + rng.nextInt(FLOCK_MAX - FLOCK_MIN + 1);
    const birds: Bird[] = [];
    for (let i = 0; i < size; i++) {
      birds.push({
        x: x + (rng.next() - 0.5),
        y: y + (rng.next() - 0.5),
        vx: (rng.next() - 0.5) * BIRD_MAX_SPEED,
        vy: (rng.next() - 0.5) * BIRD_MAX_SPEED,
      });
    }
    state.birds.push({ birds });
  }
}

// --- The substep + the public stepper ------------------------------------

function substep(state: AmbientState, map: GameMap, rng: Rng): void {
  // 1. Despawn anything whose substrate vanished (read-only self-healing). Last-mile
  //    walkers (walkTo set) are exempt — they cross lots/roads off-grid and self-despawn
  //    on arrival, so the substrate test would wrongly kill them mid-walk.
  state.cars = state.cars.filter((c) => !carOffNetwork(map, c));
  state.peds = state.peds.filter((p) => p.walkTo !== undefined || !pedOffNetwork(map, p));
  for (const f of state.birds) {
    const t = flockTile(map, f);
    if (!birdSpawnAt(map, t.x, t.y)) f.birds.pop();
  }
  state.birds = state.birds.filter((f) => f.birds.length > 0);

  // 2. Spawn the daily-itinerary CITIZENS (the primary walkers — from the residential census),
  //    then top up with ambient wanderers and bird flocks. Cars are NOT spawned here — they are
  //    the sim's O-D trips, ingested via ingestTrips on the traffic cadence (cars=trips).
  //    Last-mile walkers spawn on a car PARKING (see tryPark → spawnParkPed), not here.
  spawnCitizens(state, map, rng);
  spawnPeds(state, map, rng);
  spawnFlocks(state, map, rng);

  // 3. Move the cars. A PARKED car waits for its pedestrian (its bound ped zeroes `dwell` on
  //    return; the countdown is just a safety release). A moving trip-car follows its path
  //    and, on arrival, PARKS (a lot stall, or a street curb if none) — it no longer vanishes
  //    at the destination. A path-less car (a test fixture) falls back to the grid wander.
  state.cars = state.cars.filter((c) => {
    if (c.parked) {
      c.dwell! -= 1;
      return c.dwell! > 0;
    }
    // A freeway moves traffic twice as fast as a surface street.
    const onFreeway = map.built[map.idx(Math.round(c.x), Math.round(c.y))] === BuiltKind.RoadHighway;
    const sp = onFreeway ? CAR_SPEED * 2 : CAR_SPEED;
    if (c.path !== undefined) {
      const alive = advanceMover(c, sp, map, (x, y) => pathStep(map, c, x, y));
      return alive ? true : tryPark(state, c, map);
    }
    return advanceMover(c, sp, map, (x, y, fromDir, recent) =>
      nextRoadStep(map, x, y, fromDir, rng, recent),
    );
  });

  // 3b. Move the pedestrians. A walk target (walkTo) is reached by a MANHATTAN walk — an
  //     axis-aligned, tile-by-tile route over walkable tiles (never diagonally, never through
  //     a plot). A BOUND ped (carId) runs its car→building→inside→car machine, releasing its
  //     car on return. Others wander on ped substrate.
  state.peds = state.peds.filter((p) => {
    if (p.phase === 'inside') {
      p.dwellInside! -= 1;
      if (p.dwellInside! > 0) return true;
      if (p.carId !== undefined) {
        const car = findCar(state, p.carId);
        if (!car) return false; // its car already left → the ped vanishes too
        p.phase = 'to-car';
        p.walkTo = { x: car.x, y: car.y };
      } else if (p.itinerary !== undefined && advanceItinerary(p, map)) {
        // A citizen on a daily round moved on to its next stop (work → shop → lifestyle).
      } else {
        // A single-stop walk citizen, or a round that's complete — head home. (Itinerary stops bank
        // their wellbeing on arrival, so the home leg of a round carries nothing extra.)
        const hx = p.homeTile! % map.width;
        const hy = (p.homeTile! - hx) / map.width;
        p.phase = 'to-home';
        p.walkTo = { x: hx, y: hy };
        if (p.itinerary !== undefined) {
          p.building = undefined;
          p.mode = chooseMode(map, Math.round(p.x), Math.round(p.y), hx, hy); // pick the trip home too
        }
      }
      p.tx = Math.round(p.x); // recommit the Manhattan route from here toward the destination
      p.ty = Math.round(p.y);
      p.recent = undefined;
      return true;
    }
    if (p.walkTo !== undefined) {
      const tgtx = Math.round(p.walkTo.x);
      const tgty = Math.round(p.walkTo.y);
      // FUEL: a persistent tank, spent per substep by the terrain underfoot (beaten paths cheap,
      //   lush ground dear) and refilled at plots. A citizen chasing an UNREACHABLE destination loops
      //   without closing the distance and burns out — catching limit cycles longer than `recent`.
      //   On burnout it turns back home on a limp-home reserve (losing some wellbeing); if it's
      //   ALREADY heading home (or has no home), it respawns at home / despawns.
      p.fuel ??= FUEL_TANK;
      p.fuel -= fuelBurn(map, state.wear, Math.round(p.x), Math.round(p.y));
      if (p.fuel <= 0) {
        if (p.carId === undefined && p.phase === 'to-building' && p.homeTile !== undefined) {
          const hx = p.homeTile % map.width;
          const hy = (p.homeTile - hx) / map.width;
          p.phase = 'to-home';
          p.walkTo = { x: hx, y: hy };
          p.building = undefined; // never visited the plot → carries no visit value, just the give-up cost
          p.tx = Math.round(p.x); // recommit the route home from here
          p.ty = Math.round(p.y);
          p.recent = undefined;
          p.fuel = FUEL_LIMP_HOME; // a reserve to drag itself home (not a full tank)
          p.mode = TravelMode.Walk; // exhausted → limp home on foot
          depositHealth(state, p.homeTile, -GIVE_UP_PENALTY);
          return true;
        }
        return respawnAtHome(state, p, map); // couldn't even get home → respawn there (or despawn if homeless)
      }
      // The travel MODE sets the route (which tiles, which it hugs) and the speed (fast on its
      // network — a tram on its line, a driver on roads — slower walking to/from a stop).
      const mode = p.mode ?? TravelMode.Walk;
      const hereKind = map.built[map.idx(Math.round(p.x), Math.round(p.y))]!;
      const speed = PED_SPEED * modeSpeedMult(mode, hereKind);
      const moving = advanceMover(p, speed, map, (x, y, _fromDir, recent) =>
        nextStepToward(map, x, y, tgtx, tgty, recent, state.wear, mode),
      );
      if (moving) return true; // still walking this leg
      // advanceMover stopped: arrived (within a tile of the target) or boxed in.
      const arrived = Math.abs(Math.round(p.x) - tgtx) + Math.abs(Math.round(p.y) - tgty) <= 1;
      if (!arrived) {
        // pathing went nowhere (e.g. boxed in, or dead-ended at a freeway) — the citizen gives up.
        // A homed citizen respawns at home (the household persists) and home loses wellbeing for the
        // lost trip; a bound/homeless ped despawns (a bound car releases on its safety timeout).
        return respawnAtHome(state, p, map);
      }
      if (p.phase === 'to-building') {
        p.phase = 'inside';
        p.dwellInside = INSIDE_DWELL_MIN + rng.nextInt(INSIDE_DWELL_SPAN);
        if (p.building) {
          const kind = map.built[map.idx(p.building.x, p.building.y)]!;
          // A successful visit refuels the citizen by the plot's status/use (a good plot restores more).
          p.fuel = Math.min(FUEL_TANK, (p.fuel ?? 0) + refuelFor(kind));
          // A citizen on a daily round BANKS each stop's wellbeing at home as it visits (less the
          // leg's walk tolls), so its home health tracks where its people actually go. A single-stop
          // walk citizen instead deposits once on getting home (below).
          if (p.itinerary !== undefined && p.homeTile !== undefined) {
            const penalty = Math.floor(
              (p.roadSteps ?? 0) * ROAD_WALK_PENALTY + (p.wornSteps ?? 0) * WORN_WALK_PENALTY,
            );
            depositVisit(state, p.homeTile, p.building, map, penalty);
          }
        }
        return true;
      }
      if (p.phase === 'to-car') {
        const car = findCar(state, p.carId!);
        if (car) car.dwell = 0; // got back in → release the car to leave (deposit was on arrival)
        return false;
      }
      if (p.phase === 'to-home') {
        // Walked home → deposit the visit's wellbeing, less the toll of any road-walking trudge
        // AND of trudging beaten/degraded desire paths (convenient underfoot, but bleak).
        if (p.homeTile !== undefined && p.building) {
          const penalty = Math.floor(
            (p.roadSteps ?? 0) * ROAD_WALK_PENALTY + (p.wornSteps ?? 0) * WORN_WALK_PENALTY,
          );
          depositVisit(state, p.homeTile, p.building, map, penalty);
        }
        return false;
      }
      return false; // unbound routed ped → despawn on arrival
    }
    return advanceMover(p, PED_SPEED, map, (x, y, fromDir) => nextPedStep(map, x, y, fromDir, rng));
  });
  for (const f of state.birds) advanceFlock(f);

  // 4. Building health eases toward neutral so it tracks RECENT citizen visits, not all-time.
  if (state.buildingHealth.size > 0) {
    for (const [k, v] of [...state.buildingHealth]) {
      const nv = v > 0 ? v - HEALTH_DECAY : v + HEALTH_DECAY;
      if (Math.abs(nv) < HEALTH_DECAY) state.buildingHealth.delete(k);
      else state.buildingHealth.set(k, nv);
    }
  }

  // 5. Desire-path WEAR: every pedestrian on a wild-green tile beats it down a little; unused
  //    wear regrows. Cars don't count (they ride pavement) — this is foot traffic forming paths.
  for (const p of state.peds) {
    const tx = Math.round(p.x);
    const ty = Math.round(p.y);
    if (isWearable(map, tx, ty)) {
      const i = map.idx(tx, ty);
      const w = (state.wear.get(i) ?? 0) + WEAR_RATE;
      const capped = w > WEAR_MAX ? WEAR_MAX : w;
      state.wear.set(i, capped);
      // A walking citizen crossing a heavily-worn (degraded, littered) path brings home less — the
      // beaten path is convenient but bleak.
      if (p.phase !== undefined && p.carId === undefined && capped >= WORN_DEGRADE_MIN) {
        p.wornSteps = (p.wornSteps ?? 0) + 1;
      }
    } else if (p.phase !== undefined && p.carId === undefined) {
      // A walking citizen trudging a road/stroad accrues the unpleasant-commute penalty.
      const k = map.built[map.idx(tx, ty)]!;
      if (k === BuiltKind.RoadStreet || k === BuiltKind.RoadAvenue) p.roadSteps = (p.roadSteps ?? 0) + 1;
    }
  }
  if (state.wear.size > 0) {
    for (const [k, v] of [...state.wear]) {
      const nv = v - WEAR_DECAY;
      if (nv <= 0) state.wear.delete(k);
      else state.wear.set(k, nv);
    }
  }

  // 6. Water runoff: on a slow cadence, each coastal water tile collects pollution from the
  //    ground around it and grows heavily polluted over time (impassable, so it never wears).
  state.waterTick += 1;
  if (state.waterTick % WATER_RUNOFF_CADENCE === 0) accumulateWaterRunoff(state, map);
}

/** One water-runoff pass: every water tile with ground neighbours collects their runoff
 *  (paved/built/worn ground sheds most), accumulating toward WATER_POLL_MAX. Open water with no
 *  ground neighbours stays clean. Whole-map scan — gated to WATER_RUNOFF_CADENCE by the caller. */
function accumulateWaterRunoff(state: AmbientState, map: GameMap): void {
  const W = map.width;
  const H = map.height;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = map.idx(x, y);
      if (map.water[i] === 0) continue; // only water collects runoff
      let runoff = 0;
      for (let d = 0; d < 4; d++) {
        const nx = x + DIR_DX[d]!;
        const ny = y + DIR_DY[d]!;
        if (!map.inBounds(nx, ny)) continue;
        const ni = map.idx(nx, ny);
        if (map.water[ni] !== 0) continue; // a water neighbour sheds nothing
        const k = map.built[ni]!;
        runoff += isRoadKind(k) || k === BuiltKind.ParkingLot || zoneTypeOf(k) !== ZoneType.None
          ? RUNOFF_URBAN
          : RUNOFF_WILD;
        if ((state.wear.get(ni) ?? 0) > 40) runoff += RUNOFF_WORN;
      }
      if (runoff === 0) continue;
      const next = (state.waterPollution.get(i) ?? 0) + runoff;
      state.waterPollution.set(i, next > WATER_POLL_MAX ? WATER_POLL_MAX : next);
    }
  }
}

/** Number of urban (road / parking / built) tiles in the 8-neighbourhood of (x, y). */
function urbanNeighbours(map: GameMap, x: number, y: number): number {
  let n = 0;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      const nx = x + dx;
      const ny = y + dy;
      if (!map.inBounds(nx, ny)) continue;
      const k = map.built[map.idx(nx, ny)]!;
      if (isRoadKind(k) || k === BuiltKind.ParkingLot || zoneTypeOf(k) !== ZoneType.None) n++;
    }
  }
  return n;
}

/** Seed the live blight a century of car-culture left BEFORE the player arrives, so the city
 *  starts degraded rather than pristine: empty urban ground is already trampled brown (wear,
 *  by how hemmed-in it is) and the shorelines are already polluted (runoff). Derived from the
 *  worldgen world; the live layers evolve from here as the player heals or neglects the city. */
export function seedBlight(state: AmbientState, map: GameMap): void {
  const PLOT_SEED_RADIUS = 5; // how far a home "feels" the plots around it
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      const k = map.built[map.idx(x, y)]!;
      // Trampled urban ground: hemmed-in empty land is already a beaten path.
      if (k === BuiltKind.None && map.water[map.idx(x, y)] === 0) {
        const urban = urbanNeighbours(map, x, y);
        if (urban >= 2) state.wear.set(map.idx(x, y), Math.min(WEAR_MAX, urban * 26));
        continue;
      }
      // Precomputed home wellbeing: a century in this environment, summed from the plots a
      // home's citizens would visit nearby (industry drags it down, commerce/civic/new-urbanist
      // lift it) — so homes START with a wellbeing reflecting where they sit, not zero.
      if (zoneTypeOf(k) === ZoneType.Residential) {
        let h = 0;
        for (let dy = -PLOT_SEED_RADIUS; dy <= PLOT_SEED_RADIUS; dy++) {
          for (let dx = -PLOT_SEED_RADIUS; dx <= PLOT_SEED_RADIUS; dx++) {
            const nx = x + dx;
            const ny = y + dy;
            if (!map.inBounds(nx, ny)) continue;
            h += visitValue(map.built[map.idx(nx, ny)]!);
          }
        }
        if (h !== 0) state.buildingHealth.set(map.idx(x, y), Math.max(-HEALTH_MAX, Math.min(HEALTH_MAX, h)));
      }
    }
  }
  // A century of runoff already in the water — saturate the urban shorelines.
  for (let n = 0; n < 60; n++) accumulateWaterRunoff(state, map);
}

/**
 * Advance the ambient state by `dtMs` of wall-clock time, in fixed 50ms substeps.
 * Clamps `dtMs` to AMBIENT_MAX_FRAME_MS first (so a pathological gap can never spin
 * more than AMBIENT_MAX_FRAME_MS/50 = 20 substeps and hang the frame). Writes ONLY
 * `state`; `map` is read-only.
 */
export function stepAmbient(state: AmbientState, map: GameMap, rng: Rng, dtMs: number): void {
  state.accMs += Math.min(dtMs, AMBIENT_MAX_FRAME_MS);
  while (state.accMs >= SUBSTEP_MS) {
    state.accMs -= SUBSTEP_MS;
    substep(state, map, rng);
  }
}
