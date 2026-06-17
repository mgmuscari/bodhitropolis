// PR B — inspect names. The pure display-name map behind the inspector (and,
// later, tooltips). A fact about BuiltKind, total over the taxonomy.

import { describe, it, expect } from 'vitest';
import { builtKindName } from '../../src/engine/builtNames';
import { BuiltKind } from '../../src/engine/fabric';

describe('builtKindName', () => {
  it('names empty land and the classic transport kinds', () => {
    expect(builtKindName(BuiltKind.None)).toBe('Open land');
    expect(builtKindName(BuiltKind.RoadStreet)).toBe('Street');
    expect(builtKindName(BuiltKind.RoadAvenue)).toBe('Avenue');
    expect(builtKindName(BuiltKind.RoadHighway)).toBe('Highway');
    expect(builtKindName(BuiltKind.Rail)).toBe('Rail');
  });

  it('names the Moses-era buildings in plain language', () => {
    expect(builtKindName(BuiltKind.HouseSingle)).toBe('Single-family Home');
    expect(builtKindName(BuiltKind.Apartments)).toBe('Apartments');
    expect(builtKindName(BuiltKind.Projects)).toBe('Housing Projects');
    expect(builtKindName(BuiltKind.CommercialStrip)).toBe('Commercial Strip');
    expect(builtKindName(BuiltKind.Offices)).toBe('Offices');
    expect(builtKindName(BuiltKind.Industrial)).toBe('Industry');
    expect(builtKindName(BuiltKind.ParkingLot)).toBe('Parking Lot');
    expect(builtKindName(BuiltKind.Civic)).toBe('Civic Building');
  });

  it('names the tech-era kinds and greens', () => {
    expect(builtKindName(BuiltKind.EnergyNode)).toBe('Energy Node');
    expect(builtKindName(BuiltKind.AINode)).toBe('AI Node');
    expect(builtKindName(BuiltKind.HealingCommons)).toBe('Healing Commons');
    expect(builtKindName(BuiltKind.Park)).toBe('Park');
    expect(builtKindName(BuiltKind.RewildedLand)).toBe('Rewilded Land');
  });

  it('is total: a non-empty string for every BuiltKind', () => {
    for (const k of Object.values(BuiltKind)) {
      const name = builtKindName(k as BuiltKind);
      expect(typeof name).toBe('string');
      expect(name.length).toBeGreaterThan(0);
    }
  });
});
