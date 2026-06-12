// Worldgen stage: fabric-demo.
//
// =====================================================================
//  PLACEHOLDER STAGE — replaced by the Moses-century history simulation.
//
//  This lays a single deterministic test town: one crossroads and one of
//  each Moses-era building kind, so the renderer and fabric model have
//  something visible to draw and exercise. It is NOT settlement logic —
//  the successor feature (the Moses-century history sim) deletes this
//  file and grows the city from real history instead. Until then it stays
//  fenced: a named stage, deterministic from seed, that places nothing and
//  never throws on a pathological (e.g. all-water) map.
// =====================================================================
//
// Sub-steps (rng forks): `site` (which all-land window the town sits in),
// `layout` (crossroads jitter, building placement order, density/condition).
// Pure worldgen: only the seeded rng, no transcendental Math, no DOM. Every
// built/parcel write goes through the engine placement functions, preserving
// the single-writer invariant.

import { Water, type GameMap } from '../engine/map';
import { BuiltKind, ParcelStore, placeParcel, placeTransport } from '../engine/fabric';
import type { Rng } from '../engine/rng';
import type { WorldgenStage, WorldState } from './pipeline';

const SITE = 24; // side length of the all-land window the town needs
const MAX_SITES = 8; // collect this many spiral candidates before choosing one

interface BuildingSpec {
  kind: BuiltKind;
  w: number;
  h: number;
}

// One of each Moses-era building kind with a footprint. Array order is the
// deterministic placement order along the road frontage.
const BUILDINGS: ReadonlyArray<BuildingSpec> = [
  { kind: BuiltKind.HouseSingle, w: 1, h: 1 },
  { kind: BuiltKind.CommercialStrip, w: 2, h: 1 },
  { kind: BuiltKind.ParkingLot, w: 2, h: 2 },
  { kind: BuiltKind.Apartments, w: 2, h: 2 },
  { kind: BuiltKind.Offices, w: 2, h: 2 },
  { kind: BuiltKind.Projects, w: 3, h: 3 },
  { kind: BuiltKind.Industrial, w: 3, h: 3 },
  { kind: BuiltKind.Civic, w: 3, h: 3 },
];

/**
 * Spiral outward from the centred window anchor, collecting up to `limit`
 * all-land SITE×SITE window anchors in spiral order. Returns [] if none fit
 * (e.g. an all-water map). The first candidate is the centred window; the
 * caller picks among the collected anchors with the `site` rng.
 */
function findSites(map: GameMap, limit: number): Array<[number, number]> {
  const { width, height } = map;
  const maxX = width - SITE;
  const maxY = height - SITE;
  const valid: Array<[number, number]> = [];
  if (maxX < 0 || maxY < 0) return valid;

  const isAllLand = (ax: number, ay: number): boolean => {
    for (let dy = 0; dy < SITE; dy++) {
      for (let dx = 0; dx < SITE; dx++) {
        if (map.water[map.idx(ax + dx, ay + dy)] !== Water.None) return false;
      }
    }
    return true;
  };
  const consider = (ax: number, ay: number): void => {
    if (ax < 0 || ax > maxX || ay < 0 || ay > maxY) return;
    if (isAllLand(ax, ay)) valid.push([ax, ay]);
  };

  let x = maxX >> 1; // floor((width - SITE)/2): the centred window anchor
  let y = maxY >> 1;
  consider(x, y);

  // Expanding square spiral: legs of length 1,1,2,2,3,3,... turning R,D,L,U.
  const dirs: ReadonlyArray<readonly [number, number]> = [
    [1, 0],
    [0, 1],
    [-1, 0],
    [0, -1],
  ];
  let d = 0;
  const maxRing = width > height ? width : height;
  for (let step = 1; step <= 2 * maxRing && valid.length < limit; step++) {
    for (let leg = 0; leg < 2 && valid.length < limit; leg++) {
      const dir = dirs[d & 3]!;
      for (let s = 0; s < step && valid.length < limit; s++) {
        x += dir[0];
        y += dir[1];
        consider(x, y);
      }
      d++;
    }
  }
  return valid;
}

/** Lay the crossroads: Avenue E-W along row cy and Street N-S along col cx, spanning the window. */
function layCrossroads(map: GameMap, sx: number, sy: number, cx: number, cy: number): void {
  // placeTransport clips at water and merges the centre junction to the
  // higher-capacity kind (avenue) — both are no-ops inside an all-land window
  // but keep the stage safe on any map.
  for (let x = sx; x < sx + SITE; x++) placeTransport(map, x, cy, BuiltKind.RoadAvenue);
  for (let y = sy; y < sy + SITE; y++) placeTransport(map, cx, y, BuiltKind.RoadStreet);
}

/**
 * Place one `spec` building on the first frontage slot that fits, scanning the
 * four road-adjacent lanes (N/S of the avenue, W/E of the street) in order so
 * every placed parcel is 4-adjacent to a road. Returns true if placed.
 */
function placeOnFrontage(
  map: GameMap,
  store: ParcelStore,
  spec: BuildingSpec,
  sx: number,
  sy: number,
  cx: number,
  cy: number,
  density: number,
  condition: number,
): boolean {
  const { w, h, kind } = spec;
  const tryPlace = (ax: number, ay: number): boolean =>
    placeParcel(map, store, { x: ax, y: ay, width: w, height: h, kind, density, condition }) !== -1;

  // Lane N: building bottom edge sits one row above the avenue.
  for (let ax = sx; ax + w <= sx + SITE; ax++) if (tryPlace(ax, cy - h)) return true;
  // Lane S: building top edge sits one row below the avenue.
  for (let ax = sx; ax + w <= sx + SITE; ax++) if (tryPlace(ax, cy + 1)) return true;
  // Lane W: building right edge sits one column west of the street.
  for (let ay = sy; ay + h <= sy + SITE; ay++) if (tryPlace(cx - w, ay)) return true;
  // Lane E: building left edge sits one column east of the street.
  for (let ay = sy; ay + h <= sy + SITE; ay++) if (tryPlace(cx + 1, ay)) return true;
  return false;
}

export function fabricDemoStage(): WorldgenStage {
  return {
    name: 'fabric-demo',
    apply(world: WorldState, rng: Rng): void {
      const { map, parcels } = world;

      const sites = findSites(map, MAX_SITES);
      if (sites.length === 0) {
        world.log.push('fabric-demo: no site');
        return;
      }

      const siteRng = rng.fork('site');
      const chosen = sites[siteRng.nextInt(sites.length)]!;
      const sx = chosen[0];
      const sy = chosen[1];

      const layoutRng = rng.fork('layout');
      const half = SITE >> 1;
      const cx = sx + half + (layoutRng.nextInt(3) - 1); // +/-1 jitter of the crossing
      const cy = sy + half + (layoutRng.nextInt(3) - 1);

      layCrossroads(map, sx, sy, cx, cy);

      for (const spec of BUILDINGS) {
        const density = 1 + layoutRng.nextInt(4); // 1..4
        const condition = layoutRng.nextInt(256); // 0..255
        placeOnFrontage(map, parcels, spec, sx, sy, cx, cy, density, condition);
      }
    },
  };
}
