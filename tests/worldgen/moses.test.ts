import { describe, it, expect } from 'vitest';
import { runPipeline, type WorldgenStage, type WorldState } from '../../src/worldgen/pipeline';
import { GameMap, Water } from '../../src/engine/map';
import { createRng } from '../../src/engine/rng';
import { terrainStage } from '../../src/worldgen/terrain';
import {
  BuiltKind,
  isRoadKind,
  hashWorld,
  parcelTouchesRoad,
  checkParcelAgreement,
} from '../../src/engine/fabric';
import {
  createMosesState,
  era1Founding,
  era2MotorAge,
  era3Highways,
  era4Suburbs,
  era5Disinvestment,
  mosesCenturyStage,
  DEFAULT_MOSES_PARAMS,
  type MosesParams,
  type MosesState,
} from '../../src/worldgen/moses';
import { boxDensity, distanceField } from '../../src/worldgen/fields';

const SEEDS = ['moses-1', 'moses-2', 'moses-3'];
const P = DEFAULT_MOSES_PARAMS;

// The era functions in order; the test runner forks each era's rng exactly the
// way the stage does, so a prefix of history is reproducible and measurable.
const ERAS = [era1Founding, era2MotorAge, era3Highways, era4Suburbs, era5Disinvestment] as const;
const ERA_NAMES = ['era1', 'era2', 'era3', 'era4', 'era5'] as const;

function runFullStage(seed: string, width = 128, height = 128): WorldState {
  return runPipeline({ seed, width, height }, [terrainStage(), mosesCenturyStage()]);
}

// Runs terrain, then the first `n` eras, forking each era rng like the stage.
function runEras(
  seed: string,
  n: number,
  width = 128,
  height = 128,
  params: MosesParams = P,
): { world: WorldState; state: MosesState } {
  const world = runPipeline({ seed, width, height }, [terrainStage()]);
  const state = createMosesState();
  for (let k = 0; k < n; k++) ERAS[k]!(world, createRng(seed).fork(ERA_NAMES[k]!), params, state);
  return { world, state };
}

function runEra1(seed: string, width = 128, height = 128): { world: WorldState; state: MosesState } {
  return runEras(seed, 1, width, height);
}

function aliveKindCount(world: WorldState, kind: number): number {
  const { parcels } = world;
  let c = 0;
  for (const i of parcels.aliveIndices()) if (parcels.kindAt(i) === kind) c++;
  return c;
}

// All road tiles, and the size of the connected component reachable from the
// first one (4-connected over road kinds).
function roadNetwork(map: GameMap): { total: number; largestComponent: number } {
  const { width, height } = map;
  const isRoad = (i: number) => isRoadKind(map.built[i]!);
  const all: number[] = [];
  for (let i = 0; i < width * height; i++) if (isRoad(i)) all.push(i);
  if (all.length === 0) return { total: 0, largestComponent: 0 };
  const seen = new Uint8Array(width * height);
  let largest = 0;
  for (const start of all) {
    if (seen[start]) continue;
    let size = 0;
    const queue = [start];
    seen[start] = 1;
    let head = 0;
    while (head < queue.length) {
      const i = queue[head++]!;
      size++;
      const x = i % width;
      const y = (i - x) / width;
      for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]] as const) {
        if (!map.inBounds(nx, ny)) continue;
        const ni = map.idx(nx, ny);
        if (!seen[ni] && isRoad(ni)) {
          seen[ni] = 1;
          queue.push(ni);
        }
      }
    }
    if (size > largest) largest = size;
  }
  return { total: all.length, largestComponent: largest };
}

// Connected components of Rail tiles (4-connected), each as a list of [x, y].
function railComponents(map: GameMap): Array<Array<[number, number]>> {
  const { width, height } = map;
  const isRail = (i: number) => map.built[i] === BuiltKind.Rail;
  const seen = new Uint8Array(width * height);
  const comps: Array<Array<[number, number]>> = [];
  for (let s = 0; s < width * height; s++) {
    if (!isRail(s) || seen[s]) continue;
    const comp: Array<[number, number]> = [];
    const queue = [s];
    seen[s] = 1;
    let head = 0;
    while (head < queue.length) {
      const i = queue[head++]!;
      const x = i % width;
      const y = (i - x) / width;
      comp.push([x, y]);
      for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]] as const) {
        if (!map.inBounds(nx, ny)) continue;
        const ni = map.idx(nx, ny);
        if (!seen[ni] && isRail(ni)) {
          seen[ni] = 1;
          queue.push(ni);
        }
      }
    }
    comps.push(comp);
  }
  return comps;
}

