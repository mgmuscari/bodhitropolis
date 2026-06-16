// Canvas2D pixel-art renderer v1. A thin DOM shell over the pure engine model:
// it builds a programmatic tile atlas once, then blits only the visible tile
// range with nearest-neighbour scaling for crisp pixels. All view math lives in
// Camera and all map/fabric logic in the engine; this file holds no logic worth
// unit-testing (manual validation), only tile painting and the draw loop.
//
// v1 adds the built layer on top of terrain: autotiled roads/rail (16 mask
// variants each, connection mask from the engine) and footprint- and
// condition-aware building tiles.

import { GameMap, Water, LandCover } from '../engine/map';
import { BuiltKind, isTransportKind, transportMask } from '../engine/fabric';
import type { WorldState } from '../worldgen/pipeline';
import { Camera, BASE_TILE } from './camera';
import { builtRenderKey, renderKeyspace, type FootprintPos } from './renderKey';
import { wideRoadAt, powerPoleAt, poleWireDirs } from './decoration';

/** A previewed tile for the hover/drag overlay: world coords + validity tint. */
export interface PreviewTile {
  x: number;
  y: number;
  valid: boolean;
}

/**
 * An ecology heatmap source: given a tile index, the translucent RGBA tint to lay
 * over it (or null to leave it untinted). The closure reads the LIVE ecology layer
 * (or a precomputed biodiversity field) so it auto-reflects each ecology tick.
 */
export interface OverlaySource {
  tint(i: number): readonly [number, number, number, number] | null;
}

type RGB = readonly [number, number, number];

// Connection-mask bits (must match engine transportMask): N=1, E=2, S=4, W=8.
const N = 1;
const E = 2;
const S = 4;
const W = 8;

// How many tiles a power-line wire segment spans from a pole. Matches the pole
// spacing in decoration.ts so each pole's wire reaches the next pole, reading as a
// continuous line. Purely cosmetic (the placement decision is poleWireDirs').
const POLE_WIRE_REACH = 4;

// Dharmapunk-warm terrain palette: [base, accent] per tile kind. The accent is
// dithered in for subtle texture (deep/shallow water, gold-green meadows).
const PALETTE: Record<string, readonly [RGB, RGB]> = {
  ocean: [[26, 52, 92], [32, 64, 110]],
  lake: [[40, 82, 120], [52, 98, 140]],
  river: [[60, 120, 162], [82, 150, 192]],
  bare: [[198, 178, 132], [212, 194, 152]],
  meadow: [[150, 158, 74], [172, 180, 96]],
  grass: [[82, 132, 62], [98, 152, 74]],
  forest: [[34, 80, 46], [46, 98, 58]],
};

const KINDS = Object.keys(PALETTE);
const BANDS = 4;

// 4x4 Bayer matrix → ordered dither thresholds (0..15).
const BAYER4: ReadonlyArray<ReadonlyArray<number>> = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
];

interface RoadStyle {
  base: RGB;
  accent: RGB;
  line: RGB;
  dashed: boolean;
  double: boolean;
}

// Asphalt darkens and lane markings grow from street → avenue → highway.
// QuietStreet(7) reads as a road (renderKey maps it to road-7-{mask}) but in a
// calmer green-grey with chalk-soft markings — without this entry makeRoadTile(7)
// would deref ROAD_STYLES[7]! (undefined) and throw on a placeable kind.
const ROAD_STYLES: Record<number, RoadStyle> = {
  [BuiltKind.RoadStreet]: { base: [92, 88, 84], accent: [104, 100, 96], line: [150, 146, 128], dashed: true, double: false },
  [BuiltKind.RoadAvenue]: { base: [72, 68, 66], accent: [84, 80, 78], line: [196, 170, 72], dashed: false, double: false },
  [BuiltKind.RoadHighway]: { base: [50, 48, 50], accent: [60, 58, 60], line: [206, 184, 80], dashed: false, double: true },
  [BuiltKind.QuietStreet]: { base: [86, 96, 82], accent: [98, 108, 94], line: [156, 176, 132], dashed: true, double: false },
};

interface RailStyle {
  base: RGB;
  accent: RGB;
  rail: RGB;
  tie: RGB;
}

const RAIL_STYLE: RailStyle = {
  base: [110, 102, 94],
  accent: [124, 116, 108],
  rail: [156, 156, 168],
  tie: [70, 52, 40],
};

