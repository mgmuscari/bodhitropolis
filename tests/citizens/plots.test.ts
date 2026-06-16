import { describe, it, expect } from 'vitest';
import { BuiltKind } from '../../src/engine/fabric';
import {
  plotWellbeing,
  isNewUrbanist,
  plotBuff,
  visitValue,
  NEW_URBANIST_BUFF,
} from '../../src/citizens/plots';

describe('plotWellbeing (what a visit contributes, by use)', () => {
  it('orders industrial < conventional commercial < civic < new-urbanist', () => {
    expect(plotWellbeing(BuiltKind.Industrial)).toBeLessThan(0); // industry harms
    expect(plotWellbeing(BuiltKind.CommercialStrip)).toBeGreaterThan(plotWellbeing(BuiltKind.Industrial));
    expect(plotWellbeing(BuiltKind.Civic)).toBeGreaterThan(plotWellbeing(BuiltKind.CommercialStrip));
    expect(plotWellbeing(BuiltKind.HealingCommons)).toBeGreaterThan(plotWellbeing(BuiltKind.Civic));
  });

  it('is zero for non-destinations (homes, empty, transport)', () => {
    expect(plotWellbeing(BuiltKind.HouseSingle)).toBe(0);
    expect(plotWellbeing(BuiltKind.None)).toBe(0);
    expect(plotWellbeing(BuiltKind.RoadStreet)).toBe(0);
  });
});

describe('new-urbanist buffs (carried home)', () => {
  it('grants a buff for tech-tree restorative plots, none for conventional ones', () => {
    expect(isNewUrbanist(BuiltKind.HealingCommons)).toBe(true);
    expect(isNewUrbanist(BuiltKind.Bazaar)).toBe(true);
    expect(isNewUrbanist(BuiltKind.CommercialStrip)).toBe(false);
    expect(isNewUrbanist(BuiltKind.Industrial)).toBe(false);
    expect(plotBuff(BuiltKind.HealingCommons)).toBe(NEW_URBANIST_BUFF);
    expect(plotBuff(BuiltKind.CommercialStrip)).toBe(0);
  });
});

describe('visitValue (base + buff — the home deposit)', () => {
  it('adds the buff for new-urbanist plots, leaves conventional ones at base', () => {
    expect(visitValue(BuiltKind.CommercialStrip)).toBe(plotWellbeing(BuiltKind.CommercialStrip));
    expect(visitValue(BuiltKind.HealingCommons)).toBe(
      plotWellbeing(BuiltKind.HealingCommons) + NEW_URBANIST_BUFF,
    );
    // a new-urbanist visit beats a conventional commercial one, which beats industrial
    expect(visitValue(BuiltKind.HealingCommons)).toBeGreaterThan(visitValue(BuiltKind.CommercialStrip));
    expect(visitValue(BuiltKind.CommercialStrip)).toBeGreaterThan(visitValue(BuiltKind.Industrial));
  });
});
