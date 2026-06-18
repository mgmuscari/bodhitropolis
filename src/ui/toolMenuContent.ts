// Tool-menu content: the pure view-model behind the categorized, pictorial tool
// dock. The flat tool row (toolbarContent) didn't scale — classics + every tech
// unlock made a 20-wide strip. This groups tools behind category tiles (Transit /
// Residential / … / Energy), each a pictorial icon, with the picked category's
// tools shown in a flyout. inspect/bulldoze stay top-level modes (always one click
// away). No DOM, no transcendental Math — on the architecture pure-ui allowlist.
// Keeping the categorization + icon mapping here, not in the shell, lets it be
// unit-tested rather than left to manual QA.

import type { ToolDef, ToolId } from '../tools/tools';
import { BuiltKind, isTransportKind } from '../engine/fabric';

/** The tool categories, in fixed dock layout order. */
export type ToolCategory =
  | 'transit'
  | 'residential'
  | 'commercial'
  | 'industrial'
  | 'civic'
  | 'green'
  | 'energy';

export const CATEGORY_ORDER: readonly ToolCategory[] = [
  'transit',
  'residential',
  'commercial',
  'industrial',
  'civic',
  'green',
  'energy',
];

/** One tool entry in a menu (mode button or category flyout tile). */
export interface MenuToolRow {
  id: ToolId;
  /** Display label — `Name · cost` for buildables, bare name for the free-ish modes. */
  label: string;
  /** Pictorial icon (emoji glyph; one swap point for a future art pass). */
  icon: string;
  selected: boolean;
  affordable: boolean;
}

/** One always-visible category tile. */
export interface CategoryTile {
  id: ToolCategory;
  label: string;
  icon: string;
  /** How many tools the category holds (a count badge). */
  count: number;
  /** Whether this category's flyout is open. */
  active: boolean;
  /** Whether the currently-selected tool lives in this category (highlight even when closed). */
  hasSelected: boolean;
}

/** The full dock view: top-level modes, the category tiles, and the open flyout's tools. */
export interface ToolMenuView {
  modes: MenuToolRow[];
  categories: CategoryTile[];
  open: ToolCategory | null;
  rows: MenuToolRow[];
}

const CATEGORY_LABEL: Record<ToolCategory, string> = {
  transit: 'Transit',
  residential: 'Residential',
  commercial: 'Commercial',
  industrial: 'Industrial',
  civic: 'Civic',
  green: 'Green',
  energy: 'Energy',
};

const CATEGORY_ICON: Record<ToolCategory, string> = {
  transit: '🚊',
  residential: '🏠',
  commercial: '🏬',
  industrial: '🏭',
  civic: '🏛️',
  green: '🌳',
  energy: '⚡',
};

// Per-kind category. Anything not listed is uncategorized (won't appear as a build
// tool — e.g. ParkingLot is worldgen-only). Transit is computed via isTransportKind.
const CATEGORY_OF_BUILDING: ReadonlyMap<number, ToolCategory> = new Map<number, ToolCategory>([
  [BuiltKind.HouseSingle, 'residential'],
  [BuiltKind.Apartments, 'residential'],
  [BuiltKind.Projects, 'residential'],
  [BuiltKind.ADU, 'residential'],
  [BuiltKind.CoopHousing, 'residential'],
  [BuiltKind.Commune, 'residential'],
  [BuiltKind.CommercialStrip, 'commercial'],
  [BuiltKind.Offices, 'commercial'],
  [BuiltKind.Bazaar, 'commercial'],
  [BuiltKind.MakerSpace, 'commercial'],
  [BuiltKind.Industrial, 'industrial'],
  [BuiltKind.Civic, 'civic'],
  [BuiltKind.FireStation, 'civic'],
  [BuiltKind.HealingCommons, 'civic'],
  [BuiltKind.Park, 'green'],
  [BuiltKind.RewildedLand, 'green'],
  [BuiltKind.Parklet, 'green'],
  [BuiltKind.CommunityGarden, 'green'],
  [BuiltKind.CompostHub, 'green'],
  [BuiltKind.VerticalFarm, 'green'],
  [BuiltKind.WastewaterWorks, 'green'],
  [BuiltKind.EnergyNode, 'energy'],
  [BuiltKind.AINode, 'energy'],
  [BuiltKind.CoalPlant, 'energy'],
  [BuiltKind.GasPlant, 'energy'],
  [BuiltKind.HydroPlant, 'energy'],
  [BuiltKind.NuclearPlant, 'energy'],
  [BuiltKind.WindTurbine, 'energy'],
  [BuiltKind.SolarPlant, 'energy'],
  [BuiltKind.FusionPlant, 'energy'],
]);

