# PRP: Build Tools

## Source PRD: docs/PRDs/build-tools.md
## Date: 2026-06-12

## 1. Context Summary

The game's core verb: a pure tool system (select → preview → apply,
spending communal effort) over new fabric capabilities — an explicit
transport-conversion table (road diets as transformations), the kinds 5-9
fence replaced with empty-land placement, frontage reconciliation — plus
the renderer's kind-dispatch extension behind a pure `builtRenderKey`
seam, a toolbar dock, and click-apply input. This lands the three changes
the tech-tree PRP contractually coupled to this feature, together.

## 2. Codebase Analysis

(Line refs re-verified at HEAD `382623a`; the fabric.test.ts FROZEN-suite
refs below are corrected — the tech-tree merge shifted them off the numbers
an earlier draft inherited from the tech-tree PRP.)

- **Fence + merge** — src/engine/fabric.ts: `MERGEABLE_TRANSPORT_MAX = 4`
  :273, `canPlaceTransport` :321 with the 5-9 fence at :326,
  `placeTransport` merge `max()` :344-350, `demolishTransportAt` :388,
  `demolishParcel` :367, placement single-writer block comment :256-262.
  The conversion function joins this block; the fence line at :326 is
  REPLACED by empty-land-only placement for 5-9. **The junction-merge
  predicate stays EXACTLY as-is — `isRoadKind(kind) && isRoadKind(existing)`
  (1..3) for road junctions and `=== Rail` for rail (fabric.ts:332-333).
  Do NOT generalize the merge test to `transportCategory` equality:
  QuietStreet(7) is category road (transportCategory→1), so a category
  predicate would let Street(1) and QuietStreet(7) merge, and `max(1,7)=7`
  (fabric.ts:348) is the precise capacity-unsafe outcome the fence exists to
  prevent.** Because `isRoadKind(7)` is false, street-onto-QuietStreet (and
  QuietStreet onto anything) already fail through the unchanged predicate —
  keeping it is the safe path. Placing street onto a QuietStreet tile is
  REJECTED; the reverse (narrowing a street to a quiet street) is a
  CONVERSION, not a placement.
