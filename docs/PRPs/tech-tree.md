# PRP: Tech Tree

## Source PRD: docs/PRDs/tech-tree.md
## Date: 2026-06-12

## 1. Context Summary

The unlock spine: a data-driven seven-branch tech tree (`src/tech/`, pure,
guard-scanned), new BuiltKind codes (transit 5-9, buildings 48-60), a
deterministic TechState machine with byte-stable snapshots, communal-effort
accrual as the sim loop's first real per-tick work, and a `T`-toggled tech
panel (thin DOM shell over a pure content module). Build tools that place
the granted kinds are the *next* feature — this one fences placement of new
transit kinds off entirely (the merge rule is not capacity-safe for them).

## 2. Codebase Analysis

- **Kind space + predicates** — `src/engine/fabric.ts`: `BuiltKind`
  as-const (:19-36; transport 1-4 with 5-15 reserved per the header
  comment :13; buildings 16-23 with 48+ reserved), `isRoadKind` :40,
  `isTransportKind` :42 (hardcoded ≤4 — the recorded follow-up this
  feature closes), `isBuildingKind` :44 (16..47 — **decision: widen to
  `k >= 16 && k <= 127`**; transport 1-15 never overlaps, so the two
  reserved building ranges collapse into one honest predicate),
  `transportCategory` :364-368 (currently a PRIVATE/non-exported helper,
  range-based — must become table-based AND be exported so Task 1 can
  unit-test the per-kind category table), junction merge
  `max(existing, kind)` at :313 (inside `placeTransport`) — **NOT
  capacity-safe** once codes 5-9 exist (QuietStreet=7 would "win" over
  Highway=3); hence the placement fence (Task 1).
- **Regression contract — FROZEN vs. REQUIRED edits** (the widening forces
  exactly two existing tests to change; the PRP must say which, or the
  executor hits a "tests pass unmodified" + "editing tests is a red flag"
  contradiction the moment they widen the predicate):
  - **FROZEN** (must pass UNMODIFIED — these only exercise kinds 1-4, so
    the widening cannot touch them; editing any is the PRD §5 red flag):
    the transportMask 16-config sweep (tests/engine/fabric.test.ts:371),
    the 4-way street/avenue junction (:403), the street<avenue<highway
    merge (:292), and the rail-on-rail / road↔rail crossing cases (:304).
  - **REQUIRED edits** (the widening changes their truth by design — they
    encode the OLD boundaries, so their rewrite is expected, NOT a red
    flag): "isTransportKind is true on 1..4 only" (:52-58) →
    `isTransportKind(5)` flips false→true; "isBuildingKind is true on
    16..47 only" (:60-68) → `isBuildingKind(48)` flips false→true. Rename
    both off the "…only" titles. (The `isRoadKind` boundary test :44-50 is
    unchanged — `isRoadKind` stays 1..3.)
- **Per-tick hook point** — `src/main.ts:77`: `new
  FixedTickLoop(SIM_TICK_MS, () => {})` — the empty callback becomes the
  effort-accrual call; `FixedTickLoop` passes the tick index
  (engine/loop.ts:21,61 — `onTick: (tick: number) => void`).
- **Snapshot pattern to mirror** — `ParcelStore.snapshotBytes`
  (fabric.ts:187-203): fixed-width little-endian records; TechState does
  the same (unlocked node ids sorted lexically + effort as u32).
- **Pure-ui pattern** — `src/ui/openingContent.ts` + allowlist in
  tests/architecture.test.ts (`PURE_UI_ALLOWLIST`); panel mirrors
  `mountOpening` (src/ui/opening.ts: zero game imports, content as data,
  key handling with unbind).
- **Guard extension**: architecture guard scans hard-coded dirs (:15-16);
  Task 2 adds `src/tech` as a scanned dir (fail-closed — every future
  tech file auto-covered), and `src/ui/techContent.ts` to the allowlist.
- **Conventions**: TDD, atomic commits ≤72 chars, non-vacuous invariants,
  rng only from forks (tech needs NO rng — costs and accrual are fully
  deterministic functions; keep it that way).

**Execution mechanics:** full team pipeline (`/review-plan-team` →
`/execute-team`); the lead owns the live browser pass (team sandboxes have
no browser) and the `.dialectic-tier` strip.

## 3. Implementation Plan

**Test Command:** `npx vitest run`

