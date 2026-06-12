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
blight report, and an `E`-cycled heatmap overlay. Ecology reads fabric
(built kinds) — never tech state; it writes only its own layers.

## 2. Codebase Analysis

(Verified at branch HEAD, post-PR #6 merge `02f1d0b`.)

- **Layer + snapshot pattern** — src/engine/map.ts: six layers :40-50,
  constructor allocations :59-64, `snapshot()` FNV fold :123-132 (and it
  feeds `hashWorld`, fabric.ts:246-255, so the new layers reach the
  canonical determinism hash too).
  Three Uint8Array additions follow `landCover`'s pattern exactly; fold
  order appended after `parcel` (no pinned absolute hashes exist — every
  existing double-run determinism test then covers ecology for free).
- **Tick hook** — src/main.ts:30 `SIM_TICK_MS = 100`; the tick callback
  (loop wiring at main.ts:187) currently accrues effort + marks panelDirty.
  Ecology cadence: `if (tick > 0 && tick % ECO_CADENCE === 0)
  ecologyTick(world.map)` — `ecologyTick(map)` needs only the map (it reads
  built/parcel/water and read-writes the three ecology layers; no
  ParcelStore, no `tick` — recovery is a per-call constant); the tick index
  is already the loop's argument
  (engine/loop.ts:21,61 `onTick(tick)`), but the loop fires `tick`
  PRE-increment so the FIRST tick is 0 (loop.ts:61-62); the `tick > 0`
  guard makes the first ecology step land at tick = ECO_CADENCE (not at
  tick 0), so the freshly-seeded state is the player's t0 and dynamics
  begin one cadence interval later (plan review MINOR-a — phase pinned).
  Mark canvas `dirty` when the overlay is active (ecology changed → tint
  refresh) — NOT when inactive (no visual delta; avoids re-render churn).
- **Pipeline integration** — src/main.ts:38 `runPipeline({seed},
  [terrainStage(), mosesCenturyStage()])` gains `ecoSeedStage()` third;
  stage contract + fork-by-name per src/worldgen/pipeline.ts. The stage
  appends a chronicle line — PRD AC2 (lead-updated) now requires BOTH a
  chronicle line that RECORDS the wound AND a player-facing surface in the
  opening; the chronicle line is the RECORD half (the display half is the
  `ecologyStatLine`, below). Ground truth on surfacing (corrects an
  earlier false premise, plan
  review P1): the opening renders exactly ONE headline per era —
  `eraHeadline(entry) = `${entry.years}: ${entry.events[0]}``
  (openingContent.ts:58-61), mapped at main.ts:76; later events and the
  challenge (`firstEvent` = era-1 events[0], openingContent.ts:64-69) never
  show. moses-century runs FIRST and already owns era5.events[0]
  (`era5: disinvestment — …`, moses.ts:1023), so anything eco-seed appends
  lands at era5.events[1+] and is NOT shown — true for BOTH an `eco:`
  prefix (dropped entirely by the parser, chronicle.ts:61) AND an `era5:`
  prefix (grouped into era 5 but past events[0]). The wound is therefore
  NOT in the player's first read via the chronicle headline under either
  prefix. Per LEAD RULING the wound MUST reach the player's opening read —
  so it surfaces through the report-driven path: `ecologyReport` →
  `ecologyStatLine` appended to the opening's stat lines (Task 5/6), the
  same mechanism every other opening stat already uses (statLines is
  report-sourced, openingContent.ts:28-51). The `era5:` chronicle line is
  retained as the durable RECORD, not the display path. Prefix chosen on
  honest merits: `era5:` — the present-day wound's semantic home (era 5 =
  1985-2000), structurally retrievable via parseChronicle, and collision-
  free with report.ts (ERA5_RE requires "disinvestment" and firstMatch
  hits the moses line first, report.ts:65/77).
