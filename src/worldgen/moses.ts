// Worldgen stage 2: the Moses Century.
//
// One stage, five era sub-steps, that grows a coherent city on the terrain and
// then wrecks it — founding & streetcar town, motor age, highways & urban
// renewal, suburban flight, disinvestment — emitting a chronicle into the world
// log and leaving the decayed, disinvested start state the player must repair.
// (This stage IS the oppressive-planning history; "blight" appears critically in
// its harm report — see worldgen/report.ts — while the neutral condition is "decay".)
// Era functions are exported
// individually with a uniform signature so tests can run prefixes of history
// and measure between eras (yield point 4). All share a MosesState threaded by
// the stage and a MosesParams of design budgets/thresholds.
//
// Determinism rules (architecture guard): no DOM, no transcendental Math, seeded
// rng only, rational falloffs (no exp/pow/log). Every built/parcel write goes
// through the engine placement/demolition single-writers.

import { Water, type GameMap } from '../engine/map';
import {
  BuiltKind,
  isRoadKind,
  isPowerPlant,
  canPlaceParcel,
  placeParcel,
  placeTransport,
  demolishParcel,
  demolishTransportAt,
  type ParcelStore,
} from '../engine/fabric';
import type { Rng } from '../engine/rng';
import { distanceField, boxDensity, landRun, type Axis } from './fields';
import { gradeRedline } from './redline';
import type { WorldgenStage, WorldState } from './pipeline';

// --- Parameters ----------------------------------------------------------

export interface MosesParams {
  // Site selection
  siteStride: number; // sample every Nth tile (row-major)
  siteMargin: number; // keep candidate sites this far from the map edge
  flatRadius: number; // half-size of the flatness window (4 => 9x9)
  waterFrontageRadius: number; // a downtown likes water within this many tiles
  siteTopK: number; // rng jitter among the top-K scored candidates
  // Founding grid
  foundingGridSpan: number; // total arterial length budget (centred on the site)
  foundingBlocks: number; // parallel streets each side of each arterial
  blockSpacing: number; // tiles between parallel streets
  // Streetcar rail (radial extensions only)
  railLines: number; // how many radial lines to lay
  railExtension: number; // max tiles per line beyond the grid
  railMinLength: number; // a direction needs this much land beyond the grid to count
  // Era 1 fabric
  era1Parcels: number; // total parcels to place (clipped by space)
  era1Commercial: number; // commercial strips near the crossroads
  commercialRadius: number; // "near the crossroads" = within this Manhattan radius
  coreRadius: number; // downtown core radius (Manhattan), used by later eras
  // Era 2 motor age
  era2GrowthRings: number; // extra grid rings beyond the founding blocks
  era2Industry: number; // industrial parcels on rail/water frontage
  industryFrontage: number; // an industrial footprint must be within this of rail/water
  era2Parking: number; // parking lots near the crossroads
  era2ParkingFields: number; // full 2x2-lot parking fields laid in the open fringe
  era2Parcels: number; // extra houses/strips filling new frontage
  // Era 3 highways & urban renewal
  era3DensityRadius: number; // boxDensity radius for corridor scoring
  era3GradeWeight: number; // how strongly corridor scoring prefers redlined fabric
  era3Power: number; // legacy coal/gas plants sited on surviving redlined frontage
  era3MinDemolish: number; // a corridor must cut through at least this many parcels
  corridorTopK: number; // rng jitter among the top-K scored corridors
  era3Projects: number; // tower-in-the-park Projects placed along the corridor
  // Era 4 suburban flight
  suburbRadius: number; // road-network distance beyond which sprawl begins
  era4Spurs: number; // street spurs grown into open land
  era4SpurMin: number; // min spur length
  era4SpurMax: number; // max spur length
  era4Houses: number; // suburban houses on far frontage
  era4Offices: number; // downtown offices near the crossroads
  era4DeclineRadius: number; // inner-city residential decline radius (the ring beyond downtown)
  era4DeclineMin: number; // min condition lost by a declining inner-city parcel
  era4DeclineMax: number; // max condition lost by a declining inner-city parcel
  // Era 5 disinvestment
  maxDecay: number; // condition lost by a fully redlined parcel (grade 255)
  decayK: number; // legacy: highway-distance falloff k (decay now follows the grade)
  decayNoise: number; // extra random condition loss (0..decayNoise)
  abandonThreshold: number; // a parcel below this after decay is abandoned
  craterChance: number; // fraction of abandoned parcels that become parking craters
  // Satellites — exurbs/suburbs: small outlying core grids, freeway-linked to the main city
  satelliteCount: number; // how many satellite settlements to attempt
  satelliteSpan: number; // each satellite's arterial span (smaller than the founding grid)
  satelliteBlocks: number; // parallel streets each side of each satellite arterial
  satelliteParcels: number; // houses (a few strips) filling each satellite's frontage
  satelliteMinCoreDist: number; // a satellite must be at least this far (Manhattan) from the main core
  satelliteSpacing: number; // satellites must be at least this far from each other
}

export const DEFAULT_MOSES_PARAMS: MosesParams = {
  siteStride: 4,
  siteMargin: 12,
  flatRadius: 4,
  waterFrontageRadius: 3,
  siteTopK: 4,
  // Founding grid + site selection LEFT AT ORIGINAL: foundingGridSpan/Blocks drive the site score
  // (landBox + rail-room at radius half), so changing them moves the site to where the grid clips and
  // shrinks era1. The city is enlarged by the GROWTH eras (era2 rings + era4 spurs) + parcel budgets,
  // which expand outward from a stable founding without disturbing site selection.
  foundingGridSpan: 24,
  foundingBlocks: 3,
  blockSpacing: 4,
  railLines: 2,
  railExtension: 10,
  railMinLength: 6,
  era1Parcels: 80,
  era1Commercial: 6,
  commercialRadius: 6,
  coreRadius: 8,
  era2GrowthRings: 6,
  era2Industry: 8,
  industryFrontage: 2,
  era2Parking: 3,
  era2ParkingFields: 3,
  era2Parcels: 4000, // FILL-ALL: exceed the grown grid's frontage so every ring block fills, not half
  //                    (fillFrontage walks tiles row-major + stops at the budget, so a budget below
  //                    the frontage always leaves the BOTTOM rows empty — pack the whole grid instead)
  era3DensityRadius: 3,
  era3GradeWeight: 8,
  era3Power: 4,
  era3MinDemolish: 5,
  corridorTopK: 3,
  era3Projects: 5,
  suburbRadius: 20,
  era4Spurs: 24,
  era4SpurMin: 4,
  era4SpurMax: 16,
  era4Houses: 140,
  era4Offices: 5,
  era4DeclineRadius: 24,
  era4DeclineMin: 20,
  era4DeclineMax: 60,
  maxDecay: 340,
  decayK: 0.15,
  decayNoise: 20,
  abandonThreshold: 40,
  craterChance: 0.5,
  satelliteCount: 4,
  satelliteSpan: 16,
  satelliteBlocks: 2,
  satelliteParcels: 600, // FILL-ALL: pack the whole exurb grid (else its lower half stays empty too)
  satelliteMinCoreDist: 34,
  satelliteSpacing: 22,
};

// --- Shared state --------------------------------------------------------

export interface MosesState {
  founded: boolean;
  siteX: number;
  siteY: number; // founding crossroads
  arterialRow: number;
  arterialCol: number;
  gridX0: number;
  gridY0: number;
  gridX1: number;
  gridY1: number; // grid bounding box (extent of era-1 road tiles)
  railPeak: number; // era-1 rail tile count (for the era-3 chronicle)
  preEra5Alive: number; // set by era 5 before abandonment
  satellites: Array<{ x: number; y: number }>; // founded exurb/suburb crossroads (eraSatellites)
}

/** A fresh MosesState: not yet founded, all fields zeroed. */
export function createMosesState(): MosesState {
  return {
    founded: false,
    siteX: 0,
    siteY: 0,
    arterialRow: 0,
    arterialCol: 0,
    gridX0: 0,
    gridY0: 0,
    gridX1: 0,
    gridY1: 0,
    railPeak: 0,
    preEra5Alive: 0,
    satellites: [],
  };
}

// --- Geometry helpers ----------------------------------------------------

const isLandTile = (map: GameMap, i: number): boolean => map.water[i] === Water.None;

/**
 * Count of contiguous land tiles starting one step in direction (dx, dy) from
 * (sx, sy), up to `max`. The start tile (sx, sy) itself is not counted — this
 * measures land *beyond* a point (e.g. land beyond a grid edge for rail).
 */
function landReach(map: GameMap, sx: number, sy: number, dx: number, dy: number, max: number): number {
  let c = 0;
  let x = sx + dx;
  let y = sy + dy;
  while (c < max && map.inBounds(x, y) && map.water[map.idx(x, y)] === Water.None) {
    c++;
    x += dx;
    y += dy;
  }
  return c;
}

