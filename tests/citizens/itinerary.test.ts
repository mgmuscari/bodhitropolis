import { describe, it, expect } from 'vitest';
import { BuiltKind } from '../../src/engine/fabric';
import { StopCategory, stopCategoryOf, DAILY_ITINERARY } from '../../src/citizens/itinerary';

describe('stopCategoryOf (which daily-itinerary stop a plot serves)', () => {
  it('maps workplaces to Work', () => {
    expect(stopCategoryOf(BuiltKind.Industrial)).toBe(StopCategory.Work);
    expect(stopCategoryOf(BuiltKind.Offices)).toBe(StopCategory.Work);
  });

  it('maps commerce to Shop', () => {
    expect(stopCategoryOf(BuiltKind.CommercialStrip)).toBe(StopCategory.Shop);
    expect(stopCategoryOf(BuiltKind.Bazaar)).toBe(StopCategory.Shop);
    expect(stopCategoryOf(BuiltKind.MakerSpace)).toBe(StopCategory.Shop);
  });

  it('maps civic/restorative plots to Lifestyle', () => {
    expect(stopCategoryOf(BuiltKind.Civic)).toBe(StopCategory.Lifestyle);
    expect(stopCategoryOf(BuiltKind.HealingCommons)).toBe(StopCategory.Lifestyle);
    expect(stopCategoryOf(BuiltKind.VerticalFarm)).toBe(StopCategory.Lifestyle);
    expect(stopCategoryOf(BuiltKind.CompostHub)).toBe(StopCategory.Lifestyle);
    expect(stopCategoryOf(BuiltKind.AINode)).toBe(StopCategory.Lifestyle);
  });

  it('maps green/open space to Leisure (parks join the destination loop — Maddy 2026-06-20)', () => {
    expect(stopCategoryOf(BuiltKind.Park)).toBe(StopCategory.Leisure);
    expect(stopCategoryOf(BuiltKind.RewildedLand)).toBe(StopCategory.Leisure);
    expect(stopCategoryOf(BuiltKind.CommunityGarden)).toBe(StopCategory.Leisure);
    expect(stopCategoryOf(BuiltKind.Parklet)).toBe(StopCategory.Leisure);
  });

  it('returns 0 (not a daily-itinerary destination) for homes, transport, empty', () => {
    expect(stopCategoryOf(BuiltKind.HouseSingle)).toBe(0); // home, not a visit
    expect(stopCategoryOf(BuiltKind.Apartments)).toBe(0);
    expect(stopCategoryOf(BuiltKind.RoadStreet)).toBe(0);
    expect(stopCategoryOf(BuiltKind.Promenade)).toBe(0); // a walkway, not a leisure destination
    expect(stopCategoryOf(BuiltKind.None)).toBe(0);
  });

  it('DAILY_ITINERARY is work → shop → lifestyle → leisure, in that order', () => {
    expect(DAILY_ITINERARY).toEqual([
      StopCategory.Work,
      StopCategory.Shop,
      StopCategory.Lifestyle,
      StopCategory.Leisure,
    ]);
  });
});
