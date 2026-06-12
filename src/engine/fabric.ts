// Built-environment taxonomy: the kinds of thing that can occupy a tile's
// `built` layer. Like the map enums (see map.ts), these are `as const` objects
// + literal-union types rather than `const enum` — esbuild does not erase
// cross-module const enums, which silently breaks them in production builds.
//
// Code ranges are reserved deliberately so the taxonomy can grow without
// renumbering (no save format exists yet, so this is a cheap bet):
//   0       None (empty tile)
//   1..15   transport (roads 1..3, rail 4; 5..15 reserved for transit kinds)
//   16..47  Moses-era buildings
//   48+     reserved for tech-tree-era kinds (parklets, co-ops, communes...)

export const BuiltKind = {
  None: 0,
  // transport 1..15
  RoadStreet: 1,
  RoadAvenue: 2,
  RoadHighway: 3,
  Rail: 4,
  // Moses-era buildings 16..47
  HouseSingle: 16,
  Apartments: 17,
  Projects: 18,
  CommercialStrip: 19,
  Offices: 20,
  Industrial: 21,
  ParkingLot: 22,
  Civic: 23,
  // 48+ reserved for tech-tree-era kinds (parklets, co-ops, communes...)
} as const;
export type BuiltKind = (typeof BuiltKind)[keyof typeof BuiltKind];

/** Roads (street/avenue/highway). Rail is transport but not a road. */
export const isRoadKind = (k: number): boolean => k >= 1 && k <= 3;
/** Any transport kind: roads or rail. */
export const isTransportKind = (k: number): boolean => k >= 1 && k <= 4;
/** Any building kind, including reserved-but-unused codes in 24..47. */
export const isBuildingKind = (k: number): boolean => k >= 16 && k <= 47;
