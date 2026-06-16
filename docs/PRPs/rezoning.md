# PRP: Rezoning

## Source PRD: docs/PRDs/rezoning.md
## Date: 2026-06-15

## 1. Context Summary

Add the player's restorative counter-move: **convert an existing building
parcel in place into green, soil-healing land.** Two new kinds (`Park` 61,
`RewildedLand` 62), a `convertParcel` single-writer (the building analogue of
`convertTransport`), an ecology paved-cap **exemption** so depaved parcels heal,
two tech nodes (`pocket-parks`, `rewilding`), and the `convert-61`/`convert-62`
tools — reusing the existing convert/tool/tech/repair machinery throughout. No
new mechanism, no worldgen change, no direct ecology-layer writes. Determinism
and ecology layer-isolation are preserved.

## 2. Codebase Analysis

**Engine — `src/engine/fabric.ts`:**
- `BuiltKind` (`:24-60`) uses 48–60; **61/62 are free**. `VALID_KINDS`
  (`tree.ts:144` = `Object.values(BuiltKind)`) auto-accepts them;
  `isBuildingKind` (`:68`) covers 16–127; `parcelTouchesRoad`/`footprintPos`/
  `checkParcelAgreement` treat 61/62 as buildings.
- `convertTransport(map,x,y,to)` (`:389`) is the in-place transport conversion
  model. `ParcelStore` has `setCondition`/`setDensity` (`:194,198`) but **no
  `setKind`** (the `kind` array is private). `placeParcel`/`demolishParcel`
  (`:315,410`) are the parcel single-writers; `snapshotBytes` (`:211`) encodes
  kind+condition+density so `hashWorld` already covers a convert.
- `TRANSPORT_CONVERSIONS` (`:279`) is a from→[to] table; rezoning is simpler —
  *any* alive building parcel → a fixed target set.

**Ecology — `src/ecology/tick.ts` + `influence.ts`:**
- `tick.ts:107`: `const sealed = water[i] !== Water.None ||
  isTransportKind(built[i]!) || parcel[i] !== 0;` then `if (sealed && v >
  PAVED_CAP) v = PAVED_CAP;` (`PAVED_CAP = 40`). **The single line to change.**
- `tick.ts` imports `influenceOf, RADIUS` from `influence.ts` and reads `built`
  read-only — so `isUnsealed` belongs in `influence.ts` (keys on kind exactly
  like `influenceOf`; no new import direction). `INFLUENCE` (`influence.ts:56`)
  is the signed per-kind table; greens (CommunityGarden/Parklet/…) are positive
  + `fragmenting:false`.
- Test patterns (`tests/ecology/tick.test.ts`): `new GameMap(w,h)` (all land);
  `map.setBuilt/setParcel/setSoilHealth`, `getSoilHealth`. The paved-cap test
  (`:53-61`): ParkingLot + `setParcel(…,1)` + soil 200 → after a tick `≤ 40`.
  Layer-isolation (`:241-287`): `fabricFingerprint` equal before/after a tick;
  the AC7 test applies a tool then ticks and asserts fabric+tech bytes stable.

**Tech — `src/tech/tree.ts` + `state.ts`:**
- `node(id,branch,name,prereqs,cost,grants,flavor)`; `kind(k)` = `{kinds:[k]}`.
  `parklets` (`:65`, NU, prereq `road-diets`) and `community-gardens` (`:79`,
  GD, prereqs `urban-composting`+`road-diets`) are the anchors.
  `validateTree` enforces: each kind granted **once**, prereqs reach a root,
  acyclic, kebab ids.
- `TechState.grantedKinds()` (`state.ts:78`) = union of unlocked nodes' kinds;
  `unlock(id)` (`:55`), `hasCapability(cap)` (`:88`). Test pattern
  (`tests/tech/tree.test.ts`, `tests/tools/tools.test.ts`):
  `createTechState(TECH_TREE)`, `tech.effort = N`, `tech.unlock('walkable-
  streets'); …; tech.unlock('parklets')` then assert `grantedKinds()` /
  `availableTools`.

