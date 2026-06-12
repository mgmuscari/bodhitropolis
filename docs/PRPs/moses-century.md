# PRP: Moses Century

## Source PRD: docs/PRDs/moses-century.md
## Date: 2026-06-12
## Revised: 2026-06-12 per docs/reviews/plans/moses-century-review.md (yield points 1-6)

## 1. Context Summary

Replace the placeholder demo town with deterministic historical worldgen:
one `moses-century` stage running five era sub-steps (founding/streetcar →
motor age → highways/urban renewal → suburban flight → disinvestment) that
grow a coherent city on the terrain and wreck it, emitting a chronicle into
`world.log` and leaving the blighted start state. Requires one engine
addition — demolition primitives (the inverse of placement) with tombstoned
ParcelStore entries — and deletes `fabricdemo.ts` per its fence.

## 2. Codebase Analysis

- **Placement/integrity surface** — `src/engine/fabric.ts`: placement
  single-writers (`placeParcel`:230, `placeTransport`:269),
  `canPlaceParcel`:209, `transportMask`:301, `parcelTouchesRoad`:319,
  `checkParcelAgreement`:352 (bidirectional; returns violation strings),
  `hashWorld`:182 (canonical determinism hash; structural `HashableWorld`),
  `ParcelStore` with scalar accessors (`kindAt/densityAt/conditionAt`:121-129)
  and 10-byte `snapshotBytes` records:148. Demolition must join this file
  (single-writer rule, fabric.ts:195-199 comment).
- **Junction/upgrade mechanics already exist**: `placeTransport` merges
  same-category transport to `max(existing, kind)` (fabric.ts:273) — so
  *street→avenue upgrades and highway-over-road carving are just
  placeTransport calls* (avenue=2, highway=3 beat street=1). Rail is
  category 2; road never merges over rail (no crossings v1, fabric.ts:259) —
  era-3 corridors must demolish rail in their path, not cross it.
- **Stage contract** — `src/worldgen/pipeline.ts`: `WorldState` carries
  `map`, `parcels`, `seed`, `log`; stage rng forked by stage name; era
  sub-streams fork from the stage rng like `terrainStage` does
  (terrain.ts:343-348: `rng.fork('elevation')` etc.).
- **To delete** — `src/worldgen/fabricdemo.ts` (fenced placeholder,
  banner lines 3-13), `tests/worldgen/fabricdemo.test.ts`; `src/main.ts:22`
  swaps `fabricDemoStage()` → `mosesCenturyStage()`. Reusable ideas in it:
  spiral site search, frontage lane scans.
- **BFS precedent** — `computeMoisture` (terrain.ts:258-306) is the
  multi-source BFS pattern to generalize into a reusable `distanceField`.
- **Determinism rules** (mechanically enforced, tests/architecture.test.ts):
  DOM-free, no `Math.(exp|pow|log|sin|cos|tan|random)` in engine/worldgen;
  rational falloffs only (terrain.ts:301 precedent `1/(1+k*d)`); fixed
  row-major scans; rng draws in deterministic order.
- **Test conventions**: invariants asserted non-vacuously (counts ≥
  thresholds), per-seed sweeps, `hashWorld` double-run determinism,
  `checkParcelAgreement` as a reusable integrity sweep.

**Execution mechanics:** sequential gates + headless proposer
(`DIALECTIC_TEAM_AGENT=1`), per the established session pattern.

## 3. Implementation Plan

**Test Command:** `npx vitest run`

Era functions are exported individually so tests can run prefixes of
history and measure between eras. Uniform signatures (yield point 4):

```ts
export interface MosesState {
  founded: boolean;
  siteX: number; siteY: number;        // founding crossroads
  arterialRow: number; arterialCol: number;
  gridX0: number; gridY0: number; gridX1: number; gridY1: number; // grid bbox
  railPeak: number;                     // era-1 rail tile count (chronicle)
  preEra5Alive: number;                 // set by era 5 before abandonment
}
export function createMosesState(): MosesState  // founded=false zeros
export function era1Founding(world, rng, p, state): void   // fills state
export function era2MotorAge(world, rng, p, state): void
export function era3Highways(world, rng, p, state): void
export function era4Suburbs(world, rng, p, state): void
export function era5Disinvestment(world, rng, p, state): void
```

All take a shared `MosesParams` (with `DEFAULT_MOSES_PARAMS`). When
`state.founded` is false (all-water seed), eras 2-5 no-op.
`mosesCenturyStage(params?)` creates the state and runs all five with
forked streams (`era1`..`era5`); it is what `main.ts` uses.

