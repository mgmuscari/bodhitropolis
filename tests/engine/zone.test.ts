import { describe, it, expect } from 'vitest';
import { BuiltKind } from '../../src/engine/fabric';
import { ZoneType, zoneTypeOf } from '../../src/engine/zone';

describe('zoneTypeOf (zone taxonomy for RCI + O-D traffic)', () => {
  it('classifies residential building kinds', () => {
    for (const k of [
      BuiltKind.HouseSingle,
      BuiltKind.Apartments,
      BuiltKind.Projects,
      BuiltKind.ADU,
      BuiltKind.CoopHousing,
      BuiltKind.Commune,
    ]) {
      expect(zoneTypeOf(k)).toBe(ZoneType.Residential);
    }
  });

  it('classifies commercial building kinds', () => {
    for (const k of [BuiltKind.CommercialStrip, BuiltKind.Offices, BuiltKind.Bazaar, BuiltKind.MakerSpace]) {
      expect(zoneTypeOf(k)).toBe(ZoneType.Commercial);
    }
  });

  it('classifies industrial', () => {
    expect(zoneTypeOf(BuiltKind.Industrial)).toBe(ZoneType.Industrial);
  });

  it('classifies civic / amenity service kinds', () => {
    for (const k of [
      BuiltKind.Civic,
      BuiltKind.HealingCommons,
      BuiltKind.VerticalFarm,
      BuiltKind.WastewaterWorks,
      BuiltKind.EnergyNode,
      BuiltKind.AINode,
      BuiltKind.CompostHub,
    ]) {
      expect(zoneTypeOf(k)).toBe(ZoneType.Civic);
    }
  });

  it('classifies non-zone kinds (empty, transport, parking, greens) as None', () => {
    for (const k of [
      BuiltKind.None,
      BuiltKind.RoadStreet,
      BuiltKind.RoadHighway,
      BuiltKind.Rail,
      BuiltKind.QuietStreet,
      BuiltKind.ParkingLot,
      BuiltKind.Parklet,
      BuiltKind.CommunityGarden,
      BuiltKind.Park,
      BuiltKind.RewildedLand,
    ]) {
      expect(zoneTypeOf(k)).toBe(ZoneType.None);
    }
  });

  it('is total over every BuiltKind value (never undefined)', () => {
    const zoneValues = Object.values(ZoneType);
    for (const k of Object.values(BuiltKind)) {
      expect(zoneValues).toContain(zoneTypeOf(k));
    }
  });
});