- **FROZEN suites** (byte-unmodified, same contract as tech-tree):
  tests/engine/fabric.test.ts classic merge :357, rail-crossing :369,
  16-config mask sweep :459, 4-way junction :491, AND the transit-category
  mask suite :511-547 (kinds 5-9 injected via setBuilt — untouched by this
  feature, must stay green). The tech-tree fence tests ("refuses to place
  transit kind K on empty land", describe :393 / per-kind `it` :407) are
  REQUIRED edits this feature — they encode the old fence and flip by design
  (placement on empty land becomes legal); rewrite them as the new
  placement-rule tests. The "no merge/no crossing for 5-9" property they
  also carried must be preserved in the rewrite.
- **Frontage** — `parcelTouchesRoad` (fabric.ts :453, the `isRoadKind`
  check at :466) swaps to `transportCategory(k) === 1` (QuietStreet counts).
  The ONLY behavioral delta vs `isRoadKind` is QuietStreet (cat 1): all four
  existing frontage tests (:549-580) stay green unchanged (RoadStreet→cat 1
  stays true, Rail→cat 2 so the rail-frontage test stays false); add
  QuietStreet cases.
- **Renderer** — src/ui/renderer.ts: `BUILDING_STYLES` record :76 (16-23),
  `ROAD_STYLES` :56-60 (kinds 1-3 ONLY), atlas keys `road-{kind}-{mask}` /
  `rail-{mask}` :228-232, building keys `b-{kind}-{pos}-{tier}` :234-238
  (pos from `footprintPos` :275, computed at render time :338), binary
  dispatch :331-339 (`built === Rail ? rail : road-...` at :334) — replaced
  by a new pure module `src/ui/renderKey.ts` (allowlisted) exporting BOTH
  `builtRenderKey(kind, mask, pos, condTier)` (note: `pos` is REQUIRED — a
  building key needs the footprint position, which a 3-arg signature could
  not express) AND `renderKeyspace(): readonly string[]` (the total
  enumeration of every key the renderer can request). The atlas builder is
  refactored to ITERATE `renderKeyspace()` when painting tiles, so the key
  set has a single pure source of truth and the Task-4 totality test can
  assert `builtRenderKey ⊆ renderKeyspace` HEADLESSLY (today `buildAtlas`
  :215-242 couples enumeration to `paintTile`→`document.createElement`
  :111-115, so the pure keyspace must be factored out — Task 4 scopes that
  split). Atlas/style growth: **QuietStreet(7)** gets a road-category tile
  set + a `ROAD_STYLES[7]` entry so it keys `road-7-{mask}` — it is
  placeable on empty land AND the target of street/avenue→QuietStreet, so it
  WILL render; without the entry `makeRoadTile(7, mask)` derefs
  `ROAD_STYLES[7]!` (undefined) and throws. Plus `streetcar-{mask}`,
  `elev-{mask}`, `bike-{mask}`, `ped-{mask}` transport sets and building
  styles for 48-60 (solarpunk palette per PRD). Preview overlay: renderer
  gains `setPreview(tiles: {x,y,valid}[] | null)` drawn as translucent
  green/red tints after the built pass.
- **Input** — src/ui/input.ts `attachInput` :8 (drag pan, wheel zoom,
  arrows; currently pans on EVERY pointermove while down :25-29). Click-
  apply: track pointerdown position; on pointerup classify via the pure
  `classifyPointer` (NET displacement < 5px = click) and, with a tool
  selected, apply at the tile under the cursor (`camera.screenToWorld`
  floor). Pan-vs-tool precedence and line-drag tile enumeration live in the
  pure `inputGeometry` module (Task 5), not the shell. Hover: pointermove
  with a tool selected → preview recompute (throttled to tile changes).
- **Wiring** — src/main.ts: techPanel mount :87, `panelDirty` :111-122
  pattern; toolbar mirrors it. Tool effects mark canvas `dirty` AND
  `panelDirty` (effort changed).
- **Guard** — tests/architecture.test.ts: scanned dirs include src/tech;
  add `src/tools` (fail-closed — auto-covers `tools.ts` AND
  `inputGeometry.ts`); `PURE_UI_ALLOWLIST` gains `src/ui/toolbarContent.ts`
  + `src/ui/renderKey.ts`.
- **Effort spend** — effort is TechState's invariant (integer, non-negative,
  u32-encoded in `snapshotBytes` :88-102), and `unlock` already debits it
  under guard (state.ts:55-60). Build-tools adds a SECOND debit path, so it
  must be a guarded single-writer too: add `TechState.spend(n: number):
  boolean` BESIDE `unlock` (rejects non-integer or insufficient `n`,
  mutating NOTHING on reject; guards exactly as `unlock` does). `applyTool`
  calls `tech.spend(cost)` — NOT an external mutator of the public field.
  This keeps the effort invariant in one place (single-writer discipline,
  cf. fabric.ts:256-262), so the u32 snapshot cannot silently corrupt from a
  drifting second writer.

**Execution mechanics:** full team pipeline; lead owns the live browser
pass + tier strip.

## 3. Implementation Plan

**Test Command:** `npx vitest run`

### Task 1: Transport conversion table + fence replacement (fabric)
**Files:** `src/engine/fabric.ts`, `tests/engine/fabric.test.ts`
**Approach:**
- `TRANSPORT_CONVERSIONS: ReadonlyMap<BuiltKind, readonly BuiltKind[]>`:
  Street→[QuietStreet, Promenade, BikePath]; Avenue→[Street, QuietStreet];
  Highway→[Avenue]; Rail→[Streetcar]. Exported.
- `canConvertTransport(map, x, y, to)`: tile holds a `from` whose entry
  contains `to`. `convertTransport(map, x, y, to)`: validates, writes
  `built[i] = to`. Single-writer block. Never touches parcel layer/store.
