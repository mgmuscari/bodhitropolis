// Worldgen stage 2: the Moses Century.
//
// One stage, five era sub-steps, that grows a coherent city on the terrain and
// then wrecks it — founding & streetcar town, motor age, highways & urban
// renewal, suburban flight, disinvestment — emitting a chronicle into the world
// log and leaving the blighted start state. Era functions are exported
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
  canPlaceParcel,
  placeParcel,
  placeTransport,
  type ParcelStore,
} from '../engine/fabric';
import type { Rng } from '../engine/rng';
import { distanceField, boxDensity } from './fields';
import type { WorldState } from './pipeline';

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
}

export const DEFAULT_MOSES_PARAMS: MosesParams = {
  siteStride: 4,
  siteMargin: 12,
  flatRadius: 4,
  waterFrontageRadius: 3,
  siteTopK: 4,
  foundingGridSpan: 24,
  foundingBlocks: 3,
  blockSpacing: 4,
  railLines: 2,
  railExtension: 10,
  railMinLength: 6,
  era1Parcels: 40,
  era1Commercial: 6,
  commercialRadius: 6,
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
function placeAdjacent(
  map: GameMap,
  store: ParcelStore,
  rx: number,
  ry: number,
  w: number,
  h: number,
  kind: BuiltKind,
  rng: Rng,
): number {
  const anchors: ReadonlyArray<readonly [number, number]> = [
    [rx, ry - h], // N: parcel's south edge abuts the road
    [rx, ry + 1], // S
    [rx - w, ry], // W
    [rx + 1, ry], // E
  ];
  for (const [ax, ay] of anchors) {
    if (!canPlaceParcel(map, ax, ay, w, h)) continue;
    const density = 1 + rng.nextInt(2);
    const condition = 200 + rng.nextInt(56);
    return placeParcel(map, store, { x: ax, y: ay, width: w, height: h, kind, density, condition });
  }
  return -1;
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
  const roadTiles: number[] = [];
  for (let y = bbox.y0; y <= bbox.y1; y++) {
    for (let x = bbox.x0; x <= bbox.x1; x++) {
      const i = map.idx(x, y);
      if (isRoadKind(map.built[i]!)) roadTiles.push(i);
    }
  }
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

  // Housing fills the remaining frontage, row-major, up to the budget.
  for (const i of roadTiles) {
    if (placed >= p.era1Parcels) break;
    const x = i % map.width;
    const y = (i - x) / map.width;
    if (placeAdjacent(map, parcels, x, y, 1, 1, BuiltKind.HouseSingle, fabRng) !== -1) placed++;
  }

  world.log.push(`era1: fabric — ${placed} parcels (${commercial} commercial)`);
}
