// Deterministic neighborhood partition: parcel clusters split by fragmenting
// roads — the Moses geometry made civic. A neighborhood is a 4-connected
// component of the membership set M = parcel tiles + their non-fragmenting
// frontage halo. Busy roads (RoadStreet/RoadAvenue/RoadHighway — fragmenting)
// are barriers: never members, so they SPLIT clusters into separate components.
// A non-fragmenting connector (QuietStreet/Promenade/BikePath/rail) shared in
// the halo of two clusters IS in M and 4-connects them into ONE component — the
// road-diet payoff reused. Assignment is by connected component, never by
// nearest-parcel, so a shared halo tile needs no "which neighborhood owns it"
// tiebreak.
//
// Pure module: no DOM, no rng, no transcendental Math (the architecture guard
// scans src/civic). The one outward edge is civic → ecology: it imports
// influenceOf to read the per-kind `fragmenting` flag. Ecology never imports
// civic, so there is no cycle (the guard asserts the reverse import is absent).

import type { GameMap } from '../engine/map';
import { influenceOf } from '../ecology/influence';

/** One neighborhood: a 4-connected component of the membership set M. */
export interface Neighborhood {
  /** 1-based id; equals this entry's (index + 1). Ids order by ascending anchor. */
  id: number;
  /** Lowest member-tile index in the component — the stable re-anchoring key. */
  anchor: number;
  /** Total tiles in M for this component (parcel tiles + halo tiles). */
  tileCount: number;
  /** Count of parcel tiles (map.parcel !== 0) in this component. */
  parcelTiles: number;
}

/** The partition: a per-tile id lookup plus the component records. */
export interface NeighborhoodMap {
  /** Per-tile neighborhood id; 0 = none (a barrier, or outside any cluster). */
  tileToNeighborhood: Uint16Array;
  /** Components ordered by ascending anchor; `neighborhoods[k].id === k + 1`. */
  neighborhoods: Neighborhood[];
}

// 4-neighbour offsets (orthogonal only — the halo and connectivity are both
// 4-connected, so every halo tile is guaranteed connected to its seeding parcel).
const DIRS: ReadonlyArray<readonly [number, number]> = [
  [0, -1], // N
  [1, 0], // E
  [0, 1], // S
  [-1, 0], // W
];

/**
 * Partition `map` into neighborhoods. Membership M: a tile is in M iff it is
 * NOT fragmenting AND (it is a parcel tile OR it is 4-adjacent to ≥1 parcel
 * tile). Neighborhoods are the 4-connected components of M, ids numbered by
 * ascending anchor (lowest member-tile index) — so recomputation on an unchanged
 * map yields a byte-identical partition, and a fabric change re-anchors
 * deterministically.
 */
export function computeNeighborhoods(map: GameMap): NeighborhoodMap {
  const { width, height } = map;
  const n = width * height;
  const tileToNeighborhood = new Uint16Array(n);

  const isParcel = (i: number): boolean => map.parcel[i] !== 0;
  const isFragmenting = (i: number): boolean => influenceOf(map.built[i]!).fragmenting;

  // --- Membership set M (one pass). A halo tile must be non-fragmenting and have
  // a parcel 4-neighbour; a fragmenting tile is a barrier and is never a member
  // (parcel tiles are buildings, never fragmenting, so the two clauses never
  // conflict — but the barrier check is explicit so the contract is local).
  const inM = new Uint8Array(n);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = map.idx(x, y);
      if (isFragmenting(i)) continue; // barrier → ∉ M
      if (isParcel(i)) {
        inM[i] = 1;
        continue;
      }
      for (const [dx, dy] of DIRS) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
        if (isParcel(map.idx(nx, ny))) {
          inM[i] = 1;
          break;
        }
      }
    }
  }

  // --- 4-connected components, scanned ascending so the first tile of each
  // component (its lowest member index) seeds it: ids therefore order by
  // ascending anchor. A reused BFS queue keeps it allocation-light; each tile is
  // enqueued at most once (guarded by the already-assigned check before enqueue).
  const neighborhoods: Neighborhood[] = [];
  const queue = new Int32Array(n);
  for (let seed = 0; seed < n; seed++) {
    if (inM[seed] === 0 || tileToNeighborhood[seed] !== 0) continue;
    const id = neighborhoods.length + 1;
    let tileCount = 0;
    let parcelTiles = 0;
    let head = 0;
    let tail = 0;
    queue[tail++] = seed;
    tileToNeighborhood[seed] = id;
    while (head < tail) {
      const cur = queue[head++]!;
      tileCount++;
      if (isParcel(cur)) parcelTiles++;
      const cx = cur % width;
      const cy = (cur - cx) / width;
      for (const [dx, dy] of DIRS) {
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
        const ni = ny * width + nx;
        if (inM[ni] === 1 && tileToNeighborhood[ni] === 0) {
          tileToNeighborhood[ni] = id;
          queue[tail++] = ni;
        }
      }
    }
    neighborhoods.push({ id, anchor: seed, tileCount, parcelTiles });
  }

  return { tileToNeighborhood, neighborhoods };
}
