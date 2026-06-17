import { describe, it, expect } from 'vitest';
import { BuiltKind } from '../../src/engine/fabric';
import {
  TravelMode,
  modeSpec,
  modeRidesNetwork,
  modeSpeedMult,
  MODE_CHOICE_ORDER,
} from '../../src/citizens/modes';

describe('travel-mode table (extensible: each mode = its network + speed/cost)', () => {
  it('each mode rides FAST on its own transit network', () => {
    expect(modeRidesNetwork(TravelMode.Bike, BuiltKind.BikePath)).toBe(true);
    expect(modeRidesNetwork(TravelMode.Streetcar, BuiltKind.Streetcar)).toBe(true);
    expect(modeRidesNetwork(TravelMode.ElevatedRail, BuiltKind.ElevatedRail)).toBe(true);
    expect(modeRidesNetwork(TravelMode.Drive, BuiltKind.RoadStreet)).toBe(true);
  });

  it('a mode does not ride another mode’s network; Walk has none', () => {
    expect(modeRidesNetwork(TravelMode.Bike, BuiltKind.ElevatedRail)).toBe(false);
    expect(modeRidesNetwork(TravelMode.Streetcar, BuiltKind.BikePath)).toBe(false);
    expect(modeRidesNetwork(TravelMode.Walk, BuiltKind.BikePath)).toBe(false);
    expect(modeRidesNetwork(TravelMode.Walk, BuiltKind.Streetcar)).toBe(false);
  });

  it('riding the network is at least as fast as travelling off it', () => {
    for (const m of [TravelMode.Walk, TravelMode.Bike, TravelMode.Streetcar, TravelMode.ElevatedRail, TravelMode.Drive]) {
      const s = modeSpec(m);
      expect(s.networkSpeed).toBeGreaterThanOrEqual(s.baseSpeed);
    }
  });

  it('transit gets progressively faster: walk < bike < streetcar < elevated rail (on their networks)', () => {
    expect(modeSpec(TravelMode.Walk).networkSpeed).toBeLessThan(modeSpec(TravelMode.Bike).networkSpeed);
    expect(modeSpec(TravelMode.Bike).networkSpeed).toBeLessThan(modeSpec(TravelMode.Streetcar).networkSpeed);
    expect(modeSpec(TravelMode.Streetcar).networkSpeed).toBeLessThan(modeSpec(TravelMode.ElevatedRail).networkSpeed);
  });

  it('modeSpeedMult is the network speed on-network and the base speed off it', () => {
    expect(modeSpeedMult(TravelMode.Bike, BuiltKind.BikePath)).toBe(modeSpec(TravelMode.Bike).networkSpeed);
    expect(modeSpeedMult(TravelMode.Bike, BuiltKind.RoadStreet)).toBe(modeSpec(TravelMode.Bike).baseSpeed);
    expect(modeSpeedMult(TravelMode.Walk, BuiltKind.None)).toBe(modeSpec(TravelMode.Walk).baseSpeed);
  });

  it('only Drive is pavement-only (a car cannot cross wild ground); active modes are not', () => {
    expect(modeSpec(TravelMode.Drive).pavementOnly).toBe(true);
    expect(modeSpec(TravelMode.Walk).pavementOnly).toBe(false);
    expect(modeSpec(TravelMode.Bike).pavementOnly).toBe(false);
    expect(modeSpec(TravelMode.ElevatedRail).pavementOnly).toBe(false);
  });

  it('MODE_CHOICE_ORDER prefers premium modes first (rail before streetcar before bike before drive)', () => {
    expect(MODE_CHOICE_ORDER).toEqual([
      TravelMode.ElevatedRail,
      TravelMode.Streetcar,
      TravelMode.Bike,
      TravelMode.Drive,
    ]);
  });
});
