// Power grid: the SC1989-style conduction model. Any built tile conducts, so the
// grid = the 4-connected components of the built layer. A component with a plant is
// energized; its consumer parcels (R/C/I/Civic) draw power up to the component's
// total plant capacity — beyond that the component browns out and the FARTHEST-from-
// source consumers go dark first (power flows from the plant outward, a multi-source
// BFS distance; ties by anchor for determinism). Pure + deterministic in (map, parcels). Engine-
// layer discipline (the src/growth fail-closed guard): no DOM, no transcendental
// Math, no ui import. Recomputed live on a cadence (derived from the hashed built
// layer), like land value — never hashed itself.

import { ParcelStore, BuiltKind } from '../engine/fabric';
import type { GameMap } from '../engine/map';
import { ZoneType, zoneTypeOf } from '../engine/zone';

/** Generation capacity per plant kind (relative SC2000-ish scale). */
export const PLANT_OUTPUT: ReadonlyMap<number, number> = new Map<number, number>([
  [BuiltKind.CoalPlant, 60],
  [BuiltKind.GasPlant, 50],
  [BuiltKind.HydroPlant, 35],
  [BuiltKind.NuclearPlant, 200],
  [BuiltKind.WindTurbine, 8],
  [BuiltKind.SolarPlant, 30],
  [BuiltKind.FusionPlant, 500],
  [BuiltKind.EnergyNode, 24], // distributed community microgrid
]);

// Power demand per unit density, by zone class. Industry is the hungriest, homes the
// least — the classic R<C<I load curve. Civic services draw a flat-ish mid load.
const DEMAND_PER_DENSITY: ReadonlyMap<ZoneType, number> = new Map<ZoneType, number>([
  [ZoneType.Residential, 1],
  [ZoneType.Commercial, 2],
  [ZoneType.Industrial, 3],
  [ZoneType.Civic, 2],
]);

// Air pollution emitted per stepAmbient pass by the DIRTY combustion plants — coal
// the worst, gas cleaner. Hydro/Nuclear/Wind/Solar/Fusion and the distributed
// EnergyNode are clean (0), so the renewable transition visibly clears the smog.
const PLANT_POLLUTION: ReadonlyMap<number, number> = new Map<number, number>([
  [BuiltKind.CoalPlant, 6],
  [BuiltKind.GasPlant, 4],
]);

/** A parcel's power output (plant) — 0 for non-plants. */
export function plantOutput(kind: number): number {
  return PLANT_OUTPUT.get(kind) ?? 0;
}

/** Air pollution a plant emits per pass — 0 for clean plants and non-plants. */
export function plantPollution(kind: number): number {
  return PLANT_POLLUTION.get(kind) ?? 0;
}

/** A parcel's power demand from its kind + density — 0 for non-consumers (greens/transport/plants). */
export function powerDemand(kind: number, density: number): number {
  const per = DEMAND_PER_DENSITY.get(zoneTypeOf(kind)) ?? 0;
  return per * (density > 0 ? density : 0);
}

/** True iff a kind draws power (an R/C/I/Civic consumer). */
export function isPowerConsumer(kind: number): boolean {
  return DEMAND_PER_DENSITY.has(zoneTypeOf(kind));
}

export interface PowerGrid {
  /** Anchor tiles of consumer parcels that ARE powered this tick. */
  poweredAnchors: Set<number>;
  /** Total generation capacity across all plants on the map. */
  capacity: number;
  /** Total demand across all consumer parcels. */
  demand: number;
}

interface ConsumerRef {
  anchor: number;
  demand: number;
}

/**
 * Compute the live power grid: flood-fill the built layer into conductive
 * components, then per component with a plant, power its consumers greedily
 * (ascending anchor) up to the component's capacity — the rest brown out. Consumers
 * in a plantless component are unpowered. Returns the powered consumer anchors plus
 * global capacity/demand totals. Pure + deterministic.
 */