describe('era1Founding determinism', () => {
  it('produces an identical canonical hash for the same seed', () => {
    expect(hashWorld(runEra1('moses-1').world)).toBe(hashWorld(runEra1('moses-1').world));
  });

  it('produces different canonical hashes for different seeds', () => {
    expect(hashWorld(runEra1('moses-1').world)).not.toBe(hashWorld(runEra1('moses-2').world));
  });
});

describe('era1Founding settlement', () => {
  for (const seed of SEEDS) {
    it(`seed "${seed}": founds the town and chronicles it`, () => {
      const { world, state } = runEra1(seed);
      expect(state.founded).toBe(true);
      expect(world.log.some((l) => l.startsWith('era1:'))).toBe(true);
    });

    it(`seed "${seed}": street network is a single connected component`, () => {
      const { map } = runEra1(seed).world;
      const net = roadNetwork(map);
      expect(net.total).toBeGreaterThanOrEqual(100); // a real grid, not confetti
      expect(net.largestComponent).toBe(net.total); // single component
    });

    it(`seed "${seed}": rail runs as radial extensions only (yield point 1)`, () => {
      const { world, state } = runEra1(seed);
      const { map } = world;
      const comps = railComponents(map);
      const big = comps.filter((c) => c.length >= 6);
      expect(big.length).toBeGreaterThanOrEqual(2); // >= 2 extensions of >= 6 tiles

      // Zero rail tiles inside the grid bounding box.
      for (const comp of comps) {
        for (const [x, y] of comp) {
          const inGrid = x >= state.gridX0 && x <= state.gridX1 && y >= state.gridY0 && y <= state.gridY1;
          expect(inGrid).toBe(false);
        }
      }

      // Each big extension begins 4-adjacent to an arterial end.
      const ends: Array<[number, number]> = [
        [state.gridX1, state.arterialRow],
        [state.gridX0, state.arterialRow],
        [state.arterialCol, state.gridY0],
        [state.arterialCol, state.gridY1],
      ];
      for (const comp of big) {
        const touchesEnd = comp.some(([x, y]) =>
          ends.some(([ex, ey]) => Math.abs(x - ex) + Math.abs(y - ey) === 1),
        );
        expect(touchesEnd).toBe(true);
      }

      // railPeak chronicles the total rail tile count.
      let railTiles = 0;
      for (let i = 0; i < map.built.length; i++) if (map.built[i] === BuiltKind.Rail) railTiles++;
      expect(state.railPeak).toBe(railTiles);
      expect(state.railPeak).toBeGreaterThanOrEqual(12); // >= 2 lines * 6 tiles
    });

    it(`seed "${seed}": grows a coherent early fabric (civic, commerce, housing)`, () => {
      const { world } = runEra1(seed);
      expect(aliveKindCount(world, BuiltKind.Civic)).toBeGreaterThanOrEqual(1);
      expect(aliveKindCount(world, BuiltKind.CommercialStrip)).toBeGreaterThanOrEqual(3);
      expect(aliveKindCount(world, BuiltKind.HouseSingle)).toBeGreaterThanOrEqual(15);
    });

    it(`seed "${seed}": every alive parcel touches a road; tiles agree with the store`, () => {
      const { world } = runEra1(seed);
      const { map, parcels } = world;
      for (const i of parcels.aliveIndices()) {
        expect(parcelTouchesRoad(map, parcels, i)).toBe(true);
      }
      expect(checkParcelAgreement(map, parcels)).toEqual([]);
    });
  }
});

