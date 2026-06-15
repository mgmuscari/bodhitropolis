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
  `canPlaceParcel` (`:315,410,363,431,294`). **Two distinct connectivity
  mechanisms — do not conflate them (YP5b):** (1) `placeTransport`'s
  `max(existing, kind)` resolves two kinds occupying the **same tile** (`:367`)
  — this is the *center-line overlay* case (laying `RoadHighway` over an
  existing avenue/street tile fuses to highway). (2) **Parallel rows are
  DISTINCT 4-adjacent tiles**; they join into one component via plain
  4-adjacency (the `roadNetwork` BFS, `moses.test.ts:66-97`) and autotile
  together via `transportMask` (`:478`) — NOT via `max()`. The implementer must
  not expect `placeTransport` to do anything special *between* neighbours; a
  parallel row connects simply because each of its tiles sits next to the spine.
  `isRoadKind(k) = 1≤k≤3` (`:64`).
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
  `road-${k}-${m}-w` for every `k` in a new **`WIDE_ROAD_KINDS` =
  `ROAD_RENDER_KINDS.filter(isRoadKind)` = `[RoadStreet, RoadAvenue,
  RoadHighway]` (1–3)**, × mask. Keep order stable and duplicate-free (append
  the wide block right after the plain road block). **Deliberately EXCLUDE
  `QuietStreet(7)`** (YP5a): `wideRoadAt` is `isRoadKind`-based (1–3, Task 2),
  so `render()` can only ever request a wide key for kinds 1–3 — enumerating
  `road-7-{m}-w` would emit 16 painted-but-unreachable atlas tiles (keyspace
  cruft, and a contradiction with the Uncertainty-Log note that quiet streets
  never form a 2×2 band). Restricting to `isRoadKind` keeps the wide keyspace ==
  exactly the keys `render()` can request: no dead keys, no blank-tile risk.
  (Kinds 1 AND 2 AND 3 are all included because `wideRoadAt` can report `true`
  for any of them — a 2×2 of streets, though rare in worldgen, must not render
  blank.)
**Tests (RED first):**
- `builtRenderKey(RoadAvenue, 15, 'c', 0, true) === 'road-2-15-w'`;
  `builtRenderKey(RoadHighway, 7, 'c', 0, true) === 'road-3-7-w'`.
- `wide` ignored for buildings: `builtRenderKey(HouseSingle, 0, 'e', 1, true)
  === 'b-16-e-1'`; and for rail: `builtRenderKey(Rail, 2, 'c', 0, true) ===
  'rail-2'`.
- `renderKeyspace()` contains `road-1-{m}-w`, `road-2-15-w`, and `road-3-0-w`
  for road kinds 1–3 × 16 masks; still has no duplicates and is order-stable.
- **No `road-7-*-w` keys exist** (the QuietStreet wide-exclusion is pinned):
  `renderKeyspace().filter((k) => k.startsWith('road-7-') && k.endsWith('-w'))`
  is empty, while the plain `road-7-{m}` keys remain present.
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
- `poleWireDirs(map, x, y): ReadonlyArray<[number, number]>` (YP4) — the wire
  segments to draw from a pole at `(x, y)`: the subset of `{[1,0],[0,1]}` (E, S)
  whose neighbour is a road tile of the same run. Pure; this is the *only* wire
  decision — the shell just draws a segment toward each returned offset. Empty
  if `powerPoleAt` is false. (Extracting this means the renderer's decoration
  pass holds **zero** branching logic beyond looping the pure predicates.)
- Append `'src/ui/decoration.ts'` to `PURE_UI_ALLOWLIST`.
**Tests (RED first), using `new GameMap(w,h)` fixtures:**
- `wideRoadAt`: a 2-row avenue band (rows y=5,6, x=2..10) → every interior
  tile true; a single 1-wide row → all false; a `+` intersection of two
  1-wide avenues → center false; a 3-row band → middle and edge rows true;
  a non-road tile → false.
- `powerPoleAt`: a horizontal avenue at y=5, x=0..12 → true at x=0,4,8,12 and
  false elsewhere on the row; false on a `RoadHighway` tile; false on empty
  land, water, rail, and a building tile; deterministic (two calls equal).
