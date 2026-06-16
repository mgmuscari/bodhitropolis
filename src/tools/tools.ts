// The build-tools verb: a pure tool system over the fabric single-writers. A tool
// is selected, previewed (no mutation), then applied — spending communal effort
// through the guarded TechState.spend and routing to exactly one fabric writer
// (placeParcel / placeTransport / convertTransport / demolishParcel /
// demolishTransportAt). Pure module: no DOM, no rng, no Date, no transcendental
// Math — deterministic in (world, tech, action), so it is guard-scanned alongside
// the engine. It imports only from the engine and tech layers, never from ui.

import {
  BuiltKind,
  ParcelStore,
  isBuildingKind,
  isTransportKind,
  canPlaceParcel,
  placeParcel,
  canPlaceTransport,
  placeTransport,
  canConvertTransport,
  convertTransport,
  canConvertParcel,
  convertParcel,
  demolishParcel,
  demolishTransportAt,
} from '../engine/fabric';
import type { GameMap } from '../engine/map';
import type { TechState } from '../tech/state';

/** A tool id: the two always-on tools plus per-kind build/convert tools. */
export type ToolId = 'inspect' | 'bulldoze' | `build-${number}` | `convert-${number}`;

export interface Footprint {
  w: number;
  h: number;
}

export interface ToolDef {
  id: ToolId;
  /** Display name (the toolbar renders `Name · cost`). */
  name: string;
  /** Optional keyboard shortcut. */
  hotkey?: string;
  /** Communal-effort cost to apply (0 = free, e.g. inspect). */
  cost: number;
  /** The BuiltKind a build/convert tool produces (absent for inspect/bulldoze). */
  kind?: BuiltKind;
  /** Building footprint (absent for transport/convert/inspect/bulldoze). */
  footprint?: Footprint;
}

/** The minimal world a tool reads/writes: the map and its parcel store. */
export interface ToolWorld {
  map: GameMap;
  parcels: ParcelStore;
}

/** First blocking reason a preview/apply found (absent when valid/ok). */
export type ToolReason =
  | 'unknown-tool'
  | 'out-of-bounds'
  | 'occupied'
  | 'invalid-target'
  | 'nothing-to-bulldoze'
  | 'effort';

export interface PreviewResult {
  valid: boolean;
  reason?: ToolReason;
}

export interface ApplyResult {
  ok: boolean;
  reason?: ToolReason;
  /** Inspect-only: a human-readable line describing the tile. */
  info?: string;
}

const BULLDOZE_COST = 1;

// Per-kind build metadata for the tech-granted kinds: transit 5..9 (transport
// tools, no footprint, 3..6/tile) and buildings 48..60 (parcels, fixed footprint,
// 8..30 by size/role). Costs are placeholder economy values (balancing is a later
// feature); footprints are fixed per kind (PRD: parklet 1x1, garden up to 2x2).
interface BuildEntry {
  label: string;
  cost: number;
  footprint?: Footprint;
}

const BUILD_TABLE: Readonly<Record<number, BuildEntry>> = {
  // Transit (transport tools)
  [BuiltKind.BikePath]: { label: 'Bike Path', cost: 3 },
  [BuiltKind.Streetcar]: { label: 'Streetcar', cost: 6 },
  [BuiltKind.QuietStreet]: { label: 'Quiet Street', cost: 4 },
  [BuiltKind.ElevatedRail]: { label: 'Elevated Rail', cost: 6 },
  [BuiltKind.Promenade]: { label: 'Promenade', cost: 4 },
  // Buildings (parcels)
  [BuiltKind.Parklet]: { label: 'Parklet', cost: 8, footprint: { w: 1, h: 1 } },
  [BuiltKind.CommunityGarden]: { label: 'Community Garden', cost: 14, footprint: { w: 2, h: 2 } },
  [BuiltKind.CompostHub]: { label: 'Compost Hub', cost: 10, footprint: { w: 1, h: 1 } },
  [BuiltKind.VerticalFarm]: { label: 'Vertical Farm', cost: 22, footprint: { w: 2, h: 2 } },
  [BuiltKind.WastewaterWorks]: { label: 'Wastewater Works', cost: 24, footprint: { w: 2, h: 2 } },
  [BuiltKind.EnergyNode]: { label: 'Energy Node', cost: 16, footprint: { w: 1, h: 1 } },
  [BuiltKind.AINode]: { label: 'AI Node', cost: 26, footprint: { w: 1, h: 1 } },
  [BuiltKind.ADU]: { label: 'Accessory Dwelling', cost: 10, footprint: { w: 1, h: 1 } },
  [BuiltKind.CoopHousing]: { label: 'Co-op Housing', cost: 20, footprint: { w: 2, h: 2 } },
  [BuiltKind.Commune]: { label: 'Commune', cost: 30, footprint: { w: 3, h: 3 } },
  [BuiltKind.Bazaar]: { label: 'Bazaar', cost: 18, footprint: { w: 2, h: 2 } },
  [BuiltKind.MakerSpace]: { label: 'Maker Space', cost: 18, footprint: { w: 2, h: 2 } },
  [BuiltKind.HealingCommons]: { label: 'Healing Commons', cost: 28, footprint: { w: 3, h: 3 } },
};

