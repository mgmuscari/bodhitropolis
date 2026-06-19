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
import { BuiltKind, isTransportKind, transportMask, isRoadKind, deckMask, roadDividerMask, roadCurbMask, rampMarkingMask, freewayMedianAxis } from '../engine/fabric';
import type { WorldState } from '../worldgen/pipeline';
import { Camera, BASE_TILE } from './camera';
import {
  builtRenderKey,
  footprintCellKey,
  renderKeyspace,
  variantKey,
  surfaceVariantIndex,
  type FootprintPos,
} from './renderKey';
import { surfaceKey } from './tileset';
import { wideRoadAt, powerPoleAt, poleWireDirs } from './decoration';
import { parcelGlyph } from './glyphContent';
import { isPowerConsumer } from '../growth/power';
import { laneOffset, pedCurbOffset } from './ambientContent';
import type { AmbientState } from './ambientContent';
import { OVERLAY_DIM } from './overlayLegend';

/** Precomputed CSS for the sparse-overlay scrim (see OverlaySource.dimBase). */
const OVERLAY_DIM_CSS = `rgba(${OVERLAY_DIM[0]}, ${OVERLAY_DIM[1]}, ${OVERLAY_DIM[2]}, ${OVERLAY_DIM[3]})`;
import { policeViolenceTint } from './policeViolenceOverlayContent';
import { TravelMode } from '../citizens/modes';

/** Citizen sprite colour by travel mode (walk/bike/streetcar/elevated-rail/drive) — so the modal
 *  shift the player engineers is visible: warm walkers, yellow cyclists, cyan tram + violet rail
 *  riders, car-red drivers. Indexed by TravelMode. */
const MODE_COLORS: readonly string[] = ['#efe6d2', '#ffd24a', '#5ad1e0', '#b48cff', '#c44e3d'];

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
  /** When true, every tile the tint leaves un-highlighted (null) is dimmed with OVERLAY_DIM, so a
   *  SPARSE overlay's few strong highlights pop against a darkened map instead of washing out. */
  dimBase?: boolean;
}

type RGB = readonly [number, number, number];

// Connection-mask bits (must match engine transportMask): N=1, E=2, S=4, W=8.
const N = 1;
const E = 2;
const S = 4;
const W = 8;

// Muted-but-distinct paints for parked cars, so rows of cars read against the dark
// parking pavement. Picked deterministically per (lot, stall) — no rng.
const CAR_COLORS = ['#a8483c', '#3f6e86', '#cfc8b4', '#5a7d4e', '#9a8466', '#46424e'] as const;

// How many tiles a power-line wire segment spans from a pole. Matches the pole
// spacing in decoration.ts so each pole's wire reaches the next pole, reading as a
// continuous line. Purely cosmetic (the placement decision is poleWireDirs').
const POLE_WIRE_REACH = 4;

// Below this on-screen tile size (px) the SNES-style parcel glyphs (R1/C2/I/civic)
// are skipped — they would be an unreadable smear when zoomed out. Above it, one
// glyph is stamped per footprint, centered, with a dark halo for contrast.
const GLYPH_MIN_TS = 16;

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
  [BuiltKind.RoadRamp]: { base: [78, 74, 70], accent: [120, 112, 96], line: [210, 190, 96], dashed: true, double: false }, // an on/off ramp: a street-toned deck across the freeway
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
  // Police precinct — stark institutional blue-grey (the apparatus of control), set
  // apart from the warm Civic palette so it never reads as a community amenity.
  [BuiltKind.Precinct]: { base: [60, 70, 92], accent: [78, 90, 116], roof: [44, 52, 70] },
  // Fire station — a civic service: warm brick-red with a bright bay, distinct from the cold precinct.
  [BuiltKind.FireStation]: { base: [150, 60, 50], accent: [196, 84, 70], roof: [110, 44, 38] },
  // Civic services — clinic (clinical white/teal), library (warm brick/wood), school (schoolhouse tan).
  [BuiltKind.Clinic]: { base: [196, 210, 212], accent: [232, 242, 244], roof: [150, 176, 184] },
  [BuiltKind.Library]: { base: [122, 92, 62], accent: [154, 118, 80], roof: [92, 68, 46] },
  [BuiltKind.School]: { base: [182, 142, 72], accent: [214, 172, 94], roof: [140, 106, 52] },
  // Power plants 24..30 — dirty centralized tier reads smoky/industrial (coal soot,
  // gas steel, hydro concrete, nuclear cooling-tower grey); the renewables read
  // bright (wind white, solar gold, fusion electric-cyan) — the clean transition is
  // visible at a glance.
  [BuiltKind.CoalPlant]: { base: [74, 70, 66], accent: [96, 90, 84], roof: [52, 48, 46] },
  [BuiltKind.GasPlant]: { base: [110, 100, 96], accent: [132, 120, 114], roof: [82, 74, 70] },
  [BuiltKind.HydroPlant]: { base: [120, 132, 140], accent: [142, 156, 164], roof: [92, 104, 112] },
  [BuiltKind.NuclearPlant]: { base: [150, 156, 150], accent: [176, 182, 174], roof: [116, 122, 118] },
  [BuiltKind.WindTurbine]: { base: [210, 214, 218], accent: [232, 236, 240], roof: [180, 186, 192] },
  [BuiltKind.SolarPlant]: { base: [196, 168, 70], accent: [220, 192, 92], roof: [158, 132, 50] },
  [BuiltKind.FusionPlant]: { base: [86, 168, 188], accent: [108, 196, 214], roof: [58, 130, 150] },
  // Tech-tree-era 48..60 — solarpunk palette: parklet/garden greens, vertical-farm
  // teal, water blues, solar/AI blues, warm commune purples, bazaar/commons sandstone.
  [BuiltKind.Parklet]: { base: [88, 148, 84], accent: [104, 168, 98], roof: [64, 118, 62] },
  // The road-diet planted median: a narrow strip of deep, even green between the carriageways.
  [BuiltKind.PlantedMedian]: { base: [70, 130, 72], accent: [92, 158, 90], roof: [52, 104, 58] },
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