// Streetcar shares the rail tile shape on a paved base; elevated rail is a darker,
// cooler structure. Both reuse makeRailTile via their style.
const STREETCAR_STYLE: RailStyle = {
  base: [78, 84, 88],
  accent: [90, 96, 100],
  rail: [172, 174, 182],
  tie: [60, 58, 56],
};
const ELEV_STYLE: RailStyle = {
  base: [56, 58, 72],
  accent: [68, 70, 86],
  rail: [150, 156, 184],
  tie: [42, 42, 58],
};

interface PathStyle {
  base: RGB;
  accent: RGB;
  line: RGB;
}

// Bike paths are protected green lanes; promenades are warm paved pedestrian ways.
const BIKE_STYLE: PathStyle = { base: [46, 92, 70], accent: [56, 108, 82], line: [210, 224, 180] };
const PED_STYLE: PathStyle = { base: [150, 128, 96], accent: [168, 144, 110], line: [206, 190, 150] };

interface BuildingStyle {
  base: RGB;
  accent: RGB;
  roof: RGB;
}

// Warm, distinguishable palette per building kind.
const BUILDING_STYLES: Record<number, BuildingStyle> = {
  [BuiltKind.HouseSingle]: { base: [150, 70, 55], accent: [168, 86, 68], roof: [110, 50, 40] },
  [BuiltKind.Apartments]: { base: [132, 82, 72], accent: [150, 98, 86], roof: [96, 58, 50] },
  [BuiltKind.Projects]: { base: [122, 122, 124], accent: [140, 140, 142], roof: [92, 92, 96] },
  [BuiltKind.CommercialStrip]: { base: [182, 162, 120], accent: [198, 180, 140], roof: [150, 132, 96] },
  [BuiltKind.Offices]: { base: [92, 112, 142], accent: [110, 132, 162], roof: [66, 84, 112] },
  [BuiltKind.Industrial]: { base: [140, 92, 62], accent: [160, 110, 78], roof: [104, 66, 44] },
  [BuiltKind.ParkingLot]: { base: [96, 93, 90], accent: [110, 107, 104], roof: [82, 80, 78] },
  [BuiltKind.Civic]: { base: [190, 176, 142], accent: [206, 192, 158], roof: [152, 138, 108] },
  // Tech-tree-era 48..60 — solarpunk palette: parklet/garden greens, vertical-farm
  // teal, water blues, solar/AI blues, warm commune purples, bazaar/commons sandstone.
  [BuiltKind.Parklet]: { base: [88, 148, 84], accent: [104, 168, 98], roof: [64, 118, 62] },
  [BuiltKind.CommunityGarden]: { base: [104, 150, 72], accent: [122, 170, 86], roof: [78, 120, 54] },
  [BuiltKind.CompostHub]: { base: [110, 84, 56], accent: [128, 100, 68], roof: [84, 62, 40] },
  [BuiltKind.VerticalFarm]: { base: [72, 140, 96], accent: [88, 162, 114], roof: [50, 108, 72] },
  [BuiltKind.WastewaterWorks]: { base: [70, 118, 128], accent: [86, 138, 148], roof: [50, 90, 100] },
  [BuiltKind.EnergyNode]: { base: [74, 108, 160], accent: [92, 130, 184], roof: [52, 80, 128] },
  [BuiltKind.AINode]: { base: [96, 104, 168], accent: [116, 124, 190], roof: [70, 76, 132] },
  [BuiltKind.ADU]: { base: [166, 138, 98], accent: [184, 158, 116], roof: [128, 104, 72] },
  [BuiltKind.CoopHousing]: { base: [150, 118, 150], accent: [170, 138, 170], roof: [114, 86, 116] },
  [BuiltKind.Commune]: { base: [138, 108, 154], accent: [158, 128, 174], roof: [104, 78, 120] },
  [BuiltKind.Bazaar]: { base: [180, 120, 90], accent: [200, 140, 108], roof: [146, 90, 64] },
  [BuiltKind.MakerSpace]: { base: [150, 140, 110], accent: [170, 160, 128], roof: [112, 104, 80] },
  [BuiltKind.HealingCommons]: { base: [196, 176, 150], accent: [212, 194, 168], roof: [158, 138, 116] },
  // Rezoning greens 61..62 — depaved, soil-healing land. Park is a tended,
  // mown-and-pathed green (bright, even); RewildedLand is a wilder, deeper scrub
  // green — both distinct from Parklet's blue-green and CommunityGarden's olive.
  [BuiltKind.Park]: { base: [96, 162, 92], accent: [118, 186, 110], roof: [72, 134, 70] },
  [BuiltKind.RewildedLand]: { base: [58, 116, 64], accent: [78, 140, 80], roof: [40, 88, 48] },
};

