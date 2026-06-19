// Built-environment model: the BuiltKind taxonomy, the ParcelStore (parcel
// attributes that live alongside the map's `parcel` layer), and the canonical
// world hash. Pure engine module — no DOM, no transcendental Math.
//
// BuiltKind: the kinds of thing that can occupy a tile's `built` layer. Like
// the map enums (see map.ts), these are `as const` objects + literal-union
// types rather than `const enum` — esbuild does not erase cross-module const
// enums, which silently breaks them in production builds.
//
// Code ranges are reserved deliberately so the taxonomy can grow without
// renumbering (no save format exists yet, so this is a cheap bet):
//   0        None (empty tile)
//   1..15    transport (classic roads 1..3, rail 4; transit 5..9, 10..15 spare)
//   16..127  buildings (Moses-era 16..23, reserved 24..47, tech-tree 48..60)
//
// The transit codes 5..9 are granted by the tech tree and, since build-tools,
// placeable on EMPTY land only (they never merge or cross — see canPlaceTransport)
// or reachable as the target of a conversion (see TRANSPORT_CONVERSIONS). The
// tech-tree building codes 48..60 are granted but reach the map only through a
// build tool (see the tools layer). See the tech-tree + build-tools PRPs.

import { GameMap, Water, FNV_OFFSET, FNV_PRIME, fnv1aBytes } from './map';

export const BuiltKind = {
  None: 0,
  // classic transport 1..4
  RoadStreet: 1,
  RoadAvenue: 2,
  RoadHighway: 3,
  Rail: 4,
  // tech-tree transit 5..9 (granted by the tree; placement fenced this feature)
  BikePath: 5,
  Streetcar: 6,
  QuietStreet: 7,
  ElevatedRail: 8,
  Promenade: 9,
  // Freeway RAMP/interchange 10: a drivable tile that is both freeway and surface street — the
  // limited-access on/off + at-grade crossing the worldgen drops through the freeway band so the
  // street grid stays connected (cars enter/exit/cross the freeway only here).
  RoadRamp: 10,
  // Planted median 11 — a road-DIET upgrade (unlocked by the `road-diets` capability): the player
  // converts the interior two-way `through` lane of a 3-wide highway into a planted, NO-TRAFFIC
  // green median. It removes a traffic lane (less throughput → calmer corridor) and reads as a green
  // amenity (lifts nearby land value). Cars never drive on or cross it — a green barrier, like a
  // freeway's limited access. Created only by conversion (never worldgen), so the world hash is
  // untouched; reversible (convert back to highway).
  PlantedMedian: 11,
  // Police precinct 31 — NOT a service. Redlining over-policed the districts it
  // disinvested; the precinct is the apparatus of control, sited in the redlined
  // zones, that suppresses civic voice & trust (see civic/dynamics). The player
  // does NOT build it — they DEFUND it (convert it to a Healing Commons). Named
  // critically, scoped to the oppressive-planning history.
  Precinct: 31,
  // Fire station 32 — a genuine civic SERVICE (unlike the precinct). Worldgen provides it to the
  // greenlined neighborhoods and withholds it from the redlined ones; the player extends coverage
  // to repair (see growth/services via the live coverage field).
  FireStation: 32,
  // Civic SERVICES 33..35 — clinic (health), library + school (education). Like the fire station,
  // worldgen concentrates them in the GREENLINED districts and withholds them from the redlined ones
  // (disinvestment); they extend the live service-coverage field, and the player builds them to
  // repair the redlined zones.
  Clinic: 33,
  Library: 34,
  School: 35,
  // Moses-era buildings 16..23 (24..47 reserved)
  HouseSingle: 16,
  Apartments: 17,
  Projects: 18,
  CommercialStrip: 19,
  Offices: 20,
  Industrial: 21,
  ParkingLot: 22,
  Civic: 23,
  // Power plants 24..30 — the SC2000-style centralized tier (minus microwave).
  // Coal/Gas/Hydro/Nuclear are classic always-buildable legacy power; Wind/Solar/
  // Fusion are the renewable future granted up the Solarpunk branch. Distributed
  // generation is the existing EnergyNode (53). Dirty plants (coal/gas/nuclear) emit
  // into the live pollution field; renewables don't.
  CoalPlant: 24,
  GasPlant: 25,
  HydroPlant: 26,
  NuclearPlant: 27,
  WindTurbine: 28,
  SolarPlant: 29,
  FusionPlant: 30,
  // tech-tree-era buildings 48..60
  Parklet: 48,
  CommunityGarden: 49,
  CompostHub: 50,
  VerticalFarm: 51,
  WastewaterWorks: 52,
  EnergyNode: 53,
  AINode: 54,
  ADU: 55,
  CoopHousing: 56,
  Commune: 57,
  Bazaar: 58,
  MakerSpace: 59,
  HealingCommons: 60,
  // Rezoning-era greens 61..62 — placed only by converting an existing building
  // parcel in place (convert-61/62); soil-healing (unsealed, see ecology) and,
  // for Park, a gathering place (see civic dynamics).
  Park: 61,
  RewildedLand: 62,
} as const;
export type BuiltKind = (typeof BuiltKind)[keyof typeof BuiltKind];

/** Roads (street/avenue/highway). Rail is transport but not a road. */
export const isRoadKind = (k: number): boolean => k >= 1 && k <= 3;
/** A planted median (the road-diet green strip, 11): a transport-slot tile that carries NO traffic. */
export const isPlantedMedian = (k: number): boolean => k === BuiltKind.PlantedMedian;
/** Elevated transit that can deck OVER a road as an overpass: elevated rail (8) or promenade (9). */
export const isOverpassKind = (k: number): boolean =>
  k === BuiltKind.ElevatedRail || k === BuiltKind.Promenade;
