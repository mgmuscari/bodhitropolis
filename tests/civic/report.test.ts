import { describe, it, expect } from 'vitest';
import { GameMap } from '../../src/engine/map';
import { ParcelStore, BuiltKind, placeParcel, placeTransport } from '../../src/engine/fabric';
import { computeNeighborhoods } from '../../src/civic/neighborhoods';
import { createCivicState } from '../../src/civic/state';
import { civicReport } from '../../src/civic/report';

function blank(w: number, h: number): { map: GameMap; parcels: ParcelStore } {
  return { map: new GameMap(w, h), parcels: new ParcelStore() };
}

describe('civicReport', () => {
  it('emits one row per neighborhood with id, anchor, and the three scalars', () => {
    const { map, parcels } = blank(5, 1);
    placeParcel(map, parcels, { x: 0, y: 0, width: 1, height: 1, kind: BuiltKind.HouseSingle });
    placeParcel(map, parcels, { x: 4, y: 0, width: 1, height: 1, kind: BuiltKind.HouseSingle });
    placeTransport(map, 2, 0, BuiltKind.RoadHighway); // split into two neighborhoods
    const partition = computeNeighborhoods(map);
    const civic = createCivicState(partition);
    const r = civicReport(civic, partition);
    expect(r.count).toBe(2);
    expect(r.neighborhoods.map((n) => n.id)).toEqual([1, 2]);
    expect(r.neighborhoods[0]!.anchor).toBe(partition.neighborhoods[0]!.anchor);
    for (const row of r.neighborhoods) {
      expect(row.belonging).toBe(80);
      expect(row.voice).toBe(40);
      expect(row.trust).toBe(90);
    }
  });

  it('computes citywide means as floats (divide without flooring)', () => {
    const { map, parcels } = blank(5, 1);
    placeParcel(map, parcels, { x: 0, y: 0, width: 1, height: 1, kind: BuiltKind.HouseSingle });
    placeParcel(map, parcels, { x: 4, y: 0, width: 1, height: 1, kind: BuiltKind.HouseSingle });
    placeTransport(map, 2, 0, BuiltKind.RoadHighway);
    const partition = computeNeighborhoods(map);
    const civic = createCivicState(partition);
    civic.setValues(1, { belonging: 100, voice: 50, trust: 90 });
    civic.setValues(2, { belonging: 101, voice: 51, trust: 91 });
    const r = civicReport(civic, partition);
    expect(r.belongingMean).toBe((100 + 101) / 2); // 100.5 — NOT floored
    expect(r.voiceMean).toBe((50 + 51) / 2); // 50.5
    expect(r.trustMean).toBe((90 + 91) / 2); // 90.5
  });

  it('is degenerate-safe: no neighborhoods → empty rows, zero means, never NaN', () => {
    const map = new GameMap(8, 8); // no parcels
    const partition = computeNeighborhoods(map);
    const civic = createCivicState(partition);
    const r = civicReport(civic, partition);
    expect(r.count).toBe(0);
    expect(r.neighborhoods).toEqual([]);
    for (const m of [r.belongingMean, r.voiceMean, r.trustMean]) {
      expect(m).toBe(0);
      expect(Number.isNaN(m)).toBe(false);
    }
  });

  it('is deterministic (two runs of a fixture produce an equal report)', () => {
    const { map, parcels } = blank(6, 1);
    placeParcel(map, parcels, { x: 0, y: 0, width: 1, height: 1, kind: BuiltKind.HouseSingle });
    placeParcel(map, parcels, { x: 5, y: 0, width: 1, height: 1, kind: BuiltKind.Bazaar });
    placeTransport(map, 2, 0, BuiltKind.RoadHighway);
    const partition = computeNeighborhoods(map);
    expect(civicReport(createCivicState(partition), partition)).toEqual(
      civicReport(createCivicState(partition), partition),
    );
  });
});
