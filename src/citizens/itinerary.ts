// Citizen daily itinerary: the categories of place a citizen visits across a day, and which
// plot kinds serve each. A citizen cycles home → work → shop → lifestyle → home (repeat) — its
// home health emerges from where it goes (a grim industrial workplace drags it down; a healing
// commons lifts it). Pure mapping over BuiltKind (no DOM, no rng, no transcendental Math), peer
// to `zoneTypeOf`/`stopCategoryOf` — so the itinerary taxonomy is a deterministic fact about the
// built city. Magnitudes/membership are TUNING; the tested contract is the category each kind
// serves and the home→work→shop→lifestyle order.

import { BuiltKind } from '../engine/fabric';

/** A stop on a citizen's daily round (Home is the citizen's own tile, not a looked-up plot). */
export const StopCategory = {
  Work: 1,
  Shop: 2,
  Lifestyle: 3,
  Leisure: 4,
} as const;
export type StopCategory = (typeof StopCategory)[keyof typeof StopCategory];

// Plot kinds → the itinerary stop they serve. Homes are origins (not visits); transport, parking,
// and pure infrastructure (wastewater/energy) are not daily-life destinations → absent.
const CATEGORY_OF: ReadonlyMap<number, StopCategory> = new Map<number, StopCategory>([
  // Work — where citizens spend the working day.
  [BuiltKind.Industrial, StopCategory.Work],
  [BuiltKind.Offices, StopCategory.Work],
  // Shop — human-scaled commerce and making.
  [BuiltKind.CommercialStrip, StopCategory.Shop],
  [BuiltKind.Bazaar, StopCategory.Shop],
  [BuiltKind.MakerSpace, StopCategory.Shop],
  // Lifestyle — civic, cultural, and restorative third places.
  [BuiltKind.Civic, StopCategory.Lifestyle],
  [BuiltKind.HealingCommons, StopCategory.Lifestyle],
  [BuiltKind.VerticalFarm, StopCategory.Lifestyle],
  [BuiltKind.CompostHub, StopCategory.Lifestyle],
  [BuiltKind.AINode, StopCategory.Lifestyle],
  // Leisure — green/open space. Parks, gardens, and rewilded land are real DESTINATIONS people walk
  // to (Maddy 2026-06-20: green/leisure tiles join the agent destination loop — there is no
  // destination-less ambient stroller pool; everyone paths somewhere).
  [BuiltKind.Park, StopCategory.Leisure],
  [BuiltKind.RewildedLand, StopCategory.Leisure],
  [BuiltKind.CommunityGarden, StopCategory.Leisure],
  [BuiltKind.Parklet, StopCategory.Leisure],
]);

/** The daily-itinerary stop a plot of `kind` serves, or 0 if it is not a daily-life destination
 *  (a home, road, or piece of infrastructure). Total over every BuiltKind. */
export function stopCategoryOf(kind: number): StopCategory | 0 {
  return CATEGORY_OF.get(kind) ?? 0;
}

/** A citizen's daily round of stops, in order: work, shop, lifestyle, then a leisure stop in the
 *  greens (home bookends it — the citizen starts at home and returns there after the last stop).
 *  Each stop is reachability-gated, so a category the district lacks is simply skipped. */
export const DAILY_ITINERARY: readonly StopCategory[] = [
  StopCategory.Work,
  StopCategory.Shop,
  StopCategory.Lifestyle,
  StopCategory.Leisure,
];
