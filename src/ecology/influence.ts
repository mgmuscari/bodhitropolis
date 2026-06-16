// Ecology influence table: the per-BuiltKind contribution the land feels from
// what is built on (and near) it, plus the structural constants the ecology tick
// runs on. Pure engine-adjacent module — no DOM, no transcendental Math, no rng
// (the architecture guard scans src/ecology). It reads only the fabric taxonomy
// (BuiltKind), never tech or world state.
//
// The numbers here are PLACEHOLDER ecology (like the effort economy): the tested
// contract is the SIGNS (boosts positive, suppressors negative) and the
// road-diet `fragmenting` flag — never the magnitudes, which a later tuning
// feature will set once the civic sim consumes them.

import { BuiltKind } from '../engine/fabric';

/**
 * Per-tick ecology deltas a built tile scatters over its {@link RADIUS} box, plus
 * the fauna-impassability flag. soil/flora/fauna are signed integer deltas (a
 * boost is positive, a suppressor negative); `fragmenting === true` marks a busy
 * road that fauna cannot cross (and whose own fauna is pinned to 0 in the tick).
 */
// Fields are `readonly`: influenceOf() returns SHARED singletons (the same
// Map-entry object for every tile of a kind, and ZERO_INFLUENCE for every neutral
// kind), so a consumer that mutated a returned KindInfluence would silently poison
// the global table for ALL tiles of that kind. The read-only contract enforces the
// house single-writer discipline at the type level (code-review Task 2 Minor).
export interface KindInfluence {
  readonly soil: number;
  readonly flora: number;
  readonly fauna: number;
  readonly fragmenting: boolean;
}

/** The neutral influence — what every off-table (neutral-by-default) kind feels. */
export const ZERO_INFLUENCE: KindInfluence = { soil: 0, flora: 0, fauna: 0, fragmenting: false };

/**
 * Kinds whose tile, though parcel-covered, is NOT sealed pavement: the rezoning
 * greens (Park, RewildedLand) are depaved land, so the ecology tick must exempt
 * them from the parcel-cover soil cap (see {@link isUnsealed} use in tick.ts).
 * Lives here — keyed on kind exactly like {@link influenceOf} — so the read-only
 * tick gains no new import direction (it already imports from this module).
 */
export const UNSEALED_KINDS: ReadonlySet<BuiltKind> = new Set<BuiltKind>([
  BuiltKind.Park,
  BuiltKind.RewildedLand,
]);

/** True iff `kind` is a depaved green (parcel-covered but unsealed — soil heals). */
export const isUnsealed = (k: number): boolean => UNSEALED_KINDS.has(k as BuiltKind);

/** Ecology runs once every ECO_CADENCE sim ticks (main.ts gates `tick % ECO_CADENCE`). */
export const ECO_CADENCE = 10;
/** Influence scatter radius: a built tile affects the (2*RADIUS+1)² box around it. */
export const RADIUS = 2;

// The table. Signs are the contract; magnitudes are placeholder.
//
//   Boosts (strictly positive on all three axes, never fragmenting):
//     CommunityGarden — the strongest soil boost in the table
//     CompostHub      — a strong soil boost
//     Parklet         — a balanced green amenity
//     QuietStreet / Promenade / BikePath — mild, and crucially NON-fragmenting:
//       the road-diet payoff lives in this flag. A calm corridor still nudges
//       the land green AND lets fauna relay across it (CORRIDOR_FLOOR in tick.ts).
//
//   Suppressors (strictly negative on all three axes):
//     RoadHighway          — strong, and fragmenting (impassable to fauna)
//     RoadAvenue/RoadStreet — milder, and fragmenting
//     ParkingLot/Industrial — strong suppressors but NOT fragmenting (they are
//       buildings, not crossable road barriers; their pavement caps soil via the
//       parcel-cover rule in tick.ts, not via this flag).
export const INFLUENCE: ReadonlyMap<BuiltKind, KindInfluence> = new Map<BuiltKind, KindInfluence>([
  // Boosts
  [BuiltKind.CommunityGarden, { soil: 6, flora: 3, fauna: 2, fragmenting: false }],
  [BuiltKind.CompostHub, { soil: 4, flora: 1, fauna: 1, fragmenting: false }],
  [BuiltKind.Parklet, { soil: 2, flora: 3, fauna: 2, fragmenting: false }],
  [BuiltKind.QuietStreet, { soil: 1, flora: 1, fauna: 1, fragmenting: false }],
  [BuiltKind.Promenade, { soil: 1, flora: 1, fauna: 1, fragmenting: false }],
  [BuiltKind.BikePath, { soil: 1, flora: 1, fauna: 1, fragmenting: false }],
  // Rezoning greens — depaved, soil-healing land. Soil must stay < 6 (the
  // CommunityGarden-strongest ceiling, pinned by influence.test.ts); RewildedLand
  // is the stronger soil (still < garden). Magnitudes placeholder; signs the contract.
  [BuiltKind.Park, { soil: 2, flora: 2, fauna: 1, fragmenting: false }],
  [BuiltKind.RewildedLand, { soil: 3, flora: 2, fauna: 2, fragmenting: false }],
  // Suppressors
  [BuiltKind.RoadHighway, { soil: -5, flora: -4, fauna: -3, fragmenting: true }],
  [BuiltKind.RoadAvenue, { soil: -3, flora: -2, fauna: -2, fragmenting: true }],
  [BuiltKind.RoadStreet, { soil: -2, flora: -1, fauna: -1, fragmenting: true }],
  [BuiltKind.ParkingLot, { soil: -4, flora: -3, fauna: -2, fragmenting: false }],
  [BuiltKind.Industrial, { soil: -4, flora: -3, fauna: -2, fragmenting: false }],
]);

/**
 * The influence of `kind`: its explicit table entry, or {@link ZERO_INFLUENCE} for
 * every neutral-by-default kind (empty land, housing, civic, rail, …). Total over
 * the whole BuiltKind taxonomy — no kind is ever undefined.
 */
export function influenceOf(kind: number): KindInfluence {
  return INFLUENCE.get(kind as BuiltKind) ?? ZERO_INFLUENCE;
}
