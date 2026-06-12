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
//   0       None (empty tile)
//   1..15   transport (roads 1..3, rail 4; 5..15 reserved for transit kinds)
//   16..47  Moses-era buildings
//   48+     reserved for tech-tree-era kinds (parklets, co-ops, communes...)

import { GameMap, Water, FNV_OFFSET, FNV_PRIME, fnv1aBytes } from './map';

export const BuiltKind = {
  None: 0,
  // transport 1..15
  RoadStreet: 1,
  RoadAvenue: 2,
  RoadHighway: 3,
  Rail: 4,
  // Moses-era buildings 16..47
  HouseSingle: 16,
  Apartments: 17,
  Projects: 18,
  CommercialStrip: 19,
  Offices: 20,
  Industrial: 21,
  ParkingLot: 22,
  Civic: 23,
  // 48+ reserved for tech-tree-era kinds (parklets, co-ops, communes...)
} as const;
export type BuiltKind = (typeof BuiltKind)[keyof typeof BuiltKind];

/** Roads (street/avenue/highway). Rail is transport but not a road. */
export const isRoadKind = (k: number): boolean => k >= 1 && k <= 3;
/** Any transport kind: roads or rail. */
export const isTransportKind = (k: number): boolean => k >= 1 && k <= 4;
/** Any building kind, including reserved-but-unused codes in 24..47. */
export const isBuildingKind = (k: number): boolean => k >= 16 && k <= 47;

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

  /** Append a parcel; returns its index. */
  add(p: ParcelInit): number {
    const i = this.anchorX.length;
    this.anchorX.push(p.x);
    this.anchorY.push(p.y);
    this.w.push(p.width);
    this.h.push(p.height);
    this.kind.push(p.kind);
    this.density.push(p.density ?? DENSITY_DEFAULT);
    this.condition.push(p.condition ?? CONDITION_DEFAULT);
    return i;
  }

  count(): number {
    return this.anchorX.length;
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
   * Stable byte encoding of every parcel field, in index order. Equal content
   * yields equal bytes; any field change in any parcel changes them. Folded
   * into {@link hashWorld} so parcel attributes (which live outside the map)
   * participate in determinism assertions. Fixed 10-byte little-endian record
   * per parcel: anchorX(u16) anchorY(u16) w(u8) h(u8) kind(u8) density(u16)
   * condition(u8).
   */
  snapshotBytes(): Uint8Array {
    const n = this.count();
    const bytes = new Uint8Array(n * 10);
    const view = new DataView(bytes.buffer);
    for (let i = 0; i < n; i++) {
      const o = i * 10;
      view.setUint16(o, this.anchorX[i]! & 0xffff, true);
      view.setUint16(o + 2, this.anchorY[i]! & 0xffff, true);
      view.setUint8(o + 4, this.w[i]! & 0xff);
      view.setUint8(o + 5, this.h[i]! & 0xff);
      view.setUint8(o + 6, this.kind[i]! & 0xff);
      view.setUint16(o + 7, Math.floor(this.density[i]!) & 0xffff, true);
      view.setUint8(o + 9, this.condition[i]! & 0xff);
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
const MAX_FOOTPRINT = 3;

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
 */
export function canPlaceTransport(map: GameMap, x: number, y: number, kind: number): boolean {
  if (!isTransportKind(kind)) return false;
  if (!map.inBounds(x, y)) return false;
  const i = map.idx(x, y);
  if (map.water[i] !== Water.None) return false;
  const existing = map.built[i]!;
  if (existing === 0) return true;
  if (isRoadKind(kind) && isRoadKind(existing)) return true; // road/road junction
  if (kind === BuiltKind.Rail && existing === BuiltKind.Rail) return true; // rail/rail
  return false; // building tile, or road<->rail crossing
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
