// Citizen census: how many citizens each residential building houses, by density. This is
// the foundation of the citizen-agent transportation layer — each residential building
// spawns this many citizens, who travel to plots and carry wellbeing home, so a building's
// health emerges from where its people go. Pure: reads the parcel store only (no DOM, no
// rng, no transcendental Math), so the population is a deterministic function of the built
// city, computed the same in any environment.

import type { ParcelStore } from '../engine/fabric';
import { ZoneType, zoneTypeOf } from '../engine/zone';

/** Citizens housed per unit of residential density: a building of density d houses
 *  d × this. Placeholder magnitude — the tested contract is "denser → more, zero → none",
 *  not the constant (it tunes once the citizen economy is played). */
export const CITIZENS_PER_DENSITY = 3;

/** How many citizens a residential building of the given density houses. Non-positive
 *  density (an empty/derelict slot) houses nobody. */
export function citizensOf(density: number): number {
  return density > 0 ? density * CITIZENS_PER_DENSITY : 0;
}

/** A residential building's home anchor (tile coords) and how many citizens live there. */
export interface Household {
  x: number;
  y: number;
  count: number;
}

/** Every residential building (by zoneTypeOf) paired with its citizen count — the homes the
 *  agent layer spawns citizens from. Deterministic over the parcel store's alive set; skips
 *  commercial/industrial/civic/greens (they are trip DESTINATIONS, not homes). */
export function residentialCensus(parcels: ParcelStore): Household[] {
  const out: Household[] = [];
  for (const i of parcels.aliveIndices()) {
    if (zoneTypeOf(parcels.kindAt(i)) !== ZoneType.Residential) continue;
    const p = parcels.get(i);
    out.push({ x: p.x, y: p.y, count: citizensOf(p.density) });
  }
  return out;
}

/** Total residents across the city — the sum of every residential building's citizen count. */
export function totalResidents(parcels: ParcelStore): number {
  let n = 0;
  for (const h of residentialCensus(parcels)) n += h.count;
  return n;
}