- Fence replacement in `canPlaceTransport`: replace `if (kind >
  MERGEABLE_TRANSPORT_MAX) return false` (:326) so kinds 5-9 are legal on
  EMPTY land only (in-bounds, land, `built === 0` — never onto an occupied
  tile). **Leave the junction-merge predicate UNCHANGED:** keep
  `isRoadKind(kind) && isRoadKind(existing)` (1..3) and `Rail === Rail`
  (:332-333). Do NOT rewrite it in `transportCategory` terms — that would
  admit Street(1)↔QuietStreet(7) merges (shared category 1) and `max(1,7)=7`,
  reintroducing the capacity hazard. Because `isRoadKind(7)` is false, every
  >4 kind is excluded from merging on BOTH sides by the existing predicate;
  5-9 reach a tile only via the new empty-land branch. Classic 1-4 path
  stays byte-identical.
**Tests (RED):** every table entry converts in place (built changes, map
otherwise hashWorld-stable except that tile); every non-entry (incl.
reverse directions, converting empty/building tiles, to-kinds ≤4 not in
tables) rejected without mutation; 5-9 placement on empty land succeeds
per kind; 5-9 onto ANY occupied tile rejected; **merge-hazard guard
(non-vacuous — it must observe the regression, which `built` alone cannot):
with a QuietStreet(7) tile in place, `placeTransport` of EACH of Street/
Avenue/Highway onto it returns FALSE and leaves `built === 7`. The
category-predicate regression returns TRUE here, yet `max(7,1..3)` still
no-ops the tile to 7 — so the RETURN VALUE is the only tell, and asserting
`built` would pass under the bug. Complementary direction: with a Street/
Avenue/Highway tile in place, `placeTransport(QuietStreet)` returns FALSE
and `built` is unchanged (the empty-only fence). The frozen 1-4 suites
cannot see either**;
REQUIRED rewrite of the old fence tests (:393/:407) preserving
no-merge/no-crossing properties; FROZEN suites (:357/:369/:459/:491/:511)
untouched; conversions don't disturb adjacent parcels' frontage (placed
parcel on a street, convert street→QuietStreet, agreement clean).
**Validation:** `npx vitest run`; `npx tsc --noEmit`

### Task 2: Frontage reconciliation
**Files:** `src/engine/fabric.ts`, `tests/engine/fabric.test.ts`
**Approach:** `parcelTouchesRoad` internal check → `transportCategory(k)
=== 1`. (QuietStreet=7 is category road; BikePath/Promenade/rail kinds
are not.)
**Tests (RED):** QuietStreet-fronted parcel → true; Promenade/BikePath-
fronted → false (pedestrian/bike are not road frontage); all existing
frontage tests pass UNCHANGED; integration: parcel fronting a street,
street converted to QuietStreet → still fronted.
**Validation:** `npx vitest run`

### Task 3: Tool system (pure)
**Files:** `src/tools/tools.ts`, `tests/tools/tools.test.ts`,
`src/tech/state.ts` + `tests/tech/state.test.ts` (the new guarded `spend`
method), `tests/architecture.test.ts` (scan src/tools)
**Approach:**
```ts
type ToolId = 'inspect' | 'bulldoze' | `build-${number}` | `convert-${number}`;
interface ToolDef {id, name, hotkey?, cost, kind?, footprint?: {w,h}}
BUILD_COSTS: per-kind table (parcels 8-30 by footprint/kind tier;
  transport 3-6/tile; conversions 2-4/tile; bulldoze 1)
availableTools(tech): ToolDef[]  // inspect+bulldoze always; build-K per
  granted kind (footprints: parklet 1x1, garden 1x1..2x2 → fixed per-kind
  table; transit kinds 5-9 → transport tools). CONVERSION-TOOL GATING (two
  branches — a single "target granted" rule is UNSATISFIABLE for classic
  targets, which the tree never grants): a tool `convert-{to}` is available
  iff EITHER (a) `to` is a tech kind (5-9) AND `tech.grantedKinds()`
  includes it — covers convert-5/6/7/9; OR (b) `to` is a CLASSIC kind (1-4)
  AND `tech.hasCapability('road-diets')` — covers convert-1 (avenue→street)
  and convert-2 (highway→avenue), the PRD road-diet/boulevard-reversal that
  the target-granted rule would make permanently unreachable. (The
  `road-diets` node exists in the tree and is the prereq spine for the
  transit grants, so branch (b) is reachable exactly when narrowing applies.)
previewTool(world, tech, tool, x, y): {valid, reason?}   // pure, no mutation
applyTool(world, tech, tool, x, y): {ok, reason?}        // validates incl.
  effort, debits via `tech.spend(cost)` (the guarded TechState method — see
  §2 Effort spend), calls single-writers (placeParcel/placeTransport/
  convertTransport/demolishParcel/demolishTransportAt; bulldoze looks up the
  parcel id from `map.parcel` for demolishParcel, else demolishTransportAt)
```
Inspect: applyTool returns info without mutation (and without cost).
**Tests (RED):** `TechState.spend` (in state.test.ts): debits exactly,
rejects insufficient/non-integer with NO mutation, leaves snapshotBytes
unchanged on reject; availableTools across an unlock sequence (parklets
unlock → build-48 appears; streetcar-revival → convert-6 + build-6;
**road-diets capability → convert-1 AND convert-2 appear, and are ABSENT
before it** — the classic-target case the old example omitted); preview
never mutates (hashWorld + `tech.snapshotBytes` byte-equal before/after,
valid AND invalid cases); apply: exact cost debit (assert
`tech.snapshotBytes`), insufficient-effort rejection (no mutation), each
tool family routes to the right single-writer (build parcel/transport,
convert, bulldoze parcel + transport), determinism ((world,tech,action)
replayed on a regenerated world → identical hashWorld AND identical
`tech.snapshotBytes` — hashWorld folds only {map,parcels}, so effort
determinism needs the snapshot too); agreement sweep clean after a scripted
mixed sequence; inspect free + non-mutating.
**Validation:** `npx vitest run`

