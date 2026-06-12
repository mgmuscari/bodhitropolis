# PRP: Ecology Layers

## Source PRD: docs/PRDs/ecology-layers.md
## Date: 2026-06-12

## 1. Context Summary

The land becomes a participant: three new Uint8 map layers (soilHealth /
floraVitality / faunaPresence), a pure K-cadence ecology tick
(regrowth/spread/fragmentation/recovery driven by a per-BuiltKind
influence table), Simpson's-index biodiversity (rational arithmetic — the
deliberate no-transcendentals choice), a seeding worldgen stage that makes
the Moses century wound the land itself, an `ecologyReport` sibling to the
blight report, and an `E`-cycled heatmap overlay. Ecology reads fabric and
tech state; it writes only its own layers.

## 2. Codebase Analysis

(Verified at branch HEAD, post-PR #6 merge `02f1d0b`.)

- **Layer + snapshot pattern** — src/engine/map.ts: six layers :40-50,
  constructor allocations :56-66ish, `snapshot()` FNV fold :123-137.
  Three Uint8Array additions follow `landCover`'s pattern exactly; fold
  order appended after `parcel` (no pinned absolute hashes exist — every
  existing double-run determinism test then covers ecology for free).
- **Tick hook** — src/main.ts:30 `SIM_TICK_MS = 100`; the tick callback
  (~:184) currently accrues effort + marks panelDirty. Ecology cadence:
  `if (tick % ECO_CADENCE === 0) ecologyTick(world, tick)` — the tick
  index is already the loop's argument (engine/loop.ts `onTick(tick)`).
  Mark canvas `dirty` when the overlay is active (ecology changed → tint
  refresh) — NOT when inactive (no visual delta; avoids re-render churn).
- **Pipeline integration** — src/main.ts:38 `runPipeline({seed},
  [terrainStage(), mosesCenturyStage()])` gains `ecoSeedStage()` third;
  stage contract + fork-by-name per src/worldgen/pipeline.ts. The stage
  appends a chronicle line — NOTE the chronicle parser
  (src/worldgen/chronicle.ts) groups by `era([1-5]):` prefixes; an
  `eco:`-prefixed line lands in NO era and (verify in Task 4) is silently
  skipped by the parser — the opening overlay is unaffected; the line is
  for the report/log surface. If the wound should appear in the OPENING
  story, the line must instead be `era5:`-prefixed — design call: use
  `era5: the land kept the bill — …` so the wound IS part of the telling.
- **Influence sources** — src/engine/fabric.ts: `BuiltKind` table (transit
  5-9, buildings 16-23 + 48-60), `transportCategory` (road category 1 =
  fragmenting iff kind ∈ {1,2,3}; QuietStreet(7) is category 1 but must
  NOT fragment — the table keys on KIND, not category, precisely to
  express the road-diet payoff), `aliveIndices`/scalar accessors for
  parcel kinds, `distanceField` (src/worldgen/fields.ts — passable BFS
  for the ring breakdown, same cohorts as the blight report d≤8 / d≥16).
- **Report sibling** — src/worldgen/report.ts `buildReport` patterns
  (chronicle-sourced nullables, cohort guards ≥5, exact `=== 0`
  degenerate paths) — `ecologyReport` mirrors its discipline.
- **Overlay machinery** — src/ui/renderer.ts `setPreview` tint pass
  (translucent fills after the built pass) — the ecology overlay
  generalizes this: `setOverlay(view: {tint(i): rgba} | null)`; reuse the
  same draw stage. Pure tint mapping lives in `src/ui/ecoOverlayContent.ts`
  (allowlisted): value→color ramps per view, pinned in tests.
- **Key routing** — `E` follows the `T` pattern: pure
  `shouldCycleOverlay(key, overlayActive)` gate (opening-overlay
  suppression), shell binding in main.ts (input.ts keydown handles arrows
  only; T is bound in main.ts — verify exact location during Task 6 and
  mirror it).
- **Guard** — tests/architecture.test.ts scanned dirs gain `src/ecology`
  (fail-closed); allowlist gains `ecoOverlayContent.ts`. Simpson's index:
  `1 − Σ(count²)/(total²)` computed in integers then one division —
  exactly-rounded, no `Math.pow` (squares are `n*n`), no log.
- **Conventions**: TDD; atomic commits; FROZEN-suites discipline does not
  bind here (no fabric semantics change — fabric is READ-ONLY to ecology;
  any fabric.ts edit in this feature is a review flag).

**Execution mechanics:** full team pipeline; lead owns the live browser
pass + tier strip.

## 3. Implementation Plan

**Test Command:** `npx vitest run`

### Task 1: Map layers + snapshot fold
**Files:** `src/engine/map.ts`, `tests/engine/map.test.ts`
**Approach:** `soilHealth`, `floraVitality`, `faunaPresence` (Uint8Array,
w*h, zero-init) + typed get/set accessors per existing pattern; snapshot
fold appended after `parcel`.
**Tests (RED):** allocation/lengths; accessor roundtrips; snapshot changes
on single-cell mutation of EACH new layer; snapshot equality for equal
content (existing tests untouched).
**Validation:** `npx vitest run`; `npx tsc --noEmit`

### Task 2: Influence table + ecology constants
**Files:** `src/ecology/influence.ts`, `tests/ecology/influence.test.ts`,
`tests/architecture.test.ts` (scan src/ecology)
**Approach:**
```ts
interface KindInfluence { soil: number; flora: number; fauna: number;
  fragmenting: boolean }  // per-tick deltas applied within RADIUS (2)
INFLUENCE: ReadonlyMap<BuiltKind, KindInfluence>
influenceOf(kind): KindInfluence  // explicit entry or ZERO_INFLUENCE
ECO_CADENCE = 10; RADIUS = 2; rates/thresholds as named consts
```
Entries (data, signs are the contract): boosts — Parklet, CommunityGarden
(strongest soil), CompostHub (soil), QuietStreet/Promenade/BikePath (mild,
non-fragmenting); suppressors — RoadHighway (strong + fragmenting),
RoadStreet/RoadAvenue (mild + fragmenting), ParkingLot, Industrial;
neutral-by-default everything else (explicit ZERO).
**Tests (RED):** totality — every BuiltKind resolves (sweep the table
union); sign contract per named kind (boost kinds strictly positive on
their axis, suppressors strictly negative, QuietStreet/Promenade/BikePath
`fragmenting === false` while RoadStreet/Avenue/Highway `=== true` — the
road-diet payoff pinned AS DATA); guard scans src/ecology (probe).
**Validation:** `npx vitest run`

### Task 3: Ecology tick
**Files:** `src/ecology/tick.ts`, `tests/ecology/tick.test.ts`
**Approach:** `ecologyTick(map)` — one composite step, fixed row-major
double-buffered passes (read prev, write next — no in-pass feedback):
1. *Influence field*: accumulate per-tile soil/flora/fauna deltas from
   built kinds within RADIUS (bounded local scan, no global flood).
2. *Soil*: clamp(soil + baseRecovery(+1 every N steps via tick parity is
   NOT available — keep a per-call constant) + influenceDelta); pavement
   tiles (built transport or parcel) cap soil at PAVED_CAP.
3. *Flora*: grows where soil ≥ threshold (+spread: a tile with flora <
   SPREAD_MIN gains if ≥2 4-neighbors have flora ≥ SPREAD_SRC), decays
   under suppression; water tiles stay 0.
4. *Fauna*: habitat score = flora + water-adjacency bonus; fauna moves
   toward habitat via local diffusion (next = avg of self + best
   neighbor, integer), but diffusion across a FRAGMENTING tile is
   blocked (the table's flag — quiet streets let fauna cross).
   All integer math; no rng (ecology is fully deterministic from state —
   no stochasticity in v1; dithering aesthetics belong to rendering).
**Tests (RED):** determinism (same map → identical layers after N ticks,
two runs); directional fixtures — flora spreads onto adjacent
healthy-soil, not onto suppressed; soil rises faster beside CommunityGarden
than baseline, falls under fresh pavement toward PAVED_CAP; fauna crosses
a QuietStreet bridge between two habitat patches but NOT a RoadHighway
(both directions of the payoff asserted on mirrored fixtures); bounds
0-255 maintained (no wraparound — clamped); double-buffering proven (a
crafted fixture where in-pass feedback would differ).
**Validation:** `npx vitest run`

### Task 4: Worldgen seeding stage + chronicle line
**Files:** `src/worldgen/ecoseed.ts`, `tests/worldgen/ecoseed.test.ts`
**Approach:** `ecoSeedStage(): WorldgenStage` (name `eco-seed`, forked
streams `soil`/`fauna` if needed — prefer deterministic functions of
state, rng only for dither): soil = f(moisture, landCover) minus
corridor/industry wounds (distanceField from highways, rational falloff);
flora = f(landCover, soil); fauna = f(flora, water adjacency, distance
from core) — periphery-weighted. Chronicle: append
`era5: the land kept the bill — soil broken along the corridors, the wild
pushed to the edges` (era5-prefixed BY DESIGN so the wound appears in the
opening story; verify parser groups it and the overlay shows it — the
era-5 entry list grows by one, which the opening renders fine).
**Tests (RED):** double-run hashWorld equality (covers the new layers);
3 seeds — corridor-ring soil mean < periphery soil mean (cohorts ≥5),
fauna ring means ordered (core < periphery), flora positive on vegetated
landCover and 0 on water; the era5 chronicle line present and parsed into
era 5 (chronicle test extension); all-water seed degenerates cleanly
(layers seeded from terrain only, no throw).
**Validation:** `npx vitest run`

### Task 5: Biodiversity + ecologyReport
**Files:** `src/ecology/biodiversity.ts`, `src/ecology/report.ts`,
mirrored tests
**Approach:** habitat class per tile = small integer from (landCover
band, flora band, fauna band) → Simpson's index over an R=3 window:
`1 − Σ(count_c²)/(total²)` (integer squares, single division);
`biodiversityField(map)` (Uint8 scaled 0-255, pure function — NOT a
stored map layer; recomputed for overlay/report) and
`ecologyReport(world)`: city means (soil/flora/fauna/biodiversity),
corridor-ring vs periphery split (blight-report cohorts), nullable
degenerate paths per report.ts discipline.
**Tests (RED):** Simpson's pinned exact rationals on hand fixtures
(monoculture → 0; two equal classes → 1/2; four equal → 3/4), bounds,
determinism; report consistency on 3 seeds (ring ordering matches the
seeded wound, all values bounded, double-run equal); empty/all-water →
zeros, no NaN (exact `=== 0`).
**Validation:** `npx vitest run`

### Task 6: Overlay UI + wiring
**Files:** `src/ui/ecoOverlayContent.ts`, `tests/ui/ecoOverlayContent.test.ts`,
`src/ui/renderer.ts`, `src/main.ts`, `index.html`,
`tests/architecture.test.ts` (allowlist)
**Approach:** pure content: `OVERLAY_VIEWS = ['soil','flora','fauna',
'biodiversity']`, `cycleOverlay(current)` (off→soil→…→off),
`shouldCycleOverlay(key, openingActive)`, `overlayTint(view, value) →
[r,g,b,a]` (pinned ramps: soil browns→greens, flora greens, fauna warm,
biodiversity violet→gold), `legendLine(view)`. Renderer:
`setOverlay(source | null)` generalizing the preview tint pass (overlay
under preview). main.ts: `E` via the pure gate; ecology cadence in the
tick callback (`tick % ECO_CADENCE`), canvas dirty when overlay active;
legend line in the dock status area (shares the inspect line's slot —
legend when overlay on, inspect readout on inspect click; document the
precedence: latest action wins).
**Tests (RED):** cycle sequence incl. off-wrap; gate truth table; tint
ramps pinned at 0/128/255 per view; legend strings; allowlist green.
Shell untested (lead's live pass).
**Validation:** `npx vitest run`; `npm run build`

### Task 7: Docs
**Files:** `README.md`
**Approach:** Ecology section: the three layers + biodiversity, the
road-diet ecological payoff, the overlay key, determinism note, and the
explicit "rates are placeholder ecology" disclosure.
**Validation:** suite green.

## 4. Validation Gates

```bash
npx tsc --noEmit && npx vitest run && npm run build
npm run dev   # lead: wound visible in soil view; E cycling; garden heals
              # over ticks; quiet-street bridges fauna; ?seed= determinism
```

## 5. Rollback Plan

Additive: new layers (zero-cost when unticked), new dirs, one pipeline
stage, overlay pass. Revert = don't merge. No fabric/tech semantics
touched (fabric is read-only to ecology — enforced by review).

## 6. Uncertainty Log

- **Rates/thresholds/caps are placeholder ecology** (like effort costs);
  the tested contract is directional invariants + determinism, never
  balance. A tuning feature follows once the civic sim consumes this.
- **No rng in the tick** (v1 is fully deterministic dynamics): if visual
  monotony emerges, dithering belongs in the overlay tint, not the sim.
- **The era5 chronicle-line choice** (wound in the opening story) is a
  design call the plan review should sanity-check — the alternative
  (`eco:` prefix, silently skipped by the parser) hides the wound from
  the player's first read.
- **biodiversityField recomputed, not stored** — avoids a derived-state
  layer drifting from its source; if the per-overlay-frame cost bites,
  cache behind the ecology tick (invalidate on tick), measure first.
- **Legend/inspect dock-slot sharing** is a small UX bet; the live pass
  judges it.