// Manhattan distance from any tile of parcel `i`'s footprint to the nearest
// rail or water tile, capped at `cap` (searches a small neighbourhood).
function nearRailOrWater(map: GameMap, parcels: WorldState['parcels'], i: number, cap = 2): boolean {
  const e = parcels.get(i);
  for (let yy = e.y; yy < e.y + e.height; yy++) {
    for (let xx = e.x; xx < e.x + e.width; xx++) {
      for (let dy = -cap; dy <= cap; dy++) {
        for (let dx = -cap; dx <= cap; dx++) {
          if (Math.abs(dx) + Math.abs(dy) > cap) continue;
          const nx = xx + dx;
          const ny = yy + dy;
          if (!map.inBounds(nx, ny)) continue;
          const j = map.idx(nx, ny);
          if (map.built[j] === BuiltKind.Rail || map.water[j] !== Water.None) return true;
        }
      }
    }
  }
  return false;
}

function avenueTileCount(map: GameMap): number {
  let n = 0;
  for (let i = 0; i < map.built.length; i++) if (map.built[i] === BuiltKind.RoadAvenue) n++;
  return n;
}

describe('era2MotorAge determinism', () => {
  it('produces an identical canonical hash for the same seed', () => {
    expect(hashWorld(runEras('moses-1', 2).world)).toBe(hashWorld(runEras('moses-1', 2).world));
  });

  it('produces different canonical hashes for different seeds', () => {
    expect(hashWorld(runEras('moses-1', 2).world)).not.toBe(hashWorld(runEras('moses-2', 2).world));
  });
});

describe('era2MotorAge', () => {
  for (const seed of SEEDS) {
    it(`seed "${seed}": upgrades arterials to avenues (>= 20 tiles)`, () => {
      const { map } = runEras(seed, 2).world;
      expect(avenueTileCount(map)).toBeGreaterThanOrEqual(20);
    });

    it(`seed "${seed}": places industry on rail/water frontage`, () => {
      const { world } = runEras(seed, 2);
      const { map, parcels } = world;
      const industry = parcels.aliveIndices().filter((i) => parcels.kindAt(i) === BuiltKind.Industrial);
      expect(industry.length).toBeGreaterThanOrEqual(2);
      for (const i of industry) {
        expect(nearRailOrWater(map, parcels, i, P.industryFrontage)).toBe(true);
      }
    });

    it(`seed "${seed}": places at least one parking lot`, () => {
      const { world } = runEras(seed, 2);
      const parking = world.parcels.aliveIndices().filter((i) => world.parcels.kindAt(i) === BuiltKind.ParkingLot);
      expect(parking.length).toBeGreaterThanOrEqual(1);
    });

    it(`seed "${seed}": road network stays a single connected component`, () => {
      const { map } = runEras(seed, 2).world;
      const net = roadNetwork(map);
      expect(net.total).toBeGreaterThanOrEqual(100);
      expect(net.largestComponent).toBe(net.total);
    });

    it(`seed "${seed}": tiles still agree with the store`, () => {
      const { world } = runEras(seed, 2);
      expect(checkParcelAgreement(world.map, world.parcels)).toEqual([]);
    });
  }
});

// Connected-component sizes of a given built kind (4-connected).
function componentSizes(map: GameMap, kind: number): number[] {
  const { width, height } = map;
  const is = (i: number) => map.built[i] === kind;
  const seen = new Uint8Array(width * height);
  const sizes: number[] = [];
  for (let s = 0; s < width * height; s++) {
    if (!is(s) || seen[s]) continue;
    let size = 0;
    const queue = [s];
    seen[s] = 1;
    let head = 0;
    while (head < queue.length) {
      const i = queue[head++]!;
      size++;
      const x = i % width;
      const y = (i - x) / width;
      for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]] as const) {
        if (!map.inBounds(nx, ny)) continue;
        const ni = map.idx(nx, ny);
        if (!seen[ni] && is(ni)) {
          seen[ni] = 1;
          queue.push(ni);
        }
      }
    }
    sizes.push(size);
  }
  return sizes;
}

function countBuilt(map: GameMap, kind: number): number {
  let n = 0;
  for (let i = 0; i < map.built.length; i++) if (map.built[i] === kind) n++;
  return n;
}

