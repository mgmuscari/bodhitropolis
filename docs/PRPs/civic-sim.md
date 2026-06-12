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
  civic → {ecology(influence only), engine, worldgen(fields)} in the
  guard's comment — or lift `fragmenting` into the table consumed via a
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
  applyTool routes to fabric writers; the hook: applyTool RETURNS an
  action descriptor already (`{ok, ...}`) — main.ts forwards successful
  repair actions (build of boost kinds, conversions, bulldoze-of-blight?
  — table-driven REPAIR_ACTIONS set) to `civic.recordRepair(x, y,
  tick)`. No tools→civic import; main.ts is the composition root doing
  the forwarding (keeps tools pure of civic).
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
  numbers arrive structurally).
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
{id, anchor, tileCount, parcelTiles}[]}`. Inhabited tile = parcel tile
OR within 1 of one (parcel + frontage halo). Flood-fill 4-connectivity
where crossing a tile whose built kind is `fragmenting` (via
`influenceOf(kind).fragmenting`) BLOCKS adjacency (highways/busy roads
split; calm streets join). **Stable ids: neighborhoods ordered and
numbered by lowest tile index (anchor) — recomputation on an unchanged
map yields byte-identical output (tested); after a fabric change, ids
re-anchor deterministically (carryover handled in Task 2's state
mapping).**
**Tests (RED):** determinism (double-run byte-equal); fixtures: two
parcel clusters joined by a street = ONE neighborhood; same clusters
split by a highway between = TWO (both directions of fragmentation —
the ecology payoff reused); QuietStreet bridge joins; anchor-id
stability; real pipeline: ≥3 neighborhoods on 3 seeds (non-vacuous,
counts logged not pinned); empty/all-water map → zero neighborhoods, no
throw; guard scans src/civic (probe) + ecology/tools/tech do not import
civic (source assertion like the existing dependency rules).
**Validation:** `npx vitest run`; `npx tsc --noEmit`

### Task 2: CivicState store + repair intake
**Files:** `src/civic/state.ts`, `tests/civic/state.test.ts`
**Approach:** `CivicState` — per-neighborhood `{belonging, voice,
trust}` (Uint8, seeded mid-low: belonging 80, voice 40, trust 90 —
named consts), a repair ring buffer (per neighborhood, fixed 8 slots of
tick numbers, LE in snapshot), `recordRepair(neighborhoodId, tick)`,
`remap(oldPartition, newPartition)` — **state carryover: each new
neighborhood inherits the tile-count-weighted mean state of the old
neighborhoods its tiles came from (integer, deterministic); splits
inherit the parent's values; merges average. Ring buffers merge by
keeping the newest entries.** `snapshotBytes()` fixed-width LE.
**Tests (RED):** roundtrips; snapshot stability/divergence; remap
fixtures (split inherits parent values; merge averages weighted by
tiles; identity remap = byte-equal); ring buffer order/caps;
recordRepair on unknown id is a safe no-op (logged not thrown).
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
// fauna}, civicMeans?: {belonging, voice, trust} — passed by main.ts
// from the cached reports at their cadences; ABSENT fields contribute 0
// (pre-civic saves/tests stay valid; degenerates pinned).
wellbeing = floor(alive/8 + conditionMean/32 + ecoMean/48 + civicMean/24)
effort = max(1, wellbeing)   // ecoMean = floor((soil+flora+fauna)/3),
                             // civicMean = floor((belonging+voice+trust)/3)
```
PLACEHOLDER banner REMOVED; doc comment states the composition + that
weights are tuning data. The banner-presence test flips to
banner-ABSENCE + composition contract.
**Tests (RED):** effort — non-decreasing per input class + one
strict-across-step case EACH (condition, eco, civic); absent optional
inputs → exact legacy-formula values (backwards-compatible degenerate);
zero-parcel still exactly 1; integer-only. civicReport — determinism,
bounds, no-neighborhood degenerates, citywide means hand-checked on a
fixture.
**Validation:** `npx vitest run`

### Task 5: Composite sim orchestrator
**Files:** `src/civic/compose.ts`, `tests/civic/compose.test.ts`
**Approach:** `simTick(deps, tick)` — pure orchestration: effort accrual
every tick (consuming the CACHED eco/civic means), ecologyTick at
tick>0 && %10, civic partition-refresh + civicTick at tick>0 && %50
(partition recomputed THEN remapped THEN dynamics); fixed order
documented. Returns flags {ecoTicked, civicTicked, effortGained} for
the shell's dirty-marking. main.ts consumes this in Task 6.
**Tests (RED):** cadence phases (which ticks fire what — symbolic);
composite determinism (N=120 ticks double-run: map snapshot + civic
snapshot + tech snapshot all byte-equal); **the integration tech guard:
across a composite run with a tools placement mid-way, TechState
changes ONLY by the placement spend and accruals — civic/eco never
write it (delta accounting asserted);** fabric/parcels byte-stable
across pure runs (no placements).
**Validation:** `npx vitest run`

### Task 6: Overlay + pulse line + wiring
**Files:** `src/ui/civicOverlayContent.ts`, `tests/ui/civicOverlayContent.test.ts`,
`src/ui/ecoOverlayContent.ts` (exclusivity composite), `src/main.ts`,
`tests/architecture.test.ts` (allowlist)
**Approach:** civic views ['belonging','voice','trust'] with tints
(belonging warm amber ramp, voice violet→cyan, trust slate→gold) +
legends; neighborhood-tinted (tile → its neighborhood's value; none →
null/skip). **Exclusivity:** composite overlay state in main.ts
(`{kind, view} | null`); pure `cycleComposite(current, pressed:
'e'|'c')` in a shared module — pressing the OTHER key replaces the
active overlay at its first view (tests pin E-then-C and C-then-E).
Pulse line: `pulseLine(report, prevCitywideMean)` → "Wellbeing N ↗/→/↘"
(pure, trend from the previous civic cadence; dock status family,
latest-action-wins). main.ts: simTick consumption, C self-binding via
the shared gate, repair forwarding (REPAIR_KINDS table: boost-kind
builds + all conversions), pulse refresh on civic cadence only.
**Tests (RED):** tint ramps pinned; legends; cycleComposite full truth
table incl. exclusivity both ways + off-wraps; pulseLine trend
arithmetic (up/flat/down) + degenerates; allowlist green.
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
