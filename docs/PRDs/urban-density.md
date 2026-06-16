# PRD: Urban Density

## Status: IMPLEMENTED
## Author: Claude (Proposer stance), directed by Maddy Muscari
## Date: 2026-06-15
## Branch: feature/urban-density

## 1. Problem Statement

The first playtest's verdict on the world itself: **"zoning is very sparse.
we should see grids filled in. there should be double width stroads, and
triple width freeways. large blocks of pavement form parking lots. power
lines should run along streets."** The Moses-century worldgen produces a
*correct* city — a coherent grid, a historically-shaped blight gradient — but
a **toy-scale** one. It reads as scattered confetti, not a dense mid-century
city that the player is challenged to heal.

Concretely, the current generator is thin by construction:

- **Sparse frontage.** Every era's housing loop calls `placeAdjacent`
  (`moses.ts:230`), which places **one** parcel per road tile on the
  *first* lane (N→S→W→E) that fits, then moves on. A street with open land on
  both sides gets built on one side. Budgets are small: `era1Parcels: 40`,
  `era2Parcels: 24`, `era4Houses: 25` (`moses.ts:93,101,110`). The result is
  a lattice of roads with a thin rind of buildings.
- **Hairline corridors.** Arterials are single tiles wide. Era 2 upgrades
  the two founding arterials street→avenue *in place* (`upgradeArterialRow`/
  `Col`, `moses.ts:488,496`); era 3 carves a 1-tile `RoadHighway` line
  (`carveCorridor`, `moses.ts:650`). A "highway" one tile wide does not read
  as the neighborhood-cleaving expressway the Moses story is about.
- **No pavement mass, no utility texture.** Parking is two 2×2 lots near the
  crossroads (`era2Parking: 2`); there is no power infrastructure at all.

This is the second of four playtest features (ui-revival ✓ → **urban-density**
→ rezoning → city-life). ui-revival made the city *playable*; this makes it
*read as a city* — the dense, oppressive fabric that gives the restorative
gameplay something to push against. It is worldgen + renderer only: no new
mechanics, no new kinds.

## 2. Proposed Solution

Five changes, all inside `src/worldgen/moses.ts` and `src/ui` (renderer +
one new pure decoration module). The determinism contract (seeded rng, no
transcendental Math, `hashWorld` stable per seed) is preserved throughout —
existing seeds will produce **denser** worlds, each still reproducible.

1. **Filled blocks.** A new `fillFrontage` worldgen helper packs *every* open
   road-frontage lane (not first-fit) with era-appropriate parcels, the mix
   intensifying toward the core (denser `Apartments`/`CommercialStrip` near
   the crossroads, `HouseSingle` farther out). Per-era budgets rise ~3–4×
   (`era1Parcels` 40→~150, `era2Parcels` 24→~90, `era4Houses` 25→~90). Reuses
   the existing single-writer `placeParcel`; `Apartments` (kind 17, already in
   the taxonomy and `RESIDENTIAL` set but never yet placed) supplies the
   near-core density. Forks its own rng stream so existing per-era streams are
   not perturbed beyond the density change.

2. **Wide corridors — no new road kinds.** Era 2 widens its two arterials to
   **2-row avenues** (a stroad); era 3 carves a **3-row highway** (a freeway).
   Implemented as parallel rows of the *existing* `RoadAvenue`/`RoadHighway`
   kinds: the autotile mask and the `max()` junction merge
   (`placeTransport`, `fabric.ts:363`) already fuse adjacent same-category road
   tiles, so parallel rows connect into one component. Widening **demolishes**
   whatever it overruns via the existing `demolishParcel`/`demolishTransportAt`
   — that destruction *is* the Moses story (the expressway took the
   neighborhood). Player-built roads stay 1-wide; this is worldgen-only. The
   renderer gains a **wide-body** tile variant so a multi-row corridor draws as
   a continuous asphalt slab, not parallel stripes (see §3).

3. **Parking fields.** Clusters of 2×2 `ParkingLot` parcels (kind 22,
   existing) tiled into 4×4–6×6 pavement zones, placed in the auto-age sprawl
   (era 2/3) and in some era-5 demolition craters. Reuses `placeParcel`; no
   new kind.

4. **Power lines along streets.** A pure `powerPoleAt(map, x, y)` predicate
   (a pole at regular spacing along street/avenue tiles, derived
   deterministically from coordinates + the road layer — no new world state,
   no new layer, no new kind) plus a pole/wire **decoration pass** in the
   renderer. Purely derived + drawn, so it is one-commit reversible if it
   reads noisy.

5. **Ecological bonus (free).** Wider corridors mean more busy-road tiles, and
   `RoadAvenue`/`RoadHighway` are already negative, `fragmenting: true`
   suppressors in the **unchanged** influence table (`influence.ts:65-67`);
   the eco-seed corridor wound `CORRIDOR_WOUND/(1+highwayDist)`
   (`ecoseed.ts:85`) widens with the highway. The oppressive bulk thus reads
   ecologically with zero table changes.

## 3. Architecture Impact