// Paint over a SUPPLIED base image (a tileset surface texture, e.g. asphalt): blit it into a
// BASE_TILE canvas, then run the per-pixel `paint` callback (lane markings) on top. The procedural
// twin is paintTile (which starts from a dithered/empty base). imageSmoothing off keeps a normalized
// source crisp. Used so a single tileable road texture skins all 16 autotile mask variants.
function paintTileOver(base: AtlasImage, paint: (set: SetPixel) => void): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = BASE_TILE;
  c.height = BASE_TILE;
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(base, 0, 0, BASE_TILE, BASE_TILE);
  const img = ctx.getImageData(0, 0, BASE_TILE, BASE_TILE);
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

// The connection-mask lane markings for a road tile, drawn OVER whatever base is already laid
// (procedural dither or a tileset asphalt surface). Extracted so both bases share one marking pass.
function paintRoadMarkings(set: SetPixel, kind: number, mask: number, wide: boolean): void {
  const style = ROAD_STYLES[kind]!;
  const cols = style.double ? [6, 9] : [7];
  const rows = style.double ? [6, 9] : [7];
  const mark = (s: SetPixel, x: number, y: number): void => {
    if (style.dashed && ((x + y) & 1) !== 0) return; // dashed lane marking for streets
    s(x, y, style.line);
  };
  if (wide) {
    // Wide-body slab: a continuous asphalt mass for a 2-/3-row corridor — NO markings at all.
    // (Previously a faint center seam was drawn toward each connected edge to hint travel
    // direction, but on a long wide corridor every tile connects on all four sides, so the
    // per-tile `+` tiled into a visible grid across the slab — Maddy, 2026-06-19. A clean slab
    // is the intent anyway; per-corridor lane lines would need the corridor axis, a future pass.)
    return;
  }
  // Junction (3+ connected edges): clear the intersection — draw NO centre markings through it, so a
  // 4-way doesn't become a + cross and a street grid doesn't tile into a grid of crosses (Maddy
  // 2026-06-19). Real lane lines stop at the box. Straight (2 opposite) and turns (2 adjacent) keep
  // their line; dead-ends/isolated stubs keep theirs.
  const conns = (mask & 1) + ((mask >> 1) & 1) + ((mask >> 2) & 1) + ((mask >> 3) & 1);
  if (conns >= 3) return;
  if (mask & N) for (let y = 0; y < 8; y++) for (const cx of cols) mark(set, cx, y);
  if (mask & S) for (let y = 8; y < BASE_TILE; y++) for (const cx of cols) mark(set, cx, y);
  if (mask & E) for (let x = 8; x < BASE_TILE; x++) for (const cy of rows) mark(set, x, cy);
  if (mask & W) for (let x = 0; x < 8; x++) for (const cy of rows) mark(set, x, cy);
  if (mask === 0) rectFill(set, 7, 7, 8, 8, style.line); // isolated stub
}