// Coverage guards (headless-testable). The atlas iterates renderKeyspace() and
// paintForKey derefs ROAD_STYLES[k]! / BUILDING_STYLES[kind]! — so a future
// renderKey kind with no matching style would throw inside buildAtlas at Renderer
// construction (a crash on load that tsc / npm run build / unit tests all miss,
// since none execute the atlas). Exporting the painted key/kind sets lets a
// headless test assert renderKeyspace ⊆ {paintable}, closing that gap.
export const ROAD_STYLE_KINDS: readonly number[] = Object.keys(ROAD_STYLES).map(Number);
export const BUILDING_STYLE_KINDS: readonly number[] = Object.keys(BUILDING_STYLES).map(Number);
/** The key prefixes paintForKey's switch handles (anything else throws). */
export const PAINTABLE_PREFIXES: readonly string[] = ['road', 'rail', 'streetcar', 'elev', 'bike', 'ped', 'b'];

function clampByte(v: number): number {
  return Math.min(255, Math.max(0, Math.round(v)));
}

function shade(c: RGB, delta: number): RGB {
  return [clampByte(c[0] + delta), clampByte(c[1] + delta), clampByte(c[2] + delta)];
}

// Derelict tint: blend toward grime and darken (the < 128 condition tier).
function weather(c: RGB): RGB {
  const grime: RGB = [74, 78, 64];
  const t = 0.4;
  return [
    clampByte(c[0] * (1 - t) + grime[0] * t - 14),
    clampByte(c[1] * (1 - t) + grime[1] * t - 14),
    clampByte(c[2] * (1 - t) + grime[2] * t - 14),
  ];
}

type SetPixel = (x: number, y: number, rgb: RGB) => void;

/** Paint a BASE_TILE×BASE_TILE canvas via a per-pixel callback. */
function paintTile(paint: (set: SetPixel) => void): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = BASE_TILE;
  c.height = BASE_TILE;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(BASE_TILE, BASE_TILE);
  const set: SetPixel = (x, y, rgb) => {
    if (x < 0 || x >= BASE_TILE || y < 0 || y >= BASE_TILE) return;
    const o = (y * BASE_TILE + x) * 4;
    img.data[o] = rgb[0];
    img.data[o + 1] = rgb[1];
    img.data[o + 2] = rgb[2];
    img.data[o + 3] = 255;
  };
  paint(set);
  ctx.putImageData(img, 0, 0);
  return c;
}

function ditherFill(set: SetPixel, base: RGB, accent: RGB): void {
  for (let py = 0; py < BASE_TILE; py++) {
    for (let px = 0; px < BASE_TILE; px++) {
      const threshold = BAYER4[py % 4]![px % 4]!;
      set(px, py, threshold < 5 ? accent : base); // ~5/16 accent coverage
    }
  }
}

function rectFill(set: SetPixel, x0: number, y0: number, x1: number, y1: number, rgb: RGB): void {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) set(x, y, rgb);
}

function makeTerrainTile(base: RGB, accent: RGB): HTMLCanvasElement {
  return paintTile((set) => ditherFill(set, base, accent));
}

function makeRoadTile(kind: number, mask: number, wide = false): HTMLCanvasElement {
  const style = ROAD_STYLES[kind]!;
  const cols = style.double ? [6, 9] : [7];
  const rows = style.double ? [6, 9] : [7];
  const mark = (set: SetPixel, x: number, y: number): void => {
    if (style.dashed && ((x + y) & 1) !== 0) return; // dashed lane marking for streets
    set(x, y, style.line);
  };
  return paintTile((set) => {
    ditherFill(set, style.base, style.accent);
    if (wide) {
      // Wide-body slab: a continuous asphalt mass for a 2-/3-row corridor. Suppress
      // the per-edge lane markings AND the isolated stub so adjacent wide tiles read
      // as one slab rather than parallel striped roads; lay only a faint center seam
      // toward each connected edge to hint at travel direction (live-pass tunable).
      const seam = shade(style.base, 10);
      if (mask & N) for (let y = 0; y < 8; y++) set(7, y, seam);
      if (mask & S) for (let y = 8; y < BASE_TILE; y++) set(7, y, seam);
      if (mask & E) for (let x = 8; x < BASE_TILE; x++) set(x, 7, seam);
      if (mask & W) for (let x = 0; x < 8; x++) set(x, 7, seam);
      return;
    }
    if (mask & N) for (let y = 0; y < 8; y++) for (const cx of cols) mark(set, cx, y);
    if (mask & S) for (let y = 8; y < BASE_TILE; y++) for (const cx of cols) mark(set, cx, y);
    if (mask & E) for (let x = 8; x < BASE_TILE; x++) for (const cy of rows) mark(set, x, cy);
    if (mask & W) for (let x = 0; x < 8; x++) for (const cy of rows) mark(set, x, cy);
    if (mask === 0) rectFill(set, 7, 7, 8, 8, style.line); // isolated stub
  });
}

