// Plot-use wellbeing: what a citizen brings HOME from visiting a plot, by the plot's use.
// Industry harms; conventional commerce/services are a small plus; the new-urbanist
// tech-tree builds (bazaars, maker spaces, healing commons, vertical farms…) are the most
// restorative and hand back a status BUFF on top. Pure mapping over BuiltKind — no DOM, no
// rng, no transcendental Math — so a citizen's deposit is a deterministic function of where
// they went. Magnitudes are placeholder TUNING; the tested contract is the ordering
// (industrial < conventional commercial < civic < new-urbanist) and the signs.

import { BuiltKind } from '../engine/fabric';

/** Base wellbeing a visit to a plot of this kind contributes (signed). 0 for kinds that are
 *  not meaningful destinations (empty land, transport, greens, homes). */
const PLOT_WELLBEING: ReadonlyMap<number, number> = new Map<number, number>([
  [BuiltKind.Industrial, -4], // smokestacks, trucks, grime — a hard place to spend a day
  [BuiltKind.CommercialStrip, 1],
  [BuiltKind.Offices, 1],
  [BuiltKind.WastewaterWorks, 1],
  [BuiltKind.EnergyNode, 1],
  [BuiltKind.Civic, 2],
  [BuiltKind.AINode, 2],
  [BuiltKind.CompostHub, 2],
  [BuiltKind.Bazaar, 3], // new-urbanist commerce — lively, human-scaled
  [BuiltKind.MakerSpace, 3],
  [BuiltKind.VerticalFarm, 3],
  [BuiltKind.HealingCommons, 4], // the most restorative destination
]);

/** The new-urbanist (tech-tree restorative) plots that hand back a status BUFF on top of
 *  their base wellbeing — the modifier a citizen carries home. */
const NEW_URBANIST: ReadonlySet<number> = new Set<number>([
  BuiltKind.Bazaar,
  BuiltKind.MakerSpace,
  BuiltKind.VerticalFarm,
  BuiltKind.CompostHub,
  BuiltKind.HealingCommons,
  BuiltKind.AINode,
]);

/** Base wellbeing of visiting a plot of `kind` (0 for non-destinations). */
export function plotWellbeing(kind: number): number {
  return PLOT_WELLBEING.get(kind) ?? 0;
}

/** True for the higher-tier new-urbanist plots that grant a carried-home status buff. */
export function isNewUrbanist(kind: number): boolean {
  return NEW_URBANIST.has(kind);
}

/** The extra status buff a new-urbanist plot grants beyond its base wellbeing. */
export const NEW_URBANIST_BUFF = 2;
export function plotBuff(kind: number): number {
  return isNewUrbanist(kind) ? NEW_URBANIST_BUFF : 0;
}

/** Total wellbeing a citizen carries home from one visit to `kind`: base + any buff. The
 *  single value the building-health layer deposits at the citizen's home. */
export function visitValue(kind: number): number {
  return plotWellbeing(kind) + plotBuff(kind);
}