**Worldgen — `src/worldgen/moses.ts`** (guarded fail-closed: DOM-free,
transcendental-Math-free, seeded rng only):
- Raise `era1Parcels`, `era2Parcels`, `era4Houses` in `DEFAULT_MOSES_PARAMS`;
  add params for corridor width, parking-field size/count, and fill budgets.
- New `fillFrontage(map, parcels, rng, opts)` helper (all-lane packing,
  core-weighted kind picker), called by eras 1, 2, and (lightly) 4.
- New `widenCorridor`/parallel-row logic in era 2 (avenue → 2 rows) and era 3
  (`carveCorridor` → 3 rows). The era-3 widened carve **must aggregate and
  chronicle all demolitions across all rows** — the era-3 balance equation
  test (`moses.test.ts:381`) is exact against the logged count.
- New parking-field placement (2×2 `ParkingLot` clusters) in era 2/3 and the
  era-5 crater path.

**Renderer — `src/ui/renderKey.ts` + `src/ui/renderer.ts`**:
- `builtRenderKey` grows a `wide` parameter → appends `-w` for wide road
  tiles (stays map-agnostic — just string construction). `renderKeyspace()`
  enumerates the `-w` variants for road kinds, or `buildAtlas`
  (`renderer.ts:333`, which paints every enumerated key) would have an
  unpainted key — and conversely any `-w` key the renderer requests but the
  keyspace omits would render blank.
- `makeRoadTile(kind, mask, wide)` paints the slab variant; `paintForKey`
  (`renderer.ts:311`) parses the `-w` suffix.
- The `render()` loop computes `wide` via the new predicate and passes it to
  `builtRenderKey`; a **decoration pass** after the built layer draws power
  poles/wires where `powerPoleAt` holds.

**New pure module — `src/ui/decoration.ts`** (added to `PURE_UI_ALLOWLIST` in
`tests/architecture.test.ts:86`): `wideRoadAt(map, x, y)` (the 2×2-all-road
predicate) and `powerPoleAt(map, x, y)`. Both pure, DOM-free,
transcendental-free, unit-tested.

**No changes** to: the engine fabric API, the ecology/civic/tech/tools logic,
the BuiltKind taxonomy, or any save/serialization (none exists). Eco-seed and
civic consume the denser map unchanged.

**Data model:** none. No new tile layers, no new `BuiltKind`s, no `ParcelStore`
fields. `powerPoleAt` and `wideRoadAt` are *derived* (computed from existing
layers), never stored.

**Dependencies:** none added.

## 4. Acceptance Criteria

1. **Gates green:** `npx tsc --noEmit`, `npx vitest run`, `npm run build` all
   pass; `src/ui/decoration.ts` is on the pure-ui allowlist and passes the
   architecture guard; the renderer's `buildAtlas` paints every key
   `renderKeyspace()` emits (the existing keyspace⊆paintable guard still
   holds with the `-w` variants).
2. **Determinism preserved:** for a fixed seed, the full dense Moses stage is
   byte-stable — a **triple-snapshot** `hashWorld` assertion (run the stage
   three times, all three hashes equal) across the existing seed set, and
   different seeds still differ. `fillFrontage`, corridor widening, and
   parking-field placement each fork their own labeled rng stream.
3. **All existing era tests still pass** under the raised budgets and wider
   corridors — in particular the road **single-component** guards
   (`moses.test.ts:152,272,635`, strict `=== total`: parallel rows are
   4-adjacent, so they stay one component) and the era-3 **demolition balance
   equation** (`moses.test.ts:398`: the widened carve chronicles *every* row's
   demolitions, so `aliveAfter === aliveBefore − demolished + projects + civic`
   still holds exactly).
4. **Filled blocks (tested):** `fillFrontage` is deterministic (same seed →
   same placements) and places parcels on **multiple lanes** of the same road
   tile (the all-lane property a first-fit loop cannot satisfy); the post-stage
   alive-parcel count is materially higher than the pre-feature baseline
   (a concrete lower bound asserted per seed, e.g. ≥ 2× the old budgets).
5. **Wide corridors (tested):** `wideRoadAt(map, x, y)` is a pure predicate
   that is **true** for a tile interior to a 2-row or 3-row road band and
   **false** for a single-width road, a corridor with no parallel neighbor,
   and a simple `+` intersection of two 1-wide roads (the diagonal-exclusion
   case) — pinned with explicit fixtures. After era 2 a 2-row avenue exists
   (≥ 1 avenue tile has `wideRoadAt` true); after era 3 a 3-row highway exists.
6. **Render keys (tested):** `builtRenderKey(kind, mask, pos, tier, true)`
   returns the `-w` key for road kinds and is unaffected by `wide` for
   buildings; `renderKeyspace()` includes every `-w` key `builtRenderKey` can
   emit (the ⊆ relation holds both directions for the wide variants).