function makeRailTile(mask: number, style: RailStyle = RAIL_STYLE): HTMLCanvasElement {
  const vert = (mask & (N | S)) !== 0;
  const horz = (mask & (E | W)) !== 0;
  const railCols = [6, 9];
  const railRows = [6, 9];
  return paintTile((set) => {
    ditherFill(set, style.base, style.accent);
    // Ties first (under the rails), perpendicular to the travel direction.
    if (vert) for (let y = 1; y < BASE_TILE; y += 3) for (let x = 3; x <= 12; x++) set(x, y, style.tie);
    if (horz) for (let x = 1; x < BASE_TILE; x += 3) for (let y = 3; y <= 12; y++) set(x, y, style.tie);
    // Twin rails toward each connected edge.
    if (mask & N) for (let y = 0; y < 8; y++) for (const c of railCols) set(c, y, style.rail);
    if (mask & S) for (let y = 8; y < BASE_TILE; y++) for (const c of railCols) set(c, y, style.rail);
    if (mask & E) for (let x = 8; x < BASE_TILE; x++) for (const r of railRows) set(x, r, style.rail);
    if (mask & W) for (let x = 0; x < 8; x++) for (const r of railRows) set(x, r, style.rail);
    if (mask === 0) for (const c of railCols) for (let y = 6; y < 10; y++) set(c, y, style.rail);
  });
}

// Bike paths / promenades: a soft center stripe toward each connected edge over a
// dithered base (no ties, no double lines — these are gentle, low-speed ways).
function makePathTile(style: PathStyle, mask: number): HTMLCanvasElement {
  const cols = [7, 8];
  const rows = [7, 8];
  return paintTile((set) => {
    ditherFill(set, style.base, style.accent);
    if (mask & N) for (let y = 0; y < 8; y++) for (const cx of cols) set(cx, y, style.line);
    if (mask & S) for (let y = 8; y < BASE_TILE; y++) for (const cx of cols) set(cx, y, style.line);
    if (mask & E) for (let x = 8; x < BASE_TILE; x++) for (const cy of rows) set(x, cy, style.line);
    if (mask & W) for (let x = 0; x < 8; x++) for (const cy of rows) set(x, cy, style.line);
    if (mask === 0) rectFill(set, 6, 6, 9, 9, style.line);
  });
}

function makeBuildingTile(kind: number, pos: string, tier: number): HTMLCanvasElement {
  const style = BUILDING_STYLES[kind]!;
  const base = tier === 1 ? weather(style.base) : style.base;
  const accent = tier === 1 ? weather(style.accent) : style.accent;
  const roof = tier === 1 ? weather(style.roof) : style.roof;
  return paintTile((set) => {
    ditherFill(set, base, accent);
    // Darker outline gives each tile block definition at any zoom.
    const edge = shade(base, -34);
    for (let i = 0; i < BASE_TILE; i++) {
      set(i, 0, edge);
      set(i, BASE_TILE - 1, edge);
      set(0, i, edge);
      set(BASE_TILE - 1, i, edge);
    }
    // Roof inset varies by footprint position: center tiles get a full roof
    // highlight, edge tiles a bar, corners stay the plain outer block.
    if (pos === 'c') rectFill(set, 4, 4, 11, 11, roof);
    else if (pos === 'e') rectFill(set, 4, 4, 11, 7, roof);
    // Kind-specific marks.
    if (kind === BuiltKind.ParkingLot) {
      for (let y = 3; y < BASE_TILE - 2; y++) {
        set(5, y, edge);
        set(10, y, edge);
      }
    } else if (kind === BuiltKind.CommercialStrip) {
      rectFill(set, 2, 2, BASE_TILE - 3, 4, shade(style.accent, 30)); // sign stripe
    }
  });
}