/** Any transport kind: classic roads/rail (1..4) or transit kinds (5..15). */
export const isTransportKind = (k: number): boolean => k >= 1 && k <= 15;
/** Any building kind across the widened 16..127 band (transport never overlaps). */
export const isBuildingKind = (k: number): boolean => k >= 16 && k <= 127;
/** A central power plant (coal/gas/hydro/nuclear/wind/solar/fusion, 24..30). */
export const isPowerPlant = (k: number): boolean => k >= 24 && k <= 30;
/** A police precinct (the apparatus of control sited in redlined zones, 31). */
export const isPrecinct = (k: number): boolean => k === 31;
/** A civic SERVICE station that provides coverage: fire (32), clinic (33), library (34), school (35),
 *  or healing commons (60). Worldgen gives them to greenlined districts; the player extends them. */
export const isServiceStation = (k: number): boolean =>
  k === 32 || k === 33 || k === 34 || k === 35 || k === 60;

// --- Parcels -------------------------------------------------------------
//
// A parcel is a multi-tile building footprint plus its attributes (kind,
// density, condition). The map's `built`/`parcel` layers record *where* each
// parcel sits (single source of truth for tiles); the ParcelStore holds the
// *attributes* that don't fit in a tile layer. Storage is struct-of-arrays
// (parallel arrays grown by push) — determinism comes from content, not the
// storage class. Defaults: density 1, condition 255 (pristine).

const DENSITY_DEFAULT = 1;
const CONDITION_DEFAULT = 255;

export interface ParcelInit {
  x: number;
  y: number;
  width: number;
  height: number;
  kind: BuiltKind;
  density?: number;
  condition?: number;
}

/** A materialized read-only view of one parcel (for tests/tools). */
export interface Parcel {
  x: number;
  y: number;
  width: number;
  height: number;
  kind: BuiltKind;
  density: number;
  condition: number;
}

const clampByte = (v: number): number => (v < 0 ? 0 : v > 255 ? 255 : Math.floor(v));

export class ParcelStore {
  private readonly anchorX: number[] = [];
  private readonly anchorY: number[] = [];
  private readonly w: number[] = [];
  private readonly h: number[] = [];
  private readonly kind: number[] = [];
  private readonly density: number[] = [];
  private readonly condition: number[] = [];
  // Tombstone flag (1 = alive, 0 = demolished). Demolition tombstones rather
  // than compacts: the map's `parcel` layer holds baked (index + 1) ids, so
  // removing an array slot would re-index every later parcel. aliveIndices()
  // is the deterministic iteration order for the era passes that decay/abandon.
  private readonly alive: number[] = [];

  /** Append a parcel; returns its index. Newly added parcels are alive. */
  add(p: ParcelInit): number {
    const i = this.anchorX.length;
    this.anchorX.push(p.x);
    this.anchorY.push(p.y);
    this.w.push(p.width);
    this.h.push(p.height);
    this.kind.push(p.kind);
    this.density.push(p.density ?? DENSITY_DEFAULT);
    this.condition.push(p.condition ?? CONDITION_DEFAULT);
    this.alive.push(1);
    return i;
  }

  count(): number {
    return this.anchorX.length;
  }

  /** True iff parcel `i` exists and has not been demolished. */
  isAlive(i: number): boolean {
    return this.alive[i] === 1;
  }

  /** Number of parcels that have not been demolished. */
  aliveCount(): number {
    let c = 0;
    for (let i = 0; i < this.alive.length; i++) if (this.alive[i] === 1) c++;
    return c;
  }

  /**
   * Indices of every alive parcel, ascending. THE deterministic iteration
   * order for era passes (decay, abandonment) — index-ascending and stable
   * regardless of demolition history.
   */
  aliveIndices(): number[] {
    const out: number[] = [];
    for (let i = 0; i < this.alive.length; i++) if (this.alive[i] === 1) out.push(i);
    return out;
  }

  /**
   * Tombstone parcel `i` (demolition). Only {@link demolishParcel} should call
   * this — it keeps tile-clearing and tombstoning together as one write, the
   * inverse of {@link placeParcel}.
   */
  markDead(i: number): void {
    this.alive[i] = 0;
  }

  /** Materialize parcel `i` as an object (allocates — prefer scalar accessors on hot paths). */
  get(i: number): Readonly<Parcel> {
    return {
      x: this.anchorX[i]!,
      y: this.anchorY[i]!,
      width: this.w[i]!,
      height: this.h[i]!,
      kind: this.kind[i]! as BuiltKind,
      density: this.density[i]!,
      condition: this.condition[i]!,
    };
  }

  /** Allocation-free scalar reads, for per-tile renderer use (yield point 5). */
  kindAt(i: number): BuiltKind {
    return this.kind[i]! as BuiltKind;
  }
  densityAt(i: number): number {
    return this.density[i]!;
  }
  conditionAt(i: number): number {
    return this.condition[i]!;
  }

  /** Set condition, clamped to 0..255 (0 = derelict, 255 = pristine). */
  setCondition(i: number, v: number): void {
    this.condition[i] = clampByte(v);
  }

  setDensity(i: number, v: number): void {
    this.density[i] = v;
  }

  /**
   * Set the parcel kind. {@link convertParcel}-only — an in-place kind swap must
   * keep the tile `built` layer and this store kind in lockstep, so nothing else
   * should call this (the inverse risk to setCondition's free use).
   */
  setKind(i: number, k: BuiltKind): void {
    this.kind[i] = k;
  }

  /**
   * Stable byte encoding of every parcel field, in index order. Equal content
   * yields equal bytes; any field change in any parcel changes them. Folded
   * into {@link hashWorld} so parcel attributes (which live outside the map)
   * participate in determinism assertions. Fixed 11-byte little-endian record
   * per parcel: anchorX(u16) anchorY(u16) w(u8) h(u8) kind(u8) density(u16)
   * condition(u8) alive(u8). The alive flag is folded in so a demolition (which
   * tombstones the entry) moves the hash even though the freed tiles do too.
   */
  snapshotBytes(): Uint8Array {
    const n = this.count();
    const bytes = new Uint8Array(n * 11);
    const view = new DataView(bytes.buffer);
    for (let i = 0; i < n; i++) {
      const o = i * 11;
      view.setUint16(o, this.anchorX[i]! & 0xffff, true);
      view.setUint16(o + 2, this.anchorY[i]! & 0xffff, true);
      view.setUint8(o + 4, this.w[i]! & 0xff);
      view.setUint8(o + 5, this.h[i]! & 0xff);
      view.setUint8(o + 6, this.kind[i]! & 0xff);
      view.setUint16(o + 7, Math.floor(this.density[i]!) & 0xffff, true);
      view.setUint8(o + 9, this.condition[i]! & 0xff);
      view.setUint8(o + 10, this.alive[i]! & 0xff);
    }
    return bytes;
  }
}

