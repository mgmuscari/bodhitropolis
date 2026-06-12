# PRD: Civic Sim

## Status: IMPLEMENTED
## Author: Claude (Proposer stance), directed by Maddy Muscari
## Date: 2026-06-12
## Branch: feature/civic-sim

## 1. Problem Statement

The last pillar. The city has history, wounds, a path of growth, working
hands, and living land — but no *people-as-community*. The game's vision
names a political/civic simulation: governance, consent, community power.
And the economy still runs on a confessed lie: `effortPerTick` carries its
PLACEHOLDER banner (src/tech/effort.ts:3), counting parcels and condition
because nothing better existed. The capabilities the tech tree grants —
participatory budgeting, circles, gift circles — are stored and queryable
but consumed by nothing: the player can unlock the machinery of community
power and the simulation shrugs.

This feature makes community the engine: neighborhoods that feel
belonging, exercise voice, and build trust — fed by everything the player
heals, feeding the communal effort everything costs. The gift-economy loop
closes: a city doing well across condition, ecology, and civic life gives
its planner more to give back.

## 2. Proposed Solution

1. **Neighborhood model** (`src/civic/`, pure, guard-scanned):
   deterministic partition of inhabited tiles into contiguous
   neighborhoods (parcel clusters joined by non-fragmenting road
   connectivity — highways split neighborhoods, the Moses geometry made
   civic), recomputed on a cadence; per-neighborhood civic state —
   **belonging** (do residents feel held), **voice** (do they shape
   decisions), **trust** (in each other and the process) — Uint8 scales
   in a `CivicState` store with byte-stable snapshots.
2. **Civic dynamics** (cadence slower than ecology, ~every 50 sim
   ticks): belonging grows with neighborhood condition + ecology +
   gathering places (Bazaar, MakerSpace, HealingCommons, CommunityGarden,
   Civic) and decays in isolation; **voice grows only where participatory
   capabilities are unlocked — circles, participatory-budgeting,
   gift-circles are finally consumed** (`hasCapability` read by the sim);
   trust follows recent repair actions in the neighborhood (a small
   deterministic recent-actions buffer fed by the tools layer).
3. **Wellbeing for real**: `effortPerTick`'s placeholder banner comes
   down — effort now composes parcel condition, ecology means, and civic
   state (per-neighborhood, citywide), with the quantization-honest
   monotonicity discipline extended to the new inputs.
4. **civicReport** (pure, the third report sibling) + a small always-on
   **city pulse line** in the dock (current wellbeing + trend arrow,
   pure content, thin shell).
5. **C-key civic overlay**: neighborhood-tinted belonging/voice/trust
   views on the ecology overlay machinery; E and C mutually exclusive.

## 3. Architecture Impact

- **New**: `src/civic/` (neighborhoods, dynamics, CivicState, report;
  fail-closed guard scan), `src/ui/civicOverlayContent.ts` +
  pulse-line content (pure, allowlisted), thin shell wiring.
- **Modified**: `src/tech/effort.ts` (placeholder → real composition;
  banner removed), its tests (new contract), `src/main.ts` (civic
  cadence, C key, pulse line, repair-action feed from the tool-apply
  path), `tests/architecture.test.ts` (scan src/civic). Tools layer: a
  minimal, explicit hook so applyTool reports repair actions to civic
  (the ONE sanctioned write-path crossing — designed, not smuggled).
- **Data model**: CivicState (neighborhood table + per-neighborhood
  Uint8 triple + recent-actions ring buffer) with `snapshotBytes()`;
  neighborhood id field (Uint16 per tile, 0 = none) — either a map layer
  or CivicState-internal (PRP decides; snapshot coverage required).
- **Dependencies**: none.

## 4. Acceptance Criteria

1. Gates green; `src/civic` guard-scanned; no transcendental Math, no
   rng in dynamics; determinism double-runs for partition, dynamics, and
   the composite (sim ticks including ecology + civic cadences).
2. Neighborhood partition: deterministic; contiguous; split by highways
   and joined by calm streets (both directions asserted on fixtures —
   the fragmentation semantics reused from ecology, keyed on KIND); the
   blighted start yields ≥3 neighborhoods on ≥3 seeds (non-vacuous);
   partition stable under no-change ticks and updated after fabric
   changes (cadence/invalidations tested).
3. Dynamics directional on fixtures: belonging rises with gathering
   places and falls under isolation; voice rises ONLY when the
   respective capabilities are unlocked (locked → flat, asserted);
   trust rises after repair actions in that neighborhood and decays
   without; all bounded 0-255, integer math.
4. Wellbeing: the placeholder banner is GONE from effort.ts; the new
   composition is non-decreasing in each input class (condition mean,
   ecology means, civic means) with strict-across-quantization-step
   cases per input; zero-parcel/all-water degenerates pinned (exact
   values, never NaN); existing effort determinism contracts hold.
5. Capability consumption: unlocking circles/participatory-budgeting/
   gift-circles measurably changes voice growth in a fixture run — the
   tech tree's civic branch finally does something (asserted before vs
   after unlock).
6. Isolation both ways: civic writes only CivicState (byte-tests against
   all map layers incl. ecology, ParcelStore, TechState — except the
   sanctioned effort flow through the existing spend/accrue paths);
   ecology/fabric remain ignorant of civic (no imports from civic
   outside main/ui wiring + effort composition).
7. Reports & UI: civicReport deterministic, ring/neighborhood values
   bounded, degenerate-safe; pulse line shows wellbeing + trend
   (pure-tested content incl. trend arithmetic); C cycles
   belonging/voice/trust with legends; E and C mutually exclusive
   (selecting one clears the other — asserted in the pure gate logic).
8. Live browser pass (lead): neighborhoods visible and split along the
   highway in the C overlay; voice view dark until circles unlock, then
   warming; trust pulse after placing a garden; the dock pulse line
   moving; E/C exclusivity; `?seed=` determinism.

## 5. Risk Assessment

- **Partition cost/stability**: flood-fill per cadence is cheap at 128²,
  but neighborhood IDENTITY across recomputes matters for state
  continuity — the PRP must pin a stable id scheme (e.g. anchored by
  lowest tile index) and a state-carryover rule for splits/merges.
- **Three-system coupling**: civic reads condition+ecology+tech and
  feeds effort — the widest surface yet. The isolation tests and the
  single sanctioned tools→civic hook keep the graph a DAG.
- **Effort rebalance**: replacing the formula changes the economy under
  every existing cost; directional invariants only, balancing later —
  but the live pass should sanity-check effort isn't degenerate (frozen
  at 1 or exploding).
- **Cadence stacking**: sim tick now drives effort (1), ecology (10),
  civic (50) — phase interactions must stay deterministic (single tick
  callback, fixed order, tested composite double-run).
- **Trend UI churn**: the pulse line updates on civic cadence only —
  not per tick — to avoid dock flicker.

## 6. Open Questions

1. Neighborhood granularity — parcel-clusters vs fixed districts?
   (Assume clusters via connectivity: the Moses corridors then *are*
   civic boundaries, which is the thesis made spatial.)
2. Should trust decay to zero or to a floor? (Assume a low floor > 0 —
   communities retain a seed of trust; full zero reads as misanthropy.)
3. Does the pulse line belong in the dock or a corner HUD? (Assume dock
   status slot family, latest-action-wins like legend/inspect.)

## 7. Out of Scope

- Elections, policies, ordinances, events; individual citizens/agents;
  dialogue/quests; win/lose conditions; persistence; balancing pass;
  art beyond tints; multi-city/region play; protests/conflict systems
  (community power here is constructive-only in v1).
