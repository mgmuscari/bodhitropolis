// Trip generation: the per-zone driver that turns parcel density into origin→destination
// traffic. Each R/C/I parcel, gated by its density (denser zones trip more — Micropolis's
// "tpop > rand(N)"), attempts a trip via makeTrip; the path of every found trip has
// density laid along it and is published for the renderer (cars ARE trips). Deterministic
// in `rng` (the per-tick traffic fork) + the index-ascending parcel order. Headless.

import type { GameMap } from '../engine/map';
import type { ParcelStore } from '../engine/fabric';
import { ZoneType, zoneTypeOf } from '../engine/zone';
import type { Rng } from '../engine/rng';
import { makeTrip, type Trip } from './trip';
import { layTraffic } from './density';

/** Generation gate by zone: a zone generates a trip iff `rng.nextInt(gate) < density`,
 *  so density-3 zones trip often and density-1 rarely. Commercial/industrial trip more
 *  eagerly than residential (more deliveries/commutes per unit). Live-pass tunable. */
const GEN_GATE_RES = 4;
const GEN_GATE_COM_IND = 2;

/** Generate this cadence's trips: lay density along found paths, return the found trips
 *  (for the renderer). Civic/None parcels don't generate (jobs/destinations, not sources). */
export function generateTraffic(map: GameMap, parcels: ParcelStore, rng: Rng): Trip[] {
  const trips: Trip[] = [];
  for (const i of parcels.aliveIndices()) {
    const zone = zoneTypeOf(parcels.kindAt(i));
    if (zone !== ZoneType.Residential && zone !== ZoneType.Commercial && zone !== ZoneType.Industrial) {
      continue;
    }
    const pop = parcels.densityAt(i);
    const gate = zone === ZoneType.Residential ? GEN_GATE_RES : GEN_GATE_COM_IND;
    if (rng.nextInt(gate) >= pop) continue; // population too low to generate this cadence
    const p = parcels.get(i);
    const trip = makeTrip(map, p.x, p.y, p.width, p.height, zone, rng);
    if (trip.found) {
      layTraffic(map, trip.path);
      trips.push(trip);
    }
  }
  return trips;
}