/**
 * The canonical world hash for all stage determinism tests. Folds the map
 * snapshot (every tile layer, including `parcel`) together with the parcel
 * *attributes* (kind/density/condition/footprint) that live outside the map.
 *
 * Use this — not `map.snapshot()` alone — whenever a test must detect
 * nondeterministic parcel attribute assignment: once stages mutate parcel
 * condition/density, `map.snapshot()` is blind to those changes (see the
 * asymmetry-pin test). Typed structurally so this engine module never imports
 * worldgen's WorldState (architecture rule: engine is worldgen-free).
 */
export interface HashableWorld {
  map: GameMap;
  parcels: ParcelStore;
}

export function hashWorld(world: HashableWorld): string {
  const snap = world.map.snapshot();
  let h = FNV_OFFSET;
  for (let i = 0; i < snap.length; i++) {
    h ^= snap.charCodeAt(i);
    h = Math.imul(h, FNV_PRIME);
  }
  h = fnv1aBytes(h, world.parcels.snapshotBytes());
  return `${(h >>> 0).toString(16).padStart(8, '0')}`;
}

// --- Placement -----------------------------------------------------------
//
// These functions are the SINGLE source of truth for the built/parcel tile
// layers: nothing else writes them (PRD risk #1, dual-source-of-truth). A
// parcel write touches built + parcel together; a transport write touches
// built only. Keeping all writes here is what lets checkParcelAgreement stay a
// meaningful invariant.

const MIN_FOOTPRINT = 1;
const MAX_FOOTPRINT = 4; // the largest plant footprint (Nuclear/Fusion are 4x4)

/**
 * Transport conversions: the explicit "road diet" transformation table. A tile
 * holding a `from` kind may be converted in place to any kind in its entry list.
 * These are deliberate transformations — a street narrows to a quiet street, a
 * promenade, or a bike path; an avenue steps down to a street; a highway reverses
 * to a boulevard-grade avenue; a rail line becomes a streetcar — NOT placements
 * and NOT junction merges. Conversion is the ONLY way a kind reaches an
 * already-occupied tile: placement stays empty-land-only, and the junction merge
 * (max() over same-category classic kinds) is untouched. Joining the single-writer
 * block keeps every built-layer write in this module (PRD risk #1).
 */
export const TRANSPORT_CONVERSIONS: ReadonlyMap<BuiltKind, readonly BuiltKind[]> = new Map<
  BuiltKind,
  readonly BuiltKind[]
>([
  [BuiltKind.RoadStreet, [BuiltKind.QuietStreet, BuiltKind.Promenade, BuiltKind.BikePath]],
  [BuiltKind.RoadAvenue, [BuiltKind.RoadStreet, BuiltKind.QuietStreet]],
  // A highway reverses to a boulevard-grade avenue, OR — once road diets are unlocked — its interior
  // through-lane is planted as a no-traffic median (the tool fences PlantedMedian to interior lanes).
  [BuiltKind.RoadHighway, [BuiltKind.RoadAvenue, BuiltKind.PlantedMedian]],
  // The road diet is reversible: a planted median converts back to highway.
  [BuiltKind.PlantedMedian, [BuiltKind.RoadHighway]],
  [BuiltKind.Rail, [BuiltKind.Streetcar]],
]);

/**
 * True iff a `w`×`h` building footprint anchored at (x, y) can be placed:
 * footprint size in 1..3, fully in-bounds, and every covered tile is land,
 * unbuilt, and unowned by a parcel.
 */
export function canPlaceParcel(map: GameMap, x: number, y: number, w: number, h: number): boolean {
  if (w < MIN_FOOTPRINT || w > MAX_FOOTPRINT || h < MIN_FOOTPRINT || h > MAX_FOOTPRINT) return false;
  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) {
      const tx = x + dx;
      const ty = y + dy;
      if (!map.inBounds(tx, ty)) return false;
      const i = map.idx(tx, ty);
      if (map.water[i] !== Water.None) return false;
      if (map.built[i] !== 0) return false;
      if (map.parcel[i] !== 0) return false;
    }
  }
  return true;
}

/**
 * Place a building parcel: validate, append the store entry, then stamp its
 * kind into `built` and its (index + 1) into `parcel` across the footprint.
 * Returns the parcel index, or -1 (writing nothing) if invalid.
 */
export function placeParcel(map: GameMap, store: ParcelStore, init: ParcelInit): number {
  if (!canPlaceParcel(map, init.x, init.y, init.width, init.height)) return -1;
  const idx = store.add(init);
  const id = idx + 1;
  for (let dy = 0; dy < init.height; dy++) {
    for (let dx = 0; dx < init.width; dx++) {
      const i = map.idx(init.x + dx, init.y + dy);
      map.built[i] = init.kind;
      map.parcel[i] = id;
    }
  }
  return idx;
}

/**
 * True iff `kind` (a transport kind) can occupy (x, y): in-bounds land that is
 * either empty OR already holds a transport kind of the SAME connectable
 * category — road onto road, rail onto rail (a junction merge). Road-onto-rail
 * and rail-onto-road fail (no crossings in v1); building tiles fail.
 *
 * Transit kinds 5..9 are placeable on EMPTY land ONLY. They never merge and never
 * cross: the junction-merge predicate stays `isRoadKind && isRoadKind` (1..3) and
 * `Rail === Rail`, and isRoadKind(7..9) is false, so every >4 kind is excluded
 * from merging on BOTH sides. Do NOT relax this to a transportCategory test —
 * QuietStreet(7) is category road, so a category predicate would admit
 * Street(1)<->QuietStreet(7) and resolve max(1,7)=7, the capacity-unsafe outcome
 * the empty-only rule prevents. Narrowing an existing road to a quiet street is a
 * CONVERSION (see convertTransport), not a placement.
 */