// Paint the one tile a built-layer render key names. The key grammar is owned by
// renderKey.ts (the single source of truth iterated below); this dispatch parses
// each key back to the right tile maker. Every key renderKeyspace() emits must be
// handled here, or a placeable kind would render as a blank tile.
function paintForKey(key: string): HTMLCanvasElement {
  const parts = key.split('-');
  switch (parts[0]) {
    case 'b':
      return makeBuildingTile(Number(parts[1]), parts[2]!, Number(parts[3]));
    case 'road':
      // parts[3] === 'w' is the wide-slab variant; key off the value, never the
      // length (b-… building keys also split to length 4).
      return makeRoadTile(Number(parts[1]), Number(parts[2]), parts[3] === 'w');
    case 'rail':
      return makeRailTile(Number(parts[1]));
    case 'streetcar':
      return makeRailTile(Number(parts[1]), STREETCAR_STYLE);
    case 'elev':
      return makeRailTile(Number(parts[1]), ELEV_STYLE);
    case 'bike':
      return makePathTile(BIKE_STYLE, Number(parts[1]));
    case 'ped':
      return makePathTile(PED_STYLE, Number(parts[1]));
    default:
      throw new Error(`unknown render key '${key}'`);
  }
}

function buildAtlas(): Map<string, HTMLCanvasElement> {
  const atlas = new Map<string, HTMLCanvasElement>();

  // Terrain: kind × elevation band. (Terrain is not part of renderKeyspace — that
  // enumerates only the built layer.)
  for (const kind of KINDS) {
    const [base, accent] = PALETTE[kind]!;
    for (let band = 0; band < BANDS; band++) {
      const delta = (band - 1) * 7; // higher band → slightly brighter
      atlas.set(`${kind}-${band}`, makeTerrainTile(shade(base, delta), shade(accent, delta)));
    }
  }

  // Built layer: iterate the canonical keyspace so the painted set and the
  // requested set (builtRenderKey) have one source of truth.
  for (const key of renderKeyspace()) atlas.set(key, paintForKey(key));

  return atlas;
}

function kindOf(map: GameMap, i: number): string {
  switch (map.water[i]) {
    case Water.Ocean:
      return 'ocean';
    case Water.Lake:
      return 'lake';
    case Water.River:
      return 'river';
  }
  switch (map.landCover[i]) {
    case LandCover.Forest:
      return 'forest';
    case LandCover.Grass:
      return 'grass';
    case LandCover.Meadow:
      return 'meadow';
    default:
      return 'bare';
  }
}

function bandOf(elevation: number): number {
  return Math.min(BANDS - 1, Math.max(0, Math.floor(elevation * BANDS)));
}

/**
 * Footprint position of tile (x, y) within its parcel, derived from the map's
 * parcel layer alone (no ParcelStore object churn): a 4-neighbour with a
 * different parcel id is a footprint border. 0 borders = center ('c'), 1 = edge
 * ('e'), 2+ = corner ('k').
 */
function footprintPos(map: GameMap, x: number, y: number, pid: number): FootprintPos {
  const sameParcel = (nx: number, ny: number): boolean =>
    map.inBounds(nx, ny) && map.parcel[map.idx(nx, ny)] === pid;
  let borders = 0;
  if (!sameParcel(x - 1, y)) borders++;
  if (!sameParcel(x + 1, y)) borders++;
  if (!sameParcel(x, y - 1)) borders++;
  if (!sameParcel(x, y + 1)) borders++;
  return borders === 0 ? 'c' : borders === 1 ? 'e' : 'k';
}

