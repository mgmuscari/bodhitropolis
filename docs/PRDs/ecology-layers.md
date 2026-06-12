# PRD: Ecology Layers

## Status: DRAFT
## Author: Claude (Proposer stance), directed by Maddy Muscari
## Date: 2026-06-12
## Branch: feature/ecology-layers

## 1. Problem Statement

The city heals, but the land beneath it is scenery. The game's vision makes
ecology a first-class simulation — fauna, flora, biodiversity, local
microbiomes responding to land use — and the foundation's map was designed
with additive-layer headroom for exactly this. Right now the solarpunk
kinds the player unlocks and places (parklets, community gardens, quiet
streets) have economic cost but no ecological meaning; highways wound
neighborhoods in the chronicle but not the soil; nothing lives, recovers,
or returns. This feature makes the land a participant: the blighted city
starts ecologically wounded too, and the player's road diets and gardens
become acts of repair the simulation can measure.

## 2. Proposed Solution

1. **Three new map layers** (typed arrays, additive): `soilHealth` (the
   microbiome — degraded under and near pavement/industry, enriched near
   composting and gardens), `floraVitality` (how alive the cover is),
   `faunaPresence` (habitat occupancy). All fold into `map.snapshot()`.
2. **Ecology tick** (`src/ecology/`, pure, guard-scanned; runs every K sim
   ticks): flora regrows on healthy soil and spreads to adjacent viable
   tiles, suppressed near highways/parking/industry; fauna follows habitat
   (flora + water adjacency) and is fragmented by busy roads — **quiet
   streets, promenades, and bike paths do not fragment: the road-diet
   payoff**; soil recovers slowly, faster near CompostHub/CommunityGarden.
   Deterministic integer/rational math only.
3. **Biodiversity** via Simpson's index (1 − Σp² — rational arithmetic,
   no transcendentals) over local neighborhoods of habitat classes; a pure
   `ecologyReport(world)` (city-wide + highway-ring breakdown, the blight
   report's sibling) for future UI/civic consumption.
4. **Land-use influence table** (data-driven, per BuiltKind): boosts from
   the solarpunk kinds, suppression from highways/parking/industry,
   succession on bulldozed land.
5. **Ecology overlay** (`E` cycles off → soil → flora → fauna →
   biodiversity; established thin-shell pattern with a pure allowlisted
   tint mapping; legend line in the dock area).
6. **Worldgen seeding**: a final pipeline stage seeds the layers from
   terrain + fabric — the Moses century wounds the land (low soil near
   corridors, fauna pushed to the periphery) and the chronicle records it.

## 3. Architecture Impact

- **New**: `src/ecology/` (influence table, tick step, biodiversity,
  report; guard-scanned fail-closed), `src/worldgen/ecoseed.ts` (seeding
  stage), `src/ui/ecoOverlayContent.ts` (pure, allowlisted), overlay
  wiring in renderer (tint pass reuses the preview-tint machinery),
  mirrored tests.
- **Modified**: `src/engine/map.ts` (3 layers + snapshot fold — layers at
  :40-50, snapshot :123), `src/main.ts` (ecology cadence in the tick
  callback ~:184; `E` key route; pipeline gains the seeding stage :38),
  `src/ui/renderer.ts` (overlay tint pass), `tests/architecture.test.ts`
  (scan `src/ecology`).
- **Data model**: 3 × Uint8Array (≈49KB at 128²); influence table is data.
- **Dependencies**: none.

## 4. Acceptance Criteria

1. Gates green; `src/ecology` guard-scanned; no transcendental Math (the
   Simpson's-index choice over Shannon entropy is the deliberate
   determinism-compliant design and must stay).
2. Layers seeded deterministically by worldgen: double-run `hashWorld`
   equality; the wounded start is real and non-vacuous on ≥3 seeds — mean
   soil within the highway ring strictly below periphery mean; fauna
   presence concentrated outside the core (ring means ordered); a
   chronicle line records the ecological wound.
3. Ecology tick is deterministic (N composite ticks twice → equal
   snapshots), runs at the K-cadence (tested via tick counting), and each
   dynamic is tested directionally on fixtures: flora spreads onto
   adjacent healthy-soil tiles and not onto suppressed ones; fauna
   colonizes contiguous habitat and does not cross a highway but does
   cross a quiet street (the road-diet payoff, asserted both ways); soil
   rises near CompostHub/CommunityGarden faster than baseline and falls
   under new pavement.
4. Influence table: every BuiltKind has an explicit entry or explicit
   zero-default (totality tested); solarpunk boosts and gray suppressions
   match the table in tests, not prose.
5. Simpson's biodiversity: exact rational values pinned on hand fixtures
   (uniform → high, monoculture → 0), bounds [0, 1), deterministic;
   `ecologyReport` internally consistent on real pipelines (ring values
   ordered as seeded, indices within bounds, report deterministic).
6. Overlay: `E` cycles the four views + off; tint mapping pure and
   allowlisted with pinned color-ramp tests; legend reflects the active
   view; map interaction unaffected while overlaid.
7. Placing/bulldozing through the tools changes ecology only via the
   influence table during subsequent ticks (no instant teleporting of
   ecology state — placement writes fabric, the tick moves ecology;
   tested with a place-then-tick sequence).
8. Live browser pass (lead): seeded wound visible in soil view over the
   corridor; overlay cycling; place a community garden → nearby soil/flora
   visibly improve over ticks; a quiet-street conversion visibly bridges a
   fauna gap over ticks; `?seed=` determinism.

## 5. Risk Assessment

- **Tick cost**: full-map passes every K ticks; 16K tiles of integer math
  is cheap, but the BFS-ish spread must stay bounded (per-tick local
  neighborhood scans only — no global flood per tick).
- **Tuning swamp**: rates/thresholds are placeholder ecology, like effort
  costs; the acceptance bar is directional invariants on fixtures, never
  "looks balanced."
- **Snapshot churn**: three more layers in snapshot()/hashWorld — safe
  (no pinned absolute hashes), but every existing double-run test now
  also covers ecology determinism for free.
- **Overlay perf**: tint pass per frame while active; reuse the preview
  tint path (already per-frame) with a per-view Uint8 source — bounded.
- **Coupling creep**: ecology must not write fabric/tech state (read-only
  consumers + own layers only); the report is the only outward surface.

## 6. Open Questions

1. K cadence? (Assume K=10 — one ecology step per second at 100ms ticks;
   a constant in the ecology module, tested symbolically not by wall
   time.)
2. Does fauna need water access strictly? (Assume: water adjacency is a
   strong habitat bonus, not a hard requirement — keeps inland parks
   viable.)
3. Should the report feed the effort formula now? (Assume no — the civic
   sim owns wellbeing composition; ecology stays self-contained this
   feature.)

## 7. Out of Scope

- Civic sim and any effort-formula change; species-level simulation,
  individual animal agents; seasons, weather, climate; ecology win/lose
  conditions; sprite art (heatmap tints only); soundscape; ecology
  effects on parcel condition (a future cross-system feature).