export function canPlaceTransport(map: GameMap, x: number, y: number, kind: number): boolean {
  if (!isTransportKind(kind)) return false;
  if (!map.inBounds(x, y)) return false;
  const i = map.idx(x, y);
  if (map.water[i] !== Water.None) return false;
  const existing = map.built[i]!;
  if (existing === 0) return true; // empty land: any transport kind (incl. 5..9)
  if (isRoadKind(kind) && isRoadKind(existing)) return true; // road/road junction
  if (kind === BuiltKind.Rail && existing === BuiltKind.Rail) return true; // rail/rail
  return false; // building tile, road<->rail crossing, or a transit kind onto anything
}

/**
 * Place a transport tile. On empty land, writes `kind`. On a same-category
 * junction, the tile resolves deterministically to the higher-capacity kind —
 * `max(existing, kind)` (street < avenue < highway by code order, so the bigger
 * road wins the shared junction tile). Returns false (writing nothing) if
 * invalid.
 */
export function placeTransport(map: GameMap, x: number, y: number, kind: number): boolean {
  if (!canPlaceTransport(map, x, y, kind)) return false;
  const i = map.idx(x, y);
  const existing = map.built[i]!;
  map.built[i] = existing === 0 ? kind : Math.max(existing, kind);
  return true;
}

/**
 * Lay a transport DECK that may span WATER — a bridge. On land it is identical to placeTransport.
 * Over water it decks the span onto open water or merges road-over-road (keeping the water layer
 * underneath, so the tile still reads as water to the renderer + the runoff/parking systems — a
 * bridge, not a causeway), but never decks a building. Worldgen freeway corridors use this to cross
 * an inlet instead of leaving a gap; transport-over-transport overpasses (elevated rail over roads,
 * promenades over freeways) are the natural future extension of the same primitive.
 */
export function placeBridge(map: GameMap, x: number, y: number, kind: number): boolean {
  if (!isTransportKind(kind)) return false;
  if (!map.inBounds(x, y)) return false;
  const i = map.idx(x, y);
  if (map.water[i] === Water.None) return placeTransport(map, x, y, kind); // land: normal placement
  const existing = map.built[i]!;
  if (existing === 0) {
    map.built[i] = kind; // deck over open water
    return true;
  }
  if (isRoadKind(kind) && isRoadKind(existing)) {
    map.built[i] = Math.max(existing, kind); // a bridge junction (two corridors cross over water)
    return true;
  }
  return false; // a building (or rail/transit clash) under the span — don't deck it
}

/**
 * True iff the transport tile at (x, y) can be converted to `to`: the tile must
 * hold a `from` kind whose {@link TRANSPORT_CONVERSIONS} entry contains `to`.
 * Empty tiles, building tiles, and off-table (from, to) pairs all return false.
 */
export function canConvertTransport(map: GameMap, x: number, y: number, to: number): boolean {
  if (!map.inBounds(x, y)) return false;
  const from = map.built[map.idx(x, y)]! as BuiltKind;
  const targets = TRANSPORT_CONVERSIONS.get(from);
  return targets !== undefined && targets.includes(to as BuiltKind);
}

/**
 * Convert the transport tile at (x, y) to `to`, writing only the built layer for
 * that one tile. Returns false (writing nothing) unless {@link canConvertTransport}
 * holds. A conversion is a transformation, not a placement or merge — it touches
 * neither the parcel layer nor the ParcelStore (transport tiles carry no parcel).
 */
export function convertTransport(map: GameMap, x: number, y: number, to: number): boolean {
  if (!canConvertTransport(map, x, y, to)) return false;
  map.built[map.idx(x, y)] = to;
  return true;
}

/**
 * True iff (x, y) is the INTERIOR two-way lane of a 3+-wide divided road: the road runs along its
 * longer same-band axis, and on the shorter (width) axis BOTH neighbours are in the road's lane band
 * (the same road kind, the freeway family, or an existing planted median). This mirrors the car-sim's
 * `freewayLane` `through` role, kept engine-pure so the tool layer can gate the road-diet planted
 * median (interior-lane-only) without importing the UI. An avenue is 2-wide (no interior lane) and a
 * square crossing (equal bands) is a junction — both return false.
 */
export function isInteriorRoadLane(map: GameMap, x: number, y: number): boolean {
  const k = map.built[map.idx(x, y)]! as number;
  if (k !== BuiltKind.RoadAvenue && k !== BuiltKind.RoadHighway) return false;
  const freewayFamily = (c: number): boolean =>
    c === BuiltKind.RoadHighway || c === BuiltKind.RoadRamp;
  const band = (nx: number, ny: number): boolean => {
    if (!map.inBounds(nx, ny)) return false;
    const b = map.built[map.idx(nx, ny)]! as number;
    return b === k || (freewayFamily(k) && freewayFamily(b)) || b === BuiltKind.PlantedMedian;
  };
  const run = (dx: number, dy: number): number => {
    let n = 0;
    for (let i = 1; i <= 3; i++) {
      if (!band(x + dx * i, y + dy * i)) break;
      n++;
    }
    return n;
  };
  const vert = 1 + run(0, -1) + run(0, 1);
  const horiz = 1 + run(-1, 0) + run(1, 0);
  if (horiz > vert) return band(x, y - 1) && band(x, y + 1); // road horizontal → N & S both in band
  if (vert > horiz) return band(x - 1, y) && band(x + 1, y); // road vertical → E & W both in band
  return false; // equal bands = a square crossing (a junction), not an interior lane
}

/**
 * Rezoning targets: the building kinds an existing alive building parcel may be
 * converted *in place* into. A fixed set (the building analogue of the per-from
 * {@link TRANSPORT_CONVERSIONS} table) — *any* alive building parcel rezones to
 * either of these depaved greens.
 */
export const REZONE_TARGETS: ReadonlySet<BuiltKind> = new Set<BuiltKind>([
  BuiltKind.Park,
  BuiltKind.RewildedLand,
]);

