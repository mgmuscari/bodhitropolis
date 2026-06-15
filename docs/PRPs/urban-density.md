# PRP: Urban Density

## Source PRD: docs/PRDs/urban-density.md
## Date: 2026-06-15

## 1. Context Summary

Make the Moses-century city read as a **dense, oppressive mid-century city**
(playtest feedback: sparse zoning, want filled grids, double-width stroads,
triple-width freeways, parking-lot pavement masses, power lines along streets).
Worldgen + renderer only — **no new mechanics, no new `BuiltKind`s, no engine/
ecology/civic/tech/tools logic changes.** Five threads: (1) `fillFrontage`
packs both sides of every street with era-appropriate parcels at raised
budgets; (2) era 2 widens arterials to 2-row avenues and era 3 carves 3-row
highways out of *existing* road kinds (parallel rows that the autotile/merge
already fuse); (3) parking fields (2×2 `ParkingLot` clusters); (4) a pure
`powerPoleAt` predicate + a renderer decoration pass; (5) a wide-body render
variant so multi-row corridors draw as a slab. The determinism contract is
sacred: seeded rng with `fork(label)`, no transcendental Math, `hashWorld`
byte-stable per seed (denser, but reproducible).

## 2. Codebase Analysis

**Worldgen — `src/worldgen/moses.ts`** (all line numbers as of this branch):
- `DEFAULT_MOSES_PARAMS` (`:81`) holds the budgets to raise: `era1Parcels: 40`
  (`:93`), `era2Parcels: 24` (`:101`), `era4Houses: 25` (`:110`), plus
  `era2Parking: 2` (`:100`).
- `placeAdjacent(map, store, rx, ry, w, h, kind, rng, accept?, attrs?)`
  (`:230`) places ONE parcel in the first of N→S→W→E lanes that fits
  (`canPlaceParcel` + optional `accept`), drawing density/condition from
  `HEALTHY_ATTRS`/`PROJECT_ATTRS` (`:226-228`). This is the per-road-tile
  first-fit primitive; `fillFrontage` will generalize it to **all** lanes.
- `collectRoadTiles(map, x0, y0, x1, y1)` (`:270`) → road tile indices,
  row-major. The eras compute a core-distance and sort `byCore`
  (e.g. `:447`, `:592`, `:771`).
- `roadAt`/`growArm` (`:184`, `:199`) lay transport into a `BBox`.
  `upgradeArterialRow`/`Col` (`:488`, `:496`) rewrite a line street→avenue in
  place. Era 2 grows avenue extensions at `:527-530`.
- `carveCorridor(map, store, c)` (`:650`) demolishes parcels + rail on a
  corridor line then lays `RoadHighway`; returns `[demolished, rail]`. Era 3
  logs `"... ${demolished} parcels demolished, ${projects} projects,
  ${civic} civic"` (`:793`) — the **exact** string the balance-equation test
  parses (`moses.test.ts:385-398`).
- rng forking: the stage forks `era1..era5` (`:1041-1045`); within an era,
  sub-streams fork by label — `'site'`, `'fabric'`, `'corridor'`, `'spurs'`,
  `'build'`, `'decline'`, `'decay'`, `'crater'`. **New streams must use NEW
  labels** (`'fill'`, `'widen'`, `'parkfield'`) so existing draws are not
  reordered.

**Engine — `src/engine/fabric.ts`** (single-writer; do not write tiles
elsewhere):
- `BuiltKind`: `RoadStreet=1`, `RoadAvenue=2`, `RoadHighway=3`, `Rail=4`,
  `HouseSingle=16`, `Apartments=17`, `Projects=18`, `CommercialStrip=19`,
  `Offices=20`, `Industrial=21`, `ParkingLot=22`, `Civic=23` (`:24-60`).
  **`Apartments=17` is in the taxonomy + `RESIDENTIAL` set (`moses.ts:812`)
  but never yet placed** — this PRP introduces it for near-core density.
- `placeParcel`, `demolishParcel`, `placeTransport`, `demolishTransportAt`,
  `canPlaceParcel` (`:315,410,363,431,294`). `placeTransport` merges via
  `max(existing, kind)` on a same-category junction (`:367`) — parallel road
  rows fuse. `isRoadKind(k) = 1≤k≤3` (`:64`).
