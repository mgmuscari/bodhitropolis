// Pure render-key seam: the single source of truth for which atlas tile a built
// kind requests. `builtRenderKey` maps (kind, mask, pos, condTier) to a key
// string; `renderKeyspace` enumerates EVERY key the renderer can ever request.
// Both live here — DOM-free and on the architecture pure-ui allowlist — so the
// renderer's atlas can iterate one canonical key set (single source of truth) AND
// a headless test can assert builtRenderKey ⊆ renderKeyspace without a canvas.
//
// No transcendental Math, no DOM: just deterministic string construction.

import { BuiltKind, isRoadKind } from '../engine/fabric';

/** Footprint position of a building tile: center / edge / corner. */
export type FootprintPos = 'c' | 'e' | 'k';

const MASKS = 16; // 4-neighbour connection masks 0..15
const POSITIONS: readonly FootprintPos[] = ['c', 'e', 'k'];
const TIERS: readonly number[] = [0, 1]; // condition tiers: pristine(0) / derelict(1)

// Road-category kinds that read into the `road-{k}-{mask}` tile set: classic
// 1..3 PLUS QuietStreet(7), which renders as a road (hence ROAD_STYLES needs a [7]
// entry in the renderer, else makeRoadTile(7) throws). Rail / streetcar / elevated
// / bike / pedestrian each get their own prefixed mask set below.
const ROAD_RENDER_KINDS: readonly number[] = [
  BuiltKind.RoadStreet,
  BuiltKind.RoadAvenue,
  BuiltKind.RoadHighway,
  BuiltKind.QuietStreet,
  BuiltKind.RoadRamp, // a freeway ramp renders as a road (its own style); never widens
];

// Road kinds that can render as a continuous WIDE slab (a 2×2-block corridor):
// exactly the classic roads 1..3, because the wide flag originates from
// `wideRoadAt` which is `isRoadKind`-based (1..3). QuietStreet(7) is deliberately
// EXCLUDED — `render()` can never request a wide quiet-street key, so enumerating
// `road-7-{m}-w` would emit 16 painted-but-unreachable atlas tiles. Restricting the
// wide block to isRoadKind keeps the wide keyspace == exactly the keys render() can
// request: no dead keys, no blank-tile risk.
const WIDE_ROAD_KINDS: readonly number[] = ROAD_RENDER_KINDS.filter(isRoadKind);

// Non-road transport kinds → their key prefix, in a fixed enumeration order.
const TRANSPORT_PREFIX: ReadonlyArray<readonly [number, string]> = [
  [BuiltKind.Rail, 'rail'],
  [BuiltKind.Streetcar, 'streetcar'],
  [BuiltKind.ElevatedRail, 'elev'],
  [BuiltKind.BikePath, 'bike'],
  [BuiltKind.Promenade, 'ped'],
];
const PREFIX_OF = new Map<number, string>(TRANSPORT_PREFIX);

// Building kinds that render as footprint tiles: Moses-era 16..23 + tech 48..60
// + rezoning greens 61..62. Must match the renderer's BUILDING_STYLES key set exactly.
const BUILDING_RENDER_KINDS: readonly number[] = [
  BuiltKind.HouseSingle,
  BuiltKind.Apartments,
  BuiltKind.Projects,
  BuiltKind.CommercialStrip,
  BuiltKind.Offices,
  BuiltKind.Industrial,
  BuiltKind.ParkingLot,
  BuiltKind.Civic,
  BuiltKind.Precinct,
  BuiltKind.FireStation,
  BuiltKind.Clinic,
  BuiltKind.Library,
  BuiltKind.School,
  BuiltKind.CoalPlant,
  BuiltKind.GasPlant,
  BuiltKind.HydroPlant,
  BuiltKind.NuclearPlant,
  BuiltKind.WindTurbine,
  BuiltKind.SolarPlant,
  BuiltKind.FusionPlant,
  BuiltKind.Parklet,
  BuiltKind.CommunityGarden,
  BuiltKind.CompostHub,
  BuiltKind.VerticalFarm,
  BuiltKind.WastewaterWorks,
  BuiltKind.EnergyNode,
  BuiltKind.AINode,
  BuiltKind.ADU,
  BuiltKind.CoopHousing,
  BuiltKind.Commune,
  BuiltKind.Bazaar,
  BuiltKind.MakerSpace,
  BuiltKind.HealingCommons,
  BuiltKind.Park,
  BuiltKind.RewildedLand,
  // The road-diet planted median: a transport-slot tile that renders as a green strip (b-11-*),
  // not an autotiled road (transportCategory 11 = 0), so it keys through the building-style path.
  BuiltKind.PlantedMedian,
];