// Conversion tools keyed by TARGET kind. The transport targets are the union of
// TRANSPORT_CONVERSIONS' entry lists: {Street, Avenue, BikePath, Streetcar,
// QuietStreet, Promenade}, costs 2..4/tile (cheaper than fresh build — a road diet
// reuses the roadbed). The building targets are the rezoning greens (Park,
// RewildedLand): an in-place depave of any alive building parcel (see convertParcel).
interface ConvertEntry {
  label: string;
  cost: number;
}

const CONVERT_TABLE: Readonly<Record<number, ConvertEntry>> = {
  [BuiltKind.RoadStreet]: { label: 'Convert to Street', cost: 3 },
  [BuiltKind.RoadAvenue]: { label: 'Convert to Avenue', cost: 4 },
  [BuiltKind.BikePath]: { label: 'Convert to Bike Path', cost: 2 },
  [BuiltKind.Streetcar]: { label: 'Convert to Streetcar', cost: 4 },
  [BuiltKind.QuietStreet]: { label: 'Convert to Quiet Street', cost: 2 },
  [BuiltKind.Promenade]: { label: 'Convert to Promenade', cost: 3 },
  [BuiltKind.Park]: { label: 'Rezone: Park', cost: 6 },
  [BuiltKind.RewildedLand]: { label: 'Rezone: Rewilded Land', cost: 4 },
};

// Ascending target order for deterministic toolbar layout.
const CONVERT_TARGETS: readonly number[] = Object.keys(CONVERT_TABLE)
  .map(Number)
  .sort((a, b) => a - b);

/** True iff `to` is a tech-granted transit kind (5..9) vs a classic kind (1..4). */
function isTechTarget(to: number): boolean {
  return to >= 5 && to <= 9;
}

/**
 * Resolve a tool id to its definition from the cost tables — grant-agnostic
 * (availableTools layers the grant gating on top). Returns undefined for an id
 * whose kind has no table entry (e.g. a non-convertible target).
 */
export function toolDef(id: ToolId): ToolDef | undefined {
  if (id === 'inspect') return { id, name: 'Inspect', hotkey: 'i', cost: 0 };
  if (id === 'bulldoze') return { id, name: 'Bulldoze', hotkey: 'x', cost: BULLDOZE_COST };
  if (id.startsWith('build-')) {
    const k = Number(id.slice('build-'.length));
    const e = BUILD_TABLE[k];
    if (!e) return undefined;
    return { id, name: e.label, cost: e.cost, kind: k as BuiltKind, footprint: e.footprint };
  }
  if (id.startsWith('convert-')) {
    const to = Number(id.slice('convert-'.length));
    const e = CONVERT_TABLE[to];
    if (!e) return undefined;
    return { id, name: e.label, cost: e.cost, kind: to as BuiltKind };
  }
  return undefined;
}

/**
 * The tools available given `tech`'s grants, in a stable order: inspect, bulldoze,
 * then one build tool per granted kind (ascending kind), then the conversion tools
 * (ascending target). Conversion gating is three-branch: a building target (the
 * rezoning greens 61/62) needs its kind granted; a tech transit target (5..9) needs
 * its kind granted; a classic road target (1..4) needs the `road-diets` capability
 * (the PRD road diet / boulevard reversal the tree never grants as a kind).
 */
export function availableTools(tech: TechState): ToolDef[] {
  const out: ToolDef[] = [toolDef('inspect')!, toolDef('bulldoze')!];

  const granted = [...tech.grantedKinds()].sort((a, b) => a - b);
  for (const k of granted) {
    const def = toolDef(`build-${k}`);
    if (def) out.push(def);
  }

  for (const to of CONVERT_TARGETS) {
    const ok = isBuildingKind(to)
      ? tech.grantedKinds().has(to as BuiltKind) // rezoning green (61/62): kind-gated
      : isTechTarget(to)
        ? tech.grantedKinds().has(to as BuiltKind) // transit (5..9): kind-gated
        : tech.hasCapability('road-diets'); // classic road (1..4): capability-gated
    if (ok) out.push(toolDef(`convert-${to}`)!);
  }

  return out;
}

