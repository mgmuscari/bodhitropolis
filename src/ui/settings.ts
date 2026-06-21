// Settings store (PURE — schema, defaults, presets, and a tolerant clamp/merge). No DOM, no
// localStorage, no transcendental Math, so it headless-tests like the engine layers (on the pure-ui
// allowlist). The localStorage IO lives in the sibling `settingsStore.ts`; the interactive shell in
// `settingsPanel.ts`. Two setting classes (the determinism split, see docs/design/settings-menu.md):
//   • live caps  — pure live-layer perf ceilings, mutable at runtime (ambientContent.applyLiveCaps);
//   • world size — feeds runPipeline at world creation, so it REGENERATES (apply-on-restart). It must
//     never be live-mutated — a different size is a different (still deterministic) seeded world.

/** Live agent/render perf ceilings — the "fast PC vs slow PC" knob. Mutable at runtime; the shape is
 *  the single source of truth for `ambientContent`'s caps (imported there as a type). */
export interface LiveCaps {
  carCap: number;
  pedCap: number;
  flockCap: number;
  /** Citizens kept out on their round = total occupancy ÷ this (bigger → fewer out → lighter). */
  citizenOutDivisor: number;
  spawnPerSubstep: number;
}

/** World-generation settings (apply-on-restart; they change the seeded world). */
export interface WorldSettings {
  mapWidth: number;
  mapHeight: number;
}

export interface Settings {
  live: LiveCaps;
  world: WorldSettings;
  /** Render skin; `procedural` is the permanent default (generated tilesets are an optional skin). */
  tileset: string;
  /** Render path: `gpu` = the WebGL2 hybrid (shader jeuje's the CPU base — water/shadows/day-night/
   *  clouds); `cpu` = the Canvas2D path (the no-WebGL fallback). GPU falls back to CPU if unavailable. */
  renderer: RendererMode;
}

export type RendererMode = 'cpu' | 'gpu';

export type PresetTier = 'low' | 'medium' | 'high';
export type MapSizeKey = 'small' | 'medium' | 'large' | 'huge';

/** Square map presets. `medium` is 128 — the historical default, so the default settings reproduce
 *  today's seeded world byte-for-byte. */
export const MAP_SIZES: Record<MapSizeKey, number> = {
  small: 96,
  medium: 128,
  large: 176,
  huge: 224,
};

/** Live-cap presets from a slow machine (low) to a fast one (high). `medium` == today's shipped
 *  consts (ambientContent: CAR_CAP 200, PED_CAP 1200, FLOCK_CAP 32, divisor 3, spawn/substep 4). */
export const CAP_PRESETS: Record<PresetTier, LiveCaps> = {
  low: { carCap: 80, pedCap: 400, flockCap: 16, citizenOutDivisor: 5, spawnPerSubstep: 2 },
  medium: { carCap: 200, pedCap: 1200, flockCap: 32, citizenOutDivisor: 3, spawnPerSubstep: 4 },
  high: { carCap: 400, pedCap: 2400, flockCap: 48, citizenOutDivisor: 2, spawnPerSubstep: 6 },
};

export const DEFAULT_SETTINGS: Settings = {
  live: { ...CAP_PRESETS.medium },
  world: { mapWidth: MAP_SIZES.medium, mapHeight: MAP_SIZES.medium },
  tileset: 'procedural',
  renderer: 'gpu',
};

// Safe bands. Caps are perf ceilings (the floor keeps the game from emptying; the ceiling is a memory
// guard). Map dims must stay integer + within what GameMap and the worldgen budgets can fill sensibly.
const CAP_BOUNDS: Record<keyof LiveCaps, readonly [number, number]> = {
  carCap: [10, 2000],
  pedCap: [50, 8000],
  flockCap: [0, 256],
  citizenOutDivisor: [1, 20],
  spawnPerSubstep: [1, 32],
};
const MAP_BOUNDS: readonly [number, number] = [64, 384];

/** Clamp + round a value into [lo, hi]; non-finite / wrong-type → `dflt` (tolerates corrupt JSON). */
function clampInt(v: unknown, lo: number, hi: number, dflt: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return dflt;
  return Math.min(hi, Math.max(lo, Math.round(v)));
}

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };

/** Merge a (possibly partial / corrupt) settings blob over the defaults and clamp every field — the
 *  single sanitizer both the persisted-load path and the panel edits run through. */
export function clampSettings(partial?: DeepPartial<Settings>): Settings {
  const p = partial ?? {};
  const live = { ...DEFAULT_SETTINGS.live, ...(p.live ?? {}) };
  const world = { ...DEFAULT_SETTINGS.world, ...(p.world ?? {}) };
  const d = DEFAULT_SETTINGS;
  return {
    live: {
      carCap: clampInt(live.carCap, ...CAP_BOUNDS.carCap, d.live.carCap),
      pedCap: clampInt(live.pedCap, ...CAP_BOUNDS.pedCap, d.live.pedCap),
      flockCap: clampInt(live.flockCap, ...CAP_BOUNDS.flockCap, d.live.flockCap),
      citizenOutDivisor: clampInt(live.citizenOutDivisor, ...CAP_BOUNDS.citizenOutDivisor, d.live.citizenOutDivisor),
      spawnPerSubstep: clampInt(live.spawnPerSubstep, ...CAP_BOUNDS.spawnPerSubstep, d.live.spawnPerSubstep),
    },
    world: {
      mapWidth: clampInt(world.mapWidth, MAP_BOUNDS[0], MAP_BOUNDS[1], d.world.mapWidth),
      mapHeight: clampInt(world.mapHeight, MAP_BOUNDS[0], MAP_BOUNDS[1], d.world.mapHeight),
    },
    tileset: typeof p.tileset === 'string' ? p.tileset : d.tileset,
    renderer: p.renderer === 'cpu' || p.renderer === 'gpu' ? p.renderer : d.renderer,
  };
}