### Task 1: BuiltKind extension + placement fence
**Files:** `src/engine/fabric.ts`, `tests/engine/fabric.test.ts`
(renderer.ts intentionally NOT modified — see the deferral note below)
**Approach:**
- New codes — transit: `BikePath: 5, Streetcar: 6, QuietStreet: 7,
  ElevatedRail: 8, Promenade: 9`; buildings: `Parklet: 48,
  CommunityGarden: 49, CompostHub: 50, VerticalFarm: 51,
  WastewaterWorks: 52, EnergyNode: 53, AINode: 54, ADU: 55,
  CoopHousing: 56, Commune: 57, Bazaar: 58, MakerSpace: 59,
  HealingCommons: 60`.
- Predicates: `isTransportKind` → `k >= 1 && k <= 15` (range stays
  honest); `isBuildingKind` → `k >= 16 && k <= 127`; `isRoadKind`
  unchanged (1-3 — QuietStreet is NOT classic-road-mergeable, see fence).
  `transportCategory` becomes an explicit table AND is EXPORTED (it is
  currently a private/non-exported helper at fabric.ts:364 — the export is
  required so Task 1's "category table per new kind" test can reach it):
  1-3 → road(1), 4 → rail(2), 5 → bike(3), 6 → rail(2) (streetcar shares
  rail), 7 → road(1) (quiet street reads as street for MASKS only — NOT
  frontage, which stays on isRoadKind this feature; see the deferral note),
  8 → rail(2), 9 → pedestrian(4).
- **Placement fence**: `canPlaceTransport` rejects kinds 5-9 outright
  (`MERGEABLE_TRANSPORT = kind <= 4`), with a comment: the `max(kind)`
  junction merge is not capacity-ordered for 5-9; the build-tools feature
  replaces it with a conversion/capacity table before enabling placement.
- `parcelTouchesRoad` and the renderer are INTENTIONALLY NOT touched this
  feature (scope discipline — both are speculative for kinds nothing can
  place yet; neither is required by any PRD acceptance criterion):
  - `parcelTouchesRoad` stays on `isRoadKind` (unchanged). Making
    QuietStreet count as frontage (`transportCategory(k) === 1`) only
    matters once QuietStreet can be placed — it is unreachable behind the
    fence and would modify a frontage function under a regression contract
    for zero in-feature benefit. Deferred to build-tools. **Coupling note
    for that feature:** transportCategory already classifies QuietStreet(7)
    as road for MASKS, so masks and frontage hold two different notions of
    "road" for kind 7 until then — when build-tools un-defers, the frontage
    swap, the renderer dispatch extension, and any capacity-aware
    junction-merge change must land TOGETHER to reconcile it, not piecemeal.
  - Renderer: DEFERRED to build-tools. "Palette entries" alone do not make
    kinds visible — the renderer DISPATCHES on kind (renderer.ts:332-339):
    transit routes through a binary rail-vs-road split (Streetcar(6)/
    ElevatedRail(8) mis-key as `road-6`/`road-8`; BikePath(5)/QuietStreet(7)/
    Promenade(9) have no bike/pedestrian branch) and buildings key
    `b-${kind}` against `BUILDING_STYLES` (16-23 only). Delivering "never
    invisible later" needs the DISPATCH extended (rail/road/bike/pedestrian
    + building keyspaces), not a color table — and with the fence + no build
    tools, NOTHING places 5-9/48-60 this feature, so any entry is
    unreachable at runtime and untestable in a headless RED suite. Natural
    home is build-tools, where placement exists and rendering can be
    exercised behind a pure `builtRenderKey(kind, mask)` seam. (Diverges
    from PRD §3's "renderer palette entries now" — flagged to team lead.)
**Tests (RED):** code ranges + no collisions (programmatic sweep of the
BuiltKind table); predicate boundaries (4/5, 15/16, 47/48, 127/128) — this
REQUIRES editing the two existing predicate-boundary tests
(fabric.test.ts:52-58 `isTransportKind`, :60-68 `isBuildingKind`) so 5 and
48 now read true and the titles drop "…only" (an expected edit, NOT the
PRD red flag — see §2 FROZEN vs. REQUIRED); category table per new kind;
`canPlaceTransport` rejects each 5-9 kind on empty land (the fence,
asserted per kind); the FROZEN mask/junction/merge tests (§2: :292, :304,
:371, :403) pass UNMODIFIED; mask behavior: streetcar connects to rail,
bike path connects only to bike path, quiet street connects to street
(category-level fixtures injected via `map.setBuilt`, since the fence
blocks placing kinds 5-9 through `placeTransport`).
**Validation:** `npx vitest run`; `npx tsc --noEmit`

### Task 2: Tree data model + guard extension
**Files:** `src/tech/tree.ts`, `tests/tech/tree.test.ts`,
`tests/architecture.test.ts`
**Approach:** `Branch` as-const (7 branches); `TechNode {id, branch, name,
flavor, prereqs: string[], cost: number, grants: {kinds?: BuiltKind[],
capabilities?: string[]}}`; `TECH_TREE: readonly TechNode[]` — the seeded
table (ids kebab-case):

| id | branch | prereqs | grants | cost |
|---|---|---|---|---|
| walkable-streets | NewUrbanism | — | cap:walkability | 10 |
| road-diets | NewUrbanism | walkable-streets | cap:road-diets | 15 |
| parklets | NewUrbanism | road-diets | kind:Parklet | 20 |
| quiet-streets | NewUrbanism | road-diets | kind:QuietStreet | 25 |
| urban-promenades | NewUrbanism | quiet-streets | kind:Promenade | 35 |
| streetcar-revival | NewUrbanism | road-diets, renewable-energy | kind:Streetcar | 40 |
| soil-and-soul | GreenDevelopment | — | cap:soil-care | 10 |
| urban-composting | GreenDevelopment | soil-and-soul | kind:CompostHub | 15 |
| community-gardens | GreenDevelopment | urban-composting, road-diets | kind:CommunityGarden | 25 |
| vertical-farming | GreenDevelopment | community-gardens | kind:VerticalFarm | 40 |
| wastewater-recycling | GreenDevelopment | soil-and-soul | kind:WastewaterWorks | 30 |
| circles | RestorativeJustice | — | cap:circles | 10 |
| community-land-trust | RestorativeJustice | circles | cap:land-trust | 20 |
| healing-commons | RestorativeJustice | community-land-trust | kind:HealingCommons | 30 |
| participatory-budgeting | RestorativeJustice | circles | cap:participatory-budgeting | 25 |
| shared-table | IntentionalCommunities | — | cap:shared-table | 10 |
| adus | IntentionalCommunities | shared-table | kind:ADU | 15 |
| coop-housing | IntentionalCommunities | adus, collective-ownership | kind:CoopHousing | 30 |
| maker-spaces | IntentionalCommunities | shared-table, gift-circles | kind:MakerSpace | 25 |
| gift-circles | GiftEconomy | — | cap:gift-circles | 10 |
| urban-bazaars | GiftEconomy | gift-circles | kind:Bazaar | 20 |
| craft-fairs | GiftEconomy | gift-circles | cap:craft-fairs | 15 |
| bike-shares | GiftEconomy | gift-circles, bike-paths | cap:bike-shares | 20 |
| sun-and-wire | Solarpunk | — | cap:solar-basics | 10 |
| renewable-energy | Solarpunk | sun-and-wire | cap:renewables | 20 |
| local-grids | Solarpunk | renewable-energy | cap:local-grids | 25 |
| community-energy-nodes | Solarpunk | local-grids | kind:EnergyNode | 35 |
| bike-paths | Solarpunk | sun-and-wire | kind:BikePath | 15 |
| elevated-rail | Solarpunk | streetcar-revival, local-grids | kind:ElevatedRail | 50 |
| drone-deliveries | Solarpunk | community-ai-nodes | cap:drone-deliveries | 45 |
| mutual-aid | AnarchoCommunism | — | cap:mutual-aid | 10 |
| collective-ownership | AnarchoCommunism | mutual-aid, community-land-trust | cap:collective-ownership | 25 |
| communes | AnarchoCommunism | collective-ownership, healing-commons | kind:Commune | 35 |
| community-ai-nodes | AnarchoCommunism | mutual-aid, local-grids, participatory-budgeting | kind:AINode | 40 |

(34 nodes; 11 cross-branch edges — verified by a branch-vs-prereq audit.
Per the team-lead design ruling, all three non-root RestorativeJustice
nodes are load-bearing across branches: `community-land-trust` ←
collective-ownership, `healing-commons` ← communes, `participatory-
budgeting` ← community-ai-nodes (RJ is the thesis — you cannot heal the
built environment without healing the community). The two added edges
keep closures shallow and acyclic: healing-commons←community-land-trust←
circles, participatory-budgeting←circles, neither reaches back into AC.
Flavor lines authored at implementation, ≤90 chars, dharmapunk register.)
- `validateTree(nodes)`: duplicate ids, dangling prereqs, cycles
  (Kahn/DFS), **root-termination reachability** — every node's transitive
  prereq closure terminates ONLY at no-prereq roots, cross-branch edges
  allowed. This is NOT per-branch reachability: `drone-deliveries` is
  Solarpunk but its only direct prereq `community-ai-nodes` is
  AnarchoCommunism, so a "reach this node's OWN branch root within the
  branch" rule false-flags it by construction — use closure-terminates-at-
  some-root instead. (This intentionally refines the PRD §2/AC#2 "reachable
  from its branch root" wording, which is false for cross-branch nodes; the
  team lead is routing the PRD-side rewording.) Plus: kinds granted at most
  once across the tree, granted kinds are valid BuiltKind codes. Exported —
  the test calls it AND it self-checks on synthetic bad trees.
- Guard: add `src/tech` to scanned dirs; `src/ui/techContent.ts` to the
  pure-ui allowlist (it doesn't exist yet — the guard tolerates listed-
  but-absent files OR the entry lands in Task 5; **decide: add the
  allowlist entry in Task 5** when the file exists, keep this task's guard
  change to the `src/tech` dir).
**Tests (RED):** validateTree passes on TECH_TREE; per-property synthetic
failures (cycle, dangling, dup id, dup kind grant, bad kind code) each
flagged (self-check); root-termination reachability accepts the
cross-branch case BY NAME — `drone-deliveries` (Solarpunk) whose only
direct prereq is `community-ai-nodes` (AnarchoCommunism), asserting its
closure still terminates at no-prereq roots — and flags a synthetic node
whose closure never reaches a root; branch coverage ≥2 nodes each;
cross-branch edges assert `>= 3` (the actual count is 11 — do NOT pin an
exact value); every design-brief example node present by id (explicit
list); guard scans src/tech FAIL-CLOSED — prove it BEHAVIORALLY with a
synthetic violation, not a config assertion: write a throwaway
`src/tech/__guard_probe__.ts` holding a DOM token, re-run the scan's
`tsFiles(techDir)` + `stripComments` + `FORBIDDEN_DOM`, assert the probe is
discovered AND flagged, then unlink it (try/finally or `afterEach`). (Do
NOT "assert src/tech is in a scanned-dirs list" — that's circular config-
testing, and there's nothing to import: `engineDir`/`worldgenDir`/
`engineFiles` are file-local consts at architecture.test.ts:15-16,43-44
with no exports.) Separately confirm `effort.ts` SURVIVES the new
fail-closed scan: the scan bans DOM/transcendental-Math/ui-imports but
ALLOWS engine imports, and effort.ts's `world` is typed structurally / via
engine only (never worldgen, per Task 4), so it passes clean.
**Validation:** `npx vitest run`

### Task 3: TechState machine
**Files:** `src/tech/state.ts`, `tests/tech/state.test.ts`
**Approach:**
```ts
class TechState {
  readonly unlocked: ReadonlySet<string>; effort: number;
  canUnlock(id): {ok: boolean; reason?: 'unknown'|'unlocked'|'prereqs'|'effort'}
  unlock(id): boolean        // false (no mutation) unless canUnlock.ok
  grantedKinds(): ReadonlySet<BuiltKind>
  hasCapability(cap): boolean
  snapshotBytes(): Uint8Array  // sorted ids (utf8, len-prefixed) + effort u32
}
createTechState(tree): TechState
```
Pure, no rng, no Date. Effort is integer (floor on accrual).
**Tests (RED):** each canUnlock failure reason on fixtures; unlock spends
exactly cost and grants kinds+caps; double-unlock rejected without
mutation; prereq chain end-to-end (root → mid → leaf); cross-branch
prereq enforced (coop-housing needs AC's collective-ownership);
determinism: same action sequence twice → byte-equal snapshots; divergent
sequence → different. **Set-semantics (order-independence):** take ONE
fixed unlocked set and unlock it in two different valid orders from the
SAME starting effort — assert byte-equal snapshots (the snapshot sorts
ids, so order cannot leak; effort is identical because the spent cost is
the sum of the same node costs). Separately assert a DIFFERENT final set
yields DIFFERENT bytes. (No equal-cost-path contrivance is needed or
correct: same set ⇒ same spent cost by construction, so the earlier
"balances may differ" hedge was wrong — permute order of one fixed set,
never compare two different sets that merely share a total cost.)
**Validation:** `npx vitest run`

### Task 4: Communal effort accrual (first real sim work)
**Files:** `src/tech/effort.ts`, `tests/tech/effort.test.ts`,
`src/main.ts`
**Approach:** `effortPerTick(world): number` — PLACEHOLDER banner comment
(replaced by the civic sim). Define `conditionMean` with an explicit
zero-parcel guard: `aliveParcels === 0 ? 0 : floor(sumCondition /
aliveParcels)` — without it the empty world divides 0/0 = NaN, and
`max(1, floor(NaN)) = NaN` (NaN comparisons are false, so `max` returns
NaN), poisoning `state.effort` and every downstream u32 snapshot. Then
`effortPerTick = max(1, floor(aliveParcels/8 + conditionMean/32))` —
integer math only, ALWAYS a finite integer ≥ 1. `world` is typed
structurally (`{ parcels: ParcelStore }`, mirroring fabric.ts's
`HashableWorld`) so src/tech never imports worldgen. `accrue(state, world,
ticks)` adds `ticks * effortPerTick(world)` (formula constant within a
call; recompute per call, not per tick — placement/condition won't change
mid-frame yet). main.ts: the FixedTickLoop callback becomes `accrue(tech,
world, 1)` and, if the panel is open, sets a SEPARATE `panelDirty` flag —
distinct from the existing canvas `dirty` (main.ts:44-47), which only
drives `renderer.render(world, camera)` (:82-85) and never touches the DOM
panel. Headless safety unchanged (wiring stays inside `main()`).
**Tests (RED):** zero-parcel world → `effortPerTick` is EXACTLY 1 AND
`Number.isInteger` (the NaN-guard pin); integer-only output on populated
fixtures; **monotonicity is NON-DECREASING, not strict** — assert
`effortPerTick(hi) >= effortPerTick(lo)` for higher condition mean at the
same parcel count, PLUS one explicit boundary-crossing fixture whose
condition means are separated enough to span a `floor(.../32)` step,
asserting strictly greater there (the `floor` quantizes in steps of 32, so
strictness only holds across a step — PRD §5/AC#5 "strictly more" is
overstated and the team lead is routing the reword); N ticks twice → equal
balances (determinism in tick count); placeholder banner present (string
assertion on the source via the guard-style read — cheap honesty check).
**Validation:** `npx vitest run`

### Task 5: Pure tech-panel content
**Files:** `src/ui/techContent.ts`, `tests/ui/techContent.test.ts`,
`tests/architecture.test.ts` (allowlist entry)
**Approach:** view models from (tree, state): `branchColumns()` → 7
columns ordered as the PRD lists the philosophies, each with nodes in
topological-ish display order (roots first, then by cost); per-node
`{id, name, flavor, cost, status: 'locked'|'affordable'|'unlocked',
missing: string[]}`; `effortLine(state)`. Also the pure input-gate seam
`shouldTogglePanel(key: string, overlayActive: boolean): boolean` (true
iff `key` is `t`/`T` AND not `overlayActive`), consumed by the Task 6 DOM
shell — it lives in this pure module so the overlay-suppression gate is
unit-tested rather than left to manual QA. All strings ≤90 chars.
**Tests (RED):** status transitions across a scripted unlock sequence;
missing lists name the actual unmet prereqs (by name, not id); column
count/order; `shouldTogglePanel` truth table (`t`/`T` + inactive ⇒ true;
`t`/`T` + active ⇒ false; any non-toggle key ⇒ false); allowlist now
includes techContent.ts and the guard passes; determinism (pure data in →
same out).
**Validation:** `npx vitest run`

### Task 6: Tech panel shell + wiring
**Files:** `src/ui/techPanel.ts`, `src/main.ts`, `index.html`
**Approach:** `mountTechPanel(container, deps)` mirroring `mountOpening`:
zero game imports — deps are `{ getContent(): …, onUnlock(id): boolean,
isOverlayActive(): boolean }`. **Overlay/`T` coordination (concrete
mechanism, NOT deferred to QA):** the opening overlay binds its OWN global
keydown and unbinds only on dismiss (opening.ts:64-77), exposing no
"active" state — so if the panel blindly binds a second `T` listener it
toggles the panel *underneath* the live overlay, and no dep would let it
learn the overlay is up. Resolution: (1) the panel's keydown handler
routes through the pure `shouldTogglePanel(key, overlayActive)` seam from
Task 5, calling `deps.isOverlayActive()` each keypress and ignoring `T`
while it returns true; (2) opening.ts stays UNTOUCHED — main.ts, the single
composition root, owns an `overlayActive` boolean (init `params.get('nointro')
!== '1'`; set false inside the dismiss/`onBegin` callback it already passes
to `mountOpening`) and supplies `isOverlayActive: () => overlayActive`. The
coupling is explicit main.ts wiring, not a hidden cross-module dependency,
and both modules keep their "zero game imports" property. Then: click
affordable → `onUnlock` → re-render from `getContent()`. **Tick refresh:**
on the SEPARATE `panelDirty` flag (Task 4; NOT the canvas `dirty`) the open
panel re-renders its FULL content from `getContent()` — not just the effort
counter line: as effort accrues past a node's cost the node flips
locked→affordable, so node STATUS genuinely changes each tick and must
re-derive, otherwise newly-affordable nodes stay greyed until the next
click. Styles in index.html (panel right-docked, palette-consistent,
internal scroll). main.ts wires tree+state+accrual+panel; `?seed=`
unaffected.
**Tests:** the gate decision IS unit-tested as the pure `shouldTogglePanel`
seam in Task 5 (truth table) — not deferred to manual QA. The remaining
DOM binding is the thin-shell exception: headless import safety (existing
smoke) plus the lead's live browser pass confirms the WIRING (toggle,
unlock end-to-end, gating visible, coexistence with overlay/map, reload
determinism).
**Validation:** `npx vitest run`; `npm run build`; lead browser pass.

### Task 7: Docs
**Files:** `README.md`
**Approach:** Tech-tree section: seven branches, effort (placeholder
formula disclosed), `T` panel, what unlocks gate (build tools next).
**Validation:** `npx vitest run` still green.

## 4. Validation Gates

```bash
npx tsc --noEmit
npx vitest run
npm run build
npm run dev   # lead: T toggle, unlock flow, gating, coexistence, determinism
```

## 5. Rollback Plan

Additive (new src/tech + ui modules; fabric.ts code/predicate additions;
main.ts wiring). Revert = don't merge. No map state can contain the new
kinds, so a revert strands no data — but the two mechanisms differ and the
guarantee must be stated precisely (it is NOT "everything is fenced"):
transit 5-9 are FENCED — `canPlaceTransport` rejects them outright because
the `max(kind)` junction merge is not capacity-safe for them; building
kinds 48-60 are NOT fenced — `canPlaceParcel`/`placeParcel` (fabric.ts:249-
282) validate footprint/land/overlap but never the kind, so a 48+ parcel
WOULD persist if a caller requested it. They are safe only because nothing
calls `placeParcel` with new kinds yet (no build tools) and parcels carry
no junction-merge hazard. Either way nothing writes a new kind into a tile
this feature, so reverting cannot strand data.

## 6. Uncertainty Log

- **Costs are placeholder balance** (tier-scaled 10-50); the structural
  acceptance bar (DAG/gating/determinism) is what's tested. Balancing
  feature later. One structural-but-balance-adjacent consequence of the RJ
  design ruling to revisit at cost-tuning: `community-ai-nodes` is gated
  across THREE branches (AnarchoCommunism + Solarpunk + RestorativeJustice)
  and `drone-deliveries` (longest-prereq depth L4) then sits behind a
  four-branch closure — the deepest, most cross-coupled unlock in the tree.
  Correct as a design call now; flagged so the balancing pass eyes it.
- **`accrue` recomputes the formula per call, not per tick** — correct
  while nothing mutates the world mid-frame; the build-tools feature must
  revisit (noted in the banner comment).
- **Capability strings are unvalidated free text** by design (consumers
  arrive in later features); validateTree could pin a registry later.
- **Panel-while-overlay key handling**: RESOLVED in Task 6 — the panel
  routes `T` through the pure `shouldTogglePanel(key, overlayActive)` seam
  (unit-tested in Task 5) and main.ts owns the `overlayActive` flag, so the
  gate is decided in tested pure code; the lead's browser pass only
  confirms the wiring, not the gate logic.
- **transportCategory table values** (streetcar=rail, quiet-street=road,
  promenade=pedestrian) are design calls the build-tools feature will
  exercise for real; masks are tested now so changing them later is a
  visible, deliberate edit.
