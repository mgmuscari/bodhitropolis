import { describe, it, expect } from 'vitest';
import { GameMap, Water } from '../../src/engine/map';
import { createAmbientState } from '../../src/ui/ambientContent';
import {
  sampleRestoration,
  restorationReadout,
  restorationLines,
  type RestorationSample,
} from '../../src/ui/restorationContent';

describe('sampleRestoration — aggregates the live restoration metrics', () => {
  it('means the keyed fields and totals the pollution fields', () => {
    const map = new GameMap(8, 8); // all land (no water) by default
    const state = createAmbientState();
    state.landValue.set(0, 40);
    state.landValue.set(1, 80); // mean 60
    state.occupancy.set(0, 5);
    state.occupancy.set(1, 7); // total 12
    state.buildingHealth.set(0, -10);
    state.buildingHealth.set(1, 30); // mean 10
    state.pollution.set(0, 100);
    state.pollution.set(1, 50); // total 150
    state.groundPollution.set(2, 20); // total 20
    state.waterPollution.set(3, 9); // total 9
    const s = sampleRestoration(state, map);
    expect(s.landValue).toBe(60);
    expect(s.occupancy).toBe(12);
    expect(s.buildingHealth).toBe(10);
    expect(s.airPollution).toBe(150);
    expect(s.groundPollution).toBe(20);
    expect(s.waterPollution).toBe(9);
  });

  it('empty maps read zero (no NaN from dividing by zero)', () => {
    const s = sampleRestoration(createAmbientState(), new GameMap(4, 4));
    expect(s.landValue).toBe(0);
    expect(s.occupancy).toBe(0);
    expect(s.buildingHealth).toBe(0);
    expect(s.ecology).toBe(0);
    expect(Number.isNaN(s.landValue)).toBe(false);
  });

  it('ecology richness means flora × faunaPresence over LAND tiles only', () => {
    const map = new GameMap(4, 4);
    // one rich land tile (flora & fauna both high → richness ≈ 255), the rest bare (0)
    map.floraVitality[map.idx(1, 1)] = 255;
    map.faunaPresence[map.idx(1, 1)] = 255;
    // a water tile carries no terrestrial richness and is excluded from the denominator
    map.setWater(0, 0, Water.River);
    const s = sampleRestoration(createAmbientState(), map);
    // 15 land tiles, one at ~255 → mean ≈ 17
    expect(s.ecology).toBeGreaterThan(0);
    expect(s.ecology).toBeLessThan(255);
  });
});

describe('restorationReadout — improvement-oriented trend arrows', () => {
  const base: RestorationSample = {
    landValue: 50, occupancy: 100, buildingHealth: 0,
    ecology: 30, airPollution: 200, groundPollution: 100, waterPollution: 50,
  };

  it('no prior sample → every metric is flat', () => {
    const lines = restorationReadout(base, null);
    expect(lines.every((l) => l.trend === '→')).toBe(true);
  });

  it('a rising VALUE metric (land value, population...) reads ↗ when it grows', () => {
    const prev = { ...base, landValue: 40 };
    const cur = { ...base, landValue: 50 };
    const lv = restorationReadout(cur, prev).find((l) => l.label.includes('Land'))!;
    expect(lv.trend).toBe('↗'); // higher land value = improvement
  });

  it('a POLLUTION metric reads ↗ (improving) when it FALLS, ↘ when it rises', () => {
    const cleaner = restorationReadout({ ...base, airPollution: 150 }, base);
    const air1 = cleaner.find((l) => l.label.includes('Air'))!;
    expect(air1.trend).toBe('↗'); // less smog = your renewal helping

    const dirtier = restorationReadout({ ...base, airPollution: 250 }, base);
    const air2 = dirtier.find((l) => l.label.includes('Air'))!;
    expect(air2.trend).toBe('↘'); // more smog = worse
  });

  it('an unchanged metric is flat', () => {
    const lv = restorationReadout(base, { ...base }).find((l) => l.label.includes('Land'))!;
    expect(lv.trend).toBe('→');
  });
});

describe('restorationLines — formats label, value, trend', () => {
  it('renders one human line per metric with its arrow', () => {
    const base: RestorationSample = {
      landValue: 50, occupancy: 100, buildingHealth: 0,
      ecology: 30, airPollution: 200, groundPollution: 100, waterPollution: 50,
    };
    const lines = restorationLines({ ...base, landValue: 60 }, base);
    expect(lines.length).toBe(7);
    expect(lines[0]).toMatch(/Land value: 60 ↗/);
    expect(lines.some((l) => l.includes('Population: 100'))).toBe(true);
  });
});
