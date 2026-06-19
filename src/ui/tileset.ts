// Tileset registry + manifest (PURE — no DOM, no transcendental Math → pure-ui allowlist).
//
// A tileset is an OPTIONAL skin over the procedural atlas (docs/art/asset-generation.md §0.5):
// it supplies committed PNGs for SOME atlas keys; every key it omits falls back to the procedural
// painter in renderer.buildAtlas(). `procedural` supplies nothing — the permanent, first-class
// default. This module is the single source of truth for
//   (a) which tilesets exist  → the settings dropdown reads tilesetMetas();
//   (b) which atlas keys each tileset's PNGs fill → the async loader (tilesetLoader.ts) reads
//       def.assets and maps each loaded image onto its `keys`.
// No IO here — fetching/decoding lives in tilesetLoader.ts (which is not allowlisted).

import { builtRenderKey, type FootprintPos } from './renderKey';

/** The permanent default tileset id — pure procedural painters, never removed. */
export const PROCEDURAL = 'procedural';

/** One PNG → the exact atlas keys it fills. A file that fails to load falls back per-key. */
export interface TilesetAsset {
  /** Path under public/tilesets/<id>/ — e.g. 'terrain/grass.png'. */
  file: string;
  /** The atlas keys this single image is assigned to (terrain bands, building pos/tier, …). */
  keys: readonly string[];
}

export interface TilesetDef {
  id: string;
  /** Settings-dropdown label. */
  label: string;
  /** One-line blurb shown under the select. */
  description: string;
  /** The committed PNGs and the keys they fill. `procedural` → [] (pure painters). */
  assets: readonly TilesetAsset[];
}

/** A lightweight view of a def for the settings UI (no asset list). */
export interface TilesetMeta {
  id: string;
  label: string;
  description: string;
}

// Terrain kinds + band count — mirrors renderer.ts PALETTE / BANDS. A single terrain PNG
// per kind is reused across all elevation bands (band shading is a procedural concern that a
// tileset doesn't re-skin by default).
const TERRAIN_BANDS = 4;
const POSITIONS: readonly FootprintPos[] = ['c', 'e', 'k'];
const TIERS: readonly number[] = [0, 1];

/** The elevation-band atlas keys a single terrain PNG fills (`grass` → grass-0..grass-3). */
export function terrainKeys(kind: string): string[] {
  const keys: string[] = [];
  for (let b = 0; b < TERRAIN_BANDS; b++) keys.push(`${kind}-${b}`);
  return keys;
}

/**
 * The footprint-position × condition-tier atlas keys a single (whole-building) PNG fills,
 * built through the canonical {@link builtRenderKey} so the key grammar never drifts. Pass
 * `tier` to scope to one condition (so pristine vs. derelict art can be supplied separately);
 * omit it to fill both tiers with the same image.
 */
export function buildingKeys(kind: number, tier?: number): string[] {
  const tiers = tier === undefined ? TIERS : [tier];
  const keys: string[] = [];
  for (const pos of POSITIONS) {
    for (const t of tiers) keys.push(builtRenderKey(kind, 0, pos, t));
  }
  return keys;
}

/**
 * Reserved key namespace for SURFACE textures (e.g. road asphalt) — a tileset supplies the base
 * pavement texture and the renderer paints the connection-mask lane markings OVER it procedurally
 * (so one tileable texture skins all 16 autotile variants, instead of 16 generated tiles). A
 * surface is an INGREDIENT, not a full-tile override: the `@` prefix can never collide with a real
 * atlas key (those start with a letter), so the renderer treats `@surface/*` entries specially and
 * never blits them as tiles. Role examples: `road` (all road kinds), `road-2` (avenue-specific).
 */
export function surfaceKey(role: string): string {
  return `@surface/${role}`;
}

// ── The satellite tileset ──────────────────────────────────────────────────────────────────
// Google-Maps-inspired top-down patchwork (see docs/art/satellite-tileset.md): a slightly
// cartoonish, black-outlined, SimCity-2000-era look with Oakland, CA architectural cues —
// generated via ComfyUI, committed as PNG. `assets` lists ONLY committed files: a partial
// tileset is valid (omitted keys fall back to the procedural painter), and the list grows as
// art lands. Keep it == files actually present in public/tilesets/satellite/ so selecting it
// never triggers stray 404s.
const SATELLITE_ASSETS: readonly TilesetAsset[] = [
  // Road asphalt SURFACE (a tileable texture): the renderer paints the connection-mask lane
  // markings over it, so this one texture skins every road kind/mask. The rest of the world falls
  // back to the procedural painter until more art lands.
  { file: 'surfaces/asphalt.png', keys: [surfaceKey('road')] },
];

export const TILESET_DEFS: readonly TilesetDef[] = [
  {
    id: PROCEDURAL,
    label: 'Procedural (default)',
    description: 'The hand-painted Canvas2D look — always available, never removed.',
    assets: [],
  },
  {
    id: 'satellite',
    label: 'Satellite (Oakland)',
    description: 'Top-down Google-Maps-style patchwork, Oakland architectural cues.',
    assets: SATELLITE_ASSETS,
  },
];

/** The def for `id`, or the procedural default for an unknown id (graceful — renders procedural). */
export function tilesetDef(id: string): TilesetDef {
  return TILESET_DEFS.find((d) => d.id === id) ?? TILESET_DEFS[0]!;
}

/** Every def as a {id,label,description} meta for the settings dropdown (assets omitted). */
export function tilesetMetas(): TilesetMeta[] {
  return TILESET_DEFS.map((d) => ({ id: d.id, label: d.label, description: d.description }));
}
