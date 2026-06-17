// Travel modes: how a citizen covers a leg of its daily round. A DATA-DRIVEN table so the set of
// modes is OPEN — a new transit choice (gondola, ferry, BRT…) is just another entry here plus the
// BuiltKind it rides. Each mode = the network it rides FAST on, its speed on/off that network (as a
// multiple of walking), its routing cost on-network (so the mover hugs the line), and whether it is
// pavement-only (a car can't cross wild ground). Pure mapping over BuiltKind (no DOM, no rng, no
// transcendental Math) — the map-aware glue (can-enter, per-tile cost/speed) lives in the live layer.
//
// The mode-choice arithmetic (close → walk; build rail/streetcar/bike → citizens shift onto them;
// drive only when nothing else reaches) is what turns the player's road-diet into the bloom loop.

import { BuiltKind } from '../engine/fabric';

/** A way a citizen travels a leg. Walk is the always-available default; the rest need infrastructure. */
export const TravelMode = {
  Walk: 0,
  Bike: 1,
  Streetcar: 2,
  ElevatedRail: 3,
  Drive: 4,
} as const;
export type TravelMode = (typeof TravelMode)[keyof typeof TravelMode];

export interface ModeSpec {
  id: TravelMode;
  label: string;
  /** BuiltKinds this mode rides FAST on (its network). Empty ⇒ no acceleration (Walk). */
  network: ReadonlySet<number>;
  /** Speed ON the network, as a multiple of walking speed. */
  networkSpeed: number;
  /** Speed OFF the network (walking to/from a stop, or cycling on a street), × walking. */
  baseSpeed: number;
  /** Routing cost on the network (lower = the mover hugs the line rather than cutting across). */
  networkCost: number;
  /** True if this mode can ONLY occupy paved/road tiles (a car can't cross wild ground or a
   *  promenade). Active/transit modes are not pavement-only — riders walk to and from the line. */
  pavementOnly: boolean;
}

const MODES: Readonly<Record<TravelMode, ModeSpec>> = {
  [TravelMode.Walk]: {
    id: TravelMode.Walk,
    label: 'walk',
    network: new Set<number>(),
    networkSpeed: 1,
    baseSpeed: 1,
    networkCost: 0,
    pavementOnly: false,
  },
  [TravelMode.Bike]: {
    id: TravelMode.Bike,
    label: 'bike',
    network: new Set<number>([BuiltKind.BikePath]),
    networkSpeed: 2.5,
    baseSpeed: 1.6, // a bike is faster than walking even on a plain street
    networkCost: 0.25,
    pavementOnly: false,
  },
  [TravelMode.Streetcar]: {
    id: TravelMode.Streetcar,
    label: 'streetcar',
    network: new Set<number>([BuiltKind.Streetcar]),
    networkSpeed: 3.5,
    baseSpeed: 1, // walk to the stop, ride the line, walk off
    networkCost: 0.2,
    pavementOnly: false,
  },
  [TravelMode.ElevatedRail]: {
    id: TravelMode.ElevatedRail,
    label: 'rail',
    network: new Set<number>([BuiltKind.ElevatedRail]),
    networkSpeed: 4.5,
    baseSpeed: 1,
    networkCost: 0.2,
    pavementOnly: false,
  },
  [TravelMode.Drive]: {
    id: TravelMode.Drive,
    label: 'drive',
    network: new Set<number>([
      BuiltKind.RoadStreet,
      BuiltKind.RoadAvenue,
      BuiltKind.RoadHighway,
      BuiltKind.ParkingLot,
    ]),
    networkSpeed: 2.4, // ≈ CAR_SPEED / PED_SPEED
    baseSpeed: 2.4,
    networkCost: 0.3,
    pavementOnly: true,
  },
};

/** The full spec for a mode. */
export function modeSpec(mode: TravelMode): ModeSpec {
  return MODES[mode];
}

/** Does `mode` ride FAST on a tile of this kind (is it on the mode's network)? */
export function modeRidesNetwork(mode: TravelMode, kind: number): boolean {
  return MODES[mode].network.has(kind);
}

/** The speed multiplier (× walking) for `mode` on a tile of this kind: its network speed on the
 *  network, its base speed elsewhere. */
export function modeSpeedMult(mode: TravelMode, kind: number): number {
  const s = MODES[mode];
  return s.network.has(kind) ? s.networkSpeed : s.baseSpeed;
}

/** Premium modes in preference order, fastest/greenest first. The chooser tries each (subject to
 *  the infrastructure being near both ends of the leg) before falling back to walking. Extend this
 *  to surface a new transit choice in mode choice. */
export const MODE_CHOICE_ORDER: readonly TravelMode[] = [
  TravelMode.ElevatedRail,
  TravelMode.Streetcar,
  TravelMode.Bike,
  TravelMode.Drive,
];
