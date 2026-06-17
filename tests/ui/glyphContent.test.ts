// PR A — parcel glyphs (legibility). The pure decision behind the SNES-style
// R1/R2/R3 · C · I · civic letters the renderer stamps on each parcel. Pure: a
// total map over BuiltKind, density-aware for RCI, null where a glyph would only
// clutter (greens / parking / transport / empty).

import { describe, it, expect } from 'vitest';
import { parcelGlyph } from '../../src/ui/glyphContent';
import { BuiltKind } from '../../src/engine/fabric';

describe('parcelGlyph: residential density tiers', () => {
  it('labels homes R1/R2/R3 by density', () => {
    expect(parcelGlyph(BuiltKind.HouseSingle, 1)).toBe('R1');
    expect(parcelGlyph(BuiltKind.HouseSingle, 2)).toBe('R2');
    expect(parcelGlyph(BuiltKind.HouseSingle, 3)).toBe('R3');
  });

  it('clamps density into 1..3', () => {
    expect(parcelGlyph(BuiltKind.HouseSingle, 0)).toBe('R1');
    expect(parcelGlyph(BuiltKind.HouseSingle, 9)).toBe('R3');
  });

  it('treats every residential kind as R', () => {
    for (const k of [
      BuiltKind.HouseSingle,
      BuiltKind.Apartments,
      BuiltKind.Projects,
      BuiltKind.ADU,
      BuiltKind.CoopHousing,
      BuiltKind.Commune,
    ]) {
      expect(parcelGlyph(k, 2)).toBe('R2');
    }
  });
});

describe('parcelGlyph: commercial + industrial density tiers', () => {
  it('labels commercial kinds C with density', () => {
    for (const k of [
      BuiltKind.CommercialStrip,
      BuiltKind.Offices,
      BuiltKind.Bazaar,
      BuiltKind.MakerSpace,
    ]) {
      expect(parcelGlyph(k, 3)).toBe('C3');
    }
  });

  it('labels industrial I with density', () => {
    expect(parcelGlyph(BuiltKind.Industrial, 1)).toBe('I1');
    expect(parcelGlyph(BuiltKind.Industrial, 2)).toBe('I2');
  });
});

describe('parcelGlyph: civic glyphs (density-independent)', () => {
  it('gives each civic kind a distinct short glyph', () => {
    expect(parcelGlyph(BuiltKind.Civic, 1)).toBe('+');
    expect(parcelGlyph(BuiltKind.HealingCommons, 1)).toBe('H');
    expect(parcelGlyph(BuiltKind.VerticalFarm, 1)).toBe('F');
    expect(parcelGlyph(BuiltKind.WastewaterWorks, 1)).toBe('W');
    expect(parcelGlyph(BuiltKind.EnergyNode, 1)).toBe('P');
    expect(parcelGlyph(BuiltKind.AINode, 1)).toBe('AI');
    expect(parcelGlyph(BuiltKind.CompostHub, 1)).toBe('K');
  });

  it('ignores density for civic glyphs', () => {
    expect(parcelGlyph(BuiltKind.Civic, 3)).toBe('+');
  });
});

describe('parcelGlyph: no glyph for greens / parking / transport / empty', () => {
  it('returns null where a letter would only clutter', () => {
    for (const k of [
      BuiltKind.None,
      BuiltKind.Park,
      BuiltKind.RewildedLand,
      BuiltKind.Parklet,
      BuiltKind.CommunityGarden,
      BuiltKind.ParkingLot,
      BuiltKind.RoadStreet,
      BuiltKind.RoadAvenue,
      BuiltKind.RoadHighway,
      BuiltKind.Rail,
      BuiltKind.Promenade,
    ]) {
      expect(parcelGlyph(k, 1)).toBeNull();
    }
  });
});

describe('parcelGlyph: totality', () => {
  it('returns a string or null for every BuiltKind without throwing', () => {
    for (const k of Object.values(BuiltKind)) {
      const g = parcelGlyph(k as BuiltKind, 1);
      expect(g === null || typeof g === 'string').toBe(true);
    }
  });
});