- **Influence sources** — src/engine/fabric.ts: `BuiltKind` table (transit
  5-9, buildings 16-23 + 48-60), `transportCategory` (road category 1 =
  fragmenting iff kind ∈ {1,2,3}; QuietStreet(7) is category 1 but must
  NOT fragment — the table keys on KIND, not category, precisely to
  express the road-diet payoff), `aliveIndices`/scalar accessors for
  parcel kinds, `distanceField` (src/worldgen/fields.ts — passable BFS
  for the ring breakdown, same cohorts as the blight report d≤8 / d≥16).
- **Report sibling** — src/worldgen/report.ts `buildReport` patterns
  (chronicle-sourced nullables, cohort guards ≥5 → null, divide-guarded
  degenerate paths that yield exact 0s never NaN, report.ts:115-133 &
  149-173) — `ecologyReport` mirrors its discipline.
- **Overlay machinery** — src/ui/renderer.ts `setPreview`'s translucent
  fill pass (renderer.ts:451-457) is the MECHANISM to reuse, but the
  overlay tints EVERY visible tile, so it hooks the visible-range loop
  (renderer.ts:424-447, where the tile index `i` is in hand) as a second
  translucent pass UNDER the preview: `setOverlay(source: {tint(i): rgba}
  | null)`. For soil/flora/fauna the source closure reads the LIVE layer
  (`map.soilHealth[i]` …) so it auto-reflects each ecology tick; the
  DERIVED biodiversity source is a precomputed Uint8 field that must be
  recomputed + re-pushed on each ecology tick while active (plan review
  MINOR-b — see Task 6). Pure tint mapping lives in
  `src/ui/ecoOverlayContent.ts` (allowlisted): value→color ramps per view,
  pinned in tests.
