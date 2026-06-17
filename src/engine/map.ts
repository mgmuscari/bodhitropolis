// Layered tile map model.
//
// Each map layer is a flat typed array of width*height cells in row-major
// order (idx = y*width + x). Typed arrays keep the whole map cache-friendly
// and give us byte-level snapshots for cheap determinism assertions. This
// module is pure: no DOM access.
//
// Enums are `as const` objects + literal-union types rather than `const enum`:
// esbuild (Vite's transpiler) does not erase cross-module const enums, which
// silently breaks them in production builds (plan review yield point 5).

export const Water = { None: 0, River: 1, Lake: 2, Ocean: 3 } as const;
export type Water = (typeof Water)[keyof typeof Water];

export const LandCover = { Bare: 0, Meadow: 1, Grass: 2, Forest: 3 } as const;
export type LandCover = (typeof LandCover)[keyof typeof LandCover];

// FNV-1a constants and folding step, exported so other engine modules
// (e.g. fabric.hashWorld) hash with the exact same primitive.
export const FNV_OFFSET = 0x811c9dc5;
export const FNV_PRIME = 0x01000193;

export function fnv1aBytes(h: number, bytes: Uint8Array): number {
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i]!;
    h = Math.imul(h, FNV_PRIME);
  }
  return h >>> 0;
}

function bytesOf(arr: ArrayBufferView): Uint8Array {
  return new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
}

export class GameMap {
  readonly width: number;
  readonly height: number;

  /** Terrain height, normalized to [0, 1]. */
  readonly elevation: Float32Array;
  /** Water classification per cell (see {@link Water}). */
  readonly water: Uint8Array;
  /** Moisture, normalized to [0, 1]. */
  readonly moisture: Float32Array;
  /** Surface land cover (see {@link LandCover}). */
  readonly landCover: Uint8Array;
  /** Built structures per cell (see BuiltKind in fabric.ts); 0 = empty. */
  readonly built: Uint16Array;
  /** Owning parcel per cell: 0 = none, else parcelIndex + 1 (see ParcelStore). */
  readonly parcel: Uint16Array;
  /** Soil health per cell, 0..255 (ecology layer; see src/ecology). */
  readonly soilHealth: Uint8Array;
  /** Flora vitality per cell, 0..255 (ecology layer; see src/ecology). */
  readonly floraVitality: Uint8Array;
  /** Fauna presence per cell, 0..255 (ecology layer; see src/ecology). */
  readonly faunaPresence: Uint8Array;
  /** Traffic density per cell, 0..255 (traffic layer; see src/traffic). Laid by
   *  origin→destination trips, decays each traffic cycle. */
  readonly traffic: Uint8Array;
  /**
   * Redline grade per cell, 0..255 (0 = greenlined/best .. 255 = redlined/worst).
   * The discriminatory social geography drawn at worldgen (see src/worldgen/redline)
   * that every Moses-era burden keys off — dirty power, industry, decay, highways
   * are SITED by this grade so the damage reads as produced by policy, not nature.
   * A permanent historical record: hashed (folded into snapshot below), never live.
   * "Redlining" is named here CRITICALLY, scoped to the oppressive-planning history.
   */
  readonly redline: Uint8Array;

  constructor(width = 128, height = 128) {
    if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
      throw new RangeError(`GameMap dimensions must be positive integers, got ${width}x${height}`);
    }
    this.width = width;
    this.height = height;
    const n = width * height;
    this.elevation = new Float32Array(n);
    this.water = new Uint8Array(n);
    this.moisture = new Float32Array(n);
    this.landCover = new Uint8Array(n);
    this.built = new Uint16Array(n);
    this.parcel = new Uint16Array(n);
    this.soilHealth = new Uint8Array(n);
    this.floraVitality = new Uint8Array(n);
    this.faunaPresence = new Uint8Array(n);
    this.traffic = new Uint8Array(n);
    this.redline = new Uint8Array(n);
  }

  idx(x: number, y: number): number {
    return y * this.width + x;
  }

  inBounds(x: number, y: number): boolean {
    return x >= 0 && x < this.width && y >= 0 && y < this.height;
  }

  getElevation(x: number, y: number): number {
    return this.elevation[this.idx(x, y)]!;
  }
  setElevation(x: number, y: number, v: number): void {
    this.elevation[this.idx(x, y)] = v;
  }

  getMoisture(x: number, y: number): number {
    return this.moisture[this.idx(x, y)]!;
  }
  setMoisture(x: number, y: number, v: number): void {
    this.moisture[this.idx(x, y)] = v;
  }

  getWater(x: number, y: number): Water {
    return this.water[this.idx(x, y)] as Water;
  }
  setWater(x: number, y: number, v: Water): void {
    this.water[this.idx(x, y)] = v;
  }

  getLandCover(x: number, y: number): LandCover {
    return this.landCover[this.idx(x, y)] as LandCover;
  }
  setLandCover(x: number, y: number, v: LandCover): void {
    this.landCover[this.idx(x, y)] = v;
  }

  getBuilt(x: number, y: number): number {
    return this.built[this.idx(x, y)]!;
  }
  setBuilt(x: number, y: number, v: number): void {
    this.built[this.idx(x, y)] = v;
  }

  getParcel(x: number, y: number): number {
    return this.parcel[this.idx(x, y)]!;
  }
  setParcel(x: number, y: number, v: number): void {
    this.parcel[this.idx(x, y)] = v;
  }

  getSoilHealth(x: number, y: number): number {
    return this.soilHealth[this.idx(x, y)]!;
  }
  setSoilHealth(x: number, y: number, v: number): void {
    this.soilHealth[this.idx(x, y)] = v;
  }

  getFloraVitality(x: number, y: number): number {
    return this.floraVitality[this.idx(x, y)]!;
  }
  setFloraVitality(x: number, y: number, v: number): void {
    this.floraVitality[this.idx(x, y)] = v;
  }

  getFaunaPresence(x: number, y: number): number {
    return this.faunaPresence[this.idx(x, y)]!;
  }
  setFaunaPresence(x: number, y: number, v: number): void {
    this.faunaPresence[this.idx(x, y)] = v;
  }

  getRedline(x: number, y: number): number {
    return this.redline[this.idx(x, y)]!;
  }
  setRedline(x: number, y: number, v: number): void {
    this.redline[this.idx(x, y)] = v;
  }

  /**
   * Stable serialization of every layer: dimensions plus an FNV-1a hash over
   * the concatenated layer bytes. Equal content yields an equal snapshot;
   * any single-cell change in any layer changes it. Used for byte-identical
   * determinism assertions (same seed -> same world).
   */
  snapshot(): string {
    let h = FNV_OFFSET;
    h = fnv1aBytes(h, bytesOf(this.elevation));
    h = fnv1aBytes(h, bytesOf(this.water));
    h = fnv1aBytes(h, bytesOf(this.moisture));
    h = fnv1aBytes(h, bytesOf(this.landCover));
    h = fnv1aBytes(h, bytesOf(this.built));
    h = fnv1aBytes(h, bytesOf(this.parcel));
    h = fnv1aBytes(h, bytesOf(this.soilHealth));
    h = fnv1aBytes(h, bytesOf(this.floraVitality));
    h = fnv1aBytes(h, bytesOf(this.faunaPresence));
    h = fnv1aBytes(h, bytesOf(this.traffic));
    h = fnv1aBytes(h, bytesOf(this.redline));
    return `${this.width}x${this.height}:${(h >>> 0).toString(16).padStart(8, '0')}`;
  }
}