### Task 1: Demolition primitives + ParcelStore tombstones
**Files:** `src/engine/fabric.ts`, `tests/engine/fabric.test.ts`
**Approach:**
- `ParcelStore` gains a parallel `alive: number[]` (1/0): `isAlive(i)`,
  `aliveCount()`, `aliveIndices(): number[]` (ascending — the deterministic
  iteration order for era passes). `add` sets alive=1. `snapshotBytes`
  record grows to 11 bytes (alive u8 appended) — update its doc comment.
- `demolishParcel(map, store, i): boolean` — false if out of range or
  already dead; else clears `built` and `parcel` to 0 across the entry's
  footprint and sets alive=0. (Footprint tiles are exactly the entry's
  rectangle — guaranteed by placement + agreement invariant.)
- `demolishTransportAt(map, x, y): boolean` — false unless the tile holds a
  transport kind; clears `built` to 0.
- `checkParcelAgreement` extension: a tile whose parcel id points at a
  *dead* entry is a violation (`parcel id N refers to demolished parcel`).
**Tests (RED):** demolish clears every footprint tile and only those tiles
(neighbors untouched); agreement clean after demolish; `hashWorld` changes
on demolish (alive flag + tiles) ; double-demolish returns false and
changes nothing; OOB index false; transport demolish clears road/rail and
refuses on building/empty tiles; agreement flags a hand-corrupted tile
pointing at a dead entry; `aliveIndices` skips dead entries.
**Validation:** `npx vitest run`; `npx tsc --noEmit`

### Task 2: Spatial field helpers (worldgen)
**Files:** `src/worldgen/fields.ts` (new), `tests/worldgen/fields.test.ts`
**Approach:** pure, integer/exactly-rounded only:
- `distanceField(map, isSource: (i) => boolean, isPassable?: (i) => boolean): Int32Array`
  — multi-source 4-connected BFS (generalizes terrain.ts:258 pattern; -1 =
  unreachable). `isPassable` (default: always true) constrains expansion so
  network distances are expressible — era 4 uses `isPassable = isRoadKind∘built`
  for road-network ring distance (yield point 2).
- `boxDensity(map, isCounted: (i) => boolean, radius): Int32Array` — counts
  in a (2r+1)² box per tile via summed-area table (integer SAT — exact).
- `landRun(map, axis, index): [start, end]` — the longest contiguous
  non-water run along row/col `index` (corridor support).
**Tests (RED):** distanceField on hand fixtures (single source, two
sources, unreachable pocket, and a passability fixture: a passable corridor
vs. an unreachable far side under `isPassable`); boxDensity vs. brute-force
on a small random fixture (seeded rng); landRun with water gaps, all-land,
all-water.
**Validation:** `npx vitest run`

### Task 3: Era 1 — founding & streetcar town
**Files:** `src/worldgen/moses.ts` (new), `tests/worldgen/moses.test.ts`
**Approach:** `era1Founding(world, rng, p)`:
1. *Site*: score candidate anchors (every 4th tile, row-major) =
   `waterFrontageWithin(3)` (from `distanceField` of water) + flatness
   (elevation range in a 9×9 window, rational penalty) — pick best;
   tie-break lower index; rng jitter among top K=4. Chronicle:
   `era1: founded at (x, y)`.