// A road tile = base + lane markings. The base is the procedural dither, OR a tileset asphalt
// SURFACE texture (Maddy's call: "generate road textures with diffusion, paint the lines on top").
// One tileable surface skins all 16 mask variants — markings stay procedural so autotiling + the
// player's live road-building keep working.
function makeRoadTile(kind: number, mask: number, wide = false, surface?: AtlasImage): HTMLCanvasElement {
  if (surface) return paintTileOver(surface, (set) => paintRoadMarkings(set, kind, mask, wide));
  const style = ROAD_STYLES[kind]!;
  return paintTile((set) => {
    ditherFill(set, style.base, style.accent);
    paintRoadMarkings(set, kind, mask, wide);
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
function paintForKey(key: string, surfaces?: ReadonlyMap<string, AtlasImage>): HTMLCanvasElement {
  const parts = key.split('-');
  switch (parts[0]) {
    case 'b':
      return makeBuildingTile(Number(parts[1]), parts[2]!, Number(parts[3]));
    case 'road': {
      // parts[3] === 'w' is the wide-slab variant; key off the value, never the
      // length (b-… building keys also split to length 4). A tileset road SURFACE (asphalt) is
      // looked up per-kind then generic; absent → procedural dither base.
      const kind = Number(parts[1]);
      const surface = surfaces?.get(surfaceKey(`road-${kind}`)) ?? surfaces?.get(surfaceKey('road'));
      return makeRoadTile(kind, Number(parts[2]), parts[3] === 'w', surface);
    }
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

// The atlas is source-agnostic (ctx.drawImage takes any CanvasImageSource): procedural
// painters return <canvas>, a tileset supplies decoded <img>. So a tileset is just an OVERRIDE
// map layered on top of the painted base — present keys win, omitted keys keep the painter
// (docs/art/asset-generation.md §0.5: an optional skin with per-key procedural fallback).
type AtlasImage = CanvasImageSource;

// The procedural atlas is byte-identical for every Renderer and every tileset swap, so paint it
// ONCE (lazily, on first construction) and cache it process-wide. The tile values are read-only
// canvases — safe to share. This is the perf hinge for tileset swaps: applyTileset becomes a
// shallow Map clone + O(overrides) set, NOT an O(all-keys ≈ hundreds of paintTile) repaint.
let PROCEDURAL_ATLAS: Map<string, AtlasImage> | null = null;

function proceduralAtlas(): Map<string, AtlasImage> {
  if (PROCEDURAL_ATLAS) return PROCEDURAL_ATLAS;
  const atlas = new Map<string, AtlasImage>();

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

  PROCEDURAL_ATLAS = atlas;
  return atlas;
}

/**
 * The road SURFACE textures a tileset supplies, as an ordered variant list. Supports either N
 * tone-consistent VARIANTS (`@surface/road#0`, `#1`, … — cycled per-tile to break the repeated-
 * texture "plaid", Maddy 2026-06-19) or a single `@surface/road`. Empty ⇒ procedural asphalt.
 */
function collectRoadSurfaces(overrides: ReadonlyMap<string, AtlasImage>): AtlasImage[] {
  const out: AtlasImage[] = [];
  for (let v = 0; ; v++) {
    const img = overrides.get(variantKey(surfaceKey('road'), v));
    if (!img) break;
    out.push(img);
  }
  if (out.length === 0) {
    const single = overrides.get(surfaceKey('road'));
    if (single) out.push(single);
  }
  return out;
}

function buildAtlas(overrides?: ReadonlyMap<string, AtlasImage>): Map<string, AtlasImage> {
  // Shallow clone of the cached procedural atlas (shares the painted tile canvases by reference).
  const atlas = new Map(proceduralAtlas());
  if (!overrides) return atlas;

  // Road SURFACE textures (asphalt): when a tileset supplies one (or several variants), RE-PAINT
  // the autotiled road tiles with the procedural lane markings drawn over that texture — one
  // tileable surface skins all 16 mask variants (so autotiling + live road-building keep working).
  // With >1 variant, each road key also gets per-variant tiles under variantKey() so drawBase can
  // cycle them per-tile (anti-plaid). Only road keys are touched; every other key stays cached.
  const roadSurfaces = collectRoadSurfaces(overrides);
  if (roadSurfaces.length > 0) {
    const roadKeys = [...atlas.keys()].filter((k) => k.startsWith('road-'));
    for (const key of roadKeys) {
      roadSurfaces.forEach((surf, v) => {
        const tile = paintForKey(key, new Map([[surfaceKey('road'), surf]]));
        atlas.set(variantKey(key, v), tile);
        if (v === 0) atlas.set(key, tile); // base key = variant 0 (default / single-variant path)
      });
    }
  }

  // Full-tile overrides (terrain/buildings/segmented cells) win last; `@surface/*` entries are
  // marking-painter INGREDIENTS, never drawable tiles, so they're skipped here.
  for (const [key, img] of overrides) {
    if (!key.startsWith('@')) atlas.set(key, img);
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
  // Rebuilt on a tileset swap (applyTileset), so not readonly. Source-agnostic values.
  private atlas: Map<string, AtlasImage>;
  // True when a tileset supplied at least one override → enables the segmented-footprint
  // cell-key lookup in drawBase. False (procedural) keeps that path byte-identical + zero-cost.
  private hasTileset = false;
  // Count of road asphalt-surface variants (0 = procedural roads, 1 = single surface, >1 = cycle
  // per-tile to break the repeated-texture plaid). Read in drawBase's per-tile road key pick.
  private roadVariants = 0;
  // Cached base pass (terrain + built + overlay) on an offscreen canvas. Rebuilt
  // ONLY when invalidated (map/camera/overlay change), then blitted 1:1 onto the
  // visible canvas each frame. The hover preview and the ambient sprites live in
  // the per-frame composite, NOT the base — so a per-tile hover is a cheap blit,
  // not an O(visible-tiles) rebuild (CRITIC-YP2).
  private readonly base: HTMLCanvasElement;
  private readonly baseCtx: CanvasRenderingContext2D;
  private baseDirty = true;
  private dpr = 1;
  private cssWidth = 0;
  private cssHeight = 0;
  private preview: readonly PreviewTile[] | null = null;
  private overlay: OverlaySource | null = null;
  // A LIVE field overlay drawn per-frame in drawSprites (fresh every frame, unlike the cached-base
  // `overlay`). 'police' tints ambient.policeViolence — the Police Violence map. null = off.
  private liveOverlay: string | null = null;
  // Anchor tiles of POWERED consumer parcels (the live power grid). A consumer not
  // in this set draws an "unpowered" pip. null = grid unknown (no marks).
  private powered: Set<number> | null = null;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    overrides?: ReadonlyMap<string, AtlasImage>,
  ) {
    this.ctx = canvas.getContext('2d')!;
    this.base = document.createElement('canvas');
    this.baseCtx = this.base.getContext('2d')!;
    this.atlas = buildAtlas(overrides);
    this.hasTileset = (overrides?.size ?? 0) > 0;
    this.roadVariants = overrides ? collectRoadSurfaces(overrides).length : 0;
  }

  /**
   * Swap the active tileset at runtime: rebuild the atlas with the given PNG overrides layered
   * over the procedural painters, then invalidate the cached base so the next frame repaints.
   * `overrides` empty/undefined ⇒ back to the pure procedural look. Lets the settings menu apply
   * a tileset change live — no page reload, unlike a map-size change (which is a different seed).
   */
  applyTileset(overrides?: ReadonlyMap<string, AtlasImage>): void {
    this.atlas = buildAtlas(overrides);
    this.hasTileset = (overrides?.size ?? 0) > 0;
    this.roadVariants = overrides ? collectRoadSurfaces(overrides).length : 0;
    this.invalidateBase();
  }

  /** Set (or clear) the hover/drag preview tiles drawn as translucent tints. */
  setPreview(tiles: readonly PreviewTile[] | null): void {
    this.preview = tiles;
  }

  /** Set (or clear) the ecology heatmap overlay drawn under the preview. */
  setOverlay(source: OverlaySource | null): void {
    this.overlay = source;
  }

  /** Set (or clear) the per-frame live-field overlay ('police' → the Police Violence map). Drawn
   *  fresh each frame from the ambient field, so it tracks a continuously-changing field. */
  setLiveOverlay(kind: string | null): void {
    this.liveOverlay = kind;
  }

  /** Publish the live power grid (powered consumer anchor tiles). Unpowered consumers
   *  get a red pip. The host calls invalidateBase after this so the marks redraw. */
  setPowerGrid(poweredAnchors: Set<number> | null): void {
    this.powered = poweredAnchors;
  }

  resize(cssWidth: number, cssHeight: number, dpr: number): void {
    this.dpr = dpr;
    this.cssWidth = cssWidth;
    this.cssHeight = cssHeight;
    this.canvas.width = Math.round(cssWidth * dpr);
    this.canvas.height = Math.round(cssHeight * dpr);
    this.canvas.style.width = `${cssWidth}px`;
    this.canvas.style.height = `${cssHeight}px`;
    // The offscreen base must track the same backing-store size/DPR so the
    // identity 1:1 blit lands at the exact device pixels (no rescale/blur).
    this.base.width = Math.round(cssWidth * dpr);
    this.base.height = Math.round(cssHeight * dpr);
    this.baseDirty = true; // the resized base canvas is cleared → must redraw
  }

  /** Mark the cached base pass stale (map/camera/overlay changed). */
  invalidateBase(): void {
    this.baseDirty = true;
  }

  /**
   * Draw the cached BASE pass — terrain + built + power-line decoration + ecology
   * overlay — into the offscreen base canvas. Explicitly NOT the preview (which is
   * cursor-following and would defeat the cache on every hover) and NOT the sprites.
   * Uses the exact transform/smoothing setup the legacy render used so the base is
   * pixel-identical to today's terrain+built+overlay layer (CRITIC-YP2 / YP5).
   */
  private drawBase(world: WorldState, camera: Camera): void {
    const { map, parcels } = world;
    const ctx = this.baseCtx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.imageSmoothingEnabled = false; // base ctx scales BASE_TILE→ts; off = crisp
    ctx.fillStyle = '#14121f';
    ctx.fillRect(0, 0, this.cssWidth, this.cssHeight);

    const ts = camera.tileSize;
    const range = camera.visibleTileRange();
    // Per-parcel anchor marks (glyph + unpowered pip) are COLLECTED during the tile
    // loop and drawn in a second pass below — a multi-tile footprint's later tiles
    // would otherwise paint over a mark drawn at the anchor tile (z-order fix).
    const marks: { dx: number; dy: number; w: number; h: number; kind: number; density: number; unpowered: boolean }[] = [];
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
          // A ramp uses its FREEWAY-axis marking mask (not the full 4-way connection) so its dashed
          // line runs straight through the freeway instead of crossing the surface street it links.
          const mask =
            built === BuiltKind.RoadRamp
              ? rampMarkingMask(map, tx, ty)
              : isT
                ? transportMask(map, tx, ty)
                : 0;
          const pid = isT ? 0 : map.parcel[i]!;
          const tier = isT ? 0 : parcels.conditionAt(pid - 1) < 128 ? 1 : 0;
          const pos: FootprintPos = isT ? 'c' : footprintPos(map, tx, ty, pid);
          // wideRoadAt is predicate-guarded (false for any non-road tile), so this
          // only ever flips the slab variant on for a 2-/3-row road corridor.
          const wide = wideRoadAt(map, tx, ty);
          // Building tiles under an active tileset try the SEGMENTED-footprint cell key first
          // (a single W×H image sliced per cell, for seam continuity) and fall back to the
          // procedural pos/tier key when the tileset doesn't supply that cell. The procedural
          // path never enters this branch (hasTileset false), so it stays byte-identical.
          let builtKey = builtRenderKey(built, mask, pos, tier, wide);
          if (this.hasTileset && !isT && pid !== 0) {
            const fp = parcels.get(pid - 1);
            const cellKey = footprintCellKey(built, fp.width, fp.height, tx - fp.x, ty - fp.y, tier);
            if (this.atlas.has(cellKey)) builtKey = cellKey;
          }
          // Road asphalt-surface VARIANT pick (anti-plaid): cycle the tone-consistent variants
          // per-tile via a direction-neutral position hash, so the surface doesn't tile into a grid.
          if (this.roadVariants > 1 && builtKey.startsWith('road-')) {
            builtKey = variantKey(builtKey, surfaceVariantIndex(tx, ty, this.roadVariants));
          }
          const builtTile = this.atlas.get(builtKey);
          if (builtTile) ctx.drawImage(builtTile, 0, 0, BASE_TILE, BASE_TILE, dx, dy, ts, ts);

          // Limited-access DIVIDER: a concrete barrier on each edge where a freeway abuts a surface
          // road (a frontage avenue) — you physically can't cross there, only at a ramp. Per-tile
          // (depends on neighbour kinds), drawn OVER the road like the power poles, not an atlas key.
          // Structural/mechanical, so always on (procedural + any tileset).
          if (isT) {
            // minRun 3: only barrier a SUSTAINED freeway/frontage stretch (>2 tiles). A 1-tile
            // freeway↔street contact is a crossing / onramp, not a frontage — no barrier there.
            const div = roadDividerMask(map, tx, ty, 3);
            if (div !== 0) {
              const bw = Math.max(2, Math.round(ts * 0.16));
              const concrete = '#d8d2c4';
              const ridge = '#3a3630'; // shadow line on the road-facing side, for depth
              if (div & N) { ctx.fillStyle = concrete; ctx.fillRect(dx, dy, ts, bw); ctx.fillStyle = ridge; ctx.fillRect(dx, dy + bw - 1, ts, 1); }
              if (div & S) { ctx.fillStyle = concrete; ctx.fillRect(dx, dy + ts - bw, ts, bw); ctx.fillStyle = ridge; ctx.fillRect(dx, dy + ts - bw, ts, 1); }
              if (div & W) { ctx.fillStyle = concrete; ctx.fillRect(dx, dy, bw, ts); ctx.fillStyle = ridge; ctx.fillRect(dx + bw - 1, dy, 1, ts); }
              if (div & E) { ctx.fillStyle = concrete; ctx.fillRect(dx + ts - bw, dy, bw, ts); ctx.fillStyle = ridge; ctx.fillRect(dx + ts - bw, dy, 1, ts); }
            }

            // CURB / sidewalk / gutter: on each edge where a surface road meets non-road (a parcel
            // or open land), a light sidewalk strip with a dark gutter line on its road-facing side.
            // Turns the "field of asphalt" into a street with edges. Per-tile (neighbour-dependent).
            const curb = roadCurbMask(map, tx, ty);
            if (curb !== 0) {
              const sw = Math.max(1, Math.round(ts * 0.16));
              const walk = '#b0aa9c'; // warm concrete sidewalk (distinct from the white barrier)
              const gutter = '#26221c'; // the gutter channel where it meets the asphalt
              if (curb & N) { ctx.fillStyle = walk; ctx.fillRect(dx, dy, ts, sw); ctx.fillStyle = gutter; ctx.fillRect(dx, dy + sw - 1, ts, 1); }
              if (curb & S) { ctx.fillStyle = walk; ctx.fillRect(dx, dy + ts - sw, ts, sw); ctx.fillStyle = gutter; ctx.fillRect(dx, dy + ts - sw, ts, 1); }
              if (curb & W) { ctx.fillStyle = walk; ctx.fillRect(dx, dy, sw, ts); ctx.fillStyle = gutter; ctx.fillRect(dx + sw - 1, dy, 1, ts); }
              if (curb & E) { ctx.fillStyle = walk; ctx.fillRect(dx + ts - sw, dy, sw, ts); ctx.fillStyle = gutter; ctx.fillRect(dx + ts - sw, dy, 1, ts); }
            }

            // Freeway MEDIAN: a jersey barrier down the centre spine tile of the 3-wide corridor,
            // running lengthwise (separates the opposing carriageways). Per-tile; opens at ramps.
            const medianAxis = freewayMedianAxis(map, tx, ty);
            if (medianAxis !== null) {
              const mb = Math.max(2, Math.round(ts * 0.2));
              const concrete = '#d8d2c4';
              const ridge = '#3a3630';
              if (medianAxis === 'v') {
                const mx = Math.floor(dx + ts / 2 - mb / 2);
                ctx.fillStyle = concrete; ctx.fillRect(mx, dy, mb, ts);
                ctx.fillStyle = ridge; ctx.fillRect(Math.floor(dx + ts / 2), dy, 1, ts);
              } else {
                const my = Math.floor(dy + ts / 2 - mb / 2);
                ctx.fillStyle = concrete; ctx.fillRect(dx, my, ts, mb);
                ctx.fillStyle = ridge; ctx.fillRect(dx, Math.floor(dy + ts / 2), ts, 1);
              }
            }
          }

          // Elevated deck (overpass): drawn LIFTED above the road below with a drop shadow, so it
          // reads as grade-separated. Keys through the same atlas tiles as at-grade elev/promenade
          // (deckMask over the deck layer), so no new keyspace.
          const deck = map.deck[i]!;
          if (deck !== 0) {
            const deckTile = this.atlas.get(builtRenderKey(deck, deckMask(map, tx, ty), 'c', 0));
            if (deckTile) {
              const lift = Math.max(1, Math.round(ts * 0.2));
              ctx.fillStyle = 'rgba(8, 6, 14, 0.32)'; // the overpass's shadow on the road
              ctx.fillRect(dx + Math.round(ts * 0.1), dy + Math.round(ts * 0.12), ts, ts);
              ctx.drawImage(deckTile, 0, 0, BASE_TILE, BASE_TILE, dx, dy - lift, ts, ts);
            }
          }

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

          // Collect this parcel's anchor mark (glyph + unpowered pip) for the
          // second pass; the decisions are pure (glyphContent / isPowerConsumer).
          if (!isT && pid !== 0) {
            const pp = parcels.get(pid - 1);
            if (tx === pp.x && ty === pp.y) {
              const unpowered =
                this.powered !== null && isPowerConsumer(pp.kind) && !this.powered.has(i);
              marks.push({ dx, dy, w: pp.width, h: pp.height, kind: pp.kind, density: pp.density, unpowered });
            }
          }
        }

        // Ecology heatmap: a translucent tint over every visible tile (built or
        // not). Part of the base — overlay changes call invalidateBase (Task 3).
        // A SPARSE overlay (dimBase) scrims every un-highlighted tile so its few
        // strong highlights read as a layer view instead of washing into terrain.
        if (this.overlay) {
          const t = this.overlay.tint(i);
          if (t) {
            ctx.fillStyle = `rgba(${t[0]}, ${t[1]}, ${t[2]}, ${t[3]})`;
            ctx.fillRect(dx, dy, ts, ts);
          } else if (this.overlay.dimBase) {
            ctx.fillStyle = OVERLAY_DIM_CSS;
            ctx.fillRect(dx, dy, ts, ts);
          }
        }
      }
    }

    // Second pass: parcel anchor marks ON TOP of every tile + the overlay, so a
    // multi-tile footprint's own tiles (and the heatmap tint) can't hide them.
    // The unpowered pip sits in the footprint's top-right; the legibility glyph is
    // centered over the whole footprint (skipped below GLYPH_MIN_TS).
    for (const m of marks) {
      if (m.unpowered) {
        const pip = Math.max(2, ts * 0.18);
        ctx.fillStyle = 'rgba(232, 72, 60, 0.95)';
        ctx.fillRect(m.dx + m.w * ts - pip - 1, m.dy + 1, pip, pip);
      }
      if (ts >= GLYPH_MIN_TS) {
        const glyph = parcelGlyph(m.kind as BuiltKind, m.density);
        if (glyph) {
          const gx = m.dx + (m.w * ts) / 2;
          const gy = m.dy + (m.h * ts) / 2;
          ctx.font = `bold ${Math.max(8, Math.floor(ts * 0.55))}px "Courier New", ui-monospace, monospace`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.lineWidth = Math.max(2, ts * 0.12);
          ctx.strokeStyle = 'rgba(12, 10, 18, 0.85)';
          ctx.strokeText(glyph, gx, gy);
          ctx.fillStyle = 'rgba(240, 236, 214, 0.92)';
          ctx.fillText(glyph, gx, gy);
        }
      }
    }

    // Parked cars are no longer painted into the static base — they are the trip-cars that
    // parked (cars=trips, lots=storage), drawn dynamically in drawSprites from ambient.cars.
  }

  /**
   * Shared per-frame work for BOTH entry points, in three explicit steps:
   *  1. if the base is dirty, rebuild it (drawBase) and clear the flag;
   *  2. IDENTITY-blit the base onto the visible canvas 1:1 (same backing-store dims
   *     → no rescale; smoothing off → no re-smooth);
   *  3. draw the preview on top under the DPR transform (it lives in the composite
   *     now, NOT the base — so a hover never invalidates the base).
   */
  private composite(world: WorldState, camera: Camera): void {
    if (this.baseDirty) {
      this.drawBase(world, camera);
      this.baseDirty = false;
    }
    const ctx = this.ctx;
    // Identity blit: base is backing-store sized, so drawImage(base, 0, 0) is 1:1.
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.base, 0, 0);

    // Preview overlay (composite, not base): translucent green/red tile tints, drawn
    // at the DPR transform in CSS-space coords so they read on top of the base blit.
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    if (this.preview) {
      const ts = camera.tileSize;
      for (const t of this.preview) {
        const { sx, sy } = camera.worldToScreen(t.x, t.y);
        ctx.fillStyle = t.valid ? 'rgba(96, 200, 128, 0.40)' : 'rgba(220, 86, 86, 0.40)';
        ctx.fillRect(Math.floor(sx), Math.floor(sy), ts, ts);
      }
    }
  }

  /**
   * The legacy / ambient-OFF path: composite only (base-blit + preview, NO sprites)
   * — output-identical to today's single-pass render (terrain + built + overlay +
   * preview), now cache-optimized so a preview-only repaint is a cheap blit.
   */
  render(world: WorldState, camera: Camera): void {
    this.composite(world, camera);
  }

  /**
   * The ambient-ON path: the same composite (base-blit + preview) THEN the ambient
   * sprites on top, culled to the viewport — the O(visible sprites) draw.
   */
  renderFrame(world: WorldState, camera: Camera, ambient: AmbientState): void {
    this.composite(world, camera);
    this.drawSprites(world, camera, ambient);
  }

  /** Draw the ambient sprites (cars / pedestrians / bird flocks) + the live building-health
   *  glow at the DPR transform, culled to the viewport. Cosmetic shell — live-pass tuned. */
  private drawSprites(world: WorldState, camera: Camera, ambient: AmbientState): void {
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const ts = camera.tileSize;
    const w = this.cssWidth;
    const h = this.cssHeight;
    const onScreen = (sx: number, sy: number): boolean =>
      sx > -ts && sx < w + ts && sy > -ts && sy < h + ts;

    const mapW = world.map.width;

    // Desire-path WEAR: pedestrians beat wild-green ground into brown dirt + litter. Drawn
    // first (ground level), browning the tile by wear and dropping trash specks as it deepens.
    for (const [tile, wear] of ambient.wear) {
      const wx = tile % mapW;
      const wy = (tile - wx) / mapW;
      const { sx, sy } = camera.worldToScreen(wx, wy);
      if (sx < -ts || sx > w + ts || sy < -ts || sy > h + ts) continue;
      const f = wear / 255;
      ctx.globalAlpha = 0.7 * f; // browns the green underneath, proportional to wear
      ctx.fillStyle = '#6e5d3f';
      ctx.fillRect(Math.floor(sx), Math.floor(sy), Math.ceil(ts), Math.ceil(ts));
      ctx.globalAlpha = 1;
      if (wear > 120) {
        ctx.fillStyle = '#2e2a22'; // trash specks, more as the path deepens
        const specks: ReadonlyArray<readonly [number, number]> = [
          [0.3, 0.35],
          [0.65, 0.5],
          [0.45, 0.72],
        ];
        const n = wear > 210 ? 3 : wear > 170 ? 2 : 1;
        const sp = Math.max(1, ts * 0.12);
        for (let k = 0; k < n; k++) {
          ctx.fillRect(Math.floor(sx + specks[k]![0] * ts), Math.floor(sy + specks[k]![1] * ts), sp, sp);
        }
      }
    }

    // Water pollution: runoff murks the coastal water green-brown, deepening with accumulation.
    for (const [tile, poll] of ambient.waterPollution) {
      const wx = tile % mapW;
      const wy = (tile - wx) / mapW;
      const { sx, sy } = camera.worldToScreen(wx, wy);
      if (sx < -ts || sx > w + ts || sy < -ts || sy > h + ts) continue;
      ctx.globalAlpha = 0.72 * (poll / 255);
      ctx.fillStyle = '#46502f';
      ctx.fillRect(Math.floor(sx), Math.floor(sy), Math.ceil(ts), Math.ceil(ts));
    }
    ctx.globalAlpha = 1;

    // Air pollution: cars smog the tiles they drive — a grey haze thickening with the live field,
    // drawn over the ground overlays but under the sprites/pips (they read through the haze).
    for (const [tile, poll] of ambient.pollution) {
      const px = tile % mapW;
      const py = (tile - px) / mapW;
      const { sx, sy } = camera.worldToScreen(px, py);
      if (sx < -ts || sx > w + ts || sy < -ts || sy > h + ts) continue;
      ctx.globalAlpha = 0.5 * (poll / 255);
      ctx.fillStyle = '#5a5750';
      ctx.fillRect(Math.floor(sx), Math.floor(sy), Math.ceil(ts), Math.ceil(ts));
    }
    ctx.globalAlpha = 1;

    // Land value: a diverging tint on each inhabited plot — warm gold where it's prized, cold slate
    // where it's decayed (mid reads through clean). On zone tiles, so it rarely overlaps the wear
    // (wild ground) or smog (roads) overlays. The desirability the other layers add up to.
    for (const [tile, lv] of ambient.landValue) {
      const lx = tile % mapW;
      const ly = (tile - lx) / mapW;
      const { sx, sy } = camera.worldToScreen(lx, ly);
      if (sx < -ts || sx > w + ts || sy < -ts || sy > h + ts) continue;
      const f = (lv - 128) / 128; // -1 (decayed) .. +1 (prized)
      ctx.globalAlpha = 0.4 * Math.min(1, Math.abs(f));
      ctx.fillStyle = f >= 0 ? '#e8c060' : '#39404e';
      ctx.fillRect(Math.floor(sx), Math.floor(sy), Math.ceil(ts), Math.ceil(ts));
    }
    ctx.globalAlpha = 1;

    // Building health: a bright corner PIP on each home its citizens' trips have marked —
    // green when thriving, red when suffering, growing with magnitude. A distinct badge (not
    // a tile tint) so it reads against any building colour. The visible output of the
    // citizen-transit-health loop; live per-frame, so it lives here, not in the cached base.
    for (const [tile, health] of ambient.buildingHealth) {
      const hx = tile % mapW;
      const hy = (tile - hx) / mapW;
      const { sx, sy } = camera.worldToScreen(hx + 0.5, hy + 0.5);
      if (!onScreen(sx, sy)) continue;
      const mag = Math.min(1, Math.abs(health) / 18);
      const pip = ts * (0.2 + 0.18 * mag); // bigger badge = stronger health
      ctx.globalAlpha = 0.85;
      ctx.fillStyle = health >= 0 ? '#4ee06a' : '#ff4636';
      ctx.fillRect(Math.floor(sx - ts * 0.4), Math.floor(sy - ts * 0.4), pip, pip); // top-left corner
    }
    ctx.globalAlpha = 1;

    // Cars carry their own colour (c.tint), shown the same moving and parked. A MOVING car
    // is drawn to the right of its heading (laneOffset) so opposing traffic rides opposite
    // sides of a road; a PARKED car sits centred on its stall. Same trip-car, same colour.
    const carSize = Math.max(2, ts * 0.34);
    const parkedSize = Math.max(2, ts * 0.3);
    for (const c of ambient.cars) {
      ctx.fillStyle = CAR_COLORS[(c.tint ?? 0) % CAR_COLORS.length]!;
      // A PARKED car (lot bay or kerb slot) carries its exact stall position in c.x/c.y, so it draws
      // ON the stall (+0.5) — never warped to the lane centre. A MOVING car rides its lane (laneOffset,
      // right of heading) so opposing traffic separates. Parked cars use the smaller size.
      const off = c.parked ? { dx: 0, dy: 0 } : laneOffset(c.dir);
      const { sx, sy } = camera.worldToScreen(c.x + 0.5 + off.dx, c.y + 0.5 + off.dy);
      if (!onScreen(sx, sy)) continue;
      const size = c.parked ? parkedSize : carSize;
      ctx.fillRect(Math.floor(sx - size / 2), Math.floor(sy - size / 2), size, size);
    }

    // Police Violence map (toggled, P): a blood-red stain on every tile where the state has done
    // harm (arrests), drawn per-frame from the live field so it tracks arrests + decay. The inverse
    // of a crime map — concentrated in the redlined districts the cruisers hunt.
    if (this.liveOverlay === 'police') {
      for (const [tile, v] of ambient.policeViolence) {
        const vx = tile % mapW;
        const vy = (tile - vx) / mapW;
        const { sx, sy } = camera.worldToScreen(vx, vy);
        if (sx < -ts || sx > w + ts || sy < -ts || sy > h + ts) continue;
        const t = policeViolenceTint(v);
        ctx.globalAlpha = t[3];
        ctx.fillStyle = `rgb(${t[0]},${t[1]},${t[2]})`;
        ctx.fillRect(Math.floor(sx), Math.floor(sy), Math.ceil(ts), Math.ceil(ts));
      }
      ctx.globalAlpha = 1;
    }

    // Police cruisers: a dark institutional body with a FLASHING red/blue light bar (alternating
    // ~5x/sec) — the over-policing of the redlined districts made visible as it patrols.
    const cruiserSize = Math.max(2, ts * 0.26);
    const flashRed = Math.floor(performance.now() / 180) % 2 === 0;
    for (const c of ambient.cruisers) {
      const off = laneOffset(c.dir);
      const { sx, sy } = camera.worldToScreen(c.x + 0.5 + off.dx, c.y + 0.5 + off.dy);
      if (!onScreen(sx, sy)) continue;
      ctx.fillStyle = '#1c2235'; // dark cruiser body
      ctx.fillRect(Math.floor(sx - cruiserSize / 2), Math.floor(sy - cruiserSize / 2), cruiserSize, cruiserSize);
      // The flashing light bar on top (half the body), alternating red/blue.
      const lb = Math.max(1, cruiserSize * 0.5);
      ctx.fillStyle = flashRed ? '#ff3b30' : '#3b6bff';
      ctx.fillRect(Math.floor(sx - lb / 2), Math.floor(sy - cruiserSize / 2), lb, Math.max(1, cruiserSize * 0.34));
    }

    // Citizens on foot, coloured by TRAVEL MODE so the modal shift is legible: walkers are warm
    // dots, cyclists yellow, tram riders cyan, rail riders violet. (Drivers are CARS — drawn above
    // from ambient.cars — and their last-mile walk is a warm dot.) On a STREET a ped hugs the kerb
    // (sidewalk); crossing open ground (a demand path) it stays centred.
    const pedSize = Math.max(1, ts * 0.16);
    for (const p of ambient.peds) {
      if (p.phase === 'inside' || p.phase === 'driving') continue; // inside a building, or riding its car
      let ox = 0.5;
      let oy = 0.5;
      if (isRoadKind(world.map.built[world.map.idx(Math.round(p.x), Math.round(p.y))]!)) {
        const o = pedCurbOffset(p.dir);
        ox += o.dx;
        oy += o.dy;
      }
      const { sx, sy } = camera.worldToScreen(p.x + ox, p.y + oy);
      if (!onScreen(sx, sy)) continue;
      ctx.fillStyle = MODE_COLORS[p.mode ?? TravelMode.Walk] ?? MODE_COLORS[TravelMode.Walk]!;
      ctx.fillRect(sx - pedSize / 2, sy - pedSize / 2, pedSize, pedSize);
    }

    // Bird flocks: tiny dot clusters. Centre on the tile (+0.5) for the same
    // grid convention as cars/peds (boids spawn clustered on the tile corner).
    ctx.fillStyle = '#2b2433';
    const birdSize = Math.max(1, ts * 0.1);
    for (const f of ambient.birds) {
      for (const b of f.birds) {
        const { sx, sy } = camera.worldToScreen(b.x + 0.5, b.y + 0.5);
        if (!onScreen(sx, sy)) continue;
        ctx.fillRect(sx - birdSize / 2, sy - birdSize / 2, birdSize, birdSize);
      }
    }
  }
}