/** Geometry-only validity of `tool` at (x, y) — the predicate, no effort, no mutation. */
function geometryValid(world: ToolWorld, tool: ToolDef, x: number, y: number): PreviewResult {
  const { map } = world;
  if (tool.id === 'inspect') return { valid: true };

  if (!map.inBounds(x, y)) return { valid: false, reason: 'out-of-bounds' };

  if (tool.id === 'bulldoze') {
    const built = map.built[map.idx(x, y)]!;
    if (built === 0) return { valid: false, reason: 'nothing-to-bulldoze' };
    return { valid: true };
  }

  if (tool.id.startsWith('convert-')) {
    // A building target (rezoning green) rezones a parcel; a transport target
    // converts a road/rail tile. Dispatch on the kind so each routes to its own
    // single-writer predicate.
    const ok = isBuildingKind(tool.kind!)
      ? canConvertParcel(map, world.parcels, x, y, tool.kind!)
      : canConvertTransport(map, x, y, tool.kind!);
    return ok ? { valid: true } : { valid: false, reason: 'invalid-target' };
  }

  // build-*
  const kind = tool.kind!;
  if (isBuildingKind(kind)) {
    const fp = tool.footprint!;
    return canPlaceParcel(map, x, y, fp.w, fp.h)
      ? { valid: true }
      : { valid: false, reason: 'occupied' };
  }
  // transport build
  return canPlaceTransport(map, x, y, kind)
    ? { valid: true }
    : { valid: false, reason: 'occupied' };
}

/**
 * Preview `tool` at (x, y): the exact predicate applyTool uses before it mutates —
 * geometry first (so an occupied/invalid tile reports that), then affordability.
 * Pure: reads world + tech, writes nothing. Inspect is always valid (and free).
 */
export function previewTool(
  world: ToolWorld,
  tech: TechState,
  tool: ToolDef,
  x: number,
  y: number,
): PreviewResult {
  const g = geometryValid(world, tool, x, y);
  if (!g.valid) return g;
  if (tool.cost > tech.effort) return { valid: false, reason: 'effort' };
  return { valid: true };
}

/**
 * Minimal inspect readout for the dock status line (PRD: a console-free line
 * showing kind / condition / parcel info; the full inspector is a later feature).
 * Pure — reads the map + parcel store, mutates nothing, costs nothing — and
 * exported so the formatting is unit-tested directly rather than only via applyTool.
 */
export function inspectReadout(world: ToolWorld, x: number, y: number): string {
  const { map, parcels } = world;
  if (!map.inBounds(x, y)) return `(${x}, ${y}) out of bounds`;
  const i = map.idx(x, y);
  const built = map.built[i]!;
  if (built === 0) return `(${x}, ${y}) empty`;
  if (isTransportKind(built)) return `(${x}, ${y}) transport kind ${built}`;
  const pid = map.parcel[i]!;
  const cond = pid !== 0 ? parcels.conditionAt(pid - 1) : 255;
  return `(${x}, ${y}) building kind ${built} · parcel ${pid} · condition ${cond}`;
}

/**
 * Apply `tool` at (x, y): validate (geometry + effort), debit the cost through the
 * guarded TechState.spend, then route to exactly one fabric single-writer. Returns
 * { ok: false, reason } without mutating anything when invalid. Inspect is the
 * exception — it returns info with no cost and no mutation. Deterministic in
 * (world, tech, action).
 */
export function applyTool(
  world: ToolWorld,
  tech: TechState,
  tool: ToolDef,
  x: number,
  y: number,
): ApplyResult {
  if (tool.id === 'inspect') return { ok: true, info: inspectReadout(world, x, y) };

  const p = previewTool(world, tech, tool, x, y);
  if (!p.valid) return { ok: false, reason: p.reason };

  // Effort first, through the guarded single-writer. previewTool already proved
  // the geometry valid, so the fabric writer below cannot fail after the debit.
  if (!tech.spend(tool.cost)) return { ok: false, reason: 'effort' };

  const { map, parcels } = world;
  if (tool.id === 'bulldoze') {
    const pid = map.parcel[map.idx(x, y)]!;
    if (pid !== 0) demolishParcel(map, parcels, pid - 1);
    else demolishTransportAt(map, x, y);
    return { ok: true };
  }
  if (tool.id.startsWith('convert-')) {
    // Mirror geometryValid's dispatch: a building target rezones the parcel in
    // place, a transport target converts the tile. previewTool already proved the
    // geometry, so the chosen writer cannot fail after the debit.
    if (isBuildingKind(tool.kind!)) convertParcel(map, parcels, x, y, tool.kind!);
    else convertTransport(map, x, y, tool.kind!);
    return { ok: true };
  }
  // build-*
  const kind = tool.kind!;
  if (isBuildingKind(kind)) {
    const fp = tool.footprint!;
    placeParcel(map, parcels, { x, y, width: fp.w, height: fp.h, kind });
  } else {
    placeTransport(map, x, y, kind);
  }
  return { ok: true };
}