- `poleWireDirs`: on the same horizontal avenue, a pole at x=4 returns `[[1,0]]`
  (E wire only, no S neighbour); a pole at an L/T junction with both an E and S
  road run returns `[[1,0],[0,1]]`; returns `[]` where `powerPoleAt` is false.
- **Exact-set integration over a worldgen-shaped fixture (YP4):** build a
  `new GameMap(w,h)` laid out like real worldgen output — a 1-wide street grid
  (`blockSpacing` apart) with a **2-row avenue band** and a **3-row highway
  band** crossing it — then assert the **complete set** of `{(x,y) :
  wideRoadAt}` equals exactly the avenue+highway band tiles (and excludes every
  grid `+` intersection), and the **complete set** of `{(x,y) : powerPoleAt}`
  equals exactly the expected pole tiles. This is the headless proof that the
  predicates compose correctly over a realistic layout — the decision half of
  the render integration that Task 3's shell then only *draws*.
  - **Known, intentional boundary case (YP4 residual):** a 1-wide cross-street
    tile abutting the 2-row avenue band can itself complete a 2×2 of road tiles
    and so legitimately reads `wide` (correct `isRoadKind`-based behaviour, not a
    bug). The fixture+expected-set must handle this **deliberately** — either lay
    the grid so no street abuts the band edge-to-edge (isolating the bands to
    keep the asserted set clean), OR include those boundary tiles in the expected
    wide set. It is cosmetic (a boundary tile rendering as slab vs stripe), so
    the *visual* is left to the live pass; named here so a future reader does not
    mistake an isolated-band fixture for full mixed-kind-boundary coverage.
- The architecture allowlist test now includes `decoration.ts` and passes
  (pure).
**Validation:** `npx vitest run tests/ui/decoration.test.ts
tests/architecture.test.ts` then full suite + `tsc`.

### Task 3: Renderer wide-body slab + power-line decoration (thin shell)
**Files:** `src/ui/renderer.ts`
**Approach (thin DOM shell — every DECISION is a pure, headless-tested helper
from T1/T2; the shell holds zero branching beyond looping those helpers and
issuing `ctx` calls. YP4: by pushing the wide-flag, pole, and wire-direction
decisions into `decoration.ts` (with the exact-set fixture test in T2), the
only thing left untested here is literal `drawImage`/`fillRect`, validated by
`npm run build` + the keyspace⊆paintable guard + the live pass — matching the
renderer's existing no-unit-test convention while shrinking the untested
surface to pure pixel I/O):**
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
  `powerPoleAt(map, tx, ty)` draw a small dark mast at the tile, then for each
  offset in `poleWireDirs(map, tx, ty)` draw a thin wire segment toward that
  neighbour. The shell makes **no** decisions of its own — `powerPoleAt` and
  `poleWireDirs` (pure, T2-tested) own them; this is pure-visual `ctx` drawing,
  no atlas key.
**Tests:** none new in this file (the shell is pure pixel I/O); the wide/pole/
wire DECISIONS are covered headlessly by T2 (including the exact-set fixture
test). Validation leans on the T2 set test + the keyspace guard + build + live
pass.
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
  drawing a **kind-aware attr gen** (see next bullet), until `budget` is
  reached. Every placed parcel is road-adjacent by construction (preserves the
  `parcelTouchesRoad` invariant) and goes through `placeParcel` (preserves
  `checkParcelAgreement`). Returns the count placed.
- `pickKind(coreDist)`: `≤ commercialRadius` → occasional `CommercialStrip`
  (e.g. every 5th) else `Apartments`; `≤ coreRadius` → `Apartments`; else
  `HouseSingle`. (Density rises toward the core.)