**Tools — `src/tools/tools.ts`:**
- Tool id `convert-${number}` keyed by **target kind**; `toolDef` (`:152`) reads
  `CONVERT_TABLE` (`:119`, keyed by target). `availableTools` (`:168`) convert
  gate (`:177-182`): `isTechTarget(to)` (5–9) → `grantedKinds().has(to)`, else
  `hasCapability('road-diets')`. `geometryValid` (`:200`) and `applyTool`
  (`:286`) `convert-*` branches call `canConvertTransport`/`convertTransport`
  **unconditionally** — the dispatch point.
- `isRepairTool` (`ui/repairTools.ts:20`): **true for any `convert-*`** → trust
  credit for `convert-61/62` with **no change**.
- Test patterns (`tests/tools/tools.test.ts`): `availableTools(tech).map(t=>t.id)`;
  the `convert-6`/streetcar gate test (`:105-117`) is the mirror for the new
  granted-kind convert gate; `applyTool(world, tech, toolDef('convert-61')!, x, y)`
  with `tech.effort` high + a parcel at (x,y).

**UI — `renderKey.ts` + `renderer.ts`:** `BUILDING_RENDER_KINDS`
(`renderKey.ts:42`) + `BUILDING_STYLES` (`renderer.ts:129`) must both gain
61/62 or the totality test (`renderKey.test.ts:15`) and the coverage guard
(`:110`) fail. `builtRenderKey` → `b-61-{pos}-{tier}` already (building branch).

## 3. Implementation Plan

**Test Command:** `npx vitest run` (full suite). Per-task: the focused file,
e.g. `npx vitest run tests/engine/fabric.test.ts`. Gates also include
`npx tsc --noEmit` and `npm run build`.

> Order: kinds+render first (foundation — later kinds must resolve and the atlas
> must paint), then the `convertParcel` writer, then the ecology heal, then the
> tech gate, then the tools that tie it together. Each task = one atomic commit,
> RED → GREEN → REFACTOR, full suite green at every commit.

### Task 1: Park(61) + RewildedLand(62) kinds + render
**Files:** `src/engine/fabric.ts`, `src/ui/renderKey.ts`, `src/ui/renderer.ts`,
`tests/ui/renderKey.test.ts`
**Approach:** Add `Park: 61`, `RewildedLand: 62` to `BuiltKind`. Append both to
`BUILDING_RENDER_KINDS` (renderKey) and add `BUILDING_STYLES` entries
(renderer): Park = tended green (mown/path marks), RewildedLand = wilder green
(scrub texture) — both distinct from Parklet/CommunityGarden.
**Tests (RED first):** `builtRenderKey(BuiltKind.Park,0,'c',0) === 'b-61-c-0'`,
`RewildedLand → 'b-62-…'`; `renderKeyspace()` includes the full `b-61`/`b-62`
pos×tier sets; the existing totality test (every `Object.values(BuiltKind)` in
keyspace) and the `renderKeyspace ⊆ {paintable}` BUILDING_STYLE coverage guard
stay green (they will fail first if 61/62 are added to BuiltKind without the
render entries — that's the RED).
**Validation:** `npx vitest run tests/ui/renderKey.test.ts` + full suite +
`tsc` + `npm run build` (exercises `buildAtlas`).

### Task 2: `convertParcel` single-writer + `ParcelStore.setKind`
**Files:** `src/engine/fabric.ts`, `tests/engine/fabric.test.ts`
**Approach:**
- `ParcelStore.setKind(i, k)` — mirror `setCondition`; JSDoc "convertParcel-only".
- `REZONE_TARGETS = new Set<BuiltKind>([Park, RewildedLand])`.
- `canConvertParcel(map, store, x, y, to)`: in-bounds; `to ∈ REZONE_TARGETS`;
  tile holds a **building** kind (`isBuildingKind(built[idx])`) with a non-zero
  parcel id whose store entry `isAlive`; reject same-kind (`built[idx] === to`).
- `convertParcel(map, store, x, y, to)`: if `!canConvertParcel` return false
  (write nothing); else resolve `pid = map.parcel[idx]`, `i = pid-1`, and across
  the store entry's footprint write `map.built = to` (parcel layer unchanged —
  same id), then `store.setKind(i, to)` and `store.setCondition(i, 255)`.
  Returns true. Joins the single-writer block beside convertTransport.
