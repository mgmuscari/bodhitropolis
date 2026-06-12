# PRP: Civic Sim

## Source PRD: docs/PRDs/civic-sim.md
## Date: 2026-06-12

## 1. Context Summary

The final pillar: deterministic neighborhoods (parcel clusters split by
fragmenting roads — the Moses geometry made civic), per-neighborhood
belonging/voice/trust dynamics on a 50-tick cadence, the tech tree's
participatory capabilities finally consumed, the effort placeholder
replaced by a real three-system wellbeing composition, a civicReport +
dock pulse line, and a C-key overlay mutually exclusive with E. Civic
writes only CivicState; one sanctioned tools→civic repair-action hook.

## 2. Codebase Analysis

(Verified at branch HEAD, post-PR #7 merge `ff570b9`.)

- **The placeholder to retire** — src/tech/effort.ts:3-7 PLACEHOLDER
  banner; `effortPerTick(world)` :34-41 (`max(1, floor(alive/8 +
  conditionMean/32))`, zero-parcel guard :39 load-bearing); `accrue` :49.
  Tests in tests/tech/effort.test.ts pin: zero-parcel → exactly 1,
  integer-ness, non-decreasing + boundary-strict monotonicity, banner
  presence (a string assertion — REQUIRED rewrite: it flips to asserting
  the banner's ABSENCE + the new composition contract).
- **Capabilities to consume** — src/tech/state.ts:88-93 `hasCapability`
  scans unlocked grants. Relevant caps (tree.ts): `circles`,
  `participatory-budgeting`, `gift-circles` (+ `mutual-aid`,
  `craft-fairs` available as minor modifiers if the PRP's table wants
  them — keep the consumed set to the three named, data-driven).
- **Fragmentation semantics to reuse** — src/ecology/influence.ts
  `fragmenting` flag keyed on KIND (busy roads true; QuietStreet/
  Promenade/BikePath/rail-family false). Neighborhood adjacency uses the
  same predicate — import from ecology (civic→ecology import is a NEW
  edge: guard currently only bans engine→worldgen and ui-imports;
  verify and, if clean, document the sanctioned dependency direction
  civic → {ecology(`influenceOf` + the two report builders), engine,
  tech(`accrue`)} in the guard's comment (NO worldgen edge — civic
  flood-fills the engine `GameMap`, never worldgen fields) — or lift
  `fragmenting` into the table consumed via a
  re-export. PRP decision: import `influenceOf(kind).fragmenting`
  directly; no cycle (ecology never imports civic — asserted by guard
  extension).
- **Reports pattern** — src/ecology/report.ts (EcologyReport :21-35,
  reportable-world structural typing :37-44, tile-ring discipline,
  never-NaN) and src/worldgen/report.ts (nullable cohorts). civicReport
  mirrors; `EcologyReport` is also an INPUT to wellbeing (effort
  composition consumes its citywide means — structural typing keeps
  tech/effort.ts from importing ecology: pass the numbers, not the
  module; see Task 5).
- **Overlay machinery to mirror** — src/ui/ecoOverlayContent.ts
  (:8-15 views/state/alpha, :21 cycleOverlay, :32 shouldCycleOverlay,
  :57 overlayTint, :71 legendLine); renderer.setOverlay per-tile
  null-skip (post-0294178); E self-binding in main.ts wiring. C mirrors
  with views ['belonging','voice','trust']; **mutual exclusivity is new
  shared state** — a single `activeOverlay: {kind: 'eco'|'civic', state}
  | null` in the composition root (main.ts), with the pure exclusivity
  rule in a shared helper (extend ecoOverlayContent or a tiny
  src/ui/overlayMutex.ts — PRP picks: extend cycle logic to take and
  return the composite; tests pin E-then-C clears E and vice versa).
- **Tools hook (the sanctioned crossing)** — src/tools/tools.ts
  applyTool returns ONLY `{ok, reason?, info?}` (`ApplyResult`,
  tools.ts:68-73, every return path) — it carries NEITHER kind NOR
  position. So the repair hook is NOT driven by applyTool's return.
  Instead main.ts (the composition root) forwards from its OWN `applyAt`
  scope (main.ts:196-213), where it already holds the applied `def`
  (→ `def.kind`/`def.id`) and the target `(tx, ty)`: on
  `result.ok && isRepairTool(def)` it resolves the tile's neighborhood
  from the LIVE partition it holds —
  `partition.tileToNeighborhood[map.idx(tx, ty)]` (the anchor tile for
  footprints, deterministic — a multi-tile build straddling two
  neighborhoods credits ONLY its anchor's neighborhood by design; no
  multi-neighborhood credit) — and calls
  `civic.recordRepair(neighborhoodId, tick)`. No tools→civic import and
  NO applyTool change (the existing `{ok}` success signal + main.ts's own
  args suffice — the minimal sanctioned crossing). REPAIR set = boost-kind
  builds + all conversions ONLY, both fully classifiable from `def` alone.
  Bulldoze is EXCLUDED: applyTool returns `{ok}` for it and the tile is
  already mutated to empty, so the demolished kind is unrecoverable
  downstream — there is no "bulldoze-of-blight" in v1. A repair on a tile
  with no neighborhood (`tileToNeighborhood = 0`, e.g. a road diet far
  from any parcel) resolves to id 0 and is a safe no-op: trust rises only
  where there is a community to hold it. The live partition main.ts
  resolves against is the one in the sim deps (Task 5), refreshed on the
  civic cadence; ring entries written against the current ids are carried
  through re-anchoring by Task 2's remap.
- **Cadences** — main.ts tick callback: effort every tick, ecology at
  `tick > 0 && tick % 10`, civic at `tick > 0 && tick % CIVIC_CADENCE
  (50)`; fixed order effort→ecology→civic within a tick (document +
  test the composite determinism via N-tick double-run at the
  main-wiring level — a pure `compositeTick(world, tech, civic, tick)`
  helper in src/civic/ or a tiny src/sim/ orchestrator makes this
  headless-testable; PRP picks `src/civic/compose.ts` exporting
  `simTick(...)` consumed by main.ts).
- **Snapshot discipline** — CivicState.snapshotBytes mirrors
  ParcelStore/TechState (fixed-width LE records: neighborhood id,
  anchor, belonging, voice, trust + ring-buffer entries); hashWorld
  stays {map, parcels} — civic determinism asserted via its OWN
  snapshot in tests (matching the TechState precedent, not folded into
  hashWorld).
- **Guard** — add `src/civic` to scanned dirs (fail-closed); allowlist
  gains `civicOverlayContent.ts` + pulse content; extend the guard's
  dependency assertions: ecology must not import civic; tools must not
  import civic; tech must not import civic/ecology (the wellbeing
  numbers arrive structurally). The two new matchers (`CIVIC_IMPORT`,
  `ECOLOGY_IMPORT`) each ship a self-check pair — a POSITIVE fire + a
  BENIGN-NEGATIVE — mirroring the `WORLDGEN_IMPORT` self-checks
  (architecture.test.ts:209-218), so a path-pattern bug can't pass
  vacuously GREEN (AC #6 isolation depends on the guard being real, not a
  no-op).
- **Conventions**: TDD; atomic commits; FROZEN suites untouched (no
  fabric semantics change); read-only over fabric/ecology/tech state
  (except the designed effort-composition input and the recordRepair
  intake).

**Execution mechanics:** full team pipeline; lead owns the live browser
pass + tier strip.

## 3. Implementation Plan

**Test Command:** `npx vitest run`

### Task 1: Neighborhood partition
**Files:** `src/civic/neighborhoods.ts`, `tests/civic/neighborhoods.test.ts`,
`tests/architecture.test.ts` (scan src/civic + no-reverse-import
assertions)
**Approach:** `computeNeighborhoods(map): NeighborhoodMap` —
`{tileToNeighborhood: Uint16Array (0 = none), neighborhoods:
{id, anchor, tileCount, parcelTiles}[]}`. **Membership set M
(deterministic): a tile is in M iff it is a parcel tile, OR a
NON-fragmenting tile orthogonally (4-neighbour) adjacent to ≥1 parcel
tile (the frontage halo). Fragmenting tiles
(`influenceOf(map.built[i]).fragmenting` — RoadStreet/RoadAvenue/
RoadHighway) are NEVER members: they are barriers, assigned to no
neighborhood (`tileToNeighborhood = 0`). Neighborhoods = the 4-connected
components of M.** Because connectivity runs over M, a fragmenting road
between two parcel clusters is absent from M → the clusters land in
separate components → SPLIT; a non-fragmenting connector
(QuietStreet/Promenade/BikePath/rail) inside the halo of both clusters
IS in M and 4-connects them → JOIN. A shared non-fragmenting halo tile
4-connects both clusters into ONE component, so there is NEVER a
"which neighborhood owns it" tiebreak — assignment is by connected
component, not nearest-parcel; the orthogonal halo guarantees every
halo tile is 4-connected to its seeding parcel (no orphans). **Stable
ids: components ordered and numbered by lowest member-tile index
(anchor) — recomputation on an unchanged map yields byte-identical
output (tested); after a fabric change, ids re-anchor deterministically
(carryover handled in Task 2's state mapping).**
**Tests (RED):** determinism (double-run byte-equal); fixtures (explicit
BuiltKind, NO bare "street"): two parcel clusters bridged by a
`QuietStreet` (non-fragmenting, in M) = ONE neighborhood; the SAME
clusters with a `RoadHighway` between = TWO; the SAME clusters with a
`RoadStreet` between = TWO as well (RoadStreet is fragmenting per
influence.ts:67 — every busy-road kind splits, the ecology payoff
reused); a fragmenting tile is itself unassigned
(`tileToNeighborhood = 0`, asserted); a shared QuietStreet halo tile
merges two clusters into ONE (no tiebreak); anchor-id stability; real
pipeline: ≥3 neighborhoods on 3 seeds (non-vacuous, counts logged not
pinned); empty/all-water map → zero neighborhoods, no throw; guard scans
src/civic (probe) + ecology/tools/tech do not import civic AND tech does
not import ecology (source assertions). **Each new import-direction
matcher ships a self-check pair (mirroring architecture.test.ts:209-218):
`CIVIC_IMPORT` POSITIVE-fires on `from '../civic/state'` and stays silent
on the BENIGN `from '../engine/map'`; `ECOLOGY_IMPORT` POSITIVE-fires on
`from '../ecology/report'` and stays silent on the benign import** — so a
regex/path bug cannot pass vacuously GREEN while ecology/tech actually
import civic (AC #6 isolation depends on a real guard, not a no-op).
**Validation:** `npx vitest run`; `npx tsc --noEmit`

### Task 2: CivicState store + repair intake
**Files:** `src/civic/state.ts`, `tests/civic/state.test.ts`
**Approach:** `CivicState` — per-neighborhood `{belonging, voice,
trust}` (Uint8, seeded mid-low: belonging 80, voice 40, trust 90 —
named consts), a repair ring buffer (per neighborhood, fixed 8 slots of
tick numbers, LE in snapshot). **`recordRepair(neighborhoodId: number,
tick: number)` is the pinned signature** — CivicState stays
partition-free: the `(x, y) → neighborhoodId` resolution lives in main.ts
(§2), which passes an already-resolved id. `neighborhoodId === 0` (no
neighborhood) and any out-of-range/unknown id are a safe no-op (logged,
not thrown), so a repair off every neighborhood simply records nothing.
`remap(oldPartition, newPartition)` — **state carryover, ONE rule
(tile-count-WEIGHTED, never simple-mean): for each NEW neighborhood,
bucket its tiles by the OLD id they came from
(`oldPartition.tileToNeighborhood`); let `wᵢ` = count of its tiles whose
old id is `i` (`i ≠ 0`); each value = `floor(Σ wᵢ·vᵢ / Σ wᵢ)` over old
neighborhoods `i`, `vᵢ` = old `i`'s value. FRESH tiles (old id 0) are
EXCLUDED from both numerator and denominator. A split (one parent)
reduces to the parent's exact value; a merge (multiple parents) is this
weighted mean — explicitly NOT a simple average (a 100-tile parent at
belonging 200 merged with a 4-tile parent at 50 →
`floor((100·200+4·50)/104)=194`, not 125). ZERO-PARENT (`Σ wᵢ = 0` — the
genesis case: an all-fresh cluster the player just built) SEEDS to
belonging 80 / voice 40 / trust 90, the same named consts as initial
seeding. Ring buffers: merge all contributing parents' entries, keep the
8 NEWEST by tick descending, with a deterministic tie-break on equal
ticks (source old id ascending, then slot) for byte-stability;
zero-parent → empty ring.** `snapshotBytes()` fixed-width LE.
**Tests (RED):** roundtrips; snapshot stability/divergence; remap
fixtures (split → parent's EXACT values; merge → tile-WEIGHTED mean
`floor(Σwᵢvᵢ/Σwᵢ)`, hand-checked and distinct from a simple average;
ZERO-PARENT all-fresh cluster → seed 80/40/90; MIXED parent+fresh →
fresh tiles excluded from the weight denominator; identity remap =
byte-equal); ring buffer order/caps + newest-merge tie-break determinism;
recordRepair on id 0 / out-of-range / unknown id is a safe no-op
(logged not thrown).
**Validation:** `npx vitest run`

### Task 3: Civic dynamics
**Files:** `src/civic/dynamics.ts`, `tests/civic/dynamics.test.ts`
**Approach:** `civicTick(map, eco: {soil,flora,fauna means per
neighborhood — computed here from layers}, civic: CivicState, caps:
{circles, participatoryBudgeting, giftCircles}: booleans, tick)` —
per neighborhood, integer deltas, all read-prev/write-next on the
state copy:
- *belonging*: + when (neighborhood condition mean ≥ threshold) +
  (gathering-place count > 0: Bazaar/MakerSpace/HealingCommons/
  CommunityGarden/Civic within the neighborhood) + (eco mean ≥
  threshold); − when isolated (neighborhood touches ≥ N fragmenting
  tiles on its perimeter — the Moses isolation made mechanical).
- *voice*: + only when caps unlocked (circles → +1 base;
  participatory-budgeting → +2; gift-circles → +1); LOCKED → exactly
  flat (asserted). Scaled by belonging band (a community speaks when it
  feels held — integer band multiplier).
- *trust*: + when the ring buffer holds repairs within RECENT_WINDOW
  ticks; − slow decay otherwise; FLOOR at TRUST_FLOOR (40) — never
  below (the PRD's design call pinned).
Caps consume `hasCapability` OUTSIDE (passed as booleans — dynamics
stays tech-import-free).
**Tests (RED):** each dynamic directional on fixtures (gathering place
→ belonging up; isolation → down; locked caps → voice byte-flat across
N ticks, unlocked → strictly up across a quantization step; repair →
trust up, absence → decay to exactly TRUST_FLOOR, never below);
bounds; determinism double-run; isolation byte-tests (map layers all 9,
parcels, and — at this pure level — caps booleans obviously can't write
tech; the integration-seam tech guard lands in Task 5's composite test
per the established pattern).
**Validation:** `npx vitest run`

### Task 4: civicReport + wellbeing composition (effort.ts)
**Files:** `src/civic/report.ts`, `src/tech/effort.ts`,
`tests/civic/report.test.ts`, `tests/tech/effort.test.ts`
**Approach:** `civicReport(civic, partition)` — per-neighborhood rows +
citywide means {belonging, voice, trust}, degenerate-safe (no
neighborhoods → zeros/nulls per report discipline).
`effortPerTick(world: EffortWorld)` REPLACED:
```ts
// world gains OPTIONAL structural fields: ecoMeans?: {soil, flora,
// fauna}, civicMeans?: {belonging, voice, trust} — supplied from
// deps.ecoMeans / deps.civicMeans, which simTick RECOMPUTES and caches
// after each ecology/civic tick (Task 5 OWNS the recompute, not main.ts).
// ABSENT/null until the first recompute → contribute 0 (pre-civic
// saves/tests stay valid; degenerates pinned). The means are FLOATS
// (EcologyReport divides without flooring, report.ts:89-92; civicReport
// likewise) — ecoMean/civicMean FLOOR those float inputs, and the SINGLE
// outer floor below keeps wellbeing integer.
//
// ONE outer floor over the summed terms — NOT a sum of per-term floors.
// This is exactly what makes the absent-input path byte-identical to the
// legacy formula: floor(a+b+0+0) == floor(a+b).
wellbeing = floor(alive/8 + conditionMean/32 + ecoMean/48 + civicMean/24)
effort = max(1, wellbeing)   // ecoMean = floor((soil+flora+fauna)/3),
                             // civicMean = floor((belonging+voice+trust)/3)
```
Also export `wellbeing(world: EffortWorld): number` (the pre-max
composite integer) with `effortPerTick = max(1, wellbeing(world))`, so
the pulse line (Task 6) displays the SAME wellbeing scalar the economy
uses, without recomputing it. PLACEHOLDER banner REMOVED; doc comment
states the composition + that weights are tuning data. The
banner-presence test flips to banner-ABSENCE + composition contract.
**Tests (RED):** effort — non-decreasing per input class + one
strict-across-step case EACH (condition spans a `/32` step; ECO spans
≥144 raw mean-units = 48·3 so the floored ecoMean reliably crosses a
`/48` bucket; CIVIC spans ≥72 = 24·3 to cross a `/24` bucket); absent
optional inputs → EXACT legacy-formula values (single outer floor over
the summed terms, so absent eco/civic add literal 0 —
backwards-compatible degenerate); float means floored inside
ecoMean/civicMean; zero-parcel still exactly 1; integer-only.
civicReport — determinism, bounds, no-neighborhood degenerates, citywide
means hand-checked on a fixture.
**Validation:** `npx vitest run`

### Task 5: Composite sim orchestrator
**Files:** `src/civic/compose.ts`, `tests/civic/compose.test.ts`
**Approach:** `simTick(deps, tick)` — pure orchestration, fixed order
effort→ecology→civic: (1) effort accrues EVERY tick, consuming the means
CACHED in `deps` from the PRIOR recompute (stale-by-cadence but
deterministic — effort runs first, so it sees the last recompute's
means); (2) ecologyTick at tick>0 && %10, THEN **simTick itself
recomputes `ecologyReport` and writes `deps.ecoMeans`**; (3) civic
partition-refresh + civicTick at tick>0 && %50 (partition recomputed
THEN remapped THEN dynamics), THEN **simTick recomputes `civicReport`
and writes `deps.civicMeans`**. simTick OWNS the post-tick report
recompute (NOT main.ts), so the N=120 double-run below genuinely
exercises cache coherence across the 10/50 cadence boundaries; main.ts
only READS `deps` for rendering. `deps` holds the mutated-in-place sim
state — `{world, tech,
civic: CivicState, partition: NeighborhoodMap, ecoMeans, civicMeans}` —
where `partition` is the LIVE NeighborhoodMap (replaced on each civic
refresh) that main.ts reads to resolve repair `(x,y)→neighborhoodId`
between refreshes (Task 6), and `ecoMeans`/`civicMeans` are the caches
effort.ts consumes (Task 4). Returns flags {ecoTicked, civicTicked,
effortGained} for the shell's dirty-marking. main.ts consumes this in
Task 6.
**Tests (RED):** cadence phases (which ticks fire what — symbolic);
composite determinism (N=120 ticks double-run: map snapshot + civic
snapshot + tech snapshot — the latter including `effort`, so byte-equality
now COVERS eco/civic cache coherence across the 10/50 cadence boundaries —
all byte-equal); **the integration tech guard:
across a composite run with a tools placement mid-way, TechState
changes ONLY by the placement spend and accruals — civic/eco never
write it (delta accounting asserted);** fabric/parcels byte-stable
across pure runs (no placements).
**Validation:** `npx vitest run`

### Task 6: Overlay + pulse line + wiring
**Files:** `src/ui/civicOverlayContent.ts`, `tests/ui/civicOverlayContent.test.ts`,
`src/ui/pulseContent.ts` (pure `pulseLine`), `tests/ui/pulseContent.test.ts`,
`src/ui/pulseDock.ts` (thin always-on dock mount), `src/ui/ecoOverlayContent.ts`
(exclusivity composite), `src/main.ts`, `tests/architecture.test.ts` (allowlist
gains `civicOverlayContent.ts` + `pulseContent.ts`)
**Approach:** civic views ['belonging','voice','trust'] with tints
(belonging warm amber ramp, voice violet→cyan, trust slate→gold) +
legends; neighborhood-tinted (tile → its neighborhood's value; none →
null/skip). **Exclusivity:** composite overlay state in main.ts
(`{kind, view} | null`); pure `cycleComposite(current, pressed:
'e'|'c')` in a shared module — pressing the OTHER key replaces the
active overlay at its first view (tests pin E-then-C and C-then-E).
Pulse line: `pulseLine(wellbeing: number, prevWellbeing: number | null)`
→ "Wellbeing N →/↗/↘" where **N is the effort-composite `wellbeing(world)`
(Task 4), NOT the civic citywide mean** — the PRD's "wellbeing" IS the
composite, and pulseLine cannot derive it from civicReport alone (it
lacks parcel count / condition / eco). Pure; trend compares the current
wellbeing to the previous civic-cadence wellbeing. **`prevWellbeing =
null`** (no prior — before the first civic cadence at tick 50) → FLAT
`→`, never a spurious `↗`; equal → `→`. The pulse is ALWAYS-ON (PRD
§2.4), so it gets its OWN dedicated dock element (a thin mount like the
toolbar / effort line), **NOT** the shared `toolbar.setStatus` transient
(which inspect/legend already clobber — main.ts:183,204) — refreshed on
the civic cadence ONLY (avoid per-tick flicker). main.ts: simTick
consumption, C self-binding via
the shared gate, repair forwarding from `applyAt`'s own scope on
`result.ok` (REPAIR_KINDS = boost-kind builds + all conversions ONLY,
both classifiable from `def`; **bulldoze EXCLUDED — the post-apply tile
is already cleared, so the demolished kind is unrecoverable**), resolving
`(tx,ty)→neighborhoodId` via `deps.partition.tileToNeighborhood` (anchor
tile; id 0 = safe no-op) then `civic.recordRepair(neighborhoodId, tick)`,
pulse refresh on civic cadence only.
**Tests (RED):** tint ramps pinned; legends; cycleComposite full truth
table incl. exclusivity both ways + off-wraps; pulseLine trend over the
wellbeing scalar (`↗/→/↘`) incl. `prevWellbeing = null` → flat `→`, equal
→ flat, and the "Wellbeing N" label shows the composite value not the
civic mean; **REPAIR_KINDS classification
(pure predicate over `def`): every conversion tool + every boost-kind
build classifies as a repair; bulldoze, inspect, and non-boost builds do
NOT** (the predicate is a pure module so it is unit-tested, not left to
main.ts wiring); allowlist green.
**Validation:** `npx vitest run`; `npm run build`

### Task 7: Docs
**Files:** `README.md`
**Approach:** Civic section: neighborhoods (highways as civic
boundaries), the three values, capability consumption (the civic branch
now does something), wellbeing composition (weights are tuning data),
C overlay + pulse line. **Validation:** suite green.

## 4. Validation Gates

```bash
npx tsc --noEmit && npx vitest run && npm run build
npm run dev   # lead: neighborhoods split at the highway; voice dark→warm
              # on circles unlock; trust pulse after a garden; pulse line
              # moving; E/C exclusivity; ?seed= determinism
```

## 5. Rollback Plan

Additive (src/civic, ui content, wiring) EXCEPT effort.ts — whose new
composition degrades exactly to the legacy formula when the optional
inputs are absent (tested), so reverting the wiring alone restores old
behavior; reverting the branch restores PR #7 state. No persistence.

## 6. Uncertainty Log

- **All rates/weights/thresholds/seeds are tuning data** (belonging 80 /
  voice 40 / trust 90 seeds, the /48 and /24 wellbeing weights, cadence
  50, TRUST_FLOOR 40, ring size 8, RECENT_WINDOW) — directional
  invariants are the tested contract; a balancing feature follows.
- **Neighborhood remap carryover** (weighted means; newest-ring-merge)
  is a design guess pinned by tests; revisit if play shows identity
  churn.
- **civic→ecology import** (influenceOf for fragmenting) is a new
  sanctioned edge; the guard asserts no reverse import. If it grows
  beyond the one predicate, lift a shared `transport-semantics` module.
- **Pulse trend window** = one civic cadence; may feel slow/fast live.
- **Effort economy shift**: the composition raises effort on healthy
  cities; costs unchanged — the live pass sanity-checks it is neither
  frozen nor explosive pre-balancing.