interface BBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Place a transport tile, growing the bbox to include it on success. */
function roadAt(map: GameMap, x: number, y: number, kind: number, bbox: BBox): boolean {
  if (!placeTransport(map, x, y, kind)) return false;
  if (x < bbox.x0) bbox.x0 = x;
  if (x > bbox.x1) bbox.x1 = x;
  if (y < bbox.y0) bbox.y0 = y;
  if (y > bbox.y1) bbox.y1 = y;
  return true;
}

/**
 * Grow a line of `kind` from (cx, cy) outward in direction (dx, dy), one step at
 * a time, stopping at the first tile that cannot take transport (water / edge /
 * building). Returns how many tiles were laid (the arm's reach). The origin
 * (cx, cy) is assumed already laid by the caller.
 */
function growArm(
  map: GameMap,
  cx: number,
  cy: number,
  dx: number,
  dy: number,
  span: number,
  kind: number,
  bbox: BBox,
): number {
  let laid = 0;
  for (let s = 1; s <= span; s++) {
    if (!roadAt(map, cx + dx * s, cy + dy * s, kind, bbox)) break;
    laid = s;
  }
  return laid;
}

/**
 * Try to place a w×h parcel immediately adjacent to road tile (rx, ry) — one of
 * the N/S/W/E lanes, in that fixed order — so the placed parcel is guaranteed
 * 4-adjacent to the road. Draws density (1..2) and condition (200..255) only on
 * a successful placement. Returns the parcel index, or -1 if no lane fits.
 */
/** Attribute generator (density + condition) for a placed parcel. */
type AttrGen = (rng: Rng) => { density: number; condition: number };
/** Healthy new construction: low density, pristine-ish condition. */
const HEALTHY_ATTRS: AttrGen = (rng) => ({ density: 1 + rng.nextInt(2), condition: 200 + rng.nextInt(56) });
/** Urban-renewal projects: built dense and cheap (condition 140..180). */
const PROJECT_ATTRS: AttrGen = (rng) => ({ density: 3 + rng.nextInt(2), condition: 140 + rng.nextInt(41) });
// Legacy power plants: density 1 (plants are not density-scaled), still-running
// but aging condition. Two-nextInt draw shape matches HEALTHY_ATTRS.
const PLANT_ATTRS: AttrGen = (rng) => ({ density: 1, condition: 170 + rng.nextInt(50) });
/**
 * Dense near-core construction (Apartments): density 2..3, pristine-ish condition.
 * Same TWO-nextInt draw shape as HEALTHY_ATTRS, so swapping it in inside
 * fillFrontage leaves the 'fill' rng stream structure (and determinism) unchanged.
 */
const DENSE_ATTRS: AttrGen = (rng) => ({ density: 2 + rng.nextInt(2), condition: 200 + rng.nextInt(56) });

function placeAdjacent(
  map: GameMap,
  store: ParcelStore,
  rx: number,
  ry: number,
  w: number,
  h: number,
  kind: BuiltKind,
  rng: Rng,
  accept?: (ax: number, ay: number) => boolean,
  attrs: AttrGen = HEALTHY_ATTRS,
): number {
  const anchors: ReadonlyArray<readonly [number, number]> = [
    [rx, ry - h], // N: parcel's south edge abuts the road
    [rx, ry + 1], // S
    [rx - w, ry], // W
    [rx + 1, ry], // E
  ];
  for (const [ax, ay] of anchors) {
    if (!canPlaceParcel(map, ax, ay, w, h)) continue;
    if (accept && !accept(ax, ay)) continue;
    const { density, condition } = attrs(rng);
    return placeParcel(map, store, { x: ax, y: ay, width: w, height: h, kind, density, condition });
  }
  return -1;
}

/**
 * Pack frontage on ALL FOUR lanes of every road tile (not first-fit), walking the
 * caller-supplied deterministic order (e.g. byCore), placing pickKind(roadIndex)
 * parcels until `budget` is reached. Each parcel is 1×1 (or 2×1 for a
 * CommercialStrip), placed only where the lane is free (canPlaceParcel) and via
 * placeParcel — so every placed parcel is road-adjacent BY CONSTRUCTION and the
 * store/tile agreement (checkParcelAgreement) is preserved. Apartments draw the
 * dense attr gen; other kinds the healthy one — same two-nextInt draw shape, so the
 * rng stream is kind-independent. Returns the number of parcels placed.
 */
function fillFrontage(
  map: GameMap,
  parcels: ParcelStore,
  roadTiles: number[],
  rng: Rng,
  budget: number,
  pickKind: (roadIndex: number) => BuiltKind,
): number {
  let placed = 0;
  for (const i of roadTiles) {
    if (placed >= budget) break;
    const rx = i % map.width;
    const ry = (i - rx) / map.width;
    const kind = pickKind(i);
    const w = kind === BuiltKind.CommercialStrip ? 2 : 1;
    const h = 1;
    const attrs: AttrGen = kind === BuiltKind.Apartments ? DENSE_ATTRS : HEALTHY_ATTRS;
    const anchors: ReadonlyArray<readonly [number, number]> = [
      [rx, ry - h], // N: parcel's south edge abuts the road
      [rx, ry + 1], // S
      [rx - w, ry], // W
      [rx + 1, ry], // E
    ];
    for (const [ax, ay] of anchors) {
      if (placed >= budget) break;
      if (!canPlaceParcel(map, ax, ay, w, h)) continue;
      const { density, condition } = attrs(rng);
      if (placeParcel(map, parcels, { x: ax, y: ay, width: w, height: h, kind, density, condition }) !== -1) {
        placed++;
      }
    }
  }
  return placed;
}

/**
 * A core-weighted kind chooser for {@link fillFrontage}: dense Apartments (plus an
 * every-5th CommercialStrip) within commercialRadius, Apartments within coreRadius,
 * else HouseSingle. Closes over a deterministic commercial cadence counter and
 * consumes NO rng — pure kind selection from the road tile's core distance.
 */
function coreWeightedPickKind(
  map: GameMap,
  siteX: number,
  siteY: number,
  p: MosesParams,
): (roadIndex: number) => BuiltKind {
  let commercialSeen = 0;
  return (i: number): BuiltKind => {
    const x = i % map.width;
    const y = (i - x) / map.width;
    const coreDist = Math.abs(x - siteX) + Math.abs(y - siteY);
    if (coreDist <= p.commercialRadius) {
      return commercialSeen++ % 5 === 4 ? BuiltKind.CommercialStrip : BuiltKind.Apartments;
    }
    if (coreDist <= p.coreRadius) return BuiltKind.Apartments;
    return BuiltKind.HouseSingle;
  };
}

/**
 * Widen an upgraded arterial into a 2-row avenue: lay RoadAvenue along the line one
 * tile parallel (index+1) to the arterial, over the run [lo, hi], demolishing any
 * parcel in the way first. Each parallel tile is 4-adjacent to the (gap-free) avenue
 * spine, so the road network stays a single component. Deterministic geometry — no
 * rng. Returns the number of avenue tiles placed (folded into the era-2 chronicle).
 */
function widenAvenue(
  map: GameMap,
  parcels: ParcelStore,
  axis: Axis,
  index: number,
  lo: number,
  hi: number,
): number {
  const parallel = index + 1;
  let placed = 0;
  for (let s = lo; s <= hi; s++) {
    const x = axis === 'row' ? s : parallel;
    const y = axis === 'row' ? parallel : s;
    if (!map.inBounds(x, y)) continue;
    const pid = map.parcel[map.idx(x, y)]!;
    if (pid !== 0) demolishParcel(map, parcels, pid - 1);
    if (placeTransport(map, x, y, BuiltKind.RoadAvenue)) placed++;
  }
  return placed;
}

/**
 * Lay a `cols`×`rows` grid of 2×2 ParkingLot parcels (a 2·cols × 2·rows rectangle
 * anchored at (ax, ay)). ALL-OR-NOTHING: returns 0 (placing NOTHING) unless the
 * ENTIRE rectangle is free first — so any field that lands is one full contiguous
 * mass (no partial field, hence no flaky sub-target component). Draws one rng value
 * (condition) per lot ONLY on success. Returns the number of ParkingLot parcels
 * placed (cols·rows on success, 0 on failure — a field is N parcels, not 1).
 */
export function placeParkingField(
  map: GameMap,
  parcels: ParcelStore,
  rng: Rng,
  ax: number,
  ay: number,
  cols: number,
  rows: number,
): number {
  for (let cy = 0; cy < rows; cy++) {
    for (let cx = 0; cx < cols; cx++) {
      if (!canPlaceParcel(map, ax + cx * 2, ay + cy * 2, 2, 2)) return 0;
    }
  }
  let placed = 0;
  for (let cy = 0; cy < rows; cy++) {
    for (let cx = 0; cx < cols; cx++) {
      const condition = 60 + rng.nextInt(60); // vacant-lot grade, 60..119
      if (
        placeParcel(map, parcels, {
          x: ax + cx * 2,
          y: ay + cy * 2,
          width: 2,
          height: 2,
          kind: BuiltKind.ParkingLot,
          density: 1,
          condition,
        }) !== -1
      ) {
        placed++;
      }
    }
  }
  return placed;
}

