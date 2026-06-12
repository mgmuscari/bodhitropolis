// Communal-effort accrual: the per-tick work the sim loop does, now backed by a
// real three-system WELLBEING composition. Effort is the floor of a weighted sum
// of four healthy-city signals — population, building condition, ecology, and
// civic life — clamped to ≥1:
//
//   wellbeing = floor( alive/8 + conditionMean/32 + ecoMean/48 + civicMean/24 )
//   effort    = max(1, wellbeing)
//
// where ecoMean  = floor((soil + flora + fauna) / 3)  from the ecology means, and
//       civicMean = floor((belonging + voice + trust)/3) from the civic means.
//
// The weights (8/32/48/24) are TUNING DATA: the tested contract is the directional
// composition (effort is non-decreasing in each signal, strictly increasing across
// a quantization step) and integer-ness, never the magnitudes — a balancing
// feature will set them once the city economy is played.
//
// ONE OUTER FLOOR over the summed terms (not a sum of per-term floors). This is
// exactly what makes the absent-input path byte-identical to the old formula:
// floor(a + b + 0 + 0) == floor(a + b). The ecoMeans/civicMeans are OPTIONAL —
// supplied by the composite orchestrator after each ecology/civic recompute and
// absent until the first one (pre-civic saves/tests stay valid); absent ⇒ that
// term contributes a literal 0. The means are FLOATS (the reports divide without
// flooring); ecoMean/civicMean floor those float inputs, harmless under the single
// outer floor (nested-floor identity) but kept so the per-axis means read as the
// integer counts they model.
//
// Pure module: no DOM, no rng, no Date, no transcendental Math. The world is typed
// STRUCTURALLY — `parcels` plus two optional plain-shaped means — so src/tech never
// imports worldgen, ecology, or civic (the architecture guard asserts this).

import type { ParcelStore } from '../engine/fabric';
import type { TechState } from './state';

/**
 * The slice of the world effort accrual reads: the parcel store, plus the OPTIONAL
 * ecology/civic citywide means the composite orchestrator caches after each
 * recompute. Both are absent until the first recompute — and a degenerate (no
 * land / no neighborhoods) report supplies them as 0 — so each contributes 0 by
 * default and the formula degrades exactly to the pre-civic one.
 */
export interface EffortWorld {
  parcels: ParcelStore;
  /** Citywide ecology means (floats). Absent ⇒ the ecology term contributes 0. */
  ecoMeans?: { soil: number; flora: number; fauna: number };
  /** Citywide civic means (floats). Absent ⇒ the civic term contributes 0. */
  civicMeans?: { belonging: number; voice: number; trust: number };
}

/**
 * Wellbeing: the pre-max composite integer effort derives from (and the pulse
 * line displays). ALWAYS a finite integer. The zero-parcel guard stays
 * load-bearing: without it conditionMean = 0/0 = NaN and the whole expression
 * poisons; with it an empty world contributes 0 from the population/condition
 * terms (and 0 from any absent means), so wellbeing is 0 there.
 */
export function wellbeing(world: EffortWorld): number {
  const { parcels } = world;
  const alive = parcels.aliveCount();
  let sumCondition = 0;
  for (const i of parcels.aliveIndices()) sumCondition += parcels.conditionAt(i);
  const conditionMean = alive === 0 ? 0 : Math.floor(sumCondition / alive);

  const ecoMean = world.ecoMeans
    ? Math.floor((world.ecoMeans.soil + world.ecoMeans.flora + world.ecoMeans.fauna) / 3)
    : 0;
  const civicMean = world.civicMeans
    ? Math.floor((world.civicMeans.belonging + world.civicMeans.voice + world.civicMeans.trust) / 3)
    : 0;

  return Math.floor(alive / 8 + conditionMean / 32 + ecoMean / 48 + civicMean / 24);
}

/**
 * Effort produced per tick: ALWAYS a finite integer ≥ 1 — exactly
 * `max(1, wellbeing(world))`, so the pulse line and the economy read the SAME
 * wellbeing scalar without recomputing it.
 */
export function effortPerTick(world: EffortWorld): number {
  return Math.max(1, wellbeing(world));
}

/**
 * Accrue `ticks` ticks of effort into `state`. The per-tick rate is computed
 * once (the world is constant within a frame for now), so the gain is exactly
 * `ticks * effortPerTick(world)`. Returns the amount gained.
 */
export function accrue(state: TechState, world: EffortWorld, ticks: number): number {
  const gained = ticks * effortPerTick(world);
  state.effort += gained;
  return gained;
}