// Min Manhattan distance from any footprint tile of parcel `i` to the nearest
// tile of `kind`, capped at `cap`.
function parcelNearKind(map: GameMap, parcels: WorldState['parcels'], i: number, kind: number, cap: number): boolean {
  const e = parcels.get(i);
  for (let yy = e.y; yy < e.y + e.height; yy++) {
    for (let xx = e.x; xx < e.x + e.width; xx++) {
      for (let dy = -cap; dy <= cap; dy++) {
        for (let dx = -cap; dx <= cap; dx++) {
          if (Math.abs(dx) + Math.abs(dy) > cap) continue;
          const nx = xx + dx;
          const ny = yy + dy;
          if (!map.inBounds(nx, ny)) continue;
          if (map.built[map.idx(nx, ny)] === kind) return true;
        }
      }
    }
  }
  return false;
}

// Runs eras 1-2, snapshots the pre-era-3 world (alive count, kind counts, and
// the pre-era-3 density field + its positive-value top-quartile threshold), then
// runs era 3. The snapshot is what makes the balance equation and the
// density-overlap invariant measurable without survivorship bias.
function runEra3(seed: string) {
  const { world, state } = runEras(seed, 2);
  const { map, parcels } = world;
  const aliveBefore = parcels.aliveCount();
  const projBefore = aliveKindCount(world, BuiltKind.Projects);
  const civicBefore = aliveKindCount(world, BuiltKind.Civic);
  const density = boxDensity(map, (i) => map.parcel[i] !== 0, P.era3DensityRadius);
  const positive = [...density].filter((v) => v > 0).sort((a, b) => a - b);
  const q75 = positive[Math.floor(0.75 * (positive.length - 1))]!;
  era3Highways(world, createRng(seed).fork('era3'), P, state);
  return { world, state, aliveBefore, projBefore, civicBefore, density, q75 };
}

describe('era3Highways determinism', () => {
  it('produces an identical canonical hash for the same seed', () => {
    expect(hashWorld(runEras('moses-1', 3).world)).toBe(hashWorld(runEras('moses-1', 3).world));
  });
});

describe('era3Highways', () => {
  for (const seed of SEEDS) {
    it(`seed "${seed}": carves a highway through the dense core`, () => {
      const { world, density, q75 } = runEra3(seed);
      const { map } = world;
      expect(countBuilt(map, BuiltKind.RoadHighway)).toBeGreaterThanOrEqual(20);

      const sizes = componentSizes(map, BuiltKind.RoadHighway).sort((a, b) => b - a);
      expect(sizes[0]).toBe(countBuilt(map, BuiltKind.RoadHighway)); // single connected run/cross

      // >= 5 highway tiles fall inside the pre-era-3 top-quartile density mask.
      let inMask = 0;
      for (let i = 0; i < map.built.length; i++) {
        if (map.built[i] === BuiltKind.RoadHighway && density[i]! >= q75) inMask++;
      }
      expect(inMask).toBeGreaterThanOrEqual(5);
    });

    it(`seed "${seed}": demolition balance equation holds (yield point 5b)`, () => {
      const { world, aliveBefore, projBefore } = runEra3(seed);
      const aliveAfter = world.parcels.aliveCount();

      const line = world.log.find((l) => /urban renewal/.test(l))!;
      const demolished = Number(/(\d+) parcels demolished/.exec(line)![1]);
      const projPlaced = Number(/(\d+) projects/.exec(line)![1]);
      const civicPlaced = Number(/(\d+) civic/.exec(line)![1]);

      expect(demolished).toBeGreaterThanOrEqual(5);
      // Chronicle honesty: projects are placed only after carving and none
      // pre-exist, so their kind-delta independently confirms the chronicled
      // placement count (a corridor cannot demolish a project).
      expect(aliveKindCount(world, BuiltKind.Projects) - projBefore).toBe(projPlaced);
      // Every alive-count change in era 3 is accounted for: demolitions out,
      // projects + civic in. (Net kind-deltas would conflate a demolished
      // era-1 civic with a placed one — the chronicled placement counts do not.)
      expect(aliveAfter).toBe(aliveBefore - demolished + projPlaced + civicPlaced);
    });

    it(`seed "${seed}": the streetcar is ripped out (rail <= 10% of peak)`, () => {
      const { world, state } = runEra3(seed);
      expect(countBuilt(world.map, BuiltKind.Rail)).toBeLessThanOrEqual(Math.floor(0.1 * state.railPeak));
    });

    it(`seed "${seed}": projects sit within 3 tiles of the highway`, () => {
      const { world } = runEra3(seed);
      const { map, parcels } = world;
      const projects = parcels.aliveIndices().filter((i) => parcels.kindAt(i) === BuiltKind.Projects);
      expect(projects.length).toBeGreaterThanOrEqual(2);
      for (const i of projects) {
        expect(parcelNearKind(map, parcels, i, BuiltKind.RoadHighway, 3)).toBe(true);
      }
    });

    it(`seed "${seed}": tiles still agree with the store`, () => {
      const { world } = runEra3(seed);
      expect(checkParcelAgreement(world.map, world.parcels)).toEqual([]);
    });
  }
});

