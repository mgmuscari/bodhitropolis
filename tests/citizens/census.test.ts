import { describe, it, expect } from 'vitest';
import { GameMap } from '../../src/engine/map';
import { ParcelStore, BuiltKind, placeParcel } from '../../src/engine/fabric';
import {
  citizensOf,
  residentialCensus,
  totalResidents,
  CITIZENS_PER_DENSITY,
} from '../../src/citizens/census';

describe('citizensOf (citizens housed by density)', () => {
  it('scales with density and houses nobody at zero', () => {
    expect(citizensOf(0)).toBe(0);
    expect(citizensOf(1)).toBe(CITIZENS_PER_DENSITY);
    expect(citizensOf(2)).toBe(2 * CITIZENS_PER_DENSITY);
    expect(citizensOf(3)).toBe(3 * CITIZENS_PER_DENSITY);
    expect(citizensOf(3)).toBeGreaterThan(citizensOf(1)); // denser construction → more people
  });
});

describe('residentialCensus (homes + their citizen counts)', () => {
  function city(): ParcelStore {
    const map = new GameMap(24, 16);
    const parcels = new ParcelStore();
    placeParcel(map, parcels, { x: 2, y: 2, width: 1, height: 1, kind: BuiltKind.HouseSingle, density: 1 });
    placeParcel(map, parcels, { x: 5, y: 2, width: 1, height: 1, kind: BuiltKind.Apartments, density: 3 });
    placeParcel(map, parcels, { x: 8, y: 2, width: 1, height: 1, kind: BuiltKind.CommercialStrip, density: 3 });
    placeParcel(map, parcels, { x: 11, y: 2, width: 1, height: 1, kind: BuiltKind.Industrial, density: 2 });
    return parcels;
  }

  it('lists only residential buildings, each with its citizen count', () => {
    const parcels = city();
    const census = residentialCensus(parcels);
    expect(census.length).toBe(2); // the house + the apartments — NOT the shop or the industry
    const byPos = new Map(census.map((h) => [`${h.x},${h.y}`, h.count]));
    expect(byPos.get('2,2')).toBe(citizensOf(1));
    expect(byPos.get('5,2')).toBe(citizensOf(3));
  });

  it('totals residents across the city, deterministically', () => {
    const parcels = city();
    expect(totalResidents(parcels)).toBe(citizensOf(1) + citizensOf(3));
    expect(residentialCensus(parcels)).toEqual(residentialCensus(parcels)); // stable, pure
  });
});
