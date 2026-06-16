import { describe, it, expect } from 'vitest';
import { GameMap } from '../../src/engine/map';
import { layTraffic, decayTraffic, TRAFFIC_MAX, TRAFFIC_LAY } from '../../src/traffic/density';

describe('traffic density (lay along path + decay)', () => {
  it('a fresh map has zero traffic everywhere', () => {
    const m = new GameMap(8, 8);
    for (let i = 0; i < m.traffic.length; i++) expect(m.traffic[i]).toBe(0);
  });

  it('layTraffic adds along a path and saturates at TRAFFIC_MAX', () => {
    const m = new GameMap(8, 8);
    const path = [m.idx(1, 1), m.idx(2, 1), m.idx(3, 1)];
    layTraffic(m, path);
    for (const i of path) expect(m.traffic[i]).toBe(TRAFFIC_LAY);
    for (let k = 0; k < 10; k++) layTraffic(m, path);
    for (const i of path) expect(m.traffic[i]).toBe(TRAFFIC_MAX); // capped
  });

  it('decayTraffic steps density down toward zero (stepped, integer)', () => {
    const m = new GameMap(8, 8);
    m.traffic[0] = 240; // > 200
    m.traffic[1] = 100; // 24 < z <= 200
    m.traffic[2] = 20; //  <= 24
    m.traffic[3] = 0;
    decayTraffic(m);
    expect(m.traffic[0]).toBe(240 - 34);
    expect(m.traffic[1]).toBe(100 - 24);
    expect(m.traffic[2]).toBe(0);
    expect(m.traffic[3]).toBe(0);
  });

  it('traffic participates in the determinism snapshot', () => {
    const m = new GameMap(8, 8);
    const before = m.snapshot();
    layTraffic(m, [m.idx(4, 4)]);
    expect(m.snapshot()).not.toBe(before); // snapshot folds the traffic layer → hashWorld covers it
  });
});