const RESIDENTIAL_KINDS: number[] = [BuiltKind.HouseSingle, BuiltKind.Apartments, BuiltKind.Projects];

// Nearest road tile to (cx, cy) — mirrors era4's network-distance source.
function nearestRoad(map: GameMap, cx: number, cy: number): number {
  const maxR = map.width + map.height;
  for (let r = 0; r <= maxR; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const x = cx + dx;
        const y = cy + dy;
        if (!map.inBounds(x, y)) continue;
        if (isRoadKind(map.built[map.idx(x, y)]!)) return map.idx(x, y);
      }
    }
  }
  return -1;
}

// Road-network distance from the crossroads (BFS through road tiles only).
function roadNetDist(map: GameMap, state: MosesState): Int32Array {
  const src = nearestRoad(map, state.siteX, state.siteY);
  return distanceField(map, (i) => i === src, (i) => isRoadKind(map.built[i]!));
}

function farHouseCount(map: GameMap, parcels: WorldState['parcels'], net: Int32Array): number {
  let n = 0;
  for (const i of parcels.aliveIndices()) {
    if (parcels.kindAt(i) !== BuiltKind.HouseSingle) continue;
    const e = parcels.get(i); // era-4 houses are 1×1
    if (net[map.idx(e.x, e.y)]! > P.suburbRadius) n++;
  }
  return n;
}

// Runs eras 1-3, snapshots the core-residential cohort condition and the
// pre-era-4 far-house count, then runs era 4.
function runEra4(seed: string) {
  const { world, state } = runEras(seed, 3);
  const { map, parcels } = world;
  const cohort: number[] = [];
  for (const i of parcels.aliveIndices()) {
    if (!RESIDENTIAL_KINDS.includes(parcels.kindAt(i))) continue;
    const e = parcels.get(i);
    if (Math.abs(e.x - state.siteX) + Math.abs(e.y - state.siteY) <= P.era4DeclineRadius) cohort.push(i);
  }
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const condBefore = mean(cohort.map((i) => parcels.conditionAt(i)));
  const farBefore = farHouseCount(map, parcels, roadNetDist(map, state));
  era4Suburbs(world, createRng(seed).fork('era4'), P, state);
  return { world, state, cohort, condBefore, farBefore, mean };
}

describe('era4Suburbs determinism', () => {
  it('produces an identical canonical hash for the same seed', () => {
    expect(hashWorld(runEras('moses-1', 4).world)).toBe(hashWorld(runEras('moses-1', 4).world));
  });
});