/**
 * Autopromote accumulated concrete: a 2×2 block of RoadStreet becomes a ParkingLot
 * parcel. Only DENSE packing forms a 2×2 of street (a 1-wide grid never does), so this
 * targets the over-paved blobs — a century of paving and demolished lots settling into
 * the parking lots cars cut through (Maddy vision). Greedy, row-major, non-overlapping
 * (a promoted tile is no longer street), deterministic in `rng`. Streets carry no
 * parcel, so clearing `built` then `placeParcel` keeps `checkParcelAgreement` clean;
 * street and parking are both paved (ecology footprint unchanged) and parking is a
 * road CONNECTOR (cars cut through), so converting a through-block never severs the
 * drivable network. Returns the number of 2×2 lots promoted.
 */
export function promoteDenseStreets(map: GameMap, parcels: ParcelStore, rng: Rng): number {
  const isStreet = (x: number, y: number): boolean =>
    map.inBounds(x, y) && map.built[map.idx(x, y)] === BuiltKind.RoadStreet;
  let promoted = 0;
  for (let y = 0; y + 1 < map.height; y++) {
    for (let x = 0; x + 1 < map.width; x++) {
      if (!isStreet(x, y) || !isStreet(x + 1, y) || !isStreet(x, y + 1) || !isStreet(x + 1, y + 1)) continue;
      // Clear the four street tiles (roads carry no parcel) and stamp a 2×2 ParkingLot.
      for (let dy = 0; dy < 2; dy++) {
        for (let dx = 0; dx < 2; dx++) map.built[map.idx(x + dx, y + dy)] = 0;
      }
      const condition = 60 + rng.nextInt(60); // vacant-lot grade, matching era-2 fields
      if (
        placeParcel(map, parcels, {
          x,
          y,
          width: 2,
          height: 2,
          kind: BuiltKind.ParkingLot,
          density: 1,
          condition,
        }) !== -1
      ) {
        promoted++;
      }
    }
  }
  return promoted;
}

/** Seeded in-place Fisher-Yates shuffle. Grid fabric is filled in RANDOM order, not row-major, so a
 *  fill that doesn't reach every lane (a budget, lane conflicts, or later decline) leaves vacancy
 *  SCATTERED organically across the blocks instead of a clean empty band along one edge. */
function shuffleInPlace<T>(arr: T[], rng: Rng): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = rng.nextInt(i + 1);
    const t = arr[i]!;
    arr[i] = arr[j]!;
    arr[j] = t;
  }
}

/** Minimum value of `field` over a w×h footprint anchored at (ax, ay). */
function footprintMin(map: GameMap, field: Int32Array, ax: number, ay: number, w: number, h: number): number {
  let lo = Infinity;
  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) {
      const v = field[map.idx(ax + dx, ay + dy)]!;
      if (v >= 0 && v < lo) lo = v;
    }
  }
  return lo;
}

/** Collect the road tiles inside [x0,x1]×[y0,y1], row-major. */
function collectRoadTiles(map: GameMap, x0: number, y0: number, x1: number, y1: number): number[] {
  const out: number[] = [];
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const i = map.idx(x, y);
      if (isRoadKind(map.built[i]!)) out.push(i);
    }
  }
  return out;
}

// --- Era 1: founding & streetcar town ------------------------------------

interface SiteScore {
  i: number;
  x: number;
  y: number;
  score: number;
}

/**
 * Score every candidate anchor (every siteStride-th land tile, kept clear of the
 * edge) and return them sorted best-first. Score is lexicographic via disjoint
 * magnitude bands: rail-extension directions (most important — the streetcar
 * lines need land beyond the grid), then land in the grid window (a clean,
 * non-clipped grid), then flatness, then water frontage.
 */
function scoreSites(map: GameMap, p: MosesParams): SiteScore[] {
  const { width, height, elevation } = map;
  const half = p.foundingGridSpan >> 1;
  const waterDist = distanceField(map, (i) => map.water[i] !== Water.None);
  const landBox = boxDensity(map, (i) => isLandTile(map, i), half);

  const out: SiteScore[] = [];
  for (let y = p.siteMargin; y < height - p.siteMargin; y += p.siteStride) {
    for (let x = p.siteMargin; x < width - p.siteMargin; x += p.siteStride) {
      const i = map.idx(x, y);
      if (!isLandTile(map, i)) continue;

      // Flatness: elevation range over the flat window, as a descending bonus.
      let emin = Infinity;
      let emax = -Infinity;
      for (let dy = -p.flatRadius; dy <= p.flatRadius; dy++) {
        for (let dx = -p.flatRadius; dx <= p.flatRadius; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (!map.inBounds(nx, ny)) continue;
          const e = elevation[map.idx(nx, ny)]!;
          if (e < emin) emin = e;
          if (e > emax) emax = e;
        }
      }
      const flatBonus = 1000 - Math.floor((emax - emin) * 1000); // higher = flatter

      // Rail-extension room beyond the grid edges, in the four arterial directions.
      const er = landReach(map, x + half, y, 1, 0, p.railExtension);
      const wr = landReach(map, x - half, y, -1, 0, p.railExtension);
      const nr = landReach(map, x, y - half, 0, -1, p.railExtension);
      const sr = landReach(map, x, y + half, 0, 1, p.railExtension);
      const m = p.railMinLength;
      const dirsGood = (er >= m ? 1 : 0) + (wr >= m ? 1 : 0) + (nr >= m ? 1 : 0) + (sr >= m ? 1 : 0);

      const wd = waterDist[i]!;
      const waterBonus = wd >= 1 && wd <= p.waterFrontageRadius ? (p.waterFrontageRadius - wd + 1) * 8 : 0;

      const score = dirsGood * 1e12 + landBox[i]! * 1e6 + flatBonus * 1e2 + waterBonus;
      out.push({ i, x, y, score });
    }
  }
  out.sort((a, b) => b.score - a.score || a.i - b.i);
  return out;
}

/**
 * Era 1 — founding & streetcar town. Picks a flat, rail-extendable, water-near
 * site; lays a rectilinear street grid (two arterials + parallel streets, grown
 * from the crossroads and clipped at water so the network stays one component);
 * lays streetcar rail as radial extensions beyond the grid (in-grid track ran in
 * the street and is implicit — yield point 1); then grows the early fabric. On
 * an all-water map it logs "no viable site" and leaves state.founded false.
 */