- **Kind-aware density (YP6c):** `Apartments` are the *dense* near-core kind, so
  draw them with a denser attr gen — a new `DENSE_ATTRS: AttrGen` (e.g.
  `density: 2 + rng.nextInt(2)` → 2–3, `condition: 200 + rng.nextInt(56)`) —
  while `HouseSingle`/`CommercialStrip` keep `HEALTHY_ATTRS` (density 1–2). Pick
  the attr gen from the chosen kind inside `fillFrontage`. This keeps the
  *same* rng draw shape (two `nextInt` calls per placement, so the `'fill'`
  stream's structure is unchanged) while making `density` actually rise toward
  the core. `density` participates in `hashWorld` via `snapshotBytes`
  (`fabric.ts:222`), so it stays deterministic; no test reads density today, so
  this is forward-compat for any later density-reading feature, not a gate
  change. (Stays in scope — no new `BuiltKind`, no engine change.)
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
  The `≥ 80` floor is empirical — era-1 frontage is bounded by the
  `foundingGridSpan: 24` grid, and a water-heavy seed realizes fewer than the
  `era1Parcels: 150` budget (YP6a). During GREEN, **measure the actual realized
  `aliveCount()` on all three seeds and confirm the minimum clears 80 with
  margin**; if a seed under-realizes, set the asserted floor defensibly below
  the realized minimum (the AC-#4 intent is "materially denser, ≥ 2× the old
  ~40 baseline") rather than inflating the budget to force a number. The budget
  is a cap, not a guarantee — the test asserts the *realized* density floor.
- Existing era-1 guards stay green: civic ≥ 1, commercial ≥ 3, house ≥ 15,
  every parcel touches a road, `checkParcelAgreement` empty, single road
  component.
**Validation:** `npx vitest run tests/worldgen/moses.test.ts`.

### Task 5: Era 2 — 2-row avenues + denser fill + parking fields
**Files:** `src/worldgen/moses.ts`, `tests/worldgen/moses.test.ts`
**Approach:**
- New `widenAvenue(map, parcels, axis, index, lo, hi, rng): number`: for `s` in
  `[lo,hi]`, on the parallel line (`index+1` for the row/col), demolish any
  parcel at that tile (`demolishParcel` via the baked `parcel` id − 1) then
  `placeTransport(RoadAvenue)`; the parallel tile is 4-adjacent to the spine
  so the network stays one component (gaps at water/edge are fine — each
  placed tile attaches to the continuous primary line). **Returns the count of
  avenue tiles it placed** (YP6b). Use `rng.fork('widen')` only if any rng is
  needed (likely none — widening is deterministic geometry).
- In `era2MotorAge`, after the arterial upgrade (`:521-522`), call
  `widenAvenue` on `arterialRow` (along `gridX0..gridX1`) and `arterialCol`
  (along `gridY0..gridY1`), and **add their returned counts into the `avenues`
  tally** before the era-2 chronicle line (`:613-614`) — so `${avenues} avenue
  tiles` honestly reports the upgrade PLUS the widening, not just the upgrade
  pass. (No test parses this string — `avenueTileCount(map)` is read directly,
  `moses.test.ts:248-250` — so this is chronicle honesty, not a gate fix.)
- Add `placeParkingField(map, parcels, rng, ax, ay, cols, rows): number`: lay a
  grid of `cols × rows` 2×2 `ParkingLot` parcels (`placeParcel`) covering a
  `2*cols × 2*rows` rectangle anchored at `(ax, ay)`. **ALL-OR-NOTHING (YP3):**
  FIRST verify the **entire** `2*cols × 2*rows` rectangle is placeable (every
  constituent 2×2 lot passes `canPlaceParcel`); only if the whole rectangle is
  free, place all `cols*rows` lots and return `cols*rows`; otherwise place
  nothing and return `0`. This guarantees any field that lands is a full,
  contiguous component (no partial field → no sub-target component → no flaky
  `≥ 16` failure). Place via `rng.fork('parkfield')`. **Returns the number of
  `ParkingLot` parcels actually placed** (`cols*rows` on success, `0` on
  failure — a field is N parcels, not 1). Era 5 (Task 7) folds this count into
  its chronicled crater total so the demolition/crater balance equation stays
  exact (see Task 7).
- **Placement region = OPEN FRINGE land, NOT the gridded blocks (YP3).** With
  `blockSpacing: 4` (`:89`) and 1-wide roads, block interiors are only **3×3**
  (tiles at offsets 1,2,3 between streets at 0 and 4) — and the denser
  `fillFrontage` consumes most of that — so **no contiguous 4×4 free area
  exists inside the developed grid**; a 4×4 field can only fit in open land
  beyond it. The era-2 caller therefore SCANS open land just past the grid
  (e.g. land tiles with `built === 0 && parcel === 0` whose Manhattan distance
  to the core exceeds the grid half-span, ordered deterministically) and calls
  `placeParkingField` at the first anchor where the full rectangle fits, up to
  `era2ParkingFields` fields. (On the standard 128×128 seeds this fringe always
  exists; an all-water/tight map simply places 0 fields and the existence test
  is gated on the same viable seeds the other era-2 guards use.)
- Raise `era2Parcels: 24 → 90`; replace era 2's first-fit infill loop
  (`:603-611`) with a `fillFrontage(... rng.fork('fill') ...)` over the era-2
  grid road tiles. Keep the existing industry (`'fabric'`) + the 2 near-core
  parking lots.
**Tests (RED first):**
- **2-row avenue exists:** after era 2, `≥ 1` `RoadAvenue` tile satisfies
  `wideRoadAt(map, x, y)` (import `wideRoadAt`).
- **Parking field exists:** a `ParkingLot` connected component (reuse the
  test's `componentSizes`) of size `≥ 16` (a full 4×4 field) — satisfiable **by
  construction** now that placement is all-or-nothing in the open fringe (a
  partial field can never form, so the component is exactly the placed
  rectangle). **Empirical caveat (same as YP6a):** the stage-level `≥ 16` test
  still requires a free 4×4 to actually EXIST in the fringe on each gated seed —
  fold this into the same "verify-on-all-three-seeds-with-margin" GREEN
  instruction as the era-1 floor (on the standard 128×128 moses-1/2/3 the fringe
  is ample, but confirm rather than assume). The all-or-nothing contract itself
  is pinned seed-independently by a focused unit test of `placeParkingField` on
  a bare `new GameMap(w,h)` fixture: on a fully-free region it places `cols*rows`
  lots and returns that count (component `= 4*cols*rows` tiles); on a region with
  one occupied tile in the rectangle it places nothing and returns `0`.
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
- Raise `era4Houses: 25 → 55` (a MODERATE ~2.2× bump, not 90 — see the lever
  correction below). Keep era 4's special far-sprawl loop (`:929-938`, the
  `beyond suburbRadius` accept + farthest-from-highway order) with the raised
  budget; optionally add a light inner-core `fillFrontage` for the offices ring
  (keep it modest).
  - **Era-5 ratio — correct lever (YP2).** The era-5 guard needs `abandoned ≥
    10%` of `preEra5Alive` (`moses.test.ts:572`). The DOMINANT diluter is the
    **far-suburb budget `era4Houses`, NOT the optional inner-core fill.** Far
    houses sit at highway distance `d ≥ 16`; their era-5 decay loss is
    `floor(maxDecay/(1+decayK·d)) = floor(200/(1+0.15·16)) = 58`
    (`moses.ts:998-999`), so a `HEALTHY_ATTRS` house (condition 200–255) lands
    at ~140–197 — far above `abandonThreshold: 40`. Every far house is a
    near-guaranteed era-5 SURVIVOR that adds to the denominator with ~zero
    numerator contribution. So the prior plan (90 far houses, "cap the inner
    fill") aimed at the wrong knob. Fix: hold `era4Houses` MODERATE (55), and
    point the abandonment numerator at the carved core instead —
    **`fillFrontage` is weighted toward the core** (`pickKind` already places
    the dense `Apartments`/`CommercialStrip` near the crossroads, exactly where
    era 3 carves the 3-row highway), so the d≤2 heavy-decay band (widened by
    Task 6) gains parcels in step with the denominator.
  - **Structural floor argument (not just "sweep and tune").** Numerator
    (abandoned) is driven by near-corridor dense fill — which the 3-row carve
    (Task 6) *widens* the kill-band for and which `fillFrontage` *concentrates*
    near the core; denominator growth from the far suburbs is held to a moderate
    `era4Houses: 55`. Because the near-fill scales with the same core the
    corridor cleaves while the far-fill is capped, the abandoned fraction is
    structurally bounded BELOW only by how core-weighted the fill is — a knob we
    control — not by the far budget outrunning it. The seed-sweep is the
    empirical CHECK on this argument, not the mitigation itself.
- Era 5: a fraction of demolition craters expand from a single 2×2
  `ParkingLot` to a small parking **field** (reuse `placeParkingField` on the
  cleared footprint where space allows), via the existing `'crater'` fork.
  Keep the abandonment passes otherwise unchanged.
  - **Balance-equation discipline (exact, mirrors Task 6):** the chronicled
    `craters` count MUST be the **total number of `ParkingLot` parcels placed**
    across all craters — i.e. sum the value `placeParkingField` returns (N for
    an N-parcel field) and `+1` for each single-lot crater — NOT the number of
    crater *events*. The current loop (`moses.ts:1009-1020`) already increments
    `craters` once per `placeParcel(ParkingLot)` success, so `craters` == net
    `ParkingLot` parcels added and `aliveCount() === preEra5Alive − abandoned +
    craters` holds (`moses.test.ts:574`). A field that adds N parcels but logs
    `craters += 1` would under-count by `N − 1` and break that exact equation —
    so route every field parcel through the same counter. `abandoned` is
    unchanged (one per demolished doomed parcel); only the `craters` term must
    sum the full field footprint.
- Add a **full-stage triple-snapshot determinism** test: for each seed,
  `hashWorld(runFullStage(seed))` run three times are all equal; different
  seeds differ (extends the existing `mosesCenturyStage` determinism block).
**Tests (RED first):**
- Existing era-4 guards green: far houses ≥ 15 and `> farBefore`, offices ≥ 2,
  core residential declines, agreement.
- Existing era-5 guards green **across all three seeds** (the seed-sweep):
  abandoned ≥ 10% of `preEra5Alive`, near/far cohorts ≥ 5, blight gradient
  (near < far), parking-lot count increases; chronicle balance
  `alive === preEra5Alive − abandoned + craters`. **This balance test
  (`moses.test.ts:574`) is the guard for the crater-field counting above** —
  with fields adding multiple parcels, it stays green ONLY if `craters` sums
  every placed `ParkingLot` parcel. Cover the counting fix **non-vacuously
  without relying on organic clustering on moses-1/2/3** (era-5 fields form only
  where adjacent doomed parcels happen to clear contiguous space — seed-
  dependent and fragile to assert): the `placeParkingField` return-count is
  pinned by the focused Task-5 unit test, and the era-5 *wiring* is pinned by a
  **constructed fixture** — a `new GameMap(w,h)` seeded with a short run of
  adjacent low-condition parcels beside a `RoadHighway` tile, run through
  `era5Disinvestment`, asserting (i) a newly-created `ParkingLot` component of
  size ≥ 2 appears (a field formed) and (ii) `aliveCount() === preEra5Alive −
  abandoned + craters` holds exactly. The three-seed stage test then only needs
  the balance equation green (which it is by construction, since `craters` sums
  placed parcels regardless of whether a field forms).
- Triple-snapshot: three full-stage hashes equal per seed; cross-seed differ.
- Post-stage single road component (`moses.test.ts:621`) holds.
**Validation:** `npx vitest run tests/worldgen/moses.test.ts`. If any seed's
era-5 abandonment dips < 10%, the levers in priority order are: (1) sharpen the
`fillFrontage` core-weighting (more near-corridor parcels = more numerator);
(2) lower the far-suburb budget `era4Houses` further (fewer survivors = smaller
denominator — this is the dominant diluter per YP2, so it is the second lever,
not the inner fill); (3) modestly raise `craterChance`/`abandonThreshold`.
**NEVER the decay formula** (`decayK`/`maxDecay`/the rational falloff) — that is
the determinism-and-blight-gradient contract. Re-sweep all three seeds after any
tune; do not stop at a single passing seed (overfitting the gate).

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
  unknown — must seed-sweep (Task 7). The dominant diluter is the **far-suburb
  budget `era4Houses`** (far houses at `d ≥ 16` barely decay and become
  guaranteed survivors in the denominator), so it is held MODERATE (25→55, not
  90), and the abandonment numerator is steered to the carved core via
  core-weighted `fillFrontage`. Levers if a seed dips: fill core-weighting →
  lower `era4Houses` → `craterChance`/`abandonThreshold`; **never the decay
  formula**. Flag for the team lead's live + sweep.
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