7. **Parking fields (tested):** the placement produces contiguous `ParkingLot`
   clusters of the specified footprint (a connected-component size assertion,
   reusing the test's `componentSizes` helper), and the cluster parcels agree
   with the store (`checkParcelAgreement` empty).
8. **Power lines (tested):** `powerPoleAt(map, x, y)` is pure and
   deterministic (same coords + map → same answer), fires **only** on/along
   street/avenue tiles (never on empty land, water, rail, or building tiles),
   and at the specified spacing (a pole every Nth tile along a road, asserted
   on a fixture road).
9. **Ecology monotonicity (tested):** on identical terrain + seed, seeding
   ecology (`seedEcology`) over a **3-wide** highway band yields total soil in
   the corridor neighborhood **≤** that of a **1-wide** band (suppression is
   monotonic in corridor width), confirming the denser fabric flows through
   the unchanged influence/eco-seed path. No change to `influence.ts` or
   `ecoseed.ts`.
10. **Live pass (human acceptance gate), Chromium AND WebKit:** screenshots
    show **filled blocks** (both sides of streets built up, density rising
    toward the core), **2-wide avenues and 3-wide freeways reading as slabs**
    (not parallel stripes), **parking fields** (pavement masses), and **power
    lines along streets**. The road network remains visually connected;
    framerate at zoom 1 is acceptable with the decoration pass on.

## 5. Risk Assessment

- **Era-5 abandonment ratio under denser fabric (highest risk).** The era-5
  guard requires `abandoned ≥ 10%` of the standing city
  (`moses.test.ts:572`) and non-vacuous near/far cohorts (≥ 5 each,
  `:559-560`). Denser fabric near the carved corridors *increases*
  abandonment (near-highway parcels decay hardest), but a large far-suburb
  budget adds survivors that dilute the ratio. **Mitigation:** weight
  `fillFrontage` toward the core (where era 3 carves), keep the far-suburb
  budget growth moderate, and **seed-sweep** before the PR; if a seed dips
  below 10%, tune the fill weighting (not the decay formula) or modestly raise
  `craterChance`/`abandonThreshold`. The blight *gradient* (near more blighted
  than far) is driven by the unchanged rational falloff and is robust.
- **Era-3 balance equation (exact).** The widened (3-row) carve must count
  every demolished parcel across all three rows into the chronicled
  "N parcels demolished," or the balance equation test breaks. **Mitigation:**
  the widened carve sums each row's `demolishParcel` successes and logs the
  total; a dedicated test asserts the equation under widening.
- **Road single-component (strict ===).** Three tests assert
  `largestComponent === total`. Parallel road rows are 4-adjacent (connected),
  and `fillFrontage` adds only parcels (never roads), so connectivity is
  preserved — but a careless widen that skips a row tile at a water/edge clip
  could strand a fragment. **Mitigation:** widen by placing along the same
  validated span as the primary row (place-fails are skipped, never leaving an
  isolated tile), and the existing guards catch any regression.
- **Keyspace blow-up / blank tiles.** A `-w` key requested but not enumerated
  → blank tile; enumerated but not painted → `buildAtlas` throws on load.
  **Mitigation:** the keyspace⊆paintable and paintable⊇keyspace guards are
  headless tests; adding `-w` to both sides keeps them green.
- **Decoration-pass performance.** Drawing poles/wires every frame over the
  visible range adds per-tile work. **Mitigation:** `powerPoleAt` is a cheap
  integer predicate over the already-iterated visible range; the pass is
  reversible in one commit; the live pass checks zoom-1 framerate. (Feature D
  will cache the base layer; this feature keeps the simple per-frame draw.)
- **`hashWorld` churn is expected, not a regression.** Every existing
  determinism test compares a seed to *itself*, never to a frozen golden hash,
  so denser output does not break them — verified by reading the suite
  (`moses.test.ts` uses self-comparison throughout).

## 6. Open Questions

1. **Corridor widths final?** Assume avenue = 2 rows, highway = 3 rows (the
   "double stroad / triple freeway" of the feedback). Tunable via params.
2. **`wideRoadAt` category basis?** Assume `isRoadKind` (classic roads 1–3),
   since the widened corridors are avenue/highway; `QuietStreet`(7) reads as
   road for *masks* but is a 1-wide conversion that never forms a 2×2 band, so
   excluding it from the wide test is harmless. (Flagged for the reviewer.)
3. **Power-pole spacing/side?** Assume a pole every 4th tile along a road,
   drawn at the tile (a small mast + a wire segment toward the next pole);
   exact pixel placement is cosmetic, settled in the live pass.
4. **Near-core density kind?** Assume `Apartments` (existing kind 17) for the
   core intensification; it already renders and is in `RESIDENTIAL` so era 4
   decline / era 5 decay handle it correctly.

## 7. Out of Scope

- Rezoning / plops / community gardens / parks / rewilded land (Feature C).
- Ambient animation — cars, pedestrians, birds (Feature D), and the base-layer
  render cache that feature introduces.
- Any new `BuiltKind` or transport kind; any change to the junction-merge or
  conversion tables; widening of **player-built** roads.
- Ecology/civic/tech/tools logic changes (the influence table and eco-seed
  constants are untouched; the denser fabric flows through them unchanged).
- Restyling beyond the wide-body slab and the power-line decoration; touch /
  mobile / accessibility / localization.
