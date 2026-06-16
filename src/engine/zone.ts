// Zone taxonomy: the pure mapping from a built tile kind to its RCI zone class.
// Engine-level (a fact about BuiltKind, peer to `isRoadKind`/`transportCategory`) so
// BOTH the traffic O-D pathfinder (which destination a trip seeks) and the growth/demand
// layer (which valve a parcel answers to) can import it without a cross-layer cycle.
// Total over every BuiltKind via a ReadonlyMap + None fallback. Headless + deterministic.

import { BuiltKind } from './fabric';

/** The RCI zone class of a built parcel (or None for transport/greens/empty). */
export const ZoneType = {
  None: 0,
  Residential: 1,
  Commercial: 2,
  Industrial: 3,
  Civic: 4,
} as const;
export type ZoneType = (typeof ZoneType)[keyof typeof ZoneType];

// Building kinds → zone class. Anything absent (empty land, transport 1..15, parking,
// parklets/gardens/parks/rewilded greens) is None — not a growth/demand participant.
const ZONE_OF: ReadonlyMap<number, ZoneType> = new Map<number, ZoneType>([
  // Residential — homes of every era.
  [BuiltKind.HouseSingle, ZoneType.Residential],
  [BuiltKind.Apartments, ZoneType.Residential],
  [BuiltKind.Projects, ZoneType.Residential],
  [BuiltKind.ADU, ZoneType.Residential],
  [BuiltKind.CoopHousing, ZoneType.Residential],
  [BuiltKind.Commune, ZoneType.Residential],
  // Commercial — shops, offices, markets, makers.
  [BuiltKind.CommercialStrip, ZoneType.Commercial],
  [BuiltKind.Offices, ZoneType.Commercial],
  [BuiltKind.Bazaar, ZoneType.Commercial],
  [BuiltKind.MakerSpace, ZoneType.Commercial],
  // Industrial.
  [BuiltKind.Industrial, ZoneType.Industrial],
  // Civic / amenity services — jobs + a trip destination, but not RCI-demand-driven.
  [BuiltKind.Civic, ZoneType.Civic],
  [BuiltKind.HealingCommons, ZoneType.Civic],
  [BuiltKind.VerticalFarm, ZoneType.Civic],
  [BuiltKind.WastewaterWorks, ZoneType.Civic],
  [BuiltKind.EnergyNode, ZoneType.Civic],
  [BuiltKind.AINode, ZoneType.Civic],
  [BuiltKind.CompostHub, ZoneType.Civic],
]);

/** The zone class of a built kind, or None for non-zone tiles. Total. */
export function zoneTypeOf(kind: number): ZoneType {
  return ZONE_OF.get(kind) ?? ZoneType.None;
}