2. *Grid*: founding crossroads (street row + street col through the site,
   spanning that row/col's `landRun`, budgeted length p.foundingGridSpan);
   parallel streets every 4 tiles up to p.foundingBlocks in each direction
   (clipped to land), forming a small rectilinear grid.
3. *Rails*: in-grid streetcar track ran *in the street* — represented
   implicitly (chronicled, no rail tiles inside the grid; rail-on-road is
   impossible under the no-crossings rule, and a parallel lane would be
   severed by every cross street — yield point 1). `Rail` tiles are laid
   only as **radial extensions** beyond the grid into undeveloped land:
   p.railLines (default 2) lines, each continuing one arterial outward from
   the grid edge along its land run, length up to p.railExtension (default
   10). Chronicle: lines + total rail tile count (sets `state.railPeak`).
4. *Fabric*: walk grid-street frontage (row-major over road tiles, fixed
   lane order as in the demo's `placeOnFrontage`): houses (most), commercial
   strips near the crossroads, one Civic 3×3 at the core. Densities 1-2,
   condition 200-255 (rng). Budget p.era1Parcels (default 40, clipped by
   space).
**Tests (RED):** run terrain+era1 on 3 seeds: street network exists and is
single-component (BFS over road tiles ≥ p-derived minimum size); **rail
geometry** — ≥2 rail extensions, each a connected run of ≥6 tiles, each
starting 4-adjacent to an arterial end, zero rail tiles inside the grid
bbox (state.gridX0..X1/Y0..Y1); ≥1 Civic, ≥3 CommercialStrip, ≥15
HouseSingle alive; all parcels road-adjacent; agreement clean; chronicle
has `era1:` entries; determinism (double-run hashWorld). All-water map:
era1 no-ops with `era1: no viable site` log, `state.founded` false, no
throw.
**Validation:** `npx vitest run`

### Task 4: Era 2 — motor age
**Files:** `src/worldgen/moses.ts`, `tests/worldgen/moses.test.ts`
**Approach:** `era2MotorAge(world, rng, p)`:
1. *Arterial upgrade*: the two founding arterials (recorded in a small
   `MosesState` carried between eras inside the stage closure — era
   functions accept/return it) upgraded street→avenue via `placeTransport`
   merge along their runs.
2. *Grid extension*: extend the grid outward p.era2GrowthRings rings (new
   streets every 4 tiles), clipped to land.
3. *Industry*: Industrial 3×3 parcels on rail- or water-frontage tiles
   beyond the core (boxDensity low), budget p.era2Industry (default 4).
4. *Parking*: p.era2Parking (default 2) ParkingLot 2×2 near the crossroads.
   More houses/strips fill new frontage (budget p.era2Parcels).
**Tests (RED):** after era 2 (3 seeds): avenue tile count ≥ 20; Industrial
≥ 2, each within 2 tiles of rail or water; ParkingLot ≥ 1; road network
still single-component; agreement clean; determinism holds.
**Validation:** `npx vitest run`

### Task 5: Era 3 — urban renewal & highways (the Moses signature)
**Files:** `src/worldgen/moses.ts`, `tests/worldgen/moses.test.ts`
**Approach:** `era3Highways(world, rng, p)`:
1. *Corridor*: `boxDensity` over alive-parcel tiles (radius 3); for every
   row and column, score = density sum along its land run intersected with
   the parcel bounding box; corridor = best-scoring run extended to its full
   `landRun` (rng pick among top K=3). Demolish every parcel whose footprint
   intersects the corridor line (count them), `demolishTransportAt` any rail
   in it, then `placeTransport(RoadHighway)` along it (merges over
   street/avenue). A second perpendicular corridor iff the best
   perpendicular run's density-sum ≥ 50% of the first corridor's (yield
   point 5c). Chronicle: corridor axis, endpoints, `N parcels demolished`.
2. *Rail rip-out*: demolish ALL remaining rail tiles (the streetcar
   massacre). Chronicle: `rails removed: N (peak was M)`.
3. *Projects*: on cleared/empty land within 3 tiles of the corridor, place
   p.era3Projects (default 3) Projects 3×3 (condition 140-180 — built cheap).
4. *Civic megablock*: one more Civic 3×3 adjacent to the corridor downtown.
**Tests (RED):** (3 seeds) ≥1 highway corridor: highway tiles ≥ 20, single
connected run, AND ≥5 corridor tiles lie inside the pre-era-3 top-quartile
boxDensity mask (computed in-test before running era 3 — exported era
functions make this possible; yield point 5a); chronicle demolition count
≥ 5 AND the balance equation holds: `aliveAfter = aliveBefore −
chronicledDemolitions + placedProjects + placedCivic` (placement counts
observable as kind-count deltas; yield point 5b); rail tiles after ≤ 10%
of `state.railPeak`; Projects ≥ 2 within 3 tiles of a highway tile;
agreement clean; determinism.
**Validation:** `npx vitest run`

### Task 6: Era 4 — suburban flight
**Files:** `src/worldgen/moses.ts`, `tests/worldgen/moses.test.ts`
**Approach:** `era4Suburbs(world, rng, p)`:
1. *Spurs*: from road tiles at ring distance > p.suburbRadius from the
   founding site (road-network `distanceField` from the crossroads), grow
   straight street spurs outward (length 4-8, budget p.era4Spurs).
2. *Sprawl*: HouseSingle (density 1) along spur frontage, budget
   p.era4Houses (default 25); CommercialStrip every ~6th placement along
   avenue frontage; Offices 2×2 ×p.era4Offices (default 3) within 4 tiles
   of the crossroads.
3. *Early decline*: for alive residential parcels (HouseSingle/Apartments/
   Projects) within p.coreRadius of the crossroads, condition -= rng 20-60
   (clamped; deterministic order via `aliveIndices`).
**Tests (RED):** (3 seeds) ≥15 era-4 houses, every one road-adjacent and at
**road-network distance** > p.suburbRadius from the crossroads (the
passable-BFS `distanceField` with `isPassable = road` — yield point 2);
Offices ≥ 2 near center; mean condition of core residential < its pre-era-4
mean (export per-era so the test measures before/after); agreement clean;
determinism.
**Validation:** `npx vitest run`

### Task 7: Era 5 — disinvestment + stage assembly + demo deletion
**Files:** `src/worldgen/moses.ts`, `src/main.ts`,
`tests/worldgen/moses.test.ts`; **delete** `src/worldgen/fabricdemo.ts`,
`tests/worldgen/fabricdemo.test.ts`
**Approach:**
1. `era5Disinvestment(world, rng, p, state)`: record
   `state.preEra5Alive`; highway `distanceField`; **pass 1 (decay all)**:
   iterate a pre-collected `aliveIndices()` snapshot, condition -= decay
   `p.maxDecay * 1/(1 + p.decayK * d)` + rng noise (rational falloff —
   redlining-shaped), collecting indices ending below p.abandonThreshold
   (default 40); **pass 2 (abandon)**: demolish the collected list (no
   mutation while iterating aliveness — yield point 6), p.craterChance
   (default 0.5) of those become ParkingLot 2×2/1×1 craters (placed on the
   cleared footprint). Chronicle: decayed/abandoned/crater counts.
2. `mosesCenturyStage(params?)`: name `moses-century`; runs eras 1-5 with
   `rng.fork('era1')`…`fork('era5')`, threading MosesState; logs era
   banners. All-water maps: era 1 logs and every later era no-ops on the
   empty MosesState.
3. `main.ts`: pipeline becomes `[terrainStage(), mosesCenturyStage()]`;
   delete fabricdemo module + tests (its generic helpers, if any survive,
   move into moses.ts or fields.ts — no dead exports).
**Tests (RED):** full-stage (3 seeds): **blight gradient without
survivorship bias** (yield point 3) — partition the parcels alive at the
*start* of era 5 by highway distance (near ≤ 8, far ≥ 16, both cohorts ≥ 5
— non-vacuous); compare means of era-5 *outcomes*, counting abandoned
parcels at condition 0 (their absence is the blight): mean(near) <
mean(far); ≥10% of `state.preEra5Alive` demolished by era 5 (chronicle
numbers match store deltas); ParkingLot count increased; terrain integrity
— elevation/water/moisture/landCover buffers byte-identical before vs.
after the whole stage (the stage never edits terrain); chronicle has ≥1
entry per era; agreement clean after the full stage; hashWorld determinism
(double-run) and seed divergence; pipeline log order
`['terrain', 'moses-century']`.
**Validation:** `npx vitest run`; `npm run build`

### Task 8: Visual verification + docs
**Files:** `README.md`
**Approach:** README: replace the fabric-demo mention with the
moses-century description (era list, chronicle, determinism note). Verify
`npm run dev` on ≥2 seeds in a browser (Playwright if available): downtown
+ highway slicing it + projects + sprawl ring + weathered core visible;
state in the final report which verification method was used and what was
seen.
**Tests:** none (docs).
**Validation:** `npx vitest run` still green; manual/browser check.

## 4. Validation Gates

```bash
npx tsc --noEmit
npx vitest run
npm run build
npm run dev   # manual: city coherence + blight legibility, ?seed= variety
```

## 5. Rollback Plan

Branch revert. The only engine change is additive (demolition +
tombstones); `fabricdemo.ts` deletion is restorable from git history. No
persisted formats exist.

## 6. Uncertainty Log

- **Budgets/thresholds** (`era1Parcels: 40`, corridor min length 20, decay
  constants, suburb radius) are design targets; if a seed misses an
  invariant, tune *params* — never weaken the invariant thresholds without
  flagging it in the final report as a deviation needing review.
- **Corridor through water**: corridors span the chosen row/col's land run
  only — a river may bound a corridor (no bridges in v1); the invariant
  tests use ≥20 tiles, which a bounded run must still meet (tune corridor
  row choice to prefer longer runs when density ties).
- **128×128 crowding**: five eras of budgets may not all fit on
  water-heavy seeds; budgets are "up to N, clipped by space" and invariant
  thresholds are set well below budgets. If a test seed still starves,
  swap the test seed (documenting it) rather than weakening thresholds.
- **Rail lane adjacency** (rail beside road, not on it) may produce double-
  width transport stripes visually; acceptable for v1 streetcar reading.