**Tests (RED first):** id + footprint preserved (a 3×3 parcel → all 9 tiles new
kind, same pid); kind swapped in `built` **and** store; condition → 255; parcel
still `isAlive`; `checkParcelAgreement` empty after; rejected (writes nothing,
returns false) on empty tile, transport tile, dead parcel, non-REZONE target,
and same-kind; `hashWorld` stable across a repeated convert sequence and changes
on a convert.
**Validation:** `npx vitest run tests/engine/fabric.test.ts` + full suite.

### Task 3: Ecology paved-cap exemption + Park/RewildedLand influence
**Files:** `src/ecology/influence.ts`, `src/ecology/tick.ts`,
`tests/ecology/tick.test.ts` (+ `tests/ecology/influence.test.ts` if present)
**Approach:**
- `influence.ts`: `export const UNSEALED_KINDS = new Set<BuiltKind>([Park,
  RewildedLand])` and `export const isUnsealed = (k:number) =>
  UNSEALED_KINDS.has(k as BuiltKind)`. Add `INFLUENCE` entries: Park
  `{soil:+2, flora:+2, fauna:+1, fragmenting:false}`, RewildedLand
  `{soil:+3, flora:+2, fauna:+2, fragmenting:false}` (placeholder magnitudes;
  signs are the contract).
- `tick.ts:107`: `const sealed = water[i] !== Water.None ||
  isTransportKind(built[i]!) || (parcel[i] !== 0 && !isUnsealed(built[i]!));`
  (import `isUnsealed`). Nothing else changes; still writes only the 3 layers.
**Tests (RED first):**
- `isUnsealed(Park)` / `isUnsealed(RewildedLand)` true; `isUnsealed(ParkingLot)`
  false. `influenceOf(Park).soil > 0` and `.fragmenting === false` (same for
  RewildedLand).
- **Soil recovery (mirror `:53-61` inverted):** a Park parcel
  (`setBuilt(x,y,Park); setParcel(x,y,1); setSoilHealth(x,y,40)`) rises **above
  40** over N ticks; a ParkingLot control (same setup) stays **≤ 40**.
- Layer-isolation tests stay green (the change reads kind, writes only ecology).
**Validation:** `npx vitest run tests/ecology/` + full suite.

### Task 4: Tech nodes `pocket-parks` + `rewilding`
**Files:** `src/tech/tree.ts`, `tests/tech/tree.test.ts`
**Approach:** add
`node('pocket-parks', NewUrbanism, 'Pocket Parks', ['parklets'], 25,
kind(BuiltKind.Park), '<flavor>')` and
`node('rewilding', GreenDevelopment, 'Rewilding', ['community-gardens'], 30,
kind(BuiltKind.RewildedLand), '<flavor>')` (dharmapunk flavor ≤90 chars).
**Tests (RED first):** `validateTree(TECH_TREE)` stays `[]` (each of 61/62
granted once, prereqs reach a root, acyclic); after unlocking the prereq chain +
the node, `grantedKinds()` contains Park / RewildedLand respectively. **Check
`tests/tech/tree.test.ts` for any node-count / total-kinds assertion and update
it** (adding 2 nodes/2 kinds is expected — adjust the count, do not weaken the
structural checks).
**Validation:** `npx vitest run tests/tech/tree.test.ts` + full suite.

### Task 5: `convert-61`/`convert-62` tools — table, gate, dispatch
**Files:** `src/tools/tools.ts`, `tests/tools/tools.test.ts`
**Approach:**
- `CONVERT_TABLE` gains `[BuiltKind.Park]: { label: 'Rezone: Park', cost: 6 }`,
  `[BuiltKind.RewildedLand]: { label: 'Rezone: Rewilded Land', cost: 4 }`
  (`CONVERT_TARGETS` picks them up automatically; `toolDef('convert-61')`
  resolves).
- `availableTools` convert gate → three-way:
  `const ok = isBuildingKind(to) ? tech.grantedKinds().has(to as BuiltKind)
  : isTechTarget(to) ? tech.grantedKinds().has(to as BuiltKind)
  : tech.hasCapability('road-diets');`
- `geometryValid` `convert-*`: `if (isBuildingKind(tool.kind!)) return
  canConvertParcel(map, world.parcels, x, y, tool.kind!) ? valid :
  {invalid-target}; else return canConvertTransport(...)`.