export function era1Founding(world: WorldState, rng: Rng, p: MosesParams, state: MosesState): void {
  const { map, parcels } = world;

  const sites = scoreSites(map, p);
  if (sites.length === 0) {
    world.log.push('era1: no viable site');
    return;
  }
  const top = sites.slice(0, Math.min(p.siteTopK, sites.length));
  const chosen = top[rng.fork('site').nextInt(top.length)]!;
  const siteX = chosen.x;
  const siteY = chosen.y;

  state.founded = true;
  state.siteX = siteX;
  state.siteY = siteY;
  state.arterialRow = siteY;
  state.arterialCol = siteX;
  world.log.push(`era1: founded at (${siteX}, ${siteY})`);

  // Grid: two arterials grown from the crossroads, then parallel streets every
  // blockSpacing tiles up to foundingBlocks each side (clipped to the arterial
  // reach so they never overshoot the grid).
  const half = p.foundingGridSpan >> 1;
  const bbox: BBox = { x0: siteX, y0: siteY, x1: siteX, y1: siteY };
  roadAt(map, siteX, siteY, BuiltKind.RoadStreet, bbox);
  const eRow = growArm(map, siteX, siteY, 1, 0, half, BuiltKind.RoadStreet, bbox);
  const wRow = growArm(map, siteX, siteY, -1, 0, half, BuiltKind.RoadStreet, bbox);
  const sCol = growArm(map, siteX, siteY, 0, 1, half, BuiltKind.RoadStreet, bbox);
  const nCol = growArm(map, siteX, siteY, 0, -1, half, BuiltKind.RoadStreet, bbox);

  for (let k = 1; k <= p.foundingBlocks; k++) {
    const off = k * p.blockSpacing;
    if (off <= nCol) {
      roadAt(map, siteX, siteY - off, BuiltKind.RoadStreet, bbox);
      growArm(map, siteX, siteY - off, 1, 0, eRow, BuiltKind.RoadStreet, bbox);
      growArm(map, siteX, siteY - off, -1, 0, wRow, BuiltKind.RoadStreet, bbox);
    }
    if (off <= sCol) {
      roadAt(map, siteX, siteY + off, BuiltKind.RoadStreet, bbox);
      growArm(map, siteX, siteY + off, 1, 0, eRow, BuiltKind.RoadStreet, bbox);
      growArm(map, siteX, siteY + off, -1, 0, wRow, BuiltKind.RoadStreet, bbox);
    }
    if (off <= eRow) {
      roadAt(map, siteX + off, siteY, BuiltKind.RoadStreet, bbox);
      growArm(map, siteX + off, siteY, 0, 1, sCol, BuiltKind.RoadStreet, bbox);
      growArm(map, siteX + off, siteY, 0, -1, nCol, BuiltKind.RoadStreet, bbox);
    }
    if (off <= wRow) {
      roadAt(map, siteX - off, siteY, BuiltKind.RoadStreet, bbox);
      growArm(map, siteX - off, siteY, 0, 1, sCol, BuiltKind.RoadStreet, bbox);
      growArm(map, siteX - off, siteY, 0, -1, nCol, BuiltKind.RoadStreet, bbox);
    }
  }

  state.gridX0 = bbox.x0;
  state.gridY0 = bbox.y0;
  state.gridX1 = bbox.x1;
  state.gridY1 = bbox.y1;

  // Streetcar rail: lay the two (railLines) directions with the most land beyond
  // the grid edge, each starting one tile past an arterial end. No rail inside
  // the grid (in-grid track ran in the street — chronicled, not tiled).
  const railCands = [
    { sx: bbox.x1, sy: siteY, dx: 1, dy: 0 },
    { sx: bbox.x0, sy: siteY, dx: -1, dy: 0 },
    { sx: siteX, sy: bbox.y0, dx: 0, dy: -1 },
    { sx: siteX, sy: bbox.y1, dx: 0, dy: 1 },
  ].map((c) => ({ ...c, reach: landReach(map, c.sx, c.sy, c.dx, c.dy, p.railExtension) }));
  railCands.sort((a, b) => b.reach - a.reach);

  let railTiles = 0;
  let railLines = 0;
  for (let n = 0; n < p.railLines && n < railCands.length; n++) {
    const c = railCands[n]!;
    if (c.reach < 1) continue;
    let laid = 0;
    for (let s = 1; s <= c.reach; s++) {
      if (!placeTransport(map, c.sx + c.dx * s, c.sy + c.dy * s, BuiltKind.Rail)) break;
      laid++;
    }
    if (laid > 0) railLines++;
    railTiles += laid;
  }
  state.railPeak = railTiles;
  world.log.push(`era1: streetcar — ${railLines} lines, ${railTiles} rail tiles`);

  // Fabric: civic core, commercial near the crossroads, housing filling the
  // remaining frontage. Walk grid road tiles; place into adjacent lanes.
  const fabRng = rng.fork('fabric');
  const roadTiles = collectRoadTiles(map, bbox.x0, bbox.y0, bbox.x1, bbox.y1);
  const manhattanToCore = (i: number): number => {
    const x = i % map.width;
    const y = (i - x) / map.width;
    return Math.abs(x - siteX) + Math.abs(y - siteY);
  };
  const byCore = [...roadTiles].sort((a, b) => manhattanToCore(a) - manhattanToCore(b) || a - b);

  let placed = 0;

  // One civic megablock at the core.
  for (const i of byCore) {
    const x = i % map.width;
    const y = (i - x) / map.width;
    if (placeAdjacent(map, parcels, x, y, 3, 3, BuiltKind.Civic, fabRng) !== -1) {
      placed++;
      break;
    }
  }

  // Commercial strips near the crossroads.
  let commercial = 0;
  for (const i of byCore) {
    if (commercial >= p.era1Commercial || placed >= p.era1Parcels) break;
    if (manhattanToCore(i) > p.commercialRadius) continue;
    const x = i % map.width;
    const y = (i - x) / map.width;
    if (placeAdjacent(map, parcels, x, y, 2, 1, BuiltKind.CommercialStrip, fabRng) !== -1) {
      commercial++;
      placed++;
    }
  }

  // Housing & near-core density fill the remaining frontage on ALL lanes, core
  // first: dense Apartments (with the occasional CommercialStrip) toward the
  // crossroads, single houses farther out. Core-weighting steers the later era-5
  // abandonment numerator into the band era 3 carves the highway through.
  placed += fillFrontage(
    map,
    parcels,
    byCore,
    rng.fork('fill'),
    p.era1Parcels - placed,
    coreWeightedPickKind(map, siteX, siteY, p),
  );

  world.log.push(`era1: fabric — ${placed} parcels (${commercial} commercial)`);
}

// --- Era 2: motor age ----------------------------------------------------

/** Upgrade an arterial line (street→avenue) along its existing road tiles only. */
function upgradeArterialRow(map: GameMap, y: number, x0: number, x1: number): number {
  let n = 0;
  for (let x = x0; x <= x1; x++) {
    const i = map.idx(x, y);
    if (isRoadKind(map.built[i]!) && placeTransport(map, x, y, BuiltKind.RoadAvenue)) n++;
  }
  return n;
}
function upgradeArterialCol(map: GameMap, x: number, y0: number, y1: number): number {
  let n = 0;
  for (let y = y0; y <= y1; y++) {
    const i = map.idx(x, y);
    if (isRoadKind(map.built[i]!) && placeTransport(map, x, y, BuiltKind.RoadAvenue)) n++;
  }
  return n;
}

/**
 * Era 2 — motor age. Upgrades the two founding arterials to avenues, extends the
 * grid outward by era2GrowthRings (clipped to land, blocked by the streetcar
 * rail so the avenues grow in the non-rail directions), then adds the car-era
 * fabric: rail/water-frontage industry beyond the core, parking lots near the
 * crossroads, and more housing on the new frontage. No-ops if never founded.
 */