describe('era4Suburbs', () => {
  for (const seed of SEEDS) {
    it(`seed "${seed}": >= 15 suburban houses beyond suburbRadius (road-network distance, yield point 2)`, () => {
      const { world, state, farBefore } = runEra4(seed);
      const { map, parcels } = world;
      const net = roadNetDist(map, state);
      const farHouses = parcels
        .aliveIndices()
        .filter((i) => parcels.kindAt(i) === BuiltKind.HouseSingle && net[map.idx(parcels.get(i).x, parcels.get(i).y)]! > P.suburbRadius);
      expect(farHouses.length).toBeGreaterThanOrEqual(15);
      expect(farHouses.length).toBeGreaterThan(farBefore); // era 4 actually built sprawl
      for (const i of farHouses) {
        expect(parcelTouchesRoad(map, parcels, i)).toBe(true);
        const e = parcels.get(i);
        expect(net[map.idx(e.x, e.y)]!).toBeGreaterThan(P.suburbRadius);
      }
    });

    it(`seed "${seed}": >= 2 offices near the center`, () => {
      const { world, state } = runEra4(seed);
      const { parcels } = world;
      const offices = parcels.aliveIndices().filter((i) => {
        if (parcels.kindAt(i) !== BuiltKind.Offices) return false;
        const e = parcels.get(i);
        return Math.abs(e.x - state.siteX) + Math.abs(e.y - state.siteY) <= P.coreRadius + 2;
      });
      expect(offices.length).toBeGreaterThanOrEqual(2);
    });

    it(`seed "${seed}": core residential declines below its pre-era-4 mean`, () => {
      const { world, cohort, condBefore, mean } = runEra4(seed);
      expect(cohort.length).toBeGreaterThanOrEqual(3); // non-vacuous cohort
      const condAfter = mean(cohort.map((i) => world.parcels.conditionAt(i)));
      expect(condAfter).toBeLessThan(condBefore);
    });

    it(`seed "${seed}": tiles still agree with the store`, () => {
      const { world } = runEra4(seed);
      expect(checkParcelAgreement(world.map, world.parcels)).toEqual([]);
    });
  }
});

// Min highway distance over parcel `i`'s footprint, using a precomputed field.
function parcelHighwayDist(map: GameMap, parcels: WorldState['parcels'], i: number, field: Int32Array): number {
  const e = parcels.get(i);
  let lo = Infinity;
  for (let yy = e.y; yy < e.y + e.height; yy++) {
    for (let xx = e.x; xx < e.x + e.width; xx++) {
      const v = field[map.idx(xx, yy)]!;
      if (v >= 0 && v < lo) lo = v;
    }
  }
  return lo;
}

// Runs eras 1-4, partitions the parcels alive at the START of era 5 by highway
// distance (near <= 8 / far >= 16), snapshots parking count, then runs era 5.
// Cohorts are fixed pre-era-5 and outcomes count abandoned parcels at condition
// 0 — the survivorship-bias-free blight measure (yield point 3).
function runEra5(seed: string) {
  const { world, state } = runEras(seed, 4);
  const { map, parcels } = world;
  const highwayDist = distanceField(map, (i) => map.built[i] === BuiltKind.RoadHighway);
  const preAlive = parcels.aliveIndices();
  const near = preAlive.filter((i) => parcelHighwayDist(map, parcels, i, highwayDist) <= 8);
  const far = preAlive.filter((i) => parcelHighwayDist(map, parcels, i, highwayDist) >= 16);
  const parkingBefore = aliveKindCount(world, BuiltKind.ParkingLot);
  era5Disinvestment(world, createRng(seed).fork('era5'), P, state);
  return { world, state, near, far, parkingBefore };
}

describe('era5Disinvestment blight & abandonment', () => {
  for (const seed of SEEDS) {
    it(`seed "${seed}": blight gradient holds without survivorship bias (yield point 3)`, () => {
      const { world, near, far } = runEra5(seed);
      const { parcels } = world;
      expect(near.length).toBeGreaterThanOrEqual(5); // non-vacuous cohorts
      expect(far.length).toBeGreaterThanOrEqual(5);
      // Outcome: surviving condition, or 0 for an abandoned (demolished) parcel.
      const outcome = (i: number) => (parcels.isAlive(i) ? parcels.conditionAt(i) : 0);
      const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
      expect(mean(near.map(outcome))).toBeLessThan(mean(far.map(outcome)));
    });

    it(`seed "${seed}": >= 10% of the standing city is abandoned (chronicle matches store)`, () => {
      const { world, state } = runEra5(seed);
      const line = world.log.find((l) => /disinvestment/.test(l))!;
      const abandoned = Number(/(\d+) abandoned/.exec(line)![1]);
      const craters = Number(/(\d+) craters/.exec(line)![1]);
      expect(abandoned).toBeGreaterThanOrEqual(Math.ceil(0.1 * state.preEra5Alive));
      // Chronicle numbers match store deltas: alive = standing - abandoned + craters.
      expect(world.parcels.aliveCount()).toBe(state.preEra5Alive - abandoned + craters);
    });

    it(`seed "${seed}": parking-lot count increases (abandonment craters)`, () => {
      const { world, parkingBefore } = runEra5(seed);
      expect(aliveKindCount(world, BuiltKind.ParkingLot)).toBeGreaterThan(parkingBefore);
    });
  }
});

