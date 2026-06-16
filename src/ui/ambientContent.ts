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

/** Highest carWeightForRoad value (highway) — the rejection-sampling denominator. */
const CAR_MAX_WEIGHT = 3;

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

/** The full ambient sprite state — renderer-side only, never part of the world. */
export interface AmbientState {
  cars: Car[];
  peds: Ped[];
  birds: Flock[];
  /** Leftover sub-substep time carried between stepAmbient calls. */
  accMs: number;
}

export function createAmbientState(): AmbientState {
  return { cars: [], peds: [], birds: [], accMs: 0 };
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
 *  the U-turn `fromDir` unless it is the only option (dead-end). -1 if isolated. */
function pickStep(
  map: GameMap,
  x: number,
  y: number,
  fromDir: number,
  rng: Rng,
  passable: (nx: number, ny: number) => boolean,
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
  return options[rng.nextInt(options.length)]!;
}

/**
 * The car motion seam: from road tile (x, y), the chosen connected isRoadKind
 * neighbour direction (0..3), excluding the U-turn `fromDir` unless it is the only
 * connected road (dead-end). -1 if (x, y) has no road neighbour at all. Deterministic
 * given `rng`.
 */
export function nextRoadStep(map: GameMap, x: number, y: number, fromDir: number, rng: Rng): number {
  return pickStep(map, x, y, fromDir, rng, (nx, ny) => isCarRoad(map.built[map.idx(nx, ny)]!));
}

/** The pedestrian motion seam: the same junction rule over ped substrate. */
function nextPedStep(map: GameMap, x: number, y: number, fromDir: number, rng: Rng): number {
  return pickStep(map, x, y, fromDir, rng, (nx, ny) => isPedSubstrate(map, nx, ny));
}

// --- Despawn predicates --------------------------------------------------

/** A car is gone once the tile under it is no longer a road (e.g. converted). */
function carOffNetwork(map: GameMap, c: Car): boolean {
  const x = Math.round(c.x);
  const y = Math.round(c.y);
  if (!map.inBounds(x, y)) return true;
  return !isCarRoad(map.built[map.idx(x, y)]!);
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
 *  The map/rng are captured by `pickNext` (the per-kind junction seam). */
function advanceMover(
  m: Mover,
  speed: number,
  pickNext: (x: number, y: number, fromDir: number) => number,
): void {
  const dist = Math.abs(m.tx - m.x) + Math.abs(m.ty - m.y);
  if (dist <= speed) {
    // Arrive at the target tile centre and recommit to the next leg.
    m.x = m.tx;
    m.y = m.ty;
    const fromDir = opposite(m.dir);
    const nd = pickNext(m.tx, m.ty, fromDir);
    if (nd < 0) return; // isolated tile — stay put (despawn handles off-network)
    m.dir = nd;
    m.tx = m.x + DIR_DX[nd]!;
    m.ty = m.y + DIR_DY[nd]!;
  } else {
    m.x += DIR_DX[m.dir]! * speed;
    m.y += DIR_DY[m.dir]! * speed;
  }
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

function spawnCars(state: AmbientState, map: GameMap, rng: Rng): void {
  for (let s = 0; s < SAMPLES_PER_SUBSTEP; s++) {
    if (state.cars.length >= CAR_CAP) return;
    const { x, y } = sampleTile(map, rng);
    const weight = carWeightForRoad(map.built[map.idx(x, y)]!);
    if (weight === 0) continue;
    if (!rng.chance(weight / CAR_MAX_WEIGHT)) continue;
    const dir = nextRoadStep(map, x, y, -1, rng);
    if (dir < 0) continue; // isolated road tile — no leg to commit to
    state.cars.push({ x, y, dir, tx: x + DIR_DX[dir]!, ty: y + DIR_DY[dir]! });
  }
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
  // 1. Despawn anything whose substrate vanished (read-only self-healing).
  state.cars = state.cars.filter((c) => !carOffNetwork(map, c));
  state.peds = state.peds.filter((p) => !pedOffNetwork(map, p));
  for (const f of state.birds) {
    const t = flockTile(map, f);
    if (!birdSpawnAt(map, t.x, t.y)) f.birds.pop();
  }
  state.birds = state.birds.filter((f) => f.birds.length > 0);

  // 2. Spawn map-wide up to the global per-kind caps via rng rejection-sampling.
  spawnCars(state, map, rng);
  spawnPeds(state, map, rng);
  spawnFlocks(state, map, rng);

  // 3. Move. Cars/peds follow the grid; flocks flock.
  for (const c of state.cars) {
    advanceMover(c, CAR_SPEED, (x, y, fromDir) => nextRoadStep(map, x, y, fromDir, rng));
  }
  for (const p of state.peds) {
    advanceMover(p, PED_SPEED, (x, y, fromDir) => nextPedStep(map, x, y, fromDir, rng));
  }
  for (const f of state.birds) advanceFlock(f);
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