- `applyTool` `convert-*`: `if (isBuildingKind(tool.kind!)) convertParcel(map,
  parcels, x, y, tool.kind!); else convertTransport(map, x, y, tool.kind!)`.
  (Import `canConvertParcel`/`convertParcel`.)
**Tests (RED first):**
- `availableTools` surfaces `convert-61` only after the Park grant chain
  (`walkable-streets→road-diets→parklets→pocket-parks`) and `convert-62` only
  after `…→urban-composting/community-gardens→rewilding`; **never** via
  `road-diets` alone (the building gate, not the capability) — mirror the
  `convert-6` streetcar test.
- The existing convert-1/2 (road-diets) and convert-6 (streetcar) gates stay
  unchanged (regression).
- `applyTool(world, tech, toolDef('convert-61')!, x, y)` on a tile holding an
  alive building parcel converts it (post: kind Park, condition 255, agreement
  empty) and debits `cost` via `tech.spend`; invalid (ok:false, no mutation) on
  empty/road/water/dead tiles; the road-diet `convert-7` apply still works
  (dispatch regression).
- `isRepairTool(toolDef('convert-61')!)` / `convert-62` true (in
  `tests/ui/repairTools.test.ts` — convert-prefix; **no repairTools.ts change**).
**Validation:** `npx vitest run tests/tools/tools.test.ts
tests/ui/repairTools.test.ts` + full suite.

### Task 6: Wellbeing/civic sanity for green parcels
**Files:** `tests/civic/*.test.ts` (and/or `tests/tech/effort.test.ts` where
wellbeing lives) — **characterization; src change only if a miscount is found.**
**Approach/Tests (RED first):** assert a rezoned Park/RewildedLand parcel is
counted as an ordinary **alive** parcel with its (pristine) condition by the
wellbeing derivation, and is **not** in any residential/decline cohort
(`RESIDENTIAL` set is HouseSingle/Apartments/Projects only). Construct a small
world, rezone a derelict parcel, and assert wellbeing does not *drop* (it should
rise or hold — alive + fresh condition). If the civic/wellbeing code branches on
kind in a way that miscounts greens, fix it minimally; otherwise this task is a
guard pinning the intended behavior.
**Validation:** `npx vitest run tests/civic/ tests/tech/effort.test.ts` + full.

## 4. Validation Gates
```bash
npx tsc --noEmit
npx vitest run            # fabric convertParcel, ecology recovery+isolation,
                          # tech grants, tool gating+dispatch, render keys, civic
npm run build             # executes buildAtlas → catches an unpainted b-61/b-62 key
```
Plus the **team-lead live browser pass (Chromium + WebKit)** for AC #11:
unlock pocket-parks/rewilding, rezone a derelict parcel and a parking crater,
confirm they render green and (Eco overlay) soil climbs above the paved cap over
ticks; the unlock-flash fires.

## 5. Rollback Plan
Each task is an isolated commit. The feature is purely additive: reverting the
tools task removes the rezone tools (kinds/convertParcel become dormant);
reverting the ecology task restores the universal paved cap; reverting the kinds
task removes 61/62 (nothing else references them). No save format, no migration.
`convertParcel` joins the single-writer block, so the dual-source-of-truth
invariant is never at risk.

## 6. Uncertainty Log
- **`tests/tech/tree.test.ts` count assertions** — adding 2 nodes/kinds may trip
  a node-count or granted-kind-set test; update the expected count (not the
  structural checks). Confirm during Task 4 RED.
- **Civic kind-counting** — the main unknown (Task 6). Wellbeing reads
  alive/condition/eco/civic (no kind branch expected), but verify the civic
  neighborhood/dynamics don't special-case building kinds in a way that
  miscounts a green parcel. Likely a pure guard, not a fix.
- **Influence magnitudes** for Park/RewildedLand are placeholder (the signs are
  the contract); the live pass + a later balancing pass tune them. The soil
  recovery AC tests an isolated tile so the small positive influence + base
  recovery dominate (a park ringed by suppressors recovers slowly — intended).
- **`convertParcel` density** — left as-is (meaningless for greens; read by
  nothing in the wellbeing/civic path). Flagged in case a later feature wants a
  defined value.
- **Same-kind / source rules** — any alive building parcel is rezonable
  (Maddy's "plops on existing zones"); only a same-kind no-op is rejected.
