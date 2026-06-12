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
  as-const (:19-37; transport 1-4 with 5-15 reserved per the header
  comment :13; buildings 16-23 with 48+ reserved), `isRoadKind` :40,
  `isTransportKind` :42 (hardcoded ≤4 — the recorded follow-up this
  feature closes), `isBuildingKind` :44 (16..47 — new 48+ kinds need a
  second range or a widened predicate: **decide widened**:
  `isBuildingKind = (16..47) || (48..127)` collapsed to `k >= 16 && k <=
  127 && !isTransportKind(k)`… NO — keep it simple and explicit: building
  iff `(k >= 16 && k <= 47) || (k >= 48 && k <= 127)` ≡ `k >= 16 && k <=
  127`; transport range never overlaps. Use `k >= 16 && k <= 127`.),
  `transportCategory` :280-284 (range-based — must become table-based with
  the new kinds), junction merge `max(existing, kind)` at :273 — **NOT
  capacity-safe** once codes 5-9 exist (QuietStreet=7 would "win" over
  Highway=3); hence the placement fence (Task 1).
- **Regression contract**: the existing 16-mask exhaustive test, 4-way
  junction test, and street<avenue<highway merge tests
  (tests/engine/fabric.test.ts) must pass UNMODIFIED — editing them is a
  red flag per the PRD.
- **Per-tick hook point** — `src/main.ts:53-56`: `new
  FixedTickLoop(SIM_TICK_MS, () => {})` — the empty callback becomes the
  effort-accrual call; `FixedTickLoop` passes the tick index (engine/loop.ts).
- **Snapshot pattern to mirror** — `ParcelStore.snapshotBytes`
  (fabric.ts:148-163): fixed-width little-endian records; TechState does
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
**Files:** `src/engine/fabric.ts`, `src/ui/renderer.ts`,
`tests/engine/fabric.test.ts`
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
  `transportCategory` becomes an explicit table: 1-3 → road(1), 4 → rail(2),
  5 → bike(3), 6 → rail(2) (streetcar shares rail), 7 → road(1) (quiet
  street reads as street for masks/frontage), 8 → rail(2), 9 →
  pedestrian(4).
- **Placement fence**: `canPlaceTransport` rejects kinds 5-9 outright
  (`MERGEABLE_TRANSPORT = kind <= 4`), with a comment: the `max(kind)`
  junction merge is not capacity-ordered for 5-9; the build-tools feature
  replaces it with a conversion/capacity table before enabling placement.
- `parcelTouchesRoad` frontage: extend to count category-road tiles
  (QuietStreet counts as frontage when it exists later) — via
  `transportCategory(k) === 1` instead of `isRoadKind` internally; classic
  behavior unchanged (verified by untouched existing tests).
- Renderer: palette entries for all 18 new kinds (cheap colors; bands/
  dither reuse) so granted kinds are never invisible later.
**Tests (RED):** code ranges + no collisions (programmatic sweep of the
BuiltKind table); predicate boundaries (4/5, 15/16, 47/48, 127/128);
category table per new kind; `canPlaceTransport` rejects each 5-9 kind on
empty land (the fence, asserted per kind); existing mask/junction/merge
tests pass UNMODIFIED; mask behavior: streetcar connects to rail,
bike path connects only to bike path, quiet street connects to street
(category-level fixtures).
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
| communes | AnarchoCommunism | collective-ownership | kind:Commune | 35 |
| community-ai-nodes | AnarchoCommunism | mutual-aid, local-grids | kind:AINode | 40 |