export function era2MotorAge(world: WorldState, rng: Rng, p: MosesParams, state: MosesState): void {
  if (!state.founded) return;
  const { map, parcels } = world;
  const { siteX, siteY, arterialRow, arterialCol } = state;
  const fabRng = rng.fork('fabric');

  const bbox: BBox = { x0: state.gridX0, y0: state.gridY0, x1: state.gridX1, y1: state.gridY1 };
  // The era-1 grid extent (captured before the extension grows the bbox). Era 2's
  // infill targets the NEW extension ONLY (tiles outside this box), so it never
  // re-plugs the era-1 core where the era-4 downtown offices need 2x2 room.
  const e1x0 = state.gridX0;
  const e1y0 = state.gridY0;
  const e1x1 = state.gridX1;
  const e1y1 = state.gridY1;

  // 1. Arterial upgrade: street -> avenue along the existing arterials, then widen
  //    each into a 2-row avenue (parallel row/col). The widening counts fold into
  //    the chronicle `avenues` tally so it reports the upgrade PLUS the widening.
  let avenues = upgradeArterialRow(map, arterialRow, state.gridX0, state.gridX1);
  avenues += upgradeArterialCol(map, arterialCol, state.gridY0, state.gridY1);
  avenues += widenAvenue(map, parcels, 'row', arterialRow, state.gridX0, state.gridX1);
  avenues += widenAvenue(map, parcels, 'col', arterialCol, state.gridY0, state.gridY1);

  // 2. Grid extension: extend the arterials (as avenue), then add parallel
  //    streets within the extended spans. Avenues stop at rail/water.
  const ext = p.era2GrowthRings * p.blockSpacing;
  growArm(map, state.gridX1, arterialRow, 1, 0, ext, BuiltKind.RoadAvenue, bbox);
  growArm(map, state.gridX0, arterialRow, -1, 0, ext, BuiltKind.RoadAvenue, bbox);
  growArm(map, arterialCol, state.gridY1, 0, 1, ext, BuiltKind.RoadAvenue, bbox);
  growArm(map, arterialCol, state.gridY0, 0, -1, ext, BuiltKind.RoadAvenue, bbox);
  const X0 = bbox.x0;
  const X1 = bbox.x1;
  const Y0 = bbox.y0;
  const Y1 = bbox.y1;
  for (let k = 1; k <= p.era2GrowthRings; k++) {
    const off = (p.foundingBlocks + k) * p.blockSpacing;
    const rs = arterialRow + off;
    const rn = arterialRow - off;
    const ce = arterialCol + off;
    const cw = arterialCol - off;
    if (rs <= Y1) {
      roadAt(map, arterialCol, rs, BuiltKind.RoadStreet, bbox);
      growArm(map, arterialCol, rs, 1, 0, X1 - arterialCol, BuiltKind.RoadStreet, bbox);
      growArm(map, arterialCol, rs, -1, 0, arterialCol - X0, BuiltKind.RoadStreet, bbox);
    }
    if (rn >= Y0) {
      roadAt(map, arterialCol, rn, BuiltKind.RoadStreet, bbox);
      growArm(map, arterialCol, rn, 1, 0, X1 - arterialCol, BuiltKind.RoadStreet, bbox);
      growArm(map, arterialCol, rn, -1, 0, arterialCol - X0, BuiltKind.RoadStreet, bbox);
    }
    if (ce <= X1) {
      roadAt(map, ce, arterialRow, BuiltKind.RoadStreet, bbox);
      growArm(map, ce, arterialRow, 0, 1, Y1 - arterialRow, BuiltKind.RoadStreet, bbox);
      growArm(map, ce, arterialRow, 0, -1, arterialRow - Y0, BuiltKind.RoadStreet, bbox);
    }
    if (cw >= X0) {
      roadAt(map, cw, arterialRow, BuiltKind.RoadStreet, bbox);
      growArm(map, cw, arterialRow, 0, 1, Y1 - arterialRow, BuiltKind.RoadStreet, bbox);
      growArm(map, cw, arterialRow, 0, -1, arterialRow - Y0, BuiltKind.RoadStreet, bbox);
    }
  }
  state.gridX0 = bbox.x0;
  state.gridY0 = bbox.y0;
  state.gridX1 = bbox.x1;
  state.gridY1 = bbox.y1;

  // Fabric over the (now larger) grid.
  const roadTiles = collectRoadTiles(map, bbox.x0, bbox.y0, bbox.x1, bbox.y1);
  const toCore = (i: number): number => {
    const x = i % map.width;
    const y = (i - x) / map.width;
    return Math.abs(x - siteX) + Math.abs(y - siteY);
  };

  // 3. Industry on rail/water frontage beyond the core. Sorted by GRADE first
  //    (discrimination-first: industry concentrates in the most redlined districts)
  //    then nearest rail/water, so it still clusters on the freight/water spine —
  //    the accept filter below keeps every parcel on real rail/water frontage.
  const railWaterDist = distanceField(map, (i) => map.built[i] === BuiltKind.Rail || map.water[i] !== Water.None);
  const indCands = roadTiles
    .filter((i) => toCore(i) > p.coreRadius)
    .sort((a, b) => map.redline[b]! - map.redline[a]! || railWaterDist[a]! - railWaterDist[b]! || a - b);
  let industry = 0;
  for (const i of indCands) {
    if (industry >= p.era2Industry) break;
    const x = i % map.width;
    const y = (i - x) / map.width;
    const accept = (ax: number, ay: number): boolean =>
      footprintMin(map, railWaterDist, ax, ay, 3, 3) <= p.industryFrontage;
    if (placeAdjacent(map, parcels, x, y, 3, 3, BuiltKind.Industrial, fabRng, accept) !== -1) industry++;
  }

  // 4. Parking near the crossroads.
  const byCore = [...roadTiles].sort((a, b) => toCore(a) - toCore(b) || a - b);
  let parking = 0;
  for (const i of byCore) {
    if (parking >= p.era2Parking) break;
    if (toCore(i) > p.commercialRadius) continue;
    const x = i % map.width;
    const y = (i - x) / map.width;
    if (placeAdjacent(map, parcels, x, y, 2, 2, BuiltKind.ParkingLot, fabRng) !== -1) parking++;
  }

  // 5. Dense infill on ALL lanes of the NEW extension frontage. Era 2 is the
  //    OUTWARD motor-age fill: it packs the rings the extension just added (tiles
  //    outside the era-1 grid box) and deliberately leaves the era-1 core untouched,
  //    so the era-4 downtown offices still find 2x2 room there after the era-3 carve.
  const extensionFrontage = byCore.filter((i) => {
    const x = i % map.width;
    const y = (i - x) / map.width;
    return x < e1x0 || x > e1x1 || y < e1y0 || y > e1y1;
  });
  shuffleInPlace(extensionFrontage, rng.fork('order')); // random fill order — vacancy scatters, not banded
  const filled = fillFrontage(
    map,
    parcels,
    extensionFrontage,
    rng.fork('fill'),
    p.era2Parcels,
    coreWeightedPickKind(map, siteX, siteY, p),
  );

  // 6. Parking FIELDS in the open fringe. The dense grid has no free 4x4 interior
  //    (blockSpacing 4 → 3x3 interiors, mostly filled), so scan open land past the
  //    grid's half-span, nearest-fringe first (deterministic), and lay full
  //    all-or-nothing fields there — up to era2ParkingFields.
  const parkRng = rng.fork('parkfield');
  const gridHalf = Math.max(
    state.gridX1 - siteX,
    siteX - state.gridX0,
    state.gridY1 - siteY,
    siteY - state.gridY0,
  );
  const fringe: number[] = [];
  for (let i = 0; i < map.built.length; i++) {
    if (map.built[i] !== 0 || map.parcel[i] !== 0) continue;
    const x = i % map.width;
    const y = (i - x) / map.width;
    if (Math.abs(x - siteX) + Math.abs(y - siteY) <= gridHalf) continue;
    fringe.push(i);
  }
  fringe.sort((a, b) => toCore(a) - toCore(b) || a - b);
  let fields = 0;
  let fieldLots = 0;
  for (const i of fringe) {
    if (fields >= p.era2ParkingFields) break;
    const x = i % map.width;
    const y = (i - x) / map.width;
    const n = placeParkingField(map, parcels, parkRng, x, y, 2, 2);
    if (n > 0) {
      fields++;
      fieldLots += n;
    }
  }

  world.log.push(
    `era2: motor age — ${avenues} avenue tiles, ${industry} industry, ${parking} parking, ` +
      `${fields} fields (${fieldLots} lots), ${filled} infill`,
  );
}

// --- Era 3: urban renewal & highways (the Moses signature) ---------------

interface Corridor {
  axis: Axis;
  index: number; // the fixed row (axis 'row') or column (axis 'col')
  lo: number; // land-run start along the axis
  hi: number; // land-run end along the axis
  sum: number; // boxDensity sum over the bbox-intersected run (corridor score)
  gradeMean: number; // mean redline grade over the bbox-intersected run (0..255)
  parcels: number; // distinct parcels whose footprint touches the line
}

/** (x, y) of position `s` along corridor `c`'s line. */
function corridorTile(c: Corridor, s: number): [number, number] {
  return c.axis === 'row' ? [s, c.index] : [c.index, s];
}

/** Distinct parcel ids touching corridor `c`'s line over its full run. */
function corridorParcels(map: GameMap, c: Corridor): number {
  const seen = new Set<number>();
  for (let s = c.lo; s <= c.hi; s++) {
    const [x, y] = corridorTile(c, s);
    const pid = map.parcel[map.idx(x, y)]!;
    if (pid !== 0) seen.add(pid);
  }
  return seen.size;
}

/**
 * Carve corridor `c` as a 3-ROW highway: demolish every parcel and rip any rail
 * across the center spine PLUS the two parallel rows (index ± 1, perpendicular to
 * the axis), then lay RoadHighway across all three (merging over street/avenue).
 * The parallel tiles are 4-adjacent to the gap-free spine, so the band is one
 * connected highway mass. Returns [parcels demolished, rail tiles removed], summed
 * over ALL THREE rows — the chronicle/balance equation depends on the TOTAL.
 * demolishParcel clears a whole footprint and tombstones once, so a parcel spanning
 * rows is demolished (and counted) exactly once.
 */
function carveCorridor(map: GameMap, store: ParcelStore, c: Corridor): [number, number] {
  let demolished = 0;
  let rail = 0;
  const offsets = [0, -1, 1]; // center spine, then the two parallel rows
  const tileOf = (s: number, off: number): [number, number] =>
    c.axis === 'row' ? [s, c.index + off] : [c.index + off, s];
  // Demolish all three rows first, then lay continuous highway across them.
  for (const off of offsets) {
    for (let s = c.lo; s <= c.hi; s++) {
      const [x, y] = tileOf(s, off);
      if (!map.inBounds(x, y)) continue;
      const i = map.idx(x, y);
      const pid = map.parcel[i]!;
      if (pid !== 0 && demolishParcel(map, store, pid - 1)) demolished++;
      if (map.built[i] === BuiltKind.Rail && demolishTransportAt(map, x, y)) rail++;
    }
  }
  for (const off of offsets) {
    for (let s = c.lo; s <= c.hi; s++) {
      const [x, y] = tileOf(s, off);
      if (!map.inBounds(x, y)) continue;
      placeTransport(map, x, y, BuiltKind.RoadHighway);
    }
  }
  return [demolished, rail];
}

/**
 * Era 3 — urban renewal & highways. Scores every row/column corridor by the
 * boxDensity of alive parcels along its run, restricted to corridors that
 * actually cut through >= era3MinDemolish parcels (urban renewal demolishes
 * fabric — a corridor running along an empty edge is not a candidate). Carves
 * the best (rng among the top-K), optionally a perpendicular second corridor
 * (iff its density-sum >= 50% of the first), rips out ALL remaining rail (the
 * streetcar massacre), then drops tower-in-the-park Projects and a civic
 * megablock along the corridor. No-ops if never founded or if the city is empty.
 */
