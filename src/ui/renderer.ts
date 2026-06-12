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

type RGB = readonly [number, number, number];

// Connection-mask bits (must match engine transportMask): N=1, E=2, S=4, W=8.
const N = 1;
const E = 2;
const S = 4;
const W = 8;

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
const ROAD_STYLES: Record<number, RoadStyle> = {
  [BuiltKind.RoadStreet]: { base: [92, 88, 84], accent: [104, 100, 96], line: [150, 146, 128], dashed: true, double: false },
  [BuiltKind.RoadAvenue]: { base: [72, 68, 66], accent: [84, 80, 78], line: [196, 170, 72], dashed: false, double: false },
  [BuiltKind.RoadHighway]: { base: [50, 48, 50], accent: [60, 58, 60], line: [206, 184, 80], dashed: false, double: true },
};

const RAIL_STYLE = {
  base: [110, 102, 94] as RGB,
  accent: [124, 116, 108] as RGB,
  rail: [156, 156, 168] as RGB,
  tie: [70, 52, 40] as RGB,
};

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
};

const BUILDING_KINDS: ReadonlyArray<number> = Object.keys(BUILDING_STYLES).map(Number);

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

function makeRoadTile(kind: number, mask: number): HTMLCanvasElement {
  const style = ROAD_STYLES[kind]!;
  const cols = style.double ? [6, 9] : [7];
  const rows = style.double ? [6, 9] : [7];
  const mark = (set: SetPixel, x: number, y: number): void => {
    if (style.dashed && ((x + y) & 1) !== 0) return; // dashed lane marking for streets
    set(x, y, style.line);
  };
  return paintTile((set) => {
    ditherFill(set, style.base, style.accent);
    if (mask & N) for (let y = 0; y < 8; y++) for (const cx of cols) mark(set, cx, y);
    if (mask & S) for (let y = 8; y < BASE_TILE; y++) for (const cx of cols) mark(set, cx, y);
    if (mask & E) for (let x = 8; x < BASE_TILE; x++) for (const cy of rows) mark(set, x, cy);
    if (mask & W) for (let x = 0; x < 8; x++) for (const cy of rows) mark(set, x, cy);
    if (mask === 0) rectFill(set, 7, 7, 8, 8, style.line); // isolated stub
  });
}

function makeRailTile(mask: number): HTMLCanvasElement {
  const vert = (mask & (N | S)) !== 0;
  const horz = (mask & (E | W)) !== 0;
  const railCols = [6, 9];
  const railRows = [6, 9];
  return paintTile((set) => {
    ditherFill(set, RAIL_STYLE.base, RAIL_STYLE.accent);
    // Ties first (under the rails), perpendicular to the travel direction.
    if (vert) for (let y = 1; y < BASE_TILE; y += 3) for (let x = 3; x <= 12; x++) set(x, y, RAIL_STYLE.tie);
    if (horz) for (let x = 1; x < BASE_TILE; x += 3) for (let y = 3; y <= 12; y++) set(x, y, RAIL_STYLE.tie);
    // Twin rails toward each connected edge.
    if (mask & N) for (let y = 0; y < 8; y++) for (const c of railCols) set(c, y, RAIL_STYLE.rail);
    if (mask & S) for (let y = 8; y < BASE_TILE; y++) for (const c of railCols) set(c, y, RAIL_STYLE.rail);
    if (mask & E) for (let x = 8; x < BASE_TILE; x++) for (const r of railRows) set(x, r, RAIL_STYLE.rail);
    if (mask & W) for (let x = 0; x < 8; x++) for (const r of railRows) set(x, r, RAIL_STYLE.rail);
    if (mask === 0) for (const c of railCols) for (let y = 6; y < 10; y++) set(c, y, RAIL_STYLE.rail);
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

function buildAtlas(): Map<string, HTMLCanvasElement> {
  const atlas = new Map<string, HTMLCanvasElement>();

  // Terrain: kind × elevation band.
  for (const kind of KINDS) {
    const [base, accent] = PALETTE[kind]!;
    for (let band = 0; band < BANDS; band++) {
      const delta = (band - 1) * 7; // higher band → slightly brighter
      atlas.set(`${kind}-${band}`, makeTerrainTile(shade(base, delta), shade(accent, delta)));
    }
  }

  // Roads: street/avenue/highway × 16 connection masks.
  for (const kind of [BuiltKind.RoadStreet, BuiltKind.RoadAvenue, BuiltKind.RoadHighway]) {
    for (let mask = 0; mask < 16; mask++) atlas.set(`road-${kind}-${mask}`, makeRoadTile(kind, mask));
  }
  // Rail: 16 connection masks.
  for (let mask = 0; mask < 16; mask++) atlas.set(`rail-${mask}`, makeRailTile(mask));

  // Buildings: kind × footprint position (corner/edge/center) × condition tier.
  for (const kind of BUILDING_KINDS) {
    for (const pos of ['c', 'e', 'k']) {
      for (let tier = 0; tier < 2; tier++) atlas.set(`b-${kind}-${pos}-${tier}`, makeBuildingTile(kind, pos, tier));
    }
  }

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
function footprintPos(map: GameMap, x: number, y: number, pid: number): string {
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

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
    this.atlas = buildAtlas();
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
        if (built === 0) continue;

        let key: string;
        if (isTransportKind(built)) {
          const mask = transportMask(map, tx, ty);
          key = built === BuiltKind.Rail ? `rail-${mask}` : `road-${built}-${mask}`;
        } else {
          const pid = map.parcel[i]!;
          const tier = parcels.conditionAt(pid - 1) < 128 ? 1 : 0;
          key = `b-${built}-${footprintPos(map, tx, ty, pid)}-${tier}`;
        }
        const overlay = this.atlas.get(key);
        if (overlay) ctx.drawImage(overlay, 0, 0, BASE_TILE, BASE_TILE, dx, dy, ts, ts);
      }
    }
  }
}