- `transportMask(map, x, y)` (`:478`) is the 4-neighbour autotile mask;
  `transportCategory` (`:459`); `parcelTouchesRoad` (`:498`).
- `hashWorld(world)` (`:246`) folds `map.snapshot()` + `parcels.snapshotBytes()`.
  **THE determinism hash.**

**Renderer — `src/ui/renderKey.ts` + `src/ui/renderer.ts`:**
- `builtRenderKey(kind, mask, pos, condTier)` (`renderKey.ts:73`):
  road kinds (`ROAD_RENDER_KINDS = [1,2,3,7]`) → `road-{kind}-{mask}`.
  `renderKeyspace()` (`:92`) enumerates every key; `buildAtlas`
  (`renderer.ts:333`) paints each via `paintForKey` (`:311`).
- `makeRoadTile(kind, mask)` (`renderer.ts:224`) dithers asphalt + lane
  markings toward connected edges (`ROAD_STYLES`, `:76`). `paintForKey`
  switches on `key.split('-')[0]`.
- `render()` (`:429`) iterates the visible range; for transport tiles computes
  `mask = transportMask(...)` then `builtRenderKey(...)` (`:454-458`). The
  decoration pass will hook in right after the built `drawImage` (`:459`).
- **Guard tests** (`tests/ui/renderKey.test.ts`): totality (`builtRenderKey`
  4-arg ⊆ keyspace), no-dups, order-stable, and **keyspace⊆paintable**
  (parses key by `split('-')[0]` prefix + `[1]` kind — so a `road-2-15-w` key
  passes unchanged: prefix `'road'`, kind `2`). `b-16-c-0` and `road-2-15-w`
  both split to length 4, so the renderer's `-w` detection MUST be scoped to
  the `'road'` switch case (`parts[3] === 'w'`), never length alone.

**Ecology — `src/ecology/influence.ts` + `src/worldgen/ecoseed.ts`
(UNCHANGED):** `RoadHighway {soil:-5,fragmenting:true}`,
`RoadAvenue {soil:-3,fragmenting:true}` (`influence.ts:65-66`);
`seedEcology` wounds soil by `CORRIDOR_WOUND/(1+highwayDist)`
(`ecoseed.ts:85`). More highway tiles ⇒ a wider `highwayDist=0` band ⇒ more
total wound. The monotonicity test (Task 8) characterizes this directly over
`seedEcology`.

**Architecture guard — `tests/architecture.test.ts`:** `src/worldgen` is
fail-closed (DOM-free, transcendental-Math-free; `Math.abs/floor/min/max/imul/
sqrt` are allowed, `exp/pow/log/sin/cos/tan/random` are not). New pure-ui
modules MUST be appended to `PURE_UI_ALLOWLIST` (`:86`).

**Test map construction (for the new pure tests):** build a bare map with
`new GameMap(width, height)` and set tiles directly
(`map.built[map.idx(x, y)] = BuiltKind.RoadAvenue`), or via `placeTransport`.
Confirm the constructor signature against `tests/engine/map.test.ts`. Read
built tiles via `map.getBuilt(x, y)` / `map.built[map.idx(x, y)]` and bounds
via `map.inBounds(x, y)` (as `transportMask` does, `fabric.ts:478-489`).

## 3. Implementation Plan

**Test Command:** `npx vitest run` (full suite). Per-task TDD also runs the
focused file, e.g. `npx vitest run tests/worldgen/moses.test.ts`. Gates also
include `npx tsc --noEmit` and `npm run build`.