- **Key routing** — `E` follows the `T` pattern, ground-truthed (plan
  review factual #1; the earlier "T is bound in main.ts" was WRONG): `T` is
  SELF-bound inside `mountTechPanel` via its own `window.keydown` routed
  through the pure `shouldTogglePanel(key, overlayActive)` gate
  (techPanel.ts:115-122; gate at techContent.ts:100-102). input.ts's
  keydown handles arrows + i/x/Escape hotkeys (input.ts:118-147), NOT `E`,
  and main.ts binds NO keys. So `E` mirrors the techPanel SELF-binding
  pattern: a pure `shouldCycleOverlay(key, openingActive)` gate in
  ecoOverlayContent.ts (allowlisted; opening-overlay suppression exactly
  like shouldTogglePanel) + its OWN `window.keydown` in the overlay shell —
  NOT a main.ts binding.
- **Guard** — tests/architecture.test.ts scanned dirs gain `src/ecology`
  (fail-closed, via the tech/tools probe pattern at architecture.test.ts:
  96-139); PURE_UI_ALLOWLIST (architecture.test.ts:64-69) gains the FULL
  path `src/ui/ecoOverlayContent.ts`. Simpson's index is a SEPARATE pure
  function returning an EXACT rational (Task 5), `1 − Σ(count²)/(total²)`
  with integer squares (`n*n`, no `Math.pow`) and no log — FORBIDDEN_MATH
  (architecture.test.ts:31) bans pow/log/exp/sin/cos/tan/random but permits
  floor/min/max/sqrt/imul, so the integer formulation + one division
  passes once src/ecology is scanned.
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
**Approach:** `ecologyTick(map)` — one composite step. STRICT double
buffering (plan review P3c): every sub-step reads the PREV snapshot (the
live layers as they are at tick entry) and writes into persistent scratch
`next` buffers; the scratch is copied back into the layers (TypedArray
`.set`) only AFTER all sub-steps finish — no sub-step reads another's
freshly-written value. Scratch is a module-level, lazily-sized
`EcologyScratch {soil,flora,fauna: Uint8Array}` reused across ticks (plan
review P3d — NO per-tick allocation; GameMap layer fields are `readonly`
so we copy back via `.set`, not swap references). Consequence (pinned):
soil→flora→fauna couple with a 1-tick lag — a healed garden raises soil at
tick T, flora responds at T+1, fauna at T+2; fixtures count ticks
accordingly. The per-tile influence field is derived from read-only fabric
(stable within a tick).
1. *Influence field*: scatter each built tile's `influenceOf(kind)` over
   its RADIUS=2 box (≤5×5 per built tile — bounded local scan, no global
   flood; ≤ builtTiles×25 accumulate ops).
2. *Soil*: `next.soil = clamp(prev.soil + BASE_RECOVERY + influence.soil,
   0, 255)`; pavement tiles (transport built OR parcel-covered) cap at
   PAVED_CAP.
3. *Flora* (reads PREV soil/flora): grows where `prev.soil ≥ SOIL_THRESH`
   (+spread: a tile with `prev.flora < SPREAD_MIN` gains if ≥2 of its
   4-neighbors have `prev.flora ≥ SPREAD_SRC`), decays under net-negative
   influence; water tiles stay 0.
4. *Fauna* (plan review P3a/P3b — habitat GATES the update, "best
   neighbor" ranks on prev FAUNA): a tile is fauna-IMPASSABLE iff its
   kind's influence `fragmenting === true` (busy roads) — its fauna is
   pinned 0 and no diffusion edge crosses it. Water tiles are also habitat
   0 (open water is not habitat in v1); for a passable LAND tile i:
   - `habitat(i) = min(255, prev.flora(i) + WATER_ADJ_BONUS·waterAdj4(i)
     + CORRIDOR_FLOOR·isNonFragmentingTransit(i))` — the carrying-capacity
     CAP. WATER_ADJ_BONUS rewards LAND tiles on the riparian edge (a land
     tile with a water 4-neighbor), not the water itself; CORRIDOR_FLOOR
     lets a quiet-street/promenade/bike tile relay transiting fauna so the
     road-diet bridge actually works.
   - `bestNbr = max prev.fauna(n)` over 4-neighbors n whose edge i–n is
     passable (n not impassable), else 0.
   - `target(i) = min(habitat(i), max(prev.fauna(i), bestNbr − SPREAD_LOSS))`
     — habitat CAPS growth (this is what stops the saturation-flood the
     prior "avg of self + best neighbor" had); colonization pulls toward a
     richer passable neighbor.
   - `next.fauna(i) = prev.fauna(i) + clampMag(target − prev.fauna(i),
     FAUNA_RATE)` (ease toward target by ≤ FAUNA_RATE/tick, clamped 0-255).
   A RoadHighway line is impassable on both endpoints → patches isolated; a
   QuietStreet line is passable with CORRIDOR_FLOOR → fauna relays across
   it over ticks. All integer math; no rng (ecology is deterministic from
   state in v1; dithering aesthetics belong to rendering).
**Tests (RED):** determinism (same map → identical layers after N ticks,
two runs); directional fixtures — flora spreads onto adjacent
healthy-soil, not onto suppressed; soil rises faster beside CommunityGarden
than baseline, falls under fresh pavement toward PAVED_CAP; fauna grows
toward habitat but does NOT saturate beyond `habitat` (a low-flora tile
between two rich patches stays bounded by its own habitat — the
anti-flood pin); fauna crosses a QuietStreet bridge between two habitat
patches but NOT a RoadHighway (both directions on mirrored fixtures, with
the tick-count reflecting the relay); bounds 0-255 maintained (no
wraparound — clamped); STRICT double-buffering proven on a fixture where
pipelining (flora reading the just-written soil, or fauna reading a
neighbor's just-written fauna) would yield a DIFFERENT result than
prev-read — the test asserts the prev-read (1-tick-lag) outcome, exercising
the INTER-step dependency, not just one layer's buffer.
LAYER ISOLATION (plan review P2): capture the six non-ecology map layers
(elevation/water/moisture/landCover/built/parcel) + `parcels.snapshotBytes()`
before/after `ecologyTick`; assert byte-identical (ecology writes ONLY
soil/flora/fauna). PRD criterion 7 (the INTEGRATION test, which naturally
holds a TechState): place a CommunityGarden through the TOOLS layer
(`applyTool`, which spends communal effort from TechState), then run the
ecology ticks — assert the fabric bytes are unchanged BY THE TICKS
(placement wrote them; the tick only moves ecology — no instant
teleporting) while soil/flora move, AND assert `tech.snapshotBytes()`
(state.ts:102-116) is byte-identical across the ecology ticks (captured
AFTER the placement spend). This seam is exactly where a future civic-sim
ecology→wellbeing coupling would tempt threading tech into the tick, so the
tech byte-guard lives HERE (lead ruling); the pure `ecologyTick(map)` /
`ecoSeedStage(world)` unit tests deliberately OMIT a tech assertion because
neither entry point can reach TechState by construction (§5) — asserting it
there would be a vacuous test.
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
pushed to the edges` — the RECORD half of PRD AC2 (the display half is the
`ecologyStatLine`, Task 5/6). NOTE (corrected per plan
review P1): this does NOT appear in the opening — moses owns era5.events[0]
(the disinvestment headline) and `eraHeadline` shows only events[0], so the
wound lands at era5.events[1], parsed-but-unshown. `era5:` is chosen for
structured retrievability + collision-freedom (see §2), not opening
visibility — the player-facing surfacing is the report-driven
`ecologyStatLine` (Task 5/6), per LEAD RULING; this chronicle line is the
durable record only.
**Tests (RED):** double-run hashWorld equality (covers the new layers);
3 seeds — corridor-ring soil mean < periphery soil mean (TILE ring means
binned by highway distance, d≤8 vs d≥16), fauna ring means ordered
(core < periphery), flora positive on vegetated landCover and 0 on water; the era5 wound line is RECORDED (present in
world.log) AND grouped into era 5 by parseChronicle, while
`eraHeadline(era 5)` stays UNCHANGED — still the moses disinvestment line,
i.e. the wound is intentionally NOT the headline (pins the honest contract
and guards against a future "make it visible" regression); all-water seed
degenerates cleanly (layers seeded from terrain only, no throw). LAYER
ISOLATION (plan review P2): build the world through `[terrainStage,
mosesCenturyStage]`, capture the six non-ecology map layers +
`parcels.snapshotBytes()`, apply `ecoSeedStage`, assert those non-ecology
surfaces are byte-identical (eco-seed writes ONLY the three ecology layers
and appends the chronicle line to world.log) while the ecology layers DID
change.
**Validation:** `npx vitest run`

### Task 5: Biodiversity + ecologyReport
**Files:** `src/ecology/biodiversity.ts`, `src/ecology/report.ts`,
mirrored tests
**Approach:** habitat class per tile = small integer from (landCover
band, flora band, fauna band). TWO distinct exports (plan review P4 — a
Uint8 field cannot carry 1/2, so the exact index is SEPARATE from the
scaled field):
- `simpsonIndex(counts: readonly number[]): { num: number; den: number }`
  — the PURE index as an EXACT rational `{num: total² − Σcount², den:
  total²}` (integer squares via `n*n`; no division, no transcendentals).
  `index = num/den ∈ [0,1)`. total = Σcounts; if total = 0 return
  `{num:0, den:1}` (= 0), but a real window always includes its center so
  total ≥ 1 and `den ≥ 1` (never 0/0).
- `biodiversityField(map): Uint8Array` — per tile, the habitat-class
  counts over the CLAMPED R=3 window (a (2·3+1)² = 7×7 box; fewer tiles at
  map edges; center always counted so total ≥ 1), then
  `Math.floor((255 * num) / den)` (one integer division; FLOOR pinned, for
  consistency with clampByte/bandOf, fabric.ts:103 / renderer.ts:366). NOT
  a stored map layer — recomputed for overlay/report (Task 6 refresh path).
`ecologyReport(world)`: city means (soil/flora/fauna/biodiversity), and a
corridor-ring vs periphery split over TILES binned by the highway
`distanceField` (same thresholds as the blight report — d≤8 core / d≥16
periphery — but TILE means, not parcel cohorts, since ecology lives on tile
layers), divide-guarded so an empty ring (no highway → no ring tiles)
yields null, never NaN. It ALSO exposes, as nullable scalars, the figures
the player-facing `ecologyStatLine` cites — the corridor-ring soil mean (or
its deficit vs periphery) and the periphery fauna mean — null on the
degenerate (no-highway / all-water) path.
**Tests (RED):**
- `simpsonIndex` pinned EXACT on hand-built count arrays by
  CROSS-MULTIPLICATION (no float compare): `[k] → 0/1`; `[2,2] → 8/16`
  (= 1/2); `[1,1,1,1] → 12/16` (= 3/4); `[1,1,1] → 6/9` (= 2/3 — the
  non-dyadic case a float couldn't represent exactly); bounds
  `0 ≤ num < den`. These are hand fixtures on the pure function — a
  49-tile window can't split into two equal classes, which is exactly why
  the function is separate from the field (P4).
- `biodiversityField`: monoculture window → 0; the index→Uint8 floor
  convention pinned at a known hand fixture; bounds 0-255; determinism;
  edge-clamped windows well-defined (total ≥ 1, no 0/0).
- `ecologyReport`: consistency on 3 seeds (ring ordering matches the
  seeded wound, all values bounded, double-run equal); empty/all-water →
  zeros/nulls, no NaN (divide-guarded; `den` never 0).
**Validation:** `npx vitest run`

### Task 6: Overlay UI + opening stat line + wiring
**Files:** `src/ui/ecoOverlayContent.ts`, `tests/ui/ecoOverlayContent.test.ts`,
`src/ui/openingContent.ts`, `tests/ui/openingContent.test.ts`,
`src/ui/renderer.ts`, `src/main.ts`, `index.html`,
`tests/architecture.test.ts` (allowlist)
**Approach:** pure content in ecoOverlayContent.ts: `OVERLAY_VIEWS =
['soil','flora','fauna','biodiversity']`, `cycleOverlay(current)`
(off→soil→…→off), `shouldCycleOverlay(key, openingActive)` (mirrors
shouldTogglePanel: `(key==='e'||key==='E') && !openingActive`),
`overlayTint(view, value) → [r,g,b,a]` (pinned ramps: soil browns→greens,
flora greens, fauna warm, biodiversity violet→gold), `legendLine(view)`.
Opening stat line (PRD AC2, lead-updated): `ecologyStatLine(report:
EcologyReport): string | null` in openingContent.ts (pure, allowlisted;
type-only import of the ecology report type) — ≤90 chars, embeds a real
number + the corridor/periphery fact (soil-thin-along-corridors /
wild-at-the-edges register); returns null on the degenerate path (the
ecology ring scalars are null → all-water / no-highway), so the line is
OMITTED rather than shown as a fallback, keeping the opening's line count
legible (mirrors statLines' omit-when-null optional lines,
openingContent.ts:44-49). Exact copy chosen at implementation. Renderer:
`setOverlay(source | null)` — a translucent tint pass over the
visible-tile range UNDER the preview (renderer.ts:424-457). main.ts: push
the non-null `ecologyStatLine(ecologyReport(world))` onto the opening
`content.stats` where the report is built post-pipeline (main.ts:73-79);
bind `E` via its OWN `window.keydown` routed through the pure
`shouldCycleOverlay` gate (the techPanel SELF-binding pattern, §2 Key
routing — NOT a pre-existing main.ts binding); run the ecology cadence in
the tick callback (`tick > 0 && tick % ECO_CADENCE`); mark canvas dirty
when overlay active, and — for the biodiversity view ONLY — recompute the
biodiversity field and re-`setOverlay` on each ecology tick (plan review
MINOR-b: soil/flora/fauna closures read live layers, no recompute needed);
legend line in the dock status area (shares the inspect line's slot —
legend when overlay on, inspect readout on inspect click; precedence:
latest action wins).
**Tests (RED):** cycle sequence incl. off-wrap; `shouldCycleOverlay` truth
table (incl. openingActive suppression); tint ramps pinned at INPUT values
0/128/255 per view (the Uint8 domain — decoupled from Task 5's index→Uint8
mapping); legend strings; `ecologyStatLine` embeds the report number +
fact and stays ≤90 chars on a normal report, AND returns null (line
omitted, count stays legible) on a degenerate (all-water / no-highway)
report — mirrors statLines' omit-when-null tests (openingContent.test.ts);
allowlist green (ecoOverlayContent.ts scanned
DOM/transcendental-free). Shell + live key/canvas wiring untested (lead's
live pass).
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
npm run dev   # lead: wound named in the opening stat line + visible in
              # soil view; E cycling; garden heals over ticks; quiet-street
              # bridges fauna; biodiversity overlay refreshes; ?seed= determinism
```

## 5. Rollback Plan

Additive: new layers (zero-cost when unticked), new dirs, one pipeline
stage, overlay pass. Revert = don't merge. No fabric/tech semantics
touched (fabric is read-only to ecology — enforced by an AUTOMATED
layer-isolation test in Tasks 3 & 4, not review alone: the six non-ecology
map layers + `parcels.snapshotBytes()` are asserted byte-identical across
`ecologyTick` and `ecoSeedStage`; plan review P2). TechState sits OUTSIDE
the asserted byte-set because it is unreachable by construction from both
ecology entry points — `ecologyTick(map)` receives only the map, and
`ecoSeedStage` gets a WorldState with no `tech` field (pipeline.ts:14-25)
— so neither can mutate it; a `tech` byte-assertion in those PURE unit
tests would only restate what the signatures already guarantee. Per lead
ruling the tech byte-guard instead lives at the AC7 INTEGRATION seam
(Task 3), where placing via the tools layer naturally holds a TechState:
`tech.snapshotBytes()` is asserted byte-identical across the ecology ticks
(after the placement spend) — failing loudly if a future civic-sim feature
threads tech into the tick, without making today's unit tests
signature-dishonest (plan review round-2 MINOR, resolved).

## 6. Uncertainty Log

- **Rates/thresholds/caps are placeholder ecology** (like effort costs);
  the tested contract is directional invariants + determinism, never
  balance. A tuning feature follows once the civic sim consumes this.
- **No rng in the tick** (v1 is fully deterministic dynamics): if visual
  monotony emerges, dithering belongs in the overlay tint, not the sim.
- **The era5 chronicle line is the durable RECORD; the player-facing
  surface is `ecologyStatLine`** (LEAD RULING; plan review P1). Ground
  truth: the opening shows one headline per era (events[0]) and moses owns
  era5.events[0], so a chronicle line at era5.events[1] is invisible in the
  opening — the earlier "appears in the opening story" rationale was false
  and removed. The wound reaches the player via the report-driven path
  (`ecologyReport` → `ecologyStatLine` in the opening stats, Task 5/6),
  matching how every other opening stat is sourced; the `era5:` line is
  kept for structured retrievability + collision-freedom (§2).
- **biodiversityField recomputed, not stored** — avoids a derived-state
  layer drifting from its source. To stay correct in the overlay it is
  recomputed + re-pushed on each ecology tick while the biodiversity view
  is active (plan review MINOR-b; Task 6); soil/flora/fauna views read the
  live layer and need no recompute. If the per-tick recompute cost bites,
  cache behind the ecology tick (invalidate on tick); measure first.
- **Legend/inspect dock-slot sharing** is a small UX bet; the live pass
  judges it.
