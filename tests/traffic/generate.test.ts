import { describe, it, expect } from 'vitest';
import { GameMap } from '../../src/engine/map';
import { BuiltKind, ParcelStore, placeParcel } from '../../src/engine/fabric';
import { createRng } from '../../src/engine/rng';
import { generateTraffic } from '../../src/traffic/generate';

// A commercial zone (always generates at density 3) wired by road to an industrial
// destination — so a trip is found and traffic is laid, deterministically.
function comToInd(): { map: GameMap; parcels: ParcelStore } {
  const map = new GameMap(20, 8);
  const parcels = new ParcelStore();
  placeParcel(map, parcels, { x: 2, y: 3, width: 1, height: 1, kind: BuiltKind.CommercialStrip, density: 3 });
  for (let x = 2; x <= 14; x++) map.built[map.idx(x, 4)] = BuiltKind.RoadStreet;
  placeParcel(map, parcels, { x: 14, y: 3, width: 1, height: 1, kind: BuiltKind.Industrial, density: 3 });
  return { map, parcels };
}

describe('generateTraffic', () => {
  it('lays traffic along a found origin→destination corridor', () => {
    const { map, parcels } = comToInd();
    const trips = generateTraffic(map, parcels, createRng('g').fork('traffic:0'));
    let total = 0;
    for (let i = 0; i < map.traffic.length; i++) total += map.traffic[i]!;
    expect(total).toBeGreaterThan(0); // density laid along the corridor
    expect(trips.length).toBeGreaterThan(0); // at least the C→I trip
    for (const t of trips) expect(t.found).toBe(true); // only found trips are published/laid
  });

  it('lays no traffic on a road network with no zones', () => {
    const map = new GameMap(20, 8);
    const parcels = new ParcelStore();
    for (let x = 0; x < 20; x++) map.built[map.idx(x, 4)] = BuiltKind.RoadStreet;
    generateTraffic(map, parcels, createRng('g').fork('traffic:0'));
    for (let i = 0; i < map.traffic.length; i++) expect(map.traffic[i]).toBe(0);
  });

  it('is deterministic: same map + same rng → identical traffic field and trips', () => {
    const run = () => {
      const { map, parcels } = comToInd();
      const trips = generateTraffic(map, parcels, createRng('g').fork('traffic:0'));
      return { snap: map.snapshot(), trips };
    };
    const a = run();
    const b = run();
    expect(a.snap).toBe(b.snap);
    expect(a.trips).toEqual(b.trips);
  });
});