/**
 * True iff the tile at (x, y) can be rezoned to `to`: in-bounds; `to` is a
 * rezone target; the tile holds a BUILDING kind (not transport/empty) carrying a
 * non-zero parcel id whose store entry is alive; and it is not already `to` (a
 * same-kind no-op is refused so a repeat convert writes nothing). Clicking any
 * footprint tile rezones the whole parcel — the conversion resolves via its id.
 */
export function canConvertParcel(
  map: GameMap,
  store: ParcelStore,
  x: number,
  y: number,
  to: number,
): boolean {
  if (!map.inBounds(x, y)) return false;
  if (!REZONE_TARGETS.has(to as BuiltKind)) return false;
  const idx = map.idx(x, y);
  const built = map.built[idx]!;
  if (!isBuildingKind(built)) return false; // empty / transport tile
  if (built === to) return false; // same-kind no-op
  const pid = map.parcel[idx]!;
  if (pid === 0) return false;
  const i = pid - 1;
  if (i < 0 || i >= store.count()) return false;
  return store.isAlive(i);
}

/**
 * Rezone the building parcel under (x, y) to `to`, in place: across the store
 * entry's existing footprint, write `built = to` (the parcel-id layer is left
 * UNCHANGED — same id, same footprint), then set the store kind to `to` and reset
 * condition to 255 (pristine). Returns false (writing nothing) unless
 * {@link canConvertParcel} holds. Joins the single-writer block beside
 * {@link convertTransport}: built + store kind move together, so
 * {@link checkParcelAgreement} stays clean and {@link hashWorld} stays deterministic.
 */
export function convertParcel(
  map: GameMap,
  store: ParcelStore,
  x: number,
  y: number,
  to: number,
): boolean {
  if (!canConvertParcel(map, store, x, y, to)) return false;
  const i = map.parcel[map.idx(x, y)]! - 1;
  const p = store.get(i);
  for (let dy = 0; dy < p.height; dy++) {
    for (let dx = 0; dx < p.width; dx++) {
      map.built[map.idx(p.x + dx, p.y + dy)] = to; // parcel layer untouched
    }
  }
  store.setKind(i, to as BuiltKind);
  store.setCondition(i, 255);
  return true;
}

// --- Demolition ----------------------------------------------------------
//
// The inverse of placement, kept in this same single-writer module: a parcel
// demolition clears built + parcel across the footprint AND tombstones the
// store entry together; a transport demolition clears built only. Tombstoning
// (not array compaction) preserves the baked (index + 1) ids in the `parcel`
// layer, so later parcels keep their ids. checkParcelAgreement flags any tile
// still pointing at a tombstoned entry.

/**
 * Demolish building parcel `i`: clear `built` and `parcel` across its footprint
 * (exactly the store entry's rectangle, guaranteed by the placement + agreement
 * invariant) and tombstone the store entry. Returns false (writing nothing) if
 * `i` is out of range or already demolished.
 */
export function demolishParcel(map: GameMap, store: ParcelStore, i: number): boolean {
  if (i < 0 || i >= store.count()) return false;
  if (!store.isAlive(i)) return false;
  const p = store.get(i);
  for (let dy = 0; dy < p.height; dy++) {
    for (let dx = 0; dx < p.width; dx++) {
      const t = map.idx(p.x + dx, p.y + dy);
      map.built[t] = 0;
      map.parcel[t] = 0;
    }
  }
  store.markDead(i);
  return true;
}

/**
 * Demolish the transport tile at (x, y): clear `built` to 0. Returns false
 * (writing nothing) unless the tile is in-bounds and holds a transport kind —
 * empty tiles and building tiles are refused (a building must be demolished
 * via {@link demolishParcel}).
 */
export function demolishTransportAt(map: GameMap, x: number, y: number): boolean {
  if (!map.inBounds(x, y)) return false;
  const i = map.idx(x, y);
  if (!isTransportKind(map.built[i]!)) return false;
  map.built[i] = 0;
  return true;
}

// --- Connectivity queries ------------------------------------------------

// Connection category per transport kind: tiles connect (and autotile) only to
// same-category neighbours. Explicit table, not range logic, because the transit
// kinds cut across the numeric order: Streetcar(6)/ElevatedRail(8) share the RAIL
// category, QuietStreet(7) reads as ROAD (for masks only — frontage stays on
// isRoadKind this feature), and Promenade(9) is its own PEDESTRIAN category.
const TRANSPORT_CATEGORY: Readonly<Record<number, number>> = {
  [BuiltKind.RoadStreet]: 1, // road
  [BuiltKind.RoadAvenue]: 1,
  [BuiltKind.RoadHighway]: 1,
  [BuiltKind.Rail]: 2, // rail
  [BuiltKind.BikePath]: 3, // bike
  [BuiltKind.Streetcar]: 2, // shares rail
  [BuiltKind.QuietStreet]: 1, // reads as road
  [BuiltKind.ElevatedRail]: 2, // shares rail
  [BuiltKind.Promenade]: 4, // pedestrian
  [BuiltKind.RoadRamp]: 1, // a freeway ramp connects + masks like a road
};

/** 0 = not transport, 1 = road, 2 = rail, 3 = bike, 4 = pedestrian. */
export function transportCategory(kind: number): number {
  return TRANSPORT_CATEGORY[kind] ?? 0;
}

// Named connection/divider mask bits: N=1, E=2, S=4, W=8.
const N_BIT = 1;
const E_BIT = 2;
const S_BIT = 4;
const W_BIT = 8;

// 4-neighbour offsets paired with the mask bit each sets: N=1, E=2, S=4, W=8.
const MASK_DIRS: ReadonlyArray<readonly [number, number, number]> = [
  [0, -1, 1], // N
  [1, 0, 2], // E
  [0, 1, 4], // S
  [-1, 0, 8], // W
];

/**
 * Autotiling connection mask for the transport tile at (x, y): bit 0=N, 1=E,
 * 2=S, 3=W is set when that 4-neighbour is a transport tile of the SAME
 * category (road kinds connect to road kinds; rail only to rail). Returns 0 on
 * a non-transport tile or when no neighbour connects. Out-of-bounds neighbours
 * are unset.
 */
