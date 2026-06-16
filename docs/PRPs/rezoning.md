# PRP: Rezoning

## Source PRD: docs/PRDs/rezoning.md
## Date: 2026-06-15

## 1. Context Summary

Add the player's restorative counter-move: **convert an existing building parcel
in place into green, soil-healing land.** Two new kinds (`Park` 61, `RewildedLand`
62), a `convertParcel` single-writer (the building analogue of `convertTransport`),
an ecology paved-cap **exemption** so depaved parcels heal, two tech nodes
(`pocket-parks`, `rewilding`), the `convert-61`/`convert-62` tools, a point-plop
`isLineTool` fix (a building rezone is a single-parcel click, not a drag-paint),
and a `GATHERING_KINDS` addition (Park is a gathering place) — reusing the existing
convert/tool/tech/repair/civic machinery throughout. No new mechanism, no worldgen
change, no direct ecology-layer writes. Determinism and ecology layer-isolation are
preserved.

**Scope is convert-only — on sealed alive parcels.** `canConvertParcel` requires a
building kind on a non-zero, alive parcel, so the tools act exactly on the sealed
tiles you cannot otherwise build on (derelict Projects, ParkingLot craters/fields).
*Empty* tiles (`built = 0`) — the ~50% of era-5 demolition craters left cleared
(`moses.ts` `era5Disinvestment`, `craterChance = 0.5`) and green block-interiors —
are rejected by design: they are already unsealed (the `tick.ts:107` `sealed` rule
is false for `built=0, parcel=0`, so their soil already recovers) and already
greenable via the existing build-on-empty greens (Parklet `build-48` / Community
Garden `build-49`, whose nodes are the prereqs of `pocket-parks`/`rewilding`, hence
always co-available). A build-on-empty Park/RewildedLand path is a clean additive
follow-up if Maddy wants it later (PRD Open Q5), out of scope here.

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
  + `fragmenting:false`. **Soil ceiling:** `influence.test.ts:82-88` asserts
  CommunityGarden (soil 6) is the strongest soil boost — new greens must stay < 6.
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
  `hasCapability('road-diets')` — so a building target (61/62, **not** 5–9) would
  fall to the road-diets branch today; the three-way gate fix is required.
  `geometryValid` (`:200`) and `applyTool` (`:286`) `convert-*` branches call
  `canConvertTransport`/`convertTransport` **unconditionally** — the dispatch point.
- `isRepairTool` (`ui/repairTools.ts:20`): **true for any `convert-*`** → trust
  credit for `convert-61/62` with **no change**.
- `isLineTool` (`main.ts:151-159`): line iff `convert-*` (ANY) OR transport
  `build-*`. So `convert-61/62` would inherit **drag-paint** (mass-rezone); the fix
  is `isTransportKind(tool.kind)` (building convert → point; building build was
  already point). It is a local closure → extract to a pure predicate to unit-test
  (the `repairTools.ts` extraction precedent).
- Test patterns (`tests/tools/tools.test.ts`): `availableTools(tech).map(t=>t.id)`;
  the `convert-6`/streetcar gate test (`:105-117`) is the mirror for the new
  granted-kind convert gate; `applyTool(world, tech, toolDef('convert-61')!, x, y)`
  with `tech.effort` high + a parcel at (x,y).

