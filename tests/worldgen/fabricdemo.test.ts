import { describe, it, expect } from 'vitest';
import { runPipeline, type WorldgenStage } from '../../src/worldgen/pipeline';
import { Water } from '../../src/engine/map';
import {
  BuiltKind,
  hashWorld,
  parcelTouchesRoad,
  transportMask,
  checkParcelAgreement,
} from '../../src/engine/fabric';
import { fabricDemoStage } from '../../src/worldgen/fabricdemo';

const BUILDING_KINDS = [
  BuiltKind.HouseSingle,
  BuiltKind.Apartments,
  BuiltKind.Projects,
  BuiltKind.CommercialStrip,
  BuiltKind.Offices,
  BuiltKind.Industrial,
  BuiltKind.ParkingLot,
  BuiltKind.Civic,
];

// A test stage painting a 64x64 world as all-land with an 8x8 water patch in the
// NW corner (far from centre). The centred 24x24 site window is all land, so
// fabric-demo always finds a site; the water patch keeps "no built on water"
// non-vacuous (water actually exists to avoid).
function landWithCornerWater(): WorldgenStage {
  return {
    name: 'test-paint',
    apply(world) {
      for (let y = 0; y < 8; y++) {
        for (let x = 0; x < 8; x++) {
          world.map.setWater(x, y, Water.Ocean);
        }
      }
    },
  };
}

function demoWorld(seed: string) {
  return runPipeline({ seed, width: 64, height: 64 }, [landWithCornerWater(), fabricDemoStage()]);
}

function popcount(n: number): number {
  let c = 0;
  for (let v = n; v !== 0; v >>= 1) c += v & 1;
  return c;
}

describe('fabricDemoStage determinism', () => {
  it('produces an identical canonical hash for the same seed', () => {
    expect(hashWorld(demoWorld('town-1'))).toBe(hashWorld(demoWorld('town-1')));
  });

  it('produces different canonical hashes for different seeds', () => {
    expect(hashWorld(demoWorld('town-1'))).not.toBe(hashWorld(demoWorld('town-2')));
  });

  it('places parcels, so parcel attributes participate in the canonical hash', () => {
    expect(demoWorld('town-1').parcels.count()).toBeGreaterThan(0);
  });
});

describe('fabricDemoStage placement properties', () => {
  for (const seed of ['town-1', 'town-2', 'town-3']) {
    it(`seed "${seed}": places at least one of every building kind`, () => {
      const { parcels } = demoWorld(seed);
      const present = new Set<number>();
      for (let i = 0; i < parcels.count(); i++) present.add(parcels.kindAt(i));
      for (const k of BUILDING_KINDS) expect(present.has(k)).toBe(true);
    });

    it(`seed "${seed}": every parcel touches a road`, () => {
      const { map, parcels } = demoWorld(seed);
      expect(parcels.count()).toBeGreaterThan(0);
      for (let i = 0; i < parcels.count(); i++) {
        expect(parcelTouchesRoad(map, parcels, i)).toBe(true);
      }
    });

    it(`seed "${seed}": no built tile sits on water`, () => {
      const { map } = demoWorld(seed);
      for (let i = 0; i < map.built.length; i++) {
        if (map.built[i] !== 0) expect(map.water[i]).toBe(Water.None);
      }
    });

    it(`seed "${seed}": a crossroads junction tile exists (mask has >= 3 bits)`, () => {
      const { map } = demoWorld(seed);
      let found = false;
      for (let y = 0; y < map.height && !found; y++) {
        for (let x = 0; x < map.width; x++) {
          if (map.getBuilt(x, y) !== 0 && popcount(transportMask(map, x, y)) >= 3) {
            found = true;
            break;
          }
        }
      }
      expect(found).toBe(true);
    });

    it(`seed "${seed}": passes the bidirectional tile/store agreement sweep`, () => {
      const { map, parcels } = demoWorld(seed);
      expect(checkParcelAgreement(map, parcels)).toEqual([]);
    });
  }
});

describe('fabricDemoStage degenerate maps', () => {
  it('places nothing and logs "no site" on an all-water map (no throw)', () => {
    const allWater: WorldgenStage = {
      name: 'test-all-water',
      apply(world) {
        world.map.water.fill(Water.Ocean);
      },
    };
    const world = runPipeline({ seed: 'drowned', width: 32, height: 32 }, [allWater, fabricDemoStage()]);
    expect(world.log).toContain('fabric-demo: no site');
    let built = 0;
    for (let i = 0; i < world.map.built.length; i++) if (world.map.built[i] !== 0) built++;
    expect(built).toBe(0);
    expect(world.parcels.count()).toBe(0);
  });
});