export function transportMask(map: GameMap, x: number, y: number): number {
  const selfCat = transportCategory(map.getBuilt(x, y));
  if (selfCat === 0) return 0;
  let mask = 0;
  for (const [dx, dy, bit] of MASK_DIRS) {
    const nx = x + dx;
    const ny = y + dy;
    if (!map.inBounds(nx, ny)) continue;
    if (transportCategory(map.getBuilt(nx, ny)) === selfCat) mask |= bit;
  }
  return mask;
}

/**
 * Is the edge between road kinds `a` and `b` a LIMITED-ACCESS boundary — i.e. should a physical
 * divider (jersey barrier / guardrail) be drawn there? True exactly when both are road-category
 * tiles that would otherwise merge (transportCategory 1), NEITHER is a ramp (the ramp is the legal
 * crossing — no barrier), and EXACTLY ONE is the limited-access freeway (RoadHighway). So a freeway
 * running alongside an avenue frontage road gets a divider, but freeway↔freeway and street↔avenue do
 * not, and a ramp is an open gap. (Mechanical, not cosmetic: it's where you physically can't cross.)
 */
export function isLimitedAccessBoundary(a: number, b: number): boolean {
  if (transportCategory(a) !== 1 || transportCategory(b) !== 1) return false;
  if (a === BuiltKind.RoadRamp || b === BuiltKind.RoadRamp) return false;
  return (a === BuiltKind.RoadHighway) !== (b === BuiltKind.RoadHighway);
}

/** Raw divider mask: every freeway↔surface-road edge, no run-length filter (see roadDividerMask). */
function rawRoadDividerMask(map: GameMap, x: number, y: number): number {
  const self = map.getBuilt(x, y);
  if (transportCategory(self) !== 1) return 0;
  let mask = 0;
  for (const [dx, dy, bit] of MASK_DIRS) {
    const nx = x + dx;
    const ny = y + dy;
    if (!map.inBounds(nx, ny)) continue;
    if (isLimitedAccessBoundary(self, map.getBuilt(nx, ny))) mask |= bit;
  }
  return mask;
}

// The axis a divider boundary RUNS along, per edge bit: a vertical boundary (E/W) continues along Y,
// a horizontal one (N/S) along X. Used to measure how long the freeway/frontage boundary persists.
const DIVIDER_RUN_AXIS: ReadonlyArray<readonly [number, number, number]> = [
  [1, 1, 0], // N: horizontal boundary → run along X
  [2, 0, 1], // E: vertical boundary → run along Y
  [4, 1, 0], // S
  [8, 0, 1], // W
];

/** Contiguous length (incl. self) of the divider `bit` boundary through (x, y) along (sx, sy). */
function dividerRun(map: GameMap, x: number, y: number, bit: number, sx: number, sy: number): number {
  let len = 1;
  for (let s = 1; ; s++) {
    const nx = x + sx * s;
    const ny = y + sy * s;
    if (map.inBounds(nx, ny) && (rawRoadDividerMask(map, nx, ny) & bit) !== 0) len++;
    else break;
  }
  for (let s = 1; ; s++) {
    const nx = x - sx * s;
    const ny = y - sy * s;
    if (map.inBounds(nx, ny) && (rawRoadDividerMask(map, nx, ny) & bit) !== 0) len++;
    else break;
  }
  return len;
}

/**
 * Divider mask for the road tile at (x, y): bit N=1/E=2/S=4/W=8 set on each 4-neighbour edge that is
 * a {@link isLimitedAccessBoundary} (freeway ↔ surface road) AND part of a boundary that runs at
 * least `minRun` tiles. The run filter is the point (Maddy 2026-06-19): a 1-tile freeway/street
 * contact is a CROSSING (an onramp), not a parallel frontage, so it gets NO barrier — only a
 * sustained ≥`minRun` stretch does. `minRun = 1` (default) is the unfiltered rule. The dual of
 * {@link transportMask}: that says which edges MERGE, this says which are SEPARATED. Render-only.
 */
export function roadDividerMask(map: GameMap, x: number, y: number, minRun = 1): number {
  const raw = rawRoadDividerMask(map, x, y);
  if (minRun <= 1 || raw === 0) return raw;
  let out = 0;
  for (const [bit, sx, sy] of DIVIDER_RUN_AXIS) {
    if ((raw & bit) !== 0 && dividerRun(map, x, y, bit, sx, sy) >= minRun) out |= bit;
  }
  return out;
}

/**
 * Curb mask for the road tile at (x, y): bit N=1/E=2/S=4/W=8 set on each 4-neighbour edge where a
 * SURFACE road meets a NON-road tile (parcel / building / open land / water) — i.e. where a curb +
 * gutter + sidewalk belongs. The complement of the connection: those edges merge, these meet the
 * city. Excludes freeways (they get a limited-access barrier via {@link roadDividerMask}, not a
 * sidewalk) and any edge facing another road. Render-only. (Future: tech could add edge props —
 * street trees, bike racks — on the same curb edges.)
 */
export function roadCurbMask(map: GameMap, x: number, y: number): number {
  const self = map.getBuilt(x, y);
  if (transportCategory(self) !== 1 || self === BuiltKind.RoadHighway) return 0;
  let mask = 0;
  for (const [dx, dy, bit] of MASK_DIRS) {
    const nx = x + dx;
    const ny = y + dy;
    if (!map.inBounds(nx, ny)) continue; // map edge: no curb
    if (transportCategory(map.getBuilt(nx, ny)) !== 1) mask |= bit; // non-road neighbour → curb
  }
  return mask;
}

/**
 * The MARKING mask for a RoadRamp tile (a street overlaid on a freeway tile): only the edges toward
 * the FREEWAY band (RoadHighway / RoadRamp neighbours). Used instead of the full connection mask so
 * the ramp's dashed line runs STRAIGHT THROUGH along the freeway, instead of forming a + cross with
 * the surface street it also connects (Maddy 2026-06-19 — "go straight through instead of crosses").
 * The street arms stay functional (canDrive crosses there); they're just not drawn as a crossing.
 * 0 on a non-ramp tile. Render-only.
 */