export class Renderer {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly atlas: Map<string, HTMLCanvasElement>;
  private dpr = 1;
  private cssWidth = 0;
  private cssHeight = 0;
  private preview: readonly PreviewTile[] | null = null;
  private overlay: OverlaySource | null = null;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
    this.atlas = buildAtlas();
  }

  /** Set (or clear) the hover/drag preview tiles drawn as translucent tints. */
  setPreview(tiles: readonly PreviewTile[] | null): void {
    this.preview = tiles;
  }

  /** Set (or clear) the ecology heatmap overlay drawn under the preview. */
  setOverlay(source: OverlaySource | null): void {
    this.overlay = source;
  }

  resize(cssWidth: number, cssHeight: number, dpr: number): void {
    this.dpr = dpr;
    this.cssWidth = cssWidth;
    this.cssHeight = cssHeight;
    this.canvas.width = Math.round(cssWidth * dpr);
    this.canvas.height = Math.round(cssHeight * dpr);
    this.canvas.style.width = `${cssWidth}px`;
    this.canvas.style.height = `${cssHeight}px`;
  }

  render(world: WorldState, camera: Camera): void {
    const { map, parcels } = world;
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#14121f';
    ctx.fillRect(0, 0, this.cssWidth, this.cssHeight);

    const ts = camera.tileSize;
    const range = camera.visibleTileRange();
    for (let ty = range.y0; ty <= range.y1; ty++) {
      for (let tx = range.x0; tx <= range.x1; tx++) {
        const i = map.idx(tx, ty);
        const { sx, sy } = camera.worldToScreen(tx, ty);
        const dx = Math.floor(sx);
        const dy = Math.floor(sy);

        const terrain = this.atlas.get(`${kindOf(map, i)}-${bandOf(map.elevation[i]!)}`)!;
        ctx.drawImage(terrain, 0, 0, BASE_TILE, BASE_TILE, dx, dy, ts, ts);

        const built = map.built[i]!;
        if (built !== 0) {
          // The kind-dispatch is a single pure call (renderKey.ts); transport keys
          // on the connection mask, buildings on footprint position + condition tier.
          const isT = isTransportKind(built);
          const mask = isT ? transportMask(map, tx, ty) : 0;
          const pid = isT ? 0 : map.parcel[i]!;
          const tier = isT ? 0 : parcels.conditionAt(pid - 1) < 128 ? 1 : 0;
          const pos: FootprintPos = isT ? 'c' : footprintPos(map, tx, ty, pid);
          // wideRoadAt is predicate-guarded (false for any non-road tile), so this
          // only ever flips the slab variant on for a 2-/3-row road corridor.
          const wide = wideRoadAt(map, tx, ty);
          const builtTile = this.atlas.get(builtRenderKey(built, mask, pos, tier, wide));
          if (builtTile) ctx.drawImage(builtTile, 0, 0, BASE_TILE, BASE_TILE, dx, dy, ts, ts);

          // Power-line decoration: pure-visual ctx drawing (no atlas key). Every
          // DECISION is owned by decoration.ts — powerPoleAt picks the pole tiles,
          // poleWireDirs picks the wire offsets. The shell only draws the mast and a
          // segment toward each returned offset; it holds no branching of its own.
          if (powerPoleAt(map, tx, ty)) {
            const cx = dx + ts * 0.5;
            const cy = dy + ts * 0.5;
            const mast = Math.max(1, ts * 0.16);
            ctx.fillStyle = '#241f2b';
            ctx.fillRect(cx - mast / 2, cy - mast / 2, mast, mast);
            ctx.strokeStyle = 'rgba(26, 22, 32, 0.85)';
            ctx.lineWidth = Math.max(1, ts * 0.05);
            for (const [ox, oy] of poleWireDirs(map, tx, ty)) {
              ctx.beginPath();
              ctx.moveTo(cx, cy);
              ctx.lineTo(cx + ox * ts * POLE_WIRE_REACH, cy + oy * ts * POLE_WIRE_REACH);
              ctx.stroke();
            }
          }
        }

        // Ecology heatmap: a translucent tint over every visible tile (built or
        // not), drawn under the preview so the preview still reads on top.
        if (this.overlay) {
          const t = this.overlay.tint(i);
          if (t) {
            ctx.fillStyle = `rgba(${t[0]}, ${t[1]}, ${t[2]}, ${t[3]})`;
            ctx.fillRect(dx, dy, ts, ts);
          }
        }
      }
    }

    // Preview overlay: translucent green (valid) / red (invalid) tints over the
    // targeted tile(s), drawn after the built pass so they read on top.
    if (this.preview) {
      for (const t of this.preview) {
        const { sx, sy } = camera.worldToScreen(t.x, t.y);
        ctx.fillStyle = t.valid ? 'rgba(96, 200, 128, 0.40)' : 'rgba(220, 86, 86, 0.40)';
        ctx.fillRect(Math.floor(sx), Math.floor(sy), ts, ts);
      }
    }
  }
}