### Task 4: builtRenderKey + atlas extension + preview overlay
**Files:** `src/ui/renderKey.ts`, `tests/ui/renderKey.test.ts`,
`src/ui/renderer.ts`, `tests/architecture.test.ts` (allowlist)
**Approach:** `src/ui/renderKey.ts` (pure, allowlisted) exports:
- `builtRenderKey(kind, mask, pos, condTier): string` — total over all
  placeable kinds. Transport → `road-{k}-{m}` (k ∈ 1,2,3,7 — QuietStreet
  reads road), `rail-{m}`, `streetcar-{m}`, `elev-{m}`, `bike-{m}`,
  `ped-{m}` (mask used; pos/tier ignored); buildings → `b-{kind}-{pos}-
  {tier}` (pos used; mask ignored). `pos` is a REQUIRED param (footprint
  corner/edge/center) — the seam cannot complete a building key without it.
- `renderKeyspace(): readonly string[]` — the exhaustive, deterministic
  enumeration of every key above (each placeable kind × its relevant dims).
  Single source of truth for the key set.
Renderer: the dispatch at :331-339 calls `builtRenderKey(...)` (passing the
`footprintPos`/tier it already computes); `buildAtlas` is refactored to
ITERATE `renderKeyspace()` to paint each tile, decoupling key enumeration
from `paintTile`. Atlas/style growth: a **QuietStreet(7)** road-set +
`ROAD_STYLES[7]` entry (else `makeRoadTile(7, m)` throws on undefined
style), plus `streetcar/elev/bike/ped` tile sets and `BUILDING_STYLES`
48-60 (solarpunk palette: parklet/garden greens, solar blues, compost
browns, commons warm sandstone, bazaar textiles). `setPreview(tiles|null)`
+ translucent tint pass (green valid / red invalid) after the built pass.
**Tests (RED):** renderKey totality + membership — for every kind in
BuiltKind except None, sweep its relevant dims (transport: 16 masks;
buildings: pos ∈ {c,e,k} × tier ∈ {0,1}) and assert `builtRenderKey` is
non-empty AND ∈ `renderKeyspace()` (the membership assertion the DOM-free
keyspace makes possible); `renderKeyspace()` has no duplicates and is
order-stable; an explicit QuietStreet(7) case asserts its key resolves into
the enumerated road set (regression for the missing-style throw);
deterministic; allowlist green (renderKey.ts + toolbarContent.ts). Renderer
drawing / atlas painting stays the untested thin shell (lead browser pass).
**Validation:** `npx vitest run`

