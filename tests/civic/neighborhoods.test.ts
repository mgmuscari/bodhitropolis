import { describe, it, expect } from 'vitest';
import { GameMap, Water } from '../../src/engine/map';
import { ParcelStore, BuiltKind, placeParcel, placeTransport } from '../../src/engine/fabric';
import { computeNeighborhoods } from '../../src/civic/neighborhoods';
import { runPipeline, type WorldState } from '../../src/worldgen/pipeline';
import { terrainStage } from '../../src/worldgen/terrain';
import { mosesCenturyStage } from '../../src/worldgen/moses';
import { ecoSeedStage } from '../../src/worldgen/ecoseed';

// Neighborhoods are the 4-connected components of M = parcel tiles + their
// non-fragmenting frontage halo. Busy roads (RoadStreet/Avenue/Highway —
// fragmenting) are barriers: never members, so they SPLIT clusters; a shared
// non-fragmenting halo tile (QuietStreet/Promenade/BikePath/rail) JOINS them.

function blank(w: number, h: number): { map: GameMap; parcels: ParcelStore } {
  return { map: new GameMap(w, h), parcels: new ParcelStore() };
}

/** Two 1x1 house parcels at (0,0) and (2,0) with one tile of `between` at (1,0). */
function twoClustersBridgedBy(between: BuiltKind | null): GameMap {
  const { map, parcels } = blank(3, 1);
  placeParcel(map, parcels, { x: 0, y: 0, width: 1, height: 1, kind: BuiltKind.HouseSingle });
  placeParcel(map, parcels, { x: 2, y: 0, width: 1, height: 1, kind: BuiltKind.HouseSingle });
  if (between !== null) placeTransport(map, 1, 0, between);
  return map;
}

describe('computeNeighborhoods: JOIN vs SPLIT (the Moses geometry made civic)', () => {
  it('a shared non-fragmenting halo tile (QuietStreet) merges two clusters into ONE', () => {
    const map = twoClustersBridgedBy(BuiltKind.QuietStreet);
    const nb = computeNeighborhoods(map);
    expect(nb.neighborhoods.length).toBe(1);
    const id = nb.tileToNeighborhood[map.idx(0, 0)]!;
    expect(id).not.toBe(0);
    // the shared halo tile is assigned to the one component — no nearest-parcel tiebreak
    expect(nb.tileToNeighborhood[map.idx(1, 0)]).toBe(id);
    expect(nb.tileToNeighborhood[map.idx(2, 0)]).toBe(id);
  });

  it('the SAME clusters with a RoadHighway between = TWO (fragmenting barrier)', () => {
    const map = twoClustersBridgedBy(BuiltKind.RoadHighway);
    const nb = computeNeighborhoods(map);
    expect(nb.neighborhoods.length).toBe(2);
    // the fragmenting barrier itself is unassigned
    expect(nb.tileToNeighborhood[map.idx(1, 0)]).toBe(0);
    const a = nb.tileToNeighborhood[map.idx(0, 0)]!;
    const b = nb.tileToNeighborhood[map.idx(2, 0)]!;
    expect(a).not.toBe(0);
    expect(b).not.toBe(0);
    expect(a).not.toBe(b);
  });

  it('the SAME clusters with a RoadStreet between = TWO (every busy road fragments)', () => {
    const map = twoClustersBridgedBy(BuiltKind.RoadStreet);
    const nb = computeNeighborhoods(map);
    expect(nb.neighborhoods.length).toBe(2);
    expect(nb.tileToNeighborhood[map.idx(1, 0)]).toBe(0);
    expect(nb.tileToNeighborhood[map.idx(0, 0)]).not.toBe(nb.tileToNeighborhood[map.idx(2, 0)]);
  });

  it('a RoadAvenue between also fragments to TWO (the whole busy-road family)', () => {
    const map = twoClustersBridgedBy(BuiltKind.RoadAvenue);
    const nb = computeNeighborhoods(map);
    expect(nb.neighborhoods.length).toBe(2);
    expect(nb.tileToNeighborhood[map.idx(1, 0)]).toBe(0);
  });

  it('a single EMPTY tile between adjacent parcels bridges them (empty land is non-fragmenting halo) = ONE', () => {
    const map = twoClustersBridgedBy(null); // (1,0) empty, 4-adjacent to BOTH parcels
    const nb = computeNeighborhoods(map);
    expect(nb.neighborhoods.length).toBe(1);
    expect(nb.tileToNeighborhood[map.idx(1, 0)]).not.toBe(0); // empty halo IS a member
  });

  it('a wide empty gap (no shared halo tile) splits = TWO', () => {
    // parcels at (0,0) and (4,0): (1,0)/(3,0) are halo, but (2,0) touches no
    // parcel ⇒ ∉ M, so the two halos never connect.
    const { map, parcels } = blank(5, 1);
    placeParcel(map, parcels, { x: 0, y: 0, width: 1, height: 1, kind: BuiltKind.HouseSingle });
    placeParcel(map, parcels, { x: 4, y: 0, width: 1, height: 1, kind: BuiltKind.HouseSingle });
    const nb = computeNeighborhoods(map);
    expect(nb.neighborhoods.length).toBe(2);
    expect(nb.tileToNeighborhood[map.idx(2, 0)]).toBe(0); // un-haloed empty gap ∉ M
  });
});