**Civic — `src/civic/dynamics.ts` + `src/tech/effort.ts`:** `GATHERING_KINDS`
(`dynamics.ts:45-51`) = {Bazaar, MakerSpace, HealingCommons, CommunityGarden,
Civic} → a neighborhood with ≥1 gathering tile gets `bDelta += 1` belonging
(`:107,145-147`); belonging feeds `civicMean` → `wellbeing` (`effort.ts:66-70`).
So a gathering-kind→green rezone would drop belonging. `wellbeing` (`effort.ts:56-71`)
itself has **no kind branch** (reads `aliveCount`/`conditionAt` + optional means);
`RESIDENTIAL` (`moses.ts:1034`) is worldgen-only.

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
> tech gate, then the convert tools, the point-plop interaction fix, and finally
> the civic gathering change. Each task = one atomic commit, RED → GREEN →
> REFACTOR, full suite green at every commit.

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
`tests/ecology/tick.test.ts` (+ `tests/ecology/influence.test.ts`)
**Approach:**
- `influence.ts`: `export const UNSEALED_KINDS = new Set<BuiltKind>([Park,
  RewildedLand])` and `export const isUnsealed = (k:number) =>
  UNSEALED_KINDS.has(k as BuiltKind)`. Add `INFLUENCE` entries: Park
  `{soil:+2, flora:+2, fauna:+1, fragmenting:false}`, RewildedLand
  `{soil:+3, flora:+2, fauna:+2, fragmenting:false}` (placeholder magnitudes;
  signs are the contract). **Soil ceiling — keep both `< 6`:**
  `tests/ecology/influence.test.ts:82-88` ("the community garden is the strongest
  soil boost") iterates `INFLUENCE` and asserts every non-garden `soil < 6`. The
  +2/+3 here comply (and RewildedLand's "stronger soil," PRD Q2, means
  stronger-than-Park, still < 6). A later tuner must respect this or consciously
  re-pin that test.
- `tick.ts:107`: `const sealed = water[i] !== Water.None ||
  isTransportKind(built[i]!) || (parcel[i] !== 0 && !isUnsealed(built[i]!));`
  (import `isUnsealed`). Nothing else changes; still writes only the 3 layers.
**Tests (RED first):**
- `isUnsealed(Park)` / `isUnsealed(RewildedLand)` true; `isUnsealed(ParkingLot)`
  false. `influenceOf(Park).soil > 0` and `.fragmenting === false` (same for
  RewildedLand); both `< influenceOf(CommunityGarden).soil`.
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
the node, `grantedKinds()` contains Park / RewildedLand respectively.
**Two existing tree tests break and BOTH are intended manifest updates, not
weakenings** (adding 2 design-brief nodes):
- `tests/tech/tree.test.ts:41` `expect(TECH_TREE.length).toBe(34)` → `36`.
- `tests/tech/tree.test.ts:13-31` `DESIGN_BRIEF_IDS` array + `:45-48`
  `it('contains exactly the design-brief node ids')` (an EXACT-membership check —
  "exactly these, no more, no fewer", comment `:11-12`): **append `'pocket-parks'`
  and `'rewilding'`** to `DESIGN_BRIEF_IDS` (under NewUrbanism / GreenDevelopment
  respectively). This is updating the design-brief *manifest* because the brief
  gained two nodes — NOT loosening a structural invariant. Do NOT touch the
  `validateTree`-based structural checks (`:50-66+`); they must stay green as-is.
**Validation:** `npx vitest run tests/tech/tree.test.ts` + full suite.

### Task 5: `convert-61`/`convert-62` tools — table, gate, dispatch
**Files:** `src/tools/tools.ts`, `tests/tools/tools.test.ts`,
`tests/ui/repairTools.test.ts`
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
  empty/road/water/dead tiles. **Dispatch regression:** a *transport* convert —
  `convert-1` (road→street, `road-diets` capability) and/or `convert-6`
  (rail→streetcar, granted) — still routes to `convertTransport` and mutates the
  built layer only (a building-target convert must not hit `convertTransport`, and
  vice-versa).
- `isRepairTool(toolDef('convert-61')!)` / `convert-62` true (in
  `tests/ui/repairTools.test.ts` — convert-prefix; **no repairTools.ts change**).
**Validation:** `npx vitest run tests/tools/tools.test.ts
tests/ui/repairTools.test.ts` + full suite.

### Task 6: Point-plop — extract `isLineTool`, building convert is a point tool
**Files:** new `src/ui/lineTools.ts` (pure, mirroring `repairTools.ts`),
`src/main.ts`, `tests/ui/lineTools.test.ts`
**Approach:**
- Extract a pure `export function isLineTool(tool: ToolDef): boolean` whose body is
  `tool.kind !== undefined && isTransportKind(tool.kind)` — i.e. line iff the tool
  produces a **transport** kind (build-5..9 / convert-1..9), point otherwise
  (building convert incl. `convert-61/62`, every building build, and inspect/
  bulldoze which have no kind). This preserves today's behavior for transport
  tools and flips ONLY building converts from line→point.
- `main.ts:151-159`: replace the inline `isLineTool` closure with the imported
  predicate; the call site already passes through `toolDef(selectedToolId)`, so
  it becomes `selectedToolId !== null && isLineTool(toolDef(selectedToolId)!)`
  (null id → false, as before).
**Tests (RED first, in `tests/ui/lineTools.test.ts`):**
- `isLineTool(toolDef('convert-1')!)` / `convert-6` / `build-5` → `true`
  (transport build/convert keep drag-paint).
- `isLineTool(toolDef('convert-61')!)` / `convert-62` → `false` (building convert
  is point-plop); `build-49` (Community Garden) → `false` (regression — building
  builds were already point).
- `isLineTool(toolDef('inspect')!)` / `bulldoze` → `false`.
**Validation:** `npx vitest run tests/ui/lineTools.test.ts` + full suite + `tsc`.

### Task 7: Park is a gathering place + green-parcel civic/wellbeing sanity
**Files:** `src/civic/dynamics.ts`, `tests/civic/dynamics.test.ts`,
`tests/tech/effort.test.ts`
**Approach:** add `BuiltKind.Park` to `GATHERING_KINDS` (`dynamics.ts:45-51`) —
reusing the existing belonging mechanism for the new kind, exactly as Park joins
`INFLUENCE`. **RewildedLand stays OUT** (wild, not social). No `wellbeing`
(`effort.ts`) change — it has no kind branch; a green parcel is an ordinary alive
parcel at condition 255.
**Tests (RED first):**
- **Gathering (the YP6 fix), in `dynamics.test.ts`:** a neighborhood whose only
  gathering tile is a Park gets the gathering belonging bonus (`bDelta += 1`);
  `RewildedLand` does NOT. A CommunityGarden→Park rezone (`convertParcel`) is
  **belonging-neutral** across a `civicTick` (the gathering bonus is preserved —
  both are gathering kinds). Pin `Park ∈ GATHERING_KINDS`, `RewildedLand ∉`.
- **Wellbeing (characterization), in `effort.test.ts`:** rezone a derelict
  HouseSingle/Projects parcel (low condition) → Park via `convertParcel`;
  `wellbeing({parcels})` **rises-or-holds** (alive count unchanged, condition mean
  rises from the 255 reset — no kind miscount; no `ecoMeans`/`civicMeans` needed
  for this assertion). Assert Park/RewildedLand ∉ `RESIDENTIAL` (moses-only).
- Note (no test, documented): a *gathering*-kind→RewildedLand rezone can drop
  belonging — a deliberate trade-off (rewilding a social amenity), so the
  rises-or-holds guarantee is scoped to →Park and non-gathering→RewildedLand.
**Validation:** `npx vitest run tests/civic/ tests/tech/effort.test.ts` + full.

## 4. Validation Gates
```bash
npx tsc --noEmit
npx vitest run            # fabric convertParcel, ecology recovery+isolation,
                          # tech grants, tool gating+dispatch, point-plop,
                          # render keys, civic gathering
npm run build             # executes buildAtlas → catches an unpainted b-61/b-62 key
```
Plus the **team-lead live browser pass (Chromium + WebKit)** for AC #13: unlock
pocket-parks/rewilding, rezone a derelict parcel and a parking crater (an alive
ParkingLot parcel) in place, confirm they render green, a drag with a rezone tool
plops only the clicked parcel (no mass-rezone), and (Eco overlay) soil climbs above
the paved cap over ticks; the unlock-flash fires.

## 5. Rollback Plan
Each task is an isolated commit. The feature is purely additive: reverting the
civic task drops Park from `GATHERING_KINDS` (a CommunityGarden→Park rezone goes
back to belonging-neutral-minus-one, harmless); reverting the point-plop task
restores drag-paint converts (cosmetic); reverting the tools task removes the
rezone tools (kinds/convertParcel become dormant); reverting the ecology task
restores the universal paved cap; reverting the kinds task removes 61/62 (nothing
else references them). No save format, no migration. `convertParcel` joins the
single-writer block, so the dual-source-of-truth invariant is never at risk.
**Coupling caveat:** reverting the ecology task (Task 3) is unsafe while
`convert-61/62` exist — a converted park has `parcel ≠ 0`, so without the
`isUnsealed` exemption it would seal its OWN soil at the paved cap (the perverse
inverse of the depave payoff). Task 3 is load-bearing for the convert tools, not
just the depave AC; the Task 3 convert test (a Park parcel at soil 40 rising
> 40 over ticks) already enforces it.

## 6. Uncertainty Log
- **`tests/tech/tree.test.ts` updates (Task 4)** — two tests break and BOTH are
  intended manifest updates: `:41` `length === 34 → 36`, and the
  `DESIGN_BRIEF_IDS` exact-id-set (`:13-31`, asserted `:45-48`) gains
  `pocket-parks` + `rewilding`. The `validateTree` structural checks stay
  untouched. (Resolved per interlocutor YP3.)
- **Civic gathering (Task 7) — a real change.** Civic dynamics DOES branch on kind
  via `GATHERING_KINDS` (dynamics.ts:45-51): rezoning a gathering parcel
  (CommunityGarden/Bazaar/HealingCommons/Civic) into a green would drop the
  neighborhood's gathering belonging bonus → wellbeing. Fix: **Park joins
  `GATHERING_KINDS`** (a park is a gathering place) — CommunityGarden→Park is
  belonging-neutral. RewildedLand stays OUT (wild); a gathering→RewildedLand rezone
  is a deliberate belonging trade-off, so "wellbeing rises-or-holds" is scoped to
  →Park / non-gathering→RewildedLand. (Interlocutor YP5/YP6 + team-lead ruling.)
- **Influence magnitudes** for Park/RewildedLand are placeholder (signs are the
  contract) and bounded by the **soil < 6** ceiling (Task 3). The live pass + a
  later balancing pass tune them. The soil-recovery AC tests an isolated tile so
  the small positive influence + base recovery dominate (a park ringed by
  suppressors recovers slowly — intended).
- **`convertParcel` density** — left as-is (meaningless for greens; read by
  nothing in the wellbeing/civic path). Flagged in case a later feature wants a
  defined value.
- **Same-kind / source rules** — any alive building parcel is rezonable
  (Maddy's "plops on existing zones"); only a same-kind no-op is rejected.
- **Convert-only scope vs. empty land** — `canConvertParcel` rejects empty tiles
  (`built = 0`) by design: there is nothing sealed to depave, and they are already
  greenable via the co-available Parklet/Community Garden. This is faithful to
  Maddy's "plops on **existing zones**," and the PRD §1 motivation + AC#13 are
  scoped so neither implies rezoning fills *empty* craters/interiors. If a
  build-on-empty Park/RewildedLand path is later wanted, it is a clean additive
  follow-up (`BUILD_TABLE[61/62]` + `build-61`/`build-62`, reusing `placeParcel`)
  — PRD Open Q5, flagged for human review, NOT in this PRP.