export function era3Highways(world: WorldState, rng: Rng, p: MosesParams, state: MosesState): void {
  if (!state.founded) return;
  const { map, parcels } = world;

  // Alive-parcel bounding box.
  let pbx0 = map.width;
  let pby0 = map.height;
  let pbx1 = -1;
  let pby1 = -1;
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      if (map.parcel[map.idx(x, y)] !== 0) {
        if (x < pbx0) pbx0 = x;
        if (x > pbx1) pbx1 = x;
        if (y < pby0) pby0 = y;
        if (y > pby1) pby1 = y;
      }
    }
  }
  if (pbx1 < 0) {
    // No fabric to renew; still rip out the streetcar.
    const removed = demolishAllRail(map);
    world.log.push(`era3: rails removed ${removed} (peak ${state.railPeak})`);
    return;
  }

  const density = boxDensity(map, (i) => map.parcel[i] !== 0, p.era3DensityRadius);

  const cands: Corridor[] = [];
  for (let y = pby0; y <= pby1; y++) {
    const [lo, hi] = landRun(map, 'row', y);
    if (lo < 0) continue;
    const ix0 = Math.max(lo, pbx0);
    const ix1 = Math.min(hi, pbx1);
    if (ix0 > ix1) continue;
    let sum = 0;
    let gradeSum = 0;
    for (let x = ix0; x <= ix1; x++) {
      sum += density[map.idx(x, y)]!;
      gradeSum += map.redline[map.idx(x, y)]!;
    }
    const gradeMean = gradeSum / (ix1 - ix0 + 1);
    const c: Corridor = { axis: 'row', index: y, lo, hi, sum, gradeMean, parcels: 0 };
    c.parcels = corridorParcels(map, c);
    cands.push(c);
  }
  for (let x = pbx0; x <= pbx1; x++) {
    const [lo, hi] = landRun(map, 'col', x);
    if (lo < 0) continue;
    const iy0 = Math.max(lo, pby0);
    const iy1 = Math.min(hi, pby1);
    if (iy0 > iy1) continue;
    let sum = 0;
    let gradeSum = 0;
    for (let y = iy0; y <= iy1; y++) {
      sum += density[map.idx(x, y)]!;
      gradeSum += map.redline[map.idx(x, y)]!;
    }
    const gradeMean = gradeSum / (iy1 - iy0 + 1);
    const c: Corridor = { axis: 'col', index: x, lo, hi, sum, gradeMean, parcels: 0 };
    c.parcels = corridorParcels(map, c);
    cands.push(c);
  }

  // Only corridors that cut through real fabric; ranked by a GRADE-weighted density
  // score (the Moses signature, named): a corridor through redlined fabric outscores
  // an equally dense one through greenlined fabric, so the expressway is routed
  // THROUGH the redlined districts. Density stays a multiplicative factor, so a
  // sparse corridor never wins on grade alone.
  const score = (c: Corridor): number => c.sum * (255 + p.era3GradeWeight * c.gradeMean);
  const viable = cands.filter((c) => c.parcels >= p.era3MinDemolish);
  const ranked = (viable.length > 0 ? viable : cands).sort(
    (a, b) => score(b) - score(a) || (a.axis === b.axis ? a.index - b.index : a.axis === 'row' ? -1 : 1),
  );
  const top = ranked.slice(0, Math.min(p.corridorTopK, ranked.length));
  const first = top[rng.fork('corridor').nextInt(top.length)]!;

  let demolished = 0;
  let railRemoved = 0;
  const [d1, r1] = carveCorridor(map, parcels, first);
  demolished += d1;
  railRemoved += r1;
  world.log.push(
    `era3: highway ${first.axis} ${first.index} from ${first.lo} to ${first.hi}`,
  );

  // Second perpendicular corridor iff its density-sum >= 50% of the first's.
  const perpAxis: Axis = first.axis === 'row' ? 'col' : 'row';
  const bestPerp = ranked.filter((c) => c.axis === perpAxis)[0];
  if (bestPerp && bestPerp.sum * 2 >= first.sum) {
    const [d2, r2] = carveCorridor(map, parcels, bestPerp);
    demolished += d2;
    railRemoved += r2;
    world.log.push(`era3: highway ${bestPerp.axis} ${bestPerp.index} from ${bestPerp.lo} to ${bestPerp.hi}`);
  }

  // The streetcar massacre: rip out all remaining rail.
  railRemoved += demolishAllRail(map);
  world.log.push(`era3: rails removed ${railRemoved} (peak ${state.railPeak})`);

  // Projects (towers-in-the-park) and a civic megablock along the corridor.
  const fabRng = rng.fork('fabric');
  const highwayTiles: number[] = [];
  for (let i = 0; i < map.built.length; i++) if (map.built[i] === BuiltKind.RoadHighway) highwayTiles.push(i);
  const toCore = (i: number): number => {
    const x = i % map.width;
    const y = (i - x) / map.width;
    return Math.abs(x - state.siteX) + Math.abs(y - state.siteY);
  };
  const byCore = [...highwayTiles].sort((a, b) => toCore(a) - toCore(b) || a - b);

  let projects = 0;
  for (const i of byCore) {
    if (projects >= p.era3Projects) break;
    const x = i % map.width;
    const y = (i - x) / map.width;
    if (placeAdjacent(map, parcels, x, y, 3, 3, BuiltKind.Projects, fabRng, undefined, PROJECT_ATTRS) !== -1) {
      projects++;
    }
  }

  let civic = 0;
  for (const i of byCore) {
    const x = i % map.width;
    const y = (i - x) / map.width;
    if (placeAdjacent(map, parcels, x, y, 3, 3, BuiltKind.Civic, fabRng) !== -1) {
      civic++;
      break;
    }
  }

  // Legacy dirty power, SITED BY GRADE on the SURVIVING redlined frontage (after
  // the highway carve, so the expressway never plows the plants away — both are
  // drawn to the same redlined ground). Coal/gas drop on the most redlined road
  // frontage so those districts host the smog; they seed the starting grid — PART
  // of the city, not all — so the rest stays dark until the player builds clean
  // power. The plants ARE "redlining" made physical; the neutral live state is decay.
  const powerRng = rng.fork('power');
  const roadTiles: number[] = [];
  for (let i = 0; i < map.built.length; i++) {
    if (isRoadKind(map.built[i]!) && toCore(i) > p.coreRadius) roadTiles.push(i);
  }
  roadTiles.sort((a, b) => map.redline[b]! - map.redline[a]! || a - b);
  let power = 0;
  for (const i of roadTiles) {
    if (power >= p.era3Power) break;
    const x = i % map.width;
    const y = (i - x) / map.width;
    const kind = power % 2 === 0 ? BuiltKind.CoalPlant : BuiltKind.GasPlant;
    if (placeAdjacent(map, parcels, x, y, 3, 3, kind, powerRng, undefined, PLANT_ATTRS) !== -1) power++;
  }

  world.log.push(
    `era3: urban renewal — ${demolished} parcels demolished, ${projects} projects, ${civic} civic, ${power} power`,
  );
}

/** Demolish every Rail tile; returns how many were removed. */
function demolishAllRail(map: GameMap): number {
  let n = 0;
  for (let i = 0; i < map.built.length; i++) {
    if (map.built[i] === BuiltKind.Rail) {
      const x = i % map.width;
      const y = (i - x) / map.width;
      if (demolishTransportAt(map, x, y)) n++;
    }
  }
  return n;
}

// --- Era 4: suburban flight ----------------------------------------------

/** Residential building kinds (the ones that decline as the core empties). */
const RESIDENTIAL = new Set<number>([BuiltKind.HouseSingle, BuiltKind.Apartments, BuiltKind.Projects]);

/** Index of the nearest road tile to (cx, cy), or -1 if the map has no roads. */
function nearestRoadIndex(map: GameMap, cx: number, cy: number): number {
  const maxR = map.width + map.height;
  for (let r = 0; r <= maxR; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const x = cx + dx;
        const y = cy + dy;
        if (!map.inBounds(x, y)) continue;
        if (isRoadKind(map.built[map.idx(x, y)]!)) return map.idx(x, y);
      }
    }
  }
  return -1;
}

/**
 * Era 4 — suburban flight. Using road-network distance from the crossroads
 * (BFS through road tiles only — yield point 2), grows street spurs *away from
 * the highways* into open land beyond suburbRadius, then fills suburban houses
 * on far-road frontage farthest-from-highway first (so the suburbs spread off
 * the expressway, not along it — which is also what gives era 5 a far cohort to
 * contrast against the disinvested core). Every placed house is road-adjacent and
 * beyond suburbRadius in road-network distance. Adds downtown offices near the
 * crossroads and declines inner-city residential condition. No-ops if never
 * founded.
 */
