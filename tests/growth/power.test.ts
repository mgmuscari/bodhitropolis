// P2 — the SC1989-style power grid sim (flood-fill conduction + capacity/brownout).

import { describe, it, expect } from 'vitest';
import {
  computePowerGrid,
  plantOutput,
  powerDemand,
  isPowerConsumer,
  plantPollution,
} from '../../src/growth/power';
import { GameMap } from '../../src/engine/map';
import { ParcelStore, BuiltKind, placeParcel, placeTransport } from '../../src/engine/fabric';

describe('power tables', () => {
  it('rates plant output and zero for non-plants', () => {
    expect(plantOutput(BuiltKind.NuclearPlant)).toBeGreaterThan(plantOutput(BuiltKind.CoalPlant));
    expect(plantOutput(BuiltKind.HouseSingle)).toBe(0);
  });

  it('charges demand by zone class × density, zero for non-consumers', () => {
    expect(powerDemand(BuiltKind.HouseSingle, 2)).toBe(2); // R: 1×2
    expect(powerDemand(BuiltKind.Industrial, 2)).toBe(6); // I: 3×2
    expect(powerDemand(BuiltKind.Park, 1)).toBe(0);
    expect(powerDemand(BuiltKind.CoalPlant, 1)).toBe(0); // plants don't consume
  });

  it('identifies consumers', () => {
    expect(isPowerConsumer(BuiltKind.HouseSingle)).toBe(true);
    expect(isPowerConsumer(BuiltKind.Offices)).toBe(true);
    expect(isPowerConsumer(BuiltKind.Park)).toBe(false);
    expect(isPowerConsumer(BuiltKind.CoalPlant)).toBe(false);
  });

  it('emits air pollution from dirty combustion plants only', () => {
    expect(plantPollution(BuiltKind.CoalPlant)).toBeGreaterThan(plantPollution(BuiltKind.GasPlant));
    expect(plantPollution(BuiltKind.GasPlant)).toBeGreaterThan(0);
    for (const clean of [
      BuiltKind.HydroPlant,
      BuiltKind.NuclearPlant,
      BuiltKind.WindTurbine,
      BuiltKind.SolarPlant,
      BuiltKind.FusionPlant,
      BuiltKind.EnergyNode,
      BuiltKind.HouseSingle,
    ]) {
      expect(plantPollution(clean)).toBe(0);
    }
  });
});

function world() {
  const map = new GameMap(24, 8);
  const parcels = new ParcelStore();
  return { map, parcels };
}

describe('computePowerGrid: conduction', () => {
  it('powers a home connected to a plant through a road', () => {
    const { map, parcels } = world();
    placeParcel(map, parcels, { x: 2, y: 2, width: 1, height: 1, kind: BuiltKind.CoalPlant });
    for (let x = 3; x <= 8; x++) placeTransport(map, x, 2, BuiltKind.RoadStreet);
    placeParcel(map, parcels, { x: 9, y: 2, width: 1, height: 1, kind: BuiltKind.HouseSingle });
    const grid = computePowerGrid(map, parcels);
    expect(grid.poweredAnchors.has(map.idx(9, 2))).toBe(true);
    expect(grid.capacity).toBe(plantOutput(BuiltKind.CoalPlant));
    expect(grid.demand).toBe(powerDemand(BuiltKind.HouseSingle, 1));
  });

  it('leaves a home with no path to any plant unpowered', () => {
    const { map, parcels } = world();
    placeParcel(map, parcels, { x: 2, y: 2, width: 1, height: 1, kind: BuiltKind.CoalPlant });
    placeParcel(map, parcels, { x: 20, y: 6, width: 1, height: 1, kind: BuiltKind.HouseSingle }); // disconnected
    const grid = computePowerGrid(map, parcels);
    expect(grid.poweredAnchors.has(map.idx(20, 6))).toBe(false);
  });

  it('conducts through any built tile (adjacent zones, no road needed)', () => {
    const { map, parcels } = world();
    placeParcel(map, parcels, { x: 5, y: 3, width: 1, height: 1, kind: BuiltKind.GasPlant });
    placeParcel(map, parcels, { x: 6, y: 3, width: 1, height: 1, kind: BuiltKind.HouseSingle }); // touches the plant
    const grid = computePowerGrid(map, parcels);
    expect(grid.poweredAnchors.has(map.idx(6, 3))).toBe(true);
  });
});

describe('computePowerGrid: brownout', () => {
  it('powers only what capacity covers when demand exceeds it', () => {
    const { map, parcels } = world();
    // a tiny wind turbine (output 8) feeding a row of industry (demand 3 each)
    placeParcel(map, parcels, { x: 2, y: 2, width: 1, height: 1, kind: BuiltKind.WindTurbine });
    const homes: number[] = [];
    for (let x = 3; x <= 8; x++) {
      placeParcel(map, parcels, { x, y: 2, width: 1, height: 1, kind: BuiltKind.Industrial, density: 1 });
      homes.push(map.idx(x, 2));
    }
    const grid = computePowerGrid(map, parcels);
    const poweredCount = homes.filter((h) => grid.poweredAnchors.has(h)).length;
    // capacity 8, each industry demands 3 → only 2 powered (6 ≤ 8, 9 > 8); brownout.
    expect(poweredCount).toBe(2);
    expect(grid.demand).toBeGreaterThan(grid.capacity);
  });

  it('powers everything when capacity meets demand', () => {
    const { map, parcels } = world();
    placeParcel(map, parcels, { x: 2, y: 2, width: 1, height: 1, kind: BuiltKind.NuclearPlant });
    const homes: number[] = [];
    for (let x = 3; x <= 10; x++) {
      placeParcel(map, parcels, { x, y: 2, width: 1, height: 1, kind: BuiltKind.HouseSingle });
      homes.push(map.idx(x, 2));
    }
    const grid = computePowerGrid(map, parcels);
    expect(homes.every((h) => grid.poweredAnchors.has(h))).toBe(true);
  });

  it('is deterministic', () => {
    const build = () => {
      const { map, parcels } = world();
      placeParcel(map, parcels, { x: 2, y: 2, width: 1, height: 1, kind: BuiltKind.WindTurbine });
      for (let x = 3; x <= 8; x++) placeParcel(map, parcels, { x, y: 2, width: 1, height: 1, kind: BuiltKind.Industrial });
      return computePowerGrid(map, parcels);
    };
    const a = build();
    const b = build();
    expect([...a.poweredAnchors].sort()).toEqual([...b.poweredAnchors].sort());
  });
});