(34 nodes; 8 cross-branch edges. Flavor lines authored at implementation,
≤90 chars, dharmapunk register.)
- `validateTree(nodes)`: duplicate ids, dangling prereqs, cycles
  (Kahn/DFS), branch-root reachability (every node reaches a no-prereq
  ancestor in… nodes may have cross-branch prereqs, so reachability =
  every node's full prereq closure terminates at roots), kinds granted
  at most once across the tree, granted kinds are valid BuiltKind codes.
  Exported — the test calls it AND it self-checks on synthetic bad trees.
- Guard: add `src/tech` to scanned dirs; `src/ui/techContent.ts` to the
  pure-ui allowlist (it doesn't exist yet — the guard tolerates listed-
  but-absent files OR the entry lands in Task 5; **decide: add the
  allowlist entry in Task 5** when the file exists, keep this task's guard
  change to the `src/tech` dir).
**Tests (RED):** validateTree passes on TECH_TREE; per-property synthetic
failures (cycle, dangling, dup id, dup kind grant, bad kind code) each
flagged (self-check); branch coverage ≥2 nodes each; ≥3 cross-branch
edges (count actual: 8); every design-brief example node present by id
(explicit list); guard scans src/tech (drop a synthetic violation via a
temp-file approach OR assert the dir is in the scanned list — simplest:
export the scanned-dirs array and assert membership + that tree.ts is
among scanned files).
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
sequence → different; snapshot stable under unlock-order permutation of
the SAME final set? — NO: snapshot encodes the set sorted, so two orders
reaching the same set ARE byte-equal — assert that deliberately (set
semantics, order-free) while effort balances may differ (cost sums equal
here, so equal — fixture uses equal-cost paths to pin set-sorting).
**Validation:** `npx vitest run`

### Task 4: Communal effort accrual (first real sim work)
**Files:** `src/tech/effort.ts`, `tests/tech/effort.test.ts`,
`src/main.ts`
**Approach:** `effortPerTick(world): number` — PLACEHOLDER banner comment
(replaced by the civic sim): `max(1, floor(aliveParcels/8 +
conditionMean/32))` — integer math only. `accrue(state, world, ticks)`
adds `ticks * effortPerTick(world)` (formula constant within a call;
recompute per call, not per tick — placement/condition won't change
mid-frame yet). main.ts: the FixedTickLoop callback becomes
`tech.effort += effortPerTick(world)` via `accrue(tech, world, 1)` and
marks the panel dirty if open. Headless safety unchanged (wiring stays
inside `main()`).
**Tests (RED):** formula on fixtures (empty world → 1 minimum; higher
condition mean → strictly more, same parcel count); N ticks twice →
equal balances (determinism in tick count); integer-only output;
placeholder banner present (string assertion on the source via the
guard-style read — cheap honesty check).
**Validation:** `npx vitest run`

### Task 5: Pure tech-panel content
**Files:** `src/ui/techContent.ts`, `tests/ui/techContent.test.ts`,
`tests/architecture.test.ts` (allowlist entry)
**Approach:** view models from (tree, state): `branchColumns()` → 7
columns ordered as the PRD lists the philosophies, each with nodes in
topological-ish display order (roots first, then by cost); per-node
`{id, name, flavor, cost, status: 'locked'|'affordable'|'unlocked',
missing: string[]}`; `effortLine(state)`. All strings ≤90 chars.
**Tests (RED):** status transitions across a scripted unlock sequence;
missing lists name the actual unmet prereqs (by name, not id); column
count/order; allowlist now includes techContent.ts and the guard passes;
determinism (pure data in → same out).
**Validation:** `npx vitest run`

### Task 6: Tech panel shell + wiring
**Files:** `src/ui/techPanel.ts`, `src/main.ts`, `index.html`
**Approach:** `mountTechPanel(container, deps)` mirroring `mountOpening`:
zero game imports — deps are `{getContent(): …, onUnlock(id): boolean}`
callbacks; `T` toggles (ignores keypresses while the opening overlay is
up); click affordable → `onUnlock` → re-render from `getContent()`;
effort counter refreshed on a dirty flag from the tick callback. Styles in
index.html (panel right-docked, palette-consistent, internal scroll).
main.ts wires tree+state+accrual+panel; `?seed=` unaffected.
**Tests:** headless import safety (existing smoke); panel logic beyond
content is the thin-shell exception — covered by the lead's live browser
pass (toggle, unlock end-to-end, gating visible, coexistence with
overlay/map, reload determinism).
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

Additive (new src/tech + ui modules; fabric.ts code/predicate additions
behind the placement fence; main.ts wiring). Revert = don't merge. The
placement fence guarantees no map state can contain kinds 5-9/48+ yet, so
reverting cannot strand data.

## 6. Uncertainty Log

- **Costs are placeholder balance** (tier-scaled 10-50); the structural
  acceptance bar (DAG/gating/determinism) is what's tested. Balancing
  feature later.
- **`accrue` recomputes the formula per call, not per tick** — correct
  while nothing mutates the world mid-frame; the build-tools feature must
  revisit (noted in the banner comment).
- **Capability strings are unvalidated free text** by design (consumers
  arrive in later features); validateTree could pin a registry later.
- **Panel-while-overlay key handling**: `T` ignored until the opening
  overlay dismisses — verify interaction in the lead's browser pass.
- **transportCategory table values** (streetcar=rail, quiet-street=road,
  promenade=pedestrian) are design calls the build-tools feature will
  exercise for real; masks are tested now so changing them later is a
  visible, deliberate edit.