describe('mosesCenturyStage (full assembly)', () => {
  it('produces an identical canonical hash for the same seed', () => {
    expect(hashWorld(runFullStage('moses-1'))).toBe(hashWorld(runFullStage('moses-1')));
  });

  it('produces different canonical hashes for different seeds', () => {
    expect(hashWorld(runFullStage('moses-1'))).not.toBe(hashWorld(runFullStage('moses-2')));
  });

  it('logs the pipeline stage order terrain → moses-century', () => {
    const world = runFullStage('moses-1');
    const stages = world.log.filter((l) => l === 'terrain' || l === 'moses-century');
    expect(stages).toEqual(['terrain', 'moses-century']);
  });

  for (const seed of SEEDS) {
    it(`seed "${seed}": chronicles at least one entry per era`, () => {
      const world = runFullStage(seed);
      for (const n of [1, 2, 3, 4, 5]) {
        expect(world.log.some((l) => l.startsWith(`era${n}:`))).toBe(true);
      }
    });

    it(`seed "${seed}": never edits terrain (all four terrain layers byte-identical)`, () => {
      const full = runFullStage(seed);
      const terr = runPipeline({ seed, width: 128, height: 128 }, [terrainStage()]);
      expect(full.map.elevation).toEqual(terr.map.elevation);
      expect(full.map.water).toEqual(terr.map.water);
      expect(full.map.moisture).toEqual(terr.map.moisture);
      expect(full.map.landCover).toEqual(terr.map.landCover);
    });

    it(`seed "${seed}": tiles agree with the store after the whole stage`, () => {
      const world = runFullStage(seed);
      expect(checkParcelAgreement(world.map, world.parcels)).toEqual([]);
    });

    it(`seed "${seed}": post-stage road network stays coherent (>= 95% one component)`, () => {
      // PRD output requirement: the player inherits a "blighted-but-coherent
      // city" with a connected road network (docs/PRDs/moses-century.md §1,
      // acceptance criterion 5a "a contiguous street network exists"). Every
      // era only ever grows roads and attaches them to the network at the point
      // of placement; demolition removes parcels and rail, never roads — so the
      // final road network must stay effectively a single component. This is the
      // cheapest strong end-state coherence guard (covers all five eras at once).
      const net = roadNetwork(runFullStage(seed).map);
      expect(net.total).toBeGreaterThanOrEqual(100); // non-vacuous: a real city
      expect(net.largestComponent).toBeGreaterThanOrEqual(Math.ceil(0.95 * net.total));
    });
  }
});

describe('mosesCenturyStage on a degenerate map', () => {
  it('era 1 logs no-site and later eras no-op on an all-water map', () => {
    const allWater: WorldgenStage = {
      name: 'all-water',
      apply(world) {
        world.map.water.fill(Water.Ocean);
      },
    };
    const world = runPipeline({ seed: 'drowned', width: 48, height: 48 }, [allWater, mosesCenturyStage()]);
    expect(world.log).toContain('era1: no viable site');
    expect(world.log).toContain('moses-century');
    let built = 0;
    for (let i = 0; i < world.map.built.length; i++) if (world.map.built[i] !== 0) built++;
    expect(built).toBe(0);
    expect(world.parcels.count()).toBe(0);
  });
});

describe('era1Founding on a degenerate map', () => {
  it('no-ops with "no viable site" on an all-water map (no throw)', () => {
    const allWater: WorldgenStage = {
      name: 'all-water',
      apply(world) {
        world.map.water.fill(Water.Ocean);
      },
    };
    const world = runPipeline({ seed: 'drowned', width: 48, height: 48 }, [allWater]);
    const state = createMosesState();
    era1Founding(world, createRng('drowned').fork('era1'), P, state);
    expect(state.founded).toBe(false);
    expect(world.log).toContain('era1: no viable site');
    let built = 0;
    for (let i = 0; i < world.map.built.length; i++) if (world.map.built[i] !== 0) built++;
    expect(built).toBe(0);
    expect(world.parcels.count()).toBe(0);
  });
});
