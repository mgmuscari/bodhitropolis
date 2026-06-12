import { describe, it, expect } from 'vitest';
import { runPipeline } from '../../src/worldgen/pipeline';
import { GameMap, Water, LandCover } from '../../src/engine/map';
import { createRng } from '../../src/engine/rng';
import {
  terrainStage,
  generateElevation,
  classifyWater,
  selectSprings,
  DEFAULT_TERRAIN_PARAMS,
} from '../../src/worldgen/terrain';

const SEEDS = ['bodhi-1', 'bodhi-2', 'bodhi-3', 'bodhi-4', 'bodhi-5'];

function generate(seed: string, width = 128, height = 128) {
  return runPipeline({ seed, width, height }, [terrainStage()]);
}

function waterFraction(map: GameMap): number {
  let w = 0;
  for (let i = 0; i < map.water.length; i++) if (map.water[i] !== Water.None) w++;
  return w / map.water.length;
}

function landCoverFraction(map: GameMap, cover: LandCover): number {
  let c = 0;
  for (let i = 0; i < map.landCover.length; i++) if (map.landCover[i] === cover) c++;
  return c / map.landCover.length;
}

describe('terrainStage determinism', () => {
  it('produces an identical snapshot for the same seed', () => {
    const a = generate('bodhi-1', 96, 96);
    const b = generate('bodhi-1', 96, 96);
    expect(a.map.snapshot()).toBe(b.map.snapshot());
  });

  it('produces different snapshots for different seeds', () => {
    const a = generate('bodhi-1', 96, 96);
    const b = generate('bodhi-2', 96, 96);
    expect(a.map.snapshot()).not.toBe(b.map.snapshot());
  });
});

describe('terrainStage plausibility bounds', () => {
  for (const seed of SEEDS) {
    it(`seed "${seed}" has water fraction in [0.08, 0.45]`, () => {
      const f = waterFraction(generate(seed).map);
      expect(f).toBeGreaterThanOrEqual(0.08);
      expect(f).toBeLessThanOrEqual(0.45);
    });

    it(`seed "${seed}" has forest fraction in [0.05, 0.55]`, () => {
      const f = landCoverFraction(generate(seed).map, LandCover.Forest);
      expect(f).toBeGreaterThanOrEqual(0.05);
      expect(f).toBeLessThanOrEqual(0.55);
    });
  }
});

describe('terrainStage invariants', () => {
  it('land cover is Bare on every water cell', () => {
    const { map } = generate('bodhi-3');
    for (let i = 0; i < map.water.length; i++) {
      if (map.water[i] !== Water.None) {
        expect(map.landCover[i]).toBe(LandCover.Bare);
      }
    }
  });

  it('selectSprings only returns cells above sea level', () => {
    // Hand-crafted elevation: a gradient with cells both below and above
    // sea level. selectSprings must never pick a below-sea cell.
    const map = new GameMap(16, 16);
    const seaLevel = DEFAULT_TERRAIN_PARAMS.seaLevel;
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        // elevation ramps 0..~1 across the map
        map.setElevation(x, y, (x + y) / 30);
      }
    }
    classifyWater(map, seaLevel);
    const rng = createRng('springs');
    const springs = selectSprings(map, rng, 5, seaLevel);
    expect(springs.length).toBeGreaterThan(0);
    for (const i of springs) {
      expect(map.elevation[i]!).toBeGreaterThan(seaLevel);
      expect(map.water[i]).toBe(Water.None);
    }
  });
});

describe('terrainStage river connectivity', () => {
  // Every connected component of River cells must drain: it must contain at
  // least one cell on the map edge OR 4-adjacent to an Ocean/Lake cell. A
  // stranded river loop in the middle of land fails this. (Mere river-
  // neighbour adjacency is vacuous: river cells are themselves water.)
  function assertRiversDrain(map: GameMap): number {
    const { width, height } = map;
    const isRiver = (i: number) => map.water[i] === Water.River;
    const seen = new Uint8Array(width * height);
    let componentCount = 0;

    for (let start = 0; start < width * height; start++) {
      if (!isRiver(start) || seen[start]) continue;
      componentCount++;

      // BFS the component; check the drainage predicate over its cells.
      const queue = [start];
      seen[start] = 1;
      let drains = false;
      let head = 0;
      while (head < queue.length) {
        const i = queue[head++]!;
        const x = i % width;
        const y = (i - x) / width;

        if (x === 0 || y === 0 || x === width - 1 || y === height - 1) {
          drains = true;
        }
        const neighbours: Array<[number, number]> = [
          [x - 1, y],
          [x + 1, y],
          [x, y - 1],
          [x, y + 1],
        ];
        for (const [nx, ny] of neighbours) {
          if (!map.inBounds(nx, ny)) continue;
          const ni = map.idx(nx, ny);
          const w = map.water[ni];
          if (w === Water.Ocean || w === Water.Lake) drains = true;
          if (isRiver(ni) && !seen[ni]) {
            seen[ni] = 1;
            queue.push(ni);
          }
        }
      }
      expect(drains).toBe(true);
    }
    return componentCount;
  }

  for (const seed of SEEDS) {
    it(`seed "${seed}": every river component drains to edge or water`, () => {
      const componentCount = assertRiversDrain(generate(seed).map);
      // Guard against a vacuous pass: the drainage invariant is trivially
      // satisfied by zero rivers, so assert rivers actually exist.
      expect(componentCount).toBeGreaterThanOrEqual(1);
    });
  }
});

describe('generateElevation', () => {
  it('normalizes elevation to span [0, 1]', () => {
    const map = new GameMap(64, 64);
    generateElevation(map, createRng('elev'), 48, { octaves: 5, lacunarity: 2, gain: 0.5 });
    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < map.elevation.length; i++) {
      min = Math.min(min, map.elevation[i]!);
      max = Math.max(max, map.elevation[i]!);
    }
    expect(min).toBeCloseTo(0, 5);
    expect(max).toBeCloseTo(1, 5);
  });
});
