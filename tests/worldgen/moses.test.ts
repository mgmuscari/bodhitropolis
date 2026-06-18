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
  ParcelStore,
  placeParcel,
} from '../../src/engine/fabric';
import {
  createMosesState,
  era1Founding,
  era2MotorAge,
  era3Highways,
  era4Suburbs,
  eraSatellites,
  era5Disinvestment,
  mosesCenturyStage,
  placeParkingField,
  promoteDenseStreets,
  DEFAULT_MOSES_PARAMS,
  type MosesParams,
  type MosesState,
} from '../../src/worldgen/moses';
import { boxDensity, distanceField } from '../../src/worldgen/fields';
import { gradeRedline } from '../../src/worldgen/redline';
import { computePowerGrid } from '../../src/growth/power';
import { wideRoadAt } from '../../src/ui/decoration';

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
// Draws the redline grade first (as mosesCenturyStage does) so eras that key
// burdens off the grade see the real discriminatory geography in prefix runs.
function runEras(
  seed: string,
  n: number,
  width = 128,
  height = 128,
  params: MosesParams = P,
): { world: WorldState; state: MosesState } {
  const world = runPipeline({ seed, width, height }, [terrainStage()]);
  gradeRedline(world.map, createRng(seed).fork('redline'));
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

// Runs terrain + era1-4 + eraSatellites, forking each stream the way the stage does.
function runSatellites(seed: string, width = 128, height = 128): { world: WorldState; state: MosesState } {
  const world = runPipeline({ seed, width, height }, [terrainStage()]);
  const state = createMosesState();
  gradeRedline(world.map, createRng(seed).fork('redline'));
  era1Founding(world, createRng(seed).fork('era1'), P, state);
  era2MotorAge(world, createRng(seed).fork('era2'), P, state);
  era3Highways(world, createRng(seed).fork('era3'), P, state);
  era4Suburbs(world, createRng(seed).fork('era4'), P, state);
  eraSatellites(world, createRng(seed).fork('satellites'), P, state);
  return { world, state };
}

// Road-tile connectivity over the DRIVABLE graph. Parking lots are CONNECTORS — cars
// cut through them — so a dense street that paved over into parking still bridges the
// network. We BFS over road-OR-parking tiles but COUNT road tiles per component, so
// `largestComponent === total` means every road tile is mutually reachable (possibly
// via a parking bridge). Isolated destination-parking islands (era-2 fringe fields)
// hold zero road tiles, so they correctly don't count as fragmentation.
function roadNetwork(map: GameMap): { total: number; largestComponent: number } {
  const { width, height } = map;
  const isRoad = (i: number) => isRoadKind(map.built[i]!);
  const drivable = (i: number) => isRoad(i) || map.built[i] === BuiltKind.ParkingLot;
  let total = 0;
  for (let i = 0; i < width * height; i++) if (isRoad(i)) total++;
  if (total === 0) return { total: 0, largestComponent: 0 };
  const seen = new Uint8Array(width * height);
  let largest = 0;
  for (let s = 0; s < width * height; s++) {
    if (seen[s] || !drivable(s)) continue;
    let roadCount = 0;
    const queue = [s];
    seen[s] = 1;
    let head = 0;
    while (head < queue.length) {
      const i = queue[head++]!;
      if (isRoad(i)) roadCount++;
      const x = i % width;
      const y = (i - x) / width;
      for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]] as const) {
        if (!map.inBounds(nx, ny)) continue;
        const ni = map.idx(nx, ny);
        if (!seen[ni] && drivable(ni)) {
          seen[ni] = 1;
          queue.push(ni);
        }
      }
    }
    if (roadCount > largest) largest = roadCount;
  }
  return { total, largestComponent: largest };
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

// Count of road tiles flanked by parcels on BOTH sides (>= 2 distinct adjacent
// parcel ids). A 1-wide street tile has only its two perpendicular neighbours
// available as frontage, so per-tile this saturates at "both sides" — the COUNT
// across the grid is the all-lane signature: an all-lane fillFrontage drives it
// to ~72, where the old first-fit-one-lane loop reaches only ~14 (mostly around
// the civic megablock). So the COUNT, not a per-tile max, is the discriminator.
function bothSidesBuilt(map: GameMap): number {
  const { width, height } = map;
  let n = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!isRoadKind(map.built[map.idx(x, y)]!)) continue;
      const ids = new Set<number>();
      for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]] as const) {
        if (!map.inBounds(nx, ny)) continue;
        const pid = map.parcel[map.idx(nx, ny)]!;
        if (pid !== 0) ids.add(pid);
      }
      if (ids.size >= 2) n++;
    }
  }
  return n;
}