describe('computeNeighborhoods: membership set M', () => {
  it('a parcel tile is always a member; an unrelated empty tile is not', () => {
    const { map, parcels } = blank(5, 1);
    placeParcel(map, parcels, { x: 0, y: 0, width: 1, height: 1, kind: BuiltKind.HouseSingle });
    const nb = computeNeighborhoods(map);
    expect(nb.tileToNeighborhood[map.idx(0, 0)]).not.toBe(0); // parcel ∈ M
    expect(nb.tileToNeighborhood[map.idx(2, 0)]).toBe(0); // far empty tile ∉ M
  });

  it('a non-fragmenting tile 4-adjacent to a parcel joins as halo; the next tile out does not', () => {
    const { map, parcels } = blank(5, 1);
    placeParcel(map, parcels, { x: 0, y: 0, width: 1, height: 1, kind: BuiltKind.HouseSingle });
    placeTransport(map, 1, 0, BuiltKind.QuietStreet); // adjacent halo
    placeTransport(map, 2, 0, BuiltKind.QuietStreet); // NOT parcel-adjacent
    const nb = computeNeighborhoods(map);
    const id = nb.tileToNeighborhood[map.idx(0, 0)]!;
    expect(nb.tileToNeighborhood[map.idx(1, 0)]).toBe(id); // halo joins
    expect(nb.tileToNeighborhood[map.idx(2, 0)]).toBe(0); // not adjacent to a parcel → ∉ M
  });

  it('counts parcelTiles and tileCount per neighborhood', () => {
    const { map, parcels } = blank(4, 1);
    placeParcel(map, parcels, { x: 0, y: 0, width: 2, height: 1, kind: BuiltKind.CommunityGarden });
    placeTransport(map, 2, 0, BuiltKind.QuietStreet); // halo of the 2x1 parcel
    const nb = computeNeighborhoods(map);
    expect(nb.neighborhoods.length).toBe(1);
    expect(nb.neighborhoods[0]!.parcelTiles).toBe(2);
    expect(nb.neighborhoods[0]!.tileCount).toBe(3); // 2 parcel + 1 halo
  });
});

describe('computeNeighborhoods: stable ids + determinism', () => {
  it('numbers ids by ascending anchor (lowest member-tile index)', () => {
    const { map, parcels } = blank(5, 1);
    placeParcel(map, parcels, { x: 0, y: 0, width: 1, height: 1, kind: BuiltKind.HouseSingle });
    placeParcel(map, parcels, { x: 4, y: 0, width: 1, height: 1, kind: BuiltKind.HouseSingle });
    placeTransport(map, 2, 0, BuiltKind.RoadHighway); // split
    const nb = computeNeighborhoods(map);
    expect(nb.neighborhoods.length).toBe(2);
    expect(nb.neighborhoods[0]!.id).toBe(1);
    expect(nb.neighborhoods[1]!.id).toBe(2);
    expect(nb.neighborhoods[0]!.anchor).toBeLessThan(nb.neighborhoods[1]!.anchor);
    expect(nb.neighborhoods[0]!.anchor).toBe(map.idx(0, 0));
  });

  it('is deterministic: two runs of the same map are byte-identical', () => {
    const { map, parcels } = blank(8, 3);
    placeParcel(map, parcels, { x: 0, y: 0, width: 1, height: 1, kind: BuiltKind.HouseSingle });
    placeParcel(map, parcels, { x: 7, y: 2, width: 1, height: 1, kind: BuiltKind.Bazaar });
    placeParcel(map, parcels, { x: 3, y: 1, width: 2, height: 2, kind: BuiltKind.MakerSpace });
    placeTransport(map, 5, 0, BuiltKind.RoadHighway);
    const a = computeNeighborhoods(map);
    const b = computeNeighborhoods(map);
    expect(a.tileToNeighborhood).toEqual(b.tileToNeighborhood);
    expect(a.neighborhoods).toEqual(b.neighborhoods);
  });
});

describe('computeNeighborhoods: degenerate worlds', () => {
  it('empty map → zero neighborhoods, no throw, all ids zero', () => {
    const map = new GameMap(8, 8);
    const nb = computeNeighborhoods(map);
    expect(nb.neighborhoods.length).toBe(0);
    expect([...nb.tileToNeighborhood].every((v) => v === 0)).toBe(true);
  });

  it('all-water map → zero neighborhoods, no throw', () => {
    const map = new GameMap(8, 8);
    map.water.fill(Water.Ocean);
    const nb = computeNeighborhoods(map);
    expect(nb.neighborhoods.length).toBe(0);
  });
});

describe('computeNeighborhoods: real founded cities (non-vacuous)', () => {
  const SEEDS = ['moses-1', 'moses-2', 'moses-3'];
  function runFull(seed: string): WorldState {
    return runPipeline({ seed, width: 128, height: 128 }, [
      terrainStage(),
      mosesCenturyStage(),
      ecoSeedStage(),
    ]);
  }

  it('produces ≥3 neighborhoods on 3 seeds (counts logged, not pinned)', () => {
    for (const seed of SEEDS) {
      const world = runFull(seed);
      const nb = computeNeighborhoods(world.map);
      // eslint-disable-next-line no-console
      console.log(`computeNeighborhoods seed=${seed}: ${nb.neighborhoods.length} neighborhoods`);
      expect(nb.neighborhoods.length).toBeGreaterThanOrEqual(3);
    }
  });

  it('is deterministic on a real city (double-run byte-equal partition)', () => {
    const a = computeNeighborhoods(runFull('moses-1').map);
    const b = computeNeighborhoods(runFull('moses-1').map);
    expect(a.tileToNeighborhood).toEqual(b.tileToNeighborhood);
    expect(a.neighborhoods).toEqual(b.neighborhoods);
  });
});