// Per-kind pictorial icon. Falls back to the category icon when a kind has none.
const ICON_OF_KIND: ReadonlyMap<number, string> = new Map<number, string>([
  [BuiltKind.RoadStreet, '🛣️'],
  [BuiltKind.RoadAvenue, '🛣️'],
  [BuiltKind.RoadHighway, '🛣️'],
  [BuiltKind.Rail, '🚆'],
  [BuiltKind.BikePath, '🚲'],
  [BuiltKind.Streetcar, '🚋'],
  [BuiltKind.QuietStreet, '🚸'],
  [BuiltKind.ElevatedRail, '🚝'],
  [BuiltKind.Promenade, '🚶'],
  [BuiltKind.HouseSingle, '🏠'],
  [BuiltKind.Apartments, '🏢'],
  [BuiltKind.Projects, '🏚️'],
  [BuiltKind.ADU, '🏡'],
  [BuiltKind.CoopHousing, '🏘️'],
  [BuiltKind.Commune, '🏘️'],
  [BuiltKind.CommercialStrip, '🏬'],
  [BuiltKind.Offices, '🏢'],
  [BuiltKind.Bazaar, '🪧'],
  [BuiltKind.MakerSpace, '🔧'],
  [BuiltKind.Industrial, '🏭'],
  [BuiltKind.Civic, '🏛️'],
  [BuiltKind.FireStation, '🚒'],
  [BuiltKind.HealingCommons, '🩹'],
  [BuiltKind.Park, '🌳'],
  [BuiltKind.RewildedLand, '🌿'],
  [BuiltKind.Parklet, '🌱'],
  [BuiltKind.CommunityGarden, '🥬'],
  [BuiltKind.CompostHub, '♻️'],
  [BuiltKind.VerticalFarm, '🌾'],
  [BuiltKind.WastewaterWorks, '💧'],
  [BuiltKind.EnergyNode, '⚡'],
  [BuiltKind.AINode, '🤖'],
  [BuiltKind.CoalPlant, '🔥'],
  [BuiltKind.GasPlant, '🛢️'],
  [BuiltKind.HydroPlant, '🌊'],
  [BuiltKind.NuclearPlant, '☢️'],
  [BuiltKind.WindTurbine, '🌬️'],
  [BuiltKind.SolarPlant, '🔆'],
  [BuiltKind.FusionPlant, '⚛️'],
]);

/** The category a tool belongs to, or null for the top-level modes (inspect/bulldoze). */
export function categoryOf(def: ToolDef): ToolCategory | null {
  if (def.kind === undefined) return null; // inspect / bulldoze
  if (isTransportKind(def.kind)) return 'transit';
  return CATEGORY_OF_BUILDING.get(def.kind) ?? null;
}

/** The pictorial icon for a tool. Modes get their own glyph; builds/converts use the kind icon. */
export function toolIcon(def: ToolDef): string {
  if (def.id === 'inspect') return '🔍';
  if (def.id === 'bulldoze') return '🧨';
  if (def.kind !== undefined) {
    const icon = ICON_OF_KIND.get(def.kind);
    if (icon) return icon;
    const cat = categoryOf(def);
    if (cat) return CATEGORY_ICON[cat];
  }
  return '▫️';
}

/**
 * Assemble the dock view from the available tools, current selection, effort, and
 * which category is open. Modes (inspect/bulldoze) come first; the remaining tools
 * are bucketed by category (only non-empty categories surface, in CATEGORY_ORDER),
 * each tile flagged active/hasSelected; `rows` holds the open category's tools (or
 * [] when nothing is open). Pure — deterministic in its inputs.
 */
export function buildToolMenu(
  tools: readonly ToolDef[],
  selectedId: ToolId | null,
  effort: number,
  open: ToolCategory | null,
): ToolMenuView {
  const modes: MenuToolRow[] = [];
  const byCat = new Map<ToolCategory, MenuToolRow[]>();

  for (const t of tools) {
    const cat = categoryOf(t);
    const row: MenuToolRow = {
      id: t.id,
      label: cat === null ? t.name : `${t.name} · ${t.cost}`,
      icon: toolIcon(t),
      selected: t.id === selectedId,
      affordable: effort >= t.cost,
    };
    if (cat === null) {
      modes.push(row);
      continue;
    }
    const bucket = byCat.get(cat);
    if (bucket) bucket.push(row);
    else byCat.set(cat, [row]);
  }

  const categories: CategoryTile[] = [];
  for (const cat of CATEGORY_ORDER) {
    const rows = byCat.get(cat);
    if (!rows || rows.length === 0) continue;
    categories.push({
      id: cat,
      label: CATEGORY_LABEL[cat],
      icon: CATEGORY_ICON[cat],
      count: rows.length,
      active: open === cat,
      hasSelected: rows.some((r) => r.selected),
    });
  }

  const openValid = open !== null && byCat.has(open) ? open : null;
  return { modes, categories, open: openValid, rows: openValid ? byCat.get(openValid)! : [] };
}
