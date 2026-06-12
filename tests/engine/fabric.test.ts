import { describe, it, expect } from 'vitest';
import {
  BuiltKind,
  isRoadKind,
  isTransportKind,
  isBuildingKind,
} from '../../src/engine/fabric';

describe('BuiltKind taxonomy', () => {
  it('reserves 0 for None and packs transport into 1..4', () => {
    expect(BuiltKind.None).toBe(0);
    expect(BuiltKind.RoadStreet).toBe(1);
    expect(BuiltKind.RoadAvenue).toBe(2);
    expect(BuiltKind.RoadHighway).toBe(3);
    expect(BuiltKind.Rail).toBe(4);
  });

  it('packs Moses-era buildings into 16..23', () => {
    expect(BuiltKind.HouseSingle).toBe(16);
    expect(BuiltKind.Apartments).toBe(17);
    expect(BuiltKind.Projects).toBe(18);
    expect(BuiltKind.CommercialStrip).toBe(19);
    expect(BuiltKind.Offices).toBe(20);
    expect(BuiltKind.Industrial).toBe(21);
    expect(BuiltKind.ParkingLot).toBe(22);
    expect(BuiltKind.Civic).toBe(23);
  });
});

describe('BuiltKind predicates (boundaries)', () => {
  it('isRoadKind is true on 1..3 only', () => {
    expect(isRoadKind(0)).toBe(false); // None
    expect(isRoadKind(1)).toBe(true); // RoadStreet
    expect(isRoadKind(3)).toBe(true); // RoadHighway
    expect(isRoadKind(4)).toBe(false); // Rail is transport, not road
    expect(isRoadKind(16)).toBe(false); // building
  });

  it('isTransportKind is true on 1..4 only', () => {
    expect(isTransportKind(0)).toBe(false);
    expect(isTransportKind(1)).toBe(true);
    expect(isTransportKind(4)).toBe(true); // Rail
    expect(isTransportKind(5)).toBe(false);
    expect(isTransportKind(16)).toBe(false);
  });

  it('isBuildingKind is true on 16..47 only', () => {
    expect(isBuildingKind(15)).toBe(false);
    expect(isBuildingKind(16)).toBe(true); // first building
    expect(isBuildingKind(23)).toBe(true); // last defined Moses building
    expect(isBuildingKind(47)).toBe(true); // top of reserved range
    expect(isBuildingKind(48)).toBe(false); // tech-tree era reserved, not a building yet
    expect(isBuildingKind(0)).toBe(false);
    expect(isBuildingKind(4)).toBe(false); // transport
  });
});