describe('era1Founding density (urban-density Task 4)', () => {
  for (const seed of SEEDS) {
    it(`seed "${seed}": fills BOTH sides of streets (all-lane, not first-fit)`, () => {
      const { map } = runEra1(seed).world;
      // All-lane fillFrontage flanks ~72 road tiles on both sides; the old first-fit
      // loop manages ~14. The >= 40 bar cleanly separates them — a clean RED on the
      // pre-impl first-fit code (verified: 14 < 40), GREEN on the all-lane fill.
      expect(bothSidesBuilt(map)).toBeGreaterThanOrEqual(40);
    });

    it(`seed "${seed}": is materially denser than the old baseline (>= 2x ~40)`, () => {
      // Realized era-1 alive is 80 on moses-1/2/3 (era1Parcels=80, the AC#4 ">= 2x
      // the old ~40 baseline" target; the PRP's unmeasured 150 saturated the core
      // and collapsed the era-5 far cohort, so it was calibrated down to 80). The
      // asserted floor sits below the realized minimum with margin per the
      // budget-as-cap discipline — defensible against a water-heavier seed.
      const alive = runEra1(seed).world.parcels.aliveCount();
      expect(alive).toBeGreaterThanOrEqual(72);
    });

    it(`seed "${seed}": places dense near-core Apartments`, () => {
      // fillFrontage steers Apartments (the dense kind, DENSE_ATTRS density 2-3)
      // into the core — the band era 3 later carves the highway through, which is
      // what keeps the era-5 abandonment numerator healthy by construction.
      expect(aliveKindCount(runEra1(seed).world, BuiltKind.Apartments)).toBeGreaterThanOrEqual(5);
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

describe('era3 — legacy dirty power, sited by grade on surviving frontage', () => {
  const PLANTS = new Set<number>([BuiltKind.CoalPlant, BuiltKind.GasPlant]);
  const parcelMeanGrade = (world: WorldState, i: number): number => {
    const { map, parcels } = world;
    const e = parcels.get(i);
    let sum = 0;
    let n = 0;
    for (let dy = 0; dy < e.height; dy++) {
      for (let dx = 0; dx < e.width; dx++) {
        sum += map.redline[map.idx(e.x + dx, e.y + dy)]!;
        n++;
      }
    }
    return sum / n;
  };
  const isPlant = (world: WorldState, i: number): boolean => PLANTS.has(world.parcels.kindAt(i));

  for (const seed of SEEDS) {
    it(`seed "${seed}": sites legacy coal/gas plants`, () => {
      const { world } = runEras(seed, 3);
      const plants = world.parcels.aliveIndices().filter((i) => isPlant(world, i));
      expect(plants.length).toBeGreaterThanOrEqual(2);
    });

    it(`seed "${seed}": the seeded grid powers part of the city (not all dark)`, () => {
      const { world } = runEras(seed, 3);
      const grid = computePowerGrid(world.map, world.parcels);
      expect(grid.capacity).toBeGreaterThan(0);
      expect(grid.poweredAnchors.size).toBeGreaterThan(0);
    });

    it(`seed "${seed}": plants survive the full century (era5 doesn't dark the city)`, () => {
      // Plants are sited in redlined zones, where grade-driven era5 decay is
      // harshest — they must be exempt from abandonment or the city restarts dark.
      const world = runFullStage(seed);
      const plants = world.parcels.aliveIndices().filter((i) => isPlant(world, i));
      expect(plants.length).toBeGreaterThanOrEqual(2);
      const grid = computePowerGrid(world.map, world.parcels);
      expect(grid.poweredAnchors.size).toBeGreaterThan(0);
    });
  }

  it('plants concentrate in worse-graded districts than the average building', () => {
    // An ensemble property, not a per-seed guarantee: a map whose redlined core is
    // fully built-out leaves no 3x3 room, so plants spill to the redlined EDGE.
    // Across seeds the dirty power still sits on worse-graded ground than the
    // average developed parcel. Baseline = developed (non-plant) parcels, since
    // an all-tiles mean is inflated by undeveloped floodplain/redlined periphery.
    let plantSum = 0;
    let plantN = 0;
    let devSum = 0;
    let devN = 0;
    for (const seed of SEEDS) {
      const { world } = runEras(seed, 3);
      for (const i of world.parcels.aliveIndices()) {
        const g = parcelMeanGrade(world, i);
        if (isPlant(world, i)) {
          plantSum += g;
          plantN++;
        } else {
          devSum += g;
          devN++;
        }
      }
    }
    expect(plantSum / plantN).toBeGreaterThan(devSum / devN);
  });
});

describe('era2MotorAge — industry concentration by grade', () => {
  const parcelMeanGrade = (world: WorldState, i: number): number => {
    const { map, parcels } = world;
    const e = parcels.get(i);
    let sum = 0;
    let n = 0;
    for (let dy = 0; dy < e.height; dy++) {
      for (let dx = 0; dx < e.width; dx++) {
        sum += map.redline[map.idx(e.x + dx, e.y + dy)]!;
        n++;
      }
    }
    return sum / n;
  };

  it('industry picks the worst-graded of the rail/water frontage cohort', () => {
    // Controls for the floodplain confound (rail/water frontage is near water, so
    // it already skews worse-graded): compare industry against OTHER parcels that
    // are ALSO near rail/water. Industry is grade-sorted to pick the worst of that
    // shared cohort, so its mean grade exceeds the rest. Aggregate across seeds.
    let indSum = 0;
    let indN = 0;
    let cohortSum = 0;
    let cohortN = 0;
    for (const seed of SEEDS) {
      const { world } = runEras(seed, 2);
      const { map, parcels } = world;
      for (const i of parcels.aliveIndices()) {
        if (!nearRailOrWater(map, parcels, i, P.industryFrontage)) continue;
        const g = parcelMeanGrade(world, i);
        if (parcels.kindAt(i) === BuiltKind.Industrial) {
          indSum += g;
          indN++;
        } else {
          cohortSum += g;
          cohortN++;
        }
      }
    }
    expect(indSum / indN).toBeGreaterThan(cohortSum / cohortN);
  });
});

describe('era3 — police precincts sited in redlined districts (the apparatus of control)', () => {
  const parcelMeanGrade = (world: WorldState, i: number): number => {
    const { map, parcels } = world;
    const e = parcels.get(i);
    let sum = 0;
    let n = 0;
    for (let dy = 0; dy < e.height; dy++) {
      for (let dx = 0; dx < e.width; dx++) {
        sum += map.redline[map.idx(e.x + dx, e.y + dy)]!;
        n++;
      }
    }
    return sum / n;
  };

  for (const seed of SEEDS) {
    it(`seed "${seed}": precincts persist through the full century`, () => {
      const world = runFullStage(seed);
      const precincts = world.parcels
        .aliveIndices()
        .filter((i) => world.parcels.kindAt(i) === BuiltKind.Precinct);
      expect(precincts.length).toBeGreaterThanOrEqual(2); // state keeps policing through disinvestment
    });
  }

  it('fire stations are PROVIDED to greenlined ground, withheld from the redlined (vs precincts)', () => {
    // The inequity: precincts (control) concentrate in redlined ground; fire stations (service) in
    // greenlined. So fire-station ground is graded BETTER than precinct ground, across seeds.
    let fireSum = 0;
    let fireN = 0;
    let precSum = 0;
    let precN = 0;
    for (const seed of SEEDS) {
      const world = runFullStage(seed);
      for (const i of world.parcels.aliveIndices()) {
        const k = world.parcels.kindAt(i);
        if (k === BuiltKind.FireStation) {
          fireSum += parcelMeanGrade(world, i);
          fireN++;
        } else if (k === BuiltKind.Precinct) {
          precSum += parcelMeanGrade(world, i);
          precN++;
        }
      }
    }
    expect(fireN).toBeGreaterThan(0);
    expect(fireSum / fireN).toBeLessThan(precSum / precN); // services in greener ground than control
  });

  it('precincts sit on worse-graded ground than the average surviving building', () => {
    let precSum = 0;
    let precN = 0;
    let otherSum = 0;
    let otherN = 0;
    for (const seed of SEEDS) {
      const world = runFullStage(seed);
      for (const i of world.parcels.aliveIndices()) {
        const g = parcelMeanGrade(world, i);
        if (world.parcels.kindAt(i) === BuiltKind.Precinct) {
          precSum += g;
          precN++;
        } else {
          otherSum += g;
          otherN++;
        }
      }
    }
    expect(precSum / precN).toBeGreaterThan(otherSum / otherN);
  });
});

describe('placeParkingField (all-or-nothing, unit)', () => {
  it('places cols*rows lots on a fully-free region as one contiguous field', () => {
    const map = new GameMap(20, 20);
    const parcels = new ParcelStore();
    const n = placeParkingField(map, parcels, createRng('pf'), 2, 2, 2, 2);
    expect(n).toBe(4); // a 2x2 grid of 2x2 lots
    // The 4 lots tile a 4x4 rectangle → one 4-connected component of 16 tiles.
    expect(componentSizes(map, BuiltKind.ParkingLot).sort((a, b) => b - a)).toEqual([16]);
    expect(checkParcelAgreement(map, parcels)).toEqual([]);
  });

  it('places nothing and returns 0 if any tile in the rectangle is occupied', () => {
    const map = new GameMap(20, 20);
    const parcels = new ParcelStore();
    map.built[map.idx(3, 3)] = BuiltKind.RoadStreet; // one occupied tile inside the 4x4
    const n = placeParkingField(map, parcels, createRng('pf'), 2, 2, 2, 2);
    expect(n).toBe(0);
    expect(countBuilt(map, BuiltKind.ParkingLot)).toBe(0);
  });
});

describe('promoteDenseStreets (concrete accumulates → parking)', () => {
  it('promotes a 2x2 RoadStreet block to a ParkingLot parcel', () => {
    const map = new GameMap(12, 12);
    const parcels = new ParcelStore();
    for (const [x, y] of [[4, 4], [5, 4], [4, 5], [5, 5]] as const) {
      map.built[map.idx(x, y)] = BuiltKind.RoadStreet;
    }
    const n = promoteDenseStreets(map, parcels, createRng('ap'));
    expect(n).toBe(1);
    for (const [x, y] of [[4, 4], [5, 4], [4, 5], [5, 5]] as const) {
      expect(map.built[map.idx(x, y)]).toBe(BuiltKind.ParkingLot);
    }
    expect(checkParcelAgreement(map, parcels)).toEqual([]); // built+parcel layers agree
  });

  it('leaves a 1-wide street grid untouched (no 2x2 block forms)', () => {
    const map = new GameMap(12, 12);
    const parcels = new ParcelStore();
    for (let x = 0; x < 12; x++) map.built[map.idx(x, 5)] = BuiltKind.RoadStreet; // horizontal
    for (let y = 0; y < 12; y++) map.built[map.idx(6, y)] = BuiltKind.RoadStreet; // vertical cross
    const n = promoteDenseStreets(map, parcels, createRng('ap'));
    expect(n).toBe(0);
    expect(countBuilt(map, BuiltKind.ParkingLot)).toBe(0);
  });

  it('keeps the drivable network connected: a paved-over through-block still bridges', () => {
    // A 1-wide street corridor with a 2x2 bulge in the middle; promoting the bulge to
    // parking must not split the corridor (parking is a connector).
    const map = new GameMap(16, 8);
    for (let x = 0; x < 16; x++) map.built[map.idx(x, 4)] = BuiltKind.RoadStreet; // corridor
    map.built[map.idx(7, 3)] = BuiltKind.RoadStreet; // the bulge: (7,3),(8,3),(7,4),(8,4) = 2x2
    map.built[map.idx(8, 3)] = BuiltKind.RoadStreet;
    const parcels = new ParcelStore();
    promoteDenseStreets(map, parcels, createRng('ap'));
    const net = roadNetwork(map);
    expect(net.largestComponent).toBe(net.total); // still one connected drivable network
    expect(countBuilt(map, BuiltKind.ParkingLot)).toBe(4); // the bulge paved over
  });
});

describe('era2MotorAge density & widening (urban-density Task 5)', () => {
  for (const seed of SEEDS) {
    it(`seed "${seed}": widens an arterial into a 2-row avenue (wideRoadAt)`, () => {
      const { map } = runEras(seed, 2).world;
      let found = false;
      for (let y = 0; y < map.height && !found; y++) {
        for (let x = 0; x < map.width && !found; x++) {
          if (map.built[map.idx(x, y)] === BuiltKind.RoadAvenue && wideRoadAt(map, x, y)) found = true;
        }
      }
      expect(found).toBe(true);
    });

    it(`seed "${seed}": lays a parking field (>= 16-tile ParkingLot component)`, () => {
      // The fringe field is all-or-nothing in open land past the dense grid, so the
      // full 4x4 (16 tiles) lands as one component — satisfiable by construction.
      const { map } = runEras(seed, 2).world;
      const sizes = componentSizes(map, BuiltKind.ParkingLot).sort((a, b) => b - a);
      expect(sizes[0]).toBeGreaterThanOrEqual(16);
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

// True iff any 2x2 block is ALL RoadHighway — the signature of a multi-row carve.
// A single-row corridor cannot form one (even at a + crossing or alongside grid
// streets, the diagonal cell is never a 2nd highway row).
function hasHighwaySlab(map: GameMap): boolean {
  for (let y = 0; y < map.height - 1; y++) {
    for (let x = 0; x < map.width - 1; x++) {
      if (
        map.built[map.idx(x, y)] === BuiltKind.RoadHighway &&
        map.built[map.idx(x + 1, y)] === BuiltKind.RoadHighway &&
        map.built[map.idx(x, y + 1)] === BuiltKind.RoadHighway &&
        map.built[map.idx(x + 1, y + 1)] === BuiltKind.RoadHighway
      ) {
        return true;
      }
    }
  }
  return false;
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

    it(`seed "${seed}": carves a 3-row highway slab (a 2x2 all-highway block)`, () => {
      const { world } = runEra3(seed);
      const { map } = world;
      // The signature of a multi-row carve: a 2x2 block of ALL RoadHighway tiles.
      // A 1-wide carve cannot form one even where it abuts grid streets — and
      // wideRoadAt alone admits mixed-kind 2x2s, so it can't discriminate the band.
      // Every tile of an all-highway 2x2 also reads wide to the renderer.
      expect(hasHighwaySlab(map)).toBe(true);
    });

    it(`seed "${seed}": demolition balance equation holds (yield point 5b)`, () => {
      const { world, aliveBefore, projBefore } = runEra3(seed);
      const aliveAfter = world.parcels.aliveCount();

      const line = world.log.find((l) => /urban renewal/.test(l))!;
      const demolished = Number(/(\d+) parcels demolished/.exec(line)![1]);
      const projPlaced = Number(/(\d+) projects/.exec(line)![1]);
      const civicPlaced = Number(/(\d+) civic/.exec(line)![1]);
      const powerPlaced = Number(/(\d+) power/.exec(line)![1]);
      const precinctsPlaced = Number(/(\d+) precincts/.exec(line)![1]);
      const servicesPlaced = Number(/(\d+) services/.exec(line)![1]);

      expect(demolished).toBeGreaterThanOrEqual(5);
      // Chronicle honesty: projects are placed only after carving and none
      // pre-exist, so their kind-delta independently confirms the chronicled
      // placement count (a corridor cannot demolish a project).
      expect(aliveKindCount(world, BuiltKind.Projects) - projBefore).toBe(projPlaced);
      // Every alive-count change in era 3 is accounted for: demolitions out,
      // projects + civic + power + precincts in. (Net kind-deltas would conflate a
      // demolished era-1 civic with a placed one — the chronicled counts do not.)
      expect(aliveAfter).toBe(
        aliveBefore - demolished + projPlaced + civicPlaced + powerPlaced + precinctsPlaced + servicesPlaced,
      );
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

describe('era3Highways — routed through redlined districts', () => {
  it('highways run through worse-graded ground than the surviving city', () => {
    // The Moses signature, named: the corridor scorer prefers redlined-dense
    // corridors, so the carved expressway sits on worse-graded ground than the
    // parcels that survive beside it. Aggregate across seeds for robustness.
    let hwSum = 0;
    let hwN = 0;
    let parcelSum = 0;
    let parcelN = 0;
    for (const seed of SEEDS) {
      const { world } = runEras(seed, 3);
      const { map } = world;
      for (let i = 0; i < map.built.length; i++) {
        if (map.built[i] === BuiltKind.RoadHighway) {
          hwSum += map.redline[i]!;
          hwN++;
        } else if (map.parcel[i] !== 0) {
          // Exclude plants/precincts/fire stations (24..32): all deliberately grade-sited, so
          // they'd skew the "average building" baseline.
          const k = world.parcels.kindAt(map.parcel[i]! - 1);
          if (k >= 24 && k <= 32) continue;
          parcelSum += map.redline[i]!;
          parcelN++;
        }
      }
    }
    expect(hwSum / hwN).toBeGreaterThan(parcelSum / parcelN);
  });
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

// Mean redline grade (0..255) over parcel `i`'s footprint.
function parcelMeanRedlineT(map: GameMap, parcels: WorldState['parcels'], i: number): number {
  const e = parcels.get(i);
  let sum = 0;
  let n = 0;
  for (let yy = e.y; yy < e.y + e.height; yy++) {
    for (let xx = e.x; xx < e.x + e.width; xx++) {
      sum += map.redline[map.idx(xx, yy)]!;
      n++;
    }
  }
  return n > 0 ? sum / n : 0;
}

// Runs eras 1-4, partitions the parcels alive at the START of era 5 by REDLINE
// GRADE (redlined >= 176 / greenlined <= 80), snapshots parking count, then runs
// era 5. Cohorts are fixed pre-era-5 and outcomes count abandoned parcels at
// condition 0 — the survivorship-bias-free decay measure (yield point 3).
function runEra5(seed: string) {
  const { world, state } = runEras(seed, 4);
  const { map, parcels } = world;
  const preAlive = parcels.aliveIndices();
  const redlined = preAlive.filter((i) => parcelMeanRedlineT(map, parcels, i) >= 176);
  const greenlined = preAlive.filter((i) => parcelMeanRedlineT(map, parcels, i) <= 80);
  const parkingBefore = aliveKindCount(world, BuiltKind.ParkingLot);
  era5Disinvestment(world, createRng(seed).fork('era5'), P, state);
  return { world, state, redlined, greenlined, parkingBefore };
}

describe('era5Disinvestment decay & abandonment', () => {
  for (const seed of SEEDS) {
    it(`seed "${seed}": decay follows the redline grade (no survivorship bias)`, () => {
      const { world, redlined, greenlined } = runEra5(seed);
      const { parcels } = world;
      expect(redlined.length).toBeGreaterThanOrEqual(5); // non-vacuous cohorts
      expect(greenlined.length).toBeGreaterThanOrEqual(5);
      // Outcome: surviving condition, or 0 for an abandoned (demolished) parcel.
      const outcome = (i: number) => (parcels.isAlive(i) ? parcels.conditionAt(i) : 0);
      const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
      expect(mean(redlined.map(outcome))).toBeLessThan(mean(greenlined.map(outcome)));
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

describe('era5Disinvestment crater fields (urban-density Task 7)', () => {
  it('a crater expands into a parking field on cleared land; balance stays exact', () => {
    // Constructed fixture (seed-independent): a REDLINED low-condition house with
    // open land around it, so grade-driven era-5 decay dooms it and the crater
    // FIELD has contiguous room to form. Pins the wiring (placeParkingField reused
    // on the cleared footprint, count summed into craters) without relying on
    // fragile organic clustering on moses-1/2/3.
    const map = new GameMap(24, 24);
    const parcels = new ParcelStore();
    placeParcel(map, parcels, {
      x: 10, y: 6, width: 1, height: 1, kind: BuiltKind.HouseSingle, density: 1, condition: 45,
    });
    map.redline[map.idx(10, 6)] = 255; // fully redlined → grade-driven decay dooms it
    const world: WorldState = { seed: 'crater-field', map, parcels, log: [] };
    const state = createMosesState();
    state.founded = true;
    const params: MosesParams = { ...DEFAULT_MOSES_PARAMS, craterChance: 1 };
    era5Disinvestment(world, createRng('crater-field').fork('era5'), params, state);

    // A field formed: a ParkingLot component larger than a single 2x2 lot (4 tiles).
    const sizes = componentSizes(map, BuiltKind.ParkingLot).sort((a, b) => b - a);
    expect(sizes[0]).toBeGreaterThanOrEqual(8);
    // Balance is exact: craters counts EVERY placed lot, not crater events.
    const line = world.log.find((l) => /disinvestment/.test(l))!;
    const abandoned = Number(/(\d+) abandoned/.exec(line)![1]);
    const craters = Number(/(\d+) craters/.exec(line)![1]);
    expect(parcels.aliveCount()).toBe(state.preEra5Alive - abandoned + craters);
    expect(checkParcelAgreement(map, parcels)).toEqual([]);
  });
});

describe('mosesCenturyStage (full assembly)', () => {
  it('produces an identical canonical hash for the same seed', () => {
    expect(hashWorld(runFullStage('moses-1'))).toBe(hashWorld(runFullStage('moses-1')));
  });

  it('produces different canonical hashes for different seeds', () => {
    expect(hashWorld(runFullStage('moses-1'))).not.toBe(hashWorld(runFullStage('moses-2')));
  });

  for (const seed of SEEDS) {
    it(`seed "${seed}": three full-stage runs are byte-identical (triple-snapshot)`, () => {
      const h1 = hashWorld(runFullStage(seed));
      const h2 = hashWorld(runFullStage(seed));
      const h3 = hashWorld(runFullStage(seed));
      expect(h1).toBe(h2);
      expect(h1).toBe(h3);
    });
  }

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

    it(`seed "${seed}": post-stage road network is a single connected component`, () => {
      // PRD output requirement: the player inherits a "blighted-but-coherent
      // city" with a connected road network (docs/PRDs/moses-century.md §1,
      // acceptance criterion 5a "a contiguous street network exists"). Every
      // era only ever grows roads and attaches them to the network at the point
      // of placement; demolition removes parcels and rail, never roads — so the
      // final road network must stay a single component, exactly. Asserted at
      // the exact bar matching the era-1 (148-153) and era-2 (269-274) sibling
      // guards: the by-construction guarantee leaves no slack to allow, so a
      // strict `=== total` catches any future carve/spur change that strands
      // even one tile. This is the cheapest strong end-state coherence guard
      // (covers all five eras at once).
      const net = roadNetwork(runFullStage(seed).map);
      expect(net.total).toBeGreaterThanOrEqual(100); // non-vacuous: a real city
      expect(net.largestComponent).toBe(net.total); // single component, no fragments
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

describe('eraSatellites — exurbs/suburbs with their own grids, freeway-linked', () => {
  for (const seed of SEEDS) {
    it(`seed "${seed}": founds satellite settlements out beyond the core`, () => {
      const { state } = runSatellites(seed);
      expect(state.satellites.length).toBeGreaterThanOrEqual(2); // non-vacuous
      expect(state.satellites.length).toBeLessThanOrEqual(P.satelliteCount);
      for (const s of state.satellites) {
        const d = Math.abs(s.x - state.siteX) + Math.abs(s.y - state.siteY);
        expect(d).toBeGreaterThanOrEqual(P.satelliteMinCoreDist); // a separate settlement, not infill
      }
    });

    it(`seed "${seed}": each satellite has its own street grid`, () => {
      const { world, state } = runSatellites(seed);
      const { map } = world;
      for (const s of state.satellites) {
        let roads = 0;
        const r = P.satelliteSpan;
        for (let y = s.y - r; y <= s.y + r; y++) {
          for (let x = s.x - r; x <= s.x + r; x++) {
            if (map.inBounds(x, y) && isRoadKind(map.built[map.idx(x, y)]!)) roads++;
          }
        }
        expect(roads).toBeGreaterThanOrEqual(8); // a mini grid, not a lone tile
      }
    });

    it(`seed "${seed}": a freeway reaches each satellite`, () => {
      const { world, state } = runSatellites(seed);
      const { map } = world;
      for (const s of state.satellites) {
        let near = false;
        const r = P.satelliteSpan + 3;
        for (let y = s.y - r; y <= s.y + r && !near; y++) {
          for (let x = s.x - r; x <= s.x + r && !near; x++) {
            if (map.inBounds(x, y) && map.built[map.idx(x, y)] === BuiltKind.RoadHighway) near = true;
          }
        }
        expect(near).toBe(true);
      }
    });

    it(`seed "${seed}": the road network stays one connected component (freeways link the exurbs)`, () => {
      const net = roadNetwork(runSatellites(seed).world.map);
      expect(net.largestComponent).toBe(net.total);
    });

    it(`seed "${seed}": adds suburban houses beyond the era-4 city`, () => {
      const before = runEras(seed, 4).world.parcels.aliveCount();
      const after = runSatellites(seed).world.parcels.aliveCount();
      expect(after).toBeGreaterThan(before);
    });

    it(`seed "${seed}": tiles still agree with the store`, () => {
      const { world } = runSatellites(seed);
      expect(checkParcelAgreement(world.map, world.parcels)).toEqual([]);
    });
  }

  it('is deterministic for the same seed', () => {
    expect(hashWorld(runSatellites('moses-1').world)).toBe(hashWorld(runSatellites('moses-1').world));
  });
});