/**
 * The atlas key for a built tile. Transport kinds key on `mask` (pos/tier ignored):
 * road kinds 1..3 and QuietStreet(7) → `road-{kind}-{mask}`, the rest → their
 * prefix + mask (`rail-`/`streetcar-`/`elev-`/`bike-`/`ped-`). Buildings key on
 * footprint `pos` and condition `condTier` (mask ignored) → `b-{kind}-{pos}-{tier}`.
 * `pos` is REQUIRED — a building key cannot be formed without it. `wide` (a 2×2
 * road-slab flag) appends `-w` for the classic road kinds 1..3 ONLY; it is ignored
 * for QuietStreet(7), the other transport prefixes, and building kinds — none of
 * which ever widen. Defaults to false so every existing 4-arg call/key is unchanged.
 */
export function builtRenderKey(
  kind: number,
  mask: number,
  pos: FootprintPos,
  condTier: number,
  wide = false,
): string {
  if (ROAD_RENDER_KINDS.includes(kind)) {
    return `road-${kind}-${mask}${wide && isRoadKind(kind) ? '-w' : ''}`;
  }
  const prefix = PREFIX_OF.get(kind);
  if (prefix !== undefined) return `${prefix}-${mask}`;
  return `b-${kind}-${pos}-${condTier}`;
}

/**
 * The atlas key for ONE CELL of a segmented multi-tile building footprint — the
 * tileset-only addressing mode for art generated as a single W×H image and sliced
 * into per-cell PNGs (so a building's tiles read as one continuous picture with
 * seam continuity, not a corner/edge/center motif repeated). Keyed by footprint
 * size (w×h) and the cell's column/row within it, plus the condition tier, so
 * different sizes and tiers never collide: `b-{kind}-{w}x{h}-c{col}-r{row}-{tier}`.
 *
 * This key is NEVER painted procedurally and is deliberately NOT in renderKeyspace
 * — the procedural atlas can't form it, so a tile asks for it ONLY when a tileset
 * supplied it, and otherwise falls back to {@link builtRenderKey}'s pos/tier key.
 * Pure string construction (no DOM / no Math), like the rest of this seam.
 */
export function footprintCellKey(
  kind: number,
  width: number,
  height: number,
  col: number,
  row: number,
  condTier: number,
): string {
  return `b-${kind}-${width}x${height}-c${col}-r${row}-${condTier}`;
}

/**
 * The exhaustive, deterministic enumeration of every key {@link builtRenderKey}
 * can return. Order is stable (road kinds × masks, then each transport prefix ×
 * masks, then building kinds × positions × tiers) and free of duplicates. The
 * renderer's atlas iterates this list so the painted key set and the requested key
 * set have one source of truth.
 */
export function renderKeyspace(): readonly string[] {
  const keys: string[] = [];
  for (const k of ROAD_RENDER_KINDS) {
    for (let m = 0; m < MASKS; m++) keys.push(`road-${k}-${m}`);
  }
  // Wide-body slab variants, appended right after the plain road block so order
  // stays stable and duplicate-free. Only kinds 1..3 (WIDE_ROAD_KINDS) — render()
  // can never request road-7-*-w, so enumerating them would be dead keyspace.
  for (const k of WIDE_ROAD_KINDS) {
    for (let m = 0; m < MASKS; m++) keys.push(`road-${k}-${m}-w`);
  }
  for (const [, prefix] of TRANSPORT_PREFIX) {
    for (let m = 0; m < MASKS; m++) keys.push(`${prefix}-${m}`);
  }
  for (const k of BUILDING_RENDER_KINDS) {
    for (const pos of POSITIONS) {
      for (const tier of TIERS) keys.push(`b-${k}-${pos}-${tier}`);
    }
  }
  return keys;
}