export function era4Suburbs(world: WorldState, rng: Rng, p: MosesParams, state: MosesState): void {
  if (!state.founded) return;
  const { map, parcels } = world;
  const { siteX, siteY } = state;

  const src = nearestRoadIndex(map, siteX, siteY);
  if (src < 0) return;
  const isRoad = (i: number): boolean => isRoadKind(map.built[i]!);
  const highwayDist = distanceField(map, (i) => map.built[i] === BuiltKind.RoadHighway);

  // 1. Spurs: from far-network road tiles, grow a straight street in the
  //    cardinal direction that heads *away from the nearest highway* into open
  //    land. Grow from the farthest-from-highway bases first so the suburbs
  //    reach deep into the open quadrants.
  const net0 = distanceField(map, (i) => i === src, isRoad);
  const spurRng = rng.fork('spurs');
  const dirs: ReadonlyArray<readonly [number, number]> = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ];
  interface SpurBase {
    x: number;
    y: number;
    dx: number;
    dy: number;
    hd: number;
  }
  const bases: SpurBase[] = [];
  for (let i = 0; i < map.built.length; i++) {
    if (!isRoad(i) || net0[i]! <= p.suburbRadius) continue;
    const x = i % map.width;
    const y = (i - x) / map.width;
    let best: readonly [number, number] | null = null;
    let bestHd = highwayDist[i]!;
    for (const [dx, dy] of dirs) {
      const nx = x + dx;
      const ny = y + dy;
      if (!map.inBounds(nx, ny)) continue;
      const ni = map.idx(nx, ny);
      if (map.built[ni] !== 0 || map.water[ni] !== Water.None) continue; // open land only
      if (highwayDist[ni]! > bestHd) {
        bestHd = highwayDist[ni]!;
        best = [dx, dy];
      }
    }
    if (best) bases.push({ x, y, dx: best[0], dy: best[1], hd: highwayDist[i]! });
  }
  bases.sort((a, b) => b.hd - a.hd || a.y * map.width + a.x - (b.y * map.width + b.x));
  let spurs = 0;
  for (const b of bases) {
    if (spurs >= p.era4Spurs) break;
    const len = p.era4SpurMin + spurRng.nextInt(p.era4SpurMax - p.era4SpurMin + 1);
    let grew = 0;
    for (let s = 1; s <= len; s++) {
      if (!placeTransport(map, b.x + b.dx * s, b.y + b.dy * s, BuiltKind.RoadStreet)) break;
      grew++;
    }
    if (grew > 0) spurs++;
  }

  // 2a. Offices near the crossroads (downtown intensifies as homes leave).
  const buildRng = rng.fork('build');
  const toCore = (i: number): number => {
    const x = i % map.width;
    const y = (i - x) / map.width;
    return Math.abs(x - siteX) + Math.abs(y - siteY);
  };
  const allRoads = collectRoadTiles(map, 0, 0, map.width - 1, map.height - 1);
  const byCore = [...allRoads].sort((a, b) => toCore(a) - toCore(b) || a - b);
  // Downtown offices sit within coreRadius+2 of the crossroads. The denser fabric +
  // the 3-row highway carve leave almost no 2x2 room inside coreRadius itself, so
  // consider road tiles out to coreRadius+2 and pin the office ANCHOR within that
  // same radius (the `nearCore` accept) — the room just outside the carved core,
  // exactly the band the test counts as "near the center".
  const officeReach = p.coreRadius + 2;
  const nearCore = (ax: number, ay: number): boolean =>
    Math.abs(ax - siteX) + Math.abs(ay - siteY) <= officeReach;
  let offices = 0;
  for (const i of byCore) {
    if (offices >= p.era4Offices) break;
    if (toCore(i) > officeReach) continue;
    const x = i % map.width;
    const y = (i - x) / map.width;
    if (placeAdjacent(map, parcels, x, y, 2, 2, BuiltKind.Offices, buildRng, nearCore) !== -1) offices++;
  }

  // 2b. Sprawl: houses (and the occasional strip) on far-network frontage,
  //     farthest-from-highway first. net1 includes the new spurs; the accept
  //     predicate guarantees each placed house is beyond suburbRadius.
  const net1 = distanceField(map, (i) => i === src, isRoad);
  const far = collectRoadTiles(map, 0, 0, map.width - 1, map.height - 1)
    .filter((i) => net1[i]! > p.suburbRadius)
    .sort((a, b) => highwayDist[b]! - highwayDist[a]! || a - b);
  let houses = 0;
  for (const i of far) {
    if (houses >= p.era4Houses) break;
    const x = i % map.width;
    const y = (i - x) / map.width;
    const beyond = (ax: number, ay: number): boolean => net1[map.idx(ax, ay)]! > p.suburbRadius;
    const kind = houses % 6 === 5 ? BuiltKind.CommercialStrip : BuiltKind.HouseSingle;
    const w = kind === BuiltKind.CommercialStrip ? 2 : 1;
    if (placeAdjacent(map, parcels, x, y, w, 1, kind, buildRng, beyond) !== -1) houses++;
  }

  // 3. Early decline: inner-city residential parcels (the ring beyond the
  //    commercial downtown) lose condition as the middle class leaves
  //    (deterministic order via aliveIndices).
  const declineRng = rng.fork('decline');
  let declined = 0;
  for (const idx of parcels.aliveIndices()) {
    if (!RESIDENTIAL.has(parcels.kindAt(idx))) continue;
    const e = parcels.get(idx);
    if (Math.abs(e.x - siteX) + Math.abs(e.y - siteY) > p.era4DeclineRadius) continue;
    const loss = p.era4DeclineMin + declineRng.nextInt(p.era4DeclineMax - p.era4DeclineMin + 1);
    parcels.setCondition(idx, e.condition - loss);
    declined++;
  }

  world.log.push(
    `era4: suburban flight — ${spurs} spurs, ${houses} suburban parcels, ${offices} offices, ${declined} core parcels declined`,
  );
}

// --- Satellites: exurbs/suburbs with their own grids, freeway-linked ------

/** Lay a small SUBURB grid centred on (sx, sy): two short arterials + a couple of parallel streets
 *  each side, then fill the frontage with houses (the occasional strip). A miniature of the era-1
 *  founding grid, clipped to land. */
function laySatellite(map: GameMap, parcels: ParcelStore, sx: number, sy: number, p: MosesParams, rng: Rng): void {
  const bbox: BBox = { x0: sx, y0: sy, x1: sx, y1: sy };
  const half = p.satelliteSpan >> 1;
  roadAt(map, sx, sy, BuiltKind.RoadStreet, bbox);
  const eRow = growArm(map, sx, sy, 1, 0, half, BuiltKind.RoadStreet, bbox);
  const wRow = growArm(map, sx, sy, -1, 0, half, BuiltKind.RoadStreet, bbox);
  const sCol = growArm(map, sx, sy, 0, 1, half, BuiltKind.RoadStreet, bbox);
  const nCol = growArm(map, sx, sy, 0, -1, half, BuiltKind.RoadStreet, bbox);
  for (let k = 1; k <= p.satelliteBlocks; k++) {
    const off = k * p.blockSpacing;
    if (off <= nCol) {
      roadAt(map, sx, sy - off, BuiltKind.RoadStreet, bbox);
      growArm(map, sx, sy - off, 1, 0, eRow, BuiltKind.RoadStreet, bbox);
      growArm(map, sx, sy - off, -1, 0, wRow, BuiltKind.RoadStreet, bbox);
    }
    if (off <= sCol) {
      roadAt(map, sx, sy + off, BuiltKind.RoadStreet, bbox);
      growArm(map, sx, sy + off, 1, 0, eRow, BuiltKind.RoadStreet, bbox);
      growArm(map, sx, sy + off, -1, 0, wRow, BuiltKind.RoadStreet, bbox);
    }
    if (off <= eRow) {
      roadAt(map, sx + off, sy, BuiltKind.RoadStreet, bbox);
      growArm(map, sx + off, sy, 0, 1, sCol, BuiltKind.RoadStreet, bbox);
      growArm(map, sx + off, sy, 0, -1, nCol, BuiltKind.RoadStreet, bbox);
    }
    if (off <= wRow) {
      roadAt(map, sx - off, sy, BuiltKind.RoadStreet, bbox);
      growArm(map, sx - off, sy, 0, 1, sCol, BuiltKind.RoadStreet, bbox);
      growArm(map, sx - off, sy, 0, -1, nCol, BuiltKind.RoadStreet, bbox);
    }
  }
  // Suburb fabric: mostly single houses, a scattered commercial strip, filled in RANDOM order so any
  // vacancy scatters across the exurb instead of leaving its lower half empty (row-major artefact).
  const roadTiles = collectRoadTiles(map, bbox.x0, bbox.y0, bbox.x1, bbox.y1);
  shuffleInPlace(roadTiles, rng.fork('order'));
  const suburbKind = (i: number): BuiltKind =>
    i % 7 === 0 ? BuiltKind.CommercialStrip : BuiltKind.HouseSingle;
  fillFrontage(map, parcels, roadTiles, rng.fork('fill'), p.satelliteParcels, suburbKind);
}

/** A freeway route from an exurb at (sx,sy) to the core (cx,cy): the OPEN-LAND tile indices to pave as
 *  RoadHighway so the exurb joins the core's drivable network, or null if no route exists. A
 *  breadth-first search over {open land ∪ existing road} (a highway can't be laid on water / rail /
 *  buildings — see canPlaceTransport), so the shortest such corridor is found even when it must bend
 *  around terrain; the open-land cells beyond the exurb footprint (its grid handles the rest) are the
 *  freeway. Deterministic: fixed neighbour order, parent reconstruction by index. */