> Order rationale: the two **pure render helpers** land first (isolated,
> fully unit-tested), then the **renderer integration** (thin shell, made
> safe by those tests + the keyspace guard), then the **worldgen** density
> era-by-era (each validated by that era's existing + new tests), then the
> **ecology characterization** test. Every task is one atomic commit (test +
> impl together), RED → GREEN → REFACTOR.

### Task 1: Render-key wide variant (pure)
**Files:** `src/ui/renderKey.ts`, `tests/ui/renderKey.test.ts`
**Approach:**
- `builtRenderKey(kind, mask, pos, condTier, wide = false)` — for road kinds,
  return `` `road-${kind}-${mask}${wide ? '-w' : ''}` ``. `wide` is ignored
  for transport-prefix and building kinds (they never widen). Default `false`
  keeps all existing 4-arg callers/keys identical.
- `renderKeyspace()` — after the existing `road-${k}-${m}` loop, also push
  `road-${k}-${m}-w` for every `k` in `ROAD_RENDER_KINDS` × mask. Keep order
  stable and duplicate-free (append the wide block right after the plain road
  block).
**Tests (RED first):**
- `builtRenderKey(RoadAvenue, 15, 'c', 0, true) === 'road-2-15-w'`;
  `builtRenderKey(RoadHighway, 7, 'c', 0, true) === 'road-3-7-w'`.
- `wide` ignored for buildings: `builtRenderKey(HouseSingle, 0, 'e', 1, true)
  === 'b-16-e-1'`; and for rail: `builtRenderKey(Rail, 2, 'c', 0, true) ===
  'rail-2'`.
- `renderKeyspace()` contains `road-2-15-w` and `road-3-0-w` for all road
  kinds × 16 masks; still has no duplicates and is order-stable.
- The existing totality + keyspace⊆paintable + no-dup tests remain green
  (the 4-arg calls default `wide=false`).
**Validation:** `npx vitest run tests/ui/renderKey.test.ts` then full suite +
`tsc`.

### Task 2: Pure decoration predicates + allowlist
**Files:** `src/ui/decoration.ts` (new), `tests/ui/decoration.test.ts` (new),
`tests/architecture.test.ts` (append to `PURE_UI_ALLOWLIST`)
**Approach:** a DOM-free, transcendental-free module importing only
`GameMap` (type) + `BuiltKind`/`isRoadKind` from engine.
- `wideRoadAt(map, x, y): boolean` — true iff the tile at (x,y) is a road
  (`isRoadKind`) **and** is a member of at least one 2×2 block of all-road
  tiles. Check the four 2×2 squares that include (x,y):
  `{(x,y),(x±1,y),(x,y±1),(x±1,y±1)}` for the four sign combos; a square
  counts only if all four cells are in-bounds and `isRoadKind`. This is
  orientation-free: it is true for interior/edge tiles of a 2-row or 3-row
  corridor, and **false** for a 1-wide road and for a simple `+` of two 1-wide
  roads (the diagonal cell is not road).
- `powerPoleAt(map, x, y): boolean` — true iff the tile is `RoadStreet` or
  `RoadAvenue` (NOT highway, NOT rail/transit, NOT building/empty/water) and a
  pole falls here at `POLE_SPACING = 4`: if the tile has an E or W road
  neighbour (runs horizontally) → `x % POLE_SPACING === 0`; else if it has an
  N or S road neighbour (vertical) → `y % POLE_SPACING === 0`; isolated road
  tiles → no pole. Deterministic in `(map, x, y)` only.
- Append `'src/ui/decoration.ts'` to `PURE_UI_ALLOWLIST`.
**Tests (RED first), using `new GameMap(w,h)` fixtures:**
- `wideRoadAt`: a 2-row avenue band (rows y=5,6, x=2..10) → every interior
  tile true; a single 1-wide row → all false; a `+` intersection of two
  1-wide avenues → center false; a 3-row band → middle and edge rows true;
  a non-road tile → false.
- `powerPoleAt`: a horizontal avenue at y=5, x=0..12 → true at x=0,4,8,12 and
  false elsewhere on the row; false on a `RoadHighway` tile; false on empty
  land, water, rail, and a building tile; deterministic (two calls equal).
- The architecture allowlist test now includes `decoration.ts` and passes
  (pure).
**Validation:** `npx vitest run tests/ui/decoration.test.ts
tests/architecture.test.ts` then full suite + `tsc`.

### Task 3: Renderer wide-body slab + power-line decoration (thin shell)
**Files:** `src/ui/renderer.ts`
**Approach (no new unit test — thin DOM shell; the pure inputs are tested in
T1/T2, and `npm run build` + the keyspace⊆paintable guard + the live pass are
the gates):**
- `makeRoadTile(kind, mask, wide = false)` — when `wide`, paint a fuller
  asphalt slab: dither the base edge-to-edge and **suppress the per-edge lane
  markings / isolated stub** (or draw only a faint center seam) so adjacent
  wide tiles read as one continuous mass rather than parallel striped roads.
  Non-wide path unchanged.
- `paintForKey`: `case 'road': return makeRoadTile(Number(parts[1]),
  Number(parts[2]), parts[3] === 'w');` (scoped to the road case — `b-…` keys
  also split to length 4, so never key off length).
- `render()`: for road-category transport tiles, compute
  `const wide = wideRoadAt(map, tx, ty)` and pass it as the 5th arg to
  `builtRenderKey`. (Only roads can be wide; for non-road transport pass
  `false`/omit.)
- **Decoration pass:** right after the built `drawImage` (`:459`), if
  `powerPoleAt(map, tx, ty)` draw a small dark mast at the tile and a thin
  wire segment toward the next pole along the road (toward +x/+y road
  neighbours). Pure-visual `ctx` drawing; no atlas key.
**Tests:** none new (shell). Validation leans on the guard + build + live pass.
**Validation:** `npx tsc --noEmit && npm run build && npx vitest run` (the
keyspace⊆paintable guard must stay green). Team lead live-pass verifies slabs +
poles render.

### Task 4: `fillFrontage` helper + denser era 1
**Files:** `src/worldgen/moses.ts`, `tests/worldgen/moses.test.ts`
**Approach:**
- New `fillFrontage(map, parcels, roadTiles, rng, budget, pickKind)`: iterate
  `roadTiles` (caller passes a deterministic order, e.g. `byCore`); for each
  road tile try **all four** lanes (N,S,W,E via the `placeAdjacent` anchor
  pattern) — not first-fit — placing a 1×1 (or 2×1 for `CommercialStrip`)
  parcel of `pickKind(coreDist)` where the lane is free (`canPlaceParcel`),
  drawing `HEALTHY_ATTRS`, until `budget` is reached. Every placed parcel is
  road-adjacent by construction (preserves the `parcelTouchesRoad` invariant)
  and goes through `placeParcel` (preserves `checkParcelAgreement`). Returns
  the count placed.
- `pickKind(coreDist)`: `≤ commercialRadius` → occasional `CommercialStrip`
  (e.g. every 5th) else `Apartments`; `≤ coreRadius` → `Apartments`; else
  `HouseSingle`. (Density rises toward the core.)
- Raise `era1Parcels: 40 → 150`. In `era1Founding`, keep the civic + the
  `era1Commercial` placements on the `'fabric'` fork; **replace the first-fit
  housing loop** (`:474-480`) with a `fillFrontage(... rng.fork('fill') ...,
  era1Parcels, pickKind)` over the era-1 `roadTiles` ordered `byCore`.
**Tests (RED first):**
- Determinism: `hashWorld(runEra1('moses-1').world)` equals itself; differs
  across seeds (existing tests cover this — keep green).
- **All-lane property:** after era 1, at least one road tile has parcels on
  ≥ 2 of its 4 lanes (a property a first-fit loop cannot produce). Implement a
  small test helper that, for each road tile, counts 4-neighbour parcel ids
  belonging to distinct parcels and asserts `max ≥ 2`.
- **Denser:** `parcels.aliveCount()` after era 1 `≥ 80` (was ~40), per seed.
- Existing era-1 guards stay green: civic ≥ 1, commercial ≥ 3, house ≥ 15,
  every parcel touches a road, `checkParcelAgreement` empty, single road
  component.
**Validation:** `npx vitest run tests/worldgen/moses.test.ts`.

### Task 5: Era 2 — 2-row avenues + denser fill + parking fields
**Files:** `src/worldgen/moses.ts`, `tests/worldgen/moses.test.ts`
**Approach:**
- New `widenAvenue(map, parcels, axis, index, lo, hi, rng)`: for `s` in
  `[lo,hi]`, on the parallel line (`index+1` for the row/col), demolish any
  parcel at that tile (`demolishParcel` via the baked `parcel` id − 1) then
  `placeTransport(RoadAvenue)`; the parallel tile is 4-adjacent to the spine
  so the network stays one component (gaps at water/edge are fine — each
  placed tile attaches to the continuous primary line). Use
  `rng.fork('widen')` only if any rng is needed (likely none — widening is
  deterministic geometry).
- In `era2MotorAge`, after the arterial upgrade (`:521-522`), call
  `widenAvenue` on `arterialRow` (along `gridX0..gridX1`) and `arterialCol`
  (along `gridY0..gridY1`).
- Add `placeParkingField(map, parcels, rng, ax, ay, cols, rows)`: lay a grid
  of 2×2 `ParkingLot` parcels (`placeParcel`) covering ~`2*cols × 2*rows`
  (target 4×4–6×6) where free; near the auto-age sprawl just outside the core.
  Add param `era2ParkingFields: 1` (count) + `parkingFieldCells: 2` (→ 4×4).
  Place via `rng.fork('parkfield')`.
- Raise `era2Parcels: 24 → 90`; replace era 2's first-fit infill loop
  (`:603-611`) with a `fillFrontage(... rng.fork('fill') ...)` over the era-2
  grid road tiles. Keep the existing industry (`'fabric'`) + the 2 near-core
  parking lots.
**Tests (RED first):**
- **2-row avenue exists:** after era 2, `≥ 1` `RoadAvenue` tile satisfies
  `wideRoadAt(map, x, y)` (import `wideRoadAt`).
- **Parking field exists:** a `ParkingLot` connected component (reuse the
  test's `componentSizes`) of size `≥ 16` (a 4×4 field).
- Existing era-2 guards stay green: avenue tiles ≥ 20 (widening only ADDS
  avenue tiles), industry ≥ 2, parking ≥ 1, single road component,
  `checkParcelAgreement` empty; determinism self-hash.
**Validation:** `npx vitest run tests/worldgen/moses.test.ts`.

### Task 6: Era 3 — 3-row highway carve + aggregated demolition chronicle
**Files:** `src/worldgen/moses.ts`, `tests/worldgen/moses.test.ts`
**Approach:**
- Generalize `carveCorridor` to carve **3 rows**: the center line exactly as
  today (continuous spine: demolish parcels, rip rail, lay `RoadHighway`),
  then for each `s` in `[lo,hi]` on the two parallel lines (`index ± 1`,
  perpendicular to the corridor axis), demolish any parcel there
  (`demolishParcel`) and `placeTransport(RoadHighway)` (skip water/edge). Sum
  **all** demolitions (center + both parallels) into the returned `demolished`
  count. The perpendicular second corridor (`:751`) widens the same way. The
  chronicle line (`:793`) therefore reports the TOTAL demolitions — keeping
  the balance-equation test exact.
**Tests (RED first):**
- **3-row highway exists:** after era 3, `≥ 1` `RoadHighway` tile satisfies
  `wideRoadAt` (a corridor-interior tile).
- **Balance equation holds under widening** (the existing test at
  `moses.test.ts:381` must stay green): `aliveAfter === aliveBefore −
  demolished + projPlaced + civicPlaced`, with `demolished` parsed from the
  chronicle — so the widened carve MUST count every row's demolitions.
- Existing era-3 guards stay green: highway tiles ≥ 20, single highway
  component (`sizes[0] === count` — the 3 rows are 4-adjacent), ≥ 5 highway
  tiles in the top-quartile density mask, projects within 3 tiles, streetcar
  ripped out, agreement; determinism self-hash.
**Validation:** `npx vitest run tests/worldgen/moses.test.ts`.

### Task 7: Era 4/5 density + crater parking fields + full-stage determinism
**Files:** `src/worldgen/moses.ts`, `tests/worldgen/moses.test.ts`
**Approach:**
- Raise `era4Houses: 25 → 90`. Keep era 4's special far-sprawl loop
  (`:929-938`, the `beyond suburbRadius` accept + farthest-from-highway order)
  but with the raised budget; optionally add a light inner-core
  `fillFrontage` for the offices ring (keep it modest to protect the era-5
  ratio — see Risk).
- Era 5: a fraction of demolition craters expand from a single 2×2
  `ParkingLot` to a small parking **field** (reuse `placeParkingField` on the
  cleared footprint where space allows), via the existing `'crater'` fork.
  Keep the abandonment passes otherwise unchanged.
- Add a **full-stage triple-snapshot determinism** test: for each seed,
  `hashWorld(runFullStage(seed))` run three times are all equal; different
  seeds differ (extends the existing `mosesCenturyStage` determinism block).
**Tests (RED first):**
- Existing era-4 guards green: far houses ≥ 15 and `> farBefore`, offices ≥ 2,
  core residential declines, agreement.
- Existing era-5 guards green **across all three seeds** (the seed-sweep):
  abandoned ≥ 10% of `preEra5Alive`, near/far cohorts ≥ 5, blight gradient
  (near < far), parking-lot count increases; chronicle balance
  `alive === preEra5Alive − abandoned + craters`.
- Triple-snapshot: three full-stage hashes equal per seed; cross-seed differ.
- Post-stage single road component (`moses.test.ts:621`) holds.
**Validation:** `npx vitest run tests/worldgen/moses.test.ts`. If any seed's
era-5 abandonment dips < 10%, tune the `fillFrontage` core-weighting / cap the
era-4 inner fill (NOT the decay formula); re-sweep.

### Task 8: Ecology suppression monotonicity (characterization)
**Files:** `tests/worldgen/ecoseed.test.ts` (add a case) — **no `src` change**
(proves the free ecology bonus over the unchanged `seedEcology`).
**Approach / Tests (RED first):** build two identical bare maps (same
`width/height`, all land, uniform `landCover`/`moisture`); on map A lay a
**1-wide** `RoadHighway` line; on map B lay a **3-wide** band over the same
center; `seedEcology` both; assert `Σ soilHealth` over the corridor
neighbourhood (tiles within Manhattan distance `R` of the center line) for B
`≤` A (suppression is monotonic in corridor width). Optionally also assert the
fauna periphery weight in the band is `≤` for B. This documents AC #9 and
guards against a future influence/eco-seed change silently inverting it.
**Validation:** `npx vitest run tests/worldgen/ecoseed.test.ts`.

## 4. Validation Gates
```bash
# Type check
npx tsc --noEmit

# Full unit suite (architecture guard, worldgen determinism, render keys,
# decoration predicates, ecology monotonicity)
npx vitest run

# Production build (also the only thing that executes buildAtlas → catches an
# unpainted/unenumerated render key)
npm run build
```
Plus the **team-lead live browser pass in BOTH Chromium and WebKit** (the
human acceptance gate for AC #10): serve `npm run dev`, screenshot a generated
city, confirm filled blocks, 2-wide avenues / 3-wide freeways reading as
slabs, parking fields, power lines along streets, and acceptable zoom-1
framerate with the decoration pass on.

## 5. Rollback Plan
Each task is an isolated commit. Power lines (Task 3 decoration pass +
Task 2 `powerPoleAt`) are one-commit reversible. The wide-body variant is
additive (revert Task 1/3 to fall back to striped roads; keyspace shrinks
back). The worldgen density (Tasks 4–7) is parameter- and helper-scoped —
reverting restores the old budgets/single-width corridors with no schema or
save impact (no save format exists). No data migration anywhere.

## 6. Uncertainty Log
- **Era-5 abandonment ratio under denser fabric** is the one empirical
  unknown — must seed-sweep (Task 7). Mitigation is fill-weighting, never the
  decay formula. Flag for the team lead's live + sweep.
- **`new GameMap(w, h)` constructor signature** — confirm against
  `tests/engine/map.test.ts` before writing the Task 2 fixtures (the predicate
  logic is independent of how the fixture map is built).
- **Wide-body slab art** (how much marking to suppress so it reads as a mass
  without looking blank) is a live-pass tuning call — start with edge-to-edge
  asphalt + a faint seam.
- **Power-pole side/orientation** (which side of the road, wire thickness) is
  cosmetic — settled in the live pass; the predicate spacing is fixed/tested.
- **`wideRoadAt` basis = `isRoadKind` (1–3)**, excluding `QuietStreet`(7); the
  worldgen corridors are avenue/highway and a 1-wide quiet-street conversion
  never forms a 2×2 band, so this is harmless — flagged for the reviewer in
  case Feature C/D wants quiet-street slabs later.
