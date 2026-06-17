import { describe, it, expect } from 'vitest';
import { GameMap } from '../../src/engine/map';
import { ParcelStore, BuiltKind, placeParcel, placeTransport } from '../../src/engine/fabric';
import { computeNeighborhoods } from '../../src/civic/neighborhoods';
import { createCivicState } from '../../src/civic/state';
import { createTechState } from '../../src/tech/state';
import { TECH_TREE } from '../../src/tech/tree';
import { applyTool, toolDef } from '../../src/tools/tools';
import { simTick, CIVIC_CADENCE, type SimDeps } from '../../src/civic/compose';

function makeWorld(): { map: GameMap; parcels: ParcelStore } {
  const map = new GameMap(16, 16);
  const parcels = new ParcelStore();
  placeParcel(map, parcels, { x: 2, y: 2, width: 2, height: 2, kind: BuiltKind.CommunityGarden, condition: 200 });
  placeParcel(map, parcels, { x: 10, y: 10, width: 1, height: 1, kind: BuiltKind.HouseSingle, condition: 120 });
  placeTransport(map, 8, 8, BuiltKind.RoadHighway); // some fragmentation for ecology/civic
  map.soilHealth.fill(100);
  map.floraVitality.fill(80);
  map.faunaPresence.fill(50);
  return { map, parcels };
}

function makeDeps(): SimDeps {
  const world = makeWorld();
  const partition = computeNeighborhoods(world.map);
  return {
    world,
    tech: createTechState(TECH_TREE),
    civic: createCivicState(partition),
    partition,
    seed: 'compose-test',
  };
}

describe('simTick: cadence phases (tick>0 gated)', () => {
  it('fires nothing at tick 0 but still accrues effort', () => {
    const r = simTick(makeDeps(), 0);
    expect(r.ecoTicked).toBe(false);
    expect(r.civicTicked).toBe(false);
    expect(r.effortGained).toBeGreaterThan(0);
  });

  it('fires ecology only on a %10 non-%50 tick', () => {
    const r = simTick(makeDeps(), 10);
    expect(r.ecoTicked).toBe(true);
    expect(r.civicTicked).toBe(false);
  });

  it('fires both ecology and civic on a %50 tick', () => {
    const r = simTick(makeDeps(), CIVIC_CADENCE);
    expect(r.ecoTicked).toBe(true);
    expect(r.civicTicked).toBe(true);
  });

  it('fires neither on an off-cadence tick', () => {
    const r = simTick(makeDeps(), 7);
    expect(r.ecoTicked).toBe(false);
    expect(r.civicTicked).toBe(false);
  });

  it('caches eco/civic means after their recompute (effort then consumes them)', () => {
    const deps = makeDeps();
    expect(deps.ecoMeans).toBeUndefined();
    expect(deps.civicMeans).toBeUndefined();
    simTick(deps, 10);
    expect(deps.ecoMeans).toBeDefined();
    expect(deps.civicMeans).toBeUndefined(); // civic hasn't fired yet
    simTick(deps, CIVIC_CADENCE);
    expect(deps.civicMeans).toBeDefined();
  });
});

describe('simTick: composite determinism (N=120 double-run)', () => {
  it('yields byte-equal map + civic + tech (incl. effort) snapshots', () => {
    const run = (): { map: string; civic: Uint8Array; tech: Uint8Array } => {
      const deps = makeDeps();
      for (let tick = 1; tick <= 120; tick++) simTick(deps, tick);
      return {
        map: deps.world.map.snapshot(),
        civic: deps.civic.snapshotBytes(),
        tech: deps.tech.snapshotBytes(), // includes effort → covers eco/civic cache coherence
      };
    };
    const a = run();
    const b = run();
    expect(a.map).toBe(b.map);
    expect(a.civic).toEqual(b.civic);
    expect(a.tech).toEqual(b.tech);
  });

  it('actually advances civic state over the run (non-vacuous)', () => {
    const deps = makeDeps();
    const before = deps.civic.snapshotBytes();
    for (let tick = 1; tick <= 120; tick++) simTick(deps, tick);
    expect(deps.civic.snapshotBytes()).not.toEqual(before);
  });
});

describe('simTick: TechState integration guard (delta accounting)', () => {
  it('moves tech.effort ONLY by accruals and an explicit placement spend', () => {
    const deps = makeDeps();
    let expected = deps.tech.effort;
    for (let tick = 1; tick <= 60; tick++) {
      const r = simTick(deps, tick);
      expected += r.effortGained;
      if (tick === 30) {
        // a real tools placement (bulldoze the highway): a pure TechState.spend.
        const before = deps.tech.effort;
        const res = applyTool(deps.world, deps.tech, toolDef('bulldoze')!, 8, 8);
        expect(res.ok).toBe(true);
        expected -= before - deps.tech.effort; // exactly the spend; eco/civic never write tech
      }
    }
    expect(deps.tech.effort).toBe(expected);
  });
});

describe('simTick: traffic fires at the cadence (rng enters the sim)', () => {
  function connectedCity(): SimDeps {
    const map = new GameMap(20, 8);
    const parcels = new ParcelStore();
    placeParcel(map, parcels, { x: 2, y: 3, width: 1, height: 1, kind: BuiltKind.CommercialStrip, density: 3 });
    for (let x = 2; x <= 14; x++) placeTransport(map, x, 4, BuiltKind.RoadStreet);
    placeParcel(map, parcels, { x: 14, y: 3, width: 1, height: 1, kind: BuiltKind.Industrial, density: 3 });
    const partition = computeNeighborhoods(map);
    return {
      world: { map, parcels },
      tech: createTechState(TECH_TREE),
      civic: createCivicState(partition),
      partition,
      seed: 'traffic-fire',
    };
  }

  it('no longer lays a deterministic traffic field (agent-driven now); seeded world stays identical', () => {
    const drive = (d: SimDeps): void => {
      for (let t = 1; t <= 30; t++) simTick(d, t);
    };
    const a = connectedCity();
    drive(a);
    const b = connectedCity();
    drive(b);
    let total = 0;
    for (let i = 0; i < a.world.map.traffic.length; i++) total += a.world.map.traffic[i]!;
    expect(total).toBe(0); // the deterministic O-D generator is retired — traffic is agent-driven (live layer)
    expect(a.world.map.snapshot()).toBe(b.world.map.snapshot()); // seeded world still byte-identical
  });
});

describe('simTick: fabric isolation on pure runs (no placements)', () => {
  it('leaves the built/parcel layers and the parcel store byte-stable', () => {
    const deps = makeDeps();
    const builtBefore = deps.world.map.built.slice();
    const parcelLayerBefore = deps.world.map.parcel.slice();
    const parcelsBefore = deps.world.parcels.snapshotBytes();
    for (let tick = 1; tick <= 120; tick++) simTick(deps, tick);
    expect(deps.world.map.built).toEqual(builtBefore);
    expect(deps.world.map.parcel).toEqual(parcelLayerBefore);
    expect(deps.world.parcels.snapshotBytes()).toEqual(parcelsBefore);
  });
});