export function rampMarkingMask(map: GameMap, x: number, y: number): number {
  if (map.getBuilt(x, y) !== BuiltKind.RoadRamp) return 0;
  const hwy = (px: number, py: number): boolean =>
    map.inBounds(px, py) && map.getBuilt(px, py) === BuiltKind.RoadHighway;
  // The freeway axis is the one with HIGHWAY neighbours (only — a crossing's other ramp tiles are
  // PERPENDICULAR to the freeway, so counting ramps would re-introduce the cross at a 3-wide
  // crossing). Draw a straight line clean THROUGH along that axis.
  const vMag = (hwy(x, y - 1) ? 1 : 0) + (hwy(x, y + 1) ? 1 : 0);
  const hMag = (hwy(x - 1, y) ? 1 : 0) + (hwy(x + 1, y) ? 1 : 0);
  if (vMag === 0 && hMag === 0) return 0; // a ramp not flanking any freeway → no through-line
  return vMag >= hMag ? N_BIT | S_BIT : E_BIT | W_BIT;
}

/** Carved freeway corridor width (centre spine + 2 flanks — see carveCorridor in worldgen/moses). */
export const FREEWAY_WIDTH = 3;

/**
 * The axis a freeway MEDIAN jersey barrier runs along on tile (x, y), or null if (x, y) isn't a
 * median tile. A freeway corridor is 3 wide (centre spine + 2 flanks); the median sits on the CENTRE
 * tile and runs LENGTHWISE (Maddy 2026-06-19: "barriers in the middle tile lengthwise"). 'v' = a
 * vertical (N-S) freeway → a vertical barrier; 'h' = horizontal. A tile qualifies iff it is a
 * freeway that continues lengthwise AND sits at the exact centre of an odd-width (≥3) perpendicular
 * run of freeway lanes. Ramps (not RoadHighway) break the run, so the median opens at crossings.
 * Render-only — reads the hashed `built` layer, never writes.
 */
export function freewayMedianAxis(map: GameMap, x: number, y: number): 'v' | 'h' | null {
  if (map.getBuilt(x, y) !== BuiltKind.RoadHighway) return null;
  const hwy = (px: number, py: number): boolean =>
    map.inBounds(px, py) && map.getBuilt(px, py) === BuiltKind.RoadHighway;
  // Measure the contiguous freeway run through (x, y) on BOTH axes. The median runs along the
  // LENGTHWISE (longer) axis; the tile must sit at the centre of the strictly-SHORTER (width) band,
  // which must be an odd ≥3 cross-section (a real centre lane). Comparing run lengths is what
  // distinguishes the width band from the corridor length (a length-centred tile is symmetric too).
  let wl = 0;
  while (hwy(x - wl - 1, y)) wl++;
  let wr = 0;
  while (hwy(x + wr + 1, y)) wr++;
  const ewRun = wl + wr + 1;
  let nu = 0;
  while (hwy(x, y - nu - 1)) nu++;
  let nd = 0;
  while (hwy(x, y + nd + 1)) nd++;
  const nsRun = nu + nd + 1;
  // The width band must be EXACTLY the freeway width (3): a wider band means an interchange / freeway
  // cross, NOT a clean corridor — no median there (fixes a misplaced barrier at the big freeway
  // cross, Maddy 2026-06-19). Vertical freeway: E-W is the 3-wide centred band, N-S strictly longer.
  if (wl === wr && ewRun === FREEWAY_WIDTH && nsRun > ewRun) return 'v';
  // Horizontal freeway: N-S is the 3-wide centred band; E-W strictly longer.
  if (nu === nd && nsRun === FREEWAY_WIDTH && ewRun > nsRun) return 'h';
  return null;
}

/**
 * The lengthwise (travel) axis of a freeway tile — 'v' (N-S) or 'h' (E-W), whichever freeway run is
 * longer through (x, y); null on a non-freeway or an exactly-square run (interchange centre). Used to
 * lay a dashed lane line ALONG the corridor, so freeways read as lanes instead of blank asphalt
 * (Maddy 2026-06-19: "freeways do not have lane markings"). Render-only.
 */
export function freewayAxis(map: GameMap, x: number, y: number): 'v' | 'h' | null {
  if (map.getBuilt(x, y) !== BuiltKind.RoadHighway) return null;
  const hwy = (px: number, py: number): boolean =>
    map.inBounds(px, py) && map.getBuilt(px, py) === BuiltKind.RoadHighway;
  let wl = 0;
  while (hwy(x - wl - 1, y)) wl++;
  let wr = 0;
  while (hwy(x + wr + 1, y)) wr++;
  let nu = 0;
  while (hwy(x, y - nu - 1)) nu++;
  let nd = 0;
  while (hwy(x, y + nd + 1)) nd++;
  const ewRun = wl + wr + 1;
  const nsRun = nu + nd + 1;
  if (nsRun > ewRun) return 'v';
  if (ewRun > nsRun) return 'h';
  return null;
}

/**
 * The lane-boundary mask for a freeway tile: bit N=1/E=2/S=4/W=8 on each edge PERPENDICULAR to travel
 * that abuts another freeway lane tile — i.e. the boundary between two adjacent lanes, where a lane
 * line belongs (Maddy 2026-06-19: "inner lanes need a marking between the tiles"). 0 on a non-freeway
 * or a freeway with no parallel lane. Render-only.
 */
export function freewayLaneBoundaryMask(map: GameMap, x: number, y: number): number {
  const axis = freewayAxis(map, x, y);
  if (axis === null) return 0;
  const hwy = (px: number, py: number): boolean =>
    map.inBounds(px, py) && map.getBuilt(px, py) === BuiltKind.RoadHighway;
  let mask = 0;
  if (axis === 'v') {
    // vertical travel → lane boundaries are the E/W edges
    if (hwy(x - 1, y)) mask |= W_BIT;
    if (hwy(x + 1, y)) mask |= E_BIT;
  } else {
    if (hwy(x, y - 1)) mask |= N_BIT;
    if (hwy(x, y + 1)) mask |= S_BIT;
  }
  return mask;
}

