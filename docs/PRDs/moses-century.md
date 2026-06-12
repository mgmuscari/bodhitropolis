# PRD: Moses Century

## Status: DRAFT
## Author: Claude (Proposer stance), directed by Maddy Muscari
## Date: 2026-06-12
## Branch: feature/moses-century

## 1. Problem Statement

Bodhitropolis's premise is *inheritance*: the player takes over a city
wrecked by a century of Robert Moses-style American development and heals it.
That century is currently missing. The map has terrain (PR #1) and a fabric
model with a placeholder demo town (PR #2), but no history — no city, no
blight, no story. Dwarf Fortress's defining trick is that worldgen *simulates
history* so the start state is earned, legible, and different every seed.
This feature is Bodhitropolis's version of that trick: a deterministic
historical worldgen that founds a streetcar town (~1900), grows it through
the motor age, carves highways through its densest neighborhoods, rips out
the rails, stacks the projects, sprawls the periphery, and disinvests the
core — handing the player a blighted-but-coherent city circa 2000 plus a
chronicle of what happened to it.

It also pays down scheduled debt: the fenced placeholder
`src/worldgen/fabricdemo.ts` exists only to be deleted by this feature.

## 2. Proposed Solution

One `moses-century` worldgen stage (after `terrain`) that runs five eras in
sequence over the shared WorldState, each era a pure sub-step with its own
forked rng stream, coarse and statistical (spatial rules + rng — no
per-tick agents):

1. **Founding & streetcar town (1900-1920)** — settlement site chosen with
   water bias (harbor/river frontage + flat land scoring); founding
   crossroads; a small street grid; streetcar rail lines radiating along
   arterials; fine-grained fabric (houses, commercial strips, a civic core)
   along the rails.
2. **Motor age (1920-1945)** — grid extension; arterial streets upgraded to
   avenues; industry placed along rail and water frontage; first parking
   lots downtown.
3. **Urban renewal & highways (1945-1965)** — the Moses signature: a highway
   corridor driven straight through the *densest* fabric (demolishing
   parcels in its path), a second corridor if the map supports it; streetcar
   rails ripped out; public-housing Projects stacked on cleared blocks
   adjacent to the corridor; civic megablocks.
4. **Suburban flight (1965-1985)** — single-family sprawl at the road-
   reachable periphery; commercial strips along arterials; downtown offices
   rise; inner-core residential condition begins declining.
5. **Disinvestment (1985-2000)** — condition decay concentrated near the
   highways (redlining-shaped distance falloff); worst parcels abandoned and
   demolished; parking craters spread on the cleared land.

Each era appends chronicle entries to `world.log` (founding site, corridor
endpoints, demolition counts, etc.) — the substrate for the future
opening-challenge UI. The stage replaces `fabricDemoStage()` in `main.ts`;
`fabricdemo.ts` and its tests are deleted.

## 3. Architecture Impact

- **New**: `src/worldgen/moses.ts` (the stage + era sub-steps; possibly
  split into `moses/` modules if size demands), `tests/worldgen/moses.test.ts`.
- **Deleted**: `src/worldgen/fabricdemo.ts`, `tests/worldgen/fabricdemo.test.ts`
  (the fence the fabric PRD promised).
- **Modified**: `src/main.ts` (swap demo stage for `mosesCenturyStage()`);
  `src/engine/fabric.ts` gains the missing *demolition* primitive —
  placement currently has no inverse. A `demolishParcel(map, store, i)` /
  `demolishTransportAt(map, x, y)` pair (single-writer rule: these live in
  fabric.ts beside placement). ParcelStore needs a tombstone/alive flag (or
  equivalent) since parallel-array indices are baked into the `parcel`
  layer.
- **Data model**: no new layers expected; demolition semantics (tombstoned
  store entries, `built`/`parcel` cleared, optionally rubble→`ParkingLot` or
  Bare) are this feature's main engine-surface change. `snapshotBytes()`
  must cover the alive flag.
- **Dependencies**: none added.

## 4. Acceptance Criteria

1. All gates green: `npx tsc --noEmit`, `npx vitest run`, `npm run build`;
   architecture guard passes over all new/changed engine/worldgen code.
2. `fabricdemo.ts` and its tests are gone; `main.ts` runs
   `[terrainStage(), mosesCenturyStage()]`.
3. Determinism: same seed → identical `hashWorld(world)` across two full
   pipeline runs; different seeds differ (tested over ≥3 seeds).
4. Demolition primitive: removing a parcel clears its footprint tiles,
   tombstones its store entry, keeps `checkParcelAgreement` clean, and
   changes `hashWorld`; demolishing twice is rejected/no-op (tested).
5. Era invariants, asserted non-vacuously across ≥3 seeds (counts proven ≥
   thresholds, not just "no violation"):
   a. Founding: a contiguous street network exists; ≥1 rail line laid in
      era 1; houses + commercial + civic present along it.
   b. Highways: ≥1 highway corridor of ≥20 tiles crossing the pre-era-3
      dense core, with ≥5 parcels demolished in its path (chronicle records
      the count); corridor tiles are connected.
   c. Rails: era-3 removes streetcar rail — post-stage rail tile count is
      ≤10% of its era-1 peak (chronicle records both numbers).
   d. Projects: ≥2 Projects parcels placed within 3 tiles of a highway
      corridor during era 3.
   e. Sprawl: era-4 HouseSingle parcels outside the era-1 core are all
      road-adjacent (`parcelTouchesRoad`).
   f. Blight gradient: mean condition of parcels within distance D of a
      highway is lower than mean condition beyond 2D (D chosen in PRP);
      ≥10% of pre-era-5 parcels demolished or abandoned by era 5.
   g. Terrain integrity: elevation/water/moisture/landCover layers are
      byte-identical before vs. after the stage *except* land-cover cells
      under new built tiles (the stage builds on land, never edits water or
      elevation).
6. Integrity: `checkParcelAgreement` returns no violations after every era
   (tested via an instrumented run or post-stage sweep per era).
7. Chronicle: `world.log` contains ≥1 entry per era including founding site
   coordinates, highway corridor description with demolition count, and
   rail-removal numbers.
8. Visual: `npm run dev` shows a recognizable city — downtown, highway
   slicing it, project blocks, sprawl ring, weathered/abandoned core (the
   existing condition-tier rendering shows blight without new renderer work;
   minor renderer additions allowed if a kind needs distinguishing).

## 5. Risk Assessment

- **Coherence is the hard part**: statistical placement can produce salad
  instead of a city. Mitigation: strong spatial anchors (founding site,
  arterials, distance-to-center fields) and era invariant tests that encode
  "looks like a city" as measurable properties; visual check before PR.
- **Demolition correctness**: tombstoning store entries while the `parcel`
  layer holds index+1 ids is the riskiest engine change — a stale id after
  demolition corrupts agreement. Mitigation: demolition lives beside
  placement (single writer), bidirectional sweep runs per era in tests.
- **Determinism under iteration order**: era rules that scan the map must
  iterate in fixed row-major order and draw rng in deterministic sequence;
  any candidate-set sort must be total. Mitigation: existing conventions +
  hashWorld double-run tests.
- **Scope blow-up**: each era could be a feature. The eras here are
  deliberately coarse (one stage, five sub-steps, simple rules); the PRP
  must keep each era to one task.
- **128×128 fit**: a century of growth must not fill the map or starve
  (all-water seeds). Mitigation: growth budgets per era scaled to available
  land; the all-water no-op behavior carries over from the demo stage.

## 6. Open Questions

1. Abandonment representation: demolish-to-Bare vs. a `Rubble`/`Abandoned`
   BuiltKind (16..47 has room)? (Assume: demolition clears to empty;
   "parking crater" outcomes place ParkingLot parcels; a dedicated rubble
   kind can come with the gameplay feature that needs to bulldoze it.)
2. Should the dense-core measure be parcel density per radius (cheap) or a
   smoothed density field (nicer corridors)? (Assume: per-tile parcel
   counts in a radius via simple box sums — exact, integer, deterministic.)
3. One stage with five sub-steps vs. five pipeline stages? (Assume one
   stage `moses-century` with internally forked era streams — inserting
   future stages between eras is not a use case; the chronicle is the
   era-level interface.)

## 7. Out of Scope

- Opening-challenge / chronicle UI (reads `world.log` in a later feature)
- Gameplay, player tools, bulldozer, tech tree, ecology, civic sim
- Traffic/economy/population simulation; per-tick agents of any kind
- Save/load; map sizes beyond the 128×128 default path
- New renderer systems (existing kinds + condition tiers suffice; minor
  tile additions only if a kind is visually indistinguishable)
