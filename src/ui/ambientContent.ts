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
const HEALTH_DECAY = 0.1;

/** Transport-MODE threshold: a citizen trip whose committed path is at most this many tiles
 *  is walked (a pedestrian routes the whole way); longer trips drive. So as destinations come
 *  closer / streets calm, citizens shift out of cars — the heart of the congestion→bloom loop. */
const WALK_RANGE = 10;

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
}

export function createAmbientState(): AmbientState {
  return { cars: [], peds: [], birds: [], accMs: 0, buildingHealth: new Map() };
}

/** Publish the parking lots that store moving cars. The host (main.ts) computes these from
 *  the map's ParkingLot components (centre + stall grid) so parked cars land on the stalls. */
export function setParkingLots(state: AmbientState, lots: ReadonlyArray<ParkingLotInfo>): void {
  state.parkingLots = lots;
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

/** Advance one last-mile pedestrian straight toward its `walkTo` target by `speed`,
 *  off-grid (it may cross a lot or road). Returns false on arrival so the caller despawns
 *  it. Direction is normalized with sqrt (no trig — allowlist-safe); `dir` is set to the
 *  dominant cardinal so any heading-based draw stays sane. */
/** Ped-walkable: any in-bounds, non-water tile that is NOT an occupied R/C/I/Civic plot —
 *  i.e. roads, transit, PARKING, parks, rewilded greens, empty land all walk; only the actual
 *  building footprints block. Routed pedestrians step across these (around plots), so they no
 *  longer cut diagonally through buildings. */
function isWalkable(map: GameMap, x: number, y: number): boolean {
  if (!map.inBounds(x, y)) return false;
  if (map.water[map.idx(x, y)] !== 0) return false; // Water.None === 0
  return zoneTypeOf(map.built[map.idx(x, y)]!) === ZoneType.None;
}

/** A routed pedestrian's next grid step (a Manhattan walk): the walkable, non-recent
 *  4-neighbour that most reduces Manhattan distance to (tgtx, tgty). Returns -1 when within
 *  one tile of the target (arrived — peds stop at a building's door, not inside it) OR when
 *  boxed in. Axis-aligned → no diagonals; obeys isWalkable → never through a plot. */
function nextStepToward(
  map: GameMap,
  x: number,
  y: number,
  tgtx: number,
  tgty: number,
  recent?: readonly number[],
): number {
  if (Math.abs(x - tgtx) + Math.abs(y - tgty) <= 1) return -1; // at / adjacent to the target
  let best = -1;
  let bestScore = 1e9;
  for (let d = 0; d < 4; d++) {
    const nx = x + DIR_DX[d]!;
    const ny = y + DIR_DY[d]!;
    if (!isWalkable(map, nx, ny)) continue;
    if (recent && recent.includes(map.idx(nx, ny))) continue;
    const score = Math.abs(nx - tgtx) + Math.abs(ny - tgty);
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

    // MODE CHOICE: a citizen on a SHORT trip walks the whole way (a pedestrian routes it);
    // longer citizen trips and all freight drive. As destinations come closer / streets calm,
    // more trips fall under WALK_RANGE → people shift out of cars.
    if (home >= 0 && trip.path.length <= WALK_RANGE) {
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
        if (!carTraversable(map.built[map.idx(x, y)]!)) continue;
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

/** Deposit the wellbeing a citizen carries home from visiting `plot` into its home building's
 *  health (clamped). Called when a bound pedestrian returns to its car — the visit is done. */
function depositVisit(state: AmbientState, homeTile: number, plot: { x: number; y: number }, map: GameMap): void {
  const v = visitValue(map.built[map.idx(plot.x, plot.y)]!);
  if (v === 0) return;
  const cur = state.buildingHealth.get(homeTile) ?? 0;
  const next = Math.max(-HEALTH_MAX, Math.min(HEALTH_MAX, cur + v));
  state.buildingHealth.set(homeTile, next);
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

  // 2. Spawn peds/flocks map-wide up to the caps. Cars are NOT spawned here — they are
  //    the sim's O-D trips, ingested via ingestTrips on the traffic cadence (cars=trips).
  //    Last-mile walkers spawn on a car PARKING (see tryPark → spawnParkPed), not here.
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
    if (c.path !== undefined) {
      const alive = advanceMover(c, CAR_SPEED, map, (x, y) => pathStep(map, c, x, y));
      return alive ? true : tryPark(state, c, map);
    }
    return advanceMover(c, CAR_SPEED, map, (x, y, fromDir, recent) =>
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
      } else {
        // A WALK citizen heads back to its own home, carrying the visit's wellbeing.
        const hx = p.homeTile! % map.width;
        const hy = (p.homeTile! - hx) / map.width;
        p.phase = 'to-home';
        p.walkTo = { x: hx, y: hy };
      }
      p.tx = Math.round(p.x); // recommit the Manhattan route from here toward the destination
      p.ty = Math.round(p.y);
      p.recent = undefined;
      return true;
    }
    if (p.walkTo !== undefined) {
      const tgtx = Math.round(p.walkTo.x);
      const tgty = Math.round(p.walkTo.y);
      const moving = advanceMover(p, PED_SPEED, map, (x, y, _fromDir, recent) =>
        nextStepToward(map, x, y, tgtx, tgty, recent),
      );
      if (moving) return true; // still walking this leg
      // advanceMover stopped: arrived (within a tile of the target) or boxed in.
      const arrived = Math.abs(Math.round(p.x) - tgtx) + Math.abs(Math.round(p.y) - tgty) <= 1;
      if (!arrived) return false; // stuck → despawn (a bound car releases on its safety timeout)
      if (p.phase === 'to-building') {
        p.phase = 'inside';
        p.dwellInside = INSIDE_DWELL_MIN + rng.nextInt(INSIDE_DWELL_SPAN);
        return true;
      }
      if (p.phase === 'to-car') {
        const car = findCar(state, p.carId!);
        if (car) car.dwell = 0; // got back in → release the car to leave (deposit was on arrival)
        return false;
      }
      if (p.phase === 'to-home') {
        // Walked home → deposit the visit's wellbeing at this building (the citizen carried it).
        if (p.homeTile !== undefined && p.building) depositVisit(state, p.homeTile, p.building, map);
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