export function computePowerGrid(map: GameMap, parcels: ParcelStore): PowerGrid {
  const size = map.width * map.height;
  const built = map.built;

  // 1. 4-connected components over built tiles (ascending-index scan, BFS).
  const comp = new Int32Array(size).fill(-1);
  let nComp = 0;
  const queue: number[] = [];
  for (let start = 0; start < size; start++) {
    if (built[start] === 0 || comp[start] !== -1) continue;
    const id = nComp++;
    comp[start] = id;
    queue.length = 0;
    queue.push(start);
    while (queue.length > 0) {
      const t = queue.pop()!;
      const x = t % map.width;
      const y = (t - x) / map.width;
      const neigh = [
        x > 0 ? t - 1 : -1,
        x < map.width - 1 ? t + 1 : -1,
        y > 0 ? t - map.width : -1,
        y < map.height - 1 ? t + map.width : -1,
      ];
      for (const n of neigh) {
        if (n >= 0 && built[n] !== 0 && comp[n] === -1) {
          comp[n] = id;
          queue.push(n);
        }
      }
    }
  }

  // 2. Bucket plant capacity + consumer demand by component; collect plant footprint tiles as the
  //    BFS sources for the distance-from-source ordering below.
  const capByComp = new Float64Array(nComp);
  const consumersByComp: ConsumerRef[][] = Array.from({ length: nComp }, () => []);
  const plantTiles: number[] = [];
  let capacity = 0;
  let demand = 0;
  for (const i of parcels.aliveIndices()) {
    const p = parcels.get(i);
    const anchor = map.idx(p.x, p.y);
    const c = comp[anchor]!;
    if (c < 0) continue;
    const out = plantOutput(p.kind);
    if (out > 0) {
      capByComp[c] = capByComp[c]! + out;
      capacity += out;
      for (let dy = 0; dy < p.height; dy++) {
        for (let dx = 0; dx < p.width; dx++) plantTiles.push(map.idx(p.x + dx, p.y + dy));
      }
      continue;
    }
    const d = powerDemand(p.kind, p.density);
    if (d > 0) {
      consumersByComp[c]!.push({ anchor, demand: d });
      demand += d;
    }
  }

  // 2b. Distance from the nearest power source, by network distance through the conducting built
  //     layer — a multi-source BFS seeded from every plant tile. Powers flow from the source OUTWARD,
  //     so a brownout sheds the FARTHEST plots first (Maddy: plots nearer the source get power first).
  const dist = new Int32Array(size).fill(-1);
  const bfs: number[] = [];
  for (const t of plantTiles) {
    if (dist[t] === -1) {
      dist[t] = 0;
      bfs.push(t);
    }
  }
  for (let head = 0; head < bfs.length; head++) {
    const t = bfs[head]!;
    const x = t % map.width;
    const y = (t - x) / map.width;
    const neigh = [
      x > 0 ? t - 1 : -1,
      x < map.width - 1 ? t + 1 : -1,
      y > 0 ? t - map.width : -1,
      y < map.height - 1 ? t + map.width : -1,
    ];
    for (const n of neigh) {
      if (n >= 0 && built[n] !== 0 && dist[n] === -1) {
        dist[n] = dist[t]! + 1;
        bfs.push(n);
      }
    }
  }

  // 3. Power consumers per component within its capacity, NEAREST the source first (ties by anchor for
  //    determinism). So the grid lights up around its plants and the brownout dims the far edges.
  const poweredAnchors = new Set<number>();
  for (let c = 0; c < nComp; c++) {
    let budget = capByComp[c]!;
    if (budget <= 0) continue; // plantless component → all dark
    const consumers = consumersByComp[c]!;
    consumers.sort((a, b) => dist[a.anchor]! - dist[b.anchor]! || a.anchor - b.anchor);
    for (const cons of consumers) {
      if (budget >= cons.demand) {
        budget -= cons.demand;
        poweredAnchors.add(cons.anchor);
      }
    }
  }

  return { poweredAnchors, capacity, demand };
}