/** The elevated deck (overpass) kind at (x, y), or 0 (none). Reads the second `deck` layer. */
export function overpassAt(map: GameMap, x: number, y: number): number {
  return map.inBounds(x, y) ? map.deck[map.idx(x, y)]! : 0;
}

/**
 * True iff an overpass of `kind` can be DECKED at (x, y): `kind` is an elevated transit kind, the
 * tile is in-bounds with an EMPTY deck, and the `built` layer below is a road/freeway/ramp/rail (the
 * thing being grade-separated). Decking over open land or a building is refused — an overpass spans
 * traffic, it isn't a free-standing viaduct.
 */
export function canPlaceOverpass(map: GameMap, x: number, y: number, kind: number): boolean {
  if (!isOverpassKind(kind)) return false;
  if (!map.inBounds(x, y)) return false;
  const i = map.idx(x, y);
  if (map.deck[i] !== 0) return false; // a tile decks at most once
  const below = map.built[i]!;
  return isRoadKind(below) || below === BuiltKind.RoadRamp || below === BuiltKind.Rail;
}

/** Deck an overpass at (x, y), writing only the `deck` layer (the road below is untouched). Returns
 *  false (writing nothing) unless {@link canPlaceOverpass} holds. */
export function placeOverpass(map: GameMap, x: number, y: number, kind: number): boolean {
  if (!canPlaceOverpass(map, x, y, kind)) return false;
  map.deck[map.idx(x, y)] = kind;
  return true;
}

/** Remove the overpass deck at (x, y), leaving the road below. Returns false if there was no deck. */
export function removeOverpassAt(map: GameMap, x: number, y: number): boolean {
  if (!map.inBounds(x, y)) return false;
  const i = map.idx(x, y);
  if (map.deck[i] === 0) return false;
  map.deck[i] = 0;
  return true;
}

/**
 * Autotiling connection mask for the DECK tile at (x, y): like {@link transportMask}, but over the
 * `deck` layer — a deck tile connects (bit N=1/E=2/S=4/W=8) to a 4-neighbour deck tile of the SAME
 * connection category (an elevated rail line, a promenade overpass). 0 on a tile with no deck.
 */
export function deckMask(map: GameMap, x: number, y: number): number {
  if (!map.inBounds(x, y)) return 0;
  const selfCat = transportCategory(map.deck[map.idx(x, y)]!);
  if (selfCat === 0) return 0;
  let mask = 0;
  for (const [dx, dy, bit] of MASK_DIRS) {
    const nx = x + dx;
    const ny = y + dy;
    if (!map.inBounds(nx, ny)) continue;
    if (transportCategory(map.deck[map.idx(nx, ny)]!) === selfCat) mask |= bit;
  }
  return mask;
}

/**
 * True iff any tile orthogonally adjacent to parcel `i`'s footprint perimeter
 * (and outside the footprint) is a connection-category ROAD tile
 * (transportCategory === 1: classic roads 1..3 AND QuietStreet). Diagonals do not
 * count — only the 4-neighbours of footprint tiles are examined. Rail (cat 2),
 * bike (cat 3) and pedestrian (cat 4) kinds are not road frontage.
 */
export function parcelTouchesRoad(map: GameMap, store: ParcelStore, i: number): boolean {
  const p = store.get(i);
  const inside = (x: number, y: number): boolean =>
    x >= p.x && x < p.x + p.width && y >= p.y && y < p.y + p.height;
  for (let dy = 0; dy < p.height; dy++) {
    for (let dx = 0; dx < p.width; dx++) {
      const tx = p.x + dx;
      const ty = p.y + dy;
      for (const [ddx, ddy] of MASK_DIRS) {
        const nx = tx + ddx;
        const ny = ty + ddy;
        if (inside(nx, ny)) continue;
        if (!map.inBounds(nx, ny)) continue;
        if (transportCategory(map.getBuilt(nx, ny)) === 1) return true;
      }
    }
  }
  return false;
}

/**
 * Bidirectional consistency check between the map's built/parcel layers and the
 * ParcelStore. Returns human-readable violations (empty array = consistent).
 *
 * Forward:  a building-kind tile must carry a parcel id whose store entry has
 *           the matching kind and a footprint that covers this tile.
 * Reverse:  a non-zero parcel id must sit on a building-kind tile whose store
 *           entry matches kind and covers this tile.
 *
 * So a stray parcel id over a road/empty tile, a building tile with no parcel,
 * a kind mismatch, or a tile outside its parcel's footprint are all caught
 * (plan-review yield point 3). Exported for reuse by stage tests.
 */
export function checkParcelAgreement(map: GameMap, store: ParcelStore): string[] {
  const violations: string[] = [];
  const { width, height } = map;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = map.idx(x, y);
      const b = map.built[i]!;
      const p = map.parcel[i]!;
      const isBld = isBuildingKind(b);
      if (isBld && p === 0) {
        violations.push(`(${x},${y}): building kind ${b} has no parcel id`);
        continue;
      }
      if (!isBld && p !== 0) {
        violations.push(`(${x},${y}): parcel id ${p} over non-building kind ${b}`);
        continue;
      }
      if (p !== 0) {
        const idx = p - 1;
        if (idx < 0 || idx >= store.count()) {
          violations.push(`(${x},${y}): parcel id ${p} out of store range`);
          continue;
        }
        if (!store.isAlive(idx)) {
          violations.push(`(${x},${y}): parcel id ${p} refers to demolished parcel ${idx}`);
          continue;
        }
        const e = store.get(idx);
        if (e.kind !== b) {
          violations.push(`(${x},${y}): tile kind ${b} != store kind ${e.kind} for parcel ${idx}`);
        }
        const inside = x >= e.x && x < e.x + e.width && y >= e.y && y < e.y + e.height;
        if (!inside) {
          violations.push(`(${x},${y}): outside footprint of parcel ${idx}`);
        }
      }
    }
  }
  return violations;
}