function freewayRoute(map: GameMap, sx: number, sy: number, cx: number, cy: number, half: number): number[] | null {
  const W = map.width;
  const H = map.height;
  const N = W * H;
  const start = sy * W + sx;
  const goal = cy * W + cx;
  const passable = (i: number): boolean =>
    map.water[i] === Water.None && (map.built[i] === 0 || isRoadKind(map.built[i]!));
  if (!passable(start) || !passable(goal)) return null;
  const prev = new Int32Array(N).fill(-1);
  const seen = new Uint8Array(N);
  const queue = [start];
  seen[start] = 1;
  let head = 0;
  let found = false;
  while (head < queue.length) {
    const i = queue[head++]!;
    if (i === goal) {
      found = true;
      break;
    }
    const x = i % W;
    const y = (i - x) / W;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const ni = ny * W + nx;
      if (!seen[ni] && passable(ni)) {
        seen[ni] = 1;
        prev[ni] = i;
        queue.push(ni);
      }
    }
  }
  if (!found) return null;
  // Pave every OPEN-LAND cell on the path (existing roads on it are already drivable). Paving runs
  // right from the exurb crossroads, so the corridor is gap-free: the grid's centre connects to the
  // first paved cell, then on to the core network. (`half` is unused now — kept for the call site.)
  void half;
  const lay: number[] = [];
  for (let i = goal; i !== start && i !== -1; i = prev[i]!) {
    if (map.built[i] === 0) lay.push(i);
  }
  return lay;
}

/**
 * Satellites — exurbs & suburbs. Beyond the main city, found a few smaller settlements (each its own
 * little core grid + housing) and link each back to the core with a freeway. Sites reuse the founding
 * score (flat, open land), then are kept only if FAR from the core, SPACED from each other, clear of
 * the built city, AND reachable by an unbroken (all-land) freeway L. Runs after era 4 so the main city
 * is whole; era 5 disinvestment then decays the exurbs alongside everything else.
 */
export function eraSatellites(world: WorldState, rng: Rng, p: MosesParams, state: MosesState): void {
  if (!state.founded) return;
  const { map, parcels } = world;
  const half = p.satelliteSpan >> 1;
  const dist = (ax: number, ay: number, bx: number, by: number): number =>
    Math.abs(ax - bx) + Math.abs(ay - by);
  const hasRoadNear = (cx: number, cy: number, r: number): boolean => {
    for (let y = cy - r; y <= cy + r; y++) {
      for (let x = cx - r; x <= cx + r; x++) {
        if (map.inBounds(x, y) && isRoadKind(map.built[map.idx(x, y)]!)) return true;
      }
    }
    return false;
  };

  const before = parcels.aliveCount();
  let n = 0;
  // Each satellite is laid before the next is scored, so spacing + freeway routing see prior exurbs.
  for (const s of scoreSites(map, p)) {
    if (state.satellites.length >= p.satelliteCount) break;
    if (dist(s.x, s.y, state.siteX, state.siteY) < p.satelliteMinCoreDist) continue; // a separate town
    if (state.satellites.some((c) => dist(c.x, c.y, s.x, s.y) < p.satelliteSpacing)) continue; // spaced
    if (hasRoadNear(s.x, s.y, half + 2)) continue; // open land + room for the freeway to start
    const route = freewayRoute(map, s.x, s.y, state.siteX, state.siteY, half);
    if (!route) continue; // no drivable corridor to the core network
    // Pave the freeway BEFORE the exurb's houses, so fillFrontage can't drop a building onto a
    // corridor cell and break the link (a highway can't be laid over a parcel — canPlaceTransport).
    for (const i of route) placeTransport(map, i % map.width, (i - (i % map.width)) / map.width, BuiltKind.RoadHighway);
    laySatellite(map, parcels, s.x, s.y, p, rng.fork(`sat${n}`));
    state.satellites.push({ x: s.x, y: s.y });
    n++;
  }
  world.log.push(`satellites: ${state.satellites.length} exurbs, +${parcels.aliveCount() - before} parcels`);
}

// --- Era 5: disinvestment ------------------------------------------------

/** Mean redline grade (0..255) over parcel `i`'s footprint. */
function parcelMeanRedline(map: GameMap, parcels: ParcelStore, i: number): number {
  const e = parcels.get(i);
  let sum = 0;
  let n = 0;
  for (let dy = 0; dy < e.height; dy++) {
    for (let dx = 0; dx < e.width; dx++) {
      sum += map.redline[map.idx(e.x + dx, e.y + dy)]!;
      n++;
    }
  }
  return n > 0 ? sum / n : 0;
}

/**
 * Era 5 — disinvestment. Two passes (yield point 6): pass 1 decays every parcel
 * by its REDLINE GRADE (the most redlined districts lose the most condition) plus
 * rng noise, collecting those that fall below the abandonment threshold; pass 2
 * demolishes that pre-collected list (so aliveness is never mutated mid-iteration),
 * turning craterChance of them into vacant parking lots on the cleared footprint.
 *
 * Decay no longer keys off highway distance directly: highways are routed THROUGH
 * redlined districts (era 3), so the near-expressway decay gradient re-emerges as a
 * CONSEQUENCE of the grade, not its cause — the inversion that names the policy
 * instead of naturalizing the wound. The neutral live result is "decay". No-ops if
 * never founded.
 */
export function era5Disinvestment(world: WorldState, rng: Rng, p: MosesParams, state: MosesState): void {
  if (!state.founded) return;
  const { map, parcels } = world;

  state.preEra5Alive = parcels.aliveCount();

  // Pass 1: decay all (pre-collected snapshot; no demolition here). Loss scales
  // with the redline grade — greenlined (grade 0) loses only noise; redlined
  // (grade 255) loses the full maxDecay.
  const snapshot = parcels.aliveIndices();
  const decayRng = rng.fork('decay');
  const doomed: number[] = [];
  let decayed = 0;
  for (const idx of snapshot) {
    const grade = parcelMeanRedline(map, parcels, idx); // 0..255
    const loss = Math.floor((p.maxDecay * grade) / 255) + decayRng.nextInt(p.decayNoise + 1);
    parcels.setCondition(idx, parcels.conditionAt(idx) - loss);
    decayed++;
    // Power plants age but are NOT abandoned — the utility keeps the legacy grid
    // running through disinvestment, so the redlined dirty power survives worldgen
    // and the city does not restart 100% dark.
    if (isPowerPlant(parcels.kindAt(idx))) continue;
    if (parcels.conditionAt(idx) < p.abandonThreshold) doomed.push(idx);
  }

  // Pass 2: abandon the collected list; some become parking craters.
  const craterRng = rng.fork('crater');
  let abandoned = 0;
  let craters = 0;
  for (const idx of doomed) {
    const e = parcels.get(idx);
    if (!demolishParcel(map, parcels, idx)) continue;
    abandoned++;
    if (!craterRng.chance(p.craterChance)) continue;
    // Some craters expand into a small parking FIELD where the cleared land allows
    // (a 2x2 grid of lots on the doomed footprint + open neighbours); otherwise a
    // single vacant lot. placeParkingField is all-or-nothing and draws ZERO rng when
    // it can't fit, so in the dense organic city (no room) the rng stream — and the
    // crater condition draw — is unchanged. `craters` sums the ACTUAL ParkingLot
    // parcels placed (field count or 1), NOT crater events, so the exact balance
    // equation alive === preEra5Alive − abandoned + craters holds with fields.
    let lots = placeParkingField(map, parcels, craterRng, e.x, e.y, 2, 2);
    if (lots === 0) {
      const w = e.width >= 2 ? 2 : 1;
      const h = e.height >= 2 ? 2 : 1;
      const condition = 40 + craterRng.nextInt(50);
      if (
        placeParcel(map, parcels, {
          x: e.x, y: e.y, width: w, height: h, kind: BuiltKind.ParkingLot, density: 1, condition,
        }) !== -1
      ) {
        lots = 1;
      }
    }
    craters += lots;
  }

  // A century of accumulated concrete settles into parking: dense 2×2 street blocks
  // become parking lots cars cut through. Counted into `craters` so the chronicle
  // balance (alive = standing − abandoned + craters) stays exact; forked rng leaves
  // era-5's decay/crater streams intact.
  craters += promoteDenseStreets(map, parcels, rng.fork('autopark'));

  world.log.push(
    `era5: disinvestment — ${decayed} decayed, ${abandoned} abandoned, ${craters} craters (of ${state.preEra5Alive} standing)`,
  );
}

// --- Stage assembly ------------------------------------------------------

/**
 * The Moses-century worldgen stage: the redline grade is drawn FIRST (the
 * discriminatory social geography every later burden keys off — see
 * worldgen/redline), then founding & streetcar town → motor age → highways &
 * urban renewal → suburban flight → disinvestment, threading one MosesState and
 * forking each era's rng stream by name. On an all-water map era 1 logs "no
 * viable site" and every later era no-ops on the empty state.
 */
export function mosesCenturyStage(params: Partial<MosesParams> = {}): WorldgenStage {
  const p: MosesParams = { ...DEFAULT_MOSES_PARAMS, ...params };
  return {
    name: 'moses-century',
    apply(world, rng) {
      const state = createMosesState();
      gradeRedline(world.map, rng.fork('redline'));
      era1Founding(world, rng.fork('era1'), p, state);
      era2MotorAge(world, rng.fork('era2'), p, state);
      era3Highways(world, rng.fork('era3'), p, state);
      era4Suburbs(world, rng.fork('era4'), p, state);
      eraSatellites(world, rng.fork('satellites'), p, state);
      era5Disinvestment(world, rng.fork('era5'), p, state);
    },
  };
}
