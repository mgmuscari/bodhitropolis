# PRD: Tech Tree

## Status: IMPLEMENTED
## Author: Claude (Proposer stance), directed by Maddy Muscari
## Date: 2026-06-12
## Branch: feature/tech-tree

## 1. Problem Statement

The player has a city, a story, and a charge (PR #4) — but no path of
growth. The game's design says healing comes through a tech tree rooted in
seven philosophies: New Urbanist Philosophy, Green Development, Restorative
Justice, Intentional Communities, Gift-Based Economies, Eco/Solarpunk, and
AnarchoCommunism. Unlocks gate every future mode of transit, zoning,
housing, and utility — Road Diets opening into parklets and quiet streets,
Decentralized Infra into composting and community energy, Zoning/Density
into co-ops and communes and bazaars, Transit into streetcar revival and
bike paths. None of this exists. The `BuiltKind` code space reserved 5-15
(transit) and 48+ (tech-tree-era buildings) for exactly this moment.

This feature is the spine: the tree's data model, the unlock state machine,
the first real per-tick simulation work (communal effort accrual), and the
tech panel UI. Player build tools that *place* the unlocked kinds are the
next feature; this one makes the unlocks real, deterministic, and visible.

## 2. Proposed Solution

1. **Tree data model** (`src/tech/`, pure — added to the architecture
   guard's scanned directories, fail-closed): seven branches; data-driven
   nodes `{id, branch, name, flavor, prereqs[], grants}` where grants are
   BuiltKind codes and/or capability flags. Cross-branch prereqs allowed
   (e.g. Community Gardens needs both a New Urbanist street-reclamation
   node and a Green Development soil node). Seeded with the design's
   example paths as real nodes (~28 nodes), each assigned to its
   philosophically-correct branch, with Restorative Justice given real
   nodes (community land trust, healing commons, participatory budgeting)
   that other branches' deeper unlocks depend on.
2. **New BuiltKind codes**: transit kinds in the reserved 5-15 range
   (BikePath, Streetcar, QuietStreet, ElevatedRail, Promenade) with the
   transport predicates/categories extended (this resolves the recorded
   `isTransportKind ≤ 4` follow-up); building kinds in 48+ (Parklet,
   CommunityGarden, VerticalFarm, CompostHub, WastewaterWorks, EnergyNode,
   AINode, ADU, CoopHousing, Commune, Bazaar, MakerSpace, HealingCommons…).
   Codes, names, predicates, and cheap palette entries only — placement
   behavior and real art come with the build-tools feature.
3. **Unlock state machine** (pure, deterministic): `TechState` (unlocked
   set + effort balance); `canUnlock` (prereqs met, affordable, not already
   unlocked); `unlock` (spend, grant); `grantedKinds`/`hasCapability`
   queries; byte-stable snapshot so determinism is assertable (same action
   sequence → same state hash).
4. **Communal effort** — the gift-economy resource: accrued per *sim tick*
   (deterministic in tick count, never wall time), scaled by city wellbeing
   with an explicitly-marked placeholder formula (alive parcels + condition
   mean; the civic sim replaces it later). The fixed-tick loop gets its
   first real work, wired through a pure `simTick(world, tech)` step.
5. **Tech panel UI** (thin DOM shell + pure content module, same pattern
   as the opening overlay): `T` toggles; seven branch columns; node states
   locked / affordable / unlocked; click to unlock when affordable; effort
   counter. Pixel-art styling consistent with the overlay palette.

## 3. Architecture Impact

- **New**: `src/tech/tree.ts` (branches, node table), `src/tech/state.ts`
  (TechState machine), `src/tech/effort.ts` (accrual formula, marked
  placeholder), mirrored tests; `src/ui/techContent.ts` (pure presentation,
  added to the pure-ui allowlist), `src/ui/techPanel.ts` (DOM shell).
- **Modified**: `src/engine/fabric.ts` (new BuiltKind codes 5-9 and 48+;
  `isTransportKind`/`transportCategory`/`isRoadKind` extended with explicit
  category decisions per new transit kind);
  `src/main.ts` (sim tick wiring: effort accrual + panel mount/toggle);
  `tests/architecture.test.ts` (scan `src/tech` as a first-class pure dir).
  Renderer art/palette for the new kinds is explicitly DEFERRED to the
  build-tools feature — fenced/unplaceable kinds cannot appear on any map
  this feature can produce, so palette entries would be dead code here.
- **Data model**: TechState is the first mutable non-map game state;
  byte-stable snapshot mirrors ParcelStore's pattern. No map-layer changes.
- **Dependencies**: none added.

## 4. Acceptance Criteria

1. Gates green (`tsc`, `vitest`, `build`); architecture guard scans
   `src/tech` (fail-closed) and the extended pure-ui allowlist; no DOM or
   transcendental Math in tech modules.
2. The seeded tree: ≥25 nodes across all seven branches (every branch ≥2
   nodes); every example path from the design brief present (road diets,
   decentralized infra, zoning/density, transit chains); DAG validity
   tested (no cycles, no dangling prereq ids, every node's prereq closure
   terminates at root nodes — a cross-branch node's closure may terminate
   at another branch's root); ≥3 cross-branch prereq edges.
3. New BuiltKind codes: transit kinds within 5-15, building kinds within
   48+, no collisions (tested); transport predicates/categories updated
   with explicit per-kind category and mask behavior tested (the
   `isTransportKind ≤ 4` follow-up is closed).
4. State machine: `canUnlock` false on missing prereqs / insufficient
   effort / already unlocked (each tested); `unlock` spends effort and
   applies grants; `grantedKinds` reflects unlocks; identical action
   sequences → identical state snapshots; divergent sequences → divergent
   snapshots.
5. Effort accrual is deterministic in tick count (N ticks twice → equal
   balances), scales with the wellbeing inputs (non-decreasing in
   condition mean, and strictly greater across a quantization-step
   boundary of the floor-based formula — tested on fixtures), and the
   placeholder formula is marked as such in code at the definition site.
6. Tech panel: `T` toggles; renders seven branches with node states from
   the pure content module; clicking an affordable node unlocks it and the
   panel + effort counter update; locked/unaffordable clicks no-op. Pure
   content functions unit-tested; DOM shell thin; headless import safety
   preserved.
7. Live browser pass (team lead): panel toggle, an end-to-end unlock with
   visible effort spend, prereq gating observable, overlay/map/panel
   coexistence, reload determinism unaffected.

## 5. Risk Assessment

- **Content sprawl**: 28 nodes of flavor text invites endless writing.
  Node table is data; flavor is one line each; voice review at the gate.
- **Transport predicate changes touch merged mask/placement behavior**:
  extending categories must not alter existing street/avenue/highway/rail
  semantics — regression guard: the existing 16-mask and junction tests
  must pass untouched (any edit to them is a red flag).
- **Sim-tick wiring**: the loop currently no-ops; introducing per-tick
  state must not break determinism (effort keyed to tick count only) or
  headless tests (simTick pure, loop wiring stays in main.ts).
- **Tree balance is unknowable now**: costs are placeholders; the
  acceptance bar is structural (DAG, gating, determinism), not balance —
  a balancing feature follows playtesting.
- **UI complexity creep**: seven columns of nodes is the maximal panel;
  no zoom/pan/search/tooltips beyond title+flavor — hold the line.

## 6. Open Questions

1. Do capability flags (non-tile grants like "participatory budgeting")
   need to do anything yet? (Assume: stored and queryable
   (`hasCapability`), consumed by later features — the build-tools and
   civic features read them.)
2. Effort costs: flat per tier or per node? (Assume: per-node integer in
   the data table, roughly tier-scaled — placeholder values, balancing
   later.)
3. Should unlocking pause the sim? (Assume no — the panel overlays a
   running city; effort keeps accruing.)

## 7. Out of Scope

- Player build tools / placement of unlocked kinds (next feature)
- Ecology and civic simulations (the effort formula is a marked
  placeholder for the civic sim's wellbeing model)
- Save/load of TechState; balancing; real art/animation for new kinds;
  sound; tooltips beyond name+flavor; respec/refund mechanics
