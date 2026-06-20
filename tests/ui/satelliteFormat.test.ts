import { describe, it, expect } from 'vitest';
import { GameMap, Water, LandCover } from '../../src/engine/map';
import { BuiltKind, transportCategory } from '../../src/engine/fabric';
import {
  SatType,
  DATA_CHANNELS,
  BUILDING_TYPE,
  satTypeAt,
  buildingHeight,
  packCell,
} from '../../src/ui/satelliteFormat';

// The CPU↔GPU data contract: four bytes per cell packed from the deterministic
// world. R = tile type (SatType), G = height/band/class, B = transport adjacency
// mask, A = live sim scalar. Both gridTextureBridge (writer) and satelliteShader
// (GLSL reader) key off these, so the packing is the seam under test.

describe('satelliteFormat: channel contract', () => {
  it('packs four channels per cell', () => {
    expect(DATA_CHANNELS).toBe(4);
  });
});

describe('satelliteFormat: satTypeAt', () => {
  it('reads bare/meadow/grass/forest as Terrain', () => {
    const m = new GameMap(8, 8);
    expect(satTypeAt(m, 1, 1)).toBe(SatType.Terrain);
  });

  it('reads any water class as Water', () => {
    const m = new GameMap(8, 8);
    m.setWater(2, 2, Water.Ocean);
    m.setWater(3, 2, Water.Lake);
    m.setWater(4, 2, Water.River);
    expect(satTypeAt(m, 2, 2)).toBe(SatType.Water);
    expect(satTypeAt(m, 3, 2)).toBe(SatType.Water);
    expect(satTypeAt(m, 4, 2)).toBe(SatType.Water);
  });

  it('reads road kinds as Road, planted median as Green', () => {
    const m = new GameMap(8, 8);
    m.setBuilt(3, 3, BuiltKind.RoadStreet);
    m.setBuilt(3, 4, BuiltKind.PlantedMedian);
    expect(satTypeAt(m, 3, 3)).toBe(SatType.Road);
    expect(satTypeAt(m, 3, 4)).toBe(SatType.Green);
  });

  it('buckets buildings into archetypes', () => {
    const m = new GameMap(8, 8);
    m.setBuilt(5, 5, BuiltKind.Offices);
    m.setBuilt(5, 6, BuiltKind.HouseSingle);
    m.setBuilt(5, 7, BuiltKind.CoalPlant);
    expect(satTypeAt(m, 5, 5)).toBe(SatType.Commercial);
    expect(satTypeAt(m, 5, 6)).toBe(SatType.Residential);
    expect(satTypeAt(m, 5, 7)).toBe(SatType.Power);
  });

  it('built layer overrides underlying water/terrain', () => {
    const m = new GameMap(8, 8);
    m.setWater(2, 2, Water.River);
    m.setBuilt(2, 2, BuiltKind.RoadStreet); // a bridge deck over the river
    expect(satTypeAt(m, 2, 2)).toBe(SatType.Road);
  });
});

describe('satelliteFormat: BUILDING_TYPE map', () => {
  it('routes housing, commerce, industry, civic, power, green', () => {
    expect(BUILDING_TYPE[BuiltKind.Apartments]).toBe(SatType.Residential);
    expect(BUILDING_TYPE[BuiltKind.Bazaar]).toBe(SatType.Commercial);
    expect(BUILDING_TYPE[BuiltKind.Industrial]).toBe(SatType.Industrial);
    expect(BUILDING_TYPE[BuiltKind.Clinic]).toBe(SatType.Civic);
    expect(BUILDING_TYPE[BuiltKind.NuclearPlant]).toBe(SatType.Power);
    expect(BUILDING_TYPE[BuiltKind.CommunityGarden]).toBe(SatType.Green);
  });
});

describe('satelliteFormat: buildingHeight', () => {
  it('gives taller structures larger shadow-casting height', () => {
    expect(buildingHeight(BuiltKind.Offices)).toBeGreaterThan(buildingHeight(BuiltKind.HouseSingle));
    expect(buildingHeight(BuiltKind.ParkingLot)).toBeLessThan(buildingHeight(BuiltKind.Apartments));
  });

  it('stays within a byte', () => {
    for (const k of Object.values(BuiltKind)) {
      const h = buildingHeight(k as number);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThanOrEqual(255);
    }
  });
});

describe('satelliteFormat: packCell', () => {
  it('writes terrain band in the low bits of G', () => {
    const m = new GameMap(8, 8);
    m.setLandCover(1, 1, LandCover.Grass); // band 2
    const out = new Uint8Array(DATA_CHANNELS);
    packCell(m, 1, 1, out, 0);
    expect(out[0]).toBe(SatType.Terrain);
    expect(out[1]! & 0x3).toBe(LandCover.Grass);
  });

  it('writes water class into G for water cells', () => {
    const m = new GameMap(8, 8);
    m.setWater(2, 2, Water.Ocean);
    const out = new Uint8Array(DATA_CHANNELS);
    packCell(m, 2, 2, out, 0);
    expect(out[0]).toBe(SatType.Water);
    expect(out[1]).toBe(Water.Ocean);
  });

  it('writes road class into G and adjacency into B', () => {
    const m = new GameMap(8, 8);
    m.setBuilt(3, 3, BuiltKind.RoadStreet);
    m.setBuilt(4, 3, BuiltKind.RoadStreet); // neighbour to the East (bit 2)
    const out = new Uint8Array(DATA_CHANNELS);
    packCell(m, 3, 3, out, 0);
    expect(out[0]).toBe(SatType.Road);
    expect(out[1]).toBe(transportCategory(BuiltKind.RoadStreet));
    expect(out[2]! & 0x2).toBe(0x2); // East connection set
  });

  it('writes building height into G and traffic into A', () => {
    const m = new GameMap(8, 8);
    m.setBuilt(5, 5, BuiltKind.Offices);
    m.traffic[m.idx(5, 5)] = 200;
    const out = new Uint8Array(DATA_CHANNELS);
    packCell(m, 5, 5, out, 0);
    expect(out[0]).toBe(SatType.Commercial);
    expect(out[1]).toBe(buildingHeight(BuiltKind.Offices));
    expect(out[2]).toBe(0); // no transport adjacency under a building
    expect(out[3]).toBe(200); // live sim scalar
  });

  it('writes at the given byte offset, leaving the rest untouched', () => {
    const m = new GameMap(8, 8);
    m.setWater(2, 2, Water.Lake);
    const out = new Uint8Array(DATA_CHANNELS * 2).fill(0xee);
    packCell(m, 2, 2, out, DATA_CHANNELS);
    expect(out[0]).toBe(0xee); // first cell untouched
    expect(out[DATA_CHANNELS]).toBe(SatType.Water);
  });
});