### Task 5: Toolbar content (pure) + dock shell + input + wiring
**Files:** `src/ui/toolbarContent.ts`, `tests/ui/toolbarContent.test.ts`,
`src/tools/inputGeometry.ts` + `tests/tools/inputGeometry.test.ts` (pure
click/line logic), `src/ui/toolbar.ts`, `src/ui/input.ts`, `src/main.ts`,
`index.html`, `tests/architecture.test.ts` (allowlist)
**Approach:** content: `toolbarRows(tools, toolState, effort)` →
{id, label `Name · cost`, selected, affordable}; shell `mountToolbar`
(zero game imports; deps {getRows, onSelect}). **Pure input geometry
(`src/tools/inputGeometry.ts`, guard-scanned — extracted so the
determinism-sensitive logic is unit-tested, not left to manual QA, per the
tech-tree `shouldTogglePanel` precedent):** `classifyPointer(downSx, downSy,
upSx, upSy, threshold=5): 'click' | 'drag'` keyed on NET pointer
displacement (Euclidean distance down→up, NOT summed path length — a
jittery in-place press that never leaves the tile stays a click);
`lineTiles(x0, y0, x1, y1): {x,y}[]` enumerating the axis-major straight
line of tiles start→end, deterministic. **Pan-vs-tool precedence (resolves
the AC#8 "drag still pans" contradiction):** with NO tool or a
non-transport tool selected, a drag PANS (AC#8 preserved) and a click
applies at the tile; with a TRANSPORT tool selected, a drag paints
`lineTiles` (suppressing pan) and a click applies one tile — to pan with a
transport tool held, deselect (Escape) or hold the pan modifier (middle
button). Line application: each tile via `applyTool` in start→end order;
insufficient effort stops further tiles (deterministic prefix). The
`src/ui/input.ts` shell only reads pointer events, calls `classifyPointer`
/ `lineTiles` / `camera.screenToWorld`, and dispatches — no geometry of its
own. Hover preview recompute on tile change; hotkeys
(i/x inspect/bulldoze, Escape deselect). main wiring: tool state, preview →
renderer.setPreview, apply → dirty + panelDirty.
**Tests (RED):** toolbarContent states across selection/afford changes;
**inputGeometry (pure): `classifyPointer` at / just-under / just-over the
5px NET threshold (incl. a jitter case whose summed motion >5px but net
<5px → still click); `lineTiles` determinism, axis-major selection,
endpoints, and the single-tile (x0==x1 && y0==y1) case**; input/dock DOM
plumbing stays the thin shell (lead browser pass confirms pan-vs-tool
precedence and line painting live); smoke headless safety.
**Validation:** `npx vitest run`; `npm run build`

### Task 6: Docs
**Files:** `README.md`
**Approach:** Tools section: dock, hotkeys, conversions-as-road-diets,
effort costs, what bulldoze does. **Validation:** suite green.

## 4. Validation Gates

```bash
npx tsc --noEmit && npx vitest run && npm run build
npm run dev   # lead: unlock→tool→place→convert→bulldoze→tints→pan/drag
```

## 5. Rollback Plan

Branch revert. Fabric changes are additive (new functions) plus the fence
swap and frontage internal change; `TechState.spend` is an additive guarded
method beside `unlock`; the renderKey extraction + atlas `renderKeyspace()`
refactor is behavior-preserving for existing kinds. All covered by
rewritten/extended tests; frozen + totality suites prove classic behavior
intact. No persistence.

## 6. Uncertainty Log

- **Conversion table contents** are design calls (avenue→street as "road
  diet" narrowing; highway→avenue as the boulevard reversal); cheap to
  amend — they're data + per-entry tests.
- **Costs** are placeholder economy values; balancing later.
- **Conversion gating** splits on classic-vs-tech target (`road-diets` cap
  for convert-1/2 vs target-kind grant for convert-5/6/7/9); if the tree
  ever grants a classic kind this collapses back to one rule.
- **Pan-vs-tool precedence** (a transport-tool drag paints; panning then
  needs deselect or the middle-button modifier) is a v1 call — revisit if
  playtest finds it awkward (e.g. a dedicated hand tool).
- **Line-drag UX** (axis-major straight line) is v1; freeform paths later.
- **Inspect surface** minimal (dock line); full inspector panel later.
- **Inspect as applyTool** is a slight modeling stretch (non-mutating
  "tool") — kept for uniform input handling; revisit if it grows.
